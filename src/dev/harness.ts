// Dev harness: boot any scene on its own, on a throwaway test save, for screenshots and checks.
//
// A screen agent makes a page dev/<name>.html (same shape as index.html, but loading
// /src/dev/<name>Harness.ts) whose module calls bootHarness(() => createMyScene(), { ... }).
// Navigation the scene performs is stubbed: by default every app.nav call logs to the console
// (and to window.__game.navLog) and pushes a placeholder scene describing the call, so flows can
// be followed without the other screens existing. Override any entry with `nav`.
//
// window.__game.api gives a headless test the same handles src/main.ts will: step(n), click(x, y),
// key(k), state(), scene(), navLog().
import { createCanvas } from '../lib/engine/canvas.ts';
import { createLoop } from '../lib/engine/loop.ts';
import { drawText, setTextDefaults } from '../lib/engine/text.ts';
import { createInput } from '../ui/input.ts';
import { createSceneManager, type Scene } from '../ui/scene.ts';
import { app, type Nav } from '../ui/app.ts';
import { drawPanel, VIEW_W, VIEW_H } from '../ui/widgets.ts';
import { newGame } from '../game/state.ts';
import { addDragon, createDragon } from '../game/dragons.ts';
import { SPECIES_BY_DEX } from '../data/index.ts';
import { STARTERS } from '../data/species.ts';
import type { GameState } from '../game/types.ts';

export interface HarnessOptions {
  seed?: number;
  /**
   * Shape the test save. Default: the three starters at levels 8/9/10 and six more species at
   * varied levels, 500 coins, a stocked pantry, and every tutorial flag set.
   */
  setup?: (state: GameState) => void;
  /** Replace any nav entry (the rest log + push a placeholder). */
  nav?: Partial<Nav>;
}

/** The default test save: a small but varied burrow. */
export function defaultTestState(seed = 7): GameState {
  const s = newGame(seed);
  const levels = [8, 9, 10];
  STARTERS.forEach((id, i) => addDragon(s, createDragon(s, id, levels[i] ?? 8)));
  const others = SPECIES_BY_DEX.filter((sp) => !STARTERS.includes(sp.id) && !sp.evolvesFrom).slice(0, 6);
  others.forEach((sp, i) => addDragon(s, createDragon(s, sp.id, 6 + i * 3)));
  s.squad = s.dragons.slice(0, 3).map((d) => d.id);
  s.coins = 500;
  for (const k of Object.keys(s.food) as (keyof typeof s.food)[]) s.food[k] = 5;
  for (const k of Object.keys(s.items) as (keyof typeof s.items)[]) s.items[k] = 3;
  for (const f of ['introDone', 'burrowTutorial', 'boardTutorial', 'battleTutorial']) s.flags[f] = true;
  return s;
}

/** A stand-in for a screen that isn't part of this harness: shows the nav call; Escape/Enter pops. */
function placeholder(label: string, onClose?: () => void, keys?: Record<string, () => void>): Scene {
  return {
    name: 'placeholder',
    overlay: true,
    update(_dt, input) {
      if (keys) for (const [k, fn] of Object.entries(keys)) if (input.pressed(k)) { app.scenes.pop(); fn(); return; }
      if (input.back() || input.confirm() || input.pointer.pressed) { app.scenes.pop(); onClose?.(); }
    },
    draw(ctx) {
      ctx.fillStyle = 'rgba(27,20,38,0.6)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      drawPanel(ctx, 120, 130, 400, 100, { title: 'HARNESS' });
      drawText(ctx, label, 320, 160, { align: 'center', color: '#2a2030', shadow: false });
      const hint = keys ? Object.keys(keys).map((k) => k.toUpperCase()).join(' / ') + ' OR ENTER' : 'ENTER / ESC TO CLOSE';
      drawText(ctx, hint, 320, 200, { align: 'center', color: '#6a5a70', shadow: false });
    },
  };
}

export function bootHarness(first: () => Scene, opts: HarnessOptions = {}): void {
  const canvas = createCanvas('stage');
  setTextDefaults({ shadowColor: '#1b1426', outline: '#1b1426' });
  const input = createInput(canvas.canvas, canvas.toInternal);
  const scenes = createSceneManager();
  const navLog: string[] = [];

  app.state = defaultTestState(opts.seed ?? 7);
  opts.setup?.(app.state);
  app.scenes = scenes;
  app.input = input;
  app.save = () => {};
  app.debug = {};

  const log = (name: string, args: unknown[]): string => {
    const line = `${name}(${args.map((a) => (typeof a === 'function' ? 'fn' : JSON.stringify(a)?.slice(0, 40))).join(', ')})`;
    navLog.push(line);
    console.log('[nav] ' + line);
    return line;
  };
  const stub: Nav = {
    title: () => { scenes.push(placeholder(log('title', []))); },
    intro: () => { scenes.push(placeholder(log('intro', []))); },
    burrow: () => { scenes.push(placeholder(log('burrow', []))); },
    roster: (id) => { scenes.push(placeholder(log('roster', [id]))); },
    dex: () => { scenes.push(placeholder(log('dex', []))); },
    typeChart: (f) => { scenes.push(placeholder(log('typeChart', [f]))); },
    shop: () => { scenes.push(placeholder(log('shop', []))); },
    bag: () => { scenes.push(placeholder(log('bag', []))); },
    board: () => { scenes.push(placeholder(log('board', []))); },
    briefing: (id) => { scenes.push(placeholder(log('briefing', [id]))); },
    run: (run) => { scenes.push(placeholder(log('run', [run.missionId]))); },
    battle: (run, onEnd) => {
      scenes.push(placeholder(log('battle', [run.missionId]), () => onEnd('won'), {
        w: () => onEnd('won'), l: () => onEnd('lost'), r: () => onEnd('retreated'),
      }));
    },
    results: (run, rewards) => { scenes.push(placeholder(log('results', [run.missionId, rewards ? 'won' : 'lost']))); },
    evolve: (id, onDone) => { scenes.push(placeholder(log('evolve', [id]), onDone)); },
    dialog: (lines, onDone) => { scenes.push(placeholder(log('dialog', [lines.join(' / ')]), onDone)); },
    confirm: (text, onYes, onNo) => {
      scenes.push(placeholder(log('confirm', [text]), onYes, { y: onYes, n: () => onNo?.() }));
    },
  };
  app.nav = { ...stub, ...opts.nav };

  const loop = createLoop({
    update() {
      input.beginUpdate();
      app.time += 1 / 60;
      scenes.update(1 / 60, input);
      input.endUpdate();
    },
    render() { scenes.draw(canvas.ctx); },
  });

  scenes.reset(first());
  loop.start();

  const hooks = window.__game ?? (window.__game = { ready: false, errors: [] });
  hooks.api = {
    state: () => app.state,
    scene: () => scenes.top()?.name ?? null,
    depth: () => scenes.depth,
    step: (n: number = 1) => loop.step(n),
    click: (x: number, y: number) => input.injectClick(x, y),
    key: (k: string) => input.injectKey(k),
    navLog: () => navLog.slice(),
    debug: () => app.debug,
  };
  hooks.ready = true;
}
