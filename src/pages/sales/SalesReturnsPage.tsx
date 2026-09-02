import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Minus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { processSaleReturn } from '../../services/sales';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';

type SaleOption = { id: string; invoice_number: string; customer_id: string | null; total: number; sale_date: string };
type ReturnableItem = { id: string; quantity: number; line_total: number; products: { name: string } | null };

export function SalesReturnsPage() {
  const [showForm, setShowForm] = useState(false);
  const { data: returns } = useQuery({
    queryKey: ['sales-returns'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales_returns')
        .select('*, customers!sales_returns_customer_id_fkey(name), sales!sales_returns_sale_id_fkey(invoice_number)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const { data: sales } = useQuery({
    queryKey: ['sales-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales')
        .select('id, invoice_number, customer_id, total, sale_date')
        .eq('status', 'COMPLETED').order('sale_date', { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as SaleOption[];
    },
  });

  return <div className="space-y-4">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold text-gray-900">Sales Returns</h1><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="mr-2 h-4 w-4" /> New Return</button></div>
    <div className="card">
      {(!returns || returns.length === 0) ? <p className="py-8 text-center text-gray-500">No sales returns yet</p> : <table className="min-w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-gray-500"><th className="py-2">Return #</th><th className="py-2">Sale</th><th className="py-2">Customer</th><th className="py-2">Date</th><th className="py-2">Refund</th><th className="py-2">Reason</th></tr></thead>
        <tbody>{returns.map((returnRecord: Record<string, unknown>) => <tr key={returnRecord.id as string} className="border-b">
          <td className="py-2 font-medium">{returnRecord.return_number as string}</td><td className="py-2">{(returnRecord.sales as Record<string, unknown>)?.invoice_number as string || '—'}</td><td className="py-2">{(returnRecord.customers as Record<string, unknown>)?.name as string || 'Walk-in'}</td><td className="py-2">{formatDate(returnRecord.created_at as string)}</td><td className="py-2 font-medium text-red-600">-{formatCurrency(Number(returnRecord.total))}</td><td className="py-2 text-gray-500">{returnRecord.reason as string}</td>
        </tr>)}</tbody>
      </table>}
    </div>
    {showForm && <SalesReturnForm isOpen={showForm} onClose={() => setShowForm(false)} sales={sales || []} />}
  </div>;
}

function SalesReturnForm({ isOpen, onClose, sales }: { isOpen: boolean; onClose: () => void; sales: SaleOption[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saleId, setSaleId] = useState('');
  const [reason, setReason] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const selectedSale = sales.find(sale => sale.id === saleId);
  const { data: saleItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['sale-return-items', saleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sale_items').select('id, quantity, line_total, products(name)').eq('sale_id', saleId);
      if (error) throw error;
      return ((data || []) as unknown as ReturnableItem[]);
    },
    enabled: !!saleId,
  });
  useEffect(() => setQuantities(Object.fromEntries(saleItems.map(item => [item.id, Number(item.quantity)]))), [saleItems]);
  const estimatedRefund = saleItems.reduce((total, item) => total + (Number(item.line_total) / Number(item.quantity)) * (quantities[item.id] || 0), 0);
  const selectedCount = Object.values(quantities).filter(quantity => quantity > 0).length;
  const mutation = useMutation({
    mutationFn: () => processSaleReturn({
      sale_id: saleId, customer_id: selectedSale?.customer_id || undefined, reason, refund_method: 'CASH',
      items: saleItems.filter(item => (quantities[item.id] || 0) > 0).map(item => ({ sale_item_id: item.id, quantity: quantities[item.id], amount: (Number(item.line_total) / Number(item.quantity)) * quantities[item.id] })),
    }),
    onSuccess: async result => {
      // Only invalidate directly affected queries - NOT dashboard or customer transactions
      // Dashboard stats will eventually see the change via realtime subscription or next periodic refresh
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sales-returns'] }),
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['sales-all'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-all'] }),
      ]);
      toast('success', `Return ${result.return_number} processed: ${formatCurrency(Number(result.total))}`);
      onClose();
    },
    onError: (error: Error) => toast('error', error.message),
  });

  return <Modal isOpen={isOpen} onClose={onClose} title="New Sales Return" size="lg" footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={() => mutation.mutate()} className="btn-danger" disabled={!saleId || !reason.trim() || selectedCount === 0 || mutation.isPending}>{mutation.isPending ? 'Processing...' : 'Process Return'}</button></>}>
    <div className="space-y-4">
      <div><label className="label">Original Sale</label><select value={saleId} onChange={event => { setSaleId(event.target.value); setQuantities({}); }} className="select-field"><option value="">Select sale</option>{sales.map(sale => <option key={sale.id} value={sale.id}>{sale.invoice_number} — {formatCurrency(Number(sale.total))}</option>)}</select></div>
      {selectedSale && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm"><div className="flex justify-between"><span className="text-gray-600">Sale total</span><span className="font-bold text-blue-700">{formatCurrency(Number(selectedSale.total))}</span></div><div className="flex justify-between mt-1"><span className="text-gray-600">Sale date</span><span>{formatDate(selectedSale.sale_date)}</span></div></div>}
      {saleId && <div><label className="label">Items to return</label>{itemsLoading ? <p className="text-sm text-gray-500">Loading sale items…</p> : <div className="rounded-lg border divide-y">{saleItems.map(item => {
        const quantity = quantities[item.id] || 0;
        return <div key={item.id} className="flex items-center justify-between gap-3 p-3 text-sm"><div><p className="font-medium">{item.products?.name || 'Product'}</p><p className="text-xs text-gray-500">Sold: {item.quantity} · {formatCurrency(Number(item.line_total))}</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => setQuantities(current => ({ ...current, [item.id]: Math.max(0, quantity - 1) }))} className="rounded p-1 hover:bg-gray-100" aria-label="Decrease return quantity"><Minus size={16} /></button><input type="number" min="0" max={Number(item.quantity)} value={quantity} onChange={event => setQuantities(current => ({ ...current, [item.id]: Math.min(Number(item.quantity), Math.max(0, Number(event.target.value))) }))} className="w-16 rounded border px-2 py-1 text-center" /><button type="button" onClick={() => setQuantities(current => ({ ...current, [item.id]: Math.min(Number(item.quantity), quantity + 1) }))} className="rounded p-1 hover:bg-gray-100" aria-label="Increase return quantity"><Plus size={16} /></button></div></div>;
      })}</div>}<p className="mt-2 text-xs text-gray-500">Returned stock is added back automatically. Refund: <span className="font-semibold text-red-600">-{formatCurrency(estimatedRefund)}</span></p></div>}
      <div><label className="label">Reason</label><input value={reason} onChange={event => setReason(event.target.value)} className="input-field" placeholder="e.g. Damaged, expired, wrong item" /></div>
    </div>
  </Modal>;
}
