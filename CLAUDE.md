# CLAUDE.md

Hugo Blox (Tailwind) landing site, deployed to GitHub Pages by `.github/workflows/publish.yaml`.

## Commands
- Test ELO engine: `npm test` (node:test, no deps; needs Node 22+)
- Build: `hugo --gc --minify` — CI pins Hugo **0.148.2** (also builds on 0.161). Use `build:`, never the
  removed `_build:`, in front matter.
- Preview: `hugo server`

## ELO rankings
- Data: `data/elo/matches.json` (one object per benchmark report; `ranking` is 1st → last, nested array = tie).
  Every match needs a unique `id`, ISO `date`, public `source` URL, and `workload`.
- Engine: `assets/js/elo.mjs` — pure ES module shared by the page and the tests. Keep it dependency-free.
- Page: `content/rankings/index.md` + `layouts/rankings/single.html` (ratings computed client-side).
- Spec / intent / plan: `docs/elo/`. Change the spec before changing the algorithm.
- Discovery: `npm run find-matches` (dry run) / `-- --write` asks Claude to find new reports; needs
  `ANTHROPIC_API_KEY`. Helpers in `scripts/lib/candidates.mjs` stay pure (tests import them without
  `npm ci`). Run by hand monthly (runbook `docs/elo/finding-matches.md`); `.github/workflows/monthly-reminder.yaml`
  emails the committers via an assigned issue and refreshes ClickBench. New name variants go in
  `data/elo/aliases.json`.
- ClickBench column: `npm run clickbench` rewrites `data/elo/clickbench.json` (no key needed);
  `scripts/lib/clickbench.mjs` ports ClickBench's default "Combined" ranking — re-check it against
  benchmark.clickhouse.com if their index.html scoring changes. Product → ClickBench systems mapping:
  `data/elo/clickbench-map.json` (add an entry when a new ELO engine appears).
- Product links: `data/elo/engines.json` (url, one-line `description`, `bestFor` use case per engine; a test fails if an ELO engine or field is missing). Shown as the "What it is" / "Best for" leaderboard columns.
  Engine names on /rankings/ link there and send GA4 event `engine_click`
  (engine, link_url, link_location, workload_filter). GA is `G-GV8QDDVB6Q` in params.yaml and only
  loads in production builds, not `hugo server`.
- Use canonical engine names (`ClickHouse`, `Apache Spark`, `Trino`, `DataFusion`) — a new spelling creates a new player.

## Conventions
- Bug in the engine: add a failing test in `tests/elo.test.mjs` first, then fix.
- Run `npm test` and a pinned-Hugo build before calling work done.
