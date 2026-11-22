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
