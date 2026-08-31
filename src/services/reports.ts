import { supabase } from '../lib/supabase';

// ==================== SALES REPORTS ====================

export async function getSalesReport({ from, to }: { from: string; to: string }) {
  const { data, error } = await supabase
    .from('sales')
    .select('sale_date, total, cogs')
    .eq('status', 'COMPLETED')
    .gte('sale_date', `${from}T00:00:00`)
    .lte('sale_date', `${to}T23:59:59`)
    .order('sale_date');

  if (error) throw error;

  const grouped: Record<string, any> = {};
  (data as any[]).forEach((sale) => {
    const date = sale.sale_date.split('T')[0];
    if (!grouped[date]) grouped[date] = { date, total_sales: 0, cogs: 0, profit: 0 };
    grouped[date].total_sales += Number(sale.total);
    grouped[date].cogs += Number(sale.cogs);
    grouped[date].profit += Number(sale.total) - Number(sale.cogs);
  });

  return Object.values(grouped);
}

export async function getProductSalesReport({ from, to }: { from: string; to: string }) {
  const { data, error } = await supabase
    .from('sale_items')
    .select('product_id, quantity, line_total, cogs, products(name)')
    .order('line_total', { ascending: false });

  if (error) throw error;

  const grouped: Record<string, any> = {};
  (data as any[]).forEach((item) => {
    const name = (item.products as any)?.name || 'Unknown';
    if (!grouped[name]) grouped[name] = { name, quantity: 0, revenue: 0, cogs: 0, profit: 0 };
    grouped[name].quantity += Number(item.quantity);
    grouped[name].revenue += Number(item.line_total);
    grouped[name].cogs += Number(item.cogs || 0);
    grouped[name].profit += Number(item.line_total) - Number(item.cogs || 0);
  });

  return Object.values(grouped).sort((a: any, b: any) => b.revenue - a.revenue);
}

// ==================== INVENTORY REPORTS ====================

export async function getInventoryReport() {
  const { data: inv, error: invError } = await supabase
    .from('inventory')
    .select('product_id, quantity, average_cost');

  if (invError) throw invError;
  if (!inv || inv.length === 0) return [];

  const productIds = inv.map((i) => i.product_id);
  const { data: products } = await supabase
    .from('products')
    .select('id, name, sku, reorder_level, category_id')
    .in('id', productIds);

  const catIds = (products || []).map((p) => p.category_id).filter(Boolean);
  const { data: cats } = await supabase.from('categories').select('id, name').in('id', catIds);

  const prodMap = new Map((products || []).map((p) => [p.id, p]));
  const catMap = new Map((cats || []).map((c) => [c.id, c.name]));

  return inv.map((item) => {
    const product = prodMap.get(item.product_id);
    return {
      product_id: item.product_id,
      product_name: product?.name || 'Unknown',
      sku: product?.sku || '',
      category: catMap.get(product?.category_id) || '',
      quantity: item.quantity,
      average_cost: item.average_cost,
      stock_value: Number(item.quantity) * Number(item.average_cost),
      is_low_stock: product?.reorder_level ? item.quantity <= product.reorder_level : false,
    };
  });
}

// ==================== CUSTOMER REPORTS ====================

export async function getCustomerBalancesReport() {
  const { data: customers, error: ce } = await supabase.from('customers').select('*');
  if (ce) throw ce;

  const { data: transactions } = await supabase.from('customer_transactions').select('*');

  return (customers as any[]).map((customer) => {
    const txns = (transactions as any[]).filter((t) => t.customer_id === customer.id);
    let balance = Number(customer.opening_balance) || 0;
    txns.forEach((t) => {
      if (t.transaction_type === 'CREDIT_SALE') balance += Number(t.amount);
      if (t.transaction_type === 'PAYMENT' || t.transaction_type === 'RETURN') balance -= Number(t.amount);
    });

    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      credit_limit: customer.credit_limit,
      balance,
    };
  });
}

// ==================== SUPPLIER REPORTS ====================

export async function getSupplierBalancesReport() {
  const { data: suppliers, error: se } = await supabase.from('suppliers').select('*');
  if (se) throw se;

  const { data: transactions } = await supabase.from('supplier_transactions').select('*');

  return (suppliers as any[]).map((supplier) => {
    const txns = (transactions as any[]).filter((t) => t.supplier_id === supplier.id);
    let balance = Number(supplier.opening_balance) || 0;
    txns.forEach((t) => {
      if (t.transaction_type === 'PURCHASE') balance += Number(t.amount);
      if (t.transaction_type === 'PAYMENT' || t.transaction_type === 'RETURN') balance -= Number(t.amount);
    });

    return {
      id: supplier.id,
      name: supplier.name,
      balance,
    };
  });
}

// ==================== PROFIT & LOSS ====================

export async function getProfitAndLossReport({ from, to }: { from: string; to: string }) {
  // Revenue
  const { data: sales } = await supabase
    .from('sales')
    .select('total, cogs')
    .eq('status', 'COMPLETED')
    .gte('sale_date', `${from}T00:00:00`)
    .lte('sale_date', `${to}T23:59:59`);

  let revenue = 0;
  let cogs = 0;
  (sales || []).forEach((s: any) => {
    revenue += Number(s.total);
    cogs += Number(s.cogs);
  });

  const grossProfit = revenue - cogs;

  // Expenses by category
  const { data: expenses } = await supabase
    .from('expenses')
    .select('amount, expense_categories(name)')
    .gte('expense_date', from)
    .lte('expense_date', to);

  const expenseByCategory: Record<string, number> = {};
  let totalExpenses = 0;
  (expenses || []).forEach((e: any) => {
    const name = (e.expense_categories as any)?.name || 'Miscellaneous';
    expenseByCategory[name] = (expenseByCategory[name] || 0) + Number(e.amount);
    totalExpenses += Number(e.amount);
  });

  return {
    revenue,
    cogs,
    grossProfit,
    expenses: expenseByCategory,
    totalExpenses,
    netProfit: grossProfit - totalExpenses,
  };
}

// ==================== PURCHASE REPORTS ====================

export async function getPurchaseReport({ from, to }: { from: string; to: string }) {
  const { data, error } = await supabase
    .from('goods_receipts')
    .select('received_date, total, supplier_id, suppliers(name)')
    .gte('received_date', from)
    .lte('received_date', to)
    .order('received_date');

  if (error) throw error;

  return (data || []).map((r: any) => ({
    date: r.received_date,
    supplier: (r.suppliers as any)?.name || 'Unknown',
    total: Number(r.total),
  }));
}
