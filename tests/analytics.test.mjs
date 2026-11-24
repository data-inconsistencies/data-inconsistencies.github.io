import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../assets/js/analytics.mjs';

const ID = 'G-TEST';

function browser() {
  const scripts = [], listeners = {};
  const win = { location: { host: 'example.org' } };
  const doc = {
    createElement: () => ({}),
    head: { append: (s) => scripts.push(s.src) },
    addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  start(win, doc, ID);
  return {
    win, scripts,
    consent: (action, category) => listeners[`cookiehub_on${action}`]({ detail: { category } }),
    click: (props) => listeners.click({ target: { tagName: 'A', host: 'trino.io', href: 'https://trino.io/', ...props } }),
    events: () => (win.dataLayer ?? []).map((a) => [...a]).filter(([name]) => name === 'event'),
  };
}

test('Google Analytics does not load, and records nothing, before consent', () => {
  const b = browser();
  b.click();
  assert.deepEqual(b.scripts, []);
  assert.equal(b.win.gtag, undefined); // the rankings page checks this before sending engine_click
  assert.equal(b.win.dataLayer, undefined);
});

test('consent to something else is not consent to analytics', () => {
  const b = browser();
  b.consent('Allow', 'marketing');
  b.consent('Allow', 'preferences');
  assert.deepEqual(b.scripts, []);
});

test('it loads once after analytics consent and configures the property', () => {
  const b = browser();
  b.consent('Allow', 'analytics');
  b.consent('Allow', 'analytics');
  assert.deepEqual(b.scripts, [`https://www.googletagmanager.com/gtag/js?id=${ID}`]);
  const calls = b.win.dataLayer.map((a) => [...a]);
  assert.deepEqual(calls.map(([name]) => name), ['js', 'set', 'config']);
  assert.deepEqual(calls[2].slice(0, 2), ['config', ID]);
  assert.equal(typeof b.win.gtag, 'function');
});

test('gtag receives an arguments object, because gtag.js ignores arrays', () => {
  const b = browser();
  b.consent('Allow', 'analytics');
  assert.equal(Array.isArray(b.win.dataLayer[0]), false);
});

test('outbound clicks keep the fields the theme sent', () => {
  const b = browser();
  b.consent('Allow', 'analytics');
  b.click();
  b.click({ host: 'example.org' });   // same site
  b.click({ tagName: 'DIV' });        // not a link
  assert.deepEqual(b.events(), [['event', 'click',
    { event_category: 'outbound', event_label: 'https://trino.io/', transport_type: 'beacon' }]]);
});

test('withdrawing consent stops it, and allowing again resumes', () => {
  const b = browser();
  b.consent('Allow', 'analytics');
  b.consent('Revoke', 'marketing');
  b.click();
  assert.equal(b.events().length, 1);
  b.consent('Revoke', 'analytics');
  assert.equal(b.win[`ga-disable-${ID}`], true); // gtag.js drops every event while this is set
  b.click();
  assert.equal(b.events().length, 1);
  b.consent('Allow', 'analytics');
  assert.equal(b.win[`ga-disable-${ID}`], false);
  b.click();
  assert.equal(b.events().length, 2);
});
