import type { ContentItem, RawRecord } from './parser';

export type ResultMatch = 'exact' | 'missing' | 'ambiguous';
export interface LinkedToolResult {
  messageId: string;
  contentIndex: number | null;
  content: unknown;
  timestamp: number;
  durationMs: number | null;
  failed: boolean;
  aborted: boolean;
}
export interface LinkedToolCall {
  id: string;
  messageId: string;
  name: string;
  args: unknown;
  timestamp: number;
  dispatchTimestamp: number;
  userContext: string;
  match: ResultMatch;
  result: LinkedToolResult | null;
}

const failedStatuses = new Set(['error', 'failed', 'timeout', 'approval-unavailable']);
const stableJson = (value: unknown) => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function messageText(record: RawRecord): string {
  const content = record.message?.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content
    .filter(item => item?.type === 'text' && typeof item.text === 'string')
    .map(item => item.text).join('\n') : '';
}

/** User-shaped tool results and injected runtime context are not user prompts. */
export function isRuntimeUserMessage(record: RawRecord): boolean {
  if (record.message?.role !== 'user') return false;
  if (Object.prototype.hasOwnProperty.call(record, 'toolUseResult')) return true;
  const content = record.message.content;
  if (Array.isArray(content) && content.some(item => item?.type === 'tool_result')) return true;
  const text = messageText(record);
  return text.includes('runtime-generated, not user-authored') || text.includes('[Internal task completion event]');
}

export function toolContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(toolContentText).filter(Boolean).join('\n');
  if (content && typeof content === 'object') {
    const block = content as Record<string, unknown>;
    if (typeof block.text === 'string') return block.text;
    if ('content' in block) return toolContentText(block.content);
  }
  return '';
}

/** Resolve one transcript independently. Identity never depends on time or tool name. */
export function resolveToolCallLinks(input: RawRecord[]) {
  const records: RawRecord[] = [];
  const byId = new Map<string, RawRecord>();
  const signatures = new Map<string, Set<string>>();
  const variants = new Map<string, RawRecord[]>();
  const positions = new Map<string, number>();
  const conflicts = new Set<string>();
  for (const record of input) {
    if (!record || typeof record !== 'object') continue;
    if (typeof record.id !== 'string' || !record.id) { records.push(record); continue; }
    const signature = stableJson(record);
    const seen = signatures.get(record.id);
    if (seen) {
      if (!seen.has(signature)) {
        conflicts.add(record.id);
        seen.add(signature);
        variants.get(record.id)!.push(record);
      }
      // Retain the existing last-envelope usage/metadata behavior, but never
      // use a conflicting identity to select a tool result.
      records[positions.get(record.id)!] = record;
      byId.set(record.id, record);
      continue;
    }
    signatures.set(record.id, new Set([signature]));
    variants.set(record.id, [record]);
    positions.set(record.id, records.length);
    byId.set(record.id, record);
    records.push(record);
  }

  const calls: LinkedToolCall[] = [];
  const callsForMessage = new Map<string, LinkedToolCall[]>();
  const callsById = new Map<string, LinkedToolCall[]>();
  const callSignatures = new Map<LinkedToolCall, string>();
  const ambiguous = new Set<LinkedToolCall>();
  const results = new Map<LinkedToolCall, LinkedToolResult[]>();
  const contextCache = new Map<string, string>();
  const timestamp = (r: RawRecord) => r.message?.timestamp ?? Date.parse(r.timestamp);

  function userContext(record: RawRecord): string {
    const visited = new Set<string>([record.id]);
    const path: string[] = [];
    let context = '';
    let parent = record.parentId;
    while (typeof parent === 'string' && parent && !visited.has(parent) && !conflicts.has(parent)) {
      if (contextCache.has(parent)) { context = contextCache.get(parent)!; break; }
      visited.add(parent);
      const ancestor = byId.get(parent);
      if (!ancestor) break;
      path.push(parent);
      if (ancestor.message?.role === 'user' && !isRuntimeUserMessage(ancestor)) {
        context = messageText(ancestor).slice(0, 600);
        break;
      }
      parent = ancestor.parentId;
    }
    // Long tool-only runs share ancestor paths; don't traverse the whole
    // conversation again for every request.
    path.forEach(id => contextCache.set(id, context));
    return context;
  }

  for (const record of records) {
    if (record.type !== 'message' || typeof record.id !== 'string' || !record.id || record.message?.role !== 'assistant' || !Array.isArray(record.message.content)) continue;
    const owned = new Map<string, LinkedToolCall>();
    // Preserve the set of observed request identities across conflicting
    // envelopes; each remains visible but cannot claim an exact result.
    const content = variants.get(record.id)!.flatMap(variant =>
      variant.message?.role === 'assistant' && Array.isArray(variant.message.content) ? variant.message.content : []);
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      if ((item.type !== 'toolCall' && item.type !== 'tool_use') || typeof item.id !== 'string' || !item.id
        || typeof item.name !== 'string' || !item.name) continue;
      const args = Object.prototype.hasOwnProperty.call(item, 'arguments') ? item.arguments : item.input;
      const signature = stableJson({ name: item.name, args });
      const existing = owned.get(item.id);
      if (existing) {
        if (callSignatures.get(existing) !== signature) ambiguous.add(existing);
        continue;
      }
      const call: LinkedToolCall = {
        id: item.id, messageId: record.id, name: item.name, args,
        timestamp: timestamp(record), dispatchTimestamp: Date.parse(record.timestamp),
        userContext: userContext(record), match: 'missing', result: null,
      };
      if (conflicts.has(record.id)) ambiguous.add(call);
      callSignatures.set(call, signature);
      owned.set(call.id, call);
      calls.push(call);
      const candidates = callsById.get(call.id) ?? [];
      candidates.push(call);
      callsById.set(call.id, candidates);
    }
    callsForMessage.set(record.id, [...owned.values()]);
  }

  function owner(record: RawRecord, candidates: LinkedToolCall[]): LinkedToolCall | null {
    const visited = new Set<string>([record.id]);
    let parent = record.parentId;
    let invalidChain = conflicts.has(record.id) || (parent != null && typeof parent !== 'string');
    let incompleteChain = !parent;
    while (parent && !invalidChain) {
      if (visited.has(parent) || conflicts.has(parent)) { invalidChain = true; break; }
      visited.add(parent);
      const ancestor = byId.get(parent);
      if (!ancestor) { incompleteChain = true; break; }
      const candidate = candidates.find(call => call.messageId === parent);
      if (candidate) return candidate;
      parent = ancestor.parentId;
    }
    if (!invalidChain && incompleteChain && candidates.length === 1) return candidates[0];
    candidates.forEach(call => ambiguous.add(call));
    return null;
  }

  function addResult(record: RawRecord, id: string, contentIndex: number | null, content: unknown, item?: ContentItem) {
    const candidates = callsById.get(id);
    if (!candidates || typeof record.id !== 'string' || !record.id) return;
    const call = owner(record, candidates);
    if (!call) return;
    if (record.message?.toolName && record.message.toolName !== call.name) ambiguous.add(call);
    const detail = record.message?.details;
    const status = detail?.status;
    const modernDuration = (record.toolUseResult as { durationMs?: number } | undefined)?.durationMs;
    const duration = contentIndex === null ? detail?.durationMs : modernDuration;
    const result: LinkedToolResult = {
      messageId: record.id, contentIndex, content, timestamp: Number.isFinite(timestamp(record)) ? timestamp(record) : call.timestamp,
      durationMs: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : null,
      failed: contentIndex === null
        ? (typeof status === 'string' && failedStatuses.has(status)) || (status === undefined && Boolean(record.message?.isError))
        : Boolean(item?.is_error),
      aborted: status === 'running',
    };
    const matches = results.get(call) ?? [];
    matches.push(result);
    results.set(call, matches);
  }

  for (const envelope of records) {
    // Every version of a conflicting result can reference a different call.
    // Invalidate all those references instead of inspecting just the last one.
    for (const record of variants.get(envelope.id) ?? [envelope]) {
      if (record.type !== 'message' || !record.message) continue;
      const msg = record.message;
      if (msg.role === 'toolResult' && typeof msg.toolCallId === 'string') {
        addResult(record, msg.toolCallId, null, msg.content);
      } else if (msg.role === 'user' && Array.isArray(msg.content)) {
        msg.content.forEach((item, index) => {
          if (item && item.type === 'tool_result' && typeof item.tool_use_id === 'string') {
            addResult(record, item.tool_use_id, index, item.content, item);
          }
        });
      }
    }
  }

  for (const call of calls) {
    const matches = results.get(call) ?? [];
    call.match = ambiguous.has(call) || matches.length > 1 ? 'ambiguous' : matches.length === 1 ? 'exact' : 'missing';
    call.result = call.match === 'exact' ? matches[0] : null;
  }
  return { records, calls, callsForMessage };
}
