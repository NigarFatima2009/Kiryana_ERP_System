import { supabase } from '../lib/supabase';
import { offlineQuery } from '../lib/offlineQuery';
import { audit } from './audit';
import type { Supplier, SupplierTransaction, SupplierPayment } from '../types/database';

export async function fetchSuppliers(params?: { search?: string; active?: boolean }) {
  let query = supabase.from('suppliers').select('*', { count: 'exact' }).order('name');
  if (params?.search) query = query.or(`name.ilike.%${params.search}%,company.ilike.%${params.search}%,phone.ilike.%${params.search}%`);
  if (params?.active !== undefined) query = query.eq('active', params.active);

  const { data, error, count } = await query;
  if (error) throw error;
  const result = { data: data as Supplier[], count: count || 0 };
  return offlineQuery('suppliers', async () => result);
}

export async function fetchSupplier(id: string) {
  const { data, error } = await supabase.from('suppliers').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Supplier;
}

export async function createSupplier(supplier: Omit<Supplier, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase.from('suppliers').insert(supplier).select().single();
  if (error) throw error;
  return data as Supplier;
}

export async function updateSupplier(id: string, updates: Partial<Supplier>) {
  const { data, error } = await supabase.from('suppliers').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data as Supplier;
}

export async function fetchSupplierTransactions(supplierId: string) {
  const { data, error } = await supabase
    .from('supplier_transactions')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as SupplierTransaction[];
}

export async function fetchSupplierBalance(supplierId: string) {
  // Get opening balance
  const { data: supplier } = await supabase
    .from('suppliers')
    .select('opening_balance')
    .eq('id', supplierId)
    .single();

  // Get all goods receipts for this supplier
  const { data: receipts } = await supabase
    .from('goods_receipts')
    .select('id, total')
    .eq('supplier_id', supplierId);

  // Get all payments linked to receipts (ONLY count receipt-specific payments)
  const { data: transactions } = await supabase
    .from('supplier_transactions')
    .select('amount, transaction_type, reference_type')
    .eq('supplier_id', supplierId)
    .eq('reference_type', 'PURCHASE');  // Only payments linked to receipts

  let balance = supplier?.opening_balance || 0;

  // Add all receipt totals as payable
  for (const receipt of receipts || []) {
    balance += Number(receipt.total);
  }

  // Subtract payments made
  for (const t of transactions || []) {
    if (t.transaction_type === 'PAYMENT') {
      balance -= Number(t.amount);
    } else if (t.transaction_type === 'RETURN') {
      balance -= Math.abs(Number(t.amount));
    }
  }

  return Math.max(0, balance); // Never negative
}

export async function createSupplierPayment(payment: Omit<SupplierPayment, 'id' | 'payment_date'> & { goodsReceiptIds?: string[] }) {
  const { data, error } = await supabase.from('supplier_payments').insert({
    supplier_id: payment.supplier_id,
    amount: payment.amount,
    payment_method: payment.payment_method,
    reference: payment.reference,
    created_by: payment.created_by,
    payment_date: new Date().toISOString(),
  }).select().single();
  if (error) throw error;

  // Get all unpaid goods receipts for this supplier if not specified
  let receiptIds = payment.goodsReceiptIds;
  if (!receiptIds || receiptIds.length === 0) {
    const { data: receipts } = await supabase
      .from('goods_receipts')
      .select('id')
      .eq('supplier_id', payment.supplier_id)
      .order('created_at', { ascending: true });
    receiptIds = (receipts || []).map(r => r.id);
  }

  // Allocate payment to receipts in FIFO order
  let remainingAmount = payment.amount;
  for (const receiptId of receiptIds || []) {
    if (remainingAmount <= 0) break;

    // Get receipt total
    const { data: receipt } = await supabase
      .from('goods_receipts')
      .select('total')
      .eq('id', receiptId)
      .single();

    if (!receipt) continue;

    const receiptTotal = Number(receipt.total);
    const amountForThisReceipt = Math.min(remainingAmount, receiptTotal);

    // Create transaction linking this payment to the receipt
    await supabase.from('supplier_transactions').insert({
      supplier_id: payment.supplier_id,
      transaction_type: 'PAYMENT',
      amount: amountForThisReceipt,
      reference_type: 'PURCHASE',
      reference_id: receiptId,
      narration: `Payment via ${payment.payment_method}`,
    });

    remainingAmount -= amountForThisReceipt;
  }

  // Create audit log
  await audit.supplierPayment(payment.supplier_id, payment.amount, payment.payment_method);

  return data as SupplierPayment;
}
