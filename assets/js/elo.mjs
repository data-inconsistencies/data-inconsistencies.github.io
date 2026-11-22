// Multiplayer ELO for analytics-engine benchmark "matches".
// Pure, dependency-free ES module: used by the /rankings/ page and by `node --test tests/`.
// See docs/elo/spec.md for the algorithm.

export const DEFAULTS = { k: 32, initial: 1500 };

export function expected(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

export function workloads(matches) {
  return [...new Set(matches.map((m) => m.workload))].sort();
}

// ranking: ["A", ["B","C"], "D"] -> [{engine:"A",place:1},{engine:"B",place:2},{engine:"C",place:2},{engine:"D",place:3}]
function places(ranking) {
  const out = [];
  ranking.forEach((entry, i) => {
    for (const engine of Array.isArray(entry) ? entry : [entry]) out.push({ engine, place: i + 1 });
  });
  return out;
}

const byDateThenId = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);

export function computeRatings(allMatches, opts = {}) {
  const { k, initial, workload } = { ...DEFAULTS, ...opts };
  const ratings = {};
  const history = {};
  const matches = [];

  const sorted = allMatches
    .filter((m) => !workload || workload === 'All' || m.workload === workload)
    .slice()
    .sort(byDateThenId);

  for (const match of sorted) {
    const players = places(match.ranking);
    const names = players.map((p) => p.engine);
    if (new Set(names).size !== names.length) {
      throw new Error(`Match ${match.id}: duplicate engine in ranking`);
    }
    for (const name of names) {
      ratings[name] ??= { engine: name, rating: initial, wins: 0, losses: 0, draws: 0, played: 0, lastDelta: 0, lastDate: null };
      history[name] ??= [];
    }

    const n = players.length;
    const before = Object.fromEntries(names.map((e) => [e, ratings[e].rating]));
    const deltas = Object.fromEntries(names.map((e) => [e, 0]));

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = players[i], b = players[j];
        const s = a.place < b.place ? 1 : a.place > b.place ? 0 : 0.5;
        const e = expected(before[a.engine], before[b.engine]);
        deltas[a.engine] += s - e;
        deltas[b.engine] += 1 - s - (1 - e);
        const ra = ratings[a.engine], rb = ratings[b.engine];
        if (s === 1) { ra.wins++; rb.losses++; } else if (s === 0) { ra.losses++; rb.wins++; } else { ra.draws++; rb.draws++; }
      }
    }

    const scale = n > 1 ? k / (n - 1) : 0;
    for (const name of names) {
      const d = deltas[name] * scale;
      deltas[name] = d;
      const r = ratings[name];
      r.rating = before[name] + d;
      r.lastDelta = d;
      r.lastDate = match.date;
      r.played++;
      history[name].push({ date: match.date, id: match.id, rating: r.rating });
    }

    matches.push({ ...match, placings: players, before, deltas });
  }

  return { ratings, history, matches };
}

export function leaderboard(ratings) {
  return Object.values(ratings).sort((a, b) => b.rating - a.rating || a.engine.localeCompare(b.engine));
}
