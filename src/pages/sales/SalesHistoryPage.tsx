import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, Trash2, Clock } from 'lucide-react';
import { fetchSales, fetchSale, cancelSale, createSalesReturn } from '../../services/sales';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Pagination } from '../../components/ui/Pagination';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../lib/auth';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { getAllOfflineSales, OFFLINE_SALES_CHANGED_EVENT } from '../../lib/offline/offlineSales';
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

  // Keep the local ledger loaded in both modes. Unsynced records must remain
  // visible after connectivity returns, until the server confirms them.
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

  // Load offline sales immediately when page mounts
  useEffect(() => {
    loadOfflineSales();
  }, []);

  useEffect(() => {
    console.log('[SalesHistory] Online status changed:', isOnline);
    loadOfflineSales();
    
    // Poll every 500ms when offline to show pending sales immediately
    const interval = setInterval(loadOfflineSales, isOnline ? 5000 : 500);
    window.addEventListener(OFFLINE_SALES_CHANGED_EVENT, loadOfflineSales);

    if (isOnline) {
      // When coming back online, force refetch sales from Supabase to sync
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener(OFFLINE_SALES_CHANGED_EVENT, loadOfflineSales);
    };
  }, [isOnline, loadOfflineSales, queryClient]);

  const unsyncedLocalSales = offlineSales.filter(sale => sale.status !== 'synced');
  const onlineRows = onlineData?.data || [];
  const localRowsNotYetOnServer = offlineSales.filter(localSale =>
    localSale.status !== 'synced' || !onlineRows.some(onlineSale =>
      onlineSale.id === localSale.server_sale_id ||
      onlineSale.client_transaction_id === localSale.client_transaction_id
    )
  );
  // Add local records only on the first online page. They have no server row
  // yet, so this prevents them disappearing during the sync window. A just
  // synced row stays visible until its server copy has arrived in this list.
  const displayData = isOnline
    ? {
        ...onlineData,
        data: page === 1 ? [...localRowsNotYetOnServer, ...onlineRows] : onlineRows,
        count: (onlineData?.count || 0) + (page === 1 ? localRowsNotYetOnServer.length : 0),
      }
    : { data: offlineSales, totalPages: 1, count: offlineSales.length };
  const isLoading = isOnline ? onlineLoading && offlineLoading : offlineLoading;

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
    PARTIALLY_RETURNED: 'bg-orange-100 text-orange-700',
    pending_sync: 'bg-yellow-100 text-yellow-700',
    syncing: 'bg-blue-100 text-blue-700',
    synced: 'bg-emerald-100 text-emerald-700',
    sync_failed: 'bg-red-100 text-red-700',
    conflict: 'bg-red-100 text-red-700',
  };

  const getStatus = (row: Record<string, unknown>): string => {
    if (Number(row.returned_total || 0) > 0 && row.status === 'COMPLETED') return 'PARTIALLY_RETURNED';
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
        {'status' in row && ['pending_sync', 'syncing', 'sync_failed', 'conflict'].includes(row.status as string) && (
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
      // Online sales: prefer full_name, fall back to email prefix
      if ('profiles' in row) {
        const profile = row.profiles as { full_name?: string; email?: string } | null;
        if (profile?.full_name) return profile.full_name;
        if (profile?.email) return profile.email.split('@')[0];
        return 'System';
      }
      // Offline sales
      if ('customer_name' in row) return 'Local';
      return '-';
    }},
    { key: 'total', header: 'Net Total', render: (row) => {
      const returned = Number(row.returned_total || 0);
      const netTotal = returned > 0 ? Number(row.net_total ?? Number(row.total) - returned) : Number(row.total);
      return <div>
        <span className="font-bold text-slate-900">{formatCurrency(netTotal)}</span>
        {returned > 0 && <span className="block text-xs text-orange-600">Returned: -{formatCurrency(returned)}</span>}
      </div>;
    }},
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
      {isOnline && unsyncedLocalSales.length > 0 && (
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3">
          <p className="text-sm text-yellow-800 flex items-center gap-2">
            <Clock size={16} />
            {unsyncedLocalSales.length} local {unsyncedLocalSales.length === 1 ? 'sale is' : 'sales are'} waiting to sync
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

      {showDetail && <SaleDetail id={showDetail} onClose={() => setShowDetail(null)} isOffline={offlineSales.some(sale => sale.id === showDetail)} offlineSales={offlineSales} />}

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
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [returnReason, setReturnReason] = useState('CUSTOMER_REQUEST');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: sale } = useQuery({ queryKey: ['sale', id], queryFn: () => fetchSale(id), enabled: !isOffline });

  const returnMutation = useMutation({
    mutationFn: async () => {
      if (!sale) throw new Error('No sale found to return');
      return createSalesReturn({
        sale_id: sale.id,
        return_reason: returnReason,
        notes: '',
      });
    },
    onSuccess: () => {
      toast('success', 'Return created successfully');
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['sale', id] });
      queryClient.invalidateQueries({ queryKey: ['shift-sales'] }); // Refresh shift sales
      queryClient.invalidateQueries({ queryKey: ['current-shift'] }); // Refresh shift expected cash
      queryClient.invalidateQueries({ queryKey: ['inventory'] }); // Refresh inventory
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] }); // Refresh stock movements
      setShowReturnForm(false);
      onClose();
    },
    onError: (error: any) => {
      toast('error', error.message || 'Failed to create return');
    },
  });

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

  if (showReturnForm) {
    return (
      <Modal isOpen={true} onClose={() => setShowReturnForm(false)} title="Create Return" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Return Reason</label>
            <select
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="CUSTOMER_REQUEST">Customer Request</option>
              <option value="DEFECTIVE">Defective</option>
              <option value="DAMAGED">Damaged</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => returnMutation.mutate()}
              disabled={returnMutation.isPending}
              className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {returnMutation.isPending ? 'Processing...' : 'Create Return'}
            </button>
            <button
              onClick={() => setShowReturnForm(false)}
              className="flex-1 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={`Invoice: ${sale.invoice_number}`} size="lg">
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div><span className="text-slate-500">Customer:</span> {(sale.customers as Record<string, unknown>)?.name as string || 'Walk-in'}</div>
          <div><span className="text-slate-500">Cashier:</span> {(() => { const p = sale.profiles as { full_name?: string; email?: string } | null; return p?.full_name || (p?.email ? p.email.split('@')[0] : 'System'); })()}</div>
          <div><span className="text-slate-500">Date:</span> {formatDateTime(sale.sale_date)}</div>
          <div><span className="text-slate-500">Status:</span> {sale.status}</div>
        </div>
        <div><span className="text-slate-500">Total:</span> <span className="font-bold">{formatCurrency(Number(sale.total))}</span></div>
        {Number(sale.returned_total || 0) > 0 && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-orange-800">
            <div className="flex justify-between"><span>Returned</span><span className="font-semibold">-{formatCurrency(Number(sale.returned_total))}</span></div>
            <div className="mt-1 flex justify-between border-t border-orange-200 pt-1 font-bold"><span>Net sale</span><span>{formatCurrency(Math.max(0, Number(sale.total) - Number(sale.returned_total)))}</span></div>
          </div>
        )}
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
        {(sale.sales_returns || []).length > 0 && (
          <div>
            <h4 className="font-semibold mb-2">Returns</h4>
            {(sale.sales_returns || []).map((saleReturn: Record<string, unknown>) => (
              <div key={saleReturn.id as string} className="flex justify-between text-sm text-orange-700">
                <span>{saleReturn.return_number as string} · {saleReturn.reason as string}</span>
                <span className="font-medium">-{formatCurrency(Number(saleReturn.total))}</span>
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
        <div className="border-t border-slate-200 pt-3 flex gap-2">
          <button
            onClick={() => setShowReturnForm(true)}
            className="flex-1 px-3 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700"
          >
            Return Items
          </button>
        </div>
      </div>
    </Modal>
  );
}
