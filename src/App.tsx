import { Routes, Route, Navigate } from 'react-router-dom';
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
import { SuppliersPage } from './pages/purchasing/SuppliersPage';
import { PurchaseOrdersPage } from './pages/purchasing/PurchaseOrdersPage';
import { GoodsReceiptsPage } from './pages/purchasing/GoodsReceiptsPage';
import { PurchaseReturnsPage } from './pages/purchasing/PurchaseReturnsPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { KhataPage } from './pages/customers/KhataPage';
import { POSPage } from './pages/sales/POSPage';
import { SalesHistoryPage } from './pages/sales/SalesHistoryPage';
import { SalesReturnsPage } from './pages/sales/SalesReturnsPage';
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
import { useQuery } from '@tanstack/react-query';
import { fetchPagePermissions } from './services/permissions';
import type { AppRole } from './types/database';

function ProtectedLayout() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <MainLayout />;
}

function RoleGuard({ children, allowedRoles, pagePath }: { children: React.ReactNode; allowedRoles: AppRole[]; pagePath?: string }) {
  const { profile } = useAuth();

  // Fetch permissions — poll every 2s so disabled pages redirect instantly
  const { data: permissions = [] } = useQuery({
    queryKey: ['page-permissions', 'CASHIER'],
    queryFn: () => fetchPagePermissions('CASHIER'),
    enabled: profile?.role === 'CASHIER' && !!pagePath,
    staleTime: 0,
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
  });

  if (!profile || !allowedRoles.includes(profile.role)) {
    return (
      <div className="text-center py-10">
        <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
        <p className="text-gray-500">You don't have permission to view this page.</p>
      </div>
    );
  }

  // For CASHIER: if page got disabled while open, redirect to POS (cashier's main page)
  if (profile.role === 'CASHIER' && pagePath) {
    const perm = permissions.find((p) => p.page_path === pagePath);
    // If permission record exists and is disabled, redirect
    if (perm && !perm.enabled) {
      return <Navigate to="/pos" replace />;
    }
  }

  return <>{children}</>;
}

export default function App() {
  const { session, loading } = useAuth();

  // Subscribe to Supabase Realtime changes for live updates
  useRealtimeSync();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={!session ? <LoginPage /> : <Navigate to="/" replace />} />
      <Route path="/change-password" element={session ? <ChangePasswordPage /> : <Navigate to="/login" replace />} />
      
      <Route path="/" element={session ? <ProtectedLayout /> : <Navigate to="/login" replace />}>
        <Route index element={<RoleGuard allowedRoles={['OWNER', 'CASHIER']} pagePath="/"><DashboardPage /></RoleGuard>} />
        <Route path="pos" element={<RoleGuard allowedRoles={['CASHIER']} pagePath="/pos"><POSPage /></RoleGuard>} />
        <Route path="sales" element={<RoleGuard allowedRoles={['CASHIER']} pagePath="/sales"><SalesHistoryPage /></RoleGuard>} />
        <Route path="sales-returns" element={<RoleGuard allowedRoles={['CASHIER']} pagePath="/sales-returns"><SalesReturnsPage /></RoleGuard>} />
        <Route path="products" element={<RoleGuard allowedRoles={['OWNER']}><ProductsPage /></RoleGuard>} />
        <Route path="categories" element={<RoleGuard allowedRoles={['OWNER']}><CategoriesPage /></RoleGuard>} />
        <Route path="brands" element={<RoleGuard allowedRoles={['OWNER']}><BrandsPage /></RoleGuard>} />
        <Route path="stock" element={<RoleGuard allowedRoles={['OWNER']}><StockPage /></RoleGuard>} />
        <Route path="stock-movements" element={<RoleGuard allowedRoles={['OWNER']}><StockMovementsPage /></RoleGuard>} />
        <Route path="batches" element={<RoleGuard allowedRoles={['OWNER']}><BatchesPage /></RoleGuard>} />
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
  );
}
