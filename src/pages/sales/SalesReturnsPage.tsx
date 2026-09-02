import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Minus, Eye, CheckSquare, Square, RotateCcw, PackageCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { processSaleReturn } from '../../services/sales';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/helpers';
import { Modal } from '../../components/ui/Modal';
import { ExportButtons } from '../../components/ui/ExportButtons';
import { useToast } from '../../components/ui/Toast';

type SaleOption = { id: string; invoice_number: string; customer_id: string | null; total: number; sale_date: string };
type ReturnableItem = { id: string; quantity: number; line_total: number; products: { name: string } | null };

export function SalesReturnsPage() {
  const [showForm, setShowForm] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState<Record<string, unknown> | null>(null);

  const { data: returns } = useQuery({
    queryKey: ['sales-returns'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales_returns')
        .select('*, customers!sales_returns_customer_id_fkey(name), sales!sales_returns_sale_id_fkey(invoice_number, sale_date)')
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales Returns</h1>
          <p className="text-xs text-gray-500">Process customer item returns and automatically restock inventory</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="mr-2 h-4 w-4" /> New Sales Return
        </button>
      </div>

      <div className="card">
        {(!returns || returns.length === 0) ? (
          <p className="py-8 text-center text-gray-500">No sales returns recorded yet</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500 uppercase">
                <th className="py-2 px-2">Return #</th>
                <th className="py-2 px-2">Sale Invoice</th>
                <th className="py-2 px-2">Customer</th>
                <th className="py-2 px-2">Date</th>
                <th className="py-2 px-2">Refund Total</th>
                <th className="py-2 px-2">Reason</th>
                <th className="py-2 px-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((returnRecord: Record<string, unknown>) => (
                <tr key={returnRecord.id as string} className="border-b hover:bg-gray-50">
                  <td className="py-2 px-2 font-semibold text-gray-900">{returnRecord.return_number as string}</td>
                  <td className="py-2 px-2">{(returnRecord.sales as Record<string, unknown>)?.invoice_number as string || '—'}</td>
                  <td className="py-2 px-2">{(returnRecord.customers as Record<string, unknown>)?.name as string || 'Walk-in'}</td>
                  <td className="py-2 px-2 text-gray-600">{formatDate(returnRecord.created_at as string)}</td>
                  <td className="py-2 px-2 font-bold text-red-600">Rs. {Number(returnRecord.total).toLocaleString()}</td>
                  <td className="py-2 px-2 text-gray-500">{returnRecord.reason as string || '—'}</td>
                  <td className="py-2 px-2 text-right">
                    <button
                      onClick={() => setSelectedReturn(returnRecord)}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition"
                      title="View Return Details"
                    >
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && <SalesReturnForm isOpen={showForm} onClose={() => setShowForm(false)} sales={sales || []} />}
      {selectedReturn && <SalesReturnDetail returnRecord={selectedReturn} onClose={() => setSelectedReturn(null)} />}
    </div>
  );
}

function SalesReturnDetail({ returnRecord, onClose }: { returnRecord: Record<string, unknown>; onClose: () => void }) {
  const returnNumber = returnRecord.return_number as string;
  const invoiceNumber = (returnRecord.sales as Record<string, unknown>)?.invoice_number as string || '—';
  const customerName = (returnRecord.customers as Record<string, unknown>)?.name as string || 'Walk-in Customer';
  const refundTotal = Number(returnRecord.total || 0);
  const reason = (returnRecord.reason as string) || 'Standard Customer Return';
  const dateStr = formatDateTime(returnRecord.created_at as string);

  return (
    <Modal isOpen={true} onClose={onClose} title={`Sales Return: ${returnNumber}`} size="md">
      <div className="space-y-4">
        {/* Export Buttons */}
        <div className="flex justify-end">
          <ExportButtons
            variant="secondary"
            filename={`SalesReturn_${returnNumber}`}
            title={`Sales Return ${returnNumber}`}
            data={{
              'Return #': returnNumber,
              'Original Invoice #': invoiceNumber,
              'Customer': customerName,
              'Return Date & Time': dateStr,
              'Reason': reason,
              'Refund Method': (returnRecord.refund_method as string) || 'Cash',
              'Total Refund Amount (PKR)': refundTotal.toFixed(2),
            }}
          />
        </div>

        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs font-semibold text-red-600 uppercase">Total Refund Amount</p>
              <p className="text-2xl font-bold text-red-700 mt-0.5">Rs. {refundTotal.toLocaleString()}</p>
            </div>
            <span className="bg-red-200 text-red-800 text-xs font-bold px-2.5 py-1 rounded-full uppercase">
              Returned & Restocked
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm bg-gray-50 p-3 rounded-lg border border-gray-200">
          <div>
            <span className="text-xs text-gray-500 font-medium uppercase">Original Invoice</span>
            <p className="font-semibold text-gray-900 mt-0.5">{invoiceNumber}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500 font-medium uppercase">Customer</span>
            <p className="font-semibold text-gray-900 mt-0.5">{customerName}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500 font-medium uppercase">Return Date</span>
            <p className="font-medium text-gray-900 mt-0.5">{dateStr}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500 font-medium uppercase">Refund Method</span>
            <p className="font-medium text-gray-900 mt-0.5">{(returnRecord.refund_method as string) || 'Cash'}</p>
          </div>
        </div>

        {reason && (
          <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-sm">
            <span className="text-xs text-gray-500 font-medium uppercase block mb-1">Reason</span>
            <p className="text-gray-800">{reason}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SalesReturnForm({ isOpen, onClose, sales }: { isOpen: boolean; onClose: () => void; sales: SaleOption[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saleId, setSaleId] = useState('');
  const [reason, setReason] = useState('Customer Request');
  
  // Track selected items and their return quantities separately
  const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
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

  // When sale items load, initialize defaults (all unchecked, 1 unit default)
  useEffect(() => {
    if (saleItems.length > 0) {
      const initialSelected: Record<string, boolean> = {};
      const initialQty: Record<string, number> = {};
      saleItems.forEach(item => {
        initialSelected[item.id] = false;
        initialQty[item.id] = Number(item.quantity);
      });
      setSelectedItems(initialSelected);
      setQuantities(initialQty);
    }
  }, [saleItems]);

  // Compute total items and total refund
  const activeItems = saleItems.filter(item => selectedItems[item.id] && (quantities[item.id] || 0) > 0);
  const totalUnitsToReturn = activeItems.reduce((sum, item) => sum + (quantities[item.id] || 0), 0);
  const totalRefundAmount = activeItems.reduce((sum, item) => {
    const unitPrice = Number(item.line_total) / Number(item.quantity);
    return sum + unitPrice * (quantities[item.id] || 0);
  }, 0);

  const mutation = useMutation({
    mutationFn: () => processSaleReturn({
      sale_id: saleId,
      customer_id: selectedSale?.customer_id || undefined,
      reason,
      refund_method: 'CASH',
      items: activeItems.map(item => ({
        sale_item_id: item.id,
        quantity: quantities[item.id],
        amount: (Number(item.line_total) / Number(item.quantity)) * quantities[item.id]
      })),
    }),
    onSuccess: async result => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sales-returns'] }),
        queryClient.invalidateQueries({ queryKey: ['sales'] }),
        queryClient.invalidateQueries({ queryKey: ['sales-all'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-all'] }),
        queryClient.invalidateQueries({ queryKey: ['stock-movements'] }),
        queryClient.invalidateQueries({ queryKey: ['pos-products'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['products-all'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }),
      ]);
      toast('success', `Return processed successfully! Refund given: ${formatCurrency(Number(result.total))}`);
      onClose();
    },
    onError: (error: Error) => toast('error', error.message),
  });

  const toggleItemSelection = (itemId: string) => {
    setSelectedItems(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Sales Return & Restock"
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-left text-xs text-slate-500">
            {activeItems.length > 0 ? (
              <span className="font-semibold text-emerald-700">
                ✓ {totalUnitsToReturn} unit(s) selected across {activeItems.length} item(s)
              </span>
            ) : (
              <span>Select items above to calculate refund</span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              onClick={() => mutation.mutate()}
              className="btn-danger flex items-center gap-1.5"
              disabled={!saleId || activeItems.length === 0 || totalUnitsToReturn === 0 || mutation.isPending}
            >
              <RotateCcw size={16} />
              {mutation.isPending ? 'Processing Return...' : `Confirm Return (${formatCurrency(totalRefundAmount)})`}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Step 1: Select Original Sale */}
        <div>
          <label className="label text-sm font-semibold text-slate-900">1. Select Original Invoice</label>
          <select
            value={saleId}
            onChange={event => { setSaleId(event.target.value); }}
            className="select-field text-base font-medium"
          >
            <option value="">-- Choose a sale invoice --</option>
            {sales.map(sale => (
              <option key={sale.id} value={sale.id}>
                {sale.invoice_number} — Total: {formatCurrency(Number(sale.total))} ({formatDate(sale.sale_date)})
              </option>
            ))}
          </select>
        </div>

        {/* Selected Sale Overview */}
        {selectedSale && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-sm flex justify-between items-center">
            <div>
              <p className="text-xs font-semibold text-blue-800 uppercase">Selected Sale</p>
              <p className="font-bold text-slate-900 text-base">{selectedSale.invoice_number}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">Invoice Total</p>
              <p className="font-bold text-blue-700 text-base">{formatCurrency(Number(selectedSale.total))}</p>
            </div>
          </div>
        )}

        {/* Step 2: Item Selection Cards */}
        {saleId && (
          <div>
            <label className="label text-sm font-semibold text-slate-900">
              2. Choose Items & Quantities to Return
            </label>
            <p className="text-xs text-slate-500 mb-2">
              Check the boxes for items the customer is returning. Stock will automatically be added back to inventory.
            </p>

            {itemsLoading ? (
              <div className="py-6 text-center text-sm text-slate-500 animate-pulse">Loading sale items…</div>
            ) : saleItems.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500 border rounded-lg">No items found for this sale</p>
            ) : (
              <div className="space-y-2">
                {saleItems.map(item => {
                  const isSelected = !!selectedItems[item.id];
                  const soldQty = Number(item.quantity);
                  const currentQty = quantities[item.id] ?? soldQty;
                  const unitPrice = Number(item.line_total) / soldQty;
                  const itemRefund = unitPrice * currentQty;

                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleItemSelection(item.id)}
                      className={`p-3 rounded-lg border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50/40 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <button type="button" className="text-blue-600 focus:outline-none">
                            {isSelected ? <CheckSquare className="w-5 h-5 text-blue-600" /> : <Square className="w-5 h-5 text-slate-400" />}
                          </button>
                          <div>
                            <p className="font-bold text-slate-900">{item.products?.name || 'Product'}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              Sold: <span className="font-semibold text-slate-700">{soldQty} units</span> @ {formatCurrency(unitPrice)} each
                            </p>
                          </div>
                        </div>

                        {isSelected && (
                          <div className="flex items-center gap-4" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg p-1">
                              <button
                                type="button"
                                onClick={() => setQuantities(prev => ({ ...prev, [item.id]: Math.max(1, currentQty - 1) }))}
                                className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-700 font-bold"
                              >
                                <Minus size={14} />
                              </button>
                              <span className="w-8 text-center font-bold text-slate-900 text-sm">
                                {currentQty}
                              </span>
                              <button
                                type="button"
                                onClick={() => setQuantities(prev => ({ ...prev, [item.id]: Math.min(soldQty, currentQty + 1) }))}
                                className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-700 font-bold"
                              >
                                <Plus size={14} />
                              </button>
                            </div>
                            <div className="text-right min-w-[100px]">
                              <span className="text-xs text-slate-400 block font-medium">Item Refund</span>
                              <span className="font-bold text-red-600 text-sm">
                                {formatCurrency(itemRefund)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {isSelected && (
                        <div className="mt-2 pt-2 border-t border-blue-100 flex justify-between text-xs text-blue-800">
                          <span className="flex items-center gap-1">
                            <PackageCheck size={14} className="text-emerald-600" />
                            <strong>+{currentQty} units</strong> will be added back to stock
                          </span>
                          <span>Max returnable: {soldQty} units</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Reason for Return */}
        {saleId && (
          <div>
            <label className="label text-sm font-semibold text-slate-900">3. Return Reason</label>
            <input
              value={reason}
              onChange={event => setReason(event.target.value)}
              className="input-field"
              placeholder="e.g. Customer request, damaged item, wrong product"
            />
          </div>
        )}

        {/* Total Summary Box */}
        {saleId && activeItems.length > 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 space-y-2">
            <div className="flex justify-between items-center border-b border-emerald-200/60 pb-2">
              <span className="text-xs uppercase font-bold text-emerald-800 tracking-wider">Total Customer Refund</span>
              <span className="text-2xl font-bold text-red-600">{formatCurrency(totalRefundAmount)}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-emerald-800 font-medium">Inventory Restock</span>
              <span className="font-bold text-emerald-800">+{totalUnitsToReturn} unit(s) added back to inventory</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
