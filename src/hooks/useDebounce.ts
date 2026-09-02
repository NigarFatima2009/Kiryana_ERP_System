import { useEffect, useState } from 'react';

/**
 * Debounce hook - delays state updates to reduce API calls
 */
export function useDebounce<T>(value: T, delayMs: number = 500): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => clearTimeout(handler);
  }, [value, delayMs]);

  return debouncedValue;
}

/**
 * Debounce callback - delays function execution
 */
export function useDebounceCallback<T extends (...args: any[]) => any>(
  callback: T,
  delayMs: number = 500
): (...args: Parameters<T>) => void {
  const [timeoutId, setTimeoutId] = useState<ReturnType<typeof setTimeout> | null>(null);

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    const newTimeoutId = setTimeout(() => {
      callback(...args);
    }, delayMs);

    setTimeoutId(newTimeoutId);
  };
}
