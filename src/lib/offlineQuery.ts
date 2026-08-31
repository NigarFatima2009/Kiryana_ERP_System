import { saveToCache, getFromCache, isOnline } from './offlineCache';

/**
 * Wrap any query function with offline caching.
 * - When online: fetch from API, save to cache, return data
 * - When offline: return cached data if available, otherwise throw
 * 
 * Usage in React Query:
 *   queryFn: () => offlineQuery('products-list', () => fetchProducts(params))
 */
export async function offlineQuery<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const data = await fetcher();
    // Success — save to cache
    saveToCache(cacheKey, data);
    return data;
  } catch (err) {
    if (!isOnline()) {
      // Offline — try to return cached data
      const cached = getFromCache<T>(cacheKey);
      if (cached !== null) {
        console.log(`[Offline] Serving cached data for: ${cacheKey}`);
        return cached;
      }
    }
    // Online but request failed, or offline with no cache — throw
    throw err;
  }
}
