import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Eye, Trash2 } from 'lucide-react';
import { fetchGoodsReceipts, receiveGoods, fetchGoodsReceipt, fetchPurchaseOrders } from '../../services/purchasing';
import { fetchSuppliers } from '../../services/suppliers';
import { fetchProducts } from '../../services/products';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Pagination } from '../../components/ui/Pagination';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { formatCurrency, formatDate } from '../../utils/helpers';

type PaymentStatus = 'PAID' | 'PARTIAL' | 'UNPAID';

export function GoodsReceiptsPage() {
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canDelete = profile?.role === 'OWNER';

  const { data, isLoading } = useQuery({
    queryKey: ['goods-receipts', page],
    queryFn: () => fetchGoodsReceipts({ page }),
  });

  const statusConfig: Record<PaymentStatus, { label: string; className: string }> = {
    PAID: { label: 'Paid', className: 'bg-green-100 text-green-700' },
    PARTIAL: { label: 'Partial', className: 'bg-yellow-100 text-yellow-700' },
    UNPAID: { label: 'Unpaid', className: 'bg-red-100 text-red-700' },
  };

  const columns: Column<Record<string, unknown>>[] = [
    {
      key: 'receipt_number',
      header: 'Receipt #',
      render: (row) => <span className="font-medium">{row.receipt_number as string}</span>,
    },
    {
      key: 'supplier',
      header: 'Supplier',
      render: (row) => (row.suppliers as { name: string })?.name || '-',
    },
    {
      key: 'received_date',
      header: 'Date',
      render: (row) => formatDate(row.received_date as string),
    },
    {
      key: 'total',
      header: 'Total',
      render: (row) => formatCurrency(Number(row.total)),
    },
    {
      key: 'payment_status',
      header: 'Status',
      render: (row) => {
        const status = (row.payment_status as PaymentStatus) || 'UNPAID';
        const cfg = statusConfig[status];
        return (
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}>
            {cfg.label}
          </span>
        );
      },
    },
    {
      key: 'outstanding',
      header: 'Outstanding',
      render: (row) => {
        const out = Number(row.outstanding || 0);
        return out > 0 ? (
          <span className="text-red-600 font-medium">{formatCurrency(out)}</span>
        ) : (
          <span className="text-green-600">-</span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowDetail(row.id as string);
            }}
            className="rounded p-1 hover:bg-gray-100"
          >
            <Eye size={16} />
          </button>
          {canDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteId(row.id as string);
              }}
              className="rounded p-1 text-red-500 hover:bg-red-50"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Get receipt details
      const { data: receipt } = await supabase.from('goods_receipts').select('id, supplier_id, purchase_order_id, total').eq('id', id).single();
      const { data: items } = await supabase.from('goods_receipt_items').select('*').eq('goods_receipt_id', id);

      // Reverse inventory and batch deductions
      for (const item of items || []) {
        const qty = Number(item.quantity);

        // Add back to inventory
        const { data: inv } = await supabase.from('inventory').select('quantity').eq('product_id', item.product_id).maybeSingle();
        if (inv) {
          await supabase.from('inventory').update({ quantity: Math.max(0, Number(inv.quantity) - qty) }).eq('product_id', item.product_id);
        }

        // Reverse batch quantities (most recent batch)
        const { data: batch } = await supabase.from('inventory_batches').select('id, remaining_quantity').eq('product_id', item.product_id).order('created_at', { ascending: false }).limit(1).single();
        if (batch) {
          await supabase.from('inventory_batches').update({ remaining_quantity: Math.max(0, Number(batch.remaining_quantity) - qty) }).eq('id', batch.id);
        }

        // Delete stock movement
        await supabase.from('inventory_movements').delete().eq('reference_type', 'GOODS_RECEIPT').eq('reference_id', id).eq('product_id', item.product_id);
      }

      // Reverse supplier transaction
      if (receipt?.supplier_id) {
        await supabase.from('supplier_transactions').delete().eq('reference_type', 'PURCHASE').eq('reference_id', id);
      }

      // Reset PO status if linked
      if (receipt?.purchase_order_id) {
        await supabase.from('purchase_orders').update({ status: 'PENDING' }).eq('id', receipt.purchase_order_id);
      }

      // Delete receipt items and receipt
      await supabase.from('goods_receipt_items').delete().eq('goods_receipt_id', id);
      const { error } = await supabase.from('goods_receipts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['goods-receipts'] }),
        queryClient.refetchQueries({ queryKey: ['inventory'] }),
        queryClient.refetchQueries({ queryKey: ['inventory-all'] }),
        queryClient.refetchQueries({ queryKey: ['stock-movements'] }),
        queryClient.refetchQueries({ queryKey: ['suppliers'] }),
        queryClient.refetchQueries({ queryKey: ['purchase-orders'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
      ]);
      toast('success', 'Receipt deleted — inventory restored');
      setDeleteId(null);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Goods Receipts</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="mr-2 h-4 w-4" /> Receive Goods
        </button>
      </div>

      <div className="card p-0">
        <DataTable
          columns={columns}
          data={(data?.data || []).map((g) => g as unknown as Record<string, unknown>)}
          isLoading={isLoading}
          emptyMessage="No receipts"
        />
        <div className="border-t px-4">
          <Pagination
            page={page}
            totalPages={data?.totalPages || 1}
            onPageChange={setPage}
            totalItems={data?.count}
            pageSize={20}
          />
        </div>
      </div>

      <GoodsReceiptForm isOpen={showForm} onClose={() => setShowForm(false)} />
      {showDetail && <GoodsReceiptDetail id={showDetail} onClose={() => setShowDetail(null)} />}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Delete Receipt"
        message="Are you sure? This will reverse all inventory changes from this receipt."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

function GoodsReceiptForm({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => fetchSuppliers({}).then((r) => r.data),
  });

  const { data: productsData } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => fetchProducts({ pageSize: 500 }).then((r) => r.data),
  });

  const { data: pendingPOs = [] } = useQuery({
    queryKey: ['purchase-orders-pending'],
    queryFn: async () => {
      const result = await fetchPurchaseOrders({ status: 'PENDING', pageSize: 100 });
      return result.data || [];
    },
  });

  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [items, setItems] = useState<
    { product_id: string; quantity: number; unit_cost: number; batch_number: string; expiry_date: string }[]
  >([{ product_id: '', quantity: 1, unit_cost: 0, batch_number: '', expiry_date: '' }]);

  // Auto-fill items when a PO is selected
  useEffect(() => {
    if (purchaseOrderId) {
      const po = pendingPOs.find((p) => p.id === purchaseOrderId);
      if (po && (po as any).purchase_order_items) {
        setSupplierId((po as any).supplier_id || '');
        const poItems = (po as any).purchase_order_items
          .map((item: Record<string, unknown>) => ({
            product_id: item.product_id as string,
            quantity: Number(item.quantity) - Number(item.received_quantity || 0),
            unit_cost: Number(item.unit_cost),
            batch_number: '',
            expiry_date: '',
          }))
          .filter((i: { quantity: number }) => i.quantity > 0);
        if (poItems.length > 0) setItems(poItems);
      }
    }
  }, [purchaseOrderId, pendingPOs]);

  const addItem = () =>
    setItems([...items, { product_id: '', quantity: 1, unit_cost: 0, batch_number: '', expiry_date: '' }]);

  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const updateItem = (idx: number, field: string, value: string | number) => {
    const newItems = [...items];
    (newItems[idx] as Record<string, unknown>)[field] = value;
    setItems(newItems);
  };

  const total = items.reduce((s, item) => s + item.quantity * item.unit_cost, 0);

  const mutation = useMutation({
    mutationFn: () =>
      receiveGoods({
        supplier_id: supplierId,
        purchase_order_id: purchaseOrderId || undefined,
        notes,
        items: items
          .filter((i) => i.product_id)
          .map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity,
            unit_cost: i.unit_cost,
            batch_number: i.batch_number || undefined,
            expiry_date: i.expiry_date || undefined,
          })),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['goods-receipts'] }),
        queryClient.refetchQueries({ queryKey: ['inventory'] }),
        queryClient.refetchQueries({ queryKey: ['inventory-all'] }),
        queryClient.refetchQueries({ queryKey: ['batches'] }),
        queryClient.refetchQueries({ queryKey: ['stock-movements'] }),
        queryClient.refetchQueries({ queryKey: ['purchase-orders'] }),
        queryClient.refetchQueries({ queryKey: ['suppliers'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
      ]);
      toast('success', 'Goods received and inventory updated');
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Receive Goods"
      size="xl"
      footer={
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            className="btn-success"
            disabled={!supplierId || mutation.isPending}
          >
            {mutation.isPending ? 'Receiving...' : 'Receive Goods'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Link to Purchase Order */}
        <div>
          <label className="label">Purchase Order (optional)</label>
          <select
            value={purchaseOrderId}
            onChange={(e) => setPurchaseOrderId(e.target.value)}
            className="select-field"
          >
            <option value="">Receive without PO</option>
            {pendingPOs.map((po) => (
              <option key={(po as any).id} value={(po as any).id}>
                {(po as any).order_number} — {formatCurrency(Number((po as any).total))}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            Select a pending PO to auto-fill items and mark it as received
          </p>
        </div>

        <div>
          <label className="label">Supplier *</label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="select-field"
          >
            <option value="">Select supplier</option>
            {suppliers.map((s: { id: string; name: string }) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="label mb-0">Items</label>
            <button onClick={addItem} className="btn-secondary text-xs py-1">
              <Plus size={14} className="mr-1" /> Add Item
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500">
                  <th className="py-2 px-2">Product</th>
                  <th className="py-2 px-2">Qty</th>
                  <th className="py-2 px-2">Unit Cost</th>
                  <th className="py-2 px-2">Batch #</th>
                  <th className="py-2 px-2">Expiry</th>
                  <th className="py-2 px-2">Total</th>
                  <th className="py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="py-2 px-2">
                      <select
                        value={item.product_id}
                        onChange={(e) => updateItem(idx, 'product_id', e.target.value)}
                        className="select-field text-sm"
                      >
                        <option value="">Select product</option>
                        {productsData?.map((p: { id: string; name: string }) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                        className="input-field w-20 text-sm"
                        min="1"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        value={item.unit_cost}
                        onChange={(e) => updateItem(idx, 'unit_cost', Number(e.target.value))}
                        className="input-field w-28 text-sm"
                        min="0"
                        step="0.01"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        value={item.batch_number}
                        onChange={(e) => updateItem(idx, 'batch_number', e.target.value)}
                        className="input-field w-24 text-sm"
                        placeholder="Auto"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="date"
                        value={item.expiry_date}
                        onChange={(e) => updateItem(idx, 'expiry_date', e.target.value)}
                        className="input-field w-32 text-sm"
                      />
                    </td>
                    <td className="py-2 px-2 font-medium">
                      {formatCurrency(item.quantity * item.unit_cost)}
                    </td>
                    <td className="py-2 px-2">
                      <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700">
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="text-right text-lg font-bold">Total: {formatCurrency(total)}</div>

        <div>
          <label className="label">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input-field text-sm"
            rows={3}
            placeholder="Optional notes about this receipt"
          />
        </div>
      </div>
    </Modal>
  );
}

function GoodsReceiptDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: receipt, isLoading } = useQuery({
    queryKey: ['goods-receipt', id],
    queryFn: () => fetchGoodsReceipt(id),
  });

  if (isLoading) {
    return (
      <Modal isOpen={true} onClose={onClose} title="Loading...">
        <p>Loading receipt details...</p>
      </Modal>
    );
  }

  if (!receipt) {
    return (
      <Modal isOpen={true} onClose={onClose} title="Error">
        <p>Receipt not found</p>
      </Modal>
    );
  }

  const receiptData = receipt as any;

  return (
    <Modal isOpen={true} onClose={onClose} title={`Receipt: ${receiptData.receipt_number}`} size="lg">
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-gray-500">Supplier:</span>
            <div className="font-medium">{receiptData.suppliers?.name || '-'}</div>
          </div>
          <div>
            <span className="text-gray-500">Date:</span>
            <div className="font-medium">{formatDate(receiptData.received_date)}</div>
          </div>
          <div>
            <span className="text-gray-500">Total:</span>
            <div className="font-bold text-lg">{formatCurrency(Number(receiptData.total))}</div>
          </div>
          <div>
            <span className="text-gray-500">Status:</span>
            <div className="font-medium">{receiptData.payment_status || 'UNPAID'}</div>
          </div>
        </div>

        <div className="border-t pt-4">
          <h3 className="font-semibold mb-3">Items</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500">
                  <th className="py-2 px-2">Product</th>
                  <th className="py-2 px-2">Qty</th>
                  <th className="py-2 px-2">Unit Cost</th>
                  <th className="py-2 px-2">Total</th>
                  <th className="py-2 px-2">Batch</th>
                </tr>
              </thead>
              <tbody>
                {(receiptData.goods_receipt_items || []).map((item: Record<string, unknown>) => {
                  const product = item.products as Record<string, unknown> | null;
                  const qty = Number(item.quantity);
                  const cost = Number(item.unit_cost);
                  return (
                    <tr key={item.id as string} className="border-b">
                      <td className="py-2 px-2">{product?.name as string}</td>
                      <td className="py-2 px-2">{qty}</td>
                      <td className="py-2 px-2">{formatCurrency(cost)}</td>
                      <td className="py-2 px-2 font-medium">{formatCurrency(qty * cost)}</td>
                      <td className="py-2 px-2 text-xs text-gray-500">{(item.batch_number as string) || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {receiptData.notes && (
          <div className="border-t pt-4">
            <span className="text-gray-500">Notes:</span>
            <p className="text-gray-700 mt-1">{receiptData.notes}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
