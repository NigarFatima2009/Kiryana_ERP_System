import { supabase } from '../lib/supabase';
import type { Profile, AppRole } from '../types/database';

export interface CashierAccountResult {
  success: boolean;
  message: string;
  user_id?: string;
  email?: string;
  temp_password?: string;
}

export async function fetchEmployees() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['OWNER', 'CASHIER'])
    .order('full_name');
  if (error) throw error;
  return data as Profile[];
}

export async function updateEmployeeRole(id: string, role: AppRole) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function toggleEmployeeActive(id: string, active: boolean) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ active })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Profile;
}

/**
 * Create a cashier with a REAL Supabase Auth account.
 * Calls the create_cashier_account RPC which:
 * 1. Creates an auth.users entry (real login credentials)
 * 2. Creates/updates the profiles row
 * 3. Returns the temporary password
 */
export async function createCashier({
  email,
  full_name,
  password,
}: {
  email: string;
  full_name: string;
  password?: string;
}): Promise<CashierAccountResult> {
  const { data, error } = await supabase.rpc('create_cashier_account', {
    p_email: email,
    p_full_name: full_name,
    p_password: password || '',
  });

  if (error) throw error;

  const result = data as CashierAccountResult;
  if (!result.success) {
    throw new Error(result.message);
  }

  return result;
}

/**
 * Owner sets a new password for a cashier.
 * Forces must_change_password = true on next login.
 */
export async function setCashierPassword(
  userId: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.rpc('set_cashier_password', {
    p_user_id: userId,
    p_new_password: newPassword,
  });

  if (error) throw error;

  const result = data as { success: boolean; message: string };
  if (!result.success) {
    throw new Error(result.message);
  }

  return result;
}

/**
 * Cashier changes their own password (first login or anytime).
 */
export async function changeOwnPassword(
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.rpc('change_own_password', {
    p_new_password: newPassword,
  });

  if (error) throw error;

  const result = data as { success: boolean; message: string };
  if (!result.success) {
    throw new Error(result.message);
  }

  return result;
}

/**
 * Delete a cashier account (removes auth user + profile).
 */
export async function deleteCashierAccount(userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('delete_cashier_account', {
    p_user_id: userId,
  });

  if (error) throw error;

  const result = data as { success: boolean; message: string };
  if (!result.success) {
    throw new Error(result.message);
  }

  return true;
}

// Legacy aliases for backward compatibility
export const inviteEmployee = createCashier;
export const deleteEmployee = deleteCashierAccount;
export const setEmployeePassword = setCashierPassword;
