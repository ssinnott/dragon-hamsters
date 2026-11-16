// The mission board: the agency's corkboard of case files. Five folder tabs (one per villain gang),
// the selected gang's dossier (name, motto, crew types, a WANTED poster of its boss), and its five
// case cards pinned to the cork and tied together with red string. Picking an open case pushes the
// briefing; a locked case wiggles and says what to solve first.
import { drawText, measureText } from '../../lib/engine/text.ts';
import { MISSIONS_IN_ORDER, getLocation, getMissionType, getOrg, getVillain } from '../../data/index.ts';
import { ORG_IDS, type MissionDef, type OrgId } from '../../data/schema.ts';
import { missionStatus, nextMission, type MissionStatus } from '../../game/missions.ts';
import { drawVillain, villainHeight } from '../../art/villain.ts';
import { sfx, music } from '../../audio/index.ts';
import { app } from '../app.ts';
import type { Scene } from '../scene.ts';
import type { Input } from '../input.ts';
import {
  Button, ButtonGroup, UI, VIEW_W, VIEW_H, drawStars, drawTypeBadges, fillRoundRect, tint, wrapText, type Rect,
} from '../widgets.ts';
import { MISSION_TYPE_COLOR, blitSprite, drawLock, drawMissionTypeIcon, drawOrgEmblem, pixelSprite } from '../icons.ts';
import { TUTORIAL_FLAGS } from '../../game/types.ts';

type Ctx = CanvasRenderingContext2D;

const INK = UI.ink;

// ---------------------------------------------------------------------------------------------
// Pixel icons (fill masks; an ink outline is added around each)
// ---------------------------------------------------------------------------------------------

const PIN_ROWS = ['.rrr.', 'rwrrr', 'rrrrr', '.rrr.', '..r..', '..r..'];
function drawMapPin(ctx: Ctx, cx: number, cy: number): void {
  blitSprite(ctx, pixelSprite('pin', PIN_ROWS, { r: '#e04f45', w: '#ffc4b8' }), cx, cy);
}

// ---------------------------------------------------------------------------------------------
// Cork, pins and string
// ---------------------------------------------------------------------------------------------

let corkCache: HTMLCanvasElement | null = null;

function corkTexture(): HTMLCanvasElement {
  if (corkCache) return corkCache;
  const c = document.createElement('canvas');
  c.width = VIEW_W; c.height = VIEW_H;
  const g = c.getContext('2d') as Ctx;
  g.fillStyle = '#b5844f';
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  let s = 90210;
  const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const tones = ['#a67543', '#c4935c', '#9a6a3a', '#cfa06a', '#8f6234'];
  for (let i = 0; i < 5200; i++) {
    const x = Math.floor(rnd() * VIEW_W), y = Math.floor(rnd() * VIEW_H);
    g.fillStyle = tones[Math.floor(rnd() * tones.length)];
    g.fillRect(x, y, rnd() < 0.25 ? 2 : 1, rnd() < 0.15 ? 2 : 1);
  }
  // old pin holes and a couple of faded rectangles where papers used to hang
  g.fillStyle = 'rgba(60, 35, 15, 0.35)';
  for (let i = 0; i < 26; i++) g.fillRect(Math.floor(rnd() * VIEW_W), Math.floor(rnd() * VIEW_H), 1, 1);
  g.fillStyle = 'rgba(255, 230, 190, 0.05)';
  g.fillRect(470, 150, 90, 60);
  g.fillRect(30, 250, 70, 50);
  // the wooden frame
  const F = 5;
  g.fillStyle = UI.woodDark; g.fillRect(0, 0, VIEW_W, F); g.fillRect(0, VIEW_H - F, VIEW_W, F); g.fillRect(0, 0, F, VIEW_H); g.fillRect(VIEW_W - F, 0, F, VIEW_H);
  g.fillStyle = UI.wood; g.fillRect(0, 0, VIEW_W, F - 2); g.fillRect(0, 0, F - 2, VIEW_H); g.fillRect(VIEW_W - F, 0, F - 2, VIEW_H); g.fillRect(0, VIEW_H - F, VIEW_W, F - 2);
  g.fillStyle = UI.woodLight; g.fillRect(0, 0, VIEW_W, 1); g.fillRect(0, 0, 1, VIEW_H);
  g.fillStyle = 'rgba(40, 20, 8, 0.35)'; g.fillRect(F, F, VIEW_W - 2 * F, 2); g.fillRect(F, F, 2, VIEW_H - 2 * F);
  corkCache = c;
  return c;
}

const PIN_COLORS = ['#e04f45', '#4f9be0', '#f6c63c', '#5cbf4f', '#c86ad8'];

function drawPushpin(ctx: Ctx, x: number, y: number, color: string): void {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = 'rgba(40, 20, 8, 0.35)';
  ctx.fillRect(x - 1, y + 3, 5, 2);
  fillRoundRect(ctx, x - 3, y - 3, 7, 7, 2, INK);
  fillRoundRect(ctx, x - 2, y - 2, 5, 5, 1, color);
  ctx.fillStyle = tint(color, -0.3);
  ctx.fillRect(x - 1, y + 2, 4, 1);
  ctx.fillStyle = tint(color, 0.6);
  ctx.fillRect(x - 1, y - 1, 2, 1);
}

/** Red detective string between two pins, sagging a little. */
function drawString(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, sag: number): void {
  const n = Math.max(2, Math.ceil(Math.abs(x1 - x0) / 2));
  ctx.fillStyle = '#9e1f26';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t + sag * 4 * t * (1 - t);
    ctx.fillRect(Math.round(x), Math.round(y), 2, 1);
  }
  ctx.fillStyle = '#d8383f';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t + sag * 4 * t * (1 - t);
    ctx.fillRect(Math.round(x), Math.round(y) - 1, 2, 1);
  }
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

const TAB_Y = 34, TAB_H = 24;
const DOSSIER: Rect = { x: 9, y: TAB_Y + TAB_H - 2, w: 622, h: 68 };
const CARD_Y = 140, CARD_W = 116, CARD_H = 196;
const cardRect = (i: number): Rect => ({ x: 12 + i * 124, y: CARD_Y, w: CARD_W, h: CARD_H });
const tabRect = (i: number): Rect => ({ x: 10 + i * 124, y: TAB_Y, w: 120, h: TAB_H });

const ORDERED_ORGS: OrgId[] = [...ORG_IDS].sort((a, b) => getOrg(a).order - getOrg(b).order);

function orgMissions(org: OrgId): MissionDef[] {
  return MISSIONS_IN_ORDER.filter((m) => m.org === org).sort((a, b) => a.index - b.index).slice(0, 5);
}

const TUTORIAL = [
  "Welcome to the mission board, agent! Every case file pinned up here is a job for the agency.",
  'Pick a NEW case to read its briefing. Each villain gang fights with its own types, so check the INTEL and bring dragons that counter them!',
  'Crack a gang\'s final showdown and the next file opens up. Now go make me proud. And bring back snacks.',
];

// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

export function createBoardScene(): Scene {
  const state = (): typeof app.state => app.state;
  const orgLocked = (org: OrgId): boolean => {
    const first = orgMissions(org)[0];
    return !first || missionStatus(state(), first.id) === 'locked';
  };
  /**
   * The gang whose boss opens the file at `idx`, by its short name, or null when that gang's own
   * file is still classified too (its tab reads "???", so naming it here would spoil it).
   */
  const prevGangName = (idx: number): string | null => {
    if (idx <= 0) return null;
    const prev = ORDERED_ORGS[idx - 1];
    return orgLocked(prev) ? null : getOrg(prev).short.toUpperCase();
  };

  // Start on the gang of the first open, unsolved case (or the last gang that is open).
  const next = nextMission(state());
  let orgIdx = next ? Math.max(0, ORDERED_ORGS.indexOf(next.org)) : 0;
  if (!next) {
    for (let i = ORDERED_ORGS.length - 1; i >= 0; i--) if (!orgLocked(ORDERED_ORGS[i])) { orgIdx = i; break; }
  }
  let switchT = 0;
  let time = 0;
  let wiggle = { slot: -1, t: 0 };
  let toast = { text: '', t: 0 };
  let tutorialChecked = false;

  const org = (): OrgId => ORDERED_ORGS[orgIdx];
  const cards = (): MissionDef[] => orgMissions(org());

  const group = new ButtonGroup();
  const backBtn = group.add({
    label: '← BACK', rect: { x: 12, y: 9, w: 62, h: 20 }, hotkey: 'Escape',
    onClick: () => { sfx('back'); app.scenes.pop(); },
  });
  const tabBtns: Button[] = ORDERED_ORGS.map((_, i) => group.add({
    label: '', rect: tabRect(i), hotkey: String(i + 1),
    onClick: () => selectOrg(i, true),
  }));
  const cardBtns: Button[] = [0, 1, 2, 3, 4].map((slot) => group.add({
    label: '', rect: cardRect(slot),
    visible: () => slot < cards().length,
    onClick: () => openCard(slot),
  }));

  function selectOrg(i: number, fromClick: boolean): void {
    if (i === orgIdx) { if (fromClick) sfx('click'); return; }
    orgIdx = i;
    switchT = 0;
    wiggle = { slot: -1, t: 0 };
    sfx('click');
    if (orgLocked(org())) showToast('THIS FILE IS STILL CLASSIFIED. TOP SECRET!');
  }

  function showToast(text: string): void { toast = { text, t: 2.6 }; }

  function openCard(slot: number): void {
    const m = cards()[slot];
    if (!m) return;
    if (orgLocked(org())) {
      sfx('error');
      wiggle = { slot, t: 0.4 };
      const prevOrg = prevGangName(orgIdx);
      showToast(prevOrg ? `CLASSIFIED! CATCH THE ${prevOrg} BOSS TO OPEN THIS FILE.` : 'CLASSIFIED! OPEN THE FILES BEFORE THIS ONE FIRST.');
      return;
    }
    const st = missionStatus(state(), m.id);
    if (st === 'locked') {
      sfx('error');
      wiggle = { slot, t: 0.4 };
      const need = m.requires.map((r) => MISSIONS_IN_ORDER.find((x) => x.id === r)).filter((x): x is MissionDef => !!x);
      const sameOrg = need.find((x) => x.org === m.org);
      showToast(sameOrg ? `LOCKED! SOLVE CASE ${sameOrg.index} FIRST.` : 'LOCKED! SOLVE THE EARLIER CASES FIRST.');
      return;
    }
    sfx('select');
    app.nav.briefing(m.id);
  }

  function focusStartCard(): void {
    const list = cards();
    let slot = list.findIndex((m) => missionStatus(state(), m.id) === 'available');
    if (slot < 0) slot = 0;
    const idx = group.buttons.indexOf(cardBtns[slot]);
    if (idx >= 0) group.focus = idx;
  }
  focusStartCard();

  function handleKeys(input: Input): void {
    // Up from a card goes to THIS gang's tab (spatial nav would pick whichever tab is above it).
    const f = group.focused;
    if (f && cardBtns.includes(f) && input.pressed('ArrowUp')) {
      group.focus = group.buttons.indexOf(tabBtns[orgIdx]);
      group.keyboard = false;
    }
    // Down from a tab goes to the first open card.
    if (f && tabBtns.includes(f) && input.pressed('ArrowDown')) {
      const list = cards();
      let slot = list.findIndex((m) => missionStatus(state(), m.id) === 'available');
      if (slot < 0) slot = 0;
      group.focus = group.buttons.indexOf(cardBtns[slot]);
      group.keyboard = false;
    }
  }

  return {
    name: 'board',
    enter() {
      music('burrow');
    },
    resume() {
      switchT = 1;
      music('burrow');
    },
    update(dt, input) {
      time += dt;
      switchT += dt;
      if (wiggle.t > 0) wiggle.t = Math.max(0, wiggle.t - dt);
      if (toast.t > 0) toast.t = Math.max(0, toast.t - dt);
      if (!tutorialChecked) {
        if (!state().flags[TUTORIAL_FLAGS.board]) {
          // the Chief explains the board once its case cards have been dealt, not over an empty
          // corkboard (and nothing on it can be clicked before he has had his say)
          if (switchT < 0.5) return;
          state().flags[TUTORIAL_FLAGS.board] = true;
          app.save();
          app.nav.dialog(TUTORIAL, undefined, 'chief');
        }
        tutorialChecked = true;
        return;
      }
      const arrows = input.pressed('ArrowLeft') || input.pressed('ArrowRight');
      handleKeys(input);
      group.update(input);
      group.keyboard = true;
      // Arrowing along the tabs flips the dossier to that gang right away.
      const f = group.focused;
      if (arrows && f && tabBtns.includes(f)) {
        const i = tabBtns.indexOf(f);
        if (i !== orgIdx) selectOrg(i, false);
      }
    },
    draw(ctx) {
      ctx.drawImage(corkTexture(), 0, 0);
      drawHeader(ctx);
      drawTabs(ctx);
      drawDossier(ctx);
      drawCards(ctx);
      backBtn.draw(ctx, group.focused === backBtn);
      drawFooter(ctx);
    },
  };

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  function drawHeader(ctx: Ctx): void {
    // a pinned paper banner
    const title = 'MISSION BOARD';
    const w = measureText(title, 2) + 36;
    const x = Math.round((VIEW_W - w) / 2), y = 7;
    fillRoundRect(ctx, x + 2, y + 3, w, 24, 2, 'rgba(40, 20, 8, 0.35)');
    fillRoundRect(ctx, x, y, w, 24, 2, INK);
    fillRoundRect(ctx, x + 1, y + 1, w - 2, 22, 1, '#fffaf0');
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(x + 1, y + 21, w - 2, 2);
    ctx.fillStyle = '#f0c8c0';
    ctx.fillRect(x + 1, y + 5, w - 2, 1);
    drawText(ctx, title, VIEW_W / 2, y + 7, { size: 2, color: '#b8323a', align: 'center', shadowColor: '#f0d8c8' });
    drawPushpin(ctx, x + 7, y + 6, PIN_COLORS[0]);
    drawPushpin(ctx, x + w - 8, y + 6, PIN_COLORS[1]);

    // cases solved counter
    const all = MISSIONS_IN_ORDER.length;
    const solved = MISSIONS_IN_ORDER.filter((m) => missionStatus(state(), m.id) === 'cleared').length;
    const txt = `SOLVED ${solved}/${all}`;
    const tw = measureText(txt) + 26;
    const cx = VIEW_W - 12 - tw;
    fillRoundRect(ctx, cx, 10, tw, 17, 3, INK);
    fillRoundRect(ctx, cx + 1, 11, tw - 2, 15, 2, UI.night);
    drawStars(ctx, 1, 1, cx + 5, 14);
    drawText(ctx, txt, cx + 19, 15, { color: UI.goldLight, shadowColor: UI.nightDark });
  }

  function drawTabs(ctx: Ctx): void {
    ORDERED_ORGS.forEach((o, i) => {
      if (i === orgIdx) return;
      drawTab(ctx, o, i, false);
    });
  }

  function drawTab(ctx: Ctx, o: OrgId, i: number, selected: boolean): void {
    const r = tabRect(i);
    const btn = tabBtns[i];
    const focused = group.focused === btn;
    const hot = btn.hovered || focused;
    const lift = selected ? 0 : hot ? 1 : 3;
    const x = r.x, y = r.y + lift, w = r.w, h = r.h - lift + (selected ? 4 : 0);
    const locked = orgLocked(o);
    const fill = selected ? '#f6dfa4' : locked ? '#b7a382' : hot ? '#ecd096' : '#d9bb80';
    if (focused && !selected) {
      fillRoundRect(ctx, x - 2, y - 2, w + 4, h + 2, 4, INK);
      fillRoundRect(ctx, x - 1, y - 1, w + 2, h + 1, 4, Math.sin(time * 6) > 0 ? UI.focus : tint(UI.focus, 0.3));
    }
    fillRoundRect(ctx, x, y, w, h, 3, INK);
    fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 1, 2, fill);
    ctx.fillStyle = tint(fill, 0.45);
    ctx.fillRect(x + 3, y + 1, w - 6, 1);
    if (!selected) {
      ctx.fillStyle = tint(fill, -0.18);
      ctx.fillRect(x + 1, y + h - 3, w - 2, 2);
    }
    if (focused && selected) {
      ctx.fillStyle = Math.sin(time * 6) > 0 ? UI.focus : tint(UI.focus, 0.3);
      ctx.fillRect(x + 4, y + 2, w - 8, 2);
    }
    const cy = y + 11;
    if (locked) {
      const label = '???';
      const cw = 14 + 4 + measureText(label);
      const sx = x + Math.floor((w - cw) / 2);
      drawLock(ctx, sx + 7, cy, 12);
      drawText(ctx, label, sx + 18, cy - 3, { color: tint(UI.text, 0.25), shadow: false });
      return;
    }
    const label = getOrg(o).short.toUpperCase();
    const cw = 16 + 3 + measureText(label);
    const sx = x + Math.max(3, Math.floor((w - cw) / 2));
    drawOrgEmblem(ctx, o, sx + 7, cy, 7);
    drawText(ctx, label, sx + 18, cy - 3, { color: UI.text, shadow: false });
  }

  function drawDossier(ctx: Ctx): void {
    const d = DOSSIER;
    const o = org();
    const locked = orgLocked(o);
    // folder face
    fillRoundRect(ctx, d.x + 2, d.y + 3, d.w, d.h, 4, 'rgba(40, 20, 8, 0.35)');
    fillRoundRect(ctx, d.x, d.y, d.w, d.h, 4, INK);
    fillRoundRect(ctx, d.x + 1, d.y + 1, d.w - 2, d.h - 2, 3, '#e0c487');
    fillRoundRect(ctx, d.x + 1, d.y + 1, d.w - 2, d.h - 4, 3, '#f6dfa4');
    ctx.fillStyle = '#fff0c8';
    ctx.fillRect(d.x + 4, d.y + 1, d.w - 8, 1);
    drawTab(ctx, o, orgIdx, true);

    const ex = d.x + 32, ey = d.y + 34;
    if (locked) {
      drawOrgEmblem(ctx, o, ex, ey, 19);
      ctx.fillStyle = 'rgba(40, 30, 50, 0.55)';
      ctx.beginPath(); ctx.arc(ex, ey, 19, 0, Math.PI * 2); ctx.fill();
      drawLock(ctx, ex, ey + 1, 18);
      drawText(ctx, 'CLASSIFIED FILE', d.x + 64, d.y + 12, { size: 2, color: '#b8323a', shadowColor: '#f0c8b0' });
      const prev = prevGangName(orgIdx);
      const lines = wrapText(prev
        ? `Nobody knows who these crooks are yet. Catch the boss of the ${prev} to open this file.`
        : 'Nobody knows who these crooks are yet. Crack the classified files before this one first!', 330);
      lines.slice(0, 3).forEach((l, i) => drawText(ctx, l, d.x + 64, d.y + 32 + i * 10, { color: UI.text, shadow: false }));
    } else {
      const def = getOrg(o);
      drawOrgEmblem(ctx, o, ex, ey, 19);
      const big = measureText(def.name, 2) <= 320;
      drawText(ctx, def.name, d.x + 64, d.y + (big ? 9 : 12), { size: big ? 2 : 1, color: UI.text, shadowColor: '#e0c487' });
      const motto = wrapText(`"${def.motto}"`, 318)[0] ?? '';
      drawText(ctx, motto, d.x + 64, d.y + 29, { color: UI.textDim, shadow: false });
      drawText(ctx, 'CREW TYPES:', d.x + 64, d.y + 47, { color: UI.text, shadow: false });
      drawTypeBadges(ctx, def.themeTypes, d.x + 64 + measureText('CREW TYPES:') + 5, d.y + 44, { small: true });
      // progress
      const list = cards();
      const solved = list.filter((m) => missionStatus(state(), m.id) === 'cleared').length;
      const px = 398;
      drawText(ctx, 'CASES SOLVED', px, d.y + 13, { color: UI.text, shadow: false });
      drawStars(ctx, solved, list.length, px, d.y + 26);
      drawText(ctx, `${solved} OF ${list.length}`, px, d.y + 41, { color: UI.textDim, shadow: false });
    }
    drawWanted(ctx, o, locked);
  }

  function drawWanted(ctx: Ctx, o: OrgId, locked: boolean): void {
    const pw = 104, ph = 60;
    const px = DOSSIER.x + DOSSIER.w - pw - 8, py = DOSSIER.y + 4;
    fillRoundRect(ctx, px + 2, py + 2, pw, ph, 1, 'rgba(40, 20, 8, 0.3)');
    fillRoundRect(ctx, px, py, pw, ph, 1, INK);
    fillRoundRect(ctx, px + 1, py + 1, pw - 2, ph - 2, 0, '#efe2c4');
    ctx.fillStyle = '#e2d0aa';
    ctx.fillRect(px + 1, py + ph - 3, pw - 2, 2);
    drawText(ctx, 'WANTED', px + pw / 2, py + 4, { color: '#a8282e', shadow: false, align: 'center' });
    const bossId = getOrg(o).boss;
    let boss: ReturnType<typeof getVillain> | null = null;
    try { boss = getVillain(bossId); } catch { boss = null; }
    // the mugshot
    ctx.save();
    ctx.beginPath();
    ctx.rect(px + 3, py + 13, pw - 6, 34);
    ctx.clip();
    ctx.fillStyle = '#d6c6a4';
    ctx.fillRect(px + 3, py + 13, pw - 6, 34);
    ctx.fillStyle = '#c8b690';
    for (let ly = py + 17; ly < py + 47; ly += 6) ctx.fillRect(px + 3, ly, pw - 6, 1);
    if (boss) {
      const s = Math.min(1.2, 26 / Math.max(1, villainHeight(boss.visual, 1)));
      drawVillain(ctx, boss.visual, px + pw / 2, py + 46, {
        scale: s, facing: 1, t: time, silhouette: locked ? '#5a4a66' : null,
      });
    }
    ctx.restore();
    const name = locked || !boss ? '???' : boss.name.toUpperCase();
    drawText(ctx, measureText(name) > pw - 6 ? (boss ? boss.name.split(' ').slice(-1)[0].toUpperCase() : '???') : name,
      px + pw / 2, py + 49, { color: UI.text, shadow: false, align: 'center' });
    drawPushpin(ctx, px + pw / 2, py + 1, PIN_COLORS[2]);
    // the boss is caught once the gang's fifth case is solved
    const last = orgMissions(o)[4];
    if (!locked && last && missionStatus(state(), last.id) === 'cleared') {
      const sw = measureText('CAUGHT!', 2) + 10;
      const sx = px + Math.floor((pw - sw) / 2), sy = py + 22;
      fillRoundRect(ctx, sx, sy, sw, 20, 2, 'rgba(200, 40, 48, 0.85)');
      fillRoundRect(ctx, sx + 2, sy + 2, sw - 4, 16, 1, 'rgba(255, 240, 230, 0.9)');
      drawText(ctx, 'CAUGHT!', sx + 5, sy + 4, { size: 2, color: '#c82830', shadow: false });
    }
  }

  function drawCards(ctx: Ctx): void {
    const list = cards();
    const locked = orgLocked(org());
    // string first, from pin to pin (over the cork, under the pins)
    const pins: { x: number; y: number }[] = [];
    list.forEach((_, i) => {
      const r = cardRect(i);
      pins.push({ x: r.x + r.w / 2, y: r.y + 3 + cardOffset(i) });
    });
    // focused card drawn last so its lift and ring sit on top
    const order = list.map((_, i) => i);
    const fIdx = cardBtns.findIndex((b) => b === group.focused);
    if (fIdx >= 0) { order.splice(order.indexOf(fIdx), 1); order.push(fIdx); }
    for (const i of order) drawCard(ctx, list[i], i, locked);
    for (let i = 0; i + 1 < pins.length; i++) {
      if (cardAlpha(i) < 1 || cardAlpha(i + 1) < 1) continue;
      drawString(ctx, pins[i].x + 3, pins[i].y, pins[i + 1].x - 3, pins[i + 1].y, 3);
    }
    list.forEach((_, i) => {
      if (cardAlpha(i) <= 0) return;
      drawPushpin(ctx, pins[i].x, pins[i].y - liftOf(i), PIN_COLORS[(i + orgIdx) % PIN_COLORS.length]);
    });
  }

  /** Cards drop onto the board one after another when the gang changes. */
  function cardOffset(i: number): number {
    const t = switchT - i * 0.05;
    if (t <= 0) return -24;
    if (t >= 0.22) return 0;
    const u = t / 0.22;
    return Math.round(-24 * (1 - u) * (1 - u));
  }
  function cardAlpha(i: number): number {
    const t = switchT - i * 0.05;
    return Math.max(0, Math.min(1, t / 0.12));
  }
  function liftOf(i: number): number {
    const b = cardBtns[i];
    if (b.sink > 0) return -1;
    return b.hovered || group.focused === b ? 3 : 0;
  }

  function drawCard(ctx: Ctx, m: MissionDef, i: number, orgIsLocked: boolean): void {
    const a = cardAlpha(i);
    if (a <= 0) return;
    const base = cardRect(i);
    const b = cardBtns[i];
    const focused = group.focused === b;
    let dx = 0;
    if (wiggle.slot === i && wiggle.t > 0) dx = Math.round(Math.sin(wiggle.t * 60) * 3 * (wiggle.t / 0.4));
    const x = base.x + dx, y = base.y + cardOffset(i) - liftOf(i), w = base.w, h = base.h;
    const st: MissionStatus = orgIsLocked ? 'locked' : missionStatus(state(), m.id);
    ctx.save();
    if (a < 1) ctx.globalAlpha = a;

    // shadow, focus ring, paper
    const lifted = liftOf(i) > 0;
    fillRoundRect(ctx, x + 2, y + (lifted ? 6 : 3), w, h, 3, 'rgba(40, 20, 8, 0.35)');
    if (focused) {
      fillRoundRect(ctx, x - 3, y - 3, w + 6, h + 6, 5, INK);
      fillRoundRect(ctx, x - 2, y - 2, w + 4, h + 4, 5, Math.sin(time * 6) > 0 ? UI.focus : tint(UI.focus, 0.3));
    }
    const paper = st === 'locked' ? '#d8c9ab' : '#fff8e4';
    fillRoundRect(ctx, x, y, w, h, 3, INK);
    fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 2, 2, tint(paper, -0.12));
    fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 4, 2, b.hovered && !focused ? tint(paper, 0.3) : paper);
    // ruled lines, like an index card
    ctx.fillStyle = st === 'locked' ? '#cbb994' : '#f0dcc4';
    for (let ly = y + 66; ly < y + h - 8; ly += 12) ctx.fillRect(x + 5, ly, w - 10, 1);
    ctx.fillStyle = st === 'locked' ? '#c8a0a0' : '#f2b8b0';
    ctx.fillRect(x + 5, y + 24, w - 10, 1);
    // dog-eared corner
    ctx.fillStyle = tint(paper, -0.2);
    ctx.fillRect(x + w - 8, y + h - 4, 6, 1); ctx.fillRect(x + w - 6, y + h - 6, 4, 2); ctx.fillRect(x + w - 4, y + h - 8, 2, 2);

    const cx = x + w / 2;
    const textC = st === 'locked' ? '#7a6a58' : UI.text;
    const dimC = st === 'locked' ? '#948268' : UI.textDim;
    // CASE n and level
    drawText(ctx, `CASE ${m.index}`, x + 7, y + 12, { color: dimC, shadow: false });
    if (m.index === 5) {
      // the showdown: a tiny gold crown
      const cr = x + 7 + measureText(`CASE ${m.index}`) + 4;
      ctx.fillStyle = INK; ctx.fillRect(cr, y + 13, 9, 6);
      ctx.fillStyle = UI.gold; ctx.fillRect(cr + 1, y + 15, 7, 3);
      ctx.fillRect(cr + 1, y + 14, 1, 1); ctx.fillRect(cr + 4, y + 13, 1, 2); ctx.fillRect(cr + 7, y + 14, 1, 1);
    }
    if (!orgIsLocked) {
      const lv = `LV ${m.level}`;
      const lw = measureText(lv) + 8;
      fillRoundRect(ctx, x + w - 7 - lw, y + 10, lw, 11, 3, INK);
      fillRoundRect(ctx, x + w - 6 - lw, y + 11, lw - 2, 9, 2, st === 'locked' ? '#6a5d70' : UI.night);
      drawText(ctx, lv, x + w - 7 - lw + 4, y + 12, { color: UI.goldLight, shadow: false });
    }

    if (orgIsLocked) {
      drawText(ctx, '???', cx, y + 38, { size: 2, color: textC, shadow: false, align: 'center' });
      drawLock(ctx, cx, y + 92, 26);
      drawStamp(ctx, 'TOP SECRET', cx, y + 150, '#a8282e', 1);
      ctx.restore();
      return;
    }

    // title
    const tl = wrapText(m.title.toUpperCase(), w - 14);
    const shown = tl.slice(0, 3);
    const ty = y + 30 + (3 - shown.length) * 5;
    shown.forEach((l, k) => drawText(ctx, l, cx, ty + k * 10, { color: textC, shadow: false, align: 'center' }));

    // mission type
    const mt = getMissionType(m.type);
    ctx.save();
    if (st === 'locked') ctx.globalAlpha *= 0.55;
    drawMissionTypeIcon(ctx, m.type, cx, y + 80, 2);
    ctx.restore();
    const tname = mt.name.toUpperCase();
    drawText(ctx, tname, cx, y + 98, { color: st === 'locked' ? dimC : MISSION_TYPE_COLOR[m.type] ?? UI.text, shadow: false, align: 'center' });

    // location
    const loc = getLocation(m.location).name.toUpperCase();
    const ll = wrapText(loc, w - 16).slice(0, 2);
    ll.forEach((l, k) => {
      const lx = cx + (k === 0 ? 4 : 0);
      drawText(ctx, l, lx, y + 112 + k * 10, { color: dimC, shadow: false, align: 'center' });
      if (k === 0) drawMapPin(ctx, lx - Math.ceil(measureText(l) / 2) - 6, y + 115);
    });

    // status stamp
    const sy = y + 158;
    if (st === 'locked') {
      drawLock(ctx, cx, sy - 14, 14);
      drawStamp(ctx, 'LOCKED', cx, sy + 4, '#7a6e80', 2);
    } else if (st === 'available') {
      const bob = Math.floor(time * 3) % 2;
      drawStamp(ctx, 'NEW!', cx, sy - 2 + bob, UI.accent, 2);
    } else {
      drawStamp(ctx, 'CLEARED', cx, sy - 6, '#3e9a3a', 2);
      const clears = state().missions[m.id]?.clears ?? 1;
      const txt = clears === 1 ? 'SOLVED ONCE' : `SOLVED ${clears} TIMES`;
      const tw = measureText(txt) + 14;
      const tx = Math.round(cx - tw / 2);
      drawStars(ctx, 1, 1, tx, sy + 15);
      drawText(ctx, txt, tx + 14, sy + 16, { color: '#3e7a32', shadow: false });
    }
    ctx.restore();
  }

  function drawStamp(ctx: Ctx, text: string, cx: number, cy: number, color: string, size: number): void {
    const tw = measureText(text, size);
    const w = tw + (size > 1 ? 14 : 12), h = size > 1 ? 24 : 17;
    const x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
    fillRoundRect(ctx, x, y, w, h, 3, color);
    fillRoundRect(ctx, x + 2, y + 2, w - 4, h - 4, 2, 'rgba(255, 250, 236, 0.92)');
    ctx.fillStyle = tint(color, 0.55);
    ctx.fillRect(x + 4, y + 3, w - 8, 1);
    drawText(ctx, text, Math.round(cx - tw / 2), y + (size > 1 ? 5 : 5), { size, color, shadow: false });
  }

  function drawFooter(ctx: Ctx): void {
    if (toast.t > 0) {
      // one line in the footer strip, under the cards
      const a = Math.min(1, toast.t / 0.25);
      const w = measureText(toast.text) + 20, h = 15;
      const x = Math.round((VIEW_W - w) / 2), y = VIEW_H - 19;
      ctx.save();
      ctx.globalAlpha = a;
      fillRoundRect(ctx, x, y, w, h, 4, INK);
      fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 2, 3, UI.night);
      drawText(ctx, toast.text, VIEW_W / 2, y + 4, { color: UI.goldLight, shadowColor: UI.nightDark, align: 'center' });
      ctx.restore();
      return;
    }
    drawText(ctx, '←→ CHOOSE   ENTER OPEN CASE   1-5 GANGS   ESC BACK', VIEW_W / 2, VIEW_H - 15, {
      color: '#fff0d8', shadowColor: '#5a3a1c', align: 'center',
    });
  }
}
