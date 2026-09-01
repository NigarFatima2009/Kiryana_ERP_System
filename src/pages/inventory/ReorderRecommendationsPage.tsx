import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAllReorderRecommendations, getUrgentReorders } from '../../services/inventory';
import { createPurchaseOrder } from '../../services/purchasing';
import { fetchSuppliers } from '../../services/suppliers';
import { AlertCircle, Package, ShoppingCart } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/helpers';
import type { ReorderRecommendation } from '../../services/inventory';

export function ReorderRecommendationsPage() {
  const [showCreatePO, setShowCreatePO] = useState(false);
  const [selectedRec, setSelectedRec] = useState<ReorderRecommendation | null>(null);
  const [showUrgentOnly, setShowUrgentOnly] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: allRecs = [], isLoading } = useQuery({
    queryKey: ['reorder-recommendations'],
    queryFn: getAllReorderRecommendations,
    refetchInterval: 30000,
  });

  const { data: urgentRecs = [] } = useQuery({
    queryKey: ['urgent-reorders'],
    queryFn: getUrgentReorders,
    refetchInterval: 30000,
  });

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: () => fetchSuppliers({}).then(r => r.data) });

  const recommendations = showUrgentOnly ? urgentRecs : allRecs;

  const createPOMutation = useMutation({
    mutationFn: async (rec: ReorderRecommendation) => {
      const supplierId = selectedSupplierId || rec.suggested_supplier_id;
      if (!supplierId) {
        throw new Error('Please select a supplier before creating a purchase order.');
      }
      return createPurchaseOrder({
        supplier_id: supplierId,
        notes: `Auto-reorder: ${rec.reason}`,
        items: [{
          product_id: rec.product_id,
          quantity: rec.recommended_quantity,
          unit_cost: rec.last_purchase_price,
        }],
      });
    },
    onSuccess: () => {
      toast('success', 'Purchase order created');
      queryClient.invalidateQueries({ queryKey: ['reorder-recommendations'] });
      setShowCreatePO(false);
      setSelectedRec(null);
    },
    onError: (err: Error) => toast('error', err.message),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const totalCost = recommendations.reduce((s, r) => s + (r.estimated_cost || 0), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reorder Recommendations</h1>
          <p className="text-sm text-gray-500">Products below reorder level need restocking</p>
        </div>
        <button
          onClick={() => setShowUrgentOnly(!showUrgentOnly)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            showUrgentOnly
              ? 'bg-red-600 text-white'
              : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          {showUrgentOnly ? `Urgent Only (${urgentRecs.length})` : `All Items (${allRecs.length})`}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <Package size={16} /> To Order
          </div>
          <p className="text-2xl font-bold text-gray-900">{recommendations.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-red-500 text-sm mb-1">
            <AlertCircle size={16} /> Urgent
          </div>
          <p className="text-2xl font-bold text-red-600">{urgentRecs.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <ShoppingCart size={16} /> Est. Cost
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalCost)}</p>
        </div>
      </div>

      {/* Recommendations List */}
      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {recommendations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Package className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p>No reorder recommendations</p>
          </div>
        ) : (
          recommendations.map((rec) => (
            <div key={rec.product_id} className="flex items-center justify-between p-4 hover:bg-gray-50">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{rec.product_name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    rec.priority === 'URGENT' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {rec.priority}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-0.5">
                  Stock: {rec.current_stock} → Order: {rec.recommended_quantity} units
                  {' · '}{rec.supplier_name}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{rec.reason}</p>
              </div>
              <div className="flex items-center gap-3 ml-4">
                <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">
                  {formatCurrency(rec.estimated_cost)}
                </span>
                <button
                  onClick={() => { setSelectedRec(rec); setShowCreatePO(true); }}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 whitespace-nowrap"
                >
                  Create PO
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create PO Modal */}
      <Modal
        isOpen={showCreatePO}
        onClose={() => { setShowCreatePO(false); setSelectedRec(null); setSelectedSupplierId(''); }}
        title="Create Purchase Order"
      >
        {selectedRec && (
          <div className="space-y-4">
            {/* Product Summary */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Product</span>
                <span className="font-medium">{selectedRec.product_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Quantity</span>
                <span className="font-medium">{selectedRec.recommended_quantity} units</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Unit Price</span>
                <span className="font-medium">{formatCurrency(selectedRec.last_purchase_price)}</span>
              </div>
              <div className="border-t border-gray-200 pt-2 flex justify-between">
                <span className="text-gray-900 font-semibold">Total</span>
                <span className="font-bold text-lg">{formatCurrency(selectedRec.estimated_cost)}</span>
              </div>
            </div>

            {/* Supplier Dropdown */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Supplier *</label>
              <select
                value={selectedSupplierId || selectedRec.suggested_supplier_id || ''}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="select-field w-full"
              >
                <option value="">Select supplier</option>
                {(suppliers as { id: string; name: string }[]).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Info */}
            <div className="bg-blue-50 rounded-lg p-3 text-sm">
              <p><span className="font-medium">Lead Time:</span> {selectedRec.lead_time_days} days</p>
              <p><span className="font-medium">Reason:</span> {selectedRec.reason}</p>
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowCreatePO(false); setSelectedRec(null); setSelectedSupplierId(''); }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => selectedRec && createPOMutation.mutate(selectedRec)}
                disabled={createPOMutation.isPending}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
              >
                {createPOMutation.isPending ? 'Creating...' : 'Create PO'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
