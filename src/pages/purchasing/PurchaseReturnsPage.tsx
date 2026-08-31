import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fetchSuppliers } from '../../services/suppliers';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../lib/auth';
import { formatCurrency, formatDate } from '../../utils/helpers';

export function PurchaseReturnsPage() {
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canDelete = profile?.role === 'OWNER';

  const { data: returns, isLoading } = useQuery({
    queryKey: ['purchase-returns'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_returns')
        .select('*, suppliers(name), goods_receipts(receipt_number)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: () => fetchSuppliers({}).then((r) => r.data) });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Get return details for inventory reversal
      const { data: pr } = await supabase.from('purchase_returns').select('id, supplier_id, total').eq('id', id).single();
      const { data: items } = await supabase.from('purchase_return_items').select('*, goods_receipt_items(product_id)').eq('purchase_return_id', id);

      // Reverse inventory deductions
      for (const item of items || []) {
        const gri = item.goods_receipt_items as { product_id: string } | null;
        if (!gri) continue;
        const qty = Number(item.quantity);

        // Add back to inventory
        const { data: inv } = await supabase.from('inventory').select('quantity').eq('product_id', gri.product_id).maybeSingle();
        if (inv) {
          await supabase.from('inventory').update({ quantity: Number(inv.quantity) + qty }).eq('product_id', gri.product_id);
        }

        // Add back to batches
        const { data: batch } = await supabase.from('inventory_batches').select('id, remaining_quantity').eq('product_id', gri.product_id).order('created_at', { ascending: false }).limit(1).single();
        if (batch) {
          await supabase.from('inventory_batches').update({ remaining_quantity: Number(batch.remaining_quantity) + qty }).eq('id', batch.id);
        }

        // Delete the stock movement
        await supabase.from('inventory_movements').delete().eq('reference_type', 'PURCHASE_RETURN').eq('reference_id', id).eq('product_id', gri.product_id);
      }

      // Delete return items
      await supabase.from('purchase_return_items').delete().eq('purchase_return_id', id);

      // Reverse supplier transaction
      if (pr?.supplier_id) {
        await supabase.from('supplier_transactions').delete().eq('reference_type', 'PURCHASE_RETURN').eq('reference_id', id);
      }

      // Delete the return record
      const { error } = await supabase.from('purchase_returns').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['purchase-returns'] }),
        queryClient.refetchQueries({ queryKey: ['inventory'] }),
        queryClient.refetchQueries({ queryKey: ['inventory-all'] }),
        queryClient.refetchQueries({ queryKey: ['stock-movements'] }),
        queryClient.refetchQueries({ queryKey: ['suppliers'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
      ]);
      toast('success', 'Return deleted — inventory restored');
      setDeleteId(null);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'return_number', header: 'Return #', render: (row) => <span className="font-medium">{row.return_number as string}</span> },
    { key: 'supplier', header: 'Supplier', render: (row) => (row.suppliers as Record<string, unknown>)?.name as string || '-' },
    { key: 'receipt', header: 'From Receipt', render: (row) => (row.goods_receipts as Record<string, unknown>)?.receipt_number as string || '-' },
    { key: 'created_at', header: 'Date', render: (row) => formatDate(row.created_at as string) },
    { key: 'total', header: 'Total', render: (row) => formatCurrency(Number(row.total)) },
    { key: 'reason', header: 'Reason', render: (row) => <span className="text-gray-500">{row.reason as string}</span> },
    { key: 'actions', header: '', render: (row) => (
      canDelete ? (
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id as string); }} className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
      ) : null
    )},
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Purchase Returns</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="mr-2 h-4 w-4" /> New Return</button>
      </div>
      <div className="card p-0">
        <DataTable columns={columns} data={(returns || []).map((r) => r as unknown as Record<string, unknown>)} isLoading={isLoading} emptyMessage="No purchase returns" />
      </div>
      <PurchaseReturnForm isOpen={showForm} onClose={() => setShowForm(false)} suppliers={suppliers} />
      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && deleteMutation.mutate(deleteId)} title="Delete Return" message="Are you sure you want to delete this return? The inventory will be restored." confirmLabel="Delete" loading={deleteMutation.isPending} />
    </div>
  );
}

interface GoodsReceiptItemWithRelations {
  id: string;
  goods_receipt_id: string;
  product_id: string;
  batch_id: string | null;
  quantity: number;
  unit_cost: number;
  products: { name: string; sku: string } | null;
  inventory_batches: { batch_number: string | null; remaining_quantity: number } | null;
}

interface GoodsReceiptWithItems {
  id: string;
  receipt_number: string;
  supplier_id: string;
  received_date: string;
  total: number;
  goods_receipt_items: GoodsReceiptItemWithRelations[];
}

function PurchaseReturnForm({ isOpen, onClose, suppliers }: {
  isOpen: boolean; onClose: () => void;
  suppliers: { id: string; name: string }[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [receiptId, setReceiptId] = useState('');
  const [reason, setReason] = useState('');
  const [returnItems, setReturnItems] = useState<{ goods_receipt_item_id: string; quantity: number; unit_cost: number }[]>([]);

  // Fetch goods receipts for selected supplier
  const { data: receipts = [] } = useQuery({
    queryKey: ['goods-receipts-for-return', supplierId],
    queryFn: async () => {
      if (!supplierId) return [];
      const { data, error } = await supabase
        .from('goods_receipts')
        .select('id, receipt_number, supplier_id, received_date, total')
        .eq('supplier_id', supplierId)
        .order('received_date', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!supplierId,
  });

  // Fetch items for selected receipt
  const { data: receiptItems = [] } = useQuery({
    queryKey: ['goods-receipt-items-for-return', receiptId],
    queryFn: async () => {
      if (!receiptId) return [];
      const { data, error } = await supabase
        .from('goods_receipt_items')
        .select('*, products(name, sku), inventory_batches(batch_number, remaining_quantity)')
        .eq('goods_receipt_id', receiptId);
      if (error) throw error;
      return (data || []) as unknown as GoodsReceiptItemWithRelations[];
    },
    enabled: !!receiptId,
  });

  const total = returnItems.reduce((s, item) => s + item.quantity * item.unit_cost, 0);

  const toggleItem = (gri: GoodsReceiptItemWithRelations) => {
    const existing = returnItems.find((r) => r.goods_receipt_item_id === gri.id);
    if (existing) {
      setReturnItems(returnItems.filter((r) => r.goods_receipt_item_id !== gri.id));
    } else {
      setReturnItems([...returnItems, {
        goods_receipt_item_id: gri.id,
        quantity: Number(gri.inventory_batches?.remaining_quantity || gri.quantity),
        unit_cost: Number(gri.unit_cost),
      }]);
    }
  };

  const updateReturnQty = (griId: string, qty: number) => {
    setReturnItems(returnItems.map((r) => r.goods_receipt_item_id === griId ? { ...r, quantity: qty } : r));
  };

  const resetForm = () => {
    setSupplierId('');
    setReceiptId('');
    setReason('');
    setReturnItems([]);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const returnNumber = `PR-${Date.now().toString(36).toUpperCase()}`;

      // Create purchase return record (with goods_receipt_id as required by schema)
      const { data: pr, error: prError } = await supabase.from('purchase_returns').insert({
        goods_receipt_id: receiptId,
        supplier_id: supplierId || null,
        return_number: returnNumber,
        reason,
        total,
      }).select().single();
      if (prError) throw prError;

      // For each item: create return item, deduct inventory, update batch, create movement
      for (const item of returnItems) {
        if (item.quantity <= 0) continue;

        // Get the goods receipt item details for product_id
        const gri = receiptItems.find((r) => r.id === item.goods_receipt_item_id);
        if (!gri) continue;

        // Create return item (matching DB schema: goods_receipt_item_id, quantity, amount)
        const { error: priError } = await supabase.from('purchase_return_items').insert({
          purchase_return_id: pr.id,
          goods_receipt_item_id: item.goods_receipt_item_id,
          quantity: item.quantity,
          amount: item.quantity * item.unit_cost,
        });
        if (priError) throw priError;

        // Deduct inventory
        const { data: inv } = await supabase.from('inventory').select('quantity, average_cost').eq('product_id', gri.product_id).maybeSingle();
        if (inv) {
          const newQty = Math.max(0, Number(inv.quantity) - item.quantity);
          await supabase.from('inventory').update({ quantity: newQty }).eq('product_id', gri.product_id);
        }

        // Deduct from batches (FIFO: oldest first)
        const { data: batches } = await supabase
          .from('inventory_batches')
          .select('id, remaining_quantity')
          .eq('product_id', gri.product_id)
          .order('created_at', { ascending: true });

        let qtyToReturn = item.quantity;
        if (batches) {
          for (const batch of batches) {
            if (qtyToReturn <= 0) break;
            const canReturn = Math.min(qtyToReturn, Number(batch.remaining_quantity));
            if (canReturn > 0) {
              await supabase
                .from('inventory_batches')
                .update({ remaining_quantity: Number(batch.remaining_quantity) - canReturn })
                .eq('id', batch.id);
              qtyToReturn -= canReturn;
            }
          }
        }

        // Create stock movement
        await supabase.from('inventory_movements').insert({
          product_id: gri.product_id,
          movement_type: 'PURCHASE_RETURN',
          quantity_change: -item.quantity,
          unit_cost: item.unit_cost,
          reference_type: 'PURCHASE_RETURN',
          reference_id: pr.id,
          created_by: null,
          notes: `Purchase return - ${returnNumber}: ${reason}`,
        });
      }

      // Supplier transaction (reduce payable)
      if (supplierId) {
        await supabase.from('supplier_transactions').insert({
          supplier_id: supplierId,
          transaction_type: 'RETURN',
          amount: total,
          reference_type: 'PURCHASE_RETURN',
          reference_id: pr.id,
          narration: `Purchase return - ${returnNumber}`,
        });
      }

      return pr;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['purchase-returns'] }),
        queryClient.refetchQueries({ queryKey: ['inventory'] }),
        queryClient.refetchQueries({ queryKey: ['inventory-all'] }),
        queryClient.refetchQueries({ queryKey: ['stock-movements'] }),
        queryClient.refetchQueries({ queryKey: ['suppliers'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
      ]);
      toast('success', 'Return processed — inventory deducted');
      resetForm();
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <Modal isOpen={isOpen} onClose={() => { resetForm(); onClose(); }} title="New Purchase Return" size="lg"
      footer={<><button onClick={() => { resetForm(); onClose(); }} className="btn-secondary">Cancel</button>
        <button onClick={() => mutation.mutate()} className="btn-danger" disabled={!reason || !receiptId || returnItems.length === 0 || mutation.isPending}>
          {mutation.isPending ? 'Processing...' : 'Submit Return'}
        </button></>}>
      <div className="space-y-4">
        {/* Step 1: Select Supplier */}
        <div>
          <label className="label">Supplier *</label>
          <select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setReceiptId(''); setReturnItems([]); }} className="select-field">
            <option value="">Select supplier</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Step 2: Select Goods Receipt */}
        {supplierId && (
          <div>
            <label className="label">Goods Receipt *</label>
            <select value={receiptId} onChange={(e) => { setReceiptId(e.target.value); setReturnItems([]); }} className="select-field">
              <option value="">Select receipt to return from</option>
              {receipts.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.receipt_number} — {formatDate(r.received_date)} — {formatCurrency(Number(r.total))}
                </option>
              ))}
            </select>
            {receipts.length === 0 && <p className="text-xs text-gray-400 mt-1">No goods receipts found for this supplier</p>}
          </div>
        )}

        {/* Step 3: Select Items to Return */}
        {receiptId && receiptItems.length > 0 && (
          <div className="space-y-2">
            <label className="label mb-0">Items to Return (select items and set quantities)</label>
            <table className="min-w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-gray-500">
                <th className="py-2"></th>
                <th className="py-2">Product</th>
                <th className="py-2">Batch</th>
                <th className="py-2">Received Qty</th>
                <th className="py-2">Available</th>
                <th className="py-2">Unit Cost</th>
                <th className="py-2">Return Qty</th>
                <th className="py-2">Total</th>
              </tr></thead>
              <tbody>
                {receiptItems.map((gri) => {
                  const selected = returnItems.find((r) => r.goods_receipt_item_id === gri.id);
                  const available = Number(gri.inventory_batches?.remaining_quantity ?? gri.quantity);
                  const p = gri.products;
                  return (
                    <tr key={gri.id} className={`border-b ${selected ? 'bg-red-50' : ''}`}>
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={!!selected}
                          onChange={() => toggleItem(gri)}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="py-2 font-medium">{p?.name || 'Unknown'} <span className="text-xs text-gray-400">{p?.sku}</span></td>
                      <td className="py-2 text-gray-500">{gri.inventory_batches?.batch_number || '-'}</td>
                      <td className="py-2 text-gray-500">{Number(gri.quantity)}</td>
                      <td className="py-2 text-gray-500">{available}</td>
                      <td className="py-2">{formatCurrency(Number(gri.unit_cost))}</td>
                      <td className="py-2">
                        {selected ? (
                          <input
                            type="number"
                            value={selected.quantity}
                            onChange={(e) => updateReturnQty(gri.id, Math.min(Number(e.target.value), available))}
                            className="input-field w-20 text-sm"
                            min="1"
                            max={available}
                          />
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                      <td className="py-2 font-medium">
                        {selected ? formatCurrency(selected.quantity * selected.unit_cost) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <label className="label">Reason *</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="input-field" placeholder="e.g. Damaged goods, expired, wrong items" />
        </div>

        <div className="text-right text-lg font-bold border-t pt-3">Total Return: {formatCurrency(total)}</div>
      </div>
    </Modal>
  );
}
