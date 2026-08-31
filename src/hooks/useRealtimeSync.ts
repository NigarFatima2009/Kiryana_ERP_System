import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// Map database table names to React Query cache keys that should be refetched
const TABLE_TO_QUERY_KEYS: Record<string, string[]> = {
  products: ['products', 'products-all', 'pos-products', 'dashboard-stats'],
  categories: ['categories'],
  brands: ['brands'],
  inventory: ['inventory', 'inventory-all', 'stock', 'dashboard-stats'],
  inventory_batches: ['batches', 'inventory-all'],
  inventory_movements: ['stock-movements'],
  suppliers: ['suppliers', 'dashboard-stats'],
  purchase_orders: ['purchase-orders', 'dashboard-stats'],
  goods_receipts: ['goods-receipts', 'dashboard-stats'],
  goods_receipt_items: ['goods-receipts'],
  purchase_returns: ['purchase-returns', 'dashboard-stats'],
  purchase_return_items: ['purchase-returns'],
  customers: ['customers', 'dashboard-stats'],
  sales: ['sales', 'sales-history', 'dashboard-stats'],
  sales_items: ['sales'],
  sales_returns: ['sales-returns'],
  sales_return_items: ['sales-returns'],
  customer_transactions: ['customer-transactions', 'khata', 'dashboard-stats'],
  customer_payments: ['customer-payments', 'dashboard-stats'],
  supplier_transactions: ['supplier-transactions', 'dashboard-stats'],
  supplier_payments: ['dashboard-stats'],
  expenses: ['expenses', 'dashboard-stats'],
  profiles: ['employees'],
};

/**
 * Subscribe to Supabase Realtime changes on all key tables.
 * When any row is inserted/updated/deleted, the corresponding
 * React Query caches are invalidated so the UI updates instantly.
 */
export function useRealtimeSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const tables = Object.keys(TABLE_TO_QUERY_KEYS);
    const channels: ReturnType<typeof supabase.channel>[] = [];

    for (const table of tables) {
      const channel = supabase
        .channel(`realtime:${table}`)
        .on(
          'postgres_changes',
          {
            event: '*', // INSERT, UPDATE, DELETE
            schema: 'public',
            table,
          },
          (payload) => {
            const keys = TABLE_TO_QUERY_KEYS[table] || [];
            // Invalidate all related queries so they refetch
            for (const key of keys) {
              queryClient.invalidateQueries({ queryKey: [key] });
            }
            console.log(`[Realtime] ${payload.eventType} on ${table}`);
          }
        )
        .subscribe();

      channels.push(channel);
    }

    return () => {
      for (const channel of channels) {
        supabase.removeChannel(channel);
      }
    };
  }, [queryClient]);
}
