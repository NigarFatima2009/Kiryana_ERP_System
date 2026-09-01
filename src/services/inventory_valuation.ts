import { supabase } from '../lib/supabase';

export type ValuationMethod = 'FIFO' | 'LIFO' | 'WEIGHTED_AVERAGE';

export interface ValuationData {
  product_id: string;
  product_name: string;
  total_units: number;
  value: number;
  average_unit_cost: number;
}

export interface ValuationComparison {
  product_id: string;
  product_name: string;
  total_units: number;
  fifo_value: number;
  lifo_value: number;
  weighted_avg_value: number;
  fifo_vs_lifo_variance: number;
  fifo_vs_weighted_variance: number;
  valuation_method_impact: string;
}

export interface CogsComparison {
  fifo_method: string;
  fifo_quantity: number;
  fifo_total_cost: number;
  fifo_avg_cost: number;
  lifo_total_cost: number;
  lifo_avg_cost: number;
  weighted_avg_total_cost: number;
  weighted_avg_cost: number;
  fifo_vs_lifo_variance: number;
  fifo_vs_weighted_variance: number;
}

export interface ValuationReport {
  rank: number;
  product_name: string;
  category_name: string | null;
  total_units: number;
  unit_cost: number;
  total_value: number;
  percentage_of_total: number;
}

// Helper: fetch all active products with their batches
async function fetchProductBatches(): Promise<{
  products: Map<string, { name: string; category_name: string }>;
  batches: Map<string, Array<{ remaining_quantity: number; purchase_cost: number; received_date: string }>>;
}> {
  const { data: products } = await supabase
    .from('products')
    .select('id, name, category_id, categories(name)')
    .eq('active', true);

  const productMap = new Map<string, { name: string; category_name: string }>();
  for (const p of products || []) {
    const cat = (p as any).categories;
    productMap.set(p.id, { name: p.name, category_name: cat?.name || '' });
  }

  const productIds = [...productMap.keys()];
  if (productIds.length === 0) {
    return { products: productMap, batches: new Map() };
  }

  const { data: batches } = await supabase
    .from('inventory_batches')
    .select('product_id, remaining_quantity, purchase_cost, received_date')
    .in('product_id', productIds)
    .gt('remaining_quantity', 0);

  const batchMap = new Map<string, Array<{ remaining_quantity: number; purchase_cost: number; received_date: string }>>();
  for (const b of batches || []) {
    if (!batchMap.has(b.product_id)) batchMap.set(b.product_id, []);
    batchMap.get(b.product_id)!.push({
      remaining_quantity: Number(b.remaining_quantity),
      purchase_cost: Number(b.purchase_cost),
      received_date: b.received_date || '9999-12-31',
    });
  }

  return { products: productMap, batches: batchMap };
}

// FIFO: oldest batches first
function calculateFIFO(batches: Array<{ remaining_quantity: number; purchase_cost: number; received_date: string }>): { value: number; units: number } {
  const sorted = [...batches].sort((a, b) => a.received_date.localeCompare(b.received_date));
  let value = 0;
  let units = 0;
  for (const b of sorted) {
    value += b.remaining_quantity * b.purchase_cost;
    units += b.remaining_quantity;
  }
  return { value, units };
}

// LIFO: newest batches first
function calculateLIFO(batches: Array<{ remaining_quantity: number; purchase_cost: number; received_date: string }>): { value: number; units: number } {
  const sorted = [...batches].sort((a, b) => b.received_date.localeCompare(a.received_date));
  let value = 0;
  let units = 0;
  for (const b of sorted) {
    value += b.remaining_quantity * b.purchase_cost;
    units += b.remaining_quantity;
  }
  return { value, units };
}

// Weighted Average: total cost / total units
function calculateWA(batches: Array<{ remaining_quantity: number; purchase_cost: number }>): { value: number; units: number } {
  let totalCost = 0;
  let totalUnits = 0;
  for (const b of batches) {
    totalCost += b.remaining_quantity * b.purchase_cost;
    totalUnits += b.remaining_quantity;
  }
  return { value: totalCost, units: totalUnits };
}

// Fetch sales data for COGS comparison
async function fetchSalesCogs(days: number): Promise<{
  total_qty: number;
  total_cogs: number;
}> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data } = await supabase
    .from('sale_items')
    .select('quantity, cogs, sales!inner(status, sale_date)')
    .gte('sales.sale_date', since)
    .eq('sales.status', 'COMPLETED');

  let total_qty = 0;
  let total_cogs = 0;
  for (const item of data || []) {
    total_qty += Number((item as any).quantity || 0);
    total_cogs += Number((item as any).cogs || 0);
  }
  return { total_qty, total_cogs };
}

export async function getInventoryValuationComparison(): Promise<ValuationComparison[]> {
  const { products, batches } = await fetchProductBatches();
  const result: ValuationComparison[] = [];

  for (const [pid, pInfo] of products) {
    const pb = batches.get(pid) || [];
    if (pb.length === 0) continue;

    const fifo = calculateFIFO(pb);
    const lifo = calculateLIFO(pb);
    const wa = calculateWA(pb);
    const units = fifo.units; // same for all methods

    result.push({
      product_id: pid,
      product_name: pInfo.name,
      total_units: units,
      fifo_value: fifo.value,
      lifo_value: lifo.value,
      weighted_avg_value: wa.value,
      fifo_vs_lifo_variance: fifo.value - lifo.value,
      fifo_vs_weighted_variance: fifo.value - wa.value,
      valuation_method_impact: fifo.value !== lifo.value
        ? `Difference of Rs ${Math.abs(fifo.value - lifo.value).toFixed(2)}`
        : 'Methods produce equal value',
    });
  }

  return result.sort((a, b) => a.product_name.localeCompare(b.product_name));
}

export async function getCogsComparison30Days(): Promise<CogsComparison> {
  const { total_qty, total_cogs } = await fetchSalesCogs(30);
  const avg = total_qty > 0 ? total_cogs / total_qty : 0;

  return {
    fifo_method: 'FIFO',
    fifo_quantity: total_qty,
    fifo_total_cost: total_cogs,
    fifo_avg_cost: avg,
    lifo_total_cost: total_cogs,
    lifo_avg_cost: avg,
    weighted_avg_total_cost: total_cogs,
    weighted_avg_cost: avg,
    fifo_vs_lifo_variance: 0,
    fifo_vs_weighted_variance: 0,
  };
}

export async function getInventoryValuationReport(method: ValuationMethod): Promise<ValuationReport[]> {
  const { products, batches } = await fetchProductBatches();
  const items: ValuationReport[] = [];

  let grandTotal = 0;
  for (const [pid, pInfo] of products) {
    const pb = batches.get(pid) || [];
    if (pb.length === 0) continue;

    let totalValue = 0;
    let totalUnits = 0;

    if (method === 'FIFO') {
      const f = calculateFIFO(pb);
      totalValue = f.value;
      totalUnits = f.units;
    } else if (method === 'LIFO') {
      const l = calculateLIFO(pb);
      totalValue = l.value;
      totalUnits = l.units;
    } else {
      const w = calculateWA(pb);
      totalValue = w.value;
      totalUnits = w.units;
    }

    grandTotal += totalValue;
    items.push({
      rank: 0,
      product_name: pInfo.name,
      category_name: pInfo.category_name,
      total_units: totalUnits,
      unit_cost: totalUnits > 0 ? totalValue / totalUnits : 0,
      total_value: totalValue,
      percentage_of_total: 0,
    });
  }

  // Set ranks and percentages
  items.sort((a, b) => b.total_value - a.total_value);
  items.forEach((item, i) => {
    item.rank = i + 1;
    item.percentage_of_total = grandTotal > 0 ? (item.total_value / grandTotal) * 100 : 0;
  });

  return items;
}

export async function getInventoryValueSummary(): Promise<{
  fifo_total: number;
  lifo_total: number;
  weighted_avg_total: number;
  variance_fifo_vs_lifo: number;
  variance_fifo_vs_weighted: number;
}> {
  const { products, batches } = await fetchProductBatches();
  let fifo_total = 0;
  let lifo_total = 0;
  let weighted_avg_total = 0;

  for (const [pid] of products) {
    const pb = batches.get(pid) || [];
    if (pb.length === 0) continue;
    fifo_total += calculateFIFO(pb).value;
    lifo_total += calculateLIFO(pb).value;
    weighted_avg_total += calculateWA(pb).value;
  }

  return {
    fifo_total,
    lifo_total,
    weighted_avg_total,
    variance_fifo_vs_lifo: fifo_total - lifo_total,
    variance_fifo_vs_weighted: fifo_total - weighted_avg_total,
  };
}

export async function setProductValuationMethod(productId: string, method: ValuationMethod): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({ valuation_method: method })
    .eq('id', productId);
  if (error) throw error;
}

export async function setAllProductsValuationMethod(method: ValuationMethod): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({ valuation_method: method })
    .eq('active', true);
  if (error) throw error;
}
