// WebMCP tools for /rankings/: lets an AI agent in the visitor's browser query the ELO data.
// Dependency-free (rating functions are injected) so `node --test` can run every tool.
// Spec: docs/elo/spec.md, "WebMCP". API: https://webmachinelearning.github.io/webmcp/

const ALL = 'All';
const MAX_LIMIT = 100;

// Bad input from the agent. Returned as { error } rather than thrown: see the spec.
class InputError extends Error {}

const round = (n, digits = 1) => Number(n.toFixed(digits)) + 0; // + 0 turns -0 into 0
const list = (names) => names.map((n) => `"${n}"`).join(', ');

// elo: { computeRatings, leaderboard, workloads, expected, PLAYGROUNDS }
// view: { get() -> {playground, workload, chartEngines}, set({playground, workload, chartEngines}) }
export function createTools({ matches, engines, workloadInfo, clickbench, aliases, elo, view }) {
  const { computeRatings, leaderboard, workloads, expected, PLAYGROUNDS } = elo;
  const playgroundOf = Object.fromEntries(Object.entries(engines).map(([e, v]) => [e, v.playground]));
  const allWorkloads = [ALL, ...workloads(matches)];
  const rate = (playground, workload) => computeRatings(matches, { playground, workload, playgroundOf });
  const hasMatches = (playground, workload) => rate(playground, workload).matches.length > 0;

  const canonical = new Map();
  for (const [alias, engine] of Object.entries(aliases)) canonical.set(alias.toLowerCase(), engine);
  for (const engine of Object.keys(engines)) canonical.set(engine.toLowerCase(), engine);

  // ---- Input checks. The schema is only a hint to the agent, so every argument is checked here. ----

  function pick(args, name, allowed, fallback) {
    const value = args[name];
    if (value === undefined || value === null) return fallback;
    const hit = typeof value === 'string' && allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase());
    if (!hit) throw new InputError(`Unknown ${name} ${JSON.stringify(value)}. Use one of: ${list(allowed)}.`);
    return hit;
  }

  function engineName(value, name) {
    if (typeof value !== 'string' || !value.trim()) throw new InputError(`"${name}" must be an engine name.`);
    const hit = canonical.get(value.trim().toLowerCase());
    if (!hit || !engines[hit]) {
      throw new InputError(`Unknown engine ${JSON.stringify(value)}. Known engines: ${list(Object.keys(engines))}.`);
    }
    return hit;
  }

  function limitOf(args, fallback) {
    const value = args.limit ?? fallback;
    if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
      throw new InputError(`"limit" must be a whole number from 1 to ${MAX_LIMIT}.`);
    }
    return value;
  }

  function sinceOf(args) {
    const value = args.since;
    if (value === undefined || value === null) return null;
    // Round-trip so that impossible dates such as 2025-02-31 are refused too.
    const ok = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
    if (!ok) throw new InputError('"since" must be a date written YYYY-MM-DD.');
    return value;
  }

  function requireMatches(playground, workload) {
    if (hasMatches(playground, workload)) return;
    const available = allWorkloads.filter((w) => hasMatches(playground, w));
    throw new InputError(`No ${workload} matches in the "${playground}" playground. Workloads with matches there: ${list(available)}.`);
  }

  // ---- Output shapes ----

  const clickbenchOf = (engine) => {
    const c = clickbench.engines[engine];
    return c ? { rank: c.rank, of: clickbench.systems, score: c.score, system: c.system, date: c.date } : null;
  };

  const record = (row, rank) => ({
    rank,
    rating: round(row.rating),
    lastChange: round(row.lastDelta),
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    matches: row.played,
    lastMatch: row.lastDate,
  });

  const standing = (board, engine) => {
    const i = board.findIndex((r) => r.engine === engine);
    return i < 0 ? null : record(board[i], i + 1);
  };

  // ---- Schemas ----

  const playgroundSchema = {
    type: 'string', enum: PLAYGROUNDS,
    description: 'Separate league: query engines and lakehouse table formats are never rated against each other. Default "Engines".',
  };
  const workloadSchema = {
    type: 'string', enum: allWorkloads,
    description: 'Benchmark to rate by. Default "All" (every benchmark together).',
  };
  const engineSchema = (description) => ({ type: 'string', description });

  // Runs a tool body, turning bad input into { error }. Real bugs still reject.
  const tool = (definition, run) => ({
    ...definition,
    inputSchema: { type: 'object', additionalProperties: false, ...definition.inputSchema },
    async execute(input, options) {
      try {
        return run(input ?? {}, options);
      } catch (e) {
        if (e instanceof InputError) return { error: e.message };
        throw e;
      }
    },
  });

  return [
    tool({
      name: 'get_leaderboard',
      title: 'Get leaderboard',
      description: 'Get the ELO ranking of analytics databases and query engines (or lakehouse table formats), computed from public benchmark reports, best first. Each row has the rating, win-loss-draw record, ClickBench rank, and what the product is best for. Use it to find the fastest engines overall or on one benchmark.',
      inputSchema: {
        properties: {
          playground: playgroundSchema,
          workload: workloadSchema,
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: 'Rows to return, from the top. Default 100.' },
        },
      },
      annotations: { readOnlyHint: true },
    }, (args) => {
      const playground = pick(args, 'playground', PLAYGROUNDS, PLAYGROUNDS[0]);
      const workload = pick(args, 'workload', allWorkloads, ALL);
      const limit = limitOf(args, MAX_LIMIT);
      requireMatches(playground, workload);
      const rated = rate(playground, workload);
      const board = leaderboard(rated.ratings);
      return {
        playground,
        workload,
        workloadDescription: workloadInfo[workload]?.description ?? null,
        engines: board.length,
        matches: rated.matches.length,
        note: 'Ratings start at 1500 and measure speed in published benchmarks, many run by vendors; they say nothing about price or features. ClickBench score: lower is better, 1.00 is best.',
        leaderboard: board.slice(0, limit).map((row, i) => ({
          engine: row.engine,
          ...record(row, i + 1),
          clickbench: clickbenchOf(row.engine),
          description: engines[row.engine]?.description ?? null,
          bestFor: engines[row.engine]?.bestFor ?? null,
        })),
      };
    }),

    tool({
      name: 'get_engine',
      title: 'Get engine details',
      description: 'Get one engine or table format in detail: what it is, what it is best for, its website, its ClickBench entry, and its ELO rank, rating and record overall and on each benchmark.',
      inputSchema: {
        properties: { engine: engineSchema('Engine name, such as "DuckDB" or "BigQuery".') },
        required: ['engine'],
      },
      annotations: { readOnlyHint: true },
    }, (args) => {
      const engine = engineName(args.engine, 'engine');
      const { playground, url, description, bestFor } = engines[engine];
      const byWorkload = {};
      for (const w of allWorkloads) {
        const board = leaderboard(rate(playground, w).ratings);
        const s = standing(board, engine);
        if (s) byWorkload[w] = { ...s, of: board.length };
      }
      return { engine, playground, url, description, bestFor, clickbench: clickbenchOf(engine), standings: byWorkload };
    }),

    tool({
      name: 'compare_engines',
      title: 'Compare two engines',
      description: 'Compare two engines head to head: both ratings, the expected score of the first against the second (0.5 = even), and every benchmark report in which both appear with their finishing places.',
      inputSchema: {
        properties: {
          engine_a: engineSchema('First engine.'),
          engine_b: engineSchema('Second engine, from the same playground.'),
          workload: workloadSchema,
        },
        required: ['engine_a', 'engine_b'],
      },
      annotations: { readOnlyHint: true },
    }, (args) => {
      const a = engineName(args.engine_a, 'engine_a');
      const b = engineName(args.engine_b, 'engine_b');
      const workload = pick(args, 'workload', allWorkloads, ALL);
      if (a === b) throw new InputError(`Both names mean ${a}. Give two different engines.`);
      const playground = playgroundOf[a];
      if (playground !== playgroundOf[b]) {
        throw new InputError(`${a} (${playground}) and ${b} (${playgroundOf[b]}) are in different playgrounds and are not rated against each other.`);
      }
      const rated = rate(playground, workload);
      const board = leaderboard(rated.ratings);
      const [ra, rb] = [rated.ratings[a], rated.ratings[b]];
      const headToHead = { a_wins: 0, b_wins: 0, draws: 0 };
      const met = [];
      for (const m of rated.matches) {
        const [pa, pb] = [a, b].map((e) => m.placings.find((p) => p.engine === e)?.place);
        if (pa === undefined || pb === undefined) continue;
        headToHead[pa < pb ? 'a_wins' : pa > pb ? 'b_wins' : 'draws']++;
        met.push({ id: m.id, date: m.date, workload: m.workload, scale: m.scale ?? null, source: m.source, a_place: pa, b_place: pb, engines: m.placings.length });
      }
      return {
        playground,
        workload,
        a: { engine: a, standing: standing(board, a) },
        b: { engine: b, standing: standing(board, b) },
        expectedScoreA: ra && rb ? round(expected(ra.rating, rb.rating), 3) : null,
        headToHead,
        matches: met.reverse(),
      };
    }),

    tool({
      name: 'search_matches',
      title: 'Search benchmark reports',
      description: 'Search the benchmark reports behind the ratings, newest first. Each result has the date, benchmark, source link, finishing order with rating changes, and notes on who ran it and how it was read.',
      inputSchema: {
        properties: {
          engine: engineSchema('Only reports that include this engine.'),
          playground: { ...playgroundSchema, description: 'League to show results for. Default: the league of "engine", or "Engines".' },
          workload: workloadSchema,
          since: { type: 'string', format: 'date', description: 'Only reports published on or after this date, YYYY-MM-DD.' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: 'Reports to return. Default 10.' },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
    }, (args) => {
      const engine = args.engine === undefined || args.engine === null ? null : engineName(args.engine, 'engine');
      const playground = pick(args, 'playground', PLAYGROUNDS, engine ? playgroundOf[engine] : PLAYGROUNDS[0]);
      const workload = pick(args, 'workload', allWorkloads, ALL);
      const since = sinceOf(args);
      const limit = limitOf(args, 10);
      if (engine && playgroundOf[engine] !== playground) {
        throw new InputError(`${engine} is in the "${playgroundOf[engine]}" playground, not "${playground}".`);
      }
      const found = rate(playground, workload).matches
        .filter((m) => (!engine || m.placings.some((p) => p.engine === engine)) && (!since || m.date >= since))
        .reverse();
      return {
        playground,
        workload,
        total: found.length,
        matches: found.slice(0, limit).map((m) => ({
          id: m.id,
          date: m.date,
          workload: m.workload,
          scale: m.scale ?? null,
          source: m.source,
          weight: round(m.weight, 2),
          results: m.placings.map((p) => ({ place: p.place, engine: p.engine, ratingChange: round(m.deltas[p.engine]) })),
          comment: m.comment ?? null,
          evidence: m.evidence ?? null,
        })),
      };
    }),

    tool({
      name: 'set_rankings_view',
      title: 'Change the rankings view',
      description: 'Change what the visitor sees on this page: the playground, the benchmark, and the engines drawn in the rating history chart. Settings you leave out stay as they are. Returns the view now showing.',
      inputSchema: {
        properties: {
          playground: { ...playgroundSchema, description: 'League to show.' },
          workload: { ...workloadSchema, description: 'Benchmark to show.' },
          chart_engines: {
            type: 'array', items: { type: 'string' },
            description: 'Engines to draw in the chart. An empty list goes back to the top 6.',
          },
        },
      },
      annotations: { readOnlyHint: false },
    }, (args, options) => {
      const now = view.get();
      const playground = pick(args, 'playground', PLAYGROUNDS, now.playground);
      let workload = pick(args, 'workload', allWorkloads, null);
      if (workload) requireMatches(playground, workload);
      else workload = hasMatches(playground, now.workload) ? now.workload : ALL;

      let chartEngines;
      if (args.chart_engines !== undefined && args.chart_engines !== null) {
        if (!Array.isArray(args.chart_engines)) throw new InputError('"chart_engines" must be a list of engine names.');
        chartEngines = [...new Set(args.chart_engines.map((e) => engineName(e, 'chart_engines')))];
        const { ratings } = rate(playground, workload);
        const missing = chartEngines.filter((e) => !ratings[e]);
        if (missing.length) throw new InputError(`Not in the ${playground} / ${workload} leaderboard: ${list(missing)}.`);
      }
      options?.signal?.throwIfAborted(); // last chance to cancel: the change below is immediate
      view.set({ playground, workload, chartEngines });
      return view.get();
    }),
  ];
}

// Registers every tool or none. Resolves to true when registered; never rejects.
export async function registerTools(modelContext, tools) {
  const controller = new AbortController();
  try {
    // async + allSettled, so that a synchronous throw or the abort cannot leave another registration's rejection unhandled.
    const results = await Promise.allSettled(tools.map(async (t) => modelContext.registerTool(t, { signal: controller.signal })));
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
    return true;
  } catch (e) {
    controller.abort();
    console.warn('WebMCP tools were not registered:', e);
    return false;
  }
}
