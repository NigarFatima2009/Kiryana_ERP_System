import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { fetchCategories, createCategory, updateCategory, deleteCategory } from '../../services/products';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';

export function CategoriesPage() {
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
  });

  const createMutation = useMutation({
    mutationFn: () => createCategory(name),
    onSuccess: async () => { await queryClient.refetchQueries({ queryKey: ['categories'] }); toast('success', 'Category created'); setShowForm(false); setName(''); },
    onError: (e: Error) => toast('error', e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editItem) return;
      return editItem ? await updateCategory(editItem.id, name) : null;
    },
    onSuccess: async () => { await queryClient.refetchQueries({ queryKey: ['categories'] }); toast('success', 'Category updated'); setShowForm(false); setEditItem(null); setName(''); },
    onError: (e: Error) => toast('error', e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCategory,
    onSuccess: async () => { await queryClient.refetchQueries({ queryKey: ['categories'] }); toast('success', 'Category deactivated'); },
    onError: (e: Error) => toast('error', e.message),
  });

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'name', header: 'Category Name', render: (row) => <span className="font-medium">{row.name as string}</span> },
    { key: 'created_at', header: 'Created', render: (row) => new Date(row.created_at as string).toLocaleDateString() },
    { key: 'actions', header: '', render: (row) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); setEditItem({ id: row.id as string, name: row.name as string }); setName(row.name as string); setShowForm(true); }} className="rounded p-1 hover:bg-gray-100"><Edit2 size={16} /></button>
        <button onClick={(e) => { e.stopPropagation(); if (confirm('Deactivate category?')) deleteMutation.mutate(row.id as string); }} className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
      </div>
    )},
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
        <button onClick={() => { setEditItem(null); setName(''); setShowForm(true); }} className="btn-primary">
          <Plus className="mr-2 h-4 w-4" /> Add Category
        </button>
      </div>

      <div className="card p-0">
        <DataTable
          columns={columns}
          data={(data || []).map((c) => c as unknown as Record<string, unknown>)}
          isLoading={isLoading}
          emptyMessage="No categories"
        />
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditItem(null); setName(''); }}
        title={editItem ? 'Edit Category' : 'Add Category'}
        size="sm"
        footer={
          <>
            <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            <button
              onClick={() => editItem ? updateMutation.mutate() : createMutation.mutate()}
              className="btn-primary"
              disabled={!name.trim() || createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </>
        }
      >
        <label className="label">Category Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="e.g. Dairy" autoFocus />
      </Modal>
    </div>
  );
}
