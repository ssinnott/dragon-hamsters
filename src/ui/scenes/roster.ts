// The roster: every dragon in the burrow on the left (mini sprite, name, level, HP, types), and the
// selected dragon's card on the right: a big animated sprite that hops for joy when picked, name,
// category, level and XP, types, status, an EVOLVE button for a dragon that has put off evolving,
// and four tabs:
//   STATS  six stat bars, personality marks, ability, genes as letter grades, training points
//   MOVES  the 4-slot loadout editor over every known move, with a move info strip
//   LORE   backstory, fact, size, favourite food, day joined, missions and wins, personality
//   NEEDS  fullness / happiness / energy, mood, activity slots left today, mission readiness
//
// Keys: Up/Down pick a dragon, Left/Right (or 1-4) switch tabs, Enter pets the dragon or (on MOVES)
// starts editing the loadout, E evolves, Escape backs out of editing and then out of the screen.
import type { Scene } from '../scene.ts';
import type { Input } from '../input.ts';
import { app } from '../app.ts';
import {
  STAT_IDS, type DragonVisual, type MoveCategory, type MoveId, type StatId, type Stats,
} from '../../data/schema.ts';
import { getAbility, getFood, getMove, getPersonality, getSpecies, getType } from '../../data/index.ts';
import { calcStats } from '../../battle/stats.ts';
import {
  dragonName, dragonStats, dragonTypes, pendingEvolution, setLoadout, xpProgress,
} from '../../game/dragons.ts';
import { moodLine } from '../../game/habitat.ts';
import {
  MAX_LEVEL, MISSION_ENERGY, SLOTS_PER_DAY, TRAINING_CAP_STAT, TRAINING_CAP_TOTAL, type OwnedDragon,
} from '../../game/types.ts';
import { drawDragon, hash01, poseState, type Pose } from '../../art/dragon.ts';
import { drawText, drawTextOutlined, measureText } from '../../lib/engine/text.ts';
import {
  Button, ButtonGroup, ScrollList, UI, VIEW_W, drawBar, drawHpBar, drawInset, drawPanel, drawSelection,
  drawStatusBadge, drawTypeBadge, drawTypeBadges, fillRoundRect, hit, tint, wrapText, type Rect,
} from '../widgets.ts';
import { drawActivityIcon, drawFoodIcon, drawTypeIcon } from '../icons.ts';
import { sfx, music } from '../../audio/index.ts';

type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

const HEADER_H = 22;
const LIST_PANEL: Rect = { x: 6, y: 30, w: 214, h: 324 };
const LIST: Rect = { x: 12, y: 41, w: 202, h: 306 };
const ROW_H = 38;
const CARD: Rect = { x: 226, y: 30, w: 408, h: 324 };
const STAGE: Rect = { x: 234, y: 38, w: 122, h: 98 };
const INFO_X = 364, INFO_R = 626;
const TAB_Y = 142;
const BODY: Rect = { x: 234, y: 166, w: 392, h: 181 };
const BX = BODY.x + 6, BY = BODY.y + 5, BW = BODY.w - 12;

const TABS = ['STATS', 'MOVES', 'LORE', 'NEEDS'] as const;
const MOVES_TAB = 1;

const STAT_LABEL: Record<StatId, string> = { hp: 'HP', atk: 'ATTACK', def: 'DEFENSE', spa: 'SP. ATK', spd: 'SP. DEF', spe: 'SPEED' };
const STAT_COLOR: Record<StatId, string> = {
  hp: '#5fd35a', atk: '#f0803a', def: '#f6c63c', spa: '#4f9be0', spd: '#62c9a8', spe: '#e86fa8',
};
const UP_COLOR = '#d0452e', DOWN_COLOR = '#3a6fc4';
const CATEGORY: Record<MoveCategory, { text: string; fill: string }> = {
  physical: { text: 'PHYSICAL', fill: '#d9612f' },
  special: { text: 'SPECIAL', fill: '#4f7fd0' },
  status: { text: 'STATUS', fill: '#8a80a0' },
};

/** Genes (0-31) as a school grade. */
function geneGrade(g: number): { text: string; color: string } {
  if (g >= 31) return { text: 'S', color: '#e0a21a' };
  if (g >= 26) return { text: 'A', color: '#3f9a3a' };
  if (g >= 20) return { text: 'B', color: '#2f8fa0' };
  if (g >= 13) return { text: 'C', color: '#8a7a3a' };
  if (g >= 6) return { text: 'D', color: '#c0702a' };
  return { text: 'E', color: '#9a8a80' };
}

/** A generous "great stat at this level" used to scale stat bars. */
function statCap(level: number): Stats {
  const all = (n: number): Stats => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
  return calcStats(all(120), level, all(31), all(128), null);
}

// ---------------------------------------------------------------------------------------------
// Sprites: measured bounds and cached stills (wide wings and tails stay inside their boxes)
// ---------------------------------------------------------------------------------------------

interface Box { l: number; r: number; t: number; b: number }
const boxes = new Map<DragonVisual, Box>();

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

function fit(v: DragonVisual, maxW: number, maxH: number, maxScale: number): { scale: number; dx: number; dy: number } {
  const b = measure(v);
  const scale = Math.min(maxScale, maxW / Math.max(1, b.r - b.l), maxH / Math.max(1, b.b - b.t));
  return { scale, dx: -((b.l + b.r) / 2) * scale, dy: -Math.max(0, b.b) * scale };
}

interface Still { canvas: HTMLCanvasElement; ox: number; oy: number }
const stills = new Map<string, Still>();

function still(v: DragonVisual, maxW: number, maxH: number): Still {
  const key = `${v.body}|${v.accent}|${v.size}|${v.wings}|${v.horns}|${v.tail}|${maxW}|${maxH}`;
  const hitS = stills.get(key);
  if (hitS) return hitS;
  const f = fit(v, maxW, maxH, 1.2);
  const S = f.scale * v.size;
  const half = Math.ceil(60 * S), top = Math.ceil(100 * S);
  const c = document.createElement('canvas');
  c.width = half * 2; c.height = top + Math.ceil(16 * S);
  const g = c.getContext('2d')!;
  drawDragon(g, v, half, top, { scale: f.scale, t: openEyesTime(v) });
  const s: Still = { canvas: c, ox: half - f.dx, oy: top - f.dy };
  stills.set(key, s);
  return s;
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
    let s = 4242;
    const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < 300; i++) {
      const x = Math.floor(rnd() * 640), y = Math.floor(rnd() * 360);
      g.fillStyle = rnd() < 0.5 ? 'rgba(255, 230, 190, 0.07)' : 'rgba(20, 10, 10, 0.2)';
      g.fillRect(x, y, rnd() < 0.3 ? 2 : 1, 1);
    }
  }
  ctx.drawImage(wall, 0, 0);
}

/** A rounded chip with centred text. Returns its width. */
function chip(ctx: Ctx, text: string, x: number, y: number, fill: string, color = '#ffffff'): number {
  const w = measureText(text) + 10;
  fillRoundRect(ctx, x, y, w, 11, 3, UI.ink);
  fillRoundRect(ctx, x + 1, y + 1, w - 2, 9, 2, tint(fill, -0.15));
  fillRoundRect(ctx, x + 1, y + 1, w - 2, 8, 2, fill);
  drawText(ctx, text, x + 5, y + 2, { color, shadowColor: tint(fill, -0.5), shadow: color !== UI.text });
  return w;
}

interface Floater { text: string; x: number; y: number; t: number; color: string }

/** Chief Nibbles' first-visit briefing (once per save: flags.rosterTutorial). */
const TUTORIAL = [
  'This is the agent file room. Every dragon in the burrow has a card: stats, moves, lore, and how it is feeling today.',
  'A dragon can learn lots of moves but only carries FOUR on a mission. Open MOVES, pick a slot, then pick a move to swap it in.',
  'When a dragon is ready to evolve, a shiny gold EVOLVE button appears on its card. Press it and stand well back!',
];

// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

export function createRosterScene(dragonId?: string): Scene {
  const dragons = (): OwnedDragon[] => app.state.dragons;
  let tab = 0;
  let time = 0, hopT = 0, tabT = 1;
  let editing = false;
  type Pending = { kind: 'slot'; i: number } | { kind: 'move'; id: MoveId };
  let pending: Pending | null = null;
  const slotFlash = [0, 0, 0, 0];
  const floaters: Floater[] = [];

  const list = new ScrollList<OwnedDragon>({
    rect: LIST, rowH: ROW_H, items: dragons, drawRow,
    onSelect: () => { hopT = 0; editing = false; pending = null; sfx('select'); },
    onActivate: () => activate(),
    empty: 'NO DRAGONS YET! CHIEF NIBBLES WILL SORT THAT OUT.',
  });
  const start = dragonId ? dragons().findIndex((d) => d.id === dragonId) : 0;
  list.selected = Math.max(0, start);
  list.ensureVisible(list.selected);
  list.scroll = Math.max(0, Math.min(list.selected * ROW_H, dragons().length * ROW_H - LIST.h));

  const current = (): OwnedDragon | null => dragons()[list.selected] ?? null;

  // ---- chrome: back, evolve, tabs --------------------------------------------------------------
  const chrome = new ButtonGroup();
  chrome.keyboard = false;
  chrome.add({
    label: 'BACK', rect: { x: VIEW_W - 64, y: 2, w: 58, h: 18 }, hotkey: 'Escape', color: UI.accent,
    onClick: () => { sfx('back'); app.scenes.pop(); },
  });
  chrome.add({
    label: 'EVOLVE!', rect: { x: INFO_X, y: 116, w: 96, h: 20 }, hotkey: 'e', color: UI.gold,
    visible: () => { const d = current(); return !!d && pendingEvolution(d) !== null; },
    icon: (g, cx, cy) => {
      const k = Math.floor(time * 4) % 2;
      drawText(g, '★', cx - 3, cy - 3, { color: k ? '#ffffff' : UI.goldDark, shadow: false });
    },
    onClick: () => {
      const d = current();
      if (!d || !pendingEvolution(d)) return;
      sfx('click');
      editing = false; pending = null;
      app.nav.evolve(d.id, () => { hopT = 0; });
    },
  });
  TABS.forEach((name, i) => {
    chrome.add({
      label: name, rect: { x: BODY.x + i * 99, y: TAB_Y, w: 95, h: 20 }, hotkey: String(i + 1),
      color: UI.button, visible: () => !!current(),
      onClick: () => switchTab(i),
    });
  });
  const tabButtons = chrome.buttons.slice(2);

  function switchTab(i: number): void {
    const n = (i + TABS.length) % TABS.length;
    if (n === tab) return;
    tab = n; tabT = 0;
    editing = false; pending = null;
    sfx('click');
  }

  function activate(): void {
    const d = current();
    if (!d) return;
    if (tab === MOVES_TAB) {
      editing = true;
      moveGroup.focus = 0;
      sfx('select');
    } else {
      poke();
    }
  }

  function poke(): void {
    const d = current();
    if (!d) return;
    if (d.hp <= 0) { sfx('snore'); floaters.push({ text: 'ZZZ...', x: STAGE.x + STAGE.w / 2, y: STAGE.y + 20, t: 0, color: UI.textLightDim }); return; }
    hopT = 0;
    sfx('fluff', { pitch: 1.1 + Math.random() * 0.2 });
    floaters.push({ text: '♥', x: STAGE.x + STAGE.w / 2 + Math.round((Math.random() - 0.5) * 30), y: STAGE.y + 22, t: 0, color: '#ff6f8a' });
  }

  // ---- the move editor ---------------------------------------------------------------------------
  const moveGroup = new ButtonGroup();
  moveGroup.keyboard = false;
  const buttonMove = new Map<Button, { move: MoveId | null; slot: number }>();
  let builtFor = '';

  const SLOT_X = BX + 12, SLOT_W = 116, SLOT_Y = BY + 11, SLOT_STEP = 24;
  const KNOWN_X = BX + 138, KNOWN_W = Math.floor((BX + BW - KNOWN_X - 4) / 2), KNOWN_Y = BY + 11, KNOWN_STEP = 17;

  function moveButtonFace(m: MoveId | null): string {
    if (!m) return UI.panelDark;
    return tint(getType(getMove(m).type).color, 0.62);
  }

  function rebuildMoves(d: OwnedDragon | null): void {
    const sig = d ? `${d.id}|${d.moves.join(',')}|${d.knownMoves.join(',')}` : '';
    if (sig === builtFor) return;
    builtFor = sig;
    moveGroup.clear();
    buttonMove.clear();
    if (!d) return;
    for (let i = 0; i < 4; i++) {
      const m = d.moves[i] ?? null;
      const b = moveGroup.add({
        label: m ? getMove(m).name : '- EMPTY -', rect: { x: SLOT_X, y: SLOT_Y + i * SLOT_STEP, w: SLOT_W, h: 21 },
        color: moveButtonFace(m), textColor: m ? UI.text : UI.textDim, align: 'left',
        icon: m ? (g, cx, cy) => drawTypeIcon(g, getMove(m).type, cx, cy, 5) : undefined,
        decorate: (g, face) => {
          if (pending?.kind === 'slot' && pending.i === i) {
            // a bouncing arrow on the slot waiting for a move
            const bob = Math.floor(time * 6) % 2;
            drawText(g, '←', face.x + face.w - 9 - bob, face.y + Math.floor(face.h / 2) - 3, { color: UI.accent, shadowColor: UI.ink });
          }
          if (slotFlash[i] > 0) {
            g.save();
            g.globalAlpha = Math.min(1, slotFlash[i] * 2.5);
            fillRoundRect(g, face.x, face.y, face.w, face.h, 2, '#ffffff');
            g.restore();
          }
        },
        onClick: () => clickSlot(i),
      });
      buttonMove.set(b, { move: m, slot: i });
    }
    d.knownMoves.forEach((m, k) => {
      const col = k % 2, row = Math.floor(k / 2);
      const mv = getMove(m);
      const b = moveGroup.add({
        label: mv.name, rect: { x: KNOWN_X + col * (KNOWN_W + 4), y: KNOWN_Y + row * KNOWN_STEP, w: KNOWN_W, h: 15 },
        color: moveButtonFace(m), textColor: UI.text, align: 'left',
        icon: (g, cx, cy) => drawTypeIcon(g, mv.type, cx, cy, 4),
        visible: () => row < 7,
        decorate: (g, face) => {
          const dd = current();
          const slot = dd ? dd.moves.indexOf(m) : -1;
          if (slot >= 0) {
            const x = face.x + face.w - 10, y = face.y + Math.floor((face.h - 9) / 2);
            fillRoundRect(g, x, y, 9, 9, 2, UI.ink);
            fillRoundRect(g, x + 1, y + 1, 7, 7, 1, UI.night);
            drawText(g, String(slot + 1), x + 2, y + 1, { color: UI.goldLight, shadow: false });
          }
          if (pending?.kind === 'move' && pending.id === m) {
            g.save();
            g.globalAlpha = 0.35 + 0.2 * Math.sin(time * 8);
            fillRoundRect(g, face.x, face.y, face.w, face.h, 2, '#ffffff');
            g.restore();
          }
        },
        onClick: () => clickKnown(m),
      });
      buttonMove.set(b, { move: m, slot: -1 });
    });
  }

  function focusSlots(): void {
    if (!editing) return;
    moveGroup.focus = 0;
  }
  function focusKnown(): void {
    if (!editing) return;
    const d = current();
    if (!d) return;
    const k = d.knownMoves.findIndex((m) => !d.moves.includes(m));
    moveGroup.focus = 4 + Math.max(0, k);
  }

  function clickSlot(i: number): void {
    const d = current();
    if (!d) return;
    if (pending?.kind === 'move') { const m = pending.id; pending = null; equip(d, m, i); return; }
    if (pending?.kind === 'slot' && pending.i === i) { pending = null; sfx('back'); return; }
    pending = { kind: 'slot', i };
    sfx('select');
    focusKnown();
  }

  function clickKnown(m: MoveId): void {
    const d = current();
    if (!d) return;
    if (pending?.kind === 'slot') { const i = pending.i; pending = null; equip(d, m, i); return; }
    if (pending?.kind === 'move' && pending.id === m) { pending = null; sfx('back'); return; }
    if (!d.moves.includes(m) && d.moves.length < 4) { equip(d, m, d.moves.length); return; }
    pending = { kind: 'move', id: m };
    sfx('select');
    focusSlots();
  }

  function equip(d: OwnedDragon, m: MoveId, slot: number): void {
    const moves = [...d.moves];
    const j = moves.indexOf(m);
    const name = getMove(m).name.toUpperCase();
    if (j >= 0) {
      if (slot >= moves.length || j === slot) {
        sfx('error', { volume: 0.7 });
        say(`${name} IS ALREADY IN SLOT ${j + 1}.`, '#8a6a9a');
        return;
      }
      [moves[slot], moves[j]] = [moves[j], moves[slot]];
    } else if (slot < moves.length) {
      moves[slot] = m;
    } else {
      moves.push(m);
    }
    try {
      setLoadout(d, moves);
    } catch {
      sfx('error');
      return;
    }
    app.save();
    sfx('statUp', { volume: 0.8 });
    const at = d.moves.indexOf(m);
    if (at >= 0) slotFlash[at] = 0.4;
    if (j >= 0 && slot < 4) slotFlash[j] = 0.4;
    say(j >= 0 ? `SWAPPED SLOTS ${j + 1} AND ${slot + 1}!` : `${name} EQUIPPED IN SLOT ${at + 1}!`, '#3f8f4a');
    focusSlots();
  }

  /** A short message in the hint spot under the slots (equipped, swapped, already there). */
  let note: { text: string; color: string; t: number } | null = null;
  function say(text: string, color: string): void {
    note = { text, color, t: 0 };
  }

  /** The move the info strip describes. */
  function infoMove(d: OwnedDragon): MoveId | null {
    const f = editing ? moveGroup.focused : null;
    const hov = moveGroup.buttons.find((b) => b.hovered && b.isVisible) ?? null;
    const b = hov ?? f;
    const m = b ? buttonMove.get(b)?.move ?? null : null;
    if (m) return m;
    if (pending?.kind === 'move') return pending.id;
    if (pending?.kind === 'slot') return d.moves[pending.i] ?? null;
    return d.moves[0] ?? null;
  }

  // ---- update ----------------------------------------------------------------------------------
  let tutorialAsked = false;
  function update(dt: number, input: Input): void {
    time += dt; hopT += dt; tabT += dt;
    if (!tutorialAsked && !app.scenes.busy) {
      tutorialAsked = true;
      if (!app.state.flags.rosterTutorial && dragons().length) {
        app.state.flags.rosterTutorial = true;
        app.save();
        app.nav.dialog(TUTORIAL, undefined, 'chief');
        return;
      }
    }
    for (let i = 0; i < 4; i++) slotFlash[i] = Math.max(0, slotFlash[i] - dt);
    for (const f of floaters) f.t += dt;
    if (note) { note.t += dt; if (note.t > 1.8) note = null; }
    while (floaters.length && floaters[0].t > 1.4) floaters.shift();
    const d = current();
    rebuildMoves(tab === MOVES_TAB ? d : null);

    if (editing && input.back()) {
      if (pending) pending = null;
      else editing = false;
      sfx('back');
      return;
    }
    if (chrome.update(input)) { settleFocus(); return; }
    if (tab === MOVES_TAB) {
      moveGroup.keyboard = editing;
      if (moveGroup.update(input)) { settleFocus(); return; }
    }
    if (!editing) {
      if (input.pressed('ArrowLeft')) switchTab(tab - 1);
      else if (input.pressed('ArrowRight')) switchTab(tab + 1);
    }
    list.keyboard = !editing;
    list.update(input);

    const p = input.pointer;
    if (p.pressed && p.inside && current() && hit(STAGE, p.x, p.y)) poke();
    settleFocus();
  }

  /** Only show a focus ring where the keyboard actually is (or under the mouse). */
  function settleFocus(): void {
    const hc = chrome.buttons.findIndex((b) => b.hovered);
    chrome.focus = hc;
    if (!editing) moveGroup.focus = moveGroup.buttons.findIndex((b) => b.hovered);
  }

  // ---- drawing: list ---------------------------------------------------------------------------
  function drawRow(ctx: Ctx, d: OwnedDragon, r: Rect, selected: boolean, hovered: boolean): void {
    drawSelection(ctx, { x: r.x, y: r.y + 1, w: r.w, h: r.h - 2 }, selected, hovered);
    const sp = getSpecies(d.speciesId);
    const v = sp.visual;
    const fainted = d.hp <= 0;
    const gx = r.x + 18, gy = r.y + r.h - 4;
    if (selected && !fainted) {
      const f = fit(v, 32, 30, 1.2);
      drawDragon(ctx, v, gx + f.dx, gy + f.dy, { scale: f.scale, t: time });
    } else {
      const s = still(v, 32, 30);
      ctx.save();
      if (fainted) ctx.globalAlpha = 0.45;
      ctx.drawImage(s.canvas, Math.round(gx - s.ox), Math.round(gy - s.oy));
      ctx.restore();
    }
    const tx = r.x + 38;
    const right = r.x + r.w - 5;
    drawText(ctx, dragonName(d), tx, r.y + 5, { color: UI.text, shadow: false });
    const lv = 'LV' + d.level;
    drawText(ctx, lv, right, r.y + 5, { color: UI.textDim, shadow: false, align: 'right' });
    if (pendingEvolution(d)) {
      const k = Math.floor(time * 3 + d.level) % 2;
      drawText(ctx, '★', right - measureText(lv) - 10, r.y + 5, { color: k ? UI.gold : UI.goldDark, shadowColor: UI.ink });
    }
    const max = dragonStats(d).hp;
    drawHpBar(ctx, tx, r.y + 15, 96, d.hp, max);
    if (fainted) chip(ctx, 'FAINTED', tx + 100, r.y + 14, '#6a6080');
    else if (d.status) drawStatusBadge(ctx, d.status, tx + 100, r.y + 14);
    drawTypeBadges(ctx, dragonTypes(d), tx, r.y + 26, { small: true });
  }

  // ---- drawing: card ---------------------------------------------------------------------------
  function drawStage(ctx: Ctx, d: OwnedDragon): void {
    const s = STAGE;
    const sp = getSpecies(d.speciesId);
    const t0 = getType(sp.types[0]);
    drawInset(ctx, s.x, s.y, s.w, s.h, { fill: tint(t0.light, 0.45) });
    const fx = s.x + s.w / 2, fy = s.y + s.h - 13;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath(); ctx.ellipse(fx, fy, 44, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.rect(s.x + 1, s.y + 1, s.w - 2, s.h - 3); ctx.clip();
    const v = sp.visual;
    const fainted = d.hp <= 0;
    const f = fit(v, s.w - 14, fainted ? 46 : 56, 2);
    const hop = !fainted && hopT < 1.25;
    const pose: Pose = fainted ? 'sleep' : hop ? 'happy' : 'idle';
    const pop = hopT < 0.14 ? 1 + 0.1 * Math.sin((hopT / 0.14) * Math.PI) : 1;
    drawDragon(ctx, v, fx + f.dx, fy + f.dy + 3, { scale: f.scale * pop, t: hop ? hopT : time, pose });
    if (pendingEvolution(d)) {
      // twinkles: something is about to happen
      for (let i = 0; i < 5; i++) {
        const a = time * 1.3 + i * 1.26;
        const x = Math.round(fx + Math.cos(a) * 46), y = Math.round(s.y + 46 + Math.sin(a * 1.3) * 30);
        const big = (Math.floor(time * 5) + i) % 3 === 0;
        ctx.fillStyle = UI.goldLight;
        ctx.fillRect(x, y - (big ? 2 : 1), 1, big ? 5 : 3);
        ctx.fillRect(x - (big ? 2 : 1), y, big ? 5 : 3, 1);
      }
    }
    ctx.restore();
  }

  function drawInfo(ctx: Ctx, d: OwnedDragon): void {
    const sp = getSpecies(d.speciesId);
    const x = INFO_X;
    drawText(ctx, dragonName(d), x, 40, { size: 2, color: UI.text, shadowColor: UI.panelDark });
    const lv = 'LV ' + d.level;
    drawText(ctx, lv, INFO_R, 40, { size: 2, color: UI.accent, shadowColor: UI.panelDark, align: 'right' });
    drawText(ctx, sp.category, x, 58, { color: UI.textDim, shadow: false });
    const bx = x + drawTypeBadges(ctx, sp.types, x, 69) + 4;
    if (d.hp <= 0) chip(ctx, 'FAINTED', bx, 70, '#6a6080');
    else if (d.status) drawStatusBadge(ctx, d.status, bx, 70);
    // HP
    const max = dragonStats(d).hp;
    drawHpBar(ctx, x, 87, 168, d.hp, max);
    drawText(ctx, `${d.hp}/${max}`, INFO_R, 88, { color: UI.text, shadow: false, align: 'right' });
    // XP
    const xp = xpProgress(d);
    drawText(ctx, 'XP', x + 1, 101, { color: UI.textDim, shadow: false });
    drawBar(ctx, x + 14, 101, 154, 7, xp.frac, UI.info);
    const xpText = d.level >= MAX_LEVEL ? 'MAX LEVEL!' : `${xp.span - xp.into} TO LV ${d.level + 1}`;
    drawText(ctx, xpText, INFO_R, 101, { color: UI.textDim, shadow: false, align: 'right' });
    // evolution line (the EVOLVE button takes this spot when it is ready)
    if (!pendingEvolution(d)) {
      const evo = sp.evolvesTo;
      const text = evo ? `EVOLVES AT LV ${evo.level}` : sp.evolvesFrom ? 'FULLY EVOLVED' : 'DOES NOT EVOLVE';
      drawText(ctx, text, x, 122, { color: UI.textDim, shadow: false });
    } else {
      const to = getSpecies(sp.evolvesTo!.species);
      drawText(ctx, 'READY TO EVOLVE INTO', x + 104, 117, { color: UI.textDim, shadow: false });
      drawText(ctx, to.name + '!', x + 104, 127, { color: '#b8781e', shadow: false });
    }
  }

  function drawTabs(ctx: Ctx): void {
    tabButtons.forEach((b, i) => { b.spec.color = i === tab ? UI.accent : UI.button; });
    // the tab strip sits on a little shelf above the body
    ctx.fillStyle = tint(UI.panel, -0.12);
    ctx.fillRect(BODY.x + 2, TAB_Y + 21, BODY.w - 4, 1);
  }

  // ---- tab bodies ------------------------------------------------------------------------------
  function drawStats(ctx: Ctx, d: OwnedDragon): void {
    const stats = dragonStats(d);
    const cap = statCap(d.level);
    const pers = getPersonality(d.personality);
    const colLabel = BX + 2, colMark = BX + 49, colVal = BX + 82, barX = BX + 88, barW = 140;
    const colGene = BX + 246, colTrain = BX + 274;
    const trainTotal = STAT_IDS.reduce((a, s) => a + d.training[s], 0);
    drawText(ctx, 'STAT', colLabel, BY + 2, { color: UI.textDim, shadow: false });
    drawText(ctx, 'GENES', colGene + 4, BY + 2, { color: UI.textDim, shadow: false, align: 'center' });
    drawText(ctx, `TRAINING ${trainTotal}/${TRAINING_CAP_TOTAL}`, colTrain, BY + 2, { color: UI.textDim, shadow: false });
    STAT_IDS.forEach((s, i) => {
      const y = BY + 15 + i * 13;
      const up = pers.up === s && pers.up !== pers.down, down = pers.down === s && pers.up !== pers.down;
      drawText(ctx, STAT_LABEL[s], colLabel, y, { color: up ? UP_COLOR : down ? DOWN_COLOR : UI.text, shadow: false });
      if (up) drawText(ctx, '↑', colMark, y, { color: UP_COLOR, shadow: false });
      if (down) drawText(ctx, '↓', colMark, y, { color: DOWN_COLOR, shadow: false });
      drawText(ctx, String(stats[s]), colVal, y, { color: UI.text, shadow: false, align: 'right' });
      drawBar(ctx, barX, y, barW, 7, stats[s] / cap[s], STAT_COLOR[s]);
      const g = geneGrade(d.genes[s]);
      fillRoundRect(ctx, colGene - 1, y - 2, 11, 11, 2, UI.ink);
      fillRoundRect(ctx, colGene, y - 1, 9, 9, 2, g.color);
      drawText(ctx, g.text, colGene + 2, y, { color: '#ffffff', shadowColor: tint(g.color, -0.5) });
      drawBar(ctx, colTrain, y, 60, 7, d.training[s] / TRAINING_CAP_STAT, UI.gold);
      drawText(ctx, String(d.training[s]), colTrain + 64, y, { color: d.training[s] > 0 ? UI.text : UI.textDim, shadow: false });
    });
    // personality + ability
    let y = BY + 96;
    ctx.fillStyle = tint(UI.panel, -0.12);
    ctx.fillRect(BX, y - 5, BW, 1);
    let x = BX + 2;
    x += drawText(ctx, 'PERSONALITY: ', x, y, { color: UI.textDim, shadow: false });
    x += drawText(ctx, pers.name, x, y, { color: UI.text, shadow: false }) + 8;
    if (pers.up && pers.down && pers.up !== pers.down) {
      x += drawText(ctx, '↑' + STAT_LABEL[pers.up], x, y, { color: UP_COLOR, shadow: false }) + 6;
      drawText(ctx, '↓' + STAT_LABEL[pers.down], x, y, { color: DOWN_COLOR, shadow: false });
    } else {
      drawText(ctx, 'NO UPS OR DOWNS', x, y, { color: UI.textDim, shadow: false });
    }
    y += 10;
    for (const l of wrapText('"' + pers.blurb + '"', BW - 4).slice(0, 2)) { drawText(ctx, l, BX + 2, y, { color: UI.textDim, shadow: false }); y += 9; }
    y += 6;
    const ab = getAbility(d.ability);
    x = BX + 2;
    x += drawText(ctx, 'ABILITY: ', x, y, { color: UI.textDim, shadow: false });
    drawText(ctx, ab.name, x, y, { color: UI.text, shadow: false });
    const sp = getSpecies(d.speciesId);
    if (sp.hiddenAbility === d.ability) chip(ctx, 'RARE!', x + measureText(ab.name) + 6, y - 2, '#b05ac8');
    y += 10;
    for (const l of wrapText(ab.description, BW - 4).slice(0, 2)) { drawText(ctx, l, BX + 2, y, { color: UI.textDim, shadow: false }); y += 9; }
  }

  function drawMoves(ctx: Ctx, d: OwnedDragon): void {
    drawText(ctx, 'EQUIPPED', SLOT_X, BY + 1, { color: UI.textDim, shadow: false });
    drawText(ctx, `KNOWN MOVES (${d.knownMoves.length})`, KNOWN_X, BY + 1, { color: UI.textDim, shadow: false });
    for (let i = 0; i < 4; i++) drawText(ctx, String(i + 1), BX + 2, SLOT_Y + i * SLOT_STEP + 7, { color: UI.textDim, shadow: false });
    moveGroup.draw(ctx);
    // hint under the slots
    let hint: string;
    let hintColor = pending ? '#b3541a' : UI.textDim;
    if (note && !pending) { hint = note.text; hintColor = note.color; }
    else if (pending?.kind === 'slot') hint = `NOW PICK A MOVE FOR SLOT ${pending.i + 1}`;
    else if (pending?.kind === 'move') hint = `NOW PICK A SLOT FOR ${getMove(pending.id).name.toUpperCase()}`;
    else if (editing) hint = 'PICK A SLOT, THEN A MOVE. ESC: DONE';
    else hint = 'CLICK A SLOT, THEN A MOVE TO SWAP IT IN.';
    const hy = SLOT_Y + 4 * SLOT_STEP + 2;
    wrapText(hint, SLOT_W + 12).slice(0, 3).forEach((l, i) => drawText(ctx, l, BX + 2, hy + i * 9, { color: hintColor, shadow: false }));
    // info strip
    const m = infoMove(d);
    const iy = BODY.y + BODY.h - 41;
    drawInset(ctx, BX - 2, iy, BW + 4, 37, { fill: tint(UI.panel, 0.35) });
    if (!m) return;
    const mv = getMove(m);
    let x = BX + 4;
    const y = iy + 5;
    x += drawTypeBadge(ctx, mv.type, x, y) + 4;
    const cat = CATEGORY[mv.category];
    x += chip(ctx, cat.text, x, y + 1, cat.fill) + 8;
    const fixed = mv.effects.some((e) => e.kind === 'fixed');
    const sure = mv.effects.some((e) => e.kind === 'sureHit');
    const parts: [string, string][] = [
      ['POW', mv.power > 0 ? String(mv.power) : fixed ? 'LV' : '-'],
      ['ACC', sure ? 'SURE' : mv.accuracy + '%'],
      ['PP', String(mv.pp)],
      ['PRI', mv.priority > 0 ? '+' + mv.priority : String(mv.priority)],
    ];
    for (const [k, v] of parts) {
      x += drawText(ctx, k, x, y + 3, { color: UI.textDim, shadow: false }) + 4;
      x += drawText(ctx, v, x, y + 3, { color: UI.text, shadow: false }) + 10;
    }
    drawText(ctx, mv.name, BX + BW - 2, y + 3, { color: UI.text, shadow: false, align: 'right' });
    const desc = wrapText(mv.description, BW - 8)[0] ?? '';
    drawText(ctx, desc, BX + 4, y + 18, { color: UI.text, shadow: false });
  }

  function drawLore(ctx: Ctx, d: OwnedDragon): void {
    const sp = getSpecies(d.speciesId);
    const tw = BW - 4;
    let y = BY + 2;
    const story = wrapText(sp.backstory, tw).slice(0, 6);
    for (const l of story) { drawText(ctx, l, BX + 2, y, { color: UI.text, shadow: false }); y += 9; }
    y += 3;
    for (const l of wrapText('FACT: ' + sp.fact, tw).slice(0, 2)) { drawText(ctx, l, BX + 2, y, { color: '#a5502a', shadow: false }); y += 9; }
    // fact grid
    const gy = BODY.y + BODY.h - 62;
    ctx.fillStyle = tint(UI.panel, -0.12);
    ctx.fillRect(BX, gy - 6, BW, 1);
    const food = getFood(sp.favoriteFood);
    const pers = getPersonality(d.personality);
    const left: [string, string][] = [['HEIGHT', sp.height], ['WEIGHT', sp.weight], ['FAVOURITE', food.name], ['JOINED', `DAY ${d.joinedDay}`]];
    const right: [string, string][] = [['MISSIONS', String(d.missions)], ['BATTLES WON', String(d.battlesWon)], ['PERSONALITY', pers.name], ['DEX NO.', String(sp.dex).padStart(3, '0')]];
    const row = (items: [string, string][], x: number, lw: number): void => {
      items.forEach(([k, v], i) => {
        const yy = gy + i * 14;
        drawText(ctx, k, x, yy, { color: UI.textDim, shadow: false });
        let vx = x + lw;
        if (k === 'FAVOURITE') { drawFoodIcon(ctx, sp.favoriteFood, vx + 5, yy + 3, 12); vx += 14; }
        drawText(ctx, v, vx, yy, { color: UI.text, shadow: false });
      });
    };
    row(left, BX + 2, 62);
    row(right, BX + 200, 76);
  }

  function needBar(ctx: Ctx, y: number, label: string, value: number, color: string, word: string, icon: (x: number, y: number) => void): void {
    icon(BX + 9, y + 5);
    drawText(ctx, label, BX + 22, y + 2, { color: UI.text, shadow: false });
    drawBar(ctx, BX + 96, y, 170, 11, value / 100, color);
    drawText(ctx, `${Math.round(value)}`, BX + 272, y + 2, { color: UI.text, shadow: false });
    drawText(ctx, word, BX + BW - 2, y + 2, { color: UI.textDim, shadow: false, align: 'right' });
  }

  function drawNeeds(ctx: Ctx, d: OwnedDragon): void {
    const sp = getSpecies(d.speciesId);
    const n = d.needs;
    const full = n.fullness <= 0 ? 'STARVING' : n.fullness <= 30 ? 'HUNGRY' : n.fullness < 70 ? 'PECKISH' : n.fullness < 95 ? 'FULL' : 'STUFFED';
    const happy = n.happiness <= 20 ? 'GLUM' : n.happiness < 50 ? 'OKAY' : n.happiness < 80 ? 'HAPPY' : 'OVERJOYED';
    const energy = n.energy < MISSION_ENERGY ? 'SLEEPY' : n.energy < 70 ? 'PERKY' : 'BOUNCY';
    needBar(ctx, BY + 4, 'FULLNESS', n.fullness, '#f0a040', full, (x, y) => drawFoodIcon(ctx, sp.favoriteFood, x, y, 13));
    needBar(ctx, BY + 24, 'HAPPINESS', n.happiness, '#ef6f9a', happy, (x, y) => drawActivityIcon(ctx, 'play', x, y, 13));
    needBar(ctx, BY + 44, 'ENERGY', n.energy, '#5fb7f0', energy, (x, y) => drawActivityIcon(ctx, 'nap', x, y, 13));
    ctx.fillStyle = tint(UI.panel, -0.12);
    ctx.fillRect(BX, BY + 64, BW, 1);
    // mood
    const mood = moodLine(d);
    let y = BY + 72;
    drawText(ctx, 'MOOD', BX + 2, y + 4, { color: UI.textDim, shadow: false });
    const bad = /FAINT|STARV|HUNGRY|SLEEPY|GRUMPY|!/.test(mood) && mood !== 'OVERJOYED';
    drawText(ctx, mood, BX + 40, y, { size: 2, color: bad ? '#c0502a' : '#3f8f4a', shadowColor: UI.panelDark });
    // slots
    y += 22;
    const left = Math.max(0, SLOTS_PER_DAY - d.slotsUsed);
    let x = BX + 2;
    x += drawText(ctx, 'ACTIVITY SLOTS TODAY', x, y, { color: UI.textDim, shadow: false }) + 8;
    for (let i = 0; i < SLOTS_PER_DAY; i++) {
      const on = i < left;
      fillRoundRect(ctx, x, y - 1, 9, 9, 2, UI.ink);
      fillRoundRect(ctx, x + 1, y, 7, 7, 2, on ? UI.good : UI.panelDeep);
      if (on) { ctx.fillStyle = tint(UI.good, 0.5); ctx.fillRect(x + 2, y, 3, 1); }
      x += 12;
    }
    drawText(ctx, left === 1 ? '1 LEFT' : `${left} LEFT`, x + 4, y, { color: UI.text, shadow: false });
    // mission readiness
    y += 14;
    let ready: string, ok = false;
    if (d.hp <= 0) ready = 'FAINTED: A NAP IN THE COZY NEST WILL FIX THAT.';
    else if (n.fullness <= 0) ready = 'TOO HUNGRY FOR MISSIONS. SNACK TIME!';
    else if (n.energy < MISSION_ENERGY) ready = `TOO TIRED FOR MISSIONS (NEEDS ${MISSION_ENERGY} ENERGY).`;
    else { ready = 'READY FOR A MISSION!'; ok = true; }
    drawText(ctx, ready, BX + 2, y, { color: ok ? '#3f8f4a' : '#c0502a', shadow: false });
    // tip
    y += 14;
    const food = getFood(sp.favoriteFood);
    let tip: string;
    if (n.fullness <= 30) tip = `Tip: feed it at the Snack Bar. It adores ${food.name}!`;
    else if (n.energy < MISSION_ENERGY) tip = 'Tip: a nap in the Cozy Nest or a good night\'s sleep restores energy.';
    else if (n.happiness <= 20) tip = 'Tip: a romp in the Ball Pit cheers up even the grumpiest dragon.';
    else tip = `Tip: its favourite snack is ${food.name}. Double happiness!`;
    wrapText(tip, BW - 4).slice(0, 2).forEach((l, i) => drawText(ctx, l, BX + 2, y + i * 9, { color: UI.textDim, shadow: false }));
  }

  function drawCard(ctx: Ctx): void {
    drawPanel(ctx, CARD.x, CARD.y, CARD.w, CARD.h);
    const d = current();
    if (!d) {
      drawText(ctx, 'YOUR BURROW IS EMPTY!', CARD.x + CARD.w / 2, CARD.y + 130, { align: 'center', size: 2, color: UI.text, shadowColor: UI.panelDark });
      drawText(ctx, 'NO DRAGONS, NO NEEDS, NO STATS. JUST A VERY TIDY NEST.', CARD.x + CARD.w / 2, CARD.y + 154, { align: 'center', color: UI.textDim, shadow: false });
      return;
    }
    drawStage(ctx, d);
    drawInfo(ctx, d);
    drawTabs(ctx);
    drawInset(ctx, BODY.x, BODY.y, BODY.w, BODY.h, { fill: tint(UI.panel, 0.3) });
    // the body slides in a touch when the tab changes
    const slide = tabT < 0.12 ? Math.round((1 - tabT / 0.12) * 6) : 0;
    ctx.save();
    ctx.beginPath(); ctx.rect(BODY.x + 1, BODY.y + 1, BODY.w - 2, BODY.h - 3); ctx.clip();
    ctx.translate(slide, 0);
    if (tab === 0) drawStats(ctx, d);
    else if (tab === 1) drawMoves(ctx, d);
    else if (tab === 2) drawLore(ctx, d);
    else drawNeeds(ctx, d);
    ctx.restore();
  }

  function drawHeader(ctx: Ctx): void {
    ctx.fillStyle = UI.night;
    ctx.fillRect(0, 0, VIEW_W, HEADER_H);
    ctx.fillStyle = UI.nightLight;
    ctx.fillRect(0, HEADER_H - 3, VIEW_W, 1);
    ctx.fillStyle = UI.ink;
    ctx.fillRect(0, HEADER_H - 2, VIEW_W, 2);
    drawTextOutlined(ctx, 'DRAGONS', 10, 3, { size: 2, color: UI.gold });
    const d = current();
    const evo = !!d && pendingEvolution(d) !== null;
    const hint = editing ? 'ARROWS MOVE   ENTER PICK   ESC DONE'
      : `↑↓ DRAGON  ← → TAB  ENTER ${tab === MOVES_TAB ? 'EDIT' : 'PET'}${evo ? '  E EVOLVE' : ''}  ESC BACK`;
    drawText(ctx, hint, VIEW_W - 74, 7, { color: UI.textLightDim, shadowColor: UI.ink, align: 'right' });
  }

  function drawFloaters(ctx: Ctx): void {
    for (const f of floaters) {
      const k = f.t / 1.4;
      const y = Math.round(f.y - 14 * Math.min(1, f.t / 0.5));
      const a = k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3);
      drawTextOutlined(ctx, f.text, Math.round(f.x), y, { color: f.color, align: 'center', alpha: a });
    }
  }

  return {
    name: 'roster',
    enter(): void {
      music('burrow');
    },
    resume(): void {
      builtFor = '';
      hopT = 0;
    },
    update,
    draw(ctx: Ctx): void {
      drawWall(ctx);
      drawPanel(ctx, LIST_PANEL.x, LIST_PANEL.y, LIST_PANEL.w, LIST_PANEL.h, { title: `BURROW (${dragons().length})` });
      list.draw(ctx);
      drawCard(ctx);
      drawHeader(ctx);
      chrome.draw(ctx);
      drawFloaters(ctx);
    },
  };
}
