// Dev gallery for the scenery and the battle effects (dev/scenes.html). Cycles through every battle
// backdrop with its platforms, the Burrow with its stations, the title screen, the mission-map
// blueprints and an effects demo that fires every FxKind in turn.
//
// Keys: click / Space / Right = next, Left = previous, U = mock battle panel and HUD overlay,
// H = station hit boxes, C = sample location palettes (to check the art with non-stub colours),
// P = pause. URL: ?scene=N&t=SECONDS&ui=1&pal=1&freeze=1. window.__gallery drives it headlessly.
import { LOCATIONS, SPECIES, VILLAINS } from '../data/index.ts';
import { ACTIVITY_IDS, LOCATION_IDS, type ActivityId, type FxKind, type LocationDef, type LocationId, type TypeId } from '../data/schema.ts';
import {
  STATIONS, drawBattleBackdrop, drawBurrow, drawMapBackdrop, drawPlatform, drawStation, drawTitleBackdrop,
} from '../art/backdrops.ts';
import { createFx, type Fx } from '../art/fx.ts';
import { drawText } from '../lib/engine/text.ts';

type Ctx = CanvasRenderingContext2D;

const W = 640;
const H = 360;
const PLAYER = { x: 160, y: 240, w: 190 };
const ENEMY = { x: 470, y: 152, w: 150 };
/** Rough body centres used as fx anchor points. */
const PLAYER_BODY = { x: 160, y: 200 };
const ENEMY_BODY = { x: 470, y: 116 };

/** Every FxKind with a fitting type to colour it. */
const FX_DEMO: [FxKind, TypeId][] = [
  ['tackle', 'FLUFF'], ['slash', 'DARKNESS'], ['bite', 'DARKNESS'], ['punch', 'BRAWL'], ['flame', 'FIRE'],
  ['splash', 'WATER'], ['leaf', 'LEAF'], ['spark', 'LIGHTNING'], ['quake', 'EARTH'], ['rock', 'ROCK'],
  ['wind', 'WINGED'], ['ice', 'FROST'], ['goo', 'SLIME'], ['shadow', 'DARKNESS'], ['sparkle', 'LIGHT'],
  ['food', 'COOKING'], ['metal', 'METAL'], ['psy', 'MIND'], ['buff', 'FIRE'], ['debuff', 'MIND'],
  ['heal', 'LEAF'], ['shield', 'LIGHT'], ['beam', 'LIGHT'], ['sound', 'FLUFF'],
];
const SELF_KINDS = new Set<FxKind>(['buff', 'debuff', 'heal', 'shield']);

/** Plausible final palettes, to check the art does not depend on the stub colours. */
const SAMPLE: Record<LocationId, Pick<LocationDef, 'sky' | 'far' | 'mid' | 'floor' | 'accent'>> = {
  museum: { sky: '#c9b79a', far: '#a8916f', mid: '#8a6f55', floor: '#b49a7a', accent: '#b8323a' },
  docks: { sky: '#14183a', far: '#22284d', mid: '#1d3f5e', floor: '#5a4632', accent: '#ffd36b' },
  zoo: { sky: '#8fd3f4', far: '#4f9a5a', mid: '#7cbf5a', floor: '#d9c18e', accent: '#ff6f91' },
  tower: { sky: '#3b2b6b', far: '#5a3f7a', mid: '#e0796b', floor: '#7a7488', accent: '#ffb347' },
  lab: { sky: '#1e2b33', far: '#2f4450', mid: '#3d5866', floor: '#4a5560', accent: '#7dff7a' },
};

const state = { ui: false, boxes: false, sample: false, paused: false };

function loc(id: LocationId): LocationDef {
  const base = LOCATIONS[id];
  return state.sample ? { ...base, ...SAMPLE[id] } : base;
}

// --- creatures from the other art modules, when they exist -------------------------------------

type CreatureDraw = (ctx: Ctx, v: unknown, x: number, y: number, opts?: Record<string, unknown>) => void;
const creatures: { dragon: CreatureDraw | null; villain: CreatureDraw | null } = { dragon: null, villain: null };

async function tryLoad(spec: string, name: string): Promise<CreatureDraw | null> {
  try {
    const mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
    const f = mod[name];
    return typeof f === 'function' ? (f as CreatureDraw) : null;
  } catch {
    return null;
  }
}

function ghost(ctx: Ctx, x: number, y: number, s: number, label: string): void {
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#1b1426';
  ctx.beginPath(); ctx.ellipse(x, y - 22 * s, 20 * s, 18 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x, y - 44 * s, 13 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  drawText(ctx, label, x, y - 66 * s, { size: 1, color: '#ffffff', align: 'center' });
}

/**
 * Call another module's creature renderer without letting a half-written one break the gallery:
 * the context's transform and paint state are put back even if it throws mid-draw.
 */
function safely(ctx: Ctx, draw: () => void): boolean {
  const m = ctx.getTransform();
  const alpha = ctx.globalAlpha, op = ctx.globalCompositeOperation;
  ctx.save();
  try {
    draw();
    ctx.restore();
    return true;
  } catch {
    ctx.restore();
    ctx.setTransform(m);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    return false;
  }
}

function drawCombatants(ctx: Ctx, t: number): void {
  const dv = SPECIES[0]?.visual;
  const vv = Object.values(VILLAINS)[0]?.visual;
  const dragon = creatures.dragon, villain = creatures.villain;
  const okD = !!dragon && !!dv && safely(ctx, () => dragon(ctx, dv, PLAYER.x, PLAYER.y - 4, { scale: 2, facing: 1, t }));
  if (!okD) ghost(ctx, PLAYER.x, PLAYER.y - 4, 1.3, 'PLAYER');
  const okV = !!villain && !!vv && safely(ctx, () => villain(ctx, vv, ENEMY.x, ENEMY.y - 3, { scale: 1.6, facing: -1, t }));
  if (!okV) ghost(ctx, ENEMY.x, ENEMY.y - 3, 1.1, 'ENEMY');
}

// --- overlays ------------------------------------------------------------------------------------

function battleOverlay(ctx: Ctx): void {
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = '#1b1426'; ctx.fillRect(0, 250, W, H - 250);
  ctx.fillStyle = '#2c2440'; ctx.fillRect(8, 8, 232, 48); ctx.fillRect(372, 194, 260, 50);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#e8dcc8'; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 250.5, W - 1, H - 251); ctx.strokeRect(8.5, 8.5, 231, 47); ctx.strokeRect(372.5, 194.5, 259, 49);
  ctx.restore();
  drawText(ctx, 'BATTLE PANEL (Y > 250)', W / 2, 300, { size: 1, color: '#e8dcc8', align: 'center' });
  drawText(ctx, 'ENEMY BOX', 124, 28, { size: 1, color: '#e8dcc8', align: 'center' });
  drawText(ctx, 'PLAYER BOX', 502, 216, { size: 1, color: '#e8dcc8', align: 'center' });
}

function hudOverlay(ctx: Ctx): void {
  ctx.save(); ctx.globalAlpha = 0.6; ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, 28); ctx.fillRect(0, 318, W, 42); ctx.restore();
  drawText(ctx, 'DAY 1   ♥ HUD STRIP   $ 200', 10, 10, { size: 1, color: '#ffe9a0' });
  drawText(ctx, 'MISSIONS  DRAGONS  SHOP  DEX  TYPES  SLEEP', W / 2, 334, { size: 1, color: '#ffe9a0', align: 'center' });
  ctx.save(); ctx.strokeStyle = 'rgba(255,233,160,0.6)'; ctx.setLineDash([4, 4]); ctx.strokeRect(0.5, 230.5, W - 1, 70); ctx.restore();
  drawText(ctx, 'WANDER ZONE', 8, 290, { size: 1, color: '#ffe9a0' });
}

function boxesOverlay(ctx: Ctx): void {
  for (const id of ACTIVITY_IDS) {
    const b = STATIONS[id];
    ctx.save(); ctx.strokeStyle = '#ff4aff'; ctx.lineWidth = 1; ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1); ctx.restore();
    drawText(ctx, id, b.x + 2, b.y + b.h - 9, { size: 1, color: '#ff8aff' });
  }
}

function titleOverlay(ctx: Ctx): void {
  ctx.save(); ctx.strokeStyle = 'rgba(255,233,160,0.7)'; ctx.setLineDash([4, 4]); ctx.strokeRect(150.5, 30.5, 340, 110); ctx.restore();
  drawText(ctx, 'LOGO AREA', W / 2, 80, { size: 2, color: '#ffe9a0', align: 'center' });
  for (const [i, s] of ['NEW GAME', 'CONTINUE'].entries()) {
    ctx.save(); ctx.fillStyle = 'rgba(27,20,38,0.85)'; ctx.fillRect(250, 236 + i * 34, 140, 26); ctx.restore();
    drawText(ctx, s, W / 2, 244 + i * 34, { size: 1, color: '#ffffff', align: 'center' });
  }
}

function trailOverlay(ctx: Ctx): void {
  const nodes = [[60, 200], [150, 160], [240, 210], [330, 170], [420, 220], [510, 170], [590, 200]];
  ctx.save();
  ctx.strokeStyle = '#ffe9a0'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
  ctx.beginPath(); nodes.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  ctx.setLineDash([]);
  for (const [i, [x, y]] of nodes.entries()) {
    ctx.fillStyle = i === 2 ? '#ffd24a' : '#e8dcc8'; ctx.strokeStyle = '#1b1426'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

// --- scenes --------------------------------------------------------------------------------------

interface GScene {
  name: string;
  draw(ctx: Ctx, t: number): void;
  update?(dt: number): void;
  reset?(): void;
}

function battleScene(id: LocationId): GScene {
  return {
    name: `Battle backdrop: ${id}`,
    draw(ctx, t) {
      const l = loc(id);
      drawBattleBackdrop(ctx, l, t);
      drawPlatform(ctx, ENEMY.x, ENEMY.y, ENEMY.w, l);
      drawPlatform(ctx, PLAYER.x, PLAYER.y, PLAYER.w, l);
      drawCombatants(ctx, t);
      if (state.ui) battleOverlay(ctx);
    },
  };
}

function burrowScene(allBusy: boolean): GScene {
  return {
    name: allBusy ? 'Burrow: every station busy' : 'Burrow: stations (one highlighted, wheel busy)',
    draw(ctx, t) {
      drawBurrow(ctx, t);
      const hi: ActivityId = ACTIVITY_IDS[Math.floor(t / 2) % ACTIVITY_IDS.length];
      for (const id of ACTIVITY_IDS) {
        drawStation(ctx, id, t, { highlight: !allBusy && id === hi, busy: allBusy || id === 'wheel' });
      }
      if (state.ui) hudOverlay(ctx);
      if (state.boxes) boxesOverlay(ctx);
    },
  };
}

const titleScene: GScene = {
  name: 'Title backdrop',
  draw(ctx, t) {
    drawTitleBackdrop(ctx, t);
    if (state.ui) titleOverlay(ctx);
  },
};

function mapScene(id: LocationId): GScene {
  return {
    name: `Mission map: ${id}`,
    draw(ctx, t) {
      drawMapBackdrop(ctx, loc(id), t);
      if (state.ui) trailOverlay(ctx);
    },
  };
}

function fxScene(): GScene {
  let fx: Fx = createFx();
  let clock = 0;
  let next = 0.4;
  let index = 0;
  let label = '';
  const pending: { at: number; run: () => void }[] = [];
  let locIndex = 0;
  return {
    name: 'Effects demo: every FxKind in turn',
    reset() { fx = createFx(); clock = 0; next = 0.4; index = 0; label = ''; pending.length = 0; locIndex = 0; },
    update(dt) {
      clock += dt;
      if (clock >= next) {
        const [kind, type] = FX_DEMO[index % FX_DEMO.length];
        const forward = index % 2 === 0;
        const from = forward ? PLAYER_BODY : ENEMY_BODY, to = forward ? ENEMY_BODY : PLAYER_BODY;
        locIndex = Math.floor(index / 5) % LOCATION_IDS.length;
        label = `${index % FX_DEMO.length + 1}/${FX_DEMO.length}  ${kind.toUpperCase()}  (${type})`;
        fx.move(kind, from, to, type);
        if (kind === 'heal') pending.push({ at: clock + 0.45, run: () => fx.floatText(from.x, from.y - 30, '+24', '#7aff9a') });
        else if (!SELF_KINDS.has(kind)) {
          const dmg = String(8 + ((index * 37) % 60));
          pending.push({ at: clock + 0.55, run: () => fx.floatText(to.x, to.y - 20, '-' + dmg, index % 3 ? '#ffffff' : '#ffd24a') });
        }
        index++;
        next = clock + 1.15;
      }
      for (let i = pending.length - 1; i >= 0; i--) if (clock >= pending[i].at) { pending[i].run(); pending.splice(i, 1); }
      fx.update(dt);
    },
    draw(ctx, t) {
      const l = loc(LOCATION_IDS[locIndex]);
      ctx.save();
      ctx.translate(fx.offsetX, fx.offsetY);
      drawBattleBackdrop(ctx, l, t);
      drawPlatform(ctx, ENEMY.x, ENEMY.y, ENEMY.w, l);
      drawPlatform(ctx, PLAYER.x, PLAYER.y, PLAYER.w, l);
      drawCombatants(ctx, t);
      fx.draw(ctx);
      ctx.restore();
      if (state.ui) battleOverlay(ctx);
      drawText(ctx, label, W / 2, 8, { size: 1, color: '#ffffff', align: 'center' });
      drawText(ctx, fx.busy ? 'BUSY' : 'IDLE', W - 8, 8, { size: 1, color: fx.busy ? '#ffd24a' : '#7aff9a', align: 'right' });
    },
  };
}

const SCENES: GScene[] = [
  ...LOCATION_IDS.map(battleScene),
  burrowScene(false),
  burrowScene(true),
  titleScene,
  ...LOCATION_IDS.map(mapScene),
  fxScene(),
];

// --- runner --------------------------------------------------------------------------------------

function start(): void {
  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  const caption = document.getElementById('caption');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  const q = new URLSearchParams(location.search);
  let index = Math.max(0, Math.min(SCENES.length - 1, Number(q.get('scene') || 0) | 0));
  let t = Number(q.get('t') || 0) || 0;
  const frozen = q.get('freeze') === '1';
  state.ui = q.get('ui') === '1';
  state.sample = q.get('pal') === '1';

  const fit = () => {
    const s = Math.max(1, Math.floor(Math.min(window.innerWidth / W, (window.innerHeight - 70) / H)));
    canvas.style.width = W * s + 'px';
    canvas.style.height = H * s + 'px';
  };
  fit();
  window.addEventListener('resize', fit);

  const show = (i: number) => {
    index = ((i % SCENES.length) + SCENES.length) % SCENES.length;
    t = 0;
    SCENES[index].reset?.();
    if (caption) caption.textContent = `${index + 1}/${SCENES.length}  ${SCENES[index].name}${state.sample ? '  [sample palette]' : ''}`;
  };
  const advance = (sec: number) => {
    let left = sec;
    while (left > 1e-6) {
      const dt = Math.min(1 / 60, left);
      t += dt;
      SCENES[index].update?.(dt);
      left -= dt;
    }
  };
  const render = () => {
    // Start every frame from a clean context, whatever the previous frame left on the state stack.
    ctx.reset();
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H);
    SCENES[index].draw(ctx, t);
    ctx.restore();
  };
  const startT = t;
  show(index);
  t = startT;

  canvas.addEventListener('click', () => show(index + 1));
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'arrowright' || k === 'enter') show(index + 1);
    else if (k === 'arrowleft') show(index - 1);
    else if (k === 'u') state.ui = !state.ui;
    else if (k === 'h') state.boxes = !state.boxes;
    else if (k === 'c') { state.sample = !state.sample; show(index); }
    else if (k === 'p') state.paused = !state.paused;
    else return;
    e.preventDefault();
  });

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!frozen && !state.paused) advance(dt);
    render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  (window as unknown as { __gallery?: unknown }).__gallery = {
    count: SCENES.length,
    names: SCENES.map((s) => s.name),
    show: (i: number) => { show(i); render(); },
    advance: (sec: number) => { advance(sec); render(); },
    setTime: (sec: number) => { t = sec; render(); },
    set: (key: 'ui' | 'boxes' | 'sample', on: boolean) => { state[key] = on; render(); },
    ready: true,
  };
}

void Promise.all([tryLoad('../art/dragon.ts', 'drawDragon'), tryLoad('../art/villain.ts', 'drawVillain')]).then(([d, v]) => {
  creatures.dragon = d;
  creatures.villain = v;
});
start();
