/* Orvix - Google Analytics 4, only with the visitor's consent.

   Loaded from every page's <head> by tools/seo (head.py), which also holds the
   measurement ID and passes it in as data-ga4. Nothing else on the site needs
   to know the ID.

   Consent first: GA4 is not loaded, and nothing is sent to Google, until the
   visitor clicks Accept on the cookie banner. The choice is kept in
   localStorage ("orvix-consent" = granted | denied). Decline, or no choice
   yet, means no Google script at all. The Privacy page (company/privacy/)
   has a button carrying data-cookie-reset that clears the choice and shows
   the banner again.

   Only the production site reports. On localhost, Netlify deploy previews and
   branch deploys the banner still appears (so it can be tested) but accepting
   loads nothing, so test visits never reach the GA4 property.

   The Google origins it uses are allowed in _headers (script-src,
   connect-src, img-src); without them the browser blocks GA4 silently.

   Plain ES5, no dependencies, safe to load with async. */
(function () {
  'use strict';

  var PRODUCTION = { 'orvixnet.com': 1, 'www.orvixnet.com': 1 };
  var KEY = 'orvix-consent';

  var me = document.currentScript;
  var id = me && me.getAttribute('data-ga4');
  if (!id || !/^G-[A-Z0-9]+$/.test(id)) return;

  var ar = (document.documentElement.getAttribute('lang') || '').indexOf('ar') === 0;
  var T = ar ? {
    text: 'نستخدم ملفات تعريف الارتباط التحليلية من Google لفهم كيفية استخدام الموقع، ولا نفعل ذلك إلا بموافقتك.',
    more: 'اقرأ إشعار الخصوصية', accept: 'موافق', decline: 'رفض', href: '/ar/company/privacy/', label: 'خيارات ملفات تعريف الارتباط'
  } : {
    text: 'We use Google analytics cookies to understand how the site is used, only if you agree.',
    more: 'Read the privacy notice', accept: 'Accept', decline: 'Decline', href: '/company/privacy/', label: 'Cookie choice'
  };

  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode: ask again next visit */ } }

  var loaded = false;
  function load() {
    if (loaded || !PRODUCTION[location.hostname]) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', id);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
  }

  // Withdrawing consent also removes the cookies GA4 already set (_ga, _ga_<id>).
  function clearGaCookies() {
    var names = document.cookie.split(';');
    var host = location.hostname.replace(/^www\./, '');
    for (var i = 0; i < names.length; i++) {
      var n = names[i].split('=')[0].replace(/^\s+/, '');
      if (n.indexOf('_ga') !== 0) continue;
      var gone = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      document.cookie = gone;
      document.cookie = gone + '; domain=.' + host;
    }
  }

  var bar = null;
  function hide() { if (bar) { bar.parentNode && bar.parentNode.removeChild(bar); bar = null; } }
  function show() {
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'consent';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', T.label);
    if (ar) bar.setAttribute('dir', 'rtl');
    var p = document.createElement('p');
    p.appendChild(document.createTextNode(T.text + ' '));
    var a = document.createElement('a');
    a.href = T.href; a.textContent = T.more;
    p.appendChild(a);
    var btns = document.createElement('div');
    btns.className = 'consent__btns';
    var no = document.createElement('button'); no.type = 'button'; no.className = 'consent__no'; no.textContent = T.decline;
    var yes = document.createElement('button'); yes.type = 'button'; yes.className = 'consent__yes'; yes.textContent = T.accept;
    no.addEventListener('click', function () { save('denied'); hide(); });
    yes.addEventListener('click', function () { save('granted'); hide(); load(); });
    btns.appendChild(no); btns.appendChild(yes);
    bar.appendChild(p); bar.appendChild(btns);
    document.body.appendChild(bar);
  }

  function start() {
    var choice = read();
    if (choice === 'granted') load();
    else if (choice !== 'denied') show();
    var resets = document.querySelectorAll('[data-cookie-reset]');
    for (var i = 0; i < resets.length; i++) {
      resets[i].addEventListener('click', function () {
        try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        clearGaCookies();
        show();
      });
    }
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
