# CLAUDE.md

Hugo Blox (Tailwind) landing site, deployed to GitHub Pages by `.github/workflows/publish.yaml`.

## Commands
- Test ELO engine: `npm test` (node:test, no deps; needs Node 22+)
- Build: `hugo --gc --minify` — CI pins Hugo **0.148.2**. Newer local Hugo (≥0.145 removes `_build`)
  fails on `content/authors/_index.md`; use the pinned version to reproduce CI.
- Preview: `hugo server`

## ELO rankings
- Data: `data/elo/matches.json` (one object per benchmark report; `ranking` is 1st → last, nested array = tie).
  Every match needs a unique `id`, ISO `date`, public `source` URL, and `workload`.
- Engine: `assets/js/elo.mjs` — pure ES module shared by the page and the tests. Keep it dependency-free.
- Page: `content/rankings/index.md` + `layouts/rankings/single.html` (ratings computed client-side).
- Spec / intent / plan: `docs/elo/`. Change the spec before changing the algorithm.
- Use canonical engine names (`ClickHouse`, `Apache Spark`, `Trino`, `DataFusion`) — a new spelling creates a new player.

## Conventions
- Bug in the engine: add a failing test in `tests/elo.test.mjs` first, then fix.
- Run `npm test` and a pinned-Hugo build before calling work done.
