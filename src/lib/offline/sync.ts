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

    // Sync any pending offline cheques
    try {
      const { syncOfflineCheques } = await import('../../services/cheques');
      await syncOfflineCheques();
    } catch (chkErr) {
      console.warn('[Sync] Cheques sync warning:', chkErr);
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

    // 6. Guarantee Cheque registration & Owner Notification for cheque payments
    const chequePayment = sale.payment_methods?.find((p) => p.method === 'CHEQUE');
    if (chequePayment) {
      try {
        const { createCheque, fetchCheques } = await import('../../services/cheques');
        let customerName = sale.customer_name || 'Walk-in Customer';
        if (!sale.customer_name && sale.customer_id) {
          const { data: cust } = await supabase.from('customers').select('name').eq('id', sale.customer_id).single();
          if (cust?.name) customerName = cust.name;
        }

        const rawRef = chequePayment.reference || '';
        const chkMatch = rawRef.match(/^([^\s(]+)/);
        const bankMatch = rawRef.match(/\(([^)]+)\)/);
        const dueMatch = rawRef.match(/\[Due:\s*([^\]]+)\]/);
        const drawerMatch = rawRef.match(/\[Drawer:\s*([^\]]+)\]/);

        const chequeNum = chkMatch ? chkMatch[1] : `CHK-${sale.invoice_number.replace(/\D/g, '') || Date.now().toString().slice(-6)}`;
        const bankName = bankMatch ? bankMatch[1] : 'Bank';
        const dueDate = dueMatch ? dueMatch[1] : new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
        const drawerTitle = drawerMatch ? drawerMatch[1] : undefined;

        const existingCheques = await fetchCheques({ search: chequeNum });
        const alreadyExists = existingCheques.some((c) => c.cheque_number === chequeNum);

        if (!alreadyExists) {
          await createCheque({
            cheque_number: chequeNum,
            type: 'RECEIVED',
            party_type: sale.customer_id ? 'CUSTOMER' : 'OTHER',
            party_id: sale.customer_id || null,
            party_name: customerName,
            bank_name: bankName,
            drawer_title: drawerTitle,
            amount: chequePayment.amount,
            issue_date: new Date(sale.created_at || Date.now()).toISOString().slice(0, 10),
            due_date: dueDate,
            status: 'PENDING',
            notes: `Received via POS sale (${serverSale.invoice_number})`,
            reference_sale_id: serverSale.id,
          });
        }
      } catch (chkErr) {
        console.warn('[Sync] Cheque auto-registration warning:', chkErr);
      }
    }

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
  _saleItems: Array<{ product_id: string; quantity: number }>
): Promise<{ available: boolean; reason?: string }> {
  // Allow all offline sales to sync into sales history without failing
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
  try {
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

    if (!error && data?.sale_id) {
      return {
        id: data.sale_id as string,
        invoice_number: (data.invoice_number as string) ?? payload.invoice_number,
      };
    }
    if (error) {
      console.warn('[Sync] RPC create_offline_sale returned error, using direct table insert:', error.message);
    }
  } catch (rpcErr) {
    console.warn('[Sync] RPC call exception, using direct table insert:', rpcErr);
  }

  // 2. Direct Table Insertion Fallback
  const { data: { user } } = await supabase.auth.getUser();

  // Calculate COGS for the sale
  const totalCogs = payload.items?.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0) || 0;

  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({
      client_transaction_id: payload.client_transaction_id,
      invoice_number: payload.invoice_number,
      customer_id: payload.customer_id || null,
      created_by: user?.id || null,
      status: 'COMPLETED',
      subtotal: payload.subtotal,
      discount: payload.discount,
      tax: payload.tax,
      total: payload.total,
      cogs: totalCogs,
      notes: payload.notes || null,
    })
    .select()
    .single();

  if (saleError) throw saleError;

  // Insert items
  if (payload.items?.length) {
    const saleItems = payload.items.map(item => ({
      sale_id: sale.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount: item.discount,
      tax: item.tax,
      line_total: item.line_total,
      cogs: item.quantity * item.unit_price,
    }));
    await supabase.from('sale_items').insert(saleItems);
  }

  // Insert payments
  if (payload.payment_methods?.length) {
    const payments = payload.payment_methods.map(p => ({
      sale_id: sale.id,
      payment_method: p.method,
      amount: p.amount,
      reference: p.reference || null,
    }));
    await supabase.from('sale_payments').insert(payments);

    // If payment was made by CHEQUE, register cheque and notify owner
    const chequePayment = payload.payment_methods.find(p => p.method === 'CHEQUE');
    if (chequePayment) {
      try {
        const { createCheque } = await import('../../services/cheques');
        let customerName = 'Walk-in Customer';
        if (payload.customer_id) {
          const { data: cust } = await supabase.from('customers').select('name').eq('id', payload.customer_id).single();
          if (cust?.name) customerName = cust.name;
        }

        const chequeNum = chequePayment.reference ? chequePayment.reference.split(' ')[0] : `CHK-${Date.now().toString().slice(-6)}`;
        const dueDateStr = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        await createCheque({
          cheque_number: chequeNum,
          type: 'RECEIVED',
          party_type: 'CUSTOMER',
          party_id: payload.customer_id || null,
          party_name: customerName,
          bank_name: 'Bank',
          amount: chequePayment.amount,
          issue_date: new Date().toISOString().slice(0, 10),
          due_date: dueDateStr,
          status: 'PENDING',
          notes: `Received via POS sale (${sale.invoice_number})`,
        });
      } catch (chequeErr) {
        console.warn('[Sync] Auto-registering cheque on sync failed:', chequeErr);
      }
    }
  }

  return { id: sale.id, invoice_number: sale.invoice_number };
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
