/* Home page: the four-pillar compass. A needle swings to the pillar you
   point at, the arc draws itself, the centre shows that pillar's claim.
   It cycles on its own until the visitor interacts. Works on the Arabic
   page too: all text comes from the pillar cards on the page. */
(function () {
  var sec = document.getElementById('chain');
  if (!sec) return;
  var grid = sec.querySelector('.method3');
  var svg = sec.querySelector('.ringwrap2 svg');
  var pills = Array.prototype.slice.call(sec.querySelectorAll('.pill'));
  if (!grid || !svg || pills.length < 2) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var NS = 'http://www.w3.org/2000/svg';
  var ANGLE = { 1: -45, 2: 45, 3: 135, 4: 225 };   // quadrant centres, clockwise from 12

  // needle
  var needle = document.createElementNS(NS, 'g');
  needle.setAttribute('class', 'needle');
  needle.setAttribute('aria-hidden', 'true');
  // a pointer that rides just inside the ring, so the centre text stays clear
  needle.innerHTML = '<path d="M210 78 L217 91 L203 91 Z"/>';
  svg.appendChild(needle);

  // the centre: number, pillar name, claim (replaces the static centre text)
  var centre = document.createElementNS(NS, 'g');
  centre.setAttribute('class', 'rcenter');
  centre.setAttribute('aria-hidden', 'true');
  function t(cls, y) {
    var el = document.createElementNS(NS, 'text');
    el.setAttribute('class', cls); el.setAttribute('x', '210'); el.setAttribute('y', y); el.setAttribute('text-anchor', 'middle');
    centre.appendChild(el); return el;
  }
  var cNum = t('rnm', '186'), cTitle1 = t('rtt', '212'), cTitle2 = t('rtt', '232'), claim = t('rq', '256');
  svg.appendChild(centre);
  function setCentre(pill) {
    var num = (pill.querySelector('.n') || {}).textContent || '';
    var title = ((pill.querySelector('h3') || {}).textContent || '').trim();
    var text = ((pill.querySelector('.claim') || {}).textContent || '').trim();
    var a = title, b = '';
    if (title.length > 22) {                       // split a long name across two lines
      var mid = title.lastIndexOf(' ', Math.ceil(title.length / 2) + 4);
      if (mid > 0) { a = title.slice(0, mid); b = title.slice(mid + 1); }
    }
    cNum.textContent = num; cTitle1.textContent = a; cTitle2.textContent = b;
    cTitle1.setAttribute('y', b ? '208' : '218'); cTitle2.setAttribute('y', '228');
    claim.setAttribute('y', b ? '254' : '246');
    claim.textContent = text;
  }

  var arcs = {}, nodes = {}, nums = {};
  pills.forEach(function (p) {
    var a = p.dataset.a;
    arcs[a] = svg.querySelector('#a' + a);
    nodes[a] = svg.querySelector('#n' + a);
    p.setAttribute('tabindex', '0');
    p.setAttribute('role', 'button');
  });
  Array.prototype.forEach.call(svg.querySelectorAll('.rnum'), function (t, i) { nums[String(i + 1)] = t; });

  var current = null;
  function activate(a, byUser) {
    if (byUser) stop();
    if (a === current) return;
    current = a;
    grid.classList.add('live');
    pills.forEach(function (p) {
      var on = p.dataset.a === a;
      p.classList.toggle('on', on);
      if (on && !reduce) {           // restart the stagger
        p.classList.add('stagger');
        void p.offsetWidth;
        p.classList.remove('stagger');
      }
    });
    Object.keys(arcs).forEach(function (k) {
      var arc = arcs[k], on = k === a;
      if (!arc) return;
      arc.classList.toggle('act', on);
      if (on && !reduce && arc.getTotalLength) {
        var len = arc.getTotalLength();
        arc.style.transition = 'none';
        arc.style.strokeDasharray = len;
        arc.style.strokeDashoffset = len;
        void arc.getBoundingClientRect();
        arc.style.transition = '';
        arc.style.strokeDashoffset = 0;
      }
      if (nodes[k]) nodes[k].classList.toggle('act', on);
      if (nums[k]) nums[k].classList.toggle('act', on);
    });
    needle.style.transform = 'rotate(' + ANGLE[a] + 'deg)';
    var pill = pills.filter(function (p) { return p.dataset.a === a; })[0];
    if (pill) {
      centre.classList.add('swap');
      setTimeout(function () { setCentre(pill); centre.classList.remove('swap'); }, reduce ? 0 : 180);
    }
  }

  // autoplay until the visitor interacts
  var timer = null, order = pills.map(function (p) { return p.dataset.a; }).sort();
  var steps = 0;
  function tick() {
    var i = (order.indexOf(current) + 1) % order.length;
    activate(order[i], false);
    if (++steps >= order.length - 1) stop();
  }
  function start() { if (!timer && !reduce && steps < order.length - 1) timer = setInterval(tick, 3200); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } grid.classList.add('held'); }

  pills.forEach(function (p) {
    ['mouseenter', 'focus', 'click'].forEach(function (ev) {
      p.addEventListener(ev, function () { activate(p.dataset.a, true); });
    });
    p.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(p.dataset.a, true); }
    });
  });

  activate((pills.filter(function (p) { return p.classList.contains('on'); })[0] || pills[0]).dataset.a, false);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (grid.classList.contains('held')) return;
        if (e.isIntersecting) start(); else if (timer) { clearInterval(timer); timer = null; }
      });
    }, { threshold: 0.35 }).observe(grid);
  }
})();

/* The method schematic: pointing at a phase chip lights that phase's nodes
   and lines; the rest fades back. */
(function () {
  var flow = document.querySelector('.flow');
  if (!flow) return;
  var chips = flow.querySelectorAll('.fl-chip');
  var parts = flow.querySelectorAll('.fl-stage [data-phase]');
  // a one-line explanation under the pointer, taken from the stage cards
  var steps = document.querySelectorAll('.msteps > div');
  flow.querySelectorAll('.fl-node').forEach(function (n) {
    var step = steps[Number(n.dataset.phase)];
    var text = step ? (step.querySelector('p') || {}).textContent : '';
    if (!text) return;
    var tip = document.createElement('span');
    tip.className = 'fl-tip';
    tip.textContent = text.trim();
    n.appendChild(tip);
  });
  function light(ph) {
    flow.classList.toggle('focus', ph !== null);
    Array.prototype.forEach.call(chips, function (c) { c.classList.toggle('on', c.dataset.phase === ph); });
    Array.prototype.forEach.call(parts, function (el) { el.classList.toggle('lit', el.dataset.phase === ph); });
  }
  Array.prototype.forEach.call(chips, function (c) {
    c.addEventListener('mouseenter', function () { light(c.dataset.phase); });
    c.addEventListener('mouseleave', function () { light(null); });
  });
  flow.querySelectorAll('.fl-node').forEach(function (n) {
    n.addEventListener('mouseenter', function () { light(n.dataset.phase); });
    n.addEventListener('mouseleave', function () { light(null); });
  });
})();
