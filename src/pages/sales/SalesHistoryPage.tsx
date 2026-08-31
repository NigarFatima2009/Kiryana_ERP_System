import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, Trash2 } from 'lucide-react';
import { fetchSales, fetchSale, cancelSale } from '../../services/sales';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Pagination } from '../../components/ui/Pagination';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../lib/auth';
import { formatCurrency, formatDateTime } from '../../utils/helpers';

export function SalesHistoryPage() {
  const [page, setPage] = useState(1);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canDelete = profile?.role === 'OWNER' || profile?.role === 'MANAGER';

  const { data, isLoading } = useQuery({
    queryKey: ['sales', page],
    queryFn: () => fetchSales({ page }),
    refetchInterval: 5000,
  });

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
  };

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'invoice_number', header: 'Invoice #', render: (row) => <span className="font-semibold text-slate-900">{row.invoice_number as string}</span> },
    { key: 'customer', header: 'Customer', render: (row) => (row.customers as { name: string } | null)?.name || 'Walk-in' },
    { key: 'sale_date', header: 'Date', render: (row) => formatDateTime(row.sale_date as string) },
    { key: 'total', header: 'Total', render: (row) => <span className="font-bold text-slate-900">{formatCurrency(Number(row.total))}</span> },
    { key: 'cogs', header: 'COGS', render: (row) => formatCurrency(Number(row.cogs)) },
    { key: 'status', header: 'Status', render: (row) => (
      <span className={`badge ${statusColors[row.status as string] || ''}`}>
        {row.status as string}
      </span>
    )},
    { key: 'actions', header: '', render: (row) => (
      <div className="flex items-center gap-1">
        <button onClick={(e) => { e.stopPropagation(); setShowDetail(row.id as string); }} className="rounded-lg p-1.5 hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
          <Eye size={16} />
        </button>
        {canDelete && row.status === 'COMPLETED' && (
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
      <div className="card p-0">
        <DataTable columns={columns} data={(data?.data || []).map((s) => s as unknown as Record<string, unknown>)} isLoading={isLoading} emptyMessage="No sales found" />
        <div className="border-t border-slate-100 px-4">
          <Pagination page={page} totalPages={data?.totalPages || 1} onPageChange={setPage} totalItems={data?.count} pageSize={20} />
        </div>
      </div>

      {showDetail && <SaleDetail id={showDetail} onClose={() => setShowDetail(null)} />}

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

function SaleDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: sale } = useQuery({ queryKey: ['sale', id], queryFn: () => fetchSale(id) });
  if (!sale) return <Modal isOpen={true} onClose={onClose} title="Loading..."><p>Loading...</p></Modal>;

  return (
    <Modal isOpen={true} onClose={onClose} title={`Invoice: ${sale.invoice_number}`} size="lg">
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div><span className="text-slate-500">Customer:</span> {(sale.customers as Record<string, unknown>)?.name as string || 'Walk-in'}</div>
          <div><span className="text-slate-500">Date:</span> {formatDateTime(sale.sale_date)}</div>
          <div><span className="text-slate-500">Status:</span> {sale.status}</div>
          <div><span className="text-slate-500">Total:</span> <span className="font-bold">{formatCurrency(Number(sale.total))}</span></div>
        </div>
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
