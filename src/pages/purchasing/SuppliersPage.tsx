import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Edit2, Phone, Mail, MapPin, CreditCard, Trash2 } from 'lucide-react';
import { fetchSuppliers, createSupplier, updateSupplier, fetchSupplierTransactions, fetchSupplierBalance } from '../../services/suppliers';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../lib/auth';
import { formatCurrency, formatDateTime } from '../../utils/helpers';
import type { Supplier, SupplierTransaction } from '../../types/database';

export function SuppliersPage() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState<Supplier | null>(null);
  const [editItem, setEditItem] = useState<Supplier | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canDelete = profile?.role === 'OWNER';

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', search],
    queryFn: () => fetchSuppliers({ search }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => updateSupplier(id, { active: false }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['suppliers'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
      ]);
      toast('success', 'Supplier deactivated');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  // Calculate total payables
  const totalPayables = (data?.data || []).reduce((sum: number, supplier: any) => {
    return sum + (Number(supplier.opening_balance) || 0);
  }, 0);

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'name', header: 'Supplier', render: (row) => (
      <div>
        <p className="font-medium text-gray-900">{row.name as string}</p>
        {row.company ? <p className="text-xs text-gray-500">{String(row.company)}</p> : null}
      </div>
    )},
    { key: 'phone', header: 'Phone', render: (row) => <span className="text-gray-600">{(row.phone as string) || '-'}</span> },
    { key: 'credit_limit', header: 'Credit Limit', render: (row) => formatCurrency(Number(row.credit_limit)) },
    { key: 'actions', header: '', render: (row) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); setEditItem(row as unknown as Supplier); setShowForm(true); }} className="rounded p-1 hover:bg-gray-100"><Edit2 size={16} /></button>
        <button onClick={(e) => { e.stopPropagation(); setShowDetail(row as unknown as Supplier); }} className="btn-secondary text-xs py-1">View</button>
        {canDelete && (
          <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id as string); }} className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
        )}
      </div>
    )},
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
        <button onClick={() => { setEditItem(null); setShowForm(true); }} className="btn-primary"><Plus className="mr-2 h-4 w-4" /> Add Supplier</button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Search suppliers..." value={search} onChange={(e) => setSearch(e.target.value)} className="input-field pl-10" />
      </div>

      {/* Balance Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 font-medium mb-1">Total Suppliers</p>
          <p className="text-2xl font-bold text-gray-900">{data?.data?.length || 0}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 font-medium mb-1">Total Payables</p>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(totalPayables)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 font-medium mb-1">Total Credit Limit</p>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency((data?.data || []).reduce((sum: number, s: any) => sum + Number(s.credit_limit || 0), 0))}</p>
        </div>
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={(data?.data || []).map((s) => s as unknown as Record<string, unknown>)} isLoading={isLoading} emptyMessage="No suppliers found" />
      </div>

      <SupplierForm isOpen={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} editItem={editItem} />
      {showDetail && <SupplierDetail supplier={showDetail} onClose={() => setShowDetail(null)} />}
      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); }} title="Deactivate Supplier" message="Are you sure you want to deactivate this supplier?" confirmLabel="Deactivate" loading={deleteMutation.isPending} />
    </div>
  );
}

function SupplierForm({ isOpen, onClose, editItem }: { isOpen: boolean; onClose: () => void; editItem: Supplier | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '', company: '', phone: '', email: '', address: '', tax_information: '',
    credit_limit: 0, opening_balance: 0, notes: '',
  });

  useEffect(() => {
    if (editItem) {
      setForm({
        name: editItem.name, company: editItem.company || '', phone: editItem.phone || '',
        email: editItem.email || '', address: editItem.address || '', tax_information: editItem.tax_information || '',
        credit_limit: Number(editItem.credit_limit), opening_balance: Number(editItem.opening_balance), notes: editItem.notes || '',
      });
    }
  }, [editItem]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (editItem) return updateSupplier(editItem.id, form);
      return createSupplier(form as Parameters<typeof createSupplier>[0]);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['suppliers'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
      ]);
      toast('success', editItem ? 'Updated' : 'Created');
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editItem ? 'Edit Supplier' : 'Add Supplier'} size="lg"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={() => mutation.mutate()} className="btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving...' : 'Save'}</button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label">Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field" /></div>
        <div><label className="label">Company</label><input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="input-field" /></div>
        <div><label className="label">Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input-field" /></div>
        <div><label className="label">Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input-field" /></div>
        <div><label className="label">Address</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="input-field" /></div>
        <div><label className="label">Credit Limit</label><input type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: Number(e.target.value) })} className="input-field" min="0" /></div>
        <div><label className="label">Opening Balance</label><input type="number" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: Number(e.target.value) })} className="input-field" min="0" /></div>
        <div><label className="label">Tax Info</label><input value={form.tax_information} onChange={(e) => setForm({ ...form, tax_information: e.target.value })} className="input-field" /></div>
        <div className="sm:col-span-2"><label className="label">Notes</label><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input-field" rows={2} /></div>
      </div>
    </Modal>
  );
}

function SupplierDetail({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const [tab, setTab] = useState<'ledger' | 'info'>('info');

  const { data: transactions } = useQuery({
    queryKey: ['supplier-transactions', supplier.id],
    queryFn: () => fetchSupplierTransactions(supplier.id),
  });

  const { data: balance } = useQuery({
    queryKey: ['supplier-balance', supplier.id],
    queryFn: () => fetchSupplierBalance(supplier.id),
  });

  return (
    <Modal isOpen={true} onClose={onClose} title={supplier.name} size="xl">
      <div className="flex gap-4 mb-4">
        <button onClick={() => setTab('info')} className={tab === 'info' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}>Info</button>
        <button onClick={() => setTab('ledger')} className={tab === 'ledger' ? 'btn-primary text-xs' : 'btn-secondary text-xs'}>Ledger</button>
      </div>

      {tab === 'info' && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2"><Phone size={14} className="text-gray-400" /> {supplier.phone || '-'}</div>
          <div className="flex items-center gap-2"><Mail size={14} className="text-gray-400" /> {supplier.email || '-'}</div>
          <div className="flex items-center gap-2"><MapPin size={14} className="text-gray-400" /> {supplier.address || '-'}</div>
          <div className="flex items-center gap-2"><CreditCard size={14} className="text-gray-400" /> Outstanding: <span className="font-bold">{formatCurrency(balance || 0)}</span></div>
        </div>
      )}

      {tab === 'ledger' && (
        <div className="max-h-96 overflow-y-auto">
          {(!transactions || transactions.length === 0) ? (
            <p className="text-center py-8 text-gray-500">No transactions</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-gray-500">
                <th className="py-2">Date</th><th className="py-2">Type</th><th className="py-2">Amount</th><th className="py-2">Narration</th>
              </tr></thead>
              <tbody>
                {transactions.map((t: SupplierTransaction) => (
                  <tr key={t.id} className="border-b">
                    <td className="py-2">{formatDateTime(t.created_at)}</td>
                    <td className="py-2"><span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs">{t.transaction_type}</span></td>
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
