import { supabase } from '../lib/supabase';
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
  return { data: data as (PurchaseOrder & { suppliers: { name: string; company: string | null } })[], count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
}

export async function fetchPurchaseOrder(id: string) {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*, suppliers!purchase_orders_supplier_id_fkey(*), purchase_order_items(*, products!purchase_order_items_product_id_fkey(name, sku))')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
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

  // Fetch supplier payment summaries for all unique suppliers in this page
  const supplierIds = [...new Set((data || []).map((r) => r.supplier_id))];
  const supplierBalances: Record<string, { totalPurchases: number; totalPayments: number }> = {};

  if (supplierIds.length > 0) {
    const { data: txns } = await supabase
      .from('supplier_transactions')
      .select('supplier_id, transaction_type, amount')
      .in('supplier_id', supplierIds);

    for (const txn of txns || []) {
      const sid = txn.supplier_id as string;
      if (!supplierBalances[sid]) supplierBalances[sid] = { totalPurchases: 0, totalPayments: 0 };
      if (txn.transaction_type === 'PURCHASE') supplierBalances[sid].totalPurchases += Number(txn.amount);
      if (txn.transaction_type === 'PAYMENT' || txn.transaction_type === 'RETURN') supplierBalances[sid].totalPayments += Number(txn.amount);
    }
  }

  const enriched = (data || []).map((receipt) => {
    const bal = supplierBalances[receipt.supplier_id];
    let paymentStatus: PaymentStatus = 'UNPAID';
    let paidAmount = 0;
    let outstanding = Number(receipt.total);

    if (bal) {
      const ratio = bal.totalPurchases > 0 ? bal.totalPayments / bal.totalPurchases : 0;
      // Distribute payments proportionally across receipts for this supplier
      if (ratio >= 1) {
        paymentStatus = 'PAID';
        paidAmount = Number(receipt.total);
        outstanding = 0;
      } else if (ratio > 0) {
        paymentStatus = 'PARTIAL';
        paidAmount = Math.round(Number(receipt.total) * ratio);
        outstanding = Number(receipt.total) - paidAmount;
      }
    }

    return { ...receipt, payment_status: paymentStatus, paid_amount: paidAmount, outstanding };
  });

  return { data: enriched as GoodsReceiptWithStatus[], count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
}

export async function fetchGoodsReceipt(id: string) {
  const { data, error } = await supabase
    .from('goods_receipts')
    .select('*, suppliers!goods_receipts_supplier_id_fkey(*), goods_receipt_items(*, products!goods_receipt_items_product_id_fkey(name, sku))')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
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
