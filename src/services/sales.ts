import { supabase } from '../lib/supabase';
import { offlineQuery } from '../lib/offlineQuery';
import { generateOrderNumber } from '../utils/helpers';
import { audit } from './audit';
import { batchFetchInventory, batchFetchInventoryBatches, batchInsert, batchUpdate, batchFetchCustomers, batchFetchProfiles, batchFetchSalesReturns } from '../lib/queryOptimization';
import type { Sale, SaleItem, SalePayment, CartItem, PaymentEntry } from '../types/database';

// Search products for POS - optimized with batch queries
export async function searchProductsForPOS(query: string) {
  let q = supabase
    .from('products')
    .select('*, categories(id, name), inventory(quantity, average_cost)')
    .eq('active', true)
    .limit(50);

  if (query && query.trim() && query.trim() !== '') {
    q = q.or(`name.ilike.%${query}%,sku.ilike.%${query}%,barcode.ilike.%${query}%`);
  }

  const { data: products, error } = await q;
  if (error) throw error;
  if (!products || products.length === 0) return [];

  return products.map((p: any) => {
    const inv = p.inventory;
    const stockQty = Array.isArray(inv) ? (inv[0]?.quantity ?? 0) : (inv?.quantity ?? 0);
    return {
      ...p,
      stock: Number(stockQty),
      categories: p.categories || { name: '' },
    };
  });
}

async function getAvailableBatches(productId: string) {
  const { data, error } = await supabase
    .from('inventory_batches')
    .select('*')
    .eq('product_id', productId)
    .gt('remaining_quantity', 0)
    .order('expiry_date', { ascending: true, nullsFirst: true })
    .order('received_date', { ascending: true });

  if (error) throw error;
  const now = new Date().toISOString().split('T')[0];
  return (data || []).filter((b) => !b.expiry_date || b.expiry_date >= now);
}

// Complete Sale - OPTIMIZED with batch queries
export async function completeSale(params: {
  customer_id?: string;
  cart: CartItem[];
  discount: number;
  tax: number;
  payments: PaymentEntry[];
  notes?: string;
}) {
  const { cart, payments, customer_id, discount, tax, notes } = params;
  const subtotal = cart.reduce((sum, item) => sum + item.line_total, 0);
  const total = subtotal - discount + tax;

  const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0);
  if (Math.abs(totalPayments - total) > 0.01) {
    throw new Error(`Payment total (${totalPayments}) does not match sale total (${total})`);
  }

  // Batch validate stock for all items at once
  const productIds = cart.map(item => item.product.id);
  const inventoryMap = await batchFetchInventory(productIds);
  
  for (const item of cart) {
    const inv = inventoryMap.get(item.product.id);
    if (!inv || Number(inv.quantity) < item.quantity) {
      throw new Error(`Insufficient stock for ${item.product.name}. Available: ${inv?.quantity || 0}`);
    }
  }

  const invoiceNumber = generateOrderNumber('INV');
  const { data: { user } } = await supabase.auth.getUser();
  
  let shiftId: string | null = null;
  const { data: currentShift, error: rpcError } = await supabase
    .rpc('get_current_shift')
    .single();
  
  if (!rpcError && currentShift) {
    shiftId = (currentShift as any)?.id || null;
  } else {
    const { data } = await supabase
      .from('cashier_shifts')
      .select('id')
      .eq('status', 'OPEN')
      .eq('user_id', user?.id || '')
      .order('opened_at', { ascending: false })
      .limit(1)
      .single();
    shiftId = data?.id || null;
  }

  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({
      invoice_number: invoiceNumber,
      customer_id: customer_id || null,
      shift_id: shiftId,
      created_by: user?.id || null,
      status: 'COMPLETED',
      subtotal, discount, tax, total, cogs: 0, notes,
    })
    .select()
    .single();

  if (saleError) throw saleError;

  // Batch fetch all needed data
  const batchesMap = await batchFetchInventoryBatches(productIds);
  
  let totalCogs = 0;
  const saleItems: any[] = [];
  const inventoryUpdates: Array<{ id: string; quantity: number }> = [];
  const batchUpdates: any[] = [];
  const movementInserts: any[] = [];

  for (const item of cart) {
    const lineTotal = item.line_total;
    let remainingQty = item.quantity;
    const batches = batchesMap.get(item.product.id) || [];
    const inv = inventoryMap.get(item.product.id)!;
    const currentQty = Number(inv.quantity);

    let batchCogs = 0;
    for (const batch of batches) {
      if (remainingQty <= 0) break;
      const deductFromBatch = Math.min(remainingQty, Number(batch.remaining_quantity));
      batchCogs += deductFromBatch * Number(batch.purchase_cost);

      batchUpdates.push({
        id: batch.id,
        remaining_quantity: Number(batch.remaining_quantity) - deductFromBatch,
      });
      remainingQty -= deductFromBatch;
    }

    const deductionQty = item.quantity;
    const avgCost = Number(inv.average_cost || item.product.purchase_price);
    const actualCogs = deductionQty * avgCost;
    totalCogs += actualCogs;

    saleItems.push({
      sale_id: sale.id,
      product_id: item.product.id,
      quantity: deductionQty,
      unit_price: item.unit_price,
      discount: item.discount,
      tax: item.tax_amount,
      line_total: lineTotal,
      cogs: actualCogs,
    });

    movementInserts.push({
      product_id: item.product.id,
      movement_type: 'SALE',
      quantity_change: -deductionQty,
      unit_cost: avgCost,
      reference_type: 'SALE',
      reference_id: sale.id,
      batch_id: batches.length > 0 ? batches[0].id : null,
    });

    const newInventoryQty = currentQty - deductionQty;
    if (newInventoryQty < 0) {
      throw new Error(`Insufficient stock for ${item.product.name}`);
    }
    
    inventoryUpdates.push({
      id: item.product.id,
      quantity: newInventoryQty,
    });
  }

  // Execute all batch operations in parallel
  await Promise.all([
    batchInsert('sale_items', saleItems),
    batchInsert('inventory_movements', movementInserts),
    batchUpdate('inventory_batches', batchUpdates.map(u => ({ id: u.id, data: { remaining_quantity: u.remaining_quantity } }))),
    supabase.from('sales').update({ cogs: totalCogs }).eq('id', sale.id),
  ]);

  // Update inventory quantities
  for (const update of inventoryUpdates) {
    await supabase
      .from('inventory')
      .update({ quantity: update.quantity })
      .eq('product_id', update.id);
  }

  // Batch insert payments
  if (payments.length > 0) {
    await batchInsert('sale_payments', payments.map(p => ({
      sale_id: sale.id,
      payment_method: p.method,
      amount: p.amount,
      reference: p.reference || null,
    })));
  }

  if (customer_id) {
    const creditAmount = payments.find((p) => p.method === 'CUSTOMER_CREDIT')?.amount || 0;
    if (creditAmount > 0) {
      await supabase.from('customer_transactions').insert({
        customer_id,
        transaction_type: 'CREDIT_SALE',
        amount: creditAmount,
        reference_type: 'SALE',
        reference_id: sale.id,
        narration: `Credit sale - ${invoiceNumber}`,
      });
    }
  }

  // Create journal entries
  const { data: accounts } = await supabase.from('accounts').select('id, code');
  if (accounts) {
    const accountMap = new Map(accounts.map((a) => [a.code, a.id]));
    const { data: je } = await supabase.from('journal_entries').insert({
      reference_type: 'SALE', reference_id: sale.id, description: `Sale - ${invoiceNumber}`,
    }).select().single();

    if (je) {
      const lines: any[] = [];
      lines.push({ journal_entry_id: je.id, account_id: accountMap.get('SALES') || '', debit: 0, credit: total });
      if (totalCogs > 0) {
        lines.push({ journal_entry_id: je.id, account_id: accountMap.get('COGS') || '', debit: totalCogs, credit: 0 });
        lines.push({ journal_entry_id: je.id, account_id: accountMap.get('INVENTORY') || '', debit: 0, credit: totalCogs });
      }
      for (const payment of payments) {
        if (payment.method === 'CUSTOMER_CREDIT') {
          lines.push({ journal_entry_id: je.id, account_id: accountMap.get('AR') || '', debit: payment.amount, credit: 0 });
        } else {
          lines.push({ journal_entry_id: je.id, account_id: accountMap.get('CASH') || '', debit: payment.amount, credit: 0 });
        }
      }
      if (lines.length > 0) await batchInsert('journal_entry_lines', lines);
    }
  }

  await audit.saleCreated(sale.id, {
    invoice_number: invoiceNumber,
    total,
    cogs: totalCogs,
    items_count: cart.length,
    payment_methods: payments.map((p) => p.method),
    has_credit: payments.some((p) => p.method === 'CUSTOMER_CREDIT'),
  });

  return sale as Sale;
}

// Fetch sales history - OPTIMIZED
export async function fetchSales(params?: { page?: number; pageSize?: number; customer_id?: string }) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('sales')
    .select('*', { count: 'exact' })
    .order('sale_date', { ascending: false })
    .range(from, to);

  if (params?.customer_id) query = query.eq('customer_id', params.customer_id);

  const { data: salesData, error, count } = await query;
  if (error) throw error;

  if (!salesData || salesData.length === 0) {
    return { data: [], count: 0, page, pageSize, totalPages: 0 };
  }

  // Batch fetch all related data in parallel
  const custIds = salesData.map((s) => s.customer_id).filter(Boolean);
  const cashierIds = salesData.map((s) => s.created_by).filter(Boolean);
  const saleIds = salesData.map((sale) => sale.id);

  const [customersMap, profilesMap, returnsMap, paymentsRes, chequesRes] = await Promise.all([
    batchFetchCustomers(custIds),
    batchFetchProfiles(cashierIds),
    batchFetchSalesReturns(saleIds),
    supabase.from('sale_payments').select('*').in('sale_id', saleIds),
    supabase.from('cheques').select('*').in('reference_sale_id', saleIds),
  ]);

  const paymentsMap = new Map<string, any[]>();
  paymentsRes.data?.forEach((p) => {
    const list = paymentsMap.get(p.sale_id) || [];
    list.push(p);
    paymentsMap.set(p.sale_id, list);
  });

  const chequesMap = new Map<string, any>();
  chequesRes.data?.forEach((c) => {
    if (c.reference_sale_id) chequesMap.set(c.reference_sale_id, c);
  });

  const merged = (salesData || []).map((s) => {
    const salePayments = paymentsMap.get(s.id) || [];
    const cheque = chequesMap.get(s.id) || null;
    return {
      ...s,
      sale_payments: salePayments,
      cheque,
      customers: s.customer_id ? customersMap.get(s.customer_id) || null : null,
      profiles: s.created_by ? profilesMap.get(s.created_by) || null : null,
      returned_total: returnsMap.get(s.id)?.reduce((sum: number, r: any) => sum + r.total, 0) || 0,
      net_total: Math.max(0, Number(s.total) - (returnsMap.get(s.id)?.reduce((sum: number, r: any) => sum + r.total, 0) || 0)),
      returns: returnsMap.get(s.id) || [],
    };
  });

  const result = { data: merged, count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
  return offlineQuery(`sales-${page}`, async () => result);
}

export async function fetchSale(id: string) {
  const { data: sale, error } = await supabase
    .from('sales')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;

  // Fetch related data separately
  const [itemsResult, paymentsResult, customerResult, profileResult, returnsResult] = await Promise.all([
    supabase.from('sale_items').select('*').eq('sale_id', id),
    supabase.from('sale_payments').select('*').eq('sale_id', id),
    sale.customer_id ? supabase.from('customers').select('*').eq('id', sale.customer_id).single() : null,
    sale.created_by ? supabase.from('profiles').select('id, email, full_name').eq('id', sale.created_by).single() : null,
    supabase.from('sales_returns').select('id, return_number, total, reason, refund_method, created_at').eq('sale_id', id).order('created_at', { ascending: false }),
  ]);

  // Fetch products for items
  const productIds = [...new Set((itemsResult.data || []).map((i) => i.product_id))];
  const { data: products } = await supabase.from('products').select('id, name, sku').in('id', productIds);
  const prodMap = new Map((products || []).map((p) => [p.id, p]));

  const items = (itemsResult.data || []).map((i) => ({
    ...i,
    products: prodMap.get(i.product_id) || { name: 'Unknown', sku: '' },
  }));

  return {
    ...sale,
    sale_items: items,
    sale_payments: paymentsResult.data || [],
    sales_returns: returnsResult.data || [],
    returned_total: (returnsResult.data || []).reduce((sum, saleReturn) => sum + Number(saleReturn.total), 0),
    customers: customerResult?.data || null,
    profiles: profileResult?.data || null,
  };
}

/**
 * Fetch all sales for a specific shift (or today's sales if shift_id is null)
 */
export async function fetchSalesForShift(shiftId: string) {
  // Get the current user to filter sales
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;

  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  // Strategy 1: Get sales linked to this specific shift with creator info
  const { data: linkedSales } = await supabase
    .from('sales')
    .select(`
      *,
      profiles:created_by(email)
    `)
    .eq('shift_id', shiftId)
    .in('status', ['COMPLETED', 'RETURNED'])
    .order('created_at', { ascending: false });

  let salesToUse = linkedSales || [];

  if (salesToUse.length === 0) return [];

  // Fetch items and payments for all sales
  const saleIds = salesToUse.map((s) => s.id);
  const [{ data: items }, { data: payments }, { data: returns }] = await Promise.all([
    supabase.from('sale_items').select('*').in('sale_id', saleIds),
    supabase.from('sale_payments').select('*').in('sale_id', saleIds),
    supabase.from('sales_returns').select('sale_id, total, refund_method, return_number').in('sale_id', saleIds),
  ]);

  const itemMap = new Map<string, typeof items>();
  (items || []).forEach((item) => {
    if (!itemMap.has(item.sale_id)) itemMap.set(item.sale_id, []);
    itemMap.get(item.sale_id)!.push(item);
  });

  const paymentMap = new Map<string, typeof payments>();
  (payments || []).forEach((p) => {
    if (!paymentMap.has(p.sale_id)) paymentMap.set(p.sale_id, []);
    paymentMap.get(p.sale_id)!.push(p);
  });

  const returnMap = new Map<string, Array<{ total: number; refund_method: string; return_number: string }>>();
  (returns || []).forEach((saleReturn) => {
    const existing = returnMap.get(saleReturn.sale_id) || [];
    existing.push({ total: Number(saleReturn.total), refund_method: saleReturn.refund_method, return_number: saleReturn.return_number });
    returnMap.set(saleReturn.sale_id, existing);
  });

  return salesToUse.map((sale: any) => ({
    ...sale,
    created_by_email: sale.profiles?.email || 'Unknown',
    gross_total: Number(sale.total),
    returned_total: (returnMap.get(sale.id) || []).reduce((sum, saleReturn) => sum + saleReturn.total, 0),
    total: Math.max(0, Number(sale.total) - (returnMap.get(sale.id) || []).reduce((sum, saleReturn) => sum + saleReturn.total, 0)),
    items: itemMap.get(sale.id) || [],
    payments: paymentMap.get(sale.id) || [],
    returns: returnMap.get(sale.id) || [],
  }));
}

export async function holdSale(params: { customer_id?: string; cart: CartItem[]; discount: number; tax: number; notes?: string }) {
  const subtotal = params.cart.reduce((sum, item) => sum + item.line_total, 0);
  const total = subtotal - params.discount + params.tax;
  const invoiceNumber = generateOrderNumber('HELD');

  const { data: sale, error } = await supabase
    .from('sales')
    .insert({ invoice_number: invoiceNumber, customer_id: params.customer_id || null, status: 'HELD', subtotal, discount: params.discount, tax: params.tax, total, notes: params.notes })
    .select()
    .single();

  if (error) throw error;

  for (const item of params.cart) {
    await supabase.from('sale_items').insert({
      sale_id: sale.id, product_id: item.product.id, quantity: item.quantity,
      unit_price: item.unit_price, discount: item.discount, tax: item.tax_amount, line_total: item.line_total, cogs: 0,
    });
  }

  return sale;
}

export async function resumeSale(saleId: string) {
  const { data: sale, error } = await supabase
    .from('sales')
    .select('*')
    .eq('id', saleId)
    .eq('status', 'HELD')
    .single();
  if (error) throw error;

  const { data: items } = await supabase.from('sale_items').select('*').eq('sale_id', saleId);
  const productIds = [...new Set((items || []).map((i) => i.product_id))];
  const { data: products } = await supabase.from('products').select('*').in('id', productIds);
  const prodMap = new Map((products || []).map((p) => [p.id, p]));

  return {
    ...sale,
    sale_items: (items || []).map((i) => ({ ...i, products: prodMap.get(i.product_id) || {} })),
  };
}


// ==================== COMPLETE HELD SALE ====================
// Updates an existing HELD sale to COMPLETED instead of creating a new one.
// Deducts inventory, creates stock movements, adds payments, and journal entries.

export async function completeHeldSale(params: {
  saleId: string;
  cart: CartItem[];
  discount: number;
  tax: number;
  payments: PaymentEntry[];
  notes?: string;
}) {
  const { saleId, cart, payments, discount, tax, notes } = params;
  const subtotal = cart.reduce((sum, item) => sum + item.line_total, 0);
  const total = subtotal - discount + tax;

  const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0);
  if (Math.abs(totalPayments - total) > 0.01) {
    throw new Error(`Payment total (${totalPayments}) does not match sale total (${total})`);
  }

  // 1. Fetch the existing HELD sale
  const { data: existingSale, error: fetchError } = await supabase
    .from('sales')
    .select('*')
    .eq('id', saleId)
    .eq('status', 'HELD')
    .single();

  if (fetchError || !existingSale) {
    throw new Error('Held sale not found or already processed');
  }

  // 2. Validate stock
  for (const item of cart) {
    const { data: inv } = await supabase.from('inventory').select('quantity').eq('product_id', item.product.id).single();
    if (!inv || Number(inv.quantity) < item.quantity) {
      throw new Error(`Insufficient stock for ${item.product.name}. Available: ${inv?.quantity || 0}`);
    }
  }

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();

  // Get current shift (fallback to direct query if RPC fails)
  let shiftId: string | null = null;
  const { data: currentShift, error: rpcError } = await supabase
    .rpc('get_current_shift')
    .single();
  
  if (!rpcError && currentShift) {
    shiftId = (currentShift as any)?.id || null;
  } else {
    // Fallback: Query directly for THIS user only
    const { data } = await supabase
      .from('cashier_shifts')
      .select('id')
      .eq('status', 'OPEN')
      .eq('user_id', user?.id || '')
      .order('opened_at', { ascending: false })
      .limit(1)
      .single();
    shiftId = data?.id || null;
  }

  // 3. Update sale status to COMPLETED
  const { error: updateError } = await supabase
    .from('sales')
    .update({
      status: 'COMPLETED',
      shift_id: shiftId,
      created_by: user?.id || null,
      customer_id: cart[0]?.product ? existingSale.customer_id : null,
      subtotal,
      discount,
      tax,
      total,
      notes,
    })
    .eq('id', saleId);

  if (updateError) throw updateError;

  // 4. Update sale_items with correct cogs
  let totalCogs = 0;

  for (const item of cart) {
    const lineTotal = item.line_total;
    let remainingQty = item.quantity;
    const batches = await getAvailableBatches(item.product.id);

    let batchCogs = 0;
    for (const batch of batches) {
      if (remainingQty <= 0) break;
      const deductFromBatch = Math.min(remainingQty, Number(batch.remaining_quantity));
      batchCogs += deductFromBatch * Number(batch.purchase_cost);

      await supabase.from('inventory_batches').update({ remaining_quantity: Number(batch.remaining_quantity) - deductFromBatch }).eq('id', batch.id);
      remainingQty -= deductFromBatch;
    }

    // Get current inventory
    const { data: invData } = await supabase.from('inventory').select('quantity, average_cost').eq('product_id', item.product.id).single();
    const currentQty = Number(invData?.quantity || 0);
    const deductionQty = item.quantity;
    const avgCost = Number(invData?.average_cost || item.product.purchase_price);
    const actualCogs = deductionQty * avgCost;
    totalCogs += actualCogs;

    // Create stock movement
    const movementData: Record<string, unknown> = {
      product_id: item.product.id,
      movement_type: 'SALE',
      quantity_change: -deductionQty,
      unit_cost: avgCost,
      reference_type: 'SALE',
      reference_id: saleId,
    };
    if (batches.length > 0 && batches[0]?.id) {
      movementData.batch_id = batches[0].id;
    }
    const { error: movementError } = await supabase.from('inventory_movements').insert(movementData);
    if (movementError) {
      throw new Error(`Failed to create stock movement: ${movementError.message}`);
    }

    // Update existing sale_items with cogs
    await supabase.from('sale_items').update({ cogs: actualCogs }).eq('sale_id', saleId).eq('product_id', item.product.id);

    // Deduct inventory
    const newInventoryQty = currentQty - deductionQty;
    if (newInventoryQty < 0) {
      throw new Error(`Insufficient stock for ${item.product.name}. Available: ${currentQty}, Needed: ${deductionQty}`);
    }

    const { error: invError } = await supabase
      .from('inventory')
      .update({ quantity: newInventoryQty })
      .eq('product_id', item.product.id);

    if (invError) {
      throw new Error(`Failed to update inventory for ${item.product.name}: ${invError.message}`);
    }
  }

  // 5. Update COGS on sale
  await supabase.from('sales').update({ cogs: totalCogs }).eq('id', saleId);

  // 6. Add payments
  for (const payment of payments) {
    await supabase.from('sale_payments').insert({ sale_id: saleId, payment_method: payment.method, amount: payment.amount, reference: payment.reference || null });
  }

  // 7. Handle customer credit
  const customerId = existingSale.customer_id;
  if (customerId) {
    const creditAmount = payments.find((p) => p.method === 'CUSTOMER_CREDIT')?.amount || 0;
    if (creditAmount > 0) {
      await supabase.from('customer_transactions').insert({
        customer_id: customerId, transaction_type: 'CREDIT_SALE', amount: creditAmount,
        reference_type: 'SALE', reference_id: saleId, narration: `Credit sale - ${existingSale.invoice_number}`,
      });
    }
  }

  // 8. Create journal entries
  const { data: accounts } = await supabase.from('accounts').select('id, code');
  if (accounts) {
    const accountMap = new Map(accounts.map((a) => [a.code, a.id]));
    const { data: je } = await supabase.from('journal_entries').insert({
      reference_type: 'SALE', reference_id: saleId, description: `Sale - ${existingSale.invoice_number}`,
    }).select().single();

    if (je) {
      const lines: { journal_entry_id: string; account_id: string; debit: number; credit: number }[] = [];
      lines.push({ journal_entry_id: je.id, account_id: accountMap.get('SALES') || '', debit: 0, credit: total });
      if (totalCogs > 0) {
        lines.push({ journal_entry_id: je.id, account_id: accountMap.get('COGS') || '', debit: totalCogs, credit: 0 });
        lines.push({ journal_entry_id: je.id, account_id: accountMap.get('INVENTORY') || '', debit: 0, credit: totalCogs });
      }
      for (const payment of payments) {
        if (payment.method === 'CUSTOMER_CREDIT') {
          lines.push({ journal_entry_id: je.id, account_id: accountMap.get('AR') || '', debit: payment.amount, credit: 0 });
        } else {
          lines.push({ journal_entry_id: je.id, account_id: accountMap.get('CASH') || '', debit: payment.amount, credit: 0 });
        }
      }
      if (lines.length > 0) await supabase.from('journal_entry_lines').insert(lines);
    }
  }

  // 9. Audit log
  await audit.saleCreated(saleId, {
    invoice_number: existingSale.invoice_number,
    total,
    cogs: totalCogs,
    items_count: cart.length,
    payment_methods: payments.map((p) => p.method),
    has_credit: payments.some((p) => p.method === 'CUSTOMER_CREDIT'),
  });

  return { ...existingSale, status: 'COMPLETED', total, cogs: totalCogs } as Sale;
}

export async function cancelSale(saleId: string) {
  // Fetch sale items to restore inventory
  const { data: items } = await supabase
    .from('sale_items')
    .select('product_id, quantity')
    .eq('sale_id', saleId);

  // Restore inventory for each item
  for (const item of items || []) {
    const { data: inv } = await supabase
      .from('inventory')
      .select('quantity')
      .eq('product_id', item.product_id)
      .single();
    if (inv) {
      await supabase
        .from('inventory')
        .update({ quantity: Number(inv.quantity) + item.quantity })
        .eq('product_id', item.product_id);
    }
    // Create stock movement to record the restoration
    await supabase.from('inventory_movements').insert({
      product_id: item.product_id,
      movement_type: 'SALE_RETURN',
      quantity_change: item.quantity,
      reference_type: 'SALE',
      reference_id: saleId,
      narration: 'Sale cancelled - inventory restored',
    });
  }

  // Update sale status
  const { error } = await supabase.from('sales').update({ status: 'CANCELLED' }).eq('id', saleId);
  if (error) throw error;
}

export async function fetchHeldSales() {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .eq('status', 'HELD')
    .order('sale_date', { ascending: false });
  if (error) throw error;

  // Fetch customers
  const custIds = [...new Set((data || []).map((s) => s.customer_id).filter(Boolean))];
  const { data: customers } = await supabase.from('customers').select('id, name').in('id', custIds);
  const custMap = new Map((customers || []).map((c) => [c.id, c.name]));

  return (data || []).map((s) => ({
    ...s,
    customers: s.customer_id ? { name: custMap.get(s.customer_id) || 'Unknown' } : null,
  }));
}

export async function processSaleReturn(params: {
  sale_id: string; customer_id?: string; reason: string; refund_method: string;
  items: { sale_item_id: string; quantity: number; amount: number }[];
}) {
  // Pure JS implementation — no RPC. Avoids 406/double-restoration issues.
  const returnNumber = generateOrderNumber('SR');
  const totalRefund = params.items.reduce((sum, i) => sum + i.amount, 0);

  console.log('[SalesReturn] Processing return:', returnNumber, 'items:', params.items.length, 'total:', totalRefund);

  // 1. Create the sales_returns header
  const { data: newReturn, error: retError } = await supabase
    .from('sales_returns')
    .insert({
      sale_id: params.sale_id,
      return_number: returnNumber,
      reason: params.reason,
      refund_method: params.refund_method,
      total: totalRefund,
    })
    .select()
    .single();

  if (retError) throw retError;

  // 2. For each returned item: create return item record, restore inventory, log movement
  for (const item of params.items) {
    // Get the sale item to find the product
    const { data: saleItem } = await supabase
      .from('sale_items')
      .select('product_id, quantity')
      .eq('id', item.sale_item_id)
      .single();

    if (!saleItem?.product_id) {
      console.warn('[SalesReturn] Could not find product for sale item:', item.sale_item_id);
      continue;
    }

    // Create the sales_return_items record
    await supabase.from('sales_return_items').insert({
      sales_return_id: newReturn.id,
      sale_item_id: item.sale_item_id,
      quantity: item.quantity,
      amount: item.amount,
    });

    // Restore inventory — add the returned quantity back
    const { data: inv } = await supabase
      .from('inventory')
      .select('quantity')
      .eq('product_id', saleItem.product_id)
      .single();

    if (inv) {
      const newQty = Number(inv.quantity) + Number(item.quantity);
      await supabase
        .from('inventory')
        .update({ quantity: newQty })
        .eq('product_id', saleItem.product_id);
      console.log(`[SalesReturn] Restored ${item.quantity} units of ${saleItem.product_id}: ${inv.quantity} → ${newQty}`);
    } else {
      await supabase
        .from('inventory')
        .insert({ product_id: saleItem.product_id, quantity: Number(item.quantity) });
    }

    // Log the stock movement
    await supabase.from('inventory_movements').insert({
      product_id: saleItem.product_id,
      movement_type: 'SALE_RETURN',
      quantity_change: Number(item.quantity),
      reference_type: 'SALES_RETURN',
      reference_id: newReturn.id,
      narration: `Return ${returnNumber} — ${item.quantity} units restored`,
    });
  }

  // 3. Update the sale status if fully returned
  const { data: existingReturns } = await supabase
    .from('sales_returns')
    .select('total')
    .eq('sale_id', params.sale_id);

  const { data: sale } = await supabase
    .from('sales')
    .select('total')
    .eq('id', params.sale_id)
    .single();

  if (sale && existingReturns) {
    const totalReturned = existingReturns.reduce((sum, r) => sum + Number(r.total), 0);
    const newStatus = totalReturned >= Number(sale.total) - 0.01 ? 'RETURNED' : 'COMPLETED';
    await supabase
      .from('sales')
      .update({ status: newStatus })
      .eq('id', params.sale_id);
  }

  console.log('[SalesReturn] Return processed successfully:', returnNumber);
  return { return_id: newReturn.id, return_number: returnNumber, total: totalRefund };
}

// Quick return function - return entire sale
export async function createSalesReturn(params: {
  sale_id: string;
  return_reason: string;
  notes: string;
}) {
  const { data: saleItems, error } = await supabase
    .from('sale_items')
    .select('id, quantity, line_total')
    .eq('sale_id', params.sale_id);

  if (error) throw error;
  if (!saleItems?.length) throw new Error('Sale has no returnable items');

  return processSaleReturn({
    sale_id: params.sale_id,
    reason: params.return_reason,
    refund_method: 'CASH',
    items: saleItems.map(item => ({
      sale_item_id: item.id,
      quantity: Number(item.quantity),
      amount: Number(item.line_total),
    })),
  });
}
