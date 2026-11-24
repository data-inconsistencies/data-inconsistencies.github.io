import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORKLOADS } from '../scripts/lib/candidates.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const info = () => read('../data/elo/workloads.json');

test('every workload that can be picked has a description, and "All" does too', () => {
  const used = new Set(read('../data/elo/matches.json').map((m) => m.workload));
  for (const w of ['All', ...WORKLOADS.filter((w) => w !== 'other'), ...used]) {
    assert.ok(info()[w], `${w} has no entry in data/elo/workloads.json`);
  }
  for (const w of Object.keys(info())) assert.ok(w === 'All' || WORKLOADS.includes(w), `${w} is not a known workload`);
});

test('workload descriptions are short and say what is tested', () => {
  for (const [w, { description, shape, tests, url }] of Object.entries(info())) {
    assert.ok(description?.trim(), `${w} has no description`);
    assert.ok(description.length <= 400, `${w}: description is ${description.length} characters`);
    if (w === 'All') continue;
    assert.ok(shape?.trim(), `${w} has no shape`);
    assert.ok(tests?.length >= 2 && tests.every((t) => t.trim()), `${w} needs at least two "tests" tags`);
    assert.equal(new URL(url).protocol, 'https:', `${w}: ${url}`);
  }
});
