import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { fetchCustomers, receiveCustomerPayment } from '../../services/customers';
import { fetchSuppliers, createSupplierPayment } from '../../services/suppliers';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { supabase } from '../../lib/supabase';

export function PaymentsPage() {
  const [tab, setTab] = useState<'customer' | 'supplier'>('customer');
  const [showPayment, setShowPayment] = useState<'customer' | 'supplier' | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: customerPayments } = useQuery({
    queryKey: ['customer-payments'],
    queryFn: async () => {
      const { data } = await supabase.from('customer_payments').select('*, customers!customer_payments_customer_id_fkey(name)').order('payment_date', { ascending: false });
      return data || [];
    },
  });

  const { data: supplierPayments } = useQuery({
    queryKey: ['supplier-payments'],
    queryFn: async () => {
      const { data } = await supabase.from('supplier_payments').select('*, suppliers!supplier_payments_supplier_id_fkey(name)').order('payment_date', { ascending: false });
      return data || [];
    },
  });

  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: () => fetchCustomers({}).then((r) => r.data) });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: () => fetchSuppliers({}).then((r) => r.data) });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
        <button onClick={() => setShowPayment(tab)} className="btn-primary"><Plus className="mr-2 h-4 w-4" /> Record Payment</button>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab('customer')} className={tab === 'customer' ? 'btn-primary' : 'btn-secondary'}>Customer Payments</button>
        <button onClick={() => setTab('supplier')} className={tab === 'supplier' ? 'btn-primary' : 'btn-secondary'}>Supplier Payments</button>
      </div>

      <div className="card">
        {tab === 'customer' ? (
          (!customerPayments || customerPayments.length === 0) ? <p className="py-8 text-center text-gray-500">No customer payments</p> :
          <table className="min-w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-gray-500">
              <th className="py-2">Customer</th><th className="py-2">Amount</th><th className="py-2">Method</th><th className="py-2">Date</th><th className="py-2">Reference</th>
            </tr></thead>
            <tbody>
              {customerPayments.map((p: Record<string, unknown>) => (
                <tr key={p.id as string} className="border-b">
                  <td className="py-2 font-medium">{(p.customers as Record<string, unknown>)?.name as string || '-'}</td>
                  <td className="py-2">{formatCurrency(Number(p.amount))}</td>
                  <td className="py-2"><span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs">{p.payment_method as string}</span></td>
                  <td className="py-2">{formatDateTime(p.payment_date as string)}</td>
                  <td className="py-2 text-gray-500">{(p.reference as string) || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          (!supplierPayments || supplierPayments.length === 0) ? <p className="py-8 text-center text-gray-500">No supplier payments</p> :
          <table className="min-w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-gray-500">
              <th className="py-2">Supplier</th><th className="py-2">Amount</th><th className="py-2">Method</th><th className="py-2">Date</th><th className="py-2">Reference</th>
            </tr></thead>
            <tbody>
              {supplierPayments.map((p: Record<string, unknown>) => (
                <tr key={p.id as string} className="border-b">
                  <td className="py-2 font-medium">{(p.suppliers as Record<string, unknown>)?.name as string || '-'}</td>
                  <td className="py-2">{formatCurrency(Number(p.amount))}</td>
                  <td className="py-2"><span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs">{p.payment_method as string}</span></td>
                  <td className="py-2">{formatDateTime(p.payment_date as string)}</td>
                  <td className="py-2 text-gray-500">{(p.reference as string) || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showPayment && (
        <PaymentForm
          type={showPayment}
          customers={customers}
          suppliers={suppliers}
          onClose={() => setShowPayment(null)}
        />
      )}
    </div>
  );
}

function PaymentForm({ type, customers, suppliers, onClose }: { type: 'customer' | 'supplier'; customers: { id: string; name: string }[]; suppliers: { id: string; name: string }[]; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [entityId, setEntityId] = useState('');
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');

  // Fetch balance when entity is selected
  const { data: balance } = useQuery({
    queryKey: ['entity-balance', type, entityId],
    queryFn: async () => {
      if (!entityId) return null;
      if (type === 'customer') {
        // Calculate customer balance from transactions
        const { data: customer } = await supabase.from('customers').select('opening_balance, credit_limit').eq('id', entityId).single();
        const { data: txns } = await supabase.from('customer_transactions').select('amount, transaction_type').eq('customer_id', entityId);
        let bal = Number(customer?.opening_balance || 0);
        (txns || []).forEach((t: any) => {
          if (t.transaction_type === 'CREDIT_SALE') bal += Number(t.amount);
          if (t.transaction_type === 'PAYMENT' || t.transaction_type === 'RETURN') bal -= Number(t.amount);
        });
        return { outstanding: bal, limit: Number(customer?.credit_limit || 0) };
      } else {
        // Calculate supplier balance from transactions
        const { data: supplier } = await supabase.from('suppliers').select('opening_balance').eq('id', entityId).single();
        const { data: txns } = await supabase.from('supplier_transactions').select('amount, transaction_type').eq('supplier_id', entityId);
        let bal = Number(supplier?.opening_balance || 0);
        (txns || []).forEach((t: any) => {
          if (t.transaction_type === 'PURCHASE') bal += Number(t.amount);
          if (t.transaction_type === 'PAYMENT' || t.transaction_type === 'RETURN') bal -= Number(t.amount);
        });
        return { outstanding: bal, limit: 0 };
      }
    },
    enabled: !!entityId,
  });

  const customerMutation = useMutation({
    mutationFn: () => receiveCustomerPayment({ customer_id: entityId, amount, payment_method: method, reference }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['customer-payments'] }),
        queryClient.refetchQueries({ queryKey: ['customer-transactions'] }),
        queryClient.refetchQueries({ queryKey: ['customer-balance'] }),
        queryClient.refetchQueries({ queryKey: ['all-customer-balances'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
        queryClient.refetchQueries({ queryKey: ['journal-entries'] }),
        queryClient.refetchQueries({ queryKey: ['entity-balance'] }),
      ]);
      toast('success', 'Payment recorded');
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const supplierMutation = useMutation({
    mutationFn: () => createSupplierPayment({ supplier_id: entityId, amount, payment_method: method, reference, created_by: null }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['supplier-payments'] }),
        queryClient.refetchQueries({ queryKey: ['supplier-transactions'] }),
        queryClient.refetchQueries({ queryKey: ['supplier-balance'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
        queryClient.refetchQueries({ queryKey: ['journal-entries'] }),
        queryClient.refetchQueries({ queryKey: ['entity-balance'] }),
      ]);
      toast('success', 'Payment recorded');
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const entities = type === 'customer' ? customers : suppliers;
  const isOverpayment = balance && amount > balance.outstanding && balance.outstanding > 0;

  return (
    <Modal isOpen={true} onClose={onClose} title={`Record ${type === 'customer' ? 'Customer' : 'Supplier'} Payment`} size="sm"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={() => type === 'customer' ? customerMutation.mutate() : supplierMutation.mutate()} className="btn-success" disabled={!entityId || amount <= 0 || customerMutation.isPending || supplierMutation.isPending}>
          Record Payment
        </button></>}>
      <div className="space-y-4">
        <div><label className="label">{type === 'customer' ? 'Customer' : 'Supplier'} *</label>
          <select value={entityId} onChange={(e) => { setEntityId(e.target.value); setAmount(0); }} className="select-field">
            <option value="">Select</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>

        {/* Balance display */}
        {entityId && balance && (
          <div className={`rounded-lg border p-3 ${balance.outstanding > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                {type === 'supplier' ? 'Outstanding Payable' : 'Customer Outstanding'}
              </span>
              <span className={`text-lg font-bold ${balance.outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {formatCurrency(Math.max(0, balance.outstanding))}
              </span>
            </div>
            {balance.outstanding > 0 && (
              <button onClick={() => setAmount(balance.outstanding)} className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium">
                Pay Full Amount ({formatCurrency(balance.outstanding)})
              </button>
            )}
            {balance.outstanding <= 0 && (
              <p className="mt-1 text-xs text-green-600">No outstanding balance — fully paid</p>
            )}
          </div>
        )}

        <div>
          <label className="label">Amount (PKR) *</label>
          <input type="number" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} className="input-field" min="0" step="0.01" placeholder="Enter amount" />
          {isOverpayment && (
            <p className="text-xs text-amber-600 mt-1">Payment exceeds outstanding balance by {formatCurrency(amount - balance.outstanding)}</p>
          )}
        </div>
        <div><label className="label">Method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="select-field">
            <option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank Transfer</option>
            <option value="EASYPAISA">Easypaisa</option><option value="JAZZCASH">JazzCash</option>
          </select>
        </div>
        <div><label className="label">Reference</label><input value={reference} onChange={(e) => setReference(e.target.value)} className="input-field" placeholder="Optional" /></div>
      </div>
    </Modal>
  );
}
