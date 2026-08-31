import { supabase } from '../lib/supabase';
import type { AuditLog, StoreSettings } from '../types/database';

export async function fetchAuditLogs(params?: { page?: number; pageSize?: number; entity_type?: string; user_id?: string }) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 30;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('audit_logs')
    .select('*, profiles!audit_logs_user_id_fkey(full_name, role)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params?.entity_type) query = query.eq('entity_type', params.entity_type);
  if (params?.user_id) query = query.eq('user_id', params.user_id);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: data as (AuditLog & { profiles: { full_name: string; role: string } | null })[], count: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) };
}

export async function createAuditLog(log: {
  action: string;
  entity_type: string;
  entity_id?: string;
  previous_value?: Record<string, unknown>;
  new_value?: Record<string, unknown>;
}) {
  const { user } = await import('../lib/auth').then((m) => {
    // We need user from supabase session
    return { user: null };
  });

  const { data: { user: currentUser } } = await supabase.auth.getUser();

  await supabase.from('audit_logs').insert({
    user_id: currentUser?.id || null,
    action: log.action,
    entity_type: log.entity_type,
    entity_id: log.entity_id || null,
    previous_value: log.previous_value || null,
    new_value: log.new_value || null,
  });
}

// Store Settings
export async function fetchStoreSettings() {
  const { data, error } = await supabase.from('store_settings').select('*').eq('id', true).single();
  if (error) return null;
  return data as StoreSettings;
}

export async function updateStoreSettings(updates: Partial<StoreSettings>) {
  const { data, error } = await supabase
    .from('store_settings')
    .update(updates)
    .eq('id', true)
    .select()
    .single();
  if (error) throw error;
  return data as StoreSettings;
}
