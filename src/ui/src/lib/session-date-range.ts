export type SessionTimeFilter = 'all' | 'today' | '7d' | '30d' | 'custom';
export interface SessionDateRange {
  from?: number;
  to?: number; // Exclusive: midnight after the selected final local calendar day.
  error?: 'dateRangeIncomplete' | 'dateRangeInvalid' | 'dateRangeReversed';
}

export function localDateInput(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseLocalDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function sessionDateRange(filter: SessionTimeFilter, start: string, end: string, now = Date.now()): SessionDateRange {
  if (filter === 'all') return {};
  if (filter === 'today') {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return { from: date.getTime() };
  }
  if (filter === '7d' || filter === '30d') return { from: now - (filter === '7d' ? 7 : 30) * 86_400_000 };
  if (!start || !end) return { error: 'dateRangeIncomplete' };
  const from = parseLocalDay(start);
  const through = parseLocalDay(end);
  if (!from || !through) return { error: 'dateRangeInvalid' };
  if (from > through) return { error: 'dateRangeReversed' };
  // Calendar arithmetic, rather than +24 hours, also covers DST transitions.
  through.setDate(through.getDate() + 1);
  return { from: from.getTime(), to: through.getTime() };
}
