export function cn(...inputs: (string | false | null | undefined)[]): string {
  return inputs.filter(Boolean).join(' ');
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' && !date.endsWith('Z') && !date.includes('+')
    ? new Date(date + 'Z')
    : new Date(date);
  return d.toLocaleDateString('en-PK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Karachi',
  });
}

export function formatDateTime(date: string | Date): string {
  // Ensure UTC timestamps without Z suffix are treated as UTC, not local time
  const d = typeof date === 'string' && !date.endsWith('Z') && !date.includes('+')
    ? new Date(date + 'Z')
    : new Date(date);
  return d.toLocaleString('en-PK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Karachi',
  });
}

// Convert UTC timestamp to Pakistan time (UTC+5)
export function toPakistaniTime(date: string | Date): Date {
  const d = typeof date === 'string' && !date.endsWith('Z') && !date.includes('+')
    ? new Date(date + 'Z')
    : new Date(date);
  // Pakistan Standard Time is UTC+5, no DST
  const pakistaniTime = new Date(d.getTime() + (5 * 60 * 60 * 1000));
  return pakistaniTime;
}

// Get current time in Pakistan timezone
export function getPakistaniNow(): Date {
  const utcNow = new Date();
  return new Date(utcNow.getTime() + (5 * 60 * 60 * 1000));
}

// Format date in Pakistan timezone
export function formatDatePakistani(date: string | Date): string {
  const pakistaniDate = toPakistaniTime(date);
  const year = pakistaniDate.getUTCFullYear();
  const month = pakistaniDate.getUTCMonth();
  const day = pakistaniDate.getUTCDate();
  return new Date(year, month, day).toLocaleDateString('en-PK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Format datetime in Pakistan timezone
export function formatDateTimePakistani(date: string | Date): string {
  const pakistaniDate = toPakistaniTime(date);
  const year = pakistaniDate.getUTCFullYear();
  const month = pakistaniDate.getUTCMonth();
  const day = pakistaniDate.getUTCDate();
  const hours = String(pakistaniDate.getUTCHours()).padStart(2, '0');
  const minutes = String(pakistaniDate.getUTCMinutes()).padStart(2, '0');
  const dateObj = new Date(year, month, day);
  return dateObj.toLocaleDateString('en-PK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }) + ` ${hours}:${minutes}`;
}

export function generateOrderNumber(prefix: string): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}-${y}${m}${d}-${rand}`;
}

export function generateSKU(category: string, name: string): string {
  const catPart = category.slice(0, 3).toUpperCase();
  const namePart = name.slice(0, 3).toUpperCase();
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${catPart}-${namePart}-${rand}`;
}

export function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str;
}

export function classNames(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
