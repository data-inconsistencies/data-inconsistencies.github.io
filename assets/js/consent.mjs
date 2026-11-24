// Calls back with true or false when the visitor allows or withdraws a cookie category (analytics, marketing) in the
// CookieHub banner, on every page load for a visitor who already answered. Never before an answer.
// CookieHub announces onAllow once per page for a category, not again after onRevoke, so onStatusChange is needed too.
export function onConsent(win, doc, category, callback) {
  let last;
  const report = (allowed) => {
    if (allowed === last) return;
    last = allowed;
    callback(allowed);
  };
  doc.addEventListener('cookiehub_onAllow', ({ detail }) => { if (detail.category === category) report(true); });
  doc.addEventListener('cookiehub_onRevoke', ({ detail }) => { if (detail.category === category) report(false); });
  doc.addEventListener('cookiehub_onStatusChange', () => report(win.cookiehub?.hasConsented(category) === true));
}
