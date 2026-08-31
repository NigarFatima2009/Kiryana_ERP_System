/**
 * Offline Mutation Queue
 * 
 * When the user is offline, mutations are queued in localStorage.
 * When back online, they are replayed in order.
 * 
 * Each queued item: { id, table, operation, data, timestamp }
 */

const QUEUE_KEY = 'erp_offline_queue';
const MAX_QUEUE_SIZE = 50;

export interface QueuedMutation {
  id: string;
  table: string;
  operation: 'insert' | 'update' | 'delete';
  data: Record<string, unknown>;
  filter?: Record<string, unknown>;
  timestamp: number;
  retries: number;
}

function generateId(): string {
  return `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Get all queued mutations from localStorage */
export function getQueuedMutations(): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Save the queue to localStorage */
function saveQueue(queue: QueuedMutation[]): void {
  // Limit queue size to prevent localStorage overflow
  const trimmed = queue.slice(-MAX_QUEUE_SIZE);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
}

/** Add a mutation to the offline queue */
export function queueMutation(
  table: string,
  operation: 'insert' | 'update' | 'delete',
  data: Record<string, unknown>,
  filter?: Record<string, unknown>
): string {
  const id = generateId();
  const mutation: QueuedMutation = {
    id,
    table,
    operation,
    data,
    filter,
    timestamp: Date.now(),
    retries: 0,
  };

  const queue = getQueuedMutations();
  queue.push(mutation);
  saveQueue(queue);

  console.log(`[OfflineQueue] Queued ${operation} on ${table} (${id})`);
  return id;
}

/** Remove a mutation from the queue */
export function removeMutation(id: string): void {
  const queue = getQueuedMutations().filter((m) => m.id !== id);
  saveQueue(queue);
}

/** Update retry count for a mutation */
export function incrementRetry(id: string): void {
  const queue = getQueuedMutations().map((m) =>
    m.id === id ? { ...m, retries: m.retries + 1 } : m
  );
  saveQueue(queue);
}

/** Clear all queued mutations */
export function clearQueue(): void {
  localStorage.removeItem(QUEUE_KEY);
}

/** Get the number of pending mutations */
export function getQueueSize(): number {
  return getQueuedMutations().length;
}
