// Screenshot each card in tools/seo/_ogsheet.html to assets/img/og/<name>.png
//
//   python -m tools.seo ogcards      # build the sheet
//   node tools/seo/render_og.mjs     # render it
//
// Needs Playwright's chromium. If it is not installed the SEO build still
// passes -- og:image URLs are emitted regardless, they just 404 until this runs.

import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Playwright is a dev dependency, not the site's. Take it from the project if
// it is there, otherwise from the global npm root, so this runs without adding
// a package.json to a static export that has never needed one.
async function loadChromium() {
  const tries = ['playwright'];
  try {
    tries.push(pathToFileURL(
      path.join(execSync('npm root -g').toString().trim(), 'playwright', 'index.js')
    ).href);
  } catch { /* npm not on PATH; the bare specifier may still work */ }
  for (const spec of tries) {
    try {
      // playwright is CommonJS: importing it from ESM puts the exports on
      // .default, except where Node's interop already hoisted them.
      const m = await import(spec);
      const c = m.chromium ?? m.default?.chromium;
      if (c) return c;
    } catch { /* next */ }
  }
  throw new Error(
    'playwright not found. Install it (npm i -D playwright) and re-run.\n' +
    'The SEO build does not depend on this step: og:image URLs are emitted\n' +
    'either way, they just 404 until the cards are rendered.'
  );
}

const chromium = await loadChromium();

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const sheet = path.join(root, 'tools', 'seo', '_ogsheet.html');
const out = path.join(root, 'assets', 'img', 'og');

mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
await page.goto(pathToFileURL(sheet).href);
await page.waitForLoadState('networkidle');
await page.evaluate(() => document.fonts.ready);

const cards = await page.locator('.card').all();
let n = 0;
for (const card of cards) {
  const name = await card.getAttribute('data-name');
  await card.screenshot({ path: path.join(out, name) });
  n++;
}
await browser.close();
console.log(`og images: ${n} written to assets/img/og/`);
