import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const dates = url(compile(await readFile(new URL('../src/ui/src/lib/session-date-range.ts', import.meta.url), 'utf8')));
const source = compile(await readFile(new URL('../src/ui/src/lib/token-period.ts', import.meta.url), 'utf8'));
const { tokenPeriodRange, tokenPeriodQuery } = await import(url(source.replace("'./session-date-range'", JSON.stringify(dates))));
const base = { selection: 'p_7', singleDay: '2026-10-20', weekEnd: '2026-10-25', customStart: '2026-10-01', customEnd: '2026-10-25' };
const now = new Date(2026, 9, 25, 17, 30).getTime();
const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true });
const { createDemoData } = require('../bin/demo-data.ts');
const { findSessionFiles, parseSessionFile } = require('../src/server/parser.ts');
const { openDb, initSchema, ingestAll } = require('../src/server/db.ts');

test('shared token presets use calendar Today/Monday, rolling day counts, and unrestricted All Time', () => {
  assert.deepEqual(tokenPeriodRange({ ...base, selection: 'p_1' }, now), { from: new Date(2026, 9, 25).getTime() });
  assert.deepEqual(tokenPeriodRange({ ...base, selection: 'this_week' }, now), { from: new Date(2026, 9, 19).getTime() });
  for (const days of [7, 30, 90]) assert.deepEqual(tokenPeriodRange({ ...base, selection: `p_${days}` }, now), { from: now - days * 86400000 });
  assert.deepEqual(tokenPeriodRange({ ...base, selection: 'p_365' }, now), {});
});

test('shared day, week, and custom choices include the full selected local calendar days', () => {
  assert.deepEqual(tokenPeriodRange({ ...base, selection: 'day' }, now), { from: new Date(2026, 9, 20).getTime(), to: new Date(2026, 9, 21).getTime() });
  assert.deepEqual(tokenPeriodRange({ ...base, selection: 'week' }, now), { from: new Date(2026, 9, 19).getTime(), to: new Date(2026, 9, 26).getTime() });
  assert.deepEqual(tokenPeriodRange({ ...base, selection: 'custom' }, now), { from: new Date(2026, 9, 1).getTime(), to: new Date(2026, 9, 26).getTime() });
  assert.equal(tokenPeriodRange({ ...base, selection: 'custom', customStart: '' }).error, 'dateRangeIncomplete');
  assert.equal(tokenPeriodRange({ ...base, selection: 'custom', customStart: '2026-11-01' }).error, 'dateRangeReversed');
});

test('agent timestamps and breakdown ISO queries represent identical bounds, including epoch zero', () => {
  const range = tokenPeriodRange({ ...base, selection: 'custom' }, now);
  const numeric = new URLSearchParams(tokenPeriodQuery(range, 'timestamp'));
  const iso = new URLSearchParams(tokenPeriodQuery(range, 'iso'));
  for (const key of ['from', 'to']) assert.equal(Number(numeric.get(key)), new Date(iso.get(key)).getTime());
  assert.equal(tokenPeriodQuery({}, 'timestamp'), '');
  assert.equal(new URLSearchParams(tokenPeriodQuery({}, 'iso')).get('from'), '1970-01-01T00:00:00.000Z');
  assert.equal(new URLSearchParams(tokenPeriodQuery({ from: 0, to: 1000 }, 'timestamp')).get('from'), '0');
});

test('navigated weeks preserve calendar boundaries across daylight saving changes', () => {
  const original = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const range = tokenPeriodRange({ ...base, selection: 'week', weekEnd: '2026-03-08' }, now);
    assert.equal(range.from, new Date(2026, 2, 2).getTime());
    assert.equal(range.to, new Date(2026, 2, 9).getTime());
    assert.equal((range.to - range.from) / 3600000, 167);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('Sunday demo usage belongs to the last seven days but not the new Monday week', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claw-demo-week-'));
  try {
    const sunday = new Date(2026, 9, 25, 23, 28).getTime();
    const monday = new Date(2026, 9, 26, 0, 9).getTime();
    const files = await findSessionFiles(createDemoData(dir, sunday));
    assert.equal(files.length, 4);
    const messages = files.flatMap(file => parseSessionFile(file).messages);
    const usageSince = from => messages.filter(message => message.timestamp >= from)
      .reduce((sum, message) => sum + message.totalTokens, 0);
    assert.equal(usageSince(tokenPeriodRange({ ...base, selection: 'this_week' }, monday).from), 0);
    assert.ok(usageSince(tokenPeriodRange({ ...base, selection: 'p_7' }, monday).from) > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fresh Monday demo includes token usage even just after midnight without future events', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claw-demo-midnight-'));
  try {
    const generatedAt = new Date(2026, 9, 26, 0, 0, 0, 500).getTime();
    const files = await findSessionFiles(createDemoData(dir, generatedAt));
    assert.equal(files.length, 4);
    const parsed = files.map(file => parseSessionFile(file));
    const from = tokenPeriodRange({ ...base, selection: 'this_week' }, generatedAt).from;
    const currentUsage = parsed.flatMap(result => result.messages)
      .filter(message => message.timestamp >= from && message.totalTokens > 0);
    assert.ok(currentUsage.reduce((sum, message) => sum + message.totalTokens, 0) > 0);
    assert.equal(new Set(currentUsage.map(message => message.agentName)).size, 2);
    for (const file of files) {
      const records = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      const timestamps = records.filter(record => record.timestamp).map(record => Date.parse(record.timestamp));
      assert.ok(timestamps.every(timestamp => timestamp <= generatedAt));
      assert.deepEqual(timestamps, [...timestamps].sort((a, b) => a - b));
    }
    assert.ok(parsed.flatMap(result => result.toolCalls).every(tool => tool.timestamp <= generatedAt));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('regenerating demo data refreshes existing database timestamps across Monday without duplicate rows', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claw-demo-restart-'));
  const db = openDb(':memory:');
  try {
    initSchema(db);
    const sunday = new Date(2026, 9, 25, 23, 28).getTime();
    const monday = new Date(2026, 9, 26, 0, 0, 0, 500).getTime();
    const clawHome = createDemoData(dir, sunday);
    assert.deepEqual((await ingestAll(db, { clawHome })).errors, []);
    const count = table => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    const originalCounts = ['sessions', 'messages', 'tool_calls'].map(count);
    createDemoData(dir, monday);
    assert.deepEqual((await ingestAll(db, { clawHome })).errors, []);
    assert.deepEqual(['sessions', 'messages', 'tool_calls'].map(count), originalCounts);
    const from = tokenPeriodRange({ ...base, selection: 'this_week' }, monday).from;
    const usage = db.prepare('SELECT SUM(total_tokens) AS total FROM messages WHERE timestamp >= ?').get(from);
    assert.equal(usage.total, 9200);
    for (const file of await findSessionFiles(clawHome)) {
      const parsed = parseSessionFile(file);
      for (const session of parsed.sessions) {
        const row = db.prepare('SELECT started_at, ended_at FROM sessions WHERE id = ?').get(session.id);
        assert.equal(row.started_at, session.startedAt);
        assert.equal(row.ended_at, session.endedAt);
      }
      for (const message of parsed.messages) {
        assert.equal(db.prepare('SELECT timestamp FROM messages WHERE id = ?').get(message.id).timestamp, message.timestamp);
      }
      for (const tool of parsed.toolCalls) {
        assert.equal(db.prepare('SELECT timestamp FROM tool_calls WHERE id = ? AND message_id = ?').get(tool.id, tool.messageId).timestamp, tool.timestamp);
      }
    }
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
