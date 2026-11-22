import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDataJs, inDefaultView, selectRun, scoreEntries, rankForEngines } from '../scripts/lib/clickbench.mjs';

const q = (t) => [t, t, t];
const entry = (system, times, over = {}) => ({
  system, date: '2026-01-01', machine: 'c6a.4xlarge', cluster_size: 1, proprietary: 'no', hardware: 'cpu',
  tuned: 'no', tags: ['column-oriented'], load_time: 100, data_size: 10e9, category: 'production',
  source: `${system.toLowerCase()}/results/x.json`, result: times.map(q), ...over,
});

test('parseDataJs reads the site data file without evaluating it', () => {
  const js = 'const data = [\n{"system":"A","result":[]}\n,{"system":"B","result":[]}\n];\n';
  assert.deepEqual(parseDataJs(js).map((d) => d.system), ['A', 'B']);
});

test('selectRun: cold is run 1, hot is min of runs 2 and 3, combined weights 3:1 hot:cold', () => {
  assert.equal(selectRun([4, 2, 3], 'cold'), 4);
  assert.equal(selectRun([4, 2, 3], 'hot'), 2);
  assert.equal(selectRun([4, 2, 3], 'combined'), (2 * 0.6 + 4 * 0.2) / 0.8);
  assert.equal(selectRun([4, null, 3], 'hot'), null);
});

test('inDefaultView applies the site defaults', () => {
  assert.ok(inDefaultView(entry('A', [1])));
  assert.ok(inDefaultView(entry('A', [1], { machine: 'Snowflake: L' })), 'cloud size names are allowed');
  assert.ok(!inDefaultView(entry('A', [1], { tuned: 'yes' })));
  assert.ok(!inDefaultView(entry('A', [1], { hardware: 'gpu' })));
  assert.ok(!inDefaultView(entry('A', [1], { category: 'enthusiast' })));
  assert.ok(!inDefaultView(entry('A', [1], { machine: 'c6a.2xlarge' })), 'small machines are off by default');
  assert.ok(!inDefaultView(entry('A', [1], { machine: 'm5.large' })), 'EC2 types outside the whitelist are hidden');
  assert.ok(!inDefaultView(entry('A', [1], { tags: ['in-memory'] })), 'combined metric excludes in-memory engines');
  assert.ok(!inDefaultView(entry('A', [1], { proprietary: undefined })), 'the open-source filter drops entries without the field');
});

test('scoreEntries: identical entries score 1, a 2x slower one scores between', () => {
  const s = scoreEntries([entry('Fast', [1, 1]), entry('Same', [1, 1]), entry('Slow', [2, 2])]);
  assert.deepEqual(s.map((e) => e.system), ['Fast', 'Same', 'Slow']);
  assert.ok(Math.abs(s[0].score - 1) < 1e-12);
  assert.ok(s[2].score > 1 && s[2].score < 2, 'only 80% of the weight is query time');
});

test('scoreEntries: a failed query costs 2x the worst time, at least 300 s', () => {
  const s = scoreEntries([entry('Ok', [1, 1]), entry('Fail', [1, null], { result: [q(1), null] })]);
  const fail = s.find((e) => e.system === 'Fail');
  assert.ok(fail.score > 10);
});

test('rankForEngines takes each engine\'s best entry and ranks one row per system', () => {
  const scored = scoreEntries([
    entry('X', [1, 1]), entry('X', [1, 1], { machine: 'c7a.metal-48xl' }),
    entry('Y (Parquet)', [2, 2]), entry('Y', [3, 3]), entry('Z', [4, 4]),
  ]);
  const r = rankForEngines(scored, { Yengine: ['Y', 'Y (Parquet)'], Missing: ['Nope'] });
  assert.equal(r.systems, 4);
  assert.equal(r.engines.Yengine.system, 'Y (Parquet)');
  assert.equal(r.engines.Yengine.rank, 2);
  assert.equal(r.engines.Missing, undefined);
});

test('mapping only names ELO engines that exist in matches.json', () => {
  const map = JSON.parse(readFileSync(new URL('../data/elo/clickbench-map.json', import.meta.url)));
  const matches = JSON.parse(readFileSync(new URL('../data/elo/matches.json', import.meta.url)));
  const engines = new Set(matches.flatMap((m) => m.ranking.flat()));
  for (const e of Object.keys(map)) assert.ok(engines.has(e), `${e} is not an ELO engine`);
});
