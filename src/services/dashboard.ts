import { supabase } from '../lib/supabase';
import { offlineQuery } from '../lib/offlineQuery';
import { getOfflineDB } from '../lib/offline/db';
import type { DashboardStats } from '../types/database';

export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const todayStart = `${today}T00:00:00`;
    const todayEnd = `${today}T23:59:59`;

    // Today's sales (inline)
    const { data: todaySalesData } = await supabase
      .from('sales')
      .select('total, cogs')
      .eq('status', 'COMPLETED')
      .gte('sale_date', todayStart)
      .lte('sale_date', todayEnd);

    let totalSales = 0;
    let profit = 0;
    (todaySalesData || []).forEach((sale: any) => {
      totalSales += Number(sale.total);
      profit += Number(sale.total) - Number(sale.cogs);
    });

    // Returns reduce revenue on the day they are processed. The original sale
    // remains intact for audit, while the dashboard reports the net amount.
    const { data: todayReturns } = await supabase
      .from('sales_returns')
      .select('total')
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd);
    const returnedSales = (todayReturns || []).reduce((sum: number, saleReturn: any) => sum + Number(saleReturn.total), 0);
    totalSales = Math.max(0, totalSales - returnedSales);

    // Include offline pending sales in today's total
    try {
      const db = getOfflineDB();
      const offlineSales = await db.offlineSales.toArray();
      const todayOfflineSales = offlineSales.filter((sale: any) => {
        const saleDate = new Date(sale.sale_date).toISOString().split('T')[0];
        return saleDate === today && (sale.status === 'pending_sync' || sale.status === 'syncing');
      });
      todayOfflineSales.forEach((sale: any) => {
        totalSales += Number(sale.total || 0);
        const cogs = Number(sale.cogs || 0);
        profit += Number(sale.total || 0) - cogs;
      });
    } catch (err) {
      // Offline DB not available, continue with online data only
    }

    // Today's credit sales
    const { data: creditData } = await supabase
      .from('sale_payments')
      .select('amount')
      .eq('payment_method', 'CUSTOMER_CREDIT')
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd);

    const totalCredit = (creditData || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0);

    // Today's expenses (inline)
    const { data: expenseData } = await supabase
      .from('expenses')
      .select('amount')
      .gte('expense_date', todayStart)
      .lte('expense_date', todayEnd);

    const totalExpenses = (expenseData || []).reduce((sum: number, e: any) => sum + Number(e.amount), 0);

    // Today's purchases (inline)
    const { data: purchaseData } = await supabase
      .from('goods_receipts')
      .select('total')
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd);

    const todayPurchases = (purchaseData || []).reduce((sum: number, gr: any) => sum + Number(gr.total), 0);

    // Product count
    const { count: totalProducts } = await supabase
      .from('products')
      .select('id', { count: 'exact' })
      .eq('active', true);

    // Low stock products
    const { data: inventoryData } = await supabase
      .from('inventory')
      .select('quantity, product_id');
    const { data: productsForReorder } = await supabase
      .from('products')
      .select('id, reorder_level')
      .eq('active', true);

    const reorderMap = new Map((productsForReorder || []).map((p: any) => [p.id, p.reorder_level]));
    const lowStockCount = (inventoryData || []).filter((inv: any) => {
      const reorder = reorderMap.get(inv.product_id) || 0;
      return inv.quantity <= reorder && reorder > 0;
    }).length;

    // Expiring products (within 30 days)
    const { count: expiringCount } = await supabase
      .from('inventory_batches')
      .select('id', { count: 'exact' })
      .lte('expiry_date', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .gt('expiry_date', new Date().toISOString().split('T')[0])
      .gt('remaining_quantity', 0);

    // Customer receivables
    const { data: customerData } = await supabase
      .from('customer_transactions')
      .select('customer_id, amount, transaction_type');

    let customerReceivables = 0;
    const customerBalances: Record<string, number> = {};
    (customerData || []).forEach((t: any) => {
      if (!customerBalances[t.customer_id]) customerBalances[t.customer_id] = 0;
      if (t.transaction_type === 'CREDIT_SALE') customerBalances[t.customer_id] += Number(t.amount);
      if (t.transaction_type === 'PAYMENT' || t.transaction_type === 'RETURN') customerBalances[t.customer_id] -= Number(t.amount);
    });
    customerReceivables = Object.values(customerBalances).reduce((sum, balance) => sum + Math.max(0, balance), 0);

    // Supplier payables
    const { data: supplierData } = await supabase
      .from('supplier_transactions')
      .select('supplier_id, amount, transaction_type');

    let supplierPayables = 0;
    const supplierBalances: Record<string, number> = {};
    (supplierData || []).forEach((t: any) => {
      if (!supplierBalances[t.supplier_id]) supplierBalances[t.supplier_id] = 0;
      if (t.transaction_type === 'PURCHASE') supplierBalances[t.supplier_id] += Number(t.amount);
      if (t.transaction_type === 'PAYMENT' || t.transaction_type === 'RETURN') supplierBalances[t.supplier_id] -= Number(t.amount);
    });
    supplierPayables = Object.values(supplierBalances).reduce((sum, balance) => sum + Math.max(0, balance), 0);

    // Cash balance (from accounting)
    const { data: cashAccount } = await supabase
      .from('accounts')
      .select('id')
      .eq('code', 'CASH')
      .single();

    let cashInHand = 0;
    if (cashAccount) {
      const { data: cashLines } = await supabase
        .from('journal_entry_lines')
        .select('debit, credit')
        .eq('account_id', cashAccount.id);
      cashInHand = (cashLines || []).reduce((sum: number, line: any) => sum + Number(line.debit) - Number(line.credit), 0);
    }

    // Inventory value
    const { data: invData } = await supabase
      .from('inventory')
      .select('quantity, average_cost');
    const inventoryValue = (invData || []).reduce((sum: number, inv: any) => sum + Number(inv.quantity) * Number(inv.average_cost), 0);

    const stats = {
      todaySales: totalSales,
      todayPurchases,
      todayExpenses: totalExpenses,
      todayProfit: profit,
      cashInHand: Math.max(0, cashInHand),
      creditSales: totalCredit,
      customerReceivables,
      supplierPayables,
      inventoryValue,
      totalProducts: totalProducts || 0,
      lowStockProducts: lowStockCount,
      expiringProducts: expiringCount || 0,
    };
    return offlineQuery('dashboard-stats', async () => stats);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return {
      todaySales: 0,
      todayPurchases: 0,
      todayExpenses: 0,
      todayProfit: 0,
      cashInHand: 0,
      creditSales: 0,
      customerReceivables: 0,
      supplierPayables: 0,
      inventoryValue: 0,
      totalProducts: 0,
      lowStockProducts: 0,
      expiringProducts: 0,
    };
  }
}

export async function getSalesChartData(days: number = 14) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('sales')
    .select('sale_date, total, cogs')
    .eq('status', 'COMPLETED')
    .gte('sale_date', startDate.toISOString())
    .lte('sale_date', endDate.toISOString())
    .order('sale_date');

  if (error) return [];

  const grouped: Record<string, any> = {};
  (data || []).forEach((sale: any) => {
    const date = sale.sale_date.split('T')[0];
    if (!grouped[date]) grouped[date] = { date, sales: 0, profit: 0, cogs: 0 };
    grouped[date].sales += Number(sale.total);
    grouped[date].cogs += Number(sale.cogs);
    grouped[date].profit += Number(sale.total) - Number(sale.cogs);
  });

  return Object.values(grouped).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export async function getTopSellingProducts(limit: number = 8) {
  const { data, error } = await supabase
    .from('sale_items')
    .select('product_id, quantity, line_total, products(name)')
    .order('quantity', { ascending: false })
    .limit(limit * 3);

  if (error) return [];

  const productMap = new Map<string, { name: string; revenue: number; quantity: number }>();
  (data || []).forEach((item: any) => {
    const name = item.products?.name || 'Unknown';
    const existing = productMap.get(name) || { name, revenue: 0, quantity: 0 };
    existing.revenue += Number(item.line_total);
    existing.quantity += Number(item.quantity);
    productMap.set(name, existing);
  });

  return Array.from(productMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

export async function getSalesByPaymentMethod() {
  const { data, error } = await supabase
    .from('sale_payments')
    .select('payment_method, amount')
    .order('created_at');

  if (error) return [];

  const grouped: Record<string, { method: string; amount: number }> = {};
  (data || []).forEach((p: any) => {
    const method = p.payment_method;
    if (!grouped[method]) grouped[method] = { method, amount: 0 };
    grouped[method].amount += Number(p.amount);
  });

  return Object.values(grouped);
}

export async function getSalesByCategory() {
  const { data, error } = await supabase
    .from('sale_items')
    .select('line_total, products!sale_items_product_id_fkey(category_id, categories!products_category_id_fkey(name))');

  if (error) return [];

  const grouped: Record<string, { name: string; value: number }> = {};
  (data || []).forEach((item: any) => {
    const catName = item.products?.categories?.name || 'Uncategorized';
    if (!grouped[catName]) grouped[catName] = { name: catName, value: 0 };
    grouped[catName].value += Number(item.line_total);
  });

  return Object.values(grouped).sort((a, b) => b.value - a.value).slice(0, 6);
}

export async function getStockByCategory() {
  const { data: invData } = await supabase
    .from('inventory')
    .select('product_id, quantity');

  const { data: prodData } = await supabase
    .from('products')
    .select('id, category_id, categories(name)')
    .eq('active', true);

  const prodMap = new Map((prodData || []).map((p: any) => [p.id, p]));
  const grouped: Record<string, { name: string; quantity: number }> = {};

  (invData || []).forEach((inv: any) => {
    const prod = prodMap.get(inv.product_id);
    const catName = prod?.categories?.name || 'Uncategorized';
    if (!grouped[catName]) grouped[catName] = { name: catName, quantity: 0 };
    grouped[catName].quantity += Number(inv.quantity);
  });

  return Object.values(grouped).sort((a, b) => b.quantity - a.quantity).slice(0, 8);
}

export async function getDailyExpenses(days: number = 14) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from('expenses')
    .select('expense_date, amount, expense_categories(name)')
    .gte('expense_date', startDate.toISOString().split('T')[0])
    .lte('expense_date', endDate.toISOString().split('T')[0])
    .order('expense_date');

  const grouped: Record<string, any> = {};
  (data || []).forEach((exp: any) => {
    const date = exp.expense_date;
    if (!grouped[date]) grouped[date] = { date, expenses: 0 };
    grouped[date].expenses += Number(exp.amount);
  });

  return Object.values(grouped).sort((a: any, b: any) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
}

// ==================== TREND COMPARISONS ====================

export interface TrendData {
  period: string;
  sales: number;
  profit: number;
  transactions: number;
  avgTransactionValue: number;
}

export interface TrendComparison {
  current: TrendData;
  previous: TrendData;
  salesChange: number;
  salesChangePercent: number;
  profitChange: number;
  profitChangePercent: number;
  transactionChange: number;
  transactionChangePercent: number;
}

/**
 * Get sales trend for a specific period (day, week, month)
 */
export async function getSalesTrendData(period: 'day' | 'week' | 'month'): Promise<TrendData> {
  const now = new Date();
  let startDate: Date;
  let endDate: Date;

  if (period === 'day') {
    startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);
  } else if (period === 'week') {
    startDate = new Date(now);
    startDate.setDate(now.getDate() - now.getDay());
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now);
  }

  const { data: sales, error } = await supabase
    .from('sales')
    .select('total, cogs')
    .eq('status', 'COMPLETED')
    .gte('sale_date', startDate.toISOString())
    .lte('sale_date', endDate.toISOString());

  if (error) {
    return {
      period,
      sales: 0,
      profit: 0,
      transactions: 0,
      avgTransactionValue: 0,
    };
  }

  let totalSales = 0;
  let totalProfit = 0;
  const count = sales?.length || 0;

  (sales || []).forEach((sale: any) => {
    totalSales += Number(sale.total);
    totalProfit += Number(sale.total) - Number(sale.cogs);
  });

  return {
    period,
    sales: totalSales,
    profit: totalProfit,
    transactions: count,
    avgTransactionValue: count > 0 ? totalSales / count : 0,
  };
}

/**
 * Compare current period with previous period
 */
export async function compareSalesTrend(period: 'day' | 'week' | 'month'): Promise<TrendComparison> {
  const current = await getSalesTrendData(period);

  const now = new Date();
  let previousStart: Date;
  let previousEnd: Date;

  if (period === 'day') {
    previousStart = new Date(now);
    previousStart.setDate(now.getDate() - 1);
    previousStart.setHours(0, 0, 0, 0);
    previousEnd = new Date(now);
    previousEnd.setDate(now.getDate() - 1);
    previousEnd.setHours(23, 59, 59, 999);
  } else if (period === 'week') {
    previousStart = new Date(now);
    previousStart.setDate(now.getDate() - 7 - now.getDay());
    previousStart.setHours(0, 0, 0, 0);
    previousEnd = new Date(now);
    previousEnd.setDate(now.getDate() - 7);
    previousEnd.setHours(23, 59, 59, 999);
  } else {
    previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  }

  const { data: previousSales } = await supabase
    .from('sales')
    .select('total, cogs')
    .eq('status', 'COMPLETED')
    .gte('sale_date', previousStart.toISOString())
    .lte('sale_date', previousEnd.toISOString());

  let prevTotalSales = 0;
  let prevTotalProfit = 0;
  const prevCount = previousSales?.length || 0;

  (previousSales || []).forEach((sale: any) => {
    prevTotalSales += Number(sale.total);
    prevTotalProfit += Number(sale.total) - Number(sale.cogs);
  });

  const previous: TrendData = {
    period: `Previous ${period}`,
    sales: prevTotalSales,
    profit: prevTotalProfit,
    transactions: prevCount,
    avgTransactionValue: prevCount > 0 ? prevTotalSales / prevCount : 0,
  };

  const salesChange = current.sales - previous.sales;
  const profitChange = current.profit - previous.profit;
  const transactionChange = current.transactions - previous.transactions;

  return {
    current,
    previous,
    salesChange,
    salesChangePercent: previous.sales > 0 ? (salesChange / previous.sales) * 100 : 0,
    profitChange,
    profitChangePercent: previous.profit > 0 ? (profitChange / previous.profit) * 100 : 0,
    transactionChange,
    transactionChangePercent: previous.transactions > 0 ? (transactionChange / previous.transactions) * 100 : 0,
  };
}

/**
 * Get performance metrics for last N days
 */
export async function getPerformanceMetrics(days: number = 30): Promise<{
  date: string;
  sales: number;
  profit: number;
  margin: number;
  transactions: number;
}[]> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from('sales')
    .select('sale_date, total, cogs')
    .eq('status', 'COMPLETED')
    .gte('sale_date', startDate.toISOString())
    .lte('sale_date', endDate.toISOString())
    .order('sale_date');

  const grouped: Record<string, any> = {};

  (data || []).forEach((sale: any) => {
    const date = sale.sale_date.split('T')[0];
    if (!grouped[date]) {
      grouped[date] = { date, sales: 0, profit: 0, cogs: 0, transactions: 0 };
    }
    grouped[date].sales += Number(sale.total);
    grouped[date].cogs += Number(sale.cogs);
    grouped[date].profit += Number(sale.total) - Number(sale.cogs);
    grouped[date].transactions += 1;
  });

  return Object.values(grouped)
    .map((item: any) => ({
      date: item.date,
      sales: item.sales,
      profit: item.profit,
      margin: item.sales > 0 ? (item.profit / item.sales) * 100 : 0,
      transactions: item.transactions,
    }))
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * Get customer metrics (total customers, active customers, sales per customer)
 */
export async function getCustomerMetrics(): Promise<{
  totalCustomers: number;
  activeCustomers: number;
  totalCredit: number;
  avgCreditPerCustomer: number;
  totalReceivables: number;
}> {
  const { count: totalCustomers } = await supabase
    .from('customers')
    .select('id', { count: 'exact' });

  const { data: transactions } = await supabase
    .from('customer_transactions')
    .select('customer_id, amount, transaction_type, created_at')
    .order('created_at', { ascending: false });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const activeCustomerSet = new Set<string>();
  let totalCredit = 0;
  let totalReceivables = 0;

  const customerBalances: Record<string, number> = {};

  (transactions || []).forEach((t: any) => {
    if (new Date(t.created_at) > thirtyDaysAgo) {
      activeCustomerSet.add(t.customer_id);
    }

    if (!customerBalances[t.customer_id]) customerBalances[t.customer_id] = 0;
    if (t.transaction_type === 'CREDIT_SALE') {
      customerBalances[t.customer_id] += Number(t.amount);
      totalCredit += Number(t.amount);
    }
    if (t.transaction_type === 'PAYMENT' || t.transaction_type === 'RETURN') {
      customerBalances[t.customer_id] -= Number(t.amount);
    }
  });

  totalReceivables = Object.values(customerBalances).reduce((sum, balance) => sum + Math.max(0, balance), 0);

  return {
    totalCustomers: totalCustomers || 0,
    activeCustomers: activeCustomerSet.size,
    totalCredit,
    avgCreditPerCustomer: (totalCustomers || 0) > 0 ? totalCredit / (totalCustomers || 0) : 0,
    totalReceivables,
  };
}

/**
 * Get inventory turnover metrics
 */
export async function getInventoryTurnoverMetrics(): Promise<{
  totalInventoryValue: number;
  costOfGoodsSold: number;
  turnoverRatio: number;
  daysInventoryOutstanding: number;
}> {
  // Get current inventory value
  const { data: inventoryData } = await supabase
    .from('inventory')
    .select('quantity, average_cost');

  let totalInventoryValue = 0;
  (inventoryData || []).forEach((inv: any) => {
    totalInventoryValue += Number(inv.quantity) * Number(inv.average_cost);
  });

  // Get COGS for last 365 days
  const lastYear = new Date();
  lastYear.setDate(lastYear.getDate() - 365);

  const { data: salesData } = await supabase
    .from('sales')
    .select('cogs')
    .eq('status', 'COMPLETED')
    .gte('sale_date', lastYear.toISOString());

  let costOfGoodsSold = 0;
  (salesData || []).forEach((sale: any) => {
    costOfGoodsSold += Number(sale.cogs);
  });

  const turnoverRatio = totalInventoryValue > 0 ? costOfGoodsSold / totalInventoryValue : 0;
  const daysInventoryOutstanding = turnoverRatio > 0 ? 365 / turnoverRatio : 0;

  return {
    totalInventoryValue,
    costOfGoodsSold,
    turnoverRatio,
    daysInventoryOutstanding,
  };
}


// Get items expiring within N days
export async function getExpiringItems(daysUntilExpiry: number = 7) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const expiryDate = new Date(Date.now() + daysUntilExpiry * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const { data: batches, error } = await supabase
      .from('inventory_batches')
      .select('id, product_id, batch_number, expiry_date, remaining_quantity')
      .lte('expiry_date', expiryDate)
      .gt('expiry_date', today)
      .gt('remaining_quantity', 0)
      .order('expiry_date', { ascending: true })
      .limit(10);

    if (error) throw error;

    // Fetch product details
    const productIds = [...new Set((batches || []).map(b => b.product_id))];
    const { data: products } = await supabase
      .from('products')
      .select('id, name, sku')
      .in('id', productIds);

    const productMap = new Map((products || []).map(p => [p.id, p]));

    return (batches || []).map(batch => ({
      id: batch.id,
      productName: productMap.get(batch.product_id)?.name || 'Unknown',
      sku: productMap.get(batch.product_id)?.sku || '',
      quantity: batch.remaining_quantity,
      expiryDate: batch.expiry_date,
      daysUntilExpiry: Math.ceil((new Date(batch.expiry_date).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)),
    }));
  } catch (error) {
    console.error('Error fetching expiring items:', error);
    return [];
  }
}


// Get sales stats filtered by cashier for their own dashboard
export async function getDashboardStatsByCashier(cashierId: string): Promise<DashboardStats> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const todayStart = `${today}T00:00:00`;
    const todayEnd = `${today}T23:59:59`;

    // Today's sales for this cashier only
    const { data: todaySalesData } = await supabase
      .from('sales')
      .select('total, cogs')
      .eq('status', 'COMPLETED')
      .eq('created_by', cashierId)
      .gte('sale_date', todayStart)
      .lte('sale_date', todayEnd);

    let totalSales = 0;
    let profit = 0;
    (todaySalesData || []).forEach((sale: any) => {
      totalSales += Number(sale.total);
      profit += Number(sale.total) - Number(sale.cogs);
    });

    // Today's credit sales for this cashier
    const { data: creditData } = await supabase
      .from('sale_payments')
      .select('amount, sales(created_by)')
      .eq('payment_method', 'CUSTOMER_CREDIT')
      .eq('sales.created_by', cashierId)
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd);

    const totalCredit = (creditData || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0);

    const stats = {
      todaySales: totalSales,
      todayPurchases: 0, // Cashiers don't handle purchases
      todayExpenses: 0, // Cashiers don't record expenses
      todayProfit: profit,
      cashInHand: 0, // Will be calculated from shift
      creditSales: totalCredit,
      customerReceivables: 0, // Not relevant for cashier view
      supplierPayables: 0, // Not relevant for cashier view
      inventoryValue: 0, // Not relevant for cashier view
      totalProducts: 0,
      lowStockProducts: 0,
      expiringProducts: 0,
    };
    return stats;
  } catch (error) {
    console.error('Error fetching cashier dashboard stats:', error);
    return {
      todaySales: 0,
      todayPurchases: 0,
      todayExpenses: 0,
      todayProfit: 0,
      cashInHand: 0,
      creditSales: 0,
      customerReceivables: 0,
      supplierPayables: 0,
      inventoryValue: 0,
      totalProducts: 0,
      lowStockProducts: 0,
      expiringProducts: 0,
    };
  }
}

// Get performance metrics filtered by cashier
export async function getPerformanceMetricsByCashier(cashierId: string, days: number = 30) {
  try {
    const data = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const start = `${date}T00:00:00`;
      const end = `${date}T23:59:59`;

      const { data: sales } = await supabase
        .from('sales')
        .select('total, cogs')
        .eq('created_by', cashierId)
        .eq('status', 'COMPLETED')
        .gte('sale_date', start)
        .lte('sale_date', end);

      let dayTotal = 0;
      let dayProfit = 0;
      (sales || []).forEach((s: any) => {
        dayTotal += Number(s.total);
        dayProfit += Number(s.total) - Number(s.cogs);
      });

      data.push({
        date,
        sales: dayTotal,
        profit: dayProfit,
      });
    }
    return data;
  } catch (error) {
    console.error('Error fetching cashier performance metrics:', error);
    return [];
  }
}

// Get payment methods filtered by cashier
export async function getSalesByPaymentMethodByCashier(cashierId: string) {
  try {
    const { data, error } = await supabase
      .from('sale_payments')
      .select('payment_method, amount, sales(created_by, status)')
      .eq('sales.created_by', cashierId)
      .eq('sales.status', 'COMPLETED');

    if (error) throw error;

    const methods: Record<string, number> = {};
    (data || []).forEach((p: any) => {
      if (!methods[p.payment_method]) methods[p.payment_method] = 0;
      methods[p.payment_method] += Number(p.amount);
    });

    return Object.entries(methods).map(([method, amount]) => ({
      method,
      amount,
    }));
  } catch (error) {
    console.error('Error fetching cashier payment methods:', error);
    return [];
  }
}

// Get sales by category filtered by cashier
export async function getSalesByCategoryByCashier(cashierId: string) {
  try {
    const { data, error } = await supabase
      .from('sale_items')
      .select('products(category_id, categories(name)), line_total, sales(created_by, status)')
      .eq('sales.created_by', cashierId)
      .eq('sales.status', 'COMPLETED');

    if (error) throw error;

    const categories: Record<string, number> = {};
    (data || []).forEach((item: any) => {
      // Get category name from the nested join, fallback to 'Uncategorized'
      const categoryName = item.products?.categories?.name || 'Uncategorized';
      if (!categories[categoryName]) categories[categoryName] = 0;
      categories[categoryName] += Number(item.line_total);
    });

    return Object.entries(categories).map(([name, value]) => ({
      name,
      value,
    }));
  } catch (error) {
    console.error('Error fetching cashier sales by category:', error);
    return [];
  }
}

// Get sales trend comparison for cashier
export async function compareSalesTrendByCashier(
  cashierId: string,
  period: 'day' | 'week' | 'month'
) {
  try {
    const now = new Date();
    let currentStart: Date, currentEnd: Date, previousStart: Date, previousEnd: Date;

    if (period === 'day') {
      currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      currentEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      previousStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      previousEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      currentStart = new Date(weekStart);
      currentEnd = new Date(weekStart);
      currentEnd.setDate(weekStart.getDate() + 7);
      previousStart = new Date(weekStart);
      previousStart.setDate(weekStart.getDate() - 7);
      previousEnd = new Date(weekStart);
    } else {
      currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
      currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      previousEnd = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // Fetch current period sales for this cashier
    const { data: currentSales } = await supabase
      .from('sales')
      .select('total, cogs')
      .eq('created_by', cashierId)
      .eq('status', 'COMPLETED')
      .gte('sale_date', currentStart.toISOString())
      .lt('sale_date', currentEnd.toISOString());

    const currentSalesTotal = (currentSales || []).reduce((sum, s: any) => sum + Number(s.total), 0);
    const currentProfit = (currentSales || []).reduce((sum, s: any) => sum + Number(s.total) - Number(s.cogs), 0);
    const currentTransactions = currentSales?.length || 0;

    // Fetch previous period sales for this cashier
    const { data: previousSales } = await supabase
      .from('sales')
      .select('total, cogs')
      .eq('created_by', cashierId)
      .eq('status', 'COMPLETED')
      .gte('sale_date', previousStart.toISOString())
      .lt('sale_date', previousEnd.toISOString());

    const previousSalesTotal = (previousSales || []).reduce((sum, s: any) => sum + Number(s.total), 0);
    const previousProfit = (previousSales || []).reduce((sum, s: any) => sum + Number(s.total) - Number(s.cogs), 0);
    const previousTransactions = previousSales?.length || 0;

    const salesChangePercent = previousSalesTotal > 0 ? ((currentSalesTotal - previousSalesTotal) / previousSalesTotal) * 100 : 0;
    const profitChangePercent = previousProfit > 0 ? ((currentProfit - previousProfit) / previousProfit) * 100 : 0;

    return {
      current: {
        sales: currentSalesTotal,
        profit: currentProfit,
        transactions: currentTransactions,
        avgTransactionValue: currentTransactions > 0 ? currentSalesTotal / currentTransactions : 0,
      },
      previous: {
        sales: previousSalesTotal,
        profit: previousProfit,
        transactions: previousTransactions,
        avgTransactionValue: previousTransactions > 0 ? previousSalesTotal / previousTransactions : 0,
      },
      salesChangePercent,
      profitChangePercent,
    };
  } catch (error) {
    console.error('Error comparing cashier sales trend:', error);
    return {
      current: { sales: 0, profit: 0, transactions: 0, avgTransactionValue: 0 },
      previous: { sales: 0, profit: 0, transactions: 0, avgTransactionValue: 0 },
      salesChangePercent: 0,
      profitChangePercent: 0,
    };
  }
}
