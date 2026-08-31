import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, Search, DollarSign, BookOpen } from 'lucide-react';
import { fetchCustomers, fetchCustomerTransactions, fetchCustomerBalance, receiveCustomerPayment } from '../../services/customers';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { supabase } from '../../lib/supabase';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import type { CustomerTransaction } from '../../types/database';

export function KhataPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedCustomer, setSelectedCustomer] = useState<string>(searchParams.get('customer') || '');
  const [showPayment, setShowPayment] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => fetchCustomers({}).then((r) => r.data),
  });

  const { data: transactions, isLoading } = useQuery({
    queryKey: ['customer-transactions', selectedCustomer],
    queryFn: () => fetchCustomerTransactions(selectedCustomer),
    enabled: !!selectedCustomer,
  });

  const { data: balance } = useQuery({
    queryKey: ['customer-balance', selectedCustomer],
    queryFn: () => fetchCustomerBalance(selectedCustomer),
    enabled: !!selectedCustomer,
  });

  useEffect(() => {
    if (searchParams.get('customer')) {
      setSelectedCustomer(searchParams.get('customer') || '');
    }
  }, [searchParams]);

  const customersWithBalance = useQuery({
    queryKey: ['all-customer-balances'],
    queryFn: async () => {
      const results = [];
      for (const c of customers) {
        const b = await fetchCustomerBalance(c.id);
        results.push({ ...c, balance: b });
      }
      return results;
    },
    enabled: customers.length > 0,
  });

  const selectedCustomerData = customers.find((c) => c.id === selectedCustomer);

  // Running balance calculation
  let runningBalance = selectedCustomerData?.opening_balance || 0;
  const ledgerWithBalance = (transactions || []).slice().reverse().map((t) => {
    if (['CREDIT_SALE', 'OPENING'].includes(t.transaction_type)) runningBalance += Number(t.amount);
    if (['PAYMENT', 'RETURN', 'ADJUSTMENT'].includes(t.transaction_type)) runningBalance -= Number(t.amount);
    return { ...t, running: runningBalance };
  }).reverse();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Customer Khata</h1>
        {selectedCustomer && (
          <button onClick={() => setShowPayment(true)} className="btn-success">
            <DollarSign className="mr-2 h-4 w-4" /> Record Payment
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Customer list with balances */}
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold text-gray-500 uppercase">Customers</h3>
          <div className="max-h-[600px] space-y-1 overflow-y-auto">
            {(customersWithBalance.data || []).map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCustomer(c.id)}
                className={`w-full rounded-lg p-3 text-left transition-colors ${
                  selectedCustomer === c.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.phone || '-'}</p>
                  </div>
                  <span className={`text-sm font-bold ${c.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(c.balance)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Ledger */}
        <div className="card lg:col-span-2">
          {selectedCustomer ? (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{selectedCustomerData?.name}</h3>
                  <p className="text-sm text-gray-500">Outstanding: <span className={`font-bold ${balance && balance > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(balance || 0)}</span></p>
                </div>
                <BookOpen className="h-5 w-5 text-gray-400" />
              </div>

              {isLoading ? (
                <p className="py-8 text-center text-gray-500">Loading...</p>
              ) : ledgerWithBalance.length === 0 ? (
                <p className="py-8 text-center text-gray-500">No transactions</p>
              ) : (
                <div className="max-h-[500px] overflow-y-auto">
                  <table className="min-w-full text-sm">
                    <thead><tr className="border-b text-left text-xs text-gray-500">
                      <th className="py-2">Date</th><th className="py-2">Type</th><th className="py-2">Amount</th><th className="py-2">Balance</th><th className="py-2">Narration</th>
                    </tr></thead>
                    <tbody>
                      {ledgerWithBalance.map((t) => (
                        <tr key={t.id} className="border-b">
                          <td className="py-2 text-gray-500">{formatDateTime(t.created_at)}</td>
                          <td className="py-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs ${
                              ['CREDIT_SALE', 'OPENING'].includes(t.transaction_type)
                                ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                            }`}>
                              {t.transaction_type.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-2 font-medium">{formatCurrency(Number(t.amount))}</td>
                          <td className={`py-2 font-bold ${t.running > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(t.running)}</td>
                          <td className="py-2 text-gray-500 text-xs">{t.narration || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <BookOpen className="mb-3 h-12 w-12 text-gray-300" />
              <p>Select a customer to view their Khata</p>
            </div>
          )}
        </div>
      </div>

      {showPayment && selectedCustomer && (
        <CustomerPaymentModal
          customerId={selectedCustomer}
          customerName={selectedCustomerData?.name || ''}
          onClose={() => setShowPayment(false)}
        />
      )}
    </div>
  );
}

function CustomerPaymentModal({ customerId, customerName, onClose }: { customerId: string; customerName: string; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');

  // Fetch customer outstanding balance
  const { data: balance } = useQuery({
    queryKey: ['customer-balance-modal', customerId],
    queryFn: async () => {
      const { data: customer } = await supabase.from('customers').select('opening_balance').eq('id', customerId).single();
      const { data: txns } = await supabase.from('customer_transactions').select('amount, transaction_type').eq('customer_id', customerId);
      let bal = Number(customer?.opening_balance || 0);
      (txns || []).forEach((t: any) => {
        if (t.transaction_type === 'CREDIT_SALE') bal += Number(t.amount);
        if (t.transaction_type === 'PAYMENT' || t.transaction_type === 'RETURN') bal -= Number(t.amount);
      });
      return bal;
    },
  });

  const mutation = useMutation({
    mutationFn: () => receiveCustomerPayment({ customer_id: customerId, amount, payment_method: method, reference }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['customer-transactions', customerId] }),
        queryClient.refetchQueries({ queryKey: ['customer-balance', customerId] }),
        queryClient.refetchQueries({ queryKey: ['all-customer-balances'] }),
        queryClient.refetchQueries({ queryKey: ['customers'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
        queryClient.refetchQueries({ queryKey: ['payments'] }),
        queryClient.refetchQueries({ queryKey: ['customer-balance-modal'] }),
      ]);
      toast('success', 'Payment recorded');
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const isOverpayment = balance !== undefined && balance !== null && amount > balance && balance > 0;

  return (
    <Modal isOpen={true} onClose={onClose} title={`Payment from ${customerName}`} size="sm"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={() => mutation.mutate()} className="btn-success" disabled={amount <= 0 || mutation.isPending}>{mutation.isPending ? 'Processing...' : 'Record Payment'}</button></>}>
      <div className="space-y-4">
        {/* Outstanding balance display */}
        {balance !== null && balance !== undefined && (
          <div className={`rounded-lg border p-3 ${balance > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Outstanding Balance</span>
              <span className={`text-lg font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {formatCurrency(Math.max(0, balance))}
              </span>
            </div>
            {balance > 0 && (
              <button onClick={() => setAmount(balance)} className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium">
                Pay Full Amount ({formatCurrency(balance)})
              </button>
            )}
            {balance <= 0 && (
              <p className="mt-1 text-xs text-green-600">No outstanding balance</p>
            )}
          </div>
        )}

        <div>
          <label className="label">Amount (PKR) *</label>
          <input type="number" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} className="input-field" min="0" step="0.01" placeholder="0" />
          {isOverpayment && (
            <p className="text-xs text-amber-600 mt-1">Payment exceeds outstanding by {formatCurrency(amount - balance)}</p>
          )}
        </div>
        <div><label className="label">Payment Method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="select-field">
            <option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank Transfer</option><option value="EASYPAISA">Easypaisa</option><option value="JAZZCASH">JazzCash</option>
          </select>
        </div>
        <div><label className="label">Reference</label><input value={reference} onChange={(e) => setReference(e.target.value)} className="input-field" placeholder="Optional reference" /></div>
      </div>
    </Modal>
  );
}
