import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/ui/src/lib/session-date-range.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { sessionDateRange, localDateInput, mondayStart } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('week-to-date starts on Monday in local time, including Sundays and year boundaries', () => {
  for (const [now, monday] of [
    [new Date(2026, 9, 19, 0, 0), new Date(2026, 9, 19)],
    [new Date(2026, 9, 21, 17, 30), new Date(2026, 9, 19)],
    [new Date(2026, 9, 25, 23, 59), new Date(2026, 9, 19)],
    [new Date(2026, 0, 1, 12), new Date(2025, 11, 29)],
  ]) {
    assert.equal(mondayStart(now.getTime()), monday.getTime());
  }
});

test('custom dates include both selected calendar days and preserve existing presets', () => {
  const now = new Date(2026, 9, 25, 17, 30).getTime();
  assert.equal(localDateInput(now), '2026-10-25');
  assert.deepEqual(sessionDateRange('all', '', '', now), {});
  assert.deepEqual(sessionDateRange('today', '', '', now), { from: new Date(2026, 9, 25).getTime() });
  for (const days of [7, 30]) assert.deepEqual(sessionDateRange(`${days}d`, '', '', now), { from: now - days * 86400000 });
  assert.deepEqual(sessionDateRange('custom', '2026-10-01', '2026-10-25'), {
    from: new Date(2026, 9, 1).getTime(), to: new Date(2026, 9, 26).getTime(),
  });
  assert.deepEqual(sessionDateRange('custom', '2026-10-25', '2026-10-25'), {
    from: new Date(2026, 9, 25).getTime(), to: new Date(2026, 9, 26).getTime(),
  });
});

test('custom date validation rejects partial, impossible, and reversed ranges', () => {
  assert.equal(sessionDateRange('custom', '', '2026-10-25').error, 'dateRangeIncomplete');
  assert.equal(sessionDateRange('custom', '2026-10-25', '').error, 'dateRangeIncomplete');
  for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-01-32', 'not a date']) {
    assert.equal(sessionDateRange('custom', date, date).error, 'dateRangeInvalid');
  }
  assert.equal(sessionDateRange('custom', '2026-10-26', '2026-10-25').error, 'dateRangeReversed');
  assert.equal(sessionDateRange('custom', '2028-02-29', '2028-02-29').error, undefined);
});

test('calendar range endpoints respect 23- and 25-hour daylight saving days', () => {
  const original = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    for (const [date, hours] of [['2026-03-08', 23], ['2026-11-01', 25]]) {
      const range = sessionDateRange('custom', date, date);
      assert.equal((range.to - range.from) / 3600000, hours);
      assert.equal(new Date(range.to).getHours(), 0);
    }
    assert.equal(mondayStart(new Date(2026, 2, 8, 12).getTime()), new Date(2026, 2, 2).getTime());
    assert.equal(mondayStart(new Date(2026, 10, 1, 12).getTime()), new Date(2026, 9, 26).getTime());
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('session API bounds activity and every aggregate, including sessions active after the selected range', async () => {
  const require = createRequire(import.meta.url);
  require('ts-node').register({ transpileOnly: true });
  const { openDb, initSchema, ingestAll } = require('../src/server/db.ts');
  const { sessionsRouter } = require('../src/server/api/sessions.ts');
  const express = require('express');
  const home = await mkdtemp(path.join(tmpdir(), 'claw-date-range-'));
  const db = openDb(':memory:');
  let server;
  try {
    initSchema(db);
    const from = Date.UTC(2026, 0, 10);
    const to = Date.UTC(2026, 0, 11);
    const ids = [1, 2, 3, 4].map(n => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`);
    const entries = [
      [[from - 1000, 900], [from, 100], [from + 1000, 200, 'error'], [to, 300], [to + 1000, 400], [from + 2000, 999, 'stop', 'delivery-mirror']],
      [[from - 1000, 50]],
      [[to, 60]],
      [[from + 1000, 0, 'stop', '', 'user']],
    ];
    const directory = path.join(home, 'agents', 'workspace-1', 'sessions');
    await mkdir(directory, { recursive: true });
    for (let i = 0; i < entries.length; i++) {
      const records = entries[i].map(([timestamp, tokens, stopReason = 'stop', model = 'demo-model', role = 'assistant'], index) => ({
        type: 'message', id: `${ids[i]}-msg-${index}`, timestamp: new Date(timestamp).toISOString(),
        message: { role, model, timestamp, stopReason, content: [{ type: 'text', text: 'Example activity' }],
          usage: { input: tokens / 2, output: 0, cacheRead: tokens / 4, cacheWrite: tokens / 10, totalTokens: tokens,
            cost: { total: tokens / 100, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
        },
      }));
      await writeFile(path.join(directory, `${ids[i]}.jsonl`), records.map(record => JSON.stringify(record)).join('\n'));
    }
    assert.deepEqual((await ingestAll(db, { clawHome: home })).errors, []);
    const app = express();
    app.use('/api/sessions', sessionsRouter(db, home));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/sessions`;
    const query = async qs => {
      const response = await fetch(`${base}?${qs}`);
      assert.equal(response.status, 200);
      return response.json();
    };
    const ranged = await query(`from=${from}&to=${to}&agent=workspace-1`);
    assert.deepEqual(ranged.map(row => row.id).sort(), [ids[0], ids[3]].sort());
    const row = ranged.find(row => row.id === ids[0]);
    for (const [field, value] of Object.entries({ total_messages: 2, total_tokens: 300, total_cost: 3, error_count: 1, cache_read: 75, cache_write: 30, input_tokens: 150 })) {
      assert.equal(row[field], value, field);
    }
    assert.ok(row.last_message_at >= to, 'Later activity must not hide earlier matching messages');
    assert.equal(ranged.find(row => row.id === ids[3]).total_messages, 0);
    assert.equal((await query('')).length, 4);
    assert.equal((await query(`from=${from}`)).length, 3);
    assert.equal((await query(`to=${to}`)).length, 3);
    assert.equal((await query(`from=0&to=${to}`)).length, 3);
    assert.equal((await query(`from=${from}&to=${to}&agent=other`)).length, 0);
    for (const qs of ['from=bad', 'to=Infinity', 'from=', 'from=1.5', 'from=1&from=2', `from=${to}&to=${from}`, `from=${from}&to=${from}`]) {
      assert.equal((await fetch(`${base}?${qs}`)).status, 400, qs);
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db.close();
    await rm(home, { recursive: true, force: true });
  }
});
