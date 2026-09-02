import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, Package } from 'lucide-react';
import { fetchBatches } from '../../services/inventory';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { formatDate } from '../../utils/helpers';

export function BatchesPage() {
  const [filter, setFilter] = useState<'all' | 'expiring'>('all');

  const { data: rawData = [], isLoading } = useQuery<any[]>({
    queryKey: ['batches', filter],
    queryFn: () => fetchBatches({ expiringSoon: filter === 'expiring' }) as Promise<any[]>,
  });

  const batches = Array.isArray(rawData) ? rawData : (rawData as any)?.data || [];

  const getExpiryStatus = (expiryDate: string | null) => {
    if (!expiryDate) return { label: 'No Expiry', color: 'bg-gray-100 text-gray-600' };
    const now = new Date();
    const expiry = new Date(expiryDate);
    const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) return { label: 'Expired', color: 'bg-red-100 text-red-700' };
    if (daysUntil <= 7) return { label: `Expiring in ${daysUntil}d`, color: 'bg-red-100 text-red-700' };
    if (daysUntil <= 30) return { label: `Expiring in ${daysUntil}d`, color: 'bg-yellow-100 text-yellow-700' };
    return { label: `${daysUntil}d left`, color: 'bg-green-100 text-green-700' };
  };

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'product', header: 'Product', render: (row) => {
      const p = row.products as { name: string; sku: string; active?: boolean } | null;
      return (
        <span className="font-medium">
          {p?.name || '-'}
          {p?.active === false && <span className="ml-1 text-xs text-gray-400">(Removed)</span>}
        </span>
      );
    }},
    { key: 'batch_number', header: 'Batch #', render: (row) => <span className="text-gray-600">{(row.batch_number as string) || '-'}</span> },
    { key: 'purchase_cost', header: 'Cost', render: (row) => `Rs. ${Number(row.purchase_cost).toFixed(2)}` },
    { key: 'received_quantity', header: 'Received', render: (row) => Number(row.received_quantity) },
    { key: 'remaining_quantity', header: 'Remaining', render: (row) => {
      const remaining = Number(row.remaining_quantity);
      const total = Number(row.received_quantity);
      const pct = total > 0 ? (remaining / total) * 100 : 0;
      return (
        <div>
          <span className="font-medium">{remaining}</span>
          <div className="mt-1 h-1.5 w-20 rounded-full bg-gray-200">
            <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
    }},
    { key: 'expiry_date', header: 'Expiry', render: (row) => {
      const status = getExpiryStatus(row.expiry_date as string | null);
      return (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${status.color}`}>
          {status.label}
        </span>
      );
    }},
    { key: 'received_date', header: 'Received Date', render: (row) => formatDate(row.received_date as string) },
  ];

  const expiredCount = batches.filter((b: any) => {
    if (!b.expiry_date) return false;
    return new Date(b.expiry_date) < new Date();
  }).length;

  const expiringCount = batches.filter((b: any) => {
    if (!b.expiry_date) return false;
    const days = Math.ceil((new Date(b.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 30;
  }).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Batches & Expiry</h1>
          <div className="mt-1 flex gap-4 text-sm">
            <span className="text-gray-500">Total: {batches.length} batches</span>
            {expiredCount > 0 && <span className="text-red-600 font-medium">⚠ {expiredCount} expired</span>}
            {expiringCount > 0 && <span className="text-yellow-600 font-medium">⏰ {expiringCount} expiring soon</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setFilter('all')} className={filter === 'all' ? 'btn-primary' : 'btn-secondary'}>All</button>
          <button onClick={() => setFilter('expiring')} className={filter === 'expiring' ? 'btn-danger' : 'btn-secondary'}>
            <AlertTriangle className="mr-1 h-4 w-4" /> Expiring Soon
          </button>
        </div>
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={batches.map((i: any) => i as Record<string, unknown>)} isLoading={isLoading} emptyMessage="No batches found" />
      </div>
    </div>
  );
}
