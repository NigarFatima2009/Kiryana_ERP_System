import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, Trash2, Clock } from 'lucide-react';
import { fetchSales, fetchSale, cancelSale } from '../../services/sales';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Pagination } from '../../components/ui/Pagination';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../lib/auth';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { getAllOfflineSales } from '../../lib/offline/offlineSales';
import { useNetworkStatus } from '../../hooks/useOfflineStatus';
import type { OfflineSale } from '../../lib/offline/types';

export function SalesHistoryPage() {
  const [page, setPage] = useState(1);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const networkStatus = useNetworkStatus();
  const isOnline = networkStatus.status === 'ONLINE';

  const canDelete = profile?.role === 'OWNER' || profile?.role === 'MANAGER';

  // Online: fetch from server (refetch when coming back online)
  const { data: onlineData, isLoading: onlineLoading } = useQuery({
    queryKey: ['sales', page, isOnline],  // Add isOnline to query key so it refetches when status changes
    queryFn: () => fetchSales({ page }),
    refetchInterval: 5000,
    enabled: isOnline,
    staleTime: 0,  // Always consider stale when going online
    refetchOnWindowFocus: true,  // Refetch when window regains focus
  });

  // Offline: fetch from IndexedDB
  const [offlineSales, setOfflineSales] = useState<OfflineSale[]>([]);
  const [offlineLoading, setOfflineLoading] = useState(false);

  const loadOfflineSales = useCallback(async () => {
    setOfflineLoading(true);
    try {
      console.log('[SalesHistory] Loading offline sales...');
      const sales = await getAllOfflineSales();
      console.log('[SalesHistory] Loaded', sales.length, 'offline sales');
      setOfflineSales(sales);
    } catch (error) {
      console.error('[SalesHistory] Failed to load offline sales:', error);
      setOfflineSales([]);
    } finally {
      setOfflineLoading(false);
    }
  }, []);

  useEffect(() => {
    console.log('[SalesHistory] Online status changed:', isOnline);
    if (!isOnline) {
      // Load immediately
      loadOfflineSales();
      
      // Then poll every 2 seconds to catch new sales
      const interval = setInterval(() => {
        console.log('[SalesHistory] Polling for new offline sales...');
        loadOfflineSales();
      }, 2000);
      
      return () => clearInterval(interval);
    } else {
      // When coming back online, force refetch sales from Supabase
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    }
  }, [isOnline, loadOfflineSales, queryClient]);

  // Combine online and offline sales for offline view
  const displayData = isOnline ? onlineData : { data: offlineSales, totalPages: 1, count: offlineSales.length };
  const isLoading = isOnline ? onlineLoading : offlineLoading;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => cancelSale(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['sales'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
        queryClient.refetchQueries({ queryKey: ['inventory'] }),
        queryClient.refetchQueries({ queryKey: ['inventory-all'] }),
      ]);
      toast('success', 'Sale cancelled');
      setDeleteId(null);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const statusColors: Record<string, string> = {
    COMPLETED: 'bg-emerald-100 text-emerald-700',
    HELD: 'bg-amber-100 text-amber-700',
    CANCELLED: 'bg-red-100 text-red-700',
    RETURNED: 'bg-orange-100 text-orange-700',
    pending_sync: 'bg-yellow-100 text-yellow-700',
    syncing: 'bg-blue-100 text-blue-700',
    synced: 'bg-emerald-100 text-emerald-700',
    sync_failed: 'bg-red-100 text-red-700',
    conflict: 'bg-red-100 text-red-700',
  };

  const getStatus = (row: Record<string, unknown>): string => {
    // Online sales have 'status' field
    if ('status' in row) return row.status as string;
    // Offline sales have 'status' field too
    if ('status' in row) return row.status as string;
    return 'UNKNOWN';
  };

  const formatOfflineSaleDate = (sale: OfflineSale): string => {
    return new Date(sale.created_at).toLocaleString();
  };

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'invoice_number', header: 'Invoice #', render: (row) => (
      <div className="flex items-center gap-2">
        <span className="font-semibold text-slate-900">{row.invoice_number as string}</span>
        {!isOnline && 'status' in row && ['pending_sync', 'syncing', 'sync_failed', 'conflict'].includes(row.status as string) && (
          <div title="Pending sync"><Clock size={14} className="text-yellow-600" /></div>
        )}
      </div>
    )},
    { key: 'customer', header: 'Customer', render: (row) => {
      if ('customers' in row) return (row.customers as { name: string } | null)?.name || 'Walk-in';
      if ('customer_name' in row) return (row.customer_name as string) || 'Walk-in';
      return 'Walk-in';
    }},
    { key: 'created_at', header: 'Date', render: (row) => {
      if ('sale_date' in row) return formatDateTime(row.sale_date as string);
      if ('created_at' in row) return formatOfflineSaleDate(row as unknown as OfflineSale);
      return '-';
    }},
    { key: 'cashier', header: 'Cashier', render: (row) => {
      // Online sales: check for profiles relationship
      if ('profiles' in row) {
        const profile = row.profiles as { email: string } | null;
        return profile?.email ? profile.email.split('@')[0] : 'System';
      }
      // Offline sales don't have cashier info
      if ('customer_name' in row) return 'Local';
      return '-';
    }},
    { key: 'total', header: 'Total', render: (row) => <span className="font-bold text-slate-900">{formatCurrency(Number(row.total))}</span> },
    { key: 'cogs', header: 'COGS', render: (row) => {
      if ('cogs' in row) return formatCurrency(Number(row.cogs));
      return '-';
    }},
    { key: 'status', header: 'Status', render: (row) => (
      <span className={`badge ${statusColors[getStatus(row)] || ''}`}>
        {getStatus(row)}
      </span>
    )},
    { key: 'actions', header: '', render: (row) => (
      <div className="flex items-center gap-1">
        <button onClick={(e) => { e.stopPropagation(); setShowDetail(row.id as string); }} className="rounded-lg p-1.5 hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
          <Eye size={16} />
        </button>
        {canDelete && getStatus(row) === 'COMPLETED' && (
          <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id as string); }} className="rounded-lg p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors">
            <Trash2 size={16} />
          </button>
        )}
      </div>
    )},
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-900">Sales History</h1>
      {!isOnline && (
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3">
          <p className="text-sm text-yellow-800 flex items-center gap-2">
            <Clock size={16} />
            Offline mode: Showing pending and synced sales from local cache
          </p>
        </div>
      )}
      <div className="card p-0">
        <DataTable columns={columns} data={(displayData?.data || []).map((s) => s as unknown as Record<string, unknown>)} isLoading={isLoading} emptyMessage="No sales found" />
        {isOnline && (
          <div className="border-t border-slate-100 px-4">
            <Pagination page={page} totalPages={displayData?.totalPages || 1} onPageChange={setPage} totalItems={displayData?.count} pageSize={20} />
          </div>
        )}
      </div>

      {showDetail && <SaleDetail id={showDetail} onClose={() => setShowDetail(null)} isOffline={!isOnline} offlineSales={offlineSales} />}

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Cancel Sale"
        message="Are you sure you want to cancel this sale? This will restore the inventory quantities."
        confirmLabel="Cancel Sale"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

function SaleDetail({ id, onClose, isOffline, offlineSales }: { id: string; onClose: () => void; isOffline?: boolean; offlineSales?: OfflineSale[] }) {
  const { data: sale } = useQuery({ queryKey: ['sale', id], queryFn: () => fetchSale(id), enabled: !isOffline });

  // For offline sales, find from local array
  if (isOffline && offlineSales) {
    const offlineSale = offlineSales.find(s => s.id === id);
    if (!offlineSale) {
      return <Modal isOpen={true} onClose={onClose} title="Sale Not Found"><p>Sale not found in local cache</p></Modal>;
    }
    return (
      <Modal isOpen={true} onClose={onClose} title={`Invoice: ${offlineSale.invoice_number}`} size="lg">
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div><span className="text-slate-500">Customer:</span> {offlineSale.customer_name || 'Walk-in'}</div>
            <div><span className="text-slate-500">Date:</span> {new Date(offlineSale.created_at).toLocaleString()}</div>
            <div><span className="text-slate-500">Status:</span> <span className="font-medium">{offlineSale.status}</span></div>
            <div><span className="text-slate-500">Total:</span> <span className="font-bold">{formatCurrency(offlineSale.total)}</span></div>
          </div>
          {offlineSale.payment_methods && offlineSale.payment_methods.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2">Payments</h4>
              {offlineSale.payment_methods.map((p, idx) => (
                <div key={idx} className="flex justify-between text-sm">
                  <span>{p.method}</span>
                  <span className="font-medium">{formatCurrency(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="border-t border-slate-200 pt-3 space-y-1">
            <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(offlineSale.total - offlineSale.tax)}</span></div>
            {offlineSale.discount > 0 && (
              <div className="flex justify-between"><span>Discount:</span><span className="text-red-600">-{formatCurrency(offlineSale.discount)}</span></div>
            )}
            {offlineSale.tax > 0 && (
              <div className="flex justify-between"><span>Tax:</span><span>{formatCurrency(offlineSale.tax)}</span></div>
            )}
            <div className="flex justify-between font-bold text-lg border-t border-slate-200 pt-2"><span>Total:</span><span>{formatCurrency(offlineSale.total)}</span></div>
          </div>
          {offlineSale.status === 'sync_failed' && offlineSale.last_sync_error && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-xs">
              <p className="font-medium">Sync Error:</p>
              <p>{offlineSale.last_sync_error}</p>
            </div>
          )}
          {offlineSale.status === 'conflict' && offlineSale.last_sync_error && (
            <div className="bg-orange-50 border border-orange-200 rounded p-3 text-orange-700 text-xs">
              <p className="font-medium">Conflict:</p>
              <p>{offlineSale.last_sync_error}</p>
            </div>
          )}
        </div>
      </Modal>
    );
  }

  if (!sale) return <Modal isOpen={true} onClose={onClose} title="Loading..."><p>Loading...</p></Modal>;

  return (
    <Modal isOpen={true} onClose={onClose} title={`Invoice: ${sale.invoice_number}`} size="lg">
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div><span className="text-slate-500">Customer:</span> {(sale.customers as Record<string, unknown>)?.name as string || 'Walk-in'}</div>
          <div><span className="text-slate-500">Cashier:</span> {(sale.profiles as Record<string, unknown>)?.email ? (sale.profiles as Record<string, unknown>).email as string : 'System'}</div>
          <div><span className="text-slate-500">Date:</span> {formatDateTime(sale.sale_date)}</div>
          <div><span className="text-slate-500">Status:</span> {sale.status}</div>
        </div>
        <div><span className="text-slate-500">Total:</span> <span className="font-bold">{formatCurrency(Number(sale.total))}</span></div>
        <table className="min-w-full text-sm">
          <thead><tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
            <th className="py-2">Product</th><th className="py-2">Qty</th><th className="py-2">Price</th><th className="py-2">Total</th><th className="py-2">COGS</th>
          </tr></thead>
          <tbody>
            {(sale.sale_items || []).map((item: Record<string, unknown>) => (
              <tr key={item.id as string} className="border-b border-slate-100">
                <td className="py-2 font-medium">{(item.products as Record<string, unknown>)?.name as string}</td>
                <td className="py-2">{Number(item.quantity)}</td>
                <td className="py-2">{formatCurrency(Number(item.unit_price))}</td>
                <td className="py-2 font-semibold">{formatCurrency(Number(item.line_total))}</td>
                <td className="py-2 text-slate-500">{formatCurrency(Number(item.cogs))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(sale.sale_payments || []).length > 0 && (
          <div>
            <h4 className="font-semibold mb-2">Payments</h4>
            {(sale.sale_payments || []).map((p: Record<string, unknown>) => (
              <div key={p.id as string} className="flex justify-between text-sm">
                <span>{p.payment_method as string}</span>
                <span className="font-medium">{formatCurrency(Number(p.amount))}</span>
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-slate-200 pt-3 space-y-1">
          <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(Number(sale.subtotal))}</span></div>
          <div className="flex justify-between"><span>Discount:</span><span className="text-red-600">-{formatCurrency(Number(sale.discount))}</span></div>
          <div className="flex justify-between"><span>Tax:</span><span>{formatCurrency(Number(sale.tax))}</span></div>
          <div className="flex justify-between font-bold text-lg border-t border-slate-200 pt-2"><span>Total:</span><span>{formatCurrency(Number(sale.total))}</span></div>
          <div className="flex justify-between text-emerald-600"><span>COGS:</span><span>{formatCurrency(Number(sale.cogs))}</span></div>
          <div className="flex justify-between font-bold text-emerald-700"><span>Profit:</span><span>{formatCurrency(Number(sale.total) - Number(sale.cogs))}</span></div>
        </div>
      </div>
    </Modal>
  );
}
