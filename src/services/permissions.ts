import { supabase } from '../lib/supabase';

export interface PagePermission {
  id: string;
  role: string;
  page_path: string;
  page_label: string;
  enabled: boolean;
}

export interface UserPermissionOverride {
  id: string;
  user_id: string;
  page_path: string;
  enabled: boolean;
}

export interface UserPagePermission extends PagePermission {
  isOverride?: boolean; // true if this permission is a user override, not role default
}

export interface ProfileUser {
  id: string;
  full_name: string;
  role: string;
  active: boolean;
}

/** Fetch all active users with a specific role */
export async function fetchUsersByRole(role: string): Promise<ProfileUser[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, active')
    .eq('role', role)
    .eq('active', true)
    .order('full_name');
  if (error) throw error;
  return (data || []) as ProfileUser[];
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

/** Fetch all page permissions for a specific user, merging role defaults with user overrides */
export async function fetchPagePermissionsForUser(userId: string, role: string): Promise<UserPagePermission[]> {
  // Fetch role-based permissions
  const rolePerms = await fetchPagePermissions(role);
  
  // Fetch user-specific overrides
  const { data: overrides, error: overrideError } = await supabase
    .from('user_permission_overrides')
    .select('*')
    .eq('user_id', userId)
    .order('page_path');
  
  if (overrideError) throw overrideError;

  // Create a map of overrides for quick lookup
  const overrideMap = new Map(
    (overrides || []).map((o: UserPermissionOverride) => [o.page_path, o])
  );

  // Merge: BOTH role AND individual must be enabled (AND logic)
  // Role OFF + Individual ON = Still OFF
  // Role ON + Individual OFF = Still OFF
  // Role ON + Individual ON (or no individual) = ON
  return rolePerms.map((perm) => {
    const override = overrideMap.get(perm.page_path);
    
    // If there's an individual permission override, check it
    // But role default acts as a base filter too
    const isEnabledByIndividual = override ? override.enabled : true;
    const finalEnabled = perm.enabled && isEnabledByIndividual; // BOTH must be true
    
    return {
      ...perm,
      id: override?.id || perm.id, // Use override ID if exists
      enabled: finalEnabled,
      isOverride: !!override, // Flag to show in UI that this has an override
    };
  });
}

/** Update a single role-based page permission */
export async function updatePagePermission(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('page_permissions')
    .update({ enabled })
    .eq('id', id);
  if (error) throw error;
}

/** Create or update a user permission override */
export async function updateUserPermissionOverride(
  userId: string,
  pagePath: string,
  enabled: boolean
): Promise<void> {
  // Try to insert; if it exists, update it instead
  const { error: insertError } = await supabase
    .from('user_permission_overrides')
    .insert({ user_id: userId, page_path: pagePath, enabled });

  if (insertError && insertError.code === '23505') {
    // Unique constraint violation — record exists, update it
    const { error: updateError } = await supabase
      .from('user_permission_overrides')
      .update({ enabled })
      .eq('user_id', userId)
      .eq('page_path', pagePath);
    if (updateError) throw updateError;
  } else if (insertError) {
    throw insertError;
  }
}

/** Delete a user permission override (reverts to role default) */
export async function deleteUserPermissionOverride(userId: string, pagePath: string): Promise<void> {
  const { error } = await supabase
    .from('user_permission_overrides')
    .delete()
    .eq('user_id', userId)
    .eq('page_path', pagePath);
  if (error) throw error;
}

/** Check if a page path is enabled for a user (merges role + overrides with AND logic) */
export async function isPageEnabledForUser(userId: string, role: string, pagePath: string): Promise<boolean> {
  // Owners always have access to everything
  if (role === 'OWNER') return true;

  // Check role permission first (must be ON)
  const { data: rolePerms } = await supabase
    .from('page_permissions')
    .select('enabled')
    .eq('role', role)
    .eq('page_path', pagePath)
    .single();

  // If role doesn't allow it, user can't see it
  if (rolePerms && !rolePerms.enabled) return false;

  // Role allows it, now check individual override (if any)
  const { data: override } = await supabase
    .from('user_permission_overrides')
    .select('enabled')
    .eq('user_id', userId)
    .eq('page_path', pagePath)
    .single();

  // If override exists and is disabled, deny access
  if (override && !override.enabled) return false;

  // Otherwise allow (role is ON and no individual restriction)
  return true;
}

/** Check if a page path is enabled for a role (legacy, for backwards compatibility) */
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
