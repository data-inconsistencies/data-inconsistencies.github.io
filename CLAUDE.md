# CLAUDE.md

Hugo Blox (Tailwind v4, `github.com/HugoBlox/kit/modules/blox`) landing site, deployed to GitHub Pages by `.github/workflows/publish.yaml`.

## Commands
- Test ELO engine: `npm test` (node:test, no deps; needs Node 22+)
- Build: `npm ci` once (Tailwind CLI + preact for the theme), then `hugo --gc --minify` — CI pins Hugo
  **0.170.1**, the standard (non-extended) build, in `.github/workflows/publish.yaml`, `netlify.toml` and
  `hugoblox.yaml` — keep all three in step. Use `build:`, never the removed `_build:`, in front matter.
- Theme config is HugoBlox schema v2: everything under `hugoblox:` in `config/_default/params.yaml`
  (logo = `assets/media/logo.png`). `security.exec.allow` must keep `tailwindcss` (Hugo ≥0.165 dropped it).
  `layouts/_partials/functions/process_responsive_image.html` overrides a theme bug (images narrower than
  400px) — drop it once upstream fixes that.
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
  It also keeps one `ClickBench` match per machine in `REFERENCE_MACHINES` (c6a.4xlarge, c8g.metal-48xl; `scale` = machine)
  in `matches.json`, replaced in place on each refresh with the same id; don't add ClickBench matches by hand.
- Benchmark descriptions under the workload buttons: `data/elo/workloads.json` (a test fails if a workload has none).
- Product links: `data/elo/engines.json` (url, one-line `description`, `bestFor` use case and `playground` per engine; a test fails if an ELO engine or field is missing). `playground` (`Engines` | `Table formats`, list in `PLAYGROUNDS` in `elo.mjs`) puts the engine in a separate league; set it when adding an engine. Shown as the "What it is" / "Best for" leaderboard columns.
  Engine names on /rankings/ link there and send GA4 event `engine_click`
  (engine, link_url, link_location, workload_filter). GA is `G-GV8QDDVB6Q` in params.yaml and only
  loads in production builds, not `hugo server`.
- Google Analytics loads only after consent (`assets/js/analytics.mjs`, tests in `tests/analytics.test.mjs`; the partial
  `layouts/_partials/blox-analytics/services/google_analytics.html` overrides the theme's). `window.gtag` does not exist before
  that, so check it before sending an event.
- Brevo loads only after marketing consent (`assets/js/brevo.mjs`, tests in `tests/brevo.test.mjs`). A new third-party script
  that sets cookies needs the same gate: `onConsent` in `assets/js/consent.mjs`.
- Cookie consent: CookieHub (`layouts/_partials/hooks/head-end/cookiehub.html`). Its account has the old domain, so the hook sets
  the cookie domain to the current host; the landscape does the same in its `analytics/analytics.mjs`.
- WebMCP: `assets/js/webmcp.mjs` defines the agent tools on /rankings/ (tests in `tests/webmcp.test.mjs`, spec section
  in `docs/elo/spec.md`). Keep it import-free; bad input returns `{error}`, never throws; view changes go through
  `setView()` in `single.html`. Chrome origin-trial token: `webmcp.originTrialToken` in params.yaml (empty = flag only).
- Comments: GitHub Discussions via giscus (`comments` in params.yaml; thread repo `data-inconsistencies/website-comments`),
  only on pages with `commentable: true`. `layouts/_partials/comments/giscus.html` overrides the theme's partial so the
  widget follows the light/dark toggle.
- Use canonical engine names (`ClickHouse`, `Apache Spark`, `Trino`, `DataFusion`) — a new spelling creates a new player.

## Conventions
- Bug in the engine: add a failing test in `tests/elo.test.mjs` first, then fix.
- Run `npm test` and a pinned-Hugo build before calling work done.
