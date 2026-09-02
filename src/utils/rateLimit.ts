/**
 * Rate limiting utility for bulk operations
 * Adds delay between operations to prevent overwhelming the database
 */

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute async operations with rate limiting
 * @param operations Array of async functions to execute
 * @param delayMs Delay between operations in milliseconds (default: 50ms)
 */
export async function rateLimitedBatch<T>(
  operations: Array<() => Promise<T>>,
  delayMs: number = 50
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < operations.length; i++) {
    if (i > 0) {
      await sleep(delayMs);
    }
    results.push(await operations[i]());
  }
  return results;
}

/**
 * Process array with rate limiting
 * @param items Array of items to process
 * @param processor Async function to process each item
 * @param delayMs Delay between operations in milliseconds (default: 50ms)
 */
export async function processWithRateLimit<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  delayMs: number = 50
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0) {
      await sleep(delayMs);
    }
    results.push(await processor(items[i], i));
  }
  return results;
}
