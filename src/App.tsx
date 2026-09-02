import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from './lib/auth';
import { MainLayout } from './components/layout/MainLayout';
import { LoginPage } from './pages/auth/LoginPage';
import { ChangePasswordPage } from './pages/auth/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/products/ProductsPage';
import { CategoriesPage } from './pages/products/CategoriesPage';
import { BrandsPage } from './pages/products/BrandsPage';
import { StockPage } from './pages/inventory/StockPage';
import { StockMovementsPage } from './pages/inventory/StockMovementsPage';
import { BatchesPage } from './pages/inventory/BatchesPage';
import { ReorderRecommendationsPage } from './pages/inventory/ReorderRecommendationsPage';
import { SuppliersPage } from './pages/purchasing/SuppliersPage';
import { PurchaseOrdersPage } from './pages/purchasing/PurchaseOrdersPage';
import { GoodsReceiptsPage } from './pages/purchasing/GoodsReceiptsPage';
import { PurchaseReturnsPage } from './pages/purchasing/PurchaseReturnsPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { KhataPage } from './pages/customers/KhataPage';
import { POSPage } from './pages/sales/POSPage';
import { SalesHistoryPage } from './pages/sales/SalesHistoryPage';
import { SalesReturnsPage } from './pages/sales/SalesReturnsPage';
import { ShiftManagementPage } from './pages/sales/ShiftManagementPage';
import { PaymentsPage } from './pages/finance/PaymentsPage';
import { ExpensesPage } from './pages/finance/ExpensesPage';
import { AccountingPage } from './pages/finance/AccountingPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { EmployeesPage } from './pages/employees/EmployeesPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { AuditLogsPage } from './pages/settings/AuditLogsPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { PermissionsPage } from './pages/settings/PermissionsPage';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPagePermissions } from './services/permissions';
import { OfflineDataViewer } from './components/dev/OfflineDataViewer';
import { initializeOfflineDB } from './lib/offline/db';
import { isCacheFresh, getCachedProductCount } from './lib/offline/cache';
import { performInitialCacheSync, performOfflineSync } from './lib/offline/sync';
import { getOfflineSalesStats, getPendingOfflineSalesCount } from './lib/offline/offlineSales';
import { updateSyncStats } from './lib/offline/connectivity';
import { syncOfflineShifts } from './services/cashier';
import { useNetworkStatus } from './hooks/useOfflineStatus';
import type { AppRole } from './types/database';

function ProtectedLayout() {
  const { session, profile, loading } = useAuth();

  // While loading, show spinner
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  // No session = redirect to login
  if (!session) {
    console.log('[ProtectedLayout] No session, redirecting to login');
    return <Navigate to="/login" replace />;
  }

  // No profile after loading = error
  if (!profile) {
    console.log('[ProtectedLayout] No profile loaded, redirecting to login');
    return <Navigate to="/login" replace />;
  }

  // Profile is inactive
  if (!profile.active) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-red-50 to-red-100 px-4">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-bold text-red-600">Account Deactivated</h1>
          <p className="mt-2 text-sm text-gray-500">Your account has been deactivated. Please contact the store owner.</p>
        </div>
      </div>
    );
  }

  // All checks passed - render the layout
  console.log('[ProtectedLayout] User authenticated:', profile.email);
  return <MainLayout />;
}

function RoleGuard({ children, allowedRoles, pagePath }: { children: React.ReactNode; allowedRoles: AppRole[]; pagePath?: string }) {
  const { profile } = useAuth();

  // OWNER always has full access — skip permission checks
  const isOwner = profile?.role === 'OWNER';

  const { data: permissions = [], isError: permError } = useQuery({
    queryKey: ['page-permissions', profile?.id || 'CASHIER'],
    queryFn: async () => {
      if (!profile) return [];
      if (profile.role === 'CASHIER' && profile.id) {
        // User is CASHIER — fetch their specific permissions (role + overrides merged)
        try {
          const { fetchPagePermissionsForUser } = await import('./services/permissions');
          return await fetchPagePermissionsForUser(profile.id, 'CASHIER');
        } catch (error) {
          console.error('[RoleGuard] Failed to fetch CASHIER permissions:', error);
          // Fallback: show all pages (fail-open for offline scenarios)
          return [];
        }
      } else {
        // User is not CASHIER — use role-level defaults
        try {
          return await fetchPagePermissions(profile.role);
        } catch (error) {
          console.error('[RoleGuard] Failed to fetch role permissions:', error);
          return [];
        }
      }
    },
    enabled: !!profile && !!pagePath && !isOwner, // Skip query for OWNER
    staleTime: 300_000, // 5 minutes - permissions don't change often
    refetchInterval: 600_000, // Only refetch every 10 minutes, not 5 seconds
    retry: 1,
  });

  // Role check: is user's role in allowedRoles?
  if (!profile || !allowedRoles.includes(profile.role)) {
    return (
      <div className="text-center py-10">
        <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
        <p className="text-gray-500">You don't have permission to view this page.</p>
      </div>
    );
  }

  // OWNER has unrestricted access
  if (isOwner) {
    return <>{children}</>;
  }

  // CASHIER: check page-specific permissions
  if (profile.role === 'CASHIER' && pagePath) {
    const perm = permissions.find((p: any) => p.page_path === pagePath);
    
    // If permission explicitly disabled, deny access
    if (perm && !perm.enabled) {
      return <Navigate to="/pos" replace />;
    }
    
    // If query failed (offline) and no permission data, fail-open (allow access)
    // Better to show content than block user when offline
    // console.log('[RoleGuard] CASHIER page check:', pagePath, 'perm:', perm, 'allowed');
  }

  return <>{children}</>;
}

/**
 * Silent background component: initializes IndexedDB and caches POS data on login.
 * Renders nothing — no UI visible anywhere.
 */
function OfflineInitializer() {
  const { user, session } = useAuth();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!user || !session || initialized) return;

    async function init() {
      try {
        await initializeOfflineDB(user!.id);
        // Restore the durable queue count from IndexedDB. Without this, sales
        // saved in a previous offline session are invisible to the auto-sync
        // manager until another sale is created.
        const [offlineStats, pendingCount] = await Promise.all([
          getOfflineSalesStats(),
          getPendingOfflineSalesCount(),
        ]);
        updateSyncStats(pendingCount, offlineStats.synced, offlineStats.failed);
        setInitialized(true);

        if (navigator.onLine) {
          const fresh = await isCacheFresh();
          const productCount = await getCachedProductCount();
          // Re-sync if cache is stale OR empty (handles old users with empty cache)
          if (!fresh || productCount === 0) {
            console.log('[OfflineInit] Cache', fresh ? 'fresh but empty' : 'stale', '- syncing...');
            await performInitialCacheSync();
          }
        }
      } catch (error) {
        // Offline init failing must never break the app
        console.error('[OfflineInit] Failed:', error);
      }
    }

    init();
  }, [user?.id, session?.user?.id, initialized]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/**
 * Silent background component: triggers sync when connection returns.
 * Renders nothing — no UI visible anywhere.
 */
function OfflineSyncManager() {
  const status = useNetworkStatus();
  const queryClient = useQueryClient();
  const syncInProgress = useRef(false);
  const lastAttemptedPendingCount = useRef<number | null>(null);

  useEffect(() => {
    async function triggerSync() {
      if (status.status !== 'ONLINE') {
        // A real reconnection gets a fresh reconciliation attempt. Do not reset
        // during SYNCING, otherwise a failed sync would immediately retry in a loop.
        if (status.status === 'OFFLINE' || status.status === 'CONNECTIVITY_CHECKING') {
          lastAttemptedPendingCount.current = null;
        }
        return;
      }

      // Read IndexedDB instead of trusting the in-memory badge count. The
      // badge is reset on refresh, whereas the pending sale queue is durable.
      const pendingCount = await getPendingOfflineSalesCount();
      if (
        pendingCount === 0 ||
        syncInProgress.current ||
        lastAttemptedPendingCount.current === pendingCount
      ) {
        return;
      }

      syncInProgress.current = true;
      lastAttemptedPendingCount.current = pendingCount;
      console.log('[OfflineSync] Reconciling', pendingCount, 'local sale(s)');
      try {
        const result = await performOfflineSync();
        console.log('[OfflineSync] Sync result:', result);
        
        // After syncing sales, refresh the offline cache to get updated inventory from server
        if (result.synced > 0) {
          console.log('[OfflineSync] Refreshing offline cache after sync...');
          const { refreshOfflineCache } = await import('./lib/offline/sync');
          await refreshOfflineCache();
          
          // Invalidate inventory queries so UI refetches from cache
          queryClient.invalidateQueries({ queryKey: ['inventory'] });
          queryClient.invalidateQueries({ queryKey: ['inventory-all'] });
          console.log('[OfflineSync] Cache refreshed and inventory queries invalidated');
        }
        
        // Also sync offline shifts
        await syncOfflineShifts();
      } catch (err) {
        console.error('[OfflineSync] Auto-sync failed:', err);
      } finally {
        syncInProgress.current = false;
      }
    }

    void triggerSync();
  }, [status.status, status.pendingOperationCount]);

  return null;
}

export default function App() {
  const { session, loading } = useAuth();

  useRealtimeSync(session !== null);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <>
      {/* Silent offline infrastructure — no UI, no visible elements */}
      <OfflineInitializer />
      <OfflineSyncManager />

      {/* Offline Data Viewer (for development/debugging) */}
      {import.meta.env.DEV && <OfflineDataViewer />}

      <Routes>
        <Route path="/login" element={!session ? <LoginPage /> : <Navigate to="/" replace />} />
        <Route path="/change-password" element={session ? <ChangePasswordPage /> : <Navigate to="/login" replace />} />

        <Route path="/" element={session ? <ProtectedLayout /> : <Navigate to="/login" replace />}>
          <Route index element={<RoleGuard allowedRoles={['OWNER', 'CASHIER']} pagePath="/"><DashboardPage /></RoleGuard>} />
          <Route path="pos" element={<RoleGuard allowedRoles={['CASHIER']} pagePath="/pos"><POSPage /></RoleGuard>} />
          <Route path="shift" element={<RoleGuard allowedRoles={['CASHIER', 'OWNER', 'MANAGER']} pagePath="/shift"><ShiftManagementPage /></RoleGuard>} />
          <Route path="sales" element={<RoleGuard allowedRoles={['CASHIER', 'OWNER', 'MANAGER']} pagePath="/sales"><SalesHistoryPage /></RoleGuard>} />
          <Route path="sales-returns" element={<RoleGuard allowedRoles={['CASHIER', 'OWNER', 'MANAGER']} pagePath="/sales-returns"><SalesReturnsPage /></RoleGuard>} />
          <Route path="products" element={<RoleGuard allowedRoles={['OWNER']}><ProductsPage /></RoleGuard>} />
          <Route path="categories" element={<RoleGuard allowedRoles={['OWNER']}><CategoriesPage /></RoleGuard>} />
          <Route path="brands" element={<RoleGuard allowedRoles={['OWNER']}><BrandsPage /></RoleGuard>} />
          <Route path="stock" element={<RoleGuard allowedRoles={['OWNER']}><StockPage /></RoleGuard>} />
          <Route path="stock-movements" element={<RoleGuard allowedRoles={['OWNER']}><StockMovementsPage /></RoleGuard>} />
          <Route path="batches" element={<RoleGuard allowedRoles={['OWNER']}><BatchesPage /></RoleGuard>} />
          <Route path="reorder-recommendations" element={<RoleGuard allowedRoles={['OWNER', 'MANAGER', 'INVENTORY_MANAGER']}><ReorderRecommendationsPage /></RoleGuard>} />
          <Route path="suppliers" element={<RoleGuard allowedRoles={['OWNER']}><SuppliersPage /></RoleGuard>} />
          <Route path="purchase-orders" element={<RoleGuard allowedRoles={['OWNER']}><PurchaseOrdersPage /></RoleGuard>} />
          <Route path="goods-receipts" element={<RoleGuard allowedRoles={['OWNER']}><GoodsReceiptsPage /></RoleGuard>} />
          <Route path="purchase-returns" element={<RoleGuard allowedRoles={['OWNER']}><PurchaseReturnsPage /></RoleGuard>} />
          <Route path="customers" element={<RoleGuard allowedRoles={['OWNER', 'CASHIER']} pagePath="/customers"><CustomersPage /></RoleGuard>} />
          <Route path="khata" element={<RoleGuard allowedRoles={['OWNER', 'CASHIER']} pagePath="/khata"><KhataPage /></RoleGuard>} />
          <Route path="payments" element={<RoleGuard allowedRoles={['OWNER']}><PaymentsPage /></RoleGuard>} />
          <Route path="expenses" element={<RoleGuard allowedRoles={['OWNER', 'ACCOUNTANT', 'MANAGER']}><ExpensesPage /></RoleGuard>} />
          <Route path="accounting" element={<RoleGuard allowedRoles={['OWNER']}><AccountingPage /></RoleGuard>} />
          <Route path="reports" element={<RoleGuard allowedRoles={['OWNER', 'CASHIER']} pagePath="/reports"><ReportsPage /></RoleGuard>} />
          <Route path="employees" element={<RoleGuard allowedRoles={['OWNER', 'MANAGER']}><EmployeesPage /></RoleGuard>} />
          <Route path="notifications" element={<RoleGuard allowedRoles={['OWNER', 'CASHIER']} pagePath="/notifications"><NotificationsPage /></RoleGuard>} />
          <Route path="settings" element={<RoleGuard allowedRoles={['OWNER']}><SettingsPage /></RoleGuard>} />
          <Route path="permissions" element={<RoleGuard allowedRoles={['OWNER']}><PermissionsPage /></RoleGuard>} />
          <Route path="audit-logs" element={<RoleGuard allowedRoles={['OWNER']}><AuditLogsPage /></RoleGuard>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
