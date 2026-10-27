import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true });
const { resolveToolCallLinks } = require('../src/server/tool-call-links.ts');
const { parseSessionFile } = require('../src/server/parser.ts');
const { openDb, initSchema, ingestAll } = require('../src/server/db.ts');
const { ingestAuditEvents } = require('../src/server/audit/audit-parser.ts');
const debugRouter = require('../src/server/api/debug.ts').default;
const express = require('express');
const at = Date.UTC(2026, 9, 27, 12);
const record = (id, parentId, message, offset = 0) => ({ type: 'message', id, parentId,
  timestamp: new Date(at + offset + (message.role === 'assistant' ? 100 : 0)).toISOString(), message: { ...message, timestamp: at + offset } });
const request = (id, toolId = 'call', args = { command: 'echo example' }, parent = null, offset = 0) =>
  record(id, parent, { role: 'assistant', model: 'demo-model', stopReason: 'toolUse',
    usage: { input: 100, output: 10, totalTokens: 110, cost: { total: 0.01 } },
    content: [{ type: 'toolCall', id: toolId, name: 'exec', arguments: args }] }, offset);
const result = (id, toolId = 'call', parent = null, text = 'result', offset = 1000, status = 'completed') =>
  record(id, parent, { role: 'toolResult', toolCallId: toolId, toolName: 'exec',
    details: { status, durationMs: 700 }, content: [{ type: 'text', text }] }, offset);

test('parallel same-name tools pair by IDs despite identical timestamps, reversed results and long delays', () => {
  const a = request('a', 'one');
  a.message.content.push({ type: 'toolCall', id: 'two', name: 'exec', arguments: { command: 'echo two' } });
  const { calls } = resolveToolCallLinks([a, result('r2', 'two', 'a', 'TWO', 90000), result('r1', 'one', 'r2', 'ONE', 90000)]);
  assert.deepEqual(calls.map(call => [call.id, call.match, call.result.messageId, call.result.content[0].text]),
    [['one', 'exact', 'r1', 'ONE'], ['two', 'exact', 'r2', 'TWO']]);
});

test('reused call IDs resolve to the nearest originating assistant ancestor on their branch', () => {
  const a = request('a', 'reused');
  const b = request('b', 'reused', { command: 'echo b' }, 'a');
  const { calls } = resolveToolCallLinks([a, b, result('ra', 'reused', 'a', 'A'), result('rb', 'reused', 'b', 'B')]);
  assert.deepEqual(calls.map(call => [call.messageId, call.match, call.result.messageId]), [['a', 'exact', 'ra'], ['b', 'exact', 'rb']]);
});

test('results can precede their call in the file; a unique ID works when ancestry is absent or incomplete', () => {
  for (const parent of [null, 'missing-parent']) {
    const { calls } = resolveToolCallLinks([result('r', 'call', parent), request('a')]);
    assert.equal(calls[0].match, 'exact');
    assert.equal(calls[0].result.messageId, 'r');
  }
});

test('reused IDs without ancestry, cyclic parents and conflicting parent records never guess', () => {
  for (const extra of [[], [record('loop1', 'loop2', { role: 'user', content: [] }), record('loop2', 'loop1', { role: 'user', content: [] })],
    [record('conflict', null, { role: 'user', content: [] }), record('conflict', 'other', { role: 'user', content: [] })]]) {
    const parent = extra[0]?.id ?? null;
    const { calls } = resolveToolCallLinks([request('a'), request('b'), ...extra, result('r', 'call', parent)]);
    assert.ok(calls.every(call => call.match === 'ambiguous' && call.result === null));
  }
  const unrelated = record('other-branch', null, { role: 'user', content: [] });
  assert.equal(resolveToolCallLinks([request('a'), unrelated, result('r', 'call', unrelated.id)]).calls[0].match, 'ambiguous');
});

test('identical records and repeated request blocks deduplicate; conflicting requests/results stay ambiguous', () => {
  const a = request('a');
  const r = result('r', 'call', 'a');
  assert.equal(resolveToolCallLinks([a, structuredClone(a), r, structuredClone(r)]).calls.length, 1);
  assert.equal(resolveToolCallLinks([a, structuredClone(a), r, structuredClone(r)]).calls[0].match, 'exact');
  const repeatedBlock = structuredClone(a);
  repeatedBlock.message.content.push(structuredClone(a.message.content[0]));
  assert.equal(resolveToolCallLinks([repeatedBlock, r]).calls.length, 1);
  for (const records of [
    [a, request('a', 'call', { command: 'different' }), r],
    [a, r, result('r', 'call', 'a', 'conflicting')],
    [a, r, result('another-result', 'call', 'a')],
  ]) {
    const call = resolveToolCallLinks(records).calls[0];
    assert.equal(call.match, 'ambiguous');
    assert.equal(call.result, null);
  }
  const differentName = structuredClone(r);
  differentName.message.toolName = 'read';
  assert.equal(resolveToolCallLinks([a, differentName]).calls[0].match, 'ambiguous');
  const revision = request('a', 'second');
  revision.message.usage.totalTokens = 220;
  const revised = resolveToolCallLinks([a, revision, r]);
  assert.equal(revised.records[0].message.usage.totalTokens, 220);
  assert.deepEqual(revised.calls.map(call => [call.id, call.match]), [['call', 'ambiguous'], ['second', 'ambiguous']]);
});

test('modern tool_use.input and multiple tool_result blocks retain their individual identities and inputs', () => {
  const a = request('a');
  a.message.content = [{ type: 'tool_use', id: 'x', name: 'exec', input: { command: 'x' } },
    { type: 'tool_use', id: 'y', name: 'exec', input: { command: 'y' }, arguments: { command: 'preferred' } }];
  const r = record('r', 'a', { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'y', content: [{ type: 'text', text: 'Y' }], is_error: true },
    { type: 'tool_result', tool_use_id: 'x', content: 'X' },
  ] }, 1000);
  const { calls } = resolveToolCallLinks([a, r]);
  assert.deepEqual(calls.map(call => [call.id, call.args.command, call.match, call.result.contentIndex, call.result.failed]),
    [['x', 'x', 'exact', 1, false], ['y', 'preferred', 'exact', 0, true]]);
});

test('conflicting result envelopes invalidate every referenced call, not just the last envelope', () => {
  const calls = resolveToolCallLinks([
    request('a', 'x'), request('b', 'y'), result('known-x', 'x', 'a'),
    result('conflict', 'x', 'a'), result('conflict', 'y', 'b'),
  ]).calls;
  assert.deepEqual(calls.map(call => [call.id, call.match, call.result]), [['x', 'ambiguous', null], ['y', 'ambiguous', null]]);
});

test('malformed record IDs and null content blocks do not prevent valid calls from being ingested', async t => {
  const { home, db, write } = await fixture(t);
  const malformed = request(42, 'invalid');
  const user = record('user', null, { role: 'user', content: [null, { type: 'text', text: 'hello' }] });
  await write([null, malformed, user, request('a', 'call', {}, 'user'), result('r', 'call', 'a')]);
  assert.deepEqual((await ingestAll(db, { clawHome: home })).errors, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tool_calls').get().n, 1);
  assert.equal(db.prepare('SELECT result_match FROM tool_calls').get().result_match, 'exact');
});

test('runtime user-shaped tool messages cannot become the user prompt for audit context', () => {
  const real = record('real', null, { role: 'user', content: 'Actual user request' });
  const injected = record('injected', 'real', { role: 'user', content: [{ type: 'text', text: 'Untrusted tool output' }] });
  injected.toolUseResult = { durationMs: 10 };
  const runtime = record('runtime', 'injected', { role: 'user', content: [{ type: 'text', text: '[Internal task completion event] runtime-generated, not user-authored' }] });
  const [call] = resolveToolCallLinks([real, injected, runtime, request('a', 'call', {}, 'runtime')]).calls;
  assert.equal(call.userContext, 'Actual user request');
});

async function fixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'claw-id-links-'));
  const db = openDb(':memory:');
  initSchema(db);
  const id = '00000000-0000-4000-8000-000000000001';
  const directory = path.join(home, 'agents', 'alpha', 'sessions');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, id + '.jsonl');
  t.after(async () => { db.close(); await rm(home, { recursive: true, force: true }); });
  const write = records => writeFile(file, records.map(row => JSON.stringify(row)).join('\n') + '\n');
  return { home, db, id, file, write };
}

test('parser and audit ingestion share exact links and preserve token totals on re-ingestion', async t => {
  const { home, db, file, write } = await fixture(t);
  const a = request('a', 'reused', { command: 'echo alpha' });
  const b = request('b', 'reused', { command: 'sudo echo beta' });
  await write([a, b, result('rb', 'reused', 'b', 'BETA', 70000, 'error'), result('ra', 'reused', 'a', 'ALPHA', 90000), request('pending', 'pending')]);
  const parsed = parseSessionFile(file);
  assert.deepEqual(parsed.toolCalls.map(call => [call.messageId, call.resultMatch, call.resultMessageId, call.resultOutcome]),
    [['a', 'exact', 'ra', 'success'], ['b', 'exact', 'rb', 'failure'], ['pending', 'missing', null, 'unknown']]);
  assert.equal(parsed.toolCalls[2].durationMs, null);
  assert.deepEqual((await ingestAll(db, { clawHome: home })).errors, []);
  const events = db.prepare('SELECT * FROM audit_events ORDER BY message_id').all();
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(e => [e.message_id, e.tool_call_id, e.result_message_id, e.raw_output]),
    [['a', 'reused', 'ra', 'ALPHA'], ['b', 'reused', 'rb', 'BETA']]);
  assert.equal(JSON.parse(events[0].raw_input).command, 'echo alpha');
  assert.equal(JSON.parse(events[1].raw_input).command, 'sudo echo beta');
  assert.ok(events[1].risk_score > events[0].risk_score);
  db.exec('DELETE FROM ingest_state');
  assert.deepEqual((await ingestAll(db, { clawHome: home })).errors, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tool_calls').get().n, 3);
  assert.equal(db.prepare('SELECT SUM(total_tokens) AS n FROM messages').get().n, 330);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, 2);
});

test('modern inputs/results are audited by ID; unknown/running results do not fabricate outcomes', async t => {
  const { home, db, write } = await fixture(t);
  const a = request('modern');
  a.message.content = [{ type: 'tool_use', id: 'x', name: 'exec', input: { command: 'echo modern' } }];
  await write([a, record('modern-result', 'modern', { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'x', content: 'MODERN', is_error: true },
  ] }, 2000), request('running', 'running'), result('running-result', 'running', 'running', 'still running', 3000, 'running')]);
  assert.deepEqual((await ingestAll(db, { clawHome: home })).errors, []);
  const modern = db.prepare("SELECT * FROM tool_calls WHERE id = 'x'").get();
  assert.equal(JSON.parse(modern.arguments).command, 'echo modern');
  assert.equal(modern.result_match, 'exact');
  assert.equal(modern.result_outcome, 'failure');
  assert.equal(db.prepare("SELECT raw_output FROM audit_events WHERE tool_call_id = 'x'").get().raw_output, 'MODERN');
  assert.equal(db.prepare("SELECT result_outcome FROM tool_calls WHERE id = 'running'").get().result_outcome, 'unknown');
});

test('audit failure rolls back the whole file and leaves its ingestion state retryable', async t => {
  const { home, db, write } = await fixture(t);
  await write([request('a', 'call', { command: 'old' }), result('r', 'call', 'a', 'OLD')]);
  assert.deepEqual((await ingestAll(db, { clawHome: home })).errors, []);
  const before = db.prepare('SELECT * FROM ingest_state').get();
  db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit failure fixture'); END;");
  await write([request('a', 'call', { command: 'new command with changed data' }), result('r', 'call', 'a', 'NEW')]);
  const failed = await ingestAll(db, { clawHome: home });
  assert.ok(failed.errors.length > 0);
  assert.equal(failed.filesProcessed, 0);
  assert.equal(JSON.parse(db.prepare('SELECT arguments FROM tool_calls').get().arguments).command, 'old');
  assert.equal(db.prepare('SELECT raw_output FROM audit_events').get().raw_output, 'OLD');
  assert.deepEqual(db.prepare('SELECT * FROM ingest_state').get(), before);
  db.exec('DROP TRIGGER fail_audit');
  const retried = await ingestAll(db, { clawHome: home });
  assert.deepEqual(retried.errors, []);
  assert.equal(retried.filesProcessed, 1);
  assert.equal(JSON.parse(db.prepare('SELECT arguments FROM tool_calls').get().arguments).command, 'new command with changed data');
  assert.equal(db.prepare('SELECT raw_output FROM audit_events').get().raw_output, 'NEW');
});

test('a file changing during ingestion cannot mix tool data and audit output from different snapshots', async t => {
  const { home, db, file, write } = await fixture(t);
  await write([request('a', 'call', { command: 'old' }), result('r', 'call', 'a', 'OLD')]);
  const fsSync = require('node:fs');
  const read = fsSync.readFileSync;
  let changed = false;
  t.mock.method(fsSync, 'readFileSync', function (filename, ...args) {
    const contents = read.call(this, filename, ...args);
    if (typeof filename === 'string' && path.resolve(filename) === file && !changed) {
      changed = true;
      fsSync.writeFileSync(file, [request('a', 'call', { command: 'new snapshot with different length' }), result('r', 'call', 'a', 'NEW')]
        .map(row => JSON.stringify(row)).join('\n') + '\n');
    }
    return contents;
  });
  assert.deepEqual((await ingestAll(db, { clawHome: home })).errors, []);
  assert.equal(changed, true);
  assert.equal(JSON.parse(db.prepare('SELECT arguments FROM tool_calls').get().arguments).command, 'old');
  assert.equal(db.prepare('SELECT raw_output FROM audit_events').get().raw_output, 'OLD');
  assert.equal((await ingestAll(db, { clawHome: home })).filesProcessed, 1);
  assert.equal(db.prepare('SELECT raw_output FROM audit_events').get().raw_output, 'NEW');
});

test('re-ingestion updates a corrected tool name rather than pairing new audit data with an old label', async t => {
  const { home, db, write } = await fixture(t);
  await write([request('a'), result('r', 'call', 'a')]);
  assert.deepEqual((await ingestAll(db, { clawHome: home })).errors, []);
  const corrected = request('a', 'call', { path: '/tmp/example' });
  corrected.message.content[0].name = 'read';
  const correctedResult = result('r', 'call', 'a', 'file content');
  correctedResult.message.toolName = 'read';
  await write([corrected, correctedResult]);
  assert.deepEqual((await ingestAll(db, { clawHome: home })).errors, []);
  assert.equal(db.prepare('SELECT tool_name FROM tool_calls').get().tool_name, 'read');
  assert.equal(db.prepare('SELECT tool_name FROM audit_events').get().tool_name, 'read');
});

test('timeline requires all identity fields and refuses duplicate, stale, legacy and cross-agent audit matches', async t => {
  const { home, db, id, write } = await fixture(t);
  await write([request('a'), result('r', 'call', 'a', 'CORRECT', 90000), request('pending', 'pending')]);
  assert.deepEqual((await ingestAll(db, { clawHome: home })).errors, []);
  const app = express();
  app.use('/api/debug', debugRouter(db));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const get = async () => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/debug/session/${id}/timeline`);
    assert.equal(response.status, 200);
    return (await response.json()).turns.flatMap(turn => turn.tool_calls);
  };
  let tools = await get();
  assert.equal(tools[0].raw_output, 'CORRECT');
  assert.equal(tools[0].result_match, 'exact');
  assert.equal(tools[0].audit_match, 'exact');
  assert.equal(tools[0].message_id, 'a');
  assert.equal(tools[0].result_message_id, 'r');
  assert.equal(tools[1].success, null);
  // Misleading timestamps do not affect exact pairing.
  db.prepare('UPDATE audit_events SET timestamp = ?').run(at - 86400000);
  assert.equal((await get())[0].raw_output, 'CORRECT');
  const original = db.prepare('SELECT * FROM audit_events').get();
  const duplicate = db.prepare(`INSERT INTO audit_events (session_id, agent_id, timestamp, event_type, tool_name, tool_call_id, message_id, result_message_id, raw_output)
    VALUES (?, ?, ?, 'shell_command', 'exec', ?, ?, ?, ?)`);
  duplicate.run(id, 'other-agent', at, 'call', 'a', 'r', 'WRONG AGENT');
  assert.equal((await get())[0].raw_output, 'CORRECT');
  db.exec("INSERT INTO sessions (id, agent_name, started_at, ended_at) VALUES ('other-session', 'alpha', 1, 2)");
  duplicate.run('other-session', 'alpha', at, 'call', 'a', 'r', 'WRONG SESSION');
  assert.equal((await get())[0].raw_output, 'CORRECT');
  duplicate.run(id, 'alpha', at, null, null, null, 'LEGACY');
  assert.equal((await get())[0].raw_output, 'CORRECT');
  duplicate.run(id, 'alpha', at, 'call', 'a', 'r', 'DUPLICATE');
  tools = await get();
  assert.equal(tools[0].audit_match, 'ambiguous');
  assert.equal(tools[0].raw_input, null);
  assert.equal(tools[0].raw_output, null);
  assert.equal(tools[0].risk_score, null);
  db.prepare('DELETE FROM audit_events WHERE id != ?').run(original.id);
  db.prepare("UPDATE audit_events SET result_message_id = 'stale'").run();
  assert.equal((await get())[0].audit_match, 'ambiguous');
  assert.equal((await get())[0].raw_output, null);
  db.prepare('UPDATE audit_events SET tool_call_id = NULL, message_id = NULL, result_message_id = NULL').run();
  assert.equal((await get())[0].audit_match, 'unlinked');
  assert.equal((await get())[0].raw_output, null);
});

test('identity migration is additive, idempotent and preserves old audit history, dismissals and ingest state', () => {
  const db = openDb(':memory:');
  try {
    initSchema(db);
    db.exec("INSERT INTO sessions (id, agent_name, started_at, ended_at) VALUES ('old', 'alpha', 1, 2)");
    db.exec("INSERT INTO messages (id, session_id, agent_name, timestamp, role) VALUES ('old-message', 'old', 'alpha', 1, 'assistant')");
    db.exec("INSERT INTO tool_calls (id, message_id, session_id, agent_name, timestamp, tool_name) VALUES ('old-tool', 'old-message', 'old', 'alpha', 1, 'exec')");
    db.exec("INSERT INTO audit_events (id, session_id, agent_id, timestamp, event_type, raw_output) VALUES (91, 'old', 'alpha', 1, 'shell_command', 'OLD OUTPUT')");
    db.exec("INSERT INTO sensitive_findings (id, audit_event_id, session_id, agent_id, timestamp, pattern_type, dismissed) VALUES (92, 91, 'old', 'alpha', 1, 'test', 1)");
    db.exec("INSERT INTO ingest_state (file_path, mtime_ms, size_bytes) VALUES ('old.jsonl', 123, 456)");
    const snapshot = table => db.prepare(`SELECT * FROM ${table}`).all();
    const audit = snapshot('audit_events');
    const findings = snapshot('sensitive_findings');
    const state = snapshot('ingest_state');
    db.exec('DROP INDEX idx_audit_tool_identity');
    for (const name of ['tool_call_id', 'message_id', 'result_message_id']) db.exec(`ALTER TABLE audit_events DROP COLUMN ${name}`);
    for (const name of ['result_message_id', 'result_match', 'result_outcome']) db.exec(`ALTER TABLE tool_calls DROP COLUMN ${name}`);
    initSchema(db);
    initSchema(db);
    assert.deepEqual(snapshot('audit_events'), audit);
    assert.deepEqual(snapshot('sensitive_findings'), findings);
    assert.deepEqual(snapshot('ingest_state'), state);
    assert.equal(snapshot('tool_calls')[0].result_match, 'missing');
    assert.equal(snapshot('tool_calls')[0].result_outcome, 'unknown');
  } finally { db.close(); }
});
