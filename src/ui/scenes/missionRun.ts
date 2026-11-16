// The mission path: the location's blueprint with the node trail drawn across it (battles, rest
// stops, branches, story beats and the boss), the squad walking from stop to stop, and the squad's
// health along the bottom. Between stops the player presses GO for the next one, or RETREATs.
//
// Flow per node: story -> a dialog, then on; rest -> its text, applyRest and a heal sparkle on each
// squad dragon, then on; branch -> a choice panel, chooseBranch; battle / boss -> the encounter's
// intro and the villain's banter in a dialog, then nav.battle. The battle scene pops itself and
// calls onEnd; the outcome is handled on the next update once this scene is on top again (so it
// works whichever order pop/resume and onEnd arrive in).
import { drawText, measureText } from '../../lib/engine/text.ts';
import { getLocation, getMission, getSpecies, getVillain } from '../../data/index.ts';
import type { MissionNode, VillainDef } from '../../data/schema.ts';
import {
  abandonMission, advance, applyRest, bossSupercharge, chooseBranch, completeMission, currentNode, type MissionRun,
} from '../../game/missions.ts';
import { dragonName, dragonStats, findDragon } from '../../game/dragons.ts';
import { drawMapBackdrop } from '../../art/backdrops.ts';
import { drawDragon, dragonHeight, type Pose } from '../../art/dragon.ts';
import { createFx } from '../../art/fx.ts';
import { sfx, music } from '../../audio/index.ts';
import { app } from '../app.ts';
import type { Scene } from '../scene.ts';
import {
  ButtonGroup, UI, VIEW_W, drawHpBar, drawPanel, drawStatusBadge, drawTypeBadges, fillRoundRect, tint, wrapText,
  type Button, type Rect,
} from '../widgets.ts';
import {
  MISSION_NODE_FILL, blitSprite, drawOrgEmblem, drawTickIcon, missionNodeSprite, type MissionNodeKind,
} from '../icons.ts';

type Ctx = CanvasRenderingContext2D;
const INK = UI.ink;

// ---------------------------------------------------------------------------------------------
// Pixel icons (fill masks; an ink outline is added around each)
// ---------------------------------------------------------------------------------------------

type NodeKind = MissionNodeKind;

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

const TRAIL_X0 = 74, TRAIL_X1 = 584;
const UP_Y = 104, DOWN_Y = 152;
const ACTION: Rect = { x: 112, y: 214, w: 416, h: 46 };
/** Each enemy line in the action panel; a panel with more than two grows upwards by this much per line. */
const ENEMY_LINE_H = 13;
const SQUAD_Y = 270;
const cardRect = (i: number): Rect => ({ x: 10 + i * 210, y: SQUAD_Y, w: 200, h: 80 });

interface Pt { x: number; y: number }

const ease = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

export function createMissionRunScene(run: MissionRun): Scene {
  const def = getMission(run.missionId);
  const loc = getLocation(def.location);
  const fx = createFx();

  type Phase = 'walk' | 'idle' | 'rest' | 'branch' | 'away' | 'leaving';
  let phase: Phase = 'walk';
  let time = 0;
  let pending: 'won' | 'lost' | 'retreated' | null = null;
  let restLines: string[] = [];
  let restText = '';
  let finished = false;

  // walking: the squad's position along the trail, in node units (2.0 = standing at node 2)
  /** The leader stands this far (px) before the stop; the others follow this far apart. */
  const STAND_PX = 23, FOLLOW_PX = 13;
  const standAt = (i: number): number => i - STAND_PX / Math.max(40, spacing());
  let walkFrom = -1.4, walkTo = 0, walkT = 0, walkDur = 1.1;
  let squadPos = walkFrom;

  // displayed HP per dragon (eases toward the real value, so heals fill up visibly)
  const shownHp = new Map<string, number>();
  const hopAt = new Map<string, number>();
  for (const id of run.squad) { const d = findDragon(app.state, id); if (d) shownHp.set(id, d.hp); }

  // the trail's layout, animated when a branch splices in new stops
  let layoutFrom: Pt[] = [];
  let layoutT = 1;
  const target = (): Pt[] => computeLayout(run.nodes.length);
  let layout: Pt[] = target();
  walkTo = standAt(run.index);

  function hasOpenBranch(): boolean { return run.nodes.some((n) => n.kind === 'branch'); }

  function computeLayout(n: number): Pt[] {
    const span = TRAIL_X1 - TRAIL_X0;
    const step = n > 1 ? span / (n - 1) : 0;
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) pts.push({ x: Math.round(n === 1 ? (TRAIL_X0 + TRAIL_X1) / 2 : TRAIL_X0 + i * step), y: i % 2 ? DOWN_Y : UP_Y });
    return pts;
  }

  function nodePos(i: number): Pt {
    const to = layout[i];
    if (!to) return { x: TRAIL_X1, y: UP_Y };
    if (layoutT >= 1 || !layoutFrom[i]) return to;
    const u = ease(layoutT);
    return { x: layoutFrom[i].x + (to.x - layoutFrom[i].x) * u, y: layoutFrom[i].y + (to.y - layoutFrom[i].y) * u };
  }

  /** Point on the trail at a fractional node index (extrapolated before the first stop). */
  function trailPoint(s: number): Pt {
    const n = run.nodes.length;
    if (n === 0) return { x: TRAIL_X0, y: UP_Y };
    if (s <= 0) {
      // along the lead-in curve from the left edge, then straight on off-screen
      const p0 = nodePos(0);
      const step = Math.max(40, spacing());
      const L = leadIn();
      const span = Math.max(0.01, (p0.x - L.x) / step);
      if (s >= -span) return bez(L, ctrl(L, p0), p0, 1 + s / span);
      return { x: L.x + (s + span) * step, y: L.y };
    }
    const i = Math.min(n - 1, Math.floor(s));
    if (i >= n - 1) return nodePos(n - 1);
    const a = nodePos(i), b = nodePos(i + 1);
    return bez(a, ctrl(a, b), b, s - i);
  }

  function bez(a: Pt, c: Pt, b: Pt, u: number): Pt {
    return {
      x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * c.x + u * u * b.x,
      y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * c.y + u * u * b.y,
    };
  }

  function leadIn(): Pt {
    const p0 = nodePos(0);
    return { x: 4, y: p0.y + 30 };
  }

  function ctrl(a: Pt, b: Pt): Pt {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + (a.y < b.y ? -14 : 14) };
  }

  // --- buttons --------------------------------------------------------------------------------
  const group = new ButtonGroup();
  const goBtn = group.add({
    label: 'GO!', rect: { x: ACTION.x + ACTION.w - 124, y: ACTION.y + 9, w: 114, h: 28 }, size: 2, color: UI.accent,
    visible: () => phase === 'idle', onClick: () => go(),
  });
  group.add({
    label: 'RETREAT', rect: { x: VIEW_W - 92, y: 10, w: 82, h: 22 }, hotkey: 'Escape', color: '#d4685a',
    visible: () => phase === 'idle', onClick: () => askRetreat(),
  });
  const restBtn = group.add({
    label: 'BACK ON THE TRAIL ▶', rect: { x: 0, y: 0, w: 150, h: 22 }, color: UI.good,
    visible: () => phase === 'rest', onClick: () => leaveRest(),
  });
  const branchBtns: Button[] = [0, 1].map((k) => group.add({
    label: '', rect: { x: 0, y: 0, w: 10, h: 10 }, align: 'left', hotkey: String(k + 1), color: k ? '#bfe0ff' : '#ffd0b8',
    visible: () => phase === 'branch' && !!branchNode()?.options[k], onClick: () => pickBranch(k),
  }));
  const focusOn = (b: Button): void => { const i = group.buttons.indexOf(b); if (i >= 0) group.focus = i; };

  function branchNode(): Extract<MissionNode, { kind: 'branch' }> | null {
    const n = currentNode(run);
    return n && n.kind === 'branch' ? n : null;
  }

  function startWalk(to: number, dur = 0.9): void {
    walkFrom = squadPos;
    walkTo = to;
    walkT = 0;
    walkDur = dur;
    phase = 'walk';
  }

  function arrive(): void {
    if (run.index >= run.nodes.length) { finish(); return; }
    const node = currentNode(run);
    if (node?.kind === 'story') {
      phase = 'away';
      app.nav.dialog([node.text], () => { advance(run); app.save(); nextStop(); });
      return;
    }
    phase = 'idle';
    focusOn(goBtn);
    sfx('click', { volume: 0.5, pitch: 1.3 });
  }

  function nextStop(): void {
    if (run.index >= run.nodes.length) { finish(); return; }
    startWalk(standAt(run.index));
  }

  function go(): void {
    const node = currentNode(run);
    if (!node) { finish(); return; }
    switch (node.kind) {
      case 'story':
        phase = 'away';
        app.nav.dialog([node.text], () => { advance(run); app.save(); nextStop(); });
        break;
      case 'rest': {
        sfx('heal');
        const before = new Map(run.squad.map((id) => [id, findDragon(app.state, id)?.hp ?? 0]));
        restLines = applyRest(app.state, run);
        restText = node.text;
        app.save();
        run.squad.forEach((id, i) => {
          const d = findDragon(app.state, id);
          if (!d) return;
          const r = cardRect(i);
          const p = { x: r.x + 34, y: r.y + 42 };
          fx.move('heal', p, p, 'LEAF');
          const gained = d.hp - (before.get(id) ?? d.hp);
          if (gained > 0) fx.floatText(p.x + 4, p.y - 18, `+${gained}`, '#7dff7a');
          hopAt.set(id, time + i * 0.12);
        });
        sfx('sparkle', { delay: 0.25, volume: 0.7 });
        phase = 'rest';
        layoutRestButton();
        focusOn(restBtn);
        break;
      }
      case 'branch':
        sfx('select');
        phase = 'branch';
        layoutBranchButtons();
        focusOn(branchBtns[0]);
        break;
      case 'battle':
      case 'boss': {
        const enc = node.encounter;
        const lead = villainOf(node.kind === 'boss' ? enc.enemies[enc.enemies.length - 1]?.villain : enc.enemies[0]?.villain);
        const lines = [enc.intro];
        if (lead?.taunt) lines.push(`${lead.name.toUpperCase()}: "${lead.taunt}"`);
        phase = 'away';
        sfx(node.kind === 'boss' ? 'boss' : 'select');
        app.nav.dialog(lines, () => {
          app.nav.battle(run, (outcome) => { pending = outcome; });
        });
        break;
      }
    }
  }

  function leaveRest(): void {
    sfx('click');
    advance(run);
    app.save();
    nextStop();
  }

  function pickBranch(k: number): void {
    const node = branchNode();
    if (!node || !node.options[k]) return;
    sfx('select');
    layoutFrom = run.nodes.map((_, i) => nodePos(i));
    chooseBranch(run, k);
    app.save();
    layout = target();
    // the new stops slide in from where the branch stood
    const at = layoutFrom[run.index] ?? layout[run.index];
    for (let i = run.index; i < run.nodes.length; i++) if (!layoutFrom[i] || i > run.index) layoutFrom[i] = { ...at };
    layoutT = 0;
    // settle in front of the first stop of the chosen route (it may be a story beat)
    startWalk(standAt(run.index), 0.45);
  }

  function askRetreat(): void {
    sfx('click');
    app.nav.confirm('Retreat and head back to the Burrow? You keep the XP you earned, but no rewards.', () => {
      abandonMission(app.state, run);
      app.save();
      phase = 'leaving';
      app.nav.burrow();
    }, () => { focusOn(goBtn); });
  }

  function finish(): void {
    if (finished) return;
    finished = true;
    phase = 'leaving';
    const rewards = completeMission(app.state, run);
    app.save();
    app.nav.results(run, rewards);
  }

  function handleOutcome(o: 'won' | 'lost' | 'retreated'): void {
    if (o === 'retreated' || run.outcome === 'retreated') {
      abandonMission(app.state, run);
      app.save();
      phase = 'leaving';
      app.nav.burrow();
      return;
    }
    if (o === 'lost' || run.outcome === 'lost') {
      app.save();
      phase = 'leaving';
      app.nav.results(run, null);
      return;
    }
    // won: on to the next stop
    advance(run);
    app.save();
    sfx('coin', { volume: 0.6 });
    const p = trailPoint(squadPos);
    fx.burst(p.x, p.y - 16, UI.gold, 14);
    run.squad.forEach((id, i) => hopAt.set(id, time + i * 0.1));
    nextStop();
  }

  function layoutRestButton(): void {
    const r = restPanelRect();
    restBtn.spec.rect = { x: r.x + r.w - 160, y: r.y + r.h - 30, w: 150, h: 22 };
  }

  function restPanelRect(): Rect {
    const lines = restBodyLines();
    const h = 38 + lines.length * 10 + 34;
    return { x: 150, y: Math.max(48, 200 - h), w: 340, h };
  }

  function restBodyLines(): string[] {
    const out = wrapText(restText.toUpperCase(), 316);
    out.push('');
    for (const l of restLines) out.push(...wrapText(l.toUpperCase(), 316));
    return out;
  }

  function branchPanelRect(): Rect { return { x: 70, y: 58, w: 500, h: 138 }; }

  function layoutBranchButtons(): void {
    const r = branchPanelRect();
    branchBtns.forEach((b, k) => { b.spec.rect = { x: r.x + 12 + k * 242, y: r.y + 52, w: 234, h: 64 }; });
  }

  function villainOf(id: string | undefined): VillainDef | null {
    if (!id) return null;
    try { return getVillain(id); } catch { return null; }
  }

  const scene: Scene = {
    name: 'missionRun',
    enter() {
      music('mission');
    },
    resume() {
      // back from a dialog, the battle, the confirm box or an evolution: the battle music stops,
      // and the HP bars pick up whatever happened while we were away
      music('mission');
      if (phase === 'idle') focusOn(goBtn);
    },
    update(dt, input) {
      time += dt;
      fx.update(dt);
      if (layoutT < 1) layoutT = Math.min(1, layoutT + dt / 0.45);
      for (const id of run.squad) {
        const d = findDragon(app.state, id);
        if (!d) continue;
        const cur = shownHp.get(id) ?? d.hp;
        const diff = d.hp - cur;
        shownHp.set(id, Math.abs(diff) < 0.5 ? d.hp : cur + diff * Math.min(1, dt * 5));
      }

      if (pending && app.scenes.top() === scene && !app.scenes.busy) {
        const o = pending;
        pending = null;
        handleOutcome(o);
        return;
      }
      if (phase === 'leaving' || phase === 'away') return;

      if (phase === 'walk') {
        walkT += dt;
        const u = Math.min(1, walkT / walkDur);
        squadPos = walkFrom + (walkTo - walkFrom) * ease(u);
        if (Math.floor(walkT * 6) !== Math.floor((walkT - dt) * 6) && u < 1) sfx('click', { volume: 0.12, pitch: 0.7 });
        // any key or click hurries the walk along
        if (input.confirm() || input.pointer.pressed) walkT = walkDur;
        if (u >= 1) { squadPos = walkTo; arrive(); }
        return;
      }
      if (phase === 'branch' && input.back()) { sfx('back'); phase = 'idle'; focusOn(goBtn); return; }
      if (phase === 'rest' && input.back()) { leaveRest(); return; }
      group.update(input);
      if (phase === 'idle' && input.pressed('r')) askRetreat();
    },
    draw(ctx) {
      ctx.save();
      ctx.translate(Math.round(fx.offsetX), Math.round(fx.offsetY));
      drawMapBackdrop(ctx, loc, time);
      drawTrail(ctx);
      drawSquadOnTrail(ctx);
      ctx.restore();
      drawHeader(ctx);
      if (phase === 'idle') drawAction(ctx);
      drawSquadCards(ctx);
      if (phase === 'rest' || phase === 'branch') {
        // the trail dims behind a choice or a rest, so the panel reads as the thing to answer
        ctx.fillStyle = 'rgba(27, 20, 38, 0.45)';
        ctx.fillRect(0, 0, VIEW_W, SQUAD_Y - 6);
      }
      if (phase === 'rest') drawRestPanel(ctx);
      if (phase === 'branch') drawBranchPanel(ctx);
      group.draw(ctx);
      fx.draw(ctx);
    },
  };
  return scene;

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  function drawHeader(ctx: Ctx): void {
    const title = `CASE ${def.index}: ${def.title.toUpperCase()}`;
    const size = measureText(title, 2) <= 400 ? 2 : 1;
    const w = Math.min(420, Math.max(measureText(title, size), measureText(def.objective.toUpperCase()) + 14) + 44);
    drawPanel(ctx, 8, 8, w, 38);
    drawOrgEmblem(ctx, def.org, 24, 27, 10);
    drawText(ctx, size === 2 ? title : wrapText(title, w - 50)[0] ?? '', 40, size === 2 ? 13 : 15, { size, color: UI.text, shadowColor: UI.panelDark });
    drawText(ctx, wrapText(def.objective.toUpperCase(), w - 50)[0] ?? '', 40, 33, { color: UI.textDim, shadow: false });
    // stop counter
    const total = run.nodes.length + (hasOpenBranch() ? 1 : 0);
    const shown = Math.min(run.index + 1, run.nodes.length);
    const txt = `STOP ${shown}/${hasOpenBranch() ? '?' : total}`;
    const tw = measureText(txt) + 12;
    const x = VIEW_W - 98 - tw;
    fillRoundRect(ctx, x, 13, tw, 15, 3, INK);
    fillRoundRect(ctx, x + 1, 14, tw - 2, 13, 2, UI.night);
    drawText(ctx, txt, x + 6, 17, { color: UI.goldLight, shadowColor: UI.nightDark });
  }

  function drawTrail(ctx: Ctx): void {
    const n = run.nodes.length;
    // path segments
    for (let i = 0; i + 1 < n; i++) drawSegment(ctx, nodePos(i), nodePos(i + 1), i + 1 <= run.index);
    // the lead-in from the left edge
    drawSegment(ctx, leadIn(), nodePos(0), true);
    // nodes and labels (an unchosen branch carries its own '?')
    for (let i = 0; i < n; i++) drawNode(ctx, i);
  }

  function drawSegment(ctx: Ctx, a: Pt, b: Pt, done: boolean): void {
    const c = ctrl(a, b);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(4, Math.floor(len / 7));
    for (let k = 1; k < steps; k++) {
      const u = k / steps;
      const x = (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * c.x + u * u * b.x;
      const y = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * c.y + u * u * b.y;
      const px = Math.round(x), py = Math.round(y);
      ctx.fillStyle = INK;
      ctx.fillRect(px - 2, py - 2, 5, 5);
      ctx.fillStyle = done ? '#ffd24a' : '#e8dcc8';
      ctx.fillRect(px - 1, py - 1, 3, 3);
      if (done) { ctx.fillStyle = '#fff4b0'; ctx.fillRect(px - 1, py - 1, 1, 1); }
    }
  }

  function drawNode(ctx: Ctx, i: number): void {
    const node = run.nodes[i];
    const p = nodePos(i);
    const done = i < run.index;
    const current = i === run.index;
    const big = node.kind === 'boss';
    const r = big ? 16 : current ? 15 : 13;
    const bounce = current && phase !== 'walk' ? Math.round(Math.abs(Math.sin(time * 4)) * -4) : 0;
    const x = Math.round(p.x), y = Math.round(p.y) + bounce;
    // ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + r + 2, r * 0.8, 3, 0, 0, Math.PI * 2); ctx.fill();
    if (current) {
      // a pulsing gold ring
      const pr = r + 4 + Math.round((Math.sin(time * 5) + 1) * 1.5);
      ctx.fillStyle = 'rgba(255, 228, 92, 0.25)';
      ctx.beginPath(); ctx.arc(x, y, pr + 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = UI.focus; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2); ctx.stroke();
    }
    const fill = done ? '#7a7088' : MISSION_NODE_FILL[node.kind];
    disc(ctx, x, y, r + 1, INK);
    disc(ctx, x, y, r, tint(fill, -0.25));
    disc(ctx, x, y - 1, r - 1, fill);
    disc(ctx, x - 3, y - 4, Math.max(2, r - 9), tint(fill, 0.25));
    ctx.save();
    if (done) ctx.globalAlpha = 0.6;
    blitSprite(ctx, missionNodeSprite(node.kind, time), x, y - 1);
    ctx.restore();
    if (done) drawTickIcon(ctx, x + r - 3, y + r - 5);
    // an unchosen crossroads: the route ahead is a mystery until the squad picks one
    if (node.kind === 'branch') drawQuestionBubble(ctx, x + r - 1, y - r + 1 + Math.round(Math.sin(time * 3 + i) * 1.5));
    // label: above for the high stops, below for the low ones
    const above = p.y <= (UP_Y + DOWN_Y) / 2;
    const maxW = Math.min(150, Math.max(60, spacing() * 2 - 14));
    const lines = wrapText(node.label.toUpperCase(), maxW).slice(0, 2);
    const lw = Math.max(...lines.map((l) => measureText(l))) + 8;
    const lh = lines.length * 9 + 3;
    const ly = above ? Math.round(p.y) - r - 8 - lh : Math.round(p.y) + r + 8;
    const lx = Math.round(Math.max(6, Math.min(VIEW_W - 6 - lw, p.x - lw / 2)));
    fillRoundRect(ctx, lx, ly, lw, lh, 3, current ? 'rgba(27, 20, 38, 0.92)' : 'rgba(27, 20, 38, 0.72)');
    lines.forEach((l, k) => drawText(ctx, l, lx + lw / 2, ly + 2 + k * 9, {
      color: current ? UI.goldLight : done ? '#a8a0b8' : UI.textLight, shadow: false, align: 'center',
    }));
  }

  function drawQuestionBubble(ctx: Ctx, cx: number, cy: number): void {
    disc(ctx, cx, cy, 8, INK);
    disc(ctx, cx, cy, 7, UI.gold);
    disc(ctx, cx - 2, cy - 2, 2, UI.goldLight);
    drawText(ctx, '?', cx, cy - 3, { color: INK, shadow: false, align: 'center' });
  }

  function spacing(): number {
    return run.nodes.length > 1 ? Math.abs(nodePos(1).x - nodePos(0).x) : 200;
  }

  function disc(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
    ctx.fillStyle = color;
    for (let dy = -r; dy <= r; dy++) {
      const hw = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.8));
      ctx.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
    }
  }

  function drawSquadOnTrail(ctx: Ctx): void {
    const walking = phase === 'walk';
    // back to front so the leader is drawn on top
    for (let k = run.squad.length - 1; k >= 0; k--) {
      const d = findDragon(app.state, run.squad[k]);
      if (!d) continue;
      const p = trailPoint(squadPos - (k * FOLLOW_PX) / Math.max(40, spacing()));
      const v = getSpecies(d.speciesId).visual;
      const s = Math.max(0.3, Math.min(0.9, 22 / Math.max(1, dragonHeight(v, 1))));
      const fainted = d.hp <= 0;
      const hop = hopOffset(d.id);
      const pose: Pose = fainted ? 'sleep' : walking ? 'walk' : hop ? 'happy' : 'idle';
      drawDragon(ctx, v, Math.round(p.x), Math.round(p.y) - 1 - hop, { scale: s, facing: 1, t: time + k * 0.3, pose, alpha: fainted ? 0.7 : 1 });
    }
  }

  function hopOffset(id: string): number {
    const at = hopAt.get(id);
    if (at === undefined) return 0;
    const u = (time - at) / 0.5;
    if (u < 0 || u > 1) return 0;
    return Math.round(Math.sin(u * Math.PI) * 6);
  }

  /** The action panel: taller (growing upwards) when more than two enemies wait at the stop. */
  function actionRect(node: MissionNode): Rect {
    const n = node.kind === 'battle' || node.kind === 'boss' ? node.encounter.enemies.length : 0;
    const extra = Math.max(0, n - 2) * ENEMY_LINE_H;
    return { x: ACTION.x, y: ACTION.y - extra, w: ACTION.w, h: ACTION.h + extra };
  }

  function drawAction(ctx: Ctx): void {
    const node = currentNode(run);
    if (!node) return;
    const r = actionRect(node);
    goBtn.spec.rect = { ...goBtn.spec.rect, y: Math.round(r.y + (r.h - goBtn.spec.rect.h) / 2) };
    drawPanel(ctx, r.x, r.y, r.w, r.h);
    // node token
    const ty = Math.round(r.y + r.h / 2);
    disc(ctx, r.x + 23, ty, 15, INK);
    disc(ctx, r.x + 23, ty, 14, MISSION_NODE_FILL[node.kind]);
    blitSprite(ctx, missionNodeSprite(node.kind, time), r.x + 23, ty - 1);
    const tx = r.x + 46;
    const head: Record<NodeKind, string> = {
      battle: 'NEXT: ', boss: 'SHOWDOWN: ', rest: 'REST STOP: ', branch: 'CROSSROADS: ', story: 'NEXT: ',
    };
    const maxW = goBtn.spec.rect.x - tx - 8;
    const headTxt = wrapText(head[node.kind] + node.label.toUpperCase(), maxW)[0] ?? '';
    drawText(ctx, headTxt, tx, r.y + 9, { color: node.kind === 'boss' ? '#9a2f9a' : UI.text, shadow: false });
    // a rushed sabotage: the gadget has powered the boss up (shown on the header line, where it fits)
    const stages = bossSupercharge(run, node);
    if (stages) {
      const px = tx + measureText(headTxt) + 8;
      const tag = ['BOSS POWERED UP!', 'POWERED UP!', '↑'].find((t) => px + measureText(t) <= tx + maxW) ?? '';
      drawText(ctx, tag, px, r.y + 9, { color: '#c45a1c', shadow: false });
    }
    let detail = '';
    if (node.kind === 'battle' || node.kind === 'boss') {
      // who is waiting there, one per line with their types: pick your lead accordingly (every one
      // of them: a boss fight's boss comes last, so it must never be cut off)
      const enemies = node.encounter.enemies;
      enemies.forEach((e, k) => {
        const v = villainOf(e.villain);
        if (!v) return;
        const y = r.y + 19 + k * ENEMY_LINE_H;
        const isBoss = node.kind === 'boss' && k === enemies.length - 1;
        const nm = `${v.name.toUpperCase()} LV${e.level}`;
        drawText(ctx, nm, tx, y + 2, { color: isBoss ? '#9a2f9a' : UI.textDim, shadow: false });
        const bx = tx + measureText(nm) + 4;
        drawTypeBadges(ctx, v.types, bx, y, { small: true });
      });
    } else if (node.kind === 'rest') {
      detail = `A cosy spot to heal up (${Math.round(Math.min(1, node.heal) * 100)}% HP).`;
    } else if (node.kind === 'branch') {
      detail = node.text;
    } else {
      detail = 'Something is happening...';
    }
    if (detail) wrapText(detail.toUpperCase(), maxW).slice(0, 2).forEach((l, k) => drawText(ctx, l, tx, r.y + 21 + k * 10, { color: UI.textDim, shadow: false }));
    goBtn.spec.label = node.kind === 'boss' ? 'SHOWDOWN!' : node.kind === 'battle' ? 'FIGHT!' : node.kind === 'rest' ? 'REST' : node.kind === 'branch' ? 'DECIDE' : 'GO!';
    goBtn.spec.color = node.kind === 'boss' ? '#b85ad0' : node.kind === 'rest' ? UI.good : node.kind === 'branch' ? UI.info : UI.accent;
  }

  function drawSquadCards(ctx: Ctx): void {
    run.squad.forEach((id, i) => {
      const d = findDragon(app.state, id);
      if (!d) return;
      const r = cardRect(i);
      drawPanel(ctx, r.x, r.y, r.w, r.h, { fill: UI.night, border: INK });
      // number tag
      fillRoundRect(ctx, r.x + 5, r.y + 5, 13, 13, 4, INK);
      fillRoundRect(ctx, r.x + 6, r.y + 6, 11, 11, 3, UI.accent);
      drawText(ctx, String(i + 1), r.x + 9, r.y + 8, { color: '#ffffff', shadow: false });
      // sprite on a little cushion
      fillRoundRect(ctx, r.x + 12, r.y + 58, 46, 8, 3, UI.nightLight);
      const v = getSpecies(d.speciesId).visual;
      const s = Math.max(0.4, Math.min(1.2, 36 / Math.max(1, dragonHeight(v, 1))));
      const fainted = d.hp <= 0;
      const hop = hopOffset(d.id);
      ctx.save();
      ctx.beginPath(); ctx.rect(r.x + 4, r.y + 4, 64, r.h - 8); ctx.clip();
      drawDragon(ctx, v, r.x + 35, r.y + 62 - hop, { scale: s, facing: 1, t: time + i * 0.4, pose: fainted ? 'sleep' : hop ? 'happy' : 'idle', alpha: fainted ? 0.6 : 1 });
      ctx.restore();
      // name, level, hp
      const tx = r.x + 72;
      drawText(ctx, dragonName(d).toUpperCase(), tx, r.y + 9, { color: UI.textLight, shadowColor: UI.nightDark });
      drawText(ctx, `LV ${d.level}`, tx, r.y + 21, { color: UI.textLightDim, shadow: false });
      const max = dragonStats(d).hp;
      const hp = Math.round(shownHp.get(id) ?? d.hp);
      drawHpBar(ctx, tx, r.y + 35, r.w - 82, hp, max);
      drawText(ctx, `${hp}/${max}`, r.x + r.w - 10, r.y + 48, { color: UI.textLightDim, shadow: false, align: 'right' });
      if (fainted) {
        const t = 'FAINTED';
        const w = measureText(t) + 8;
        fillRoundRect(ctx, tx, r.y + 60, w, 11, 3, INK);
        fillRoundRect(ctx, tx + 1, r.y + 61, w - 2, 9, 2, UI.bad);
        drawText(ctx, t, tx + 4, r.y + 62, { color: '#ffffff', shadowColor: tint(UI.bad, -0.5) });
      } else if (d.status) {
        drawStatusBadge(ctx, d.status, tx, r.y + 60);
      } else {
        drawText(ctx, hp >= max ? 'TIP-TOP!' : hp > max / 2 ? 'READY' : 'HANGING IN', tx, r.y + 62, {
          color: hp > max / 2 ? '#8fe08a' : UI.hpYellow, shadow: false,
        });
      }
    });
  }

  function drawRestPanel(ctx: Ctx): void {
    const r = restPanelRect();
    drawPanel(ctx, r.x, r.y, r.w, r.h, { title: 'REST STOP', fill: UI.panelLight });
    const ic = missionNodeSprite('rest', time);
    blitSprite(ctx, ic, r.x + 22, r.y + 22, 2);
    const node = currentNode(run);
    drawText(ctx, (node?.label ?? 'REST').toUpperCase(), r.x + 44, r.y + 14, { size: 1, color: UI.text, shadow: false });
    restBodyLines().forEach((l, k) => drawText(ctx, l, r.x + 12, r.y + 38 + k * 10, { color: k < wrapText(restText, 316).length ? UI.text : '#3e7a32', shadow: false }));
  }

  function drawBranchPanel(ctx: Ctx): void {
    const node = branchNode();
    if (!node) return;
    const r = branchPanelRect();
    drawPanel(ctx, r.x, r.y, r.w, r.h, { title: 'CHOOSE YOUR ROUTE', fill: UI.panelLight });
    blitSprite(ctx, missionNodeSprite('branch', time), r.x + 22, r.y + 26, 2);
    drawText(ctx, node.label.toUpperCase(), r.x + 46, r.y + 12, { color: UI.text, shadow: false });
    wrapText(node.text.toUpperCase(), r.w - 60).slice(0, 2).forEach((l, k) => drawText(ctx, l, r.x + 46, r.y + 25 + k * 10, { color: UI.textDim, shadow: false }));
    drawText(ctx, 'PRESS 1 OR 2, OR TAP A ROUTE', r.x + r.w / 2, r.y + r.h - 15, { color: UI.textDim, shadow: false, align: 'center' });
    node.options.slice(0, 2).forEach((o, k) => {
      const b = branchBtns[k];
      b.spec.label = '';
      b.spec.decorate = (g, face) => {
        drawText(g, `${k + 1}. ${o.label.toUpperCase()}`, face.x + 8, face.y + 6, { color: UI.text, shadowColor: tint(k ? '#bfe0ff' : '#ffd0b8', 0.4) });
        wrapText(o.description.toUpperCase(), face.w - 16).slice(0, 3).forEach((l, j) => {
          drawText(g, l, face.x + 8, face.y + 20 + j * 10, { color: tint(UI.text, 0.2), shadow: false });
        });
      };
    });
  }
}
