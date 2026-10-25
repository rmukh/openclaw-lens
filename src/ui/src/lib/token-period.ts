import { localDateInput, mondayStart, sessionDateRange } from './session-date-range';
import type { SessionDateRange } from './session-date-range';

export const TOKEN_PERIOD_OPTIONS = [
  ['p_1', 'tokenUsage.today'], ['this_week', 'tokenUsage.thisWeek'],
  ['p_7', 'tokenUsage.last7Days'], ['p_30', 'tokenUsage.last30Days'],
  ['p_90', 'tokenUsage.last90Days'], ['p_365', 'tokenUsage.allTime'],
  ['day', 'tokenUsage.byDay'], ['week', 'tokenUsage.byWeek'], ['custom', 'sessions.customRange'],
] as const;
export type TokenPeriodSelection = typeof TOKEN_PERIOD_OPTIONS[number][0];
export interface TokenPeriodValues {
  selection: TokenPeriodSelection;
  singleDay: string;
  weekEnd: string;
  customStart: string;
  customEnd: string;
}

export function tokenPeriodRange(values: TokenPeriodValues, now = Date.now()): SessionDateRange {
  const { selection } = values;
  if (selection === 'p_365') return {}; // All recorded history, without a rolling cutoff.
  if (selection === 'p_1') return sessionDateRange('today', '', '', now);
  if (selection === 'this_week') return { from: mondayStart(now) };
  if (selection === 'p_7' || selection === 'p_30' || selection === 'p_90') {
    return { from: now - Number(selection.slice(2)) * 86_400_000 };
  }
  if (selection === 'custom') return sessionDateRange('custom', values.customStart, values.customEnd);
  if (selection === 'day') return sessionDateRange('custom', values.singleDay, values.singleDay);
  const end = sessionDateRange('custom', values.weekEnd, values.weekEnd);
  if (end.error) return end;
  const start = new Date(end.from!);
  start.setDate(start.getDate() - 6);
  return sessionDateRange('custom', localDateInput(start.getTime()), values.weekEnd);
}

export function tokenPeriodQuery(range: SessionDateRange, format: 'timestamp' | 'iso'): string {
  const params = new URLSearchParams();
  // Explicit epoch start prevents the summary endpoint's default 30-day fallback.
  const from = format === 'iso' ? range.from ?? 0 : range.from;
  if (from !== undefined) params.set('from', format === 'iso' ? new Date(from).toISOString() : String(from));
  if (range.to !== undefined) params.set('to', format === 'iso' ? new Date(range.to).toISOString() : String(range.to));
  return params.size ? `?${params}` : '';
}
