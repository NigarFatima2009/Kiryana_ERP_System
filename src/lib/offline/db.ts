/**
 * Offline-First POS: IndexedDB Database Schema
 * 
 * Uses Dexie.js for IndexedDB abstraction.
 * Provides persistent offline storage for POS operations.
 */

import Dexie, { type Table } from 'dexie';
import type {
  OfflineProduct,
  OfflineInventory,
  OfflineCustomer,
  OfflineCategory,
  OfflineAppMetadata,
  OfflineSale,
  OfflineSaleItem,
  SyncQueueItem,
  SyncConflict,
  OfflineInventoryMovement,
} from './types';

/**
 * Main offline database.
 * 
 * Design principles:
 * - Each table represents a cache of server data or offline-created transaction
 * - Offline transactions (sales) are isolated from read-only caches (products, customers)
 * - Sync queue tracks all pending mutations durably
 * - Conflicts are recorded for later review
 */
export class ERPOfflineDB extends Dexie {
  // Cache tables (read-only, populated from server)
  products!: Table<OfflineProduct>;
  inventory!: Table<OfflineInventory>;
  customers!: Table<OfflineCustomer>;
  categories!: Table<OfflineCategory>;

  // Transaction tables (write during offline operation)
  offlineSales!: Table<OfflineSale>;
  offlineSaleItems!: Table<OfflineSaleItem>;
  offlineInventoryMovements!: Table<OfflineInventoryMovement>;

  // Sync infrastructure
  syncQueue!: Table<SyncQueueItem>;
  syncConflicts!: Table<SyncConflict>;

  // Metadata
  appMetadata!: Table<OfflineAppMetadata>;

  constructor() {
    super('ERPOfflineDB');

    // ===================== CACHE TABLES =====================

    this.version(1).stores({
      // Products cache
      // Indexed by: id (PK), barcode (for barcode scanning), sku (for SKU search)
      products: 'id, barcode, sku, active, updated_at',

      // Inventory cache
      // Indexed by: product_id (PK), synced_at (for cache age checking)
      inventory: 'product_id, synced_at',

      // Customers cache
      // Indexed by: id (PK), phone (for phone lookup), active status
      customers: 'id, phone, active, synced_at',

      // Categories cache (for autocomplete, UI)
      categories: 'id, active',

      // ===================== TRANSACTION TABLES =====================

      // Offline sales (primary transaction record)
      // Indexed by: id (PK), client_transaction_id (UNIQUE for idempotency)
      //            status (for filtering pending/failed), created_at (for chronological order)
      //            server_sale_id (for tracking post-sync)
      offlineSales: 'id, client_transaction_id, status, created_at, server_sale_id, synced_at',

      // Offline sale items (detail lines)
      // Indexed by: id (PK), offline_sale_id (FK for joins), product_id (for reporting)
      offlineSaleItems: 'id, offline_sale_id, product_id',

      // Offline inventory movements (audit trail)
      // Indexed by: id (PK), product_id (for stock reports), reference_id (to link to offline_sale)
      // synced flag allows tracking which movements have been replicated
      offlineInventoryMovements: 'id, product_id, reference_id, synced, created_at',

      // ===================== SYNC INFRASTRUCTURE =====================

      // Sync queue (durable queue for mutations)
      // Indexed by: id (PK), client_transaction_id (UNIQUE for deduplication)
      //            entity_id (FK to offline_sales, etc.), status (for filtering by state)
      //            created_at (for FIFO processing order)
      syncQueue: 'id, client_transaction_id, entity_id, status, created_at, last_attempt_at',

      // Sync conflicts (recorded for manual resolution)
      // Indexed by: id (PK), offline_sale_id (to link to sale)
      //            sync_queue_item_id (to link to queue item), resolved (to find open conflicts)
      syncConflicts: 'id, offline_sale_id, sync_queue_item_id, resolved, created_at',

      // ===================== METADATA =====================

      // App metadata (singleton for sync tracking)
      // Indexed by: id (always 'app-metadata' as primary key)
      appMetadata: 'id',
    });
  }

  /**
   * Initialize metadata record (call once after first sync)
   */
  async initializeMetadata(userId: string): Promise<void> {
    const exists = await this.appMetadata.get('app-metadata');
    if (!exists) {
      const now = Date.now();
      await this.appMetadata.add({
        id: 'app-metadata',
        last_successful_sync_at: null,
        last_sync_attempt_at: now,
        last_sync_error: null,
        sync_conflict_count: 0,
        initialized_at: now,
        schema_version: 1,
        user_id: userId,
      });
    }
  }

  /**
   * Update sync metadata after successful sync
   */
  async updateSyncMetadata(error: string | null = null): Promise<void> {
    const now = Date.now();
    await this.appMetadata.update('app-metadata', {
      last_sync_attempt_at: now,
      last_sync_error: error,
      last_successful_sync_at: error ? undefined : now,
    });
  }

  /**
   * Clear all offline data (for testing or logout)
   * WARNING: This will delete all pending transactions!
   */
  async clearOfflineData(): Promise<void> {
    await Promise.all([
      this.products.clear(),
      this.inventory.clear(),
      this.customers.clear(),
      this.categories.clear(),
      this.offlineSales.clear(),
      this.offlineSaleItems.clear(),
      this.offlineInventoryMovements.clear(),
      this.syncQueue.clear(),
      this.syncConflicts.clear(),
    ]);
  }

  /**
   * Get cache age (time since last sync)
   */
  async getCacheAge(): Promise<number | null> {
    const metadata = await this.appMetadata.get('app-metadata');
    if (!metadata || !metadata.last_successful_sync_at) {
      return null;
    }
    return Date.now() - metadata.last_successful_sync_at;
  }

  /**
   * Bulk clear cache tables only (keeps transactions, metadata)
   */
  async clearCacheTables(): Promise<void> {
    await Promise.all([
      this.products.clear(),
      this.inventory.clear(),
      this.customers.clear(),
      this.categories.clear(),
    ]);
  }
}

/**
 * Global instance of offline database
 * Singleton pattern to ensure single connection
 */
let dbInstance: ERPOfflineDB | null = null;

/**
 * Get or create offline database instance
 */
export function getOfflineDB(): ERPOfflineDB {
  if (!dbInstance) {
    dbInstance = new ERPOfflineDB();
  }
  return dbInstance;
}

/**
 * Initialize offline database on app start
 * Call this in AuthProvider after user is authenticated
 */
export async function initializeOfflineDB(userId: string): Promise<void> {
  const db = getOfflineDB();
  try {
    // IndexedDB is already persistent across reloads. Ask the browser to mark
    // this business-critical cache as durable too, reducing the chance that it
    // is evicted under storage pressure. Browsers may decline this request.
    if (navigator.storage?.persist) {
      try {
        const isPersistent = await navigator.storage.persisted();
        if (!isPersistent) {
          const granted = await navigator.storage.persist();
          if (granted) {
            console.info('[OfflineDB] Persistent storage granted');
          }
          // Don't log if not granted - it's normal and not critical
        }
      } catch (persistError) {
        // Ignore persistence errors - IndexedDB works fine without it
        console.debug('[OfflineDB] Persistent storage check skipped');
      }
    }

    // Test database access
    await db.appMetadata.toArray();
    // Initialize metadata if needed
    await db.initializeMetadata(userId);
    console.log('[OfflineDB] Initialized for user:', userId);
  } catch (error) {
    console.error('[OfflineDB] Failed to initialize:', error);
    throw error;
  }
}

/**
 * Check if offline database is accessible
 */
export async function isOfflineDBConnected(): Promise<boolean> {
  try {
    const db = getOfflineDB();
    await db.appMetadata.toArray();
    return true;
  } catch (error) {
    console.error('[OfflineDB] Connection check failed:', error);
    return false;
  }
}
