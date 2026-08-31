import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download } from 'lucide-react';
import { getSalesReport, getProductSalesReport, getInventoryReport, getCustomerBalancesReport, getSupplierBalancesReport, getProfitAndLossReport, getPurchaseReport } from '../../services/reports';
import { formatCurrency, formatDate } from '../../utils/helpers';

type ReportType = 'sales' | 'products' | 'inventory' | 'customers' | 'suppliers' | 'pnl' | 'purchases';

export function ReportsPage() {
  const [report, setReport] = useState<ReportType>('sales');
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);

  const reports: { key: ReportType; label: string }[] = [
    { key: 'sales', label: 'Sales Report' },
    { key: 'products', label: 'Product Sales' },
    { key: 'inventory', label: 'Inventory Valuation' },
    { key: 'purchases', label: 'Purchase Report' },
    { key: 'customers', label: 'Customer Balances' },
    { key: 'suppliers', label: 'Supplier Balances' },
    { key: 'pnl', label: 'Profit & Loss' },
  ];

  const exportCSV = (headers: string[], rows: (string | number)[][], filename: string) => {
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <BarChart3 className="h-6 w-6 text-gray-400" />
      </div>

      <div className="flex flex-wrap gap-2">
        {reports.map((r) => (
          <button key={r.key} onClick={() => setReport(r.key)} className={report === r.key ? 'btn-primary' : 'btn-secondary'}>{r.label}</button>
        ))}
      </div>

      <div className="card">
        <div className="mb-4 flex items-center gap-4">
          <div><label className="label">From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-field" /></div>
          <div><label className="label">To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-field" /></div>
        </div>
      </div>

      {report === 'sales' && <SalesReport from={from} to={to} exportCSV={exportCSV} />}
      {report === 'products' && <ProductReport from={from} to={to} exportCSV={exportCSV} />}
      {report === 'inventory' && <InventoryReport exportCSV={exportCSV} />}
      {report === 'purchases' && <PurchaseReport from={from} to={to} />}
      {report === 'customers' && <CustomerBalancesReport exportCSV={exportCSV} />}
      {report === 'suppliers' && <SupplierBalancesReport exportCSV={exportCSV} />}
      {report === 'pnl' && <PnLReport from={from} to={to} />}
    </div>
  );
}

function SalesReport({ from, to, exportCSV }: { from: string; to: string; exportCSV: Function }) {
  const { data, isLoading } = useQuery({ queryKey: ['sales-report', from, to], queryFn: () => getSalesReport({ from, to }) });
  if (isLoading) return <p className="py-8 text-center">Loading...</p>;

  const totalSales = (data || []).reduce((s, r) => s + r.total_sales, 0);
  const totalCogs = (data || []).reduce((s, r) => s + r.cogs, 0);
  const totalProfit = totalSales - totalCogs;

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">Daily Sales ({from} to {to})</h3>
        <button onClick={() => exportCSV(['Date', 'Sales', 'COGS', 'Profit'], (data || []).map((r) => [r.date, r.total_sales, r.cogs, r.profit]), 'sales-report')} className="btn-secondary text-xs"><Download size={14} className="mr-1" /> CSV</button>
      </div>
      <table className="min-w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-gray-500">
          <th className="py-2">Date</th><th className="py-2 text-right">Sales</th><th className="py-2 text-right">COGS</th><th className="py-2 text-right">Profit</th>
        </tr></thead>
        <tbody>
          {(data || []).map((r) => (
            <tr key={r.date} className="border-b">
              <td className="py-2">{formatDate(r.date)}</td>
              <td className="py-2 text-right">{formatCurrency(r.total_sales)}</td>
              <td className="py-2 text-right">{formatCurrency(r.cogs)}</td>
              <td className="py-2 text-right font-medium text-green-600">{formatCurrency(r.profit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t font-bold">
          <td className="py-2">Total</td>
          <td className="py-2 text-right">{formatCurrency(totalSales)}</td>
          <td className="py-2 text-right">{formatCurrency(totalCogs)}</td>
          <td className="py-2 text-right text-green-600">{formatCurrency(totalProfit)}</td>
        </tr></tfoot>
      </table>
    </div>
  );
}

function ProductReport({ from, to, exportCSV }: { from: string; to: string; exportCSV: Function }) {
  const { data, isLoading } = useQuery({ queryKey: ['product-report', from, to], queryFn: () => getProductSalesReport({ from, to }) });
  if (isLoading) return <p className="py-8 text-center">Loading...</p>;

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">Product Sales Report</h3>
        <button onClick={() => exportCSV(['Product', 'Qty Sold', 'Revenue', 'COGS', 'Profit'], (data || []).map((r) => [r.name, r.quantity, r.revenue, r.cogs, r.profit]), 'product-sales')} className="btn-secondary text-xs"><Download size={14} className="mr-1" /> CSV</button>
      </div>
      <table className="min-w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-gray-500">
          <th className="py-2">Product</th><th className="py-2 text-right">Qty Sold</th><th className="py-2 text-right">Revenue</th><th className="py-2 text-right">COGS</th><th className="py-2 text-right">Profit</th>
        </tr></thead>
        <tbody>
          {(data || []).map((r, i) => (
            <tr key={i} className="border-b">
              <td className="py-2 font-medium">{r.name}</td>
              <td className="py-2 text-right">{r.quantity}</td>
              <td className="py-2 text-right">{formatCurrency(r.revenue)}</td>
              <td className="py-2 text-right">{formatCurrency(r.cogs)}</td>
              <td className="py-2 text-right text-green-600">{formatCurrency(r.profit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InventoryReport({ exportCSV }: { exportCSV: Function }) {
  const { data, isLoading } = useQuery({ queryKey: ['inventory-report'], queryFn: getInventoryReport });
  if (isLoading) return <p className="py-8 text-center">Loading...</p>;
  const totalValue = (data || []).reduce((s, r) => s + r.stock_value, 0);

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">Inventory Valuation — Total: {formatCurrency(totalValue)}</h3>
        <button onClick={() => exportCSV(['Product', 'SKU', 'Category', 'Qty', 'Avg Cost', 'Stock Value', 'Low Stock'], (data || []).map((r) => [r.product_name, r.sku, r.category, r.quantity, r.average_cost, r.stock_value, r.is_low_stock ? 'YES' : '']), 'inventory')} className="btn-secondary text-xs"><Download size={14} className="mr-1" /> CSV</button>
      </div>
      <table className="min-w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-gray-500">
          <th className="py-2">Product</th><th className="py-2">Category</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Avg Cost</th><th className="py-2 text-right">Value</th><th className="py-2">Status</th>
        </tr></thead>
        <tbody>
          {(data || []).map((r, i) => (
            <tr key={i} className="border-b">
              <td className="py-2 font-medium">{r.product_name}</td>
              <td className="py-2 text-gray-500">{r.category}</td>
              <td className="py-2 text-right">{r.quantity}</td>
              <td className="py-2 text-right">{formatCurrency(r.average_cost)}</td>
              <td className="py-2 text-right">{formatCurrency(r.stock_value)}</td>
              <td className="py-2">{r.is_low_stock ? <span className="text-red-600 text-xs font-medium">LOW STOCK</span> : <span className="text-green-600 text-xs">OK</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomerBalancesReport({ exportCSV }: { exportCSV: Function }) {
  const { data, isLoading } = useQuery({ queryKey: ['customer-balances-report'], queryFn: getCustomerBalancesReport });
  if (isLoading) return <p className="py-8 text-center">Loading...</p>;
  const totalReceivable = (data || []).reduce((s, r) => s + r.balance, 0);

  return (
    <div className="card">
      <h3 className="mb-4 font-semibold">Customer Khata Balances — Total Receivable: <span className="text-red-600">{formatCurrency(totalReceivable)}</span></h3>
      <table className="min-w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-gray-500">
          <th className="py-2">Customer</th><th className="py-2">Phone</th><th className="py-2 text-right">Credit Limit</th><th className="py-2 text-right">Balance</th><th className="py-2">Status</th>
        </tr></thead>
        <tbody>
          {(data || []).filter((r) => r.balance > 0).map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2 font-medium">{r.name}</td>
              <td className="py-2">{r.phone || '-'}</td>
              <td className="py-2 text-right">{formatCurrency(Number(r.credit_limit))}</td>
              <td className="py-2 text-right font-bold text-red-600">{formatCurrency(r.balance)}</td>
              <td className="py-2">{r.balance > Number(r.credit_limit) && r.credit_limit > 0 ? <span className="text-red-600 text-xs font-medium">OVER LIMIT</span> : <span className="text-green-600 text-xs">OK</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SupplierBalancesReport({ exportCSV }: { exportCSV: Function }) {
  const { data, isLoading } = useQuery({ queryKey: ['supplier-balances-report'], queryFn: getSupplierBalancesReport });
  if (isLoading) return <p className="py-8 text-center">Loading...</p>;
  const totalPayable = (data || []).reduce((s, r) => s + r.balance, 0);

  return (
    <div className="card">
      <h3 className="mb-4 font-semibold">Supplier Balances — Total Payable: <span className="text-orange-600">{formatCurrency(totalPayable)}</span></h3>
      <table className="min-w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-gray-500">
          <th className="py-2">Supplier</th><th className="py-2 text-right">Balance</th>
        </tr></thead>
        <tbody>
          {(data || []).filter((r) => r.balance > 0).map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2 font-medium">{r.name}</td>
              <td className="py-2 text-right font-bold text-orange-600">{formatCurrency(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PnLReport({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['pnl', from, to], queryFn: () => getProfitAndLossReport({ from, to }) });
  if (isLoading) return <p className="py-8 text-center">Loading...</p>;

  return (
    <div className="card space-y-4">
      <h3 className="font-semibold">Profit & Loss Statement ({from} to {to})</h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between border-b pb-2"><span>Revenue</span><span className="font-bold">{formatCurrency(data?.revenue || 0)}</span></div>
        <div className="flex justify-between border-b pb-2"><span>Cost of Goods Sold</span><span className="text-red-600">({formatCurrency(data?.cogs || 0)})</span></div>
        <div className="flex justify-between border-b pb-2 font-bold"><span>Gross Profit</span><span className="text-green-600">{formatCurrency(data?.grossProfit || 0)}</span></div>
        <div className="pt-2"><p className="font-medium text-gray-700 mb-2">Operating Expenses:</p>
          {Object.entries(data?.expenses || {}).map(([name, amount]) => (
            <div key={name} className="flex justify-between pl-4"><span>{name}</span><span className="text-red-600">({formatCurrency(amount as number)})</span></div>
          ))}
        </div>
        <div className="flex justify-between border-t pt-2"><span>Total Expenses</span><span className="text-red-600">({formatCurrency(data?.totalExpenses || 0)})</span></div>
        <div className="flex justify-between border-t-2 pt-2 text-lg font-bold">
          <span>Net Profit</span>
          <span className={data && data.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(data?.netProfit || 0)}</span>
        </div>
      </div>
    </div>
  );
}

function PurchaseReport({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['purchase-report', from, to], queryFn: () => getPurchaseReport({ from, to }) });
  if (isLoading) return <p className="py-8 text-center">Loading...</p>;
  const total = (data || []).reduce((s, r) => s + r.total, 0);

  return (
    <div className="card">
      <h3 className="mb-4 font-semibold">Purchase Report — Total: {formatCurrency(total)}</h3>
      <table className="min-w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-gray-500">
          <th className="py-2">Date</th><th className="py-2">Supplier</th><th className="py-2 text-right">Total</th>
        </tr></thead>
        <tbody>
          {(data || []).map((r, i) => (
            <tr key={i} className="border-b">
              <td className="py-2">{formatDate(r.date)}</td>
              <td className="py-2">{r.supplier}</td>
              <td className="py-2 text-right font-medium">{formatCurrency(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
