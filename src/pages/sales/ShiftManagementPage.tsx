import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  openCashierShift,
  closeCashierShift,
  getCurrentShift,
  getShiftSummary,
  getUserShifts,
  getTodayShiftDashboard,
} from '../../services/cashier';
import { fetchSalesForShift } from '../../services/sales';
import { Clock, LogOut, AlertCircle } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import type { CashierShift, ShiftSummary } from '../../services/cashier';
import type { Sale } from '../../types/database';

export function ShiftManagementPage() {
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [showOpenForm, setShowOpenForm] = useState(false);
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<ShiftSummary | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get current shift
  const { data: currentShift, isLoading } = useQuery({
    queryKey: ['current-shift'],
    queryFn: getCurrentShift,
    refetchInterval: 5000,
  });

  // Get sales for current shift
  const { data: shiftSales = [] } = useQuery({
    queryKey: ['shift-sales', currentShift?.id],
    queryFn: () => (currentShift ? fetchSalesForShift(currentShift.id) : Promise.resolve([])),
    enabled: !!currentShift?.id,
    refetchInterval: 5000,
  });

  // Log for debugging
  useEffect(() => {
    if (currentShift === null) {
      console.log('⚠️ No current shift found');
    } else if (currentShift) {
      console.log('✅ Current shift found:', { id: currentShift.id, status: currentShift.status });
    }
  }, [currentShift]);

  // Get all shifts for history
  const { data: allShifts } = useQuery({
    queryKey: ['user-shifts'],
    queryFn: () => getUserShifts({ pageSize: 10 }),
  });

  const openMutation = useMutation({
    mutationFn: (amount: number) => openCashierShift(amount),
    onSuccess: (data) => {
      toast('success', `Shift opened with Rs. ${formatCurrency(data.opening_cash)}`);
      queryClient.invalidateQueries({ queryKey: ['current-shift'] });
      queryClient.invalidateQueries({ queryKey: ['shift-sales'] });
      setOpeningCash('');
      setShowOpenForm(false);
    },
    onError: (error: any) => {
      toast('error', `Failed to open shift: ${error.message}`);
    },
  });

  const closeMutation = useMutation({
    mutationFn: (amount: number) => {
      if (!currentShift) throw new Error('No active shift');
      return closeCashierShift(currentShift.id, amount);
    },
    onSuccess: (data) => {
      const varianceStatus = data.variance === 0 ? '✓ Balanced' : `${data.variance! > 0 ? '+' : ''}Rs. ${formatCurrency(Math.abs(data.variance || 0))}`;
      toast('success', `Shift closed. Variance: ${varianceStatus}`);
      queryClient.invalidateQueries({ queryKey: ['current-shift'] });
      queryClient.invalidateQueries({ queryKey: ['shift-sales'] });
      queryClient.invalidateQueries({ queryKey: ['user-shifts'] });
      setClosingCash('');
      setShowCloseForm(false);
      setShiftSummary(data);
    },
    onError: (error: any) => {
      toast('error', `Failed to close shift: ${error.message}`);
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const totalSales = shiftSales.reduce((sum, s) => sum + (s.total || 0), 0);

  // If shift is closed, show summary
  if (!currentShift && shiftSummary) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold text-gray-900">Shift Summary</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-white border border-gray-200 rounded p-4">
            <h3 className="font-semibold text-gray-900 mb-2 text-sm">Cash Summary</h3>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-600">Opening:</span>
                <span className="font-bold">{formatCurrency(shiftSummary.opening_cash)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Sales:</span>
                <span className="font-bold">{formatCurrency(shiftSummary.total_sales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Expected:</span>
                <span className="font-bold">{formatCurrency(shiftSummary.expected_cash || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Actual:</span>
                <span className="font-bold">{formatCurrency(shiftSummary.closing_cash || 0)}</span>
              </div>
              <div className="flex justify-between border-t pt-1">
                <span className="font-bold">Variance:</span>
                <span className="font-bold">
                  {shiftSummary.variance === 0
                    ? '✓ Balanced'
                    : `${shiftSummary.variance! > 0 ? '+' : '-'}${formatCurrency(Math.abs(shiftSummary.variance || 0))}`}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded p-4">
            <h3 className="font-semibold text-gray-900 mb-2 text-sm">Summary</h3>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-600">Transactions:</span>
                <span className="font-bold">{shiftSummary.sales_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Avg Transaction:</span>
                <span className="font-bold">{formatCurrency(shiftSummary.sales_count > 0 ? shiftSummary.average_transaction : 0)}</span>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            setShiftSummary(null);
            setShowOpenForm(true);
          }}
          className="w-full px-3 py-2 bg-blue-600 text-white rounded text-sm font-semibold hover:bg-blue-700"
        >
          Start New Shift
        </button>
      </div>
    );
  }

  // If no current shift, show open form
  if (!currentShift) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold text-gray-900">Shift Management</h1>

        <div className="max-w-md">
          <div className="bg-white rounded border border-gray-200 p-4">
            <h2 className="font-bold text-gray-900 mb-3">Open New Shift</h2>

            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Opening Cash
                </label>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-500 text-sm">Rs.</span>
                  <input
                    type="number"
                    step="0.01"
                    value={openingCash}
                    onChange={(e) => setOpeningCash(e.target.value)}
                    placeholder="e.g., 10000"
                    className="w-full pl-8 pr-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <button
                onClick={() => {
                  if (!openingCash) {
                    toast('error', 'Please enter opening cash');
                    return;
                  }
                  openMutation.mutate(parseFloat(openingCash));
                }}
                disabled={openMutation.isPending || !openingCash}
                className="w-full px-3 py-2 bg-blue-600 text-white rounded text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {openMutation.isPending ? 'Opening...' : 'Open Shift'}
              </button>
            </div>
          </div>
        </div>

        {/* Previous Shifts */}
        {(allShifts?.data?.length || 0) > 0 && (
          <div>
            <h3 className="font-semibold text-gray-900 text-sm mb-2">Recent Shifts</h3>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {allShifts?.data?.slice(0, 5).map((shift) => (
                <div
                  key={shift.id}
                  className="bg-white p-2 rounded border border-gray-200 flex justify-between items-center text-xs"
                >
                  <span className="text-gray-600">
                    {formatDateTime(shift.opened_at)}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      shift.status === 'OPEN'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-green-100 text-green-800'
                    }`}
                  >
                    {shift.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // If shift is open, show current shift with sales
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-bold text-gray-900">Active Shift</h1>
        <button
          onClick={() => setShowCloseForm(true)}
          className="px-3 py-1.5 bg-red-600 text-white rounded text-sm font-semibold hover:bg-red-700"
        >
          Close Shift
        </button>
      </div>

      {/* Shift Summary Card */}
      <div className="bg-white border border-gray-200 rounded p-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div>
            <p className="text-gray-600">Opening Cash</p>
            <p className="font-bold text-lg">{formatCurrency(currentShift.opening_cash)}</p>
          </div>
          <div>
            <p className="text-gray-600">Time Elapsed</p>
            <p className="font-bold text-lg">{calculateTimeElapsed(new Date(currentShift.opened_at))}</p>
          </div>
          <div>
            <p className="text-gray-600">Total Sales</p>
            <p className="font-bold text-lg text-green-600">{formatCurrency(totalSales)}</p>
          </div>
          <div>
            <p className="text-gray-600">Transactions</p>
            <p className="font-bold text-lg">{shiftSales.length}</p>
          </div>
        </div>

        {/* Time Progress Bar */}
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-600">Shift Duration</span>
            <span className="text-gray-600">{formatDateTime(currentShift.opened_at)}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{
                width: `${Math.min((new Date().getTime() - new Date(currentShift.opened_at).getTime()) / (12 * 60 * 60 * 1000) * 100, 100)}%`
              }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">Typical shift: 12 hours</p>
        </div>
      </div>

      {/* Sales Made This Shift */}
      {shiftSales.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Sales ({shiftSales.length}) - Total: {formatCurrency(totalSales)}</h3>
          <div className="bg-white border border-gray-200 rounded divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {shiftSales.map((sale) => (
              <div key={sale.id} className="p-2 flex justify-between items-center text-xs">
                <div>
                  <p className="font-medium text-gray-900">{formatDateTime(sale.created_at)}</p>
                  <p className="text-gray-600">{sale.items?.length || 0} items</p>
                </div>
                <span className="font-bold">{formatCurrency(sale.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Close Shift Modal */}
      <Modal
        isOpen={showCloseForm}
        onClose={() => setShowCloseForm(false)}
        title="Close Shift"
      >
        <div className="space-y-3">
          <div className="bg-gray-50 rounded p-3 text-sm">
            <div className="flex justify-between mb-1">
              <span className="text-gray-600">Opening Cash:</span>
              <span className="font-bold">{formatCurrency(currentShift.opening_cash)}</span>
            </div>
            <div className="flex justify-between mb-1">
              <span className="text-gray-600">Total Sales (Auto-tracked):</span>
              <span className={`font-bold ${totalSales > 0 ? 'text-green-600' : 'text-gray-500'}`}>
                {totalSales > 0 ? formatCurrency(totalSales) : (shiftSales.length > 0 ? formatCurrency(totalSales) : 'Loading...')}
              </span>
            </div>
            <div className="flex justify-between mb-1">
              <span className="text-gray-600">Transactions:</span>
              <span className="font-bold">{shiftSales.length}</span>
            </div>
            <div className="flex justify-between border-t pt-1 font-bold bg-white p-2 rounded">
              <span>Auto-Calculated Expected:</span>
              <span className="text-green-600">{formatCurrency(currentShift.opening_cash + totalSales)}</span>
            </div>
          </div>

          {shiftSales.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded p-2 text-xs text-green-700">
              <p><strong>✓ Sales Detected:</strong> {shiftSales.length} transaction(s) totaling {formatCurrency(totalSales)} automatically added to expected amount.</p>
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-700">
            <p><strong>Note:</strong> Sales are automatically tracked from the POS system. The expected amount is calculated automatically. Enter what you count in the till below.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Actual Cash Counted in Till
            </label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-500">
                Rs.
              </span>
              <input
                type="number"
                step="0.01"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
                placeholder={`Expected: ${formatCurrency(currentShift.opening_cash + totalSales)}`}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Count all cash in your till (float + sales) and enter the amount
            </p>
          </div>

          {closingCash && (
            <div className={`p-2 rounded text-sm ${
              Math.abs(parseFloat(closingCash) - (currentShift.opening_cash + totalSales)) < 1
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-yellow-50 border border-yellow-200 text-yellow-700'
            }`}>
              <p className="font-semibold">
                Variance: {parseFloat(closingCash) - (currentShift.opening_cash + totalSales) > 0 ? '+' : ''}
                {formatCurrency(parseFloat(closingCash) - (currentShift.opening_cash + totalSales))}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowCloseForm(false);
                setClosingCash('');
              }}
              className="flex-1 px-3 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!closingCash) {
                  toast('error', 'Please enter closing cash amount');
                  return;
                }
                closeMutation.mutate(parseFloat(closingCash));
              }}
              disabled={closeMutation.isPending || !closingCash}
              className="flex-1 px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
            >
              {closeMutation.isPending ? 'Closing...' : 'Close Shift'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Helper function to calculate time elapsed
function calculateTimeElapsed(startTime: Date): string {
  const now = new Date();
  const diff = Math.floor((now.getTime() - startTime.getTime()) / 1000);

  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
