import { Bell, Check, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNotifications, useMarkNotificationRead } from '../hooks/useNotifications';
import { formatDateTime } from '../utils/helpers';

export function NotificationsPage() {
  const navigate = useNavigate();
  const { notifications, isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();

  const typeIcons: Record<string, string> = {
    LOW_STOCK: '📦', EXPIRED: '⏰', EXPIRING_SOON: '⏰',
    CREDIT_LIMIT: '💳', PAYMENT_DUE: '💰', LARGE_EXPENSE: '💸',
    CHEQUE_RECEIVED: '📜', CHEQUE_CLEARED: '✓', CHEQUE_BOUNCED: '✕',
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>

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
            {notifications.map((n) => (
              <div key={n.id} className={`flex items-start gap-3 rounded-lg p-3 ${n.read_at ? 'bg-white' : 'bg-blue-50'}`}>
                <span className="text-xl">{typeIcons[n.type] || '🔔'}</span>
                <div className="flex-1">
                  <p className={`text-sm ${n.read_at ? '' : 'font-medium'}`}>{n.title}</p>
                  {n.body && <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>}
                  <p className="text-xs text-gray-400 mt-1">{formatDateTime(n.created_at)}</p>
                  {n.type?.includes('CHEQUE') && (
                    <button
                      onClick={() => navigate('/cheques')}
                      className="text-xs text-blue-600 hover:text-blue-800 font-semibold mt-1 flex items-center gap-1"
                    >
                      Open Cheque Management <ArrowRight size={12} />
                    </button>
                  )}
                </div>
                {!n.read_at && (
                  <button onClick={() => markRead.mutate(n.id)} className="rounded p-1 text-gray-400 hover:bg-white hover:text-green-600" title="Mark as read">
                    <Check size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
