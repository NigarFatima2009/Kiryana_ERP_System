import { supabase } from '../lib/supabase';
import { audit } from './audit';
import type { Customer, CustomerTransaction, CustomerPayment } from '../types/database';

export async function fetchCustomers(params?: { search?: string; active?: boolean }) {
  let query = supabase.from('customers').select('*', { count: 'exact' }).order('name');
  if (params?.search) query = query.or(`name.ilike.%${params.search}%,phone.ilike.%${params.search}%`);
  if (params?.active !== undefined) query = query.eq('active', params.active);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: data as Customer[], count: count || 0 };
}

export async function fetchCustomer(id: string) {
  const { data, error } = await supabase.from('customers').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Customer;
}

export async function createCustomer(customer: Omit<Customer, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase.from('customers').insert(customer).select().single();
  if (error) throw error;
  if (customer.opening_balance && customer.opening_balance > 0) {
    await supabase.from('customer_transactions').insert({
      customer_id: data.id,
      transaction_type: 'OPENING',
      amount: customer.opening_balance,
      reference_type: 'OPENING',
      narration: 'Opening balance',
    });
  }
  return data as Customer;
}

export async function updateCustomer(id: string, updates: Partial<Customer>) {
  const { data, error } = await supabase.from('customers').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data as Customer;
}

export async function fetchCustomerTransactions(customerId: string) {
  const { data, error } = await supabase
    .from('customer_transactions')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as CustomerTransaction[];
}

export async function fetchCustomerBalance(customerId: string) {
  const { data: customer } = await supabase.from('customers').select('opening_balance').eq('id', customerId).single();
  const { data: transactions } = await supabase
    .from('customer_transactions')
    .select('amount, transaction_type')
    .eq('customer_id', customerId);

  let balance = customer?.opening_balance || 0;
  if (transactions) {
    for (const t of transactions) {
      if (['CREDIT_SALE', 'OPENING'].includes(t.transaction_type)) balance += t.amount;
      if (['PAYMENT', 'RETURN', 'ADJUSTMENT'].includes(t.transaction_type)) balance -= t.amount;
    }
  }
  return balance;
}

export async function receiveCustomerPayment(payment: {
  customer_id: string;
  amount: number;
  payment_method: string;
  reference?: string;
}) {
  const { data: cp, error: cpError } = await supabase
    .from('customer_payments')
    .insert({
      ...payment,
      payment_date: new Date().toISOString(),
    })
    .select()
    .single();
  if (cpError) throw cpError;

  await supabase.from('customer_transactions').insert({
    customer_id: payment.customer_id,
    transaction_type: 'PAYMENT',
    amount: payment.amount,
    reference_type: 'CUSTOMER_PAYMENT',
    reference_id: cp.id,
    narration: `Payment received via ${payment.payment_method}`,
  });

  // Create audit log
  await audit.customerPayment(payment.customer_id, payment.amount, payment.payment_method);

  return cp as CustomerPayment;
}
