import { supabase } from '../lib/supabase';

export interface CashierShift {
  id: string;
  user_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  variance: number | null;
  status: 'OPEN' | 'CLOSED';
  notes: string | null;
  created_at: string;
}

export interface ShiftSummary {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  variance: number | null;
  variance_percentage: number;
  sales_count: number;
  total_sales: number;
  average_transaction: number;
  status: 'OPEN' | 'CLOSED';
}

export interface ShiftDashboardItem {
  id: string;
  user_id: string;
  email: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  variance: number | null;
  variance_status: 'HIGH_VARIANCE' | 'OVERAGE' | 'SHORTAGE' | 'BALANCED';
  sales_count: number;
  total_sales: number;
  status: 'OPEN' | 'CLOSED';
  created_at: string;
}

// ==================== SHIFT MANAGEMENT ====================

/**
 * Open a new cashier shift
 */
export async function openCashierShift(openingCash: number): Promise<CashierShift> {
  const { data, error } = await supabase
    .rpc('open_cashier_shift', { p_opening_cash: openingCash })
    .single();

  if (error) throw error;
  return data as CashierShift;
}

/**
 * Close current shift
 */
export async function closeCashierShift(
  shiftId: string,
  closingCash: number
): Promise<ShiftSummary> {
  const { data, error } = await supabase
    .rpc('close_cashier_shift', {
      p_shift_id: shiftId,
      p_closing_cash: closingCash,
    })
    .single();

  if (error) throw error;
  // Compute average_transaction (RPC doesn't return it)
  const result = data as any;
  result.average_transaction = result.sales_count > 0 ? result.total_sales / result.sales_count : 0;
  result.variance_percentage = result.expected_cash > 0 ? ((result.variance || 0) / result.expected_cash) * 100 : 0;
  return result as ShiftSummary;
}

/**
 * Get current open shift for the logged-in user
 * Falls back to direct query if RPC fails
 */
export async function getCurrentShift(): Promise<CashierShift | null> {
  try {
    // Try RPC first
    const { data, error } = await supabase
      .rpc('get_current_shift')
      .single();

    if (error && error.code !== 'PGRST116') {
      // Only log non-"no rows" errors
      console.warn('RPC get_current_shift error:', error.message);
    }

    if (data) {
      console.log('✅ RPC get_current_shift succeeded');
      return data as CashierShift;
    }

    // Fallback: Query table directly
    console.log('⏳ RPC returned no data, trying fallback query...');
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('cashier_shifts')
      .select('*')
      .eq('status', 'OPEN')
      .order('opened_at', { ascending: false })
      .limit(1)
      .single();

    if (fallbackError) {
      if (fallbackError.code === 'PGRST116') {
        // No rows found - this is normal when no shift is open
        console.log('ℹ️ No open shift found');
        return null;
      }
      console.error('❌ Fallback query error:', fallbackError.message);
      return null;
    }

    console.log('✅ Fallback query succeeded');
    return fallbackData as CashierShift;
  } catch (err) {
    console.error('❌ Fatal error in getCurrentShift:', err);
    return null;
  }
}

/**
 * Get shift summary details
 */
export async function getShiftSummary(shiftId: string): Promise<ShiftSummary> {
  const { data, error } = await supabase
    .rpc('get_shift_summary', { p_shift_id: shiftId })
    .single();

  if (error) throw error;
  return data as ShiftSummary;
}

/**
 * Get all shifts for current user
 */
export async function getUserShifts(params?: {
  page?: number;
  pageSize?: number;
  status?: 'OPEN' | 'CLOSED';
}): Promise<{ data: CashierShift[]; count: number; totalPages: number }> {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('cashier_shifts')
    .select('*', { count: 'exact' })
    .order('opened_at', { ascending: false })
    .range(from, to);

  if (params?.status) {
    query = query.eq('status', params.status);
  }

  const { data, error, count } = await query;

  if (error) throw error;

  return {
    data: (data || []) as CashierShift[],
    count: count || 0,
    totalPages: Math.ceil((count || 0) / pageSize),
  };
}

/**
 * Get today's shift dashboard
 */
export async function getTodayShiftDashboard(): Promise<ShiftDashboardItem[]> {
  const { data, error } = await supabase
    .from('shift_dashboard')
    .select('*');

  if (error) throw error;
  return (data || []) as ShiftDashboardItem[];
}

/**
 * Get shift performance report (historical)
 */
export async function getShiftPerformanceReport(params?: {
  days?: number;
  user_id?: string;
}): Promise<any[]> {
  let query = supabase
    .from('shift_performance_report')
    .select('*')
    .order('shift_date', { ascending: false });

  if (params?.days) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - params.days);
    query = query.gte('shift_date', startDate.toISOString().split('T')[0]);
  }

  if (params?.user_id) {
    query = query.eq('user_id', params.user_id);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

/**
 * Update shift with notes
 */
export async function updateShiftNotes(shiftId: string, notes: string): Promise<void> {
  const { error } = await supabase
    .from('cashier_shifts')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('id', shiftId);

  if (error) throw error;
}
