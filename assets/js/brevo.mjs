// Brevo (web push and marketing), only after the visitor allows marketing in the CookieHub banner. Loaded by
// layouts/_partials/hooks/head-end/brevo.html, which passes onConsent from consent.mjs. A script cannot be unloaded, so
// withdrawing consent takes effect on the next page.
export function start(win, doc, key, onConsent) {
  let loaded = false;

  onConsent(win, doc, 'marketing', (allowed) => {
    if (!allowed || loaded) return;
    loaded = true;
    win.Brevo = win.Brevo ?? [];
    win.Brevo.push(['init', { client_key: key }]);
    doc.head.append(Object.assign(doc.createElement('script'), {
      src: 'https://cdn.brevo.com/js/sdk-loader.js', async: true,
    }));
  });
}
