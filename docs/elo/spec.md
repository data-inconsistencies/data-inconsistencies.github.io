# Spec: ELO leaderboard

## Data
`data/elo/matches.json` — list of matches, oldest or newest order (engine sorts by date, then id).

```json
{ "id": 18,                                  // stable unique integer
  "date": "2024-04-17",                      // date the report was published
  "source": "https://pola.rs/posts/benchmarks/",
  "workload": "TPC-H",                       // TPC-H | TPC-DS | SSB | ClickBench | CH-benCHmark | Join Order Benchmark | other
  "ranking": ["Polars", "DuckDB", "Apache Spark", "Dask", "Pandas", "Modin"] }  // 1st → last
```
An optional `scale` (e.g. `"SF 10"`) marks one scale of a page that lists separate runs. On such a page
(benchbox.dev) a match is all the runs of one benchmark at one scale on one run date: `date` is the run
date, `source` the page filtered to that benchmark and scale, and runs from different dates are never
combined. A run list is left out when every engine in it also ran that benchmark at a larger scale in one
match on that date (the same engines, or a subset of them) and they finished in the same order, so one
result is not counted two or three times. A scale stays a match of its own when it has an engine that the
larger match lacks, or when its engines finished in a different order: some products do better on small
data than on large. The scale is shown next to the workload in the match log and does not affect ratings. ClickBench
matches use `scale` for the machine instead (see "ClickBench matches").
Two optional text fields explain a match. `comment` is a short plain-language caveat for visitors
(at most 280 characters: who ran it, what was left out, known defects) and is always visible in the
match log. `evidence` is the longer record of which table or figure the order came from; the log
shows it behind a "How we read this report" toggle. Neither affects ratings.
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
   ClickBench, CH-benCHmark, Join Order Benchmark, only workloads with matches in the chosen playground) —
   recompute ratings from the filtered matches. Below the buttons, a short panel describes the chosen
   benchmark: what it is, its shape (tables, queries, schema), what it tests (joins, flat-table scans,
   optimizer, …) and a link. Text lives in `data/elo/workloads.json`; every workload needs an entry
   (a test checks), and "All" has one too.
2. Leaderboard table: rank, engine, rating, Δ from last match, W-L-D (pairwise), matches played, last match date.
   Hovering over a column heading with a dotted underline explains it.
3. Rating history chart for the top engines (inline SVG, no external libs).
4. Match log, newest first, with result order, rating change per engine, match weight, source link,
   and the match's `comment` and `evidence` when it has them.
5. "How to add a report" note linking the data file on GitHub.
6. Discussion: one GitHub Discussions thread for the page, through giscus (the only third-party widget here; needs a
   GitHub account to post). It follows the light/dark toggle. Comments never affect ratings.
The main menu, the homepage hero and the homepage standings all point to `/rankings/`.

## Homepage standings
The `elo-top` block (`layouts/_partials/hbx/blocks/elo-top/block.html`) shows the top 5 of the Engines playground
across all workloads, computed in the browser with the same `computeRatings` and data as `/rankings/`, so the two
pages cannot disagree. Columns: rank, engine, rating, W–L and matches (a thin record should be visible). Only each match's `id`, `date` and `ranking` are embedded. Below the table: the number of
engines and matches in that playground and the newest report's date. Without JavaScript it shows a link to
`/rankings/`.

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
  `workload`, `scale` (empty unless the page lists runs by scale), `ranking` (fastest → slowest; nested array = tie), `evidence` (how the order
  was read from the report, e.g. "total runtime SF100 table").
- **Post-processing (pure, tested in `scripts/lib/candidates.mjs`):**
  engine names are mapped to canonical names through `data/elo/aliases.json`;
  candidates whose normalized URL + workload + date (+ scale, when both have one) already exist are
  dropped (a page republished with new results on a later date is a new match); a match
  whose engines all appear, in the same order, in a larger-scale match on the same page with the same
  workload and date is dropped (candidates are skipped, recorded matches are returned as `superseded`); invalid
  candidates (bad date, <2 engines, duplicate engine, non-http source, future date) are
  rejected with a reason; survivors get the next free ids.
- **Default is a dry run** that prints candidates. `--write` appends them to
  `matches.json` with an `evidence` field and removes the superseded matches. A human checks each one against its source in
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

## ClickBench matches
ClickBench also counts as matches (workload `ClickBench`), one per reference machine: **c6a.4xlarge**
(16 vCPU, ClickBench's long-standing reference) and **c8g.metal-48xl** (192-core Graviton). Both are
written by the same `npm run clickbench` into `data/elo/matches.json`, so the column and the matches
always come from one download. The two machines reward different things (DuckDB does relatively better
on the small one, Polars and DataFusion on the big one), so both count; this does mean ClickBench moves
the engines in both about twice as much as a single report.

- **Like with like:** each match uses only entries on its machine, from the scored default view above.
  Each ELO engine gets its best entry there (same mapping as the column); engines with no entry on that
  machine (cloud services, serverless) are not in the match. The order is by Combined score, best
  first; engines whose scores round to the same two decimals tie. The machine is the match's `scale`,
  shown next to the workload in the match log.
- **Counted once per machine:** ClickBench is a live leaderboard, not a dated report, so there is
  exactly one ClickBench match per machine. Each refresh replaces it in place and keeps its `id` (a new
  one gets the next free id); a ClickBench match for a machine no longer in the list is removed. Its
  `date` is the newest result date among the entries in it, so a refresh that changes no result changes
  nothing, and decay ages it like any report.
- `source` is `https://benchmark.clickhouse.com/`; `comment` says ClickHouse runs the benchmark, it is
  one flat table, and which machine; `evidence` lists each engine's system, score and result date.
- `find-matches` already skips the page, since its URL is in the data.

## WebMCP (tools for AI agents)
`/rankings/` registers [WebMCP](https://webmachinelearning.github.io/webmcp/) tools, so an AI agent
in the visitor's browser can query the rankings as data instead of scraping the page. WebMCP is a
W3C Community Group draft (read 2026-11-24) in a Chrome origin trial; the tools use only its
imperative API, `document.modelContext.registerTool`.

| Tool | Does | Hints |
|------|------|-------|
| `get_leaderboard` | Ratings table for a playground + workload, best first; `limit` 1–100 | read-only |
| `get_engine` | One engine: product info, ClickBench entry, rank and record overall and per workload | read-only |
| `compare_engines` | Two engines: ratings, expected score, and every match both played | read-only |
| `search_matches` | Match log, newest first, filtered by engine, workload, playground, `since` date; `limit` 1–100 | read-only, untrusted content |
| `set_rankings_view` | Changes what the visitor sees: playground, workload, engines in the chart | changes the page |

- Definitions are in `assets/js/webmcp.mjs` (no imports; the rating functions are passed in), so
  `node --test` runs every tool without a browser. Numbers come from `computeRatings` — the same
  code the table uses, never a second implementation.
- Read-only tools default to `Engines` / `All`, whatever the visitor has selected, so the same call
  always gives the same answer. `set_rankings_view` goes through the same function as the buttons;
  omitted settings keep their value, except that a workload with no matches in the new playground
  falls back to `All` (as the buttons do). An agent's chart selection is not saved to the browser.
- Engine names are matched case-insensitively and through `data/elo/aliases.json`.
- Bad input returns `{ "error": "…" }` naming the valid values and changes nothing. It does not
  throw: the WebMCP draft reduces a rejected tool call to a bare `OperationError`, which an agent cannot
  learn from.
- `search_matches` is marked untrusted because `comment` and `evidence` summarise third-party pages.
- Registration is all or nothing: if one tool is refused, the others are unregistered.
  Browsers without `document.modelContext` do not download the module, and a WebMCP failure never
  breaks the page.
- Origin trial: until WebMCP ships by default, Chrome visitors only get the tools if the page carries
  an origin-trial token. Set `webmcp.originTrialToken` in `config/_default/params.yaml` (tokens are
  public, per origin, and expire). Empty = no tag; local testing uses
  `chrome://flags/#enable-webmcp-testing`.
