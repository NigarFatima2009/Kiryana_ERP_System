import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// Map database table names to React Query cache keys that should be refetched
const TABLE_TO_QUERY_KEYS: Record<string, string[]> = {
  products: ['products', 'products-all', 'pos-products', 'dashboard-stats', 'top-products', 'category-sales', 'stock-category'],
  categories: ['categories'],
  brands: ['brands'],
  inventory: ['inventory', 'inventory-all', 'stock', 'dashboard-stats', 'stock-category'],
  inventory_batches: ['batches', 'inventory-all', 'dashboard-stats'],
  inventory_movements: ['stock-movements'],
  suppliers: ['suppliers', 'dashboard-stats'],
  purchase_orders: ['purchase-orders', 'dashboard-stats'],
  goods_receipts: ['goods-receipts', 'dashboard-stats', 'sales-chart'],
  goods_receipt_items: ['goods-receipts'],
  purchase_returns: ['purchase-returns', 'dashboard-stats'],
  purchase_return_items: ['purchase-returns'],
  customers: ['customers', 'dashboard-stats'],
  sales: ['sales', 'sales-history', 'dashboard-stats', 'sales-chart', 'top-products', 'payment-methods', 'category-sales'],
  sales_items: ['sales', 'top-products', 'category-sales', 'payment-methods'],
  sales_returns: ['sales-returns', 'dashboard-stats', 'sales-chart', 'top-products'],
  sales_return_items: ['sales-returns'],
  customer_transactions: ['customer-transactions', 'khata', 'dashboard-stats'],
  customer_payments: ['customer-payments', 'dashboard-stats'],
  supplier_transactions: ['supplier-transactions', 'dashboard-stats'],
  supplier_payments: ['dashboard-stats'],
  expenses: ['expenses', 'dashboard-stats', 'daily-expenses'],
  profiles: ['employees'],
  page_permissions: ['page-permissions'],
};

/**
 * Subscribe to Supabase Realtime changes on all key tables.
 * When any row is inserted/updated/deleted, the corresponding
 * React Query caches are invalidated so the UI updates instantly.
 * 
 * Gracefully handles connection failures - app continues to work
 * even if realtime connection isn't available.
 */
export function useRealtimeSync(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const tables = Object.keys(TABLE_TO_QUERY_KEYS);
    const channels: ReturnType<typeof supabase.channel>[] = [];

    async function setupRealtimeSubscriptions() {
      for (const table of tables) {
        try {
          const channel = supabase
            .channel(`realtime:${table}`, {
              config: {
                broadcast: { ack: true },
              },
            })
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
            .subscribe((status) => {
              if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn(`[Realtime] Subscription error on ${table} - will continue without realtime updates`);
              } else if (status === 'SUBSCRIBED') {
                console.log(`[Realtime] Subscribed to ${table}`);
              }
            });

          channels.push(channel);
        } catch (error) {
          console.warn(`[Realtime] Failed to subscribe to ${table}:`, error);
          // Continue - app works without this table's realtime updates
        }
      }
    }

    setupRealtimeSubscriptions();

    return () => {
      for (const channel of channels) {
        supabase.removeChannel(channel);
      }
    };
  }, [enabled, queryClient]);
}
