/**
 * Offline-First POS: Sync Queue Management
 */

import { getOfflineDB } from './db';
import type { SyncQueueItem, SyncOperationType } from './types';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function queueSyncOperation(params: {
  operation_type: SyncOperationType;
  entity_type: string;
  entity_id: string;
  client_transaction_id: string;
  payload: Record<string, unknown>;
}): Promise<string> {
  const db = getOfflineDB();
  const queueItem: SyncQueueItem = {
    id: generateUUID(),
    operation_type: params.operation_type,
    entity_type: params.entity_type,
    entity_id: params.entity_id,
    client_transaction_id: params.client_transaction_id,
    payload: params.payload,
    status: 'pending',
    attempt_count: 0,
    last_attempt_at: null,
    last_error: null,
    created_at: Date.now(),
    synced_at: null,
  };
  await db.syncQueue.add(queueItem);
  console.log(`[SyncQueue] Queued ${params.operation_type}: ${params.entity_id}`);
  return queueItem.id;
}

export async function getPendingOperations(): Promise<SyncQueueItem[]> {
  const db = getOfflineDB();
  return db.syncQueue.where('status').anyOf(['pending', 'failed']).sortBy('created_at');
}

export async function getOperationsForEntity(entityId: string): Promise<SyncQueueItem[]> {
  const db = getOfflineDB();
  return db.syncQueue.where('entity_id').equals(entityId).toArray();
}

export async function getOperationByClientId(clientId: string): Promise<SyncQueueItem | null> {
  const db = getOfflineDB();
  return (await db.syncQueue.where('client_transaction_id').equals(clientId).first()) ?? null;
}

export async function getQueueItem(id: string): Promise<SyncQueueItem | null> {
  const db = getOfflineDB();
  return (await db.syncQueue.get(id)) ?? null;
}

export async function markOperationSyncing(id: string): Promise<void> {
  const db = getOfflineDB();
  await db.syncQueue.update(id, { status: 'syncing', last_attempt_at: Date.now() });
}

export async function markOperationSynced(id: string): Promise<void> {
  const db = getOfflineDB();
  await db.syncQueue.update(id, { status: 'synced', synced_at: Date.now(), last_attempt_at: Date.now() });
}

export async function markOperationFailed(
  id: string,
  errorMessage: string,
  errorCode?: string
): Promise<void> {
  const db = getOfflineDB();
  const item = await db.syncQueue.get(id);
  await db.syncQueue.update(id, {
    status: 'failed',
    last_error: errorMessage,
    last_error_code: errorCode,
    last_attempt_at: Date.now(),
    attempt_count: (item?.attempt_count ?? 0) + 1,
  });
}

export async function markOperationConflict(id: string, conflictReason: string): Promise<void> {
  const db = getOfflineDB();
  const item = await db.syncQueue.get(id);
  await db.syncQueue.update(id, {
    status: 'conflict',
    conflict_reason: conflictReason,
    last_error: conflictReason,
    last_attempt_at: Date.now(),
    attempt_count: (item?.attempt_count ?? 0) + 1,
  });
}

export async function retryOperation(id: string): Promise<void> {
  const db = getOfflineDB();
  const item = await db.syncQueue.get(id);
  if (!item) return;
  if (item.attempt_count < 5) {
    await db.syncQueue.update(id, { status: 'pending', last_error: null });
  }
}

export async function removeQueueItem(id: string): Promise<void> {
  const db = getOfflineDB();
  await db.syncQueue.delete(id);
}

export async function clearSyncedOperations(): Promise<number> {
  const db = getOfflineDB();
  const synced = await db.syncQueue.where('status').equals('synced').toArray();
  await db.syncQueue.where('status').equals('synced').delete();
  return synced.length;
}

export async function clearAllOperations(): Promise<void> {
  const db = getOfflineDB();
  await db.syncQueue.clear();
}

export async function getSyncQueueStats(): Promise<{
  total: number;
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
  conflicts: number;
}> {
  const db = getOfflineDB();
  const [total, pending, syncing, synced, failed, conflicts] = await Promise.all([
    db.syncQueue.count(),
    db.syncQueue.where('status').equals('pending').count(),
    db.syncQueue.where('status').equals('syncing').count(),
    db.syncQueue.where('status').equals('synced').count(),
    db.syncQueue.where('status').equals('failed').count(),
    db.syncQueue.where('status').equals('conflict').count(),
  ]);
  return { total, pending, syncing, synced, failed, conflicts };
}

export async function getAverageRetries(): Promise<number> {
  const db = getOfflineDB();
  const items = await db.syncQueue.toArray();
  if (items.length === 0) return 0;
  const total = items.reduce((sum, i) => sum + i.attempt_count, 0);
  return Math.round((total / items.length) * 10) / 10;
}

export async function getMostCommonError(): Promise<string | null> {
  const db = getOfflineDB();
  const items = await db.syncQueue.where('status').equals('failed').toArray();
  if (items.length === 0) return null;
  const counts: Record<string, number> = {};
  items.forEach(i => {
    const e = i.last_error ?? 'Unknown';
    counts[e] = (counts[e] ?? 0) + 1;
  });
  return Object.entries(counts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;
}

export async function getStaleOperations(ageMs: number): Promise<SyncQueueItem[]> {
  const db = getOfflineDB();
  const cutoff = Date.now() - ageMs;
  const items = await db.syncQueue.toArray();
  return items.filter(i => i.created_at < cutoff && i.status !== 'synced');
}
