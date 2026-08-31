// Core API service with pagination and error handling
import { supabase } from '../lib/supabase';

export interface QueryOptions {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filters?: Record<string, any>;
  search?: string;
  searchFields?: string[];
}

export async function apiGet<T>(
  table: string,
  options?: QueryOptions
): Promise<{ data: T[]; count: number }> {
  let query = supabase.from(table).select('*', { count: 'exact' });

  // Filters
  if (options?.filters) {
    Object.entries(options.filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (typeof value === 'boolean') {
          query = query.eq(key, value);
        } else if (Array.isArray(value)) {
          query = query.in(key, value);
        } else {
          query = query.eq(key, value);
        }
      }
    });
  }

  // Search
  if (options?.search && options?.searchFields && options.searchFields.length > 0) {
    const searchFilter = options.searchFields
      .map(field => `${field}.ilike.%${options.search}%`)
      .join(',');
    query = query.or(searchFilter);
  }

  // Sorting
  if (options?.sortBy) {
    query = query.order(options.sortBy, { ascending: options?.sortOrder !== 'desc' });
  }

  // Pagination
  const pageSize = options?.pageSize || 50;
  const page = (options?.page || 1) - 1;
  query = query.range(page * pageSize, page * pageSize + pageSize - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  return { data: data || [], count: count || 0 };
}

export async function apiGetOne<T>(table: string, id: string): Promise<T | null> {
  const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }
  return data;
}

export async function apiInsert<T>(table: string, data: Partial<T>): Promise<T> {
  const { data: result, error } = await supabase.from(table).insert([data as any]).select().single();
  if (error) throw error;
  return result;
}

export async function apiUpdate<T>(table: string, id: string, data: Partial<T>): Promise<T> {
  const { data: result, error } = await supabase
    .from(table)
    .update(data as any)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function apiDelete(table: string, id: string): Promise<void> {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

export async function apiCall<T>(
  functionName: string,
  params?: Record<string, any>
): Promise<T> {
  const { data, error } = await supabase.rpc(functionName, params);
  if (error) throw error;
  return data;
}
