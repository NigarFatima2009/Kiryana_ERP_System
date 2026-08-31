import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  getDashboardStats, getSalesChartData, getTopSellingProducts,
  getSalesByPaymentMethod, getSalesByCategory, getStockByCategory,
} from '../services/dashboard';
import { formatCurrency } from '../utils/helpers';

const COLORS = ['#475569', '#1d4ed8', '#b45309', '#15803d', '#9333ea', '#be123c'];

function StatCard({ title, value, onClick }: { title: string; value: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`bg-white border border-gray-200 rounded-lg p-4 ${onClick ? 'cursor-pointer hover:border-gray-300 transition-colors' : ''}`}
    >
      <p className="text-xs text-gray-400 font-medium">{title}</p>
      <p className="text-xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}

const tooltipStyle = { borderRadius: '6px', border: '1px solid #e5e7eb', fontSize: '13px' };

export function DashboardPage() {
  const navigate = useNavigate();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => getDashboardStats(),
    refetchInterval: 10000,
  });

  const { data: chartData } = useQuery({ queryKey: ['sales-chart'], queryFn: () => getSalesChartData(14) });
  const { data: topProducts } = useQuery({ queryKey: ['top-products'], queryFn: () => getTopSellingProducts(5) });
  const { data: paymentMethods } = useQuery({ queryKey: ['payment-methods'], queryFn: () => getSalesByPaymentMethod() });
  const { data: categorySales } = useQuery({ queryKey: ['category-sales'], queryFn: () => getSalesByCategory() });
  const { data: stockByCategory } = useQuery({ queryKey: ['stock-category'], queryFn: () => getStockByCategory() });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-200 border-t-gray-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <h1 className="text-lg font-semibold text-gray-900">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Today's Sales" value={formatCurrency(stats?.todaySales || 0)} onClick={() => navigate('/sales')} />
        <StatCard title="Today's Profit" value={formatCurrency(stats?.todayProfit || 0)} onClick={() => navigate('/reports')} />
        <StatCard title="Today's Purchases" value={formatCurrency(stats?.todayPurchases || 0)} onClick={() => navigate('/purchase-orders')} />
        <StatCard title="Today's Expenses" value={formatCurrency(stats?.todayExpenses || 0)} onClick={() => navigate('/expenses')} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Cash in Hand" value={formatCurrency(stats?.cashInHand || 0)} />
        <StatCard title="Receivables" value={formatCurrency(stats?.customerReceivables || 0)} onClick={() => navigate('/khata')} />
        <StatCard title="Payables" value={formatCurrency(stats?.supplierPayables || 0)} onClick={() => navigate('/suppliers')} />
        <StatCard title="Inventory" value={formatCurrency(stats?.inventoryValue || 0)} onClick={() => navigate('/stock')} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Products" value={String(stats?.totalProducts || 0)} onClick={() => navigate('/products')} />
        <StatCard title="Low Stock" value={String(stats?.lowStockProducts || 0)} onClick={() => navigate('/stock')} />
        <StatCard title="Expiring Soon" value={String(stats?.expiringProducts || 0)} onClick={() => navigate('/batches')} />
        <StatCard title="Credit Sales" value={formatCurrency(stats?.creditSales || 0)} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sales Trend */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Sales Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData || []}>
              <defs>
                <pattern id="hatchSales" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="#475569" strokeWidth="1.2" opacity="0.3" />
                </pattern>
                <pattern id="hatchProfit" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(-45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="#15803d" strokeWidth="1.2" opacity="0.3" />
                </pattern>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={(d) => new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric' })} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="sales" stroke="#475569" strokeWidth={1.5} fill="url(#hatchSales)" name="Sales" dot={false} />
              <Area type="monotone" dataKey="profit" stroke="#15803d" strokeWidth={1.5} fill="url(#hatchProfit)" name="Profit" dot={false} />
            </AreaChart>
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
