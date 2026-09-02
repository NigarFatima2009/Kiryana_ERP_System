/**
 * Smart caching layer for inventory data
 * Implements LRU (Least Recently Used) cache with configurable TTL
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;
  private defaultTTL: number;

  constructor(maxSize: number = 100, defaultTTL: number = 1000 * 60 * 5) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  /**
   * Get value from cache if not expired
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const isExpired = Date.now() - entry.timestamp > entry.ttl;
    if (isExpired) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data;
  }

  /**
   * Set value in cache
   */
  set(key: string, data: T, ttl?: number): void {
    // Remove oldest entry if cache is full
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    // Remove old entry if exists
    this.cache.delete(key);

    // Add new entry at end
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    });
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }
}

// Global inventory caches
const lowStockCache = new LRUCache(10, 1000 * 60 * 10); // 10 minute TTL for low stock
const inventoryPageCache = new LRUCache(50, 1000 * 60 * 5); // 5 minute TTL for paginated results
const batchCache = new LRUCache(20, 1000 * 60 * 15); // 15 minute TTL for batches

export const inventoryCache = {
  /**
   * Get low-stock cache
   */
  getLowStock(search?: string) {
    const key = `low-stock:${search || 'all'}`;
    return lowStockCache.get(key);
  },

  /**
   * Set low-stock cache
   */
  setLowStock(data: any, search?: string, ttl?: number) {
    const key = `low-stock:${search || 'all'}`;
    lowStockCache.set(key, data, ttl);
  },

  /**
   * Get paginated inventory cache
   */
  getPage(page: number, pageSize: number, search?: string) {
    const key = `inventory:${page}:${pageSize}:${search || 'all'}`;
    return inventoryPageCache.get(key);
  },

  /**
   * Set paginated inventory cache
   */
  setPage(data: any, page: number, pageSize: number, search?: string, ttl?: number) {
    const key = `inventory:${page}:${pageSize}:${search || 'all'}`;
    inventoryPageCache.set(key, data, ttl);
  },

  /**
   * Get batch cache
   */
  getBatch(productId?: string, expiringSoon?: boolean) {
    const key = `batches:${productId || 'all'}:${expiringSoon ? 'expiring' : 'all'}`;
    return batchCache.get(key);
  },

  /**
   * Set batch cache
   */
  setBatch(data: any, productId?: string, expiringSoon?: boolean, ttl?: number) {
    const key = `batches:${productId || 'all'}:${expiringSoon ? 'expiring' : 'all'}`;
    batchCache.set(key, data, ttl);
  },

  /**
   * Clear all caches
   */
  clearAll() {
    lowStockCache.clear();
    inventoryPageCache.clear();
    batchCache.clear();
  },

  /**
   * Get cache statistics
   */
  stats() {
    return {
      lowStock: lowStockCache.size(),
      inventoryPages: inventoryPageCache.size(),
      batches: batchCache.size(),
      total: lowStockCache.size() + inventoryPageCache.size() + batchCache.size(),
    };
  },
};
