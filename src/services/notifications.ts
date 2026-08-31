import { supabase } from '../lib/supabase';
import type { Notification, AuditLog } from '../types/database';

// ==================== NOTIFICATIONS ====================

export async function fetchNotifications(params?: {
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const pageSize = params?.pageSize || 50;
  const page = (params?.page || 1) - 1;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params?.unreadOnly) {
    query = query.is('read_at', null);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  return { data: data as Notification[], count: count || 0 };
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact' })
    .is('read_at', null);

  if (error) throw error;
  return count || 0;
}

export async function markNotificationAsRead(id: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

export async function markAllNotificationsAsRead() {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);

  if (error) throw error;
}

export async function deleteNotification(id: string) {
  const { error } = await supabase.from('notifications').delete().eq('id', id);
  if (error) throw error;
}

export async function clearOldNotifications(daysOld: number = 30) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('notifications')
    .delete()
    .lt('created_at', cutoffDate)
    .not('read_at', 'is', null);

  if (error) throw error;
}

// ==================== NOTIFICATION CREATION ====================

export async function createNotification(
  recipientId: string | null,
  type: string,
  title: string,
  body?: string,
  entityType?: string,
  entityId?: string
) {
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      recipient_id: recipientId,
      type,
      title,
      body,
      entity_type: entityType,
      entity_id: entityId,
    })
    .select()
    .single();

  if (error) throw error;
  return data as Notification;
}

// ==================== AUTO NOTIFICATIONS ====================

export async function notifyLowStockProducts() {
  const { data: products, error } = await supabase
    .from('inventory')
    .select('product_id, quantity, products!inner(name, reorder_level)')
    .lt('quantity', supabase.rpc('reorder_level'));

  if (error || !products) return;

  for (const item of products) {
    await createNotification(
      null,
      'LOW_STOCK',
      `Low Stock Alert: ${(item.products as any).name}`,
      `Stock level is ${item.quantity} units, below reorder level`,
      'product',
      item.product_id
    );
  }
}

export async function notifyExpiringProducts() {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30);

  const { data: batches, error } = await supabase
    .from('inventory_batches')
    .select('id, product_id, expiry_date, remaining_quantity, products(*)')
    .lte('expiry_date', expiryDate.toISOString().split('T')[0])
    .gt('expiry_date', new Date().toISOString().split('T')[0])
    .gt('remaining_quantity', 0);

  if (error || !batches) return;

  for (const batch of batches) {
    const daysUntilExpiry = Math.ceil(
      (new Date(batch.expiry_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    );

    await createNotification(
      null,
      'EXPIRING_PRODUCT',
      `Expiring Soon: ${(batch.products as any).name}`,
      `Expires in ${daysUntilExpiry} days (${batch.expiry_date})`,
      'batch',
      batch.id
    );
  }
}

export async function notifyExpiredProducts() {
  const { data: batches, error } = await supabase
    .from('inventory_batches')
    .select('id, product_id, expiry_date, remaining_quantity, products(*)')
    .lt('expiry_date', new Date().toISOString().split('T')[0])
    .gt('remaining_quantity', 0);

  if (error || !batches) return;

  for (const batch of batches) {
    await createNotification(
      null,
      'EXPIRED_PRODUCT',
      `Expired: ${(batch.products as any).name}`,
      `Batch expired on ${batch.expiry_date}. Quantity: ${batch.remaining_quantity} units`,
      'batch',
      batch.id
    );
  }
}

export async function notifyCreditLimitExceeded(customerId: string, customerName: string, exceedAmount: number) {
  await createNotification(
    null,
    'CREDIT_LIMIT_EXCEEDED',
    `Credit Limit Exceeded: ${customerName}`,
    `Customer has exceeded credit limit by ${exceedAmount}`,
    'customer',
    customerId
  );
}

export async function notifyLargeExpense(expenseAmount: number, category: string, threshold: number = 50000) {
  if (expenseAmount >= threshold) {
    await createNotification(
      null,
      'LARGE_EXPENSE',
      `Large Expense Recorded: ${category}`,
      `Amount: Rs ${expenseAmount}`
    );
  }
}

export async function notifySupplierPaymentDue(supplierId: string, supplierName: string, amount: number) {
  await createNotification(
    null,
    'SUPPLIER_PAYMENT_DUE',
    `Supplier Payment Due: ${supplierName}`,
    `Outstanding amount: Rs ${amount}`,
    'supplier',
    supplierId
  );
}

// ==================== AUDIT LOGS ====================

export async function fetchAuditLogs(params?: {
  action?: string;
  entityType?: string;
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const pageSize = params?.pageSize || 50;
  const page = (params?.page || 1) - 1;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('audit_logs')
    .select('*, profiles(*)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params?.action) {
    query = query.eq('action', params.action);
  }
  if (params?.entityType) {
    query = query.eq('entity_type', params.entityType);
  }
  if (params?.dateFrom) {
    query = query.gte('created_at', params.dateFrom);
  }
  if (params?.dateTo) {
    query = query.lte('created_at', params.dateTo);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  return { data: data as any[], count: count || 0 };
}

export async function createAuditLog(
  action: string,
  entityType: string,
  entityId: string,
  newValue?: Record<string, unknown>,
  previousValue?: Record<string, unknown>
) {
  const { error } = await supabase.from('audit_logs').insert({
    action,
    entity_type: entityType,
    entity_id: entityId,
    new_value: newValue,
    previous_value: previousValue,
  });

  if (error) throw error;
}
