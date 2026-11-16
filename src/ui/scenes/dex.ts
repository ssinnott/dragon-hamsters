// The Dragondex: every species in dex order as a grid of little sprites (owned in a bright frame,
// seen-but-not-owned in a dim one, never-seen as a dark silhouette marked ???), with a counter,
// and the selected species' entry: big sprite, number, name, category, types, height and weight,
// backstory and fact (seen only), base stats (owned only), the evolution chain with levels, and
// the missions whose reward pools hold it (titles only for missions the player can reach).
import type { Scene } from '../scene.ts';
import type { Input } from '../input.ts';
import { app } from '../app.ts';
import { STAT_IDS, type SpeciesDef, type SpeciesId, type StatId, type DragonVisual, type Rarity } from '../../data/schema.ts';
import { MISSIONS_IN_ORDER, SPECIES_BY_DEX, getSpecies } from '../../data/index.ts';
import { missionStatus } from '../../game/missions.ts';
import { drawDragon, hash01, poseState, type Pose } from '../../art/dragon.ts';
import { drawText, drawTextOutlined, measureText } from '../../lib/engine/text.ts';
import {
  ButtonGroup, UI, VIEW_W, drawBar, drawInset, drawPanel, drawTypeBadges, fillRoundRect, hit, tint, wrapText,
  type Rect,
} from '../widgets.ts';
import { sfx, music } from '../../audio/index.ts';

type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

const HEADER_H = 22;
const GRID_PANEL: Rect = { x: 6, y: 29, w: 258, h: 325 };
const COLS = 6, CELL_W = 40, CELL_H = 44;
const GRID: Rect = { x: 14, y: 37, w: COLS * CELL_W, h: 7 * CELL_H };
const ENTRY: Rect = { x: 270, y: 29, w: 364, h: 325 };
const EX = ENTRY.x + 8, EW = ENTRY.w - 16;
const STAGE: Rect = { x: EX, y: 37, w: 108, h: 90 };
const INFO_X = STAGE.x + STAGE.w + 10;
const LORE: Rect = { x: EX, y: 133, w: EW, h: 82 };
const STATS: Rect = { x: EX, y: 221, w: 168, h: 125 };
const EVO: Rect = { x: EX + 174, y: 221, w: EW - 174, h: 125 };

const STAT_SHORT: Record<StatId, string> = { hp: 'HP', atk: 'ATTACK', def: 'DEFENSE', spa: 'SP. ATK', spd: 'SP. DEF', spe: 'SPEED' };
const STAT_COLOR: Record<StatId, string> = {
  hp: '#5fd35a', atk: '#f0803a', def: '#f6c63c', spa: '#4f9be0', spd: '#62c9a8', spe: '#e86fa8',
};
const RARITY: Record<Rarity, { text: string; color: string }> = {
  starter: { text: 'STARTER', color: '#ef7d4f' },
  common: { text: 'COMMON', color: '#8d6f52' },
  uncommon: { text: 'UNCOMMON', color: '#3f8f4a' },
  rare: { text: 'RARE', color: '#3a6fc4' },
  legendary: { text: 'LEGENDARY', color: '#b8781e' },
};

// ---------------------------------------------------------------------------------------------
// Sprites: measured bounds (so wide wings and tails fit their boxes) and cached still frames
// ---------------------------------------------------------------------------------------------

/** A sprite's drawn bounds at scale 1, relative to its ground point (px). */
interface Box { l: number; r: number; t: number; b: number }
const boxes = new Map<DragonVisual, Box>();

/** A still idle frame with its eyes open (the blink cycle is part of the pose maths). */
function openEyesTime(v: DragonVisual): number {
  const phase = hash01([v.body, v.belly, v.accent, v.wing, v.size, v.build, v.wings, v.horns, v.tail]);
  for (const t of [0.45, 1.2, 1.9, 2.7, 3.4]) if (poseState('idle', t, 0, phase).eyes !== 'closed') return t;
  return 0.45;
}

function measure(v: DragonVisual): Box {
  const hitB = boxes.get(v);
  if (hitB) return hitB;
  const K = 2, S = K * v.size;
  const half = Math.ceil(60 * S), top = Math.ceil(100 * S);
  const c = document.createElement('canvas');
  c.width = half * 2; c.height = top + Math.ceil(16 * S);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  drawDragon(g, v, half, top, { scale: K, t: openEyesTime(v), silhouette: '#000000' });
  const data = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, x1 = -1, y0 = c.height, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] > 60) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const box: Box = x1 < 0
    ? { l: -20 * v.size, r: 20 * v.size, t: -40 * v.size, b: 0 }
    : { l: (x0 - half) / K, r: (x1 + 1 - half) / K, t: (y0 - top) / K, b: (y1 + 1 - top) / K };
  boxes.set(v, box);
  return box;
}

/** Scale and horizontal nudge that fit `v` (idle) inside maxW x maxH, centred on its bounds. */
function fit(v: DragonVisual, maxW: number, maxH: number, maxScale: number): { scale: number; dx: number; dy: number } {
  const b = measure(v);
  const scale = Math.min(maxScale, maxW / Math.max(1, b.r - b.l), maxH / Math.max(1, b.b - b.t));
  return { scale, dx: -((b.l + b.r) / 2) * scale, dy: -Math.max(0, b.b) * scale };
}

interface Still { canvas: HTMLCanvasElement; ox: number; oy: number }
const stills = new Map<string, Still>();

/** A still frame fitted to maxW x maxH; blit it with its bounds centred on x and resting on y. */
function still(sp: SpeciesDef, maxW: number, maxH: number, silhouette: string | null): Still {
  const key = `${sp.id}|${maxW}|${maxH}|${silhouette ?? ''}`;
  const hitS = stills.get(key);
  if (hitS) return hitS;
  const v = sp.visual;
  const f = fit(v, maxW, maxH, 1.2);
  const S = f.scale * v.size;
  const half = Math.ceil(60 * S), top = Math.ceil(100 * S);
  const c = document.createElement('canvas');
  c.width = half * 2; c.height = top + Math.ceil(16 * S);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  drawDragon(g, v, half, top, { scale: f.scale, t: openEyesTime(v), silhouette });
  const s: Still = { canvas: c, ox: half - f.dx, oy: top - f.dy };
  stills.set(key, s);
  return s;
}

function blitStill(ctx: Ctx, s: Still, x: number, y: number): void {
  ctx.drawImage(s.canvas, Math.round(x - s.ox), Math.round(y - s.oy));
}

// ---------------------------------------------------------------------------------------------
// Background (cached): a warm burrow wall
// ---------------------------------------------------------------------------------------------

let wall: HTMLCanvasElement | null = null;
function drawWall(ctx: Ctx): void {
  if (!wall) {
    wall = document.createElement('canvas');
    wall.width = 640; wall.height = 360;
    const g = wall.getContext('2d')!;
    const bands = ['#3d2a22', '#43302a', '#4a352c', '#523b30', '#5a4134', '#614536'];
    const bh = 360 / bands.length;
    bands.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, Math.floor(i * bh), 640, Math.ceil(bh) + 1); });
    let s = 99173;
    const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < 300; i++) {
      const x = Math.floor(rnd() * 640), y = Math.floor(rnd() * 360);
      g.fillStyle = rnd() < 0.5 ? 'rgba(255, 230, 190, 0.07)' : 'rgba(20, 10, 10, 0.2)';
      g.fillRect(x, y, rnd() < 0.3 ? 2 : 1, 1);
    }
    for (let i = 0; i < 26; i++) {   // pebbles
      const x = Math.floor(rnd() * 640), y = Math.floor(rnd() * 360), w = 3 + Math.floor(rnd() * 4);
      fillRoundRect(g, x, y, w, Math.max(2, w - 2), 1, 'rgba(255, 230, 190, 0.06)');
    }
  }
  ctx.drawImage(wall, 0, 0);
}

// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

type Know = 'owned' | 'seen' | 'unseen';

/** Chief Nibbles' first-visit briefing (once per save: flags.dexTutorial). */
const TUTORIAL = [
  'The Dragondex! Every dragon hamster the agency has on file. Well, the ones we have spotted. The rest are still shadowy question marks.',
  'Spot a dragon and it gets a page. Raise one yourself and you will see its base stats too. FOUND IN tells you which cases might turn one up.',
];

export function createDexScene(): Scene {
  const all = SPECIES_BY_DEX;
  const know = (sp: SpeciesDef): Know => {
    const dex = app.state.dex;
    if (dex.owned.includes(sp.id) || app.state.dragons.some((d) => d.speciesId === sp.id)) return 'owned';
    return dex.seen.includes(sp.id) ? 'seen' : 'unseen';
  };
  let sel = Math.max(0, all.findIndex((sp) => know(sp) === 'owned'));
  let scroll = 0, scrollTarget = 0;
  let hover = -1;
  let hopT = 9;
  let selT = 0;
  let time = 0;
  let lastPx = -1, lastPy = -1;
  const rows = Math.ceil(all.length / COLS);
  const visRows = Math.floor(GRID.h / CELL_H);
  const maxScroll = Math.max(0, rows - visRows) * CELL_H;

  const buttons = new ButtonGroup();
  buttons.keyboard = false;
  buttons.add({
    label: 'BACK', rect: { x: VIEW_W - 64, y: 2, w: 58, h: 18 }, hotkey: 'Escape', color: UI.accent,
    onClick: () => { sfx('back'); app.scenes.pop(); },
  });

  function cellRect(i: number): Rect {
    const c = i % COLS, r = Math.floor(i / COLS);
    return { x: GRID.x + c * CELL_W, y: GRID.y + r * CELL_H - Math.round(scroll), w: CELL_W - 2, h: CELL_H - 2 };
  }

  function select(i: number, sound: boolean): void {
    i = Math.max(0, Math.min(all.length - 1, i));
    if (i === sel) return;
    sel = i;
    selT = 0;
    hopT = 9;
    const r = Math.floor(i / COLS);
    const top = r * CELL_H;
    if (top < scrollTarget) scrollTarget = top;
    if (top + CELL_H > scrollTarget + GRID.h) scrollTarget = top + CELL_H - GRID.h;
    if (sound) sfx('select', { volume: 0.7 });
  }

  function poke(): void {
    if (know(all[sel]) === 'unseen') { sfx('error', { volume: 0.6 }); return; }
    hopT = 0;
    sfx('fluff', { pitch: 1.2 });
  }

  let tutorialAsked = false;
  function update(dt: number, input: Input): void {
    time += dt; hopT += dt; selT += dt;
    if (!tutorialAsked && !app.scenes.busy) {
      tutorialAsked = true;
      if (!app.state.flags.dexTutorial) {
        app.state.flags.dexTutorial = true;
        app.save();
        app.nav.dialog(TUTORIAL, undefined, 'chief');
        return;
      }
    }
    if (buttons.update(input)) return;
    if (input.pressed('ArrowLeft')) select(sel - 1, true);
    else if (input.pressed('ArrowRight')) select(sel + 1, true);
    else if (input.pressed('ArrowUp')) { if (sel - COLS >= 0) select(sel - COLS, true); }
    else if (input.pressed('ArrowDown')) { if (sel + COLS < all.length) select(sel + COLS, true); else if (Math.floor(sel / COLS) < rows - 1) select(all.length - 1, true); }
    else if (input.pressed('Home')) select(0, true);
    else if (input.pressed('End')) select(all.length - 1, true);
    else if (input.confirm()) poke();

    const p = input.pointer;
    const moved = p.x !== lastPx || p.y !== lastPy;
    lastPx = p.x; lastPy = p.y;
    hover = -1;
    if (p.inside && hit(GRID, p.x, p.y)) {
      for (let i = 0; i < all.length; i++) if (hit(cellRect(i), p.x, p.y)) { hover = i; break; }
    }
    if (p.inside && input.wheel !== 0 && hit(GRID_PANEL, p.x, p.y)) scrollTarget += input.wheel * 0.5;
    if (p.pressed && hover >= 0) {
      if (hover === sel) poke();
      else select(hover, true);
    } else if (p.pressed && p.inside && hit(STAGE, p.x, p.y)) {
      poke();
    }
    void moved;
    scrollTarget = Math.max(0, Math.min(maxScroll, scrollTarget));
    const d = scrollTarget - scroll;
    scroll = Math.abs(d) < 0.5 ? scrollTarget : scroll + d * 0.35;
  }

  // ---- drawing ------------------------------------------------------------------------------
  function drawHeader(ctx: Ctx): void {
    ctx.fillStyle = UI.night;
    ctx.fillRect(0, 0, VIEW_W, HEADER_H);
    ctx.fillStyle = UI.nightLight;
    ctx.fillRect(0, HEADER_H - 3, VIEW_W, 1);
    ctx.fillStyle = UI.ink;
    ctx.fillRect(0, HEADER_H - 2, VIEW_W, 2);
    drawTextOutlined(ctx, 'DRAGONDEX', 10, 3, { size: 2, color: UI.gold });
    const owned = all.filter((sp) => know(sp) === 'owned').length;
    const seen = all.filter((sp) => know(sp) !== 'unseen').length;
    const text = `OWNED ${owned} / SEEN ${seen} / TOTAL ${all.length}`;
    const tx = 140;
    drawText(ctx, text, tx, 4, { color: UI.textLight, shadowColor: UI.ink });
    const bw = measureText(text);
    drawBar(ctx, tx, 13, bw, 5, all.length ? owned / all.length : 0, UI.gold);
  }

  function drawCell(ctx: Ctx, i: number): void {
    const sp = all[i];
    const r = cellRect(i);
    const k = know(sp);
    const selected = i === sel, hovered = i === hover;
    // frame
    const fill = k === 'owned' ? UI.panelLight : k === 'seen' ? tint(UI.panelDark, -0.08) : UI.nightLight;
    const border = k === 'owned' ? UI.ink : k === 'seen' ? tint(UI.panelDeep, -0.3) : UI.nightDark;
    if (selected) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      fillRoundRect(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, 4, UI.ink);
      fillRoundRect(ctx, r.x - 1, r.y - 1, r.w + 2, r.h + 2, 4, pulse > 0.5 ? UI.focus : tint(UI.focus, 0.3));
    }
    fillRoundRect(ctx, r.x, r.y, r.w, r.h, 3, border);
    fillRoundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 2, selected ? (k === 'unseen' ? tint(UI.nightLight, 0.15) : UI.select) : fill);
    if (k !== 'unseen') {
      ctx.fillStyle = tint(fill, 0.5);
      ctx.fillRect(r.x + 3, r.y + 1, r.w - 6, 1);
    }
    if (hovered && !selected) fillRoundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 2, 'rgba(255, 246, 222, 0.35)');
    // number, and a heart for owned / ??? for never seen
    const num = String(sp.dex).padStart(2, '0');
    const numColor = k === 'owned' ? UI.textDim : k === 'seen' ? tint(UI.textDim, -0.2) : UI.textLightDim;
    drawText(ctx, num, r.x + 3, r.y + 3, { color: numColor, shadow: false });
    if (k === 'owned') drawText(ctx, '♥', r.x + r.w - 8, r.y + 3, { color: '#e0505a', shadow: false });
    if (k === 'unseen') drawText(ctx, '???', r.x + r.w - 3, r.y + 3, { color: UI.textLightDim, shadow: false, align: 'right' });
    // sprite, in the box under the number row
    const gx = r.x + Math.floor(r.w / 2), gy = r.y + r.h - 3;
    if (k === 'unseen') {
      blitStill(ctx, still(sp, r.w - 4, r.h - 15, UI.nightDark), gx, gy);
    } else {
      blitStill(ctx, still(sp, r.w - 4, r.h - 15, null), gx, gy);
    }
  }

  function drawGrid(ctx: Ctx): void {
    drawPanel(ctx, GRID_PANEL.x, GRID_PANEL.y, GRID_PANEL.w, GRID_PANEL.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(GRID.x - 4, GRID.y - 4, GRID.w + 8, GRID.h + 6);
    ctx.clip();
    for (let i = 0; i < all.length; i++) if (i !== sel) drawCell(ctx, i);
    drawCell(ctx, sel);
    ctx.restore();
    if (maxScroll > 0) {
      const bx = GRID.x + GRID.w + 1, th = Math.max(16, Math.round(GRID.h * GRID.h / (rows * CELL_H)));
      const ty = GRID.y + Math.round((GRID.h - th) * (scroll / maxScroll));
      fillRoundRect(ctx, bx, GRID.y, 6, GRID.h, 2, tint(UI.panelDeep, -0.2));
      fillRoundRect(ctx, bx, ty, 6, th, 2, UI.wood);
    }
  }

  function drawStage(ctx: Ctx, sp: SpeciesDef, k: Know): void {
    const s = STAGE;
    drawInset(ctx, s.x, s.y, s.w, s.h, { fill: k === 'unseen' ? UI.nightLight : '#cfe3d2' });
    // a soft spotlight floor
    const fx = s.x + s.w / 2, fy = s.y + s.h - 14;
    ctx.fillStyle = k === 'unseen' ? 'rgba(255,255,255,0.05)' : 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath(); ctx.ellipse(fx, fy, 40, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.rect(s.x + 1, s.y + 1, s.w - 2, s.h - 3); ctx.clip();
    const v = sp.visual;
    const f = fit(v, s.w - 12, 58, 1.7);
    const hop = hopT < 1.3;
    const pose: Pose = hop ? 'happy' : 'idle';
    const pop = selT < 0.15 ? 1 + 0.12 * Math.sin((selT / 0.15) * Math.PI) : 1;
    const gx = fx + f.dx, gy = fy + f.dy + 4;
    if (k === 'unseen') {
      drawDragon(ctx, v, gx, gy, { scale: f.scale * pop, t: time, silhouette: UI.nightDark });
      drawTextOutlined(ctx, '?', s.x + s.w - 14, s.y + 6, { size: 2, color: UI.textLightDim });
    } else {
      drawDragon(ctx, v, gx, gy, { scale: f.scale * pop, t: hop ? hopT : time, pose });
    }
    ctx.restore();
  }

  function drawInfo(ctx: Ctx, sp: SpeciesDef, k: Know): void {
    const x = INFO_X, right = EX + EW;
    drawText(ctx, 'NO. ' + String(sp.dex).padStart(3, '0'), x, STAGE.y + 2, { color: UI.textDim, shadow: false });
    // status chip
    const chip = k === 'owned' ? { t: 'OWNED', f: UI.good } : k === 'seen' ? { t: 'SEEN', f: UI.info } : { t: 'UNKNOWN', f: UI.inkSoft };
    const cw = measureText(chip.t) + 10;
    fillRoundRect(ctx, right - cw, STAGE.y, cw, 11, 3, UI.ink);
    fillRoundRect(ctx, right - cw + 1, STAGE.y + 1, cw - 2, 9, 2, chip.f);
    drawText(ctx, chip.t, right - cw + 5, STAGE.y + 2, { color: '#ffffff', shadowColor: tint(chip.f, -0.5) });
    if (k === 'unseen') {
      drawText(ctx, '???', x, STAGE.y + 15, { size: 2, color: UI.text, shadowColor: UI.panelDark });
      drawText(ctx, 'UNKNOWN DRAGON', x, STAGE.y + 34, { color: UI.textDim, shadow: false });
      drawText(ctx, 'HT ???   WT ???', x, STAGE.y + 64, { color: UI.textDim, shadow: false });
      return;
    }
    drawText(ctx, sp.name, x, STAGE.y + 15, { size: 2, color: UI.text, shadowColor: UI.panelDark });
    drawText(ctx, sp.category, x, STAGE.y + 34, { color: UI.textDim, shadow: false });
    drawTypeBadges(ctx, sp.types, x, STAGE.y + 45);
    // height / weight / rarity
    const hy = STAGE.y + 64;
    drawText(ctx, 'HT', x, hy, { color: UI.textDim, shadow: false });
    let cx = x + 15;
    cx += drawText(ctx, sp.height, cx, hy, { color: UI.text, shadow: false }) + 12;
    drawText(ctx, 'WT', cx, hy, { color: UI.textDim, shadow: false });
    drawText(ctx, sp.weight, cx + 15, hy, { color: UI.text, shadow: false });
    const rar = RARITY[sp.rarity] ?? RARITY.common;
    drawText(ctx, rar.text, x, hy + 13, { color: rar.color, shadow: false });
  }

  function drawLore(ctx: Ctx, sp: SpeciesDef, k: Know): void {
    const b = LORE;
    drawInset(ctx, b.x, b.y, b.w, b.h, { fill: tint(UI.panel, 0.3) });
    const tx = b.x + 7, tw = b.w - 14;
    if (k === 'unseen') {
      const lines = wrapText('No data yet. Spot this dragon on a mission (or win one) to fill in this page!', tw);
      lines.forEach((l, i) => drawText(ctx, l, tx, b.y + 30 + i * 10, { color: UI.textDim, shadow: false }));
      return;
    }
    const step = 9;
    const story = wrapText(sp.backstory, tw);
    const fact = wrapText('FACT: ' + sp.fact, tw);
    const maxLines = Math.floor((b.h - 10) / step);
    const storyLines = story.slice(0, Math.max(1, maxLines - fact.length));
    let y = b.y + 6;
    for (const l of storyLines) { drawText(ctx, l, tx, y, { color: UI.text, shadow: false }); y += step; }
    y += 3;
    for (const l of fact.slice(0, Math.max(0, maxLines - storyLines.length))) {
      drawText(ctx, l, tx, y, { color: '#a5502a', shadow: false });
      y += step;
    }
  }

  function drawStats(ctx: Ctx, sp: SpeciesDef, k: Know): void {
    const b = STATS;
    drawInset(ctx, b.x, b.y, b.w, b.h, { fill: tint(UI.panel, 0.3) });
    drawText(ctx, 'BASE STATS', b.x + 7, b.y + 6, { color: UI.text, shadow: false });
    const owned = k === 'owned';
    const rowY = (i: number): number => b.y + 20 + i * 13;
    const barX = b.x + 72, barW = b.w - 72 - 8;
    STAT_IDS.forEach((s, i) => {
      const y = rowY(i);
      drawText(ctx, STAT_SHORT[s], b.x + 7, y, { color: UI.textDim, shadow: false });
      if (owned) {
        const val = sp.baseStats[s];
        drawText(ctx, String(val), barX - 4, y, { color: UI.text, shadow: false, align: 'right' });
        drawBar(ctx, barX, y, barW, 7, val / 150, STAT_COLOR[s]);
      } else {
        drawText(ctx, '??', barX - 4, y, { color: UI.textDim, shadow: false, align: 'right' });
        drawBar(ctx, barX, y, barW, 7, 0, STAT_COLOR[s], { bg: tint(UI.barBg, 0.3) });
      }
    });
    const ty = rowY(6) + 3;
    if (owned) {
      const total = STAT_IDS.reduce((a, s) => a + sp.baseStats[s], 0);
      drawText(ctx, 'TOTAL', b.x + 7, ty, { color: UI.textDim, shadow: false });
      drawText(ctx, String(total), barX - 4, ty, { color: UI.text, shadow: false, align: 'right' });
    } else {
      drawText(ctx, 'RAISE ONE TO SEE THEM!', b.x + b.w / 2, ty, { color: UI.textDim, shadow: false, align: 'center' });
    }
  }

  /** The evolution line containing `sp`, first stage first. */
  function chain(sp: SpeciesDef): SpeciesDef[] {
    let first = sp;
    const guard = new Set<SpeciesId>();
    while (first.evolvesFrom && !guard.has(first.id)) { guard.add(first.id); first = getSpecies(first.evolvesFrom); }
    const out = [first];
    while (out[out.length - 1].evolvesTo && out.length < 5) out.push(getSpecies(out[out.length - 1].evolvesTo!.species));
    return out;
  }

  function drawEvolution(ctx: Ctx, sp: SpeciesDef): void {
    const b = EVO;
    drawInset(ctx, b.x, b.y, b.w, b.h, { fill: tint(UI.panel, 0.3) });
    drawText(ctx, 'EVOLUTION', b.x + 7, b.y + 6, { color: UI.text, shadow: false });
    const line = chain(sp);
    const slotW = 36;
    const gy = b.y + 50;
    if (line.length === 1) {
      // a one-stage dragon: its portrait and a note side by side
      const x = b.x + 12;
      fillRoundRect(ctx, x, b.y + 16, slotW, 40, 3, tint(UI.gold, 0.2));
      fillRoundRect(ctx, x + 1, b.y + 17, slotW - 2, 38, 2, tint(UI.gold, 0.65));
      blitStill(ctx, still(sp, slotW - 2, 32, know(sp) === 'unseen' ? UI.nightLight : null), x + slotW / 2, gy);
      drawText(ctx, 'DOES NOT', x + slotW + 10, b.y + 27, { color: UI.textDim, shadow: false });
      drawText(ctx, 'EVOLVE', x + slotW + 10, b.y + 37, { color: UI.textDim, shadow: false });
    }
    const arrowW = line.length > 1 ? Math.min(28, Math.floor((b.w - 12 - line.length * slotW) / (line.length - 1))) : 0;
    const totalW = line.length * slotW + (line.length - 1) * arrowW;
    let x = b.x + Math.floor((b.w - totalW) / 2);
    if (line.length > 1) line.forEach((s, i) => {
      const k = know(s);
      const cx = x + slotW / 2;
      if (s.id === sp.id) {
        fillRoundRect(ctx, x, b.y + 16, slotW, 40, 3, tint(UI.gold, 0.2));
        fillRoundRect(ctx, x + 1, b.y + 17, slotW - 2, 38, 2, tint(UI.gold, 0.65));
      }
      blitStill(ctx, still(s, slotW - 2, 32, k === 'unseen' ? UI.nightLight : null), cx, gy);
      if (i < line.length - 1) {
        const ax = x + slotW, lvl = s.evolvesTo?.level ?? 0;
        const midY = b.y + 34;
        drawText(ctx, '→', ax + Math.floor(arrowW / 2) - 3, midY, { color: UI.text, shadow: false });
        drawText(ctx, 'LV' + lvl, ax + Math.floor(arrowW / 2), midY - 10, { color: UI.textDim, shadow: false, align: 'center' });
      }
      x += slotW + arrowW;
    });

    // FOUND IN
    const fy = b.y + 66;
    ctx.fillStyle = tint(UI.panel, -0.12);
    ctx.fillRect(b.x + 6, fy - 4, b.w - 12, 1);
    drawText(ctx, 'FOUND IN:', b.x + 7, fy, { color: UI.text, shadow: false });
    const lines = foundIn(sp);
    const maxLines = Math.floor((b.y + b.h - 6 - (fy + 11)) / 9);
    lines.slice(0, maxLines).forEach((l, i) => {
      drawText(ctx, l.text, b.x + 7, fy + 11 + i * 9, { color: l.color, shadow: false });
    });
  }

  function clip(text: string, w: number): string {
    if (measureText(text) <= w) return text;
    let t = text;
    while (t.length > 1 && measureText(t + '.') > w) t = t.slice(0, -1);
    return t.trimEnd() + '.';
  }

  function foundIn(sp: SpeciesDef): { text: string; color: string }[] {
    const w = EVO.w - 14;
    const out: { text: string; color: string }[] = [];
    for (const m of MISSIONS_IN_ORDER) {
      if (!m.rewards.dragon?.species.includes(sp.id)) continue;
      const st = missionStatus(app.state, m.id);
      if (st === 'locked') out.push({ text: '???', color: UI.textDim });
      else out.push({ text: clip((st === 'cleared' ? '★ ' : '- ') + m.title, w), color: st === 'cleared' ? '#3f8f4a' : UI.text });
    }
    const maxLines = 5;
    if (out.length > maxLines) {
      const extra = out.length - (maxLines - 1);
      out.splice(maxLines - 1, out.length, { text: `+${extra} MORE CASES`, color: UI.textDim });
    }
    if (out.length) return out;
    if (sp.rarity === 'starter' && !sp.evolvesFrom) return [{ text: "CHIEF NIBBLES' STARTERS", color: UI.text }];
    if (sp.evolvesFrom) {
      const prev = getSpecies(sp.evolvesFrom);
      const name = know(prev) === 'unseen' ? '???' : prev.name.toUpperCase();
      return wrapText(`EVOLVE A ${name} AT LV ${prev.evolvesTo?.level ?? '?'}`, w).map((t) => ({ text: t, color: UI.text }));
    }
    return wrapText('NOT SPOTTED ON ANY CASE YET', w).map((t) => ({ text: t, color: UI.textDim }));
  }

  function drawEntry(ctx: Ctx): void {
    const sp = all[sel];
    const k = know(sp);
    drawPanel(ctx, ENTRY.x, ENTRY.y, ENTRY.w, ENTRY.h);
    drawStage(ctx, sp, k);
    drawInfo(ctx, sp, k);
    drawLore(ctx, sp, k);
    drawStats(ctx, sp, k);
    drawEvolution(ctx, sp);
  }

  return {
    name: 'dex',
    enter(): void {
      music('burrow');
    },
    update,
    draw(ctx: Ctx): void {
      drawWall(ctx);
      drawGrid(ctx);
      drawEntry(ctx);
      drawHeader(ctx);
      buttons.draw(ctx);
    },
  };
}
