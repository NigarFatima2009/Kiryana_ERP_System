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
  const { data: supplier } = await supabase.from('suppliers').select('opening_balance').eq('id', supplierId).single();
  const { data: transactions } = await supabase
    .from('supplier_transactions')
    .select('amount, transaction_type')
    .eq('supplier_id', supplierId);

  let balance = supplier?.opening_balance || 0;
  if (transactions) {
    for (const t of transactions) {
      if (['PURCHASE', 'OPENING'].includes(t.transaction_type)) balance += t.amount;
      if (['PAYMENT', 'RETURN'].includes(t.transaction_type)) balance -= t.amount;
    }
  }
  return balance;
}

export async function createSupplierPayment(payment: Omit<SupplierPayment, 'id' | 'payment_date'>) {
  const { data, error } = await supabase.from('supplier_payments').insert({
    ...payment,
    payment_date: new Date().toISOString(),
  }).select().single();
  if (error) throw error;

  // Create supplier transaction (PAYMENT type) so balance is reduced
  await supabase.from('supplier_transactions').insert({
    supplier_id: payment.supplier_id,
    transaction_type: 'PAYMENT',
    amount: payment.amount,
    reference_type: 'SUPPLIER_PAYMENT',
    reference_id: data.id,
    narration: `Payment via ${payment.payment_method}`,
  });

  // Create audit log
  await audit.supplierPayment(payment.supplier_id, payment.amount, payment.payment_method);

  return data as SupplierPayment;
}
