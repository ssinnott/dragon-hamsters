// The Burrow: the hub of the game. Every owned dragon wanders the floor of the Secret Burrow and
// shows its mood (hungry ones dream of seeds, tired ones nap in the Cozy Nest, overjoyed ones hop).
//
//   HUD strip      DAY n, coins, MISSIONS DRAGONS DEX TYPES SHOP BAG SLEEP (hotkeys M D X T S B Z)
//   stations       click one or press 1-5 -> pick a dragon (and a food for the Snack Bar)
//   dragons        click one -> a floating info card with its needs and quick activity buttons
//   activity       doActivity, then a short vignette at the station, then a result card
//   SLEEP          confirm -> endDay -> a starry night and a sunrise -> the day report
//
// Keyboard: arrows move focus between the HUD buttons, the stations and the dragons themselves
// (they are invisible hotspot buttons in the same ButtonGroup), Enter picks, Escape closes.
import { drawText, measureText } from '../../lib/engine/text.ts';
import { app } from '../app.ts';
import type { Scene } from '../scene.ts';
import type { Input } from '../input.ts';
import {
  Button, ButtonGroup, ScrollList, UI, VIEW_H, VIEW_W, drawBar, drawCoins, drawHpBar, drawInset, drawPanel,
  drawPlaque, drawSelection, drawTypeBadges, fillRoundRect, hit, hpColor, tint, wrapText,
  type ButtonSpec, type Rect,
} from '../widgets.ts';
import { drawActivityIcon, drawCoinIcon, drawFoodIcon, drawItemIcon } from '../icons.ts';
import { STATIONS, drawBurrow, drawStation } from '../../art/backdrops.ts';
import { drawDragon, dragonHeight, type Pose } from '../../art/dragon.ts';
import { createFx } from '../../art/fx.ts';
import { music, setMusic, setSound, sfx, type SfxName } from '../../audio/index.ts';
import { ACTIVITIES, FOODS, ITEMS, MISSIONS, getMove, getSpecies } from '../../data/index.ts';
import {
  ACTIVITY_IDS, FOOD_IDS, ITEM_IDS, STAT_IDS, STAT_NAMES, STATUS_NAMES,
  type ActivityId, type DragonVisual, type FoodId, type StatId, type StatusId,
} from '../../data/schema.ts';
import { canDoActivity, doActivity, endDay, moodLine, type ActivityResult, type DayReport } from '../../game/habitat.ts';
import { dragonName, dragonStats, dragonTypes, findDragon, isFainted, xpProgress } from '../../game/dragons.ts';
import { MISSION_ENERGY, SLOTS_PER_DAY, type OwnedDragon } from '../../game/types.ts';

type Ctx = CanvasRenderingContext2D;
type IconFn = (ctx: Ctx, cx: number, cy: number) => void;

// ---------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------

const HUD_H = 28;
/** Where dragons wander (ground points). */
const FLOOR = { x0: 44, x1: 596, y0: 250, y1: 298 };
const DRAGON_SCALE = 1;
const WALK_SPEED = 26;
/** Mirrors the habitat rules for the burrow's body language. */
const HUNGRY_AT = 30;
const JOYFUL_AT = 80;
/** Vignette timing (seconds). */
const ACT_TIME = 2.5;
/** The first case: the MISSIONS button pulses until it is cleared. */
const FIRST_CASE = 'cheese-1';

/** Stations in screen order, left to right: hotkeys 1-5. */
const STATION_ORDER: ActivityId[] = [...ACTIVITY_IDS].sort((a, b) => STATIONS[a].x - STATIONS[b].x);

const NEED_COLORS = { fullness: '#f39c3a', happiness: '#ff7eb0', energy: '#4fb3e0' } as const;
const STAT_COLORS: Record<StatId, string> = {
  hp: '#5fd35a', atk: '#ef6a3a', def: '#e0a040', spa: '#9a6ae0', spd: '#3fb39a', spe: '#4f9be0',
};

// ---------------------------------------------------------------------------------------------
// Small drawing helpers
// ---------------------------------------------------------------------------------------------

/** Pixel art from a string mask; each character picks a colour from `pal` ('.' is clear). */
function drawMask(ctx: Ctx, rows: readonly string[], cx: number, cy: number, pal: Record<string, string>): void {
  const h = rows.length, w = rows[0].length;
  const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
  for (let r = 0; r < h; r++) {
    const row = rows[r];
    for (let c = 0; c < w; c++) {
      const col = pal[row[c]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x0 + c, y0 + r, 1, 1);
    }
  }
}

const MASK_GLASS = [
  '.kkkk.....',
  'kwwggk....',
  'kwgggk....',
  'kggggk....',
  'kggggk....',
  '.kkkkkk...',
  '.....khk..',
  '......khk.',
  '.......khk',
  '........kk',
];
const MASK_PAW = [
  '..kk.kk..',
  '.kppkppk.',
  '..kk.kk..',
  'kk.....kk',
  'kpk.k.kpk',
  '.k.kpk.k.',
  '..kpppk..',
  '.kpppppk.',
  '.kpppppk.',
  '..kkkkk..',
];
const MASK_BOOK = [
  'kkkkkkkkk.',
  'krrrrrrrkw',
  'krryyyrrkw',
  'kryyyyyrkw',
  'krryyyrrkw',
  'krrrrrrrkw',
  'krrrrrrrkw',
  'kkkkkkkkkw',
  '.kwwwwwwwk',
  '..kkkkkkkk',
];
const MASK_GRID = [
  'kkkkkkkkkk',
  'kaakbbkcck',
  'kaakbbkcck',
  'kkkkkkkkkk',
  'kbbkcckaak',
  'kbbkcckaak',
  'kkkkkkkkkk',
  'kcckaakbbk',
  'kcckaakbbk',
  'kkkkkkkkkk',
];
const MASK_SACK = [
  '..kk.kk..',
  '...kyk...',
  '..kkkkk..',
  '.kbbbbbk.',
  'kbwbbbbbk',
  'kbwbbbbbk',
  'kbbbbbbbk',
  'kbbbbbbdk',
  '.kbbbbdk.',
  '..kkkkk..',
];
const MASK_ARROW = [
  '....k....',
  '...kck...',
  '..kccck..',
  '.kccccck.',
  'kkkccckkk',
  '..kccck..',
  '..kccck..',
  '..kkkkk..',
];
const MASK_PLUS = [
  '..kkk..',
  '..kck..',
  'kkkckkk',
  'kcccccck',
  'kkkckkk',
  '..kck..',
  '..kkk..',
];
const MASK_STAR = [
  '....k....',
  '...kyk...',
  'kkkkyykkk',
  'kyyyyyyyk',
  '.kyyyyyk.',
  '..kyyyk..',
  '.kyykyyk.',
  '.kkk.kkk.',
];

function iconGlass(ctx: Ctx, cx: number, cy: number): void {
  drawMask(ctx, MASK_GLASS, cx, cy, { k: UI.ink, w: '#ffffff', g: '#9fd8f0', h: '#9a6440' });
}
function iconPaw(ctx: Ctx, cx: number, cy: number): void {
  drawMask(ctx, MASK_PAW, cx, cy, { k: '#5a3a2a', p: '#ff9ab0' });
}
function iconBook(ctx: Ctx, cx: number, cy: number): void {
  drawMask(ctx, MASK_BOOK, cx, cy, { k: UI.ink, r: '#d8504a', y: '#ffd24a', w: '#fff6de' });
}
function iconGrid(ctx: Ctx, cx: number, cy: number): void {
  drawMask(ctx, MASK_GRID, cx, cy, { k: UI.ink, a: '#ef6a3a', b: '#5cbf4f', c: '#4f9be0' });
}
function iconSack(ctx: Ctx, cx: number, cy: number): void {
  drawMask(ctx, MASK_SACK, cx, cy, { k: UI.ink, b: '#c38a58', w: '#f0c890', d: '#8a5a34', y: '#ffd24a' });
}
function iconArrow(color: string): IconFn {
  return (ctx, cx, cy) => drawMask(ctx, MASK_ARROW, cx, cy, { k: UI.ink, c: color });
}
function iconPlus(ctx: Ctx, cx: number, cy: number): void {
  drawMask(ctx, MASK_PLUS, cx, cy, { k: UI.ink, c: '#5fd35a' });
}
function iconStar(ctx: Ctx, cx: number, cy: number): void {
  drawMask(ctx, MASK_STAR, cx, cy, { k: UI.ink, y: UI.gold });
}
function iconHeart(ctx: Ctx, cx: number, cy: number): void {
  drawText(ctx, '♥', cx - 2, cy - 3, { color: '#ff5a8a', shadowColor: UI.ink });
}

/** A little keyboard key with a label (hotkey hints). Returns its width. */
function drawKeycap(ctx: Ctx, key: string, x: number, y: number): number {
  const tw = measureText(key);
  const w = Math.max(9, tw + 4), h = 12;
  x = Math.round(x); y = Math.round(y);
  fillRoundRect(ctx, x, y, w, h, 2, UI.ink);
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 2, 1, UI.nightDark);
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 3, 1, UI.nightLight);
  ctx.fillStyle = tint(UI.nightLight, 0.25);
  ctx.fillRect(x + 2, y + 1, w - 4, 1);
  drawText(ctx, key, x + Math.floor((w - tw) / 2), y + 2, { color: UI.textLight, shadow: false });
  return w;
}

/** A small coloured pill with light text (effect chips). Returns its width. */
function drawChip(ctx: Ctx, text: string, x: number, y: number, fill: string): number {
  const w = measureText(text) + 8, h = 11;
  x = Math.round(x); y = Math.round(y);
  fillRoundRect(ctx, x, y, w, h, 3, UI.ink);
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 2, 2, tint(fill, -0.25));
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 3, 2, fill);
  drawText(ctx, text, x + 4, y + 2, { color: '#ffffff', shadowColor: tint(fill, -0.55) });
  return w;
}

/** Trim text (rarely needed) so it fits `maxW` px. */
function fit(text: string, maxW: number): string {
  if (measureText(text) <= maxW) return text;
  let s = text;
  while (s.length > 1 && measureText(s + '.') > maxW) s = s.slice(0, -1);
  return s.trimEnd() + '.';
}

function dragonVisual(d: OwnedDragon): DragonVisual {
  return getSpecies(d.speciesId).visual;
}

function likesActivity(d: OwnedDragon, id: ActivityId): boolean {
  const liked = ACTIVITIES[id].likedBy;
  return dragonTypes(d).some((t) => liked.includes(t));
}

function moodColor(m: string): string {
  if (m === 'FAINTED' || m.endsWith('!')) return UI.bad;
  if (m === 'SLEEPY' || m === 'GRUMPY') return tint(UI.warn, -0.15);
  if (m === 'OVERJOYED' || m === 'HAPPY') return tint(UI.good, -0.3);
  return UI.textDim;
}

function stationName(id: ActivityId): string {
  return ACTIVITIES[id].name.toUpperCase();
}

/** Activity effect chips for the station panel header. */
function activityChips(id: ActivityId): { text: string; color: string }[] {
  const a = ACTIVITIES[id];
  const out: { text: string; color: string }[] = [];
  out.push({ text: a.usesSlot ? '1 SLOT' : 'NO SLOT', color: '#8a7aa8' });
  if (a.energy !== 0) out.push({ text: `ENERGY ${a.energy > 0 ? '-' : '+'}${Math.abs(a.energy)}`, color: NEED_COLORS.energy });
  if (a.fullness > 0) out.push({ text: `FULL -${a.fullness}`, color: NEED_COLORS.fullness });
  if (a.happiness > 0) out.push({ text: `HAPPY +${a.happiness}`, color: NEED_COLORS.happiness });
  for (const s of STAT_IDS) {
    const n = a.training[s] ?? 0;
    if (n > 0) out.push({ text: `+${n} ${STAT_NAMES[s]}`, color: STAT_COLORS[s] });
  }
  if (a.xpFraction > 0) out.push({ text: '+XP', color: '#c89a2a' });
  if (id === 'nap') out.push({ text: 'HEALS HP', color: '#4caf50' });
  if (id === 'dig') out.push({ text: 'LOOT!', color: '#c89a2a' });
  if (id === 'feed') out.push({ text: 'PICK A SNACK', color: '#c89a2a' });
  return out;
}

function foodSummary(f: FoodId, fav: boolean): string {
  const def = FOODS[f];
  let s = `FULL +${def.fullness}, HAPPY +${def.happiness * (fav ? 2 : 1)}`;
  if (def.xp > 0) s += `, +${def.xp} XP`;
  return s;
}

// ---------------------------------------------------------------------------------------------
// Station geometry (derived from the station boxes so it follows the art)
// ---------------------------------------------------------------------------------------------

function stationCentre(id: ActivityId): { x: number; y: number } {
  const b = STATIONS[id];
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Where a dragon stands while it does an activity. */
function actPoint(id: ActivityId): { x: number; y: number; facing: 1 | -1 } {
  const b = STATIONS[id];
  const cx = b.x + b.w / 2, base = b.y + b.h;
  switch (id) {
    case 'feed': return { x: cx - 4, y: base + 16, facing: 1 };
    case 'wheel': return { x: cx, y: b.y + 78 + 47, facing: 1 };
    case 'nap': return { x: cx - 4, y: base - 10, facing: 1 };
    case 'dig': return { x: cx - 6, y: base + 4, facing: 1 };
    case 'play': return { x: cx - 8, y: base - 24, facing: -1 };
    default: return { x: cx, y: base + 12, facing: 1 };
  }
}

/** Where a dragon steps out to once its activity is over (the floor in front of the station). */
function exitPoint(id: ActivityId): { x: number; y: number } {
  const a = actPoint(id);
  return { x: a.x, y: Math.max(a.y, FLOOR.y0 + 3) };
}

/** The top of the ball pit's padded wall (the play vignette hides the dragon below it). */
function pitTop(): number {
  const b = STATIONS.play;
  return b.y + b.h - 40 + 6;
}

/** Spots in and around the Cozy Nest for sleepy dragons. */
function nestSpot(i: number): { x: number; y: number } {
  const b = STATIONS.nap;
  const cx = b.x + b.w / 2, ny = b.y + b.h - 16;
  const IN = [[-18, 8], [10, 10], [34, 7], [-38, 11], [44, 12]];
  if (i < IN.length) return { x: cx + IN[i][0], y: ny + IN[i][1] };
  const k = i - IN.length;
  return { x: cx - 56 + (k % 6) * 22, y: FLOOR.y0 + Math.floor(k / 6) * 10 };
}

/** Station sign geometry, mirrored from backdrops.ts, for the hotkey caps. */
function signLeft(id: ActivityId): { x: number; y: number } {
  const b = STATIONS[id];
  const cx = b.x + b.w / 2 + (id === 'nap' ? -14 : id === 'play' ? -4 : 0);
  const w = ACTIVITIES[id].name.length * 6 + 7;
  return { x: Math.round(cx - w / 2), y: b.y + 4 };
}

// ---------------------------------------------------------------------------------------------
// Hotspots: invisible buttons for stations and dragons, so keyboard focus can land on them
// ---------------------------------------------------------------------------------------------

class Hotspot extends Button {
  kind: 'station' | 'dragon';
  ref: string;
  constructor(spec: ButtonSpec, kind: 'station' | 'dragon', ref: string) {
    super(spec);
    this.kind = kind;
    this.ref = ref;
  }
  /** Drawn by the scene (station glow, dragon arrow). */
  override draw(_ctx: Ctx, _focused?: boolean): void { /* nothing */ }
}

// ---------------------------------------------------------------------------------------------
// Wandering dragons
// ---------------------------------------------------------------------------------------------

type WalkerState = 'idle' | 'walk' | 'hop' | 'toNest' | 'sleep' | 'faint' | 'held' | 'act';

interface Walker {
  id: string;
  x: number; y: number;
  tx: number; ty: number;
  state: WalkerState;
  timer: number;
  facing: 1 | -1;
  /** Per-dragon clock offset so the burrow does not breathe in lockstep. */
  phase: number;
  /** Hop timer when picked up / clicked. */
  wiggle: number;
  nest: number;
  /** Height in px (ear tips) of the current species at burrow scale. */
  h: number;
  btn: Hotspot;
}

interface Snapshot {
  needs: { fullness: number; happiness: number; energy: number };
  hp: number; maxHp: number; status: StatusId | null; level: number; xpFrac: number;
}

function snapshot(d: OwnedDragon): Snapshot {
  return {
    needs: { ...d.needs }, hp: d.hp, maxHp: dragonStats(d).hp, status: d.status, level: d.level, xpFrac: xpProgress(d).frac,
  };
}

// ---------------------------------------------------------------------------------------------
// Result rows
// ---------------------------------------------------------------------------------------------

interface ResultRow {
  kind: 'text' | 'chips' | 'xp';
  lines: string[];
  color: string;
  icon: IconFn | null;
  chips: { text: string; color: string }[];
  sound: SfxName;
  h: number;
}

const ROW_TEXT_W = 236;

function textRow(text: string, color: string, icon: IconFn | null, sound: SfxName = 'select'): ResultRow {
  const lines = wrapText(text.toUpperCase(), ROW_TEXT_W - 16);
  return { kind: 'text', lines, color, icon, chips: [], sound, h: lines.length * 10 + 3 };
}

// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

type Mode = 'hub' | 'card' | 'station' | 'vignette' | 'result' | 'night';

interface CardState {
  id: string;
  group: ButtonGroup;
  rect: Rect;
  acts: { id: ActivityId; btn: Button }[];
  msg: string;
  msgT: number;
}

interface DragonRow { d: OwnedDragon; ok: boolean; reason: string; liked: boolean }
interface FoodRow { id: FoodId; ok: boolean; reason: string; fav: boolean; count: number }

interface PanelState {
  station: ActivityId;
  mode: 'dragons' | 'foods';
  dragonId: string | null;
  fromCard: boolean;
  rows: DragonRow[];
  foods: FoodRow[];
  dlist: ScrollList<DragonRow>;
  flist: ScrollList<FoodRow>;
  group: ButtonGroup;
  msg: string;
  msgT: number;
}

interface Ball { x: number; y: number; vx: number; vy: number; color: string }

interface Vignette {
  id: string;
  activity: ActivityId;
  food: FoodId | null;
  result: ActivityResult;
  before: Snapshot;
  phase: 'walk' | 'act';
  t: number;
  walkDur: number;
  fromX: number; fromY: number;
  balls: Ball[];
  lootIcon: IconFn | null;
}

interface ResultState {
  id: string;
  activity: ActivityId;
  title: string;
  flavour: string[];
  rows: ResultRow[];
  t: number;
  shown: number;
  rect: Rect;
  group: ButtonGroup;
  evolveTo: string | null;
  xp: { from: number; to: number; levels: number[]; startLevel: number } | null;
}

interface NightState {
  t: number;
  report: DayReport;
  oldDay: number;
  dawnPlayed: boolean;
  snores: number;
}

const NIGHT_DARK = 1.0, NIGHT_HOLD = 2.5, NIGHT_DAWN = 3.6, NIGHT_END = 4.1;

const HUD_HINTS: Record<string, string> = {
  MISSIONS: 'MISSIONS: case files from Chief Nibbles. Send a squad of up to 3 dragons to crack them.',
  DRAGONS: 'DRAGONS: stats, moves and life stories of everyone in the burrow.',
  DEX: 'DRAGONDEX: every dragon hamster you have spotted or befriended.',
  TYPES: 'TYPE CHART: who beats whom. FIRE beats LEAF, LEAF beats WATER, WATER beats FIRE!',
  SHOP: 'PANTRY SHOP: snacks and battle items, paid for in shiny coins.',
  BAG: 'BAG: use healing items on your dragons, or peek at the pantry.',
  SLEEP: 'SLEEP: end the day. Everyone heals, recharges and gets fresh activity slots.',
};

const TIPS = [
  'Click a dragon to see how it feels, or press 1-5 to visit a station.',
  'A dragon dreaming of seeds is hungry. The Snack Bar never uses up an activity slot!',
  'Sleepy dragons tuck themselves into the Cozy Nest. Clever little things.',
  `Each dragon gets ${SLOTS_PER_DAY} activity slots per day. SLEEP to refill them.`,
  'Look for the ♥: a dragon doing its favourite activity gets double happiness.',
  'The Treasure Tunnels hide coins, snacks and the odd shiny item. Diggers welcome.',
  'Arrow keys hop between buttons, stations and dragons. Enter picks.',
];

const TUTORIAL = [
  'Welcome to the Secret Burrow, agent! This cosy hole in the ground is the headquarters of the Dragon Hamster Agency. Mind the bunting.',
  'These five stations keep your dragons in tip-top shape. Click a station, or press 1 to 5, then pick who gets to go.',
  'Every dragon has three needs: FULLNESS, HAPPINESS and ENERGY. A hungry dragon dreams of seeds, and a sleepy one shuffles off to the Cozy Nest.',
  `Each dragon gets ${SLOTS_PER_DAY} activity slots a day. Snacks at the Snack Bar are free. Snacks are always free. That is the agency's most important rule.`,
  'When everyone is worn out, press SLEEP. One good night heals every scrape and starts a brand new day.',
  'Click any dragon to see how it is feeling. The SHOP sells snacks, and your BAG holds healing items.',
  'Now, the important bit: our first case file is waiting on the MISSIONS board. That dinosaur egg will not un-steal itself!',
];

export function createBurrowScene(): Scene {
  let mode: Mode = 'hub';
  const fx = createFx();
  const walkers = new Map<string, Walker>();
  let order: Walker[] = [];
  const hub = new ButtonGroup();
  const hudButtons: Button[] = [];
  const stationSpots: Hotspot[] = [];
  let shownCoins = app.state.coins;
  let coinFlash = 0;
  let navT = -99;
  let tutorialAsked = false;
  let card: CardState | null = null;
  let panel: PanelState | null = null;
  let vig: Vignette | null = null;
  let result: ResultState | null = null;
  let night: NightState | null = null;

  // ---------------------------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------------------------

  const nagging = (): boolean =>
    MISSIONS.some((m) => m.id === FIRST_CASE) && (app.state.missions[FIRST_CASE]?.clears ?? 0) === 0;

  function hudButton(label: string, key: string, icon: IconFn, action: () => void, color?: string): Button {
    const w = measureText(label) + 37;
    const b = new Button({
      label, rect: { x: 0, y: 4, w, h: 20 }, hotkey: key, icon, align: 'left', color,
      onClick: () => { sfx('click'); action(); },
      decorate: (ctx, face) => {
        drawKeycap(ctx, key.toUpperCase(), face.x + face.w - 13, face.y + Math.floor((face.h - 12) / 2));
      },
    });
    return b;
  }

  function buildHud(): void {
    const nav = app.nav;
    hudButtons.push(
      hudButton('MISSIONS', 'm', iconGlass, () => nav.board(), UI.accent),
      hudButton('DRAGONS', 'd', iconPaw, () => nav.roster()),
      hudButton('DEX', 'x', iconBook, () => nav.dex()),
      hudButton('TYPES', 't', iconGrid, () => nav.typeChart()),
      hudButton('SHOP', 's', (c, x, y) => drawCoinIcon(c, x, y, 5), () => nav.shop()),
      hudButton('BAG', 'b', iconSack, () => nav.bag()),
      hudButton('SLEEP', 'z', (c, x, y) => drawActivityIcon(c, 'nap', x, y, 12), askSleep, '#b8a8e8'),
    );
    const gap = 3;
    let x = VIEW_W - 5 - hudButtons.reduce((s, b) => s + b.spec.rect.w, 0) - gap * (hudButtons.length - 1);
    for (const b of hudButtons) { b.spec.rect.x = x; x += b.spec.rect.w + gap; }

    STATION_ORDER.forEach((id, i) => {
      const r = STATIONS[id];
      stationSpots.push(new Hotspot({
        label: stationName(id), rect: { x: r.x, y: r.y, w: r.w, h: r.h }, hotkey: String(i + 1),
        onClick: () => openStation(id, null, false),
      }, 'station', id));
    });
  }

  function focusKey(): string | null {
    const f = hub.focused;
    if (!f) return null;
    if (f instanceof Hotspot) return f.kind + ':' + f.ref;
    return 'hud:' + f.spec.label;
  }

  function rebuildHub(): void {
    const key = focusKey();
    hub.clear();
    for (const b of hudButtons) hub.add(b);
    for (const s of stationSpots) hub.add(s);
    for (const w of order) hub.add(w.btn);
    if (key) {
      const i = hub.buttons.findIndex((b) => (b instanceof Hotspot ? b.kind + ':' + b.ref : 'hud:' + b.spec.label) === key);
      if (i >= 0) hub.focus = i;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Walkers
  // ---------------------------------------------------------------------------------------------

  function randomFloor(nearX?: number): { x: number; y: number } {
    let x = FLOOR.x0 + Math.random() * (FLOOR.x1 - FLOOR.x0);
    if (nearX !== undefined) x = Math.max(FLOOR.x0, Math.min(FLOOR.x1, nearX + (Math.random() - 0.5) * 320));
    return { x, y: FLOOR.y0 + Math.random() * (FLOOR.y1 - FLOOR.y0) };
  }

  function newWalker(d: OwnedDragon): Walker {
    const p = randomFloor();
    const w: Walker = {
      id: d.id, x: p.x, y: p.y, tx: p.x, ty: p.y, state: 'idle', timer: Math.random() * 2.5,
      facing: Math.random() < 0.5 ? 1 : -1, phase: Math.random() * 10, wiggle: 0, nest: -1, h: 36,
      btn: null as unknown as Hotspot,
    };
    w.btn = new Hotspot({
      label: d.id, rect: { x: p.x - 14, y: p.y - 36, w: 28, h: 36 }, onClick: () => openCard(w.id),
      enabled: () => mode === 'hub' && !(vig && vig.id === w.id),
    }, 'dragon', d.id);
    // Already-tired dragons start out asleep in the nest rather than wandering there.
    if (d.needs.energy < MISSION_ENERGY && !isFainted(d)) {
      w.nest = freeNestSpot();
      const s = nestSpot(w.nest);
      w.x = w.tx = s.x; w.y = w.ty = s.y;
      w.state = 'sleep';
    } else if (isFainted(d)) {
      w.state = 'faint';
    }
    return w;
  }

  function freeNestSpot(): number {
    const used = new Set<number>();
    for (const w of walkers.values()) if ((w.state === 'sleep' || w.state === 'toNest') && w.nest >= 0) used.add(w.nest);
    let i = 0;
    while (used.has(i)) i++;
    return i;
  }

  function sync(): void {
    const ds = app.state.dragons;
    const same = ds.length === order.length && ds.every((d, i) => order[i]?.id === d.id);
    if (same) return;
    const ids = new Set(ds.map((d) => d.id));
    for (const id of [...walkers.keys()]) if (!ids.has(id)) walkers.delete(id);
    for (const d of ds) if (!walkers.has(d.id)) walkers.set(d.id, newWalker(d));
    order = ds.map((d) => walkers.get(d.id) as Walker);
    rebuildHub();
  }

  function thinkWalker(w: Walker, d: OwnedDragon, dt: number): void {
    if (w.wiggle > 0) w.wiggle = Math.max(0, w.wiggle - dt);
    if (w.state === 'act' || w.state === 'held') return;
    const fainted = isFainted(d);
    const tired = d.needs.energy < MISSION_ENERGY;
    if (fainted) { if (w.state !== 'faint') { w.state = 'faint'; w.nest = -1; } return; }
    if (w.state === 'faint') { w.state = 'idle'; w.timer = 0.6; }
    if (tired && w.state !== 'sleep' && w.state !== 'toNest') {
      w.nest = freeNestSpot();
      const s = nestSpot(w.nest);
      w.tx = s.x; w.ty = s.y;
      w.state = 'toNest';
    } else if (!tired && (w.state === 'sleep' || w.state === 'toNest')) {
      // Rested: stretch, hop off the nest and back to the floor.
      w.state = 'hop'; w.timer = 0.9; w.nest = -1;
    }
    const hovered = w.btn.hovered && mode === 'hub';
    switch (w.state) {
      case 'idle':
        if (hovered) break;
        w.timer -= dt;
        if (w.timer <= 0) {
          if (d.needs.happiness >= JOYFUL_AT && Math.random() < 0.45) { w.state = 'hop'; w.timer = 1.3 + Math.random() * 0.8; }
          else {
            const p = randomFloor(w.x);
            w.tx = p.x; w.ty = p.y; w.state = 'walk';
          }
        }
        break;
      case 'hop':
        w.timer -= dt;
        if (w.timer <= 0) {
          if (w.y < FLOOR.y0 - 2) { const p = randomFloor(w.x); w.tx = p.x; w.ty = p.y; w.state = 'walk'; }
          else { w.state = 'idle'; w.timer = 1 + Math.random() * 2; }
        }
        break;
      case 'walk':
      case 'toNest': {
        if (hovered && w.state === 'walk') break;
        const dx = w.tx - w.x, dy = w.ty - w.y;
        const dist = Math.hypot(dx, dy);
        const step = WALK_SPEED * dt * (w.state === 'toNest' ? 0.8 : 1);
        if (Math.abs(dx) > 0.5) w.facing = dx > 0 ? 1 : -1;
        if (dist <= step) {
          w.x = w.tx; w.y = w.ty;
          if (w.state === 'toNest') w.state = 'sleep';
          else { w.state = 'idle'; w.timer = 1.5 + Math.random() * 3.5; }
        } else {
          w.x += (dx / dist) * step; w.y += (dy / dist) * step;
        }
        break;
      }
      default: break;
    }
  }

  function walkerPose(w: Walker): { pose: Pose; poseT: number } {
    if (night && night.t > 0.4 && night.t < NIGHT_DAWN - 0.3) return { pose: 'sleep', poseT: 0 };
    if (vig && vig.id === w.id) {
      if (vig.phase === 'walk') return { pose: 'run', poseT: 0 };
      const P: Record<ActivityId, Pose> = { feed: 'eat', wheel: 'run', dig: 'dig', nap: 'sleep', play: 'happy' };
      return { pose: P[vig.activity], poseT: 0 };
    }
    if (w.wiggle > 0) return { pose: 'happy', poseT: 0 };
    // a dragon under the cursor stops to look at you
    if (w.state === 'walk' && w.btn.hovered && mode === 'hub') return { pose: 'idle', poseT: 0 };
    switch (w.state) {
      case 'walk': case 'toNest': return { pose: 'walk', poseT: 0 };
      case 'hop': return { pose: 'happy', poseT: 0 };
      case 'sleep': return { pose: 'sleep', poseT: 0 };
      case 'faint': return { pose: 'faint', poseT: 0.58 };
      default: return { pose: 'idle', poseT: 0 };
    }
  }

  function updateHotspot(w: Walker, d: OwnedDragon): void {
    const v = dragonVisual(d);
    w.h = Math.max(18, Math.round(dragonHeight(v, DRAGON_SCALE)));
    const lying = w.state === 'sleep' || w.state === 'faint';
    const h = lying ? Math.round(w.h * 0.7) : w.h;
    const hw = Math.max(13, Math.round(w.h * (lying ? 0.6 : 0.42)));
    const r = w.btn.spec.rect;
    r.x = Math.round(w.x - hw); r.y = Math.round(w.y - h); r.w = hw * 2; r.h = h + 2;
  }

  // ---------------------------------------------------------------------------------------------
  // Info card
  // ---------------------------------------------------------------------------------------------

  const CARD_W = 206, CARD_H = 130;

  function canFeedAny(d: OwnedDragon): { ok: boolean; reason: string } {
    const stocked = FOOD_IDS.filter((f) => (app.state.food[f] ?? 0) > 0);
    if (!stocked.length) return { ok: false, reason: 'PANTRY EMPTY: VISIT THE SHOP' };
    let reason = '';
    for (const f of stocked) {
      const c = canDoActivity(app.state, d.id, 'feed', f);
      if (c.ok) return { ok: true, reason: '' };
      if (!reason) reason = c.reason ?? 'NOT RIGHT NOW';
    }
    return { ok: false, reason };
  }

  function check(d: OwnedDragon, id: ActivityId): { ok: boolean; reason: string } {
    if (id === 'feed') return canFeedAny(d);
    const c = canDoActivity(app.state, d.id, id);
    return { ok: c.ok, reason: c.ok ? '' : c.reason ?? 'NOT RIGHT NOW' };
  }

  function openCard(id: string): void {
    const d = findDragon(app.state, id);
    const w = walkers.get(id);
    if (!d || !w) return;
    sfx('select');
    w.state = w.state === 'sleep' || w.state === 'faint' ? w.state : 'held';
    w.wiggle = w.state === 'held' ? 0.55 : 0;
    // Above the dragon when there is room, else beside it.
    let x = Math.round(w.x - CARD_W / 2);
    let y = Math.round(w.y - w.h - 12 - CARD_H);
    if (y < HUD_H + 4) {
      y = Math.max(HUD_H + 4, Math.min(VIEW_H - CARD_H - 4, Math.round(w.y - CARD_H + 20)));
      x = w.x + 24 + CARD_W < VIEW_W - 4 ? Math.round(w.x + 24) : Math.round(w.x - 24 - CARD_W);
    }
    x = Math.max(4, Math.min(VIEW_W - CARD_W - 4, x));
    const rect = { x, y, w: CARD_W, h: CARD_H };
    const group = new ButtonGroup();
    group.add({
      label: 'CARD', rect: { x: x + 8, y: y + CARD_H - 38, w: 48, h: 20 }, hotkey: 'c', color: UI.accent,
      onClick: () => { sfx('click'); closeCard(); app.nav.roster(id); },
    });
    const acts: { id: ActivityId; btn: Button }[] = [];
    STATION_ORDER.forEach((aid, i) => {
      const btn = group.add({
        label: '', rect: { x: x + 61 + i * 28, y: y + CARD_H - 38, w: 26, h: 20 }, hotkey: String(i + 1),
        enabled: () => { const dd = findDragon(app.state, id); return !!dd && check(dd, aid).ok; },
        icon: (c, cx, cy) => drawActivityIcon(c, aid, cx, cy, 14),
        onClick: () => {
          if (aid === 'feed') { closeCard(); openStation('feed', id, true); }
          else startActivity(id, aid, null);
        },
      });
      acts.push({ id: aid, btn });
    });
    group.add({
      label: 'X', rect: { x: x + CARD_W - 19, y: y + 5, w: 14, h: 14 }, hotkey: 'Escape', color: UI.panelDark,
      onClick: () => { sfx('back'); closeCard(); },
    });
    group.focus = 0;
    card = { id, group, rect, acts, msg: '', msgT: 0 };
    mode = 'card';
  }

  function closeCard(): void {
    if (!card) return;
    const w = walkers.get(card.id);
    if (w && w.state === 'held') { w.state = 'idle'; w.timer = 0.8; }
    card = null;
    if (mode === 'card') mode = 'hub';
  }

  function updateCard(input: Input): void {
    if (!card) return;
    const c = card;
    const d = findDragon(app.state, c.id);
    if (!d) { closeCard(); return; }
    c.msgT = Math.max(0, c.msgT - 1 / 60);
    const p = input.pointer;
    // Disabled activity buttons still explain themselves when poked.
    if (p.pressed) {
      for (const a of c.acts) {
        if (hit(a.btn.spec.rect, p.x, p.y) && !a.btn.isEnabled) {
          sfx('error');
          c.msg = check(d, a.id).reason; c.msgT = 1.6;
          return;
        }
      }
      if (!hit(c.rect, p.x, p.y)) {
        // A click outside closes the card and goes on to whatever is there.
        closeCard();
        hub.update(input);
        return;
      }
    }
    for (let i = 0; i < c.acts.length; i++) {
      const a = c.acts[i];
      if (input.pressed(String(i + 1)) && !a.btn.isEnabled) { sfx('error'); c.msg = check(d, a.id).reason; c.msgT = 1.6; }
    }
    c.group.update(input);
  }

  function cardHint(d: OwnedDragon): { text: string; color: string } {
    const c = card as CardState;
    if (c.msgT > 0) return { text: c.msg, color: UI.bad };
    const p = app.input.pointer;
    let target: Button | null = null;
    for (const b of c.group.buttons) if (p.inside && hit(b.spec.rect, p.x, p.y)) target = b;
    if (!target) target = c.group.focused;
    const act = c.acts.find((a) => a.btn === target);
    if (act) {
      const r = check(d, act.id);
      const key = `[${STATION_ORDER.indexOf(act.id) + 1}] `;
      return r.ok ? { text: key + stationName(act.id) + (act.id === 'feed' ? ': PICK A SNACK' : ': GO!'), color: UI.text }
        : { text: key + r.reason, color: UI.bad };
    }
    if (target && target.spec.label === 'CARD') return { text: 'STATS, MOVES AND BACKSTORY', color: UI.text };
    if (target && target.spec.label === 'X') return { text: 'CLOSE (ESC)', color: UI.text };
    return { text: '', color: UI.text };
  }

  function drawCard(ctx: Ctx): void {
    if (!card) return;
    const d = findDragon(app.state, card.id);
    const w = walkers.get(card.id);
    if (!d || !w) return;
    const { x, y } = card.rect;
    // pointer tail toward the dragon
    const tx = Math.max(x + 14, Math.min(x + CARD_W - 14, Math.round(w.x)));
    const below = y + CARD_H < w.y - w.h;
    drawPanel(ctx, x, y, CARD_W, CARD_H, { fill: UI.panelLight });
    if (below) {
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = UI.ink; ctx.fillRect(tx - 7 + i, y + CARD_H - 1 + i, 15 - i * 2, 1);
        if (i < 6) { ctx.fillStyle = tint(UI.panelLight, -0.16); ctx.fillRect(tx - 6 + i, y + CARD_H - 2 + i, 13 - i * 2, 1); }
      }
    }
    const name = dragonName(d).toUpperCase();
    drawText(ctx, fit(name, 110), x + 8, y + 7, { color: UI.text, shadowColor: tint(UI.panelLight, -0.2) });
    drawText(ctx, 'LV ' + d.level, x + 8 + measureText(fit(name, 110)) + 6, y + 7, { color: UI.textDim, shadow: false });
    drawTypeBadges(ctx, dragonTypes(d), x + 8, y + 18, { small: true });
    const mood = moodLine(d);
    drawText(ctx, mood, x + CARD_W - 8, y + 20, { align: 'right', color: moodColor(mood), shadow: false });
    // HP and needs
    const max = dragonStats(d).hp;
    drawHpBar(ctx, x + 8, y + 33, 120, d.hp, max);
    drawText(ctx, `${d.hp}/${max}`, x + CARD_W - 8, y + 34, { align: 'right', color: UI.textDim, shadow: false });
    const needs: [string, number, string][] = [
      ['FULL', d.needs.fullness, NEED_COLORS.fullness],
      ['HAPPY', d.needs.happiness, NEED_COLORS.happiness],
      ['ENERGY', d.needs.energy, NEED_COLORS.energy],
    ];
    needs.forEach(([label, v, col], i) => {
      const yy = y + 46 + i * 10;
      drawText(ctx, label, x + 8, yy, { color: UI.textDim, shadow: false });
      drawBar(ctx, x + 48, yy, CARD_W - 80, 7, v / 100, col);
      drawText(ctx, String(v), x + CARD_W - 8, yy, { align: 'right', color: UI.text, shadow: false });
    });
    // slots left today
    const left = Math.max(0, SLOTS_PER_DAY - d.slotsUsed);
    const sy = y + 77;
    drawText(ctx, 'SLOTS TODAY', x + 8, sy, { color: UI.textDim, shadow: false });
    for (let i = 0; i < SLOTS_PER_DAY; i++) {
      const px = x + 80 + i * 11;
      fillRoundRect(ctx, px, sy - 1, 9, 9, 2, UI.ink);
      fillRoundRect(ctx, px + 1, sy, 7, 7, 1, i < left ? UI.gold : UI.disabled);
      if (i < left) { ctx.fillStyle = UI.goldLight; ctx.fillRect(px + 2, sy + 1, 3, 1); }
    }
    drawText(ctx, left === 1 ? '1 LEFT' : `${left} LEFT`, x + 82 + SLOTS_PER_DAY * 11, sy, { color: left ? UI.text : UI.bad, shadow: false });
    card.group.draw(ctx);
    const hint = cardHint(d);
    if (hint.text) drawText(ctx, fit(hint.text, CARD_W - 16), x + CARD_W / 2, y + CARD_H - 13, { align: 'center', color: hint.color, shadow: false });
  }

  // ---------------------------------------------------------------------------------------------
  // Station panel: pick a dragon (and a snack)
  // ---------------------------------------------------------------------------------------------

  const P: Rect = { x: 88, y: 40, w: 464, h: 272 };
  const LIST: Rect = { x: P.x + 8, y: P.y + 80, w: P.w - 16, h: 26 * 6 };
  const COL = { name: 30, hp: 134, full: 180, happy: 226, energy: 272, status: 320 };

  function dragonRows(station: ActivityId): DragonRow[] {
    const rows = app.state.dragons.map((d, i) => {
      const r = check(d, station);
      return { d, ok: r.ok, reason: r.reason, liked: likesActivity(d, station), i };
    });
    rows.sort((a, b) => Number(b.ok) - Number(a.ok) || Number(b.liked && b.ok) - Number(a.liked && a.ok) || a.i - b.i);
    return rows.map(({ d, ok, reason, liked }) => ({ d, ok, reason, liked }));
  }

  function foodRows(d: OwnedDragon): FoodRow[] {
    const fav = getSpecies(d.speciesId).favoriteFood;
    return FOOD_IDS.map((f) => {
      const c = canDoActivity(app.state, d.id, 'feed', f);
      return { id: f, ok: c.ok, reason: c.ok ? '' : c.reason ?? 'NOT RIGHT NOW', fav: f === fav, count: app.state.food[f] ?? 0 };
    });
  }

  function openStation(id: ActivityId, dragonId: string | null, fromCard: boolean): void {
    sfx('click');
    const group = new ButtonGroup();
    group.keyboard = false;
    const st: PanelState = {
      station: id, mode: 'dragons', dragonId: null, fromCard, rows: [], foods: [],
      dlist: null as unknown as ScrollList<DragonRow>, flist: null as unknown as ScrollList<FoodRow>,
      group, msg: '', msgT: 0,
    };
    st.rows = dragonRows(id);
    st.dlist = new ScrollList<DragonRow>({
      rect: LIST, rowH: 26, items: () => st.rows, drawRow: drawDragonRow,
      onSelect: () => sfx('click', { volume: 0.5 }),
      onActivate: (row) => pickDragon(row),
      empty: 'NO DRAGONS IN THE BURROW YET!',
    });
    st.flist = new ScrollList<FoodRow>({
      rect: { x: LIST.x, y: LIST.y, w: LIST.w, h: 26 * 5 }, rowH: 26, items: () => st.foods, drawRow: drawFoodRow,
      onSelect: () => sfx('click', { volume: 0.5 }),
      onActivate: (row) => pickFood(row),
    });
    group.add({
      label: 'GO!', rect: { x: P.x + P.w - 160, y: P.y + P.h - 32, w: 76, h: 22 }, color: UI.good,
      enabled: () => {
        if (!panel) return false;
        if (panel.mode === 'dragons') return !!panel.rows[panel.dlist.selected]?.ok;
        return !!panel.foods[panel.flist.selected]?.ok;
      },
      onClick: () => {
        if (!panel) return;
        if (panel.mode === 'dragons') { const r = panel.rows[panel.dlist.selected]; if (r) pickDragon(r); }
        else { const f = panel.foods[panel.flist.selected]; if (f) pickFood(f); }
      },
    });
    group.add({
      label: 'BACK', rect: { x: P.x + P.w - 78, y: P.y + P.h - 32, w: 70, h: 22 }, hotkey: 'Escape',
      onClick: () => panelBack(),
    });
    panel = st;
    mode = 'station';
    if (dragonId) {
      const d = findDragon(app.state, dragonId);
      if (d) enterFoods(d);
    }
  }

  function enterFoods(d: OwnedDragon): void {
    if (!panel) return;
    panel.mode = 'foods';
    panel.dragonId = d.id;
    panel.foods = foodRows(d);
    const fav = panel.foods.findIndex((f) => f.fav && f.ok);
    const first = panel.foods.findIndex((f) => f.ok);
    panel.flist.selected = fav >= 0 ? fav : Math.max(0, first);
    panel.msg = ''; panel.msgT = 0;
  }

  function panelBack(): void {
    if (!panel) return;
    sfx('back');
    if (panel.mode === 'foods' && !panel.fromCard) {
      panel.mode = 'dragons';
      panel.rows = dragonRows('feed');
      return;
    }
    const back = panel.fromCard ? panel.dragonId : null;
    panel = null;
    mode = 'hub';
    if (back) openCard(back);
  }

  function refuse(msg: string): void {
    sfx('error');
    if (panel) { panel.msg = msg; panel.msgT = 2; }
  }

  function pickDragon(row: DragonRow): void {
    if (!panel) return;
    if (!row.ok) { refuse(row.reason); return; }
    if (panel.station === 'feed') { sfx('select'); enterFoods(row.d); return; }
    startActivity(row.d.id, panel.station, null);
  }

  function pickFood(row: FoodRow): void {
    if (!panel || !panel.dragonId) return;
    if (!row.ok) { refuse(row.count <= 0 ? 'NONE LEFT. THE PANTRY SHOP SELLS MORE!' : row.reason); return; }
    startActivity(panel.dragonId, 'feed', row.id);
  }

  function updatePanel(input: Input): void {
    if (!panel) return;
    panel.msgT = Math.max(0, panel.msgT - 1 / 60);
    if (panel.mode === 'dragons') panel.dlist.update(input);
    else panel.flist.update(input);
    if (panel) {
      panel.group.update(input);
      // Enter picks the selected row, so the focus ring belongs on GO
      if (panel) panel.group.focus = 0;
    }
  }

  function miniDragon(ctx: Ctx, d: OwnedDragon, x: number, y: number, maxH: number): void {
    const v = dragonVisual(d);
    const s = Math.min(0.55, maxH / Math.max(1, dragonHeight(v, 1)));
    const fainted = isFainted(d);
    drawDragon(ctx, v, x, y, { scale: s, t: app.time + d.id.length, pose: fainted ? 'faint' : 'idle', poseT: fainted ? 0.58 : 0 });
  }

  function drawDragonRow(ctx: Ctx, row: DragonRow, r: Rect, sel: boolean, hov: boolean): void {
    drawSelection(ctx, r, sel, hov);
    const d = row.d;
    miniDragon(ctx, d, r.x + 15, r.y + r.h - 3, 20);
    const name = fit(dragonName(d).toUpperCase(), 84);
    drawText(ctx, name, r.x + COL.name, r.y + 4, { color: row.ok ? UI.text : UI.textDim, shadow: false });
    if (row.liked) drawText(ctx, '♥', r.x + COL.name + measureText(name) + 4, r.y + 4, { color: '#ff5a8a', shadowColor: UI.ink });
    drawText(ctx, 'LV ' + d.level, r.x + COL.name, r.y + 15, { color: UI.textDim, shadow: false });
    // slot pips after the level
    const left = Math.max(0, SLOTS_PER_DAY - d.slotsUsed);
    const px0 = r.x + COL.name + measureText('LV ' + d.level) + 5;
    for (let i = 0; i < SLOTS_PER_DAY; i++) {
      fillRoundRect(ctx, px0 + i * 7, r.y + 16, 5, 5, 1, UI.ink);
      ctx.fillStyle = i < left ? UI.gold : UI.disabled;
      ctx.fillRect(px0 + i * 7 + 1, r.y + 17, 3, 3);
    }
    const max = dragonStats(d).hp;
    const by = r.y + 10;
    drawBar(ctx, r.x + COL.hp, by, 40, 6, d.hp / max, hpColor(d.hp / max));
    drawBar(ctx, r.x + COL.full, by, 40, 6, d.needs.fullness / 100, NEED_COLORS.fullness);
    drawBar(ctx, r.x + COL.happy, by, 40, 6, d.needs.happiness / 100, NEED_COLORS.happiness);
    drawBar(ctx, r.x + COL.energy, by, 40, 6, d.needs.energy / 100, NEED_COLORS.energy);
    const sw = r.w - COL.status - 4;
    if (row.ok) {
      drawText(ctx, row.liked ? 'READY! LOVES IT' : 'READY!', r.x + COL.status, r.y + 9, { color: tint(UI.good, -0.35), shadow: false });
    } else {
      const lines = wrapText(row.reason, sw).slice(0, 2);
      lines.forEach((l, i) => drawText(ctx, l, r.x + COL.status, r.y + (lines.length === 1 ? 9 : 4 + i * 10), { color: UI.bad, shadow: false }));
    }
  }

  function drawFoodRow(ctx: Ctx, row: FoodRow, r: Rect, sel: boolean, hov: boolean): void {
    drawSelection(ctx, r, sel, hov);
    ctx.save();
    if (row.count <= 0) ctx.globalAlpha = 0.5;
    drawFoodIcon(ctx, row.id, r.x + 15, r.y + 13, 16);
    ctx.restore();
    const def = FOODS[row.id];
    drawText(ctx, def.name, r.x + COL.name, r.y + 4, { color: row.count > 0 ? UI.text : UI.textDim, shadow: false });
    if (row.fav) drawText(ctx, '♥', r.x + COL.name + measureText(def.name) + 4, r.y + 4, { color: '#ff5a8a', shadowColor: UI.ink });
    drawText(ctx, foodSummary(row.id, row.fav), r.x + COL.name, r.y + 15, { color: UI.textDim, shadow: false });
    drawText(ctx, 'X' + row.count, r.x + 236, r.y + 9, { color: row.count > 0 ? UI.text : UI.bad, shadow: false });
    const sx = r.x + 270, sw = r.w - 274;
    if (row.ok) {
      drawText(ctx, row.fav ? 'FAVOURITE! X2 HAPPY' : 'YUM!', sx, r.y + 9, { color: row.fav ? '#d83a72' : tint(UI.good, -0.35), shadow: false });
    } else {
      const reason = row.count <= 0 ? 'NONE LEFT' : row.reason;
      const lines = wrapText(reason, sw).slice(0, 2);
      lines.forEach((l, i) => drawText(ctx, l, sx, r.y + (lines.length === 1 ? 9 : 4 + i * 10), { color: UI.bad, shadow: false }));
    }
  }

  function drawStationPanel(ctx: Ctx): void {
    if (!panel) return;
    const st = panel;
    const a = ACTIVITIES[st.station];
    ctx.fillStyle = 'rgba(27, 20, 38, 0.45)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawPanel(ctx, P.x, P.y, P.w, P.h, { title: stationName(st.station) });
    const x = P.x + 12, w = P.w - 24;
    if (st.mode === 'dragons') {
      drawInset(ctx, x - 4, P.y + 12, w + 8, 52);
      drawActivityIcon(ctx, st.station, x + 12, P.y + 26, 20);
      const desc = wrapText(a.description, w - 34).slice(0, 2);
      desc.forEach((l, i) => drawText(ctx, l, x + 28, P.y + 17 + i * 10, { color: UI.text, shadow: false }));
      let cx = x + 2;
      for (const c of activityChips(st.station)) {
        const cw = measureText(c.text) + 8;
        if (cx + cw > x + w) break;
        cx += drawChip(ctx, c.text, cx, P.y + 39, c.color) + 3;
      }
      drawText(ctx, '♥ LOVED BY', x + 2, P.y + 55, { color: '#d83a72', shadow: false });
      drawTypeBadges(ctx, a.likedBy, x + 66, P.y + 53, { small: true });
      drawText(ctx, st.station === 'feed' ? '(FAVOURITE SNACK: X2 HAPPY)' : '(X2 HAPPY)', x + w - 2, P.y + 55, { align: 'right', color: UI.textDim, shadow: false });
      // column headers
      const hy = P.y + 69;
      const hx = LIST.x;
      drawText(ctx, 'DRAGON', hx + COL.name, hy, { color: UI.textDim, shadow: false });
      drawText(ctx, 'HP', hx + COL.hp, hy, { color: UI.textDim, shadow: false });
      drawText(ctx, 'FULL', hx + COL.full, hy, { color: tint(NEED_COLORS.fullness, -0.3), shadow: false });
      drawText(ctx, 'HAPPY', hx + COL.happy, hy, { color: tint(NEED_COLORS.happiness, -0.35), shadow: false });
      drawText(ctx, 'ENERGY', hx + COL.energy, hy, { color: tint(NEED_COLORS.energy, -0.35), shadow: false });
      drawText(ctx, 'READY?', hx + COL.status, hy, { color: UI.textDim, shadow: false });
      drawInset(ctx, LIST.x - 2, LIST.y - 2, LIST.w + 4, LIST.h + 4);
      st.dlist.draw(ctx);
    } else {
      const d = st.dragonId ? findDragon(app.state, st.dragonId) : undefined;
      drawInset(ctx, x - 4, P.y + 12, w + 8, 52);
      if (d) {
        drawDragon(ctx, dragonVisual(d), x + 22, P.y + 58, { scale: Math.min(0.9, 40 / dragonHeight(dragonVisual(d), 1)), t: app.time, pose: 'idle' });
        drawText(ctx, `WHAT SHOULD ${dragonName(d).toUpperCase()} EAT?`, x + 48, P.y + 19, { color: UI.text, shadow: false });
        drawText(ctx, 'FULL', x + 48, P.y + 33, { color: UI.textDim, shadow: false });
        drawBar(ctx, x + 80, P.y + 33, 90, 7, d.needs.fullness / 100, NEED_COLORS.fullness);
        drawText(ctx, 'HAPPY', x + 180, P.y + 33, { color: UI.textDim, shadow: false });
        drawBar(ctx, x + 214, P.y + 33, 90, 7, d.needs.happiness / 100, NEED_COLORS.happiness);
        const fav = getSpecies(d.speciesId).favoriteFood;
        drawText(ctx, `♥ FAVOURITE: ${FOODS[fav].name.toUpperCase()}`, x + 48, P.y + 47, { color: '#d83a72', shadow: false });
        drawText(ctx, 'NO SLOT USED', x + w - 4, P.y + 47, { align: 'right', color: UI.textDim, shadow: false });
      }
      const hy = P.y + 69;
      drawText(ctx, 'SNACK', LIST.x + COL.name, hy, { color: UI.textDim, shadow: false });
      drawText(ctx, 'HAVE', LIST.x + 230, hy, { color: UI.textDim, shadow: false });
      const fr = st.flist.rect;
      drawInset(ctx, fr.x - 2, fr.y - 2, fr.w + 4, fr.h + 4);
      st.flist.draw(ctx);
    }
    // footer: feedback or a key hint
    const fy = P.y + P.h - 25;
    if (st.msgT > 0) {
      const lines = wrapText(st.msg, P.w - 190).slice(0, 2);
      lines.forEach((l, i) => drawText(ctx, l, P.x + 12, fy - (lines.length - 1) * 5 + i * 10, { color: UI.bad, shadow: false }));
    } else {
      drawText(ctx, 'ARROWS + ENTER, OR CLICK AND GO!', P.x + 12, fy, { color: UI.textDim, shadow: false });
    }
    st.group.buttons[0].spec.label = st.mode === 'foods' ? 'FEED!' : st.station === 'feed' ? 'NEXT' : 'GO!';
    st.group.draw(ctx);
  }

  // ---------------------------------------------------------------------------------------------
  // Doing an activity: the vignette
  // ---------------------------------------------------------------------------------------------

  function startActivity(id: string, activity: ActivityId, food: FoodId | null): void {
    const d = findDragon(app.state, id);
    const w = walkers.get(id);
    if (!d || !w) return;
    const before = snapshot(d);
    const res = doActivity(app.state, id, activity, food ?? undefined);
    if (!res.ok) {
      sfx('error');
      if (panel) refuse(res.reason ?? 'NOT RIGHT NOW');
      else if (card) { card.msg = res.reason ?? 'NOT RIGHT NOW'; card.msgT = 1.6; }
      return;
    }
    app.save();
    sfx('select');
    panel = null;
    card = null;
    const to = actPoint(activity);
    const dist = Math.hypot(to.x - w.x, to.y - w.y);
    w.state = 'act';
    w.wiggle = 0;
    // everyone else makes room at the station
    for (const o of order) {
      if (o === w || (o.state !== 'idle' && o.state !== 'walk' && o.state !== 'hop')) continue;
      if (Math.abs(o.x - to.x) < 44 && Math.abs(o.y - to.y) < 30) {
        const p = randomFloor();
        if (Math.abs(p.x - to.x) < 70) p.x = to.x + (to.x < 320 ? 90 : -90);
        o.tx = p.x; o.ty = p.y; o.state = 'walk';
      }
    }
    vig = {
      id, activity, food, result: res, before, phase: 'walk', t: 0,
      walkDur: Math.max(0.3, Math.min(1.1, dist / 150)), fromX: w.x, fromY: w.y, balls: [], lootIcon: null,
    };
    if (activity === 'dig' && res.loot) {
      const it = ITEM_IDS.find((i) => res.loot?.items[i]);
      const fd = FOOD_IDS.find((f) => res.loot?.food[f]);
      if (it) vig.lootIcon = (c, x, y) => drawItemIcon(c, it, x, y, 16);
      else if (fd) vig.lootIcon = (c, x, y) => drawFoodIcon(c, fd, x, y, 16);
      else vig.lootIcon = (c, x, y) => drawCoinIcon(c, x, y, 7);
    }
    mode = 'vignette';
  }

  /** Did the vignette clock cross `k` this step? */
  const crossed = (prev: number, now: number, k: number): boolean => prev < k && now >= k;

  function updateVignette(input: Input, dt: number): void {
    if (!vig) return;
    const v = vig;
    const w = walkers.get(v.id);
    if (!w) { finishVignette(); return; }
    if (input.confirm() || input.back() || input.pointer.pressed) { finishVignette(); return; }
    const prev = v.t;
    v.t += dt;
    const to = actPoint(v.activity);
    if (v.phase === 'walk') {
      const u = Math.min(1, v.t / v.walkDur);
      w.x = v.fromX + (to.x - v.fromX) * u;
      w.y = v.fromY + (to.y - v.fromY) * u;
      if (Math.abs(to.x - v.fromX) > 1) w.facing = to.x > v.fromX ? 1 : -1;
      if (u >= 1) {
        v.phase = 'act'; v.t = 0; w.facing = to.facing;
        if (v.activity === 'play') {
          const cols = ['#ff5a6a', '#ffd24a', '#4aa8ff', '#6ad46a', '#ff8ad8', '#ff9a3a'];
          for (let i = 0; i < 6; i++) {
            v.balls.push({ x: to.x - 34 + Math.random() * 68, y: pitTop() - 2, vx: (Math.random() - 0.5) * 70, vy: -50 - Math.random() * 70, color: cols[i % cols.length] });
          }
        }
      }
      return;
    }
    const t = v.t;
    const head = { x: w.x + w.facing * 6, y: w.y - w.h * 0.55 };
    switch (v.activity) {
      case 'feed':
        for (const k of [0.25, 0.85, 1.45]) if (crossed(prev, t, k)) { sfx('eat'); fx.burst(head.x + w.facing * 8, head.y + 8, '#e8d4a0', 5); }
        if (crossed(prev, t, 2.0)) {
          const fav = v.food !== null && getSpecies(findDragon(app.state, v.id)?.speciesId ?? '').favoriteFood === v.food;
          fx.floatText(head.x, head.y - 14, fav ? 'FAVOURITE!' : 'NOM NOM!', fav ? '#ff7eb0' : '#ffe9a8');
          if (fav) fx.burst(head.x, head.y - 4, '#ff7eb0', 10);
          sfx('sparkle', { volume: 0.6 });
        }
        break;
      case 'wheel':
        for (const k of [0.05, 0.85, 1.65]) if (crossed(prev, t, k)) sfx('wheel');
        if (crossed(prev, t, 2.0)) { fx.floatText(w.x, w.y - w.h - 18, 'ZOOM!', '#bfe8ff'); sfx('statUp', { volume: 0.6 }); }
        break;
      case 'dig':
        for (const k of [0.1, 0.6, 1.1]) if (crossed(prev, t, k)) { sfx('dig'); fx.burst(w.x + w.facing * 12, w.y - 4, '#8a5a34', 6); }
        if (crossed(prev, t, 1.5)) {
          const shiny = !!v.result.loot && (Object.keys(v.result.loot.items).length > 0 || Object.keys(v.result.loot.food).length > 0);
          sfx(shiny ? 'sparkle' : 'coin');
          fx.burst(w.x + w.facing * 14, w.y - 14, UI.gold, shiny ? 16 : 9);
        }
        break;
      case 'nap':
        for (const k of [0.3, 1.5]) if (crossed(prev, t, k)) sfx('snore');
        if (crossed(prev, t, 2.1)) {
          if (v.before.hp < v.before.maxHp || v.before.status) { sfx('heal'); fx.move('heal', { x: w.x, y: w.y - w.h / 2 }, { x: w.x, y: w.y - w.h / 2 }, 'LEAF'); }
          else sfx('sparkle', { volume: 0.6 });
        }
        break;
      case 'play':
        for (const k of [0.15, 0.7, 1.25, 1.8]) if (crossed(prev, t, k)) {
          sfx('fluff', { pitch: 1 + Math.random() * 0.3 });
          const cols = ['#ff5a6a', '#ffd24a', '#4aa8ff', '#6ad46a'];
          v.balls.push({ x: w.x + (Math.random() - 0.5) * 40, y: pitTop() - 2, vx: (Math.random() - 0.5) * 80, vy: -95 - Math.random() * 40, color: cols[Math.floor(Math.random() * 4)] });
        }
        if (crossed(prev, t, 2.1)) { sfx('sparkle'); fx.burst(w.x, w.y - w.h, '#ff7eb0', 10); }
        break;
      default: break;
    }
    // ball pit physics
    const floorY = pitTop() - 2;
    for (const b of v.balls) {
      b.vy += 300 * dt; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y > floorY) { b.y = floorY; b.vy = -Math.abs(b.vy) * 0.72; if (Math.abs(b.vy) < 40) b.vy = -60 - Math.random() * 60; }
      const box = STATIONS.play;
      if (b.x < box.x + 12 || b.x > box.x + box.w - 22) b.vx = -b.vx;
    }
    if (t >= ACT_TIME) finishVignette();
  }

  function finishVignette(): void {
    if (!vig) return;
    const v = vig;
    vig = null;
    const w = walkers.get(v.id);
    const to = actPoint(v.activity);
    if (w) {
      const out = exitPoint(v.activity);
      w.x = out.x; w.y = out.y; w.facing = to.facing;
      w.state = 'hop'; w.timer = 0.8;
    }
    openResult(v);
  }

  function drawVignetteExtras(ctx: Ctx): void {
    if (!vig || vig.phase !== 'act') return;
    const v = vig;
    const w = walkers.get(v.id);
    if (!w) return;
    const t = v.t;
    if (v.activity === 'feed' && v.food) {
      // the snack, nibbled away bite by bite at the mouth
      const bites = (t > 0.25 ? 1 : 0) + (t > 0.85 ? 1 : 0) + (t > 1.45 ? 1 : 0);
      if (bites < 3) {
        const s = Math.round(14 - bites * 3);
        const mx = w.x + w.facing * Math.round(w.h * 0.42), my = w.y - Math.round(w.h * 0.36) + Math.round(Math.sin(t * 14));
        drawFoodIcon(ctx, v.food, mx, my, s);
      }
    } else if (v.activity === 'wheel') {
      // speed lines behind the runner
      for (let i = 0; i < 4; i++) {
        const k = (t * 3 + i * 0.25) % 1;
        const lx = Math.round(w.x - w.facing * (14 + k * 18)), ly = Math.round(w.y - 8 - i * 7);
        ctx.fillStyle = `rgba(255,255,255,${(0.7 * (1 - k)).toFixed(2)})`;
        ctx.fillRect(w.facing > 0 ? lx - 8 : lx, ly, 8, 1);
      }
    } else if (v.activity === 'dig' && v.lootIcon && t > 1.5) {
      // the find pops out of the dirt and hovers with a glint
      const k = Math.min(1, (t - 1.5) / 0.35);
      const lx = w.x + w.facing * 16, ly = w.y - 10 - 26 * (1 - (1 - k) * (1 - k)) + Math.sin(t * 6) * 1.5;
      v.lootIcon(ctx, Math.round(lx), Math.round(ly));
      const g = 0.5 + 0.5 * Math.sin(t * 10);
      ctx.fillStyle = `rgba(255,255,255,${(0.9 * g).toFixed(2)})`;
      ctx.fillRect(Math.round(lx) + 5, Math.round(ly) - 9, 1, 5);
      ctx.fillRect(Math.round(lx) + 3, Math.round(ly) - 7, 5, 1);
    }
    if (v.activity === 'play') drawBalls(ctx, v, 1);
  }

  /** Ball pit balls; parity 0 are drawn behind the bouncing dragon, parity 1 in front of it. */
  function drawBalls(ctx: Ctx, v: Vignette, parity: number): void {
    for (let i = parity; i < v.balls.length; i += 2) {
      const b = v.balls[i];
      ctx.fillStyle = UI.ink;
      ctx.beginPath(); ctx.arc(Math.round(b.x), Math.round(b.y), 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(Math.round(b.x), Math.round(b.y), 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(Math.round(b.x) - 2, Math.round(b.y) - 2, 2, 1);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Result card
  // ---------------------------------------------------------------------------------------------

  function openResult(v: Vignette): void {
    const d = findDragon(app.state, v.id);
    if (!d) { mode = 'hub'; return; }
    const res = v.result;
    const a = ACTIVITIES[v.activity];
    const name = dragonName(d).toUpperCase();
    const rows: ResultRow[] = [];
    // why it was extra fun
    if (v.activity === 'feed' && v.food && getSpecies(d.speciesId).favoriteFood === v.food) {
      rows.push(textRow(`${FOODS[v.food].name} is ${name}'s favourite! X2 happiness`, '#d83a72', iconHeart, 'sparkle'));
    } else if (v.activity !== 'feed' && likesActivity(d, v.activity) && a.happiness > 0) {
      rows.push(textRow(`${name} LOVES the ${a.name}! X2 happiness`, '#d83a72', iconHeart, 'sparkle'));
    }
    // needs
    const chips: { text: string; color: string }[] = [];
    const dn = (k: 'fullness' | 'happiness' | 'energy'): number => d.needs[k] - v.before.needs[k];
    const sign = (n: number): string => (n > 0 ? '+' : '') + n;
    if (dn('fullness')) chips.push({ text: 'FULL ' + sign(dn('fullness')), color: NEED_COLORS.fullness });
    if (dn('happiness')) chips.push({ text: 'HAPPY ' + sign(dn('happiness')), color: NEED_COLORS.happiness });
    if (dn('energy')) chips.push({ text: 'ENERGY ' + sign(dn('energy')), color: NEED_COLORS.energy });
    if (chips.length) rows.push({ kind: 'chips', lines: [], color: UI.text, icon: null, chips, sound: 'select', h: 15 });
    // nap
    if (v.activity === 'nap') {
      if (d.hp > v.before.hp) rows.push(textRow('HP fully restored!', tint(UI.good, -0.35), iconPlus, 'heal'));
      if (v.before.status && !d.status) rows.push(textRow(`No longer ${STATUS_NAMES[v.before.status]}!`, tint(UI.good, -0.35), iconPlus, 'heal'));
    }
    // training
    if (res.training) {
      const gains = STAT_IDS.filter((s) => (res.training?.[s] ?? 0) > 0);
      for (const s of gains) rows.push(textRow(`+${res.training[s]} ${STAT_NAMES[s]} TRAINING`, tint(STAT_COLORS[s], -0.35), iconArrow(STAT_COLORS[s]), 'statUp'));
      if (!gains.length) rows.push(textRow('This training is maxed out!', UI.textDim, iconStar, 'select'));
    }
    // loot
    if (res.loot) {
      rows.push(textRow(`+${res.loot.coins} coins`, UI.goldDark, (c, x, y) => drawCoinIcon(c, x, y, 5), 'coin'));
      for (const f of FOOD_IDS) if (res.loot.food[f]) rows.push(textRow(`+${res.loot.food[f]} ${FOODS[f].name}`, UI.text, (c, x, y) => drawFoodIcon(c, f, x, y, 12), 'sparkle'));
      for (const it of ITEM_IDS) if (res.loot.items[it]) rows.push(textRow(`+${res.loot.items[it]} ${ITEMS[it].name}! Something shiny!`, UI.text, (c, x, y) => drawItemIcon(c, it, x, y, 12), 'sparkle'));
    }
    // XP, levels, moves, evolution
    let xp: ResultState['xp'] = null;
    if (res.xp && res.xp.xp > 0) {
      const r = res.xp;
      rows.push({ kind: 'xp', lines: [`+${r.xp} XP`], color: UI.text, icon: null, chips: [], sound: 'select', h: 13 });
      xp = { from: v.before.xpFrac, to: xpProgress(d).frac, levels: r.levelsGained, startLevel: v.before.level };
      if (r.levelsGained.length) rows.push(textRow(`Level up! ${name} is now LV ${r.levelsGained[r.levelsGained.length - 1]}!`, UI.goldDark, iconStar, 'levelUp'));
      for (const m of r.learned) {
        const mv = getMove(m).name.toUpperCase();
        rows.push(textRow(d.moves.includes(m) ? `Learned ${mv}!` : `Learned ${mv}! Equip it in DRAGONS.`, '#3a7ad0', iconStar, 'statUp'));
      }
      if (r.evolveTo) rows.push(textRow(`Huh? ${name} is starting to glow!`, UI.goldDark, iconStar, 'sparkle'));
    }
    const flavour = wrapText((res.lines[0] ?? '').toUpperCase(), ROW_TEXT_W);
    const rowsH = rows.reduce((s, r) => s + r.h, 0);
    const w = 362;
    const h = Math.max(150, 16 + flavour.length * 10 + 8 + rowsH + 40);
    const rect = { x: Math.round((VIEW_W - w) / 2), y: Math.max(HUD_H + 10, Math.round((VIEW_H - h) / 2)), w, h };
    const group = new ButtonGroup();
    group.add({
      label: 'OK!', rect: { x: rect.x + w - 84, y: rect.y + h - 30, w: 72, h: 22 }, color: UI.good, hotkey: 'Escape',
      onClick: () => closeResult(),
    });
    result = {
      id: v.id, activity: v.activity, title: stationName(v.activity), flavour, rows, t: 0, shown: 0, rect, group,
      evolveTo: res.xp?.evolveTo ?? null, xp,
    };
    mode = 'result';
  }

  function closeResult(): void {
    if (!result) return;
    const r = result;
    sfx('click');
    result = null;
    mode = 'hub';
    if (r.evolveTo) app.nav.evolve(r.id, () => { sync(); });
  }

  const REVEAL_START = 0.3, REVEAL_STEP = 0.2;

  function updateResult(input: Input, dt: number): void {
    if (!result) return;
    const r = result;
    r.t += dt;
    const target = Math.min(r.rows.length, Math.max(0, Math.floor((r.t - REVEAL_START) / REVEAL_STEP) + 1));
    while (r.shown < target) {
      const row = r.rows[r.shown++];
      sfx(row.sound, { volume: 0.8 });
    }
    if (r.shown < r.rows.length && (input.confirm() || input.pointer.pressed || input.back())) {
      r.shown = r.rows.length;
      r.t = Math.max(r.t, REVEAL_START + r.rows.length * REVEAL_STEP + 1);
      return;
    }
    r.group.update(input);
  }

  function drawResult(ctx: Ctx): void {
    if (!result) return;
    const r = result;
    const d = findDragon(app.state, r.id);
    if (!d) return;
    ctx.fillStyle = 'rgba(27, 20, 38, 0.55)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const { x, y, w, h } = r.rect;
    const pop = Math.min(1, r.t / 0.18);
    const off = Math.round((1 - pop) * 10);
    drawPanel(ctx, x, y + off, w, h, { title: r.title, fill: UI.panelLight });
    const yy = y + off;
    // portrait
    drawInset(ctx, x + 10, yy + 14, 92, 104, { fill: '#e8d0a8' });
    const v = dragonVisual(d);
    const s = Math.min(1.4, 64 / Math.max(1, dragonHeight(v, 1)));
    drawDragon(ctx, v, x + 56, yy + 100, { scale: s, t: app.time, pose: 'happy' });
    const name = fit(dragonName(d).toUpperCase(), 86);
    drawText(ctx, name, x + 56, yy + 106, { align: 'center', color: UI.text, shadow: false });
    // flavour + rows
    const rx = x + 112;
    let cy = yy + 14;
    for (const l of r.flavour) { drawText(ctx, l, rx, cy, { color: UI.text, shadow: false }); cy += 10; }
    cy += 3;
    ctx.fillStyle = tint(UI.panelLight, -0.14);
    ctx.fillRect(rx, cy, ROW_TEXT_W, 1);
    cy += 5;
    for (let i = 0; i < r.shown; i++) {
      const row = r.rows[i];
      const age = r.t - (REVEAL_START + i * REVEAL_STEP);
      const slide = Math.max(0, Math.round((1 - Math.min(1, age / 0.15)) * 8));
      if (row.kind === 'chips') {
        let cx = rx + slide;
        for (const c of row.chips) cx += drawChip(ctx, c.text, cx, cy, c.color) + 3;
      } else if (row.kind === 'xp' && r.xp) {
        drawText(ctx, row.lines[0], rx + slide, cy + 2, { color: '#3a7ad0', shadow: false });
        const k = Math.min(1, Math.max(0, age / 0.9));
        const levels = r.xp.levels.length;
        let frac: number, lv: number;
        if (!levels) { frac = r.xp.from + (r.xp.to - r.xp.from) * k; lv = r.xp.startLevel; }
        else if (k < 0.5) { frac = r.xp.from + (1 - r.xp.from) * (k / 0.5); lv = r.xp.startLevel; }
        else { frac = r.xp.to * ((k - 0.5) / 0.5); lv = r.xp.levels[levels - 1]; }
        const bx = rx + 70;
        drawText(ctx, 'LV ' + lv, bx, cy + 2, { color: UI.textDim, shadow: false });
        drawBar(ctx, bx + 36, cy + 2, ROW_TEXT_W - 106, 7, frac, '#4f9be0');
      } else {
        if (row.icon) row.icon(ctx, rx + 5 + slide, cy + 4);
        row.lines.forEach((l, j) => drawText(ctx, l, rx + 15 + slide, cy + j * 10, { color: row.color, shadow: false }));
      }
      cy += row.h;
    }
    if (r.shown >= r.rows.length) r.group.draw(ctx);
    else drawText(ctx, 'CLICK TO SKIP', x + w - 12, yy + h - 22, { align: 'right', color: UI.textDim, shadow: false });
  }

  // ---------------------------------------------------------------------------------------------
  // Sleep and the night
  // ---------------------------------------------------------------------------------------------

  function askSleep(): void {
    const tired = app.state.dragons.filter((d) => d.slotsUsed < SLOTS_PER_DAY && !isFainted(d)).length;
    const text = tired
      ? `Tuck everyone in and sleep until tomorrow? ${tired === 1 ? '1 dragon still has' : tired + ' dragons still have'} activity slots left today.`
      : 'Tuck everyone in and sleep until tomorrow?';
    app.nav.confirm(text, () => startNight());
  }

  function startNight(): void {
    const oldDay = app.state.day;
    const report = endDay(app.state);
    app.save();
    night = { t: 0, report, oldDay, dawnPlayed: false, snores: 0 };
    card = null; panel = null;
    mode = 'night';
    music(null);
    for (const w of order) {
      if (w.state === 'act' || w.state === 'held') w.state = 'idle';
    }
  }

  function updateNight(input: Input, dt: number): void {
    if (!night) return;
    const n = night;
    const prev = n.t;
    n.t += dt;
    if (crossed(prev, n.t, 0.9) || crossed(prev, n.t, 1.9)) sfx('snore', { volume: 0.8 });
    if (!n.dawnPlayed && n.t >= NIGHT_HOLD + 0.4) {
      n.dawnPlayed = true;
      sfx('sparkle');
      music('burrow');
    }
    if ((input.confirm() || input.pointer.pressed || input.back()) && n.t < NIGHT_HOLD) n.t = NIGHT_HOLD;
    if (n.t >= NIGHT_END) {
      night = null;
      mode = 'hub';
      if (!n.dawnPlayed) music('burrow');
      // everyone wakes up: overjoyed ones bounce
      for (const w of order) if (w.state === 'idle' || w.state === 'hop') { w.state = 'hop'; w.timer = 0.6 + Math.random() * 0.8; }
      app.nav.dialog(n.report.lines);
    }
  }

  function starAt(i: number): { x: number; y: number; s: number } {
    const h = (k: number): number => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
    return { x: Math.round(16 + h(1) * 608), y: Math.round(32 + h(2) * 190), s: h(3) };
  }

  function drawNight(ctx: Ctx): void {
    if (!night) return;
    const t = night.t;
    let dark: number;
    if (t < NIGHT_DARK) dark = t / NIGHT_DARK;
    else if (t < NIGHT_HOLD) dark = 1;
    else dark = Math.max(0, 1 - (t - NIGHT_HOLD) / (NIGHT_DAWN - NIGHT_HOLD));
    if (dark > 0) {
      ctx.save();
      ctx.globalAlpha = 0.84 * dark;
      ctx.fillStyle = '#0b0a26';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
      // stars twinkle across the dark ceiling and a moon fills the window
      for (let i = 0; i < 46; i++) {
        const s = starAt(i);
        const tw = 0.5 + 0.5 * Math.sin(t * (2 + s.s * 3) + i);
        ctx.fillStyle = `rgba(255, 244, 200, ${(dark * (0.35 + 0.65 * tw)).toFixed(2)})`;
        ctx.fillRect(s.x, s.y, 1, 1);
        if (s.s > 0.8) { ctx.fillRect(s.x - 1, s.y, 3, 1); ctx.fillRect(s.x, s.y - 1, 1, 3); }
      }
      ctx.save();
      ctx.globalAlpha = dark;
      ctx.fillStyle = '#161848';
      ctx.beginPath(); ctx.arc(320, 86, 23, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff4cc';
      ctx.beginPath(); ctx.arc(326, 80, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#161848';
      ctx.beginPath(); ctx.arc(330, 77, 8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // dawn: golden light pours in through the window and warms the whole burrow
    if (t > NIGHT_HOLD) {
      const k = Math.min(1, (t - NIGHT_HOLD) / (NIGHT_END - NIGHT_HOLD));
      const glowA = Math.sin(k * Math.PI);
      if (glowA > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = glowA * 0.16;
        ctx.fillStyle = '#ff9a3a';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        const rays = ctx.createRadialGradient(320, 86, 16, 320, 86, 250);
        rays.addColorStop(0, 'rgba(255, 220, 150, 0.55)');
        rays.addColorStop(1, 'rgba(255, 220, 150, 0)');
        ctx.fillStyle = rays;
        ctx.globalAlpha = glowA;
        const RAYS = [[-0.5, 0.06], [-0.22, 0.04], [0.04, 0.08], [0.3, 0.05], [0.52, 0.035]];
        for (const [i, [a0, wd]] of RAYS.entries()) {
          const a = a0 + Math.sin(t * 0.8 + i) * 0.02;
          ctx.beginPath();
          ctx.moveTo(320, 86);
          ctx.lineTo(320 + Math.sin(a - wd) * 300, 86 + Math.cos(a - wd) * 300);
          ctx.lineTo(320 + Math.sin(a + wd) * 300, 86 + Math.cos(a + wd) * 300);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    }
    // captions
    const cap = (text: string, sub: string, a: number, color: string): void => {
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha = Math.min(1, a);
      const tw = Math.max(measureText(text, 2), measureText(sub));
      fillRoundRect(ctx, Math.round(320 - tw / 2 - 14), 130, tw + 28, 44, 5, 'rgba(27, 20, 38, 0.72)');
      drawText(ctx, text, 320, 138, { size: 2, align: 'center', color, shadowColor: UI.ink });
      drawText(ctx, sub, 320, 160, { align: 'center', color: UI.textLightDim, shadowColor: UI.ink });
      ctx.restore();
    };
    const fadeIn = (a: number, b: number): number => Math.max(0, Math.min(1, (t - a) / 0.3, (b - t) / 0.3));
    cap('GOOD NIGHT, BURROW!', 'ZZZ... SHHH. EVERYONE IS SLEEPING.', fadeIn(0.7, NIGHT_HOLD), '#c8c8ff');
    cap(`DAY ${night.report.day}`, 'RISE AND SHINE, AGENTS!', fadeIn(NIGHT_HOLD + 0.4, NIGHT_END), UI.goldLight);
  }

  // ---------------------------------------------------------------------------------------------
  // Drawing the burrow
  // ---------------------------------------------------------------------------------------------

  function drawThought(ctx: Ctx, w: Walker, starving: boolean): void {
    const bob = Math.round(Math.sin(app.time * 2.2 + w.phase) * 1.5);
    const bx = Math.round(w.x + w.facing * 10), by = Math.round(w.y - w.h - 16 + bob);
    // trailing puffs
    ctx.fillStyle = UI.ink;
    ctx.fillRect(Math.round(w.x + w.facing * 4) - 2, by + 12, 4, 4);
    ctx.fillRect(Math.round(w.x + w.facing * 7) - 2, by + 8, 5, 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(w.x + w.facing * 4) - 1, by + 13, 2, 2);
    ctx.fillRect(Math.round(w.x + w.facing * 7) - 1, by + 9, 3, 3);
    fillRoundRect(ctx, bx - 10, by - 9, 20, 16, 5, UI.ink);
    fillRoundRect(ctx, bx - 9, by - 8, 18, 14, 4, '#ffffff');
    drawFoodIcon(ctx, 'seeds', bx, by - 1, 10);
    if (starving) drawText(ctx, '!', bx + 10, by - 12, { color: UI.bad, shadowColor: UI.ink });
  }

  function drawWalker(ctx: Ctx, w: Walker, d: OwnedDragon): void {
    const v = dragonVisual(d);
    const { pose, poseT } = walkerPose(w);
    const clip = vig && vig.id === w.id && vig.phase === 'act' && vig.activity === 'play';
    if (clip) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, VIEW_W, pitTop() + 1); ctx.clip();
    }
    const bounce = clip ? -Math.abs(Math.sin((vig as Vignette).t * 5)) * 12 : 0;
    drawDragon(ctx, v, Math.round(w.x), Math.round(w.y + bounce), { scale: DRAGON_SCALE, facing: w.facing, t: app.time + w.phase, pose, poseT });
    if (clip) ctx.restore();
    if (pose === 'faint') {
      // little stars circle a knocked-out dragon
      const cx = Math.round(w.x - w.facing * 4), cy = Math.round(w.y - w.h * 0.45);
      for (let i = 0; i < 3; i++) {
        const a = app.time * 3 + (i / 3) * Math.PI * 2 + w.phase;
        const sx = Math.round(cx + Math.cos(a) * 11), sy = Math.round(cy + Math.sin(a) * 3);
        ctx.fillStyle = UI.ink; ctx.fillRect(sx - 2, sy - 1, 5, 3); ctx.fillRect(sx - 1, sy - 2, 3, 5);
        ctx.fillStyle = UI.gold; ctx.fillRect(sx - 1, sy, 3, 1); ctx.fillRect(sx, sy - 1, 1, 3);
      }
    }
  }

  function drawFocusTag(ctx: Ctx, w: Walker, d: OwnedDragon): void {
    const name = dragonName(d).toUpperCase();
    const lying = w.state === 'sleep' || w.state === 'faint';
    const top = Math.round(w.y - (lying ? w.h * 0.7 : w.h));
    const tw = measureText(name) + 12;
    const bob = Math.round(Math.sin(app.time * 5) * 1.5);
    let px = Math.round(w.x - tw / 2);
    px = Math.max(4, Math.min(VIEW_W - tw - 4, px));
    const py = Math.max(HUD_H + 2, top - 30 + bob);
    drawPlaque(ctx, name, px, py, { fill: UI.night });
    const ax = Math.round(w.x), ay = py + 16;
    ctx.fillStyle = UI.ink;
    ctx.fillRect(ax - 5, ay, 11, 2); ctx.fillRect(ax - 4, ay + 2, 9, 1); ctx.fillRect(ax - 3, ay + 3, 7, 1); ctx.fillRect(ax - 2, ay + 4, 5, 1); ctx.fillRect(ax - 1, ay + 5, 3, 1);
    ctx.fillStyle = UI.focus;
    ctx.fillRect(ax - 4, ay, 9, 1); ctx.fillRect(ax - 3, ay + 1, 7, 1); ctx.fillRect(ax - 2, ay + 2, 5, 1); ctx.fillRect(ax - 1, ay + 3, 3, 1);
  }

  function drawHud(ctx: Ctx): void {
    const day = night && night.t < NIGHT_HOLD + 0.5 ? night.oldDay : app.state.day;
    const dw = drawPlaque(ctx, `DAY ${day}`, 6, 7);
    const cw = drawCoins(ctx, shownCoins, 6 + dw + 5, 7);
    if (coinFlash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, coinFlash * 2) * 0.5;
      fillRoundRect(ctx, 6 + dw + 5, 7, cw, 13, 3, '#ffffff');
      ctx.restore();
    }
    // the first case nags with a soft pulse until it is cleared
    const nag = nagging();
    const missions = hudButtons[0];
    if (nag) {
      // the button breathes (quantised so the colour cache stays small) and glows
      const pulse = Math.round((0.5 + 0.5 * Math.sin(app.time * 4)) * 6) / 6;
      missions.spec.color = tint(UI.accent, 0.35 * pulse);
      const b = missions.spec.rect;
      ctx.save();
      ctx.globalAlpha = 0.2 + 0.4 * pulse;
      fillRoundRect(ctx, b.x - 4, b.y - 3, b.w + 8, b.h + 7, 5, '#ffb070');
      ctx.restore();
    } else {
      missions.spec.color = UI.accent;
    }
    hub.draw(ctx);
    if (nag) {
      const b = missions.spec.rect;
      const hop = Math.round(Math.abs(Math.sin(app.time * 4)) * -2);
      const bx = b.x - 5, by = b.y - 1 + hop;
      fillRoundRect(ctx, bx, by, 10, 11, 3, UI.ink);
      fillRoundRect(ctx, bx + 1, by + 1, 8, 9, 2, UI.bad);
      drawText(ctx, '!', bx + 3, by + 2, { color: '#ffffff', shadow: false });
    }
  }

  function hintText(): string {
    if (!app.state.dragons.length) return 'The burrow is empty! Finish a mission to bring dragons home.';
    const f = hub.focused;
    const hovering = !!f && f.hovered;
    const keyed = app.time - navT < 5;
    if (f && (hovering || keyed)) {
      if (f instanceof Hotspot) {
        if (f.kind === 'station') {
          const id = f.ref as ActivityId;
          return `${stationName(id)} [${STATION_ORDER.indexOf(id) + 1}]: ${ACTIVITIES[id].description}`;
        }
        const d = findDragon(app.state, f.ref);
        if (d) {
          const left = Math.max(0, SLOTS_PER_DAY - d.slotsUsed);
          return `${dragonName(d)}, LV ${d.level}: ${moodLine(d)}. ${left} activity ${left === 1 ? 'slot' : 'slots'} left today. Click for details.`;
        }
      } else {
        return HUD_HINTS[f.spec.label] ?? '';
      }
    }
    return TIPS[Math.floor(app.time / 7) % TIPS.length];
  }

  function drawHint(ctx: Ctx): void {
    const text = hintText();
    if (!text) return;
    const lines = wrapText(text.toUpperCase(), 600).slice(0, 2);
    fillRoundRect(ctx, 10, 318, VIEW_W - 20, 32, 4, 'rgba(18, 10, 8, 0.45)');
    const y0 = lines.length === 1 ? 330 : 324;
    lines.forEach((l, i) => drawText(ctx, l, VIEW_W / 2, y0 + i * 10, { align: 'center', color: '#ecd9b4', shadowColor: '#120a06' }));
  }

  function drawScene(ctx: Ctx): void {
    const t = app.time;
    drawBurrow(ctx, t);
    const focused = mode === 'hub' ? hub.focused : null;
    for (const id of ACTIVITY_IDS) {
      const hl = (focused instanceof Hotspot && focused.kind === 'station' && focused.ref === id) || (mode === 'station' && panel?.station === id);
      drawStation(ctx, id, t, { highlight: hl, busy: !!vig && vig.activity === id && vig.phase === 'act' });
    }
    STATION_ORDER.forEach((id, i) => {
      const s = signLeft(id);
      drawKeycap(ctx, String(i + 1), s.x - 12, s.y);
    });
    // dragons, back to front
    const sorted = [...order].sort((a, b) => a.y - b.y);
    const actor = vig ? vig.id : null;
    for (const w of sorted) {
      const d = findDragon(app.state, w.id);
      if (d && w.id !== actor) drawWalker(ctx, w, d);
    }
    // the dragon doing an activity is the star of the show: always in front
    if (actor) {
      const w = walkers.get(actor), d = findDragon(app.state, actor);
      if (vig && vig.phase === 'act' && vig.activity === 'play') drawBalls(ctx, vig, 0);
      if (w && d) drawWalker(ctx, w, d);
    }
    drawVignetteExtras(ctx);
    // thought bubbles for hungry dragons (not while asleep or busy)
    if (!night) {
      for (const w of sorted) {
        const d = findDragon(app.state, w.id);
        if (!d || d.needs.fullness > HUNGRY_AT || w.state === 'sleep' || w.state === 'faint' || w.state === 'act' || w.state === 'toNest' || w.state === 'held') continue;
        const starving = d.needs.fullness <= 0;
        if (starving || (app.time + w.phase * 3) % 6 < 4) drawThought(ctx, w, starving);
      }
    }
    if (focused instanceof Hotspot && focused.kind === 'dragon') {
      const w = walkers.get(focused.ref);
      const d = findDragon(app.state, focused.ref);
      if (w && d) drawFocusTag(ctx, w, d);
    }
    fx.draw(ctx);
    drawHud(ctx);
    drawHint(ctx);
  }

  // ---------------------------------------------------------------------------------------------
  // Scene
  // ---------------------------------------------------------------------------------------------

  buildHud();
  sync();

  /** For tools/playtest.ts and the dev harness: where everyone is and what the hub is doing. */
  function publishDebug(): void {
    app.debug.burrow = {
      mode: () => mode,
      dragon: (id: string) => {
        const w = walkers.get(id);
        return w ? { x: Math.round(w.x), y: Math.round(w.y), h: w.h, state: w.state } : null;
      },
      station: (id: ActivityId) => stationCentre(id),
    };
  }

  function refresh(): void {
    sync();
    for (const w of order) if (w.state === 'held' || w.state === 'act') { w.state = 'idle'; w.timer = 0.5; }
  }

  return {
    name: 'burrow',
    enter() {
      setSound(app.state.settings.sound);
      setMusic(app.state.settings.music);
      music('burrow');
      shownCoins = app.state.coins;
      refresh();
      publishDebug();
    },
    resume() {
      music('burrow');
      refresh();
      if (mode !== 'night') { mode = 'hub'; card = null; panel = null; }
    },
    update(dt, input) {
      sync();
      fx.update(dt);
      // HUD coin counter rolls toward the real amount
      // during a dig the coins wait for the moment the treasure pops out of the dirt
      const holdCoins = !!vig && !(vig.activity === 'dig' && vig.phase === 'act' && vig.t >= 1.5);
      if (shownCoins !== app.state.coins && !holdCoins) {
        const diff = app.state.coins - shownCoins;
        shownCoins += Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * 0.12));
        if (Math.sign(app.state.coins - shownCoins) !== Math.sign(diff)) shownCoins = app.state.coins;
        coinFlash = 0.4;
      }
      coinFlash = Math.max(0, coinFlash - dt);
      for (const w of order) {
        const d = findDragon(app.state, w.id);
        if (!d) continue;
        if (!night || night.t >= NIGHT_DAWN - 0.3) thinkWalker(w, d, dt);
        updateHotspot(w, d);
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].some((k) => input.pressed(k))) navT = app.time;
      switch (mode) {
        case 'hub':
          if (!tutorialAsked && !app.state.flags.burrowTutorial && !app.scenes.busy) {
            tutorialAsked = true;
            app.nav.dialog(TUTORIAL, () => { app.state.flags.burrowTutorial = true; app.save(); }, 'chief');
            return;
          }
          hub.update(input);
          break;
        case 'card': updateCard(input); break;
        case 'station': updatePanel(input); break;
        case 'vignette': updateVignette(input, dt); break;
        case 'result': updateResult(input, dt); break;
        case 'night': updateNight(input, dt); break;
      }
    },
    draw(ctx) {
      drawScene(ctx);
      if (mode === 'card') drawCard(ctx);
      if (mode === 'station') drawStationPanel(ctx);
      if (mode === 'result') drawResult(ctx);
      if (night) drawNight(ctx);
    },
  };
}
