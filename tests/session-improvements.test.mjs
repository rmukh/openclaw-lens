import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Exercise the actual pure UI modules without requiring a DOM or a TS test runner.
async function loadModule(name) {
  const source = await readFile(new URL(`../src/ui/src/lib/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { createToolStyles, toOklab, colorDistance, LLM_COLOR, ERROR_COLOR } = await loadModule('tool-colors');
const { sortSessions } = await loadModule('session-sort');

test('demo session logs are discoverable and parse custom tools and failures on this platform', async () => {
  const require = createRequire(import.meta.url);
  require('ts-node').register({ transpileOnly: true });
  const { createDemoData } = require('../bin/demo-data.ts');
  const { findSessionFiles, parseSessionFile } = require('../src/server/parser.ts');
  const directory = await mkdtemp(path.join(tmpdir(), 'claw-lens-test-'));
  try {
    const files = await findSessionFiles(createDemoData(directory));
    assert.equal(files.length, 4);
    const tools = files.flatMap(file => parseSessionFile(file).toolCalls);
    assert.ok(tools.some(tool => tool.toolName === 'custom.render_report'));
    assert.ok(tools.some(tool => tool.success === 0));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('session palette separates formerly similar and custom tools from each other and reserved colors', () => {
  const names = ['exec', 'process', 'read', 'web_search', 'web_fetch', 'custom.skill', 'another.custom'];
  const styles = createToolStyles(names);
  assert.equal(styles.size, names.length);
  const labs = [...styles.values()].map(s => toOklab(s.backgroundColor));
  for (let i = 0; i < labs.length; i++) {
    assert.ok(colorDistance(labs[i], toOklab(LLM_COLOR)) >= 0.18);
    assert.ok(colorDistance(labs[i], toOklab(ERROR_COLOR)) >= 0.18);
    for (let j = 0; j < i; j++) assert.ok(colorDistance(labs[i], labs[j]) >= 0.12);
  }
  assert.deepEqual(styles, createToolStyles([...names].reverse().concat(names)));
  assert.equal(createToolStyles([]).size, 0);
});

test('large palettes add secondary cues whenever colors are perceptually close', () => {
  const styles = [...createToolStyles(Array.from({ length: 100 }, (_, i) => `plugin.${i}`)).values()];
  assert.equal(new Set(styles.map(s => JSON.stringify(s))).size, 100);
  assert.ok(styles.some(s => s.backgroundImage));
  for (let i = 0; i < styles.length; i++) {
    for (let j = 0; j < i; j++) {
      if (colorDistance(toOklab(styles[i].backgroundColor), toOklab(styles[j].backgroundColor)) < 0.12) {
        assert.ok(styles[i].backgroundImage);
        assert.notEqual(styles[i].backgroundImage, styles[j].backgroundImage);
      }
    }
  }
});

const base = { started_at: 0, last_message_at: null, duration_ms: 0, total_tokens: 0,
  total_messages: 0, total_cost: 0, error_count: 0, cache_read: 0, input_tokens: 0 };
const rows = [
  { ...base, id: 'a', started_at: 10, last_message_at: 90, duration_ms: 80, total_tokens: 100, total_messages: 10, total_cost: 2, error_count: 1, input_tokens: 100 },
  { ...base, id: 'b', started_at: 30, last_message_at: 50, duration_ms: 20, total_tokens: 90, total_messages: 3, total_cost: 3, cache_read: 100 },
  { ...base, id: 'c', started_at: 60, duration_ms: 0, total_tokens: 0, total_messages: 0, error_count: 2, cache_read: 50, input_tokens: 50 },
];
for (const [key, expected] of Object.entries({ last_active: ['b','c','a'], started: ['a','b','c'], duration: ['c','b','a'], avg_per_msg: ['c','a','b'] })) {
  test(`${key} sorts ascending and descending by the actual numeric value`, () => {
    assert.deepEqual(sortSessions(rows, key, 'asc').map(s => s.id), expected);
    assert.deepEqual(sortSessions(rows, key, 'desc').map(s => s.id), [...expected].reverse());
    assert.deepEqual(rows.map(s => s.id), ['a','b','c']);
  });
}
test('existing sorts and deterministic tie breaking are preserved', () => {
  for (const [key, expected] of Object.entries({ last_active: ['a','c','b'], tokens: ['a','b','c'], cost: ['b','a','c'], errors: ['c','a','b'], cache_hit: ['b','c','a'] })) {
    assert.deepEqual(sortSessions(rows, key, 'desc').map(s => s.id), expected);
  }
  assert.deepEqual(sortSessions([{ ...base, id: 'b' }, { ...base, id: 'a' }], 'duration', 'desc').map(s => s.id), ['a','b']);
  assert.deepEqual(sortSessions([], 'avg_per_msg', 'desc'), []);
});

test('every sort field supports reversing direction independently', () => {
  for (const field of ['last_active', 'started', 'duration', 'avg_per_msg', 'tokens', 'cost', 'errors', 'cache_hit']) {
    const ascending = sortSessions(rows, field, 'asc').map(s => s.id);
    const descending = sortSessions(rows, field, 'desc').map(s => s.id);
    assert.deepEqual(ascending, [...descending].reverse());
  }
});
