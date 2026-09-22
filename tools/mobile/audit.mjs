// Mobile audit. Loads every page at a phone viewport and reports failures that
// a user would actually see, filtering the ones that only look like failures:
//
//   * an oversized decorative layer inside an overflow:hidden parent is fine
//   * an SVG's internals extending past its own viewBox is fine
//   * an inline text link being under 44px tall is fine; a button is not
//   * a scroller that declares overflow-x is fine; one that silently clips is not
//
//   node tools/mobile/audit.mjs [width] [en|ar]
//
// Writes tools/mobile/_audit-<width>.json and prints a summary.

import { writeFileSync, mkdirSync, globSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

async function loadChromium() {
  const tries = ['playwright'];
  try {
    tries.push(pathToFileURL(path.join(
      execSync('npm root -g').toString().trim(), 'playwright', 'index.js')).href);
  } catch { /* fall through */ }
  for (const spec of tries) {
    try {
      const m = await import(spec);
      const c = m.chromium ?? m.default?.chromium;
      if (c) return c;
    } catch { /* next */ }
  }
  throw new Error('playwright not found (npm i -D playwright)');
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const WIDTH = Number(process.argv[2] || 390);
const ONLY = process.argv[3] || '';

const pages = globSync('**/*.html', { cwd: root })
  .map(p => p.split(path.sep).join('/'))
  .filter(p => !p.startsWith('tools/'))
  .filter(p => ONLY === 'en' ? !p.startsWith('ar/')
             : ONLY === 'ar' ? p.startsWith('ar/') : true)
  .sort();

const probe = (vw) => {
  const out = { overflow: null, wide: [], tiny: [], smallTap: [], clipped: [] };
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1) {
    out.overflow = { scrollWidth: de.scrollWidth, viewport: vw };
  }

  const label = el => {
    const id = el.id ? '#' + el.id : '';
    const cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return el.tagName.toLowerCase() + id + cls;
  };

  // Is the overflow contained by an ancestor that clips, or does it really
  // reach past the edge of the page?
  const containedByClip = el => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'hidden' || cs.overflowX === 'clip' ||
          cs.overflow === 'hidden' || cs.overflow === 'clip') {
        if (p.getBoundingClientRect().right <= vw + 1) return true;
      }
    }
    return false;
  };

  const decorative = el => {
    if (el.closest('svg')) return true;               // svg internals clip to viewBox
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.closest('[aria-hidden="true"]')) return true;
    const cs = getComputedStyle(el);
    if (cs.pointerEvents === 'none' && !el.textContent.trim()) return true;
    return false;
  };

  const ownText = el => [...el.childNodes]
    .filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();

  const seen = new Set();
  const once = (k, fn) => { if (!seen.has(k)) { seen.add(k); fn(); } };

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const key = label(el);

    // -- reaches past the viewport edge and nothing clips it ---------------
    if (r.width > 8 && (r.right > vw + 1 || r.left < -1)) {
      if (!decorative(el) && !containedByClip(el)) {
        once('w' + key, () => out.wide.push({
          el: key, left: Math.round(r.left), right: Math.round(r.right),
          overflowBy: Math.round(Math.max(r.right - vw, -r.left)),
          text: (el.textContent || '').trim().slice(0, 45),
        }));
      }
    }

    // -- text under 12px ---------------------------------------------------
    const fs = parseFloat(cs.fontSize);
    const t = ownText(el);
    if (t.length > 2 && fs > 0 && fs < 12 && !el.closest('svg')) {
      once('t' + key, () => out.tiny.push({
        el: key, fontSize: +fs.toFixed(1), transform: cs.textTransform,
        sample: t.slice(0, 40),
      }));
    }

    // -- tap targets: real controls only, not inline prose links -----------
    if (el.matches('button, input, select, [role=tab], [role=button], .btn, .cvg-tab') ||
        (el.matches('a[href]') && (cs.display !== 'inline' || el.querySelector('img')))) {
      const inProse = el.matches('a[href]') && el.closest('p, li');
      if (!inProse && r.height > 0 && (r.height < 40 || r.width < 30)) {
        once('s' + key, () => out.smallTap.push({
          el: key, w: Math.round(r.width), h: Math.round(r.height),
          text: (el.textContent || '').trim().slice(0, 30),
        }));
      }
    }

    // -- content wider than its box, with no way to reach it ---------------
    if (el.scrollWidth > el.clientWidth + 8 && el.clientWidth > 0) {
      const ov = cs.overflowX;
      if (ov !== 'auto' && ov !== 'scroll' && !el.closest('svg') &&
          (el.textContent || '').trim().length > 0) {
        once('c' + key, () => out.clipped.push({
          el: key, lost: el.scrollWidth - el.clientWidth,
          clientWidth: el.clientWidth, overflowX: ov,
          text: (el.textContent || '').trim().slice(0, 45),
        }));
      }
    }
  }
  return out;
};

const chromium = await loadChromium();
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: WIDTH, height: 844 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
             '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();

const results = {};
for (const rel of pages) {
  await page.goto(pathToFileURL(path.join(root, rel)).href, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  results[rel] = await page.evaluate(probe, WIDTH);
}
await browser.close();

mkdirSync(here, { recursive: true });
writeFileSync(path.join(here, `_audit-${WIDTH}.json`), JSON.stringify(results, null, 1));

const tally = { overflow: 0, wide: 0, tiny: 0, smallTap: 0, clipped: 0 };
const byKind = { wide: {}, tiny: {}, smallTap: {}, clipped: {} };
for (const r of Object.values(results)) {
  if (r.overflow) tally.overflow++;
  for (const k of ['wide', 'tiny', 'smallTap', 'clipped']) {
    if (r[k].length) tally[k]++;
    for (const item of r[k]) byKind[k][item.el] = (byKind[k][item.el] || 0) + 1;
  }
}
console.log(`viewport ${WIDTH}px   pages ${pages.length}`);
console.log(`  page scrolls sideways      : ${tally.overflow}`);
console.log(`  element past the edge      : ${tally.wide}`);
console.log(`  text under 12px            : ${tally.tiny}`);
console.log(`  control under 40px         : ${tally.smallTap}`);
console.log(`  content silently clipped   : ${tally.clipped}`);
for (const k of ['wide', 'clipped', 'smallTap', 'tiny']) {
  const top = Object.entries(byKind[k]).sort((a, b) => b[1] - a[1]).slice(0, 14);
  if (top.length) {
    console.log(`\n${k}:`);
    for (const [el, n] of top) console.log(`  ${String(n).padStart(4)} pages  ${el}`);
  }
}
