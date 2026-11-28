#!/usr/bin/env node
// Refresh data/elo/clickbench.json and the ClickBench matches in data/elo/matches.json
// from ClickBench's published results.
//   npm run clickbench            # download from GitHub
//   npm run clickbench -- <file>  # use a local copy of data.generated.js
// See docs/elo/spec.md ("ClickBench column", "ClickBench matches").

import { readFileSync, writeFileSync } from 'node:fs';
import { parseDataJs, scoreEntries, rankForEngines, clickbenchMatch, upsertClickbenchMatches, REFERENCE_MACHINES } from './lib/clickbench.mjs';

const SOURCE = 'https://raw.githubusercontent.com/ClickHouse/ClickBench/main/data.generated.js';
const MAP = new URL('../data/elo/clickbench-map.json', import.meta.url);
const OUT = new URL('../data/elo/clickbench.json', import.meta.url);
const MATCHES = new URL('../data/elo/matches.json', import.meta.url);

// Why a mapped engine has no entry in the default view, in the site's own terms.
function hiddenReasons(data, mapping, ranked) {
  const out = {};
  for (const [engine, systems] of Object.entries(mapping)) {
    if (ranked[engine]) continue;
    const entries = data.filter((e) => systems.includes(e.system));
    if (!entries.length) { out[engine] = 'no ClickBench entry'; continue; }
    const cats = new Set(entries.map((e) => e.category));
    if (entries.every((e) => (e.tags ?? []).includes('in-memory'))) out[engine] = 'in-memory engine, not scored by the Combined metric';
    else if ([...cats].every((c) => c === 'enthusiast' || c === 'joke')) out[engine] = `listed as "${[...cats][0]}", hidden by default`;
    else out[engine] = 'only tuned or non-default-machine results';
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
  const local = process.argv[2];
  let js;
  if (local) {
    js = readFileSync(local, 'utf8');
  } else {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${SOURCE}`);
    js = await res.text();
  }

  const data = parseDataJs(js);
  const mapping = JSON.parse(readFileSync(MAP, 'utf8'));
  const scored = scoreEntries(data);
  const { systems, engines } = rankForEngines(scored, mapping);

  const out = {
    source: 'https://benchmark.clickhouse.com/',
    metric: 'Combined, default view; lower is better, 1.00 = best',
    updated: new Date().toISOString().slice(0, 10),
    systems,
    engines: Object.fromEntries(Object.entries(engines).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, {
      rank: v.rank, score: Number(v.score.toFixed(2)), system: v.system, machine: v.machine, date: v.date,
    }])),
    hidden: hiddenReasons(data, mapping, engines),
  };
  // Keep the previous "updated" date when nothing else changed, so the monthly job opens no PR.
  try {
    const prev = JSON.parse(readFileSync(OUT, 'utf8'));
    if (JSON.stringify({ ...prev, updated: out.updated }) === JSON.stringify(out)) out.updated = prev.updated;
  } catch { /* first run */ }
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);

  for (const [engine, v] of Object.entries(out.engines)) {
    console.log(`${engine.padEnd(18)} #${String(v.rank).padEnd(4)} ×${v.score.toFixed(2).padEnd(7)} ${v.system} [${v.machine}]`);
  }
  for (const [engine, v] of Object.entries(out.hidden)) console.log(`${engine.padEnd(18)} — ${v}`);
  console.log(`${systems} ClickBench systems in the default view.`);

  const matches = JSON.parse(readFileSync(MATCHES, 'utf8'));
  const updated = upsertClickbenchMatches(matches, REFERENCE_MACHINES, (id, machine) => clickbenchMatch(scored, mapping, id, machine));
  writeFileSync(MATCHES, `${JSON.stringify(updated, null, 2)}\n`);
  for (const machine of REFERENCE_MACHINES) {
    const m = updated.find((x) => x.workload === 'ClickBench' && x.scale === machine);
    console.log(m ? `ClickBench match #${m.id} (${m.date}, ${machine}): ${m.ranking.map((r) => [r].flat().join(' = ')).join(' > ')}`
      : `No ClickBench match on ${machine}: fewer than two engines there.`);
  }
}

main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
