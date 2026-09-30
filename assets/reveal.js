/* Scroll reveal, shared by every page.

   Anything with class="rv" starts slightly lowered and transparent and eases
   in the first time it scrolls into view (the timing lives in the page's
   stylesheet, .js .rv / .js .rv.in). The hidden state only applies once the
   inline head script has put .js on <html>, so with JavaScript off, or if
   this file fails to load, everything is simply visible. Visitors who ask
   for reduced motion get no movement (see the prefers-reduced-motion rules).

   Several pages still carry an older inline observer that does the same
   thing; adding .in twice is harmless. */
(function () {
  var els = document.querySelectorAll('.rv:not(.in)');
  if (!('IntersectionObserver' in window)) {
    for (var i = 0; i < els.length; i++) els[i].classList.add('in');
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  for (var j = 0; j < els.length; j++) io.observe(els[j]);
})();
