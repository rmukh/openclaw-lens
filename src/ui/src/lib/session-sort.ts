export interface SortableSession {
  id: string;
  started_at: number;
  last_message_at: number | null;
  duration_ms: number;
  total_tokens: number;
  total_messages: number;
  total_cost: number;
  error_count: number;
  cache_read: number;
  input_tokens: number;
}

export function averageTokens(s: SortableSession): number {
  return s.total_messages > 0 ? s.total_tokens / s.total_messages : 0;
}

export type SessionSortField = 'last_active' | 'started' | 'duration' | 'avg_per_msg' | 'tokens' | 'cost' | 'errors' | 'cache_hit';
export type SortDirection = 'asc' | 'desc';

export function sortSessions<T extends SortableSession>(sessions: readonly T[], sort: SessionSortField, direction: SortDirection): T[] {
  const value = (s: T): number => {
    switch (sort) {
      case 'started': return s.started_at;
      case 'duration': return s.duration_ms || 0;
      case 'avg_per_msg': return averageTokens(s);
      case 'tokens': return s.total_tokens;
      case 'cost': return s.total_cost;
      case 'errors': return s.error_count;
      case 'cache_hit': {
        const total = (s.cache_read || 0) + (s.input_tokens || 0);
        return total > 0 ? (s.cache_read || 0) / total : 0;
      }
      default: return s.last_message_at ?? s.started_at;
    }
  };
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...sessions].sort((a, b) => multiplier * (value(a) - value(b)) || a.id.localeCompare(b.id));
}
