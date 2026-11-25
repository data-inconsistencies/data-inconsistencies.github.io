# Finding new ELO matches (monthly, by hand)

A GitHub issue labelled `elo-reminder` is opened on the 1st of each month and assigned to the
committers (`.github/workflows/monthly-reminder.yaml`). Use this runbook to answer it.

## Option A: the script (needs an Anthropic API key)

```bash
npm ci
ANTHROPIC_API_KEY=sk-ant-... npm run find-matches           # dry run: prints candidates
ANTHROPIC_API_KEY=sk-ant-... npm run find-matches -- --write # appends them to data/elo/matches.json
```

The script asks Claude (Opus 5.5, with web search and fetch) for reports newer than the newest
match, then validates them with `scripts/lib/candidates.mjs` (canonical engine names, duplicate
check on URL + workload + date, basic validation). Each added match carries an `evidence` note.

## Option B: Claude Code (no API key)

Open this repo in Claude Code and ask:

> Follow docs/elo/finding-matches.md: search for public benchmark reports published after the
> newest match in data/elo/matches.json, read each one, and add the valid ones through
> mergeCandidates in scripts/lib/candidates.mjs.

What it should do, and what to check it did:

1. Search for TPC-H, TPC-DS, SSB, CH-benCHmark, Join Order Benchmark (JOB) and ClickBench-style
   comparisons of analytics engines published after the newest `date` in
   `data/elo/matches.json`. Include pages republished with new results.
2. Read each report (not search snippets). Record `date`, `source`, `workload`, `ranking` (fastest
   first; nested array = tie) and one sentence of `evidence` naming the table or figure used.
   Add a `comment` (at most 280 characters, shown to visitors) when a reader should know something:
   vendor-run, engines or queries left out, different hardware, known defects.
   - CH-benCHmark mixes transactions and analytics. Rank on the report's own headline measure; when
     engines tie on one side (OLTP or OLAP), the other side decides. Skip it when the two disagree
     and the report names no overall winner, and skip runs of only its OLTP half (that is TPC-C).
   - JOB means all 113 queries. Skip JOB-light, JOB-Complex, CEB, single-variant subsets, and papers
     that swap optimizers inside one engine.
   - BenchBox (`https://benchbox.dev/results/query?benchmark=tpch`, also `ssb`, `tpcds`, `joinorder`) is a
     list of runs, not a report. One match = all runs of one benchmark at one scale on one run date,
     when at least two engines ran. Leave out a scale when all its engines (the same set, or a subset)
     are also in one larger-scale match that day. Rank by the list's "Geomean latency" column. Set `scale` (`SF 1`) and
     use `...?benchmark=tpch&sf=1.0` as `source`. Leave out runs that did not finish every query
     ("Partial pass", or a valid query count below 22 / 13 / 103 / 113) and DuckLake (same engine as DuckDB).
     Keep runs BenchBox marks defective, unofficial or unvalidated, and say so in `comment`, as well as
     when the machines differ. Read every page, sorted by the Result ID column: sorted by date, paging
     repeats some runs and hides others.
3. Skip reports with no clear overall order. When results are only in images, use the raw data if
   the authors publish it, or skip.
4. Run the candidates through `mergeCandidates(existing, candidates, { aliases })` from
   `scripts/lib/candidates.mjs`, append the `added` entries and remove the
   `superseded` ids. Never hand-edit ids.
5. `npm test`, then open a PR listing each match and any judgement calls.

## Before merging (either option)

- Open every source and confirm the date, workload and finishing order.
- One configuration per product: if a report tests several sizes, use the one the report treats as
  its main comparison, and say which in `evidence`.
- New spelling of an engine name? Add it to `data/elo/aliases.json` instead of creating a new player.
- New engine? Add its product URL, `description` and `bestFor` to `data/elo/engines.json` (a test fails otherwise) and, if it is
  on ClickBench, its systems to `data/elo/clickbench-map.json`.
- Close the month's `elo-reminder` issue.
