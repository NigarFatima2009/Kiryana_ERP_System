/**
 * Simple offline data cache using localStorage.
 * Saves query results after each successful fetch.
 * Provides cached data when offline.
 */

const CACHE_PREFIX = 'erp_data_';
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/** Save data to offline cache */
export function saveToCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage full — clear old cache entries
    try {
      clearOldCache();
      const entry: CacheEntry<T> = { data, timestamp: Date.now() };
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch {
      console.warn('[OfflineCache] Cannot write to localStorage');
    }
  }
}

/** Get data from offline cache */
export function getFromCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    // Check if cache is expired
    if (Date.now() - entry.timestamp > CACHE_EXPIRY) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

/** Remove specific cache entry */
export function removeFromCache(key: string): void {
  localStorage.removeItem(CACHE_PREFIX + key);
}

/** Clear all old cache entries */
function clearOldCache(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(CACHE_PREFIX)) {
      try {
        const raw = localStorage.getItem(k);
        if (raw) {
          const entry: CacheEntry<unknown> = JSON.parse(raw);
          if (Date.now() - entry.timestamp > CACHE_EXPIRY) {
            keysToRemove.push(k);
          }
        }
      } catch {
        keysToRemove.push(k);
      }
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}

/** Check if navigator is online */
export function isOnline(): boolean {
  return navigator.onLine;
}
