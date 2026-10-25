import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true });
const { sessionActivity } = require('../src/server/session-activity.ts');
const { openDb, initSchema } = require('../src/server/db.ts');
const { sessionsRouter } = require('../src/server/api/sessions.ts');
const express = require('express');

const now = Date.now();
test('completed, failed, aborted, and token-limited turns are idle immediately, regardless of recency', () => {
  for (const stop_reason of ['stop', 'error', 'aborted', 'length']) {
    for (const timestamp of [now - 1, now - 86400000]) {
      assert.deepEqual(sessionActivity({ role: 'assistant', stop_reason, timestamp }, now, now), {
        state: 'idle', reason: 'turn_closed',
      });
    }
  }
});

test('new user messages and tool requests are inferred in progress, not merely recent completed messages', () => {
  assert.deepEqual(sessionActivity({ role: 'user', stop_reason: null, timestamp: now - 1 }, null, now), { state: 'in_progress', reason: 'pending_reply' });
  assert.deepEqual(sessionActivity({ role: 'assistant', stop_reason: 'toolUse', timestamp: now - 1 }, null, now), { state: 'in_progress', reason: 'tool_use' });
  assert.equal(sessionActivity({ role: 'assistant', stop_reason: null, timestamp: now }, null, now).state, 'unknown');
});

test('stale unfinished turns become unknown, while recent tool activity keeps an unfinished turn current', () => {
  const message = { role: 'assistant', stop_reason: 'toolUse', timestamp: now - 10 * 60000 };
  assert.deepEqual(sessionActivity(message, null, now), { state: 'unknown', reason: 'stale' });
  assert.equal(sessionActivity({ ...message, timestamp: message.timestamp + 1 }, null, now).state, 'in_progress');
  assert.equal(sessionActivity(message, now - 1000, now).state, 'in_progress');
  assert.equal(sessionActivity(message, now + 3600000, now).state, 'unknown');
});

test('missing, invalid, and future-skewed logs never imply an exited TUI or a completed turn', () => {
  for (const message of [null, { role: 'assistant', stop_reason: 'unknown', timestamp: now },
    { role: 'user', stop_reason: null, timestamp: NaN }, { role: 'user', stop_reason: null, timestamp: now + 60001 }]) {
    assert.deepEqual(sessionActivity(message, null, now), { state: 'unknown', reason: 'unavailable' });
  }
});

test('sessions API uses the latest real message, insertion order for ties, and current state even in historical filters', async () => {
  const db = openDb(':memory:');
  let server;
  try {
    initSchema(db);
    const addSession = db.prepare('INSERT INTO sessions (id, agent_name, started_at, ended_at) VALUES (?, ?, ?, ?)');
    const addMessage = db.prepare('INSERT INTO messages (id, session_id, agent_name, timestamp, role, stop_reason, model) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const id of ['finished', 'new-user', 'tool', 'stale', 'missing', 'legacy']) addSession.run(id, 'test', now - 3600000, now);
    addMessage.run('finished-msg', 'finished', 'test', now - 1, 'assistant', 'stop', 'demo-model');
    addMessage.run('synthetic', 'finished', 'test', now, 'assistant', 'toolUse', 'delivery-mirror');
    addMessage.run('old-turn', 'new-user', 'test', now - 5000, 'assistant', 'stop', 'demo-model');
    addMessage.run('new-prompt', 'new-user', 'test', now - 5000, 'user', null, '');
    addMessage.run('tool-msg', 'tool', 'test', now - 3600000, 'assistant', 'toolUse', 'demo-model');
    db.prepare('INSERT INTO tool_calls (id, message_id, session_id, agent_name, timestamp, tool_name) VALUES (?, ?, ?, ?, ?, ?)')
      .run('call', 'tool-msg', 'tool', 'test', now, 'exec');
    addMessage.run('stale-msg', 'stale', 'test', now - 3600000, 'user', null, '');
    addMessage.run('legacy-msg', 'legacy', 'test', now - 1, 'assistant', 'unknown', 'demo-model');
    const app = express();
    app.use('/api/sessions', sessionsRouter(db));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/sessions`;
    const rows = await fetch(url).then(response => response.json());
    const state = id => rows.find(row => row.id === id).activity.state;
    assert.equal(state('finished'), 'idle');
    assert.equal(rows.find(row => row.id === 'finished').last_stop_reason, 'stop');
    assert.equal(state('new-user'), 'in_progress');
    assert.equal(state('tool'), 'in_progress');
    assert.equal(state('stale'), 'unknown');
    assert.equal(state('missing'), 'unknown');
    assert.equal(state('legacy'), 'unknown');
    addMessage.run('later-prompt', 'finished', 'test', now + 1, 'user', null, '');
    const historical = await fetch(`${url}?from=${now - 1000}&to=${now}`).then(response => response.json());
    assert.equal(historical.find(row => row.id === 'finished').activity.state, 'in_progress');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
