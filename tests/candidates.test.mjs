import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeUrl, canonicalEngine, normalizeCandidate, validateCandidate, mergeCandidates, buildPrompt,
  WORKLOADS, OUTPUT_SCHEMA,
} from '../scripts/lib/candidates.mjs';

const aliases = { Clickhouse: 'ClickHouse', PySpark: 'Apache Spark' };
const known = ['ClickHouse', 'Apache Spark', 'DuckDB'];
const existing = [{ id: 7, date: '2024-01-01', source: 'https://www.example.com/post/', workload: 'TPC-H', ranking: ['DuckDB', 'ClickHouse'] }];
const cand = (over = {}) => ({ date: '2025-03-01', source: 'https://blog.test/bench', workload: 'TPC-H', ranking: ['DuckDB', 'Apache Spark'], evidence: 'total runtime table', ...over });

test('normalizeUrl ignores scheme, www, trailing slash, query and hash', () => {
  assert.equal(normalizeUrl('https://www.Example.com/post/?utm=1#x'), normalizeUrl('http://example.com/post'));
});

test('canonicalEngine maps aliases and fixes case of known engines', () => {
  assert.equal(canonicalEngine('PySpark', aliases, known), 'Apache Spark');
  assert.equal(canonicalEngine('  duckdb ', aliases, known), 'DuckDB');
  assert.equal(canonicalEngine('clickhouse', aliases, known), 'ClickHouse');
  assert.equal(canonicalEngine('Velox', aliases, known), 'Velox');
});

test('normalizeCandidate canonicalizes names inside ties too', () => {
  const c = normalizeCandidate(cand({ ranking: [['Clickhouse', 'duckdb'], 'PySpark'] }), aliases, known);
  assert.deepEqual(c.ranking, [['ClickHouse', 'DuckDB'], 'Apache Spark']);
});

test('validateCandidate rejects bad input with a reason', () => {
  const today = '2026-01-01';
  assert.equal(validateCandidate(cand(), today), null);
  assert.match(validateCandidate(cand({ date: '03/01/2025' }), today), /date/);
  assert.match(validateCandidate(cand({ date: '2027-01-01' }), today), /future/);
  assert.match(validateCandidate(cand({ ranking: ['DuckDB'] }), today), /2 engines/);
  assert.match(validateCandidate(cand({ ranking: ['DuckDB', ['DuckDB', 'X']] }), today), /duplicate/);
  assert.match(validateCandidate(cand({ source: 'ftp://x' }), today), /source/);
  assert.match(validateCandidate(cand({ workload: '' }), today), /workload/);
});

test('mergeCandidates drops known sources, rejects invalid ones, assigns next ids', () => {
  const { added, skipped } = mergeCandidates(existing, [
    cand({ source: 'http://example.com/post', date: '2024-01-01' }),    // same report, workload and date -> skip
    cand({ source: 'http://example.com/post', date: '2025-05-01' }),    // same page republished later -> keep
    cand({ source: 'http://example.com/post', date: '2024-01-01', workload: 'TPC-DS' }), // new workload -> keep
    cand({ source: 'https://a.test/1' }),
    cand({ source: 'https://a.test/1' }),                  // duplicate within batch -> skip
    cand({ source: 'https://b.test/2', ranking: ['X'] }),  // invalid
  ], { aliases, today: '2026-01-01' });
  assert.deepEqual(added.map((m) => [m.id, m.workload, m.date]), [[8, 'TPC-H', '2025-05-01'], [9, 'TPC-DS', '2024-01-01'], [10, 'TPC-H', '2025-03-01']]);
  assert.equal(skipped.length, 3);
  assert.ok(skipped.every((s) => s.reason));
});

test('buildPrompt includes cutoff date, known engines and known sources', () => {
  const p = buildPrompt(existing, { today: '2026-01-01' });
  assert.match(p, /2024-01-01/);
  assert.match(p, /ClickHouse/);
  assert.match(p, /example\.com\/post/);
  assert.match(p, /2024-01-01 TPC-H https:\/\/www\.example\.com\/post\//, 'known sources listed with date and workload');
  assert.match(p, /republished/i);
});

test('aliases file maps only to engines spelled canonically elsewhere', () => {
  const a = JSON.parse(readFileSync(new URL('../data/elo/aliases.json', import.meta.url)));
  for (const [k, v] of Object.entries(a)) assert.notEqual(k, v);
});

test('CH-benCHmark and Join Order Benchmark are known workloads, offered to the search and allowed in its output', () => {
  const prompt = buildPrompt(existing, { today: '2026-01-01' });
  const allowed = OUTPUT_SCHEMA.properties.matches.items.properties.workload.enum;
  for (const w of ['CH-benCHmark', 'Join Order Benchmark']) {
    assert.ok(WORKLOADS.includes(w), `${w} missing from WORKLOADS`);
    assert.ok(allowed.includes(w), `${w} missing from OUTPUT_SCHEMA`);
    assert.ok(prompt.includes(w), `${w} missing from the prompt`);
  }
});

test('every recorded match uses a known workload spelling', () => {
  const matches = JSON.parse(readFileSync(new URL('../data/elo/matches.json', import.meta.url)));
  for (const m of matches) assert.ok(WORKLOADS.includes(m.workload), `match ${m.id}: unknown workload "${m.workload}"`);
});
