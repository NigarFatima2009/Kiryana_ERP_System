/**
 * Offline Transactions Modal Component
 * 
 * Shows list of pending offline sales with their status
 * Allows manual retry of failed transactions
 */

import { useEffect, useState } from 'react';
import {
  X,
  Clock,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { useAllOfflineSales } from '../../hooks/useOfflineSales';
import { performOfflineSync } from '../../lib/offline/sync';
import { formatCurrency } from '../../utils/helpers';
import type { OfflineSale } from '../../lib/offline/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function OfflineTransactionsModal({ isOpen, onClose }: Props) {
  const { sales, loading } = useAllOfflineSales();
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<OfflineSale['status'] | 'all'>('all');

  const filteredSales =
    filter === 'all' ? sales : sales.filter(s => s.status === filter);

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      await performOfflineSync();
    } finally {
      setSyncing(false);
    }
  };

  const getStatusBadgeColor = (status: OfflineSale['status']): string => {
    switch (status) {
      case 'pending_sync':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'syncing':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'synced':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'sync_failed':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'conflict':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'duplicate_detected':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusIcon = (status: OfflineSale['status']) => {
    switch (status) {
      case 'pending_sync':
        return <Clock className="h-4 w-4" />;
      case 'syncing':
        return <RefreshCw className="h-4 w-4 animate-spin" />;
      case 'synced':
        return <CheckCircle className="h-4 w-4" />;
      case 'sync_failed':
        return <AlertTriangle className="h-4 w-4" />;
      case 'conflict':
        return <AlertTriangle className="h-4 w-4" />;
      case 'duplicate_detected':
        return <CheckCircle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getStatusLabel = (status: OfflineSale['status']): string => {
    switch (status) {
      case 'pending_sync':
        return 'Pending Sync';
      case 'syncing':
        return 'Syncing...';
      case 'synced':
        return 'Synced';
      case 'sync_failed':
        return 'Sync Failed';
      case 'conflict':
        return 'Conflict';
      case 'duplicate_detected':
        return 'Duplicate';
      default:
        return 'Unknown';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Offline Transactions</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-gray-100"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 border-b border-gray-200 px-6 py-3 overflow-x-auto">
          {[
            { value: 'all' as const, label: 'All' },
            { value: 'pending_sync' as const, label: 'Pending' },
            { value: 'synced' as const, label: 'Synced' },
            { value: 'sync_failed' as const, label: 'Failed' },
            { value: 'conflict' as const, label: 'Conflicts' },
          ].map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-3 py-1 text-sm font-medium rounded-lg transition-colors ${
                filter === tab.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {tab.label} ({sales.filter(s => tab.value === 'all' || s.status === tab.value).length})
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : filteredSales.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <CheckCircle className="mb-3 h-12 w-12 text-gray-300" />
              <p className="text-sm">No {filter === 'all' ? '' : filter} transactions</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSales.map(sale => (
                <div
                  key={sale.id}
                  className="flex items-start justify-between rounded-lg border border-gray-200 p-4 hover:bg-gray-50"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">
                        {sale.invoice_number}
                      </h3>
                      <span
                        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBadgeColor(
                          sale.status
                        )}`}
                      >
                        {getStatusIcon(sale.status)}
                        {getStatusLabel(sale.status)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                      <div>
                        <p className="text-xs text-gray-500">Customer</p>
                        <p className="font-medium text-gray-900">
                          {sale.customer_name || 'Walk-in'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Amount</p>
                        <p className="font-medium text-gray-900">
                          {formatCurrency(sale.total)}
                        </p>
                      </div>
                    </div>

                    {sale.last_sync_error && (
                      <div className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                        <strong>Error:</strong> {sale.last_sync_error}
                      </div>
                    )}

                    {sale.server_sale_id && (
                      <div className="mt-2 text-xs text-gray-500">
                        Server ID: {sale.server_sale_id}
                      </div>
                    )}

                    <div className="mt-2 text-xs text-gray-500">
                      Created: {new Date(sale.created_at).toLocaleString()}
                      {sale.synced_at && (
                        <> • Synced: {new Date(sale.synced_at).toLocaleString()}</>
                      )}
                    </div>
                  </div>

                  <div className="ml-4">
                    <p className="text-xs text-gray-500">
                      Attempts: {sale.sync_attempt_count}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
          >
            Close
          </button>
          <button
            onClick={handleSyncAll}
            disabled={syncing || filteredSales.filter(s => s.status !== 'synced').length === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              syncing || filteredSales.filter(s => s.status !== 'synced').length === 0
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync All'}
          </button>
        </div>
      </div>
    </div>
  );
}
