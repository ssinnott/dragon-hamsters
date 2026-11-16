// Boot: the canvas, input, the scene stack, the live save, navigation between every screen, the
// fixed-step loop and the debug/test API on window.__game.
//
// Scenes never import each other; they navigate through app.nav, which is wired here to each
// scene factory. A frame that throws is recorded once per distinct message (window.__game.errors
// and the console) and the loop keeps running, so one bad screen cannot freeze the whole game.
import { createCanvas } from './lib/engine/canvas.ts';
import { createLoop } from './lib/engine/loop.ts';
import { setTextDefaults } from './lib/engine/text.ts';
import { createInput } from './ui/input.ts';
import { createSceneManager, type Scene } from './ui/scene.ts';
import { app, type Nav } from './ui/app.ts';
import { UI } from './ui/widgets.ts';
import { loadGame, newGame, saveGame } from './game/state.ts';
import { freshSeed } from './game/rng.ts';
import { ALL_TUTORIAL_FLAGS, type GameState } from './game/types.ts';
import { addDragon, createDragon, markSeen } from './game/dragons.ts';
import { STARTERS } from './data/index.ts';
import type { SpeciesId } from './data/schema.ts';
import { isAudioUnlocked, setMusic, setSound, unlockAudio } from './audio/index.ts';
import { createTitleScene } from './ui/scenes/title.ts';
import { createIntroScene } from './ui/scenes/intro.ts';
import { createConfirmScene, createDialogScene } from './ui/scenes/dialog.ts';
import { createBurrowScene } from './ui/scenes/burrow.ts';
import { createShopScene } from './ui/scenes/shop.ts';
import { createBagScene } from './ui/scenes/bag.ts';
import { createRosterScene } from './ui/scenes/roster.ts';
import { createDexScene } from './ui/scenes/dex.ts';
import { createTypeChartScene } from './ui/scenes/typechart.ts';
import { createEvolutionScene } from './ui/scenes/evolution.ts';
import { createBoardScene } from './ui/scenes/board.ts';
import { createBriefingScene } from './ui/scenes/briefing.ts';
import { createMissionRunScene } from './ui/scenes/missionRun.ts';
import { createResultsScene } from './ui/scenes/results.ts';
import { createBattleScene } from './ui/scenes/battle.ts';

const DT = 1 / 60;
const STARTER_LEVEL = 5;
/** Every one-shot tutorial the screens show; the test API can mark them all seen. */

// ---------------------------------------------------------------------------------------------
// Debug hooks (index.html installs window.__game before the module graph loads)
// ---------------------------------------------------------------------------------------------

const hooks = window.__game ?? (window.__game = { ready: false, errors: [] });
const reported = new Set<string>();

/** Record a caught frame error once per distinct message, and keep going. */
function report(where: string, e: unknown): void {
  const msg = `${where}: ${e instanceof Error ? e.message : String(e)}`;
  if (reported.has(msg)) return;
  reported.add(msg);
  hooks.errors.push(msg);
  console.error('[dragon-hamsters] ' + msg, e);
  const box = document.getElementById('errors');
  if (box) { box.style.display = 'block'; box.textContent = hooks.errors.slice(-8).join('\n'); }
}


// ---------------------------------------------------------------------------------------------
// Canvas, input, scenes, state
// ---------------------------------------------------------------------------------------------

const canvas = createCanvas('stage');
const ctx = canvas.ctx;
setTextDefaults({ shadowColor: UI.ink, outline: UI.ink });
const input = createInput(canvas.canvas, canvas.toInternal);
const scenes = createSceneManager();

app.state = loadGame() ?? newGame(freshSeed());
app.scenes = scenes;
app.input = input;
app.time = 0;
app.debug = app.debug ?? {};
app.save = () => { saveGame(app.state); };

/** Push the sound switches from the save into the audio module. */
function applySettings(): void {
  setSound(app.state.settings.sound);
  setMusic(app.state.settings.music);
}
applySettings();

/** Only a world with dragons in it is worth writing over whatever is on disk. */
function saveIfStarted(): void {
  if (app.state && app.state.dragons.length > 0) app.save();
}

/**
 * Reset the stack to [base, top] in one fade: `top` is pushed the moment `base` has entered, inside
 * the same fade, so the player never sees `base` on its own.
 */
function resetTo(base: Scene, top: Scene): void {
  const baseEnter = base.enter;
  base.enter = function enterThenPush(): void {
    base.enter = baseEnter;
    baseEnter?.call(base);
    scenes.push(top);
  };
  scenes.reset(base);
}

const nav: Nav = {
  title: () => { saveIfStarted(); scenes.reset(createTitleScene()); },
  intro: () => scenes.reset(createIntroScene()),
  burrow: () => { app.save(); scenes.reset(createBurrowScene()); },
  roster: (dragonId) => scenes.push(createRosterScene(dragonId)),
  dex: () => scenes.push(createDexScene()),
  typeChart: (focus) => scenes.push(createTypeChartScene(focus)),
  shop: () => scenes.push(createShopScene()),
  bag: () => scenes.push(createBagScene()),
  board: () => scenes.push(createBoardScene()),
  briefing: (missionId) => scenes.push(createBriefingScene(missionId)),
  run: (run) => { app.save(); resetTo(createBurrowScene(), createMissionRunScene(run)); },
  battle: (run, onEnd) => scenes.push(createBattleScene(run, onEnd)),
  results: (run, rewards) => { app.save(); scenes.replace(createResultsScene(run, rewards)); },
  evolve: (dragonId, onDone) => scenes.push(createEvolutionScene(dragonId, onDone)),
  dialog: (lines, onDone, speaker) => scenes.push(createDialogScene(lines, onDone, speaker)),
  confirm: (text, onYes, onNo) => scenes.push(createConfirmScene(text, onYes, onNo)),
};
Object.assign(app.nav, nav);

// ---------------------------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------------------------

/** Put the context back to a clean state after a draw threw half-way through a save()/restore(). */
function resetContext(): void {
  const c = ctx as CanvasRenderingContext2D & { reset?: () => void };
  try { if (typeof c.reset === 'function') c.reset(); } catch { /* older browsers */ }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.setLineDash([]);
  ctx.imageSmoothingEnabled = false;
}

const loop = createLoop({
  update() {
    input.beginUpdate();
    try {
      app.time += DT;
      scenes.update(DT, input);
    } catch (e) {
      report('update', e);
    } finally {
      input.endUpdate();
    }
  },
  render() {
    try {
      scenes.draw(ctx);
    } catch (e) {
      report('draw', e);
      resetContext();
    }
  },
});

// ---------------------------------------------------------------------------------------------
// Audio unlock and saving when the page goes away
// ---------------------------------------------------------------------------------------------

function onGesture(): void {
  unlockAudio();
  if (isAudioUnlocked()) {
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
  }
}
window.addEventListener('pointerdown', onGesture, true);
window.addEventListener('keydown', onGesture, true);

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveIfStarted(); });
window.addEventListener('pagehide', saveIfStarted);

// ---------------------------------------------------------------------------------------------
// Debug / test API (tools/smoke.ts, tools/playtest.ts)
// ---------------------------------------------------------------------------------------------

interface NewGameOpts { skipTutorials?: boolean }

/**
 * A fresh world with two starters at level 5 (default: the FIRE and WATER starters) in the squad,
 * the intro marked done (and every tutorial too with { skipTutorials: true }), then the Burrow.
 * The options may also be passed as the second argument.
 */
function apiNewGame(seed?: number, starters?: [SpeciesId, SpeciesId] | NewGameOpts | null, opts?: NewGameOpts): GameState {
  const pair = Array.isArray(starters) ? starters : null;
  const o: NewGameOpts = (!Array.isArray(starters) && starters && typeof starters === 'object' ? starters : opts) ?? {};
  const s = newGame(typeof seed === 'number' && Number.isFinite(seed) ? seed : freshSeed());
  if (app.state?.settings) s.settings = { ...app.state.settings };
  const ids = pair ?? [STARTERS[0], STARTERS[STARTERS.length - 1]];
  for (const id of ids) addDragon(s, createDragon(s, id, STARTER_LEVEL));
  for (const id of STARTERS) if (!ids.includes(id)) markSeen(s, id);
  s.squad = s.dragons.map((d) => d.id);
  s.flags.introDone = true;
  if (o.skipTutorials) for (const f of ALL_TUTORIAL_FLAGS) s.flags[f] = true;
  app.state = s;
  applySettings();
  app.nav.burrow();
  return s;
}

hooks.api = {
  state: () => app.state,
  scene: () => scenes.top()?.name ?? null,
  depth: () => scenes.depth,
  step: (n: number = 1) => loop.step(n),
  click: (x: number, y: number) => input.injectClick(x, y),
  key: (k: string) => input.injectKey(k),
  newGame: apiNewGame,
  goto: (name: keyof Nav, ...args: unknown[]) => {
    const fn = app.nav[name] as ((...a: unknown[]) => void) | undefined;
    if (typeof fn !== 'function') throw new Error(`no nav entry '${String(name)}'`);
    fn(...args);
  },
  debug: () => app.debug,
  errors: () => hooks.errors.slice(),
};

// ---------------------------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------------------------

scenes.reset(createTitleScene());
loop.start();
hooks.ready = true;
