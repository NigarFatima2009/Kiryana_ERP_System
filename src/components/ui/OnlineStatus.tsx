import { Wifi, WifiOff, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export function OnlineStatus() {
  const { isOnline, queueSize, forceSync } = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Don't show anything if online and no queue and dismissed
  if (isOnline && queueSize === 0 && dismissed) return null;

  // Show offline banner
  if (!isOnline) {
    return (
      <div className="fixed bottom-4 right-4 z-50 max-w-sm">
        <div className="rounded-lg border border-red-200 bg-white p-3 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-red-100 p-2">
              <WifiOff size={16} className="text-red-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">You're offline</p>
              <p className="text-xs text-gray-500">
                {queueSize > 0
                  ? `${queueSize} change${queueSize > 1 ? 's' : ''} saved locally`
                  : 'Changes will sync when reconnected'}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show sync banner (online but has queued changes)
  if (queueSize > 0) {
    return (
      <div className="fixed bottom-4 right-4 z-50 max-w-sm">
        <div className="rounded-lg border border-yellow-200 bg-white p-3 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-yellow-100 p-2">
              <RefreshCw size={16} className={`text-yellow-600 ${syncing ? 'animate-spin' : ''}`} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">Syncing changes</p>
              <p className="text-xs text-gray-500">
                {queueSize} pending change{queueSize > 1 ? 's' : ''}
              </p>
            </div>
            <button
              onClick={async () => {
                setSyncing(true);
                await forceSync();
                setSyncing(false);
              }}
              className="rounded p-1 hover:bg-gray-100"
              title="Sync now"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show brief "back online" notification
  if (dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-white px-3 py-2 shadow-lg">
        <div className="rounded-full bg-green-100 p-1.5">
          <Wifi size={14} className="text-green-600" />
        </div>
        <span className="text-xs font-medium text-green-700">Back online</span>
        <button
          onClick={() => setDismissed(true)}
          className="ml-1 rounded p-0.5 hover:bg-gray-100"
        >
          <X size={12} className="text-gray-400" />
        </button>
      </div>
    </div>
  );
}
