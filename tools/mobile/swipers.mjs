// Find components you have to swipe sideways on a phone.
//
// The page itself may not scroll while a row inside it still does -- a tab
// strip, a table, a card rail. Each one is a thing the visitor has to discover
// by dragging, and on a phone most of them should simply wrap.
//
//   node tools/mobile/swipers.mjs [width] [en|ar|all]

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
const ONLY = process.argv[3] || 'en';

const pages = globSync('**/*.html', { cwd: root })
  .map(p => p.split(path.sep).join('/'))
  .filter(p => !p.startsWith('tools/'))
  .filter(p => ONLY === 'en' ? !p.startsWith('ar/')
             : ONLY === 'ar' ? p.startsWith('ar/') : true)
  .sort();

const probe = () => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (!/auto|scroll/.test(cs.overflowX) && !/auto|scroll/.test(cs.overflow)) continue;
    const hidden = el.scrollWidth - el.clientWidth;
    if (hidden <= 4 || el.clientWidth === 0) continue;
    // the mobile drawer scrolls vertically by design; ignore pure y-scrollers
    if (el.id === 'mob') continue;
    out.push({
      el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
          (typeof el.className === 'string' && el.className.trim()
            ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''),
      visible: el.clientWidth, hidden,
      kids: el.children.length,
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50),
    });
  }
  return out;
};

const chromium = await loadChromium();
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: 844 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();

const tally = new Map();
for (const rel of pages) {
  await page.goto(pathToFileURL(path.join(root, rel)).href, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const rows = await page.evaluate(probe);
  for (const r of rows) {
    if (!tally.has(r.el)) tally.set(r.el, { n: 0, sample: r, pages: [] });
    const t = tally.get(r.el);
    t.n++;
    if (t.pages.length < 2) t.pages.push(rel);
  }
}
await browser.close();

const rows = [...tally.entries()].sort((a, b) => b[1].n - a[1].n);
console.log(`${W}px ${ONLY}: ${rows.length} distinct swipeable components\n`);
for (const [el, t] of rows) {
  console.log(`${String(t.n).padStart(3)} pages  ${el}`);
  console.log(`           shows ${t.sample.visible}px, ${t.sample.hidden}px off-screen, ${t.sample.kids} children`);
  console.log(`           ${JSON.stringify(t.sample.text)}`);
  console.log(`           e.g. ${t.pages[0]}`);
}
