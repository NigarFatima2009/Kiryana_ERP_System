import { supabase } from '../lib/supabase';
import type { Profile, AppRole } from '../types/database';

export async function fetchEmployees() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('full_name');
  if (error) throw error;
  return data as (Profile & { email: string | null })[];
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

export async function deleteEmployee(id: string) {
  // Delete the profile (auth user cascade deletes the profile due to FK)
  // Note: This only works if we can delete from profiles.
  // The auth user must be deleted separately via admin API or Dashboard.
  const { error } = await supabase
    .from('profiles')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return true;
}


export async function setEmployeePassword(userId: string, newPassword: string, email: string) {
  if (!email) throw new Error('Email is required');
  if (!newPassword || newPassword.length < 6) throw new Error('Password must be at least 6 characters');

  try {
    // Call RPC function to set password
    // This stores a hashed password in the database for the employee to use
    const { data, error } = await supabase.rpc('set_employee_password_temp', {
      p_employee_id: userId,
      p_password: newPassword,
    });

    if (error) throw error;
    if (data && data[0]) {
      const result = data[0];
      if (!result.success) throw new Error(result.message);
      return result;
    }

    throw new Error('Failed to set password');
  } catch (err: any) {
    throw new Error(err.message || 'Failed to set password');
  }
}

export async function inviteEmployee({ email, full_name, role }: { email: string; full_name: string; role: AppRole }) {
  // Generate a temporary password
  const tempPassword = Math.random().toString(36).substring(2, 10) +
                       Math.random().toString(36).substring(2, 6) + 'A1!';

  try {
    // Get current owner session BEFORE any auth changes
    const { data: { session: ownerSession } } = await supabase.auth.getSession();
    if (!ownerSession) throw new Error('Not authenticated');

    // Sign up the new user
    // Note: Supabase requires email confirmation. The user will receive a confirmation email.
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email,
      password: tempPassword,
      options: {
        data: { full_name, role },
        emailRedirectTo: window.location.origin + '/login',
      },
    });

    if (signUpError) throw signUpError;
    if (!authData.user) throw new Error('Failed to create user');

    // Update the profile with email and role
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ email, role })
      .eq('id', authData.user.id);

    if (updateError) throw updateError;

    // Restore the owner session
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: ownerSession.access_token,
      refresh_token: ownerSession.refresh_token,
    });

    if (sessionError) throw sessionError;

    return {
      email,
      tempPassword,
      role,
      message: `Cashier invited successfully!\n\nSteps:\n1. Cashier will receive a confirmation email\n2. They click the confirmation link\n3. Then login with:\n\nEmail: ${email}\nPassword: ${tempPassword}\n\nAfter login, they can change their password.`,
    };
  } catch (err: any) {
    console.error('Failed to invite employee:', err);
    throw new Error(`Failed to invite employee: ${err.message}`);
  }
}
