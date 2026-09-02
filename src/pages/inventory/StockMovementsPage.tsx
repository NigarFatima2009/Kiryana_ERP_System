import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WifiOff, Eye } from 'lucide-react';
import { fetchStockMovements } from '../../services/inventory';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Pagination } from '../../components/ui/Pagination';
import { Modal } from '../../components/ui/Modal';
import { formatDateTime, formatCurrency } from '../../utils/helpers';
import { getOfflineDB } from '../../lib/offline/db';
import { getAllCachedProducts } from '../../lib/offline/cache';
import { useNetworkStatus } from '../../hooks/useOfflineStatus';

export function StockMovementsPage() {
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
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

  const movementDescriptions: Record<string, (qty: number, product: string) => string> = {
    PURCHASE: (qty, product) => `Purchased ${qty} ${product}`,
    SALE: (qty, product) => `Sold ${qty} ${product}`,
    SALE_RETURN: (qty, product) => `Sale return of ${qty} ${product}`,
    PURCHASE_RETURN: (qty, product) => `Returned ${qty} ${product} to supplier`,
    ADJUSTMENT: (qty, product) => `Adjusted stock by ${qty} ${product}`,
    DAMAGE: (qty, product) => `Damaged stock: ${Math.abs(qty)} ${product}`,
    WASTAGE: (qty, product) => `Wasted ${Math.abs(qty)} ${product}`,
    OPENING_STOCK: (qty, product) => `Opening stock: ${qty} ${product}`,
  };

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'when', header: 'When', render: (row) => (
      <div className="text-sm">
        <div className="font-medium text-slate-900">{new Date(row.created_at as string).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</div>
        <div className="text-xs text-slate-500">{new Date(row.created_at as string).toLocaleDateString()}</div>
      </div>
    )},
    { key: 'what', header: 'What', render: (row) => {
      const p = row.products as { name: string; sku: string; active?: boolean } | null;
      const qty = Math.abs(Number(row.quantity_change));
      const desc = movementDescriptions[row.movement_type as string]?.(qty, p?.name || 'Unknown') || `${row.movement_type}: ${qty} units`;
      return (
        <div className="font-medium text-slate-900">
          {desc}
          <div className="text-xs text-slate-500 mt-0.5">{p?.sku || '-'}</div>
        </div>
      );
    }},
    { key: 'who', header: 'Who', render: (row) => {
      const profile = (row.profiles as { full_name: string; email: string } | null) || null;
      const cashierName = profile?.full_name || 'System';
      return (
        <div className="font-medium text-slate-900">{cashierName}</div>
      );
    }},
    { key: 'type', header: 'Type', render: (row) => (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[row.movement_type as string] || 'bg-gray-100'}`}>
        {(row.movement_type as string)?.replace('_', ' ')}
      </span>
    )},
    { key: 'reference', header: 'Reference', render: (row) => (
      <div className="text-sm">
        <div className="font-mono font-medium text-slate-900">{row.reference_type as string}</div>
        <div className="text-xs text-slate-500">{String(row.reference_id || '-').slice(0, 8)}</div>
      </div>
    )},
    { key: 'actions', header: '', render: (row) => (
      <button 
        onClick={() => setDetailId(row.id as string)}
        className="rounded-lg p-1.5 hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
      >
        <Eye size={16} />
      </button>
    )},
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

      {detailId && <StockMovementDetail id={detailId} onClose={() => setDetailId(null)} isOnline={isOnline} movements={tableData} />}
    </div>
  );
}

function StockMovementDetail({ id, onClose, isOnline, movements }: { id: string; onClose: () => void; isOnline: boolean; movements: Record<string, unknown>[] }): React.ReactElement {
  const movement = movements.find(m => (m.id as string) === id);
  
  if (!movement) {
    return <Modal isOpen={true} onClose={onClose} title="Movement Details"><p>Not found</p></Modal>;
  }

  const movementType = String(movement.movement_type || '');
  const product = movement.products as { name: string; sku: string; active?: boolean } | null;
  const profile = (movement.profiles as { full_name: string; email: string } | null) || null;
  const qty = Math.abs(Number(movement.quantity_change || 0));
  const cashierName = profile?.full_name || 'System';
  const isIncrease = Number(movement.quantity_change || 0) > 0;

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

  const movementDescriptions: Record<string, (qty: number, product: string) => string> = {
    PURCHASE: (q, p) => `Purchased ${q} ${p}`,
    SALE: (q, p) => `Sold ${q} ${p}`,
    SALE_RETURN: (q, p) => `Returned ${q} ${p}`,
    PURCHASE_RETURN: (q, p) => `Returned ${q} ${p}`,
    ADJUSTMENT: (q, p) => `Adjusted ${q} ${p}`,
    DAMAGE: (q, p) => `Damaged ${q} ${p}`,
    WASTAGE: (q, p) => `Wasted ${q} ${p}`,
    OPENING_STOCK: (q, p) => `Opening: ${q} ${p}`,
  };

  const description = movementDescriptions[movementType]?.(qty, product?.name || 'Unknown') || `${movementType}: ${qty}`;
  const refType = String(movement.reference_type || '-');
  const timestampStr = String(formatDateTime(String(movement.created_at)));

  return (
    <Modal isOpen={true} onClose={onClose} title="Movement Details" size="md">
      <div className="space-y-4">
        {/* Main Action */}
        <div className={`rounded-lg p-4 ${isIncrease ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <h3 className="font-bold text-slate-900 text-base">{description}</h3>
          <div className={`inline-block mt-2 rounded-full px-2 py-1 text-xs font-medium ${typeColors[movementType] || 'bg-gray-100'}`}>
            {movementType.replace('_', ' ')}
          </div>
        </div>

        {/* WHO, WHAT, WHEN Grid */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase">Who</p>
            <p className="text-sm font-bold text-slate-900 mt-1">{cashierName}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase">When</p>
            <p className="text-sm font-bold text-slate-900 mt-1">{new Date(String(movement.created_at)).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase">Qty</p>
            <p className={`text-sm font-bold mt-1 ${isIncrease ? 'text-green-600' : 'text-red-600'}`}>
              {isIncrease ? '+' : '-'}{qty}
            </p>
          </div>
        </div>

        {/* Reference */}
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
          <p className="text-xs font-semibold text-slate-600 uppercase mb-2">Reference: {refType}</p>
          <p className="font-mono text-sm text-slate-900 break-all">{String(movement.reference_id || '-')}</p>
        </div>

        {/* Details Row */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-slate-600">Product</p>
            <p className="font-medium text-slate-900">{product?.name || 'Unknown'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-600">Cost</p>
            <p className="font-medium text-slate-900">{String(formatCurrency(Number(movement.unit_cost || 0)))}</p>
          </div>
        </div>

        {/* Timestamp Footer */}
        <div className="text-xs text-slate-500 text-center pt-2 border-t">
          {timestampStr}
        </div>
      </div>
    </Modal>
  );
}
