# Intent: ELO leaderboard for analytics engines

## Problem
Benchmarks lie, and each one is a static snapshot under one vendor's conditions.
Our rankings currently live in a Google Sheet behind a short link; visitors can't
see the leaderboard, history, or sources on the site itself.

## Outcome
A `/rankings/` page on the landing site that turns every collected public
benchmark into ELO "matches" (1v1 or N-way) and shows:
- the current leaderboard,
- rating history over time,
- every match with its source link,
- a filter by workload (TPC-H, TPC-DS, SSB, …).

## Users
Data engineers choosing an engine; vendors/DevRel checking their standing;
contributors who want to submit a benchmark report.

## Constraints
- Static site (Hugo Blox, GitHub Pages). No backend.
- Adding a report must be a one-file data edit, reviewable in a PR.
- Results must be reproducible: same data → same ratings.
- Every match cites a public URL.

## Open questions
- Should old results decay over time? (Not in v1. Added later: match weight halves every 2 years; see spec.)
- Should "playgrounds" (e.g. lakehouse formats vs engines) be ranked separately? (Not in v1. Since added: yes, one league per playground; see spec.)
