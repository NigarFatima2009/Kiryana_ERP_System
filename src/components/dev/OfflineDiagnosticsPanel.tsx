/**
 * Offline Diagnostics Panel (Development Only)
 * 
 * Debug panel for development/testing
 * Shows detailed offline state and provides testing controls
 */

import { useEffect, useState } from 'react';
import { Zap, Database, RefreshCw, Trash2, Eye, EyeOff } from 'lucide-react';
import {
  getConnectivityDiagnostics,
  simulateOffline,
  simulateOnline,
} from '../../lib/offline/connectivity';
import { getCacheStats } from '../../lib/offline/cache';
import { getOfflineSalesStats } from '../../lib/offline/offlineSales';
import { getSyncQueueStats } from '../../lib/offline/syncQueue';
import { performOfflineSync, getSyncDiagnostics } from '../../lib/offline/sync';
import type { OfflineDiagnostics } from '../../lib/offline/types';

export function OfflineDiagnosticsPanel() {
  const [visible, setVisible] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{
    connectivity: ReturnType<typeof getConnectivityDiagnostics>;
    cache: Awaited<ReturnType<typeof getCacheStats>>;
    sales: Awaited<ReturnType<typeof getOfflineSalesStats>>;
    syncQueue: Awaited<ReturnType<typeof getSyncQueueStats>>;
    sync: Awaited<ReturnType<typeof getSyncDiagnostics>>;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [clearing, setClearing] = useState(false);

  const loadDiagnostics = async () => {
    try {
      const [connectivity, cache, sales, syncQueue, sync] = await Promise.all([
        Promise.resolve(getConnectivityDiagnostics()),
        getCacheStats(),
        getOfflineSalesStats(),
        getSyncQueueStats(),
        getSyncDiagnostics(),
      ]);

      setDiagnostics({
        connectivity,
        cache,
        sales,
        syncQueue,
        sync,
      });
    } catch (error) {
      console.error('[Diagnostics] Load failed:', error);
    }
  };

  useEffect(() => {
    if (visible) {
      loadDiagnostics();
      const interval = setInterval(loadDiagnostics, 2000); // Refresh every 2s
      return () => clearInterval(interval);
    }
  }, [visible]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await performOfflineSync();
      await loadDiagnostics();
    } finally {
      setSyncing(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Clear all offline data? This cannot be undone!')) {
      return;
    }

    setClearing(true);
    try {
      const { clearAllOperations } = await import('../../lib/offline/syncQueue');
      const { deleteOfflineSale, getAllOfflineSales } = await import(
        '../../lib/offline/offlineSales'
      );

      // Delete all offline sales
      const sales = await getAllOfflineSales();
      for (const sale of sales) {
        await deleteOfflineSale(sale.id);
      }

      // Clear sync queue
      await clearAllOperations();

      // Reload diagnostics
      await loadDiagnostics();
      alert('Offline data cleared');
    } catch (error) {
      console.error('[Diagnostics] Clear failed:', error);
      alert('Failed to clear data');
    } finally {
      setClearing(false);
    }
  };

  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700"
      >
        <Zap className="h-4 w-4" />
        Dev Panel
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-96 max-h-96 flex flex-col rounded-lg border-2 border-gray-800 bg-gray-900 text-gray-100 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-4 py-3">
        <h3 className="font-bold text-sm">Offline Diagnostics</h3>
        <button
          onClick={() => setVisible(false)}
          className="rounded p-1 hover:bg-gray-700"
        >
          <EyeOff className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-xs">
        {diagnostics ? (
          <>
            {/* Connection Status */}
            <div className="rounded-lg bg-gray-800 p-2">
              <div className="font-bold text-blue-400 mb-1">Connection</div>
              <div className="space-y-1 text-gray-300">
                <div>
                  Status: <span className="font-mono">{diagnostics.connectivity.status}</span>
                </div>
                <div>
                  Navigator.onLine:{' '}
                  <span className="font-mono">{diagnostics.connectivity.navigatorOnline ? 'true' : 'false'}</span>
                </div>
                <div>
                  Last Online: <span className="font-mono">{diagnostics.connectivity.lastOnlineTime}</span>
                </div>
              </div>
            </div>

            {/* Cache Stats */}
            <div className="rounded-lg bg-gray-800 p-2">
              <div className="font-bold text-green-400 mb-1">Cache</div>
              <div className="space-y-1 text-gray-300">
                <div>Products: <span className="font-mono">{diagnostics.cache.products}</span></div>
                <div>Customers: <span className="font-mono">{diagnostics.cache.customers}</span></div>
                <div>Inventory: <span className="font-mono">{diagnostics.cache.inventory}</span></div>
                <div>
                  Age: <span className="font-mono">
                    {diagnostics.cache.cacheAge
                      ? `${Math.round(diagnostics.cache.cacheAge / 1000)}s`
                      : 'Never'}
                  </span>
                </div>
              </div>
            </div>

            {/* Offline Sales */}
            <div className="rounded-lg bg-gray-800 p-2">
              <div className="font-bold text-yellow-400 mb-1">Offline Sales</div>
              <div className="space-y-1 text-gray-300">
                <div>Total: <span className="font-mono">{diagnostics.sales.total}</span></div>
                <div>Pending: <span className="font-mono">{diagnostics.sales.pending}</span></div>
                <div>Synced: <span className="font-mono">{diagnostics.sales.synced}</span></div>
                <div>Failed: <span className="font-mono">{diagnostics.sales.failed}</span></div>
              </div>
            </div>

            {/* Sync Queue */}
            <div className="rounded-lg bg-gray-800 p-2">
              <div className="font-bold text-purple-400 mb-1">Sync Queue</div>
              <div className="space-y-1 text-gray-300">
                <div>Total: <span className="font-mono">{diagnostics.syncQueue.total}</span></div>
                <div>Pending: <span className="font-mono">{diagnostics.syncQueue.pending}</span></div>
                <div>Syncing: <span className="font-mono">{diagnostics.syncQueue.syncing}</span></div>
                <div>Failed: <span className="font-mono">{diagnostics.syncQueue.failed}</span></div>
              </div>
            </div>

            {/* Sync Engine */}
            <div className="rounded-lg bg-gray-800 p-2">
              <div className="font-bold text-cyan-400 mb-1">Sync Engine</div>
              <div className="space-y-1 text-gray-300">
                <div>Avg Retries: <span className="font-mono">{diagnostics.sync.averageRetries}</span></div>
                <div>Common Error: <span className="font-mono text-xs">{diagnostics.sync.mostCommonError || 'None'}</span></div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-gray-400">Loading...</div>
        )}
      </div>

      {/* Footer - Actions */}
      <div className="border-t border-gray-700 bg-gray-800 px-4 py-3 flex gap-2">
        <button
          onClick={() => simulateOffline()}
          className="flex-1 flex items-center justify-center gap-1 rounded bg-red-700 hover:bg-red-600 px-2 py-1 text-xs font-medium"
        >
          Simulate Offline
        </button>
        <button
          onClick={() => simulateOnline()}
          className="flex-1 flex items-center justify-center gap-1 rounded bg-green-700 hover:bg-green-600 px-2 py-1 text-xs font-medium"
        >
          Simulate Online
        </button>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex-1 flex items-center justify-center gap-1 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-50 px-2 py-1 text-xs font-medium"
        >
          <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
          Sync
        </button>
        <button
          onClick={handleClear}
          disabled={clearing}
          className="flex-1 flex items-center justify-center gap-1 rounded bg-orange-700 hover:bg-orange-600 disabled:opacity-50 px-2 py-1 text-xs font-medium"
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </button>
      </div>
    </div>
  );
}

// Only render in development
export function DevDiagnosticsWrapper() {
  if (!import.meta.env.DEV) {
    return null;
  }

  return <OfflineDiagnosticsPanel />;
}
