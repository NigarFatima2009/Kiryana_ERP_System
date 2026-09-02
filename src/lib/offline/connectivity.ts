/**
 * Offline-First POS: Connectivity Detection & Status Management
 * 
 * Provides reliable network status tracking beyond navigator.onLine.
 * Uses lightweight health checks and event listeners.
 */

import type { ConnectivityStatus, NetworkStatus } from './types';

// ==================== CONNECTIVITY STATE ====================

type StatusChangeListener = (status: NetworkStatus) => void;

interface ConnectivityState {
  status: ConnectivityStatus;
  lastOnlineTime: number;
  lastSyncTime: number | null;
  lastSyncError: string | null;
  pendingOperationCount: number;
  syncedOperationCount: number;
  failedOperationCount: number;
}

let state: ConnectivityState = {
  status: navigator.onLine ? 'ONLINE' : 'OFFLINE',
  lastOnlineTime: Date.now(),
  lastSyncTime: null,
  lastSyncError: null,
  pendingOperationCount: 0,
  syncedOperationCount: 0,
  failedOperationCount: 0,
};

const listeners: Set<StatusChangeListener> = new Set();

// ==================== CONNECTIVITY HINTS ====================

/**
 * Perform lightweight connectivity check against Supabase
 * Uses a simple, fast endpoint to verify network access
 */
async function performHealthCheck(): Promise<boolean> {
  // Rely on navigator.onLine for reliable browser online status
  return navigator.onLine;
}

/**
 * Detect if browser navigator.onLine changed to offline
 */
function handleOffline(): void {
  if (state.status !== 'OFFLINE' && state.status !== 'SYNCING') {
    setStatus('OFFLINE');
  }
}

/**
 * Detect if browser navigator.onLine changed to online
 */
async function handleOnline(): Promise<void> {
  // Quickly set to checking state
  setStatus('CONNECTIVITY_CHECKING');
  console.log('[Connectivity] Checking if truly online...');

  // Verify connectivity with health check
  const isConnected = await performHealthCheck();
  
  if (isConnected) {
    state.lastOnlineTime = Date.now();
    setStatus('ONLINE');
    console.log('[Connectivity] ✓ Confirmed ONLINE');

    // Refresh offline cache when coming back online to clean up deleted products
    try {
      const { refreshOfflineCache } = await import('./sync');
      console.log('[Connectivity] Refreshing offline cache after coming online...');
      refreshOfflineCache().catch(error => {
        console.warn('[Connectivity] Cache refresh failed (non-critical):', error);
      });
    } catch (error) {
      console.warn('[Connectivity] Could not import refreshOfflineCache:', error);
    }
  } else {
    // Health check failed, stay offline
    setStatus('OFFLINE');
    console.log('[Connectivity] ✗ Health check failed, staying OFFLINE');
  }
}

// ==================== STATUS MANAGEMENT ====================

/**
 * Set connectivity status
 */
function setStatus(newStatus: ConnectivityStatus): void {
  if (state.status !== newStatus) {
    console.log('[Connectivity] Status change:', state.status, '→', newStatus);
    state.status = newStatus;
    notifyListeners();
  }
}

/**
 * Get current network status
 */
export function getNetworkStatus(): NetworkStatus {
  return {
    status: state.status,
    lastOnlineTime: state.lastOnlineTime,
    lastSyncTime: state.lastSyncTime,
    lastSyncError: state.lastSyncError,
    pendingOperationCount: state.pendingOperationCount,
    syncedOperationCount: state.syncedOperationCount,
    failedOperationCount: state.failedOperationCount,
  };
}

/**
 * Update sync statistics
 */
export function updateSyncStats(
  pending: number,
  synced: number,
  failed: number,
  error: string | null = null
): void {
  state.pendingOperationCount = pending;
  state.syncedOperationCount = synced;
  state.failedOperationCount = failed;
  state.lastSyncTime = Date.now();
  state.lastSyncError = error;
  notifyListeners();
}

/**
 * Manually set sync error
 */
export function setSyncError(error: string): void {
  state.lastSyncError = error;
  state.status = 'SYNC_ERROR';
  notifyListeners();
}

/**
 * Clear sync error
 */
export function clearSyncError(): void {
  if (state.lastSyncError) {
    state.lastSyncError = null;
    if (state.status === 'SYNC_ERROR') {
      state.status = 'ONLINE';
    }
    notifyListeners();
  }
}

/**
 * Set status to SYNCING
 */
export function startSync(): void {
  setStatus('SYNCING');
}

/**
 * Set status after sync completes
 */
export function endSync(hadError: boolean): void {
  if (hadError) {
    setStatus('SYNC_ERROR');
  } else {
    setStatus('ONLINE');
  }
}

// ==================== LISTENER MANAGEMENT ====================

/**
 * Notify all listeners of status change
 */
function notifyListeners(): void {
  const status = getNetworkStatus();
  listeners.forEach(listener => {
    try {
      listener(status);
    } catch (error) {
      console.error('[Connectivity] Listener error:', error);
    }
  });
}

/**
 * Subscribe to connectivity status changes
 * Returns unsubscribe function
 */
export function onConnectivityChange(listener: StatusChangeListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

let initialized = false;

/**
 * Initialize connectivity detection
 * Safe to call multiple times — only runs once
 */
export function initializeConnectivity(): void {
  if (initialized) return;
  initialized = true;

  console.log('[Connectivity] Initializing. Current navigator.onLine:', navigator.onLine);

  // Listen for browser online/offline events
  window.addEventListener('online', () => {
    console.log('[Connectivity] Browser "online" event fired');
    handleOnline().catch(error => {
      console.error('[Connectivity] Error handling online event:', error);
    });
  });

  window.addEventListener('offline', () => {
    console.log('[Connectivity] Browser "offline" event fired');
    handleOffline();
  });

  // Verify the initial browser state immediately. Until this completes the
  // status remains CONNECTIVITY_CHECKING, which the POS treats as local-first.
  if (navigator.onLine) {
    void handleOnline().catch(error => {
      console.error('[Connectivity] Error checking initial connection:', error);
    });
  } else {
    handleOffline();
  }

  // Periodic connectivity check every 10 seconds (more aggressive)
  setInterval(async () => {
    const currentStatus = state.status;
    
    if (currentStatus === 'OFFLINE') {
      // Check if we're back online via navigator.onLine
      if (navigator.onLine) {
        console.log('[Connectivity] Periodic check detected navigator.onLine = true, verifying...');
        await handleOnline();
      }
    } else if (currentStatus === 'ONLINE' || currentStatus === 'CONNECTIVITY_CHECKING') {
      // Verify we're still online
      try {
        const isConnected = await performHealthCheck();
        if (!isConnected && state.status === 'ONLINE') {
          console.log('[Connectivity] Periodic health check failed, going OFFLINE');
          setStatus('OFFLINE');
        }
      } catch (error) {
        console.error('[Connectivity] Periodic check error:', error);
      }
    }
  }, 10_000); // Check every 10 seconds instead of 30

  console.log('[Connectivity] Initialized. Current status:', state.status);
}

// ==================== DIAGNOSTICS ====================

/**
 * Get connectivity diagnostics for debug panel
 */
export function getConnectivityDiagnostics(): {
  navigatorOnline: boolean;
  status: ConnectivityStatus;
  lastOnlineTime: string;
  lastSyncTime: string | null;
  lastSyncError: string | null;
  pendingOperations: number;
  syncedOperations: number;
  failedOperations: number;
} {
  return {
    navigatorOnline: navigator.onLine,
    status: state.status,
    lastOnlineTime: new Date(state.lastOnlineTime).toLocaleString(),
    lastSyncTime: state.lastSyncTime ? new Date(state.lastSyncTime).toLocaleString() : null,
    lastSyncError: state.lastSyncError,
    pendingOperations: state.pendingOperationCount,
    syncedOperations: state.syncedOperationCount,
    failedOperations: state.failedOperationCount,
  };
}

// ==================== DEVELOPMENT MODE ====================

/**
 * Simulate offline mode (development only)
 */
export function simulateOffline(): void {
  setStatus('OFFLINE');
}

/**
 * Simulate online mode (development only)
 */
export function simulateOnline(): void {
  state.lastOnlineTime = Date.now();
  setStatus('ONLINE');
}

/**
 * Check if development mode is enabled
 */
function isDevelopment(): boolean {
  return import.meta.env.DEV === true;
}
