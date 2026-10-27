import { Router } from 'express';
import type { Database } from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { getClawHome } from '../paths';
import type { RawRecord } from '../parser';
import { resolveToolCallLinks } from '../tool-call-links';

type Obj = Record<string, any>;
type State = 'available' | 'missing' | 'ambiguous' | 'unreadable' | 'too_large';
const object = (value: unknown): value is Obj => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
class SourceError extends Error {
  constructor(public state: State) { super(state); }
}

/** Bound actual bytes read, including files appended after the initial stat. */
async function readJsonl(file: string): Promise<Obj[]> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of fs.createReadStream(file)) {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) throw new SourceError('too_large');
      chunks.push(chunk as Buffer);
    }
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable');
  }
  const records: Obj[] = [];
  const lines = Buffer.concat(chunks).toString('utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { const value: unknown = JSON.parse(lines[i]); if (object(value)) records.push(value); }
    catch { if (i !== lines.length - 1) throw new SourceError('unreadable'); }
  }
  return records;
}

async function sessionFile(home: string, agent: string, session: string): Promise<string> {
  const directory = path.join(home, 'agents', agent, 'sessions');
  let names: string[];
  try { names = await fs.promises.readdir(directory); } catch { throw new SourceError('missing'); }
  const active = session + '.jsonl';
  if (names.includes(active)) return path.join(directory, active);
  const archived = names.filter(name => name.startsWith(active + '.deleted.') || name.startsWith(active + '.reset.'));
  if (archived.length !== 1) throw new SourceError(archived.length ? 'ambiguous' : 'missing');
  return path.join(directory, archived[0]);
}

function contextBefore(records: RawRecord[], selected: RawRecord) {
  const byId = new Map<string, RawRecord[]>();
  for (const record of records) {
    if (typeof record.id !== 'string') continue;
    const variants = byId.get(record.id) ?? [];
    if (variants.length === 2) continue; // Two distinct envelopes already prove conflict.
    if (!variants.some(existing => canonical(existing) === canonical(record))) variants.push(record);
    byId.set(record.id, variants);
  }
  const messages: unknown[] = [];
  const ancestorIds = new Set<string>();
  let parent = selected.parentId;
  let complete = true;
  while (parent) {
    if (typeof parent !== 'string' || ancestorIds.has(parent) || parent === selected.id) { complete = false; break; }
    const variants = byId.get(parent);
    if (!variants || variants.length !== 1) { complete = false; break; }
    ancestorIds.add(parent);
    const record = variants[0];
    if (record.type === 'message' && record.message) messages.push({ id: record.id, ...record.message });
    if (record.type === 'compaction' || record.type === 'branch_summary') complete = false;
    parent = record.parentId;
  }
  return { messages: messages.reverse(), complete, ancestorIds };
}

const toolIds = (message: Obj | undefined): string[] => Array.isArray(message?.content)
  ? message.content.filter((block: unknown) => object(block) && ['toolCall', 'tool_use'].includes(block.type) && typeof block.id === 'string').map((block: Obj) => block.id) : [];

/** Link a step by unique tool IDs and an identical context prefix. Retried
 * contexts stay ambiguous. Time proximity is never evidence. */
async function capturedContext(home: string, file: string, session: string, selected: RawRecord, records: RawRecord[], ancestorIds: Set<string>) {
  const ids = toolIds(selected.message);
  const counts = new Map<string, number>();
  for (const record of resolveToolCallLinks(records).records) {
    if (record.message?.role === 'assistant') for (const id of toolIds(record.message)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const unique = ids.length > 0 && ids.every(id => counts.get(id) === 1);
  let trajectory: Obj[] = [];
  let traceState: State = 'missing';
  try { trajectory = await readJsonl(path.join(path.dirname(file), session + '.trajectory.jsonl')); }
  catch (error) { traceState = (error as SourceError).state ?? 'unreadable'; }
  trajectory = trajectory.filter(event => event.traceSchema === 'openclaw-trajectory' && event.schemaVersion === 1 && event.sessionId === session);
  const compiled = trajectory.filter(event => event.type === 'context.compiled' && typeof event.runId === 'string'
    && object(event.data) && ancestorIds.has(event.data.transcriptLeafId));
  // Initial history must not already contain the selected request.
  const runs = unique ? compiled.filter(event => Array.isArray(event.data.messages)
    && !event.data.messages.some((message: Obj) => toolIds(message).some(id => ids.includes(id)))
    && trajectory.some(end => end.type === 'model.completed' && end.runId === event.runId
      && Array.isArray(end.data?.messagesSnapshot) && end.data.messagesSnapshot.some((message: Obj) => ids.every(id => toolIds(message).includes(id))))) : [];
  const run = runs.length === 1 ? runs[0] : undefined;
  let cache: Obj[] = [];
  // Paths come from server configuration, never HTTP input.
  let cacheFile = process.env.OPENCLAW_CACHE_TRACE_FILE || path.join(home, 'logs', 'cache-trace.jsonl');
  if (!process.env.OPENCLAW_CACHE_TRACE_FILE) {
    try {
      const config = JSON.parse(await fs.promises.readFile(path.join(home, 'openclaw.json'), 'utf8'));
      if (typeof config.diagnostics?.cacheTrace?.filePath === 'string') cacheFile = config.diagnostics.cacheTrace.filePath;
    } catch { /* Use default with missing or JSON5 config. */ }
  }
  try { cache = await readJsonl(cacheFile); }
  catch (error) { traceState = (error as SourceError).state ?? 'unreadable'; }
  const matches: Obj[] = [];
  let duplicateInput = false;
  if (unique && run) {
    const steps = cache.filter(event => event.sessionId === session && event.runId === run.runId && event.stage === 'stream:context'
      && Number.isSafeInteger(event.seq) && Array.isArray(event.messages)).sort((a, b) => a.seq - b.seq);
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.messages.some((message: Obj) => ids.some(id => toolIds(message).includes(id)))) continue;
      const next = steps[i + 1]?.messages ?? trajectory.find(event => event.type === 'model.completed' && event.runId === run.runId)?.data?.messagesSnapshot;
      if (!Array.isArray(next)) continue;
      const index = next.findIndex((message: Obj) => message?.role === 'assistant' && ids.every(id => toolIds(message).includes(id)));
      if (index >= 0 && canonical(next.slice(0, index)) === canonical(step.messages)) {
        const fingerprint = (entry: Obj) => canonical({ system: entry.system, messages: entry.messages, options: entry.options });
        if (steps.filter(entry => fingerprint(entry) === fingerprint(step)).length > 1) duplicateInput = true;
        matches.push(step);
      }
    }
  }
  if (matches.length === 1 && !duplicateInput) return { source: 'cache_trace', value: {
    system: matches[0].system ?? null, messages: matches[0].messages, options: matches[0].options ?? null,
  }, metadata: { scope: 'step', runId: matches[0].runId, seq: matches[0].seq }, state: 'available' as State };
  return { source: 'recorded_context', state: duplicateInput || matches.length > 1 || runs.length > 1 ? 'ambiguous' as State : traceState,
    runContext: run ? { scope: 'run', runId: run.runId, systemPrompt: run.data.systemPrompt, prompt: run.data.prompt,
      messages: run.data.messages, tools: run.data.tools } : undefined };
}

export function callDetailsRouter(db: Database, clawHome?: string): Router {
  const router = Router();
  router.get('/session/:id/call', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { agent, message, tool, section = 'response', limit = '65536' } = req.query;
    const session = req.params.id;
    const limitChars = Number(limit);
    if (typeof agent !== 'string' || !/^[\w.-]+$/.test(agent) || ['.', '..'].includes(agent)
      || !/^[0-9a-f-]+$/i.test(session) || typeof message !== 'string' || !message || message.length > 512
      || (tool !== undefined && (typeof tool !== 'string' || !tool || tool.length > 512))
      || typeof section !== 'string' || !['arguments', 'result', 'response', 'context', 'raw'].includes(section)
      || typeof limit !== 'string' || !Number.isSafeInteger(limitChars) || limitChars < 1024 || limitChars > 2_097_152) {
      res.status(400).json({ error: 'Invalid call identity, section or size limit' }); return;
    }
    const owner = db.prepare("SELECT id FROM messages WHERE id = ? AND session_id = ? AND agent_name = ? AND role = 'assistant'").get(message, session, agent);
    if (!owner || (tool && !db.prepare('SELECT id FROM tool_calls WHERE id = ? AND message_id = ? AND session_id = ? AND agent_name = ?').get(tool, message, session, agent))) {
      res.status(404).json({ error: 'Call not found' }); return;
    }
    const identity = { session, agent, message, tool: tool ?? null };
    const send = (status: State, source = 'transcript', value?: unknown, metadata?: unknown) => {
      const serialized = value === undefined ? '' : JSON.stringify(value);
      const truncated = serialized.length > limitChars;
      res.json({ identity, section, status, source, metadata, characters: serialized.length, limit: limitChars, truncated,
        ...(truncated ? { preview: serialized.slice(0, limitChars) } : value === undefined ? {} : { value }) });
    };
    try {
      const home = clawHome || getClawHome();
      const file = await sessionFile(home, agent, session);
      const records = await readJsonl(file) as RawRecord[];
      const variants = records.filter(record => record.type === 'message' && record.id === message);
      if (!variants.length) { send('missing'); return; }
      if (new Set(variants.map(canonical)).size !== 1) { send('ambiguous'); return; }
      const selected = variants[0];
      if (selected.message?.role !== 'assistant') { send('ambiguous'); return; }
      const links = resolveToolCallLinks(records);
      const call = tool ? links.calls.find(call => call.messageId === message && call.id === tool) : undefined;
      if (tool && !call) { send('missing'); return; }
      const blocks = tool && Array.isArray(selected.message.content) ? selected.message.content.filter(block =>
        block && ['toolCall', 'tool_use'].includes(block.type) && block.id === tool) : [];
      const requestConflict = new Set(blocks.map(block => canonical({ name: block.name,
        args: Object.prototype.hasOwnProperty.call(block, 'arguments') ? block.arguments : block.input }))).size > 1;
      if (section === 'arguments') { send(requestConflict ? 'ambiguous' : call ? 'available' : 'missing', 'transcript', requestConflict ? undefined : call?.args ?? null); return; }
      if (section === 'result') {
        send(call?.match === 'exact' ? 'available' : call?.match ?? 'missing', 'transcript', call?.result?.content,
          call?.result ? { messageId: call.result.messageId, contentIndex: call.result.contentIndex, failed: call.result.failed, unfinished: call.result.aborted } : undefined); return;
      }
      if (section === 'response') { send('available', 'transcript', selected.message); return; }
      if (section === 'raw') {
        const result = call?.result ? links.records.find(record => record.id === call.result!.messageId) : undefined;
        send('available', 'transcript', { request: selected, ...(call ? { toolCallId: call.id, resultMatch: call.match, result: result ?? null } : {}) }); return;
      }
      const context = contextBefore(records, selected);
      const captured = await capturedContext(home, file, session, selected, records, context.ancestorIds)
        .catch(() => ({ source: 'recorded_context', state: 'unreadable' as State, value: undefined, metadata: undefined, runContext: undefined }));
      if (captured.source === 'cache_trace') send('available', 'cache_trace', captured.value, captured.metadata);
      else send('available', 'recorded_context', { messages: context.messages, ...(captured.runContext ? { runContext: captured.runContext } : {}) },
        { complete: context.complete, capturedInput: captured.state });
    } catch (error) { send(error instanceof SourceError ? error.state : 'unreadable'); }
  });
  return router;
}
