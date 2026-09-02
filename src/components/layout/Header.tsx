import { Bell, Search, Menu, Banknote, CheckCircle, XCircle, Calendar, Building2, X, ArrowRight, AlertTriangle, Clock } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../lib/auth';
import { useNotifications } from '../../hooks/useNotifications';
import { getChequesSummary, fetchCheques, updateChequeStatus, getChequeMaturityInfo, type Cheque } from '../../services/cheques';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { useToast } from '../ui/Toast';

interface HeaderProps {
  onMenuToggle: () => void;
}

// ── Cheque quick-action row inside the dropdown ───────────────────────────────
function ChequeRow({ cheque, onDone }: { cheque: Cheque; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const navigate = useNavigate();

  const maturity = getChequeMaturityInfo(cheque.due_date, cheque.status);

  const clearMutation = useMutation({
    mutationFn: () => updateChequeStatus(cheque.id, 'CLEARED'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cheques'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-summary'] });
      toast('success', `✓ Cheque ${cheque.cheque_number} marked as Cleared.`);
      onDone();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const bounceMutation = useMutation({
    mutationFn: () => updateChequeStatus(cheque.id, 'BOUNCED'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cheques'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-summary'] });
      toast('error', `✕ Cheque ${cheque.cheque_number} marked as Bounced.`);
      onDone();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const isBusy = clearMutation.isPending || bounceMutation.isPending;
  const isOverdue = maturity.isOverdue;

  return (
    <div
      className={`rounded-xl border p-3 space-y-2 transition-colors ${
        isOverdue
          ? 'border-red-200 bg-red-50/60'
          : 'border-gray-100 bg-gray-50/60 hover:bg-white'
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-mono text-xs font-bold text-blue-700">{cheque.cheque_number}</span>
          <span className="ml-2 text-xs text-gray-500">{cheque.type === 'RECEIVED' ? '← Received' : '→ Issued'}</span>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${maturity.badgeClass}`}>
          {maturity.label}
        </span>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div className="flex items-center gap-1 text-gray-600">
          <Building2 size={11} className="text-gray-400 shrink-0" />
          <span className="truncate font-medium">{cheque.party_name}</span>
        </div>
        <div className="flex items-center gap-1 text-gray-600">
          <Banknote size={11} className="text-gray-400 shrink-0" />
          <span className="font-semibold text-gray-900">{formatCurrency(Number(cheque.amount))}</span>
        </div>
        <div className="flex items-center gap-1 text-gray-500">
          <Building2 size={11} className="text-gray-400 shrink-0" />
          <span>{cheque.bank_name}</span>
        </div>
        <div className="flex items-center gap-1 text-gray-500">
          <Calendar size={11} className="text-gray-400 shrink-0" />
          <span>Due: {formatDate(cheque.due_date)}</span>
        </div>
        {cheque.notes && (
          <div className="col-span-2 text-gray-400 italic truncate">
            📝 {cheque.notes}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          disabled={isBusy}
          onClick={() => clearMutation.mutate()}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold py-1.5 transition-colors"
        >
          <CheckCircle size={12} />
          {clearMutation.isPending ? 'Clearing…' : 'Mark Cleared'}
        </button>
        <button
          disabled={isBusy}
          onClick={() => bounceMutation.mutate()}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold py-1.5 transition-colors"
        >
          <XCircle size={12} />
          {bounceMutation.isPending ? 'Saving…' : 'Mark Bounced'}
        </button>
        <button
          onClick={() => navigate(`/cheques?id=${cheque.id}`)}
          title="View full details"
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors"
        >
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Main Header ───────────────────────────────────────────────────────────────
export function Header({ onMenuToggle }: HeaderProps) {
  const { profile } = useAuth();
  const { unreadCount } = useNotifications();
  const isOwnerOrManager = profile?.role === 'OWNER' || profile?.role === 'MANAGER';

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  const { data: chequesSummary } = useQuery({
    queryKey: ['cheques-summary'],
    queryFn: getChequesSummary,
    enabled: isOwnerOrManager,
    refetchInterval: 15000,
  });

  // Only fetch the full pending list when the dropdown is opened
  const { data: pendingCheques = [], isLoading: pendingLoading } = useQuery({
    queryKey: ['cheques-pending-header'],
    queryFn: () => fetchCheques({ status: 'PENDING' }),
    enabled: isOwnerOrManager && dropdownOpen,
    staleTime: 10000,
  });

  const pendingCount = chequesSummary?.pendingCount ?? 0;
  const overdueCount = chequesSummary?.overdueCount ?? 0;
  const hasPendingCheques = Boolean(
    chequesSummary && (pendingCount > 0 || overdueCount > 0)
  );
  const totalPending = pendingCheques.length;

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6 z-30 relative">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuToggle}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 lg:hidden"
        >
          <Menu size={20} />
        </button>
        <div className="relative hidden sm:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            className="input-field pl-9 w-64"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* ── Cheque notification button + dropdown ── */}
        {isOwnerOrManager && hasPendingCheques && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all shadow-sm border ${
                overdueCount > 0
                  ? 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100 animate-pulse'
                  : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
              }`}
            >
              {overdueCount > 0 ? (
                <AlertTriangle size={13} />
              ) : (
                <Banknote size={13} />
              )}
              <span>
                {overdueCount > 0
                  ? `${overdueCount} Overdue Cheque${overdueCount > 1 ? 's' : ''}`
                  : `${pendingCount} Pending Cheque${pendingCount !== 1 ? 's' : ''}`}
              </span>
              {/* unread dot */}
              {overdueCount > 0 && (
                <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
                  {overdueCount}
                </span>
              )}
            </button>

            {/* ── Dropdown panel ── */}
            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-[360px] rounded-2xl border border-gray-200 bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
                {/* Panel header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <Banknote size={16} className="text-blue-600" />
                    <span className="font-bold text-gray-900 text-sm">Pending Cheques</span>
                    {overdueCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-[10px] font-bold border border-red-200">
                        <AlertTriangle size={10} />
                        {overdueCount} Overdue
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setDropdownOpen(false)}
                    className="rounded-lg p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors"
                  >
                    <X size={15} />
                  </button>
                </div>

                {/* Summary strip */}
                {chequesSummary && (
                  <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100 bg-white">
                    <div className="px-3 py-2 text-center">
                      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Pending</p>
                      <p className="text-sm font-bold text-gray-900">{pendingCount}</p>
                    </div>
                    <div className="px-3 py-2 text-center">
                      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Overdue</p>
                      <p className={`text-sm font-bold ${overdueCount > 0 ? 'text-red-600' : 'text-gray-900'}`}>{overdueCount}</p>
                    </div>
                    <div className="px-3 py-2 text-center">
                      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Due ≤15d</p>
                      <p className="text-sm font-bold text-amber-700">{chequesSummary.dueWithin15DaysCount}</p>
                    </div>
                  </div>
                )}

                {/* Cheque list */}
                <div className="overflow-y-auto max-h-[420px] p-3 space-y-2">
                  {pendingLoading ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-gray-400 text-sm">
                      <Clock size={16} className="animate-spin" />
                      Loading cheques…
                    </div>
                  ) : pendingCheques.length === 0 ? (
                    <div className="py-10 text-center text-gray-400 text-sm">
                      <CheckCircle size={32} className="mx-auto mb-2 text-emerald-400" />
                      All cheques have been processed!
                    </div>
                  ) : (
                    <>
                      {/* Overdue first */}
                      {pendingCheques
                        .slice()
                        .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
                        .map((cheque) => (
                          <ChequeRow
                            key={cheque.id}
                            cheque={cheque}
                            onDone={() => {
                              // keep open so user can process more; summary auto-refreshes
                            }}
                          />
                        ))}
                      <p className="text-center text-[11px] text-gray-400 pt-1">
                        Showing {totalPending} pending cheque{totalPending !== 1 ? 's' : ''}
                      </p>
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="border-t border-gray-100 px-4 py-2.5 bg-gray-50">
                  <Link
                    to="/cheques"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center justify-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    Open Cheque Management
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bell */}
        <Link
          to="/notifications"
          className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
              {unreadCount}
            </span>
          )}
        </Link>

        {/* User avatar */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-600">
            {profile?.full_name?.charAt(0) || 'U'}
          </div>
          <span className="hidden text-sm font-medium text-gray-700 sm:block">
            {profile?.full_name || 'User'}
          </span>
        </div>
      </div>
    </header>
  );
}
