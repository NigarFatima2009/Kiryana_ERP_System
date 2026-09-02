import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import {
  getDashboardStats, getSalesChartData, getTopSellingProducts,
  getSalesByPaymentMethod, getSalesByCategory, getStockByCategory,
  compareSalesTrend, getPerformanceMetrics, getCustomerMetrics, getInventoryTurnoverMetrics,
  getExpiringItems, getDashboardStatsByCashier, getPerformanceMetricsByCashier,
  getSalesByPaymentMethodByCashier, getSalesByCategoryByCashier, compareSalesTrendByCashier,
} from '../services/dashboard';
import { useAuth } from '../lib/auth';
import { formatCurrency } from '../utils/helpers';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const COLORS = ['#475569', '#1d4ed8', '#b45309', '#15803d', '#9333ea', '#be123c'];

function StatCard({ title, value, onClick, trend, trendPercent }: { title: string; value: string; onClick?: () => void; trend?: 'up' | 'down' | 'neutral'; trendPercent?: number }) {
  return (
    <div
      onClick={onClick}
      className={`bg-white border border-gray-200 rounded-lg p-4 ${onClick ? 'cursor-pointer hover:border-gray-300 transition-colors' : ''}`}
    >
      <div className="flex justify-between items-start">
        <div>
          <p className="text-xs text-gray-400 font-medium">{title}</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        {trend && trendPercent !== undefined && (
          <div className="flex items-center gap-1">
            {trend === 'up' && <TrendingUp className="w-4 h-4 text-green-600" />}
            {trend === 'down' && <TrendingDown className="w-4 h-4 text-red-600" />}
            {trend === 'neutral' && <Minus className="w-4 h-4 text-gray-400" />}
            <span className={`text-xs font-medium ${trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-gray-400'}`}>
              {Math.abs(trendPercent).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const tooltipStyle = { borderRadius: '6px', border: '1px solid #e5e7eb', fontSize: '13px' };

export function DashboardPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [trendPeriod, setTrendPeriod] = useState<'day' | 'week' | 'month'>('day');

  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => getDashboardStats(),
    staleTime: 60_000, // 1 minute - dashboard aggregations are expensive
    refetchInterval: 120_000, // Only refetch every 2 minutes, not 10 seconds
  });

  const { data: chartData } = useQuery({ 
    queryKey: ['sales-chart'], 
    queryFn: () => getSalesChartData(14),
    staleTime: 60_000,
  });
  
  const { data: topProducts } = useQuery({ 
    queryKey: ['top-products'], 
    queryFn: () => getTopSellingProducts(5),
    staleTime: 60_000,
  });
  
  const { data: paymentMethods } = useQuery({ 
    queryKey: ['payment-methods'], 
    queryFn: () => getSalesByPaymentMethod(),
    staleTime: 60_000,
  });
  
  const { data: categorySales } = useQuery({ 
    queryKey: ['category-sales'], 
    queryFn: () => getSalesByCategory(),
    staleTime: 60_000,
  });
  
  const { data: stockByCategory } = useQuery({ 
    queryKey: ['stock-category'], 
    queryFn: () => getStockByCategory(),
    staleTime: 60_000,
  });
  
  // Trend data
  const { data: trendComparison } = useQuery({
    queryKey: ['trend-comparison', trendPeriod],
    queryFn: () => compareSalesTrend(trendPeriod),
    staleTime: 60_000,
    refetchInterval: 180_000, // Increased from 30s to 3 minutes
  });

  const { data: performanceMetrics } = useQuery({
    queryKey: ['performance-metrics'],
    queryFn: () => getPerformanceMetrics(30),
    staleTime: 60_000,
    refetchInterval: 180_000, // Increased from 60s to 3 minutes
  });

  const { data: customerMetrics } = useQuery({
    queryKey: ['customer-metrics'],
    queryFn: () => getCustomerMetrics(),
    staleTime: 60_000,
    refetchInterval: 180_000, // Increased from 60s to 3 minutes
  });

  const { data: inventoryMetrics } = useQuery({
    queryKey: ['inventory-metrics'],
    queryFn: () => getInventoryTurnoverMetrics(),
    staleTime: 60_000,
    refetchInterval: 180_000, // Increased from 60s to 3 minutes
  });

  const { data: expiringItems } = useQuery({
    queryKey: ['expiring-items'],
    queryFn: () => getExpiringItems(7),
    staleTime: 60_000,
    refetchInterval: 300_000, // Increased from 30s to 5 minutes - expiring items don't change that often
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-200 border-t-gray-600" />
      </div>
    );
  }

  // Get trend indicators
  const getTrendIndicator = (percent: number): 'up' | 'down' | 'neutral' => {
    if (percent > 5) return 'up';
    if (percent < -5) return 'down';
    return 'neutral';
  };

  // CASHIER: Only show sales-related cards
  if (profile?.role === 'CASHIER') {
    // Use cashier-specific queries
    const { data: cashierStats } = useQuery({
      queryKey: ['dashboard-stats-cashier', profile.id],
      queryFn: () => getDashboardStatsByCashier(profile.id),
      refetchInterval: 10000,
    });

    const { data: cashierTrend } = useQuery({
      queryKey: ['trend-comparison-cashier', trendPeriod, profile.id],
      queryFn: () => compareSalesTrendByCashier(profile.id, trendPeriod),
      refetchInterval: 30000,
    });

    const { data: cashierPerformance } = useQuery({
      queryKey: ['performance-metrics-cashier', profile.id],
      queryFn: () => getPerformanceMetricsByCashier(profile.id, 30),
      refetchInterval: 60000,
    });

    const { data: cashierPaymentMethods } = useQuery({
      queryKey: ['payment-methods-cashier', profile.id],
      queryFn: () => getSalesByPaymentMethodByCashier(profile.id),
      refetchInterval: 30000,
    });

    const { data: cashierCategorySales } = useQuery({
      queryKey: ['category-sales-cashier', profile.id],
      queryFn: () => getSalesByCategoryByCashier(profile.id),
      refetchInterval: 30000,
    });

    return (
      <div className="space-y-6 max-w-7xl">
        <h1 className="text-lg font-semibold text-gray-900">Dashboard</h1>

        {/* Trend Period Selector */}
        <div className="flex gap-2">
          <button
            onClick={() => setTrendPeriod('day')}
            className={`px-3 py-1 rounded text-sm font-medium ${
              trendPeriod === 'day'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setTrendPeriod('week')}
            className={`px-3 py-1 rounded text-sm font-medium ${
              trendPeriod === 'week'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            This Week
          </button>
          <button
            onClick={() => setTrendPeriod('month')}
            className={`px-3 py-1 rounded text-sm font-medium ${
              trendPeriod === 'month'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            This Month
          </button>
        </div>

        {/* Sales only for cashiers with trends */}
        <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
          <StatCard
            title="Total Sales"
            value={formatCurrency(cashierTrend?.current?.sales || 0)}
            onClick={() => navigate('/sales')}
            trend={getTrendIndicator(cashierTrend?.salesChangePercent || 0)}
            trendPercent={cashierTrend?.salesChangePercent}
          />
          <StatCard
            title="Total Profit"
            value={formatCurrency(cashierTrend?.current?.profit || 0)}
            trend={getTrendIndicator(cashierTrend?.profitChangePercent || 0)}
            trendPercent={cashierTrend?.profitChangePercent}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
          <StatCard title="Transactions" value={String(cashierTrend?.current?.transactions || 0)} />
          <StatCard
            title="Avg Transaction"
            value={formatCurrency(cashierTrend?.current?.avgTransactionValue || 0)}
          />
        </div>

        {/* Charts - Sales and Payment Methods only */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Sales Performance Metrics */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Your Sales Performance (30 Days)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={cashierPerformance || []}>
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={(d) => new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric' })} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                <Legend />
                <Line type="monotone" dataKey="sales" stroke="#475569" strokeWidth={2} dot={false} name="Daily Sales" />
                <Line type="monotone" dataKey="profit" stroke="#15803d" strokeWidth={2} dot={false} name="Daily Profit" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Payment Methods */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Your Payment Methods</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <defs>
                  {COLORS.map((color, i) => (
                    <pattern key={`pie-hatch-${i}`} id={`pieHatch${i}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform={`rotate(${i * 30})`}>
                      <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="1.2" opacity="0.35" />
                    </pattern>
                  ))}
                </defs>
                <Pie
                  data={(cashierPaymentMethods || []).map((p) => ({
                    ...p,
                    method: p.method.replace('CUSTOMER_CREDIT', 'Khata').replace('BANK_TRANSFER', 'Bank').replace('EASYPAISA', 'Easypaisa').replace('JAZZCASH', 'JazzCash'),
                  }))}
                  cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2}
                  dataKey="amount" nameKey="method" strokeWidth={2}
                >
                  {(cashierPaymentMethods || []).map((_, i) => <Cell key={i} fill={`url(#pieHatch${i % 6})`} stroke={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                <Legend verticalAlign="bottom" height={30} formatter={(v) => <span className="text-xs text-gray-600">{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Category Sales */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Your Sales by Category</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <defs>
                  {COLORS.map((color, i) => (
                    <pattern key={`cat-hatch-${i}`} id={`catHatch${i}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform={`rotate(${i * 30 + 15})`}>
                      <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="1.2" opacity="0.35" />
                    </pattern>
                  ))}
                </defs>
                <Pie
                  data={cashierCategorySales || []} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2}
                  dataKey="value" nameKey="name" strokeWidth={2}
                >
                  {(cashierCategorySales || []).map((_, i) => <Cell key={i} fill={`url(#catHatch${i % 6})`} stroke={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                <Legend verticalAlign="bottom" height={30} formatter={(v) => <span className="text-xs text-gray-600">{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    );
  }

  // OWNER/MANAGER/OTHERS: Show all cards with trends
  return (
    <div className="space-y-6 max-w-7xl">
      <h1 className="text-lg font-semibold text-gray-900">Dashboard</h1>

      {/* Trend Period Selector */}
      <div className="flex gap-2">
        <button
          onClick={() => setTrendPeriod('day')}
          className={`px-3 py-1 rounded text-sm font-medium ${
            trendPeriod === 'day'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Today
        </button>
        <button
          onClick={() => setTrendPeriod('week')}
          className={`px-3 py-1 rounded text-sm font-medium ${
            trendPeriod === 'week'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          This Week
        </button>
        <button
          onClick={() => setTrendPeriod('month')}
          className={`px-3 py-1 rounded text-sm font-medium ${
            trendPeriod === 'month'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          This Month
        </button>
      </div>

      {/* Stats with Trends */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          title="Total Sales"
          value={formatCurrency(trendComparison?.current?.sales || 0)}
          onClick={() => navigate('/sales')}
          trend={getTrendIndicator(trendComparison?.salesChangePercent || 0)}
          trendPercent={trendComparison?.salesChangePercent}
        />
        <StatCard
          title="Total Profit"
          value={formatCurrency(trendComparison?.current?.profit || 0)}
          onClick={() => navigate('/reports')}
          trend={getTrendIndicator(trendComparison?.profitChangePercent || 0)}
          trendPercent={trendComparison?.profitChangePercent}
        />
        <StatCard title="Today's Purchases" value={formatCurrency(stats?.todayPurchases || 0)} onClick={() => navigate('/purchase-orders')} />
        <StatCard title="Today's Expenses" value={formatCurrency(stats?.todayExpenses || 0)} onClick={() => navigate('/expenses')} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Cash in Hand" value={formatCurrency(stats?.cashInHand || 0)} />
        <StatCard title="Receivables" value={formatCurrency(stats?.customerReceivables || 0)} onClick={() => navigate('/khata')} />
        <StatCard title="Payables" value={formatCurrency(stats?.supplierPayables || 0)} onClick={() => navigate('/suppliers')} />
        <StatCard title="Inventory Value" value={formatCurrency(stats?.inventoryValue || 0)} onClick={() => navigate('/stock')} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Total Products" value={String(stats?.totalProducts || 0)} onClick={() => navigate('/products')} />
        <StatCard title="Low Stock Items" value={String(stats?.lowStockProducts || 0)} onClick={() => navigate('/stock')} />
        <StatCard title="Expiring Soon" value={String(stats?.expiringProducts || 0)} onClick={() => navigate('/batches')} />
        <StatCard title="Customer Turnover" value={(inventoryMetrics?.turnoverRatio.toFixed(2) || '0') + 'x'} />
      </div>

      {/* Metrics Cards */}
      {customerMetrics && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Customer Metrics</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Customers:</span>
                <span className="font-semibold">{customerMetrics.totalCustomers}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Active (30d):</span>
                <span className="font-semibold">{customerMetrics.activeCustomers}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Credit:</span>
                <span className="font-semibold">{formatCurrency(customerMetrics.totalCredit)}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-2">
                <span className="text-gray-600">Receivables:</span>
                <span className="font-semibold text-blue-600">{formatCurrency(customerMetrics.totalReceivables)}</span>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Inventory Turnover</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Inventory Value:</span>
                <span className="font-semibold">{formatCurrency(inventoryMetrics?.totalInventoryValue || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Annual COGS:</span>
                <span className="font-semibold">{formatCurrency(inventoryMetrics?.costOfGoodsSold || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Turnover Ratio:</span>
                <span className="font-semibold">{(inventoryMetrics?.turnoverRatio.toFixed(2) || '0')}x</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-2">
                <span className="text-gray-600">Days Outstanding:</span>
                <span className="font-semibold text-blue-600">{(inventoryMetrics?.daysInventoryOutstanding.toFixed(0) || '0')} days</span>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Expiring Items (7 Days)</h3>
            {expiringItems && expiringItems.length > 0 ? (
              <div className="space-y-2 text-sm">
                {expiringItems.slice(0, 5).map((item: any) => (
                  <div key={item.id} className="flex justify-between items-start pb-2 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="font-medium text-slate-900">{item.productName}</p>
                      <p className="text-xs text-gray-500">{item.quantity} units</p>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${item.daysUntilExpiry <= 2 ? 'bg-red-100 text-red-700' : item.daysUntilExpiry <= 4 ? 'bg-yellow-100 text-yellow-700' : 'bg-orange-100 text-orange-700'}`}>
                      {item.daysUntilExpiry} d
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No items expiring soon</p>
            )}
            <button onClick={() => navigate('/batches')} className="mt-3 text-xs text-blue-600 hover:text-blue-700 font-medium">View all →</button>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sales Performance */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Sales Performance (30 Days)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={performanceMetrics || []}>
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={(d) => new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric' })} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
              <Legend />
              <Line type="monotone" dataKey="sales" stroke="#475569" strokeWidth={2} dot={false} name="Daily Sales" />
              <Line type="monotone" dataKey="profit" stroke="#15803d" strokeWidth={2} dot={false} name="Daily Profit" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Top Products */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Top Products</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={topProducts || []} layout="vertical" margin={{ left: 10 }}>
              <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#374151' }} width={100} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
              <defs>
                {COLORS.map((color, i) => (
                  <pattern key={`bar-hatch-${i}`} id={`barHatch${i}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform={`rotate(${i * 30})`}>
                    <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="1.2" opacity="0.3" />
                  </pattern>
                ))}
              </defs>
              <Bar dataKey="revenue" radius={[0, 3, 3, 0]} barSize={16}>
                {(topProducts || []).map((_, i) => (
                  <Cell key={i} fill={`url(#barHatch${i % 6})`} stroke={COLORS[i % 6]} strokeWidth={1.5} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Payment Methods */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Payment Methods</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <defs>
                {COLORS.map((color, i) => (
                  <pattern key={`pie-hatch-${i}`} id={`pieHatch${i}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform={`rotate(${i * 30})`}>
                    <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="1.2" opacity="0.35" />
                  </pattern>
                ))}
              </defs>
              <Pie
                data={(paymentMethods || []).map((p) => ({
                  ...p,
                  method: p.method.replace('CUSTOMER_CREDIT', 'Khata').replace('BANK_TRANSFER', 'Bank').replace('EASYPAISA', 'Easypaisa').replace('JAZZCASH', 'JazzCash'),
                }))}
                cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2}
                dataKey="amount" nameKey="method" strokeWidth={2}
              >
                {(paymentMethods || []).map((_, i) => <Cell key={i} fill={`url(#pieHatch${i % 6})`} stroke={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
              <Legend verticalAlign="bottom" height={30} formatter={(v) => <span className="text-xs text-gray-600">{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Category Sales */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Sales by Category</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <defs>
                {COLORS.map((color, i) => (
                  <pattern key={`cat-hatch-${i}`} id={`catHatch${i}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform={`rotate(${i * 30 + 15})`}>
                    <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="1.2" opacity="0.35" />
                  </pattern>
                ))}
              </defs>
              <Pie
                data={categorySales || []} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2}
                dataKey="value" nameKey="name" strokeWidth={2}
              >
                {(categorySales || []).map((_, i) => <Cell key={i} fill={`url(#catHatch${i % 6})`} stroke={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
              <Legend verticalAlign="bottom" height={30} formatter={(v) => <span className="text-xs text-gray-600">{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Stock by Category */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 lg:col-span-2">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Stock by Category</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stockByCategory || []}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <defs>
                {COLORS.map((color, i) => (
                  <pattern key={`stock-hatch-${i}`} id={`stockHatch${i}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform={`rotate(${i * 30})`}>
                    <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="1.2" opacity="0.3" />
                  </pattern>
                ))}
              </defs>
              <Bar dataKey="quantity" radius={[3, 3, 0, 0]} barSize={24}>
                {(stockByCategory || []).map((_, i) => (
                  <Cell key={i} fill={`url(#stockHatch${i % 6})`} stroke={COLORS[i % 6]} strokeWidth={1.5} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
