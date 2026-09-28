/* Orvix - "The boundary" selector on the What we do pages.

   Builds one tab per move from the steps already on the page, then steps
   through them on its own (01 -> 02 -> 03 -> 01 ...). A thin bar on the
   active tab shows the time left before the next move.

   It only advances while the band is on screen and the tab is visible. It
   pauses while the pointer is over it or focus is inside it, and a click or
   arrow key picks a move and restarts the count from there. With
   prefers-reduced-motion set it does not advance at all.

   Plain ES5, no dependencies, safe to load with defer. */
(function () {
  'use strict';

  var STEP_MS = 5000;
  var still = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  each(document.querySelectorAll('[data-bsel]'), function (sc) {
    var svg = sc.querySelector('.dia');
    var steps = Array.prototype.slice.call(sc.querySelectorAll('.stp'));
    var track = sc.querySelector('.track');
    if (!steps.length || !track) return;

    var tabs = document.createElement('div');
    tabs.className = 'btabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'The three moves');

    steps.forEach(function (s, i) {
      var n = s.querySelector('.n'), h = s.querySelector('h3');
      var label = n ? n.textContent.trim() : '';
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btab' + (/NOT OURS/i.test(label) ? ' alt' : '');
      b.setAttribute('role', 'tab');
      b.innerHTML = '<span class="k"></span><span class="t"></span><span class="mk"></span><span class="pg" aria-hidden="true"></span>';
      b.querySelector('.k').textContent = label;
      b.querySelector('.t').textContent = h ? h.textContent.trim() : '';
      b.addEventListener('click', function () { pick(i); restart(); });
      b.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1
              : e.key === 'ArrowUp'   || e.key === 'ArrowLeft'  ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var j = (i + d + steps.length) % steps.length;
        tabs.children[j].focus(); pick(j); restart();
      });
      tabs.appendChild(b);
    });
    track.insertBefore(tabs, track.firstChild);

    var cur = 0;
    function pick(i) {
      cur = i;
      steps.forEach(function (s, k) { s.classList.toggle('act', k === i); });
      each(tabs.children, function (b, k) {
        b.classList.toggle('on', k === i);
        b.setAttribute('aria-selected', k === i);
        b.tabIndex = k === i ? 0 : -1;
      });
      if (svg) {
        each(svg.querySelectorAll('.g'), function (g) { g.classList.remove('on'); });
        var g = svg.querySelector('.g' + (i + 1));
        if (g) g.classList.add('on');
      }
    }
    pick(0);

    if (still) return;

    /* ---- auto-advance -------------------------------------------------- */

    sc.style.setProperty('--bstep', STEP_MS + 'ms');
    var timer = null, started = 0, left = STEP_MS;
    var seen = false, hover = false, focus = false;

    function running() { return seen && !hover && !focus && !document.hidden; }

    function arm(ms) {
      clearTimeout(timer);
      started = Date.now(); left = ms;
      timer = setTimeout(function () { pick((cur + 1) % steps.length); restart(); }, ms);
    }

    // restart the bar animation on the newly active tab and the clock with it
    function restart() {
      sc.classList.remove('bauto');
      void sc.offsetWidth;
      left = STEP_MS;
      sc.classList.add('bauto');
      sync();
    }

    function sync() {
      var go = running();
      sc.classList.toggle('bpause', !go);
      if (go) arm(left);
      else if (timer) { clearTimeout(timer); timer = null; left = Math.max(0, left - (Date.now() - started)); }
    }

    // pausing must not reset the remaining time, so only sync on a change
    function set(fn) { return function () { var was = running(); fn(); if (running() !== was) sync(); }; }

    sc.addEventListener('mouseenter', set(function () { hover = true; }));
    sc.addEventListener('mouseleave', set(function () { hover = false; }));
    sc.addEventListener('focusin', set(function () { focus = true; }));
    sc.addEventListener('focusout', set(function (e) {
      focus = !!(e.relatedTarget && sc.contains(e.relatedTarget));
    }));
    document.addEventListener('visibilitychange', set(function () {}));

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { set(function () { seen = e.isIntersecting; })(); });
      }, { threshold: 0.35 }).observe(sc);
    } else {
      seen = true;
    }

    sc.classList.add('bauto');
    sync();
  });
})();
