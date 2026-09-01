import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, AlertTriangle, WifiOff } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Pagination } from '../../components/ui/Pagination';
import { formatCurrency } from '../../utils/helpers';
import { getAllCachedInventory, getAllCachedProducts, getAllCachedCategories } from '../../lib/offline/cache';
import { useNetworkStatus } from '../../hooks/useOfflineStatus';

export function StockPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'low'>('all');
  const PAGE_SIZE = 20;
  const networkStatus = useNetworkStatus();
  const isOnline = networkStatus.status === 'ONLINE';

  // Online: fetch from Supabase
  const { data: onlineData, isLoading: onlineLoading } = useQuery({
    queryKey: ['inventory-all'],
    refetchInterval: 10000,
    enabled: isOnline,
    queryFn: async () => {
      const { data: inv } = await supabase.from('inventory').select('*');
      if (!inv || inv.length === 0) return [];

      const productIds = inv.map((i) => i.product_id);
      const { data: products } = await supabase.from('products').select('id, name, sku, barcode, unit, purchase_price, selling_price, reorder_level, category_id, active').in('id', productIds);

      const catIds = (products || []).map((p) => p.category_id).filter(Boolean);
      const { data: cats } = await supabase.from('categories').select('id, name').in('id', catIds);

      const pMap = new Map((products || []).map((p) => [p.id, p]));
      const cMap = new Map((cats || []).map((c) => [c.id, c.name]));

      return inv.map((i) => {
        const p = pMap.get(i.product_id);
        return {
          ...i,
          products: p ? { ...p, categories: p.category_id ? { name: cMap.get(p.category_id) || '' } : null } : null,
          product_active: p?.active ?? true,
        };
      });
    },
  });

  // Offline: load from IndexedDB with periodic refresh
  const [offlineData, setOfflineData] = useState<any[]>([]);
  const [offlineLoading, setOfflineLoading] = useState(false);

  const loadOfflineData = useCallback(async () => {
    try {
      const [inventory, products, categories] = await Promise.all([
        getAllCachedInventory(),
        getAllCachedProducts(),
        getAllCachedCategories(),
      ]);

      const pMap = new Map(products.map((p) => [p.id, p]));
      const cMap = new Map(categories.map((c) => [c.id, c.name]));

      setOfflineData(
        inventory.map((inv) => {
          const p = pMap.get(inv.product_id);
          return {
            ...inv,
            products: p
              ? { ...p, categories: p.category_id ? { name: cMap.get(p.category_id) || '' } : null }
              : null,
            product_active: p?.active ?? true,
          };
        })
      );
    } catch (err) {
      console.error('[StockPage] Failed to load offline data:', err);
    }
  }, []);

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

  const allData = isOnline ? onlineData : offlineData;
  const isLoading = isOnline ? onlineLoading : offlineLoading;

  // Apply filters
  let filtered = allData || [];
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter((item) => {
      const p = item.products as Record<string, unknown> | null;
      return p && (
        (p.name as string)?.toLowerCase().includes(s) ||
        (p.sku as string)?.toLowerCase().includes(s) ||
        (p.barcode as string)?.includes(s)
      );
    });
  }
  if (filter === 'low') {
    filtered = filtered.filter((item) => {
      const p = item.products as Record<string, unknown> | null;
      return p && Number(item.quantity) <= Number(p.reorder_level || 0);
    });
  }

  const totalCount = filtered.length;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const pagedData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'product', header: 'Product', render: (row) => {
      const p = row.products as Record<string, unknown> | null;
      const cat = p?.categories as Record<string, unknown> | null;
      return (
        <div>
          <p className="font-medium text-gray-900">{(p?.name as string) || '-'}</p>
          <p className="text-xs text-gray-500">{(p?.sku as string) || ''} • {cat?.name as string || ''}</p>
        </div>
      );
    }},
    { key: 'quantity', header: 'Quantity', render: (row) => {
      const p = row.products as Record<string, unknown> | null;
      const qty = Number(row.quantity);
      const reorder = Number(p?.reorder_level || 0);
      const isLow = qty <= reorder;
      return (
        <span className={`font-bold ${isLow ? 'text-red-600' : 'text-green-600'}`}>
          {qty} {isLow && <AlertTriangle className="inline h-3 w-3" />}
        </span>
      );
    }},
    { key: 'average_cost', header: 'Avg Cost', render: (row) => formatCurrency(Number(row.average_cost)) },
    { key: 'stock_value', header: 'Stock Value', render: (row) => formatCurrency(Number(row.quantity) * Number(row.average_cost)) },
    { key: 'selling_price', header: 'Selling Price', render: (row) => {
      const p = row.products as Record<string, unknown> | null;
      return formatCurrency(Number(p?.selling_price || 0));
    }},
    { key: 'reorder_level', header: 'Reorder Level', render: (row) => {
      const p = row.products as Record<string, unknown> | null;
      return <span className="text-gray-500">{Number(p?.reorder_level || 0)}</span>;
    }},
  ];

  const totalValue = filtered.reduce((s: number, i: Record<string, unknown>) => s + Number(i.quantity) * Number(i.average_cost), 0);

  return (
    <div className="space-y-4">
      {!isOnline && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
          <WifiOff className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-medium text-amber-700">Offline Mode — Showing cached inventory (auto-refreshes)</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock</h1>
          <p className="text-sm text-gray-500">Total inventory value: <span className="font-semibold">{formatCurrency(totalValue)}</span></p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setFilter('all'); setPage(1); }} className={filter === 'all' ? 'btn-primary' : 'btn-secondary'}>All</button>
          <button onClick={() => { setFilter('low'); setPage(1); }} className={filter === 'low' ? 'btn-danger' : 'btn-secondary'}>
            <AlertTriangle className="mr-1 h-4 w-4" /> Low Stock
          </button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="input-field pl-10"
        />
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={pagedData.map((i) => i as unknown as Record<string, unknown>)} isLoading={isLoading} emptyMessage="No products found" />
        <div className="border-t px-4">
          <Pagination page={page} totalPages={totalPages || 1} onPageChange={setPage} totalItems={totalCount} pageSize={PAGE_SIZE} />
        </div>
      </div>
    </div>
  );
}
