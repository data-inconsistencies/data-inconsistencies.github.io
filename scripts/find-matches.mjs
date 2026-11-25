#!/usr/bin/env node
// Look for new public benchmark reports and propose them as ELO matches.
//
//   npm run find-matches              # dry run: print candidates
//   npm run find-matches -- --write   # append candidates to data/elo/matches.json
//   options: --max <n> (default 10), --summary <file> (write a Markdown summary, used by CI)
//
// Needs ANTHROPIC_API_KEY (or an `ant auth login` profile). See docs/elo/spec.md.

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildPrompt, mergeCandidates, OUTPUT_SCHEMA } from './lib/candidates.mjs';

const MATCHES = new URL('../data/elo/matches.json', import.meta.url);
const ALIASES = new URL('../data/elo/aliases.json', import.meta.url);
const MAX_CONTINUATIONS = 6;

function parseArgs(argv) {
  const opts = { write: false, max: 10, summary: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write') opts.write = true;
    else if (argv[i] === '--max') opts.max = Number(argv[++i]);
    else if (argv[i] === '--summary') opts.summary = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return opts;
}

async function discover(prompt) {
  const client = new Anthropic();
  const params = {
    model: 'claude-opus-5-5',
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    tools: [
      { type: 'web_search_20260209', name: 'web_search', max_uses: 15 },
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 25 },
    ],
  };
  const messages = [{ role: 'user', content: prompt }];
  let searches = 0;
  let fetches = 0;

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const response = await client.beta.messages.stream({ ...params, messages }).finalMessage();
    for (const b of response.content) {
      if (b.type === 'server_tool_use' && b.name === 'web_search') searches++;
      if (b.type === 'server_tool_use' && b.name === 'web_fetch') fetches++;
    }

    if (response.stop_reason === 'pause_turn') {
      // Server-side tool loop hit its iteration limit: send the turn back and it resumes.
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    if (response.stop_reason === 'refusal') {
      throw new Error(`Model declined: ${response.stop_details?.category ?? 'unknown'} ${response.stop_details?.explanation ?? ''}`);
    }
    if (response.stop_reason === 'max_tokens') throw new Error('Response hit max_tokens before finishing');

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const { matches } = JSON.parse(text);
    return { matches, searches, fetches, usage: response.usage };
  }
  throw new Error(`Still paused after ${MAX_CONTINUATIONS} continuations`);
}

function summarize({ added, skipped, superseded }, stats) {
  const lines = [`Searched ${stats.searches}× and fetched ${stats.fetches} pages.`, ''];
  if (added.length) {
    lines.push(`### ${added.length} new match(es) — check each against its source before merging`, '');
    for (const m of added) {
      const order = m.ranking.map((e) => (Array.isArray(e) ? `(${e.join(' = ')})` : e)).join(' > ');
      lines.push(`- **#${m.id} ${m.workload}, ${m.date}**: ${order}`, `  - ${m.source}`, `  - Evidence: ${m.evidence}`);
    }
  } else {
    lines.push('No new matches found.');
  }
  if (superseded.length) lines.push('', `Superseded by a larger scale, to be removed: ${superseded.map((id) => `#${id}`).join(', ')}`);
  if (skipped.length) {
    lines.push('', '<details><summary>Skipped candidates</summary>', '');
    for (const s of skipped) lines.push(`- ${s.candidate.source || '(no source)'} (${s.candidate.workload}): ${s.reason}`);
    lines.push('', '</details>');
  }
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const existing = JSON.parse(readFileSync(MATCHES, 'utf8'));
  const aliases = JSON.parse(readFileSync(ALIASES, 'utf8'));

  const result = await discover(buildPrompt(existing, { maxResults: opts.max }));
  const merged = mergeCandidates(existing, result.matches, { aliases });
  const summary = summarize(merged, result);

  console.log(summary);
  console.error(`\nTokens: ${result.usage.input_tokens} in, ${result.usage.output_tokens} out (last turn).`);
  if (opts.summary) writeFileSync(opts.summary, `${summary}\n`);

  if (opts.write && merged.added.length) {
    writeFileSync(MATCHES, `${JSON.stringify([...existing.filter((m) => !merged.superseded.includes(m.id)), ...merged.added], null, 2)}\n`);
    console.error(`Wrote ${merged.added.length} match(es) to data/elo/matches.json`);
  } else if (!opts.write && merged.added.length) {
    console.error('Dry run: rerun with --write to add them.');
  }
}

main().catch((err) => {
  if (err instanceof Anthropic.AuthenticationError) console.error('No valid Anthropic credential: set ANTHROPIC_API_KEY.');
  else if (err instanceof Anthropic.RateLimitError) console.error('Rate limited by the Anthropic API; try again later.');
  else if (err instanceof Anthropic.APIError) console.error(`Anthropic API error ${err.status}: ${err.message}`);
  else console.error(err.message ?? err);
  process.exit(1);
});
