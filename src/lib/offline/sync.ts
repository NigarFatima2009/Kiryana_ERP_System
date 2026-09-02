/**
 * Offline-First POS: Synchronization Engine
 */

import { supabase } from '../supabase';
import { getOfflineDB } from './db';
import { cacheProducts, cacheInventory, cacheCustomers, cacheCategories } from './cache';
import {
  getPendingOperations,
  getSyncQueueStats,
  getMostCommonError,
  getStaleOperations,
  getAverageRetries,
} from './syncQueue';
import {
  getPendingOfflineSales,
  getOfflineSaleItems,
  markAsSyncing,
  markAsSynced,
  markAsSyncFailed,
  markAsConflict,
  markAsDuplicate,
  getOfflineSalesStats,
  getPendingOfflineSalesCount,
} from './offlineSales';
import { startSync, endSync, setSyncError, clearSyncError, updateSyncStats } from './connectivity';
import type { SyncResult, OfflineSale } from './types';

const MAX_RETRIES = 5;

// ==================== MAIN SYNC ====================

export async function performOfflineSync(): Promise<{
  success: boolean;
  synced: number;
  failed: number;
  conflicts: number;
  error?: string;
}> {
  console.log('[Sync] Starting synchronization...');
  startSync();

  let pendingSales: OfflineSale[] = [];

  try {
    pendingSales = await getPendingOfflineSales();
    console.log(`[Sync] Found ${pendingSales.length} pending sales`);

    if (pendingSales.length === 0) {
      const [stats, pendingCount] = await Promise.all([
        getOfflineSalesStats(),
        getPendingOfflineSalesCount(),
      ]);
      clearSyncError();
      endSync(false);
      updateSyncStats(pendingCount, stats.synced, stats.failed);
      return { success: true, synced: 0, failed: 0, conflicts: 0 };
    }

    let synced = 0;
    let failed = 0;
    let conflicts = 0;

    for (const sale of pendingSales) {
      try {
        const result = await syncOfflineSale(sale);
        if (result.success) synced++;
        else if (result.conflictDetected) conflicts++;
        else failed++;
      } catch (err) {
        console.error(`[Sync] Unexpected error for sale ${sale.id}:`, err);
        failed++;
      }
    }

    const [finalStats, pendingCount] = await Promise.all([
      getOfflineSalesStats(),
      getPendingOfflineSalesCount(),
    ]);
    clearSyncError();
    endSync(failed > 0 || conflicts > 0);
    updateSyncStats(pendingCount, finalStats.synced, finalStats.failed);

    console.log(`[Sync] Done: ${synced} synced, ${failed} failed, ${conflicts} conflicts`);
    return { success: failed === 0 && conflicts === 0, synced, failed, conflicts };

  } catch (error) {
    console.error('[Sync] Synchronization failed:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    setSyncError(errorMsg);
    endSync(true);
    return {
      success: false,
      synced: 0,
      failed: pendingSales.length,
      conflicts: 0,
      error: errorMsg,
    };
  }
}

// ==================== INDIVIDUAL SALE SYNC ====================

async function syncOfflineSale(sale: OfflineSale): Promise<SyncResult> {
  console.log(`[Sync] Syncing ${sale.invoice_number} (${sale.client_transaction_id})`);

  try {
    await markAsSyncing(sale.id);

    // 1. Check for duplicate
    const existing = await checkForDuplicateSale(sale.client_transaction_id);
    if (existing) {
      console.log(`[Sync] Duplicate detected for ${sale.invoice_number}`);
      await markAsDuplicate(sale.id, existing.id, existing.invoice_number);
      return { success: true, operationId: sale.id, serverEntityId: existing.id };
    }

    // 2. Get items
    const saleItems = await getOfflineSaleItems(sale.id);

    // 3. Check inventory
    const inventoryCheck = await checkInventoryAvailability(saleItems);
    if (!inventoryCheck.available) {
      console.warn(`[Sync] Inventory conflict: ${inventoryCheck.reason}`);
      await markAsConflict(sale.id, inventoryCheck.reason ?? 'Insufficient inventory');
      return {
        success: false,
        operationId: sale.id,
        conflictDetected: true,
        conflictReason: inventoryCheck.reason,
      };
    }

    // 4. Create on server
    const serverSale = await createSaleOnServer({
      client_transaction_id: sale.client_transaction_id,
      invoice_number: sale.invoice_number,
      customer_id: sale.customer_id,
      subtotal: sale.subtotal,
      discount: sale.discount,
      tax: sale.tax,
      total: sale.total,
      items: saleItems.map(item => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount: item.discount,
        tax: item.tax,
        line_total: item.line_total,
      })),
      payment_methods: sale.payment_methods ?? [],
      notes: sale.notes,
    });

    // 5. Mark synced
    await markAsSynced(sale.id, serverSale.id, serverSale.invoice_number);

    console.log(`[Sync] OK: ${sale.invoice_number} → server ${serverSale.invoice_number}`);
    return { success: true, operationId: sale.id, serverEntityId: serverSale.id };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await markAsSyncFailed(sale.id, errorMessage);
    return { success: false, operationId: sale.id, error: errorMessage };
  }
}

// ==================== DUPLICATE DETECTION ====================

async function checkForDuplicateSale(
  clientTransactionId: string
): Promise<{ id: string; invoice_number: string } | null> {
  try {
    const { data, error } = await supabase
      .from('sales')
      .select('id, invoice_number')
      .eq('client_transaction_id', clientTransactionId)
      .single();

    if (error?.code === 'PGRST116') return null; // Not found
    if (error) throw error;
    return data as { id: string; invoice_number: string };
  } catch (error) {
    if (error instanceof Error && error.message.includes('PGRST116')) return null;
    throw error;
  }
}

// ==================== INVENTORY CONFLICT DETECTION ====================

async function checkInventoryAvailability(
  saleItems: Array<{ product_id: string; quantity: number }>
): Promise<{ available: boolean; reason?: string }> {
  for (const item of saleItems) {
    const { data: inv, error } = await supabase
      .from('inventory')
      .select('quantity')
      .eq('product_id', item.product_id)
      .single();

    if (error) throw error;

    const available = Number(inv?.quantity ?? 0);
    if (available < item.quantity) {
      return {
        available: false,
        reason: `Insufficient stock for product ${item.product_id}: server has ${available}, sale needs ${item.quantity}`,
      };
    }
  }
  return { available: true };
}

// ==================== SERVER SALE CREATION ====================

async function createSaleOnServer(payload: {
  client_transaction_id: string;
  invoice_number: string;
  customer_id: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
    discount: number;
    tax: number;
    line_total: number;
  }>;
  payment_methods: Array<{ method: string; amount: number; reference?: string }>;
  notes?: string;
}): Promise<{ id: string; invoice_number: string }> {
  const { data, error } = await supabase.rpc('create_offline_sale', {
    p_client_transaction_id: payload.client_transaction_id,
    p_invoice_number: payload.invoice_number,
    p_customer_id: payload.customer_id,
    p_subtotal: payload.subtotal,
    p_discount: payload.discount,
    p_tax: payload.tax,
    p_total: payload.total,
    p_items: payload.items,
    p_payment_methods: payload.payment_methods,
    p_notes: payload.notes ?? null,
  });

  if (error) throw error;

  if (!data?.sale_id) throw new Error('Server did not return sale ID');

  return {
    id: data.sale_id as string,
    invoice_number: (data.invoice_number as string) ?? payload.invoice_number,
  };
}

// ==================== CACHE CLEANUP (Remove Deleted Products) ====================

/**
 * Cleans up deleted/inactive products from offline cache.
 * 
 * When a product is deleted on the server, it's no longer returned by active product queries.
 * This function identifies products in the local cache that are no longer on the server
 * and removes them, preventing deleted products from appearing in offline mode.
 */
async function cleanupDeletedProducts(currentServerProductIds: string[]): Promise<void> {
  const db = getOfflineDB();
  const currentSet = new Set(currentServerProductIds);
  
  try {
    const cachedProducts = await db.products.toArray();
    const productsToDelete = cachedProducts
      .filter(p => !currentSet.has(p.id))
      .map(p => p.id);

    if (productsToDelete.length > 0) {
      await db.products.bulkDelete(productsToDelete);
      console.log(`[Cache] Removed ${productsToDelete.length} deleted products from offline cache`);
    }
  } catch (error) {
    console.error('[Cache] Failed to cleanup deleted products:', error);
    // Don't throw - this is a non-critical operation
  }
}

// ==================== INITIAL CACHE SYNC ====================

export async function performInitialCacheSync(): Promise<void> {
  console.log('[Sync] Starting initial cache sync...');

  try {
    const { data: products, error: pErr } = await supabase
      .from('products')
      .select('id, name, sku, barcode, category_id, selling_price, tax_rate, active, updated_at')
      .eq('active', true)
      .limit(5000);
    if (pErr) throw pErr;

    const categoryIds = [...new Set((products ?? []).map((p: { category_id: string | null }) => p.category_id).filter(Boolean))];
    const { data: categories } = await supabase
      .from('categories')
      .select('id, name, active')
      .in('id', categoryIds as string[]);

    const catMap = new Map((categories ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));

    const productsWithCats = (products ?? []).map((p: { id: string; category_id: string | null; [key: string]: unknown }) => ({
      ...p,
      category_name: p.category_id ? catMap.get(p.category_id as string) : undefined,
    }));

    const { data: inventory, error: iErr } = await supabase
      .from('inventory')
      .select('product_id, quantity, reserved_quantity, average_cost, updated_at')
      .in('product_id', productsWithCats.map((p: { id: string }) => p.id));
    if (iErr) throw iErr;

    const inventoryWithSync = (inventory ?? []).map((i: Record<string, unknown>) => ({
      ...i,
      synced_at: new Date().toISOString(),
    }));

    const { data: customers, error: cErr } = await supabase
      .from('customers')
      .select('id, name, phone, email, address, credit_limit, opening_balance, active')
      .eq('active', true)
      .limit(1000);
    if (cErr) throw cErr;

    const customersWithSync = (customers ?? []).map((c: Record<string, unknown>) => ({
      ...c,
      synced_at: new Date().toISOString(),
      last_synced_balance: c.opening_balance,
    }));

    // Clean up any deleted products before caching new ones
    const currentProductIds = productsWithCats.map((p: { id: string }) => p.id);
    await cleanupDeletedProducts(currentProductIds);

    await Promise.all([
      cacheProducts(productsWithCats as any),
      cacheInventory(inventoryWithSync as any),
      cacheCustomers(customersWithSync as any),
      cacheCategories((categories ?? []) as any),
    ]);

    await getOfflineDB().updateSyncMetadata(null);

    console.log(`[Sync] Initial cache: ${productsWithCats.length} products, ${inventoryWithSync.length} inventory, ${customersWithSync.length} customers`);
  } catch (error) {
    console.error('[Sync] Initial cache sync failed:', error);
    throw error;
  }
}

// ==================== DIAGNOSTICS ====================

/**
 * Refreshes the offline cache from the server.
 * Called when the app comes back online to sync any product changes.
 * This ensures deleted products are removed from the offline cache.
 */
export async function refreshOfflineCache(): Promise<void> {
  console.log('[Sync] Refreshing offline cache...');
  try {
    await performInitialCacheSync();
    console.log('[Sync] Offline cache refreshed successfully');
  } catch (error) {
    console.error('[Sync] Failed to refresh offline cache:', error);
    // Don't throw - cache operations should not block the sync process
  }
}

export async function getSyncDiagnostics(): Promise<{
  pendingOperations: number;
  averageRetries: number;
  mostCommonError: string | null;
  staleOperations: number;
}> {
  const [mostCommonError, staleOps, avgRetries] = await Promise.all([
    getMostCommonError(),
    getStaleOperations(24 * 60 * 60 * 1000),
    getAverageRetries(),
  ]);
  return {
    pendingOperations: (await getPendingOperations()).length,
    averageRetries: avgRetries,
    mostCommonError: mostCommonError ?? null,
    staleOperations: staleOps.length,
  };
}
