import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Edit2, Trash2, Package } from 'lucide-react';
import { fetchProducts, createProduct, updateProduct, deleteProduct, fetchCategories, fetchBrands } from '../../services/products';
import { supabase } from '../../lib/supabase';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Pagination } from '../../components/ui/Pagination';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/helpers';
import type { ProductWithRelations } from '../../types/database';

export function ProductsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<ProductWithRelations | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['products', search, page],
    queryFn: () => fetchProducts({ search, page, pageSize: 20 }),
  });

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });
  const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: fetchBrands });

  const deleteMutation = useMutation({
    mutationFn: deleteProduct,
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['products'] }),
        queryClient.refetchQueries({ queryKey: ['inventory'] }),
        queryClient.refetchQueries({ queryKey: ['inventory-all'] }),
        queryClient.refetchQueries({ queryKey: ['pos-products'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
      ]);
      toast('success', 'Product removed');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const columns: Column<Record<string, unknown>>[] = [
    { key: 'name', header: 'Product', render: (row) => (
      <div>
        <p className="font-medium text-gray-900">{row.name as string}</p>
        <p className="text-xs text-gray-500">{row.sku as string}</p>
      </div>
    )},
    { key: 'category', header: 'Category', render: (row) => {
      const cat = row.categories as Record<string, unknown> | null;
      return cat?.name as string || '-';
    }},
    { key: 'purchase_price', header: 'Purchase Price', render: (row) => formatCurrency(row.purchase_price as number) },
    { key: 'selling_price', header: 'Selling Price', render: (row) => formatCurrency(row.selling_price as number) },
    { key: 'stock', header: 'Stock', render: (row) => {
      const inv = row.inventory as { quantity: number }[] | { quantity: number } | undefined;
      const qty = Array.isArray(inv) ? (inv[0]?.quantity ?? 0) : (inv?.quantity ?? 0);
      return <span className={`font-medium ${qty <= 0 ? 'text-red-600' : 'text-gray-900'}`}>{qty}</span>;
    }},
    { key: 'actions', header: '', render: (row) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); setEditItem(row as unknown as ProductWithRelations); setShowForm(true); }} className="rounded p-1 hover:bg-gray-100"><Edit2 size={16} /></button>
        <button onClick={(e) => { e.stopPropagation(); if (confirm('Remove this product from the list?')) deleteMutation.mutate(row.id as string); }} className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
      </div>
    )},
  ];

  const tableData = (data?.data || []).map((p) => ({ ...p } as unknown as Record<string, unknown>));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Products</h1>
        <button onClick={() => { setEditItem(null); setShowForm(true); }} className="btn-primary">
          <Plus className="mr-2 h-4 w-4" /> Add Product
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="input-field pl-10"
        />
      </div>

      <div className="card p-0">
        <DataTable columns={columns} data={tableData} isLoading={isLoading} emptyMessage="No products found" />
        <div className="border-t px-4">
          <Pagination
            page={page}
            totalPages={data?.totalPages || 1}
            onPageChange={setPage}
            totalItems={data?.count}
            pageSize={20}
          />
        </div>
      </div>

      <ProductForm
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditItem(null); }}
        editItem={editItem}
        categories={categories}
        brands={brands}
      />
    </div>
  );
}

function ProductForm({ isOpen, onClose, editItem, categories, brands }: {
  isOpen: boolean;
  onClose: () => void;
  editItem: ProductWithRelations | null;
  categories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [barcodeError, setBarcodeError] = useState('');

  const [form, setForm] = useState({
    name: '',
    sku: '',
    barcode: '',
    category_id: '',
    brand_id: '',
    unit: 'pcs',
    purchase_price: 0,
    selling_price: 0,
    wholesale_price: 0,
    tax_rate: 0,
    reorder_level: 0,
    minimum_stock: 0,
    expiry_tracking: false,
  });

  // Check for duplicate barcode
  const checkBarcodeExists = async (barcode: string) => {
    if (!barcode || editItem?.barcode === barcode) {
      setBarcodeError('');
      return;
    }
    
    try {
      const { data } = await supabase
        .from('products')
        .select('id')
        .eq('barcode', barcode)
        .single();
      
      if (data) {
        setBarcodeError('This barcode already exists. Use a unique barcode.');
      } else {
        setBarcodeError('');
      }
    } catch {
      // Product not found, barcode is unique
      setBarcodeError('');
    }
  };

  // Reset form every time modal opens
  useEffect(() => {
    if (!isOpen) return;
    if (editItem) {
      setForm({
        name: editItem.name,
        sku: editItem.sku,
        barcode: editItem.barcode || '',
        category_id: editItem.category_id || '',
        brand_id: editItem.brand_id || '',
        unit: editItem.unit,
        purchase_price: Number(editItem.purchase_price),
        selling_price: Number(editItem.selling_price),
        wholesale_price: Number(editItem.wholesale_price),
        tax_rate: Number(editItem.tax_rate),
        reorder_level: Number(editItem.reorder_level),
        minimum_stock: Number(editItem.minimum_stock),
        expiry_tracking: editItem.expiry_tracking,
      });
    } else {
      setForm({
        name: '',
        sku: '',
        barcode: '',
        category_id: '',
        brand_id: '',
        unit: 'pcs',
        purchase_price: 0,
        selling_price: 0,
        wholesale_price: 0,
        tax_rate: 0,
        reorder_level: 0,
        minimum_stock: 0,
        expiry_tracking: false,
      });
    }
  }, [isOpen, editItem]);

  const mutation = useMutation({
    mutationFn: async () => {
      // Check for barcode duplicate before submitting
      if (form.barcode && form.barcode !== editItem?.barcode) {
        const { data } = await supabase
          .from('products')
          .select('id')
          .eq('barcode', form.barcode)
          .single();
        
        if (data) throw new Error('This barcode already exists. Use a unique barcode.');
      }

      // Convert empty strings to null for UUID fields and barcode
      const formData = {
        ...form,
        category_id: form.category_id || null,
        brand_id: form.brand_id || null,
        barcode: form.barcode || null, // Convert empty barcode to null to avoid unique constraint issues
      };
      if (editItem) {
        return updateProduct(editItem.id, formData);
      } else {
        return createProduct(formData as Parameters<typeof createProduct>[0]);
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['products'] }),
        queryClient.refetchQueries({ queryKey: ['inventory'] }),
        queryClient.refetchQueries({ queryKey: ['inventory-all'] }),
        queryClient.refetchQueries({ queryKey: ['pos-products'] }),
        queryClient.refetchQueries({ queryKey: ['dashboard-stats'] }),
      ]);
      toast('success', editItem ? 'Product updated' : 'Product created');
      onClose();
    },
    onError: (e: Error) => {
      // Parse error message for better user experience
      let errorMsg = e.message;
      if (errorMsg.includes('duplicate key')) {
        errorMsg = 'This barcode already exists. Use a unique barcode.';
      }
      toast('error', errorMsg);
    },
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editItem ? 'Edit Product' : 'Add Product'}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => mutation.mutate()} className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : editItem ? 'Update' : 'Create'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Product Name *</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field" placeholder="e.g. Milk 1 Liter" />
        </div>
        <div>
          <label className="label">SKU *</label>
          <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="input-field" placeholder="e.g. DAL-MIL-001" />
        </div>
        <div>
          <label className="label">Barcode</label>
          <input 
            value={form.barcode} 
            onChange={(e) => {
              setForm({ ...form, barcode: e.target.value });
              checkBarcodeExists(e.target.value);
            }}
            className={`input-field ${barcodeError ? 'border-red-500' : ''}`}
            placeholder="Optional barcode (leave empty if not available)" 
          />
          <p className="mt-1 text-xs text-gray-500">Must be unique if provided. Leave empty to skip.</p>
          {barcodeError && <p className="mt-1 text-xs text-red-500">{barcodeError}</p>}
        </div>
        <div>
          <label className="label">Category</label>
          <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="select-field">
            <option value="">Select category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Brand</label>
          <select value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })} className="select-field">
            <option value="">Select brand</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Unit</label>
          <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="select-field">
            <option value="pcs">Pieces</option>
            <option value="kg">Kilograms</option>
            <option value="g">Grams</option>
            <option value="L">Liters</option>
            <option value="ml">Milliliters</option>
            <option value="box">Box</option>
            <option value="dozen">Dozen</option>
          </select>
        </div>
        <div>
          <label className="label">Purchase Price (PKR) *</label>
          <input type="number" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: Number(e.target.value) })} className="input-field" min="0" step="0.01" />
        </div>
        <div>
          <label className="label">Selling Price (PKR) *</label>
          <input type="number" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: Number(e.target.value) })} className="input-field" min="0" step="0.01" />
        </div>
        <div>
          <label className="label">Wholesale Price (PKR)</label>
          <input type="number" value={form.wholesale_price} onChange={(e) => setForm({ ...form, wholesale_price: Number(e.target.value) })} className="input-field" min="0" step="0.01" />
        </div>
        <div>
          <label className="label">Tax Rate (%)</label>
          <input type="number" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })} className="input-field" min="0" max="100" step="0.01" />
        </div>
        <div>
          <label className="label">Reorder Level</label>
          <input type="number" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: Number(e.target.value) })} className="input-field" min="0" />
        </div>
        <div>
          <label className="label">Minimum Stock</label>
          <input type="number" value={form.minimum_stock} onChange={(e) => setForm({ ...form, minimum_stock: Number(e.target.value) })} className="input-field" min="0" />
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={form.expiry_tracking} onChange={(e) => setForm({ ...form, expiry_tracking: e.target.checked })} className="h-4 w-4" id="expiry" />
          <label htmlFor="expiry" className="text-sm text-gray-700">Enable Expiry Tracking</label>
        </div>
      </div>
    </Modal>
  );
}
