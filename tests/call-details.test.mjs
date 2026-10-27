import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, rename, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true });
const { openDb, initSchema, ingestAll } = require('../src/server/db.ts');
const { callDetailsRouter } = require('../src/server/api/call-details.ts');
const express = require('express');
const sid = '00000000-0000-4000-8000-000000000001';
const record = (id, parentId, message) => ({ type: 'message', id, parentId, timestamp: '2026-10-28T12:00:00Z', message: { timestamp: 1793188800000, ...message } });
const user = record('u', null, { role: 'user', content: 'Run the Python skill.' });
const a = record('a', 'u', { role: 'assistant', model: 'test', content: [
  { type: 'text', text: 'Run the requested script.' },
  { type: 'toolCall', id: 'x', name: 'custom.python', arguments: { command: 'python report.py', note: 'line one\r\n\tline two', path: 'C:\\demo\\reports' } },
] });
const result = record('r', 'a', { role: 'toolResult', toolCallId: 'x', toolName: 'custom.python', content: [{ type: 'text', text: 'Z'.repeat(6000) }], details: { status: 'completed', exitCode: 0 } });
const records = [user, a, result];
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';

async function fixture(t, rows = records) {
  const home = await mkdtemp(path.join(tmpdir(), 'lens-inspector-'));
  const dir = path.join(home, 'agents', 'alpha', 'sessions');
  const file = path.join(dir, sid + '.jsonl');
  await mkdir(dir, { recursive: true });
  await writeFile(file, jsonl(rows));
  const db = openDb(':memory:');
  initSchema(db);
  assert.deepEqual((await ingestAll(db, { clawHome: home })).errors, []);
  const app = express();
  app.use('/api/debug', callDetailsRouter(db, home));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); await rm(home, { recursive: true, force: true }); });
  const get = async (section, query = {}) => {
    const params = new URLSearchParams({ agent: 'alpha', message: 'a', tool: 'x', section, ...query });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/debug/session/${sid}/call?${params}`);
    return { code: response.status, data: await response.json(), cacheControl: response.headers.get('cache-control') };
  };
  return { home, dir, file, db, get };
}

test('inspector returns full custom-tool payloads and preserves original strings, independently of audit coverage', async t => {
  const { get, db } = await fixture(t);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, 0);
  const args = await get('arguments');
  assert.equal(args.code, 200);
  assert.equal(args.cacheControl, 'no-store');
  assert.deepEqual(args.data.value, a.message.content[1].arguments);
  assert.equal((await get('result')).data.value[0].text.length, 6000);
  assert.deepEqual((await get('response')).data.value, a.message);
  const raw = (await get('raw')).data.value;
  assert.equal(raw.request.id, 'a');
  assert.equal(raw.result.id, 'r');
  const context = (await get('context')).data;
  assert.equal(context.source, 'recorded_context');
  assert.equal(context.value.messages.length, 1);
  assert.equal(context.value.messages[0].content, 'Run the Python skill.');
});

test('inspector validates scope and progressively bounds payloads without pretending a partial JSON value is complete', async t => {
  const { get } = await fixture(t);
  for (const query of [{ agent: '../alpha' }, { limit: '-1' }, { limit: '2097153' }]) assert.equal((await get('result', query)).code, 400);
  for (const query of [{ agent: 'other' }, { message: 'other' }, { tool: 'other' }]) assert.equal((await get('result', query)).code, 404);
  assert.equal((await get('bogus')).code, 400);
  const preview = (await get('result', { limit: '1024' })).data;
  assert.equal(preview.truncated, true);
  assert.equal(preview.value, undefined);
  assert.equal(preview.preview.length, 1024);
  const full = (await get('result', { limit: '8192' })).data;
  assert.equal(full.truncated, false);
  assert.equal(full.value[0].text.length, 6000);
});

test('missing/conflicting results never select a different result; conflicting request blocks do not select arguments', async t => {
  const { get, file } = await fixture(t);
  await writeFile(file, jsonl([user, a]));
  assert.equal((await get('result')).data.status, 'missing');
  const conflicting = structuredClone(result);
  conflicting.message.content[0].text = 'CONFLICT';
  await writeFile(file, jsonl([user, a, result, conflicting]));
  assert.equal((await get('result')).data.status, 'ambiguous');
  assert.equal((await get('result')).data.value, undefined);
  assert.equal((await get('arguments')).data.status, 'available');
  const changed = structuredClone(a);
  changed.message.content.push({ ...a.message.content[1], arguments: { command: 'different' } });
  await writeFile(file, jsonl([user, changed, result]));
  assert.equal((await get('arguments')).data.status, 'ambiguous');
  const envelope = structuredClone(a);
  envelope.message.model = 'revision';
  await writeFile(file, jsonl([user, a, envelope, result]));
  assert.equal((await get('response')).data.status, 'ambiguous');
});

test('modern result blocks are selected individually and live incomplete lines do not destroy complete records', async t => {
  const modern = structuredClone(a);
  modern.message.content = [{ type: 'tool_use', id: 'x', name: 'custom.python', input: { command: 'python x.py' } },
    { type: 'tool_use', id: 'y', name: 'custom.python', input: { command: 'python y.py' } }];
  const output = record('modern-result', 'a', { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'y', content: 'Y' },
    { type: 'tool_result', tool_use_id: 'x', content: [{ type: 'text', text: '{"nested":{"value":true}}' }], is_error: true },
  ] });
  const { get, file } = await fixture(t, [user, modern, output]);
  await writeFile(file, jsonl([user, modern, output]) + '{"type":');
  assert.deepEqual((await get('arguments')).data.value, { command: 'python x.py' });
  const data = (await get('result')).data;
  assert.equal(data.metadata.contentIndex, 1);
  assert.equal(data.metadata.failed, true);
  assert.equal(data.value[0].text, '{"nested":{"value":true}}');
});

test('archived and removed sources have explicit states; broken ancestry is marked incomplete', async t => {
  const { file, get } = await fixture(t);
  const orphan = structuredClone(a);
  orphan.parentId = 'missing';
  await writeFile(file, jsonl([orphan, result]));
  assert.equal((await get('context')).data.metadata.complete, false);
  await rename(file, file + '.deleted.2026-10-28');
  assert.equal((await get('response')).data.status, 'available');
  await writeFile(file + '.reset.other', jsonl(records));
  assert.equal((await get('response')).data.status, 'ambiguous');
  await rm(file + '.deleted.2026-10-28');
  await rm(file + '.reset.other');
  assert.equal((await get('response')).data.status, 'missing');
  await writeFile(file, '');
  await truncate(file, 33 * 1024 * 1024);
  assert.equal((await get('response')).data.status, 'too_large');
});

test('captured context requires a unique run, unique tool IDs, and an exact witnessed prefix, never a nearby timestamp', async t => {
  const { get, dir, home } = await fixture(t);
  const runtime = (type, data) => ({ traceSchema: 'openclaw-trajectory', schemaVersion: 1, sessionId: sid, runId: 'run', type, data });
  const events = [runtime('context.compiled', { transcriptLeafId: 'u', messages: [], systemPrompt: 'system', tools: [{ name: 'custom.python' }] }),
    runtime('model.completed', { messagesSnapshot: records.map(row => row.message) })];
  await writeFile(path.join(dir, sid + '.trajectory.jsonl'), jsonl(events));
  await mkdir(path.join(home, 'logs'));
  const cache = path.join(home, 'logs', 'cache-trace.jsonl');
  const step = { sessionId: sid, runId: 'run', seq: 7, ts: '1999-01-01', stage: 'stream:context', messages: [user.message], system: 'captured system' };
  await writeFile(cache, jsonl([step]));
  let context = (await get('context')).data;
  assert.equal(context.source, 'cache_trace');
  assert.equal(context.metadata.seq, 7);
  assert.equal(context.value.system, 'captured system');
  // A retry with the same prefix makes selection ambiguous.
  await writeFile(cache, jsonl([step, { ...step, seq: 8 }]));
  context = (await get('context')).data;
  assert.equal(context.source, 'recorded_context');
  // The earlier retry has a following context that does not witness the response;
  // it cannot be distinguished from a retry of the same input, so neither is exact.
  assert.equal(context.metadata.capturedInput, 'ambiguous');
  await writeFile(cache, jsonl([{ ...step, messages: [{ role: 'user', content: 'different' }] }]));
  context = (await get('context')).data;
  assert.equal(context.source, 'recorded_context');
  assert.equal(context.value.runContext.scope, 'run');
  assert.equal(context.value.runContext.systemPrompt, 'system');
});
