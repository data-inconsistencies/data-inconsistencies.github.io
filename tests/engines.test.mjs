import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));

test('every ELO engine has a product URL, and every URL belongs to an ELO engine', () => {
  const engines = read('../data/elo/engines.json');
  const used = new Set(read('../data/elo/matches.json').flatMap((m) => m.ranking.flat()));
  for (const e of used) assert.ok(engines[e], `${e} has no entry in data/elo/engines.json`);
  for (const e of Object.keys(engines)) assert.ok(used.has(e), `${e} is not an ELO engine`);
});

test('product URLs are absolute https URLs', () => {
  for (const [e, { url }] of Object.entries(read('../data/elo/engines.json'))) {
    assert.equal(new URL(url).protocol, 'https:', `${e}: ${url}`);
  }
});

test('every engine has a short description and best-for use case', () => {
  for (const [e, { description, bestFor }] of Object.entries(read('../data/elo/engines.json'))) {
    assert.ok(description?.trim(), `${e} has no description`);
    assert.ok(bestFor?.trim(), `${e} has no bestFor`);
  }
});
