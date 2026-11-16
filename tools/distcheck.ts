// The shipped build boots from disk: dist/index.html (npm run build) loaded through file:// in
// headless Chromium, no server, must reach the title screen and draw it with no errors.
// Usage: npm run build && node tools/distcheck.ts   (npm run distcheck; exit code 1 on any failure)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'index.html');

function loadPlaywright(): any {
  for (const c of ['playwright', '/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright', 'playwright-core']) {
    try { return require(c); } catch { /* next */ }
  }
  throw new Error('Playwright not found');
}

let bad = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log((cond ? '  ok:   ' : '  FAIL: ') + msg);
  if (!cond) bad++;
};

ok(fs.existsSync(DIST), 'dist/index.html exists (run npm run build first)');
if (bad) process.exit(1);
const html = fs.readFileSync(DIST, 'utf8');
ok(!/src=["'](\.\/)?src\//.test(html) && !/type=["']module["']/.test(html), 'the page is self-contained (no module script, nothing from src/)');

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 });
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push('pageerror: ' + e.message));
page.on('console', (m: any) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r: any) => errors.push('request failed: ' + r.url()));
try {
  const url = pathToFileURL(DIST).href;
  await page.goto(url, { waitUntil: 'load' });
  let ready = true;
  try {
    await page.waitForFunction(() => (window as any).__game?.ready === true, null, { timeout: 20000 });
  } catch {
    ready = false;
  }
  ok(ready, `boots from ${url}`);
  if (ready) {
    await page.waitForTimeout(500);
    await page.evaluate(() => (window as any).__game.api.step(60));
    const top = await page.evaluate(() => (window as any).__game.api.scene());
    ok(top === 'title', `the title screen is on top (got ${JSON.stringify(top)})`);
    const colours: number = await page.evaluate(() => {
      const c = document.getElementById('stage') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return seen.size;
    });
    ok(colours > 40, `the title is drawn (${colours} distinct colours)`);
    await page.screenshot({ path: path.join(ROOT, 'screenshots', 'dist-title.png') });
  }
  const all = [...errors, ...(await page.evaluate(() => (window as any).__game?.errors ?? []).catch(() => [] as string[]))];
  ok(all.length === 0, `no errors${all.length ? ' -> ' + all.join(' | ') : ''}`);
} catch (e) {
  ok(false, 'distcheck threw: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  await browser.close();
}
console.log(bad ? `\nDISTCHECK FAILED (${bad})` : '\nDISTCHECK OK: dist/index.html boots from file:// to the title with no errors.');
process.exit(bad ? 1 : 0);
