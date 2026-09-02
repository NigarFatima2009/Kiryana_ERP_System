import { supabase } from '../lib/supabase';
import { offlineQuery } from '../lib/offlineQuery';
import { generateOrderNumber } from '../utils/helpers';
import { audit } from './audit';
import type { PurchaseOrder, PurchaseOrderItem, GoodsReceipt, GoodsReceiptItem } from '../types/database';

// ==================== PURCHASE ORDERS ====================

export async function fetchPurchaseOrders(params?: {
  status?: string;
  supplier_id?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('purchase_orders')
    .select('*, suppliers!purchase_orders_supplier_id_fkey(name, company)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params?.status) query = query.eq('status', params.status);
  if (params?.supplier_id) query = query.eq('supplier_id', params.supplier_id);

  const { data, error, count } = await query;
  if (error) throw error;
  const result = { data: data as (PurchaseOrder & { suppliers: { name: string; company: string | null } })[], count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
  return offlineQuery(`purchase-orders-${page}-${pageSize}-${params?.status || 'all'}-${params?.supplier_id || 'all'}`, async () => result);
}

export async function fetchPurchaseOrder(id: string) {
  console.log('[fetchPurchaseOrder] Starting with id:', id);
  
  // Fetch main purchase order
  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .select('*')
    .eq('id', id)
    .single();
  
  console.log('[fetchPurchaseOrder] PO fetch result:', { po, poError });
  if (poError) throw poError;

  // Fetch supplier and items safely
  console.log('[fetchPurchaseOrder] Fetching supplier and items in parallel...');
  const [supplierRes, itemsRes] = await Promise.all([
    po.supplier_id
      ? supabase.from('suppliers').select('*').eq('id', po.supplier_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from('purchase_order_items').select('*').eq('purchase_order_id', id)
  ]);

  console.log('[fetchPurchaseOrder] Supplier fetch:', supplierRes);
  console.log('[fetchPurchaseOrder] Items fetch:', itemsRes);

  const items = itemsRes.data || [];
  const supplier = supplierRes.data || null;

  console.log('[fetchPurchaseOrder] Items array length:', items.length);
  console.log('[fetchPurchaseOrder] Items data:', items);

  // Batch fetch products for all items
  const productIds = [...new Set(items.map((i: any) => i.product_id).filter(Boolean))];
  console.log('[fetchPurchaseOrder] Product IDs to fetch:', productIds);
  
  let prodMap = new Map();
  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from('products')
      .select('id, name, sku, purchase_price, selling_price')
      .in('id', productIds);
    console.log('[fetchPurchaseOrder] Products fetched:', products);
    prodMap = new Map((products || []).map((p) => [p.id, p]));
  }

  // Enrich items with product data
  const enrichedItems = items.map((item: any) => ({
    ...item,
    products: prodMap.get(item.product_id) || { id: item.product_id, name: 'Unknown Product', sku: '' }
  }));

  console.log('[fetchPurchaseOrder] Enriched items:', enrichedItems);

  const result = {
    ...po,
    suppliers: supplier,
    purchase_order_items: enrichedItems
  };
  
  console.log('[fetchPurchaseOrder] Final result:', result);
  return result;
}

export async function createPurchaseOrder(order: {
  supplier_id: string;
  notes?: string;
  discount?: number;
  tax?: number;
  items: { product_id: string; quantity: number; unit_cost: number; discount?: number }[];
}) {
  let total = 0;
  for (const item of order.items) {
    total += (item.quantity * item.unit_cost) - (item.discount || 0);
  }
  total = total - (order.discount || 0) + (order.tax || 0);

  const orderNumber = generateOrderNumber('PO');

  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .insert({
      order_number: orderNumber,
      supplier_id: order.supplier_id,
      status: 'DRAFT',
      discount: order.discount || 0,
      tax: order.tax || 0,
      total,
      notes: order.notes,
    })
    .select()
    .single();

  if (poError) throw poError;

  const items = order.items.map((item) => ({
    purchase_order_id: po.id,
    product_id: item.product_id,
    quantity: item.quantity,
    unit_cost: item.unit_cost,
    discount: item.discount || 0,
  }));

  const { error: itemsError } = await supabase.from('purchase_order_items').insert(items);
  if (itemsError) throw itemsError;

  // Create audit log
  await audit.purchaseOrderCreated(po.id, {
    order_number: orderNumber,
    supplier_id: order.supplier_id,
    total,
    items_count: order.items.length,
  });

  return po as PurchaseOrder;
}

export async function updatePurchaseOrderStatus(id: string, status: string) {
  const { data, error } = await supabase.from('purchase_orders').update({ status }).eq('id', id).select().single();
  if (error) throw error;
  return data as PurchaseOrder;
}

// ==================== GOODS RECEIPTS (Receiving) ====================

export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface GoodsReceiptWithStatus extends GoodsReceipt {
  suppliers: { name: string; company: string | null };
  payment_status: PaymentStatus;
  paid_amount: number;
  outstanding: number;
}

export async function fetchGoodsReceipts(params?: { supplier_id?: string; page?: number; pageSize?: number }) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('goods_receipts')
    .select('*, suppliers!goods_receipts_supplier_id_fkey(name, company)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params?.supplier_id) query = query.eq('supplier_id', params.supplier_id);

  const { data, error, count } = await query;
  if (error) throw error;

  // Calculate payment status per receipt using payment records linked to each receipt
  const receiptStatusMap = new Map<string, { payment_status: PaymentStatus; paid_amount: number; outstanding: number }>();

  for (const receipt of data || []) {
    const receiptId = receipt.id as string;
    const total = Number(receipt.total);

    // Get payments linked to THIS SPECIFIC receipt
    const { data: receiptPayments } = await supabase
      .from('supplier_transactions')
      .select('amount, transaction_type')
      .eq('reference_id', receiptId)
      .eq('reference_type', 'PURCHASE');

    let paidAmount = 0;
    for (const txn of receiptPayments || []) {
      if (txn.transaction_type === 'PAYMENT') {
        paidAmount += Number(txn.amount);
      } else if (txn.transaction_type === 'RETURN') {
        paidAmount -= Math.abs(Number(txn.amount));
      }
    }

    paidAmount = Math.max(0, Math.round(paidAmount * 100) / 100); // Round to 2 decimals
    const outstanding = Math.max(0, Math.round((total - paidAmount) * 100) / 100);

    let paymentStatus: PaymentStatus = 'UNPAID';
    if (outstanding < 0.01 && total > 0) {
      paymentStatus = 'PAID';
    } else if (paidAmount > 0.01 && outstanding > 0.01) {
      paymentStatus = 'PARTIAL';
    }

    receiptStatusMap.set(receiptId, {
      payment_status: paymentStatus,
      paid_amount: paidAmount,
      outstanding,
    });
  }

  const enriched = (data || []).map((receipt) => {
    const status = receiptStatusMap.get(receipt.id as string) || {
      payment_status: 'UNPAID' as PaymentStatus,
      paid_amount: 0,
      outstanding: Number(receipt.total),
    };

    return { ...receipt, ...status };
  });

  const result = { data: enriched as GoodsReceiptWithStatus[], count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
  return offlineQuery(`goods-receipts-${page}`, async () => result);
}

export async function fetchGoodsReceipt(id: string) {
  const { data, error } = await supabase
    .from('goods_receipts')
    .select('*, suppliers!goods_receipts_supplier_id_fkey(*), goods_receipt_items(*, products!goods_receipt_items_product_id_fkey(name, sku))')
    .eq('id', id)
    .single();
  if (error) throw error;

  let paymentStatus: PaymentStatus = 'UNPAID';
  let paidAmount = 0;
  let outstanding = Number(data.total);
  const total = Number(data.total);

  // Get payments linked to THIS SPECIFIC receipt only
  const { data: receiptPayments } = await supabase
    .from('supplier_transactions')
    .select('amount, transaction_type')
    .eq('reference_id', id)
    .eq('reference_type', 'PURCHASE');

  paidAmount = 0;
  for (const txn of receiptPayments || []) {
    if (txn.transaction_type === 'PAYMENT') {
      paidAmount += Number(txn.amount);
    } else if (txn.transaction_type === 'RETURN') {
      paidAmount -= Math.abs(Number(txn.amount));
    }
  }

  paidAmount = Math.max(0, Math.round(paidAmount * 100) / 100); // Round to 2 decimals
  outstanding = Math.max(0, Math.round((total - paidAmount) * 100) / 100);

  if (outstanding < 0.01 && total > 0) {
    paymentStatus = 'PAID';
  } else if (paidAmount > 0.01 && outstanding > 0.01) {
    paymentStatus = 'PARTIAL';
  }

  return { ...data, payment_status: paymentStatus, paid_amount: paidAmount, outstanding };
}

export async function receiveGoods(receipt: {
  purchase_order_id?: string;
  supplier_id: string;
  received_date?: string;
  notes?: string;
  items: { product_id: string; quantity: number; unit_cost: number; expiry_date?: string; batch_number?: string; manufacturing_date?: string }[];
}) {
  let subtotal = 0;
  for (const item of receipt.items) {
    subtotal += item.quantity * item.unit_cost;
  }

  const receiptNumber = generateOrderNumber('GR');

  // 1. Create goods receipt
  const { data: gr, error: grError } = await supabase
    .from('goods_receipts')
    .insert({
      receipt_number: receiptNumber,
      purchase_order_id: receipt.purchase_order_id || null,
      supplier_id: receipt.supplier_id,
      received_date: receipt.received_date || new Date().toISOString().split('T')[0],
      subtotal,
      total: subtotal,
      notes: receipt.notes,
    })
    .select()
    .single();

  if (grError) throw grError;

  // 2. For each item: create batch, update inventory, create receipt item, create movement
  for (const item of receipt.items) {
    // Generate unique batch number if not provided or if it already exists
    let batchNum = item.batch_number || null;
    if (batchNum) {
      const { data: existing } = await supabase
        .from('inventory_batches')
        .select('id')
        .eq('batch_number', batchNum)
        .eq('product_id', item.product_id)
        .maybeSingle();
      if (existing) {
        batchNum = `${batchNum}-${Date.now()}`;
      }
    } else {
      batchNum = `B-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    }

    // Create batch
    const { data: batch, error: batchError } = await supabase
      .from('inventory_batches')
      .insert({
        product_id: item.product_id,
        supplier_id: receipt.supplier_id,
        batch_number: batchNum,
        purchase_cost: item.unit_cost,
        received_quantity: item.quantity,
        remaining_quantity: item.quantity,
        manufacturing_date: item.manufacturing_date || null,
        expiry_date: item.expiry_date || null,
        received_date: receipt.received_date || new Date().toISOString().split('T')[0],
      })
      .select()
      .single();

    if (batchError) throw batchError;

    // Create receipt item
    await supabase.from('goods_receipt_items').insert({
      goods_receipt_id: gr.id,
      product_id: item.product_id,
      batch_id: batch.id,
      quantity: item.quantity,
      unit_cost: item.unit_cost,
    });

    // Update inventory
    const { data: inv } = await supabase.from('inventory').select('*').eq('product_id', item.product_id).single();
    if (inv) {
      const newQty = inv.quantity + item.quantity;
      const newCost = inv.quantity > 0
        ? ((inv.average_cost * inv.quantity) + (item.unit_cost * item.quantity)) / newQty
        : item.unit_cost;
      await supabase.from('inventory').update({ quantity: newQty, average_cost: newCost }).eq('product_id', item.product_id);
    } else {
      await supabase.from('inventory').insert({ product_id: item.product_id, quantity: item.quantity, average_cost: item.unit_cost });
    }

    // Create inventory movement
    await supabase.from('inventory_movements').insert({
      product_id: item.product_id,
      batch_id: batch.id,
      movement_type: 'PURCHASE',
      quantity_change: item.quantity,
      unit_cost: item.unit_cost,
      reference_type: 'GOODS_RECEIPT',
      reference_id: gr.id,
    });
  }

  // 3. Update PO status if linked
  if (receipt.purchase_order_id) {
    const { data: poItems } = await supabase
      .from('purchase_order_items')
      .select('quantity, received_quantity')
      .eq('purchase_order_id', receipt.purchase_order_id);

    const totalOrdered = poItems?.reduce((sum, i) => sum + Number(i.quantity), 0) || 0;
    const totalReceived = (poItems?.reduce((sum, i) => sum + Number(i.received_quantity), 0) || 0) + receipt.items.reduce((sum, i) => sum + i.quantity, 0);

    let newStatus = 'PARTIALLY_RECEIVED';
    if (totalReceived >= totalOrdered) newStatus = 'RECEIVED';

    await supabase.from('purchase_orders').update({ status: newStatus }).eq('id', receipt.purchase_order_id);

    for (const item of receipt.items) {
      const { data: poItem } = await supabase
        .from('purchase_order_items')
        .select('id, received_quantity')
        .eq('purchase_order_id', receipt.purchase_order_id)
        .eq('product_id', item.product_id)
        .single();
      if (poItem) {
        await supabase
          .from('purchase_order_items')
          .update({ received_quantity: Number(poItem.received_quantity) + item.quantity })
          .eq('id', poItem.id);
      }
    }
  }

  // 4. Supplier transaction (increase payable)
  await supabase.from('supplier_transactions').insert({
    supplier_id: receipt.supplier_id,
    transaction_type: 'PURCHASE',
    amount: subtotal,
    reference_type: 'GOODS_RECEIPT',
    reference_id: gr.id,
    narration: `Goods received: ${receiptNumber}`,
  });

  // Create audit log
  await audit.purchaseReceived(gr.id, {
    receipt_number: receiptNumber,
    supplier_id: receipt.supplier_id,
    total: subtotal,
    items_count: receipt.items.length,
  });

  return gr as GoodsReceipt;
}
