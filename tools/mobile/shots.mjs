// Full-page phone screenshots for eyeballing.
//   node tools/mobile/shots.mjs <outdir> [width] [page.html ...]
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

async function loadChromium() {
  const tries = ['playwright'];
  try {
    tries.push(pathToFileURL(path.join(
      execSync('npm root -g').toString().trim(), 'playwright', 'index.js')).href);
  } catch {}
  for (const spec of tries) {
    try { const m = await import(spec); const c = m.chromium ?? m.default?.chromium; if (c) return c; } catch {}
  }
  throw new Error('playwright not found');
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const [outdir, widthArg, ...rels] = process.argv.slice(2);
const WIDTH = Number(widthArg || 390);
mkdirSync(outdir, { recursive: true });

const chromium = await loadChromium();
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: WIDTH, height: 844 }, deviceScaleFactor: 1,
  isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
for (const rel of rels) {
  await page.goto(pathToFileURL(path.join(root, rel)).href, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const name = rel.replace(/[\\/]/g, '__').replace(/\.html$/, '') + `-${WIDTH}.png`;
  await page.screenshot({ path: path.join(outdir, name), fullPage: true });
  console.log(name);
}
await browser.close();
