/**
 * Offline-First POS: Data Cache Management
 */

import { getOfflineDB } from './db';
import type {
  OfflineProduct,
  OfflineInventory,
  OfflineCustomer,
  OfflineCategory,
} from './types';

// ==================== PRODUCT CACHE ====================

export async function cacheProducts(products: OfflineProduct[]): Promise<void> {
  const db = getOfflineDB();
  try {
    await db.products.bulkPut(products);
    console.log(`[Cache] Cached ${products.length} products`);
  } catch (error) {
    console.error('[Cache] Failed to cache products:', error);
    throw error;
  }
}

export async function searchCachedProducts(query: string): Promise<OfflineProduct[]> {
  const db = getOfflineDB();
  const q = query.toLowerCase();
  const allProducts = await db.products.toArray();
  return allProducts.filter(p => {
    if (!p.active) return false;
    return (
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.barcode && p.barcode.toLowerCase().includes(q))
    );
  });
}

export async function getProductByBarcode(barcode: string): Promise<OfflineProduct | null> {
  const db = getOfflineDB();
  const product = await db.products.where('barcode').equals(barcode).first();
  return product ?? null;
}

export async function getProductBySku(sku: string): Promise<OfflineProduct | null> {
  const db = getOfflineDB();
  const product = await db.products.where('sku').equals(sku).first();
  return product ?? null;
}

export async function getAllCachedProducts(): Promise<OfflineProduct[]> {
  const db = getOfflineDB();
  const all = await db.products.toArray();
  return all.filter(p => p.active);
}

export async function getCachedProductCount(): Promise<number> {
  const db = getOfflineDB();
  return db.products.count();
}

// ==================== INVENTORY CACHE ====================

export async function cacheInventory(inventory: OfflineInventory[]): Promise<void> {
  const db = getOfflineDB();
  try {
    await db.inventory.bulkPut(inventory);
    console.log(`[Cache] Cached inventory for ${inventory.length} products`);
  } catch (error) {
    console.error('[Cache] Failed to cache inventory:', error);
    throw error;
  }
}

export async function getCachedInventory(productId: string): Promise<OfflineInventory | null> {
  const db = getOfflineDB();
  const record = await db.inventory.get(productId);
  return record ?? null;
}

export async function getAllCachedInventory(): Promise<OfflineInventory[]> {
  const db = getOfflineDB();
  return db.inventory.toArray();
}

export async function decrementLocalInventory(
  productId: string,
  quantity: number,
  _unitCost: number
): Promise<void> {
  const db = getOfflineDB();
  const inv = await db.inventory.get(productId);
  if (!inv) {
    console.error(`[Cache] CRITICAL: Inventory for product ${productId} not cached — offline sale will not decrement stock!`);
    return;
  }
  const newQuantity = inv.quantity - quantity;
  if (newQuantity < 0) {
    console.warn(`[Cache] Inventory for ${productId} would go negative`);
  }
  await db.inventory.update(productId, {
    quantity: Math.max(0, newQuantity),
    reserved_quantity: Math.max(0, inv.reserved_quantity - quantity),
  });
}

export async function incrementLocalInventory(
  productId: string,
  quantity: number
): Promise<void> {
  const db = getOfflineDB();
  const inv = await db.inventory.get(productId);
  if (!inv) {
    console.error(`[Cache] CRITICAL: Inventory for product ${productId} not cached — offline sale will not decrement stock!`);
    return;
  }
  await db.inventory.update(productId, { quantity: inv.quantity + quantity });
}

// ==================== CUSTOMER CACHE ====================

export async function cacheCustomers(customers: OfflineCustomer[]): Promise<void> {
  const db = getOfflineDB();
  try {
    await db.customers.bulkPut(customers);
    console.log(`[Cache] Cached ${customers.length} customers`);
  } catch (error) {
    console.error('[Cache] Failed to cache customers:', error);
    throw error;
  }
}

export async function searchCachedCustomers(query: string): Promise<OfflineCustomer[]> {
  const db = getOfflineDB();
  const q = query.toLowerCase();
  const all = await db.customers.toArray();
  return all.filter(c => {
    if (!c.active) return false;
    return (
      c.name.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q))
    );
  });
}

export async function getCachedCustomer(customerId: string): Promise<OfflineCustomer | null> {
  const db = getOfflineDB();
  const record = await db.customers.get(customerId);
  return record ?? null;
}

export async function getAllCachedCustomers(): Promise<OfflineCustomer[]> {
  const db = getOfflineDB();
  const all = await db.customers.toArray();
  return all.filter(c => c.active);
}

export async function getCachedCustomerCount(): Promise<number> {
  const db = getOfflineDB();
  return db.customers.count();
}

// ==================== CATEGORY CACHE ====================

export async function cacheCategories(categories: OfflineCategory[]): Promise<void> {
  const db = getOfflineDB();
  try {
    await db.categories.bulkPut(categories);
    console.log(`[Cache] Cached ${categories.length} categories`);
  } catch (error) {
    console.error('[Cache] Failed to cache categories:', error);
    throw error;
  }
}

export async function getAllCachedCategories(): Promise<OfflineCategory[]> {
  const db = getOfflineDB();
  const all = await db.categories.toArray();
  return all.filter(c => c.active);
}

// ==================== CACHE DIAGNOSTICS ====================

export async function getCacheStats(): Promise<{
  products: number;
  customers: number;
  inventory: number;
  categories: number;
  cacheAge: number | null;
}> {
  const db = getOfflineDB();
  const [products, customers, inventory, categories, cacheAge] = await Promise.all([
    db.products.count(),
    db.customers.count(),
    db.inventory.count(),
    db.categories.count(),
    db.getCacheAge(),
  ]);
  return { products, customers, inventory, categories, cacheAge };
}

export async function clearAllCaches(): Promise<void> {
  const db = getOfflineDB();
  await db.clearCacheTables();
  console.log('[Cache] Cleared all cache tables');
}

export async function isCacheFresh(): Promise<boolean> {
  const cacheAge = await getOfflineDB().getCacheAge();
  if (!cacheAge) return false;
  return cacheAge < 60 * 60 * 1000; // 1 hour
}

export async function getLastCacheUpdateTime(): Promise<Date | null> {
  const metadata = await getOfflineDB().appMetadata.get('app-metadata');
  if (!metadata?.last_successful_sync_at) return null;
  return new Date(metadata.last_successful_sync_at);
}
