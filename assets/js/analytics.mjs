// Google Analytics, only after the visitor allows analytics in the CookieHub banner. Loaded by
// layouts/_partials/blox-analytics/services/google_analytics.html, which passes onConsent from consent.mjs.
export function start(win, doc, id, onConsent) {
  let loaded = false;
  let allowed = false;

  onConsent(win, doc, 'analytics', (answer) => {
    allowed = answer;
    win[`ga-disable-${id}`] = !allowed; // gtag.js drops every event while this is set
    if (!allowed || loaded) return;
    loaded = true;
    win.dataLayer = win.dataLayer ?? [];
    win.gtag = function () { win.dataLayer.push(arguments); }; // must be `arguments`: gtag.js ignores arrays
    win.gtag('js', new Date());
    win.gtag('set', { cookie_flags: 'SameSite=None;Secure' });
    win.gtag('config', id);
    doc.head.append(Object.assign(doc.createElement('script'), {
      src: `https://www.googletagmanager.com/gtag/js?id=${id}`, async: true,
    }));
  });

  // Outbound links, with the same fields as the theme's tracker that this replaces.
  doc.addEventListener('click', ({ target }) => {
    if (!allowed || target.tagName !== 'A' || target.host === win.location.host) return;
    win.gtag('event', 'click', { event_category: 'outbound', event_label: target.href, transport_type: 'beacon' });
  });
}
