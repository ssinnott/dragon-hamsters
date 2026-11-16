// Chief Nibbles: the retired dragon hamster agent who runs the Secret Burrow.
//
// He is an ordinary drawDragon sprite (CHIEF_VISUAL: grey fur, a red agency scarf, a monocle, long
// grey whiskers and a distinguished tuft) with two things painted on top that no species has: an
// eye patch over his far eye and a mouth that flaps while he talks. Both are drawn in the dragon's
// own head space, so they follow the idle bob and head tilt exactly.
//
// drawChief draws him full length (intro scene, cameo art); drawChiefPortrait draws a framed
// head-and-shoulders crop for dialog boxes.
import type { DragonVisual } from '../data/schema.ts';
import {
  INK, addCirc, addEll, dragonHeadGeo, drawDragon, enterLocal, ink, outlinePx, poseState, strokeLine,
  type CreatureFrame, type Pose,
} from '../art/dragon.ts';
import { UI, fillRoundRect, tint } from './widgets.ts';

type Ctx = CanvasRenderingContext2D;

/** How the Chief is drawn: a big, grey, slightly round elder with his old agency scarf. */
export const CHIEF_VISUAL: DragonVisual = {
  body: '#a8a4b4',
  belly: '#f1ebe0',
  accent: '#c9473d',
  wing: '#d4cedc',
  eye: '#1e1826',
  cheek: '#f2a2aa',
  size: 1.2,
  build: 0.3,
  wings: 'stubby',
  horns: 'none',
  tail: 'stub',
  pattern: 'none',
  extras: ['scarf', 'monocle', 'whiskersLong', 'tuft'],
};

/** Outer size of the framed portrait drawChiefPortrait paints (square). */
export const CHIEF_PORTRAIT_SIZE = 64;

const PATCH = '#2a2232';
const STRAP = '#3a3044';

export interface ChiefOpts {
  /** 1 faces right (default), -1 faces left. */
  facing?: 1 | -1;
  /** Any creature pose; default 'idle'. The patch and talking mouth follow it. */
  pose?: Pose;
  poseT?: number;
  alpha?: number;
}

/**
 * Chief Nibbles standing with his feet at (x, y). At scale 1 he is about 46 px tall.
 * @param talking flap his mouth (pass true while his line is still typing out)
 */
export function drawChief(ctx: Ctx, x: number, y: number, scale: number, t: number, talking: boolean, opts: ChiefOpts = {}): void {
  const v = CHIEF_VISUAL;
  const facing: 1 | -1 = opts.facing === -1 ? -1 : 1;
  const pose = opts.pose ?? 'idle';
  const poseT = opts.poseT ?? 0;
  const alpha = opts.alpha ?? 1;
  drawDragon(ctx, v, x, y, { scale, t, facing, pose, poseT, alpha });

  const G = dragonHeadGeo(v);
  const st = poseState(pose, t, poseT, G.phase);
  if (st.fade * alpha <= 0.004) return;
  const S = scale * v.size;
  const fr: CreatureFrame = { S, facing, alpha, flash: 0, silhouette: null, st, shadowRx: 0 };
  const ow = outlinePx(scale, v.size) / S * 0.5;
  const hr = G.hr;

  ctx.save();
  if (alpha * st.fade < 1) ctx.globalAlpha *= alpha * st.fade;
  ctx.translate(x, y);
  enterLocal(ctx, fr);
  ctx.translate(G.hx + st.headDx, G.hy + st.headDy);
  ctx.rotate(st.tilt);

  // Eye patch over the far eye, its strap running up over the brow and round the back of the head.
  const ex = 0.68 * hr, ey = -0.09 * hr;
  const prx = G.eyeRy * 0.95, pry = G.eyeRy * 1.2;
  ctx.save();
  ctx.beginPath(); addCirc(ctx, 0, 0, hr * 0.985); ctx.clip();
  ctx.beginPath();
  ctx.moveTo(ex - prx * 0.2, ey - pry * 0.9);
  ctx.quadraticCurveTo(0.15 * hr, -0.78 * hr, -0.62 * hr, -0.66 * hr);
  strokeLine(ctx, INK, ow * 3.6);
  ctx.beginPath();
  ctx.moveTo(ex - prx * 0.2, ey - pry * 0.9);
  ctx.quadraticCurveTo(0.15 * hr, -0.78 * hr, -0.62 * hr, -0.66 * hr);
  strokeLine(ctx, STRAP, ow * 1.5);
  ctx.beginPath();
  ctx.moveTo(ex + prx * 0.7, ey - pry * 0.55);
  ctx.quadraticCurveTo(0.98 * hr, -0.32 * hr, 1.02 * hr, -0.12 * hr);
  strokeLine(ctx, INK, ow * 3.2);
  ctx.beginPath();
  ctx.moveTo(ex + prx * 0.7, ey - pry * 0.55);
  ctx.quadraticCurveTo(0.98 * hr, -0.32 * hr, 1.02 * hr, -0.12 * hr);
  strokeLine(ctx, STRAP, ow * 1.2);
  ctx.restore();
  ctx.beginPath(); addEll(ctx, ex, ey, prx, pry, 0.12);
  ink(ctx, PATCH, ow);
  ctx.beginPath(); addEll(ctx, ex - prx * 0.32, ey - pry * 0.42, prx * 0.32, pry * 0.16, -0.5);
  ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();

  // A mouth that flaps while he talks: open-closed a few times a second, never quite in rhythm.
  if (talking && st.pose !== 'sleep' && st.pose !== 'faint') {
    const k = Math.sin(t * 17) * 0.6 + Math.sin(t * 7.3) * 0.4;
    if (k > -0.15) {
      const open = 0.55 + 0.45 * Math.min(1, (k + 0.15) / 0.8);
      const mx = hr * 0.86, my = hr * 0.5;
      const w = 2.6, h = 1.4 + 3.2 * open;
      ctx.beginPath();
      ctx.moveTo(mx - w, my - 0.5);
      ctx.quadraticCurveTo(mx, my + 0.1, mx + w, my - 0.5);
      ctx.quadraticCurveTo(mx + w * 0.85, my + h, mx, my + h);
      ctx.quadraticCurveTo(mx - w * 0.85, my + h, mx - w, my - 0.5);
      ctx.closePath();
      ink(ctx, '#6a2236', ow * 0.8);
      ctx.beginPath(); addEll(ctx, mx + 0.2, my + h * 0.7, w * 0.55, h * 0.24); ctx.fillStyle = '#ff7d8e'; ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * A framed head-and-shoulders portrait of the Chief, CHIEF_PORTRAIT_SIZE square, top-left at (x, y).
 * @param talking flap his mouth
 */
export function drawChiefPortrait(ctx: Ctx, x: number, y: number, t: number, talking: boolean): void {
  x = Math.round(x); y = Math.round(y);
  const S = CHIEF_PORTRAIT_SIZE;
  // wooden frame
  fillRoundRect(ctx, x + 1, y + 2, S, S, 4, 'rgba(27, 20, 38, 0.25)');
  fillRoundRect(ctx, x, y, S, S, 4, UI.ink);
  fillRoundRect(ctx, x + 1, y + 1, S - 2, S - 2, 3, UI.woodDark);
  fillRoundRect(ctx, x + 1, y + 1, S - 2, S - 3, 3, UI.wood);
  ctx.fillStyle = UI.woodLight;
  ctx.fillRect(x + 4, y + 1, S - 8, 1);
  // the picture: a warm office wall with a soft lamp glow behind his head
  const ix = x + 4, iy = y + 4, iw = S - 8, ih = S - 8;
  fillRoundRect(ctx, ix - 1, iy - 1, iw + 2, ih + 2, 2, UI.ink);
  ctx.save();
  ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
  const bg = ctx.createLinearGradient(0, iy, 0, iy + ih);
  bg.addColorStop(0, '#f6d58e'); bg.addColorStop(1, '#d99a5a');
  ctx.fillStyle = bg;
  ctx.fillRect(ix, iy, iw, ih);
  const glow = ctx.createRadialGradient(ix + iw * 0.55, iy + ih * 0.4, 2, ix + iw * 0.55, iy + ih * 0.4, iw * 0.7);
  glow.addColorStop(0, 'rgba(255, 246, 214, 0.85)'); glow.addColorStop(1, 'rgba(255, 246, 214, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(ix, iy, iw, ih);
  // wallpaper stripes
  ctx.fillStyle = 'rgba(160, 90, 40, 0.13)';
  for (let sx = ix + 3; sx < ix + iw; sx += 8) ctx.fillRect(sx, iy, 3, ih);
  const scale = 1.2;
  const G = dragonHeadGeo(CHIEF_VISUAL);
  const headX = G.hx * CHIEF_VISUAL.size * scale;
  const headY = G.hy * CHIEF_VISUAL.size * scale;
  drawChief(ctx, Math.round(ix + iw / 2 - headX - 5), Math.round(iy + ih * 0.6 - headY), scale, t, talking);
  ctx.restore();
  // a little brass name plate at the bottom of the frame
  const pw = 22, px = x + Math.floor((S - pw) / 2), py = y + S - 4;
  fillRoundRect(ctx, px, py - 1, pw, 5, 1, UI.ink);
  fillRoundRect(ctx, px + 1, py, pw - 2, 3, 1, UI.gold);
  ctx.fillStyle = tint(UI.gold, 0.5);
  ctx.fillRect(px + 2, py, pw - 4, 1);
}
