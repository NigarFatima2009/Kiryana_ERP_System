import { supabase } from '../lib/supabase';
import { offlineQuery } from '../lib/offlineQuery';
import type { Product, ProductWithRelations, Category, Brand } from '../types/database';

// ==================== PRODUCTS ====================

export async function fetchProducts(params?: {
  search?: string;
  category_id?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('products')
    .select('*, categories!products_category_id_fkey(*), brands!products_brand_id_fkey(*), inventory(quantity, average_cost)', { count: 'exact' })
    .order('name')
    .range(from, to);

  if (params?.search) {
    query = query.or(`name.ilike.%${params.search}%,sku.ilike.%${params.search}%,barcode.ilike.%${params.search}%`);
  }
  if (params?.category_id) {
    query = query.eq('category_id', params.category_id);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  const result = { data: data as ProductWithRelations[], count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
  return offlineQuery(`products-${page}-${pageSize}-${params?.category_id || 'all'}-${params?.search || ''}`, async () => result);
}

export async function fetchProduct(id: string) {
  const { data, error } = await supabase
    .from('products')
    .select('*, categories!products_category_id_fkey(*), brands!products_brand_id_fkey(*)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as ProductWithRelations;
}

export async function createProduct(product: Omit<Product, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase.from('products').insert(product).select().single();
  if (error) throw error;
  // Initialize inventory
  await supabase.from('inventory').insert({ product_id: data.id, quantity: 0 });
  return data as Product;
}

export async function updateProduct(id: string, updates: Partial<Product>) {
  const { data, error } = await supabase.from('products').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data as Product;
}

export async function deleteProduct(id: string) {
  // Delete inventory batches for this product
  await supabase.from('inventory_batches').delete().eq('product_id', id);
  
  // Delete inventory movements for this product
  await supabase.from('inventory_movements').delete().eq('product_id', id);
  
  // Delete inventory record for this product
  await supabase.from('inventory').delete().eq('product_id', id);
  
  // Finally, delete the product itself
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

// ==================== CATEGORIES ====================

export async function fetchCategories() {
  const { data, error } = await supabase.from('categories').select('*').eq('active', true).order('name');
  if (error) throw error;
  return offlineQuery('categories', async () => data as Category[]);
}

export async function createCategory(name: string) {
  const { data, error } = await supabase.from('categories').insert({ name }).select().single();
  if (error) throw error;
  return data as Category;
}

export async function updateCategory(id: string, name: string) {
  const { data, error } = await supabase.from('categories').update({ name }).eq('id', id).select().single();
  if (error) throw error;
  return data as Category;
}

export async function deleteCategory(id: string) {
  const { error } = await supabase.from('categories').update({ active: false }).eq('id', id);
  if (error) throw error;
}

// ==================== BRANDS ====================

export async function fetchBrands() {
  const { data, error } = await supabase.from('brands').select('*').eq('active', true).order('name');
  if (error) throw error;
  return offlineQuery('brands', async () => data as Brand[]);
}

export async function createBrand(name: string) {
  const { data, error } = await supabase.from('brands').insert({ name }).select().single();
  if (error) throw error;
  return data as Brand;
}

export async function updateBrand(id: string, name: string) {
  const { data, error } = await supabase.from('brands').update({ name }).eq('id', id).select().single();
  if (error) throw error;
  return data as Brand;
}

export async function deleteBrand(id: string) {
  const { error } = await supabase.from('brands').update({ active: false }).eq('id', id);
  if (error) throw error;
}
