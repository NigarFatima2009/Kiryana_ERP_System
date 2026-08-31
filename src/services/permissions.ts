import { supabase } from '../lib/supabase';

export interface PagePermission {
  id: string;
  role: string;
  page_path: string;
  page_label: string;
  enabled: boolean;
}

/** Fetch all page permissions for a role — always fresh, not cached */
export async function fetchPagePermissions(role: string): Promise<PagePermission[]> {
  const { data, error } = await supabase
    .from('page_permissions')
    .select('*')
    .eq('role', role)
    .order('page_path');
  if (error) throw error;
  return (data || []) as PagePermission[];
}

/** Update a single page permission */
export async function updatePagePermission(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('page_permissions')
    .update({ enabled })
    .eq('id', id);
  if (error) throw error;
}

/** Check if a page path is enabled for a role */
export async function isPageEnabled(role: string, pagePath: string): Promise<boolean> {
  // Owners always have access to everything
  if (role === 'OWNER') return true;

  const { data } = await supabase
    .from('page_permissions')
    .select('enabled')
    .eq('role', role)
    .eq('page_path', pagePath)
    .single();

  // If no permission record, default to enabled
  return data?.enabled ?? true;
}
