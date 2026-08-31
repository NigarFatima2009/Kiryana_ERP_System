import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Plus, Trash2 } from 'lucide-react';
import { fetchExpenses, createExpense, fetchExpenseCategories } from '../../services/finance';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Pagination } from '../../components/ui/Pagination';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../lib/auth';
import { formatCurrency, formatDate } from '../../utils/helpers';

export function ExpensesPage() {
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canDelete = profile?.role === 'OWNER';

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', page],
    queryFn: () => fetchExpenses({ page }),
  });

  const { data: categories = [] } = useQuery({ queryKey: ['expense-categories'], queryFn: fetchExpenseCategories });

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'category', header: 'Category', render: (row) => {
      const c = row.expense_categories as Record<string, unknown> | null;
      return <span className="font-medium">{c?.name as string || '-'}</span>;
    }},
    { key: 'amount', header: 'Amount', render: (row) => <span className="font-bold">{formatCurrency(Number(row.amount))}</span> },
    { key: 'expense_date', header: 'Date', render: (row) => formatDate(row.expense_date as string) },
    { key: 'payment_method', header: 'Method', render: (row) => <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{row.payment_method as string}</span> },
    { key: 'description', header: 'Description', render: (row) => <span className="text-gray-500">{(row.description as string) || '-'}</span> },
    { key: 'actions', header: '', render: (row) => (
      canDelete ? (
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id as string); }} className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
      ) : null
    )},
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="mr-2 h-4 w-4" /> Add Expense</button>
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={(data?.data || []).map((e) => e as unknown as Record<string, unknown>)} isLoading={isLoading} emptyMessage="No expenses" />
        <div className="border-t px-4"><Pagination page={page} totalPages={data?.totalPages || 1} onPageChange={setPage} totalItems={data?.count} pageSize={20} /></div>
      </div>

      <ExpenseForm isOpen={showForm} onClose={() => setShowForm(false)} categories={categories} />
      <ConfirmDialog isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={async () => {
        if (!deleteId) return;
        const { error } = await supabase.from('expenses').delete().eq('id', deleteId);
        if (error) throw error;
        await queryClient.refetchQueries({ queryKey: ['expenses'] });
        await queryClient.refetchQueries({ queryKey: ['dashboard-stats'] });
        toast('success', 'Expense deleted');
        setDeleteId(null);
      }} title="Delete Expense" message="Are you sure you want to delete this expense?" confirmLabel="Delete" />
    </div>
  );
}

function ExpenseForm({ isOpen, onClose, categories }: { isOpen: boolean; onClose: () => void; categories: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ expense_category_id: '', amount: 0, expense_date: new Date().toISOString().split('T')[0], payment_method: 'CASH', description: '' });

  const mutation = useMutation({
    mutationFn: () => createExpense(form),
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['expenses'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
        queryClient.refetchQueries({ queryKey: ['journal-entries'] }),
        queryClient.refetchQueries({ queryKey: ['account-balances'] }),
      ]);
      toast('success', 'Expense recorded');
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Expense" size="md"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={() => mutation.mutate()} className="btn-primary" disabled={!form.expense_category_id || form.amount <= 0 || mutation.isPending}>{mutation.isPending ? 'Saving...' : 'Save'}</button></>}>
      <div className="space-y-4">
        <div><label className="label">Category *</label>
          <select value={form.expense_category_id} onChange={(e) => setForm({ ...form, expense_category_id: e.target.value })} className="select-field">
            <option value="">Select category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><label className="label">Amount (PKR) *</label><input type="number" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} className="input-field" min="0" step="0.01" /></div>
        <div><label className="label">Date</label><input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} className="input-field" /></div>
        <div><label className="label">Payment Method</label>
          <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} className="select-field">
            <option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank Transfer</option>
          </select>
        </div>
        <div><label className="label">Description</label><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input-field" rows={2} placeholder="Optional description" /></div>
      </div>
    </Modal>
  );
}
