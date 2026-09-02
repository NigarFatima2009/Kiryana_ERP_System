import { supabase } from '../lib/supabase';
import { getOfflineDB } from '../lib/offline/db';
import type { OfflineShift } from '../lib/offline/types';

// Maximum shift duration in minutes before auto-closing
// TEMPORARY: 15 minutes for testing — change back to 12*60 (720) for production
export const MAX_SHIFT_MINUTES = 15;

/**
 * Check if a shift has exceeded the maximum allowed duration.
 * If so, auto-close it and return true.
 * DISABLED FOR TESTING - we want manual close only
 */
async function autoCloseExpiredShift(shift: CashierShift): Promise<boolean> {
  // DISABLED: Auto-closing disabled during testing
  return false;
}

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
  auto_close_at?: string | null;
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
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function openCashierShift(openingCash: number): Promise<CashierShift> {
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id || '';

  // Check if offline — save shift to IndexedDB
  if (!navigator.onLine) {
    console.log('[Shift] Offline — saving shift to IndexedDB');
    const db = getOfflineDB();
    const shiftId = generateUUID();
    const now = new Date().toISOString();
    const offlineShift: OfflineShift = {
      id: shiftId,
      user_id: userId,
      opened_at: now,
      closed_at: null,
      opening_cash: openingCash,
      closing_cash: null,
      expected_cash: null,
      variance: null,
      status: 'OPEN',
      notes: null,
      synced: false,
      server_shift_id: null,
      created_at: Date.now(),
      synced_at: null,
    };
    await db.offlineShifts.add(offlineShift);
    console.log('[Shift] Offline shift created:', shiftId);
    // Return as CashierShift (compatible shape)
    return {
      id: shiftId,
      user_id: userId,
      opened_at: now,
      closed_at: null,
      opening_cash: openingCash,
      closing_cash: null,
      expected_cash: null,
      variance: null,
      status: 'OPEN',
      notes: null,
      created_at: now,
    };
  }

  // Pass client's local time so the shift starts at the cashier's actual time
  const clientTime = new Date().toISOString();
  console.log(`[Shift] Opening new shift at: ${new Date().toLocaleString()}`);

  const { data, error } = await supabase
    .rpc('open_cashier_shift', {
      p_opening_cash: openingCash,
      p_client_time: clientTime,
    })
    .single();

  if (error) throw error;
  return data as CashierShift;
}

/**
 * Resume a closed shift (re-opens it without changing opened_at)
 */
export async function resumeCashierShift(shiftId: string): Promise<CashierShift> {
  const { data, error } = await supabase
    .rpc('resume_cashier_shift', { p_shift_id: shiftId })
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
  // If offline, close in IndexedDB
  if (!navigator.onLine) {
    const db = getOfflineDB();
    const shift = await db.offlineShifts.get(shiftId);
    if (!shift) throw new Error('Shift not found');

    // Calculate expected cash from offline sales
    const sales = await db.offlineSales
      .where('status').anyOf(['pending_sync', 'synced'])
      .toArray();
    // TODO: link sales to shift by shift_id when available
    const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
    const expectedCash = shift.opening_cash + totalSales;
    const variance = expectedCash - closingCash;

    await db.offlineShifts.update(shiftId, {
      status: 'CLOSED',
      closed_at: new Date().toISOString(),
      closing_cash: closingCash,
      expected_cash: expectedCash,
      variance: variance,
    });

    return {
      id: shiftId,
      opened_at: shift.opened_at,
      closed_at: new Date().toISOString(),
      opening_cash: shift.opening_cash,
      closing_cash: closingCash,
      expected_cash: expectedCash,
      variance: variance,
      variance_percentage: expectedCash > 0 ? (variance / expectedCash) * 100 : 0,
      sales_count: sales.length,
      total_sales: totalSales,
      average_transaction: sales.length > 0 ? totalSales / sales.length : 0,
      status: 'CLOSED',
    };
  }

  // Online: use RPC
  const clientTime = new Date().toISOString();
  const { data, error } = await supabase
    .rpc('close_cashier_shift', {
      p_shift_id: shiftId,
      p_closing_cash: closingCash,
      p_client_time: clientTime,
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
  // Helper: small delay for retry
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Helper: check if error is a 406 (schema mismatch / not acceptable)
  const isSchemaError = (err: any) =>
    err?.status === 406 || err?.code === '42P01' || err?.message?.includes('Not Acceptable');

  try {
    // If offline, check IndexedDB for active shift
    if (!navigator.onLine) {
      const db = getOfflineDB();
      const offlineShift = await db.offlineShifts
        .where('status').equals('OPEN')
        .first();
      if (offlineShift) {
        console.log('[Shift] Using offline shift:', offlineShift.id);
        return {
          id: offlineShift.id,
          user_id: offlineShift.user_id,
          opened_at: offlineShift.opened_at,
          closed_at: offlineShift.closed_at,
          opening_cash: offlineShift.opening_cash,
          closing_cash: offlineShift.closing_cash,
          expected_cash: offlineShift.expected_cash,
          variance: offlineShift.variance,
          status: offlineShift.status,
          notes: offlineShift.notes,
          created_at: new Date(offlineShift.created_at).toISOString(),
        };
      }
      return null;
    }

    // Online: Try RPC first
    const { data, error } = await supabase
      .rpc('get_current_shift')
      .single();

    // If 406 (schema mismatch), wait 2s and retry once — PostgREST may need schema reload
    if (isSchemaError(error)) {
      console.warn('⚠️ 406 on get_current_shift — retrying after 2s (schema may be reloading)...');
      await sleep(2000);
      const { data: retryData, error: retryError } = await supabase
        .rpc('get_current_shift')
        .single();
      if (retryData) {
        const shift = retryData as CashierShift;
        const wasExpired = await autoCloseExpiredShift(shift);
        if (wasExpired) return null;
        console.log('✅ RPC get_current_shift succeeded on retry');
        return shift;
      }
      if (retryError) console.warn('RPC retry also failed:', retryError.message);
    } else if (error && error.code !== 'PGRST116') {
      console.warn('RPC get_current_shift error:', error.message);
    }

    if (data && !isSchemaError(error)) {
      const shift = data as CashierShift;
      const wasExpired = await autoCloseExpiredShift(shift);
      if (wasExpired) {
        console.log('⏰ Expired shift auto-closed, returning null');
        return null;
      }
      console.log('✅ RPC get_current_shift succeeded');
      return shift;
    }

    // Fallback: Query table directly for THIS user only
    console.log('⏳ RPC returned no data, trying fallback query...');
    const { data: { user } } = await supabase.auth.getUser();
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('cashier_shifts')
      .select('*')
      .eq('status', 'OPEN')
      .eq('user_id', user?.id || '')
      .order('opened_at', { ascending: false })
      .limit(1)
      .single();

    if (fallbackError) {
      if (fallbackError.code === 'PGRST116') {
        console.log('ℹ️ No open shift found');
        return null;
      }
      // If 406 on fallback too, retry once
      if (isSchemaError(fallbackError)) {
        console.warn('⚠️ 406 on fallback query — retrying after 2s...');
        await sleep(2000);
        const { data: retryFallback, error: retryErr } = await supabase
          .from('cashier_shifts')
          .select('*')
          .eq('status', 'OPEN')
          .eq('user_id', user?.id || '')
          .order('opened_at', { ascending: false })
          .limit(1)
          .single();
        if (retryErr && retryErr.code !== 'PGRST116') {
          console.error('❌ Fallback retry also failed:', retryErr.message);
          return null;
        }
        if (retryFallback) {
          const shift = retryFallback as CashierShift;
          const wasExpired = await autoCloseExpiredShift(shift);
          if (wasExpired) return null;
          console.log('✅ Fallback query succeeded on retry');
          return shift;
        }
        console.log('ℹ️ No open shift found (after retry)');
        return null;
      }
      console.error('❌ Fallback query error:', fallbackError.message);
      return null;
    }

    const shift = fallbackData as CashierShift;
    const wasExpired = await autoCloseExpiredShift(shift);
    if (wasExpired) {
      console.log('⏰ Expired shift auto-closed via fallback, returning null');
      return null;
    }
    console.log('✅ Fallback query succeeded');
    return shift;
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

  // Filter by current user — cashiers should only see their own shifts
  const { data: { user } } = await supabase.auth.getUser();
  let query = supabase
    .from('cashier_shifts')
    .select('*', { count: 'exact' })
    .eq('user_id', user?.id || '')
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
 * Sync offline shifts to Supabase when connection returns
 */
export async function syncOfflineShifts(): Promise<void> {
  if (!navigator.onLine) return;

  const db = getOfflineDB();
  const unsyncedShifts = await db.offlineShifts
    .where('synced').equals(0)
    .toArray();

  if (unsyncedShifts.length === 0) return;
  console.log(`[Shift] Syncing ${unsyncedShifts.length} offline shifts...`);

  for (const offlineShift of unsyncedShifts) {
    try {
      if (offlineShift.status === 'CLOSED') {
        // Closed shift — just insert it
        const { data, error } = await supabase
          .from('cashier_shifts')
          .insert({
            user_id: offlineShift.user_id,
            opened_at: offlineShift.opened_at,
            closed_at: offlineShift.closed_at,
            opening_cash: offlineShift.opening_cash,
            closing_cash: offlineShift.closing_cash,
            expected_cash: offlineShift.expected_cash,
            variance: offlineShift.variance,
            status: 'CLOSED',
            notes: offlineShift.notes || 'Synced from offline',
          })
          .select()
          .single();

        if (!error && data) {
          await db.offlineShifts.update(offlineShift.id, {
            synced: true,
            server_shift_id: data.id,
            synced_at: Date.now(),
          });
          console.log('[Shift] Synced closed shift:', offlineShift.id, '->', data.id);
        }
      } else {
        // Open shift — insert it and update any offline sales to link to it
        const { data, error } = await supabase
          .from('cashier_shifts')
          .insert({
            user_id: offlineShift.user_id,
            opened_at: offlineShift.opened_at,
            opening_cash: offlineShift.opening_cash,
            status: 'OPEN',
            notes: offlineShift.notes || 'Synced from offline',
          })
          .select()
          .single();

        if (!error && data) {
          await db.offlineShifts.update(offlineShift.id, {
            synced: true,
            server_shift_id: data.id,
            synced_at: Date.now(),
          });
          console.log('[Shift] Synced open shift:', offlineShift.id, '->', data.id);
        }
      }
    } catch (err) {
      console.error('[Shift] Failed to sync shift:', offlineShift.id, err);
    }
  }
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

/**
 * Owner: Force-close any cashier's shift
 * Used for testing or when a cashier forgets to close their shift
 */
export async function ownerCloseShift(shiftId: string): Promise<void> {
  const { data: shift, error: fetchError } = await supabase
    .from('cashier_shifts')
    .select('*')
    .eq('id', shiftId)
    .single();

  if (fetchError || !shift) throw new Error('Shift not found');

  // Calculate expected cash from sales
  const { data: salesData } = await supabase
    .from('sales')
    .select('total')
    .eq('shift_id', shiftId)
    .eq('status', 'COMPLETED');

  const totalSales = (salesData || []).reduce((sum, s) => sum + (s.total || 0), 0);
  const expectedCash = Number(shift.opening_cash) + totalSales;

  const { error } = await supabase
    .from('cashier_shifts')
    .update({
      status: 'CLOSED',
      closed_at: new Date().toISOString(),
      closing_cash: expectedCash, // Assume balanced for forced close
      expected_cash: expectedCash,
      variance: 0,
      notes: `Force-closed by owner. Auto-set to expected: ${expectedCash}`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', shiftId);

  if (error) throw error;
}

/**
 * Owner: Get all shifts across all cashiers
 */
export async function ownerGetAllShifts(params?: {
  page?: number;
  pageSize?: number;
  date?: string;
}): Promise<{ data: CashierShift[]; count: number }> {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('cashier_shifts')
    .select('*, profiles!cashier_shifts_user_id_fkey(email, full_name)', { count: 'exact' })
    .order('opened_at', { ascending: false })
    .range(from, to);

  if (params?.date) {
    query = query.gte('opened_at', `${params.date}T00:00:00`).lt('opened_at', `${params.date}T23:59:59`);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    data: (data || []) as any[],
    count: count || 0,
  };
}
