import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, Trash2, Clock, Banknote, ArrowUpRight, CheckCircle, XCircle, Building2, Calendar, AlertTriangle, Send } from 'lucide-react';
import { fetchSales, fetchSale, cancelSale, createSalesReturn } from '../../services/sales';
import { fetchCheques, updateChequeStatus, getChequeMaturityInfo, type Cheque } from '../../services/cheques';
import { notifyOwnerChequeClearanceRequest } from '../../services/notifications';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Pagination } from '../../components/ui/Pagination';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ExportButtons } from '../../components/ui/ExportButtons';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../lib/auth';
import { formatCurrency, formatDateTime, formatDate } from '../../utils/helpers';
import { getAllOfflineSales, OFFLINE_SALES_CHANGED_EVENT } from '../../lib/offline/offlineSales';
import { useNetworkStatus } from '../../hooks/useOfflineStatus';
import type { OfflineSale } from '../../lib/offline/types';

export function SalesHistoryPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const networkStatus = useNetworkStatus();
  const isOnline = networkStatus.status === 'ONLINE';

  const isOwnerOrManager = profile?.role === 'OWNER' || profile?.role === 'MANAGER';
  const canDelete = isOwnerOrManager;

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

  const notifyOwnerMutation = useMutation({
    mutationFn: async ({ row, linkedCheque }: { row: Record<string, unknown>; linkedCheque?: Cheque }) => {
      const invoiceNumber = (row.invoice_number as string) || '';
      let customerName = 'Walk-in';
      if ('customers' in row && (row.customers as any)?.name) customerName = (row.customers as any).name;
      else if ('customer_name' in row && row.customer_name) customerName = row.customer_name as string;

      const amount = Number(linkedCheque?.amount || row.net_total || row.total || 0);

      await notifyOwnerChequeClearanceRequest({
        invoiceNumber,
        customerName: linkedCheque?.party_name || customerName,
        amount,
        chequeNumber: linkedCheque?.cheque_number,
        bankName: linkedCheque?.bank_name,
        dueDate: linkedCheque?.due_date,
        chequeId: linkedCheque?.id,
        cashierName: profile?.full_name || 'Cashier',
      });
    },
    onSuccess: (_, vars) => {
      const num = vars.linkedCheque?.cheque_number || (vars.row.invoice_number as string);
      toast('success', `✓ Sent Cheque ${num} to Store Owner for clearance!`);
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
    if (Number(row.returned_total || 0) > 0 && row.status === 'COMPLETED') return 'RETURNED';
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
      if ('customers' in row && (row.customers as { name: string } | null)?.name) {
        return (row.customers as { name: string }).name;
      }
      if ('customer_name' in row && row.customer_name) {
        return row.customer_name as string;
      }
      if (typeof row.notes === 'string') {
        const match = row.notes.match(/(?:Customer|Party):\s*([^,()]+)/i);
        if (match && match[1]) return match[1].trim();
      }
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
    { key: 'status', header: 'Status', render: (row) => {
      const chequePayment = (row as any).sale_payments?.find((p: any) => p.payment_method === 'CHEQUE')
        || (row as any).payment_methods?.find((p: any) => p.method === 'CHEQUE');
      const hasCheque =
        Boolean((row as any).cheque) ||
        Boolean(chequePayment) ||
        (typeof row.notes === 'string' && row.notes.includes('Cheque'));

      const linkedCheque: Cheque | undefined = (row as any).cheque;
      const chequeStatus = linkedCheque?.status;
      const chequeNum = linkedCheque?.cheque_number;
      const chequeAmt = linkedCheque ? formatCurrency(Number(linkedCheque.amount)) : '';

      if (hasCheque && getStatus(row) !== 'CANCELLED' && getStatus(row) !== 'RETURNED') {
        if (chequeStatus === 'CLEARED') {
          return (
            <div className="flex flex-col items-start gap-0.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                <CheckCircle size={11} /> Cheque Cleared
              </span>
              {chequeNum && <span className="text-[10px] text-gray-400 font-mono">{chequeNum}</span>}
            </div>
          );
        }
        if (chequeStatus === 'BOUNCED') {
          return (
            <div className="flex flex-col items-start gap-0.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">
                <XCircle size={11} /> Cheque Bounced
              </span>
              {chequeNum && <span className="text-[10px] text-gray-400 font-mono">{chequeNum}</span>}
              {isOwnerOrManager && (
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(linkedCheque ? `/cheques?id=${linkedCheque.id}` : '/cheques'); }}
                  className="text-[11px] text-red-600 hover:text-red-800 flex items-center gap-0.5 font-medium underline"
                >
                  Action Required <ArrowUpRight size={11} />
                </button>
              )}
            </div>
          );
        }
        // PENDING (or unknown)
        return (
          <div className="flex flex-col items-start gap-0.5">
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 animate-pulse">
              <Banknote size={11} /> Cheque Pending
            </span>
            {chequeNum && (
              <span className="text-[10px] text-gray-500 font-mono">{chequeNum}{chequeAmt ? ` · ${chequeAmt}` : ''}</span>
            )}
            {isOwnerOrManager ? (
              <button
                onClick={(e) => { e.stopPropagation(); navigate(linkedCheque ? `/cheques?id=${linkedCheque.id}` : '/cheques'); }}
                className="text-[11px] text-blue-600 hover:text-blue-800 flex items-center gap-0.5 font-medium underline"
              >
                Clear / Bounce <ArrowUpRight size={11} />
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  notifyOwnerMutation.mutate({ row, linkedCheque });
                }}
                disabled={notifyOwnerMutation.isPending}
                title="Send cheque details to Store Owner so they can clear it"
                className="text-[11px] text-amber-900 hover:text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-0.5 rounded flex items-center gap-1 font-semibold transition-colors mt-0.5"
              >
                <Send size={10} />
                {notifyOwnerMutation.isPending ? 'Sending...' : 'Send to Owner'}
              </button>
            )}
          </div>
        );
      }

      return (
        <span className={`badge ${statusColors[getStatus(row)] || ''}`}>
          {getStatus(row)}
        </span>
      );
    }},
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
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3 flex items-center justify-between">
          <p className="text-sm text-yellow-800 flex items-center gap-2">
            <Clock size={16} />
            {unsyncedLocalSales.length} local {unsyncedLocalSales.length === 1 ? 'sale is' : 'sales are'} waiting to sync
          </p>
          <button
            onClick={async () => {
              toast('info', 'Syncing offline sales...');
              const { performOfflineSync } = await import('../../lib/offline/sync');
              const res = await performOfflineSync();
              await queryClient.invalidateQueries({ queryKey: ['sales'] });
              loadOfflineSales();
              if (res.success) toast('success', `Synced ${res.synced} sales successfully!`);
              else toast('error', `Sync finished: ${res.synced} synced, ${res.failed} failed`);
            }}
            className="btn-primary text-xs py-1 px-3"
          >
            Sync Now
          </button>
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
  const [refundMethod, setRefundMethod] = useState('CASH');
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [selectedItemIds, setSelectedItemIds] = useState<Record<string, boolean>>({});

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { profile } = useAuth();
  const isOwnerOrManager = profile?.role === 'OWNER' || profile?.role === 'MANAGER';

  const { data: sale } = useQuery({ queryKey: ['sale', id], queryFn: () => fetchSale(id), enabled: !isOffline });

  // Initialize return quantities when opening return form
  const openReturnModal = () => {
    if (!sale?.sale_items) return;
    const initialQtys: Record<string, number> = {};
    const initialSelected: Record<string, boolean> = {};

    sale.sale_items.forEach((item: any) => {
      initialQtys[item.id] = Number(item.quantity);
      initialSelected[item.id] = false; // User must explicitly select items to return
    });

    setReturnQuantities(initialQtys);
    setSelectedItemIds(initialSelected);
    setShowReturnForm(true);
  };

  const handleQtyChange = (itemId: string, maxQty: number, delta: number) => {
    setReturnQuantities((prev) => {
      const current = prev[itemId] || 0;
      const next = Math.max(1, Math.min(maxQty, current + delta));
      return { ...prev, [itemId]: next };
    });
  };

  const toggleItemSelection = (itemId: string) => {
    setSelectedItemIds((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  };

  // Calculate live refund total
  const calculateTotalRefund = () => {
    if (!sale?.sale_items) return 0;
    return sale.sale_items.reduce((sum: number, item: any) => {
      if (!selectedItemIds[item.id]) return sum;
      const qty = returnQuantities[item.id] || 0;
      const unitPrice = Number(item.unit_price) || (Number(item.line_total) / Number(item.quantity));
      return sum + unitPrice * qty;
    }, 0);
  };

  const processReturnMutation = useMutation({
    mutationFn: async () => {
      if (!sale) throw new Error('No sale found to return');
      
      const itemsToReturn = (sale.sale_items || [])
        .filter((item: any) => selectedItemIds[item.id] && (returnQuantities[item.id] || 0) > 0)
        .map((item: any) => ({
          sale_item_id: item.id,
          quantity: returnQuantities[item.id] || 1,
          amount: (Number(item.unit_price) || (Number(item.line_total) / Number(item.quantity))) * (returnQuantities[item.id] || 1),
        }));

      if (itemsToReturn.length === 0) {
        throw new Error('Please select at least one item to return');
      }

      const { processSaleReturn } = await import('../../services/sales');
      return processSaleReturn({
        sale_id: sale.id,
        customer_id: sale.customer_id || undefined,
        reason: returnReason,
        refund_method: refundMethod,
        items: itemsToReturn,
      });
    },
    onSuccess: (result) => {
      toast('success', `Return ${result.return_number} processed: ${formatCurrency(result.total)}`);
      // Invalidate all relevant queries so data updates in real time
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['sale', id] });
      queryClient.invalidateQueries({ queryKey: ['shift-sales'] });
      queryClient.invalidateQueries({ queryKey: ['current-shift'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-all'] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-all'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setShowReturnForm(false);
      // Don't close modal — let user see updated sale with return info
    },
    onError: (error: any) => {
      toast('error', error.message || 'Failed to process return');
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
        </div>
      </Modal>
    );
  }

  if (!sale) return <Modal isOpen={true} onClose={onClose} title="Loading..."><p>Loading...</p></Modal>;

  if (showReturnForm) {
    const totalRefund = calculateTotalRefund();
    const selectedCount = Object.values(selectedItemIds).filter(Boolean).length;

    return (
      <Modal isOpen={true} onClose={() => setShowReturnForm(false)} title={`Return Items — ${sale.invoice_number}`} size="lg">
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
            Select the specific items and choose the quantities you want to return to stock.
          </div>

          <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
            <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 grid grid-cols-12 gap-2 uppercase">
              <div className="col-span-1 text-center">Select</div>
              <div className="col-span-5">Product</div>
              <div className="col-span-3 text-center">Return Qty</div>
              <div className="col-span-3 text-right">Refund Amount</div>
            </div>

            {(sale.sale_items || []).map((item: any) => {
              const isSelected = !!selectedItemIds[item.id];
              const returnQty = returnQuantities[item.id] || 1;
              const maxQty = Number(item.quantity);
              const unitPrice = Number(item.unit_price) || (Number(item.line_total) / Number(item.quantity));
              const lineRefund = unitPrice * returnQty;

              return (
                <div key={item.id} className={`px-3 py-2.5 grid grid-cols-12 gap-2 items-center text-sm ${isSelected ? 'bg-white' : 'bg-slate-50/50 opacity-60'}`}>
                  <div className="col-span-1 text-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleItemSelection(item.id)}
                      className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                    />
                  </div>
                  <div className="col-span-5">
                    <p className="font-semibold text-slate-900">{item.products?.name || 'Product'}</p>
                    <p className="text-xs text-slate-500">Sold: {maxQty} units @ {formatCurrency(unitPrice)}</p>
                  </div>
                  <div className="col-span-3 flex items-center justify-center gap-1.5">
                    <button
                      type="button"
                      disabled={!isSelected || returnQty <= 1}
                      onClick={() => handleQtyChange(item.id, maxQty, -1)}
                      className="w-7 h-7 rounded border border-slate-300 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-bold text-sm">{returnQty}</span>
                    <button
                      type="button"
                      disabled={!isSelected || returnQty >= maxQty}
                      onClick={() => handleQtyChange(item.id, maxQty, 1)}
                      className="w-7 h-7 rounded border border-slate-300 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                  <div className="col-span-3 text-right font-bold text-red-600">
                    {isSelected ? `-${formatCurrency(lineRefund)}` : '—'}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Return Reason</label>
              <select
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                className="select-field text-xs py-2"
              >
                <option value="CUSTOMER_REQUEST">Customer Request</option>
                <option value="DEFECTIVE">Defective / Damaged</option>
                <option value="EXPIRED">Expired / Quality Issue</option>
                <option value="WRONG_ITEM">Wrong Item Purchased</option>
                <option value="OTHER">Other Reason</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Refund Method</label>
              <select
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value)}
                className="select-field text-xs py-2"
              >
                <option value="CASH">Cash Refund</option>
                <option value="CUSTOMER_CREDIT">Customer Khata (Credit)</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
              </select>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-500">Selected for Return</p>
              <p className="font-bold text-slate-800">{selectedCount} item(s)</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">Total Refund & Stock Return</p>
              <p className="text-lg font-bold text-red-600">-{formatCurrency(totalRefund)}</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowReturnForm(false)}
              className="flex-1 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={() => processReturnMutation.mutate()}
              disabled={selectedCount === 0 || totalRefund <= 0 || processReturnMutation.isPending}
              className="flex-1 px-3 py-2 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700 disabled:opacity-50"
            >
              {processReturnMutation.isPending ? 'Processing Return...' : `Confirm Return (${formatCurrency(totalRefund)})`}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Fetch any cheque linked to this sale (by reference_sale_id OR invoice in notes) ──
  const { data: allCheques = [] } = useQuery({
    queryKey: ['cheques-for-sale', sale.id],
    queryFn: () => fetchCheques(),
    staleTime: 15000,
  });
  const linkedCheque: Cheque | undefined = allCheques.find(
    (c) =>
      c.reference_sale_id === sale.id ||
      (c.notes && c.notes.includes(sale.invoice_number))
  );

  const clearMutation = useMutation({
    mutationFn: () => updateChequeStatus(linkedCheque!.id, 'CLEARED'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cheques'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-summary'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-for-sale', sale.id] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      toast('success', `✓ Cheque ${linkedCheque?.cheque_number} marked as Cleared.`);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const bounceMutation = useMutation({
    mutationFn: () => updateChequeStatus(linkedCheque!.id, 'BOUNCED'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cheques'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-summary'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-for-sale', sale.id] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      toast('error', `✕ Cheque ${linkedCheque?.cheque_number} marked as Bounced.`);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const notifyOwnerSaleMutation = useMutation({
    mutationFn: async () => {
      const invoiceNumber = sale.invoice_number;
      const customerName = (sale.customers as any)?.name || 'Walk-in Customer';
      const amount = Number(linkedCheque?.amount || sale.total || 0);

      await notifyOwnerChequeClearanceRequest({
        invoiceNumber,
        customerName: linkedCheque?.party_name || customerName,
        amount,
        chequeNumber: linkedCheque?.cheque_number,
        bankName: linkedCheque?.bank_name,
        dueDate: linkedCheque?.due_date,
        chequeId: linkedCheque?.id,
        cashierName: profile?.full_name || 'Cashier',
      });
    },
    onSuccess: () => {
      toast('success', `✓ Cheque details for Invoice #${sale.invoice_number} sent to Store Owner to clear.`);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <Modal isOpen={true} onClose={onClose} title={`Invoice: ${sale.invoice_number}`} size="lg">
      <div className="space-y-4 text-sm">
        {/* Top meta & Action Export Buttons */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 pb-3 border-b border-slate-100">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div><span className="text-slate-500">Customer:</span> <span className="font-semibold text-slate-800">{(sale.customers as Record<string, unknown>)?.name as string || 'Walk-in'}</span></div>
            <div><span className="text-slate-500">Cashier:</span> <span className="font-semibold text-slate-800">{(() => { const p = sale.profiles as { full_name?: string; email?: string } | null; return p?.full_name || (p?.email ? p.email.split('@')[0] : 'System'); })()}</span></div>
            <div><span className="text-slate-500">Date:</span> <span className="font-semibold text-slate-800">{formatDateTime(sale.sale_date)}</span></div>
            <div><span className="text-slate-500">Status:</span> <span className="font-bold text-blue-600">{sale.status}</span></div>
          </div>
        </div>

        {/* ── Cheque Section ── */}
        {linkedCheque && (() => {
          const maturity = getChequeMaturityInfo(linkedCheque.due_date, linkedCheque.status);
          const isBusy = clearMutation.isPending || bounceMutation.isPending;
          const canAct = linkedCheque.status === 'PENDING';
          return (
            <div className={`rounded-xl border-2 p-4 space-y-3 ${
              linkedCheque.status === 'CLEARED' ? 'border-emerald-200 bg-emerald-50/60' :
              linkedCheque.status === 'BOUNCED'  ? 'border-red-200 bg-red-50/60' :
              'border-amber-300 bg-amber-50/60'
            }`}>
              {/* Header */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Banknote size={16} className="text-blue-600 shrink-0" />
                  <span className="font-bold text-gray-900 text-sm">Cheque Payment</span>
                  <span className="font-mono text-xs font-bold text-blue-700">{linkedCheque.cheque_number}</span>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${maturity.badgeClass}`}>
                  {maturity.label}
                </span>
              </div>

              {/* Detail grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <Building2 size={12} className="text-gray-400 shrink-0" />
                  <span className="text-gray-500">Party:</span>
                  <span className="font-semibold text-gray-800 truncate">{linkedCheque.party_name}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Banknote size={12} className="text-gray-400 shrink-0" />
                  <span className="text-gray-500">Amount:</span>
                  <span className="font-bold text-gray-900">{formatCurrency(Number(linkedCheque.amount))}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Building2 size={12} className="text-gray-400 shrink-0" />
                  <span className="text-gray-500">Bank:</span>
                  <span className="font-semibold text-gray-800">{linkedCheque.bank_name}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Calendar size={12} className="text-gray-400 shrink-0" />
                  <span className="text-gray-500">Issue Date:</span>
                  <span className="font-semibold text-gray-800">{formatDate(linkedCheque.issue_date)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Calendar size={12} className="text-gray-400 shrink-0" />
                  <span className="text-gray-500">Due Date:</span>
                  <span className="font-semibold text-gray-800">{formatDate(linkedCheque.due_date)}</span>
                </div>
                {linkedCheque.drawer_title && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Drawer:</span>
                    <span className="font-semibold text-gray-800">{linkedCheque.drawer_title}</span>
                  </div>
                )}
                {linkedCheque.account_number && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Account #:</span>
                    <span className="font-semibold text-gray-800">{linkedCheque.account_number}</span>
                  </div>
                )}
                {linkedCheque.cleared_at && (
                  <div className="col-span-2 flex items-center gap-1.5 text-emerald-700">
                    <CheckCircle size={12} />
                    <span className="font-semibold">Cleared on {formatDate(linkedCheque.cleared_at)}</span>
                  </div>
                )}
                {linkedCheque.notes && (
                  <div className="col-span-2 text-gray-400 italic text-[11px] truncate">📝 {linkedCheque.notes}</div>
                )}
              </div>

              {/* Bounced warning */}
              {linkedCheque.status === 'BOUNCED' && (
                <div className="flex items-center gap-2 rounded-lg bg-red-100 border border-red-200 px-3 py-2 text-xs text-red-800 font-semibold">
                  <AlertTriangle size={13} />
                  This cheque has bounced. Please follow up with the customer immediately.
                </div>
              )}

              {/* Action buttons — for owner/manager: Clear / Bounce */}
              {canAct && isOwnerOrManager && (
                <div className="flex items-center gap-2 pt-1">
                  <button
                    disabled={isBusy}
                    onClick={() => clearMutation.mutate()}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold py-2 transition-colors"
                  >
                    <CheckCircle size={13} />
                    {clearMutation.isPending ? 'Clearing…' : 'Mark as Cleared'}
                  </button>
                  <button
                    disabled={isBusy}
                    onClick={() => bounceMutation.mutate()}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold py-2 transition-colors"
                  >
                    <XCircle size={13} />
                    {bounceMutation.isPending ? 'Saving…' : 'Mark as Bounced'}
                  </button>
                </div>
              )}

              {/* Action button — for cashier: send to owner */}
              {canAct && !isOwnerOrManager && (
                <div className="pt-1">
                  <button
                    disabled={notifyOwnerSaleMutation.isPending}
                    onClick={() => notifyOwnerSaleMutation.mutate()}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold py-2 transition-colors shadow-sm"
                  >
                    <Send size={13} />
                    {notifyOwnerSaleMutation.isPending ? 'Sending to Owner...' : 'Send Cheque to Store Owner for Clearance'}
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* Action Export Buttons */}
        <div className="flex flex-wrap gap-2 justify-end">
          <ExportButtons
            variant="secondary"
            filename={`invoice-${sale.invoice_number}`}
            title={`Invoice ${sale.invoice_number}`}
            invoiceData={{
              invoiceNumber: sale.invoice_number,
              date: sale.sale_date,
              customer: (sale.customers as Record<string, unknown>)?.name as string || 'Walk-in',
              items: (sale.sale_items || []).map((i: any) => ({
                description: i.products?.name || 'Product',
                quantity: Number(i.quantity),
                unitPrice: Number(i.unit_price),
                amount: Number(i.line_total),
              })),
              subtotal: Number(sale.subtotal),
              tax: Number(sale.tax),
              total: Number(sale.total),
              payments: (sale.sale_payments || []).map((p: any) => ({
                method: p.payment_method.replace('CUSTOMER_CREDIT', 'Khata / Credit'),
                amount: Number(p.amount),
              })),
              notes: sale.status === 'CANCELLED' ? 'This invoice has been cancelled' : undefined,
            }}
          />
        </div>

        <div>
          <span className="text-slate-500">Total:</span> <span className="font-bold text-lg text-slate-900 ml-1">{formatCurrency(Number(sale.total))}</span>
        </div>

        {Number(sale.returned_total || 0) > 0 && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-orange-800">
            <div className="flex justify-between"><span>Returned</span><span className="font-semibold">-{formatCurrency(Number(sale.returned_total))}</span></div>
            <div className="mt-1 flex justify-between border-t border-orange-200 pt-1 font-bold"><span>Net sale</span><span>{formatCurrency(Math.max(0, Number(sale.total) - Number(sale.returned_total)))}</span></div>
          </div>
        )}

        {/* Product Line Items */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-600 uppercase">
                <th className="py-2.5 px-3">Product</th>
                <th className="py-2.5 px-3 text-center">Qty</th>
                <th className="py-2.5 px-3 text-right">Price</th>
                <th className="py-2.5 px-3 text-right">Total</th>
                <th className="py-2.5 px-3 text-right text-slate-500">COGS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(sale.sale_items || []).map((item: Record<string, unknown>) => (
                <tr key={item.id as string} className="hover:bg-slate-50">
                  <td className="py-2.5 px-3 font-semibold text-slate-800">{(item.products as Record<string, unknown>)?.name as string || 'Product'}</td>
                  <td className="py-2.5 px-3 text-center font-bold">{Number(item.quantity)}</td>
                  <td className="py-2.5 px-3 text-right">{formatCurrency(Number(item.unit_price))}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-slate-900">{formatCurrency(Number(item.line_total))}</td>
                  <td className="py-2.5 px-3 text-right text-slate-500">{formatCurrency(Number(item.cogs))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Payments Breakdown */}
        {(sale.sale_payments || []).length > 0 && (
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <h4 className="font-bold text-xs uppercase text-slate-600 mb-1.5">Payments Breakdown</h4>
            {(sale.sale_payments || []).map((p: Record<string, unknown>) => (
              <div key={p.id as string} className="flex justify-between text-xs py-0.5">
                <span className="font-medium text-slate-700">{(p.payment_method as string).replace('CUSTOMER_CREDIT', 'Khata / Credit')}</span>
                <span className="font-bold text-slate-900">{formatCurrency(Number(p.amount))}</span>
              </div>
            ))}
          </div>
        )}

        {/* Returns history */}
        {(sale.sales_returns || []).length > 0 && (
          <div>
            <h4 className="font-semibold mb-2">Returns History</h4>
            {(sale.sales_returns || []).map((saleReturn: Record<string, unknown>) => (
              <div key={saleReturn.id as string} className="flex justify-between text-sm text-orange-700 bg-orange-50 px-2 py-1 rounded mb-1">
                <span>{saleReturn.return_number as string} · {saleReturn.reason as string}</span>
                <span className="font-medium">-{formatCurrency(Number(saleReturn.total))}</span>
              </div>
            ))}
          </div>
        )}

        {/* Financial Summary */}
        <div className="border-t border-slate-200 pt-3 space-y-1 text-sm">
          <div className="flex justify-between text-slate-600"><span>Subtotal:</span><span>{formatCurrency(Number(sale.subtotal))}</span></div>
          {Number(sale.discount) > 0 && (
            <div className="flex justify-between text-red-600"><span>Discount:</span><span>-{formatCurrency(Number(sale.discount))}</span></div>
          )}
          {Number(sale.tax) > 0 && (
            <div className="flex justify-between text-slate-600"><span>Tax:</span><span>{formatCurrency(Number(sale.tax))}</span></div>
          )}
          <div className="flex justify-between font-bold text-base border-t border-slate-200 pt-2 text-slate-900">
            <span>Total:</span><span>{formatCurrency(Number(sale.total))}</span>
          </div>
          <div className="flex justify-between text-xs text-emerald-600 pt-1"><span>COGS:</span><span>{formatCurrency(Number(sale.cogs))}</span></div>
          <div className="flex justify-between text-xs font-bold text-emerald-700"><span>Profit:</span><span>{formatCurrency(Number(sale.total) - Number(sale.cogs))}</span></div>
        </div>

        {/* Action Button: Itemized Return — only if no return has been processed yet */}
        {sale.status !== 'CANCELLED' && (!sale.sales_returns || sale.sales_returns.length === 0) && (
          <div className="border-t border-slate-200 pt-3 flex gap-2">
            <button
              onClick={openReturnModal}
              className="flex-1 px-3 py-2 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700 transition flex items-center justify-center gap-1.5"
            >
              <span>↩ Return Specific Items & Stock</span>
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
