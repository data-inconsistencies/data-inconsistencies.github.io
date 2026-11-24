// Google Analytics, only after the visitor allows analytics in the CookieHub banner. Loaded by
// layouts/_partials/blox-analytics/services/google_analytics.html. CookieHub announces each allowed or withdrawn
// category with these document events, on every page load for a visitor who already answered.
export function start(win, doc, id) {
  let loaded = false;
  let allowed = false;

  doc.addEventListener('cookiehub_onAllow', ({ detail }) => {
    if (detail.category !== 'analytics') return;
    allowed = true;
    win[`ga-disable-${id}`] = false;
    if (loaded) return;
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

  doc.addEventListener('cookiehub_onRevoke', ({ detail }) => {
    if (detail.category !== 'analytics') return;
    allowed = false;
    win[`ga-disable-${id}`] = true; // gtag.js drops every event while this is set
  });

  // Outbound links, with the same fields as the theme's tracker that this replaces.
  doc.addEventListener('click', ({ target }) => {
    if (!allowed || target.tagName !== 'A' || target.host === win.location.host) return;
    win.gtag('event', 'click', { event_category: 'outbound', event_label: target.href, transport_type: 'beacon' });
  });
}
