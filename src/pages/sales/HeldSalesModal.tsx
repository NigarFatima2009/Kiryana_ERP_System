import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cancelSale } from '../../services/sales';
import { Modal } from '../../components/ui/Modal';
import { formatCurrency } from '../../utils/helpers';
import type { Sale } from '../../types/database';

interface HeldSalesModalProps {
  heldSales: Sale[];
  onResume: (saleId: string) => void;
  onClose: () => void;
}

export function HeldSalesModal({
  heldSales,
  onResume,
  onClose,
}: HeldSalesModalProps) {
  const queryClient = useQueryClient();

  const cancelMutation = useMutation({
    mutationFn: cancelSale,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['held-sales'] });
    },
  });

  return (
    <Modal isOpen={true} onClose={onClose} title="Held Sales" size="md">
      {heldSales.length === 0 ? (
        <p className="py-8 text-center text-gray-500">No held sales</p>
      ) : (
        <div className="space-y-2">
          {heldSales.map((s: any) => (
            <div key={s.id} className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{s.invoice_number}</p>
                <p className="text-xs text-gray-500">
                  {formatCurrency(Number(s.total))} • {s.customers?.name || 'Walk-in'}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => onResume(s.id)} className="btn-primary text-xs py-1">
                  Resume
                </button>
                <button
                  onClick={() => cancelMutation.mutate(s.id)}
                  className="btn-danger text-xs py-1"
                  disabled={cancelMutation.isPending}
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
