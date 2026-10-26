import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { waitForApi } from '../bin/wait-for-api.mjs';

const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true });
const { resolveOpenClawDir } = require('../src/server/model-meta.ts');
const { WebSocket } = require('ws');
const root = fileURLToPath(new URL('../', import.meta.url));

test('readiness waits through unavailable and unrelated responses, then accepts the Lens API', async () => {
  let ready = false;
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(ready ? { service: 'claw-lens', status: 'ok' } : { status: 'ok' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/health`;
  try {
    await assert.rejects(waitForApi({ url, timeoutMs: 100, retryMs: 10 }), /Timed out waiting/);
    ready = true;
    await waitForApi({ url, timeoutMs: 1000, retryMs: 10 });
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await assert.rejects(waitForApi({ url, timeoutMs: 100, retryMs: 10 }), /Timed out waiting/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('OpenClaw discovery supports Windows npm shims and package binaries without accepting unrelated packages', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claw-discovery-'));
  try {
    const pkg = path.join(dir, 'node_modules', 'openclaw');
    await mkdir(path.join(pkg, 'dist'), { recursive: true });
    await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'openclaw' }));
    const shim = path.join(dir, 'openclaw.cmd');
    const binary = path.join(pkg, 'dist', 'cli.js');
    await writeFile(shim, '@echo off');
    await writeFile(binary, '');
    assert.equal(resolveOpenClawDir([shim]), pkg);
    assert.equal(resolveOpenClawDir([binary]), pkg);
    assert.equal(resolveOpenClawDir([path.join(dir, 'missing'), shim]), pkg);
    await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'unrelated' }));
    assert.equal(resolveOpenClawDir([shim, binary]), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function startFixture(serveUi) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claw-startup-'));
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  await mkdir(path.join(dir, 'dist', 'ui'), { recursive: true });
  await writeFile(path.join(dir, 'dist', 'ui', 'index.html'), '<html>production dashboard fixture</html>');
  const source = `require(${JSON.stringify(path.join(root, 'src/server/index.ts'))}).startServer(${JSON.stringify({ port, serveUi, clawHome: path.join(dir, 'openclaw'), dbPath: path.join(dir, 'test.db'), open: false })}).catch(error => { console.error(error); process.exit(1); });`;
  const child = spawn(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), '-e', source], {
    cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TS_NODE_PROJECT: path.join(root, 'tsconfig.json') },
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  };
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForApi({ url: url + '/api/health', timeoutMs: 30000, retryMs: 100 });
    assert.doesNotMatch(output, /which.*not recognized/);
    return { url, stop };
  } catch (error) {
    await stop();
    throw new Error(`${error.message}\n${output}`);
  }
}

test('development is API-only and Vite forwards HTTP and WebSockets with the origin guard intact', async () => {
  const fixture = await startFixture(false);
  let vite;
  let client;
  let rejected;
  try {
    const home = await fetch(fixture.url);
    assert.match(await home.text(), /development dashboard at http:\/\/localhost:6060/);
    assert.equal((await fetch(fixture.url + '/tokens')).status, 404);
    const { createServer: createViteServer } = await import(pathToFileURL(path.join(root, 'src/ui/node_modules/vite/dist/node/index.js')).href);
    vite = await createViteServer({
      configFile: path.join(root, 'src/ui/vite.config.ts'), root: path.join(root, 'src/ui'),
      server: { host: '127.0.0.1', port: 0, proxy: {
        '/api': { target: fixture.url },
        '/ws': { target: fixture.url.replace('http:', 'ws:') },
      } },
    });
    assert.equal(vite.config.server.proxy['/ws'].rewriteWsOrigin, false);
    await vite.listen();
    const port = vite.httpServer.address().port;
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/health`)).json(), { service: 'claw-lens', status: 'ok' });
    const wsUrl = `ws://127.0.0.1:${port}/ws/live`;
    client = new WebSocket(wsUrl, { origin: `http://localhost:${port}` });
    const [message] = await once(client, 'message');
    assert.equal(JSON.parse(message.toString()).type, 'gateway_status');
    rejected = new WebSocket(wsUrl, { origin: 'https://untrusted.example' });
    const [code] = await once(rejected, 'close');
    assert.equal(code, 1008);
  } finally {
    if (client?.readyState === WebSocket.OPEN) {
      const closed = once(client, 'close');
      client.close();
      await closed;
    } else {
      client?.terminate();
    }
    rejected?.terminate();
    await vite?.close();
    await fixture.stop();
  }
});

test('production still serves the built dashboard and client-side routes', async () => {
  const fixture = await startFixture(undefined);
  try {
    for (const route of ['/', '/tokens']) {
      const response = await fetch(fixture.url + route);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /production dashboard fixture/);
    }
  } finally {
    await fixture.stop();
  }
});
