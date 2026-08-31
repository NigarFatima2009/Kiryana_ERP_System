import { supabase } from '../lib/supabase';
import type { Profile, AppRole } from '../types/database';

export async function fetchEmployees() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['OWNER', 'MANAGER', 'CASHIER'])
    .eq('active', true)
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
  const tempPassword = Math.random().toString(36).substring(2, 10) +
                       Math.random().toString(36).substring(2, 6) + 'A1!';

  try {
    // Create profile directly in the database
    const { data, error: profileError } = await supabase
      .from('profiles')
      .insert({
        full_name,
        email,
        role,
        active: true,
      })
      .select()
      .single();

    if (profileError) {
      if (profileError.code === '23505') {
        throw new Error('An employee with this name already exists');
      }
      throw profileError;
    }

    return {
      id: data?.id,
      email,
      tempPassword,
      role,
      full_name,
      message: `Cashier added!\n\nTo let them login, create their auth account:\n1. Go to Supabase Dashboard → Authentication → Users\n2. Click 'Add user'\n3. Email: ${email}\n4. Password: ${tempPassword}\n5. Click Save\n\nShare these credentials:\nEmail: ${email}\nPassword: ${tempPassword}`,
    };
  } catch (err: any) {
    console.error('Failed to invite employee:', err);
    throw new Error(err.message || 'Failed to invite employee');
  }
}
