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

export function sortSessions<T extends SortableSession>(sessions: readonly T[], sort: string): T[] {
  const value = (s: T): number => {
    switch (sort) {
      case 'started_desc': case 'started_asc': return s.started_at;
      case 'duration_desc': case 'duration_asc': return s.duration_ms || 0;
      case 'avg_per_msg_desc': case 'avg_per_msg_asc': return averageTokens(s);
      case 'tokens': return s.total_tokens;
      case 'cost': return s.total_cost;
      case 'errors': return s.error_count;
      case 'cache_hit_asc': {
        const total = (s.cache_read || 0) + (s.input_tokens || 0);
        return total > 0 ? (s.cache_read || 0) / total : 0;
      }
      default: return s.last_message_at ?? s.started_at;
    }
  };
  const direction = sort.endsWith('_asc') ? 1 : -1;
  return [...sessions].sort((a, b) => direction * (value(a) - value(b)) || a.id.localeCompare(b.id));
}
