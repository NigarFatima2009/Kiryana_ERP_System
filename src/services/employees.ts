import { supabase } from '../lib/supabase';
import type { Profile, AppRole } from '../types/database';

export interface CashierAccountResult {
  success: boolean;
  message: string;
  user_id?: string;
  email?: string;
  temp_password?: string;
}

/**
 * Security validation helpers
 */
const SecurityValidation = {
  /**
   * Validate email format and sanitize
   */
  validateEmail(email: string): { valid: boolean; error?: string; email?: string } {
    if (!email || typeof email !== 'string') {
      return { valid: false, error: 'Email is required' };
    }

    const trimmed = email.trim().toLowerCase();
    
    // RFC 5322 simplified email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      return { valid: false, error: 'Invalid email format' };
    }

    // Check length (RFC 5321: max 254 chars)
    if (trimmed.length > 254) {
      return { valid: false, error: 'Email is too long (max 254 characters)' };
    }

    return { valid: true, email: trimmed };
  },

  /**
   * Validate full name
   */
  validateFullName(name: string): { valid: boolean; error?: string; name?: string } {
    if (!name || typeof name !== 'string') {
      return { valid: false, error: 'Full name is required' };
    }

    const trimmed = name.trim();
    
    if (trimmed.length < 2) {
      return { valid: false, error: 'Full name must be at least 2 characters' };
    }

    if (trimmed.length > 100) {
      return { valid: false, error: 'Full name must be less than 100 characters' };
    }

    // Prevent common XSS/injection patterns
    if (/<script|javascript:|onerror|onclick/i.test(trimmed)) {
      return { valid: false, error: 'Full name contains invalid characters' };
    }

    return { valid: true, name: trimmed };
  },

  /**
   * Validate password strength (if provided)
   */
  validatePassword(password?: string): { valid: boolean; error?: string } {
    if (!password) {
      // Password is optional - will be generated server-side
      return { valid: true };
    }

    if (typeof password !== 'string') {
      return { valid: false, error: 'Password must be a string' };
    }

    if (password.length < 6) {
      return { valid: false, error: 'Password must be at least 6 characters' };
    }

    if (password.length > 128) {
      return { valid: false, error: 'Password must be less than 128 characters' };
    }

    return { valid: true };
  },

  /**
   * Check for duplicate email before submission
   */
  async checkEmailDuplicate(email: string): Promise<{ exists: boolean; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id', { count: 'exact' })
        .eq('email', email.toLowerCase())
        .maybeSingle();

      if (error) {
        // Log but don't throw - this is a soft check
        console.warn('[SecurityValidation] Email duplicate check error:', error.message);
        return { exists: false };
      }

      return { exists: !!data };
    } catch (err) {
      console.warn('[SecurityValidation] Email duplicate check failed:', err);
      return { exists: false };
    }
  },
};

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
 * 
 * Security Features:
 * - Owner-only access verification (double-checked on both client and server)
 * - Session refresh and validation
 * - Input sanitization and validation
 * - Email duplicate checking
 * - Password strength validation
 * - Comprehensive error handling and logging
 * 
 * Calls the create-cashier edge function which:
 * 1. Uses supabase.auth.admin.createUser() to create real login credentials
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
  console.log('[createCashier] Initiating cashier creation...');

  // ────────────────────────────────────────────────────────────
  // STEP 1: Validate input parameters
  // ────────────────────────────────────────────────────────────
  
  const emailValidation = SecurityValidation.validateEmail(email);
  if (!emailValidation.valid) {
    throw new Error(emailValidation.error || 'Invalid email');
  }

  const nameValidation = SecurityValidation.validateFullName(full_name);
  if (!nameValidation.valid) {
    throw new Error(nameValidation.error || 'Invalid full name');
  }

  const passwordValidation = SecurityValidation.validatePassword(password);
  if (!passwordValidation.valid) {
    throw new Error(passwordValidation.error || 'Invalid password');
  }

  const sanitizedEmail = emailValidation.email!;
  const sanitizedName = nameValidation.name!;

  console.log('[createCashier] Input validation passed');

  // ────────────────────────────────────────────────────────────
  // STEP 2: Check for email duplicates
  // ────────────────────────────────────────────────────────────
  
  const dupCheck = await SecurityValidation.checkEmailDuplicate(sanitizedEmail);
  if (dupCheck.exists) {
    throw new Error(`A user with email "${sanitizedEmail}" already exists`);
  }

  console.log('[createCashier] Email duplicate check passed');

  // ────────────────────────────────────────────────────────────
  // STEP 3: Verify session and owner status
  // ────────────────────────────────────────────────────────────
  
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  if (!supabaseUrl) {
    throw new Error('Supabase URL is not configured');
  }

  // Refresh session to ensure token is valid
  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
  const session = refreshData.session;

  if (refreshError) {
    console.error('[createCashier] Session refresh error:', refreshError.message);
    throw new Error('Failed to refresh login session. Please sign in again.');
  }

  if (!session) {
    throw new Error('Your login session has expired. Please sign in again before creating a cashier.');
  }

  // Get current user info
  const { data: userData, error: userError } = await supabase.auth.getUser(session.access_token);
  if (userError) {
    console.error('[createCashier] Get user error:', userError.message);
    throw new Error('Your login session could not be verified. Please sign in again.');
  }

  if (!userData.user) {
    throw new Error('User session is invalid. Please sign in again.');
  }

  const currentUserId = userData.user.id;
  console.log('[createCashier] User verified:', currentUserId);

  // ────────────────────────────────────────────────────────────
  // STEP 4: Verify user is an active OWNER
  // ────────────────────────────────────────────────────────────
  
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, active, full_name')
    .eq('id', currentUserId)
    .single();

  if (profileError) {
    console.error('[createCashier] Profile fetch error:', profileError.message);
    throw new Error('Failed to verify your account status. Please try again.');
  }

  if (!profile) {
    throw new Error('Your profile could not be found. Please sign in again.');
  }

  if (!profile.active) {
    console.warn('[createCashier] Attempt by inactive user:', currentUserId);
    throw new Error('Your account has been deactivated. Contact the administrator.');
  }

  if (profile.role !== 'OWNER') {
    console.warn('[createCashier] Unauthorized attempt by non-owner:', currentUserId, 'role:', profile.role);
    throw new Error('Only the owner can create cashier accounts.');
  }

  console.log('[createCashier] Owner verification passed for user:', currentUserId);

  // ────────────────────────────────────────────────────────────
  // STEP 5: Call edge function to create cashier
  // ────────────────────────────────────────────────────────────
  
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  if (!anonKey) {
    throw new Error('Supabase configuration is incomplete');
  }

  let resp: Response;
  try {
    resp = await fetch(`${supabaseUrl}/functions/v1/create-cashier`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': anonKey,
      },
      body: JSON.stringify({
        fullName: sanitizedName,
        email: sanitizedEmail,
        temporaryPassword: password || undefined,
      }),
    });
  } catch (err: any) {
    console.error('[createCashier] Network error:', err?.message);
    throw new Error('Network error while creating cashier. Please check your connection.');
  }

  // ────────────────────────────────────────────────────────────
  // STEP 6: Parse and validate response
  // ────────────────────────────────────────────────────────────
  
  let json: any;
  try {
    json = await resp.json();
  } catch (err) {
    console.error('[createCashier] Failed to parse response:', err);
    throw new Error(`Edge function returned invalid response (HTTP ${resp.status})`);
  }

  console.log('[createCashier] Edge function response:', {
    status: resp.status,
    success: json?.success,
    message: json?.message,
    hasUserId: !!json?.user_id,
  });

  // Handle HTTP errors
  if (!resp.ok) {
    const errorMessage = json?.message || `Edge function failed with status ${resp.status}`;
    console.error('[createCashier] Error:', errorMessage);
    throw new Error(errorMessage);
  }

  // Validate success response
  const result = json as CashierAccountResult;
  if (!result?.success) {
    const errorMessage = result?.message || 'Unknown error from edge function';
    console.error('[createCashier] Success flag false:', errorMessage);
    throw new Error(errorMessage);
  }

  // ────────────────────────────────────────────────────────────
  // STEP 7: Validate required fields in response
  // ────────────────────────────────────────────────────────────
  
  if (!result.user_id || !result.email || !result.temp_password) {
    console.error('[createCashier] Response missing required fields:', {
      hasUserId: !!result.user_id,
      hasEmail: !!result.email,
      hasPassword: !!result.temp_password,
    });
    throw new Error('Server response is incomplete. Please try again.');
  }

  console.log('[createCashier] ✅ Success! Cashier created:', result.user_id);

  return result;
}

/**
 * Owner sets a new password for a cashier.
 * Forces must_change_password = true on next login.
 * 
 * Security Features:
 * - Owner-only access verification
 * - Password strength validation
 * - User existence check
 * - Comprehensive error handling
 */
export async function setCashierPassword(
  userId: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  console.log('[setCashierPassword] Setting password for user:', userId);

  // ────────────────────────────────────────────────────────────
  // STEP 1: Validate input parameters
  // ────────────────────────────────────────────────────────────
  
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('User ID is required');
  }

  if (!newPassword || typeof newPassword !== 'string') {
    throw new Error('Password is required');
  }

  // Validate password strength
  if (newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  if (newPassword.length > 128) {
    throw new Error('Password must be less than 128 characters');
  }

  console.log('[setCashierPassword] Input validation passed');

  // ────────────────────────────────────────────────────────────
  // STEP 2: Verify current user is owner
  // ────────────────────────────────────────────────────────────
  
  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('role, active')
    .eq('id', (await supabase.auth.getUser()).data.user?.id)
    .single();

  if (currentProfile?.role !== 'OWNER' || !currentProfile?.active) {
    console.warn('[setCashierPassword] Unauthorized attempt');
    throw new Error('Only the owner can set cashier passwords');
  }

  // ────────────────────────────────────────────────────────────
  // STEP 3: Verify target user exists and is a cashier
  // ────────────────────────────────────────────────────────────
  
  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (!targetProfile) {
    throw new Error('Cashier not found');
  }

  if (targetProfile.role !== 'CASHIER') {
    throw new Error('Can only set password for cashier accounts');
  }

  console.log('[setCashierPassword] Authorization check passed');

  // ────────────────────────────────────────────────────────────
  // STEP 4: Call RPC function
  // ────────────────────────────────────────────────────────────
  
  let result: any;
  try {
    const { data, error } = await supabase.rpc('set_cashier_password', {
      p_user_id: userId,
      p_new_password: newPassword,
    });

    if (error) {
      console.error('[setCashierPassword] RPC error:', error.message);
      throw error;
    }

    result = data as { success: boolean; message: string };
  } catch (err: any) {
    const message = err?.message || 'Failed to set password';
    console.error('[setCashierPassword] Error:', message);
    throw new Error(message);
  }

  if (!result.success) {
    console.error('[setCashierPassword] RPC returned success=false:', result.message);
    throw new Error(result.message);
  }

  console.log('[setCashierPassword] ✅ Password set successfully');
  return result;
}

/**
 * Cashier changes their own password (first login or anytime).
 * 
 * Security Features:
 * - Self-only access (uses current auth user)
 * - Password strength validation
 * - Comprehensive error handling
 */
export async function changeOwnPassword(
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  console.log('[changeOwnPassword] Changing password for current user');

  // ────────────────────────────────────────────────────────────
  // STEP 1: Validate input
  // ────────────────────────────────────────────────────────────
  
  if (!newPassword || typeof newPassword !== 'string') {
    throw new Error('Password is required');
  }

  if (newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  if (newPassword.length > 128) {
    throw new Error('Password must be less than 128 characters');
  }

  console.log('[changeOwnPassword] Input validation passed');

  // ────────────────────────────────────────────────────────────
  // STEP 2: Verify user is authenticated
  // ────────────────────────────────────────────────────────────
  
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    throw new Error('You must be logged in to change your password');
  }

  console.log('[changeOwnPassword] User authenticated:', userData.user.id);

  // ────────────────────────────────────────────────────────────
  // STEP 3: Call RPC function
  // ────────────────────────────────────────────────────────────
  
  let result: any;
  try {
    const { data, error } = await supabase.rpc('change_own_password', {
      p_new_password: newPassword,
    });

    if (error) {
      console.error('[changeOwnPassword] RPC error:', error.message);
      throw error;
    }

    result = data as { success: boolean; message: string };
  } catch (err: any) {
    const message = err?.message || 'Failed to change password';
    console.error('[changeOwnPassword] Error:', message);
    throw new Error(message);
  }

  if (!result.success) {
    console.error('[changeOwnPassword] RPC returned success=false:', result.message);
    throw new Error(result.message);
  }

  console.log('[changeOwnPassword] ✅ Password changed successfully');
  return result;
}

/**
 * Delete a cashier account (removes auth user + profile).
 * 
 * Security Features:
 * - Owner-only access verification
 * - Prevents deleting active cashiers (must deactivate first)
 * - Comprehensive error handling
 * - Audit logging
 */
export async function deleteCashierAccount(userId: string): Promise<boolean> {
  console.log('[deleteCashierAccount] Deleting cashier account:', userId);

  // ────────────────────────────────────────────────────────────
  // STEP 1: Validate input
  // ────────────────────────────────────────────────────────────
  
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('User ID is required');
  }

  // ────────────────────────────────────────────────────────────
  // STEP 2: Verify current user is owner
  // ────────────────────────────────────────────────────────────
  
  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('role, active')
    .eq('id', (await supabase.auth.getUser()).data.user?.id)
    .single();

  if (currentProfile?.role !== 'OWNER' || !currentProfile?.active) {
    console.warn('[deleteCashierAccount] Unauthorized attempt');
    throw new Error('Only the owner can delete cashier accounts');
  }

  // ────────────────────────────────────────────────────────────
  // STEP 3: Verify target user exists, is inactive, and is a cashier
  // ────────────────────────────────────────────────────────────
  
  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('role, active, full_name, email')
    .eq('id', userId)
    .single();

  if (!targetProfile) {
    throw new Error('Cashier not found');
  }

  if (targetProfile.role !== 'CASHIER') {
    throw new Error('Can only delete cashier accounts');
  }

  if (targetProfile.active) {
    throw new Error('Cannot delete an active cashier account. Deactivate it first.');
  }

  console.log('[deleteCashierAccount] Target validation passed:', targetProfile.email);

  // ────────────────────────────────────────────────────────────
  // STEP 4: Call RPC function
  // ────────────────────────────────────────────────────────────
  
  let result: any;
  try {
    const { data, error } = await supabase.rpc('delete_cashier_account', {
      p_user_id: userId,
    });

    if (error) {
      console.error('[deleteCashierAccount] RPC error:', error.message);
      throw error;
    }

    result = data as { success: boolean; message: string };
  } catch (err: any) {
    const message = err?.message || 'Failed to delete cashier account';
    console.error('[deleteCashierAccount] Error:', message);
    throw new Error(message);
  }

  if (!result.success) {
    console.error('[deleteCashierAccount] RPC returned success=false:', result.message);
    throw new Error(result.message);
  }

  console.log('[deleteCashierAccount] ✅ Account deleted successfully:', targetProfile.email);
  return true;
}

// Legacy aliases for backward compatibility
export const inviteEmployee = createCashier;
export const deleteEmployee = deleteCashierAccount;
export const setEmployeePassword = setCashierPassword;
