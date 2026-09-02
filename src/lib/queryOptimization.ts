/**
 * Query Optimization Utilities
 * Eliminates N+1 patterns by batching related queries
 */

import { supabase } from './supabase';

/**
 * Batch fetch inventory for multiple products
 */
export async function batchFetchInventory(productIds: string[]) {
  if (productIds.length === 0) return new Map();
  
  const uniqueIds = [...new Set(productIds)];
  const { data, error } = await supabase
    .from('inventory')
    .select('product_id, quantity, average_cost')
    .in('product_id', uniqueIds);

  if (error) throw error;
  
  const map = new Map<string, any>();
  (data || []).forEach(inv => {
    map.set(inv.product_id, inv);
  });
  
  return map;
}

/**
 * Batch fetch inventory batches for multiple products
 */
export async function batchFetchInventoryBatches(productIds: string[]) {
  if (productIds.length === 0) return new Map();
  
  const uniqueIds = [...new Set(productIds)];
  const { data, error } = await supabase
    .from('inventory_batches')
    .select('*')
    .in('product_id', uniqueIds)
    .gt('remaining_quantity', 0)
    .order('expiry_date', { ascending: true, nullsFirst: true })
    .order('received_date', { ascending: true });

  if (error) throw error;

  const now = new Date().toISOString().split('T')[0];
  const filtered = (data || []).filter((b) => !b.expiry_date || b.expiry_date >= now);

  const map = new Map<string, any[]>();
  filtered.forEach(batch => {
    if (!map.has(batch.product_id)) {
      map.set(batch.product_id, []);
    }
    map.get(batch.product_id)!.push(batch);
  });

  return map;
}

/**
 * Batch fetch customer details
 */
export async function batchFetchCustomers(customerIds: string[]) {
  if (customerIds.length === 0) return new Map();
  
  const uniqueIds = [...new Set(customerIds.filter(Boolean))];
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, email, phone')
    .in('id', uniqueIds);

  if (error) throw error;

  const map = new Map<string, any>();
  (data || []).forEach(customer => {
    map.set(customer.id, customer);
  });

  return map;
}

/**
 * Batch fetch profiles (cashiers, users)
 */
export async function batchFetchProfiles(profileIds: string[]) {
  if (profileIds.length === 0) return new Map();
  
  const uniqueIds = [...new Set(profileIds.filter(Boolean))];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .in('id', uniqueIds);

  if (error) throw error;

  const map = new Map<string, any>();
  (data || []).forEach(profile => {
    map.set(profile.id, profile);
  });

  return map;
}

/**
 * Batch fetch products
 */
export async function batchFetchProducts(productIds: string[]) {
  if (productIds.length === 0) return new Map();
  
  const uniqueIds = [...new Set(productIds)];
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sku, active, purchase_price, selling_price')
    .in('id', uniqueIds);

  if (error) throw error;

  const map = new Map<string, any>();
  (data || []).forEach(product => {
    map.set(product.id, product);
  });

  return map;
}

/**
 * Batch fetch sales returns
 */
export async function batchFetchSalesReturns(saleIds: string[]) {
  if (saleIds.length === 0) return new Map();
  
  const uniqueIds = [...new Set(saleIds)];
  const { data, error } = await supabase
    .from('sales_returns')
    .select('sale_id, total, refund_method')
    .in('sale_id', uniqueIds);

  if (error) throw error;

  const map = new Map<string, Array<{ total: number; refund_method: string }>>();
  (data || []).forEach(saleReturn => {
    if (!map.has(saleReturn.sale_id)) {
      map.set(saleReturn.sale_id, []);
    }
    map.get(saleReturn.sale_id)!.push({
      total: Number(saleReturn.total),
      refund_method: saleReturn.refund_method,
    });
  });

  return map;
}

/**
 * Batch fetch sale items
 */
export async function batchFetchSaleItems(saleIds: string[]) {
  if (saleIds.length === 0) return new Map();
  
  const uniqueIds = [...new Set(saleIds)];
  const { data, error } = await supabase
    .from('sale_items')
    .select('*')
    .in('sale_id', uniqueIds);

  if (error) throw error;

  const map = new Map<string, any[]>();
  (data || []).forEach(item => {
    if (!map.has(item.sale_id)) {
      map.set(item.sale_id, []);
    }
    map.get(item.sale_id)!.push(item);
  });

  return map;
}

/**
 * Batch fetch sale payments
 */
export async function batchFetchSalePayments(saleIds: string[]) {
  if (saleIds.length === 0) return new Map();
  
  const uniqueIds = [...new Set(saleIds)];
  const { data, error } = await supabase
    .from('sale_payments')
    .select('*')
    .in('sale_id', uniqueIds);

  if (error) throw error;

  const map = new Map<string, any[]>();
  (data || []).forEach(payment => {
    if (!map.has(payment.sale_id)) {
      map.set(payment.sale_id, []);
    }
    map.get(payment.sale_id)!.push(payment);
  });

  return map;
}

/**
 * Batch insert operations with error handling
 */
export async function batchInsert(
  table: string,
  records: Record<string, any>[],
  chunkSize: number = 100
): Promise<any[]> {
  if (records.length === 0) return [];

  const results: any[] = [];
  
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from(table)
      .insert(chunk as any)
      .select();

    if (error) throw error;
    results.push(...(data || []));
  }

  return results;
}

/**
 * Batch update operations
 */
export async function batchUpdate(
  table: string,
  updates: Array<{ id: string; data: Record<string, any> }>
): Promise<void> {
  const batchSize = 50;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const promises = batch.map(({ id, data }) =>
      supabase
        .from(table)
        .update(data as any)
        .eq('id', id)
    );

    const results = await Promise.all(promises);
    for (const result of results) {
      if (result.error) throw result.error;
    }
  }
}
