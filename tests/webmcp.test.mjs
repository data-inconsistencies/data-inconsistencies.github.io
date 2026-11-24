import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as elo from '../assets/js/elo.mjs';
import { createTools, registerTools } from '../assets/js/webmcp.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = {
  matches: read('../data/elo/matches.json'),
  engines: read('../data/elo/engines.json'),
  workloadInfo: read('../data/elo/workloads.json'),
  clickbench: read('../data/elo/clickbench.json'),
  aliases: read('../data/elo/aliases.json'),
};

function setup(overrides = {}) {
  let state = { playground: 'Engines', workload: 'All', chartEngines: ['DuckDB'] };
  const sets = [];
  const view = {
    get: () => ({ ...state }),
    set: (v) => { sets.push(v); state = { ...state, ...v, chartEngines: v.chartEngines ?? state.chartEngines }; },
  };
  const tools = createTools({ ...data, elo, view, ...overrides });
  const call = (name, input, options) => tools.find((t) => t.name === name).execute(input, options);
  return { tools, call, sets, view };
}

const rated = (playground, workload) => elo.computeRatings(data.matches, {
  playground, workload,
  playgroundOf: Object.fromEntries(Object.entries(data.engines).map(([e, v]) => [e, v.playground])),
});

test('tool definitions satisfy the WebMCP registration rules', () => {
  const { tools } = setup();
  assert.deepEqual(tools.map((t) => t.name), ['get_leaderboard', 'get_engine', 'compare_engines', 'search_matches', 'set_rankings_view']);
  for (const t of tools) {
    assert.match(t.name, /^[A-Za-z0-9_.-]{1,128}$/);
    assert.ok(t.description.trim(), `${t.name} has no description`);
    assert.equal(t.inputSchema.type, 'object');
    for (const r of t.inputSchema.required ?? []) assert.ok(t.inputSchema.properties[r], `${t.name}: ${r} is required but not defined`);
    assert.doesNotThrow(() => JSON.stringify(t.inputSchema));
    assert.equal(t.annotations.readOnlyHint, t.name !== 'set_rankings_view');
  }
  assert.equal(tools.find((t) => t.name === 'search_matches').annotations.untrustedContentHint, true);
});

test('get_leaderboard matches the ELO engine, and defaults to Engines / All', async () => {
  const { call } = setup();
  const out = await call('get_leaderboard', {});
  const board = elo.leaderboard(rated('Engines', 'All').ratings);
  assert.equal(out.playground, 'Engines');
  assert.equal(out.workload, 'All');
  assert.equal(out.engines, board.length);
  assert.deepEqual(out.leaderboard.map((r) => r.engine), board.map((r) => r.engine));
  assert.equal(out.leaderboard[0].rank, 1);
  assert.ok(Math.abs(out.leaderboard[0].rating - board[0].rating) <= 0.05);
});

test('get_leaderboard ignores the view the visitor has open', async () => {
  const { call, view } = setup();
  view.set({ playground: 'Table formats', workload: 'All' });
  assert.equal((await call('get_leaderboard', {})).playground, 'Engines');
});

test('a missing input object is treated as empty', async () => {
  const { call } = setup();
  assert.ok((await call('get_leaderboard', undefined)).leaderboard.length);
});

test('get_leaderboard filters by playground, workload and limit', async () => {
  const { call } = setup();
  const out = await call('get_leaderboard', { workload: 'tpc-ds', limit: 2 });
  assert.equal(out.workload, 'TPC-DS');
  assert.equal(out.leaderboard.length, 2);
  const tf = await call('get_leaderboard', { playground: 'Table formats' });
  for (const r of tf.leaderboard) assert.equal(data.engines[r.engine].playground, 'Table formats');
});

test('bad input returns an error naming the valid values', async () => {
  const { call, sets } = setup();
  const bad = [
    ['get_leaderboard', { workload: 'TPC-Z' }, /TPC-H/],
    ['get_leaderboard', { playground: 7 }, /Table formats/],
    ['get_leaderboard', { limit: 0 }, /1 to 100/],
    ['get_leaderboard', { limit: '5' }, /1 to 100/],
    ['get_leaderboard', { playground: 'Table formats', workload: 'Join Order Benchmark' }, /Workloads with matches/],
    ['get_engine', {}, /engine name/],
    ['get_engine', { engine: 'NoSuchDB' }, /DuckDB/],
    ['get_engine', { engine: '__proto__' }, /Unknown engine/],
    ['compare_engines', { engine_a: 'DuckDB', engine_b: 'duckdb' }, /two different/],
    ['compare_engines', { engine_a: 'DuckDB', engine_b: 'Apache Hudi' }, /different playgrounds/],
    ['search_matches', { since: '2025-02-31' }, /YYYY-MM-DD/],
    ['search_matches', { since: 'last year' }, /YYYY-MM-DD/],
    ['search_matches', { engine: 'DuckDB', playground: 'Table formats' }, /playground/],
    ['set_rankings_view', { playground: 'Table formats', workload: 'Join Order Benchmark' }, /Workloads with matches/],
    ['set_rankings_view', { chart_engines: 'DuckDB' }, /list/],
    ['set_rankings_view', { chart_engines: ['Apache Hudi'] }, /Not in the Engines/],
  ];
  for (const [name, input, pattern] of bad) {
    const out = await call(name, input);
    assert.match(out.error ?? '', pattern, `${name} ${JSON.stringify(input)} -> ${JSON.stringify(out).slice(0, 120)}`);
  }
  assert.deepEqual(sets, [], 'bad input must not change the view');
});

test('get_engine resolves aliases and any letter case', async () => {
  const { call } = setup();
  for (const name of ['BigQuery', ' bigquery ', 'GOOGLE BIGQUERY']) {
    const out = await call('get_engine', { engine: name });
    assert.equal(out.engine, 'Google BigQuery');
    assert.ok(out.standings.All.rank >= 1);
  }
});

test('get_engine works for every engine, and only lists workloads it played', async () => {
  const { call } = setup();
  for (const engine of Object.keys(data.engines)) {
    const out = await call('get_engine', { engine });
    assert.equal(out.engine, engine);
    assert.ok(out.standings.All, `${engine} has no overall standing`);
    for (const w of Object.keys(out.standings)) assert.ok(rated(out.playground, w).ratings[engine]);
  }
});

test('compare_engines is symmetric and agrees with the match log', async () => {
  const { call } = setup();
  const ab = await call('compare_engines', { engine_a: 'ClickHouse', engine_b: 'DuckDB' });
  const ba = await call('compare_engines', { engine_a: 'DuckDB', engine_b: 'ClickHouse' });
  assert.ok(ab.matches.length > 0);
  assert.equal(ab.headToHead.a_wins, ba.headToHead.b_wins);
  assert.equal(ab.headToHead.draws, ba.headToHead.draws);
  assert.ok(Math.abs(ab.expectedScoreA + ba.expectedScoreA - 1) < 0.002);
  const { a_wins, b_wins, draws } = ab.headToHead;
  assert.equal(a_wins + b_wins + draws, ab.matches.length);
  for (const m of ab.matches) {
    const raw = data.matches.find((x) => x.id === m.id).ranking.flat();
    assert.ok(raw.includes('ClickHouse') && raw.includes('DuckDB'));
  }
});

test('compare_engines has no expected score when one engine did not play the workload', async () => {
  const { call } = setup();
  const jobRatings = rated('Engines', 'Join Order Benchmark').ratings;
  const absent = Object.keys(data.engines).find((e) => data.engines[e].playground === 'Engines' && !jobRatings[e]);
  const out = await call('compare_engines', { engine_a: Object.keys(jobRatings)[0], engine_b: absent, workload: 'Join Order Benchmark' });
  assert.equal(out.expectedScoreA, null);
  assert.equal(out.b.standing, null);
});

test('search_matches filters, sorts newest first and reports the total', async () => {
  const { call } = setup();
  const out = await call('search_matches', { engine: 'DuckDB', since: '2024-01-01', limit: 3 });
  assert.ok(out.total >= out.matches.length && out.matches.length <= 3);
  const dates = out.matches.map((m) => m.date);
  assert.deepEqual(dates, dates.slice().sort().reverse());
  for (const m of out.matches) {
    assert.ok(m.date >= '2024-01-01');
    assert.ok(m.results.some((r) => r.engine === 'DuckDB'));
  }
});

test('search_matches uses the engine\'s own playground by default', async () => {
  const { call } = setup();
  const out = await call('search_matches', { engine: 'Hudi' });
  assert.equal(out.playground, 'Table formats');
  assert.ok(out.total > 0);
});

test('set_rankings_view changes only what it is given and reports the result', async () => {
  const { call, sets } = setup();
  const out = await call('set_rankings_view', { workload: 'TPC-H' });
  assert.deepEqual(sets, [{ playground: 'Engines', workload: 'TPC-H', chartEngines: undefined }]);
  assert.equal(out.workload, 'TPC-H');
  await call('set_rankings_view', { chart_engines: ['clickhouse', 'ClickHouse Local', 'DuckDB'] });
  assert.deepEqual(sets[1], { playground: 'Engines', workload: 'TPC-H', chartEngines: ['ClickHouse', 'DuckDB'] });
  await call('set_rankings_view', { chart_engines: [] });
  assert.deepEqual(sets[2].chartEngines, []);
});

test('set_rankings_view falls back to All when the open workload has no matches in the new playground', async () => {
  const { call, view } = setup();
  view.set({ playground: 'Engines', workload: 'Join Order Benchmark' });
  assert.equal((await call('set_rankings_view', { playground: 'Table formats' })).workload, 'All');
});

test('set_rankings_view does nothing when the agent has already cancelled', async () => {
  const { call, sets } = setup();
  await assert.rejects(call('set_rankings_view', { workload: 'TPC-H' }, { signal: AbortSignal.abort() }));
  assert.deepEqual(sets, []);
});

test('a real bug rejects instead of looking like bad input', async () => {
  const { call } = setup({ view: { get: () => { throw new TypeError('boom'); } } });
  await assert.rejects(call('set_rankings_view', {}), /boom/);
});

test('every result survives JSON serialisation', async () => {
  const { call } = setup();
  for (const [name, input] of [['get_leaderboard', {}], ['get_engine', { engine: 'DuckDB' }], ['search_matches', {}],
    ['compare_engines', { engine_a: 'DuckDB', engine_b: 'Trino' }], ['set_rankings_view', {}]]) {
    const out = await call(name, input);
    assert.equal(out.error, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
  }
});

// Stand-in for document.modelContext that unregisters on abort, as the draft says.
function fakeContext(refuse = () => {}) {
  const live = new Map();
  return {
    live,
    registerTool(tool, { signal }) {
      refuse(tool);
      live.set(tool.name, tool);
      signal.addEventListener('abort', () => live.delete(tool.name));
      return Promise.resolve();
    },
  };
}

test('registerTools registers every tool', async () => {
  const ctx = fakeContext();
  assert.equal(await registerTools(ctx, setup().tools), true);
  assert.equal(ctx.live.size, 5);
});

test('registerTools is all or nothing and never rejects', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const ctx = fakeContext((tool) => { if (tool.name === 'search_matches') throw new Error('refused'); });
  assert.equal(await registerTools(ctx, setup().tools), false);
  assert.equal(ctx.live.size, 0);
});
