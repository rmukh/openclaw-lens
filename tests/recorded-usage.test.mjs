import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true });
const { openDb, initSchema, ingestAll } = require('../src/server/db.ts');
const { createDemoData } = require('../bin/demo-data.ts');
const { tokensRouter } = require('../src/server/api/tokens.ts');
const { profilerRouter } = require('../src/server/api/profiler.ts');
const express = require('express');

test('recorded counts agree across breakdown, agents and sessions without multiplying tokens or counting results', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claw-recorded-'));
  const previousHome = process.env.OPENCLAW_HOME;
  process.env.OPENCLAW_HOME = dir;
  const db = openDb(':memory:');
  let server;
  try {
    await writeFile(path.join(dir, 'openclaw.json'), JSON.stringify({ agents: { list: [{ id: 'alpha' }, { id: 'beta' }, { id: 'empty' }] } }));
    initSchema(db);
    const from = new Date(2026, 9, 26).getTime();
    const to = new Date(2026, 9, 27).getTime();
    const session = db.prepare('INSERT INTO sessions (id, agent_name, started_at, ended_at, is_cron) VALUES (?, ?, ?, ?, ?)');
    session.run('a', 'alpha', from - 1000, to + 1000, 1);
    session.run('b', 'beta', from, to, 0);
    session.run('e', 'empty', from, to, 0);
    const message = db.prepare(`INSERT INTO messages (id, session_id, agent_name, timestamp, role, model, total_tokens, cost_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const add = (id, at, { agent = 'alpha', role = 'assistant', model = 'model-a', tokens = 0, cost = 0 } = {}) => {
      message.run(id, agent === 'alpha' ? 'a' : 'b', agent, at, role, model, tokens, cost);
    };
    add('before', from - 1, { tokens: 900, cost: 9 });
    add('parallel', from, { tokens: 100, cost: 1 });
    add('pending-retry', from + 10);
    add('last', to - 1, { agent: 'beta', model: 'model-b', tokens: 200, cost: 2 });
    add('at-end', to, { agent: 'beta', model: 'model-b', tokens: 300, cost: 3 });
    add('mirror', from + 20, { model: 'delivery-mirror' });
    add('injected', from + 21, { model: 'gateway-injected' });
    add('user', from + 30, { role: 'user' });
    add('bad-cost', from + 40, { cost: -1 });
    add('final', from + 60);
    add('result', from + 70, { role: 'toolResult' });
    const tool = db.prepare(`INSERT OR IGNORE INTO tool_calls (id, message_id, session_id, agent_name, timestamp, tool_name, success, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const addTool = (id, parent, name, { agent = 'alpha', at = to + 100, success = 1, duration = null } = {}) => {
      tool.run(id, parent, agent === 'alpha' ? 'a' : 'b', agent, at, name, success, duration);
    };
    addTool('same-id', 'parallel', 'read');
    addTool('failed', 'parallel', 'exec', { success: 0, duration: 100 });
    addTool('retry', 'pending-retry', 'read');
    addTool('same-id', 'last', 'read', { agent: 'beta' });
    addTool('custom', 'last', 'custom.search_documents', { agent: 'beta' });
    // Repeated ingestion of the same identity must not add another request.
    addTool('same-id', 'parallel', 'read');
    for (const parent of ['before', 'at-end', 'mirror', 'injected', 'user', 'bad-cost', 'result']) addTool('excluded-' + parent, parent, 'excluded');
    const app = express();
    app.use('/api/tokens', tokensRouter(db));
    app.use('/api/profiler', profilerRouter(db));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api`;
    const get = async endpoint => {
      const response = await fetch(url + endpoint);
      assert.equal(response.status, 200);
      return response.json();
    };
    const summary = await get('/tokens/summary?' + new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() }));
    assert.equal(summary.totals.llmResponses, 4);
    assert.equal(summary.totals.toolCalls, 5);
    assert.equal(summary.totals.total, 300);
    assert.equal(summary.totals.cost, 3);
    assert.deepEqual(summary.byTool, [
      { toolName: 'read', toolCalls: 3 }, { toolName: 'custom.search_documents', toolCalls: 1 }, { toolName: 'exec', toolCalls: 1 },
    ]);
    assert.equal(summary.byAgent.find(row => row.agent === 'empty').toolCalls, 0);
    assert.equal(summary.byAgent.find(row => row.agent === 'empty').llmResponses, 0);
    assert.deepEqual([summary.cronVsManual.cron.llmResponses, summary.cronVsManual.cron.toolCalls], [3, 3]);
    assert.deepEqual([summary.cronVsManual.manual.llmResponses, summary.cronVsManual.manual.toolCalls], [1, 2]);
    assert.equal(summary.byModel.reduce((sum, row) => sum + row.messages, 0), 4);
    assert.equal(summary.byModel.reduce((sum, row) => sum + row.toolCalls, 0), 5);
    const qs = `?from=${from}&to=${to}`;
    const agents = await get('/profiler/tokens' + qs);
    for (const agent of agents) {
      const breakdown = summary.byAgent.find(row => row.agent === agent.agent_name);
      assert.equal(agent.message_count, breakdown.llmResponses);
      assert.equal(agent.tool_call_count, breakdown.toolCalls);
      assert.equal(agent.total_tokens, breakdown.total);
      assert.equal(agent.tools.reduce((sum, row) => sum + row.call_count, 0), agent.tool_call_count);
      const sessions = await get(`/profiler/tokens/${agent.agent_name}/sessions${qs}`);
      assert.equal(sessions.reduce((sum, row) => sum + row.message_count, 0), agent.message_count);
      assert.equal(sessions.reduce((sum, row) => sum + row.tool_call_count, 0), agent.tool_call_count);
    }
    const startOnly = await get(`/profiler/tokens/alpha/sessions?from=${from}&to=${from + 1}`);
    assert.equal(startOnly[0].tool_call_count, 2);
    const noTools = await get(`/profiler/tokens?from=${from + 60}&to=${from + 61}`);
    assert.equal(noTools[0].message_count, 1);
    assert.equal(noTools[0].tool_call_count, 0);
    assert.deepEqual(noTools[0].tools, []);
    const empty = await get('/tokens/summary?from=2099-01-01&to=2099-01-02');
    assert.equal(empty.totals.llmResponses, 0);
    assert.equal(empty.totals.toolCalls, 0);
    assert.deepEqual(empty.byTool, []);
    const all = await get('/tokens/summary?from=1970-01-01T00:00:00.000Z');
    const allAgents = await get('/profiler/tokens');
    assert.equal(all.totals.toolCalls, 7);
    assert.equal(all.totals.llmResponses, 6);
    assert.equal(allAgents.reduce((sum, row) => sum + row.tool_call_count, 0), 7);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db.close();
    if (previousHome === undefined) delete process.env.OPENCLAW_HOME;
    else process.env.OPENCLAW_HOME = previousHome;
    await rm(dir, { recursive: true, force: true });
  }
});

test('existing databases gain the message index and real demo re-ingestion preserves recorded counts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claw-recorded-ingest-'));
  const db = openDb(':memory:');
  try {
    initSchema(db);
    db.exec('DROP INDEX idx_tool_calls_message');
    initSchema(db);
    assert.ok(db.prepare("PRAGMA index_list('tool_calls')").all().some(index => index.name === 'idx_tool_calls_message'));
    const clawHome = createDemoData(dir);
    assert.deepEqual((await ingestAll(db, { clawHome })).errors, []);
    const count = () => ({ responses: db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role = 'assistant'").get().n,
      tools: db.prepare('SELECT COUNT(*) AS n FROM tool_calls').get().n });
    assert.deepEqual(count(), { responses: 25, tools: 21 });
    db.exec('DELETE FROM ingest_state');
    assert.deepEqual((await ingestAll(db, { clawHome })).errors, []);
    assert.deepEqual(count(), { responses: 25, tools: 21 });
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
