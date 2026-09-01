/**
 * React Hook: Track offline status and sync state
 * 
 * Provides real-time network connectivity and sync status to components
 */

import { useEffect, useState } from 'react';
import {
  getNetworkStatus,
  onConnectivityChange,
  initializeConnectivity,
} from '../lib/offline/connectivity';
import type { NetworkStatus } from '../lib/offline/types';

/**
 * Hook to get current network status
 * Re-renders when status changes
 */
export function useNetworkStatus() {
  const [status, setStatus] = useState<NetworkStatus>(getNetworkStatus());

  useEffect(() => {
    // Initialize connectivity detection
    initializeConnectivity();

    // Subscribe to changes
    const unsubscribe = onConnectivityChange(setStatus);

    return () => {
      unsubscribe();
    };
  }, []);

  return status;
}

/**
 * Hook to check if application is online
 */
export function useIsOnline(): boolean {
  const status = useNetworkStatus();
  return status.status === 'ONLINE';
}

/**
 * Hook to check if currently syncing
 */
export function useIsSyncing(): boolean {
  const status = useNetworkStatus();
  return status.status === 'SYNCING';
}

/**
 * Hook to get sync statistics
 */
export function useSyncStats() {
  const status = useNetworkStatus();
  return {
    pendingOperations: status.pendingOperationCount,
    syncedOperations: status.syncedOperationCount,
    failedOperations: status.failedOperationCount,
    lastSyncTime: status.lastSyncTime,
    lastSyncError: status.lastSyncError,
  };
}
