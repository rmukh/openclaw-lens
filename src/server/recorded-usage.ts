import Database from 'better-sqlite3';

/** The same recorded assistant messages supply token totals and event counts. */
export function recordedMessageFilter(from?: number, to?: number, agent?: string) {
  const clauses = ["m.role = 'assistant'", "m.model NOT IN ('delivery-mirror', 'gateway-injected')", 'm.cost_total >= 0'];
  const params: (number | string)[] = [];
  if (from !== undefined) { clauses.push('m.timestamp >= ?'); params.push(from); }
  if (to !== undefined) { clauses.push('m.timestamp < ?'); params.push(to); }
  if (agent !== undefined) { clauses.push('m.agent_name = ?'); params.push(agent); }
  return { where: clauses.join(' AND '), params };
}

// Count children once per message, without multiplying its token/cost values.
// Use m.timestamp for the window: tool_calls.timestamp can be completion time.
export const TOOL_CALL_COUNT_SQL = `COALESCE(SUM((SELECT COUNT(*) FROM tool_calls tc WHERE tc.message_id = m.id)), 0)`;

export interface RecordedToolUsage {
  agent_name: string;
  tool_name: string;
  call_count: number;
}

export function recordedToolUsage(db: Database.Database, from?: number, to?: number, agent?: string): RecordedToolUsage[] {
  const { where, params } = recordedMessageFilter(from, to, agent);
  return db.prepare(`
    SELECT m.agent_name, tc.tool_name, COUNT(*) AS call_count
    FROM messages m JOIN tool_calls tc ON tc.message_id = m.id
    WHERE ${where}
    GROUP BY m.agent_name, tc.tool_name
    ORDER BY call_count DESC, tc.tool_name ASC, m.agent_name ASC
  `).all(...params) as RecordedToolUsage[];
}
