import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const dates = url(compile(await readFile(new URL('../src/ui/src/lib/session-date-range.ts', import.meta.url), 'utf8')));
const source = compile(await readFile(new URL('../src/ui/src/lib/token-period.ts', import.meta.url), 'utf8'));
const { tokenPeriodRange, tokenPeriodQuery } = await import(url(source.replace("'./session-date-range'", JSON.stringify(dates))));
const base = { selection: 'p_7', singleDay: '2026-10-20', weekEnd: '2026-10-25', customStart: '2026-10-01', customEnd: '2026-10-25' };
const now = new Date(2026, 9, 25, 17, 30).getTime();

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
