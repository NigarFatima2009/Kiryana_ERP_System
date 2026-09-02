import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, ShoppingCart, Package, Warehouse, Truck, Users, CreditCard,
  Receipt, BarChart3, Settings, Bell, Shield, ChevronDown, ChevronRight,
  Store, Tags, Boxes, ArrowLeftRight, FileText, UserCircle, ClipboardList,
  Banknote, BookOpen, AlertTriangle, PackageX, HandCoins, CircleDollarSign,
  ScrollText, LogOut, PanelLeftClose, PanelLeftOpen, Lock,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { fetchPagePermissions } from '../../services/permissions';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

interface NavGroup {
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
  roles?: string[];
}

const navigation: NavGroup[] = [
  // Dashboard — ALL
  { label: 'Dashboard', icon: <LayoutDashboard size={20} />, items: [{ label: 'Dashboard', path: '/', icon: <LayoutDashboard size={18} /> }], roles: ['OWNER', 'CASHIER'] },
  {
    label: 'POS',
    icon: <ShoppingCart size={20} />,
    items: [
      { label: 'Point of Sale', path: '/pos', icon: <Store size={18} /> },
      { label: 'Shift Management', path: '/shift', icon: <ScrollText size={18} /> },
      { label: 'Sales History', path: '/sales', icon: <FileText size={18} /> },
      { label: 'Sales Returns', path: '/sales-returns', icon: <PackageX size={18} /> },
    ],
    roles: ['CASHIER'],
  },

  // Products — OWNER only
  {
    label: 'Products',
    icon: <Package size={20} />,
    items: [
      { label: 'Products', path: '/products', icon: <Package size={18} /> },
      { label: 'Categories', path: '/categories', icon: <Tags size={18} /> },
      { label: 'Brands', path: '/brands', icon: <Tags size={18} /> },
    ],
    roles: ['OWNER'],
  },

  // Inventory — OWNER only
  {
    label: 'Inventory',
    icon: <Warehouse size={20} />,
    items: [
      { label: 'Stock', path: '/stock', icon: <Boxes size={18} /> },
      { label: 'Stock Movements', path: '/stock-movements', icon: <ArrowLeftRight size={18} /> },
      { label: 'Batches & Expiry', path: '/batches', icon: <AlertTriangle size={18} /> },
    ],
    roles: ['OWNER'],
  },

  // Purchasing — OWNER only
  {
    label: 'Purchasing',
    icon: <Truck size={20} />,
    items: [
      { label: 'Reorder Recommendations', path: '/reorder-recommendations', icon: <AlertTriangle size={18} /> },
      { label: 'Suppliers', path: '/suppliers', icon: <Users size={18} /> },
      { label: 'Purchase Orders', path: '/purchase-orders', icon: <ClipboardList size={18} /> },
      { label: 'Goods Receipts', path: '/goods-receipts', icon: <Receipt size={18} /> },
      { label: 'Purchase Returns', path: '/purchase-returns', icon: <PackageX size={18} /> },
    ],
    roles: ['OWNER'],
  },

  // Customers — OWNER + CASHIER (cashier collects payments)
  {
    label: 'Customers',
    icon: <Users size={20} />,
    items: [
      { label: 'Customers', path: '/customers', icon: <Users size={18} /> },
      { label: 'Khata', path: '/khata', icon: <BookOpen size={18} /> },
    ],
    roles: ['OWNER', 'CASHIER'],
  },

  // Finance — OWNER only
  {
    label: 'Finance',
    icon: <CircleDollarSign size={20} />,
    items: [
      { label: 'Payments', path: '/payments', icon: <HandCoins size={18} /> },
      { label: 'Expenses', path: '/expenses', icon: <Banknote size={18} /> },
      { label: 'Accounting', path: '/accounting', icon: <ScrollText size={18} /> },
    ],
    roles: ['OWNER'],
  },

  // Reports — OWNER only
  {
    label: 'Reports',
    icon: <BarChart3 size={20} />,
    items: [{ label: 'Reports', path: '/reports', icon: <BarChart3 size={18} /> }],
    roles: ['OWNER'],
  },

  // Employees — OWNER only
  {
    label: 'Employees',
    icon: <UserCircle size={20} />,
    items: [{ label: 'Employees', path: '/employees', icon: <UserCircle size={18} /> }],
    roles: ['OWNER'],
  },

  // Notifications — ALL
  {
    label: 'Notifications',
    icon: <Bell size={20} />,
    items: [{ label: 'Notifications', path: '/notifications', icon: <Bell size={18} /> }],
    roles: ['OWNER', 'CASHIER'],
  },

  // Settings — OWNER only
  {
    label: 'Settings',
    icon: <Settings size={20} />,
    items: [
      { label: 'Settings', path: '/settings', icon: <Settings size={18} /> },
      { label: 'Page Permissions', path: '/permissions', icon: <Lock size={18} /> },
      { label: 'Audit Logs', path: '/audit-logs', icon: <Shield size={18} /> },
    ],
    roles: ['OWNER'],
  },
];

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({ isOpen, onToggle }: SidebarProps) {
  const location = useLocation();
  const { profile, signOut } = useAuth();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    navigation.forEach((g) => { initial[g.label] = true; });
    return initial;
  });

  // Fetch low stock count for badge
  const { data: lowStockCount = 0 } = useQuery<number>({
    queryKey: ['low-stock-count'],
    queryFn: async () => {
      const { data: inv } = await supabase.from('inventory').select('product_id, quantity');
      const { data: prods } = await supabase.from('products').select('id, reorder_level').eq('active', true);
      const reorderMap = new Map((prods || []).map((p: any) => [p.id, p.reorder_level]));
      return (inv || []).filter((i: any) => {
        const rl = reorderMap.get(i.product_id) || 0;
        return rl > 0 && i.quantity <= rl;
      }).length;
    },
    refetchInterval: 60000,
    staleTime: 60000,
  });

  // Fetch expiring soon count for badge
  const { data: expiringCount = 0 } = useQuery<number>({
    queryKey: ['expiring-count'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const { count } = await supabase
        .from('inventory_batches')
        .select('id', { count: 'exact', head: true })
        .lte('expiry_date', expiry)
        .gt('expiry_date', today)
        .gt('remaining_quantity', 0);
      return count || 0;
    },
    refetchInterval: 60000,
    staleTime: 60000,
  });

  // Fetch page permissions — cached in localStorage for offline use
  const { data: permissions = [] } = useQuery({
    queryKey: ['page-permissions', profile?.id || 'CASHIER'],
    queryFn: async () => {
      if (!profile) return [];
      const cacheKey = `page-permissions-${profile.id || profile.role}`;
      try {
        let perms;
        if (profile.role === 'CASHIER' && profile.id) {
          const { fetchPagePermissionsForUser } = await import('../../services/permissions');
          perms = await fetchPagePermissionsForUser(profile.id, 'CASHIER');
        } else {
          const { fetchPagePermissions } = await import('../../services/permissions');
          perms = await fetchPagePermissions(profile.role);
        }
        // Cache to localStorage for offline fallback
        try { localStorage.setItem(cacheKey, JSON.stringify(perms)); } catch {}
        console.log('✓ Permissions fetched:', perms.length, 'pages');
        return perms;
      } catch (error) {
        console.warn('Permission fetch failed (using cache):', (error instanceof Error ? error.message : String(error)).substring(0, 80));
        // Fall back to cached permissions from localStorage
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached);
            console.log('✓ Using cached permissions:', parsed.length, 'pages');
            return parsed;
          }
        } catch {}
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,     // Cache for 5 minutes
    refetchInterval: navigator.onLine ? 30_000 : false, // Poll every 30s (online only)
    enabled: !!profile,
    retry: navigator.onLine ? 2 : 0, // Don't retry when offline
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Build a set of enabled paths for quick lookup
  const enabledPaths = new Set(
    permissions.filter((p: any) => p.enabled).map((p: any) => p.page_path)
  );

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const isVisible = (group: NavGroup) => {
    if (!group.roles) return true;
    if (!profile) return false;
    if (!group.roles.includes(profile.role)) return false;

    // For CASHIER: check page permissions
    if (profile.role === 'CASHIER') {
      // SAFETY FALLBACK: If permissions array is empty (loading or error),
      // still show groups — better to show everything than hide everything
      if (permissions.length === 0) {
        return true;
      }
      // Show group if at least one of its pages is enabled
      const hasEnabledPage = group.items.some((item) => enabledPaths.has(item.path));
      return hasEnabledPage;
    }

    return true;
  };

  // Filter items within a group based on permissions
  const getVisibleItems = (group: NavGroup) => {
    if (profile?.role !== 'CASHIER') return group.items;
    
    // SAFETY FALLBACK: If permissions array is empty (loading or error),
    // show all items — better than hiding everything
    if (permissions.length === 0) {
      return group.items;
    }
    
    return group.items.filter((item) => enabledPaths.has(item.path));
  };

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <aside
      className={`${
        isOpen ? 'w-64' : 'w-16'
      } flex flex-col border-r border-gray-200 bg-white transition-all duration-200 ease-in-out`}
    >
      {/* Logo */}
      <div className="flex h-14 items-center justify-between border-b border-gray-100 px-4">
        {isOpen ? (
          <div className="flex items-center gap-2">
            <Store className="h-6 w-6 text-gray-700" />
            <span className="text-base font-semibold text-gray-900">Kiryana ERP</span>
          </div>
        ) : (
          <div className="flex w-full justify-center">
            <Store className="h-5 w-5 text-gray-600" />
          </div>
        )}
        {isOpen && (
          <button onClick={onToggle} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <PanelLeftClose size={18} />
          </button>
        )}
      </div>

      {!isOpen && (
        <div className="flex justify-center py-2">
          <button onClick={onToggle} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <PanelLeftOpen size={18} />
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto no-scrollbar px-2 py-2 space-y-0.5">
        {navigation.map((group) => {
          if (!isVisible(group)) return null;
          return (
            <div key={group.label}>
              {isOpen ? (
                <>
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  >
                    <span className="text-gray-500">{group.icon}</span>
                    <span className="flex-1 text-left">{group.label}</span>
                    {expandedGroups[group.label] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {expandedGroups[group.label] && (
                    <div className="ml-4 space-y-0.5 border-l border-gray-200 pl-2">
                      {getVisibleItems(group).map((item) => (
                        <Link
                          key={item.path}
                          to={item.path}
                          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${
                            isActive(item.path)
                              ? 'bg-blue-50 text-blue-700 font-medium'
                              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                          }`}
                        >
                          {item.label}
                          {item.path === '/stock' && Number(lowStockCount) > 0 && (
                            <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
                              {String(lowStockCount)}
                            </span>
                          )}
                          {item.path === '/batches' && Number(expiringCount) > 0 && (
                            <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold">
                              {String(expiringCount)}
                            </span>
                          )}
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="relative group">
                  <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none z-50 whitespace-nowrap">
                    {group.label}
                  </div>
                  {getVisibleItems(group).map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      title={item.label}
                      className={`relative flex items-center justify-center rounded-lg p-2 my-0.5 ${
                        isActive(item.path)
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                      }`}
                    >
                      {item.icon}
                      {item.path === '/stock' && Number(lowStockCount) > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold">
                          {String(lowStockCount)}
                        </span>
                      )}
                      {item.path === '/batches' && Number(expiringCount) > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded-full bg-orange-500 text-white text-[8px] font-bold">
                          {String(expiringCount)}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User section */}
      <div className="border-t border-gray-100 p-3">
        {isOpen ? (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-600">
              {profile?.full_name?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{profile?.full_name || 'User'}</p>
              <p className="text-xs text-gray-500 truncate">{profile?.role?.replace('_', ' ')}</p>
            </div>
            <button onClick={signOut} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Sign Out">
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <button onClick={signOut} className="flex w-full items-center justify-center rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Sign Out">
            <LogOut size={16} />
          </button>
        )}
      </div>
    </aside>
  );
}
