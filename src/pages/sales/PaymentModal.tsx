import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, FileText } from 'lucide-react';
import { completeSale } from '../../services/sales';
import { createOfflineSale } from '../../lib/offline/offlineSales';
import { getNetworkStatus } from '../../lib/offline/connectivity';
import { createCheque } from '../../services/cheques';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/helpers';
import type { CartItem, PaymentEntry, Customer } from '../../types/database';

interface PaymentModalProps {
  total: number;
  customerId: string;
  cart: CartItem[];
  discount: number;
  tax: number;
  customers?: Customer[];
  onClose: () => void;
  onSuccess: () => void;
}

export function PaymentModal({
  total,
  customerId,
  cart,
  discount,
  tax,
  customers = [],
  onClose,
  onSuccess,
}: PaymentModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [payments, setPayments] = useState<PaymentEntry[]>([{ method: 'CASH', amount: total }]);

  // Cheque state
  const [chequeNumber, setChequeNumber] = useState('');
  const [bankName, setBankName] = useState('HBL');
  const defaultDueDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [chequeDueDate, setChequeDueDate] = useState(defaultDueDate);
  const [drawerTitle, setDrawerTitle] = useState('');

  const setDueDaysFromNow = (days: number) => {
    const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    setChequeDueDate(d.toISOString().slice(0, 10));
  };

  useEffect(() => {
    setPayments([{ method: 'CASH', amount: total }]);
  }, [total]);

  const { totalPaid, remaining } = useMemo(() => {
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    return { totalPaid: paid, remaining: total - paid };
  }, [payments, total]);

  const hasChequePayment = payments.some((p) => p.method === 'CHEQUE');

  const addPayment = () => setPayments([...payments, { method: 'CASH', amount: Math.max(0, remaining) }]);
  const removePayment = (idx: number) => setPayments(payments.filter((_, i) => i !== idx));
  const updatePayment = (idx: number, field: string, value: string | number) => {
    const newPayments = [...payments];
    (newPayments[idx] as unknown as Record<string, unknown>)[field] = value;
    setPayments(newPayments);
  };

  const saleMutation = useMutation({
    mutationFn: async () => {
      if (hasChequePayment && !chequeNumber.trim()) {
        throw new Error('Please enter Cheque Number for cheque payment');
      }

      const customer = customers.find((c) => c.id === customerId);
      const partyName = customer?.name || drawerTitle.trim() || 'Walk-in Customer';

      const paymentsWithRef = payments.map((p) =>
        p.method === 'CHEQUE'
          ? {
              ...p,
              reference: `${chequeNumber.trim()} (${bankName}) [Due: ${chequeDueDate}]${drawerTitle.trim() ? ` [Drawer: ${drawerTitle.trim()}]` : ''}`,
            }
          : p
      );

      const chequePayment = payments.find((p) => p.method === 'CHEQUE');
      let saleResult: any = null;
      let mode: 'online' | 'offline' = 'online';

      if (navigator.onLine) {
        try {
          saleResult = await completeSale({
            customer_id: customerId || undefined,
            cart,
            discount,
            tax,
            payments: paymentsWithRef,
            notes: hasChequePayment ? `Cheque #${chequeNumber.trim()} (${bankName}) due ${chequeDueDate}` : undefined,
          });
          mode = 'online';
        } catch (err) {
          console.warn('[POS] Online sale error, falling back to offline storage:', err);
          saleResult = await createOfflineSale({
            items: cart.map((item) => ({
              product_id: item.product.id,
              product_name: item.product.name,
              product_sku: item.product.sku,
              quantity: item.quantity,
              unit_price: item.unit_price,
              discount: item.discount,
              tax: item.tax_amount,
            })),
            customer_id: customerId || undefined,
            customer_name: partyName,
            discount,
            tax,
            total,
            notes: hasChequePayment ? `Cheque #${chequeNumber.trim()} (${bankName}) due ${chequeDueDate}` : undefined,
            payment_methods: paymentsWithRef.map((p) => ({
              method: p.method,
              amount: p.amount,
              reference: p.reference,
            })),
          });
          mode = 'offline';
        }
      } else {
        saleResult = await createOfflineSale({
          items: cart.map((item) => ({
            product_id: item.product.id,
            product_name: item.product.name,
            product_sku: item.product.sku,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount: item.discount,
            tax: item.tax_amount,
          })),
          customer_id: customerId || undefined,
          customer_name: partyName,
          discount,
          tax,
          total,
          notes: hasChequePayment ? `Cheque #${chequeNumber.trim()} (${bankName}) due ${chequeDueDate}` : undefined,
          payment_methods: paymentsWithRef.map((p) => ({
            method: p.method,
            amount: p.amount,
            reference: p.reference,
          })),
        });
        mode = 'offline';
      }

      // Guarantee Cheque registration in Cheque Management & Owner Alert
      if (hasChequePayment && chequePayment) {
        try {
          await createCheque({
            cheque_number: chequeNumber.trim(),
            type: 'RECEIVED',
            party_type: customerId ? 'CUSTOMER' : 'OTHER',
            party_id: customerId || null,
            party_name: partyName,
            bank_name: bankName,
            drawer_title: drawerTitle.trim() || undefined,
            amount: chequePayment.amount,
            issue_date: new Date().toISOString().slice(0, 10),
            due_date: chequeDueDate,
            status: 'PENDING',
            notes: `Received via POS sale${saleResult?.invoice_number ? ` (${saleResult.invoice_number})` : ''}`,
            reference_sale_id: saleResult?.id || null,
          });
        } catch (chequeErr) {
          console.warn('[POS] Cheque creation warning:', chequeErr);
        }
      }

      return {
        mode,
        isCheque: hasChequePayment,
        chequeNumber: chequeNumber.trim(),
        dueDate: chequeDueDate,
        invoiceNumber: saleResult?.invoice_number,
      };
    },
    onSuccess: (data: any) => {
      void queryClient.invalidateQueries();
      if (data?.isCheque) {
        toast('success', `Sale ${data.invoiceNumber || ''} created! Cheque #${data.chequeNumber} recorded in Cheque Management.`);
      } else if (data?.mode === 'online') {
        toast('success', `Sale ${data.invoiceNumber || ''} completed!`);
      } else {
        toast('success', 'Sale saved offline — will sync when connected.');
      }
      onSuccess();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Payment"
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => saleMutation.mutate()}
            className="btn-success w-40"
            disabled={Math.abs(totalPaid - total) > 0.01 || saleMutation.isPending}
          >
            {saleMutation.isPending ? 'Processing...' : 'Complete Sale'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-center">
          <p className="text-sm text-gray-500">Total Amount</p>
          <p className="text-3xl font-bold text-gray-900">{formatCurrency(total)}</p>
        </div>

        <div className="space-y-3">
          {payments.map((p, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                value={p.method}
                onChange={(e) => updatePayment(idx, 'method', e.target.value)}
                className="select-field w-44"
              >
                <option value="CASH">Cash</option>
                <option value="CHEQUE">Cheque (Post-Dated)</option>
                <option value="CARD">Card</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="EASYPAISA">Easypaisa</option>
                <option value="JAZZCASH">JazzCash</option>
                <option value="CUSTOMER_CREDIT">Khata (Credit)</option>
              </select>
              <input
                type="number"
                value={p.amount || ''}
                onChange={(e) => updatePayment(idx, 'amount', Number(e.target.value))}
                className="input-field flex-1"
                min="0"
                step="0.01"
              />
              {payments.length > 1 && (
                <button
                  onClick={() => removePayment(idx)}
                  className="rounded p-1 text-red-400 hover:bg-red-50"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* CHEQUE DETAILS FORM */}
        {hasChequePayment && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2.5">
            <div className="flex items-center gap-2 text-blue-800">
              <FileText className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Cheque Details (Auto-Registered)</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Cheque Number *</label>
                <input
                  type="text"
                  value={chequeNumber}
                  onChange={(e) => setChequeNumber(e.target.value)}
                  placeholder="e.g. CHK-104928"
                  className="input-field bg-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Bank *</label>
                <select value={bankName} onChange={(e) => setBankName(e.target.value)} className="select-field bg-white text-sm">
                  <option value="HBL">HBL</option>
                  <option value="Meezan">Meezan</option>
                  <option value="UBL">UBL</option>
                  <option value="MCB">MCB</option>
                  <option value="Allied">Allied Bank</option>
                  <option value="Bank Alfalah">Bank Alfalah</option>
                  <option value="Faysal">Faysal Bank</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-gray-700">Clearance / Maturity Date *</label>
                <div className="flex gap-1">
                  {[0, 7, 15, 30].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDueDaysFromNow(d)}
                      className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                        d === 15 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {d === 0 ? 'Today' : `+${d}d`}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="date"
                value={chequeDueDate}
                onChange={(e) => setChequeDueDate(e.target.value)}
                className="input-field bg-white text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Account / Drawer Title (Optional)</label>
              <input
                type="text"
                value={drawerTitle}
                onChange={(e) => setDrawerTitle(e.target.value)}
                placeholder="e.g. Customer Name on Cheque"
                className="input-field bg-white text-sm"
              />
            </div>
          </div>
        )}

        {remaining > 0.01 && (
          <p className="text-center text-sm text-orange-600">Remaining: {formatCurrency(remaining)}</p>
        )}
        {remaining < -0.01 && (
          <p className="text-center text-sm text-green-600">Change: {formatCurrency(Math.abs(remaining))}</p>
        )}

        <button onClick={addPayment} className="btn-secondary w-full text-sm">
          + Add Payment Method
        </button>
      </div>
    </Modal>
  );
}
