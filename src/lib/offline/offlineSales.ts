/**
 * Offline-First POS: Offline Sale Creation & Management
 */

import { getOfflineDB } from './db';
import { decrementLocalInventory } from './cache';
import { updateSyncStats } from './connectivity';
import type { OfflineSale, OfflineSaleItem, OfflineSaleStatus, OfflineInventoryMovement } from './types';

export const OFFLINE_SALES_CHANGED_EVENT = 'offline-sales-changed';

function notifyOfflineSalesChanged(): void {
  window.dispatchEvent(new Event(OFFLINE_SALES_CHANGED_EVENT));
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ==================== SALE CREATION ====================

export async function createOfflineSale(params: {
  items: Array<{
    product_id: string;
    product_name: string;
    product_sku: string;
    quantity: number;
    unit_price: number;
    discount: number;
    tax: number;
  }>;
  customer_id?: string;
  customer_name?: string;
  discount: number;
  tax: number;
  total: number;
  notes?: string;
  payment_methods?: Array<{ method: string; amount: number; reference?: string }>;
}): Promise<OfflineSale> {
  const db = getOfflineDB();
  const saleId = generateUUID();
  const clientTransactionId = `OFFLINE_${Date.now()}_${generateUUID().substring(0, 8)}`;
  const invoiceNumber = `INV-OFF-${Date.now().toString().slice(-5)}`;
  const subtotal = params.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);

  const sale: OfflineSale = {
    id: saleId,
    client_transaction_id: clientTransactionId,
    invoice_number: invoiceNumber,
    customer_id: params.customer_id ?? null,
    customer_name: params.customer_name,
    subtotal,
    discount: params.discount,
    tax: params.tax,
    total: params.total,
    status: 'pending_sync',
    notes: params.notes,
    created_at: Date.now(),
    synced_at: null,
    sync_attempt_count: 0,
    last_sync_attempt_at: null,
    payment_methods: params.payment_methods,
  };

  await db.transaction('rw', db.offlineSales, db.offlineSaleItems, db.offlineInventoryMovements, db.inventory, async () => {
    await db.offlineSales.add(sale);

    const saleItems: OfflineSaleItem[] = params.items.map(item => ({
      id: generateUUID(),
      offline_sale_id: saleId,
      product_id: item.product_id,
      product_name: item.product_name,
      product_sku: item.product_sku,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount: item.discount,
      tax: item.tax,
      line_total: item.quantity * item.unit_price,
      cogs: item.quantity * item.unit_price,
      created_at: Date.now(),
    }));

    await db.offlineSaleItems.bulkAdd(saleItems);

    // Create inventory movement records for owner visibility
    const movements: OfflineInventoryMovement[] = params.items.map(item => ({
      id: generateUUID(),
      product_id: item.product_id,
      movement_type: 'SALE' as const,
      quantity_change: -item.quantity,
      unit_cost: item.unit_price,
      reference_type: 'OFFLINE_SALE',
      reference_id: saleId,
      notes: `Offline sale ${invoiceNumber}`,
      created_at: Date.now(),
      synced: false,
    }));
    await db.offlineInventoryMovements.bulkAdd(movements);

    for (const item of params.items) {
      await decrementLocalInventory(item.product_id, item.quantity, item.unit_price);
    }
  });

  console.log(`[OfflineSales] Created ${invoiceNumber} (${clientTransactionId})`);
  
  // Update pending operation count to trigger auto-sync when connection returns
  const stats = await getOfflineSalesStats();
  updateSyncStats(stats.pending, stats.synced, stats.failed);
  notifyOfflineSalesChanged();
  
  return sale;
}

// ==================== RETRIEVAL ====================

export async function getOfflineSale(saleId: string): Promise<OfflineSale | null> {
  const db = getOfflineDB();
  return (await db.offlineSales.get(saleId)) ?? null;
}

export async function getOfflineSaleByClientId(clientId: string): Promise<OfflineSale | null> {
  const db = getOfflineDB();
  return (await db.offlineSales.where('client_transaction_id').equals(clientId).first()) ?? null;
}

export async function getOfflineSaleItems(saleId: string): Promise<OfflineSaleItem[]> {
  const db = getOfflineDB();
  return db.offlineSaleItems.where('offline_sale_id').equals(saleId).toArray();
}

export async function getPendingOfflineSales(): Promise<OfflineSale[]> {
  const db = getOfflineDB();
  return db.offlineSales.where('status').anyOf(['pending_sync', 'sync_failed']).toArray();
}

export async function getSyncedOfflineSales(): Promise<OfflineSale[]> {
  const db = getOfflineDB();
  return db.offlineSales.where('status').equals('synced').toArray();
}

export async function getConflictedOfflineSales(): Promise<OfflineSale[]> {
  const db = getOfflineDB();
  return db.offlineSales.where('status').anyOf(['conflict', 'sync_failed']).toArray();
}

export async function getAllOfflineSales(): Promise<OfflineSale[]> {
  const db = getOfflineDB();
  return db.offlineSales.orderBy('created_at').reverse().toArray();
}

export async function getPendingOfflineSalesCount(): Promise<number> {
  const db = getOfflineDB();
  return db.offlineSales.where('status').anyOf(['pending_sync', 'sync_failed']).count();
}

// ==================== STATUS UPDATES ====================

export async function updateOfflineSaleStatus(
  saleId: string,
  status: OfflineSaleStatus,
  updates?: Partial<OfflineSale>
): Promise<void> {
  const db = getOfflineDB();
  await db.offlineSales.update(saleId, { status, ...updates });
  notifyOfflineSalesChanged();
}

export async function markAsSyncing(saleId: string): Promise<void> {
  const db = getOfflineDB();
  const sale = await db.offlineSales.get(saleId);
  await db.offlineSales.update(saleId, {
    status: 'syncing',
    last_sync_attempt_at: Date.now(),
    sync_attempt_count: (sale?.sync_attempt_count ?? 0) + 1,
  });
  notifyOfflineSalesChanged();
}

export async function markAsSynced(
  saleId: string,
  serverSaleId: string,
  serverInvoiceNumber: string
): Promise<void> {
  const db = getOfflineDB();
  await db.offlineSales.update(saleId, {
    status: 'synced',
    server_sale_id: serverSaleId,
    server_invoice_number: serverInvoiceNumber,
    synced_at: Date.now(),
  });
  notifyOfflineSalesChanged();
}

export async function markAsSyncFailed(saleId: string, errorMessage: string): Promise<void> {
  const db = getOfflineDB();
  const sale = await db.offlineSales.get(saleId);
  await db.offlineSales.update(saleId, {
    status: 'sync_failed',
    last_sync_error: errorMessage,
    last_sync_attempt_at: Date.now(),
    sync_attempt_count: (sale?.sync_attempt_count ?? 0) + 1,
  });
  notifyOfflineSalesChanged();
}

export async function markAsConflict(saleId: string, conflictReason: string): Promise<void> {
  const db = getOfflineDB();
  await db.offlineSales.update(saleId, {
    status: 'conflict',
    last_sync_error: conflictReason,
  });
  notifyOfflineSalesChanged();
}

export async function markAsDuplicate(
  saleId: string,
  serverSaleId: string,
  serverInvoiceNumber: string
): Promise<void> {
  const db = getOfflineDB();
  await db.offlineSales.update(saleId, {
    status: 'synced',
    server_sale_id: serverSaleId,
    server_invoice_number: serverInvoiceNumber,
    synced_at: Date.now(),
  });
  notifyOfflineSalesChanged();
}

export async function deleteOfflineSale(saleId: string): Promise<void> {
  const db = getOfflineDB();
  await db.transaction('rw', db.offlineSales, db.offlineSaleItems, async () => {
    await db.offlineSaleItems.where('offline_sale_id').equals(saleId).delete();
    await db.offlineSales.delete(saleId);
  });
  notifyOfflineSalesChanged();
}

// ==================== DIAGNOSTICS ====================

export async function getOfflineSalesStats(): Promise<{
  total: number;
  pending: number;
  synced: number;
  failed: number;
  conflicts: number;
  totalItems: number;
}> {
  const db = getOfflineDB();
  const [total, pending, synced, failed, conflicts, totalItems] = await Promise.all([
    db.offlineSales.count(),
    db.offlineSales.where('status').anyOf(['pending_sync', 'syncing']).count(),
    db.offlineSales.where('status').equals('synced').count(),
    db.offlineSales.where('status').equals('sync_failed').count(),
    db.offlineSales.where('status').anyOf(['conflict', 'duplicate_detected']).count(),
    db.offlineSaleItems.count(),
  ]);
  return { total, pending, synced, failed, conflicts, totalItems };
}
