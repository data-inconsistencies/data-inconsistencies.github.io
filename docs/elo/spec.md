# Spec: ELO leaderboard

## Data
`data/elo/matches.json` — list of matches, oldest or newest order (engine sorts by date, then id).

```json
{ "id": 18,                                  // stable unique integer
  "date": "2024-04-17",                      // date the report was published
  "source": "https://pola.rs/posts/benchmarks/",
  "workload": "TPC-H",                       // TPC-H | TPC-DS | SSB | CH-benCHmark | Join Order Benchmark | other
  "ranking": ["Polars", "DuckDB", "Apache Spark", "Dask", "Pandas", "Modin"] }  // 1st → last
```
JSON (not YAML) so the same file is read by Hugo and by `node --test` with no dependencies.
Ties: an entry may be a list, e.g. `["A", ["B", "C"], "D"]` means B and C tie for 2nd.

Initial data is imported from the existing "RAW" sheet (19 matches, 2022-01 → 2024-06).

## Rating algorithm
- Every engine starts at **1500**.
- Matches are processed in (date, id) order.
- An N-way match is decomposed into all N·(N-1)/2 pairs. For each pair,
  expected score `E = 1 / (1 + 10^((Rb - Ra)/400))`, actual `S` = 1 / 0.5 / 0.
- Each engine's delta = `w · K / (N-1) · Σ (S - E)` over its pairs, with **K = 32**,
  computed from pre-match ratings and applied simultaneously (order-independent within a match).
- **Half-life decay:** `w = 0.5 ^ (age / halfLife)`, where `age` is the time between the match's date
  and the reference date `asOf`, and **halfLife = 2 years** (730.5 days). A report two years older
  than `asOf` moves ratings half as much as one published on `asOf`; four years, a quarter.
  - `asOf` defaults to the newest match date in the whole data file (not today, and not the
    filtered workload), so ratings are deterministic, change only when the data changes, and all
    workload views share one clock. Matches dated after `asOf` get `w = 1`.
  - `halfLife: Infinity` (or `0`/`null`) turns decay off (`w = 1`, plain ELO).
  - Decay scales each match's update; it does not pull ratings back toward 1500, so an inactive
    engine keeps its rating. Ratings stay zero-sum.
- **Playgrounds** are separate leagues: products of different kinds (query engines vs lakehouse
  table formats) are not rated against each other. Each engine's playground is the `playground`
  field in `data/elo/engines.json` (`Engines` or `Table formats`). Ratings are computed for one
  playground at a time: every match's ranking is cut down to that playground's engines (places
  renumbered, ties kept), and a match left with fewer than 2 engines is skipped. A report that
  mixes playgrounds therefore counts as one match per playground. `asOf` is still the newest match
  date in the whole file. With no `playground` option every engine is in one league (used by tests).
- The engine is a pure function:
  `computeRatings(matches, {k, initial, workload?, halfLife?, asOf?, playground?, playgroundOf?}) → {ratings, history, matches}`
  where `playgroundOf` maps engine → playground; each returned match carries its `weight`
  and its cut-down `ranking`.

## Page
`/rankings/`:
1. Playground switch (Engines by default, Table formats) and workload filter (All, TPC-H, TPC-DS, SSB,
   CH-benCHmark, Join Order Benchmark, only workloads with matches in the chosen playground) —
   recompute ratings from the filtered matches.
2. Leaderboard table: rank, engine, rating, Δ from last match, W-L-D (pairwise), matches played, last match date.
3. Rating history chart for the top engines (inline SVG, no external libs).
4. Match log, newest first, with result order, rating change per engine, match weight, and source link.
5. "How to add a report" note linking the data file on GitHub.
Homepage "Explore the live rankings" button and the main menu point to `/rankings/`.

## Acceptance
- `node --test tests/` passes (engine unit tests incl. zero-sum, N-way, ties, determinism).
- `hugo` builds with no errors; `/rankings/` renders leaderboard from the data file.
- Light and dark mode readable; works at 375px width.

## Discovering new matches (`npm run find-matches`)
`scripts/find-matches.mjs` asks Claude (Opus 5.5, with the server-side web search and
web fetch tools) to find public benchmark reports published after the newest match in
`data/elo/matches.json`, and to extract each report's overall ranking.

- **Input to the model:** newest match date, the canonical engine names, and every source
  URL already in the data (so known reports are skipped).
- **Output:** JSON matching a fixed schema (structured outputs): `date`, `source`,
  `workload`, `ranking` (fastest → slowest; nested array = tie), `evidence` (how the order
  was read from the report, e.g. "total runtime SF100 table").
- **Post-processing (pure, tested in `scripts/lib/candidates.mjs`):**
  engine names are mapped to canonical names through `data/elo/aliases.json`;
  candidates whose normalized URL + workload + date already exist are dropped (a page
  republished with new results on a later date is a new match); invalid
  candidates (bad date, <2 engines, duplicate engine, non-http source, future date) are
  rejected with a reason; survivors get the next free ids.
- **Default is a dry run** that prints candidates. `--write` appends them to
  `matches.json` with an `evidence` field. A human checks each one against its source in
  the PR diff before merge: the model can misread charts, and vendor reports are biased.
- Needs an Anthropic credential (`ANTHROPIC_API_KEY` or an `ant auth login` profile).

### Schedule
The search is run by hand, monthly. `.github/workflows/monthly-reminder.yaml` opens an issue on the
1st of each month assigned to the committers (GitHub emails them) and closes the previous one.
The runbook is `docs/elo/finding-matches.md`: run `npm run find-matches` with an API key, or ask
Claude Code to follow the same process. Nothing reaches the leaderboard until a human merges the PR.

## ClickBench column
The leaderboard shows, next to each engine's ELO, how the same product does on
[ClickBench](https://benchmark.clickhouse.com/) — a single-table, scan-heavy benchmark run by
ClickHouse, so a useful contrast to the join-heavy TPC suites behind the ELO.

- **Data:** `npm run clickbench` downloads ClickBench's `data.generated.js` (the file the site
  itself renders) and writes `data/elo/clickbench.json`. No API key needed. The monthly reminder
  workflow refreshes it and opens a PR when it changed.
- **Score:** a port of the site's default view (`scripts/lib/clickbench.mjs`): the "Combined"
  metric (60% hot run, 20% cold run, 10% load time, 10% data size, each a geometric mean of
  ratios to the best result, +10 ms per query, failed queries at 2× the system's worst), with
  the default filters (untuned, CPU, default machine list, categories elite/production/
  challenger/retired, in-memory engines excluded). Lower is better; ×1.00 is the best entry.
- **Mapping:** `data/elo/clickbench-map.json` lists, per ELO engine, the ClickBench systems that
  are that product (any storage variant or the vendor's cloud service; not third-party wrappers
  such as pg_duckdb or Spark accelerators). The engine gets its best-scoring entry.
- **Rank:** position among ClickBench systems, one row per system (the site's "best" toggle),
  e.g. `#14 of 120`. Engines with no entry in the default view show "—".
