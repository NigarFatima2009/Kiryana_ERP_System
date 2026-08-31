import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { getQueuedMutations, removeMutation, incrementRetry, type QueuedMutation } from '../lib/offlineQueue';

const MAX_RETRIES = 3;
const SYNC_INTERVAL_MS = 10_000; // Check every 10 seconds

async function processMutation(mutation: QueuedMutation): Promise<boolean> {
  const { table, operation, data, filter } = mutation;

  try {
    if (operation === 'insert') {
      const { error } = await supabase.from(table).insert(data);
      if (error) throw error;
    } else if (operation === 'update') {
      if (!filter) throw new Error('Update requires a filter');
      const { error } = await supabase.from(table).update(data).match(filter);
      if (error) throw error;
    } else if (operation === 'delete') {
      if (!filter) throw new Error('Delete requires a filter');
      const { error } = await supabase.from(table).delete().match(filter);
      if (error) throw error;
    }
    return true;
  } catch (err) {
    console.error(`[OfflineSync] Failed to sync ${mutation.id}:`, err);
    return false;
  }
}

/**
 * Hook that:
 * 1. Tracks online/offline status
 * 2. Automatically syncs queued mutations when back online
 * 3. Returns { isOnline, queueSize }
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueSize, setQueueSize] = useState(0);
  const queryClient = useQueryClient();
  const syncingRef = useRef(false);

  // Update queue size display
  const updateQueueSize = useCallback(() => {
    const queue = getQueuedMutations();
    setQueueSize(queue.length);
  }, []);

  // Process all queued mutations
  const syncQueue = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;

    try {
      const queue = getQueuedMutations();
      if (queue.length === 0) {
        syncingRef.current = false;
        return;
      }

      console.log(`[OfflineSync] Syncing ${queue.length} queued mutations...`);

      // Process mutations in order
      for (const mutation of queue) {
        if (mutation.retries >= MAX_RETRIES) {
          console.warn(`[OfflineSync] Dropping mutation ${mutation.id} after ${MAX_RETRIES} retries`);
          removeMutation(mutation.id);
          continue;
        }

        const success = await processMutation(mutation);
        if (success) {
          removeMutation(mutation.id);
        } else {
          incrementRetry(mutation.id);
        }
      }

      // Invalidate all queries after sync to refresh data
      await queryClient.invalidateQueries();
      updateQueueSize();
      console.log('[OfflineSync] Sync complete');
    } finally {
      syncingRef.current = false;
    }
  }, [queryClient, updateQueueSize]);

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Sync after a short delay to let connection stabilize
      setTimeout(syncQueue, 1000);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial queue size
    updateQueueSize();

    // Periodic sync check (handles edge cases where online event is missed)
    const interval = setInterval(() => {
      if (navigator.onLine) {
        const queue = getQueuedMutations();
        if (queue.length > 0) {
          syncQueue();
        }
      }
      updateQueueSize();
    }, SYNC_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [syncQueue, updateQueueSize]);

  return { isOnline, queueSize, forceSync: syncQueue };
}
