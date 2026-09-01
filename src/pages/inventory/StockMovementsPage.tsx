import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WifiOff } from 'lucide-react';
import { fetchStockMovements } from '../../services/inventory';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Pagination } from '../../components/ui/Pagination';
import { formatDateTime } from '../../utils/helpers';
import { getOfflineDB } from '../../lib/offline/db';
import { getAllCachedProducts } from '../../lib/offline/cache';
import { useNetworkStatus } from '../../hooks/useOfflineStatus';

export function StockMovementsPage() {
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const networkStatus = useNetworkStatus();
  const isOnline = networkStatus.status === 'ONLINE';

  // Online: fetch from Supabase
  const { data, isLoading: onlineLoading } = useQuery({
    queryKey: ['stock-movements', page, typeFilter],
    queryFn: () => fetchStockMovements({ page, movement_type: typeFilter || undefined }),
    refetchInterval: 10000,
    enabled: isOnline,
  });

  // Offline: load from IndexedDB
  const [offlineMovements, setOfflineMovements] = useState<Record<string, unknown>[]>([]);
  const [offlineTotal, setOfflineTotal] = useState(0);
  const [offlineLoading, setOfflineLoading] = useState(false);

  const loadOfflineData = useCallback(async () => {
    try {
      const db = getOfflineDB();
      let allMovements = await db.offlineInventoryMovements
        .orderBy('created_at')
        .reverse()
        .toArray();

      // Apply type filter
      if (typeFilter) {
        allMovements = allMovements.filter((m) => m.movement_type === typeFilter);
      }

      // Get product names
      const products = await getAllCachedProducts();
      const pMap = new Map(products.map((p) => [p.id, p]));

      const PAGE_SIZE = 20;
      const total = allMovements.length;
      const paged = allMovements.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

      setOfflineTotal(total);
      setOfflineMovements(
        paged.map((m) => {
          const p = pMap.get(m.product_id);
          return {
            ...m,
            created_at: new Date(m.created_at).toISOString(),
            products: p ? { name: p.name, sku: p.sku, active: p.active } : null,
          };
        })
      );
    } catch (err) {
      console.error('[StockMovements] Failed to load offline data:', err);
    }
  }, [page, typeFilter]);

  useEffect(() => {
    if (isOnline) return;

    // Initial load
    setOfflineLoading(true);
    loadOfflineData().finally(() => setOfflineLoading(false));

    // Poll every 3 seconds to catch offline sales
    const interval = setInterval(() => {
      loadOfflineData();
    }, 3000);

    return () => clearInterval(interval);
  }, [isOnline, loadOfflineData]);

  const isLoading = isOnline ? onlineLoading : offlineLoading;
  const tableData = isOnline ? (data?.data || []) : offlineMovements;
  const totalPages = isOnline ? (data?.totalPages || 1) : Math.ceil(offlineTotal / 20);
  const totalItems = isOnline ? data?.count : offlineTotal;

  const typeColors: Record<string, string> = {
    PURCHASE: 'bg-green-100 text-green-800',
    SALE: 'bg-red-100 text-red-800',
    SALE_RETURN: 'bg-blue-100 text-blue-800',
    PURCHASE_RETURN: 'bg-orange-100 text-orange-800',
    ADJUSTMENT: 'bg-yellow-100 text-yellow-800',
    DAMAGE: 'bg-red-100 text-red-800',
    WASTAGE: 'bg-gray-100 text-gray-800',
    OPENING_STOCK: 'bg-purple-100 text-purple-800',
  };

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'date', header: 'Date', render: (row) => formatDateTime(row.created_at as string) },
    { key: 'product', header: 'Product', render: (row) => {
      const p = row.products as { name: string; sku: string; active?: boolean } | null;
      return (
        <span className="font-medium">
          {p?.name || '-'} <span className="text-xs text-gray-400">({p?.sku})</span>
          {p?.active === false && <span className="ml-1 text-xs text-gray-400">(Removed)</span>}
        </span>
      );
    }},
    { key: 'movement_type', header: 'Type', render: (row) => (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[row.movement_type as string] || 'bg-gray-100'}`}>
        {(row.movement_type as string)?.replace('_', ' ')}
      </span>
    )},
    { key: 'quantity_change', header: 'Qty Change', render: (row) => (
      <span className={`font-medium ${Number(row.quantity_change) > 0 ? 'text-green-600' : 'text-red-600'}`}>
        {Number(row.quantity_change) > 0 ? '+' : ''}{Number(row.quantity_change)}
      </span>
    )},
    { key: 'unit_cost', header: 'Unit Cost', render: (row) => `Rs. ${Number(row.unit_cost).toFixed(2)}` },
    { key: 'reference', header: 'Reference', render: (row) => <span className="text-gray-500 text-xs">{row.reference_type as string} - {String(row.reference_id || '').slice(0, 8)}</span> },
    { key: 'notes', header: 'Notes', render: (row) => <span className="text-gray-500 text-xs">{(row.notes as string) || '-'}</span> },
  ];

  const types = ['PURCHASE', 'SALE', 'SALE_RETURN', 'PURCHASE_RETURN', 'ADJUSTMENT', 'DAMAGE', 'WASTAGE', 'OPENING_STOCK'];

  return (
    <div className="space-y-4">
      {!isOnline && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
          <WifiOff className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-medium text-amber-700">Offline Mode — Showing cached stock movements (auto-refreshes)</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Stock Movements</h1>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="select-field w-48">
          <option value="">All Types</option>
          {types.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={tableData.map((i) => i as unknown as Record<string, unknown>)} isLoading={isLoading} emptyMessage="No movements found" />
        <div className="border-t px-4">
          <Pagination page={page} totalPages={totalPages || 1} onPageChange={setPage} totalItems={totalItems} pageSize={20} />
        </div>
      </div>
    </div>
  );
}
