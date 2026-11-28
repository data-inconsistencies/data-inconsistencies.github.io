// Port of the default ranking on https://benchmark.clickhouse.com/ (ClickBench's index.html,
// renderSummary/relativeQueryTime/metricExcludes). Pure: no network. See docs/elo/spec.md.

const CONSTANT_TIME_ADD = 0.01;
const MISSING_RESULT_PENALTY = 2;
const MISSING_RESULT_TIME = 300;
const SHARE = { load: 0.1, size: 0.1, cold: 0.2, hot: 0.6 };

// Machines shown by default: the AWS whitelist minus the small/odd ones the site leaves unselected,
// plus every non-EC2 machine name (cloud service sizes such as "Snowflake: L").
const DEFAULT_AWS_MACHINES = new Set(['c6a.4xlarge', 'c7a.metal-48xl', 'c8g.metal-48xl', 'p5.4xlarge']);
const AWS_MACHINE = /^[a-z]+[0-9]+[a-z]*\.[0-9a-z-]+$/;
const DEFAULT_CATEGORIES = new Set(['elite', 'production', 'challenger', 'retired']);

// data.generated.js is `const data = [ {...}\n,{...}\n];` — one JSON object per line.
// Parse it as JSON instead of evaluating downloaded code.
export function parseDataJs(js) {
  const start = js.indexOf('[');
  const end = js.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('Unrecognized ClickBench data file');
  return JSON.parse(js.slice(start, end + 1));
}

export function inDefaultView(e) {
  const tags = e.tags ?? [];
  const machineShown = AWS_MACHINE.test(e.machine) ? DEFAULT_AWS_MACHINES.has(e.machine) : true;
  return machineShown
    && e.tuned === 'no'
    && (e.proprietary === 'yes' || e.proprietary === 'no')
    && (e.hardware === 'cpu' || !e.hardware)
    && DEFAULT_CATEGORIES.has(e.category)
    && tags.length > 0
    && !e.hide
    && !tags.includes('in-memory'); // excluded from the Combined metric
}

export function selectRun(timings, metric) {
  if (timings == null) return null;
  const cold = timings[0];
  const hot = timings[1] !== null && timings[2] !== null ? Math.min(timings[1], timings[2]) : null;
  if (metric === 'cold') return cold;
  if (metric === 'hot') return hot;
  return hot !== null && cold !== null ? (hot * SHARE.hot + cold * SHARE.cold) / (SHARE.hot + SHARE.cold) : null;
}

function relativeQueryTime(baseline, e, metric) {
  const fallback = MISSING_RESULT_PENALTY * Math.max(MISSING_RESULT_TIME, ...e.result.map((t) => selectRun(t, metric)));
  let acc = 0;
  let used = 0;
  baseline.forEach((runs, i) => {
    const base = selectRun(runs, metric);
    if (base === null || !Number.isFinite(base)) return;
    const curr = selectRun(e.result[i], metric) ?? fallback;
    acc += Math.log((CONSTANT_TIME_ADD + curr) / (CONSTANT_TIME_ADD + base));
    used++;
  });
  return used ? Math.exp(acc / used) : null;
}

const excludesCold = (e) => (e.tags ?? []).includes('in-memory') || (e.tags ?? []).includes('no-cold');
const excludesLoad = (e) => !(e.load_time >= 5) || (e.tags ?? []).includes('stateless') || (e.tags ?? []).includes('in-memory');
const excludesSize = (e) => !(e.data_size >= 1e9);

// Returns the entries in the default view with their Combined score, best (lowest) first.
export function scoreEntries(data) {
  const shown = data.filter(inDefaultView);
  if (!shown.length) return [];
  const numQueries = shown[0].result.length;
  const coldCandidates = shown.filter((e) => !excludesCold(e));
  const baseline = [...Array(numQueries).keys()].map((qi) => [0, 1, 2].map((run) =>
    Math.min(...(run === 0 ? coldCandidates : shown).map((e) => e.result[qi]?.[run]).filter((x) => x != null))));
  const minLoad = Math.min(...shown.filter((e) => !excludesLoad(e)).map((e) => e.load_time));
  const minSize = Math.min(...shown.filter((e) => !excludesSize(e)).map((e) => e.data_size));

  return shown.map((e) => {
    const noCold = excludesCold(e);
    const noLoad = excludesLoad(e);
    const noSize = excludesSize(e);
    let log = (noCold ? SHARE.cold + SHARE.hot : SHARE.hot) * Math.log(relativeQueryTime(baseline, e, 'hot'));
    if (!noCold) log += SHARE.cold * Math.log(relativeQueryTime(baseline, e, 'cold'));
    if (!noLoad) log += SHARE.load * Math.log(e.load_time / minLoad);
    if (!noSize) log += SHARE.size * Math.log(e.data_size / minSize);
    if (noLoad || noSize) log /= 1 - (noLoad ? SHARE.load : 0) - (noSize ? SHARE.size : 0);
    return { system: e.system, machine: e.machine, date: e.date, source: e.source, score: Math.exp(log) };
  }).sort((a, b) => a.score - b.score);
}

// mapping: { eloEngine: [clickbench system names] }. Rank is among systems, one row per system.
export function rankForEngines(scored, mapping) {
  const bestPerSystem = [];
  const seen = new Set();
  for (const s of scored) if (!seen.has(s.system)) { seen.add(s.system); bestPerSystem.push(s); }
  const rankOf = new Map(bestPerSystem.map((s, i) => [s.system, i + 1]));

  const engines = {};
  for (const [engine, systems] of Object.entries(mapping)) {
    const best = bestPerSystem.find((s) => systems.includes(s.system));
    if (best) engines[engine] = { ...best, rank: rankOf.get(best.system) };
  }
  return { systems: bestPerSystem.length, engines };
}

// The single ClickBench match (docs/elo/spec.md, "ClickBench match"): best entry per engine on the
// reference machine, ordered by Combined score; equal scores at two decimals tie.
export const CLICKBENCH_SOURCE = 'https://benchmark.clickhouse.com/';
export const REFERENCE_MACHINE = 'c6a.4xlarge';
const COMMENT = 'Run and published by ClickHouse. One flat table (web analytics hits), so no joins: it tests scans, '
  + 'filters and aggregation. Only entries on the reference c6a.4xlarge machine, which leaves out cloud services.';

export function clickbenchMatch(scored, mapping, id) {
  const best = [];
  for (const [engine, systems] of Object.entries(mapping)) {
    const e = scored.filter((s) => s.machine === REFERENCE_MACHINE && systems.includes(s.system))
      .sort((a, b) => a.score - b.score)[0];
    if (e) best.push({ engine, ...e, rounded: e.score.toFixed(2) });
  }
  if (best.length < 2) return null;
  best.sort((a, b) => a.score - b.score || a.engine.localeCompare(b.engine));

  const ranking = [];
  for (let i = 0; i < best.length;) {
    let j = i;
    while (j + 1 < best.length && best[j + 1].rounded === best[i].rounded) j++;
    const group = best.slice(i, j + 1).map((b) => b.engine);
    ranking.push(group.length > 1 ? group : group[0]);
    i = j + 1;
  }
  const date = best.map((b) => b.date).sort().at(-1);
  return {
    id,
    date,
    source: CLICKBENCH_SOURCE,
    workload: 'ClickBench',
    ranking,
    comment: COMMENT,
    evidence: `ClickBench default view, Combined score (lower is better, ×1.00 = best of all entries), `
      + `${REFERENCE_MACHINE} only, best entry per product: `
      + best.map((b) => `${b.engine}: ${b.system} ×${b.rounded} (${b.date})`).join('; ')
      + `. Dated to the newest of these results; written by npm run clickbench, which replaces this match on each refresh.`,
  };
}

// Put the ClickBench match built by build(id) where the old one was (keeping its id), or append it
// with the next free id. build returning null removes it.
export function upsertClickbenchMatch(matches, build) {
  const i = matches.findIndex((m) => m.workload === 'ClickBench' && m.source === CLICKBENCH_SOURCE);
  const id = i >= 0 ? matches[i].id : Math.max(0, ...matches.map((m) => m.id)) + 1;
  const match = build(id);
  const out = matches.filter((_, k) => k !== i);
  if (match) out.splice(i >= 0 ? i : out.length, 0, match);
  return out;
}
