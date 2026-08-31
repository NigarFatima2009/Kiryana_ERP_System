import { supabase } from '../lib/supabase';
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

    return {
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
