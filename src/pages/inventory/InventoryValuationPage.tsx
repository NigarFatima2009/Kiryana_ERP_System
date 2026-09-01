import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getInventoryValuationComparison,
  getInventoryValueSummary,
  getInventoryValuationReport,
  getCogsComparison30Days,
  setAllProductsValuationMethod,
  type ValuationMethod,
} from '../../services/inventory_valuation';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell, LineChart, Line } from 'recharts';
import { formatCurrency } from '../../utils/helpers';
import { TrendingUp, Info } from 'lucide-react';
import { useToast } from '../../components/ui/Toast';

const COLORS = ['#1d4ed8', '#15803d', '#b45309'];

export function InventoryValuationPage() {
  const [selectedMethod, setSelectedMethod] = useState<ValuationMethod>('FIFO');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get valuation comparison
  const { data: comparison, isLoading: comparisonLoading } = useQuery({
    queryKey: ['inventory-valuation-comparison'],
    queryFn: getInventoryValuationComparison,
    refetchInterval: 60000,
  });

  // Get value summary
  const { data: summary } = useQuery({
    queryKey: ['inventory-value-summary'],
    queryFn: getInventoryValueSummary,
    refetchInterval: 60000,
  });

  // Get valuation report
  const { data: report } = useQuery({
    queryKey: ['valuation-report', selectedMethod],
    queryFn: () => getInventoryValuationReport(selectedMethod),
    refetchInterval: 60000,
  });

  // Get COGS comparison
  const { data: cogsData } = useQuery({
    queryKey: ['cogs-comparison'],
    queryFn: getCogsComparison30Days,
    refetchInterval: 60000,
  });

  const setMethodMutation = useMutation({
    mutationFn: (method: ValuationMethod) => setAllProductsValuationMethod(method),
    onSuccess: () => {
      toast('success', 'Valuation method updated for all products');
      queryClient.invalidateQueries({ queryKey: ['inventory-valuation-comparison'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-value-summary'] });
    },
    onError: (error: any) => {
      toast('error', `Failed to update valuation method: ${error.message}`);
    },
  });

  if (comparisonLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  // Prepare comparison chart data
  const chartData = (comparison || []).slice(0, 10).map((item) => ({
    product: item.product_name.substring(0, 15),
    FIFO: item.fifo_value,
    LIFO: item.lifo_value,
    'Weighted Avg': item.weighted_avg_value,
  }));

  // Prepare COGS comparison data
  const cogsChartData = cogsData ? [
    {
      method: 'FIFO',
      total_cost: cogsData.fifo_total_cost,
      avg_cost: cogsData.fifo_avg_cost,
    },
    {
      method: 'LIFO',
      total_cost: cogsData.lifo_total_cost,
      avg_cost: cogsData.lifo_avg_cost,
    },
    {
      method: 'Weighted Avg',
      total_cost: cogsData.weighted_avg_total_cost,
      avg_cost: cogsData.weighted_avg_cost,
    },
  ] : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inventory Valuation</h1>
      </div>

      {/* Summary Cards - Clean */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded p-4">
          <p className="text-xs text-gray-500 font-medium">FIFO Value</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">
            {formatCurrency(summary?.fifo_total || 0)}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded p-4">
          <p className="text-xs text-gray-500 font-medium">LIFO Value</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">
            {formatCurrency(summary?.lifo_total || 0)}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded p-4">
          <p className="text-xs text-gray-500 font-medium">Weighted Avg Value</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">
            {formatCurrency(summary?.weighted_avg_total || 0)}
          </p>
        </div>
      </div>

      {/* Variance - Simple */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white border border-gray-200 rounded p-4">
          <p className="text-xs text-gray-500 font-medium mb-2">FIFO vs LIFO</p>
          <p className={`text-2xl font-bold ${summary?.variance_fifo_vs_lifo! > 0 ? 'text-gray-900' : 'text-gray-900'}`}>
            {summary?.variance_fifo_vs_lifo! > 0 ? '+' : ''}{formatCurrency(summary?.variance_fifo_vs_lifo || 0)}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded p-4">
          <p className="text-xs text-gray-500 font-medium mb-2">FIFO vs Weighted Avg</p>
          <p className={`text-2xl font-bold ${summary?.variance_fifo_vs_weighted! > 0 ? 'text-gray-900' : 'text-gray-900'}`}>
            {summary?.variance_fifo_vs_weighted! > 0 ? '+' : ''}{formatCurrency(summary?.variance_fifo_vs_weighted || 0)}
          </p>
        </div>
      </div>

      {/* Method Selection - Simple */}
      <div className="bg-white border border-gray-200 rounded p-4">
        <p className="text-sm font-medium text-gray-900 mb-3">Default Method</p>
        <div className="flex gap-2">
          {(['FIFO', 'LIFO', 'WEIGHTED_AVERAGE'] as ValuationMethod[]).map((method) => (
            <button
              key={method}
              onClick={() => {
                setSelectedMethod(method);
                setMethodMutation.mutate(method);
              }}
              disabled={setMethodMutation.isPending}
              className={`px-3 py-2 text-sm rounded border font-medium transition ${
                selectedMethod === method
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {method === 'FIFO' ? 'FIFO' : method === 'LIFO' ? 'LIFO' : 'Weighted Avg'}
            </button>
          ))}
        </div>
      </div>

      {/* Comparison Chart */}
      {chartData.length > 0 && (
        <div className="bg-white border border-gray-200 rounded p-4">
          <p className="text-sm font-medium text-gray-900 mb-4">Product Valuations</p>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <XAxis dataKey="product" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Legend wrapperStyle={{ paddingTop: '10px', fontSize: '12px' }} />
              <Bar dataKey="FIFO" fill="#6b7280" />
              <Bar dataKey="LIFO" fill="#9ca3af" />
              <Bar dataKey="Weighted Avg" fill="#d1d5db" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Detailed Report */}
      <div className="bg-white border border-gray-200 rounded p-4">
        <p className="text-sm font-medium text-gray-900 mb-4">Product Details</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Product</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">Units</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">Unit Cost</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">Total Value</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">% Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {(report || []).map((item) => (
                <tr key={`${item.rank}-${item.product_name}`} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-900">{item.product_name}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{item.total_units}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{formatCurrency(item.unit_cost)}</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">
                    {formatCurrency(item.total_value)}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{item.percentage_of_total.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
