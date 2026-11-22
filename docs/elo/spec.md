# Spec: ELO leaderboard

## Data
`data/elo/matches.json` — list of matches, oldest or newest order (engine sorts by date, then id).

```json
{ "id": 18,                                  // stable unique integer
  "date": "2024-04-17",                      // date the report was published
  "source": "https://pola.rs/posts/benchmarks/",
  "workload": "TPC-H",                       // TPC-H | TPC-DS | SSB | other
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
- Each engine's delta = `K / (N-1) · Σ (S - E)` over its pairs, with **K = 32**,
  computed from pre-match ratings and applied simultaneously (order-independent within a match).
- The engine is a pure function: `computeRatings(matches, {k, initial, workload?}) → {ratings, history, matches}`.

## Page
`/rankings/`:
1. Workload filter (All, TPC-H, TPC-DS, SSB) — recomputes ratings from the filtered matches.
2. Leaderboard table: rank, engine, rating, Δ from last match, W-L-D (pairwise), matches played, last match date.
3. Rating history chart for the top engines (inline SVG, no external libs).
4. Match log, newest first, with result order, rating change per engine, and source link.
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
`.github/workflows/find-matches.yaml` runs every Monday 06:00 UTC (and on manual dispatch).
It runs the tests, then `find-matches --write`. If `matches.json` changed it pushes
branch `bot/elo-new-matches` and opens (or updates) a PR listing each candidate with its
evidence. Nothing reaches the leaderboard until a human merges that PR.
Requires repo secret `ANTHROPIC_API_KEY` and the setting
"Allow GitHub Actions to create and approve pull requests".

## ClickBench column
The leaderboard shows, next to each engine's ELO, how the same product does on
[ClickBench](https://benchmark.clickhouse.com/) — a single-table, scan-heavy benchmark run by
ClickHouse, so a useful contrast to the join-heavy TPC suites behind the ELO.

- **Data:** `npm run clickbench` downloads ClickBench's `data.generated.js` (the file the site
  itself renders) and writes `data/elo/clickbench.json`. No API key needed. The weekly workflow
  refreshes it too.
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
