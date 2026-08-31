import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Shield, Eye, EyeOff, Check, X, Save, Info } from 'lucide-react';
import { fetchPagePermissions, updatePagePermission, type PagePermission } from '../../services/permissions';
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
      { path: '/sales', label: 'Sales History', description: 'View past sales and invoices' },
      { path: '/sales-returns', label: 'Sales Returns', description: 'Process product returns from customers' },
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
    label: 'Reports & Other',
    pages: [
      { path: '/reports', label: 'Reports', description: 'View sales and inventory reports' },
      { path: '/notifications', label: 'Notifications', description: 'View system notifications' },
    ],
  },
];

export function PermissionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [hasChanges, setHasChanges] = useState(false);

  const { data: permissions = [], isLoading } = useQuery({
    queryKey: ['page-permissions', 'CASHIER'],
    queryFn: () => fetchPagePermissions('CASHIER'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updatePagePermission(id, enabled),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['page-permissions'] });
      setHasChanges(false);
      toast('success', 'Permissions updated — changes apply immediately for cashiers');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const handleToggle = (perm: PagePermission, enabled: boolean) => {
    updateMutation.mutate({ id: perm.id, enabled });
  };

  // Create a map of path -> permission for quick lookup
  const permMap = new Map(permissions.map((p) => [p.page_path, p]));

  const enabledCount = permissions.filter((p) => p.enabled).length;
  const totalCount = permissions.length;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Page Permissions</h1>
          <p className="text-sm text-gray-500 mt-1">Control which pages the Cashier can see and access</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
          <Info size={14} className="text-blue-600" />
          <span className="text-xs text-blue-700 font-medium">
            {enabledCount}/{totalCount} pages enabled for Cashier
          </span>
        </div>
      </div>

      {/* Info card */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <Shield size={18} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-800">
            <p className="font-semibold mb-1">How it works:</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>Toggle pages ON/OFF for the Cashier role</li>
              <li>Disabled pages disappear from the Cashier's sidebar and cannot be accessed</li>
              <li>Changes take effect immediately — no restart needed</li>
              <li>The Owner always has access to all pages</li>
            </ul>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="card py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
        </div>
      ) : (
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
                            handleToggle(perm, !isEnabled);
                          }
                        }}
                        disabled={!perm || updateMutation.isPending}
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
      )}
    </div>
  );
}
