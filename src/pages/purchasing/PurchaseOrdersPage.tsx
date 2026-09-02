import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Eye, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fetchPurchaseOrders, createPurchaseOrder, fetchPurchaseOrder, updatePurchaseOrderStatus } from '../../services/purchasing';
import { fetchSuppliers } from '../../services/suppliers';
import { fetchProducts } from '../../services/products';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Pagination } from '../../components/ui/Pagination';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ExportButtons } from '../../components/ui/ExportButtons';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../lib/auth';
import { formatCurrency, formatDate } from '../../utils/helpers';
import type { PurchaseOrder } from '../../types/database';

export function PurchaseOrdersPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canDelete = profile?.role === 'OWNER';

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', page, statusFilter],
    queryFn: () => fetchPurchaseOrders({ page, status: statusFilter || undefined }),
  });

  const statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-800',
    PENDING: 'bg-yellow-100 text-yellow-800',
    PARTIALLY_RECEIVED: 'bg-blue-100 text-blue-800',
    RECEIVED: 'bg-green-100 text-green-800',
    CANCELLED: 'bg-red-100 text-red-800',
  };

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'order_number', header: 'Order #', render: (row) => <span className="font-medium">{row.order_number as string}</span> },
    { key: 'supplier', header: 'Supplier', render: (row) => {
      const s = row.suppliers as { name: string } | null;
      return s?.name || '-';
    }},
    { key: 'order_date', header: 'Date', render: (row) => formatDate(row.order_date as string) },
    { key: 'total', header: 'Total', render: (row) => formatCurrency(Number(row.total)) },
    { key: 'status', header: 'Status', render: (row) => (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[row.status as string] || ''}`}>
        {(row.status as string)?.replace('_', ' ')}
      </span>
    )},
    { key: 'actions', header: '', render: (row) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); setShowDetail(row.id as string); }} className="rounded p-1 hover:bg-gray-100"><Eye size={16} /></button>
        {['DRAFT', 'PENDING'].includes(row.status as string) && (
          <button onClick={(e) => { e.stopPropagation(); if (confirm('Submit this PO?')) submitPO.mutate(row.id as string); }} className="btn-success text-xs py-1">Submit</button>
        )}
        {canDelete && ['DRAFT', 'CANCELLED'].includes(row.status as string) && (
          <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id as string); }} className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
        )}
      </div>
    )},
  ];

  const submitPO = useMutation({
    mutationFn: (id: string) => updatePurchaseOrderStatus(id, 'PENDING'),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['purchase-orders'] });
      toast('success', 'PO submitted');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Delete PO items first
      await supabase.from('purchase_order_items').delete().eq('purchase_order_id', id);
      const { error } = await supabase.from('purchase_orders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['purchase-orders'] });
      toast('success', 'Purchase order deleted');
      setDeleteId(null);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="mr-2 h-4 w-4" /> New PO</button>
      </div>

      <div className="flex gap-2">
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="select-field w-48">
          <option value="">All Status</option>
          <option value="DRAFT">Draft</option>
          <option value="PENDING">Pending</option>
          <option value="PARTIALLY_RECEIVED">Partially Received</option>
          <option value="RECEIVED">Received</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={(data?.data || []).map((p) => p as unknown as Record<string, unknown>)} isLoading={isLoading} emptyMessage="No purchase orders" />
        <div className="border-t px-4"><Pagination page={page} totalPages={data?.totalPages || 1} onPageChange={setPage} totalItems={data?.count} pageSize={20} /></div>
      </div>

      <PurchaseOrderForm isOpen={showForm} onClose={() => setShowForm(false)} />
      {showDetail && <PurchaseOrderDetail id={showDetail} onClose={() => setShowDetail(null)} />}
      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && deleteMutation.mutate(deleteId)} title="Delete Purchase Order" message="Are you sure you want to delete this purchase order?" confirmLabel="Delete" loading={deleteMutation.isPending} />
    </div>
  );
}

function PurchaseOrderForm({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: () => fetchSuppliers({}).then((r) => r.data) });
  const { data: productsData } = useQuery({ queryKey: ['products-all'], queryFn: () => fetchProducts({ pageSize: 500 }).then((r) => r.data) });

  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<{ product_id: string; quantity: number; unit_cost: number }[]>([{ product_id: '', quantity: 1, unit_cost: 0 }]);

  const addItem = () => setItems([...items, { product_id: '', quantity: 1, unit_cost: 0 }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: string, value: string | number) => {
    const newItems = [...items];
    (newItems[idx] as Record<string, unknown>)[field] = value;
    setItems(newItems);
  };

  const total = items.reduce((s, item) => s + item.quantity * item.unit_cost, 0);

  const mutation = useMutation({
    mutationFn: () => createPurchaseOrder({
      supplier_id: supplierId,
      notes,
      items: items.filter((i) => i.product_id),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['purchase-orders'] }),
        queryClient.refetchQueries({ queryKey: ['suppliers'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
      ]);
      toast('success', 'Purchase order created');
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Purchase Order" size="xl"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={() => mutation.mutate()} className="btn-primary" disabled={!supplierId || items.length === 0 || mutation.isPending}>{mutation.isPending ? 'Creating...' : 'Create PO'}</button></>}>
      <div className="space-y-4">
        <div>
          <label className="label">Supplier *</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="select-field">
            <option value="">Select supplier</option>
            {suppliers.map((s: { id: string; name: string }) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div>
          <label className="label">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input-field" placeholder="Optional notes" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="label mb-0">Items</label>
            <button onClick={addItem} className="btn-secondary text-xs py-1"><Plus size={14} className="mr-1" /> Add Item</button>
          </div>

          <table className="min-w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-gray-500">
              <th className="py-2">Product</th><th className="py-2">Qty</th><th className="py-2">Unit Cost</th><th className="py-2">Total</th><th className="py-2"></th>
            </tr></thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} className="border-b">
                  <td className="py-2">
                    <select value={item.product_id} onChange={(e) => updateItem(idx, 'product_id', e.target.value)} className="select-field text-sm">
                      <option value="">Select product</option>
                      {productsData?.map((p: { id: string; name: string; sku: string }) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                    </select>
                  </td>
                  <td className="py-2"><input type="number" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))} className="input-field w-20 text-sm" min="1" /></td>
                  <td className="py-2"><input type="number" value={item.unit_cost} onChange={(e) => updateItem(idx, 'unit_cost', Number(e.target.value))} className="input-field w-28 text-sm" min="0" step="0.01" /></td>
                  <td className="py-2 font-medium">{formatCurrency(item.quantity * item.unit_cost)}</td>
                  <td className="py-2"><button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700">×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-right text-lg font-bold">Total: {formatCurrency(total)}</div>
      </div>
    </Modal>
  );
}

function PurchaseOrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: po } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => fetchPurchaseOrder(id),
  });

  if (!po) return <Modal isOpen={true} onClose={onClose} title="Loading..."><p>Loading...</p></Modal>;

  const supplierName = (po.suppliers as Record<string, unknown>)?.name as string || 'Supplier';

  return (
    <Modal isOpen={true} onClose={onClose} title={`Purchase Order: ${po.order_number}`} size="lg">
      <div className="space-y-4">
        {/* Export Action Buttons */}
        <div className="flex justify-end gap-2">
          <ExportButtons
            variant="secondary"
            filename={`PurchaseOrder_${po.order_number}`}
            title={`Purchase Order ${po.order_number}`}
            tableData={{
              headers: ['#', 'Product', 'Ordered Qty', 'Received Qty', 'Unit Cost', 'Line Total'],
              rows: (po.purchase_order_items || []).map((item: any, idx: number) => [
                idx + 1,
                item.products?.name || '—',
                Number(item.quantity),
                Number(item.received_quantity || 0),
                formatCurrency(Number(item.unit_cost)),
                formatCurrency(Number(item.quantity) * Number(item.unit_cost)),
              ]),
              totals: {
                'Total Amount': formatCurrency(Number(po.total)),
              },
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 p-3 rounded-lg border border-slate-200">
          <div><span className="text-gray-500 font-medium">Supplier:</span> <span className="font-semibold text-gray-900">{supplierName}</span></div>
          <div><span className="text-gray-500 font-medium">Date:</span> <span className="font-semibold text-gray-900">{formatDate(po.order_date)}</span></div>
          <div><span className="text-gray-500 font-medium">Status:</span> <span className="font-bold text-blue-700">{po.status}</span></div>
          <div><span className="text-gray-500 font-medium">Total:</span> <span className="font-bold text-gray-900">{formatCurrency(Number(po.total))}</span></div>
        </div>

        <table className="min-w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-gray-500 uppercase">
            <th className="py-2">Product</th><th className="py-2 text-center">Ordered</th><th className="py-2 text-center">Received</th><th className="py-2 text-right">Cost</th><th className="py-2 text-right">Total</th>
          </tr></thead>
          <tbody>
            {(po.purchase_order_items || []).map((item: Record<string, unknown>) => {
              const p = item.products as Record<string, unknown> | null;
              const qty = Number(item.quantity);
              const cost = Number(item.unit_cost);
              return (
                <tr key={item.id as string} className="border-b hover:bg-gray-50">
                  <td className="py-2 font-medium text-gray-900">{p?.name as string || '-'}</td>
                  <td className="py-2 text-center">{qty}</td>
                  <td className="py-2 text-center">{Number(item.received_quantity || 0)}</td>
                  <td className="py-2 text-right">{formatCurrency(cost)}</td>
                  <td className="py-2 text-right font-bold text-gray-900">{formatCurrency(qty * cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
