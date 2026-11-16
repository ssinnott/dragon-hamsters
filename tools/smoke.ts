// Headless smoke test: the real game boots in a browser, served as TypeScript by tools/server.ts
// with nothing compiled to disk, draws a title screen, and survives a new game into the Burrow.
// Usage: node tools/smoke.ts   (exit code 1 on any failure)
//
// 1. Serve the repo on a free port and load index.html in headless Chromium.
// 2. Wait for window.__game.ready (src/main.ts sets it after wiring every screen).
// 3. No page errors, the title is on top, and the canvas is really drawn (many distinct colours;
//    a blank or single-fill page has 1-2).
// 4. window.__game.api.newGame(7, undefined, { skipTutorials: true }), a few hundred frames, then:
//    the Burrow is on top, the world was autosaved, the canvas is drawn, and still no errors.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from './server.ts';

const require = createRequire(import.meta.url);

function loadPlaywright(): any {
  for (const c of ['/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright', 'playwright', 'playwright-core']) {
    try { return require(c); } catch { /* next */ }
  }
  throw new Error('Playwright not found');
}

async function launch(chromium: any): Promise<any> {
  try { return await chromium.launch(); }
  catch (e) {
    const exe = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
    if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe });
    throw e;
  }
}

let bad = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log((cond ? '  ok:   ' : '  FAIL: ') + msg);
  if (!cond) bad++;
};

const server = createServer();
await new Promise<void>((r) => server.listen(0, () => r()));
const port = (server.address() as { port: number }).port;

const { chromium } = loadPlaywright();
const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push('pageerror: ' + e.message));
page.on('console', (m: any) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r: any) => errors.push('request failed: ' + r.url()));
page.on('response', (r: any) => {
  if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) errors.push(`HTTP ${r.status()}: ${r.url()}`);
});

/** Distinct RGB colours on the game canvas right now. */
const colours = (): Promise<number> => page.evaluate(() => {
  const c = document.getElementById('stage') as HTMLCanvasElement;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set<number>();
  for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return seen.size;
});
const gameErrors = (): Promise<string[]> => page.evaluate(() => (window as any).__game?.errors ?? []);
const api = <T>(fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([f, a]: [string, unknown[]]) => (window as any).__game.api[f](...a), [fn, args] as [string, unknown[]]);

try {
  await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load' });
  let ready = true;
  try {
    await page.waitForFunction(() => (window as any).__game?.ready === true, null, { timeout: 20000 });
  } catch {
    ready = false;
  }
  ok(ready, 'the game boots (window.__game.ready)');
  if (ready) {
    await page.waitForTimeout(400);
    await api('step', 60);
    const all = [...errors, ...(await gameErrors())];
    ok(all.length === 0, `no page errors on the title screen${all.length ? ' -> ' + all.join(' | ') : ''}`);
    const top = await api<string | null>('scene');
    ok(top === 'title', `the title screen is on top (got ${JSON.stringify(top)})`);
    const n = await colours();
    ok(n > 40, `the title screen is drawn (${n} distinct colours; a blank page has 1-2)`);

    await api('newGame', 7, undefined, { skipTutorials: true });
    for (let i = 0; i < 6; i++) await api('step', 50);
    const top2 = await api<string | null>('scene');
    ok(top2 === 'burrow', `newGame(7) lands in the Burrow (got ${JSON.stringify(top2)})`);
    const state = await api<{ dragons: unknown[]; squad: string[]; flags: Record<string, boolean> }>('state');
    ok(state.dragons.length === 2 && state.squad.length === 2 && state.flags.introDone === true,
      `two starters in the squad (${state.dragons.length} dragons, squad ${state.squad.length})`);
    const saved = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (k.startsWith('dragon-hamsters/save')) return (JSON.parse(localStorage.getItem(k) ?? '{}').dragons ?? []).length;
      }
      return -1;
    });
    ok(saved === 2, `the Burrow autosaved the new world (saved dragons: ${saved})`);
    const n2 = await colours();
    ok(n2 > 40, `the Burrow is drawn (${n2} distinct colours)`);
    const all2 = [...errors, ...(await gameErrors())];
    ok(all2.length === 0, `still no page errors${all2.length ? ' -> ' + all2.join(' | ') : ''}`);
  } else {
    const all = [...errors, ...(await gameErrors().catch(() => [] as string[]))];
    if (all.length) console.log('  errors: ' + all.join('\n          '));
  }
} catch (e) {
  ok(false, 'smoke run threw: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  await browser.close();
  server.close();
}

console.log(bad ? `\nSMOKE FAILED (${bad})` : '\nSMOKE OK: the game boots, draws its title and reaches the Burrow with no errors.');
process.exit(bad ? 1 : 0);
