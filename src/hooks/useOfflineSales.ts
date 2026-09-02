/**
 * React Hook: Manage offline sales
 * 
 * Provides interface for creating, tracking, and syncing offline sales
 */

import { useEffect, useState } from 'react';
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

/**
 * Hook to get pending offline sales
 * Polls for updates
 */
export function usePendingOfflineSales() {
  const [sales, setSales] = useState<OfflineSale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const pendingSales = await getPendingOfflineSales();
        if (mounted) {
          setSales(pendingSales);
        }
      } catch (error) {
        console.error('[useOfflineSales] Error loading pending sales:', error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();
    window.addEventListener(OFFLINE_SALES_CHANGED_EVENT, load);

    // Poll every 5 seconds for updates
    const interval = setInterval(load, 5000);

    return () => {
      mounted = false;
      window.removeEventListener(OFFLINE_SALES_CHANGED_EVENT, load);
      clearInterval(interval);
    };
  }, []);

  return { sales, loading };
}

/**
 * Hook to get count of pending offline sales
 */
export function usePendingOfflineSalesCount() {
  const [count, setCount] = useState(0);

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

    load();
    window.addEventListener(OFFLINE_SALES_CHANGED_EVENT, load);

    // Poll every 5 seconds
    const interval = setInterval(load, 5000);

    return () => {
      mounted = false;
      window.removeEventListener(OFFLINE_SALES_CHANGED_EVENT, load);
      clearInterval(interval);
    };
  }, []);

  return count;
}

/**
 * Hook to get all offline sales (pending, synced, failed, etc.)
 */
export function useAllOfflineSales() {
  const [sales, setSales] = useState<OfflineSale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const allSales = await getAllOfflineSales();
        if (mounted) {
          setSales(allSales);
        }
      } catch (error) {
        console.error('[useOfflineSales] Error loading all sales:', error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();
    window.addEventListener(OFFLINE_SALES_CHANGED_EVENT, load);

    // Refresh every 10 seconds
    const interval = setInterval(load, 10_000);

    return () => {
      mounted = false;
      window.removeEventListener(OFFLINE_SALES_CHANGED_EVENT, load);
      clearInterval(interval);
    };
  }, []);

  return { sales, loading };
}

/**
 * Hook to get offline sales statistics
 */
export function useOfflineSalesStats() {
  const [stats, setStats] = useState<OfflineSalesStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const st = await getOfflineSalesStats();
        if (mounted) {
          setStats(st);
        }
      } catch (error) {
        console.error('[useOfflineSales] Error loading stats:', error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();
    window.addEventListener(OFFLINE_SALES_CHANGED_EVENT, load);

    // Poll every 10 seconds
    const interval = setInterval(load, 10_000);

    return () => {
      mounted = false;
      window.removeEventListener(OFFLINE_SALES_CHANGED_EVENT, load);
      clearInterval(interval);
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
      // This is a no-op; just triggers re-fetch by component
      await getPendingOfflineSales();
    } finally {
      setRefreshing(false);
    }
  };

  return { refresh, refreshing };
}
