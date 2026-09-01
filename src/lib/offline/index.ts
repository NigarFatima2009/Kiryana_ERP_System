/**
 * Offline-First POS: Main Exports
 * 
 * Re-exports all offline functionality from a single entry point
 */

// Types
export * from './types';

// Database
export { getOfflineDB, initializeOfflineDB, isOfflineDBConnected } from './db';

// Connectivity
export {
  getNetworkStatus,
  updateSyncStats,
  setSyncError,
  clearSyncError,
  startSync,
  endSync,
  onConnectivityChange,
  initializeConnectivity,
  getConnectivityDiagnostics,
  simulateOffline,
  simulateOnline,
} from './connectivity';

// Cache
export {
  cacheProducts,
  searchCachedProducts,
  getProductByBarcode,
  getProductBySku,
  getAllCachedProducts,
  getCachedProductCount,
  cacheInventory,
  getCachedInventory,
  getAllCachedInventory,
  decrementLocalInventory,
  incrementLocalInventory,
  cacheCustomers,
  searchCachedCustomers,
  getCachedCustomer,
  getAllCachedCustomers,
  getCachedCustomerCount,
  cacheCategories,
  getAllCachedCategories,
  getCacheStats,
  clearAllCaches,
  isCacheFresh,
  getLastCacheUpdateTime,
} from './cache';

// Offline Sales
export {
  createOfflineSale,
  getOfflineSale,
  getOfflineSaleByClientId,
  getOfflineSaleItems,
  getPendingOfflineSales,
  getSyncedOfflineSales,
  getConflictedOfflineSales,
  getAllOfflineSales,
  getPendingOfflineSalesCount,
  updateOfflineSaleStatus,
  markAsSyncing,
  markAsSynced,
  markAsSyncFailed,
  markAsConflict,
  markAsDuplicate,
  deleteOfflineSale,
  getOfflineSalesStats,
} from './offlineSales';

// Sync Queue
export {
  queueSyncOperation,
  getPendingOperations,
  getOperationsForEntity,
  getOperationByClientId,
  getQueueItem,
  markOperationSyncing,
  markOperationSynced,
  markOperationFailed,
  markOperationConflict,
  retryOperation,
  removeQueueItem,
  clearSyncedOperations,
  clearAllOperations,
  getSyncQueueStats,
  getAverageRetries,
  getMostCommonError,
  getStaleOperations,
} from './syncQueue';

// Sync Engine
export {
  performOfflineSync,
  performInitialCacheSync,
  getSyncDiagnostics,
} from './sync';
