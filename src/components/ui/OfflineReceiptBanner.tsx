/**
 * Offline Receipt Banner Component
 * 
 * Displays after completing an offline sale
 * Clearly indicates that sale is pending synchronization
 */

import { AlertCircle, Clock } from 'lucide-react';
import type { OfflineSale } from '../../lib/offline/types';

interface Props {
  sale: OfflineSale;
}

export function OfflineReceiptBanner({ sale }: Props) {
  return (
    <div className="rounded-lg border-2 border-orange-200 bg-orange-50 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-orange-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-semibold text-orange-900">Offline Sale</h3>
          <p className="mt-1 text-sm text-orange-800">
            This sale was created while offline and is pending synchronization with the server.
            It will be automatically synced when the connection returns.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="font-medium text-orange-900">Invoice:</span>{' '}
              <span className="text-orange-700">{sale.invoice_number}</span>
            </div>
            <div>
              <span className="font-medium text-orange-900">Status:</span>{' '}
              <span className="text-orange-700">
                {sale.status === 'pending_sync' ? 'Pending Sync' : sale.status}
              </span>
            </div>
            <div>
              <span className="font-medium text-orange-900">Client ID:</span>{' '}
              <span className="text-orange-700 text-xs">{sale.client_transaction_id}</span>
            </div>
            <div>
              <span className="font-medium text-orange-900">Created:</span>{' '}
              <span className="text-orange-700">
                {new Date(sale.created_at).toLocaleTimeString()}
              </span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-lg bg-orange-100 px-3 py-2 text-xs font-medium text-orange-900">
            <Clock className="h-4 w-4" />
            Do not close this browser or restart until the sale is synced.
          </div>
        </div>
      </div>
    </div>
  );
}
