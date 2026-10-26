import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/ui/src/lib/live-connection.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { connectLiveSocket } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

function setup(t, protocol = 'http:') {
  const originalWindow = globalThis.window;
  const originalSocket = globalThis.WebSocket;
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    closeCount = 0;
    onopen = null;
    onmessage = null;
    onclose = null;
    onerror = null;
    constructor(url) { this.url = url; sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    close() {
      assert.equal(this.readyState, 1, 'cleanup must not abort a connecting socket');
      this.closeCount++;
      this.readyState = 3;
      this.onclose?.();
    }
    drop() { this.readyState = 3; this.onclose?.(); }
    receive(data) { this.onmessage?.({ data }); }
  }
  globalThis.window = { location: { protocol, host: 'localhost:6060' } };
  globalThis.WebSocket = FakeSocket;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stops = [];
  t.after(() => {
    for (const stop of stops) stop();
    t.mock.timers.reset();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalSocket === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = originalSocket;
  });
  return { sockets, connect(options = {}) {
    const stop = connectLiveSocket({ onMessage: () => {}, ...options });
    stops.push(stop);
    return stop;
  } };
}

test('React StrictMode setup/cleanup/setup opens only the surviving connection', t => {
  const { sockets, connect } = setup(t);
  const firstStop = connect();
  firstStop();
  connect();
  t.mock.timers.tick(0);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, 'ws://localhost:6060/ws/live');
  sockets[0].open();
});

test('cleanup during a pending handshake closes gracefully after open without callbacks or retries', t => {
  const { sockets, connect } = setup(t);
  const changes = [], messages = [];
  const stop = connect({ onMessage: message => messages.push(message), onConnectionChange: state => changes.push(state) });
  t.mock.timers.tick(0);
  const socket = sockets[0];
  stop();
  assert.equal(socket.closeCount, 0);
  socket.receive('{"type":"data_updated"}');
  socket.open();
  assert.equal(socket.closeCount, 1);
  t.mock.timers.tick(10000);
  assert.equal(sockets.length, 1);
  assert.deepEqual(changes, []);
  assert.deepEqual(messages, []);
});

test('live events and connection state work over HTTPS and open sockets close on cleanup', t => {
  const { sockets, connect } = setup(t, 'https:');
  const changes = [], messages = [];
  const stop = connect({ onMessage: message => messages.push(message), onConnectionChange: state => changes.push(state) });
  t.mock.timers.tick(0);
  const socket = sockets[0];
  assert.equal(socket.url, 'wss://localhost:6060/ws/live');
  socket.open();
  socket.receive('invalid JSON');
  socket.receive('{"type":"data_updated"}');
  assert.deepEqual(changes, [true]);
  assert.deepEqual(messages, [{ type: 'data_updated' }]);
  stop();
  assert.equal(socket.closeCount, 1);
  t.mock.timers.tick(10000);
  assert.equal(sockets.length, 1);
});

test('an error followed by close schedules one reconnect, which cleanup can cancel', t => {
  const { sockets, connect } = setup(t);
  const changes = [];
  const stop = connect({ onConnectionChange: state => changes.push(state) });
  t.mock.timers.tick(0);
  sockets[0].open();
  sockets[0].onerror();
  sockets[0].drop();
  assert.deepEqual(changes, [true, false]);
  t.mock.timers.tick(2999);
  assert.equal(sockets.length, 1);
  t.mock.timers.tick(1);
  assert.equal(sockets.length, 2);
  sockets[1].open();
  sockets[1].drop();
  stop();
  t.mock.timers.tick(10000);
  assert.equal(sockets.length, 2);
  assert.deepEqual(changes, [true, false, true, false]);
});
