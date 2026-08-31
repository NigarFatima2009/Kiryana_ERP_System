import { supabase } from '../lib/supabase';
import { offlineQuery } from '../lib/offlineQuery';
import type { Inventory, InventoryBatch, InventoryMovement } from '../types/database';

// ==================== INVENTORY ====================

export async function fetchInventory(params?: { search?: string; lowStock?: boolean; page?: number; pageSize?: number }) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Step 1: Fetch inventory with count
  const { data: inventoryData, error: invError, count } = await supabase
    .from('inventory')
    .select('*', { count: 'exact' })
    .order('quantity')
    .range(from, to);

  if (invError) throw invError;

  if (!inventoryData || inventoryData.length === 0) {
    return { data: [], count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
  }

  // Step 2: Fetch products for these inventory items (only active products)
  const productIds = inventoryData.map((i) => i.product_id);
  const { data: products } = await supabase
    .from('products')
    .select('id, name, sku, barcode, unit, purchase_price, selling_price, reorder_level, category_id, active')
    .in('id', productIds)
    .eq('active', true); // Only show active products

  // Step 3: Fetch categories
  const categoryIds = (products || []).map((p) => p.category_id).filter(Boolean);
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .in('id', categoryIds);

  // Step 4: Merge data
  const productMap = new Map((products || []).map((p) => [p.id, p]));
  const categoryMap = new Map((categories || []).map((c) => [c.id, c.name]));

  let merged = inventoryData
    .filter((inv) => productMap.has(inv.product_id)) // Only include inventory for active products
    .map((inv) => {
      const product = productMap.get(inv.product_id) || null;
      const categoryName = product?.category_id ? categoryMap.get(product.category_id) : null;
      return { ...inv, products: product ? { ...product, categories: categoryName ? { name: categoryName } : null } : null };
    });

  // Step 5: Apply search filter
  if (params?.search) {
    const s = params.search.toLowerCase();
    merged = merged.filter((item) => {
      const p = item.products as Record<string, unknown> | null;
      return p && (
        (p.name as string)?.toLowerCase().includes(s) ||
        (p.sku as string)?.toLowerCase().includes(s)
      );
    });
  }

  // Step 6: Apply low stock filter
  if (params?.lowStock) {
    merged = merged.filter((item) => {
      const p = item.products as Record<string, unknown> | null;
      return p && item.quantity != null && (item.quantity as number) <= (p.reorder_level as number);
    });
  }

  const result = { data: merged, count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
  return offlineQuery(`inventory-${page}`, async () => result);
}

export async function fetchBatches(params?: { product_id?: string; expiringSoon?: boolean }) {
  // Step 1: Fetch batches
  let query = supabase
    .from('inventory_batches')
    .select('*')
    .order('expiry_date', { ascending: true, nullsFirst: true });

  if (params?.product_id) {
    query = query.eq('product_id', params.product_id);
  }
  if (params?.expiringSoon) {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    query = query.not('expiry_date', 'is', null).lte('expiry_date', thirtyDaysFromNow.toISOString().split('T')[0]);
  }

  const { data: batchData, error } = await query;
  if (error) throw error;

  if (!batchData || batchData.length === 0) return [];

  // Step 2: Fetch products for batches (include all — even deactivated)
  const productIds = [...new Set(batchData.map((b) => b.product_id))];
  const { data: products } = await supabase
    .from('products')
    .select('id, name, sku, active')
    .in('id', productIds);

  const productMap = new Map((products || []).map((p) => [p.id, p]));

  const result = batchData.map((b) => ({ ...b, products: productMap.get(b.product_id) || { name: 'Unknown', sku: '' } }));
  return offlineQuery('batches', async () => result);
}

export async function fetchStockMovements(params?: { product_id?: string; movement_type?: string; page?: number; pageSize?: number }) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('inventory_movements')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params?.product_id) query = query.eq('product_id', params.product_id);
  if (params?.movement_type) query = query.eq('movement_type', params.movement_type);

  const { data: movementData, error, count } = await query;
  if (error) throw error;

  if (!movementData || movementData.length === 0) {
    return { data: [], count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
  }

  // Fetch products (include all — even deactivated for history)
  const productIds = [...new Set(movementData.map((m) => m.product_id))];
  const { data: products } = await supabase
    .from('products')
    .select('id, name, sku, active')
    .in('id', productIds);

  const productMap = new Map((products || []).map((p) => [p.id, p]));

  const merged = movementData
    .map((m) => ({
      ...m,
      products: productMap.get(m.product_id) || { name: 'Unknown', sku: '' },
    }));

  const result = { data: merged, count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
  return offlineQuery(`inventory-${page}`, async () => result);
}
