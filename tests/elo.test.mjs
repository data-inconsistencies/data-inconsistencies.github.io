import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeRatings, expected, workloads } from '../assets/js/elo.mjs';

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
    assert.ok(d.ranking.length >= 2, `match ${d.id} needs 2+ engines`);
  }
  const { ratings } = computeRatings(data);
  assert.ok(Math.abs(sum(ratings) - 1500 * Object.keys(ratings).length) < 1e-6);
});
