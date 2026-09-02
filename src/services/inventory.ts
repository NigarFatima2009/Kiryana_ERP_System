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

  // Fetch profiles (cashier info) for created_by field
  const profileIds = [...new Set(movementData.map((m) => m.created_by).filter(Boolean))];
  const { data: profiles } = profileIds.length > 0
    ? await supabase.from('profiles').select('id, full_name, email').in('id', profileIds)
    : { data: [] };

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));

  const merged = movementData
    .map((m) => ({
      ...m,
      products: productMap.get(m.product_id) || { name: 'Unknown', sku: '' },
      profiles: m.created_by ? profileMap.get(m.created_by) || null : null,
    }));

  const result = { data: merged, count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
  return offlineQuery(`inventory-${page}`, async () => result);
}

// ==================== SMART REORDER RECOMMENDATIONS ====================

export interface ReorderRecommendation {
  product_id: string;
  product_name: string;
  category_name: string;
  current_stock: number;
  daily_usage: number;
  lead_time_days: number;
  reorder_level: number;
  recommended_quantity: number;
  suggested_supplier_id: string | null;
  supplier_name: string;
  supplier_phone: string;
  last_purchase_price: number;
  estimated_cost: number;
  reason: string;
  priority?: 'URGENT' | 'NORMAL';
}

export async function getReorderRecommendation(productId: string): Promise<ReorderRecommendation | null> {
  const { data, error } = await supabase
    .rpc('calculate_reorder_recommendation', { p_product_id: productId })
    .single();

  if (error) {
    console.error('Error fetching reorder recommendation:', error);
    return null;
  }

  return data as ReorderRecommendation;
}

// Normalize view columns to match TS interface (old view uses different names)
function normalizeRec(raw: Record<string, unknown>): ReorderRecommendation {
  return {
    product_id: (raw.product_id || raw.id || '') as string,
    product_name: (raw.product_name || raw.name || 'Unknown') as string,
    category_name: (raw.category_name || raw.category || '') as string,
    current_stock: Number(raw.current_stock ?? 0),
    daily_usage: Number(raw.daily_usage ?? 5),
    lead_time_days: Number(raw.lead_time_days ?? 3),
    reorder_level: Number(raw.reorder_level ?? 10),
    recommended_quantity: Number(raw.recommended_quantity ?? 10),
    suggested_supplier_id: (raw.suggested_supplier_id || raw.supplier_id || null) as string | null,
    supplier_name: (raw.supplier_name || 'No supplier') as string,
    supplier_phone: (raw.supplier_phone || '') as string,
    last_purchase_price: Number(raw.last_purchase_price ?? 0),
    estimated_cost: Number(raw.estimated_cost ?? 0),
    reason: (raw.reason || 'Below reorder level') as string,
    priority: (raw.priority || 'NORMAL') as 'URGENT' | 'NORMAL',
  };
}

export async function getAllReorderRecommendations(): Promise<ReorderRecommendation[]> {
  const { data, error } = await supabase
    .from('reorder_recommendations')
    .select('*')
    .order('priority', { ascending: true })
    .order('recommended_quantity', { ascending: false });

  if (error) {
    console.error('Error fetching reorder recommendations (trying fallback):', error);
    // Use fallback query
    return getLowStockProductsFallback();
  }

  // If view returns empty, try fallback
  if (!data || data.length === 0) {
    console.log('Reorder view returned empty, using fallback low-stock query');
    return getLowStockProductsFallback();
  }

  return data.map(normalizeRec);
}

export async function getUrgentReorders(): Promise<ReorderRecommendation[]> {
  const { data, error } = await supabase
    .from('reorder_recommendations')
    .select('*')
    .eq('priority', 'URGENT')
    .order('recommended_quantity', { ascending: false });

  if (error) {
    console.error('Error fetching urgent reorders (trying fallback):', error);
    // Use fallback and filter for urgent
    const fallback = await getLowStockProductsFallback();
    return fallback.filter((r) => r.priority === 'URGENT');
  }

  // If view returns empty, try fallback
  if (!data || data.length === 0) {
    console.log('Urgent reorders view returned empty, using fallback');
    const fallback = await getLowStockProductsFallback();
    return fallback.filter((r) => r.priority === 'URGENT');
  }

  return data.map(normalizeRec);
}

/**
 * Fallback: Query low-stock products directly from inventory + products tables
 * This is used when the reorder_recommendations view is not available or returns empty
 */
export async function getLowStockProductsFallback(): Promise<ReorderRecommendation[]> {
  try {
    // Fetch all inventory
    const { data: inventory, error: invError } = await supabase
      .from('inventory')
      .select('quantity, product_id');

    if (invError) throw invError;
    if (!inventory || inventory.length === 0) return [];

    // Fetch products with reorder_level set
    const productIds = inventory.map((i) => i.product_id);
    const { data: products, error: prodError } = await supabase
      .from('products')
      .select('id, name, category_id, reorder_level, purchase_price, active')
      .in('id', productIds)
      .eq('active', true)
      .gt('reorder_level', 0); // Only products with reorder_level > 0

    if (prodError) throw prodError;
    if (!products || products.length === 0) return [];

    // Fetch one active supplier for fallback
    const { data: suppliers } = await supabase
      .from('suppliers')
      .select('id, name, phone')
      .eq('active', true)
      .limit(1);

    const defaultSupplierId = suppliers?.[0]?.id || null;
    const defaultSupplierName = suppliers?.[0]?.name || 'No supplier';
    const defaultSupplierPhone = suppliers?.[0]?.phone || '';

    // Build inventory map
    const invMap = new Map(inventory.map((i) => [i.product_id, Number(i.quantity) || 0]));

    // Filter products that are below reorder level
    const lowStockProducts = products.filter((p) => {
      const qty = invMap.get(p.id) || 0;
      const reorderLevel = Number(p.reorder_level || 0);
      return qty < reorderLevel; // Below reorder level
    });

    if (lowStockProducts.length === 0) return [];

    // Build recommendations
    return lowStockProducts.map((p) => {
      const qty = invMap.get(p.id) || 0;
      const reorderLevel = Number(p.reorder_level || 0);
      const purchasePrice = Number(p.purchase_price || 0);
      const recommendedQty = Math.ceil(reorderLevel * 1.5);
      
      return {
        product_id: p.id,
        product_name: p.name,
        category_name: '',
        current_stock: qty,
        daily_usage: 5,
        lead_time_days: 3,
        reorder_level: reorderLevel,
        recommended_quantity: recommendedQty,
        suggested_supplier_id: defaultSupplierId,
        supplier_name: defaultSupplierName,
        supplier_phone: defaultSupplierPhone,
        last_purchase_price: purchasePrice,
        estimated_cost: recommendedQty * purchasePrice,
        reason: `Below configured reorder level of ${reorderLevel}`,
        priority: (qty === 0 ? 'URGENT' : 'NORMAL') as 'URGENT' | 'NORMAL',
      };
    }).sort((a, b) => {
      // Sort: URGENT first, then by lowest stock
      if (a.priority !== b.priority) return a.priority === 'URGENT' ? -1 : 1;
      return a.current_stock - b.current_stock;
    });
  } catch (err) {
    console.error('❌ Fallback low-stock query failed:', err);
    return [];
  }
}
