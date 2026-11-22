# Plan

| # | Change | Files | Proof |
|---|--------|-------|-------|
| 1 | Pure ELO engine (ES module, no deps) | `assets/js/elo.mjs` | `tests/elo.test.mjs` via `node --test` |
| 2 | Import sheet data | `data/elo/matches.json` | count = 19, test loads it |
| 3 | Rankings page + layout | `content/rankings/index.md`, `layouts/rankings/single.html` | `hugo` build, browser check |
| 4 | Link from homepage + menu | `content/_index.md`, `config/_default/menus.yaml` | link resolves |
| 5 | CI: run tests before build | `.github/workflows/publish.yaml` | workflow step |
| 6 | CLAUDE.md with commands/conventions | `CLAUDE.md` | — |

Risks: Hugo Blox base template block names (`main`) — verify by building.
Riskiest step: the layout integrating with the theme. Left out: rating decay, per-playground leagues, submission form.
