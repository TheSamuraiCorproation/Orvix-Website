/* ══════════════════════════════════════════════════════════════════════════
   ORVIX — engagement page behavior.
   Progressive throughout: with JavaScript off, every question, phase body and
   answer is still in the markup and the menu falls back to plain links.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var ANSWERED = document.documentElement.lang === "ar" ? " مُجاب عنها" : " ANSWERED";
  var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Reveal is opt-in. Without this class every .rv element stays visible, so a
     script failure degrades to a plain page rather than a blank one. */
  document.documentElement.classList.add("js");

  /* ── nav menus ──────────────────────────────────────────────────────── */
  var items = [].slice.call(document.querySelectorAll(".menu__item"));
  function closeAll(except) {
    items.forEach(function (it) {
      if (it !== except) {
        it.dispatchEvent(new CustomEvent("_close"));
        it.setAttribute("data-open", "false");
        var b = it.querySelector(".menu__top");
        if (b) b.setAttribute("aria-expanded", "false");
      }
    });
  }
  items.forEach(function (it) {
    var top = it.querySelector(".menu__top");
    if (!it.querySelector(".mega")) return;
    /* Hover opens; a click pins it open so touch and keyboard behave the same
       way a mouse does, instead of the click cancelling the hover. */
    var pinned = false;
    function open(v) {
      it.setAttribute("data-open", v ? "true" : "false");
      top.setAttribute("aria-expanded", v ? "true" : "false");
      if (v) closeAll(it);
    }
    top.addEventListener("click", function (e) {
      e.stopPropagation();
      pinned = !pinned;
      open(pinned);
    });
    /* Focusing the trigger opens the panel, so a keyboard user can Tab into the
       links. A closed panel is visibility:hidden and correctly untabbable. */
    top.addEventListener("focus", function () { open(true); });
    it.addEventListener("mouseenter", function () { open(true); });
    it.addEventListener("mouseleave", function () { if (!pinned) open(false); });
    it.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { pinned = false; open(false); top.focus(); }
    });
    it.addEventListener("focusout", function (e) {
      if (!it.contains(e.relatedTarget)) { pinned = false; open(false); }
    });
    it.addEventListener("_close", function () { pinned = false; });
  });
  document.addEventListener("click", function () { closeAll(null); });

  var tgl = document.querySelector(".navtoggle");
  var menu = document.querySelector(".menu");
  if (tgl && menu) {
    tgl.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = menu.hasAttribute("data-mobile");
      if (open) { menu.removeAttribute("data-mobile"); menu.style.cssText = ""; }
      else {
        menu.setAttribute("data-mobile", "");
        menu.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;gap:0;" +
          "position:absolute;top:74px;left:0;right:0;background:#03072C;padding:8px 24px 24px;" +
          "border-bottom:1px solid rgba(217,222,231,.13);max-height:70vh;overflow:auto;z-index:90";
      }
      tgl.setAttribute("aria-expanded", open ? "false" : "true");
    });
  }

  /* ── scroll reveal ──────────────────────────────────────────────────── */
  var targets = document.querySelectorAll(".rv");
  if (still || !("IntersectionObserver" in window)) {
    [].forEach.call(targets, function (t) { t.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var d = e.target.getAttribute("data-delay");
        if (d) e.target.style.transitionDelay = d + "ms";
        e.target.classList.add("in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
    [].forEach.call(targets, function (t) { io.observe(t); });
  }

  /* ── figure counters ────────────────────────────────────────────────── */
  function runCount(el) {
    var end = parseInt(el.getAttribute("data-count"), 10);
    if (isNaN(end)) return;
    if (still || end === 0) { el.textContent = String(end); return; }
    var t0 = null;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / 900, 1);
      el.textContent = String(Math.round(end * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var figs = document.querySelectorAll("[data-count]");
  if (!("IntersectionObserver" in window)) { [].forEach.call(figs, runCount); }
  else {
    var io2 = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { runCount(e.target); io2.unobserve(e.target); } });
    }, { threshold: 0.6 });
    [].forEach.call(figs, function (f) { io2.observe(f); });
  }

  /* ── self-check ─────────────────────────────────────────────────────
     Four statements about the reader's own estate. It counts the gaps and
     says plainly when the engagement is not needed — a check that can only
     ever recommend buying is an advertisement, not a check.             */
  var check = document.querySelector("[data-check]");
  if (check) {
    var V = JSON.parse(check.getAttribute("data-check"));
    var qs = check.querySelectorAll(".check__q");
    var fill = check.querySelector(".check__fill");
    var vEl = check.querySelector(".check__verdict");
    var nEl = check.querySelector(".check__note");
    var cEl = check.querySelector(".check__count");
    var state = [];
    for (var i = 0; i < qs.length; i++) state.push(null);

    function paint() {
      var answered = state.filter(function (v) { return v !== null; }).length;
      var gaps = state.filter(function (v) { return v === false; }).length;
      cEl.textContent = answered + " / " + qs.length + ANSWERED;
      fill.style.width = (answered / qs.length * 100) + "%";
      var b = answered < qs.length ? "pending" : (gaps === 0 ? "none" : (gaps <= 2 ? "some" : "many"));
      vEl.textContent = V[b].t;
      nEl.textContent = V[b].n;
    }
    [].forEach.call(qs, function (q, idx) {
      [].forEach.call(q.querySelectorAll("button"), function (b) {
        b.addEventListener("click", function () {
          [].forEach.call(q.querySelectorAll("button"), function (o) { o.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          state[idx] = b.classList.contains("yes");
          paint();
        });
      });
    });
    paint();
  }

  /* ── deliverables: a marker that travels the list ────────────────────
     Continuous, but it stops while the list is off screen — an animation
     nobody is looking at is just battery. */
  var lists = document.querySelectorAll("[data-pop]");
  [].forEach.call(lists, function (list) {
    var rows = list.querySelectorAll(".dl");
    if (!rows.length || still) return;
    var i = -1, timer = null;
    function tick() {
      [].forEach.call(rows, function (r) { r.classList.remove("pop"); });
      i = (i + 1) % rows.length;
      rows[i].classList.add("pop");
    }
    function start() { if (!timer) { tick(); timer = setInterval(tick, 1700); } }
    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      [].forEach.call(rows, function (r) { r.classList.remove("pop"); });
    }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        es[0].isIntersecting ? start() : stop();
      }, { threshold: 0.15 }).observe(list);
    } else { start(); }
  });
})();
