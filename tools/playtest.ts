// End-to-end playtest: the REAL game (index.html served as TypeScript by tools/server.ts) in headless
// Chromium, played the way a first-time player would, with a screenshot of every screen on the way.
// Usage: node tools/playtest.ts   (npm run playtest; exit code 1 on any failure)
//
// The route:
//   title -> NEW GAME -> Chief Nibbles' intro -> pick two starters -> the Burrow and its tutorial
//   -> each of the five activities once (the Snack Bar with a food, the nap last) -> shop: buy a Seed Cake
//   -> bag: use a Seed Cake -> roster (every tab, swap two moves) -> Dragondex -> type chart
//   -> mission board -> briefing for case 1 -> AUTO-PICK -> LAUNCH -> every stop of the trail
//   (dialogs, the rest stop, battles: the first turn by FIGHT -> a move, then autoplay) -> results
//   (evolutions, the new dragon's reveal) -> the Burrow -> SLEEP.
//   Then the API fast-forwards (levels through the real XP path, earlier cases marked cleared in the
//   save) and one case of every other gang runs on autoplay: a DEFEND with its rest stop, a SABOTAGE
//   with its branch choice, a RESCUE and its new dragon, and an INFILTRATE; boss counter-swaps are
//   photographed when they happen. A lost case is slept off and tried once more; case 1 must be won
//   within three tries.
//
// Every random draw in the page comes from one seed (PLAYTEST_SEED, default 20240611), so a run is
// repeatable screen for screen.
//
// Input is injected through window.__game.api (key / click, in game coordinates) exactly where a
// player would press: buttons are found by label in api.buttons(), the list of what the player
// could press after the latest update. The real-time loop is stopped and api.step(n) drives the
// game, so every run sees the same frames and the screenshots land on the frame they name.
//
// Fails on any page error, console error, failed request, a game frame that threw, or a screen that
// does not move on within its frame budget. Screenshots: screenshots/playtest/NNN-name.png (640x360
// viewport at deviceScaleFactor 2, so 1280x720 with crisp pixels).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from './server.ts';
import { MISSIONS } from '../src/data/index.ts';
import type { ActivityId, MissionId, SpeciesId } from '../src/data/schema.ts';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots', 'playtest');
/** The world (and every dice roll) the playtest plays; PLAYTEST_SEED overrides it. */
const SEED = (Number(process.env.PLAYTEST_SEED) || 20240611) >>> 0;
/** Wall-clock cap for the whole run. */
const TIME_LIMIT_MS = 12 * 60 * 1000;

function loadPlaywright(): any {
  for (const c of ['playwright', '/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright', 'playwright-core']) {
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

class PlaytestFailure extends Error {}

// ---------------------------------------------------------------------------------------------
// What the page tells us after each step
// ---------------------------------------------------------------------------------------------

interface Rect { x: number; y: number; w: number; h: number }
interface LiveButton { label: string; sub?: string; hotkey?: string; rect: Rect; enabled: boolean }

interface Snap {
  scene: string | null;
  busy: boolean;
  depth: number;
  buttons: LiveButton[];
  intro: { phase: string; line: number } | null;
  burrow: string | null;
  run: { phase: string; node: string | null; index: number } | null;
  battle: { menu: string | null; busy: boolean; text: string; textDone: boolean; swaps: number; boss: boolean; turn: number } | null;
  results: { stage: string; animating: boolean } | null;
  evo: { evolved: boolean; revealT: number } | null;
}

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

const started = Date.now();
const shots: string[] = [];
const scenesSeen: string[] = [];
const log: string[] = [];
const browserErrors: string[] = [];
let frames = 0;
let page: any = null;
/** The first SUPER EFFECTIVE line of the run gets its own screenshot. */
let superShot = false;

const note = (msg: string): void => { log.push(msg); console.log('  ' + msg); };

function fail(msg: string): never {
  throw new PlaytestFailure(msg);
}

async function snap(): Promise<Snap> {
  const s: Snap = await page.evaluate(() => {
    const api = (window as any).__game.api;
    const d = api.debug();
    const scene: string | null = api.scene();
    const ui = d.battleUi;
    const b = d.battle;
    return {
      scene, busy: api.busy(), depth: api.depth(), buttons: api.buttons(),
      intro: scene === 'intro' && d.intro ? { phase: d.intro.phase(), line: d.intro.line() } : null,
      burrow: scene === 'burrow' && d.burrow ? d.burrow.mode() : null,
      run: d.run ? { phase: d.run.phase(), node: d.run.node(), index: d.run.index() } : null,
      battle: scene === 'battle' && ui && b ? {
        menu: ui.menu(), busy: ui.busy(), text: ui.text(), textDone: ui.textDone(), swaps: b.enemySwaps,
        boss: b.enemy.team.some((m: any) => m.isBoss), turn: b.turn,
      } : null,
      results: scene === 'results' && d.results ? { stage: d.results.stage(), animating: d.results.animating() } : null,
      evo: scene === 'evolution' && d.evolution ? { evolved: d.evolution.evolved(), revealT: d.evolution.revealT() } : null,
    };
  });
  if (s.scene && scenesSeen[scenesSeen.length - 1] !== s.scene) scenesSeen.push(s.scene);
  return s;
}

/** Run n fixed updates (and one render); fail at once on any error the page reported. */
async function step(n = 1): Promise<void> {
  const errs: string[] = await page.evaluate((k: number) => {
    const api = (window as any).__game.api;
    api.step(k);
    return api.errors();
  }, n);
  frames += n;
  const all = [...browserErrors, ...errs];
  if (all.length) fail('the page reported errors:\n    ' + all.join('\n    '));
  if (Date.now() - started > TIME_LIMIT_MS) fail(`time limit (${TIME_LIMIT_MS / 60000} min) reached`);
}

/** Step until `cond` holds; fail with `what` if it takes more than maxFrames. */
async function until(what: string, cond: (s: Snap) => boolean, maxFrames = 900, chunk = 4): Promise<Snap> {
  let waited = 0;
  for (;;) {
    const s = await snap();
    if (cond(s)) return s;
    if (waited >= maxFrames) {
      await shot('STUCK-' + (s.scene ?? 'none'));
      fail(`stuck: ${what} (scene '${s.scene}' after ${waited} frames; buttons: ${s.buttons.map((b) => b.label || b.hotkey).join(', ') || 'none'})`);
    }
    await step(chunk);
    waited += chunk;
  }
}

/** Save the current frame as screenshots/playtest/NNN-name.png. */
async function shot(name: string): Promise<void> {
  await step(1);
  const file = `${String(shots.length + 1).padStart(3, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  shots.push(file);
}

async function key(k: string, settle = 3): Promise<void> {
  await page.evaluate((kk: string) => (window as any).__game.api.key(kk), k);
  await step(settle);
}

async function clickAt(x: number, y: number, settle = 3): Promise<void> {
  await page.evaluate(([cx, cy]: [number, number]) => (window as any).__game.api.click(cx, cy), [Math.round(x), Math.round(y)]);
  await step(settle);
}

async function clickRect(r: Rect, settle = 3): Promise<void> {
  await clickAt(r.x + r.w / 2, r.y + r.h / 2, settle);
}

const matches = (b: LiveButton, label: string | string[]): boolean =>
  Array.isArray(label) ? label.some((l) => matches(b, l)) : b.label === label || (label.length > 2 && b.label.startsWith(label));

/** Click the (topmost) enabled button labelled `label` (or any of several), waiting for it first. */
async function press(label: string | string[], settle = 3, maxFrames = 400): Promise<void> {
  const s = await until(`a '${label}' button`, (x) => !x.busy && x.buttons.some((b) => b.enabled && matches(b, label)), maxFrames);
  const b = [...s.buttons].reverse().find((x) => x.enabled && matches(x, label))!;
  await clickRect(b.rect, settle);
}

/** The trail's big action button says what the next stop is. */
const GO_LABELS = ['GO!', 'FIGHT!', 'SHOWDOWN!', 'REST', 'DECIDE'];

async function setAutoplay(on: boolean): Promise<void> {
  await page.evaluate((v: boolean) => { (window as any).__game.api.debug().autoplay = v; }, on);
}

/**
 * Read every page of the dialog(s) on top, one Enter at a time (the first finishes the typewriter,
 * the next turns the page). Photographs the first page as `name` when given.
 */
async function readDialogs(name?: string): Promise<void> {
  let s = await until('a dialog', (x) => x.scene === 'dialog' && !x.busy, 300);
  if (name) {
    await step(40);
    await shot(name);
  }
  for (let presses = 0; s.scene === 'dialog'; presses++) {
    if (presses > 80) fail('a dialog that never ends');
    await key('Enter', 4);
    s = await snap();
  }
}

/** Press a Burrow hotkey and arrive at its screen, reading (and photographing) a first-visit tutorial. */
async function open(k: string, scene: string, tutorial: string): Promise<void> {
  await key(k, 6);
  await until(`the ${scene} screen`, (x) => !x.busy && (x.scene === scene || x.scene === 'dialog'), 300);
  // the tutorial may wait for the screen to settle (the board deals its cards first)
  for (let i = 0; i < 60 && (await snap()).scene !== 'dialog'; i += 4) await step(4);
  if ((await snap()).scene === 'dialog') await readDialogs(tutorial);
  else fail(`no first-visit tutorial on the ${scene} screen`);
  await arrive(scene);
}

/** Wait for a scene to be on top and settled (no fade). */
async function arrive(scene: string, maxFrames = 600): Promise<Snap> {
  return until(`the ${scene} screen`, (s) => s.scene === scene && !s.busy, maxFrames);
}

// ---------------------------------------------------------------------------------------------
// Pieces of the route
// ---------------------------------------------------------------------------------------------

async function burrowStation(id: ActivityId): Promise<{ x: number; y: number }> {
  return page.evaluate((a: string) => (window as any).__game.api.debug().burrow.station(a), id);
}

/** Do one activity at a Burrow station: click it, pick the first dragon that can (and a food). */
async function activity(id: ActivityId, food: boolean): Promise<void> {
  await until('the Burrow hub', (s) => s.scene === 'burrow' && s.burrow === 'hub' && !s.busy);
  const c = await burrowStation(id);
  await clickAt(c.x, c.y, 6);
  await until(`the ${id} panel`, (s) => s.burrow === 'station', 60);
  if (food) {
    await shot('burrow-snackbar-pick-dragon');
    await press('NEXT', 6);
    await shot('burrow-snackbar-pick-food');
    await press('FEED!', 6);
  } else {
    await press('GO!', 6);
  }
  await until(`the ${id} vignette`, (s) => s.burrow === 'vignette', 60);
  await step(food ? 100 : 130);
  await shot(`burrow-${id}`);
  await until(`the ${id} result card`, (s) => s.burrow === 'result', 600);
  await step(90);
  await shot(`burrow-${id}-result`);
  await press('OK!', 6);
  // a level-up can start an evolution right here
  const s = await snap();
  if (s.scene === 'evolution') await playEvolution(`burrow-${id}`);
}

async function playEvolution(tag: string): Promise<void> {
  await until('the evolution reveal', (s) => s.scene === 'evolution' && !!s.evo && s.evo.evolved && s.evo.revealT > 1.4, 900);
  await shot(`${tag}-evolution`);
  for (let i = 0; i < 40; i++) {
    const s = await snap();
    if (s.scene !== 'evolution') return;
    await key('Enter', 12);
  }
  fail('the evolution scene never closed');
}

/** A screenshot in the middle of an autoplayed battle: back to 1x for the frame, so the line stays put. */
async function calmShot(name: string): Promise<void> {
  await setAutoplay(false);
  await shot(name);
  await setAutoplay(true);
}

/** The battle on top: optionally the first turn by hand (FIGHT -> the best move), then autoplay. */
async function playBattle(tag: string, o: { manual: boolean; shoot: boolean; bossShot: boolean }): Promise<void> {
  let s = await until('the battle', (x) => x.scene === 'battle' && !!x.battle, 300, 2);
  const boss = !!s.battle?.boss;
  if (o.manual || (boss && o.bossShot) || o.shoot) {
    await setAutoplay(false);
    s = await until('the battle menu', (x) => x.scene !== 'battle' || (x.battle?.menu === 'main' && !x.battle.busy), 1800);
    if (s.scene !== 'battle') return;
    await shot(boss ? `${tag}-boss-battle` : `${tag}-battle`);
  }
  if (o.manual) {
    // the rock-paper-scissors helpers a new player reaches for: the SWAP cards (star grades) and
    // the [?] type chart opened on this very matchup
    await press('SWAP', 4);
    await until('the swap cards', (x) => x.battle?.menu === 'swap', 30, 1);
    await step(10);
    await shot(`${tag}-battle-swap-cards`);
    await key('Escape', 4);
    await until('the battle menu again', (x) => x.battle?.menu === 'main', 30, 1);
    await press('TYPES', 6);
    await arrive('typechart', 60);
    await step(20);
    await shot(`${tag}-battle-type-chart`);
    await key('Escape', 6);
    await until('the battle menu again', (x) => x.scene === 'battle' && x.battle?.menu === 'main' && !x.busy, 60, 1);
    await press('FIGHT', 4);
    await until('the move menu', (x) => x.battle?.menu === 'fight', 30, 1);
    await shot(`${tag}-battle-moves`);
    const slot: number = await page.evaluate(async () => {
      const url = '/src/ui/battle/auto.ts';
      const auto = await import(url);
      return auto.bestMove((window as any).__game.api.debug().battle);
    });
    const s2 = await snap();
    const btn = s2.buttons.find((b) => b.hotkey === String(slot + 1) && b.enabled);
    if (!btn) fail(`no move button ${slot + 1} in the FIGHT menu`);
    note(`first battle turn by hand: FIGHT -> move ${slot + 1}`);
    await clickRect(btn.rect, 2);
    // photograph the move landing, and the line that judges the hit (super effective...) if any
    let used = false, judged = false;
    for (let i = 0; i < 400; i += 2) {
      const x = await snap();
      if (x.scene !== 'battle' || !x.battle) break;
      if (!used && / USED /.test(x.battle.text) && x.battle.textDone) {
        used = true;
        await step(16);
        await shot(`${tag}-battle-attack`);
      }
      if (!judged && /EFFECTIVE|NO EFFECT/.test(x.battle.text) && x.battle.textDone) {
        judged = true;
        await shot(`${tag}-battle-hit`);
      }
      if (x.battle.menu === 'main' && !x.battle.busy) {
        await shot(`${tag}-battle-turn-2`);
        break;
      }
      await step(2);
    }
  }
  await setAutoplay(true);
  let swapShot = false;
  for (let waited = 0; ; waited += 2) {
    const x = await snap();
    if (x.scene !== 'battle') return;
    if (waited > 30000) fail(`${tag}: the battle never ended`);
    if (!superShot && x.battle && /SUPER EFFECTIVE/.test(x.battle.text) && x.battle.textDone) {
      superShot = true;
      await calmShot(`${tag}-battle-super-effective`);
    }
    if (!swapShot && x.battle && /SWAPPED IN/.test(x.battle.text) && x.battle.textDone) {
      swapShot = true;
      note(`${tag}: the boss counter-swapped ("${x.battle.text}")`);
      await calmShot(`${tag}-boss-counter-swap`);
    }
    await step(2);
  }
}

interface MissionOpts {
  tag: string;
  /** Play the first battle's first turn by hand. */
  manual: boolean;
  /** Branch option to take on a SABOTAGE (0 = rush the boss, 1 = cut the power). */
  branch?: number;
  /** Photograph the trail, the first battle's dialog and every rest stop. */
  full: boolean;
}

/** Walk the trail from launch to the results screen. Returns how it ended. */
async function playMission(o: MissionOpts): Promise<'results' | 'burrow'> {
  const t = o.tag;
  let trailShot = false, battleIntroShot = false, bossIntroShot = false, restShot = false, firstBattle = true;
  await until('the mission trail', (s) => s.scene === 'missionRun' && !s.busy, 600);
  for (let guard = 0; ; guard++) {
    if (guard > 4000) fail(`${t}: the mission never ended`);
    const s = await snap();
    if (s.busy) { await step(4); continue; }
    switch (s.scene) {
      case 'missionRun': {
        const ph = s.run?.phase;
        if (ph === 'idle') {
          if (!trailShot) { trailShot = true; await step(20); await shot(`${t}-trail`); }
          // after a rushed sabotage the next-stop panel warns that the boss is powered up
          if (o.branch !== undefined && s.run?.node === 'boss') { await step(10); await shot(`${t}-boss-next`); }
          await press(GO_LABELS, 4);
        } else if (ph === 'rest') {
          await step(50);
          if (!restShot || o.full) await shot(`${t}-rest-stop`);
          restShot = true;
          await press('BACK ON THE TRAIL', 4);
        } else if (ph === 'branch') {
          await step(30);
          await shot(`${t}-branch-choice`);
          const k = o.branch ?? 0;
          note(`${t}: branch option ${k + 1}`);
          await key(String(k + 1), 4);
          await until('the trail after the branch', (x) => x.scene !== 'missionRun' || x.run?.phase === 'idle', 400);
          await step(30);
          await shot(`${t}-branch-taken`);
        } else {
          await step(4);   // walking, or away at a dialog / battle that is still opening
        }
        break;
      }
      case 'dialog': {
        const kind = s.run?.node;
        let name: string | undefined;
        if (kind === 'boss' && !bossIntroShot) { bossIntroShot = true; name = `${t}-boss-intro`; }
        else if (kind === 'battle' && !battleIntroShot && o.full) { battleIntroShot = true; name = `${t}-battle-intro`; }
        else if (kind === 'story') name = `${t}-story`;
        await readDialogs(name);
        break;
      }
      case 'battle':
        await playBattle(t, { manual: o.manual && firstBattle, shoot: false, bossShot: true });
        firstBattle = false;
        break;
      case 'results':
        return 'results';
      case 'burrow':
        return 'burrow';
      case 'evolution':
        await playEvolution(t);
        break;
      default:
        fail(`${t}: unexpected screen '${s.scene}' on the trail`);
    }
  }
}

/** The results screen through to the Burrow: report, evolutions, a new dragon's reveal. */
async function playResults(tag: string): Promise<boolean> {
  let s = await arrive('results');
  await step(50);
  await shot(`${tag}-results`);
  await until('the results to settle', (x) => !!x.results && !x.results.animating, 900);
  await step(10);
  await shot(`${tag}-results-report`);
  let revealShot = false;
  for (let guard = 0; guard < 60; guard++) {
    s = await snap();
    if (s.scene === 'burrow') return true;
    if (s.scene === 'evolution') { await playEvolution(tag); continue; }
    if (s.scene === 'results' && s.results) {
      if (s.results.stage === 'reveal' && !revealShot) {
        await until('the reveal card', (x) => !x.results || !x.results.animating, 300);
        await step(30);
        await shot(`${tag}-new-dragon`);
        revealShot = true;
      }
      if (s.results.stage === 'leaving') { await step(10); continue; }
      await press('CONTINUE', 10);
      continue;
    }
    await step(10);
  }
  fail(`${tag}: the results screen never led home`);
}

/** On the board: click the gang's folder tab, then its first case card; arrive at the briefing. */
async function openCase(org: number, id: MissionId, shootBoard: boolean): Promise<void> {
  let s = await arrive('board');
  if (org > 1) {
    const tab = s.buttons.find((b) => b.hotkey === String(org));
    if (!tab) fail(`no folder tab ${org} on the board`);
    await clickRect(tab.rect, 30);
    s = await snap();
  }
  if (shootBoard) await shot(`board-${id.split('-')[0]}`);
  const card = s.buttons.find((b) => b.label === '' && !b.hotkey);   // case cards: no label, no hotkey
  if (!card) fail('no case cards on the board');
  await clickRect(card.rect, 6);
  await arrive('briefing');
}

/** Board -> (gang tab) -> the first open case -> briefing -> AUTO-PICK -> LAUNCH. */
async function launchFromBoard(id: MissionId, org: number, shoot: boolean): Promise<void> {
  await until('the Burrow hub', (s) => s.scene === 'burrow' && s.burrow === 'hub' && !s.busy);
  await key('m', 6);
  await arrive('board');
  await openCase(org, id, shoot);
  await step(60);
  if (shoot) await shot(`briefing-${id}`);
  await press('AUTO-PICK', 6);
  await step(20);
  if (shoot) await shot(`briefing-${id}-squad`);
  await press('LAUNCH', 6);
}

async function sleep(shoot: boolean): Promise<void> {
  await until('the Burrow hub', (s) => s.scene === 'burrow' && s.burrow === 'hub' && !s.busy);
  await key('z', 6);
  await arrive('confirm', 60);
  if (shoot) { await step(12); await shot('burrow-sleep-confirm'); }
  await press('YES', 6);
  await until('the night', (s) => s.burrow === 'night', 60);
  await step(70);
  if (shoot) await shot('burrow-night');
  await key('Enter', 4);
  await until('the day report', (s) => s.scene === 'dialog', 900);
  await readDialogs(shoot ? 'burrow-morning-report' : undefined);
}

// ---------------------------------------------------------------------------------------------
// The playthrough
// ---------------------------------------------------------------------------------------------

async function playthrough(port: number): Promise<void> {
  // One seed for every random draw the page makes (the new world's seed comes from
  // crypto.getRandomValues, battles and wandering from Math.random), so a run is repeatable and its
  // screenshots can be compared run to run. PLAYTEST_SEED=n picks another world.
  await page.addInitScript((seed: number) => {
    let a = seed >>> 0;
    const rnd = (): number => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    Math.random = rnd;
    const real = crypto.getRandomValues.bind(crypto);
    (crypto as any).getRandomValues = (arr: any) => {
      if (arr instanceof Uint32Array) { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(rnd() * 4294967296); return arr; }
      return real(arr);
    };
  }, SEED);
  await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__game?.ready === true, null, { timeout: 20000 });
  await page.evaluate(() => (window as any).__game.api.run(false));
  await step(90);

  // --- title and intro ---------------------------------------------------------------------------
  await arrive('title');
  await shot('title');
  await press('NEW GAME', 4);
  let s = await arrive('intro');
  await step(40);
  const introShots: Record<number, string> = { 0: 'intro-chief', 2: 'intro-teacup', 3: 'intro-wanted', 4: 'intro-duties' };
  for (let guard = 0; s.intro?.phase === 'talk'; guard++) {
    if (guard > 40) fail('the intro talk never ended');
    const line = s.intro.line;
    await key('Enter', 30);   // finish the line (and let its picture pop in)
    if (introShots[line]) { await shot(introShots[line]); delete introShots[line]; }
    await key('Enter', 6);    // next line
    s = await snap();
  }
  s = await until('the starter pick', (x) => x.intro?.phase === 'pick', 120);
  await step(40);
  await shot('starter-pick');
  const starterBtn = (k: string): LiveButton => s.buttons.find((b) => b.hotkey === k)!;
  s = await snap();
  await clickRect(starterBtn('1').rect, 30);   // the FIRE starter
  await shot('starter-picked-one');
  s = await snap();
  await clickRect(starterBtn('3').rect, 30);   // the WATER starter
  await shot('starter-picked-two');
  await press('THESE TWO', 4);
  await arrive('confirm', 30);
  await step(12);
  await shot('starter-confirm');
  await press('YES', 4);
  s = await until('the Chief reacts', (x) => x.intro?.phase === 'react', 120);
  await key('Enter', 30);
  await shot('intro-chief-reacts');
  for (let guard = 0; (await snap()).scene === 'intro'; guard++) {
    if (guard > 40) fail('the Chief never stopped talking');
    await key('Enter', 6);
  }

  // --- the Burrow ------------------------------------------------------------------------------
  await until('the Burrow tutorial', (x) => x.scene === 'dialog', 600);
  await readDialogs('burrow-tutorial');
  await arrive('burrow');
  await step(120);
  await shot('burrow');
  const before = await page.evaluate(() => (window as any).__game.api.state().stats.activities);
  await activity('feed', true);
  // the nap comes last: the Cozy Nest only offers a nap to a dragon with something to mend (a
  // fresh starter at full HP and energy is listed as NOTHING TO FIX)
  for (const a of ['wheel', 'dig', 'play', 'nap'] as ActivityId[]) await activity(a, false);
  const after = await page.evaluate(() => (window as any).__game.api.state().stats.activities);
  note(`activities done: ${after - before} (feed, wheel, dig, play, nap)`);

  // shop: buy a Seed Cake (the sixth shelf row)
  await key('s', 6);
  await arrive('shop');
  await step(60);
  await shot('shop');
  for (let i = 0; i < 5; i++) await key('ArrowDown', 3);
  const cakesBefore: number = await page.evaluate(() => (window as any).__game.api.state().items.seedcake);
  await press('BUY X1', 30);
  const cakesAfter: number = await page.evaluate(() => (window as any).__game.api.state().items.seedcake);
  if (cakesAfter !== cakesBefore + 1) fail(`buying a seed cake: ${cakesBefore} -> ${cakesAfter}`);
  await shot('shop-bought');
  await key('Escape', 6);

  // bag: use a Seed Cake. Nobody is hurt on day one, so the API scuffs the FIRE starter first.
  await page.evaluate(() => { const d = (window as any).__game.api.state().dragons[0]; d.hp = Math.max(1, Math.floor(d.hp * 0.45)); });
  note('API: the first starter is set to 45% HP so the Seed Cake has a job');
  await arrive('burrow');
  await key('b', 6);
  await arrive('bag');
  for (let i = 0; i < 5; i++) await key('ArrowDown', 3);
  await step(20);
  await shot('bag-seed-cake');
  await press('USE', 10);
  await shot('bag-pick-dragon');
  await key('Enter', 40);
  const cakesLeft: number = await page.evaluate(() => (window as any).__game.api.state().items.seedcake);
  if (cakesLeft !== cakesAfter - 1) fail(`using a seed cake: ${cakesAfter} -> ${cakesLeft}`);
  await shot('bag-used');
  await key('Escape', 4);
  await key('Escape', 6);

  // roster: every tab, and swap two moves
  await arrive('burrow');
  await open('d', 'roster', 'roster-tutorial');
  await step(30);
  await shot('roster-stats');
  await key('2', 20);
  await shot('roster-moves');
  s = await snap();
  const tabEnd = s.buttons.findIndex((b) => b.label === 'NEEDS');
  const slots = s.buttons.slice(tabEnd + 1, tabEnd + 5);
  const second = slots[1]?.label;
  const known = s.buttons.slice(tabEnd + 5).find((b) => b.label === second);
  if (!slots[0] || !known) fail('the MOVES tab offers no slots / known moves to swap');
  await clickRect(slots[0].rect, 6);
  await clickRect(known.rect, 20);
  const swapped: string[] = await page.evaluate(() => (window as any).__game.api.state().dragons[0].moves);
  note(`roster: swapped slots 1 and 2 -> ${swapped.join(', ')}`);
  await shot('roster-moves-swapped');
  await key('3', 20);
  await shot('roster-lore');
  await key('4', 20);
  await shot('roster-needs');
  await key('Escape', 6);

  // Dragondex and type chart
  await arrive('burrow');
  await open('x', 'dex', 'dex-tutorial');
  await step(30);
  await shot('dex');
  await key('Escape', 6);
  await arrive('burrow');
  await open('t', 'typechart', 'typechart-tutorial');
  await step(30);
  await shot('typechart');
  await key('Escape', 6);

  // --- case 1 ----------------------------------------------------------------------------------
  await arrive('burrow');
  await open('m', 'board', 'board-tutorial');
  await step(30);
  await shot('board');
  await openCase(1, 'cheese-1', false);
  await step(60);
  await shot('briefing-cheese-1');
  await press('AUTO-PICK', 6);
  await step(20);
  await shot('briefing-cheese-1-squad');
  await press('LAUNCH', 6);
  let won = false;
  for (let attempt = 1; attempt <= 3 && !won; attempt++) {
    const end = await playMission({ tag: attempt === 1 ? 'cheese-1' : `cheese-1-try${attempt}`, manual: attempt === 1, full: attempt === 1 });
    if (end === 'results') await playResults(attempt === 1 ? 'cheese-1' : `cheese-1-try${attempt}`);
    won = await cleared('cheese-1');
    note(`case 1 (cheese-1), attempt ${attempt}: ${won ? 'WON' : 'lost'}`);
    if (!won) { await sleep(false); await launchFromBoard('cheese-1', 1, false); }
  }
  if (!won) fail('case 1 was lost three times in a row: the first mission must be winnable');
  await arrive('burrow');
  await step(60);
  await shot('burrow-after-case-1');
  await sleep(true);

  // --- fast-forward: one case from every other gang ----------------------------------------------
  // `nearEvolve`: that species stops 5 XP short of its evolution level, so the case's first win
  // evolves it on the results screen
  const RUNS: { id: MissionId; org: number; level: number; adopt: [SpeciesId, number][]; branch?: number; nearEvolve?: SpeciesId }[] = [
    { id: 'crows-1', org: 2, level: 22, adopt: [['granitooth', 21], ['statickle', 21]], nearEvolve: 'statickle' },
    { id: 'snakes-1', org: 3, level: 30, adopt: [['flitterbit', 29], ['blobbit', 29]], branch: 0 },
    { id: 'cats-1', org: 4, level: 37, adopt: [['sproutling', 36]] },
    { id: 'ferrets-1', org: 5, level: 44, adopt: [['scrappling', 43]] },
  ];
  for (const r of RUNS) {
    const prior = MISSIONS.slice(0, MISSIONS.findIndex((m) => m.id === r.id)).map((m) => m.id);
    const party = await page.evaluate(async ([ids, level, adopt, near]: [string[], number, [string, number][], string]) => {
      const api = (window as any).__game.api;
      const url = '/src/data/index.ts';
      const data = await import(url);
      const st = api.state();
      for (const id of ids) if (!(st.missions[id]?.clears > 0)) st.missions[id] = { clears: 1, firstClearDay: st.day };
      for (const [sp, lv] of adopt) api.adopt(sp, lv);
      const out: string[] = [];
      for (const d of st.dragons) {
        const evo = data.getSpecies(d.speciesId).evolvesTo;
        const t = d.speciesId === near && evo ? api.train(d.id, evo.level, false, 5) : api.train(d.id, level);
        d.needs.fullness = 100;
        d.needs.happiness = Math.max(d.needs.happiness, 80);
        out.push(`${t.speciesId} L${t.level}`);
      }
      return out;
    }, [prior, r.level, r.adopt, r.nearEvolve ?? ''] as [string[], number, [string, number][], string]);
    note(`API fast-forward to ${r.id}: ${prior.length} earlier cases marked cleared; burrow: ${party.join(', ')}`);
    // a loss is a real outcome (its MISSION FAILED screen gets photographed): sleep it off and
    // try once more, as a player would
    for (let attempt = 1; attempt <= 2; attempt++) {
      const tag = attempt === 1 ? r.id : `${r.id}-try${attempt}`;
      await sleep(false);   // a real night: everyone healed and rested
      await launchFromBoard(r.id, r.org, attempt === 1);
      await setAutoplay(true);
      const end = await playMission({ tag, manual: false, branch: r.branch, full: false });
      if (end === 'results') await playResults(tag);
      const ok = await cleared(r.id);
      note(`${r.id}, attempt ${attempt}: ${ok ? 'WON' : 'lost'} on autoplay`);
      if (ok) break;
    }
  }
  await arrive('burrow');
  await step(60);
  await shot('burrow-end');
}

async function cleared(id: MissionId): Promise<boolean> {
  return page.evaluate((m: string) => ((window as any).__game.api.state().missions[m]?.clears ?? 0) > 0, id);
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));

const server = createServer();
await new Promise<void>((r) => server.listen(0, () => r()));
const port = (server.address() as { port: number }).port;
const { chromium } = loadPlaywright();
const browser = await launch(chromium);
page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 });
page.on('pageerror', (e: Error) => browserErrors.push('pageerror: ' + e.message));
page.on('console', (m: any) => { if (m.type() === 'error') browserErrors.push('console: ' + m.text()); });
page.on('requestfailed', (r: any) => browserErrors.push('request failed: ' + r.url()));
page.on('response', (r: any) => {
  if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) browserErrors.push(`HTTP ${r.status()}: ${r.url()}`);
});

let failure: string | null = null;
console.log(`PLAYTEST: Dragon Hamsters, end to end (seed ${SEED})`);
try {
  await playthrough(port);
} catch (e) {
  failure = e instanceof PlaytestFailure ? e.message : (e instanceof Error ? e.stack ?? e.message : String(e));
} finally {
  await browser.close();
  server.close();
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\nscenes: ${scenesSeen.join(' > ')}`);
console.log(`\n${shots.length} screenshots in screenshots/playtest/:`);
for (const f of shots) console.log('  ' + f);
console.log(`\n${frames} game frames (${(frames / 60 / 60).toFixed(1)} min of game time) in ${secs} s`);
if (failure) {
  console.log(`\nPLAYTEST FAILED: ${failure}`);
  process.exit(1);
}
console.log('\nPLAYTEST OK: title to case 1 by hand, then one case of every gang on autoplay, with no errors.');
process.exit(0);
