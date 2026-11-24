import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../assets/js/brevo.mjs';
import { onConsent } from '../assets/js/consent.mjs';

function browser() {
  const scripts = [], listeners = {};
  const win = {};
  const doc = {
    createElement: () => ({}),
    head: { append: (s) => scripts.push(s.src) },
    addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  start(win, doc, 'key123', onConsent);
  return { win, scripts, allow: (category) => listeners.cookiehub_onAllow({ detail: { category } }) };
}

test('Brevo does not load before consent', () => {
  const b = browser();
  assert.deepEqual(b.scripts, []);
  assert.equal(b.win.Brevo, undefined);
});

test('consent to analytics is not consent to marketing', () => {
  const b = browser();
  b.allow('analytics');
  b.allow('preferences');
  assert.deepEqual(b.scripts, []);
});

test('it loads once, with its key, after marketing consent', () => {
  const b = browser();
  b.allow('marketing');
  b.allow('marketing');
  assert.deepEqual(b.scripts, ['https://cdn.brevo.com/js/sdk-loader.js']);
  assert.deepEqual(b.win.Brevo, [['init', { client_key: 'key123' }]]);
});
