// UI kit gallery (dev/ui.html): every widget, all 16 type badges and emblems, every icon, effect
// tags, bars, a ScrollList and interactive ButtonGroups, on four pages. Tabs: 1-4 or click.
// window.__game.api exposes a few probes for headless checks.
import { createCanvas } from '../lib/engine/canvas.ts';
import { createLoop } from '../lib/engine/loop.ts';
import { drawText, drawTextOutlined, measureText, setTextDefaults } from '../lib/engine/text.ts';
import {
  ACTIVITY_IDS, FOOD_IDS, ITEM_IDS, ORG_IDS, TYPE_IDS, type StatusId, type TypeId,
} from '../data/schema.ts';
import { TYPES } from '../data/types.ts';
import { FOODS, ITEMS } from '../data/items.ts';
import { ORGS } from '../data/villains.ts';
import { ACTIVITIES } from '../data/activities.ts';
import { createInput, type Input } from '../ui/input.ts';
import { createSceneManager, type Scene } from '../ui/scene.ts';
import {
  ButtonGroup, ScrollList, Typewriter, UI, VIEW_H, VIEW_W, drawBar, drawCoins, drawEffectTag,
  drawHpBar, drawInset, effectStyle, drawMessageBox, drawPanel, drawSelection, drawStars, drawStatusBadge,
  drawTypeBadge, drawTypeBadges, drawWrapped, fillRoundRect, type Rect,
} from '../ui/widgets.ts';
import {
  drawActivityIcon, drawCoinIcon, drawFoodIcon, drawItemIcon, drawLock, drawOrgEmblem, drawTypeIcon,
} from '../ui/icons.ts';

setTextDefaults({ shadowColor: UI.ink, outline: UI.ink });

const display = createCanvas('stage', { width: VIEW_W, height: VIEW_H });
const ctx = display.ctx;
const input = createInput(display.canvas, display.toInternal);
const scenes = createSceneManager();

let clock = 0;
/** The lists page's ScrollList, for the headless probes. */
let probeList: { selected: number; scroll: number } | null = null;
let lastAction = 'NOTHING YET. GO ON, POKE SOMETHING!';
const act = (what: string): void => { lastAction = what; };

// ---------------------------------------------------------------------------------------------
// Shared chrome: burrow backdrop, tab bar, footer
// ---------------------------------------------------------------------------------------------

function drawBackdrop(g: CanvasRenderingContext2D): void {
  const bands = ['#3d2a22', '#43302a', '#4a352c', '#523b30', '#5a4134'];
  const bh = VIEW_H / bands.length;
  bands.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, Math.floor(i * bh), VIEW_W, Math.ceil(bh) + 1); });
  let s = 1234567;
  const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rnd() * VIEW_W), y = Math.floor(rnd() * VIEW_H);
    g.fillStyle = rnd() < 0.5 ? 'rgba(255, 230, 190, 0.07)' : 'rgba(20, 10, 10, 0.18)';
    g.fillRect(x, y, rnd() < 0.3 ? 2 : 1, 1);
  }
}

const PAGES = ['WIDGETS', 'TYPES', 'ICONS', 'LISTS'] as const;
let pageIndex = 0;

function addTabs(group: ButtonGroup, current: number): void {
  PAGES.forEach((name, i) => {
    group.add({
      label: `${i + 1} ${name}`,
      rect: { x: 8 + i * 84, y: 6, w: 78, h: 20 },
      color: i === current ? UI.accent : UI.button,
      hotkey: String(i + 1),
      onClick: () => { if (i !== pageIndex) goTo(i); },
    });
  });
}

function drawChrome(g: CanvasRenderingContext2D): void {
  drawTextOutlined(g, 'UI KIT', VIEW_W - 10, 7, { size: 2, color: UI.gold, align: 'right' });
  drawText(g, 'DRAGON HAMSTERS', VIEW_W - 92, 11, { color: UI.panel, align: 'right' });
  fillRoundRect(g, 0, VIEW_H - 14, VIEW_W, 14, 0, 'rgba(27, 20, 38, 0.75)');
  drawText(g, '> ' + lastAction, 8, VIEW_H - 11, { color: UI.panelLight });
  drawText(g, 'ARROWS/TAB MOVE  ENTER PRESS  1-4 PAGES', VIEW_W - 8, VIEW_H - 11, { color: UI.textLightDim, align: 'right' });
}

function makePage(index: number): Scene {
  switch (index) {
    case 1: return typesPage();
    case 2: return iconsPage();
    case 3: return listsPage();
    default: return widgetsPage();
  }
}

function goTo(i: number): void {
  pageIndex = i;
  act(`PAGE ${i + 1}: ${PAGES[i]}`);
  scenes.replace(makePage(i));
}

// ---------------------------------------------------------------------------------------------
// Page 1: widgets
// ---------------------------------------------------------------------------------------------

const LINES = [
  'Chief Nibbles adjusts his monocle. "Agent, the dinosaur egg is missing. Again."',
  'EMBERPUFF used TOASTY TACKLE! It\'s super effective!',
  'The Big Cheese drops a smoke bomb... made of actual cheese. It smells AMAZING.',
  'Your squad gets a good night\'s sleep. Everyone feels bouncy!',
];

function widgetsPage(): Scene {
  const group = new ButtonGroup();
  addTabs(group, 0);
  const bx = 18, by = 52;
  const col = (i: number): number => bx + i * 92;
  group.add({ label: 'HONEY', rect: { x: col(0), y: by, w: 86, h: 20 }, onClick: () => act('HONEY BUTTON: SWEET!') });
  group.add({ label: 'ACCENT', rect: { x: col(1), y: by, w: 86, h: 20 }, color: UI.accent, onClick: () => act('ACCENT BUTTON: BOLD CHOICE.') });
  group.add({ label: 'GOOD', rect: { x: col(0), y: by + 28, w: 86, h: 20 }, color: UI.good, onClick: () => act('GOOD BUTTON: GOOD JOB!') });
  group.add({ label: 'BAD', rect: { x: col(1), y: by + 28, w: 86, h: 20 }, color: UI.bad, onClick: () => act('BAD BUTTON: IT WAS NOT THAT BAD.') });
  group.add({ label: 'DISABLED', rect: { x: col(0), y: by + 56, w: 86, h: 20 }, enabled: () => false, onClick: () => act('THIS SHOULD NEVER HAPPEN') });
  group.add({ label: 'WITH SUB', sub: 'SMALL LINE', rect: { x: col(1), y: by + 56, w: 86, h: 26 }, color: UI.panelLight, onClick: () => act('SUB BUTTON PRESSED') });
  group.add({
    label: 'SHOP', rect: { x: col(0), y: by + 90, w: 86, h: 22 }, color: UI.gold,
    icon: (g, cx, cy) => drawCoinIcon(g, cx, cy, 5), hotkey: 's', onClick: () => act('SHOP (HOTKEY S)'),
  });
  group.add({
    label: 'FIGHT', rect: { x: col(1), y: by + 90, w: 86, h: 22 }, color: '#e8603c',
    icon: (g, cx, cy) => drawTypeIcon(g, 'FIRE', cx, cy, 6), hotkey: 'f', onClick: () => act('FIGHT (HOTKEY F)'),
  });
  group.add({ label: 'BIG GO!', size: 2, rect: { x: col(0), y: by + 120, w: 178, h: 30 }, color: UI.info, onClick: () => act('BIG BLUE BUTTON. VERY IMPORTANT.') });
  group.add({ label: 'LEFT ALIGNED', align: 'left', sub: 'FOR LIST-LIKE MENUS', rect: { x: col(0), y: by + 158, w: 178, h: 26 }, icon: (g, cx, cy) => drawActivityIcon(g, 'nap', cx, cy, 12), onClick: () => act('LEFT ALIGNED BUTTON') });

  const tw = new Typewriter(60);
  let line = 0;
  let hold = 0;
  tw.set(LINES[0]);
  const msgRect: Rect = { x: 8, y: 262, w: 624, h: 72 };

  return {
    name: 'widgets',
    update(dt, inp: Input) {
      clock += dt;
      tw.update(dt);
      if (tw.done) hold += dt;
      const clickedBox = inp.pointer.pressed && inp.pointer.x >= msgRect.x && inp.pointer.y >= msgRect.y && inp.pointer.y < msgRect.y + msgRect.h;
      if (clickedBox) {
        if (!tw.done) tw.skip();
        else hold = 99;
      }
      if (hold > 2.5) { hold = 0; line = (line + 1) % LINES.length; tw.set(LINES[line]); }
      group.update(inp);
    },
    draw(g) {
      drawBackdrop(g);
      drawPanel(g, 8, 40, 198, 214, { title: 'BUTTONS' });
      group.draw(g);

      // bars and meters
      const px = 214, py = 40;
      drawPanel(g, px, py, 206, 214, { title: 'BARS & HP' });
      let y = py + 14;
      const hpRow = (label: string, hp: number, max: number, boss = false): void => {
        drawText(g, label, px + 10, y + 1, { color: UI.text, shadow: false });
        drawHpBar(g, px + 62, y, 132, hp, max, { boss });
        y += 14;
      };
      hpRow('FULL', 48, 48);
      hpRow('HURT', 30, 48);
      hpRow('OUCH', 15, 48);
      hpRow('YIKES', 5, 48);
      hpRow('BOSS', 140, 180, true);
      y += 2;
      drawText(g, 'XP', px + 10, y + 1, { color: UI.text, shadow: false });
      drawBar(g, px + 62, y + 1, 132, 6, 0.4 + 0.3 * Math.sin(clock * 0.8), UI.info);
      y += 13;
      const needs: [string, number, string][] = [['FULL', 0.8, '#f2a33a'], ['HAPPY', 0.55, '#ef6f9a'], ['ENERGY', 0.2, '#5cbf4f']];
      for (const [label, f, c] of needs) {
        drawText(g, label, px + 10, y + 1, { color: UI.textDim, shadow: false });
        drawBar(g, px + 62, y, 132, 8, f, c);
        y += 12;
      }
      y += 3;
      for (let i = 0; i <= 3; i++) drawStars(g, i, 3, px + 10 + i * 46, y);
      y += 16;
      let sx = px + 10;
      for (const st of ['burn', 'goop', 'zap', 'snooze', 'frozen'] as StatusId[]) sx += drawStatusBadge(g, st, sx, y) + 3;
      y += 15;
      sx = px + 10;
      sx += drawCoins(g, 200, sx, y) + 4;
      sx += drawCoins(g, 1234567, sx, y) + 4;
      // a dark battle-box style panel built from the same pieces
      drawPanel(g, px + 8, 227, 190, 23, { fill: UI.night });
      drawText(g, 'TOAD GOON', px + 15, 230, { color: UI.textLight });
      drawText(g, 'LV12', px + 15, 240, { color: UI.textLightDim, shadow: false });
      drawStatusBadge(g, 'goop', px + 72, 236);
      drawHpBar(g, px + 104, 232, 86, 9, 30);

      // matchup tags
      const mx = 428, my = 40;
      drawPanel(g, mx, my, 204, 214, { title: 'MATCHUPS' });
      let ty = my + 14;
      const mults = [4, 2, 1, 0.5, 0.25, 0];
      mults.forEach((m, i) => {
        drawEffectTag(g, m, mx + 10, ty + i * 16);
        drawEffectTag(g, m, mx + 112, ty + i * 16 + 2, { small: true });
      });
      ty += mults.length * 16 + 4;
      drawInset(g, mx + 8, ty, 188, 62);
      drawText(g, 'WEAK TO:', mx + 14, ty + 6, { color: UI.text, shadow: false });
      drawTypeBadges(g, ['WATER', 'ROCK'], mx + 66, ty + 3, { small: true });
      drawText(g, 'MATCHUP', mx + 14, ty + 22, { color: UI.text, shadow: false });
      drawTypeBadge(g, 'FIRE', mx + 66, ty + 19, { small: true });
      drawText(g, '→', mx + 128, ty + 21, { color: UI.good, shadowColor: UI.panelDark });
      drawEffectTag(g, 2, mx + 138, ty + 19, { small: true });
      drawTypeBadge(g, 'LEAF', mx + 66, ty + 35, { small: true });
      drawText(g, '←', mx + 128, ty + 37, { color: UI.warn, shadowColor: UI.panelDark });
      drawEffectTag(g, 0.5, mx + 138, ty + 35, { small: true });
      drawText(g, 'GRADE', mx + 14, ty + 51, { color: UI.text, shadow: false });
      drawStars(g, 2, 3, mx + 66, ty + 50);
      // the starter triangle, in miniature
      const tri: TypeId[] = ['FIRE', 'LEAF', 'WATER'];
      tri.forEach((t, i) => {
        const cx = mx + 34 + i * 68;
        drawTypeIcon(g, t, cx, 233, 8);
        drawText(g, i < 2 ? '>' : '', cx + 34, 225, { color: UI.text, shadow: false, align: 'center' });
      });
      drawText(g, 'BEATS', mx + 68, 236, { color: UI.textDim, shadow: false, align: 'center' });
      drawText(g, 'BEATS', mx + 136, 236, { color: UI.textDim, shadow: false, align: 'center' });

      drawMessageBox(g, msgRect.x, msgRect.y, msgRect.w, msgRect.h, tw, { name: 'CHIEF NIBBLES' });
      drawChrome(g);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Page 2: types
// ---------------------------------------------------------------------------------------------

function typesPage(): Scene {
  const group = new ButtonGroup();
  addTabs(group, 1);
  return {
    name: 'types',
    update(dt, inp) { clock += dt; group.update(inp); },
    draw(g) {
      drawBackdrop(g);
      drawPanel(g, 8, 40, 410, 152, { title: 'TYPE BADGES' });
      TYPE_IDS.forEach((t, i) => {
        const c = i % 4, r = Math.floor(i / 4);
        drawTypeBadge(g, t, 18 + c * 98, 54 + r * 18);
        drawTypeBadge(g, t, 18 + c * 98, 128 + r * 14, { small: true });
      });
      drawPanel(g, 426, 40, 206, 152, { title: 'EMBLEMS R4 / R6 / R9' });
      TYPE_IDS.forEach((t, i) => {
        const c = i % 4, r = Math.floor(i / 4);
        const x = 448 + c * 50, y = 64 + r * 32;
        drawTypeIcon(g, t, x - 16, y, 4);
        drawTypeIcon(g, t, x - 2, y, 6);
        drawTypeIcon(g, t, x + 16, y, 9);
      });
      drawPanel(g, 8, 202, 624, 140, { title: 'TYPE CHART HEADERS' });
      TYPE_IDS.forEach((t, i) => {
        const x = 30 + i * 37;
        drawTypeIcon(g, t, x, 230, 9);
        drawTypeIcon(g, t, x, 254, 6, { plain: true });
        drawText(g, (TYPES[t]?.name ?? t).slice(0, 5), x, 266, { color: UI.text, shadow: false, align: 'center' });
        drawTypeIcon(g, t, x, 292, 12);
        drawTypeIcon(g, t, x, 322, 5);
      });
      group.draw(g);
      drawChrome(g);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Page 3: icons
// ---------------------------------------------------------------------------------------------

function iconsPage(): Scene {
  const group = new ButtonGroup();
  addTabs(group, 2);
  const label = (g: CanvasRenderingContext2D, text: string, x: number, y: number): void => {
    drawText(g, text, x, y, { color: UI.text, shadow: false, align: 'center' });
  };
  return {
    name: 'icons',
    update(dt, inp) { clock += dt; group.update(inp); },
    draw(g) {
      drawBackdrop(g);
      drawPanel(g, 8, 40, 310, 146, { title: 'PANTRY: FOODS & ITEMS' });
      FOOD_IDS.forEach((id, i) => {
        const x = 40 + i * 60;
        drawFoodIcon(g, id, x - 14, 70, 14);
        drawFoodIcon(g, id, x + 6, 70, 24);
        label(g, (FOODS[id]?.name ?? id).split(' ')[0], x, 88);
      });
      ITEM_IDS.forEach((id, i) => {
        const x = 40 + i * 60;
        drawItemIcon(g, id, x - 14, 128, 14);
        drawItemIcon(g, id, x + 6, 128, 24);
        label(g, (ITEMS[id]?.name ?? id).split(' ').slice(-1)[0], x, 146);
      });
      drawText(g, 'SIZES 14 AND 24', 18, 168, { color: UI.textDim, shadow: false });

      drawPanel(g, 326, 40, 306, 146, { title: 'BURROW ACTIVITIES' });
      ACTIVITY_IDS.forEach((id, i) => {
        const x = 358 + i * 60;
        drawActivityIcon(g, id, x - 14, 70, 14);
        drawActivityIcon(g, id, x + 6, 70, 24);
        label(g, (ACTIVITIES[id]?.name ?? id).split(' ').slice(-1)[0], x, 88);
      });
      const cy = 128;
      drawCoinIcon(g, 350, cy, 3);
      drawCoinIcon(g, 364, cy, 4);
      drawCoinIcon(g, 382, cy, 5);
      drawCoinIcon(g, 408, cy, 9);
      label(g, 'COINS', 380, 146);
      drawLock(g, 450, cy, 10);
      drawLock(g, 470, cy, 14);
      drawLock(g, 498, cy, 22);
      label(g, 'LOCK', 474, 146);
      drawStars(g, 3, 3, 530, cy - 5);
      label(g, 'STARS', 545, 146);
      drawCoins(g, 999, 580, cy - 6);

      drawPanel(g, 8, 196, 624, 146, { title: 'VILLAIN ORGANISATIONS' });
      ORG_IDS.forEach((id, i) => {
        const x = 70 + i * 124;
        drawOrgEmblem(g, id, x - 30, 236, 9);
        drawOrgEmblem(g, id, x + 10, 236, 18);
        drawOrgEmblem(g, id, x - 30, 262, 6);
        label(g, (ORGS[id]?.short ?? id), x, 280);
      });
      // a mission-card style strip using the pieces together
      ORG_IDS.forEach((id, i) => {
        const x = 18 + i * 124;
        drawInset(g, x, 296, 116, 36);
        drawOrgEmblem(g, id, x + 16, 314, 10);
        drawText(g, `CASE ${i + 1}`, x + 32, 302, { color: UI.text, shadow: false });
        if (i < 2) drawStars(g, 3 - i, 3, x + 32, 315);
        else drawLock(g, x + 40, 320, 12);
      });
      group.draw(g);
      drawChrome(g);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Page 4: lists, interactive group, modal
// ---------------------------------------------------------------------------------------------

interface DemoMon { name: string; types: TypeId[]; level: number; grade: number }

const DEMO_NAMES = [
  'EMBERPUFF', 'SPROUTLING', 'DRIZZLEBUN', 'ZAPWHISKER', 'PEBBLEPAW', 'MUDNIBBLER', 'GUSTFLUFF', 'FROSTBUN',
  'GOOBERLING', 'SHADOWCHEW', 'GLIMMERTAIL', 'MUFFINWING', 'COGSQUEAK', 'PONDERPIP', 'BOXERBUN', 'CINDERLOAF',
  'MOSSMUNCH', 'SPLASHCHEEK', 'VOLTNUT', 'BOULDERBUM',
];

function listsPage(): Scene {
  const group = new ButtonGroup();
  addTabs(group, 3);
  const mons: DemoMon[] = DEMO_NAMES.map((name, i) => ({
    name,
    types: i % 3 === 0 ? [TYPE_IDS[i % 16], TYPE_IDS[(i * 5 + 3) % 16]] : [TYPE_IDS[i % 16]],
    level: 5 + ((i * 7) % 40),
    grade: 1 + (i % 3),
  }));
  const list = new ScrollList<DemoMon>({
    rect: { x: 20, y: 56, w: 254, h: 258 },
    rowH: 24,
    items: () => mons,
    drawRow: (g, m, r, sel, hov) => {
      drawSelection(g, { x: r.x, y: r.y + 1, w: r.w, h: r.h - 2 }, sel, hov);
      drawText(g, m.name, r.x + 6, r.y + 5, { color: UI.text, shadow: false });
      drawText(g, 'LV' + m.level, r.x + 6, r.y + 14, { color: UI.textDim, shadow: false });
      drawTypeBadges(g, m.types, r.x + 36, r.y + 12, { small: true });
      drawStars(g, m.grade, 3, r.x + r.w - 33, r.y + 4);
    },
    onSelect: (m) => act('SELECTED ' + m.name),
    onActivate: (m) => act('ACTIVATED ' + m.name + '! (DOUBLE-CLICK OR ENTER)'),
  });
  list.keyboard = false;
  probeList = list;
  let listFocus = false;

  const moves: { name: string; type: TypeId; pp: number; mult: number }[] = [
    { name: 'TOASTY TACKLE', type: 'FIRE', pp: 25, mult: 2 },
    { name: 'SEED SPITTER', type: 'LEAF', pp: 15, mult: 0.5 },
    { name: 'CHEEK STUFF', type: 'FLUFF', pp: 10, mult: 1 },
    { name: 'BOLT NIBBLE', type: 'LIGHTNING', pp: 0, mult: 0 },
  ];
  const moveRects: Rect[] = [];
  moves.forEach((mv, i) => {
    const r: Rect = { x: 298 + (i % 2) * 166, y: 66 + Math.floor(i / 2) * 44, w: 158, h: 38 };
    moveRects.push(r);
    group.add({
      label: mv.name, sub: `PP ${mv.pp}/25`, rect: r, align: 'left', hotkey: String.fromCharCode(113 + i * 6),
      color: TYPES[mv.type]?.color, enabled: () => mv.pp > 0,
      icon: (g, cx, cy) => drawTypeIcon(g, mv.type, cx, cy, 6),
      onClick: () => act(`USED ${mv.name}!`),
    });
  });
  group.add({ label: 'OPEN MODAL', rect: { x: 298, y: 168, w: 158, h: 22 }, color: UI.accent, hotkey: 'm', onClick: () => { act('MODAL OPENED'); scenes.push(modal()); } });
  group.add({ label: 'FADE TO PAGE 1', rect: { x: 464, y: 168, w: 158, h: 22 }, onClick: () => goTo(0) });
  group.add({ label: 'LIST KEYS', sub: 'TOGGLE ARROWS', rect: { x: 298, y: 198, w: 158, h: 26 }, color: UI.panelLight, onClick: () => { listFocus = !listFocus; list.keyboard = listFocus; group.keyboard = !listFocus; act(listFocus ? 'ARROWS NOW DRIVE THE LIST (ESC TO RETURN)' : 'ARROWS DRIVE THE BUTTONS'); } });

  return {
    name: 'lists',
    update(dt, inp) {
      clock += dt;
      if (listFocus && inp.back()) { listFocus = false; list.keyboard = false; group.keyboard = true; act('ARROWS DRIVE THE BUTTONS'); }
      list.update(inp);
      group.update(inp);
    },
    draw(g) {
      drawBackdrop(g);
      drawPanel(g, 8, 40, 278, 290, { title: 'SCROLL LIST' });
      drawInset(g, 16, 52, 262, 266);
      list.draw(g);
      drawPanel(g, 290, 40, 342, 194, { title: 'MOVES (Q W E R)' });
      group.draw(g);
      moves.forEach((mv, i) => {
        const r = moveRects[i];
        const b = group.buttons[PAGES.length + i];
        const sink = b.pressT > 0 || (b.down && b.hovered) ? 2 : 0;
        if (mv.pp > 0) drawEffectTag(g, mv.mult, r.x + r.w - 6 - measureTag(mv.mult), r.y + 20 + sink, { small: true });
      });
      drawPanel(g, 290, 242, 342, 88, { title: 'STATUS' });
      drawWrapped(g, listFocus ? 'THE LIST HAS THE ARROW KEYS. ESC GIVES THEM BACK.' : 'HOVER, CLICK, OR USE ARROWS + ENTER. HOTKEYS Q/W/E/R FIRE MOVES. DOUBLE-CLICK A ROW.', 302, 256, 318, { color: UI.text, shadow: false });
      drawText(g, `SELECTED: ${list.selected >= 0 ? mons[list.selected].name : '-'}`, 302, 300, { color: UI.textDim, shadow: false });
      drawText(g, `STACK DEPTH: ${scenes.depth}`, 302, 312, { color: UI.textDim, shadow: false });
      drawChrome(g);
    },
  };
}

function measureTag(mult: number): number {
  return measureText(effectStyle(mult).text) + 8;
}

function modal(): Scene {
  const group = new ButtonGroup();
  const close = (msg: string): void => { act(msg); scenes.pop(); };
  group.add({ label: 'YES!', rect: { x: 236, y: 206, w: 80, h: 22 }, color: UI.good, hotkey: 'y', onClick: () => close('MODAL: YES, OBVIOUSLY.') });
  group.add({ label: 'NO', rect: { x: 324, y: 206, w: 80, h: 22 }, color: UI.bad, hotkey: 'Escape', onClick: () => close('MODAL: NO (OR ESC)') });
  return {
    name: 'modal',
    overlay: true,
    update(dt, inp) { clock += dt; group.update(inp); },
    draw(g) {
      drawPanel(g, 200, 120, 240, 120, { title: 'SECRET MEMO' });
      drawTypeIcon(g, 'COOKING', 226, 152, 9);
      drawWrapped(g, 'Should the agency stock more cheese cubes in the pantry?', 244, 140, 184, { color: UI.text, shadow: false });
      drawText(g, 'Y / ESC', 320, 186, { color: UI.textDim, shadow: false, align: 'center' });
      group.draw(g);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------

scenes.reset(makePage(0));

const loop = createLoop({
  update() {
    input.beginUpdate();
    scenes.update(1 / 60, input);
    input.endUpdate();
  },
  render() { scenes.draw(ctx); },
});
loop.start();

const hooks = window.__game;
if (hooks) {
  hooks.api = {
    page: (i: number) => goTo(i),
    lastAction: () => lastAction,
    depth: () => scenes.depth,
    busy: () => scenes.busy,
    top: () => scenes.top()?.name ?? null,
    click: (x: number, y: number) => input.injectClick(x, y),
    key: (k: string) => input.injectKey(k),
    list: () => (probeList ? { selected: probeList.selected, scroll: probeList.scroll } : null),
  };
  hooks.ready = true;
}
