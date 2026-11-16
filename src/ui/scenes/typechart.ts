// The type chart overlay: the full 16x16 rock-paper-scissors grid (rows attack, columns defend),
// a cursor that explains any pair in words, the attacker's and defender's strengths and fears as
// icon rows, and the clean triangles from TYPE_CYCLES drawn as little icon loops with arrows.
//
// Opened from the Burrow (TYPES) and from battle ([?]) with `focus`: the player's attacking
// types and the foe's defending types are framed in gold and the cursor starts on that matchup.
import type { Scene } from '../scene.ts';
import type { Input } from '../input.ts';
import { app } from '../app.ts';
import { TYPE_IDS, type TypeId } from '../../data/schema.ts';
import { CHART, getType } from '../../data/index.ts';
import { TYPE_CYCLES, TYPE_CYCLE_NAMES } from '../../data/types.ts';
import { drawText, measureText } from '../../lib/engine/text.ts';
import {
  ButtonGroup, UI, drawEffectTag, drawInset, drawPanel, drawTypeBadge, fillRoundRect, hit, tint, wrapText,
} from '../widgets.ts';
import { drawTypeIcon } from '../icons.ts';
import { sfx } from '../../audio/index.ts';

type Ctx = CanvasRenderingContext2D;

export interface TypeChartFocus { attack?: readonly TypeId[]; defend?: readonly TypeId[] }

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

const PANEL = { x: 6, y: 9, w: 628, h: 345 };
const CELL = 16;
const N = TYPE_IDS.length;
/** Top-left of cell (0, 0). */
const GX = 46, GY = 60;
const GRID_W = CELL * N, GRID_H = CELL * N;
const SIDE_X = GX + GRID_W + 14;
const SIDE_W = PANEL.x + PANEL.w - 10 - SIDE_X;
const INFO = { x: SIDE_X, y: 24, w: SIDE_W, h: 96 };
const TRI = { x: SIDE_X, y: 126, w: SIDE_W, h: 168 };
const LEGEND_Y = 300;
const CAPTION = { x: 14, y: GY + GRID_H + 6, w: PANEL.w - 16, h: 26 };

/** Chart cell colours. */
const CELL_STYLE = {
  super: { fill: '#4cbf52', text: '#ffffff', label: '2' },
  weak: { fill: '#f08a3a', text: '#ffffff', label: '.5' },
  none: { fill: '#4a4260', text: '#d8d2e6', label: '0' },
} as const;

// ---------------------------------------------------------------------------------------------
// Why each pair is what it is (short, for the caption). Missing pairs fall back to the numbers.
// ---------------------------------------------------------------------------------------------

const REASONS: Record<string, string> = {
  'FLUFF>DARKNESS': 'a big warm hug chases off the dark', 'FLUFF>MIND': 'a surprise hug breaks any concentration',
  'FLUFF>ROCK': 'fluff just bounces off stone', 'FLUFF>METAL': 'fluff just bounces off steel',
  'FLUFF>BRAWL': 'brawlers shrug off a pillow fight',

  'FIRE>LEAF': 'it burns plants', 'FIRE>FROST': 'it melts the ice', 'FIRE>METAL': 'it melts metal into puddles',
  'FIRE>COOKING': "it overcooks the chef's dinner", 'FIRE>FIRE': 'fire is used to the heat',
  'FIRE>WATER': 'water puts it right out', 'FIRE>ROCK': 'rocks do not burn',

  'WATER>FIRE': 'it douses the flames', 'WATER>EARTH': 'it turns dirt into mud', 'WATER>ROCK': 'it wears down stone',
  'WATER>COOKING': 'it makes the snacks soggy', 'WATER>WATER': 'one more splash in the pond',
  'WATER>LEAF': 'plants drink it right up', 'WATER>WINGED': "like water off a duck's back",

  'LEAF>WATER': 'plants drink the water up', 'LEAF>EARTH': 'roots crack the soil', 'LEAF>ROCK': 'roots split the stone',
  'LEAF>FIRE': 'leaves go up in smoke', 'LEAF>LEAF': 'plants do not mind plants',
  'LEAF>SLIME': 'goo smothers the sprouts', 'LEAF>COOKING': 'chefs chop greens into salad',

  'LIGHTNING>WATER': 'it shocks the swimmers', 'LIGHTNING>WINGED': 'it zaps flyers out of the sky',
  'LIGHTNING>LIGHTNING': 'sparks only tickle sparks', 'LIGHTNING>LEAF': 'plants soak up the zap',
  'LIGHTNING>SLIME': 'rubbery goo insulates', 'LIGHTNING>EARTH': 'the ground soaks it all up',

  'EARTH>FIRE': 'dirt smothers the flames', 'EARTH>LIGHTNING': 'it grounds the sparks',
  'EARTH>SLIME': 'it buries the goo', 'EARTH>METAL': 'it buries the robots',
  'EARTH>LEAF': 'plants love fresh soil', 'EARTH>FROST': 'frozen ground will not budge',
  'EARTH>LIGHT': 'mud cannot dim the sparkle', 'EARTH>WINGED': 'flyers soar over the quake',

  'ROCK>FIRE': 'rocks squash the campfire', 'ROCK>FROST': 'rocks shatter the ice', 'ROCK>WINGED': 'rocks knock down flyers',
  'ROCK>EARTH': 'dirt swallows pebbles', 'ROCK>METAL': 'rocks bounce off metal', 'ROCK>BRAWL': 'brawlers punch rocks apart',

  'WINGED>BRAWL': 'it flies rings around brawlers', 'WINGED>SLIME': 'birds gobble up slugs',
  'WINGED>COOKING': 'it swoops in and steals the snacks', 'WINGED>LIGHTNING': 'storms ground the flyers',
  'WINGED>ROCK': 'beaks versus boulders. Ouch', 'WINGED>METAL': 'wings clang off metal',

  'FROST>LEAF': 'frost nips the crops', 'FROST>EARTH': 'it freezes the ground solid', 'FROST>WINGED': 'it ices up wings',
  'FROST>FIRE': 'ice melts in the heat', 'FROST>WATER': 'water shrugs off a chill', 'FROST>FROST': 'snow does not mind snow',
  'FROST>METAL': 'cold metal stays cold metal',

  'SLIME>LEAF': 'goo works like weedkiller', 'SLIME>LIGHTNING': 'it gums up the sparks',
  'SLIME>LIGHT': 'it smears the sparkle', 'SLIME>COOKING': 'yuck, food poisoning',
  'SLIME>SLIME': 'goo on goo is just more goo', 'SLIME>EARTH': 'the dirt soaks it up',
  'SLIME>WINGED': 'flyers flap out of reach', 'SLIME>METAL': 'it slides off rust-proof metal',

  'DARKNESS>MIND': 'it preys on fearful minds', 'DARKNESS>LIGHT': 'it swallows the light',
  'DARKNESS>DARKNESS': 'the dark is not scared of the dark', 'DARKNESS>BRAWL': 'brawlers are not afraid of the dark',

  'LIGHT>BRAWL': 'it dazzles the bullies', 'LIGHT>DARKNESS': 'it chases away the dark',
  'LIGHT>FIRE': 'fire is bright already', 'LIGHT>SLIME': 'goo dims the glow', 'LIGHT>METAL': 'shiny metal reflects it',

  'COOKING>FLUFF': 'no fluffball resists fresh treats', 'COOKING>LEAF': 'chefs chop up the veggies',
  'COOKING>FROST': 'a warm oven thaws the ice', 'COOKING>FIRE': 'fire is used to the kitchen',
  'COOKING>WATER': 'water just does the dishes', 'COOKING>METAL': 'pots and pans do not mind',
  'COOKING>COOKING': "a chef sees through another chef's tricks",

  'METAL>FROST': 'it shatters the ice', 'METAL>ROCK': 'it smashes the rocks', 'METAL>LIGHT': 'it tarnishes the sparkle',
  'METAL>FIRE': 'fire softens metal', 'METAL>WATER': 'water makes it rusty', 'METAL>LIGHTNING': 'magnets push it away',
  'METAL>METAL': 'clang! metal on metal',

  'MIND>BRAWL': 'it outsmarts the brawlers', 'MIND>SLIME': 'it outwits the sludge', 'MIND>MIND': 'big brains block big brains',
  'MIND>METAL': 'tinfoil hats really work', 'MIND>FLUFF': 'not much goes on in a fluffy head',
  'MIND>DARKNESS': 'the dark cannot be read',

  'BRAWL>FLUFF': 'it bowls over fluffballs', 'BRAWL>ROCK': 'it cracks the rocks', 'BRAWL>DARKNESS': 'it punches out the dark',
  'BRAWL>METAL': 'it dents the metal', 'BRAWL>SLIME': 'fists get stuck in the goo', 'BRAWL>WINGED': 'flyers dodge the punches',
  'BRAWL>MIND': 'big brains see the punch coming', 'BRAWL>LIGHT': 'too sparkly to punch',
};

/** Chief Nibbles' first-visit briefing (once per save: flags.typeChartTutorial). */
const TUTORIAL = [
  'The type chart! Attacking types run down the side, defending types along the top. Find where they meet.',
  'A green 2 means double damage. An orange .5 means half. A dark 0 means no effect at all. Blank means plain old normal.',
  'The loops on the right are the classics: FIRE beats LEAF, LEAF beats WATER, WATER beats FIRE. Rock, paper, scissors, with teeth!',
];

function mult(a: TypeId, d: TypeId): number {
  return CHART[a]?.[d] ?? 1;
}

function fmtMult(m: number): string {
  return 'X' + (Math.round(m * 100) / 100).toString();
}

/** The caption sentence for one pair. */
function caption(a: TypeId, d: TypeId): string {
  const m = mult(a, d);
  const an = getType(a).name, dn = getType(d).name;
  const head = `${an} ATTACKING ${dn}: `;
  const why = REASONS[`${a}>${d}`];
  const tail = why ? ' - ' + why.toUpperCase() + '!' : '!';
  if (m === 0) return head + 'NO EFFECT X0' + tail;
  if (m > 1) return head + 'SUPER EFFECTIVE ' + fmtMult(m) + tail;
  if (m < 1) return head + 'NOT VERY EFFECTIVE ' + fmtMult(m) + tail;
  return head + 'NORMAL DAMAGE X1. NOTHING SPECIAL HERE.';
}

// ---------------------------------------------------------------------------------------------
// Pixel helpers
// ---------------------------------------------------------------------------------------------

/** A crisp line of `w`-px squares from (x0, y0) to (x1, y1). */
function pixelLine(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string, w = 1): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  ctx.fillStyle = color;
  const o = Math.floor(w / 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    ctx.fillRect(Math.round(x0 + (x1 - x0) * t) - o, Math.round(y0 + (y1 - y0) * t) - o, w, w);
  }
}

/** An arrow from a to b with a pixel arrowhead at b (ink-outlined). */
function drawArrow(ctx: Ctx, ax: number, ay: number, bx: number, by: number, color: string): void {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const head = 5;
  const lx = bx - ux * head - uy * 3.5, ly = by - uy * head + ux * 3.5;
  const rx = bx - ux * head + uy * 3.5, ry = by - uy * head - ux * 3.5;
  const strokes = (c: string, w: number): void => {
    pixelLine(ctx, ax, ay, bx - ux * 2, by - uy * 2, c, w);
    pixelLine(ctx, bx, by, lx, ly, c, w);
    pixelLine(ctx, bx, by, rx, ry, c, w);
  };
  strokes(UI.ink, 3);
  strokes(color, 1);
}

// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

export function createTypeChartScene(focus?: TypeChartFocus): Scene {
  const focusAtk = new Set<TypeId>(focus?.attack ?? []);
  const focusDef = new Set<TypeId>(focus?.defend ?? []);
  const idx = (t: TypeId | undefined): number => (t ? Math.max(0, TYPE_IDS.indexOf(t)) : 0);
  let row = idx(focus?.attack?.[0]);
  let col = idx(focus?.defend?.[0]);
  let time = 0;
  /** Time since the cursor last moved (drives the little pop on the cursor cell). */
  let moved = 1;
  let lastPx = -1, lastPy = -1;
  /** Per-triangle edge cursor for clicks on a triangle (cycles A>B, B>C, C>A). */
  const triEdge = TYPE_CYCLES.map(() => 0);

  const buttons = new ButtonGroup();
  buttons.keyboard = false;
  buttons.add({
    label: 'CLOSE', rect: { x: PANEL.x + PANEL.w - 66, y: 1, w: 58, h: 18 }, hotkey: 'Escape', color: UI.accent,
    onClick: () => close(),
  });

  function close(): void {
    sfx('back');
    app.scenes.pop();
  }

  function setCursor(r: number, c: number, sound: boolean): void {
    r = (r + N) % N; c = (c + N) % N;
    if (r === row && c === col) return;
    row = r; col = c; moved = 0;
    if (sound) sfx('click', { volume: 0.5 });
  }

  // ---- triangles geometry ------------------------------------------------------------------
  const TRI_COLS = 4;
  const triCellW = Math.floor((TRI.w - 8) / TRI_COLS), triCellH = 74;
  function triCentre(i: number): { x: number; y: number } {
    const c = i % TRI_COLS, r = Math.floor(i / TRI_COLS);
    return { x: TRI.x + 4 + c * triCellW + Math.floor(triCellW / 2), y: TRI.y + 22 + r * triCellH + 30 };
  }
  function triPoints(i: number): { x: number; y: number }[] {
    const c = triCentre(i);
    return [{ x: c.x, y: c.y - 19 }, { x: c.x + 23, y: c.y + 15 }, { x: c.x - 23, y: c.y + 15 }];
  }
  function triRect(i: number): { x: number; y: number; w: number; h: number } {
    const c = triCentre(i);
    return { x: c.x - Math.floor(triCellW / 2) + 2, y: c.y - 30, w: triCellW - 4, h: triCellH - 4 };
  }
  /** Which edge (0..2) of triangle i is the current cursor pair, or -1. */
  function activeEdge(i: number): number {
    const cyc = TYPE_CYCLES[i];
    const a = TYPE_IDS[row], d = TYPE_IDS[col];
    for (let k = 0; k < 3; k++) {
      const p = cyc[k], q = cyc[(k + 1) % 3];
      if ((a === p && d === q) || (a === q && d === p)) return k;
    }
    return -1;
  }

  // ---- update ---------------------------------------------------------------------------------
  let tutorialAsked = false;
  function update(dt: number, input: Input): void {
    time += dt;
    moved += dt;
    if (!tutorialAsked && !app.scenes.busy) {
      tutorialAsked = true;
      if (!app.state.flags.typeChartTutorial) {
        app.state.flags.typeChartTutorial = true;
        app.save();
        app.nav.dialog(TUTORIAL, undefined, 'chief');
        return;
      }
    }
    if (buttons.update(input)) return;

    if (input.pressed('ArrowLeft')) setCursor(row, col - 1, true);
    else if (input.pressed('ArrowRight')) setCursor(row, col + 1, true);
    else if (input.pressed('ArrowUp')) setCursor(row - 1, col, true);
    else if (input.pressed('ArrowDown')) setCursor(row + 1, col, true);
    else if (input.pressed('Home')) setCursor(idx(focus?.attack?.[0]), idx(focus?.defend?.[0]), true);

    const p = input.pointer;
    const pmoved = p.x !== lastPx || p.y !== lastPy;
    lastPx = p.x; lastPy = p.y;
    if (p.inside && (pmoved || p.pressed)) {
      const c = Math.floor((p.x - GX) / CELL), r = Math.floor((p.y - GY) / CELL);
      const inCols = c >= 0 && c < N, inRows = r >= 0 && r < N;
      if (inCols && inRows) setCursor(r, c, p.pressed);
      else if (inCols && p.y >= GY - 18 && p.y < GY) setCursor(row, c, p.pressed);   // column header
      else if (inRows && p.x >= GX - 18 && p.x < GX) setCursor(r, col, p.pressed);   // row header
    }
    if (p.pressed && p.inside) {
      for (let i = 0; i < TYPE_CYCLES.length; i++) {
        if (!hit(triRect(i), p.x, p.y)) continue;
        const cyc = TYPE_CYCLES[i];
        const k = activeEdge(i) >= 0 ? (activeEdge(i) + 1) % 3 : triEdge[i];
        triEdge[i] = k;
        setCursor(TYPE_IDS.indexOf(cyc[k]), TYPE_IDS.indexOf(cyc[(k + 1) % 3]), false);
        sfx('select');
        break;
      }
    }
  }

  // ---- drawing --------------------------------------------------------------------------------
  function drawAxisLabels(ctx: Ctx): void {
    const label = 'DEFENDING →';
    drawText(ctx, label, GX + GRID_W / 2, GY - 30, { align: 'center', color: UI.text, shadow: false });
    const word = 'ATTACKING';
    const x = 16, step = 10;
    const y0 = GY + GRID_H / 2 - Math.floor(((word.length + 1) * step) / 2);
    for (let i = 0; i < word.length; i++) drawText(ctx, word[i], x, y0 + i * step, { color: UI.text, shadow: false });
    drawText(ctx, '↓', x, y0 + word.length * step, { color: UI.text, shadow: false });
  }

  function drawGrid(ctx: Ctx): void {
    // well behind the grid: its colour shows through as the grid lines
    fillRoundRect(ctx, GX - 2, GY - 2, GRID_W + 3, GRID_H + 3, 2, UI.ink);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const x = GX + c * CELL, y = GY + r * CELL;
        const m = mult(TYPE_IDS[r], TYPE_IDS[c]);
        const st = m === 0 ? CELL_STYLE.none : m > 1 ? CELL_STYLE.super : m < 1 ? CELL_STYLE.weak : null;
        const base = st ? st.fill : ((r + c) % 2 ? UI.panelLight : tint(UI.panelLight, -0.05));
        ctx.fillStyle = base;
        ctx.fillRect(x, y, CELL - 1, CELL - 1);
        if (st) {
          ctx.fillStyle = tint(base, 0.35);
          ctx.fillRect(x, y, CELL - 1, 1);
          ctx.fillStyle = tint(base, -0.2);
          ctx.fillRect(x, y + CELL - 2, CELL - 1, 1);
        }
        // the cursor's row and column glow
        if (r === row || c === col) {
          ctx.fillStyle = st ? 'rgba(255, 246, 200, 0.28)' : 'rgba(255, 228, 92, 0.42)';
          ctx.fillRect(x, y, CELL - 1, CELL - 1);
        }
        if (st) {
          const w = measureText(st.label);
          drawText(ctx, st.label, x + Math.floor((CELL - 1 - w) / 2), y + 4, { color: st.text, shadowColor: tint(st.fill, -0.5) });
        }
      }
    }
    // focus frames: gold outlines around the highlighted attack rows and defend columns
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    const gold = pulse > 0.5 ? UI.gold : UI.goldLight;
    for (const t of focusAtk) {
      const r = TYPE_IDS.indexOf(t);
      if (r < 0) continue;
      strokeRect(ctx, GX - 1, GY + r * CELL - 1, GRID_W + 1, CELL + 1, gold);
    }
    for (const t of focusDef) {
      const c = TYPE_IDS.indexOf(t);
      if (c < 0) continue;
      strokeRect(ctx, GX + c * CELL - 1, GY - 1, CELL + 1, GRID_H + 1, gold);
    }
    // the cursor cell, with a little pop when it arrives
    const pop = moved < 0.12 ? 1 : 0;
    const cx = GX + col * CELL - 2 - pop, cy = GY + row * CELL - 2 - pop;
    const cs = CELL + 3 + pop * 2;
    const ring = Math.sin(time * 6) > 0 ? UI.focus : tint(UI.focus, 0.35);
    strokeRect(ctx, cx - 2, cy - 2, cs + 4, cs + 4, UI.ink);
    strokeRect(ctx, cx - 1, cy - 1, cs + 2, cs + 2, ring);
    strokeRect(ctx, cx, cy, cs, cs, ring);
    strokeRect(ctx, cx + 1, cy + 1, cs - 2, cs - 2, UI.ink);
  }

  function strokeRect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillRect(x + w - 1, y, 1, h);
  }

  function drawHeaders(ctx: Ctx): void {
    for (let i = 0; i < N; i++) {
      const t = TYPE_IDS[i];
      const cxCol = GX + i * CELL + 7, cyRow = GY + i * CELL + 7;
      const colHot = i === col, rowHot = i === row;
      const colY = GY - 10 - (colHot ? 2 : 0);
      const rowX = GX - 10 - (rowHot ? 2 : 0);
      if (focusDef.has(t)) fillRoundRect(ctx, cxCol - 8, GY - 19, 17, 17, 4, UI.gold);
      if (focusAtk.has(t)) fillRoundRect(ctx, GX - 19, cyRow - 8, 17, 17, 4, UI.gold);
      drawTypeIcon(ctx, t, cxCol, colY, 6);
      drawTypeIcon(ctx, t, rowX, cyRow, 6);
    }
    // little pointers at the cursor's header icons
    ctx.fillStyle = UI.accent;
    const px = GX + col * CELL + 7, py = GY + row * CELL + 7;
    ctx.fillRect(px - 2, GY - 21 - 2, 5, 1); ctx.fillRect(px - 1, GY - 20 - 2, 3, 1); ctx.fillRect(px, GY - 19 - 2, 1, 1);
    ctx.fillRect(GX - 21 - 2, py - 2, 1, 5); ctx.fillRect(GX - 20 - 2, py - 1, 1, 3); ctx.fillRect(GX - 19 - 2, py, 1, 1);
  }

  function iconRow(ctx: Ctx, label: string, types: TypeId[], x: number, y: number, labelW: number, maxW: number, zero?: Set<TypeId>): void {
    drawText(ctx, label, x, y + 1, { color: UI.text, shadow: false });
    const x0 = x + labelW + 13;
    if (!types.length) {
      drawText(ctx, 'NOTHING!', x0 - 6, y + 1, { color: UI.textDim, shadow: false });
      return;
    }
    const step = Math.max(13, Math.min(17, Math.floor((maxW - labelW - 13) / types.length)));
    types.forEach((t, i) => {
      const ix = x0 + i * step;
      drawTypeIcon(ctx, t, ix, y + 4, 6);
      if (zero?.has(t)) {
        // immune: a little "0" chip on the icon's corner
        fillRoundRect(ctx, ix + 2, y + 3, 8, 10, 2, UI.ink);
        ctx.fillStyle = CELL_STYLE.none.fill;
        ctx.fillRect(ix + 3, y + 4, 6, 8);
        drawText(ctx, '0', ix + 4, y + 5, { color: '#ffffff', shadow: false });
      }
    });
  }

  function drawInfo(ctx: Ctx): void {
    const b = INFO;
    drawInset(ctx, b.x, b.y, b.w, b.h, { fill: tint(UI.panel, 0.25) });
    const a = TYPE_IDS[row], d = TYPE_IDS[col];
    const m = mult(a, d);
    let x = b.x + 8;
    const y = b.y + 7;
    x += drawTypeBadge(ctx, a, x, y) + 5;
    drawText(ctx, '→', x, y + 3, { color: UI.text, shadow: false });
    x += 11;
    x += drawTypeBadge(ctx, d, x, y) + 5;
    drawText(ctx, '=', x, y + 3, { color: UI.text, shadow: false });
    x += 11;
    drawEffectTag(ctx, m, x, y);

    const an = getType(a).name, dn = getType(d).name;
    const superVs = TYPE_IDS.filter((t) => mult(a, t) > 1);
    const weakVs = TYPE_IDS.filter((t) => mult(a, t) < 1);
    const fears = TYPE_IDS.filter((t) => mult(t, d) > 1);
    const shrugs = TYPE_IDS.filter((t) => mult(t, d) < 1);
    const zeroA = new Set(TYPE_IDS.filter((t) => mult(a, t) === 0));
    const zeroD = new Set(TYPE_IDS.filter((t) => mult(t, d) === 0));
    const labels = [`${an} HITS HARD:`, `${an} IS WEAK VS:`, `${dn} FEARS:`, `${dn} SHRUGS OFF:`];
    const lw = Math.max(...labels.map((l) => measureText(l)));
    const ly = b.y + 27;
    const mw = b.w - 16;
    iconRow(ctx, labels[0], superVs, b.x + 8, ly, lw, mw);
    iconRow(ctx, labels[1], weakVs, b.x + 8, ly + 16, lw, mw, zeroA);
    iconRow(ctx, labels[2], fears, b.x + 8, ly + 32, lw, mw);
    iconRow(ctx, labels[3], shrugs, b.x + 8, ly + 48, lw, mw, zeroD);
  }

  function drawTriangles(ctx: Ctx): void {
    const b = TRI;
    drawInset(ctx, b.x, b.y, b.w, b.h, { fill: tint(UI.panel, 0.25) });
    drawText(ctx, 'ROCK-PAPER-SCISSORS LOOPS', b.x + b.w / 2, b.y + 6, { align: 'center', color: UI.text, shadow: false });
    for (let i = 0; i < TYPE_CYCLES.length; i++) {
      const cyc = TYPE_CYCLES[i];
      const pts = triPoints(i);
      const edge = activeEdge(i);
      const r = triRect(i);
      if (edge >= 0) {
        fillRoundRect(ctx, r.x, r.y, r.w, r.h, 4, tint(UI.gold, 0.35));
        fillRoundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 3, tint(UI.gold, 0.7));
      }
      for (let k = 0; k < 3; k++) {
        const p = pts[k], q = pts[(k + 1) % 3];
        const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const inset = 10;
        const hot = edge === k;
        drawArrow(ctx, p.x + ux * inset, p.y + uy * inset, q.x - ux * inset, q.y - uy * inset, hot ? UI.gold : UI.good);
      }
      for (let k = 0; k < 3; k++) drawTypeIcon(ctx, cyc[k], pts[k].x, pts[k].y, 7);
      let name = TYPE_CYCLE_NAMES[i] ?? '';
      name = name.replace(/ TRIANGLE$/, '');
      const c = triCentre(i);
      const lines = wrapText(name, r.w - 4);
      drawText(ctx, lines[0] ?? '', c.x, c.y + 26, { align: 'center', color: edge >= 0 ? UI.text : UI.textDim, shadow: false });
    }
  }

  function drawLegend(ctx: Ctx): void {
    const items: { st: { fill: string; text: string; label: string } | null; text: string }[] = [
      { st: CELL_STYLE.super, text: 'SUPER X2' },
      { st: CELL_STYLE.weak, text: 'WEAK X0.5' },
      { st: CELL_STYLE.none, text: 'NO EFFECT' },
      { st: null, text: 'NORMAL X1' },
    ];
    const gap = 8;
    const total = items.reduce((s, it) => s + 15 + 4 + measureText(it.text), 0) + (items.length - 1) * gap;
    let x = SIDE_X + Math.floor((SIDE_W - total) / 2);
    const y = LEGEND_Y;
    for (const it of items) {
      fillRoundRect(ctx, x, y, 15, 15, 2, UI.ink);
      ctx.fillStyle = it.st ? it.st.fill : UI.panelLight;
      ctx.fillRect(x + 1, y + 1, 13, 13);
      if (it.st) {
        const w = measureText(it.st.label);
        drawText(ctx, it.st.label, x + 1 + Math.floor((13 - w) / 2), y + 4, { color: it.st.text, shadowColor: tint(it.st.fill, -0.5) });
      }
      drawText(ctx, it.text, x + 19, y + 4, { color: UI.text, shadow: false });
      x += 15 + 4 + measureText(it.text) + gap;
    }
  }

  function drawCaption(ctx: Ctx): void {
    const b = CAPTION;
    drawInset(ctx, b.x, b.y, b.w, b.h, { fill: UI.panelLight });
    const text = caption(TYPE_IDS[row], TYPE_IDS[col]);
    const lines = wrapText(text, b.w - 16).slice(0, 2);
    const step = 10;
    const y0 = b.y + Math.floor((b.h - (lines.length * step - 3)) / 2);
    const m = mult(TYPE_IDS[row], TYPE_IDS[col]);
    const color = m > 1 ? '#2f7d32' : m === 0 ? '#57506a' : m < 1 ? '#b3541a' : UI.text;
    lines.forEach((l, i) => drawText(ctx, l, b.x + b.w / 2, y0 + i * step, { align: 'center', color, shadow: false }));
  }

  return {
    name: 'typechart',
    overlay: true,
    update,
    draw(ctx: Ctx): void {
      drawPanel(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, { title: 'TYPE CHART' });
      drawAxisLabels(ctx);
      drawGrid(ctx);
      drawHeaders(ctx);
      drawInfo(ctx);
      drawTriangles(ctx);
      drawLegend(ctx);
      drawCaption(ctx);
      buttons.draw(ctx);
    },
  };
}
