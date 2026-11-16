// The results screen. A win: the "MISSION COMPLETE!" banner drops in with confetti, the case's
// success line, the rewards (coins count up, food and items pop in), and the squad report (XP bars
// fill, LEVEL UP! tags, new moves). CONTINUE then plays any evolutions one after another, and if a
// new dragon joined, a big reveal card with its story. A loss: "MISSION FAILED", Chief Nibbles'
// pep talk with concrete type advice from the case intel, a reminder to rest, and the XP the squad
// kept anyway. CONTINUE goes home to the Burrow.
//
// Enter / Space / click on CONTINUE first fast-forwards whatever is still animating.
import { drawText, drawTextOutlined, measureText } from '../../lib/engine/text.ts';
import { getFood, getItem, getMission, getMove, getSpecies, getType } from '../../data/index.ts';
import { FOOD_IDS, ITEM_IDS, type FoodId, type ItemId, type MoveId, type TypeId } from '../../data/schema.ts';
import { intelTypes, type MissionRewards, type MissionRun } from '../../game/missions.ts';
import { swapLines } from '../../game/habitat.ts';
import { dragonName, findDragon, foldSwaps, pendingEvolution, type MoveSwap } from '../../game/dragons.ts';
import { MAX_LEVEL, type OwnedDragon } from '../../game/types.ts';
import { levelForXp, xpForLevel } from '../../battle/stats.ts';
import { counterTypes } from '../../battle/matchup.ts';
import { drawDragon, dragonHeight, type Pose } from '../../art/dragon.ts';
import { createFx } from '../../art/fx.ts';
import { sfx, music } from '../../audio/index.ts';
import { app } from '../app.ts';
import type { Scene } from '../scene.ts';
import {
  ButtonGroup, Typewriter, UI, VIEW_H, VIEW_W, drawBar, drawInset, drawPanel, drawTypeBadges, drawTypewriter,
  fillRoundRect, tint, wrapText, type Rect,
} from '../widgets.ts';
import { drawCoinIcon, drawFoodIcon, drawItemIcon } from '../icons.ts';
import { CHIEF_PORTRAIT_SIZE, drawChiefPortrait } from '../chief.ts';

type Ctx = CanvasRenderingContext2D;
const INK = UI.ink;

interface SquadLine {
  id: string;
  gained: number;
  startXp: number;
  levels: number[];
  learned: MoveId[];
  /** Automatic loadout swaps across the mission's reports ("SWAPPED X FOR Y"). */
  swapped: MoveSwap[];
  evolve: boolean;
  /** Animation: last level shown, and when it last levelled up. */
  shownLevel: number;
  levelUpAt: number;
}

interface Confetto { x: number; y: number; vx: number; vy: number; color: string; phase: number; w: number; h: number; front: boolean }

const CONFETTI_COLORS = ['#ef7d4f', '#f6c63c', '#5cbf4f', '#4f9be0', '#e86aa0', '#b07ae0', '#fff6de'];

const easeOut = (u: number): number => 1 - (1 - u) * (1 - u) * (1 - u);

/** The new-recruit card. */
const REVEAL_W = 400;
const REVEAL_X = Math.round((VIEW_W - REVEAL_W) / 2);
const REVEAL_Y = 40;

/** Typical encouragement lines from the Chief (one is picked per defeat). */
const PEP_TALKS = [
  "Chin up, agent! Even the best agents get their whiskers singed sometimes.",
  "Ooh, that was a tough one. Don't worry, the villains won't get far. We'll be back!",
  "Every great agent has a bad day. Mine involved a rubber duck. Let's not talk about it.",
];

export function createResultsScene(run: MissionRun, rewards: MissionRewards | null): Scene {
  const def = getMission(run.missionId);
  const won = !!rewards;
  const fx = createFx();
  // The success text can run to five lines; the panels below make room for it.
  const successLines = wrapText(def.success, VIEW_W - 44).slice(0, 5);
  const SUCCESS_Y = 42;
  const successH = 10 + successLines.length * 10;
  const PANEL_Y = SUCCESS_Y + successH + 13;
  const PANEL_H = VIEW_H - 42 - PANEL_Y;
  const ROW_H = Math.min(62, Math.floor((PANEL_H - 16) / 3) - 3);
  let time = 0;

  // --- squad report data --------------------------------------------------------------------
  const squad: SquadLine[] = run.squad.map((id) => {
    const reps = run.xp[id] ?? [];
    const d = findDragon(app.state, id);
    const gained = reps.reduce((a, r) => a + Math.max(0, r.xp), 0);
    const endXp = d?.xp ?? 0;
    const startXp = Math.max(0, endXp - gained);
    return {
      id,
      gained,
      startXp,
      levels: reps.flatMap((r) => r.levelsGained),
      learned: reps.flatMap((r) => r.learned),
      swapped: foldSwaps(reps.map((r) => r.swapped)),
      evolve: reps.some((r) => !!r.evolveTo),
      shownLevel: Math.min(MAX_LEVEL, levelForXp(startXp)),
      levelUpAt: -9,
    };
  });

  // --- reward rows ----------------------------------------------------------------------------
  const rewardRows: { kind: 'food' | 'item'; id: FoodId | ItemId; qty: number }[] = [];
  if (rewards) {
    for (const id of FOOD_IDS) if (rewards.food[id] !== undefined) rewardRows.push({ kind: 'food', id, qty: rewards.food[id] ?? 0 });
    for (const id of ITEM_IDS) if (rewards.items[id] !== undefined) rewardRows.push({ kind: 'item', id, qty: rewards.items[id] ?? 0 });
  }

  // --- defeat advice from the case intel ------------------------------------------------------
  const intel = intelTypes(run.missionId);
  const counts = new Map<TypeId, number>();
  for (const set of intel) for (const t of set) counts.set(t, (counts.get(t) ?? 0) + 1);
  const theirTypes = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
  const bring = counterTypes(intel.flat()).slice(0, 2);
  const typeName = (t: TypeId): string => { try { return getType(t).name; } catch { return t; } };
  const advice = (() => {
    const crew = theirTypes.map(typeName).join(' and ');
    const counter = bring.map(typeName).join(' or ');
    const a = crew ? `Their crew is mostly ${crew}.` : 'That crew is a slippery bunch.';
    const b = counter ? ` Try bringing ${counter} dragons!` : ' Try a different squad!';
    return a + b;
  })();
  const pep = PEP_TALKS[(def.index + run.squad.length + app.state.day) % PEP_TALKS.length];
  const chiefText = `${pep} ${advice} And let everyone rest in the Cozy Nest before you try again.`;
  const tw = new Typewriter(app.state.settings?.fastText !== false ? 72 : 42);
  let blips = 0;
  tw.onChar = () => { blips++; if (blips % 3 === 0) sfx('click', { volume: 0.2, pitch: 0.62 }); };

  // --- timeline -------------------------------------------------------------------------------
  // win:  banner 0..0.6, coins 0.7..1.9, items pop after, XP 2.1..3.6
  // loss: banner 0..0.6, chief talks from 0.7, XP 1.2..2.4
  const COIN_START = 0.7, COIN_DUR = 1.2;
  const ITEMS_START = COIN_START + COIN_DUR + 0.1, ITEM_STEP = 0.14;
  const XP_START = won ? ITEMS_START + rewardRows.length * ITEM_STEP + 0.3 : 1.2;
  const XP_DUR = 1.5;
  const ANIM_END = XP_START + XP_DUR + 0.2;
  let skipped = false;
  const now = (): number => (skipped ? Math.max(time, ANIM_END) : time);
  let lastCoinTick = 0;
  let itemsPopped = 0;

  type Stage = 'report' | 'evolving' | 'reveal' | 'leaving';
  let stage: Stage = 'report';
  const evoQueue: string[] = squad.filter((s) => s.evolve).map((s) => s.id);
  let evoPending = false;
  let revealT = 0;
  const confetti: Confetto[] = [];

  // --- buttons --------------------------------------------------------------------------------
  const group = new ButtonGroup();
  const contBtn = group.add({
    label: 'CONTINUE ▶', rect: { x: VIEW_W - 136, y: VIEW_H - 32, w: 126, h: 24 }, color: won ? UI.accent : UI.info, hotkey: 'Escape',
    onClick: () => onContinue(),
  });

  function animating(): boolean {
    if (stage === 'reveal') return revealT < 1.2;
    return now() < ANIM_END || (!won && !tw.done);
  }

  function onContinue(): void {
    if (stage === 'leaving' || stage === 'evolving') return;
    if (animating()) {
      // fast-forward
      skipped = true;
      tw.skip();
      if (stage === 'reveal') revealT = 1.2;
      sfx('click');
      return;
    }
    sfx('select');
    if (stage === 'report') {
      if (evoQueue.length) { stage = 'evolving'; nextEvolution(); return; }
      if (rewards?.dragon) { startReveal(); return; }
    }
    leave();
  }

  function nextEvolution(): void {
    while (evoQueue.length) {
      const id = evoQueue.shift() as string;
      const d = findDragon(app.state, id);
      if (!d || !pendingEvolution(d)) continue;
      app.nav.evolve(id, () => { evoPending = true; });
      return;
    }
    // all done
    app.save();
    if (rewards?.dragon) startReveal();
    else { stage = 'report'; }
  }

  function startReveal(): void {
    stage = 'reveal';
    revealT = 0;
    sfx('sparkle');
    sfx('levelUp', { delay: 0.35 });
    burstConfetti(70);
  }

  function leave(): void {
    stage = 'leaving';
    app.save();
    app.nav.burrow();
  }

  function burstConfetti(n: number): void {
    for (let i = 0; i < n; i++) {
      confetti.push({
        x: VIEW_W / 2 + (Math.random() - 0.5) * 120, y: 20 + Math.random() * 10,
        vx: (Math.random() - 0.5) * 260, vy: -60 - Math.random() * 120,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], phase: Math.random() * 6,
        w: Math.random() < 0.5 ? 2 : 3, h: Math.random() < 0.5 ? 3 : 2, front: true,
      });
    }
  }

  const scene: Scene = {
    name: 'results',
    enter() {
      // for tools/playtest.ts: report / evolving / reveal / leaving
      app.debug.results = { stage: () => stage, animating: () => animating() };
      if (won) {
        music('victory');
        burstConfetti(90);
      } else {
        music(null);
        sfx('defeat');
      }
    },
    resume() {
      if (won) music('victory');
      else music('burrow');
    },
    update(dt, input) {
      time += dt;
      fx.update(dt);
      if (stage === 'reveal') {
        const before = revealT;
        revealT += dt;
        if (before < 0.25 && revealT >= 0.25) {
          // the new dragon pops onto its stage
          fx.burst(REVEAL_X + 82, REVEAL_Y + 80, UI.gold, 24);
          fx.burst(REVEAL_X + 82, REVEAL_Y + 80, '#ffffff', 12);
          sfx('fluff', { pitch: 1.3, volume: 0.8 });
        }
      }
      if (!won && time > 1.8 && time - dt <= 1.8) music('burrow');
      if (!won && time > 0.7) {
        if (!tw.text) tw.set(chiefText);
        tw.update(dt);
      }

      // confetti physics
      for (const c of confetti) {
        c.vy += 220 * dt;
        c.vx *= 1 - 1.6 * dt;
        c.vy = Math.min(c.vy, 70);
        c.x += (c.vx + Math.sin(time * 5 + c.phase) * 18) * dt;
        c.y += c.vy * dt;
      }
      for (let i = confetti.length - 1; i >= 0; i--) if (confetti[i].y > VIEW_H + 6) confetti.splice(i, 1);
      if (won && stage !== 'leaving' && time < 6 && Math.random() < dt * 14) {
        confetti.push({
          x: Math.random() * VIEW_W, y: -4, vx: 0, vy: 30 + Math.random() * 30,
          color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)], phase: Math.random() * 6, w: 2, h: 3, front: false,
        });
      }

      tickAnimations();

      if (stage === 'evolving') {
        if (evoPending && app.scenes.top() === scene && !app.scenes.busy) {
          evoPending = false;
          nextEvolution();
        }
        return;
      }
      if (stage === 'leaving') return;
      if (input.pointer.pressed && stage !== 'reveal' && !hit(contBtn.spec.rect, input.pointer.x, input.pointer.y) && animating()) {
        skipped = true; tw.skip();
      }
      if (stage === 'reveal' && input.pointer.pressed && !hit(contBtn.spec.rect, input.pointer.x, input.pointer.y)) {
        // a tap on the card finishes its entrance, the next one heads home
        if (revealT < 1.2) revealT = 1.2;
        else { sfx('select'); leave(); return; }
      }
      group.update(input);
    },
    draw(ctx) {
      if (won) drawWinBackdrop(ctx); else drawLossBackdrop(ctx);
      drawConfetti(ctx, false);
      drawBanner(ctx);
      if (won) {
        drawSuccess(ctx);
        drawRewards(ctx);
        drawSquad(ctx, { x: 230, y: PANEL_Y, w: 402, h: PANEL_H }, false);
      } else {
        drawChief(ctx);
        drawAdvice(ctx);
        drawSquad(ctx, { x: 8, y: 214, w: 624, h: 104 }, true);
      }
      contBtn.draw(ctx, true);
      fx.draw(ctx);
      drawConfetti(ctx, true);
      if (stage === 'reveal') {
        drawReveal(ctx);
        // the way home stays lit above the reveal's dim, so it never looks switched off
        if (revealT >= 0.6) contBtn.draw(ctx, true);
      }
    },
  };
  return scene;

  /** The opening burst flies in front of everything; the gentle drizzle after it stays behind the panels. */
  function drawConfetti(ctx: Ctx, front: boolean): void {
    for (const c of confetti) {
      if (c.front !== front) continue;
      const flip = Math.sin(time * 9 + c.phase) > 0;
      ctx.fillStyle = flip ? c.color : tint(c.color, -0.25);
      ctx.fillRect(Math.round(c.x), Math.round(c.y), flip ? c.w : c.h, flip ? c.h : c.w);
    }
  }

  function hit(r: Rect, x: number, y: number): boolean {
    return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  }

  // -------------------------------------------------------------------------------------------
  // Animation ticks (sounds, level-up pops)
  // -------------------------------------------------------------------------------------------

  function coinProgress(): number {
    return Math.max(0, Math.min(1, (now() - COIN_START) / COIN_DUR));
  }

  function xpProgressU(): number {
    return Math.max(0, Math.min(1, (now() - XP_START) / XP_DUR));
  }

  function tickAnimations(): void {
    if (won && rewards) {
      const u = coinProgress();
      if (u > 0 && u < 1 && time - lastCoinTick > 0.07) {
        lastCoinTick = time;
        sfx('coin', { volume: 0.35, pitch: 0.9 + u * 0.6 });
      }
      const popped = Math.max(0, Math.min(rewardRows.length, Math.floor((now() - ITEMS_START) / ITEM_STEP) + 1));
      while (itemsPopped < popped) {
        itemsPopped++;
        if (!skipped) sfx('select', { volume: 0.5, pitch: 1 + itemsPopped * 0.08 });
      }
    }
    const u = xpProgressU();
    squad.forEach((s, i) => {
      const d = findDragon(app.state, s.id);
      if (!d) return;
      const cur = s.startXp + (d.xp - s.startXp) * easeOut(u);
      const lvl = Math.min(MAX_LEVEL, Math.max(levelForXp(cur), s.shownLevel));
      if (lvl > s.shownLevel) {
        s.shownLevel = lvl;
        s.levelUpAt = time;
        if (!skipped || u < 1) sfx('levelUp', { volume: 0.7 });
        const r = squadRowRect(i);
        fx.burst(r.x + 34, r.y + r.h / 2, UI.gold, 12);
      }
    });
  }

  function squadRowRect(i: number): Rect {
    if (won) return { x: 238, y: PANEL_Y + 12 + i * (ROW_H + 3), w: 386, h: ROW_H };
    return { x: 16, y: 228 + i * 29, w: 608, h: 27 };
  }

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  function drawWinBackdrop(ctx: Ctx): void {
    ctx.fillStyle = '#3a2350';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // slowly turning sunburst behind the banner
    const cx = VIEW_W / 2, cy = 30;
    ctx.save();
    for (let k = 0; k < 16; k++) {
      const a0 = time * 0.15 + (k / 16) * Math.PI * 2;
      const a1 = a0 + Math.PI / 16;
      ctx.fillStyle = k % 2 ? 'rgba(255, 200, 90, 0.10)' : 'rgba(255, 140, 90, 0.07)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a0) * 800, cy + Math.sin(a0) * 800);
      ctx.lineTo(cx + Math.cos(a1) * 800, cy + Math.sin(a1) * 800);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(27, 20, 38, 0.35)';
    ctx.fillRect(0, VIEW_H - 40, VIEW_W, 40);
  }

  function drawLossBackdrop(ctx: Ctx): void {
    ctx.fillStyle = '#232a44';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = '#29314f';
    for (let y = 0; y < VIEW_H; y += 6) ctx.fillRect(0, y, VIEW_W, 3);
    // gentle rain
    ctx.fillStyle = 'rgba(160, 190, 240, 0.35)';
    for (let i = 0; i < 70; i++) {
      const x = (i * 97 + Math.floor(time * 30)) % (VIEW_W + 20) - 10;
      const y = (i * 53 + Math.floor(time * 160 + i * 17)) % (VIEW_H + 20) - 10;
      ctx.fillRect(x, y, 1, 5);
    }
  }

  function drawBanner(ctx: Ctx): void {
    const text = won ? 'MISSION COMPLETE!' : 'MISSION FAILED';
    const u = Math.min(1, time / 0.55);
    // drop in with a little bounce (a sad droop for a loss)
    const drop = won ? Math.round(-50 * (1 - easeOut(u)) + Math.sin(Math.min(1, u) * Math.PI) * 3) : Math.round(-40 * (1 - easeOut(u)));
    const tw2 = measureText(text, 2);
    const w = tw2 + 48, h = 28;
    const x = Math.round((VIEW_W - w) / 2), y = 8 + drop;
    const fill = won ? '#d8383f' : '#5a6488';
    const tail = won ? '#a8282e' : '#424a68';
    // ribbon tails
    for (const side of [-1, 1]) {
      const tx = side < 0 ? x - 18 : x + w - 4;
      fillRoundRect(ctx, tx, y + 8, 22, h - 4, 2, INK);
      fillRoundRect(ctx, tx + 1, y + 9, 20, h - 6, 1, tail);
      ctx.fillStyle = INK;
      const nx = side < 0 ? tx : tx + 21;
      for (let k = 0; k < 6; k++) ctx.fillRect(nx - side * k, y + 13 + k, 1, (h - 14) - 2 * k);
    }
    fillRoundRect(ctx, x + 2, y + 3, w, h, 3, 'rgba(27, 20, 38, 0.35)');
    fillRoundRect(ctx, x, y, w, h, 3, INK);
    fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 2, 2, tint(fill, -0.2));
    fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 4, 2, fill);
    ctx.fillStyle = tint(fill, 0.35);
    ctx.fillRect(x + 4, y + 2, w - 8, 1);
    drawTextOutlined(ctx, text, VIEW_W / 2, y + 7, { size: 2, color: won ? UI.goldLight : '#dfe4f6', align: 'center', shadow: false });
    if (won) {
      // twinkling stars on the ribbon ends
      const tw3 = Math.floor(time * 4) % 2;
      drawText(ctx, '★', x + 10, y + 10 - tw3, { color: UI.gold, shadowColor: tint(fill, -0.5) });
      drawText(ctx, '★', x + w - 15, y + 10 - (1 - tw3), { color: UI.gold, shadowColor: tint(fill, -0.5) });
    }
  }

  function drawSuccess(ctx: Ctx): void {
    drawPanel(ctx, 8, SUCCESS_Y, VIEW_W - 16, successH, { fill: UI.panelLight });
    successLines.forEach((l, i) => drawText(ctx, l, VIEW_W / 2, SUCCESS_Y + 6 + i * 10, { color: UI.text, shadow: false, align: 'center' }));
  }

  function drawRewards(ctx: Ctx): void {
    if (!rewards) return;
    const r: Rect = { x: 8, y: PANEL_Y, w: 214, h: PANEL_H };
    drawPanel(ctx, r.x, r.y, r.w, r.h, { title: 'REWARDS' });
    // coins counting up
    const u = coinProgress();
    const shown = Math.round(rewards.coins * easeOut(u));
    drawInset(ctx, r.x + 8, r.y + 12, r.w - 16, 30, { fill: '#fff2d2' });
    const bump = u > 0 && u < 1 ? Math.floor(time * 20) % 2 : 0;
    drawCoinIcon(ctx, r.x + 24, r.y + 27 - bump, 9);
    drawText(ctx, `+${shown}`, r.x + 40, r.y + 21, { size: 2, color: UI.goldDark, shadowColor: '#ffe7a0' });
    drawText(ctx, 'COINS', r.x + r.w - 14, r.y + 25, { color: UI.textDim, shadow: false, align: 'right' });
    // where the coins came from
    const drops = Math.min(rewards.coins, Math.max(0, run.coins));
    const casePay = rewards.coins - drops;
    drawText(ctx, rewards.firstClear ? 'CASE PAY' : 'CASE PAY (REPLAY: HALF)', r.x + 12, r.y + 47, { color: UI.textDim, shadow: false });
    drawText(ctx, String(casePay), r.x + r.w - 14, r.y + 47, { color: UI.text, shadow: false, align: 'right' });
    drawText(ctx, 'VILLAIN DROPS', r.x + 12, r.y + 57, { color: UI.textDim, shadow: false });
    drawText(ctx, String(drops), r.x + r.w - 14, r.y + 57, { color: UI.text, shadow: false, align: 'right' });
    if (rewards.firstClear) {
      fillRoundRect(ctx, r.x + 8, r.y + 68, r.w - 16, 13, 3, '#3e9a3a');
      drawText(ctx, 'FIRST CLEAR! CASE CLOSED!', r.x + r.w / 2, r.y + 71, { color: '#ffffff', shadowColor: '#2a6a28', align: 'center' });
    }
    // food and items, one by one
    let y = r.y + 88;
    rewardRows.forEach((row, i) => {
      if (i >= itemsPopped) return;
      if (y + 18 > r.y + r.h - (rewards.dragon ? 32 : 8)) return;
      const since = now() - (ITEMS_START + i * ITEM_STEP);
      const pop = since < 0.12 && !skipped ? Math.round((1 - since / 0.12) * 3) : 0;
      drawInset(ctx, r.x + 8, y, r.w - 16, 18, { fill: '#f7e8c6' });
      if (row.kind === 'food') drawFoodIcon(ctx, row.id as FoodId, r.x + 19, y + 9 - pop, 14);
      else drawItemIcon(ctx, row.id as ItemId, r.x + 19, y + 9 - pop, 14);
      const name = row.kind === 'food' ? getFood(row.id as FoodId).name : getItem(row.id as ItemId).name;
      drawText(ctx, name.toUpperCase(), r.x + 30, y + 6, { color: UI.text, shadow: false });
      drawText(ctx, row.qty > 0 ? `X${row.qty}` : 'FULL!', r.x + r.w - 14, y + 6, { color: row.qty > 0 ? '#3e7a32' : UI.bad, shadow: false, align: 'right' });
      y += 21;
    });
    // a new friend is on the way
    if (rewards.dragon && now() >= ANIM_END - 0.3) {
      const by = r.y + r.h - 28;
      const pulse = Math.floor(time * 3) % 2;
      fillRoundRect(ctx, r.x + 8, by, r.w - 16, 20, 4, INK);
      fillRoundRect(ctx, r.x + 9, by + 1, r.w - 18, 18, 3, pulse ? '#ffe7a0' : '#fff2c0');
      drawText(ctx, '+ A NEW DRAGON FRIEND!', r.x + r.w / 2, by + 7, { color: '#7a3aa0', shadow: false, align: 'center' });
    }
  }

  function drawSquad(ctx: Ctx, r: Rect, compact: boolean): void {
    drawPanel(ctx, r.x, r.y, r.w, r.h, { title: compact ? 'XP KEPT' : 'SQUAD REPORT' });
    const u = xpProgressU();
    squad.forEach((s, i) => {
      const d = findDragon(app.state, s.id);
      if (!d) return;
      drawSquadRow(ctx, s, d, squadRowRect(i), u, compact);
    });
  }

  function drawSquadRow(ctx: Ctx, s: SquadLine, d: OwnedDragon, r: Rect, u: number, compact: boolean): void {
    drawInset(ctx, r.x, r.y, r.w, r.h, { fill: '#f7e8c6' });
    const cur = s.startXp + (d.xp - s.startXp) * easeOut(u);
    const lvl = Math.max(s.shownLevel, Math.min(MAX_LEVEL, levelForXp(cur)));
    const lo = xpForLevel(lvl), hi = xpForLevel(Math.min(MAX_LEVEL, lvl + 1));
    const frac = lvl >= MAX_LEVEL ? 1 : Math.max(0, Math.min(1, (cur - lo) / Math.max(1, hi - lo)));
    const since = time - s.levelUpAt;
    const fainted = d.hp <= 0;
    // sprite
    const v = getSpecies(d.speciesId).visual;
    const spriteH = compact ? 20 : 38;
    const sc = Math.max(0.3, Math.min(1.3, spriteH / Math.max(1, dragonHeight(v, 1))));
    const hop = since >= 0 && since < 0.5 ? Math.round(Math.sin((since / 0.5) * Math.PI) * 6) : 0;
    const pose: Pose = fainted ? 'sleep' : since >= 0 && since < 1.2 ? 'happy' : 'idle';
    const sw = compact ? 30 : 56;
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x + 2, r.y + 1, sw, r.h - 2); ctx.clip();
    drawDragon(ctx, v, r.x + 2 + sw / 2, r.y + r.h - 4 - hop, { scale: sc, facing: 1, t: time + r.y * 0.01, pose, poseT: Math.min(1, Math.max(0, since / 1.2)), alpha: fainted ? 0.65 : 1 });
    ctx.restore();
    const tx = r.x + sw + 8;
    const name = dragonName(d).toUpperCase();
    const levelled = lvl > levelForXp(s.startXp);
    if (compact) {
      drawText(ctx, name, tx, r.y + 4, { color: UI.text, shadow: false });
      drawText(ctx, `LV ${lvl}`, tx + 90, r.y + 4, { color: levelled ? '#3e7a32' : UI.textDim, shadow: false });
      drawBar(ctx, tx, r.y + 15, 210, 7, frac, UI.info);
      drawText(ctx, `+${Math.round(s.gained * easeOut(u))} XP`, tx + 218, r.y + 15, { color: UI.textDim, shadow: false });
      if (since >= 0 && since < 2.5 || (levelled && u >= 1)) drawLevelUpTag(ctx, tx + 300, r.y + 8, since);
      if (s.evolve && u >= 1 && pendingEvolution(d)) drawGlowTag(ctx, r.x + r.w - 98, r.y + 8);
      return;
    }
    drawText(ctx, name, tx, r.y + 6, { color: UI.text, shadow: false });
    const lvTxt = `LV ${lvl}`;
    drawText(ctx, lvTxt, tx + measureText(name) + 6, r.y + 6, { color: levelled ? '#3e7a32' : UI.textDim, shadow: false });
    drawBar(ctx, tx, r.y + 18, 200, 8, frac, UI.info);
    drawText(ctx, `+${Math.round(s.gained * easeOut(u))} XP`, tx + 206, r.y + 19, { color: UI.textDim, shadow: false });
    if (levelled) drawLevelUpTag(ctx, r.x + r.w - 66, r.y + 4, since);
    // moves learned, once the bar is full
    if (u >= 1 && s.learned.length) {
      const names = s.learned.map((m) => { try { return getMove(m).name.toUpperCase(); } catch { return m; } });
      const line = `NEW MOVE${names.length > 1 ? 'S' : ''}: ${names.join(', ')}!`;
      const maxW = r.w - (tx - r.x) - 8;
      const swaps = s.swapped.length ? wrapText(swapLines(s.swapped).join(' '), maxW).slice(0, 1) : [];
      const lines = [...wrapText(line, maxW).slice(0, 2 - swaps.length), ...swaps];
      lines.forEach((l, k) => drawText(ctx, l, tx, r.y + 32 + k * 10, { color: k >= lines.length - swaps.length ? '#2f6ab0' : '#7a3aa0', shadow: false }));
    } else if (u >= 1 && s.evolve && pendingEvolution(d)) {
      drawText(ctx, `${name} IS STARTING TO GLOW!`, tx, r.y + 32, { color: '#b8781e', shadow: false });
    } else if (u >= 1 && fainted) {
      drawText(ctx, 'NEEDS A GOOD NAP.', tx, r.y + 32, { color: UI.textDim, shadow: false });
    }
    if (s.evolve && u >= 1 && pendingEvolution(d)) drawGlowTag(ctx, r.x + r.w - 98, r.y + r.h - 16);
  }

  function drawLevelUpTag(ctx: Ctx, x: number, y: number, since: number): void {
    const pop = since >= 0 && since < 0.25 ? Math.round((1 - since / 0.25) * 4) : 0;
    const t = 'LEVEL UP!';
    const w = measureText(t) + 10;
    fillRoundRect(ctx, x, y - pop, w, 13, 4, INK);
    fillRoundRect(ctx, x + 1, y + 1 - pop, w - 2, 11, 3, Math.floor(time * 4) % 2 ? UI.gold : UI.goldLight);
    drawText(ctx, t, x + 5, y + 3 - pop, { color: UI.text, shadow: false });
  }

  function drawGlowTag(ctx: Ctx, x: number, y: number): void {
    const t = 'GLOWING!';
    const w = measureText(t) + 18;
    fillRoundRect(ctx, x, y, w, 13, 4, INK);
    fillRoundRect(ctx, x + 1, y + 1, w - 2, 11, 3, '#fff0f8');
    const k = Math.floor(time * 5) % 2;
    drawText(ctx, '★', x + 3, y + 3 - k, { color: UI.gold, shadow: false });
    drawText(ctx, t, x + 12, y + 3, { color: '#b05ab8', shadow: false });
  }

  function drawChief(ctx: Ctx): void {
    const r: Rect = { x: 8, y: 46, w: VIEW_W - 16, h: 92 };
    drawPanel(ctx, r.x, r.y, r.w, r.h, { fill: UI.panelLight, title: 'CHIEF NIBBLES' });
    drawChiefPortrait(ctx, r.x + 10, r.y + 14, time, !tw.done && time > 0.7);
    const tx = r.x + 20 + CHIEF_PORTRAIT_SIZE;
    drawTypewriter(ctx, tw, tx, r.y + 14, r.x + r.w - 14 - tx, { color: UI.text, shadow: false });
  }

  function drawAdvice(ctx: Ctx): void {
    const r: Rect = { x: 8, y: 150, w: VIEW_W - 16, h: 48 };
    drawPanel(ctx, r.x, r.y, r.w, r.h, { title: 'INTEL REPORT' });
    drawText(ctx, 'THEIR CREW IS MOSTLY:', r.x + 12, r.y + 12, { color: UI.text, shadow: false });
    drawTypeBadges(ctx, theirTypes, r.x + 12, r.y + 25);
    const bx = r.x + r.w / 2 + 10;
    drawText(ctx, 'TRY BRINGING:', bx, r.y + 12, { color: '#3e7a32', shadow: false });
    drawTypeBadges(ctx, bring, bx, r.y + 25);
    ctx.fillStyle = tint(UI.panel, -0.15);
    ctx.fillRect(r.x + r.w / 2, r.y + 8, 1, r.h - 16);
  }

  function drawReveal(ctx: Ctx): void {
    const d = rewards?.dragon;
    if (!d) return;
    const sp = getSpecies(d.speciesId);
    const u = Math.min(1, revealT / 0.35);
    ctx.fillStyle = `rgba(27, 20, 38, ${0.65 * u})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const w = REVEAL_W, h = 252;
    const x = REVEAL_X;
    const y = Math.round(REVEAL_Y + (1 - easeOut(u)) * 40);
    // light rays behind the card
    ctx.save();
    ctx.globalAlpha = 0.5 * u;
    const cx = VIEW_W / 2, cy = y + 70;
    for (let k = 0; k < 12; k++) {
      const a0 = revealT * 0.4 + (k / 12) * Math.PI * 2, a1 = a0 + Math.PI / 12;
      ctx.fillStyle = k % 2 ? 'rgba(255, 230, 140, 0.5)' : 'rgba(255, 200, 120, 0.3)';
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a0) * 420, cy + Math.sin(a0) * 420);
      ctx.lineTo(cx + Math.cos(a1) * 420, cy + Math.sin(a1) * 420);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    drawPanel(ctx, x, y, w, h, { fill: UI.panelLight, title: 'NEW RECRUIT!' });
    // the stage the dragon hops onto
    drawInset(ctx, x + 12, y + 14, 140, 112, { fill: '#ffeec0' });
    const v = sp.visual;
    const sc = Math.max(0.6, Math.min(2.2, 80 / Math.max(1, dragonHeight(v, 1))));
    const hopU = Math.max(0, Math.min(1, (revealT - 0.25) / 0.6));
    const hop = Math.round(Math.abs(Math.sin(hopU * Math.PI * 2)) * (1 - hopU) * 30);
    const enter = Math.round((1 - easeOut(hopU)) * 40);
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 13, y + 15, 138, 110); ctx.clip();
    ctx.fillStyle = 'rgba(184, 120, 30, 0.25)';
    ctx.beginPath(); ctx.ellipse(x + 82, y + 118, 40, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (revealT > 0.25) drawDragon(ctx, v, x + 82, y + 118 - hop + enter, { scale: sc, facing: 1, t: revealT, pose: hopU < 1 ? 'happy' : 'idle', poseT: hopU });
    ctx.restore();
    // name, category, types
    const tx = x + 164, tw2 = w - 176;
    const name = dragonName(d).toUpperCase();
    drawText(ctx, name, tx, y + 16, { size: measureText(name, 2) <= tw2 ? 2 : 1, color: UI.text, shadowColor: UI.panelDark });
    drawText(ctx, sp.category.toUpperCase(), tx, y + 36, { color: UI.textDim, shadow: false });
    drawTypeBadges(ctx, sp.types, tx, y + 48);
    drawText(ctx, `LV ${d.level}`, tx, y + 68, { color: UI.text, shadow: false });
    // the dex fact beside the stage, the story under it
    wrapText(sp.fact, tw2).slice(0, 4).forEach((l, k) => drawText(ctx, l, tx, y + 84 + k * 10, { color: UI.textDim, shadow: false }));
    wrapText(sp.backstory, w - 24).slice(0, 8).forEach((l, k) => drawText(ctx, l, x + 12, y + 134 + k * 10, { color: UI.text, shadow: false }));
    // joined banner
    const jt = `${name} JOINED THE BURROW!`;
    const jw = Math.min(w - 24, measureText(jt) + 20);
    const jy = y + h - 34;
    fillRoundRect(ctx, x + (w - jw) / 2, jy, jw, 20, 4, INK);
    fillRoundRect(ctx, x + (w - jw) / 2 + 1, jy + 1, jw - 2, 18, 3, Math.floor(revealT * 3) % 2 ? UI.gold : UI.goldLight);
    drawText(ctx, jt, VIEW_W / 2, jy + 7, { color: UI.text, shadow: false, align: 'center' });
  }
}
