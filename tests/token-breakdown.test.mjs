import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true });
const { openDb, initSchema } = require('../src/server/db.ts');
const { tokensRouter } = require('../src/server/api/tokens.ts');
const express = require('express');

test('token breakdown applies custom boundaries to totals, every grouping, and contributing sessions', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'claw-token-range-'));
  const originalHome = process.env.OPENCLAW_HOME;
  process.env.OPENCLAW_HOME = home;
  const db = openDb(':memory:');
  let server;
  try {
    await writeFile(path.join(home, 'openclaw.json'), JSON.stringify({ agents: { list: [{ id: 'alpha' }, { id: 'beta' }] } }));
    initSchema(db);
    const from = Date.UTC(2026, 0, 5);
    const to = Date.UTC(2026, 0, 8);
    const session = db.prepare('INSERT INTO sessions (id, agent_name, started_at, ended_at, is_cron) VALUES (?, ?, ?, ?, ?)');
    session.run('cron', 'alpha', from - 1000, to + 1000, 1);
    session.run('manual', 'beta', from, to, 0);
    session.run('span', 'alpha', from, to + 1000, 0);
    const fixtures = [
      { session: 'cron', at: from - 1, tokens: 900, cost: 9 },
      { session: 'cron', at: from, tokens: 100, cost: 1 },
      { session: 'manual', at: from + 1000, tokens: 200, cost: 2 },
      { session: 'span', at: to - 1, tokens: 300, cost: 3 },
      { session: 'manual', at: to, tokens: 400, cost: 4 },
      { session: 'span', at: to + 1000, tokens: 700, cost: 7 },
      { session: 'span', at: from + 2000, tokens: 800, cost: -8 },
      { session: 'span', at: from + 3000, tokens: 999, cost: 9, model: 'delivery-mirror' },
    ];
    const insert = db.prepare(`INSERT INTO messages (id, session_id, agent_name, timestamp, role, model,
      input_tokens, output_tokens, cache_read, cache_write, total_tokens, cost_total)
      VALUES (?, ?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?)`);
    fixtures.forEach((row, i) => insert.run(String(i), row.session, row.session === 'manual' ? 'beta' : 'alpha', row.at,
      row.model || (row.session === 'manual' ? 'model-b' : 'model-a'), row.tokens / 2, row.tokens / 10,
      row.tokens / 4, row.tokens / 20, row.tokens, row.cost));
    const app = express();
    app.use('/api/tokens', tokensRouter(db));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/tokens/summary`;
    const get = async params => {
      const response = await fetch(`${url}?${new URLSearchParams(params)}`);
      assert.equal(response.status, 200);
      return response.json();
    };
    const result = await get({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    for (const [key, value] of Object.entries({ input: 300, output: 60, cacheRead: 150, cacheWrite: 30, total: 600, cost: 6, sessionCount: 3, avgCostPerSession: 2 })) {
      assert.equal(result.totals[key], value, key);
    }
    for (const group of [result.byModel, result.byAgent]) {
      assert.equal(group.reduce((sum, row) => sum + row.total, 0), 600);
      assert.equal(group.reduce((sum, row) => sum + row.cost, 0), 6);
    }
    assert.equal(result.byDay.reduce((sum, row) => sum + row.cost, 0), 6);
    assert.equal(result.byAgent.find(row => row.agent === 'alpha').sessions, 2);
    assert.equal(result.byModel.reduce((sum, row) => sum + row.messages, 0), 3);
    assert.deepEqual(result.cronVsManual, {
      cron: { tokens: 100, cost: 1, sessions: 1 }, manual: { tokens: 500, cost: 5, sessions: 2 },
    });
    // Week-to-date uses a single explicit Monday boundary, with no rolling fallback.
    assert.equal((await get({ from: new Date(from).toISOString() })).totals.total, 1700);
    assert.equal((await get({ from: '2026-01-05T03:00:00+03:00', to: '2026-01-08T03:00:00+03:00' })).totals.total, 600);
    const empty = await get({ from: '2099-01-01T00:00:00Z', to: '2099-01-02T00:00:00Z' });
    assert.equal(empty.totals.total, 0);
    assert.equal(empty.totals.sessionCount, 0);
    assert.equal(empty.totals.avgCostPerSession, 0);
    assert.deepEqual(empty.byModel, []);
    assert.equal(empty.byAgent.reduce((sum, row) => sum + row.total, 0), 0);
    // Preserve the date-only contract used by existing clients, with local days.
    const localFrom = new Date('2026-01-05T00:00:00').getTime();
    const localTo = new Date('2026-01-08T00:00:00').getTime();
    const localExpected = fixtures.filter(row => row.at >= localFrom && row.at < localTo && row.cost >= 0 && !row.model).reduce((sum, row) => sum + row.tokens, 0);
    assert.equal((await get({ from: '2026-01-05', to: '2026-01-08' })).totals.total, localExpected);
    assert.equal((await get({ days: '365' })).totals.total, 2600);
    for (const params of [{ from: '' }, { from: 'bad' }, { from: '2026-02-30' }, { from: '2026-01-08', to: '2026-01-05' }, { from: '2026-01-05', to: '2026-01-05' }, { from: '2026-01-05', to: 'bad' }]) {
      assert.equal((await fetch(`${url}?${new URLSearchParams(params)}`)).status, 400);
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db.close();
    if (originalHome === undefined) delete process.env.OPENCLAW_HOME;
    else process.env.OPENCLAW_HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  }
});
