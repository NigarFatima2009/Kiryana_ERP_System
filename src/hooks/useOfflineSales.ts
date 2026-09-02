/**
 * React Hook: Manage offline sales
 * 
 * OPTIMIZED: Implements smart caching and polling deduplication
 * Singleton polling to prevent multiple intervals running for the same data
 */

import { useEffect, useState, useRef } from 'react';
import {
  getPendingOfflineSales,
  getAllOfflineSales,
  getPendingOfflineSalesCount,
  getOfflineSalesStats,
  OFFLINE_SALES_CHANGED_EVENT,
} from '../lib/offline/offlineSales';
import type { OfflineSale } from '../lib/offline/types';

interface OfflineSalesStats {
  total: number;
  pending: number;
  synced: number;
  failed: number;
  conflicts: number;
}

// Singleton polling managers to deduplicate polling intervals
const pollManagers = new Map<string, {
  intervalId: ReturnType<typeof setInterval> | null;
  subscribers: Set<() => void>;
  lastUpdate: number;
}>();

function getOrCreatePollManager(key: string, intervalMs: number) {
  if (!pollManagers.has(key)) {
    pollManagers.set(key, {
      intervalId: null,
      subscribers: new Set(),
      lastUpdate: 0,
    });
  }
  
  const manager = pollManagers.get(key)!;
  
  // Start polling if not already started
  if (!manager.intervalId) {
    manager.intervalId = setInterval(() => {
      manager.subscribers.forEach(callback => callback());
    }, intervalMs) as any;
  }
  
  return manager;
}

/**
 * Hook to get pending offline sales - OPTIMIZED with shared polling
 */
export function usePendingOfflineSales() {
  const [sales, setSales] = useState<OfflineSale[]>([]);
  const [loading, setLoading] = useState(true);
  const managerRef = useRef<ReturnType<typeof getOrCreatePollManager> | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const pendingSales = await getPendingOfflineSales();
        if (mounted) {
          setSales(pendingSales);
          setLoading(false);
        }
      } catch (error) {
        console.error('[useOfflineSales] Error loading pending sales:', error);
      }
    }

    // Initial load
    load();

    // Set up shared polling (only one interval for all subscribers)
    const manager = getOrCreatePollManager('pending-sales', 5000);
    managerRef.current = manager;
    manager.subscribers.add(load);

    // Event listener for manual triggers
    window.addEventListener(OFFLINE_SALES_CHANGED_EVENT, load);

    return () => {
      mounted = false;
      manager.subscribers.delete(load);
      window.removeEventListener(OFFLINE_SALES_CHANGED_EVENT, load);
      
      // Clean up polling if no more subscribers
      if (manager.subscribers.size === 0 && manager.intervalId) {
        clearInterval(manager.intervalId);
        manager.intervalId = null;
      }
    };
  }, []);

  return { sales, loading };
}

/**
 * Hook to get count of pending offline sales - OPTIMIZED
 */
export function usePendingOfflineSalesCount() {
  const [count, setCount] = useState(0);
  const managerRef = useRef<ReturnType<typeof getOrCreatePollManager> | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const c = await getPendingOfflineSalesCount();
        if (mounted) {
          setCount(c);
        }
      } catch (error) {
        console.error('[useOfflineSales] Error loading count:', error);
      }
    }

    // Initial load
    load();

    // Shared polling
    const manager = getOrCreatePollManager('pending-count', 5000);
    managerRef.current = manager;
    manager.subscribers.add(load);

    window.addEventListener(OFFLINE_SALES_CHANGED_EVENT, load);

    return () => {
      mounted = false;
      manager.subscribers.delete(load);
      window.removeEventListener(OFFLINE_SALES_CHANGED_EVENT, load);
      
      if (manager.subscribers.size === 0 && manager.intervalId) {
        clearInterval(manager.intervalId);
        manager.intervalId = null;
      }
    };
  }, []);

  return count;
}

/**
 * Hook to get all offline sales - OPTIMIZED with shared polling
 */
export function useAllOfflineSales() {
  const [sales, setSales] = useState<OfflineSale[]>([]);
  const [loading, setLoading] = useState(true);
  const managerRef = useRef<ReturnType<typeof getOrCreatePollManager> | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const allSales = await getAllOfflineSales();
        if (mounted) {
          setSales(allSales);
          setLoading(false);
        }
      } catch (error) {
        console.error('[useOfflineSales] Error loading all sales:', error);
      }
    }

    // Initial load
    load();

    // Shared polling with longer interval (10s)
    const manager = getOrCreatePollManager('all-sales', 10000);
    managerRef.current = manager;
    manager.subscribers.add(load);

    window.addEventListener(OFFLINE_SALES_CHANGED_EVENT, load);

    return () => {
      mounted = false;
      manager.subscribers.delete(load);
      window.removeEventListener(OFFLINE_SALES_CHANGED_EVENT, load);
      
      if (manager.subscribers.size === 0 && manager.intervalId) {
        clearInterval(manager.intervalId);
        manager.intervalId = null;
      }
    };
  }, []);

  return { sales, loading };
}

/**
 * Hook to get offline sales statistics - OPTIMIZED
 */
export function useOfflineSalesStats() {
  const [stats, setStats] = useState<OfflineSalesStats | null>(null);
  const [loading, setLoading] = useState(true);
  const managerRef = useRef<ReturnType<typeof getOrCreatePollManager> | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const st = await getOfflineSalesStats();
        if (mounted) {
          setStats(st);
          setLoading(false);
        }
      } catch (error) {
        console.error('[useOfflineSales] Error loading stats:', error);
      }
    }

    // Initial load
    load();

    // Shared polling
    const manager = getOrCreatePollManager('sales-stats', 10000);
    managerRef.current = manager;
    manager.subscribers.add(load);

    window.addEventListener(OFFLINE_SALES_CHANGED_EVENT, load);

    return () => {
      mounted = false;
      manager.subscribers.delete(load);
      window.removeEventListener(OFFLINE_SALES_CHANGED_EVENT, load);
      
      if (manager.subscribers.size === 0 && manager.intervalId) {
        clearInterval(manager.intervalId);
        manager.intervalId = null;
      }
    };
  }, []);

  return { stats, loading };
}

/**
 * Hook to manually refresh offline sales data
 */
export function useRefreshOfflineSales() {
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await getPendingOfflineSales();
      // Trigger event to notify all subscribers
      window.dispatchEvent(new Event(OFFLINE_SALES_CHANGED_EVENT));
    } finally {
      setRefreshing(false);
    }
  };

  return { refresh, refreshing };
}
