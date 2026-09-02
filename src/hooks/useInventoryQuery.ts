import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { fetchInventory } from '../services/inventory';

interface UseInventoryQueryOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  lowStock?: boolean;
  staleTime?: number;
  gcTime?: number;
}

/**
 * Optimized inventory query hook with smart caching
 * - Implements pagination to avoid loading all products
 * - Caches data aggressively (5 minute stale time)
 * - Defers background refetch to avoid blocking UI
 */
export function useInventoryQuery(options: UseInventoryQueryOptions = {}) {
  const {
    page = 1,
    pageSize = 50,
    search = '',
    lowStock = false,
    staleTime = 1000 * 60 * 5, // 5 minutes
    gcTime = 1000 * 60 * 10, // 10 minutes
  } = options;

  return useQuery({
    queryKey: ['inventory', { page, pageSize, search, lowStock }],
    queryFn: () =>
      fetchInventory({
        page,
        pageSize,
        search: search || undefined,
        lowStock: lowStock || undefined,
      }),
    staleTime, // Aggressive caching - don't refetch for 5 minutes
    gcTime, // Keep in cache for 10 minutes
    refetchOnWindowFocus: false, // Don't refetch when user returns to window
    refetchOnReconnect: false, // Don't refetch on reconnect (manual sync handles this)
    retry: 1, // Only retry failed requests once
  });
}

/**
 * Hook for paginated inventory with automatic page size selection
 * Optimizes for different screen sizes and use cases
 */
export function usePaginatedInventory(
  options: UseInventoryQueryOptions & {
    autoPageSize?: boolean; // If true, adjust page size based on viewport
  } = {}
) {
  const { autoPageSize = false, ...queryOptions } = options;

  // Auto-detect page size based on viewport if enabled
  let pageSize = queryOptions.pageSize || 50;
  if (autoPageSize && typeof window !== 'undefined') {
    const screenHeight = window.innerHeight;
    // Approximately 60px per row, fit visible rows + buffer
    pageSize = Math.max(10, Math.ceil((screenHeight - 400) / 60));
  }

  return useInventoryQuery({
    ...queryOptions,
    pageSize,
  });
}
