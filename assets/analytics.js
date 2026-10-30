/* Orvix - Google Analytics 4.

   Loaded from every page's <head> by tools/seo (head.py), which also holds the
   measurement ID and passes it in as data-ga4. Nothing else on the site needs
   to know the ID.

   Only the production site reports. On localhost, Netlify deploy previews and
   branch deploys (the sam branch, for instance) this does nothing, so test
   visits never reach the GA4 property.

   The two Google origins it uses are allowed in _headers (script-src,
   connect-src, img-src); without them the browser blocks GA4 silently.

   Plain ES5, no dependencies, safe to load with async. */
(function () {
  'use strict';

  var PRODUCTION = { 'orvixnet.com': 1, 'www.orvixnet.com': 1 };

  var me = document.currentScript;
  var id = me && me.getAttribute('data-ga4');
  if (!id || !/^G-[A-Z0-9]+$/.test(id)) return;
  if (!PRODUCTION[location.hostname]) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag('js', new Date());
  gtag('config', id);

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
  document.head.appendChild(s);
})();
