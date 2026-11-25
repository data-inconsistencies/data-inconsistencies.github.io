// Pure helpers for scripts/find-matches.mjs: no network, no SDK, fully unit-tested.

export const WORKLOADS = ['TPC-H', 'TPC-DS', 'SSB', 'ClickBench', 'CH-benCHmark', 'Join Order Benchmark', 'other'];

const flat = (ranking) => ranking.flatMap((e) => (Array.isArray(e) ? e : [e]));

export function normalizeUrl(url) {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '');
  return `${host}${path}`;
}

export function canonicalEngine(name, aliases, known) {
  const n = String(name).trim();
  if (aliases[n]) return aliases[n];
  const lower = n.toLowerCase();
  const alias = Object.keys(aliases).find((k) => k.toLowerCase() === lower);
  if (alias) return aliases[alias];
  return known.find((k) => k.toLowerCase() === lower) ?? n;
}

export function normalizeCandidate(c, aliases, known) {
  const fix = (e) => canonicalEngine(e, aliases, known);
  return {
    ...c,
    source: String(c.source ?? '').trim(),
    workload: String(c.workload ?? '').trim(),
    scale: String(c.scale ?? '').trim(),
    ranking: (c.ranking ?? []).map((e) => (Array.isArray(e) ? e.map(fix) : fix(e))),
  };
}

// Returns null when valid, otherwise a human-readable reason.
export function validateCandidate(c, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date ?? '') || Number.isNaN(Date.parse(c.date))) return 'date must be YYYY-MM-DD';
  if (c.date > today) return 'date is in the future';
  try {
    if (!/^https?:$/.test(new URL(c.source).protocol)) return 'source must be an http(s) URL';
  } catch {
    return 'source must be an http(s) URL';
  }
  if (!c.workload) return 'workload is required';
  const names = flat(c.ranking ?? []);
  if (names.length < 2) return 'ranking needs at least 2 engines';
  if (new Set(names).size !== names.length) return 'duplicate engine in ranking';
  if (names.some((n) => !n)) return 'empty engine name';
  return null;
}

export function knownEngines(matches) {
  return [...new Set(matches.flatMap((m) => flat(m.ranking)))].sort();
}

const scaleOf = (m) => Number(/^SF\s*([\d.]+)$/i.exec(m.scale ?? '')?.[1] ?? NaN);

// One benchmark run at several scales on one date is one day's testing, not several results: returns
// every match whose engines all appear, in the same order, in one larger-scale match of that page,
// workload and date. A different order stays: some products do better on small data than on large.
export function supersededRuns(matches) {
  const keyOf = (m) => JSON.stringify([normalizeUrl(m.source), m.workload, m.date]);
  const runs = matches
    .filter((m) => !Number.isNaN(scaleOf(m)))
    .map((m) => ({ m, key: keyOf(m), scale: scaleOf(m), place: new Map(m.ranking.flatMap((e, i) => [e].flat().map((n) => [n, i]))) }));
  const sameOrder = (big, small) => {
    const names = [...small.place.keys()];
    const cmp = (r, a, b) => Math.sign(r.place.get(a) - r.place.get(b));
    return names.every((a) => big.place.has(a)) && names.every((a) => names.every((b) => cmp(big, a, b) === cmp(small, a, b)));
  };
  const covers = (big, small) => big.key === small.key && big.scale > small.scale && sameOrder(big, small);
  return runs.filter((small) => runs.some((big) => covers(big, small))).map((r) => r.m);
}

// Returns `added` (with ids), `skipped` (with reasons) and `superseded`: ids of existing matches to remove.
export function mergeCandidates(existing, candidates, { aliases = {}, today = new Date().toISOString().slice(0, 10) } = {}) {
  const known = knownEngines(existing);
  // A report is the same match only if URL, workload and publication date all match:
  // a page republished with new results on a later date is a new match. A page that lists runs at
  // several scales gives one match per scale; a match without a scale covers the whole page.
  const keyOf = (m) => `${normalizeUrl(m.source)}|${m.workload}|${m.date}`;
  const seen = new Map();
  const isKnown = (m) => {
    const scales = seen.get(keyOf(m));
    return !!scales && (!m.scale || scales.has('') || scales.has(m.scale));
  };
  const remember = (m) => seen.set(keyOf(m), (seen.get(keyOf(m)) ?? new Set()).add(m.scale ?? ''));
  existing.forEach(remember);
  let nextId = Math.max(0, ...existing.map((m) => m.id)) + 1;
  const fresh = [];
  const skipped = [];

  for (const raw of candidates) {
    const c = normalizeCandidate(raw, aliases, known);
    const reason = validateCandidate(c, today);
    if (reason) { skipped.push({ candidate: c, reason }); continue; }
    if (isKnown(c)) { skipped.push({ candidate: c, reason: 'already in matches.json' }); continue; }
    remember(c);
    fresh.push(c);
  }

  const smaller = new Set(supersededRuns([...existing, ...fresh]));
  const added = [];
  for (const c of fresh) {
    if (smaller.has(c)) { skipped.push({ candidate: c, reason: 'all its engines finished in the same order at a larger scale that day' }); continue; }
    const comment = String(c.comment ?? '').trim();
    added.push({
      id: nextId++, date: c.date, source: c.source, workload: c.workload, ...(c.scale && { scale: c.scale }), ranking: c.ranking,
      ...(comment && { comment }), evidence: c.evidence,
    });
  }
  return { added, skipped, superseded: existing.filter((m) => smaller.has(m)).map((m) => m.id) };
}

export function buildPrompt(existing, { today = new Date().toISOString().slice(0, 10), maxResults = 10 } = {}) {
  const newest = existing.map((m) => m.date).sort().at(-1) ?? '2020-01-01';
  const sources = [...new Set(existing.map((m) => `${m.date} ${m.workload} ${m.source}`))].sort();
  return `You maintain an ELO leaderboard of analytics / OLAP query engines built from public benchmark reports.
Today is ${today}. The newest report already in the leaderboard was published ${newest}.

Find up to ${maxResults} public performance reports published after ${newest} that compare at least two
analytics engines (OLAP databases, query engines, dataframe libraries, cloud warehouses) on a named
benchmark such as TPC-H, TPC-DS, SSB, ClickBench, CH-benCHmark, or Join Order Benchmark (JOB). Vendor blogs, independent blogs, papers and docs
all count, including messy ones, as long as the results are public and the overall order is readable.

For each report:
1. Fetch the page and read the results yourself; do not rely on search snippets.
2. Determine the overall finishing order, fastest first, using the report's own headline measure
   (total runtime, geometric mean, or the number it summarizes with). Put engines the report calls
   equal in a nested array, e.g. ["A", ["B", "C"], "D"]. If one report covers several benchmarks,
   return one entry per benchmark. If a page is a list of separate runs (such as benchbox.dev), return
   one entry per benchmark, scale and run date, and never mix runs from different dates. Leave out
   a scale when all its engines (the same set, or a subset) are in one larger-scale entry of that date,
   in the same order; keep it when the order differs.
3. date = the report's publication date (YYYY-MM-DD). source = the canonical URL of the report.
4. evidence = one sentence saying which figure or table the order came from.
5. comment = a plain-language caveat shown to visitors, at most 280 characters: who ran the test if a
   vendor did, what was left out, known defects. Empty string if there is nothing to warn about.
6. scale = the data scale (e.g. "SF 10") when the entry is one scale of such a list of runs, otherwise
   an empty string.

Skip a report if you cannot determine a clear order or if it is not public. These reports are already
recorded (date, benchmark, URL). Skip them, unless the page has since been republished with new results
on a later date: then return it again with the new publication date and the new order.
${sources.map((s) => `- ${s}`).join('\n')}

Use these exact engine names when an engine matches one of them; otherwise use the engine's official name:
${knownEngines(existing).join(', ')}

Return only engines that were actually measured. Return an empty list if you find nothing new.`;
}

export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['matches'],
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'source', 'workload', 'scale', 'ranking', 'comment', 'evidence'],
        properties: {
          date: { type: 'string', description: 'Publication date, YYYY-MM-DD' },
          source: { type: 'string', description: 'Report URL' },
          workload: { type: 'string', enum: WORKLOADS },
          scale: { type: 'string', description: 'Data scale such as "SF 10" when the page lists separate runs by scale; empty otherwise.' },
          ranking: {
            type: 'array',
            description: 'Fastest first. A nested array means a tie.',
            items: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          },
          comment: { type: 'string', description: 'Caveat for visitors, at most 280 characters; empty if none.' },
          evidence: { type: 'string' },
        },
      },
    },
  },
};
