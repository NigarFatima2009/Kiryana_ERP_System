import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  CheckCircle,
  AlertTriangle,
  Clock,
  XCircle,
  Search,
  Filter,
  Calendar,
  FileText,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { fetchCustomers, receiveCustomerPayment } from '../../services/customers';
import { fetchSuppliers, createSupplierPayment } from '../../services/suppliers';
import {
  fetchCheques,
  createCheque,
  updateChequeStatus,
  deleteCheque,
  getChequesSummary,
  getChequeMaturityInfo,
  type Cheque,
  type ChequeType,
  type ChequeStatus,
} from '../../services/cheques';
import { formatCurrency, formatDateTime, formatDate } from '../../utils/helpers';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { supabase } from '../../lib/supabase';

export function PaymentsPage() {
  const [tab, setTab] = useState<'customer' | 'supplier' | 'cheques'>('customer');
  const [showPayment, setShowPayment] = useState<'customer' | 'supplier' | null>(null);
  const [showAddCheque, setShowAddCheque] = useState(false);
  const [chequeFilterType, setChequeFilterType] = useState<ChequeType | 'ALL'>('ALL');
  const [chequeFilterStatus, setChequeFilterStatus] = useState<ChequeStatus | 'ALL'>('ALL');
  const [chequeSearch, setChequeSearch] = useState('');

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: customerPayments = [] } = useQuery({
    queryKey: ['customer-payments'],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_payments')
        .select('*, customers!customer_payments_customer_id_fkey(name)')
        .order('payment_date', { ascending: false });
      return data || [];
    },
  });

  const { data: supplierPayments = [] } = useQuery({
    queryKey: ['supplier-payments'],
    queryFn: async () => {
      const { data } = await supabase
        .from('supplier_payments')
        .select('*, suppliers!supplier_payments_supplier_id_fkey(name)')
        .order('payment_date', { ascending: false });
      return data || [];
    },
  });

  const { data: cheques = [], isLoading: chequesLoading } = useQuery({
    queryKey: ['cheques', chequeFilterType, chequeFilterStatus, chequeSearch],
    queryFn: () =>
      fetchCheques({
        type: chequeFilterType === 'ALL' ? undefined : chequeFilterType,
        status: chequeFilterStatus === 'ALL' ? undefined : chequeFilterStatus,
        search: chequeSearch || undefined,
      }),
  });

  const { data: chequeSummary } = useQuery({
    queryKey: ['cheques-summary'],
    queryFn: getChequesSummary,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => fetchCustomers({}).then((r) => r.data),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => fetchSuppliers({}).then((r) => r.data),
  });

  const chequeStatusMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: ChequeStatus; notes?: string }) => {
      return updateChequeStatus(id, status, notes);
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['cheques'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-summary'] });
      queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
      queryClient.invalidateQueries({ queryKey: ['supplier-payments'] });
      toast('success', `Cheque marked as ${updated.status.toLowerCase()}`);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  // Helper to find matching cheque for payment
  const findChequeForPayment = (payment: any) => {
    if (payment.payment_method !== 'CHEQUE') return null;
    const ref = (payment.reference || '').trim();
    return cheques.find(
      (c) =>
        (ref && (c.cheque_number.includes(ref) || ref.includes(c.cheque_number))) ||
        (c.party_id === (payment.customer_id || payment.supplier_id) && Math.abs(c.amount - payment.amount) < 0.1)
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payments & Cheques</h1>
          <p className="text-xs text-gray-500">
            Manage customer & supplier payments, and track post-dated cheque clearances
          </p>
        </div>
        <div className="flex gap-2">
          {tab === 'cheques' ? (
            <button onClick={() => setShowAddCheque(true)} className="btn-primary">
              <Plus className="mr-2 h-4 w-4" /> Register New Cheque
            </button>
          ) : (
            <button onClick={() => setShowPayment(tab as 'customer' | 'supplier')} className="btn-primary">
              <Plus className="mr-2 h-4 w-4" /> Record {tab === 'customer' ? 'Customer' : 'Supplier'} Payment
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b border-gray-200 pb-2 overflow-x-auto">
        <button
          onClick={() => setTab('customer')}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
            tab === 'customer'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Customer Payments
        </button>
        <button
          onClick={() => setTab('supplier')}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
            tab === 'supplier'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Supplier Payments
        </button>
        <button
          onClick={() => setTab('cheques')}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition flex items-center gap-1.5 ${
            tab === 'cheques'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <span>Cheque Management</span>
          {chequeSummary && (chequeSummary.dueWithin15DaysCount > 0 || chequeSummary.overdueCount > 0) && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400 text-gray-900 font-extrabold">
              {chequeSummary.dueWithin15DaysCount + chequeSummary.overdueCount}
            </span>
          )}
        </button>
      </div>

      {/* Cheque Summary KPI Cards when in Cheques Tab */}
      {tab === 'cheques' && chequeSummary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3.5 shadow-sm">
            <div className="flex items-center gap-2 text-blue-600 mb-1">
              <Clock className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Pending Receivables
              </span>
            </div>
            <p className="text-lg font-bold text-blue-700">{formatCurrency(chequeSummary.pendingReceivedAmount)}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">Incoming customer cheques</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-3.5 shadow-sm">
            <div className="flex items-center gap-2 text-orange-600 mb-1">
              <Clock className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Pending Payables
              </span>
            </div>
            <p className="text-lg font-bold text-orange-700">{formatCurrency(chequeSummary.pendingIssuedAmount)}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">Outgoing supplier cheques (Uncashed)</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-3.5 shadow-sm">
            <div className="flex items-center gap-2 text-amber-600 mb-1">
              <Calendar className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Cashing in ≤ 15 Days
              </span>
            </div>
            <p className="text-lg font-bold text-amber-700">{chequeSummary.dueWithin15DaysCount} cheques</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {formatCurrency(chequeSummary.dueWithin15DaysAmount)} maturing soon
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-3.5 shadow-sm">
            <div className="flex items-center gap-2 text-red-600 mb-1">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Overdue Cheques
              </span>
            </div>
            <p className="text-lg font-bold text-red-700">{chequeSummary.overdueCount} cheques</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{formatCurrency(chequeSummary.overdueAmount)} past due</p>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="card">
        {tab === 'customer' && (
          customerPayments.length === 0 ? (
            <p className="py-8 text-center text-gray-500">No customer payments recorded yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-semibold text-gray-500 uppercase">
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3">Amount</th>
                    <th className="py-2.5 px-3">Method</th>
                    <th className="py-2.5 px-3">Clearance / Status</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Reference / Cheque #</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {customerPayments.map((p: any) => {
                    const matchedCheque = findChequeForPayment(p);
                    const maturity = matchedCheque
                      ? getChequeMaturityInfo(matchedCheque.due_date, matchedCheque.status)
                      : null;

                    return (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="py-2.5 px-3 font-medium text-gray-900">
                          {p.customers?.name || 'Customer'}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-blue-600">
                          {formatCurrency(Number(p.amount))}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-xs font-medium">
                            {p.payment_method}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {p.payment_method === 'CHEQUE' ? (
                            maturity ? (
                              <div className="flex items-center gap-1.5">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${maturity.badgeClass}`}>
                                  {maturity.label}
                                </span>
                                <button
                                  onClick={() => {
                                    if (matchedCheque) setChequeSearch(matchedCheque.cheque_number);
                                    setTab('cheques');
                                  }}
                                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold"
                                  title="View in Cheque Management"
                                >
                                  View →
                                </button>
                              </div>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-800 border border-amber-200">
                                ⏳ Cheque Pending
                              </span>
                            )
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-50 text-green-700 border border-green-200">
                              ✓ Paid
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-gray-600">{formatDateTime(p.payment_date)}</td>
                        <td className="py-2.5 px-3 text-gray-500 text-xs font-mono">{p.reference || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {tab === 'supplier' && (
          supplierPayments.length === 0 ? (
            <p className="py-8 text-center text-gray-500">No supplier payments recorded yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-semibold text-gray-500 uppercase">
                    <th className="py-2.5 px-3">Supplier</th>
                    <th className="py-2.5 px-3">Amount</th>
                    <th className="py-2.5 px-3">Method</th>
                    <th className="py-2.5 px-3">Clearance / Status</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Reference / Cheque #</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {supplierPayments.map((p: any) => {
                    const matchedCheque = findChequeForPayment(p);
                    const maturity = matchedCheque
                      ? getChequeMaturityInfo(matchedCheque.due_date, matchedCheque.status)
                      : null;

                    return (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="py-2.5 px-3 font-medium text-gray-900">
                          {p.suppliers?.name || 'Supplier'}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-orange-600">
                          {formatCurrency(Number(p.amount))}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="rounded-full bg-orange-100 text-orange-800 px-2 py-0.5 text-xs font-medium">
                            {p.payment_method}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {p.payment_method === 'CHEQUE' ? (
                            maturity ? (
                              <div className="flex items-center gap-1.5">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${maturity.badgeClass}`}>
                                  {maturity.label}
                                </span>
                                <button
                                  onClick={() => {
                                    if (matchedCheque) setChequeSearch(matchedCheque.cheque_number);
                                    setTab('cheques');
                                  }}
                                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold"
                                  title="View in Cheque Management"
                                >
                                  View →
                                </button>
                              </div>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-800 border border-amber-200">
                                ⏳ Cheque Issued (Uncashed)
                              </span>
                            )
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-50 text-green-700 border border-green-200">
                              ✓ Paid
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-gray-600">{formatDateTime(p.payment_date)}</td>
                        <td className="py-2.5 px-3 text-gray-500 text-xs font-mono">{p.reference || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {tab === 'cheques' && (
          <div className="space-y-3">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
              <div className="flex items-center gap-2 flex-1 max-w-sm">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    value={chequeSearch}
                    onChange={(e) => setChequeSearch(e.target.value)}
                    placeholder="Search cheque #, bank, party..."
                    className="input-field pl-8 text-xs py-1.5"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={chequeFilterType}
                  onChange={(e) => setChequeFilterType(e.target.value as any)}
                  className="select-field text-xs py-1.5"
                >
                  <option value="ALL">All Types (In & Out)</option>
                  <option value="RECEIVED">Received (from Customers)</option>
                  <option value="ISSUED">Issued (to Suppliers)</option>
                </select>

                <select
                  value={chequeFilterStatus}
                  onChange={(e) => setChequeFilterStatus(e.target.value as any)}
                  className="select-field text-xs py-1.5"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="PENDING">Pending (Uncashed)</option>
                  <option value="CLEARED">Cleared</option>
                  <option value="BOUNCED">Bounced</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>
            </div>

            {cheques.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <FileText className="w-10 h-10 mx-auto text-gray-300 mb-2" />
                <p className="font-semibold text-gray-700">No cheques found</p>
                <p className="text-xs text-gray-400 mt-1">
                  Cheques recorded in Customer/Supplier payments appear here automatically with 15-day maturity countdowns.
                </p>
                <button onClick={() => setShowAddCheque(true)} className="btn-primary mt-3 text-xs">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Register Cheque Manually
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs font-semibold text-gray-500 uppercase">
                      <th className="py-2.5 px-3">Cheque #</th>
                      <th className="py-2.5 px-3">Party (Customer / Supplier)</th>
                      <th className="py-2.5 px-3">Bank & Account</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Due / Clearance Date</th>
                      <th className="py-2.5 px-3">Maturity Status</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {cheques.map((c) => {
                      const maturity = getChequeMaturityInfo(c.due_date, c.status);
                      return (
                        <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-gray-900">{c.cheque_number}</div>
                            <span
                              className={`inline-block text-[10px] font-bold px-1.5 py-0.2 rounded ${
                                c.type === 'RECEIVED'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-purple-100 text-purple-700'
                              }`}
                            >
                              {c.type === 'RECEIVED' ? 'INCOMING (CUSTOMER)' : 'OUTGOING (SUPPLIER)'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-gray-800">{c.party_name}</div>
                            {c.notes && <div className="text-xs text-gray-400 truncate max-w-xs">{c.notes}</div>}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-gray-700">{c.bank_name}</div>
                            {c.drawer_title && <div className="text-xs text-gray-500">{c.drawer_title}</div>}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-gray-900">
                            {formatCurrency(c.amount)}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-gray-800">{formatDate(c.due_date)}</div>
                            <div className="text-[11px] text-gray-400">Issued: {formatDate(c.issue_date)}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${maturity.badgeClass}`}
                            >
                              {maturity.label}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {c.status === 'PENDING' ? (
                              <div className="flex justify-end gap-1.5">
                                <button
                                  onClick={() =>
                                    chequeStatusMutation.mutate({ id: c.id, status: 'CLEARED' })
                                  }
                                  className="px-2.5 py-1 bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 rounded text-xs font-semibold"
                                  title="Mark as Cashed / Cleared in Bank"
                                >
                                  Mark Cleared
                                </button>
                                <button
                                  onClick={() =>
                                    chequeStatusMutation.mutate({ id: c.id, status: 'BOUNCED' })
                                  }
                                  className="px-2.5 py-1 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded text-xs font-semibold"
                                  title="Mark as Bounced / Dishonored"
                                >
                                  Bounced
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400 font-medium">
                                {c.status === 'CLEARED' ? '✓ Cleared' : c.status}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {showPayment && (
        <PaymentForm
          type={showPayment}
          customers={customers}
          suppliers={suppliers}
          onClose={() => setShowPayment(null)}
          onSuccessRedirect={() => setTab('cheques')}
        />
      )}

      {showAddCheque && (
        <AddChequeModal
          customers={customers}
          suppliers={suppliers}
          onClose={() => setShowAddCheque(false)}
        />
      )}
    </div>
  );
}

function PaymentForm({
  type,
  customers,
  suppliers,
  onClose,
  onSuccessRedirect,
}: {
  type: 'customer' | 'supplier';
  customers: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  onClose: () => void;
  onSuccessRedirect: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [entityId, setEntityId] = useState('');
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');

  // Cheque-specific fields
  const [chequeNumber, setChequeNumber] = useState('');
  const [bankName, setBankName] = useState('HBL');
  const defaultDueDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [chequeDueDate, setChequeDueDate] = useState(defaultDueDate);
  const [drawerTitle, setDrawerTitle] = useState('');

  const setDueDaysFromNow = (days: number) => {
    const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    setChequeDueDate(d.toISOString().slice(0, 10));
  };

  // Fetch balance when entity is selected
  const { data: balance } = useQuery({
    queryKey: ['entity-balance', type, entityId],
    queryFn: async () => {
      if (!entityId) return null;
      if (type === 'customer') {
        const { data: customer } = await supabase.from('customers').select('opening_balance, credit_limit').eq('id', entityId).single();
        const { data: txns } = await supabase.from('customer_transactions').select('amount, transaction_type').eq('customer_id', entityId);
        let bal = Number(customer?.opening_balance || 0);
        (txns || []).forEach((t: any) => {
          if (t.transaction_type === 'CREDIT_SALE') bal += Number(t.amount);
          if (t.transaction_type === 'PAYMENT' || t.transaction_type === 'RETURN') bal -= Number(t.amount);
        });
        return { outstanding: bal, limit: Number(customer?.credit_limit || 0) };
      } else {
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

  const submitPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!entityId) throw new Error('Please select a party');
      if (!amount || amount <= 0) throw new Error('Please enter a valid amount');

      const partyList = type === 'customer' ? customers : suppliers;
      const party = partyList.find((x) => x.id === entityId);
      const partyName = party?.name || (type === 'customer' ? 'Customer' : 'Supplier');

      let finalRef = reference;

      if (method === 'CHEQUE') {
        if (!chequeNumber.trim()) throw new Error('Please enter Cheque Number');
        finalRef = `${chequeNumber.trim()} (${bankName})`;

        // AUTOMATICALLY CREATE THE CHEQUE IN CHEQUES TABLE!
        try {
          await createCheque({
            cheque_number: chequeNumber.trim(),
            type: type === 'customer' ? 'RECEIVED' : 'ISSUED',
            party_type: type === 'customer' ? 'CUSTOMER' : 'SUPPLIER',
            party_id: entityId,
            party_name: partyName,
            bank_name: bankName,
            drawer_title: drawerTitle.trim() || undefined,
            amount,
            issue_date: new Date().toISOString().slice(0, 10),
            due_date: chequeDueDate,
            status: 'PENDING',
            notes: `Recorded via ${type} payment on ${new Date().toLocaleDateString()}`,
          });
        } catch (chequeError: any) {
          console.warn('[PaymentForm] Cheque registration failed (table may not exist):', chequeError);
          // Continue with payment recording even if cheque fails - cheques table may not be created yet
        }
      }

      // Record payment
      if (type === 'customer') {
        await receiveCustomerPayment({
          customer_id: entityId,
          amount,
          payment_method: method,
          reference: finalRef,
        });
      } else {
        await createSupplierPayment({
          supplier_id: entityId,
          amount,
          payment_method: method,
          reference: finalRef,
          created_by: null,
        });
      }

      return { isCheque: method === 'CHEQUE', partyName, chequeNumber: chequeNumber.trim(), dueDate: chequeDueDate };
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['customer-payments'] }),
        queryClient.refetchQueries({ queryKey: ['supplier-payments'] }),
        queryClient.refetchQueries({ queryKey: ['cheques'] }),
        queryClient.refetchQueries({ queryKey: ['cheques-summary'] }),
        queryClient.refetchQueries({ queryKey: ['customer-transactions'] }),
        queryClient.refetchQueries({ queryKey: ['supplier-transactions'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
        queryClient.refetchQueries({ queryKey: ['entity-balance'] }),
      ]);

      if (result.isCheque) {
        toast('success', `Cheque ${result.chequeNumber} registered for ${result.partyName} (Cashes on ${formatDate(result.dueDate)}).`);
        onSuccessRedirect(); // Navigate to Cheques Tab!
      } else {
        toast('success', 'Payment recorded successfully');
      }
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const entities = type === 'customer' ? customers : suppliers;
  const isOverpayment = balance && amount > balance.outstanding && balance.outstanding > 0;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Record ${type === 'customer' ? 'Customer' : 'Supplier'} Payment`}
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => submitPaymentMutation.mutate()}
            className="btn-success"
            disabled={!entityId || amount <= 0 || submitPaymentMutation.isPending}
          >
            {submitPaymentMutation.isPending
              ? 'Recording...'
              : method === 'CHEQUE'
              ? 'Record Payment & Register Cheque'
              : 'Record Payment'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">{type === 'customer' ? 'Customer' : 'Supplier'} *</label>
          <select
            value={entityId}
            onChange={(e) => {
              setEntityId(e.target.value);
              setAmount(0);
            }}
            className="select-field"
          >
            <option value="">Select {type === 'customer' ? 'Customer' : 'Supplier'}</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>

        {/* Balance display */}
        {entityId && balance && (
          <div
            className={`rounded-lg border p-3 ${
              balance.outstanding > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                {type === 'supplier' ? 'Outstanding Payable to Supplier' : 'Customer Khata Outstanding'}
              </span>
              <span className={`text-lg font-bold ${balance.outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {formatCurrency(Math.max(0, balance.outstanding))}
              </span>
            </div>
            {balance.outstanding > 0 && (
              <button
                onClick={() => setAmount(balance.outstanding)}
                className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                Pay Full Amount ({formatCurrency(balance.outstanding)})
              </button>
            )}
            {balance.outstanding <= 0 && (
              <p className="mt-1 text-xs text-green-600">No outstanding balance — fully settled</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Amount (PKR) *</label>
            <input
              type="number"
              value={amount || ''}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="input-field"
              min="0"
              step="0.01"
              placeholder="Enter amount"
            />
            {isOverpayment && (
              <p className="text-xs text-amber-600 mt-1">
                Payment exceeds outstanding balance by {formatCurrency(amount - balance.outstanding)}
              </p>
            )}
          </div>

          <div>
            <label className="label">Payment Method *</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="select-field font-semibold"
            >
              <option value="CASH">Cash</option>
              <option value="CHEQUE">Cheque (Post-Dated / Standard)</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="CARD">Card</option>
              <option value="EASYPAISA">Easypaisa</option>
              <option value="JAZZCASH">JazzCash</option>
            </select>
          </div>
        </div>

        {/* CHEQUE SPECIFIC AUTOMATIC REGISTRATION FIELDS */}
        {method === 'CHEQUE' && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-blue-600" /> Cheque Management Details
              </span>
              <span className="text-[11px] text-blue-700 bg-blue-100 px-2 py-0.5 rounded font-medium">
                Auto-Registered in Cheques
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Cheque Number *</label>
                <input
                  type="text"
                  value={chequeNumber}
                  onChange={(e) => setChequeNumber(e.target.value)}
                  placeholder="e.g. CHK-104298"
                  className="input-field bg-white"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Bank Name *</label>
                <select
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="select-field bg-white"
                >
                  <option value="HBL">Habib Bank Limited (HBL)</option>
                  <option value="Meezan">Meezan Bank</option>
                  <option value="UBL">United Bank Limited (UBL)</option>
                  <option value="MCB">MCB Bank</option>
                  <option value="Allied">Allied Bank (ABL)</option>
                  <option value="Bank Alfalah">Bank Alfalah</option>
                  <option value="Faysal">Faysal Bank</option>
                  <option value="Standard Chartered">Standard Chartered</option>
                  <option value="Askari">Askari Bank</option>
                  <option value="Other">Other Bank</option>
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-gray-700">Maturity / Clearance Date *</label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setDueDaysFromNow(0)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-white hover:bg-gray-100 border text-gray-700 font-medium"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueDaysFromNow(7)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-white hover:bg-gray-100 border text-gray-700 font-medium"
                  >
                    +7 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueDaysFromNow(15)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600 text-white font-bold shadow-sm"
                  >
                    +15 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueDaysFromNow(30)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-white hover:bg-gray-100 border text-gray-700 font-medium"
                  >
                    +30 Days
                  </button>
                </div>
              </div>
              <input
                type="date"
                value={chequeDueDate}
                onChange={(e) => setChequeDueDate(e.target.value)}
                className="input-field bg-white"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Account Title / Drawer</label>
              <input
                type="text"
                value={drawerTitle}
                onChange={(e) => setDrawerTitle(e.target.value)}
                placeholder="e.g. Kiryana Superstore"
                className="input-field bg-white"
              />
            </div>
          </div>
        )}

        {method !== 'CHEQUE' && (
          <div>
            <label className="label">Reference / Note</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="input-field"
              placeholder="Optional transaction reference"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

function AddChequeModal({
  customers,
  suppliers,
  onClose,
}: {
  customers: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [type, setType] = useState<ChequeType>('RECEIVED');
  const [partyId, setPartyId] = useState('');
  const [customPartyName, setCustomPartyName] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [bankName, setBankName] = useState('HBL');
  const [drawerTitle, setDrawerTitle] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));

  const defaultDueDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [notes, setNotes] = useState('');

  const setDueDaysFromNow = (days: number) => {
    const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    setDueDate(d.toISOString().slice(0, 10));
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      let resolvedPartyName = customPartyName;
      if (partyId) {
        if (type === 'RECEIVED') {
          resolvedPartyName = customers.find((c) => c.id === partyId)?.name || customPartyName;
        } else {
          resolvedPartyName = suppliers.find((s) => s.id === partyId)?.name || customPartyName;
        }
      }

      if (!chequeNumber.trim()) throw new Error('Please enter cheque number');
      if (!amount || amount <= 0) throw new Error('Please enter a valid amount');
      if (!resolvedPartyName.trim()) throw new Error('Please select or enter party name');

      return createCheque({
        cheque_number: chequeNumber.trim(),
        type,
        party_type: type === 'RECEIVED' ? 'CUSTOMER' : 'SUPPLIER',
        party_id: partyId || null,
        party_name: resolvedPartyName,
        bank_name: bankName,
        drawer_title: drawerTitle.trim() || undefined,
        amount: Number(amount),
        issue_date: issueDate,
        due_date: dueDate,
        status: 'PENDING',
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cheques'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-summary'] });
      toast('success', `Cheque ${chequeNumber} registered (Cashes on ${formatDate(dueDate)})`);
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Register Cheque"
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="btn-primary"
          >
            {createMutation.isPending ? 'Saving...' : 'Register Cheque'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Cheque Type *</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setType('RECEIVED');
                setPartyId('');
              }}
              className={`p-2.5 rounded-lg border text-sm font-semibold transition ${
                type === 'RECEIVED'
                  ? 'bg-blue-50 border-blue-500 text-blue-700 ring-2 ring-blue-500/20'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              📥 Received from Customer
            </button>
            <button
              type="button"
              onClick={() => {
                setType('ISSUED');
                setPartyId('');
              }}
              className={`p-2.5 rounded-lg border text-sm font-semibold transition ${
                type === 'ISSUED'
                  ? 'bg-purple-50 border-purple-500 text-purple-700 ring-2 ring-purple-500/20'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              📤 Issued to Supplier
            </button>
          </div>
        </div>

        <div>
          <label className="label">{type === 'RECEIVED' ? 'Customer' : 'Supplier'} *</label>
          <select
            value={partyId}
            onChange={(e) => {
              setPartyId(e.target.value);
              const name = (type === 'RECEIVED' ? customers : suppliers).find((x) => x.id === e.target.value)?.name || '';
              setCustomPartyName(name);
            }}
            className="select-field"
          >
            <option value="">-- Select {type === 'RECEIVED' ? 'Customer' : 'Supplier'} --</option>
            {(type === 'RECEIVED' ? customers : suppliers).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Cheque Number *</label>
            <input
              type="text"
              value={chequeNumber}
              onChange={(e) => setChequeNumber(e.target.value)}
              placeholder="e.g. CHK-104928"
              className="input-field"
            />
          </div>
          <div>
            <label className="label">Bank Name *</label>
            <select
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="select-field"
            >
              <option value="HBL">Habib Bank Limited (HBL)</option>
              <option value="Meezan">Meezan Bank</option>
              <option value="UBL">United Bank Limited (UBL)</option>
              <option value="MCB">MCB Bank</option>
              <option value="Allied">Allied Bank (ABL)</option>
              <option value="Bank Alfalah">Bank Alfalah</option>
              <option value="Faysal">Faysal Bank</option>
              <option value="Standard Chartered">Standard Chartered</option>
              <option value="Askari">Askari Bank</option>
              <option value="Other">Other Bank</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Amount (PKR) *</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : '')}
              placeholder="0.00"
              className="input-field"
              min="0"
              step="0.01"
            />
          </div>
          <div>
            <label className="label">Account / Drawer Title</label>
            <input
              type="text"
              value={drawerTitle}
              onChange={(e) => setDrawerTitle(e.target.value)}
              placeholder="e.g. Store Pvt Ltd"
              className="input-field"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label mb-0">Cashing / Maturity Date *</label>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setDueDaysFromNow(0)}
                className="text-[11px] px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setDueDaysFromNow(7)}
                className="text-[11px] px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                +7 Days
              </button>
              <button
                type="button"
                onClick={() => setDueDaysFromNow(15)}
                className="text-[11px] px-2 py-0.5 rounded bg-blue-100 hover:bg-blue-200 text-blue-800 font-bold"
              >
                +15 Days
              </button>
              <button
                type="button"
                onClick={() => setDueDaysFromNow(30)}
                className="text-[11px] px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                +30 Days
              </button>
            </div>
          </div>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="input-field"
          />
        </div>

        <div>
          <label className="label">Notes / Instructions</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Cash in branch after clearing confirmation"
            className="input-field"
          />
        </div>
      </div>
    </Modal>
  );
}
