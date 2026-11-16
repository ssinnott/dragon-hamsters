// Briefing + squad selection. Left: the case file (title, objective, the mission type and its
// twist), Chief Nibbles reading the briefing out (typewriter, paged when long), and the INTEL panel
// (enemy types, or the exact scouted roster on INFILTRATE missions, plus "BRING:" counter types).
// Right: every dragon in the burrow as a row (mini sprite, name, level, HP, energy, types, a 1-3
// star grade against the intel, and why it cannot go if it cannot), up to three picked in
// send-out order, AUTO-PICK, the rewards on offer, and LAUNCH.
//
// Keyboard: the dragon list and the buttons take turns with the arrow keys. In the list, Up/Down
// move and Enter/Space adds or removes a dragon; Down past the last row (or Left) moves to the
// buttons, and Up from the bottom buttons comes back. Hotkeys: A auto-pick, L launch, M more
// briefing, T type chart, Esc back.
import { drawText, measureText } from '../../lib/engine/text.ts';
import {
  getMission, getMissionType, getOrg, getSpecies, getVillain, isFood,
} from '../../data/index.ts';
import type { MissionId, MissionNode, TypeId, VillainId } from '../../data/schema.ts';
import { canLaunch, intelTypes, startMission } from '../../game/missions.ts';
import { dragonName, dragonStats, dragonTypes, findDragon } from '../../game/dragons.ts';
import { MISSION_ENERGY, SQUAD_SIZE, type OwnedDragon } from '../../game/types.ts';
import { GRADE_LABELS, counterTypes, intelGrade } from '../../battle/matchup.ts';
import { drawDragon, dragonHeight, type Pose } from '../../art/dragon.ts';
import { sfx, music } from '../../audio/index.ts';
import { app } from '../app.ts';
import type { Scene } from '../scene.ts';
import type { Input } from '../input.ts';
import {
  ButtonGroup, ScrollList, Typewriter, UI, VIEW_W, drawBar, drawHpBar, drawInset, drawPanel, drawSelection, drawStars,
  drawTypeBadge, drawTypeBadges, drawTypewriter, fillRoundRect, hit, tint, typeBadgeWidth, typeBadgesWidth, wrapText,
  type Button, type Rect,
} from '../widgets.ts';
import {
  MISSION_TYPE_COLOR, blitSprite, drawCoinIcon, drawFoodIcon, drawItemIcon, drawMissionTypeIcon, drawOrgEmblem, pixelSprite,
} from '../icons.ts';
import { CHIEF_PORTRAIT_SIZE, drawChiefPortrait } from '../chief.ts';

type Ctx = CanvasRenderingContext2D;
const INK = UI.ink;

// ---------------------------------------------------------------------------------------------
// Pixel icons (fill masks; an ink outline is added around each)
// ---------------------------------------------------------------------------------------------

const TARGET_ROWS = ['..rrrrr..', '.rwwwwwr.', 'rwrrrrrwr', 'rwrwwwrwr', 'rwrwrwrwr', 'rwrwwwrwr', 'rwrrrrrwr', '.rwwwwwr.', '..rrrrr..'];
const BOLT_ROWS = ['..yyy', '.yyy.', '.yy..', 'yyyyy', '..yy.', '.yy..', '.y...'];

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type Reason = 'FAINTED' | 'TIRED' | 'HUNGRY' | 'BUSY';

/** Why canLaunch would refuse this dragon on its own (null: it can go). */
function reasonOf(missionId: MissionId, d: OwnedDragon): Reason | null {
  const c = canLaunch(app.state, missionId, [d.id]);
  if (c.ok) return null;
  const r = (c.reason ?? '').toUpperCase();
  if (r.includes('FAINT')) return 'FAINTED';
  if (r.includes('TIRED')) return 'TIRED';
  if (r.includes('HUNGRY')) return 'HUNGRY';
  if (d.hp <= 0) return 'FAINTED';
  if (d.needs.energy < MISSION_ENERGY) return 'TIRED';
  if (d.needs.fullness <= 0) return 'HUNGRY';
  return 'BUSY';
}

const REASON_FILL: Record<Reason, string> = { FAINTED: '#e04f45', TIRED: '#7f8fb8', HUNGRY: '#f39c3a', BUSY: '#8f8170' };

function reasonHint(name: string, r: Reason): string {
  switch (r) {
    case 'FAINTED': return `${name} has fainted. A nap in the Cozy Nest will fix that!`;
    case 'TIRED': return `${name} is too tired. A nap in the Cozy Nest will perk them up!`;
    case 'HUNGRY': return `${name} is too hungry to go. Visit the Snack Bar first!`;
    default: return `${name} can't go right now.`;
  }
}

/** Every enemy the mission fields (all branch routes), as villain + level, without repeats. */
function scoutedRoster(missionId: MissionId): { villain: VillainId; level: number; boss: boolean }[] {
  const out: { villain: VillainId; level: number; boss: boolean }[] = [];
  const walk = (nodes: readonly MissionNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'battle' || n.kind === 'boss') {
        n.encounter.enemies.forEach((e, i) => {
          const boss = n.kind === 'boss' && i === n.encounter.enemies.length - 1;
          if (!out.some((o) => o.villain === e.villain && o.level === e.level)) out.push({ villain: e.villain, level: e.level, boss });
        });
      } else if (n.kind === 'branch') {
        for (const o of n.options) walk(o.nodes);
      }
    }
  };
  walk(getMission(missionId).nodes);
  return out;
}

function drawPixelText(ctx: Ctx, text: string, x: number, y: number, color: string, opts: { align?: 'left' | 'center' | 'right'; shadow?: string } = {}): number {
  return drawText(ctx, text, x, y, { color, align: opts.align, shadow: !!opts.shadow, shadowColor: opts.shadow });
}

/** A dragon drawn about `h` px tall with its feet at (x, y), clipped to `clip`. */
function drawMini(ctx: Ctx, d: OwnedDragon, x: number, y: number, h: number, t: number, clip: Rect, opts: { pose?: Pose; poseT?: number; alpha?: number } = {}): void {
  const v = getSpecies(d.speciesId).visual;
  const s = Math.max(0.3, Math.min(1.1, h / Math.max(1, dragonHeight(v, 1))));
  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.w, clip.h);
  ctx.clip();
  drawDragon(ctx, v, Math.round(x), Math.round(y), { scale: s, facing: 1, t, pose: opts.pose ?? 'idle', poseT: opts.poseT ?? 0, alpha: opts.alpha ?? 1 });
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

const LX = 8, LW = 316;
const RX = 332, RW = 300;
const SQUAD_PANEL: Rect = { x: RX, y: 9, w: RW, h: 276 };
const PADS_Y = 18;
const LIST: Rect = { x: RX + 8, y: 54, w: RW - 16, h: 224 };
const ROW_H = 32;
const REWARDS: Rect = { x: RX, y: 297, w: RW, h: 28 };
const BTN_Y = 331, BTN_H = 23;
const padRect = (i: number): Rect => ({ x: RX + 8 + i * 34, y: PADS_Y, w: 30, h: 30 });

// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

export function createBriefingScene(missionId: MissionId): Scene {
  const def = getMission(missionId);
  const org = getOrg(def.org);
  const mtype = getMissionType(def.type);
  const intel = intelTypes(missionId);
  const flatIntel: TypeId[] = [];
  for (const set of intel) for (const t of set) if (!flatIntel.includes(t)) flatIntel.push(t);
  const counters = counterTypes(intel.flat());
  const roster = def.type === 'infiltrate' ? scoutedRoster(missionId) : [];
  const firstClear = (app.state.missions[missionId]?.clears ?? 0) <= 0;

  // dragons: the ones who can go first, best matchup first, then by level
  const gradeOf = new Map<string, 1 | 2 | 3>();
  const reasons = new Map<string, Reason | null>();
  const refresh = (): void => {
    for (const d of app.state.dragons) {
      gradeOf.set(d.id, intelGrade(dragonTypes(d), d.moves, intel));
      reasons.set(d.id, reasonOf(missionId, d));
    }
  };
  refresh();
  const dragons: OwnedDragon[] = [...app.state.dragons].sort((a, b) => {
    const ra = reasons.get(a.id) ? 1 : 0, rb = reasons.get(b.id) ? 1 : 0;
    return ra - rb || (gradeOf.get(b.id) ?? 2) - (gradeOf.get(a.id) ?? 2) || b.level - a.level;
  });
  const squad: string[] = app.state.squad.filter((id) => !!findDragon(app.state, id) && !reasons.get(id)).slice(0, SQUAD_SIZE);

  let time = 0;
  let zone: 'list' | 'buttons' = dragons.length ? 'list' : 'buttons';
  let hint: { text: string; warn: boolean; t: number } = { text: '', warn: false, t: 0 };
  const addedAt = new Map<string, number>();
  let shake = { id: '', t: 0 };
  let launched = false;

  // --- Chief's briefing, paged to fit the box -----------------------------------------------
  const fast = app.state.settings?.fastText !== false;
  const tw = new Typewriter(fast ? 72 : 42);
  let blips = 0;
  tw.onChar = () => { blips++; if (blips % 3 === 0) sfx('click', { volume: 0.2, pitch: 0.62 }); };
  const twistLines = wrapText(mtype.twist, LW - 58);
  const typeH = Math.max(40, 22 + Math.min(3, twistLines.length) * 10);
  const typeY = 68;
  const briefY = typeY + typeH + 11;
  const INTEL_Y = 234;
  const briefH = INTEL_Y - 12 - briefY;
  const textX = LX + 8 + CHIEF_PORTRAIT_SIZE + 8;
  const textW = LX + LW - 10 - textX;
  const linesPerPage = Math.max(3, Math.floor((briefH - 12) / 10));
  // pages break between sentences when they can (a sentence too long for one page splits by line)
  const pages: string[] = [];
  {
    const fits = (t: string): boolean => wrapText(t, textW).length <= linesPerPage;
    const sentences = def.briefing.match(/[^.!?]+[.!?]+["']?\s*|[^.!?]+$/g) ?? [def.briefing];
    let cur = '';
    for (const raw of sentences) {
      const sent = raw.trim();
      if (!sent) continue;
      const cand = cur ? `${cur} ${sent}` : sent;
      if (fits(cand)) { cur = cand; continue; }
      if (cur) pages.push(cur);
      if (fits(sent)) { cur = sent; continue; }
      const lines = wrapText(sent, textW);
      for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage).join('\n'));
      cur = '';
    }
    if (cur) pages.push(cur);
    if (!pages.length) pages.push('');
  }
  let page = 0;
  tw.set(pages[0]);

  // --- the dragon list ----------------------------------------------------------------------
  const list = new ScrollList<OwnedDragon>({
    rect: LIST,
    rowH: ROW_H,
    items: () => dragons,
    drawRow: (ctx, d, r, selected, hovered) => drawRow(ctx, d, r, selected, hovered),
    // a click (not a drag) toggles the dragon in or out of the squad
    onClick: (d) => { zone = 'list'; toggle(d); },
    empty: 'No dragons in the burrow yet!',
  });
  list.keyboard = false;
  list.selected = 0;

  // --- buttons ------------------------------------------------------------------------------
  const group = new ButtonGroup();
  const canGo = (): { ok: boolean; reason?: string } => canLaunch(app.state, missionId, squad);
  const moreBtn = group.add({
    label: pages.length > 1 ? 'MORE ▶' : 'AGAIN', rect: { x: LX + 8, y: briefY + 74, w: CHIEF_PORTRAIT_SIZE, h: 14 }, hotkey: 'm',
    color: UI.panelLight,
    onClick: () => {
      sfx('click');
      if (!tw.done) { tw.skip(); return; }
      page = (page + 1) % pages.length;
      tw.set(pages[page]);
    },
  });
  const typesBtn = group.add({
    label: '? TYPES', rect: { x: LX + LW - 66, y: INTEL_Y + 6, w: 58, h: 16 }, hotkey: 't', color: UI.panelLight,
    onClick: () => { sfx('click'); app.nav.typeChart({ attack: counters, defend: flatIntel }); },
  });
  const backBtn = group.add({
    label: '← BACK', rect: { x: RX, y: BTN_Y, w: 62, h: BTN_H }, hotkey: 'Escape',
    onClick: () => { sfx('back'); app.scenes.pop(); },
  });
  const autoBtn = group.add({
    label: 'AUTO-PICK', rect: { x: RX + 68, y: BTN_Y, w: 92, h: BTN_H }, hotkey: 'a', color: UI.info,
    enabled: () => dragons.some((d) => !reasons.get(d.id)),
    onClick: () => autoPick(),
  });
  const launchBtn = group.add({
    label: 'LAUNCH ▶', rect: { x: RX + 166, y: BTN_Y, w: RW - 166, h: BTN_H }, hotkey: 'l', color: UI.accent, size: 2,
    enabled: () => !launched && canGo().ok,
    onClick: () => launch(),
  });
  const leftButtons: Button[] = [moreBtn, typesBtn];
  const bottomButtons: Button[] = [backBtn, autoBtn, launchBtn];
  const focusOn = (b: Button): void => { const i = group.buttons.indexOf(b); if (i >= 0) group.focus = i; };
  focusOn(launchBtn);

  function say(text: string, warn = false): void { hint = { text, warn, t: 4 }; }

  function toggle(d: OwnedDragon): void {
    const name = dragonName(d);
    const at = squad.indexOf(d.id);
    if (at >= 0) {
      squad.splice(at, 1);
      sfx('back', { volume: 0.8 });
      say(`${name} stays home this time.`);
      return;
    }
    const r = reasons.get(d.id);
    if (r) {
      sfx('error');
      shake = { id: d.id, t: 0.35 };
      say(reasonHint(name, r), true);
      return;
    }
    if (squad.length >= SQUAD_SIZE) {
      sfx('error');
      shake = { id: d.id, t: 0.35 };
      say('The squad is full! Tap a dragon in it to send it home first.', true);
      return;
    }
    squad.push(d.id);
    addedAt.set(d.id, time);
    sfx('select');
    const g = gradeOf.get(d.id) ?? 2;
    say(g === 3 ? `${GRADE_LABELS[3]} ${name} is a great pick for this case!` : g === 1 ? `${GRADE_LABELS[1]}: ${name} joins in, but this gang could give them trouble.` : `${GRADE_LABELS[2]}: ${name} is ready to go!`);
  }

  function autoPick(): void {
    const best = dragons.filter((d) => !reasons.get(d.id))
      .sort((a, b) => (gradeOf.get(b.id) ?? 2) - (gradeOf.get(a.id) ?? 2) || b.level - a.level)
      .slice(0, SQUAD_SIZE);
    squad.length = 0;
    best.forEach((d, i) => { squad.push(d.id); addedAt.set(d.id, time + i * 0.08); });
    sfx('select');
    sfx('sparkle', { volume: 0.6, delay: 0.08 });
    say(best.length ? 'Auto-picked the best matchups. Good luck, agents!' : 'Nobody is fit to go. Rest up in the Burrow first!', !best.length);
  }

  function launch(): void {
    const c = canGo();
    if (!c.ok) { sfx('error'); say(c.reason ?? 'Not yet!', true); return; }
    launched = true;
    const run = startMission(app.state, missionId, [...squad]);
    app.save();
    sfx('select');
    sfx('boss', { volume: 0.5, delay: 0.05 });
    app.nav.run(run);
  }

  // --- input --------------------------------------------------------------------------------
  function handleList(input: Input): void {
    const n = dragons.length;
    if (!n) { zone = 'buttons'; return; }
    if (input.pressed('ArrowUp')) {
      list.selected = Math.max(0, list.selected - 1);
      list.ensureVisible(list.selected);
    } else if (input.pressed('ArrowDown')) {
      if (list.selected >= n - 1) { zone = 'buttons'; focusOn(canGo().ok ? launchBtn : autoBtn); sfx('click', { volume: 0.4 }); return; }
      list.selected = Math.min(n - 1, list.selected + 1);
      list.ensureVisible(list.selected);
    } else if (input.pressed('PageDown')) {
      list.selected = Math.min(n - 1, list.selected + 6); list.ensureVisible(list.selected);
    } else if (input.pressed('PageUp')) {
      list.selected = Math.max(0, list.selected - 6); list.ensureVisible(list.selected);
    } else if (input.pressed('ArrowLeft')) {
      zone = 'buttons'; focusOn(typesBtn); sfx('click', { volume: 0.4 });
    } else if (input.pressed('ArrowRight')) {
      zone = 'buttons'; focusOn(canGo().ok ? launchBtn : autoBtn); sfx('click', { volume: 0.4 });
    } else if (input.confirm()) {
      toggle(dragons[list.selected]);
    }
  }

  return {
    name: 'briefing',
    enter() { music('burrow'); },
    resume() {
      music('burrow');
      refresh();
      for (let i = squad.length - 1; i >= 0; i--) if (!findDragon(app.state, squad[i]) || reasons.get(squad[i])) squad.splice(i, 1);
    },
    update(dt, input) {
      time += dt;
      tw.update(dt);
      if (hint.t > 0) hint.t -= dt;
      if (shake.t > 0) shake.t = Math.max(0, shake.t - dt);
      if (launched) return;
      const p = input.pointer;

      // a click on the briefing text finishes the line
      if (p.pressed && hit({ x: textX - 4, y: briefY, w: textW + 8, h: briefH }, p.x, p.y) && !tw.done) tw.skip();

      // squad pads: click one to send that dragon home
      if (p.released) {
        for (let i = 0; i < SQUAD_SIZE; i++) {
          if (!hit(padRect(i), p.x, p.y) || !squad[i]) continue;
          const d = findDragon(app.state, squad[i]);
          if (d) toggle(d);
        }
      }

      // list rows: a click (not a drag) toggles the dragon (the list's onClick)
      if (p.pressed && hit(LIST, p.x, p.y)) zone = 'list';
      list.update(input);

      // keyboard zones
      let groupKeys = zone === 'buttons';
      if (zone === 'list') {
        handleList(input);
      } else {
        const f = group.focused;
        if (input.pressed('ArrowUp') && f && bottomButtons.includes(f) && dragons.length) {
          zone = 'list'; groupKeys = false; list.ensureVisible(list.selected); sfx('click', { volume: 0.4 });
        } else if (input.pressed('ArrowRight') && f && leftButtons.includes(f) && dragons.length) {
          zone = 'list'; groupKeys = false; list.ensureVisible(list.selected); sfx('click', { volume: 0.4 });
        }
      }
      group.keyboard = groupKeys;
      group.update(input);
      group.keyboard = true;
    },
    draw(ctx) {
      drawBackdrop(ctx);
      // the case file slides in from the left, the squad sheet from the right
      const k = 1 - Math.pow(1 - Math.min(1, time / 0.28), 3);
      const slide = Math.round((1 - k) * 48);
      ctx.save();
      ctx.translate(-slide, 0);
      drawCaseHeader(ctx);
      drawTypePanel(ctx);
      drawBriefing(ctx);
      drawIntel(ctx);
      for (const b of leftButtons) b.draw(ctx, zone === 'buttons' && group.focused === b);
      ctx.restore();
      ctx.save();
      ctx.translate(slide, 0);
      drawSquadPanel(ctx);
      drawRewards(ctx);
      for (const b of bottomButtons) b.draw(ctx, zone === 'buttons' && group.focused === b);
      ctx.restore();
      if (launchBtn.isEnabled) {
        // a little shine sweeping across LAUNCH when it is ready
        const r = launchBtn.spec.rect;
        const sx = Math.floor(((time * 70) % (r.w + 60)) - 30);
        if (sx > 2 && sx < r.w - 6) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.fillRect(r.x + sx, r.y + 2 + launchBtn.sink, 3, r.h - 6);
          ctx.fillRect(r.x + sx + 5, r.y + 2 + launchBtn.sink, 1, r.h - 6);
        }
      }
    },
  };

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  function drawBackdrop(ctx: Ctx): void {
    // the agency office wall: dark plum with a faint diamond wallpaper
    ctx.fillStyle = '#2b2140';
    ctx.fillRect(0, 0, VIEW_W, 360);
    ctx.fillStyle = '#33284b';
    for (let y = 0; y < 360; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < VIEW_W; x += 16) {
      ctx.fillRect(x + 7, y + 4, 2, 8); ctx.fillRect(x + 4, y + 7, 8, 2);
    }
    ctx.fillStyle = '#241b36';
    ctx.fillRect(LX + LW + 3, 0, 2, 360);
  }

  function drawCaseHeader(ctx: Ctx): void {
    const x = LX, y = 8, w = LW, h = 54;
    drawPanel(ctx, x, y, w, h);
    drawOrgEmblem(ctx, def.org, x + 13, y + 10, 6);
    drawPixelText(ctx, `CASE ${def.index} - ${org.short.toUpperCase()}`, x + 23, y + 7, UI.textDim);
    // level pill
    const lv = `LV ${def.level}`;
    const lw = measureText(lv) + 10;
    fillRoundRect(ctx, x + w - 10 - lw, y + 5, lw, 12, 3, INK);
    fillRoundRect(ctx, x + w - 9 - lw, y + 6, lw - 2, 10, 2, UI.night);
    drawPixelText(ctx, lv, x + w - 10 - lw + 5, y + 8, UI.goldLight);
    // title: size 2 when it fits, else size 1
    const title = def.title.toUpperCase();
    if (measureText(title, 2) <= w - 20) drawText(ctx, title, x + 9, y + 19, { size: 2, color: UI.text, shadowColor: UI.panelDark });
    else drawText(ctx, wrapText(title, w - 20)[0] ?? '', x + 9, y + 22, { color: UI.text, shadowColor: UI.panelDark });
    // objective strip
    drawInset(ctx, x + 6, y + 36, w - 12, 14, { fill: '#fff2d2' });
    blitSprite(ctx, pixelSprite('target', TARGET_ROWS, { r: '#e04f45', w: '#fff6de' }), x + 15, y + 43);
    let obj = `OBJECTIVE: ${def.objective.toUpperCase()}`;
    if (measureText(obj) > w - 36) obj = def.objective.toUpperCase();
    if (measureText(obj) > w - 36) obj = wrapText(obj, w - 36)[0] ?? '';
    drawPixelText(ctx, obj, x + 24, y + 40, UI.text);
  }

  function drawTypePanel(ctx: Ctx): void {
    const x = LX, y = typeY, w = LW, h = typeH;
    drawPanel(ctx, x, y, w, h);
    drawInset(ctx, x + 6, y + 6, 36, h - 12, { fill: '#fff2d2' });
    drawMissionTypeIcon(ctx, def.type, x + 24, y + Math.floor(h / 2) - 1, 2);
    const name = `${mtype.name.toUpperCase()} MISSION`;
    drawPixelText(ctx, name, x + 50, y + 7, MISSION_TYPE_COLOR[def.type] ?? UI.text);
    const lines = twistLines.slice(0, 3);
    lines.forEach((l, i) => drawPixelText(ctx, l, x + 50, y + 19 + i * 10, UI.text));
  }

  function drawBriefing(ctx: Ctx): void {
    const x = LX, y = briefY, w = LW, h = briefH;
    drawPanel(ctx, x, y, w, h, { fill: UI.panelLight, title: 'CHIEF NIBBLES' });
    drawChiefPortrait(ctx, x + 8, y + 7, time, !tw.done);
    drawTypewriter(ctx, tw, textX, y + 9, textW, { color: UI.text, shadow: false });
    moreBtn.spec.label = !tw.done ? 'SKIP' : pages.length > 1 && page < pages.length - 1 ? 'MORE ▶' : 'AGAIN';
  }

  function drawIntel(ctx: Ctx): void {
    const x = LX, y = INTEL_Y, w = LW, h = 352 - INTEL_Y;
    drawPanel(ctx, x, y, w, h, { title: 'INTEL' });
    let cy = y + 10;
    if (def.type === 'infiltrate') {
      drawPixelText(ctx, 'SCOUTED ROSTER (EXACT!)', x + 10, cy, UI.textDim);
      cy += 13;
      const maxRows = 6;
      const rows = roster.length > maxRows ? roster.slice(0, maxRows - 1) : roster;
      for (const r of rows) {
        let v: ReturnType<typeof getVillain> | null = null;
        try { v = getVillain(r.villain); } catch { v = null; }
        const name = v ? v.name.toUpperCase() : '???';
        if (r.boss) { ctx.fillStyle = UI.gold; ctx.fillRect(x + 10, cy + 2, 3, 3); }
        drawPixelText(ctx, name, x + 16, cy + 2, r.boss ? '#a8282e' : UI.text);
        drawPixelText(ctx, `LV ${r.level}`, x + 128, cy + 2, UI.textDim);
        if (v) drawTypeBadges(ctx, v.types, x + 160, cy, { small: true });
        cy += 12;
      }
      if (roster.length > rows.length) {
        drawPixelText(ctx, `+${roster.length - rows.length} MORE`, x + 16, cy + 2, UI.textDim);
        cy += 12;
      }
    } else {
      drawPixelText(ctx, 'ENEMY TYPES SPOTTED', x + 10, cy, UI.textDim);
      cy += 12;
      // one group of badges per kind of crook, flowing in rows
      let gx = x + 10;
      const maxX = x + w - 10;
      for (const set of intel) {
        const bw = typeBadgesWidth(set, { small: true }) + 6;
        if (gx + bw > maxX) { gx = x + 10; cy += 16; }
        if (cy > y + h - 46) break;
        // a darker well per crook, so a two-type crook reads as one thing and not two
        drawInset(ctx, gx, cy, bw, 15, { fill: '#d8bd8c' });
        drawTypeBadges(ctx, set, gx + 3, cy + 2, { small: true });
        gx += bw + 6;
      }
      cy += 20;
      // who runs the show (no levels: only an INFILTRATE scouts those)
      const boss = bossOf();
      if (boss && cy + 9 < y + h - 28) {
        drawPixelText(ctx, 'LOOK OUT FOR:', x + 10, cy, UI.textDim);
        drawPixelText(ctx, boss.name.toUpperCase(), x + 10 + measureText('LOOK OUT FOR:') + 6, cy, '#a8282e');
      }
    }
    // BRING:
    const by = y + h - 24;
    drawInset(ctx, x + 6, by - 3, w - 12, 19, { fill: '#e6f2c8' });
    drawText(ctx, 'BRING:', x + 12, by + 3, { color: '#3e7a32', shadow: false });
    let bx = x + 12 + measureText('BRING:') + 6;
    for (const t of counters) {
      const bw = typeBadgeWidth(t);
      if (bx + bw > x + w - 10) break;
      drawTypeBadge(ctx, t, bx, by);
      bx += bw + 3;
    }
    if (!counters.length) drawPixelText(ctx, 'ANYONE BRAVE!', bx, by + 3, UI.textDim);
  }

  function bossOf(): ReturnType<typeof getVillain> | null {
    const walk = (nodes: readonly MissionNode[]): string | null => {
      for (const n of nodes) {
        if (n.kind === 'boss') return n.encounter.enemies[n.encounter.enemies.length - 1]?.villain ?? null;
        if (n.kind === 'branch') for (const o of n.options) { const b = walk(o.nodes); if (b) return b; }
      }
      return null;
    };
    const id = walk(def.nodes);
    if (!id) return null;
    try { return getVillain(id); } catch { return null; }
  }


  function drawSquadPanel(ctx: Ctx): void {
    const r = SQUAD_PANEL;
    drawPanel(ctx, r.x, r.y, r.w, r.h, { title: 'PICK YOUR SQUAD' });
    // the three launch pads, in send-out order
    for (let i = 0; i < SQUAD_SIZE; i++) {
      const pr = padRect(i);
      const id = squad[i];
      const d = id ? findDragon(app.state, id) : undefined;
      drawInset(ctx, pr.x, pr.y, pr.w, pr.h, { fill: d ? '#fff2d2' : '#e2cfa8' });
      if (d) {
        const since = time - (addedAt.get(d.id) ?? -9);
        const hop = since >= 0 && since < 0.45 ? Math.round(Math.sin((since / 0.45) * Math.PI) * 5) : 0;
        drawMini(ctx, d, pr.x + pr.w / 2, pr.y + pr.h - 3 - hop, 20, time, { x: pr.x + 1, y: pr.y + 1, w: pr.w - 2, h: pr.h - 2 },
          { pose: since >= 0 && since < 0.8 ? 'happy' : 'idle', poseT: Math.min(1, Math.max(0, since / 0.8)) });
      } else {
        drawText(ctx, '?', pr.x + pr.w / 2, pr.y + 11, { color: '#c4ab80', shadow: false, align: 'center' });
      }
      drawOrderTag(ctx, i + 1, pr.x + 5, pr.y + 5, !!d, 0);
    }
    // hint / status text
    const hx = padRect(2).x + 38, hw = r.x + r.w - 8 - hx;
    let text: string, color: string;
    if (hint.t > 0 && hint.text) { text = hint.text; color = hint.warn ? '#b8323a' : '#3e7a32'; }
    else if (!squad.length) { text = 'Tap up to 3 dragons. Number 1 goes into battle first.'; color = UI.textDim; }
    else {
      const c = canGo();
      text = c.ok ? `${squad.length}/${SQUAD_SIZE} ready. ${squad.length < SQUAD_SIZE ? 'Room for more, or LAUNCH!' : 'Hit LAUNCH when ready!'}` : (c.reason ?? '');
      color = c.ok ? UI.text : '#b8323a';
    }
    wrapText(text.toUpperCase(), hw).slice(0, 3).forEach((l, i) => drawPixelText(ctx, l, hx, PADS_Y + 1 + i * 10, color));

    drawInset(ctx, LIST.x - 2, LIST.y - 2, LIST.w + 4, LIST.h + 4, { fill: '#f0dcb4' });
    list.draw(ctx);
  }

  function drawOrderTag(ctx: Ctx, n: number, cx: number, cy: number, filled: boolean, pop: number): void {
    const r = 6 + pop;
    disc(ctx, cx, cy, r, INK);
    disc(ctx, cx, cy, r - 1, filled ? tint(UI.accent, -0.2) : '#b89c70');
    disc(ctx, cx, cy - 1, r - 2, filled ? UI.accent : '#cdb48a');
    drawText(ctx, String(n), cx - 2, cy - 3, { color: filled ? '#ffffff' : '#8f7656', shadow: filled, shadowColor: tint(UI.accent, -0.5) });
  }

  function disc(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
    ctx.fillStyle = color;
    for (let dy = -r; dy <= r; dy++) {
      const hw = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.8));
      ctx.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
    }
  }

  function drawRow(ctx: Ctx, d: OwnedDragon, r: Rect, selected: boolean, hovered: boolean): void {
    const reason = reasons.get(d.id) ?? null;
    const at = squad.indexOf(d.id);
    let x = r.x;
    if (shake.id === d.id && shake.t > 0) x += Math.round(Math.sin(shake.t * 55) * 3 * (shake.t / 0.35));
    const row: Rect = { x, y: r.y + 1, w: r.w, h: r.h - 2 };
    if (at >= 0) fillRoundRect(ctx, row.x + 1, row.y, row.w - 2, row.h, 3, 'rgba(239, 125, 79, 0.18)');
    drawSelection(ctx, row, selected && zone === 'list', hovered);
    if (selected && zone !== 'list') fillRoundRect(ctx, row.x + 1, row.y + 1, row.w - 2, row.h - 2, 2, 'rgba(255, 233, 168, 0.35)');
    const dim = !!reason;
    const textC = dim ? UI.disabledText : UI.text;

    // send-out order tag
    if (at >= 0) {
      const since = time - (addedAt.get(d.id) ?? -9);
      const pop = since >= 0 && since < 0.2 ? Math.round(2 * Math.sin((since / 0.2) * Math.PI)) : 0;
      drawOrderTag(ctx, at + 1, x + 8, row.y + 15, true, pop);
    }
    // sprite
    const since = time - (addedAt.get(d.id) ?? -9);
    const pose: Pose = reason === 'TIRED' ? 'sleep' : reason === 'FAINTED' ? 'hurt' : since >= 0 && since < 0.8 && at >= 0 ? 'happy' : 'idle';
    drawMini(ctx, d, x + 31, row.y + row.h - 3, 21, time + d.level * 0.37, { x: x + 15, y: row.y, w: 32, h: row.h },
      { pose, poseT: pose === 'hurt' ? 0.5 : pose === 'happy' ? Math.min(1, since / 0.8) : 0, alpha: reason === 'FAINTED' ? 0.55 : 1 });

    // line 1: name, level | reason tag, stars
    const tx = x + 50;
    const name = dragonName(d).toUpperCase();
    drawPixelText(ctx, name, tx, row.y + 4, textC);
    drawPixelText(ctx, `LV${d.level}`, tx + measureText(name) + 5, row.y + 4, dim ? UI.disabledText : UI.textDim);
    const starsX = x + r.w - 35;
    drawStars(ctx, gradeOf.get(d.id) ?? 2, 3, starsX, row.y + 3);
    if (reason) {
      const tw2 = measureText(reason) + 8;
      const rx = starsX - 4 - tw2;
      fillRoundRect(ctx, rx, row.y + 2, tw2, 11, 3, INK);
      fillRoundRect(ctx, rx + 1, row.y + 3, tw2 - 2, 9, 2, REASON_FILL[reason]);
      drawText(ctx, reason, rx + 4, row.y + 4, { color: '#ffffff', shadow: true, shadowColor: tint(REASON_FILL[reason], -0.5) });
    }
    // line 2: types | HP, energy
    drawTypeBadges(ctx, dragonTypes(d), tx, row.y + 15, { small: true });
    const max = dragonStats(d).hp;
    const ex = x + r.w - 44;
    drawHpBar(ctx, ex - 58, row.y + 16, 54, d.hp, max);
    blitSprite(ctx, pixelSprite('bolt', BOLT_ROWS, { y: '#ffd84a' }), ex + 2, row.y + 20);
    const en = Math.max(0, Math.min(100, d.needs.energy)) / 100;
    drawBar(ctx, ex + 8, row.y + 17, 34, 7, en, d.needs.energy < MISSION_ENERGY ? UI.hpRed : '#f6d04a');
  }

  function drawRewards(ctx: Ctx): void {
    const r = REWARDS;
    drawPanel(ctx, r.x, r.y, r.w, r.h, { title: firstClear ? 'REWARDS' : 'REWARDS (REPLAY)' });
    const cy = r.y + 14;
    // a mystery dragon (right-aligned), if the pool still has species you don't own
    let rightEdge = r.x + r.w - 10;
    const dr = def.rewards.dragon;
    if (dr && dr.species.length) {
      const have = new Set<string>([...app.state.dex.owned, ...app.state.dragons.map((d) => d.speciesId)]);
      const left = dr.species.filter((s) => !have.has(s));
      if (left.length) {
        const chance = Math.min(1, dr.chance * (firstClear ? 1 : 0.5));
        const txt = `DRAGON: ? ${Math.round(chance * 100)}%`;
        const dx = r.x + r.w - 10 - measureText(txt);
        // a silhouette of one of the dragons it could be
        let v: ReturnType<typeof getSpecies>['visual'] | null = null;
        try { v = getSpecies(left[Math.floor(time / 1.5) % left.length]).visual; } catch { v = null; }
        if (v) {
          const s = Math.min(0.6, 15 / Math.max(1, dragonHeight(v, 1)));
          ctx.save();
          ctx.beginPath(); ctx.rect(dx - 24, r.y + 3, 22, r.h - 5); ctx.clip();
          drawDragon(ctx, v, dx - 13, r.y + r.h - 5, { scale: s, t: time, silhouette: '#5a4a66' });
          ctx.restore();
        }
        drawText(ctx, txt, dx, cy - 3, { color: '#7a3aa0', shadow: false });
        rightEdge = dx - 28;
      }
    }
    // coins (infiltrate pays +50%, replays pay half)
    let x = r.x + 10;
    let pay = def.rewards.coins;
    if (def.type === 'infiltrate') pay *= 1.5;
    if (!firstClear) pay *= 0.5;
    pay = Math.floor(pay);
    drawCoinIcon(ctx, x + 5, cy, 5);
    x += 13;
    x += drawText(ctx, String(pay), x, cy - 3, { color: UI.text, shadow: false }) + 8;
    // items and food, as many as fit
    for (const it of def.rewards.items) {
      const label = `X${it.qty}`;
      if (x + 14 + measureText(label) > rightEdge) break;
      if (isFood(it.id)) drawFoodIcon(ctx, it.id, x + 6, cy, 13);
      else drawItemIcon(ctx, it.id, x + 6, cy, 13);
      x += 14;
      x += drawText(ctx, label, x, cy - 3, { color: UI.textDim, shadow: false }) + 7;
    }
  }
}

