import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fetchSales } from '../../services/sales';
import { formatCurrency, formatDate, generateOrderNumber } from '../../utils/helpers';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../lib/auth';

export function SalesReturnsPage() {
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canDelete = profile?.role === 'OWNER';

  const { data: returns } = useQuery({
    queryKey: ['sales-returns'],
    queryFn: async () => {
      const { data } = await supabase.from('sales_returns').select('*, customers!sales_returns_customer_id_fkey(name)').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const { data: sales } = useQuery({
    queryKey: ['sales-all'],
    queryFn: async () => {
      const { data } = await supabase
        .from('sales')
        .select('id, invoice_number, customer_id, total, sale_date, status')
        .eq('status', 'COMPLETED')
        .order('sale_date', { ascending: false })
        .limit(100);
      return data || [];
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Sales Returns</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="mr-2 h-4 w-4" /> New Return</button>
      </div>

      <div className="card">
        {(!returns || returns.length === 0) ? (
          <p className="py-8 text-center text-gray-500">No sales returns yet</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-gray-500">
              <th className="py-2">Return #</th><th className="py-2">Customer</th><th className="py-2">Date</th><th className="py-2">Total</th><th className="py-2">Reason</th>{canDelete && <th className="py-2"></th>}
            </tr></thead>
            <tbody>
              {returns.map((r: Record<string, unknown>) => (
                <tr key={r.id as string} className="border-b">
                  <td className="py-2 font-medium">{r.return_number as string}</td>
                  <td className="py-2">{(r.customers as Record<string, unknown>)?.name as string || 'Walk-in'}</td>
                  <td className="py-2">{formatDate(r.created_at as string)}</td>
                  <td className="py-2">{formatCurrency(Number(r.total))}</td>
                  <td className="py-2 text-gray-500">{r.reason as string}</td>
                  {canDelete && <td className="py-2"><button onClick={() => setDeleteId(r.id as string)} className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && <SalesReturnForm isOpen={showForm} onClose={() => setShowForm(false)} sales={sales || []} />}
      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={async () => {
        if (!deleteId) return;
        await supabase.from('sales_returns').delete().eq('id', deleteId);
        await queryClient.refetchQueries({ queryKey: ['sales-returns'] });
        toast('success', 'Return deleted');
        setDeleteId(null);
      }} title="Delete Sales Return" message="Are you sure you want to delete this return?" confirmLabel="Delete" />
    </div>
  );
}

function SalesReturnForm({ isOpen, onClose, sales }: { isOpen: boolean; onClose: () => void; sales: { id: string; invoice_number: string; customer_id: string | null; total: number; sale_date: string }[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saleId, setSaleId] = useState('');
  const [reason, setReason] = useState('');
  const [total, setTotal] = useState(0);

  const selectedSale = sales.find((s) => s.id === saleId);

  const mutation = useMutation({
    mutationFn: async () => {
      const returnNumber = generateOrderNumber('SR');
      const sale = sales.find((s) => s.id === saleId);
      const { data, error } = await supabase.from('sales_returns').insert({
        sale_id: saleId,
        customer_id: sale?.customer_id || null,
        return_number: returnNumber,
        reason,
        refund_method: 'CASH',
        total,
      }).select().single();
      if (error) throw error;
      // Restore inventory via movement
      await supabase.from('inventory_movements').insert({
        movement_type: 'SALE_RETURN',
        quantity_change: 1,
        reference_type: 'SALES_RETURN',
        reference_id: data.id,
      });
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['sales-returns'] }),
        queryClient.refetchQueries({ queryKey: ['sales'] }),
        queryClient.refetchQueries({ queryKey: ['inventory'] }),
        queryClient.refetchQueries({ queryKey: ['inventory-all'] }),
        queryClient.refetchQueries({ queryKey: ['stock-movements'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
        queryClient.refetchQueries({ queryKey: ['customer-transactions'] }),
      ]);
      toast('success', 'Return processed');
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Sales Return" size="md"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={() => mutation.mutate()} className="btn-danger" disabled={!saleId || !reason || mutation.isPending}>{mutation.isPending ? 'Processing...' : 'Submit Return'}</button></>}>
      <div className="space-y-4">
        <div>
          <label className="label">Original Sale</label>
          <select value={saleId} onChange={(e) => {
              const id = e.target.value;
              setSaleId(id);
              const sale = sales.find((s) => s.id === id);
              if (sale) setTotal(Number(sale.total));
            }} className="select-field">
            <option value="">Select sale to refund</option>
            {sales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.invoice_number} — {formatCurrency(Number(s.total))}
              </option>
            ))}
          </select>
        </div>

        {selectedSale && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Invoice:</span>
              <span className="font-medium">{selectedSale.invoice_number}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Date:</span>
              <span className="font-medium">{formatDate(selectedSale.sale_date)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-blue-200 mt-2 pt-2">
              <span className="text-gray-600">Sale Total:</span>
              <span className="text-lg font-bold text-blue-700">{formatCurrency(Number(selectedSale.total))}</span>
            </div>
          </div>
        )}

        <div>
          <label className="label">Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="input-field" placeholder="e.g. Expired, Damaged, Wrong item" />
        </div>

        <div>
          <label className="label">Refund Amount</label>
          <div className="relative">
            <input
              type="number"
              value={total || ''}
              onChange={(e) => setTotal(Number(e.target.value))}
              className="input-field pr-16"
              min="0"
              max={selectedSale ? Number(selectedSale.total) : undefined}
              step="0.01"
            />
            {selectedSale && (
              <button
                type="button"
                onClick={() => setTotal(Number(selectedSale.total))}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 transition"
              >
                Full Amount
              </button>
            )}
          </div>
          {selectedSale && total > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              Refunding {formatCurrency(total)} of {formatCurrency(Number(selectedSale.total))} sale total
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
