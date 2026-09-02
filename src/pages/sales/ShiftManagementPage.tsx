import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  openCashierShift,
  closeCashierShift,
  resumeCashierShift,
  getCurrentShift,
  getUserShifts,
  MAX_SHIFT_MINUTES,
  type CashierShift,
  type ShiftSummary,
} from '../../services/cashier';
import { fetchSalesForShift } from '../../services/sales';
import { Clock, AlertCircle, CheckCircle, Activity, Eye, EyeOff } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency, formatDateTime } from '../../utils/helpers';

export function ShiftManagementPage() {
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [showOpenForm, setShowOpenForm] = useState(false);
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<ShiftSummary | null>(null);
  
  // Active Presence & Timer states
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [isActiveOnPage, setIsActiveOnPage] = useState(true);
  const [isShiftDurationReached, setIsShiftDurationReached] = useState(false);
  const lastActivityTimeRef = useRef(Date.now());
  const hasAutoPromptedRef = useRef(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get current shift
  const { data: currentShift, isLoading } = useQuery({
    queryKey: ['current-shift'],
    queryFn: getCurrentShift,
    refetchInterval: false,
    staleTime: 60000,
  });

  // Get sales for current shift
  const { data: shiftSales = [] } = useQuery({
    queryKey: ['shift-sales', currentShift?.id],
    queryFn: () => (currentShift ? fetchSalesForShift(currentShift.id) : Promise.resolve([])),
    enabled: !!currentShift?.id,
    refetchInterval: 5000,
  });

  // Get all shifts for history
  const { data: allShifts } = useQuery({
    queryKey: ['user-shifts'],
    queryFn: () => getUserShifts({ pageSize: 10 }),
  });

  // ---- Active Time Tracking & Idle / Background Detection ----
  // Restore active seconds from localStorage (tracks only time user is active on site)
  // IMPORTANT: We do NOT use wall-clock elapsed time — only actual active time matters.
  useEffect(() => {
    if (!currentShift) {
      setActiveSeconds(0);
      setIsShiftDurationReached(false);
      hasAutoPromptedRef.current = false;
      return;
    }

    const storageKey = `shift_active_seconds_${currentShift.id}`;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed)) {
        const capped = Math.min(parsed, MAX_SHIFT_MINUTES * 60);
        setActiveSeconds(capped);
        if (capped >= MAX_SHIFT_MINUTES * 60) {
          setIsShiftDurationReached(true);
        }
        return;
      }
    }

    // No stored value: start from 0 (don't use wall clock — only active time counts)
    setActiveSeconds(0);
    setIsShiftDurationReached(false);
  }, [currentShift?.id]);

  // Listen to global shift active updates from anywhere across the app (POS, Products, Sales, etc.)
  useEffect(() => {
    const handleShiftPresence = (event: Event) => {
      const customEvent = event as CustomEvent<{ shiftId: string; activeSeconds: number }>;
      if (customEvent.detail && currentShift && customEvent.detail.shiftId === currentShift.id) {
        setActiveSeconds(customEvent.detail.activeSeconds);
        setIsActiveOnPage(true);
      }
    };
    window.addEventListener('shift-presence-updated', handleShiftPresence);
    return () => window.removeEventListener('shift-presence-updated', handleShiftPresence);
  }, [currentShift?.id]);

  // Track user interaction (mouse, key, touch, click)
  useEffect(() => {
    const handleUserActivity = () => {
      lastActivityTimeRef.current = Date.now();
      if (!isActiveOnPage && document.visibilityState === 'visible') {
        setIsActiveOnPage(true);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setIsActiveOnPage(false);
      } else {
        lastActivityTimeRef.current = Date.now();
        setIsActiveOnPage(true);
      }
    };

    window.addEventListener('mousemove', handleUserActivity, { passive: true });
    window.addEventListener('keydown', handleUserActivity, { passive: true });
    window.addEventListener('click', handleUserActivity, { passive: true });
    window.addEventListener('touchstart', handleUserActivity, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('click', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isActiveOnPage]);

  // Active Timer Tick: only increments when tab is visible and active within 2-minute idle window
  useEffect(() => {
    if (!currentShift) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const idleTimeMs = now - lastActivityTimeRef.current;
      const isUserIdle = idleTimeMs > 300_000; // 5 minutes without input = idle
      const isVisible = document.visibilityState === 'visible';
      const isCurrentlyActive = isVisible && !isUserIdle;

      setIsActiveOnPage(isCurrentlyActive);

      if (isCurrentlyActive) {
        setActiveSeconds((prev) => {
          const next = prev + 1;
          const maxSeconds = MAX_SHIFT_MINUTES * 60;

          // Save to local storage for persistence across reloads
          localStorage.setItem(`shift_active_seconds_${currentShift.id}`, next.toString());

          // Check if maximum shift duration has been reached
          if (next >= maxSeconds && !isShiftDurationReached) {
            setIsShiftDurationReached(true);
            if (!hasAutoPromptedRef.current) {
              hasAutoPromptedRef.current = true;
              setShowCloseForm(true);
              toast('warning', `Shift duration (${MAX_SHIFT_MINUTES} mins) completed! Please reconcile and close shift.`);
            }
          }

          return next;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentShift?.id, isShiftDurationReached, toast]);

  const openMutation = useMutation({
    mutationFn: (amount: number) => openCashierShift(amount),
    onSuccess: (data) => {
      toast('success', `Shift opened with Rs. ${formatCurrency(data.opening_cash)}`);
      queryClient.setQueryData(['current-shift'], data as CashierShift);
      queryClient.invalidateQueries({ queryKey: ['shift-sales'] });
      queryClient.invalidateQueries({ queryKey: ['user-shifts'] });
      setOpeningCash('');
      setShowOpenForm(false);
      setActiveSeconds(0);
      setIsShiftDurationReached(false);
      hasAutoPromptedRef.current = false;
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
      if (currentShift?.id) {
        localStorage.removeItem(`shift_active_seconds_${currentShift.id}`);
      }
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
      <div className="space-y-4 max-w-2xl mx-auto py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Shift Closed & Reconciled</h1>
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800">
            COMPLETED
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-2 text-sm">Cash Reconciliation</h3>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-600">Opening Float:</span>
                <span className="font-bold">{formatCurrency(shiftSummary.opening_cash)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Sales:</span>
                <span className="font-bold text-green-600">{formatCurrency(shiftSummary.total_sales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Expected in Till:</span>
                <span className="font-bold">{formatCurrency(shiftSummary.expected_cash || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Actual Counted:</span>
                <span className="font-bold">{formatCurrency(shiftSummary.closing_cash || 0)}</span>
              </div>
              <div className="flex justify-between border-t pt-1.5 font-bold text-sm">
                <span>Variance:</span>
                <span className={shiftSummary.variance === 0 ? 'text-green-600' : 'text-red-600'}>
                  {shiftSummary.variance === 0
                    ? '✓ Balanced'
                    : `${shiftSummary.variance! > 0 ? '+' : '-'}${formatCurrency(Math.abs(shiftSummary.variance || 0))}`}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-2 text-sm">Performance Summary</h3>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-600">Transactions:</span>
                <span className="font-bold">{shiftSummary.sales_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Avg Transaction:</span>
                <span className="font-bold">{formatCurrency(shiftSummary.sales_count > 0 ? shiftSummary.average_transaction : 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Opened At:</span>
                <span>{formatDateTime(shiftSummary.opened_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Closed At:</span>
                <span>{shiftSummary.closed_at ? formatDateTime(shiftSummary.closed_at) : 'Just now'}</span>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            setShiftSummary(null);
            setShowOpenForm(true);
          }}
          className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 shadow transition"
        >
          Start New Shift
        </button>
      </div>
    );
  }

  // If no current shift, show open form directly
  if (!currentShift) {
    return (
      <div className="space-y-4 max-w-lg mx-auto py-6">
        <h1 className="text-xl font-bold text-gray-900">Shift Management</h1>

        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <h2 className="font-bold text-gray-900 mb-3 text-base">Open New Shift</h2>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Opening Cash Float (PKR) *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-semibold">Rs.</span>
                <input
                  type="number"
                  step="0.01"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium"
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Standard shift duty time: {MAX_SHIFT_MINUTES} minutes. Timer tracks active website presence.
              </p>
            </div>

            <button
              onClick={() => {
                if (!openingCash) {
                  toast('error', 'Please enter opening cash float');
                  return;
                }
                openMutation.mutate(parseFloat(openingCash));
              }}
              disabled={openMutation.isPending || !openingCash}
              className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition shadow"
            >
              {openMutation.isPending ? 'Opening Shift...' : 'Open Shift'}
            </button>
          </div>
        </div>

        {/* Previous Shifts list */}
        {(allShifts?.data?.length || 0) > 0 && (
          <div>
            <h3 className="font-semibold text-gray-800 text-xs uppercase tracking-wider mb-2">Recent Shifts</h3>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {allShifts?.data?.slice(0, 5).map((shift) => (
                <div
                  key={shift.id}
                  className="bg-white p-2.5 rounded-lg border border-gray-200 flex justify-between items-center text-xs"
                >
                  <span className="text-gray-700 font-medium">
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

  // Active time calculations
  const maxTotalSeconds = MAX_SHIFT_MINUTES * 60;
  const progressPercent = Math.min(100, Math.round((activeSeconds / maxTotalSeconds) * 100));
  const formattedActiveTime = formatActiveDuration(activeSeconds);
  const remainingSeconds = Math.max(0, maxTotalSeconds - activeSeconds);

  // If shift is open, show Active Shift view
  return (
    <div className="space-y-3">
      {/* Expiration alert banner if max shift duration completed */}
      {isShiftDurationReached && (
        <div className="bg-amber-500 text-white rounded-lg p-3 shadow-md flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <span>Shift Target Duration ({MAX_SHIFT_MINUTES} mins) Reached! Please reconcile cash and close shift.</span>
          </div>
          <button
            onClick={() => setShowCloseForm(true)}
            className="px-3 py-1.5 bg-white text-amber-900 rounded font-bold text-xs hover:bg-amber-50 transition shadow"
          >
            Reconcile & Close Now
          </button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-gray-900">Active Shift</h1>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
            isActiveOnPage ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isActiveOnPage ? 'bg-green-500 animate-ping' : 'bg-gray-400'}`} />
            {isActiveOnPage ? 'Active on Screen' : 'Idle / Screen Off (Paused)'}
          </span>
        </div>
        <button
          onClick={() => setShowCloseForm(true)}
          className="px-4 py-1.5 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 transition shadow"
        >
          Close Shift
        </button>
      </div>

      {/* Shift Summary Card */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <p className="text-gray-500 font-medium">Opening Cash</p>
            <p className="font-bold text-lg text-gray-900 mt-0.5">{formatCurrency(currentShift.opening_cash)}</p>
          </div>
          <div>
            <div className="flex items-center gap-1 text-gray-500 font-medium">
              <span>Active Time Elapsed</span>
              {isActiveOnPage ? <Eye className="w-3.5 h-3.5 text-green-600" /> : <EyeOff className="w-3.5 h-3.5 text-gray-400" />}
            </div>
            <p className="font-bold text-lg text-blue-600 mt-0.5">{formattedActiveTime}</p>
          </div>
          <div>
            <p className="text-gray-500 font-medium">Total Sales</p>
            <p className="font-bold text-lg text-green-600 mt-0.5">{formatCurrency(totalSales)}</p>
          </div>
          <div>
            <p className="text-gray-500 font-medium">Transactions</p>
            <p className="font-bold text-lg text-gray-900 mt-0.5">{shiftSales.length}</p>
          </div>
        </div>

        {/* Time Progress Bar */}
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="flex justify-between text-xs mb-1.5 font-medium">
            <span className="text-gray-600 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> Duty Target: {MAX_SHIFT_MINUTES} minutes
            </span>
            <span className={isShiftDurationReached ? 'text-green-600 font-bold' : 'text-gray-500'}>
              {isShiftDurationReached ? '✓ Duration Completed' : `${formatActiveDuration(remainingSeconds)} remaining`}
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
            <div
              className={`h-2.5 rounded-full transition-all duration-300 ${
                isShiftDurationReached ? 'bg-green-500' : 'bg-blue-600'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            * Note: Active time only counts when screen is active on site making sales or working. Pauses when screen is off or idle.
          </p>
        </div>
      </div>

      {/* Sales Made This Shift */}
      {shiftSales.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <h3 className="font-bold text-gray-900 text-sm mb-2">
            Sales in this Shift ({shiftSales.length}) — Total: {formatCurrency(totalSales)}
          </h3>
          <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {shiftSales.map((sale: any) => (
              <div key={sale.id} className="py-2 flex justify-between items-center text-xs hover:bg-gray-50 px-1 rounded">
                <div>
                  <p className="font-semibold text-gray-900">{formatDateTime(sale.created_at)}</p>
                  <p className="text-gray-500">{sale.items?.length || 0} items • {sale.invoice_number || 'Sale'}</p>
                  {sale.created_by_email && <p className="text-gray-400 text-[10px]">{sale.created_by_email}</p>}
                </div>
                <span className="font-bold text-sm text-gray-900">{formatCurrency(sale.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Close Shift Modal */}
      <Modal
        isOpen={showCloseForm}
        onClose={() => setShowCloseForm(false)}
        title="Reconcile & Close Shift"
      >
        <div className="space-y-3">
          <div className="bg-gray-50 rounded-lg p-3 text-sm border border-gray-200">
            <div className="flex justify-between mb-1 text-xs">
              <span className="text-gray-600">Opening Cash Float:</span>
              <span className="font-bold">{formatCurrency(currentShift.opening_cash)}</span>
            </div>
            <div className="flex justify-between mb-1 text-xs">
              <span className="text-gray-600">Auto-Tracked Sales:</span>
              <span className="font-bold text-green-600">{formatCurrency(totalSales)}</span>
            </div>
            <div className="flex justify-between mb-1 text-xs">
              <span className="text-gray-600">Transactions Count:</span>
              <span className="font-bold">{shiftSales.length}</span>
            </div>
            <div className="flex justify-between border-t pt-2 font-bold bg-white p-2 rounded mt-1 border-gray-200">
              <span className="text-gray-800">Total Expected in Till:</span>
              <span className="text-green-600 text-base">{formatCurrency(currentShift.opening_cash + totalSales)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Actual Cash Counted in Till (Float + Cash Sales) *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold text-sm">
                Rs.
              </span>
              <input
                type="number"
                step="0.01"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
                placeholder={`Expected: ${formatCurrency(currentShift.opening_cash + totalSales)}`}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 font-medium"
                autoFocus
              />
            </div>
          </div>

          {closingCash && (
            <div className={`p-2.5 rounded-lg text-xs font-semibold border ${
              Math.abs(parseFloat(closingCash) - (currentShift.opening_cash + totalSales)) < 1
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}>
              <p>
                Variance: {parseFloat(closingCash) - (currentShift.opening_cash + totalSales) > 0 ? '+' : ''}
                {formatCurrency(parseFloat(closingCash) - (currentShift.opening_cash + totalSales))}
                {Math.abs(parseFloat(closingCash) - (currentShift.opening_cash + totalSales)) < 1 ? ' (✓ Balanced)' : ''}
              </p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => {
                setShowCloseForm(false);
                setClosingCash('');
              }}
              className="flex-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!closingCash) {
                  toast('error', 'Please enter closing cash counted in till');
                  return;
                }
                closeMutation.mutate(parseFloat(closingCash));
              }}
              disabled={closeMutation.isPending || !closingCash}
              className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm font-bold transition shadow"
            >
              {closeMutation.isPending ? 'Closing Shift...' : 'Finalize & Close Shift'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Format seconds into readable duration string
function formatActiveDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

// Helper to get proper Date object handling UTC timestamps
function getProperDate(dateStr: string | Date): Date {
  if (typeof dateStr === 'string') {
    const hasTimezone = dateStr.includes('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr);
    if (hasTimezone) {
      return new Date(dateStr);
    } else {
      return new Date(dateStr + 'Z');
    }
  }
  return dateStr;
}
