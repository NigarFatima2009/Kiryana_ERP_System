import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Shield, Eye, EyeOff, Info, Users } from 'lucide-react';
import { fetchPagePermissions, updatePagePermission, fetchUsersByRole, fetchPagePermissionsForUser, updateUserPermissionOverride, type PagePermission, type ProfileUser } from '../../services/permissions';
import { useToast } from '../../components/ui/Toast';

// All pages grouped by category for the permissions UI
const pageGroups = [
  {
    label: 'Dashboard',
    pages: [
      { path: '/', label: 'Dashboard', description: 'Main dashboard with sales overview' },
    ],
  },
  {
    label: 'POS & Sales',
    pages: [
      { path: '/pos', label: 'Point of Sale', description: 'Process new sales transactions' },
      { path: '/shift', label: 'Shift Management', description: 'Open/close cashier shifts and reconcile cash' },
      { path: '/sales', label: 'Sales History', description: 'View past sales and invoices' },
      { path: '/sales-returns', label: 'Sales Returns', description: 'Process product returns from customers' },
    ],
  },
  {
    label: 'Inventory',
    pages: [
      { path: '/stock', label: 'Stock', description: 'View and manage inventory levels' },
      { path: '/stock-movements', label: 'Stock Movements', description: 'Track inventory in/out movements' },
      { path: '/batches', label: 'Batches & Expiry', description: 'Manage product batches and expiry dates' },
      { path: '/valuation', label: 'Inventory Valuation', description: 'Calculate inventory value using FIFO/LIFO/WA' },
      { path: '/reorder-recommendations', label: 'Reorder Recommendations', description: 'View products needing restock' },
    ],
  },
  {
    label: 'Purchasing',
    pages: [
      { path: '/suppliers', label: 'Suppliers', description: 'Manage supplier list and details' },
      { path: '/purchase-orders', label: 'Purchase Orders', description: 'Create and manage purchase orders' },
      { path: '/goods-receipts', label: 'Goods Receipts', description: 'Receive goods from suppliers' },
      { path: '/purchase-returns', label: 'Purchase Returns', description: 'Process returns to suppliers' },
    ],
  },
  {
    label: 'Customers',
    pages: [
      { path: '/customers', label: 'Customers', description: 'Manage customer list and details' },
      { path: '/khata', label: 'Khata (Ledger)', description: 'View customer credit/debit history' },
    ],
  },
  {
    label: 'Products',
    pages: [
      { path: '/products', label: 'Products', description: 'Manage product list and details' },
      { path: '/categories', label: 'Categories', description: 'Manage product categories' },
      { path: '/brands', label: 'Brands', description: 'Manage product brands' },
    ],
  },
  {
    label: 'Finance',
    pages: [
      { path: '/payments', label: 'Payments', description: 'Record and track payments' },
      { path: '/expenses', label: 'Expenses', description: 'Record business expenses' },
      { path: '/accounting', label: 'Accounting', description: 'View accounting reports and ledger' },
    ],
  },
  {
    label: 'Reports & Admin',
    pages: [
      { path: '/reports', label: 'Reports', description: 'View business reports and analytics' },
      { path: '/employees', label: 'Employees', description: 'Manage employee list and details' },
      { path: '/notifications', label: 'Notifications', description: 'View system notifications' },
      { path: '/settings', label: 'Settings', description: 'System settings and configuration' },
      { path: '/permissions', label: 'Page Permissions', description: 'Control page access for users' },
      { path: '/audit-logs', label: 'Audit Logs', description: 'View system activity and audit trail' },
    ],
  },
];

export function PermissionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [mode, setMode] = useState<'role' | 'user'>('role');

  // Fetch all CASHIER users
  const { data: cashierUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ['cashier-users'],
    queryFn: () => fetchUsersByRole('CASHIER'),
  });

  // Fetch role-level permissions
  const { data: rolePermissions = [], isLoading: roleLoading } = useQuery({
    queryKey: ['page-permissions', 'CASHIER'],
    queryFn: () => fetchPagePermissions('CASHIER'),
    enabled: mode === 'role',
  });

  // Fetch user-level permissions (with overrides merged)
  const { data: userPermissions = [], isLoading: userLoading } = useQuery({
    queryKey: ['user-page-permissions', selectedUserId],
    queryFn: () => {
      if (!selectedUserId) return Promise.resolve([]);
      return fetchPagePermissionsForUser(selectedUserId, 'CASHIER');
    },
    enabled: mode === 'user' && !!selectedUserId,
  });

  const updateRolePermMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updatePagePermission(id, enabled),
    onSuccess: async () => {
      // Refetch both role permissions and ALL user permissions (overrides depend on role defaults)
      await queryClient.invalidateQueries({ queryKey: ['page-permissions', 'CASHIER'] });
      await queryClient.invalidateQueries({ queryKey: ['user-page-permissions'] });
      // Also refetch sidebar permissions so changes apply instantly
      await queryClient.invalidateQueries({ queryKey: ['page-permissions'] });
      toast('success', 'Role permissions updated — all CASHIERs affected immediately');
    },
    onError: (e: Error) => toast('error', `Failed to update role permissions: ${e.message}`),
  });

  const updateUserPermMutation = useMutation({
    mutationFn: ({ userId, pagePath, enabled }: { userId: string; pagePath: string; enabled: boolean }) =>
      updateUserPermissionOverride(userId, pagePath, enabled),
    onSuccess: async () => {
      // Refetch this user's permissions
      if (selectedUserId) {
        await queryClient.invalidateQueries({ queryKey: ['user-page-permissions', selectedUserId] });
        // Also refetch sidebar if this is the current user
        await queryClient.invalidateQueries({ queryKey: ['page-permissions'] });
      }
      toast('success', 'User permissions updated immediately');
    },
    onError: (e: Error) => toast('error', `Failed to update user permissions: ${e.message}`),
  });

  const handleToggleRolePermission = (perm: PagePermission, enabled: boolean) => {
    updateRolePermMutation.mutate({ id: perm.id, enabled });
  };

  const handleToggleUserPermission = (pagePath: string, enabled: boolean) => {
    if (!selectedUserId) return;
    updateUserPermMutation.mutate({ userId: selectedUserId, pagePath, enabled });
  };

  // Create a map of path -> permission for quick lookup
  const permMap = new Map(rolePermissions.map((p) => [p.page_path, p]));
  const userPermMap = new Map(userPermissions.map((p) => [p.page_path, p]));

  const enabledCount = rolePermissions.filter((p) => p.enabled).length;
  const totalCount = rolePermissions.length;

  const selectedUser = cashierUsers.find(u => u.id === selectedUserId);
  const userEnabledCount = userPermissions.filter((p) => p.enabled).length;
  const userTotalCount = userPermissions.length;

  const isLoading = mode === 'role' ? roleLoading : userLoading || usersLoading;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Page Permissions</h1>
          <p className="text-sm text-gray-500 mt-1">Control which pages users can see and access</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
          <Info size={14} className="text-blue-600" />
          <span className="text-xs text-blue-700 font-medium">
            {mode === 'role' ? `${enabledCount}/${totalCount} pages for all CASHIERs` : `${userEnabledCount}/${userTotalCount} pages for ${selectedUser?.full_name || 'user'}`}
          </span>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => { setMode('role'); setSelectedUserId(null); }}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            mode === 'role'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          Role Defaults (All CASHIERs)
        </button>
        <button
          onClick={() => setMode('user')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            mode === 'user'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <Users size={16} />
          Individual User
        </button>
      </div>

      {/* Info card */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <Shield size={18} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-800">
            <p className="font-semibold mb-1">How it works:</p>
            {mode === 'role' ? (
              <ul className="space-y-0.5 list-disc list-inside">
                <li>Toggle pages ON/OFF for the CASHIER role (affects all cashiers)</li>
                <li>These are the foundation — role must be ON first</li>
                <li>Individual cashiers can add additional restrictions on top</li>
                <li><span className="font-semibold">AND Logic:</span> Both role AND individual must be ON for access</li>
                <li>The Owner always has access to all pages</li>
              </ul>
            ) : (
              <ul className="space-y-0.5 list-disc list-inside">
                <li>Select a cashier to add individual restrictions on top of role defaults</li>
                <li><span className="font-semibold">AND Logic:</span> If role is ON and individual is OFF → page is OFF</li>
                <li>Green icon = both role and individual allow it (or no individual restriction)</li>
                <li>Gray icon = either role OR individual (or both) restrict it</li>
                <li><span className="font-semibold">Blue badge:</span> Shows this page has an individual restriction</li>
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* User selector for individual mode */}
      {mode === 'user' && (
        <div className="card">
          <label className="label">Select Cashier</label>
          <select
            value={selectedUserId || ''}
            onChange={(e) => setSelectedUserId(e.target.value || null)}
            className="select-field"
          >
            <option value="">Choose a cashier...</option>
            {cashierUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {isLoading ? (
        <div className="card py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
        </div>
      ) : mode === 'role' ? (
        <div className="space-y-4">
          {pageGroups.map((group) => (
            <div key={group.label} className="card">
              <div className="border-b border-gray-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-gray-800">{group.label}</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {group.pages.map((page) => {
                  const perm = permMap.get(page.path);
                  const isEnabled = perm?.enabled ?? true;

                  return (
                    <div
                      key={page.path}
                      className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isEnabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                          {isEnabled ? (
                            <Eye size={16} className="text-green-600" />
                          ) : (
                            <EyeOff size={16} className="text-gray-400" />
                          )}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${isEnabled ? 'text-gray-900' : 'text-gray-400'}`}>
                            {page.label}
                          </p>
                          <p className="text-xs text-gray-500">{page.description}</p>
                          <p className="text-xs text-gray-400 mt-0.5 font-mono">{page.path}</p>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          if (perm) {
                            handleToggleRolePermission(perm, !isEnabled);
                          }
                        }}
                        disabled={!perm || updateRolePermMutation.isPending}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          isEnabled ? 'bg-green-600' : 'bg-gray-300'
                        } disabled:opacity-50`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            isEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : selectedUserId ? (
        <div className="space-y-4">
          {pageGroups.map((group) => (
            <div key={group.label} className="card">
              <div className="border-b border-gray-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-gray-800">{group.label}</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {group.pages.map((page) => {
                  const perm = userPermMap.get(page.path);
                  const isEnabled = perm?.enabled ?? true;
                  const isOverride = perm?.isOverride ?? false;

                  return (
                    <div
                      key={page.path}
                      className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isEnabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                          {isEnabled ? (
                            <Eye size={16} className="text-green-600" />
                          ) : (
                            <EyeOff size={16} className="text-gray-400" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-medium ${isEnabled ? 'text-gray-900' : 'text-gray-400'}`}>
                              {page.label}
                            </p>
                            {isOverride && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                                Override
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">{page.description}</p>
                          <p className="text-xs text-gray-400 mt-0.5 font-mono">{page.path}</p>
                        </div>
                      </div>

                      <button
                        onClick={() => handleToggleUserPermission(page.path, !isEnabled)}
                        disabled={updateUserPermMutation.isPending}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          isEnabled ? 'bg-green-600' : 'bg-gray-300'
                        } disabled:opacity-50`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            isEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card py-8 text-center text-gray-500">
          <Users size={32} className="mx-auto mb-2 opacity-50" />
          <p>Select a cashier to customize their permissions</p>
        </div>
      )}
    </div>
  );
}
