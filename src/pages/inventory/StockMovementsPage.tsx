import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchStockMovements } from '../../services/inventory';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Pagination } from '../../components/ui/Pagination';
import { formatDateTime } from '../../utils/helpers';

export function StockMovementsPage() {
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['stock-movements', page, typeFilter],
    queryFn: () => fetchStockMovements({ page, movement_type: typeFilter || undefined }),
    refetchInterval: 10000,
  });

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
      const p = row.products as { name: string; sku: string } | null;
      return <span className="font-medium">{p?.name || '-'} <span className="text-xs text-gray-400">({p?.sku})</span></span>;
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Stock Movements</h1>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="select-field w-48">
          <option value="">All Types</option>
          {types.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={(data?.data || []).map((i) => i as unknown as Record<string, unknown>)} isLoading={isLoading} emptyMessage="No movements found" />
        <div className="border-t px-4">
          <Pagination page={page} totalPages={data?.totalPages || 1} onPageChange={setPage} totalItems={data?.count} pageSize={20} />
        </div>
      </div>
    </div>
  );
}
