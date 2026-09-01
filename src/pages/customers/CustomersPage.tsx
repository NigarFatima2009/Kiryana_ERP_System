import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Edit2, Eye, BookOpen, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fetchCustomers, createCustomer, updateCustomer, fetchCustomerTransactions, fetchCustomerBalance } from '../../services/customers';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../lib/auth';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import { getAllCachedCustomers } from '../../lib/offline/cache';
import { useNetworkStatus } from '../../hooks/useOfflineStatus';
import type { Customer, CustomerTransaction } from '../../types/database';
import { useNavigate } from 'react-router-dom';

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<Customer | null>(null);
  const [showDetail, setShowDetail] = useState<Customer | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const networkStatus = useNetworkStatus();
  const isOnline = networkStatus.status === 'ONLINE';
  const canDelete = profile?.role === 'OWNER';

  // Online: fetch from server
  const { data: onlineData, isLoading: onlineLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => fetchCustomers({ search }),
    enabled: isOnline, // Only fetch online
  });

  // Offline: fetch from IndexedDB cache
  const [offlineData, setOfflineData] = useState<Customer[] | null>(null);
  const [offlineLoading, setOfflineLoading] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      loadOfflineCustomers();
    }
  }, [isOnline]);

  const loadOfflineCustomers = async () => {
    setOfflineLoading(true);
    try {
      const cached = await getAllCachedCustomers();
      // Map offline customers to match Customer interface
      const mapped = (cached as any[]).map(c => ({
        ...c,
        notes: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Customer));
      setOfflineData(mapped);
    } catch (error) {
      console.error('[Customers] Failed to load offline cache:', error);
      setOfflineData([]);
    } finally {
      setOfflineLoading(false);
    }
  };

  // Re-filter offline data when search changes
  useEffect(() => {
    if (!isOnline && offlineData) {
      const filtered = offlineData.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.phone && c.phone.includes(search))
      );
      setOfflineData(filtered);
    }
  }, [search, isOnline]);

  const data = isOnline ? onlineData : { data: offlineData || [] };
  const isLoading = isOnline ? onlineLoading : offlineLoading;

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'name', header: 'Customer', render: (row) => (
      <div>
        <p className="font-medium text-gray-900">{row.name as string}</p>
        <p className="text-xs text-gray-500">{(row.phone as string) || '-'}</p>
      </div>
    )},
    { key: 'credit_limit', header: 'Credit Limit', render: (row) => formatCurrency(Number(row.credit_limit)) },
    { key: 'actions', header: '', render: (row) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); setEditItem(row as unknown as Customer); setShowForm(true); }} className="rounded p-1 hover:bg-gray-100"><Edit2 size={16} /></button>
        <button onClick={(e) => { e.stopPropagation(); setShowDetail(row as unknown as Customer); }} className="rounded p-1 hover:bg-gray-100"><Eye size={16} /></button>
        <button onClick={(e) => { e.stopPropagation(); navigate(`/khata?customer=${row.id}`); }} className="rounded p-1 hover:bg-gray-100 text-blue-600" title="View Khata"><BookOpen size={16} /></button>
        {canDelete && (
          <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id as string); }} className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
        )}
      </div>
    )},
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
        <button onClick={() => { setEditItem(null); setShowForm(true); }} className="btn-primary"><Plus className="mr-2 h-4 w-4" /> Add Customer</button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} className="input-field pl-10" />
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={(data?.data || []).map((c) => c as unknown as Record<string, unknown>)} isLoading={isLoading} emptyMessage="No customers" />
      </div>

      <CustomerForm isOpen={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} editItem={editItem} />
      {showDetail && <CustomerDetail customer={showDetail} onClose={() => setShowDetail(null)} />}
      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={async () => {
        if (!deleteId) return;
        const { error } = await supabase.from('customers').update({ active: false }).eq('id', deleteId);
        if (error) throw error;
        await queryClient.refetchQueries({ queryKey: ['customers'] });
        toast('success', 'Customer deactivated');
        setDeleteId(null);
      }} title="Deactivate Customer" message="Are you sure you want to deactivate this customer? They will no longer appear in dropdowns." confirmLabel="Deactivate" />
    </div>
  );
}

function CustomerForm({ isOpen, onClose, editItem }: { isOpen: boolean; onClose: () => void; editItem: Customer | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', credit_limit: 0, opening_balance: 0, notes: '' });

  useEffect(() => {
    if (editItem) {
      setForm({
        name: editItem.name, phone: editItem.phone || '', email: editItem.email || '',
        address: editItem.address || '', credit_limit: Number(editItem.credit_limit),
        opening_balance: Number(editItem.opening_balance), notes: editItem.notes || '',
      });
    }
  }, [editItem]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (editItem) return updateCustomer(editItem.id, form);
      return createCustomer(form as Parameters<typeof createCustomer>[0]);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['customers'] }),
        queryClient.refetchQueries({ queryKey: ['all-customer-balances'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
      ]);
      toast('success', editItem ? 'Updated' : 'Created');
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editItem ? 'Edit Customer' : 'Add Customer'} size="lg"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={() => mutation.mutate()} className="btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving...' : 'Save'}</button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label">Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field" /></div>
        <div><label className="label">Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input-field" /></div>
        <div><label className="label">Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-field" /></div>
        <div className="sm:col-span-2"><label className="label">Address</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="input-field" /></div>
        <div><label className="label">Credit Limit (PKR)</label><input type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: Number(e.target.value) })} className="input-field" min="0" /></div>
        <div><label className="label">Opening Balance (PKR)</label><input type="number" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: Number(e.target.value) })} className="input-field" min="0" /></div>
        <div className="sm:col-span-2"><label className="label">Notes</label><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input-field" rows={2} /></div>
      </div>
    </Modal>
  );
}

function CustomerDetail({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [tab, setTab] = useState<'ledger' | 'info'>('ledger');

  const { data: transactions } = useQuery({
    queryKey: ['customer-transactions', customer.id],
    queryFn: () => fetchCustomerTransactions(customer.id),
  });

  const { data: balance } = useQuery({
    queryKey: ['customer-balance', customer.id],
    queryFn: () => fetchCustomerBalance(customer.id),
  });

  return (
    <Modal isOpen={true} onClose={onClose} title={customer.name} size="xl">
      <div className="flex gap-4 mb-4">
        <button onClick={() => setTab('ledger')} className={tab === 'ledger' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}>Ledger</button>
        <button onClick={() => setTab('info')} className={tab === 'info' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}>Info</button>
        <div className="ml-auto text-lg font-bold">
          Balance: <span className={balance && balance > 0 ? 'text-red-600' : 'text-green-600'}>{formatCurrency(balance || 0)}</span>
        </div>
      </div>

      {tab === 'info' && (
        <div className="space-y-2 text-sm">
          <p><span className="text-gray-500">Phone:</span> {customer.phone || '-'}</p>
          <p><span className="text-gray-500">Email:</span> {customer.email || '-'}</p>
          <p><span className="text-gray-500">Address:</span> {customer.address || '-'}</p>
          <p><span className="text-gray-500">Credit Limit:</span> {formatCurrency(Number(customer.credit_limit))}</p>
        </div>
      )}

      {tab === 'ledger' && (
        <div className="max-h-96 overflow-y-auto">
          {(!transactions || transactions.length === 0) ? (
            <p className="py-8 text-center text-gray-500">No transactions</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-gray-500">
                <th className="py-2">Date</th><th className="py-2">Type</th><th className="py-2">Amount</th><th className="py-2">Narration</th>
              </tr></thead>
              <tbody>
                {transactions.map((t: CustomerTransaction) => (
                  <tr key={t.id} className="border-b">
                    <td className="py-2">{formatDateTime(t.created_at)}</td>
                    <td className="py-2"><span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs">{t.transaction_type.replace('_', ' ')}</span></td>
                    <td className="py-2 font-medium">{formatCurrency(Number(t.amount))}</td>
                    <td className="py-2 text-gray-500">{t.narration || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Modal>
  );
}
