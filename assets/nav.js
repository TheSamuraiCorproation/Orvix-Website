/* Orvix - shared navigation behaviour. One copy, loaded by every page.

   Header menus  the four menu buttons open on click or tap, and for mouse
                 users on hover as well. Only one panel is open at a time;
                 Escape, a click outside the bar or tabbing away closes it.
   Drawer        below 1120px the burger toggles the drawer; Escape closes
                 it, and it closes itself if the viewport grows past the
                 breakpoint with it open.
   Photo slots   a .ph slot that has a picture, or any element carrying an
                 inline --img, gets .filled so its placeholder brief hides.

   Plain ES5, no dependencies, safe to load with defer. */
(function () {
  'use strict';

  var doc = document;
  var nav = doc.getElementById('nav');
  var fine = !!(window.matchMedia && matchMedia('(hover:hover) and (pointer:fine)').matches);

  /* ---- header menus ---------------------------------------------------- */

  function setOpen(li, on) {
    li.classList.toggle('open', on);
    var b = li.querySelector('button.has');
    if (b) b.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  function closeAll(except) {
    if (!nav) return;
    var open = nav.querySelectorAll('.nav-l>li.open');
    for (var i = 0; i < open.length; i++) {
      if (open[i] !== except) setOpen(open[i], false);
    }
  }

  function wire(li) {
    var b = li.querySelector('button.has');
    if (!b) return;                       // a plain link item, nothing to open
    b.setAttribute('aria-expanded', 'false');

    b.addEventListener('click', function (e) {
      e.preventDefault();
      var on = !li.classList.contains('open');
      // with a mouse the panel is already open from hover: a click on it
      // keeps it open rather than flickering it shut
      if (!on && fine) return;
      closeAll(li);
      setOpen(li, on);
    });

    if (fine) {
      li.addEventListener('mouseenter', function () { closeAll(li); setOpen(li, true); });
      li.addEventListener('mouseleave', function () { setOpen(li, false); });
    }

    // keyboard: tabbing out of the item closes it. relatedTarget is null
    // when focus falls to the document (iOS taps do this), and that case is
    // left to the outside-click handler so the tap is not swallowed.
    li.addEventListener('focusout', function (e) {
      if (e.relatedTarget && !li.contains(e.relatedTarget)) setOpen(li, false);
    });
  }

  if (nav) {
    var items = nav.querySelectorAll('.nav-l>li');
    for (var i = 0; i < items.length; i++) wire(items[i]);

    doc.addEventListener('click', function (e) {
      if (!nav.contains(e.target)) closeAll();
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      var open = nav.querySelector('.nav-l>li.open');
      if (!open) return;
      var b = open.querySelector('button.has');
      closeAll();
      if (b) b.focus();
    });
  }

  /* ---- drawer ----------------------------------------------------------- */

  var bg = doc.getElementById('bg'), mob = doc.getElementById('mob');
  if (bg && mob) {
    var drawer = function (on) {
      mob.classList.toggle('open', on);
      bg.classList.toggle('x', on);
      bg.setAttribute('aria-expanded', on ? 'true' : 'false');
      doc.body.style.overflow = on ? 'hidden' : '';
    };
    bg.addEventListener('click', function () { drawer(!mob.classList.contains('open')); });

    var links = mob.querySelectorAll('a');
    for (var j = 0; j < links.length; j++) {
      links[j].addEventListener('click', function () { drawer(false); });
    }
    doc.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && mob.classList.contains('open')) {
        drawer(false);
        bg.focus();
      }
    });
    if (window.matchMedia) {
      var wide = matchMedia('(min-width:1121px)');
      var onWide = function () { if (wide.matches && mob.classList.contains('open')) drawer(false); };
      if (wide.addEventListener) wide.addEventListener('change', onWide);
      else if (wide.addListener) wide.addListener(onWide);
    }
  }

  /* ---- photo slots ------------------------------------------------------ */

  function fillSlots() {
    var ph = doc.querySelectorAll('.ph:not(.filled)');
    for (var k = 0; k < ph.length; k++) {
      if (getComputedStyle(ph[k]).backgroundImage !== 'none') ph[k].classList.add('filled');
    }
  }
  fillSlots();
  var st = doc.querySelectorAll('[style*="--img"]');
  for (var m = 0; m < st.length; m++) st[m].classList.add('filled');

  /* Below-the-fold photos are held back while <html> has .bgwait (see
     "photo deferral" in assets/css/main.css), so those slots look empty on
     the first pass. Check again the moment the class comes off. */
  var root = doc.documentElement;
  if (root.classList.contains('bgwait') && 'MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      if (!root.classList.contains('bgwait')) { mo.disconnect(); fillSlots(); }
    });
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---- phones: keep the contact button within reach --------------------- */

  var headCta = doc.querySelector('#nav .nav-cta');
  var path = location.pathname;
  if (headCta && !/\/company\/contact\/?$/.test(path) && !/\/admin\//.test(path)) {
    var fab = doc.createElement('a');
    fab.className = 'cta-float';
    fab.href = headCta.getAttribute('href');
    fab.textContent = headCta.textContent;
    doc.body.appendChild(fab);
    var foot = doc.querySelector('footer');
    var drawer = doc.getElementById('mob');
    var floatOn = false, queued = false;
    var syncFloat = function () {
      queued = false;
      var y = window.pageYOffset || root.scrollTop || 0;
      var nearEnd = foot && foot.getBoundingClientRect().top < window.innerHeight - 60;
      var on = y > 480 && !nearEnd && !(drawer && drawer.classList.contains('open'));
      if (on !== floatOn) { floatOn = on; fab.classList.toggle('on', on); }
    };
    var queueFloat = function () { if (!queued) { queued = true; setTimeout(syncFloat, 60); } };
    window.addEventListener('scroll', queueFloat, { passive: true });
    window.addEventListener('resize', queueFloat);
    doc.addEventListener('click', queueFloat);          // the burger opens and closes the drawer
    syncFloat();
  }
})();
