import { Bell, Check, ArrowRight, ExternalLink, Banknote, Building2, Calendar, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNotifications, useMarkNotificationRead } from '../hooks/useNotifications';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { fetchCheques, updateChequeStatus, getChequeMaturityInfo, type Cheque } from '../services/cheques';
import { formatCurrency, formatDate, formatDateTime } from '../utils/helpers';
import { useToast } from '../components/ui/Toast';
import type { Notification } from '../types/database';

// ── Inline cheque card shown inside a cheque notification ─────────────────────
function InlineChequeCard({ entityId, notification }: { entityId: string; notification: Notification }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const markRead = useMarkNotificationRead();
  const navigate = useNavigate();

  const { data: cheques = [] } = useQuery({
    queryKey: ['cheque-detail-notif', entityId],
    queryFn: () => fetchCheques(),
    staleTime: 30000,
  });

  const cheque: Cheque | undefined = cheques.find((c) => c.id === entityId);

  const clearMutation = useMutation({
    mutationFn: () => updateChequeStatus(entityId, 'CLEARED'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cheques'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-summary'] });
      queryClient.invalidateQueries({ queryKey: ['cheque-detail-notif', entityId] });
      toast('success', `✓ Cheque marked as Cleared.`);
      if (!notification.read_at) markRead.mutate(notification.id);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const bounceMutation = useMutation({
    mutationFn: () => updateChequeStatus(entityId, 'BOUNCED'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cheques'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-summary'] });
      queryClient.invalidateQueries({ queryKey: ['cheque-detail-notif', entityId] });
      toast('error', `✕ Cheque marked as Bounced.`);
      if (!notification.read_at) markRead.mutate(notification.id);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  if (!cheque) return null;

  const maturity = getChequeMaturityInfo(cheque.due_date, cheque.status);
  const isBusy = clearMutation.isPending || bounceMutation.isPending;
  const canAction = cheque.status === 'PENDING';

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Cheque details */}
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="font-mono text-sm font-bold text-blue-700">{cheque.cheque_number}</span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${maturity.badgeClass}`}>
            {maturity.label}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="flex items-center gap-1.5 text-gray-700">
            <Building2 size={12} className="text-gray-400 shrink-0" />
            <span className="font-semibold truncate">{cheque.party_name}</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-700">
            <Banknote size={12} className="text-gray-400 shrink-0" />
            <span className="font-bold text-gray-900">{formatCurrency(Number(cheque.amount))}</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-500">
            <Building2 size={12} className="text-gray-400 shrink-0" />
            <span>{cheque.bank_name}</span>
            {cheque.drawer_title && <span className="text-gray-400">({cheque.drawer_title})</span>}
          </div>
          <div className="flex items-center gap-1.5 text-gray-500">
            <Calendar size={12} className="text-gray-400 shrink-0" />
            <span>Due: {formatDate(cheque.due_date)}</span>
          </div>
          <div className="text-gray-500">
            <span className="font-medium">Type:</span>{' '}
            <span className={cheque.type === 'RECEIVED' ? 'text-blue-700' : 'text-purple-700'}>
              {cheque.type === 'RECEIVED' ? '← Received' : '→ Issued'}
            </span>
          </div>
          {cheque.issue_date && (
            <div className="text-gray-500">
              <span className="font-medium">Issued:</span> {formatDate(cheque.issue_date)}
            </div>
          )}
          {cheque.account_number && (
            <div className="col-span-2 text-gray-500">
              <span className="font-medium">Account #:</span> {cheque.account_number}
            </div>
          )}
          {cheque.notes && (
            <div className="col-span-2 text-gray-400 italic truncate">
              📝 {cheque.notes}
            </div>
          )}
          {cheque.cleared_at && (
            <div className="col-span-2 text-emerald-600 text-xs font-semibold">
              ✓ Cleared on {formatDate(cheque.cleared_at)}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-3 pb-3">
        {canAction && (
          <>
            <button
              disabled={isBusy}
              onClick={() => clearMutation.mutate()}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold py-2 transition-colors"
            >
              <CheckCircle size={13} />
              {clearMutation.isPending ? 'Clearing…' : 'Mark Cleared'}
            </button>
            <button
              disabled={isBusy}
              onClick={() => bounceMutation.mutate()}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold py-2 transition-colors"
            >
              <XCircle size={13} />
              {bounceMutation.isPending ? 'Saving…' : 'Mark Bounced'}
            </button>
          </>
        )}
        <button
          onClick={() => navigate(`/cheques?id=${entityId}`)}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-semibold px-2 py-2 rounded-lg hover:bg-blue-50 transition-colors"
        >
          <ExternalLink size={12} />
          Full Details
        </button>
      </div>
    </div>
  );
}

// ── Main Notifications Page ───────────────────────────────────────────────────
export function NotificationsPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { notifications, isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();

  const isOwnerOrManager = profile?.role === 'OWNER' || profile?.role === 'MANAGER';

  const typeIcons: Record<string, string> = {
    LOW_STOCK: '📦', EXPIRED: '⏰', EXPIRING_SOON: '⏰',
    CREDIT_LIMIT: '💳', PAYMENT_DUE: '💰', LARGE_EXPENSE: '💸',
    CHEQUE_RECEIVED: '📜', CHEQUE_CLEARED: '✅', CHEQUE_BOUNCED: '❌',
  };

  const typeBg: Record<string, string> = {
    CHEQUE_RECEIVED: 'border-blue-100 bg-blue-50/50',
    CHEQUE_CLEARED: 'border-emerald-100 bg-emerald-50/50',
    CHEQUE_BOUNCED: 'border-red-100 bg-red-50/50',
  };

  const unreadCheques = notifications.filter(
    (n) => n.type?.includes('CHEQUE') && !n.read_at
  ).length;

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          {unreadCheques > 0 && isOwnerOrManager && (
            <p className="text-sm text-amber-700 font-medium mt-0.5 flex items-center gap-1.5">
              <AlertTriangle size={14} />
              {unreadCheques} cheque notification{unreadCheques > 1 ? 's' : ''} require your attention
            </p>
          )}
        </div>
        {notifications.some((n) => !n.read_at) && (
          <button
            onClick={() => {
              notifications.filter((n) => !n.read_at).forEach((n) => markRead.mutate(n.id));
            }}
            className="text-xs text-blue-600 hover:text-blue-800 font-semibold"
          >
            Mark all as read
          </button>
        )}
      </div>

      <div className="card">
        {isLoading ? (
          <p className="py-8 text-center text-gray-500">Loading...</p>
        ) : notifications.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            <Bell className="mx-auto mb-3 h-12 w-12 text-gray-300" />
            <p>No notifications</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => {
              const isCheque = n.type?.includes('CHEQUE');
              const bgClass = typeBg[n.type] || (n.read_at ? 'bg-white border-transparent' : 'bg-blue-50 border-blue-100');

              return (
                <div
                  key={n.id}
                  className={`rounded-xl border p-3.5 transition-colors ${bgClass}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl mt-0.5 shrink-0">{typeIcons[n.type] || '🔔'}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm leading-snug ${n.read_at ? 'text-gray-700' : 'font-semibold text-gray-900'}`}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.body}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">{formatDateTime(n.created_at)}</p>

                      {/* Inline cheque card for owners/managers */}
                      {isCheque && n.entity_id && isOwnerOrManager && (
                        <InlineChequeCard entityId={n.entity_id} notification={n} />
                      )}

                      {/* Fallback link for non-owners or no entity */}
                      {isCheque && !isOwnerOrManager && (
                        <button
                          onClick={() => {
                            const chequeId = n.entity_id ? `?id=${n.entity_id}` : '';
                            navigate(`/cheques${chequeId}`);
                            if (!n.read_at) markRead.mutate(n.id);
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800 font-semibold mt-1.5 flex items-center gap-1"
                        >
                          <ExternalLink size={11} />
                          View Cheque Details <ArrowRight size={12} />
                        </button>
                      )}
                    </div>
                    {!n.read_at && (
                      <button
                        onClick={() => markRead.mutate(n.id)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-green-600 transition-colors shrink-0"
                        title="Mark as read"
                      >
                        <Check size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
