import { CLOSED_STOP_REASONS } from './parser';

const STALE_AFTER_MS = 10 * 60_000;
export interface ActivityMessage {
  role: string;
  stop_reason: string | null;
  timestamp: number;
}
export interface SessionActivity {
  state: 'in_progress' | 'idle' | 'unknown';
  reason: 'turn_closed' | 'pending_reply' | 'tool_use' | 'stale' | 'unavailable';
}

/** Describes the latest recorded turn, never the lifetime of a TUI process.
 * Missing/stale evidence must not be reported as an exit or a completed turn.
 */
export function sessionActivity(message: ActivityMessage | null, lastToolAt: number | null = null, now = Date.now()): SessionActivity {
  if (!message || !Number.isFinite(message.timestamp) || message.timestamp > now + 60_000) {
    return { state: 'unknown', reason: 'unavailable' };
  }
  if (message.role === 'assistant' && CLOSED_STOP_REASONS.has(message.stop_reason || '')) {
    return { state: 'idle', reason: 'turn_closed' };
  }
  const pending = message.role === 'user' || (message.role === 'assistant' && message.stop_reason === 'toolUse');
  if (!pending) return { state: 'unknown', reason: 'unavailable' };
  const lastActivity = lastToolAt !== null && Number.isFinite(lastToolAt) && lastToolAt <= now + 60_000
    ? Math.max(message.timestamp, lastToolAt) : message.timestamp;
  if (now - lastActivity >= STALE_AFTER_MS) return { state: 'unknown', reason: 'stale' };
  return { state: 'in_progress', reason: message.role === 'user' ? 'pending_reply' : 'tool_use' };
}
