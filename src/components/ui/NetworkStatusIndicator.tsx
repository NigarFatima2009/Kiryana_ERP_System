/**
 * Network Status Indicator Component
 * 
 * Shows real-time connectivity status and sync information in the header
 * Displays: Online/Offline/Syncing status, last sync time, pending operations
 */

import { useEffect, useState } from 'react';
import { Wifi, WifiOff, RefreshCw, AlertCircle, Clock } from 'lucide-react';
import { useNetworkStatus, useSyncStats } from '../../hooks/useOfflineStatus';
import { usePendingOfflineSalesCount } from '../../hooks/useOfflineSales';
import { performOfflineSync } from '../../lib/offline/sync';
import type { ConnectivityStatus } from '../../lib/offline/types';

export function NetworkStatusIndicator() {
  const networkStatus = useNetworkStatus();
  const syncStats = useSyncStats();
  const pendingCount = usePendingOfflineSalesCount();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSyncNow = async () => {
    if (syncing) return;

    setSyncing(true);
    setSyncError(null);

    try {
      const result = await performOfflineSync();
      if (!result.success && result.error) {
        setSyncError(result.error);
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const getStatusColor = (status: ConnectivityStatus): string => {
    switch (status) {
      case 'ONLINE':
        return 'text-green-600';
      case 'OFFLINE':
        return 'text-red-600';
      case 'SYNCING':
        return 'text-blue-600';
      case 'SYNC_ERROR':
        return 'text-orange-600';
      case 'CONNECTIVITY_CHECKING':
        return 'text-gray-600';
      default:
        return 'text-gray-600';
    }
  };

  const getStatusLabel = (status: ConnectivityStatus): string => {
    switch (status) {
      case 'ONLINE':
        return 'Online';
      case 'OFFLINE':
        return 'Offline';
      case 'SYNCING':
        return 'Syncing...';
      case 'SYNC_ERROR':
        return 'Sync Error';
      case 'CONNECTIVITY_CHECKING':
        return 'Checking...';
      default:
        return 'Unknown';
    }
  };

  const getStatusIcon = (status: ConnectivityStatus) => {
    switch (status) {
      case 'ONLINE':
        return <Wifi className="h-4 w-4" />;
      case 'OFFLINE':
        return <WifiOff className="h-4 w-4" />;
      case 'SYNCING':
        return <RefreshCw className="h-4 w-4 animate-spin" />;
      case 'SYNC_ERROR':
        return <AlertCircle className="h-4 w-4" />;
      case 'CONNECTIVITY_CHECKING':
        return <RefreshCw className="h-4 w-4 animate-spin" />;
      default:
        return <WifiOff className="h-4 w-4" />;
    }
  };

  const formatLastSyncTime = (): string => {
    if (!syncStats.lastSyncTime) {
      return 'Never';
    }

    const date = new Date(syncStats.lastSyncTime);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  return (
    <div className="flex items-center gap-6 px-4 py-2 border-b border-gray-200 bg-white">
      {/* Status Badge */}
      <div
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
          networkStatus.status === 'ONLINE'
            ? 'bg-green-50 border-green-200'
            : networkStatus.status === 'OFFLINE'
              ? 'bg-red-50 border-red-200'
              : networkStatus.status === 'SYNCING'
                ? 'bg-blue-50 border-blue-200'
                : 'bg-orange-50 border-orange-200'
        }`}
      >
        <span className={`${getStatusColor(networkStatus.status)}`}>
          {getStatusIcon(networkStatus.status)}
        </span>
        <span
          className={`text-sm font-medium ${getStatusColor(networkStatus.status)}`}
        >
          {getStatusLabel(networkStatus.status)}
        </span>
      </div>

      {/* Last Sync Time */}
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Clock className="h-4 w-4" />
        <span>Last sync: {formatLastSyncTime()}</span>
      </div>

      {/* Pending Operations */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-50 border border-yellow-200">
          <span className="text-sm font-medium text-yellow-700">
            {pendingCount} {pendingCount === 1 ? 'sale' : 'sales'} pending
          </span>
        </div>
      )}

      {/* Sync Error Message */}
      {syncError && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <span className="text-sm text-red-700">{syncError}</span>
        </div>
      )}

      {/* Sync Now Button */}
      <button
        onClick={handleSyncNow}
        disabled={syncing || networkStatus.status === 'OFFLINE' || pendingCount === 0}
        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          syncing || networkStatus.status === 'OFFLINE' || pendingCount === 0
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
        {syncing ? 'Syncing...' : 'Sync Now'}
      </button>

      {/* Offline Mode Notice */}
      {networkStatus.status === 'OFFLINE' && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200">
          <span className="text-sm text-red-700 font-medium">
            Offline mode — sales will sync automatically when connection returns
          </span>
        </div>
      )}
    </div>
  );
}
