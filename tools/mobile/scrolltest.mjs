// Does the page actually scroll sideways on a phone?
//
// audit.mjs measures scrollWidth right after load. That misses overflow that
// only appears once JS has laid a component out, or once the menu is open, or
// that comes from an element the document does not stretch for. This one waits
// for the page to settle and then *tries to scroll*, which is what a finger
// does.
//
//   node tools/mobile/scrolltest.mjs [width] [en|ar|all]

import { globSync } from 'node:fs';
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
  throw new Error('playwright not found');
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const W = Number(process.argv[2] || 390);
const ONLY = process.argv[3] || 'all';

const pages = globSync('**/*.html', { cwd: root })
  .map(p => p.split(path.sep).join('/'))
  .filter(p => !p.startsWith('tools/'))
  .filter(p => ONLY === 'en' ? !p.startsWith('ar/')
             : ONLY === 'ar' ? p.startsWith('ar/') : true)
  .sort();

// what is sticking out, once we know something is
const culprits = (vw) => {
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.right <= vw + 1) continue;
    // ignore anything an ancestor clips
    let clipped = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (/hidden|clip|auto|scroll/.test(pcs.overflowX + pcs.overflow) &&
          p.getBoundingClientRect().right <= vw + 1) { clipped = true; break; }
    }
    if (clipped) continue;
    const key = el.tagName.toLowerCase() +
      (el.id ? '#' + el.id : '') +
      (typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ el: key, right: Math.round(r.right), over: Math.round(r.right - vw),
               text: (el.textContent || '').trim().slice(0, 40) });
  }
  return out.sort((a, b) => b.over - a.over).slice(0, 6);
};

const chromium = await loadChromium();
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: 844 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
             '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();

let bad = 0;
for (const rel of pages) {
  await page.goto(pathToFileURL(path.join(root, rel)).href, { waitUntil: 'load' });
  await page.waitForTimeout(900);            // let JS-built components settle
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);            // trip any scroll-triggered reveal
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);

  for (const state of ['closed', 'open']) {
    if (state === 'open') {
      const bg = page.locator('#bg');
      if (await bg.count() === 0) continue;
      await bg.tap().catch(() => {});
      await page.waitForTimeout(400);
    }
    const res = await page.evaluate((vw) => {
      window.scrollTo(9999, 0);
      const x = Math.round(window.scrollX);
      window.scrollTo(0, 0);
      return { x, doc: document.documentElement.scrollWidth,
               body: document.body.scrollWidth, vw };
    }, W);
    if (res.x > 0 || res.doc > W + 1 || res.body > W + 1) {
      bad++;
      const who = await page.evaluate(culprits, W);
      console.log(`SIDEWAYS  ${rel}  [${state}]  scrollX=${res.x} doc=${res.doc} body=${res.body}`);
      for (const c of who) console.log(`             ${c.el}  right=${c.right} (+${c.over})  ${JSON.stringify(c.text)}`);
    }
    if (state === 'open') {
      await page.locator('#bg').tap().catch(() => {});
      await page.waitForTimeout(200);
    }
  }
}
await browser.close();
console.log(`\n${W}px ${ONLY}: ${pages.length} pages, ${bad} scroll sideways`);
