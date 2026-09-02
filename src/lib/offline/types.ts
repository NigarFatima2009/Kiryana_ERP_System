/**
 * Offline-First POS: Core Type Definitions
 * 
 * Defines all data structures for offline database, sync queue, and connectivity tracking
 */

// ==================== CONNECTIVITY STATUS ====================

export type ConnectivityStatus = 
  | 'ONLINE'
  | 'OFFLINE'
  | 'CONNECTIVITY_CHECKING'
  | 'SYNCING'
  | 'SYNC_ERROR';

export interface NetworkStatus {
  status: ConnectivityStatus;
  lastOnlineTime: number; // timestamp
  lastSyncTime: number | null; // timestamp
  lastSyncError: string | null;
  pendingOperationCount: number;
  syncedOperationCount: number;
  failedOperationCount: number;
}

// ==================== CACHED DATA FOR OFFLINE POS ====================

/**
 * Cached product snapshot for offline product search.
 * Mirrors essential product information needed for POS.
 */
export interface OfflineProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  category_id: string | null;
  category_name?: string; // Denormalized for offline search
  selling_price: number;
  tax_rate: number;
  active: boolean;
  updated_at: string;
}

/**
 * Cached inventory snapshot for offline POS.
 * Tracks quantity at time of sync to ensure accurate offline stock display.
 */
export interface OfflineInventory {
  product_id: string;
  quantity: number;
  reserved_quantity: number;
  average_cost: number;
  synced_at: string; // When this snapshot was taken
}

/**
 * Cached customer for offline credit/khata operations.
 * Includes enough info to display balance and create credit sales.
 */
export interface OfflineCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  credit_limit: number;
  opening_balance: number;
  active: boolean;
  // Calculated at sync time
  last_synced_balance?: number; // Balance as of last sync
  synced_at: string;
}

/**
 * Cached category for UI display.
 */
export interface OfflineCategory {
  id: string;
  name: string;
  active: boolean;
}

/**
 * Metadata about the offline database and synchronization.
 */
export interface OfflineAppMetadata {
  id: 'app-metadata'; // Singleton key
  last_successful_sync_at: number | null; // timestamp
  last_sync_attempt_at: number | null; // timestamp
  last_sync_error: string | null;
  sync_conflict_count: number;
  initialized_at: number; // When offline DB was first created
  schema_version: number; // For future migrations
  user_id: string; // Authenticated user (cashier)
}

// ==================== OFFLINE SALES & TRANSACTIONS ====================

/**
 * Status of an offline sale throughout its lifecycle.
 */
export type OfflineSaleStatus = 
  | 'pending_sync'      // Created offline, not yet synced
  | 'syncing'           // Currently attempting to sync
  | 'synced'            // Successfully synced to server
  | 'sync_failed'       // Failed to sync, will retry
  | 'conflict'          // Conflict detected (e.g., inventory shortage)
  | 'duplicate_detected'; // Duplicate detected on server (idempotency)

/**
 * Offline sale created while device is disconnected.
 * Contains minimal data needed to recreate sale on server.
 */
export interface OfflineSale {
  // Local identifiers
  id: string; // Local UUID for offline sale record
  client_transaction_id: string; // Idempotency key sent to server (must be UNIQUE on server)
  
  // Sale details
  invoice_number: string; // Local invoice number, e.g., INV-OFF-12345
  customer_id: string | null;
  customer_name?: string; // Denormalized for display
  
  // Financial details
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  
  // Status tracking
  status: OfflineSaleStatus;
  
  // Server sync info
  server_sale_id?: string; // Populated after successful sync
  server_invoice_number?: string; // Server's invoice number
  
  // Notes
  notes?: string;
  
  // Timing
  created_at: number; // timestamp
  synced_at: number | null; // timestamp when successfully synced
  sync_attempt_count: number; // Retry tracking
  last_sync_attempt_at: number | null; // timestamp
  last_sync_error?: string; // Error message from last sync attempt
  
  // Payment info (cached for reference)
  payment_methods?: Array<{ method: string; amount: number; reference?: string }>;
}

/**
 * Offline sale item line.
 */
export interface OfflineSaleItem {
  id: string; // Local UUID
  offline_sale_id: string; // FK to OfflineSale.id
  product_id: string;
  product_name?: string; // Denormalized
  product_sku?: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tax: number;
  line_total: number;
  cogs: number;
  created_at: number; // timestamp
}

// ==================== OFFLINE SHIFTS ====================

/**
 * Shift created while offline.
 * Synced to Supabase when connection returns.
 */
export interface OfflineShift {
  id: string;
  user_id: string;
  opened_at: string; // ISO string
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  variance: number | null;
  status: 'OPEN' | 'CLOSED';
  notes: string | null;
  // Sync tracking
  synced: boolean;
  server_shift_id: string | null; // Populated after sync
  created_at: number; // timestamp
  synced_at: number | null;
}

// ==================== SYNC QUEUE ====================

/**
 * Type of operation queued for synchronization.
 */
export type SyncOperationType = 
  | 'create_sale'
  | 'update_sale_status'
  | 'create_customer_credit'
  | 'create_inventory_movement'
  | 'update_inventory';

/**
 * Queued operation for safe, durable synchronization.
 * 
 * Each operation contains:
 * - Enough info to retry safely (idempotency keys)
 * - Payload to send to server
 * - Retry tracking
 * - Error history
 */
export interface SyncQueueItem {
  // Queue identifiers
  id: string; // UUID for queue item
  operation_type: SyncOperationType;
  entity_type: string; // 'sale', 'payment', etc.
  entity_id: string; // Local ID of entity (offline_sale.id, etc.)
  
  // Idempotency
  client_transaction_id: string; // Unique identifier for this operation (must be UNIQUE on server)
  
  // Payload
  payload: Record<string, any>; // JSON payload to send to server
  
  // Status
  status: 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';
  
  // Retry tracking
  attempt_count: number;
  last_attempt_at: number | null; // timestamp
  last_error: string | null;
  last_error_code?: string; // HTTP status or error code
  
  // Conflict info
  conflict_reason?: string; // Explanation of conflict (e.g., "Insufficient inventory")
  
  // Timing
  created_at: number; // timestamp
  synced_at: number | null; // timestamp when successfully synced
}

// ==================== SYNC CONFLICTS ====================

/**
 * Recorded conflict for manual resolution.
 */
export interface SyncConflict {
  id: string; // UUID
  sync_queue_item_id: string; // FK to SyncQueueItem.id
  offline_sale_id?: string; // FK to OfflineSale.id if applicable
  
  conflict_type: string; // 'insufficient_inventory', 'duplicate_detected', 'rls_failure', etc.
  description: string; // Human-readable explanation
  
  // Local vs Server data
  local_data: Record<string, any>; // What offline had
  server_data?: Record<string, any>; // What server has (if known)
  
  // Resolution
  resolved: boolean;
  resolution_notes?: string;
  resolved_at: number | null; // timestamp
  
  // Timing
  created_at: number; // timestamp
}

// ==================== OFFLINE INVENTORY SNAPSHOT ====================

/**
 * Inventory movement created locally while offline.
 * Used to track stock changes during offline operation.
 */
export interface OfflineInventoryMovement {
  id: string; // UUID
  product_id: string;
  movement_type: 'SALE' | 'ADJUSTMENT' | 'OPENING_STOCK';
  quantity_change: number; // Negative for sales
  unit_cost: number;
  reference_type: string; // 'OFFLINE_SALE', etc.
  reference_id: string; // offline_sale.id, etc.
  notes?: string;
  created_at: number; // timestamp
  synced: boolean; // Whether this has been synced to server
  server_movement_id?: string; // Server-side ID after sync
}

// ==================== UTILITY TYPES ====================

/**
 * Result of sync operation.
 */
export interface SyncResult {
  success: boolean;
  operationId: string;
  serverEntityId?: string; // Server-assigned ID if created
  error?: string;
  conflictDetected?: boolean;
  conflictReason?: string;
}

/**
 * Offline database statistics for diagnostics.
 */
export interface OfflineDiagnostics {
  connected: boolean; // IndexedDB accessible
  cachedProducts: number;
  cachedCustomers: number;
  cachedInventory: number;
  pendingSales: number;
  syncQueueSize: number;
  conflictCount: number;
  lastSuccessfulSync: string | null;
  lastSyncError: string | null;
  syncStatus: ConnectivityStatus;
}
