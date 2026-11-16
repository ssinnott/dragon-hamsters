// The evolution cutscene. Over a dimmed screen with slowly turning light rays, the dragon pulses and
// flashes white, then flickers between its old shape and the new species' silhouette, faster and
// faster, while motes of light stream in; a white flash, a sparkle burst, and the reveal: evolve()
// runs at that moment, the new form hops for joy, and the message box says who it became, which
// moves it just learned and which new ones are coming. Cards slide in with the stat gains.
//
// Enter / Space / click advance the reveal text and finally close (pop, then onDone). Escape during
// the build-up jumps straight to the reveal; the evolution itself always happens.
import type { Scene } from '../scene.ts';
import type { Input } from '../input.ts';
import { app } from '../app.ts';
import { STAT_IDS, type DragonVisual, type MoveId, type SpeciesDef, type StatId, type Stats, type TypeId } from '../../data/schema.ts';
import { getMove, getSpecies, getType } from '../../data/index.ts';
import { dragonName, dragonStats, evolve, findDragon } from '../../game/dragons.ts';
import { drawDragon, type Pose } from '../../art/dragon.ts';
import { createFx } from '../../art/fx.ts';
import { drawText, drawTextOutlined, measureText } from '../../lib/engine/text.ts';
import {
  Typewriter, UI, VIEW_H, VIEW_W, drawMessageBox, drawPanel, drawTypeBadge, wrapText,
} from '../widgets.ts';
import { drawTypeIcon } from '../icons.ts';
import { currentMusic, music, sfx, type TrackName } from '../../audio/index.ts';

type Ctx = CanvasRenderingContext2D;

const CX = VIEW_W / 2;
/** Ground point of the dragon, and the centre of the light. */
const GROUND_Y = 236;
const GLOW_Y = 172;
/** Timeline (seconds). */
const INTRO = 1.5;
const MORPH = 5.0;
const FLASH_UP = 0.35;
const REVEAL_AT = INTRO + MORPH + FLASH_UP;
const MSG = { x: 40, y: 290, w: 560, h: 60 };

const STAT_SHORT: Record<StatId, string> = { hp: 'HP', atk: 'ATTACK', def: 'DEFENSE', spa: 'SP. ATK', spd: 'SP. DEF', spe: 'SPEED' };

interface Mote { a: number; r: number; v: number; color: string; size: number }
interface Confetti { x: number; y: number; vx: number; vy: number; color: string; spin: number; t: number }

/** A sprite's drawn bounds at scale 1, relative to its ground point (px), measured once. */
interface Box { l: number; r: number; t: number; b: number }
const boxes = new Map<DragonVisual, Box>();

function measure(v: DragonVisual): Box {
  const hitB = boxes.get(v);
  if (hitB) return hitB;
  const K = 2, S = K * v.size;
  const half = Math.ceil(60 * S), top = Math.ceil(100 * S);
  const c = document.createElement('canvas');
  c.width = half * 2; c.height = top + Math.ceil(16 * S);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  drawDragon(g, v, half, top, { scale: K, t: 0.45, silhouette: '#000000' });
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

/** Scale and horizontal nudge that fit `v` inside maxW x maxH, centred on its bounds. */
function fit(v: DragonVisual, maxW: number, maxH: number, maxScale: number): { scale: number; dx: number } {
  const b = measure(v);
  const scale = Math.min(maxScale, maxW / Math.max(1, b.r - b.l), maxH / Math.max(1, b.b - b.t));
  return { scale, dx: Math.round(-((b.l + b.r) / 2) * scale) };
}

export function createEvolutionScene(dragonId: string, onDone: () => void): Scene {
  const fx = createFx();
  let t = 0;
  let theta = 0;
  let lastSide = 0;
  let evolved = false;
  let finished = false;
  let revealT = -1;
  let prevMusic: TrackName | null = null;
  const motes: Mote[] = [];
  const confetti: Confetti[] = [];
  const tw = new Typewriter(48);
  let lines: string[] = [];
  let lineIdx = 0;
  const sfxAt = [INTRO, INTRO + 1.4, INTRO + 2.5, INTRO + 3.3, INTRO + 3.9, INTRO + 4.4];
  let sfxNext = 0;

  const d = findDragon(app.state, dragonId) ?? null;
  const from: SpeciesDef | null = d ? getSpecies(d.speciesId) : null;
  const to: SpeciesDef | null = from?.evolvesTo ? getSpecies(from.evolvesTo.species) : null;
  const valid = !!(d && from && to);
  const oldName = d ? dragonName(d) : '';
  const oldStats: Stats | null = d ? dragonStats(d) : null;
  const oldTypes: TypeId[] = from ? [...from.types] : [];
  let newStats: Stats | null = null;
  let learned: MoveId[] = [];
  let upcoming: { level: number; move: MoveId }[] = [];

  function doEvolve(): void {
    if (evolved || !valid || !d || !from || !to) return;
    evolved = true;
    const knownBefore = [...d.knownMoves];
    evolve(app.state, d);
    app.save();
    newStats = dragonStats(d);
    learned = d.knownMoves.filter((m) => !knownBefore.includes(m));
    const oldSet = new Set(from.learnset.map((e) => e.move));
    upcoming = to.learnset.filter((e) => e.level > d.level && !oldSet.has(e.move) && !d.knownMoves.includes(e.move)).slice(0, 2);
    const newName = dragonName(d);
    lines = [`${oldName} evolved into ${to.name}!`];
    for (const m of learned) {
      const name = getMove(m).name;
      lines.push(d.moves.includes(m) ? `${newName} learned ${name}! It is ready to use.` : `${newName} learned ${name}! Equip it on the DRAGONS screen.`);
    }
    const gained = to.types.filter((ty) => !oldTypes.includes(ty));
    if (gained.length) lines.push(`${newName} is now ${to.types.map((ty) => getType(ty).name).join(' and ')} type!`);
    if (upcoming.length) {
      lines.push(`Keep training: ${upcoming.map((u) => `${getMove(u.move).name} at LV ${u.level}`).join(', and ')}!`);
    }
    lineIdx = 0;
    tw.set(lines[0]);
    revealT = 0;
    // the burst
    const colors = [getType(to.types[0]).light, getType(to.types[0]).color, UI.goldLight, '#ffffff'];
    colors.forEach((c, i) => fx.burst(CX, GLOW_Y + 10, c, 18 + i * 4));
    fx.shake(4);
    sfx('sparkle');
    sfx('victory', { delay: 0.15 });
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 170;
      confetti.push({
        x: CX, y: GLOW_Y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90,
        color: colors[i % colors.length], spin: Math.random() * 10, t: 0,
      });
    }
  }

  function skipToReveal(): void {
    if (evolved) return;
    t = REVEAL_AT;
    sfx('evolve', { pitch: 1.8, volume: 0.6 });
    doEvolve();
  }

  function finish(): void {
    if (finished) return;
    finished = true;
    sfx('click');
    app.scenes.pop();
    onDone();
  }

  function advance(): void {
    if (!tw.done) { tw.skip(); return; }
    if (lineIdx < lines.length - 1) {
      lineIdx++;
      tw.set(lines[lineIdx]);
      sfx('click', { volume: 0.6 });
      return;
    }
    finish();
  }

  // ---- update -----------------------------------------------------------------------------------
  function update(dt: number, input: Input): void {
    if (!valid) {
      if (input.confirm() || input.back() || input.pointer.pressed || t > 3) finish();
      t += dt;
      return;
    }
    t += dt;
    fx.update(dt);
    tw.update(dt);
    if (revealT >= 0) revealT += dt;

    // the flicker: half-cycles per second ramp from slow to a blur
    if (t > INTRO && !evolved) {
      const u = Math.min(1, (t - INTRO) / MORPH);
      theta += dt * (1.6 + 16 * u * u);
      const side = Math.floor(theta) % 2;
      if (side !== lastSide && u > 0.2 && u < 0.92) sfx('click', { volume: 0.25, pitch: 1.5 + u });
      lastSide = side;
    }
    while (sfxNext < sfxAt.length && t >= sfxAt[sfxNext]) {
      sfx('evolve', { pitch: 1 + sfxNext * 0.14, volume: 0.8 });
      sfxNext++;
    }
    if (!evolved && t >= REVEAL_AT) doEvolve();

    // motes stream inward during the build-up
    if (!evolved && t > INTRO * 0.6) {
      const rate = 10 + 50 * Math.min(1, (t - INTRO) / MORPH);
      const want = rate * dt;
      for (let i = 0; i < Math.floor(want) + (Math.random() < want % 1 ? 1 : 0); i++) {
        const tt = getType((Math.random() < 0.5 ? to! : from!).types[0]);
        motes.push({ a: Math.random() * Math.PI * 2, r: 150 + Math.random() * 120, v: 120 + Math.random() * 100, color: Math.random() < 0.4 ? '#ffffff' : tt.light, size: Math.random() < 0.3 ? 2 : 1 });
      }
    }
    for (const m of motes) m.r -= m.v * dt;
    for (let i = motes.length - 1; i >= 0; i--) if (motes[i].r < 12 || evolved) motes.splice(i, 1);
    for (const c of confetti) { c.t += dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 220 * dt; c.vx *= 0.985; }
    for (let i = confetti.length - 1; i >= 0; i--) if (confetti[i].t > 2.6 || confetti[i].y > VIEW_H + 10) confetti.splice(i, 1);

    const clicked = input.pointer.pressed;
    if (!evolved) {
      if (input.back()) skipToReveal();
      return;
    }
    if (revealT < 0.6) return;   // let the reveal land before any key can close it
    if (input.confirm() || clicked) advance();
    else if (input.back()) { if (!tw.done) tw.skip(); else finish(); }
  }

  // ---- drawing ----------------------------------------------------------------------------------
  function drawRays(ctx: Ctx): void {
    const u = evolved ? 1 : Math.max(0, Math.min(1, (t - INTRO * 0.3) / (INTRO + MORPH)));
    const n = 14;
    const spin = evolved ? (revealT * 0.25) : t * (0.15 + 0.9 * u * u);
    const base = evolved ? 0.16 : 0.05 + 0.16 * u;
    const color = evolved && to ? getType(to.types[0]).light : '#fff2c4';
    ctx.save();
    ctx.translate(CX, GLOW_Y);
    for (let i = 0; i < n; i++) {
      const a = spin + (i / n) * Math.PI * 2;
      const w = 0.07 + 0.03 * Math.sin(t * 2 + i);
      const alpha = base * (0.6 + 0.4 * Math.sin(t * 3 + i * 1.7));
      ctx.fillStyle = color;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a - w) * 460, Math.sin(a - w) * 460);
      ctx.lineTo(Math.cos(a + w) * 460, Math.sin(a + w) * 460);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // the glow
    const glowR = evolved ? 92 : 50 + 40 * u + 6 * Math.sin(t * 7);
    const glowC = evolved && to ? getType(to.types[0]).light : '#fff6d8';
    const g = ctx.createRadialGradient(CX, GLOW_Y, 0, CX, GLOW_Y, glowR);
    g.addColorStop(0, hexA(glowC, evolved ? 0.55 : 0.25 + 0.5 * u));
    g.addColorStop(1, hexA(glowC, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(CX, GLOW_Y, glowR, 0, Math.PI * 2); ctx.fill();
  }

  function hexA(hex: string, a: number): string {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  }

  function drawCreature(ctx: Ctx): void {
    if (!from || !to) return;
    const fo = fit(from.visual, 200, 140, 3);
    const fn = fit(to.visual, 200, 140, 3);
    if (evolved) {
      const hop = revealT < 1.8;
      const pose: Pose = hop ? 'happy' : 'idle';
      const pop = revealT < 0.25 ? 1 + 0.15 * Math.sin((revealT / 0.25) * Math.PI) : 1;
      const flash = Math.max(0, 1 - revealT / 0.5);
      drawDragon(ctx, to.visual, CX + fn.dx, GROUND_Y, { scale: fn.scale * pop, t: hop ? revealT : t, pose, flash });
      return;
    }
    if (t < INTRO) {
      drawDragon(ctx, from.visual, CX + fo.dx, GROUND_Y, { scale: fo.scale, t });
      return;
    }
    const u = Math.min(1, (t - INTRO) / MORPH);
    if (u < 0.2) {
      // pulse: breathe in and out, flashing whiter each time
      const k = 0.5 - 0.5 * Math.cos((t - INTRO) * 9);
      drawDragon(ctx, from.visual, CX + fo.dx, GROUND_Y, { scale: fo.scale * (1 + 0.04 * k), t, flash: Math.min(1, 0.3 + u * 3.5) * k });
      return;
    }
    const showNew = Math.floor(theta) % 2 === 1;
    const f = showNew ? fn : fo;
    const breathe = 1 + 0.03 * Math.sin(t * 20);
    drawDragon(ctx, showNew ? to.visual : from.visual, CX + f.dx, GROUND_Y, { scale: f.scale * breathe, t, silhouette: '#ffffff' });
  }

  function drawMotes(ctx: Ctx): void {
    for (const m of motes) {
      const x = Math.round(CX + Math.cos(m.a) * m.r), y = Math.round(GLOW_Y + Math.sin(m.a) * m.r * 0.8);
      ctx.fillStyle = m.color;
      ctx.fillRect(x, y, m.size, m.size);
      // a short trail outward
      ctx.globalAlpha = 0.4;
      ctx.fillRect(Math.round(x + Math.cos(m.a) * 3), Math.round(y + Math.sin(m.a) * 2.4), 1, 1);
      ctx.globalAlpha = 1;
    }
    for (const c of confetti) {
      const a = Math.max(0, 1 - Math.max(0, c.t - 1.6));
      ctx.globalAlpha = a;
      ctx.fillStyle = c.color;
      const flip = Math.floor(c.t * 8 + c.spin) % 2;
      ctx.fillRect(Math.round(c.x), Math.round(c.y), flip ? 3 : 2, flip ? 2 : 3);
      ctx.globalAlpha = 1;
    }
  }

  function drawFlash(ctx: Ctx): void {
    // the white-out around the reveal
    const before = REVEAL_AT - t;
    let a = 0;
    if (!evolved && before < FLASH_UP) a = 1 - before / FLASH_UP;
    else if (evolved) a = Math.max(0, 1 - revealT / 0.6);
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }

  function cardSlide(delay: number): number {
    const k = Math.max(0, Math.min(1, (revealT - delay) / 0.35));
    return 1 - (1 - k) * (1 - k) * (1 - k);
  }

  function drawCards(ctx: Ctx): void {
    if (!evolved || !d || !to || !oldStats || !newStats) return;
    // stats card (right)
    const kR = cardSlide(0.9);
    if (kR > 0) {
      const w = 158, h = 128;
      const x = Math.round(VIEW_W - 8 - w + (1 - kR) * (w + 20)), y = 64;
      drawPanel(ctx, x, y, w, h, { title: 'STATS UP!' });
      STAT_IDS.forEach((s, i) => {
        const yy = y + 12 + i * 14;
        drawText(ctx, STAT_SHORT[s], x + 8, yy, { color: UI.textDim, shadow: false });
        drawText(ctx, String(newStats![s]), x + 96, yy, { color: UI.text, shadow: false, align: 'right' });
        const gain = newStats![s] - oldStats![s];
        if (gain !== 0) drawText(ctx, (gain > 0 ? '+' : '') + gain, x + w - 8, yy, { color: gain > 0 ? '#3f8f4a' : '#c0502a', shadow: false, align: 'right' });
      });
    }
    // form card (left)
    const kL = cardSlide(0.75);
    if (kL > 0) {
      const w = 158, h = 128;
      const x = Math.round(8 - (1 - kL) * (w + 20)), y = 64;
      drawPanel(ctx, x, y, w, h, { title: 'NEW FORM' });
      drawText(ctx, to.name, x + 8, y + 12, { color: UI.text, shadow: false });
      drawText(ctx, wrapText(to.category, w - 16)[0] ?? '', x + 8, y + 23, { color: UI.textDim, shadow: false });
      const gained = to.types.filter((ty) => !oldTypes.includes(ty));
      let bx = x + 8;
      for (const ty of to.types) {
        bx += drawTypeBadge(ctx, ty, bx, y + 34, { small: true }) + 2;
      }
      if (gained.length) drawText(ctx, 'NEW!', x + w - 8, y + 36, { color: '#b8781e', shadow: false, align: 'right' });
      drawText(ctx, learned.length ? 'NEW MOVES' : 'COMING UP', x + 8, y + 52, { color: UI.textDim, shadow: false });
      const items: { m: MoveId; tag: string }[] = [
        ...learned.map((m) => ({ m, tag: 'NOW' })),
        ...upcoming.map((u) => ({ m: u.move, tag: 'LV' + u.level })),
      ].slice(0, 4);
      if (!items.length) drawText(ctx, 'SAME TRUSTY MOVES', x + 8, y + 64, { color: UI.text, shadow: false });
      items.forEach((it, i) => {
        const yy = y + 63 + i * 14;
        const mv = getMove(it.m);
        drawTypeIcon(ctx, mv.type, x + 13, yy + 3, 4);
        drawText(ctx, mv.name, x + 22, yy, { color: UI.text, shadow: false });
        drawText(ctx, it.tag, x + w - 8, yy, { color: it.tag === 'NOW' ? '#3f8f4a' : UI.textDim, shadow: false, align: 'right' });
      });
    }
  }

  function drawMessage(ctx: Ctx): void {
    if (!d || !from) return;
    if (!evolved) {
      const text = t < INTRO + MORPH * 0.5 ? `What? ${oldName} is evolving!` : `${oldName} is glowing brighter and brighter!`;
      if (tw.text !== text) tw.set(text);
      drawMessageBox(ctx, MSG.x, MSG.y, MSG.w, MSG.h, tw, { arrow: false });
      if (t > INTRO) drawText(ctx, 'ESC: SKIP TO THE END', MSG.x + MSG.w - 12, MSG.y - 11, { color: UI.textLightDim, shadowColor: UI.ink, align: 'right' });
      return;
    }
    drawMessageBox(ctx, MSG.x, MSG.y, MSG.w, MSG.h, tw);
    if (lines.length > 1) {
      const pg = `${lineIdx + 1}/${lines.length}`;
      drawText(ctx, pg, MSG.x + MSG.w - 12, MSG.y - 11, { color: UI.textLightDim, shadowColor: UI.ink, align: 'right' });
    }
  }

  function drawTitle(ctx: Ctx): void {
    if (!evolved || !to) return;
    const k = Math.max(0, Math.min(1, (revealT - 0.3) / 0.3));
    if (k <= 0) return;
    const y = Math.round(18 - (1 - k) * 30);
    const text = 'EVOLUTION!';
    const w = measureText(text, 2);
    drawTextOutlined(ctx, text, CX - Math.floor(w / 2), y, { size: 2, color: UI.gold });
  }

  return {
    name: 'evolution',
    overlay: true,
    enter(): void {
      prevMusic = currentMusic();
      music(null);   // a hush: the evolution sounds carry the moment
      if (valid) sfx('levelUp', { volume: 0.7 });
    },
    exit(): void {
      music(prevMusic);
    },
    update,
    draw(ctx: Ctx): void {
      // dim the screen below much further, so the light reads
      ctx.save();
      ctx.globalAlpha = 0.84;
      ctx.fillStyle = UI.ink;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
      if (!valid) {
        drawMessageBox(ctx, MSG.x, MSG.y, MSG.w, MSG.h, 'Hmm, nothing happened. Maybe next time!');
        return;
      }
      ctx.save();
      ctx.translate(Math.round(fx.offsetX), Math.round(fx.offsetY));
      drawRays(ctx);
      drawMotes(ctx);
      drawCreature(ctx);
      fx.draw(ctx);
      ctx.restore();
      drawCards(ctx);
      drawTitle(ctx);
      drawMessage(ctx);
      drawFlash(ctx);
    },
  };
}
