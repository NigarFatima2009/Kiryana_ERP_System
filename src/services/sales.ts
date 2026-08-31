import { supabase } from '../lib/supabase';
import { generateOrderNumber } from '../utils/helpers';
import { audit } from './audit';
import type { Sale, SaleItem, SalePayment, CartItem, PaymentEntry } from '../types/database';

// Search products for POS - reliable approach without complex joins
export async function searchProductsForPOS(query: string) {
  // Step 1: Search products
  const { data: products, error } = await supabase
    .from('products')
    .select('*')
    .eq('active', true)
    .or(`name.ilike.%${query}%,sku.ilike.%${query}%,barcode.ilike.%${query}%`)
    .limit(50);

  if (error) throw error;
  if (!products || products.length === 0) return [];

  // Step 2: Get inventory for found products
  const productIds = products.map((p) => p.id);
  const { data: inventory } = await supabase
    .from('inventory')
    .select('product_id, quantity')
    .in('product_id', productIds);

  // Step 3: Get categories
  const catIds = [...new Set(products.map((p) => p.category_id).filter(Boolean))];
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .in('id', catIds);

  // Step 4: Merge data
  const invMap = new Map((inventory || []).map((i) => [i.product_id, Number(i.quantity)]));
  const catMap = new Map((categories || []).map((c) => [c.id, c.name]));

  return products.map((p) => ({
    ...p,
    stock: invMap.get(p.id) || 0,
    categories: { name: catMap.get(p.category_id) || '' },
  }));
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

// Complete Sale
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

  // Validate stock
  for (const item of cart) {
    const { data: inv } = await supabase.from('inventory').select('quantity').eq('product_id', item.product.id).single();
    if (!inv || Number(inv.quantity) < item.quantity) {
      throw new Error(`Insufficient stock for ${item.product.name}. Available: ${inv?.quantity || 0}`);
    }
  }

  const invoiceNumber = generateOrderNumber('INV');
  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({
      invoice_number: invoiceNumber,
      customer_id: customer_id || null,
      status: 'COMPLETED',
      subtotal, discount, tax, total, cogs: 0, notes,
    })
    .select()
    .single();

  if (saleError) throw saleError;

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

    // Create stock movement for every sale item
    const movementData: Record<string, unknown> = {
      product_id: item.product.id,
      movement_type: 'SALE',
      quantity_change: -deductionQty,
      unit_cost: avgCost,
      reference_type: 'SALE',
      reference_id: sale.id,
    };
    // Only add batch_id if we actually have one
    if (batches.length > 0 && batches[0]?.id) {
      movementData.batch_id = batches[0].id;
    }
    const { error: movementError } = await supabase.from('inventory_movements').insert(movementData);
    if (movementError) {
      throw new Error(`Failed to create stock movement: ${movementError.message}`);
    }

    await supabase.from('sale_items').insert({
      sale_id: sale.id,
      product_id: item.product.id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount: item.discount,
      tax: item.tax_amount,
      line_total: lineTotal,
      cogs: actualCogs,
    });

    const { error: invError } = await supabase.from('inventory').update({ quantity: currentQty - deductionQty }).eq('product_id', item.product.id);
    if (invError) {
      throw new Error(`Failed to update inventory for ${item.product.name}: ${invError.message}`);
    }
  }

  await supabase.from('sales').update({ cogs: totalCogs }).eq('id', sale.id);

  for (const payment of payments) {
    await supabase.from('sale_payments').insert({ sale_id: sale.id, payment_method: payment.method, amount: payment.amount, reference: payment.reference || null });
  }

  if (customer_id) {
    const creditAmount = payments.find((p) => p.method === 'CUSTOMER_CREDIT')?.amount || 0;
    if (creditAmount > 0) {
      await supabase.from('customer_transactions').insert({
        customer_id, transaction_type: 'CREDIT_SALE', amount: creditAmount,
        reference_type: 'SALE', reference_id: sale.id, narration: `Credit sale - ${invoiceNumber}`,
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

  // Create audit log for the sale
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

// Fetch sales history
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

  // Fetch customers
  const custIds = [...new Set((salesData || []).map((s) => s.customer_id).filter(Boolean))];
  const { data: customers } = await supabase.from('customers').select('id, name').in('id', custIds);
  const custMap = new Map((customers || []).map((c) => [c.id, c.name]));

  const merged = (salesData || []).map((s) => ({
    ...s,
    customers: s.customer_id ? { name: custMap.get(s.customer_id) || 'Unknown' } : null,
  }));

  return { data: merged, count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
}

export async function fetchSale(id: string) {
  const { data: sale, error } = await supabase
    .from('sales')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;

  // Fetch related data separately
  const [itemsResult, paymentsResult, customerResult] = await Promise.all([
    supabase.from('sale_items').select('*').eq('sale_id', id),
    supabase.from('sale_payments').select('*').eq('sale_id', id),
    sale.customer_id ? supabase.from('customers').select('*').eq('id', sale.customer_id).single() : null,
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
    customers: customerResult?.data || null,
  };
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
  const total = params.items.reduce((sum, item) => sum + item.amount, 0);
  const returnNumber = generateOrderNumber('SR');

  const { data: sr, error: srError } = await supabase
    .from('sales_returns')
    .insert({ sale_id: params.sale_id, customer_id: params.customer_id || null, return_number: returnNumber, reason: params.reason, refund_method: params.refund_method, total })
    .select()
    .single();
  if (srError) throw srError;

  for (const item of params.items) {
    await supabase.from('sales_return_items').insert({ sales_return_id: sr.id, sale_item_id: item.sale_item_id, quantity: item.quantity, amount: item.amount });
    const { data: saleItem } = await supabase.from('sale_items').select('product_id').eq('id', item.sale_item_id).single();
    if (saleItem) {
      const { data: inv } = await supabase.from('inventory').select('quantity').eq('product_id', saleItem.product_id).single();
      if (inv) await supabase.from('inventory').update({ quantity: Number(inv.quantity) + item.quantity }).eq('product_id', saleItem.product_id);
      await supabase.from('inventory_movements').insert({ product_id: saleItem.product_id, movement_type: 'SALE_RETURN', quantity_change: item.quantity, reference_type: 'SALES_RETURN', reference_id: sr.id });
    }
  }

  if (params.customer_id && params.refund_method === 'CUSTOMER_CREDIT') {
    await supabase.from('customer_transactions').insert({
      customer_id: params.customer_id, transaction_type: 'RETURN', amount: total, reference_type: 'SALES_RETURN', reference_id: sr.id, narration: `Sale return - ${returnNumber}`,
    });
  }

  return sr;
}
