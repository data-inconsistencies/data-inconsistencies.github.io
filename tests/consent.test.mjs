import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onConsent } from '../assets/js/consent.mjs';

function browser() {
  const listeners = {}, seen = [];
  const win = { cookiehub: { hasConsented: () => win.consented === true } };
  onConsent(win, { addEventListener: (name, fn) => { listeners[name] = fn; } }, 'marketing', (allowed) => seen.push(allowed));
  return {
    win, seen,
    fire: (name, category) => listeners[`cookiehub_on${name}`]({ detail: { category } }),
    answer(consented) { win.consented = consented; this.fire('StatusChange'); },
  };
}

test('nothing is reported before an answer', () => assert.deepEqual(browser().seen, []));

test('only changes to the category are reported', () => {
  const b = browser();
  b.fire('Allow', 'analytics');
  b.fire('Revoke', 'analytics');
  assert.deepEqual(b.seen, []);
  b.fire('Allow', 'marketing');
  b.fire('Allow', 'marketing');
  assert.deepEqual(b.seen, [true]);
});

// CookieHub 2.9.3 announces onAllow for a category once per page: not again after onRevoke.
test('declining and then allowing on the same page is noticed', () => {
  const b = browser();
  b.answer(false);
  b.fire('Revoke', 'marketing');
  b.answer(true);
  assert.deepEqual(b.seen, [false, true]);
});

test('allowing and then declining is noticed, even without onRevoke', () => {
  const b = browser();
  b.answer(true);
  b.fire('Allow', 'marketing');
  b.answer(false);
  assert.deepEqual(b.seen, [true, false]);
});

test('a status change before CookieHub is ready is not consent', () => {
  const b = browser();
  b.win.cookiehub = undefined;
  b.fire('StatusChange');
  assert.deepEqual(b.seen, [false]);
});
