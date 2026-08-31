import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { type QueryClient } from '@tanstack/react-query';

const FIVE_MINUTES = 1000 * 60 * 5;
const ONE_DAY = 1000 * 60 * 60 * 24;

/**
 * Cache keys that should be persisted for offline access.
 * These are the core data sets needed to browse the app offline.
 */
const OFFLINE_CACHE_KEYS: string[][] = [
  ['products'],
  ['categories'],
  ['brands'],
  ['inventory'],
  ['inventory-all'],
  ['suppliers'],
  ['customers'],
  ['expenses'],
];

/**
 * Custom entry storage that wraps localStorage with size safety.
 * If localStorage is full, it evicts old entries gracefully.
 */
const safeLocalStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // localStorage full — try to make space by clearing old cache
      try {
        // Remove the oldest entries to make room
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith('reactQuery')) keys.push(k);
        }
        // Remove the first half
        keys.slice(0, Math.ceil(keys.length / 2)).forEach((k) => localStorage.removeItem(k));
        // Retry
        localStorage.setItem(key, value);
      } catch {
        console.warn('[OfflineCache] localStorage full, skipping cache write');
      }
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

/**
 * Set up React Query persist client.
 * Call this once when the app initializes.
 */
export function setupOfflineCache(queryClient: QueryClient): void {
  persistQueryClient({
    queryClient,
    persister: {
      persistClient: async (client) => {
        // Only persist offline-relevant cache entries
        const filteredQueries = client.clientState.queries.filter((q) => {
          const key = q.queryKey as unknown[];
          // Check if this query key matches any offline cache key
          return OFFLINE_CACHE_KEYS.some((offlineKey) => {
            return offlineKey.every((part, i) => key[i] === part);
          });
        });

        const filteredClient = {
          ...client,
          clientState: {
            ...client.clientState,
            queries: filteredQueries,
          },
        };

        safeLocalStorage.setItem(
          'erp-offline-cache',
          JSON.stringify(filteredClient)
        );
      },
      restoreClient: async () => {
        try {
          const raw = safeLocalStorage.getItem('erp-offline-cache');
          if (!raw) return undefined;
          return JSON.parse(raw);
        } catch {
          return undefined;
        }
      },
      removeClient: async (): Promise<void> => {
        safeLocalStorage.removeItem('erp-offline-cache');
      },
    },
    maxAge: ONE_DAY,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => {
        // Only persist successful queries (not loading/error states)
        return query.state.status === 'success';
      },
    },
  });
}
