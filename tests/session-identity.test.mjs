import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true });
const { createSessionIdentityResolver } = require('../src/server/session-identity.ts');
const { createDemoData } = require('../bin/demo-data.ts');
const { openDb, initSchema, ingestAll } = require('../src/server/db.ts');
const { sessionsRouter } = require('../src/server/api/sessions.ts');
const express = require('express');
const { setupLiveWs } = require('../src/server/api/live.ts');
const { WebSocketServer } = require('ws');

function fixture(t) {
  const home = mkdtempSync(path.join(tmpdir(), 'claw-identity-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const write = (file, data) => {
    const full = path.join(home, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, JSON.stringify(data));
  };
  return { home, write };
}

test('identity matches UUID to agent-scoped run key and preserves complete run suffix', t => {
  const { home, write } = fixture(t);
  write('openclaw.json', { agents: { list: [{ id: 'workspace-1', workspace: '/projects/workspace-1' }] } });
  write('agents/workspace-1/sessions/sessions.json', {
    'agent:workspace-1:run1': { sessionId: 'one' },
    'agent:workspace-1:telegram:direct:42': { sessionId: 'two' },
  });
  const identify = createSessionIdentityResolver(home);
  assert.deepEqual(identify({ id: 'one', agent_name: 'workspace-1' }), {
    workspace_name: 'workspace-1', workspace_path: '/projects/workspace-1', session_name: 'run1', session_key: 'agent:workspace-1:run1',
  });
  assert.equal(identify({ id: 'two', agent_name: 'workspace-1' }).session_name, 'telegram:direct:42');
  // UUIDs not in the current index must not inherit a newer session's name.
  assert.equal(identify({ id: 'old-reset-session', agent_name: 'workspace-1' }).session_name, null);
});

test('session-specific workspace and explicit names override configuration and routing names', t => {
  const { home, write } = fixture(t);
  write('openclaw.json', { agents: { list: [{ id: 'main', workspace: '/configured/workspace' }] } });
  write('agents/main/sessions/sessions.json', {
    'agent:main:run1': { sessionId: 'one', label: 'Inspect build', displayName: 'Display name', spawnedWorkspaceDir: 'C:\\projects\\workspace-2\\' },
    'agent:main:run2': { sessionId: 'two', displayName: 'Display name' },
  });
  const identify = createSessionIdentityResolver(home);
  const first = identify({ id: 'one', agent_name: 'main', workspace_path: '/transcript/workspace', session_label: 'Transcript name' });
  assert.equal(first.workspace_name, 'workspace-2');
  assert.equal(first.session_name, 'Inspect build');
  const second = identify({ id: 'two', agent_name: 'main', workspace_path: '/transcript/workspace', session_label: 'Renamed in transcript' });
  assert.equal(second.workspace_path, '/transcript/workspace');
  assert.equal(second.session_name, 'Renamed in transcript');
  assert.equal(identify({ id: 'two', agent_name: 'main' }).session_name, 'Display name');
});

test('identity tolerates missing and malformed stores, refreshes renames, and chooses latest UUID alias', t => {
  const { home, write } = fixture(t);
  const source = { id: 'one', agent_name: 'workspace-1' };
  assert.deepEqual(createSessionIdentityResolver(home)(source), {
    workspace_name: 'workspace-1', workspace_path: null, session_name: null, session_key: null,
  });
  write('agents/workspace-1/sessions/sessions.json', {
    'agent:workspace-1:old': { sessionId: 'one', updatedAt: 1 },
    'agent:workspace-1:new': { sessionId: 'one', updatedAt: 2, label: 'New label' },
    invalid: null,
  });
  assert.equal(createSessionIdentityResolver(home)(source).session_name, 'New label');
  write('agents/workspace-1/sessions/sessions.json', { 'agent:workspace-1:new': { sessionId: 'one', label: 'Renamed' } });
  assert.equal(createSessionIdentityResolver(home)(source).session_name, 'Renamed');
  writeFileSync(path.join(home, 'agents/workspace-1/sessions/sessions.json'), '{ partial');
  assert.equal(createSessionIdentityResolver(home)(source).session_name, null);
  // A malformed/traversal agent id never causes filesystem traversal.
  assert.equal(createSessionIdentityResolver(home)({ id: 'one', agent_name: '../outside' }).session_key, null);
});

test('default agent workspace is not incorrectly applied to every agent', t => {
  const { home, write } = fixture(t);
  write('openclaw.json', { agents: { defaults: { workspace: '/projects/default' }, list: [{ id: 'primary', default: true }, { id: 'other' }] } });
  const identify = createSessionIdentityResolver(home);
  assert.equal(identify({ id: 'a', agent_name: 'primary' }).workspace_name, 'default');
  assert.equal(identify({ id: 'b', agent_name: 'other' }).workspace_name, 'other');
});

test('existing databases re-ingest workspace/name metadata and list/detail APIs expose the same identity', async t => {
  const { home: directory, write } = fixture(t);
  const home = createDemoData(directory);
  const db = openDb(':memory:');
  t.after(() => db.close());
  initSchema(db);
  const first = await ingestAll(db, { clawHome: home });
  assert.deepEqual(first.errors, []);
  assert.equal(first.sessionsUpserted, 4);
  // Emulate an already-ingested installation from before the metadata migration.
  db.exec('ALTER TABLE sessions DROP COLUMN workspace_path; ALTER TABLE sessions DROP COLUMN session_label');
  db.exec("UPDATE sessions SET agent_name = 'legacy'; UPDATE messages SET agent_name = 'legacy'; UPDATE tool_calls SET agent_name = 'legacy'");
  db.prepare("UPDATE settings SET value = '3' WHERE key = 'session_aggregate_version'").run();
  initSchema(db);
  const migrated = await ingestAll(db, { clawHome: home });
  assert.equal(migrated.filesProcessed, 4);
  assert.deepEqual(migrated.errors, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE workspace_path IS NOT NULL').get().count, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE agent_name = 'workspace-1'").get().count, 2);
  assert.equal(db.prepare("SELECT session_label FROM sessions WHERE session_label IS NOT NULL").get().session_label, 'Review changes');
  initSchema(db);
  assert.equal((await ingestAll(db, { clawHome: home })).filesSkipped, 4);

  const app = express();
  app.use('/api/sessions', sessionsRouter(db, home));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/sessions`;
  try {
    const rows = await fetch(base).then(r => r.json());
    assert.equal(rows.length, 4);
    const firstRun = rows.find(row => row.session_key === 'agent:workspace-1:run1');
    assert.equal(firstRun.workspace_name, 'workspace-1');
    assert.equal(firstRun.session_name, 'run1');
    assert.ok(rows.some(row => row.session_name === 'Review changes'));
    assert.ok(rows.some(row => row.agent_name === 'demo' && row.session_name === null));
    const detail = await fetch(`${base}/${firstRun.id}`).then(r => r.json());
    for (const key of ['workspace_name', 'workspace_path', 'session_name', 'session_key']) {
      assert.equal(detail.session[key], firstRun[key]);
    }
    // Renames must be reflected even when transcript files are unchanged.
    write('demo-openclaw/agents/workspace-1/sessions/sessions.json', {
      'agent:workspace-1:run1': { sessionId: firstRun.id, label: 'Updated run label' },
    });
    const renamed = await fetch(`${base}/${firstRun.id}`).then(r => r.json());
    assert.equal(renamed.session.session_name, 'Updated run label');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('live tracking discovers an agent directory created after startup and ingests subsequent messages', { timeout: 15000 }, async t => {
  const { home, write } = fixture(t);
  const gateway = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => gateway.once('listening', resolve));
  write('openclaw.json', { gateway: { port: gateway.address().port } });
  const db = openDb(':memory:');
  initSchema(db);
  const server = createServer();
  const stop = setupLiveWs(server, db, home);
  try {
    // Begin with no agents at all, then add a workspace while the watcher is live.
    await delay(250);
    const id = 'aaaaaaaa-0000-4000-8000-000000000001';
    const records = [
      { type: 'session', id, timestamp: new Date().toISOString(), cwd: '/projects/new-workspace' },
      { type: 'message', id: 'new-user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'Inspect workspace' } },
    ];
    const file = path.join(home, 'agents/new-workspace/sessions', `${id}.jsonl`);
    write('agents/new-workspace/sessions/sessions.json', { 'agent:new-workspace:run1': { sessionId: id } });
    writeFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
    const waitFor = async predicate => {
      const deadline = Date.now() + 10000;
      while (!predicate()) {
        assert.ok(Date.now() < deadline, 'Timed out waiting for live ingestion');
        await delay(100);
      }
    };
    await waitFor(() => db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id));
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    assert.equal(createSessionIdentityResolver(home)(session).session_name, 'run1');
    records.push({ type: 'message', id: 'new-assistant', timestamp: new Date().toISOString(), message: { role: 'assistant', model: 'demo-model', content: 'Done', stopReason: 'stop' } });
    writeFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
    await waitFor(() => db.prepare('SELECT total_messages FROM sessions WHERE id = ?').get(id)?.total_messages === 1);
  } finally {
    stop();
    for (const socket of gateway.clients) socket.terminate();
    await new Promise(resolve => gateway.close(resolve));
    db.close();
  }
});

test('offline gateway error and close events schedule a single bounded reconnect', { timeout: 10000 }, async t => {
  const { home, write } = fixture(t);
  let attempts = 0;
  const gateway = createServer();
  gateway.on('upgrade', (_request, socket) => {
    attempts++;
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  gateway.listen(0, '127.0.0.1');
  await new Promise(resolve => gateway.once('listening', resolve));
  write('openclaw.json', { gateway: { port: gateway.address().port } });
  const db = openDb(':memory:');
  initSchema(db);
  const stop = setupLiveWs(createServer(), db, home);
  try {
    // Retry at approximately 1s and 3s. Duplicate error/close scheduling used
    // to produce seven attempts here, growing exponentially while offline.
    await delay(3500);
    assert.ok(attempts >= 2 && attempts <= 3, `Expected bounded backoff, saw ${attempts} attempts`);
  } finally {
    stop();
    await new Promise(resolve => gateway.close(resolve));
    db.close();
  }
});
