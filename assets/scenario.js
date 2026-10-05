/* Illustrative scenario (Case studies page). A light travels a route with
   five stations; the line behind it is the part of the review already done.
   The ledger grid beside it is examined, coloured and sealed as the weeks
   pass. Plays through once when it scrolls into view, then waits; a click, a
   tap or the arrow keys take over. All copy is in the page, so the same
   script serves English and Arabic. */
(function () {
  var root = document.getElementById('scenario');
  if (!root) return;
  var stops = Array.prototype.slice.call(root.querySelectorAll('.scn-stop'));
  var caps = Array.prototype.slice.call(root.querySelectorAll('.scn-cap'));
  var done = root.querySelector('.scn-done');
  var comet = root.querySelector('.scn-comet');
  if (stops.length < 2 || caps.length !== stops.length || !done || !comet || !done.getTotalLength) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var total = done.getTotalLength();
  var last = stops.length - 1;
  var current = -1, at = 0, raf = 0, timer = null, played = false;

  done.style.strokeDasharray = total + ' ' + total;

  function place(f) {                       // f: 0..1 along the route
    at = f;
    done.style.strokeDashoffset = (total * (1 - f)).toFixed(1);
    var p = done.getPointAtLength(total * f);
    comet.setAttribute('cx', p.x.toFixed(1));
    comet.setAttribute('cy', p.y.toFixed(1));
  }

  var settle = 0;
  function travel(to) {
    cancelAnimationFrame(raf);
    clearTimeout(settle);
    if (reduce) return place(to);
    var from = at, t0 = null, ms = 500 + 900 * Math.abs(to - from) * last;
    raf = requestAnimationFrame(function step(t) {
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / ms);
      k = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;      // ease in-out
      place(from + (to - from) * k);
      if (k < 1) raf = requestAnimationFrame(step);
    });
    // frames are not guaranteed (a background tab gets none): always land on the station
    settle = setTimeout(function () { cancelAnimationFrame(raf); place(to); }, ms + 80);
  }

  function show(i, instant) {
    if (i === current) return;
    var prev = current;
    current = i;
    stops.forEach(function (s, k) {
      s.classList.toggle('on', k === i);
      s.classList.toggle('done', k < i);
      s.setAttribute('aria-selected', k === i ? 'true' : 'false');
      s.tabIndex = k === i ? 0 : -1;
    });
    caps.forEach(function (c, k) { c.classList.toggle('on', k === i); });
    // the ledger follows the deliverables: examined at 2, marked at 3, owners at 4,
    // the one-line position at 5, the assembled pack at 6
    for (var n = 2; n <= stops.length; n++) root.classList.toggle('ge' + n, i >= n - 1);
    root.classList.remove('at2');
    if (i === 1 && prev < 1) { void root.offsetWidth; root.classList.add('at2'); }   // restart the scan
    if (instant) place(i / last); else travel(i / last);
  }

  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function play() {
    if (played || reduce) return;
    played = true;
    timer = setInterval(function () {
      if (current >= last) return stop();
      show(current + 1);
    }, 3600);
  }

  stops.forEach(function (s, i) {
    s.addEventListener('click', function () { stop(); played = true; show(i); });
    s.addEventListener('keydown', function (e) {
      var next = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!next) return;
      if (document.documentElement.dir === 'rtl') next = -next;
      var k = Math.max(0, Math.min(last, i + next));
      e.preventDefault(); stop(); played = true; show(k); stops[k].focus();
    });
  });

  root.classList.add('js');
  show(0, true);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es, io) {
      es.forEach(function (e) { if (e.isIntersecting) { play(); io.disconnect(); } });
    }, { threshold: 0.3 }).observe(root);
  }
})();
