import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeRatings, expected, workloads, PLAYGROUNDS } from '../assets/js/elo.mjs';

const m = (id, date, ranking, workload = 'TPC-H') => ({ id, date, ranking, workload, source: 'https://example.com' });
const sum = (r) => Object.values(r).reduce((a, b) => a + b.rating, 0);

test('expected score is 0.5 for equal ratings and symmetric', () => {
  assert.equal(expected(1500, 1500), 0.5);
  assert.ok(Math.abs(expected(1600, 1400) + expected(1400, 1600) - 1) < 1e-12);
});

test('1v1 win from equal ratings moves K/2 each way', () => {
  const { ratings } = computeRatings([m(1, '2024-01-01', ['A', 'B'])]);
  assert.equal(ratings.A.rating, 1516);
  assert.equal(ratings.B.rating, 1484);
  assert.deepEqual([ratings.A.wins, ratings.A.losses, ratings.B.losses], [1, 0, 1]);
});

test('ratings are zero-sum across N-way matches', () => {
  const { ratings } = computeRatings([
    m(1, '2024-01-01', ['A', 'B', 'C', 'D']),
    m(2, '2024-02-01', ['D', 'A', 'C']),
    m(3, '2024-03-01', ['C', 'B']),
  ]);
  assert.ok(Math.abs(sum(ratings) - 1500 * 4) < 1e-9);
});

test('N-way match: K is scaled by 1/(N-1) so winner of 3-way from equal gains K/2', () => {
  const { ratings } = computeRatings([m(1, '2024-01-01', ['A', 'B', 'C'])]);
  assert.equal(ratings.A.rating, 1516);
  assert.equal(ratings.B.rating, 1500);
  assert.equal(ratings.C.rating, 1484);
});

test('ties score 0.5 and leave equal ratings unchanged', () => {
  const { ratings } = computeRatings([m(1, '2024-01-01', [['A', 'B']])]);
  assert.equal(ratings.A.rating, 1500);
  assert.equal(ratings.A.draws, 1);
});

test('matches are processed by date then id regardless of input order', () => {
  const a = [m(2, '2024-02-01', ['B', 'A']), m(1, '2024-01-01', ['A', 'B'])];
  const b = [...a].reverse();
  assert.deepEqual(computeRatings(a).ratings, computeRatings(b).ratings);
  assert.deepEqual(computeRatings(a).matches.map((x) => x.id), [1, 2]);
});

test('workload filter only uses matching matches', () => {
  const data = [m(1, '2024-01-01', ['A', 'B'], 'TPC-H'), m(2, '2024-01-02', ['B', 'C'], 'SSB')];
  const { ratings } = computeRatings(data, { workload: 'SSB' });
  assert.deepEqual(Object.keys(ratings).sort(), ['B', 'C']);
  assert.deepEqual(workloads(data), ['SSB', 'TPC-H']);
});

test('history records one point per engine per match, plus per-match deltas', () => {
  const { ratings, history, matches } = computeRatings([
    m(1, '2024-01-01', ['A', 'B']), m(2, '2024-02-01', ['A', 'C']),
  ]);
  assert.equal(history.A.length, 2);
  assert.equal(history.B.length, 1);
  assert.ok(Math.abs(matches[1].deltas.A - (ratings.A.rating - history.A[0].rating)) < 1e-9);
  assert.equal(ratings.A.lastDelta, matches[1].deltas.A);
});

test('rejects a match that lists an engine twice', () => {
  assert.throws(() => computeRatings([m(1, '2024-01-01', ['A', 'A'])]), /duplicate/i);
});

test('real data file is valid and produces a leaderboard', () => {
  const data = JSON.parse(readFileSync(new URL('../data/elo/matches.json', import.meta.url)));
  assert.equal(new Set(data.map((d) => d.id)).size, data.length, 'ids unique');
  for (const d of data) {
    assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(d.source, /^https?:\/\//);
    assert.ok(d.ranking.flat().length >= 2, `match ${d.id} needs 2+ engines`);
  }
  const { ratings } = computeRatings(data);
  assert.ok(Math.abs(sum(ratings) - 1500 * Object.keys(ratings).length) < 1e-6);
});

test('half-life decay: a match one half-life before asOf moves ratings half as much', () => {
  const { ratings, matches } = computeRatings([m(1, '2022-01-01', ['A', 'B'])], { asOf: '2024-01-01', halfLife: 2 });
  assert.ok(Math.abs(matches[0].weight - 0.5 ** (730 / 730.5)) < 1e-12);
  assert.ok(Math.abs(ratings.A.rating - (1500 + 16 * matches[0].weight)) < 1e-9);
});

test('half-life decay: asOf defaults to the newest match date, so the newest match has weight 1', () => {
  const { matches } = computeRatings([m(1, '2020-01-01', ['A', 'B']), m(2, '2024-01-01', ['B', 'A'])]);
  assert.equal(matches[1].weight, 1);
  assert.ok(Math.abs(matches[0].weight - 0.5 ** (1461 / 730.5)) < 1e-12, 'default half-life is 2 years');
});

test('half-life decay: asOf comes from all matches, not the filtered workload', () => {
  const data = [m(1, '2022-01-01', ['A', 'B'], 'SSB'), m(2, '2024-01-01', ['A', 'C'], 'TPC-H')];
  const { matches } = computeRatings(data, { workload: 'SSB' });
  assert.ok(matches[0].weight < 1);
});

test('half-life decay: halfLife Infinity/0/null disables decay; future matches get weight 1', () => {
  const data = [m(1, '2010-01-01', ['A', 'B']), m(2, '2024-01-01', ['B', 'A'])];
  for (const halfLife of [Infinity, 0, null]) {
    assert.deepEqual(computeRatings(data, { halfLife }).matches.map((x) => x.weight), [1, 1]);
  }
  assert.equal(computeRatings(data, { asOf: '2000-01-01' }).matches[0].weight, 1);
});

test('half-life decay: one recent loss outweighs two old wins (plain ELO says the opposite)', () => {
  const data = [m(1, '2016-01-01', ['A', 'B']), m(2, '2016-01-02', ['A', 'B']), m(3, '2024-01-01', ['B', 'A'])];
  const plain = computeRatings(data, { halfLife: Infinity }).ratings;
  assert.ok(plain.A.rating > plain.B.rating);
  const { ratings } = computeRatings(data);
  assert.ok(ratings.B.rating > ratings.A.rating);
  assert.ok(Math.abs(ratings.A.rating + ratings.B.rating - 3000) < 1e-9, 'still zero-sum');
});

test('playgrounds: a mixed match only counts within the chosen playground, places renumbered, ties kept', () => {
  const playgroundOf = { A: 'Engines', B: 'Table formats', C: 'Engines', D: 'Engines', E: 'Table formats' };
  const data = [m(1, '2024-01-01', ['B', 'A', ['C', 'E'], 'D'])];
  const eng = computeRatings(data, { playground: 'Engines', playgroundOf });
  assert.deepEqual(Object.keys(eng.ratings).sort(), ['A', 'C', 'D']);
  assert.deepEqual(eng.matches[0].ranking, ['A', ['C'], 'D']);
  assert.deepEqual(eng.matches[0].placings.map((p) => [p.engine, p.place]), [['A', 1], ['C', 2], ['D', 3]]);
  assert.equal(eng.ratings.A.rating, 1516, 'A wins its 3-way league match');
  const fmt = computeRatings(data, { playground: 'Table formats', playgroundOf });
  assert.deepEqual(Object.keys(fmt.ratings).sort(), ['B', 'E']);
  assert.equal(fmt.ratings.B.rating, 1516);
});

test('playgrounds: matches left with fewer than 2 engines are skipped; asOf still spans the whole file', () => {
  const playgroundOf = { A: 'Engines', B: 'Engines', X: 'Table formats', Y: 'Table formats' };
  const data = [m(1, '2022-01-01', ['X', 'Y']), m(2, '2024-01-01', ['A', 'X']), m(3, '2026-01-01', ['A', 'B'])];
  const fmt = computeRatings(data, { playground: 'Table formats', playgroundOf });
  assert.deepEqual(fmt.matches.map((x) => x.id), [1]);
  assert.ok(fmt.matches[0].weight < 0.3, 'weighted against 2026, not 2022');
  assert.deepEqual(computeRatings(data, { playground: 'Engines', playgroundOf }).matches.map((x) => x.id), [3]);
});

test('playgrounds: an engine with no playground is an error, not silently dropped', () => {
  assert.throws(() => computeRatings([m(1, '2024-01-01', ['A', 'Z'])], { playground: 'Engines', playgroundOf: { A: 'Engines' } }), /playground/i);
});

test('real data: every engine has a known playground and both leagues are non-empty', () => {
  const data = JSON.parse(readFileSync(new URL('../data/elo/matches.json', import.meta.url)));
  const engines = JSON.parse(readFileSync(new URL('../data/elo/engines.json', import.meta.url)));
  const playgroundOf = Object.fromEntries(Object.entries(engines).map(([e, v]) => [e, v.playground]));
  for (const [e, p] of Object.entries(playgroundOf)) assert.ok(PLAYGROUNDS.includes(p), `${e}: playground ${p}`);
  for (const p of PLAYGROUNDS) assert.ok(computeRatings(data, { playground: p, playgroundOf }).matches.length > 0, p);
});
