// Dragon hamster renderer: one procedural, cel-shaded sprite for every species, driven by DragonVisual.
//
// Local space: a size-1.0 dragon is about 40 units tall, authored facing RIGHT, origin on the ground point
// between the feet, y negative = up. drawDragon scales local units by `scale * size` and mirrors for
// facing -1, so every measurement below is in "size-1 pixels at scale 1".
//
// Draw order, back to front: aura, far wing, far ear + horns, tail, far feet, the body/head/cheek blob
// (one shared ink outline, cel shadow underneath, highlight on top, pattern, belly, muzzle), shell,
// feet and paws, face, near-side headwear, near wing, accessories, particles. Particles that contain
// letters (the sleep Z) are drawn unmirrored.
//
// The pose machinery (poseState), the hit-flash / silhouette / fade layer (drawCreatureFrame) and a few
// particle helpers are exported for src/art/villain.ts, which shares them.

import type { DragonVisual, DragonExtra } from '../data/schema.ts';
import { shade, mix, rgba } from '../lib/art/palettes.ts';
import { pathStar, pathGear, pathTaperedCapsule } from '../lib/art/shapes.ts';
import { clamp, ease } from '../lib/engine/math.ts';

// ---------------------------------------------------------------------------------------------
// Public contract (docs/API.md "src/art")
// ---------------------------------------------------------------------------------------------

export type Pose = 'idle' | 'walk' | 'attack' | 'hurt' | 'faint' | 'happy' | 'sleep' | 'eat' | 'run' | 'dig';
/** Every pose, in a sensible display order (galleries, tests). */
export const POSES: readonly Pose[] = ['idle', 'walk', 'run', 'attack', 'hurt', 'faint', 'happy', 'sleep', 'eat', 'dig'];

export interface CreatureOpts {
  /** 1 = a size-1.0 creature about 40 px tall; battle uses ~2. */
  scale?: number;
  /** 1 faces right (player side), -1 faces left (enemy side). */
  facing?: 1 | -1;
  /** Seconds; drives idle bob, blink, wing flap and the looping poses. */
  t?: number;
  pose?: Pose;
  /** 0..1 progress through a one-shot pose (attack lunge, hurt recoil, faint sink). */
  poseT?: number;
  alpha?: number;
  /** Draw as one flat colour (undiscovered dex entries). */
  silhouette?: string | null;
  /** 0..1 white hit flash. */
  flash?: number;
}

/** The game's ink: every creature outline. */
export const INK = '#1b1426';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Pose state, shared with villain.ts
// ---------------------------------------------------------------------------------------------

export type EyeMode = 'open' | 'closed' | 'happy' | 'hurt' | 'dizzy' | 'fierce';
export type MouthMode = 'smile' | 'open' | 'grin' | 'chew' | 'wavy' | 'o';
export type PawMode = 'rest' | 'walk' | 'dig' | 'eat' | 'attack' | 'up' | 'limp' | 'fold';

/** Everything a pose does to a creature this frame, in facing-right local units. */
export interface PoseState {
  pose: Pose;
  /** Clock (seconds) and one-shot progress (0..1). */
  t: number;
  p: number;
  /** Root offset; +x is toward the facing direction. */
  ox: number;
  oy: number;
  /** Root rotation in radians about (pivotX, 0); positive leans forward. */
  rot: number;
  pivotX: number;
  /** Squash and stretch about the ground point. */
  sx: number;
  sy: number;
  /** Head offset and tilt (radians, positive = nose down). */
  headDx: number;
  headDy: number;
  tilt: number;
  eyes: EyeMode;
  mouth: MouthMode;
  /** Wing flap angle and tail sway angle, radians. */
  wing: number;
  tail: number;
  /** Walk cycle phase (radians) and foot lift amplitude (0 = planted). */
  step: number;
  stepAmp: number;
  paws: PawMode;
  /** Cheek puff 0..1 and chew 0..1 (eat). */
  puff: number;
  chew: number;
  /** Alpha multiplier (faint fades out). */
  fade: number;
  /** Height above the ground (hops); shrinks the ground shadow. */
  lift: number;
  zzz: boolean;
  dirt: boolean;
  sweat: boolean;
  hearts: boolean;
  seed: boolean;
}

function blinkClosed(t: number, phase: number): boolean {
  const period = 3.1 + phase * 1.7;
  const u = (t + phase * 11.3) % period;
  return u < 0.13 || (phase > 0.6 && u > 0.3 && u < 0.4);
}

/**
 * Compute a pose frame. `phase` (0..1) is a per-creature constant that desynchronises blinks and bobs,
 * so a burrow full of dragons does not breathe in lockstep.
 */
export function poseState(pose: Pose, t: number, poseT: number, phase: number): PoseState {
  const p = clamp(poseT, 0, 1);
  const s: PoseState = {
    pose, t, p, ox: 0, oy: 0, rot: 0, pivotX: 0, sx: 1, sy: 1, headDx: 0, headDy: 0, tilt: 0,
    eyes: blinkClosed(t, phase) ? 'closed' : 'open', mouth: 'smile', wing: 0, tail: 0, step: 0, stepAmp: 0,
    paws: 'rest', puff: 0, chew: 0, fade: 1, lift: 0, zzz: false, dirt: false, sweat: false, hearts: false, seed: false,
  };
  const ph = phase * TAU;
  switch (pose) {
    case 'idle': {
      const br = Math.sin(t * 2.4 + ph);
      s.sy = 1 + 0.028 * br; s.sx = 1 - 0.014 * br; s.headDy = -0.35 * br;
      s.wing = 0.14 * Math.sin(t * 3.1 + ph); s.tail = 0.14 * Math.sin(t * 1.7 + ph);
      s.tilt = 0.05 * Math.sin(t * 0.8 + ph * 3);
      break;
    }
    case 'walk': {
      s.step = t * TAU * 2.1 + ph; s.stepAmp = 1;
      const b = Math.abs(Math.sin(s.step));
      s.oy = -1.4 * b; s.rot = 0.05 * Math.sin(s.step);
      s.sy = 1 + 0.03 * Math.cos(s.step * 2); s.sx = 1 - 0.02 * Math.cos(s.step * 2);
      s.wing = 0.22 * Math.sin(s.step); s.tail = 0.22 * Math.sin(s.step + 1); s.paws = 'walk';
      break;
    }
    case 'run': {
      s.step = t * TAU * 3.6 + ph; s.stepAmp = 1.7;
      s.oy = -3 * Math.abs(Math.sin(s.step)); s.rot = 0.13 + 0.04 * Math.sin(s.step * 2);
      s.sy = 1 + 0.06 * Math.cos(s.step * 2); s.sx = 1 - 0.04 * Math.cos(s.step * 2);
      s.headDx = 0.8; s.wing = -0.15 + 0.5 * Math.sin(s.step * 2); s.tail = -0.25 + 0.15 * Math.sin(s.step);
      s.mouth = 'o'; s.paws = 'walk';
      break;
    }
    case 'attack': {
      if (p < 0.22) {
        const k = ease.outQuad(p / 0.22);
        s.ox = -3.5 * k; s.rot = -0.13 * k; s.sx = 1 - 0.05 * k; s.sy = 1 + 0.05 * k;
      } else if (p < 0.42) {
        const k = ease.outCubic((p - 0.22) / 0.2);
        s.ox = -3.5 + 19.5 * k; s.rot = -0.13 + 0.33 * k; s.sx = 1.05 + 0.08 * k; s.sy = 1.05 - 0.13 * k;
      } else if (p < 0.56) {
        const k = (p - 0.42) / 0.14;
        s.ox = 16; s.rot = 0.2; s.sx = 1.13 - 0.1 * k; s.sy = 0.92 + 0.06 * k;
      } else {
        const k = ease.inOutQuad((p - 0.56) / 0.44);
        s.ox = 16 * (1 - k); s.rot = 0.2 * (1 - k); s.sx = 1.03 - 0.03 * k; s.sy = 0.98 + 0.02 * k;
      }
      s.eyes = 'fierce'; s.mouth = 'open'; s.paws = 'attack';
      s.wing = -0.35 + 0.5 * Math.sin(t * 22); s.tail = -0.2;
      break;
    }
    case 'hurt': {
      const k = p < 0.12 ? p / 0.12 : Math.max(0, 1 - (p - 0.12) / 0.88);
      const kk = ease.outQuad(k);
      s.ox = -7 * kk + Math.sin(p * 70) * 1.1 * (1 - p); s.rot = -0.22 * kk;
      s.sx = 1 + 0.16 * kk; s.sy = 1 - 0.15 * kk; s.headDy = 0.8 * kk;
      s.eyes = 'hurt'; s.mouth = 'wavy'; s.paws = 'up'; s.sweat = true;
      s.wing = 0.3 * kk; s.tail = 0.35 * kk;
      break;
    }
    case 'faint': {
      const wob = p < 0.2 ? Math.sin(p * 45) * 0.08 * (p / 0.2) : 0;
      const k = ease.inQuad(clamp((p - 0.15) / 0.45, 0, 1));
      const bounce = p > 0.6 ? Math.sin((p - 0.6) * 28) * 0.07 * (1 - (p - 0.6) / 0.4) : 0;
      s.rot = wob - 1.42 * k + bounce; s.pivotX = -9;
      s.oy = 5 * ease.inQuad(clamp((p - 0.5) / 0.5, 0, 1));
      s.fade = 1 - clamp((p - 0.65) / 0.35, 0, 1);
      s.eyes = 'dizzy'; s.mouth = 'o'; s.paws = 'limp'; s.wing = 0.45 * k; s.tail = 0.4 * k;
      s.headDy = 0.6 * k;
      break;
    }
    case 'happy': {
      const hp = (t * 1.55 + phase) % 1;
      const air = hp < 0.62 ? Math.sin((hp / 0.62) * Math.PI) : 0;
      const land = hp >= 0.62 ? Math.sin(((hp - 0.62) / 0.38) * Math.PI) : 0;
      s.oy = -8 * air; s.lift = 8 * air;
      s.sy = 1 + 0.07 * air - 0.12 * land; s.sx = 1 - 0.04 * air + 0.1 * land;
      s.eyes = 'happy'; s.mouth = 'grin'; s.paws = 'up'; s.hearts = true;
      s.wing = 0.4 * Math.sin(t * 15); s.tail = 0.3 * Math.sin(t * 12);
      break;
    }
    case 'sleep': {
      const br = Math.sin(t * 1.4 + ph);
      s.sy = 0.86 + 0.03 * br; s.sx = 1.08 - 0.015 * br;
      s.headDy = 2.4; s.headDx = 0.4; s.tilt = 0.14;
      s.eyes = 'closed'; s.mouth = 'smile'; s.paws = 'fold'; s.zzz = true;
      s.wing = 0.3; s.tail = 0.35;
      break;
    }
    case 'eat': {
      const c = (Math.sin(t * 14) + 1) / 2;
      s.chew = c; s.puff = 0.75 + 0.25 * c; s.headDy = 0.6 * c;
      const br = Math.sin(t * 2.4 + ph);
      s.sy = 1 + 0.02 * br; s.eyes = blinkClosed(t * 0.5, phase) ? 'open' : 'happy'; s.mouth = 'chew';
      s.paws = 'eat'; s.seed = true; s.wing = 0.1 * Math.sin(t * 3); s.tail = 0.2 * Math.sin(t * 5);
      break;
    }
    case 'dig': {
      s.rot = 0.3; s.headDy = 1.2; s.oy = -0.6 * Math.abs(Math.sin(t * 16));
      s.eyes = 'fierce'; s.mouth = 'o'; s.paws = 'dig'; s.dirt = true;
      s.tail = 0.3 * Math.sin(t * 9); s.wing = 0.15 * Math.sin(t * 9);
      break;
    }
  }
  return s;
}

/** A stable 0..1 number from a list of strings and numbers (blink phase, pattern jitter). */
export function hash01(parts: readonly (string | number)[]): number {
  let h = 2166136261;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  }
  return ((h >>> 0) % 10007) / 10007;
}

// ---------------------------------------------------------------------------------------------
// Frame compositor: ground shadow, hit flash, silhouette, fade (shared with villain.ts)
// ---------------------------------------------------------------------------------------------

/** One creature draw call as the compositor needs it. */
export interface CreatureFrame {
  /** Screen px per local unit: scale * size. */
  S: number;
  facing: 1 | -1;
  alpha: number;
  flash: number;
  silhouette: string | null;
  st: PoseState;
  /** Ground shadow half-width in local units (0 = none). */
  shadowRx: number;
}

let layerCanvas: HTMLCanvasElement | null = null;
let layerCtx: CanvasRenderingContext2D | null = null;

function layer(w: number, h: number): CanvasRenderingContext2D {
  if (!layerCanvas || !layerCtx || layerCanvas.width < w || layerCanvas.height < h) {
    const c: HTMLCanvasElement = layerCanvas ?? document.createElement('canvas');
    c.width = Math.max(w, layerCanvas ? layerCanvas.width : 0);
    c.height = Math.max(h, layerCanvas ? layerCanvas.height : 0);
    layerCanvas = c;
    layerCtx = c.getContext('2d')!;
  }
  return layerCtx;
}

/** Soft oval contact shadow on the ground, shrinking while the creature is airborne. */
export function drawGroundShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, lift: number, alpha: number): void {
  if (rx <= 0) return;
  const k = 1 / (1 + lift * 0.06);
  ctx.save();
  ctx.globalAlpha *= alpha * 0.24 * k;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(x, y, rx * k, Math.max(1, rx * 0.2 * k), 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw one creature through the shared compositor. `draw(g, fx)` paints the creature with `g` translated
 * to the ground point (screen px, unmirrored); `fx` is false for silhouettes (no particles).
 * Flash, silhouette and any alpha below 1 render into an offscreen layer first, so overlapping parts fade
 * as one sprite and the tint can use source-atop compositing.
 */
export function drawCreatureFrame(ctx: CanvasRenderingContext2D, x: number, y: number, fr: CreatureFrame,
  draw: (g: CanvasRenderingContext2D, fx: boolean) => void): void {
  const a = fr.alpha * fr.st.fade;
  if (a <= 0.004) return;
  if (!fr.silhouette) drawGroundShadow(ctx, x + fr.st.ox * fr.S * fr.facing, y, fr.shadowRx * fr.S, fr.st.lift, a);
  const layered = fr.flash > 0.004 || !!fr.silhouette || a < 0.996;
  if (!layered) {
    ctx.save(); ctx.translate(x, y); draw(ctx, true); ctx.restore();
    return;
  }
  const S = fr.S;
  const half = Math.ceil(60 * S), top = Math.ceil(100 * S), w = half * 2, h = top + Math.ceil(16 * S);
  const g = layer(w, h);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.clearRect(0, 0, w, h);
  g.save(); g.translate(half, top); draw(g, !fr.silhouette); g.restore();
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (fr.silhouette) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = fr.silhouette; g.fillRect(0, 0, w, h);
  }
  if (fr.flash > 0.004) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(255,255,255,${clamp(fr.flash, 0, 1).toFixed(3)})`; g.fillRect(0, 0, w, h);
  }
  g.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.drawImage(g.canvas, 0, 0, w, h, Math.round(x - half), Math.round(y - top), w, h);
  ctx.restore();
}

/** Outline half-width in screen px for a creature drawn at `scale` and `size`. */
export function outlinePx(scale: number, size: number): number {
  return Math.max(0.9, scale * (0.88 + 0.16 * size));
}

/**
 * Enter the creature's local space: mirror for facing, apply the pose root offset, rotation and squash,
 * then scale to local units. Call inside save/restore.
 */
export function enterLocal(g: CanvasRenderingContext2D, fr: CreatureFrame): void {
  const st = fr.st, S = fr.S;
  g.scale(fr.facing, 1);
  g.translate(st.ox * S, st.oy * S);
  if (st.rot !== 0) { g.translate(st.pivotX * S, 0); g.rotate(st.rot); g.translate(-st.pivotX * S, 0); }
  g.scale(S * st.sx, S * st.sy);
}

/** Map a facing-right local point to the unmirrored ground-point space (for letters and upright particles). */
export function localToGround(fr: CreatureFrame, lx: number, ly: number, out: { x: number; y: number }): { x: number; y: number } {
  const st = fr.st, S = fr.S;
  let x = lx * st.sx, y = ly * st.sy;
  if (st.rot !== 0) {
    const c = Math.cos(st.rot), s = Math.sin(st.rot), px = st.pivotX;
    const dx = x - px;
    x = px + dx * c - y * s; y = dx * s + y * c;
  }
  out.x = (x + st.ox) * S * fr.facing;
  out.y = (y + st.oy) * S;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Path and paint helpers
// ---------------------------------------------------------------------------------------------

/** Append an ellipse sub-path (no beginPath), so several shapes share one outline. */
export function addEll(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, rot = 0): void {
  rx = Math.max(0.05, rx); ry = Math.max(0.05, ry);
  g.moveTo(cx + Math.cos(rot) * rx, cy + Math.sin(rot) * rx);
  g.ellipse(cx, cy, rx, ry, rot, 0, TAU);
}
/** Append a circle sub-path. */
export function addCirc(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  r = Math.max(0.05, r);
  g.moveTo(cx + r, cy);
  g.arc(cx, cy, r, 0, TAU);
}
/** Stroke the current path in ink (`ow` shows outside the fill), then fill it. */
export function ink(g: CanvasRenderingContext2D, fill: string | null, ow: number, outline: string = INK): void {
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = outline; g.lineWidth = ow * 2; g.stroke();
  if (fill) { g.fillStyle = fill; g.fill(); }
}
/** Stroke the current path as a detail line. */
export function strokeLine(g: CanvasRenderingContext2D, color: string, w: number): void {
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = color; g.lineWidth = w; g.stroke();
}

const SCR = new Float64Array(80);
/**
 * Append a closed tapered band along a quadratic curve (horns, whiskers, feathers): width w0 at the start,
 * w1 at the end.
 */
export function addTaperQuad(g: CanvasRenderingContext2D, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w0: number, w1: number, n = 8): void {
  n = Math.min(n, 19);
  for (let i = 0; i <= n; i++) {
    const u = i / n, iu = 1 - u;
    const x = iu * iu * x0 + 2 * iu * u * cx + u * u * x1;
    const y = iu * iu * y0 + 2 * iu * u * cy + u * u * y1;
    const dx = 2 * iu * (cx - x0) + 2 * u * (x1 - cx), dy = 2 * iu * (cy - y0) + 2 * u * (y1 - cy);
    const len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, w = (w0 + (w1 - w0) * u) / 2;
    SCR[i * 4] = x + nx * w; SCR[i * 4 + 1] = y + ny * w; SCR[i * 4 + 2] = x - nx * w; SCR[i * 4 + 3] = y - ny * w;
  }
  g.moveTo(SCR[0], SCR[1]);
  for (let i = 1; i <= n; i++) g.lineTo(SCR[i * 4], SCR[i * 4 + 1]);
  for (let i = n; i >= 0; i--) g.lineTo(SCR[i * 4 + 2], SCR[i * 4 + 3]);
  g.closePath();
}

/** Append a flame tongue rising from (x, y): width w, height h, tip swaying by `sway`. */
export function addFlame(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, sway: number): void {
  const hw = w / 2;
  g.moveTo(x - hw, y);
  g.bezierCurveTo(x - hw * 1.25, y - h * 0.38, x - hw * 0.3 + sway * 0.3, y - h * 0.62, x + sway, y - h);
  g.bezierCurveTo(x + hw * 0.2 + sway * 0.5, y - h * 0.66, x + hw * 1.3, y - h * 0.42, x + hw, y);
  g.quadraticCurveTo(x, y + hw * 0.7, x - hw, y);
  g.closePath();
}

/** Append a leaf (pointed oval) from (x, y) along angle `a`, length l, width w. */
export function addLeaf(g: CanvasRenderingContext2D, x: number, y: number, a: number, l: number, w: number): void {
  const c = Math.cos(a), s = Math.sin(a), nx = -s, ny = c;
  const tx = x + c * l, ty = y + s * l;
  g.moveTo(x, y);
  g.quadraticCurveTo(x + c * l * 0.5 + nx * w, y + s * l * 0.5 + ny * w, tx, ty);
  g.quadraticCurveTo(x + c * l * 0.5 - nx * w, y + s * l * 0.5 - ny * w, x, y);
  g.closePath();
}

/** Darker, slightly cooler tone (cel shadow). */
export function dark(hex: string, f: number): string { return mix(shade(hex, f), '#2c2358', 0.14); }
/** Lighter, slightly warmer tone (cel highlight). */
export function light(hex: string, k: number): string { return mix(hex, '#fffbea', k); }

/** A 4-point twinkle. */
export function drawTwinkle(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, ow: number): void {
  if (r < 0.2) return;
  g.beginPath();
  g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); g.closePath();
  ink(g, color, ow * 0.6);
}

/** A little heart (happy pose). */
export function drawHeart(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, ow: number): void {
  g.beginPath();
  g.moveTo(x, y + r * 0.9);
  g.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.8, y - r * 1.3, x, y - r * 0.45);
  g.bezierCurveTo(x + r * 0.8, y - r * 1.3, x + r * 1.5, y - r * 0.1, x, y + r * 0.9);
  g.closePath();
  ink(g, color, ow * 0.7);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath(); g.arc(x - r * 0.45, y - r * 0.35, r * 0.22, 0, TAU); g.fill();
}

/** A sweat drop (hurt pose). */
export function drawSweat(g: CanvasRenderingContext2D, x: number, y: number, r: number, ow: number): void {
  g.beginPath();
  g.moveTo(x, y - r * 1.8);
  g.quadraticCurveTo(x + r * 1.1, y - r * 0.2, x, y + r);
  g.quadraticCurveTo(x - r * 1.1, y - r * 0.2, x, y - r * 1.8);
  g.closePath();
  ink(g, '#bfe8ff', ow * 0.7);
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(x - r * 0.3, y - r * 0.2, r * 0.25, 0, TAU); g.fill();
}

/**
 * Sleep Zs rising from (x, y) in unmirrored ground-point space. `u` is screen px per local unit.
 * Each Z drifts up and away, growing and fading, with a soft round bubble behind it.
 */
export function drawZzz(g: CanvasRenderingContext2D, x: number, y: number, u: number, t: number, facing: 1 | -1): void {
  for (let i = 0; i < 3; i++) {
    const k = (t * 0.45 + i / 3) % 1;
    const zx = x + facing * (2 + k * 9) * u + Math.sin(k * 6 + i) * 1.2 * u;
    const zy = y - (k * 16) * u;
    const r = (1.8 + k * 2.2) * u;
    const a = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
    g.save();
    g.globalAlpha *= a;
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.strokeStyle = INK; g.lineWidth = Math.max(1, u * 0.7);
    g.beginPath(); g.arc(zx, zy, r * 1.25, 0, TAU); g.fill(); g.stroke();
    g.beginPath();
    g.moveTo(zx - r * 0.6, zy - r * 0.6); g.lineTo(zx + r * 0.6, zy - r * 0.6);
    g.lineTo(zx - r * 0.6, zy + r * 0.6); g.lineTo(zx + r * 0.6, zy + r * 0.6);
    g.lineJoin = 'miter'; g.lineCap = 'square'; g.strokeStyle = '#4a3a8a'; g.lineWidth = Math.max(1, r * 0.32); g.stroke();
    g.restore();
  }
}

/** Dirt clods flung backward while digging (local, facing right; the ground is y = 0). */
export function drawDirt(g: CanvasRenderingContext2D, x: number, t: number, ow: number, color = '#8a5a34'): void {
  for (let i = 0; i < 5; i++) {
    const k = (t * 2.2 + i * 0.21) % 1;
    const dx = x - 3 - k * 16 - i * 1.5;
    const dy = -Math.sin(k * Math.PI) * (8 + i * 2.2);
    const r = 1.6 - k * 0.7 + (i % 2) * 0.4;
    g.beginPath(); addCirc(g, dx, dy, r);
    ink(g, i % 2 ? color : shade(color, 0.8), ow * 0.6);
  }
}

/** Dizzy spiral eye. */
export function drawSpiral(g: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, w: number): void {
  g.beginPath();
  const turns = 2.2, n = 22, a0 = t * 6;
  for (let i = 0; i <= n; i++) {
    const u = i / n, a = a0 + u * turns * TAU, rr = r * u;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  strokeLine(g, INK, w);
}

// ---------------------------------------------------------------------------------------------
// Dragon palette and geometry (cached per visual object)
// ---------------------------------------------------------------------------------------------

interface DPal {
  body: string; bodySh: string; bodyHi: string; bodyFar: string;
  belly: string; bellySh: string;
  accent: string; accentSh: string; accentHi: string; accentFar: string;
  wing: string; wingSh: string; wingHi: string; wingFar: string; wingFarSh: string;
  eye: string; eyeLow: string; cheek: string; earIn: string; nose: string;
  paw: string; pawSh: string;
}

interface DGeo {
  b: number; f: number;
  bx: number; by: number; brx: number; bry: number;
  hx: number; hy: number; hr: number;
  earR: number; eyeRy: number;
  wingL: number; hornK: number; tailL: number;
  /** Highest point at rest (ear tops), local units, negative. */
  top: number;
  phase: number;
  extras: Set<DragonExtra>;
}

const palCache = new WeakMap<DragonVisual, DPal>();
const geoCache = new WeakMap<DragonVisual, DGeo>();

function dpal(v: DragonVisual): DPal {
  let P = palCache.get(v);
  if (P) return P;
  const farK = 0.74;
  P = {
    body: v.body, bodySh: dark(v.body, 0.78), bodyHi: light(v.body, 0.32), bodyFar: dark(v.body, farK),
    belly: v.belly, bellySh: dark(v.belly, 0.86),
    accent: v.accent, accentSh: dark(v.accent, 0.74), accentHi: light(v.accent, 0.4), accentFar: dark(v.accent, farK),
    wing: v.wing, wingSh: dark(v.wing, 0.78), wingHi: light(v.wing, 0.4), wingFar: dark(v.wing, farK), wingFarSh: dark(v.wing, farK * 0.8),
    eye: v.eye, eyeLow: mix(v.eye, '#ffffff', 0.32), cheek: v.cheek,
    earIn: mix(v.cheek, v.belly, 0.45), nose: mix(v.cheek, INK, 0.35),
    paw: mix(v.belly, v.cheek, 0.22), pawSh: dark(mix(v.belly, v.cheek, 0.22), 0.82),
  };
  palCache.set(v, P);
  return P;
}

function dgeo(v: DragonVisual): DGeo {
  let G = geoCache.get(v);
  if (G) return G;
  const b = clamp(v.build, 0, 1), f = clamp((v.size - 0.7) / 0.8, 0, 1);
  const brx = 12.6 + 2.6 * f + 4.6 * b;
  const bry = 11.6 + 1.0 * f - 2.2 * b;
  const bx = -2 - 1.6 * b;
  const by = -(bry + 1.3);
  const hr = 11.3 - 1.3 * f;
  const hx = bx + brx * 0.56 + 1.4 * b;
  const hy = by - bry * 0.6 - hr * 0.48;
  const earR = hr * (0.36 - 0.04 * f);
  G = {
    b, f, bx, by, brx, bry, hx, hy, hr, earR,
    eyeRy: hr * (0.31 - 0.05 * f),
    wingL: 9.5 + 5.5 * f,
    hornK: 0.85 + 0.5 * f,
    tailL: 9 + 5 * f + 3 * b,
    top: hy - hr * 0.86 - earR * 0.9,
    phase: hash01([v.body, v.belly, v.accent, v.wing, v.size, v.build, v.wings, v.horns, v.tail]),
    extras: new Set(v.extras),
  };
  geoCache.set(v, G);
  return G;
}

/** Height in px of a dragon drawn at `scale` (ground to ear tips; horns and hats stick out above). */
export function dragonHeight(v: DragonVisual, scale = 1): number {
  return -dgeo(v).top * v.size * scale;
}

// ---------------------------------------------------------------------------------------------
// Per-draw context
// ---------------------------------------------------------------------------------------------

interface DC {
  v: DragonVisual; P: DPal; G: DGeo; st: PoseState; fr: CreatureFrame;
  ow: number; t: number; fx: boolean;
  /** Posed head centre, tilt cos/sin. */
  hx: number; hy: number; hc: number; hs: number;
}

/** Head-local point -> body-local x. */
function hX(D: DC, lx: number, ly: number): number { return D.hx + lx * D.hc - ly * D.hs; }
/** Head-local point -> body-local y. */
function hY(D: DC, lx: number, ly: number): number { return D.hy + lx * D.hs + ly * D.hc; }

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export function drawDragon(ctx: CanvasRenderingContext2D, v: DragonVisual, x: number, y: number, opts: CreatureOpts = {}): void {
  const scale = opts.scale ?? 1;
  const facing: 1 | -1 = opts.facing === -1 ? -1 : 1;
  const t = opts.t ?? 0;
  const G = dgeo(v), P = dpal(v);
  const st = poseState(opts.pose ?? 'idle', t, opts.poseT ?? 0, G.phase);
  const S = scale * v.size;
  const fr: CreatureFrame = {
    S, facing, alpha: opts.alpha ?? 1, flash: opts.flash ?? 0, silhouette: opts.silhouette ?? null, st,
    shadowRx: G.brx * 1.02,
  };
  const ow = outlinePx(scale, v.size) / S * 0.5;
  drawCreatureFrame(ctx, x, y, fr, (g, fx) => {
    const D: DC = {
      v, P, G, st, fr, ow, t, fx,
      hx: G.hx + st.headDx, hy: G.hy + st.headDy, hc: Math.cos(st.tilt), hs: Math.sin(st.tilt),
    };
    g.save();
    enterLocal(g, fr);
    renderDragon(g, D);
    g.restore();
    if (fx && st.zzz) {
      const pt = localToGround(fr, hX(D, G.hr * 0.6, -G.hr * 1.1), hY(D, G.hr * 0.6, -G.hr * 1.1), { x: 0, y: 0 });
      drawZzz(g, pt.x, pt.y, S, t, facing);
    }
  });
}

function renderDragon(g: CanvasRenderingContext2D, D: DC): void {
  const { G, st } = D;
  const ex = G.extras;
  if (ex.has('aura') && D.fx) drawAura(g, D);
  if (ex.has('scarf')) drawScarfTails(g, D);
  if (ex.has('mask')) drawMaskTails(g, D);
  drawWing(g, D, false);
  drawEars(g, D);
  drawHorns(g, D, false);
  drawTail(g, D);
  drawFeet(g, D, false);
  drawBodyBlob(g, D);
  if (ex.has('shell')) drawShell(g, D);
  if (ex.has('apron')) drawApron(g, D);
  drawFeet(g, D, true);
  if (ex.has('drips')) drawDrips(g, D);
  if (ex.has('scarf')) drawScarf(g, D);
  if (ex.has('bowtie')) drawBowtie(g, D);
  drawPaws(g, D);
  drawHead(g, D);
  drawWing(g, D, true);
  if (D.fx) drawParticles(g, D);
  if (st.dirt && D.fx) drawDirt(g, G.bx - G.brx * 0.6, D.t, D.ow);
}

// ---------------------------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------------------------

function cheekNear(D: DC): { x: number; y: number; r: number } {
  const hr = D.G.hr;
  return { x: hX(D, -0.04 * hr, 0.46 * hr), y: hY(D, -0.04 * hr, 0.46 * hr), r: hr * 0.4 * (1 + 0.3 * D.st.puff) };
}
function cheekFar(D: DC): { x: number; y: number; r: number } {
  const hr = D.G.hr;
  return { x: hX(D, 0.8 * hr, 0.47 * hr), y: hY(D, 0.8 * hr, 0.47 * hr), r: hr * 0.3 * (1 + 0.42 * D.st.puff) };
}

function blobPath(g: CanvasRenderingContext2D, D: DC, shrink: number, dy: number): void {
  const { G } = D;
  const cn = cheekNear(D), cf = cheekFar(D);
  g.beginPath();
  addEll(g, G.bx, G.by + dy * G.bry, G.brx * shrink, G.bry * shrink);
  addCirc(g, D.hx, D.hy + dy * G.hr, G.hr * shrink);
  addCirc(g, cn.x, cn.y + dy * cn.r, cn.r * shrink);
  addCirc(g, cf.x, cf.y + dy * cf.r, cf.r * shrink);
}

function drawBodyBlob(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P, v } = D;
  blobPath(g, D, 1, 0);
  ink(g, P.bodySh, D.ow);
  g.save();
  g.clip();
  // Lit base: the same shapes nudged up leave a shadow crescent along the underside.
  blobPath(g, D, 0.99, -0.13);
  g.fillStyle = P.body; g.fill();
  if (v.pattern !== 'none') drawPattern(g, D);
  // Belly patch with its own underside shade.
  g.beginPath(); addEll(g, G.bx + G.brx * 0.36, G.by + G.bry * 0.3, G.brx * 0.58, G.bry * 0.72);
  g.fillStyle = P.bellySh; g.fill();
  g.beginPath(); addEll(g, G.bx + G.brx * 0.37, G.by + G.bry * 0.18, G.brx * 0.54, G.bry * 0.66);
  g.fillStyle = P.belly; g.fill();
  // Final stages get a fluffy chest ruff.
  if (G.f > 0.55) {
    const cx = G.bx + G.brx * 0.5, cy = G.by - G.bry * 0.38;
    g.beginPath();
    g.moveTo(cx - 4, cy);
    for (let i = 0; i < 4; i++) { g.lineTo(cx - 3 + i * 2.2, cy + 2.6); g.lineTo(cx - 2 + i * 2.2, cy + 0.6); }
    g.lineTo(cx + 5, cy - 2); g.closePath();
    g.fillStyle = P.belly; g.fill();
  }
  // Muzzle: belly-coloured snout and chin.
  const hr = G.hr;
  g.beginPath(); addEll(g, hX(D, 0.68 * hr, 0.46 * hr), hY(D, 0.68 * hr, 0.46 * hr), hr * 0.46, hr * 0.36, D.st.tilt);
  g.fillStyle = P.belly; g.fill();
  // Highlights: a soft cap on the head and a sheen along the back.
  g.beginPath();
  addEll(g, hX(D, -0.3 * hr, -0.58 * hr), hY(D, -0.3 * hr, -0.58 * hr), hr * 0.42, hr * 0.19, -0.42 + D.st.tilt);
  addEll(g, G.bx - G.brx * 0.3, G.by - G.bry * 0.7, G.brx * 0.34, G.bry * 0.13, -0.22);
  g.fillStyle = P.bodyHi; g.fill();
  g.restore();
  // Near cheek: a separate puffy ball over the muzzle edge.
  const cn = cheekNear(D);
  g.save();
  blobPath(g, D, 1, 0); g.clip();
  g.beginPath(); addCirc(g, cn.x, cn.y + cn.r * 0.06, cn.r * 0.98);
  g.fillStyle = P.bodySh; g.fill();
  g.beginPath(); addCirc(g, cn.x - cn.r * 0.06, cn.y - cn.r * 0.06, cn.r * 0.9);
  g.fillStyle = P.body; g.fill();
  g.restore();
  g.beginPath();
  g.arc(cn.x, cn.y, cn.r, -0.25 + D.st.tilt, 1.05 + D.st.tilt);
  strokeLine(g, P.bodySh, D.ow * 1.1);
  // Blush.
  g.fillStyle = rgba(P.cheek, 0.85);
  g.beginPath(); addEll(g, cn.x + cn.r * 0.18, cn.y - cn.r * 0.08, cn.r * 0.52, cn.r * 0.32, D.st.tilt); g.fill();
  const cf = cheekFar(D);
  g.beginPath(); addEll(g, cf.x + cf.r * 0.25, cf.y - cf.r * 0.3, cf.r * 0.45, cf.r * 0.3, D.st.tilt); g.fill();
}

function drawPattern(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P, v } = D;
  const { bx, by, brx, bry, hr } = G;
  const col = P.accent;
  g.fillStyle = col;
  switch (v.pattern) {
    case 'spots': {
      g.beginPath();
      addEll(g, bx - brx * 0.45, by - bry * 0.42, 2.8, 2.4, 0.3);
      addEll(g, bx - brx * 0.05, by - bry * 0.72, 2.1, 1.7, -0.2);
      addEll(g, bx - brx * 0.75, by + bry * 0.08, 1.9, 2.2, 0);
      addEll(g, bx - brx * 0.25, by - bry * 0.05, 1.5, 1.3, 0);
      addCirc(g, hX(D, -0.5 * hr, -0.4 * hr), hY(D, -0.5 * hr, -0.4 * hr), 1.9);
      addCirc(g, hX(D, -0.05 * hr, -0.78 * hr), hY(D, -0.05 * hr, -0.78 * hr), 1.4);
      g.fill();
      break;
    }
    case 'stripes': {
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const x0 = bx - brx * 0.78 + i * brx * 0.3;
        pathTaperedCapsule(g, x0 + 1.2, by - bry * 1.05, x0 - 0.8, by - bry * 0.18 + Math.abs(i - 1.5) * 1.2, 1.9, 0.5, true);
      }
      for (let i = 0; i < 2; i++) {
        const lx = -0.45 * hr + i * 0.38 * hr;
        pathTaperedCapsule(g, hX(D, lx, -1.05 * hr), hY(D, lx, -1.05 * hr), hX(D, lx - 0.08 * hr, -0.55 * hr), hY(D, lx - 0.08 * hr, -0.55 * hr), 1.6, 0.4, true);
      }
      g.fill();
      break;
    }
    case 'scales': {
      // Overlapping scallops along the spine, rows offset like roof tiles.
      const n = 6;
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < n - row; i++) {
          const u = (i + row * 0.5) / (n - 1);
          const ang = Math.PI * (1.12 + 0.62 * u);
          const rr = row === 0 ? 0.86 : 0.58;
          const cx = bx + Math.cos(ang) * brx * rr, cy = by + Math.sin(ang) * bry * rr;
          g.beginPath(); g.arc(cx, cy, 2.4, Math.PI * 0.05, Math.PI * 0.95, false); g.closePath();
          g.fillStyle = P.accentSh; g.fill();
          g.beginPath(); g.arc(cx, cy - 0.5, 2.0, Math.PI * 0.05, Math.PI * 0.95, false); g.closePath();
          g.fillStyle = col; g.fill();
        }
      }
      break;
    }
    case 'speckles': {
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = Math.PI * (1.05 + (i * 0.618) % 0.85);
        const rr = 0.45 + ((i * 0.37) % 0.45);
        addCirc(g, bx + Math.cos(a) * brx * rr, by + Math.sin(a) * bry * rr, 0.7 + (i % 3) * 0.25);
      }
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (1.15 + i * 0.13), rr = 0.62 + (i % 2) * 0.18;
        addCirc(g, hX(D, Math.cos(a) * hr * rr, Math.sin(a) * hr * rr), hY(D, Math.cos(a) * hr * rr, Math.sin(a) * hr * rr), 0.65 + (i % 2) * 0.2);
      }
      g.fill();
      break;
    }
    case 'swirl': {
      const cx = bx - brx * 0.38, cy = by - bry * 0.18;
      g.beginPath();
      for (let i = 0; i <= 26; i++) {
        const u = i / 26, a = -0.6 + u * TAU * 1.6, r = 0.6 + u * bry * 0.6;
        const px = cx + Math.cos(a) * r * 1.15, py = cy + Math.sin(a) * r;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      strokeLine(g, col, 1.8);
      const sx = hX(D, -0.4 * hr, -0.45 * hr), sy = hY(D, -0.4 * hr, -0.45 * hr);
      g.beginPath();
      for (let i = 0; i <= 14; i++) {
        const u = i / 14, a = 0.4 + u * TAU * 1.1, r = 0.4 + u * 2.6;
        const px = sx + Math.cos(a) * r, py = sy + Math.sin(a) * r;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      strokeLine(g, col, 1.3);
      break;
    }
    case 'patches': {
      g.beginPath();
      addEll(g, bx - brx * 0.5, by - bry * 0.48, brx * 0.32, bry * 0.34, 0.4);
      addCirc(g, bx - brx * 0.28, by - bry * 0.72, bry * 0.22);
      addEll(g, bx - brx * 0.82, by + bry * 0.1, brx * 0.18, bry * 0.3, 0);
      addCirc(g, hX(D, -0.55 * hr, -0.55 * hr), hY(D, -0.55 * hr, -0.55 * hr), hr * 0.42);
      g.fill();
      break;
    }
    case 'none':
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Feet and paws
// ---------------------------------------------------------------------------------------------

function drawFeet(g: CanvasRenderingContext2D, D: DC, near: boolean): void {
  const { G, P, st } = D;
  const fy = -1.9;
  const k = G.brx * 0.42;
  for (let i = 0; i < 2; i++) {
    const ph = st.step + i * Math.PI + (near ? 0 : Math.PI * 0.5);
    const lift = Math.max(0, Math.sin(ph)) * 2.2 * st.stepAmp;
    const swing = Math.cos(ph) * 1.6 * st.stepAmp;
    let x = G.bx + (i === 0 ? k : -k) + swing + (near ? 0 : 2.4);
    let y = fy - lift - (near ? 0 : 0.6);
    if (st.paws === 'limp') { x += i ? -1 : 1; }
    const rx = 3.9 + G.f * 0.6, ry = 2.2;
    g.beginPath(); addEll(g, x, y, rx, ry);
    ink(g, near ? P.paw : P.pawSh, D.ow);
    if (near) {
      g.beginPath(); addEll(g, x - 0.4, y + 0.55, rx * 0.8, ry * 0.45); g.fillStyle = P.pawSh; g.fill();
      // toe lines, or little claws on final stages
      g.beginPath();
      g.moveTo(x + rx * 0.35, y - 0.4); g.lineTo(x + rx * 0.35, y + 0.9);
      g.moveTo(x + rx * 0.72, y - 0.6); g.lineTo(x + rx * 0.72, y + 0.6);
      strokeLine(g, P.pawSh, D.ow * 0.9);
      if (G.f > 0.5) {
        g.beginPath();
        for (let c = 0; c < 3; c++) {
          const cx = x + rx * (0.45 + c * 0.24), cy = y + 0.2 + c * 0.25;
          g.moveTo(cx, cy - 0.6); g.lineTo(cx + 1.4, cy + 0.2); g.lineTo(cx, cy + 0.8);
        }
        g.fillStyle = '#fbf6ec'; g.fill();
      }
      x += 0; y += 0;
    }
  }
}

function drawPaws(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P, st, t } = D;
  const hr = G.hr;
  // Rest: tucked under the chin like a hamster holding a seed.
  let ax = D.hx + hr * 0.02, ay = D.hy + hr * 1.08;
  let bx2 = D.hx + hr * 0.42, by2 = D.hy + hr * 1.12;
  switch (st.paws) {
    case 'walk': { const s = Math.sin(st.step) * 1.2 * st.stepAmp; ax += s; bx2 -= s; break; }
    case 'dig': {
      const s1 = Math.sin(t * 22), s2 = Math.sin(t * 22 + Math.PI);
      ax += 2 + s1 * 2.5; ay += 2.5 + Math.max(0, s1) * 2; bx2 += 2 + s2 * 2.5; by2 += 2.5 + Math.max(0, s2) * 2;
      break;
    }
    case 'eat': { ax = D.hx + hr * 0.62; ay = D.hy + hr * 0.82 + st.chew * 0.6; bx2 = D.hx + hr * 0.98; by2 = ay + 0.4; break; }
    case 'attack': { ax += 4; ay -= 1.5; bx2 += 5; by2 -= 2.5; break; }
    case 'up': { ax -= 1; ay -= 4 + Math.sin(t * 18) * 0.8; bx2 += 1; by2 -= 4.6 + Math.sin(t * 18 + 1) * 0.8; break; }
    case 'limp': { ax -= 1; ay += 1.6; bx2 -= 1; by2 += 1.8; break; }
    case 'fold': { ax += 0.5; ay += 0.6; bx2 = ax + 3; by2 = ay + 0.2; break; }
    case 'rest': break;
  }
  if (st.seed) {
    // A sunflower seed held in both paws.
    const sx = (ax + bx2) / 2 + 0.6, sy = (ay + by2) / 2 - 1.9;
    g.beginPath(); addEll(g, sx, sy, 2.1, 1.3, -0.5);
    ink(g, '#3a3036', D.ow * 0.8);
    g.beginPath(); g.moveTo(sx - 1.4, sy + 0.5); g.lineTo(sx + 1.2, sy - 1);
    strokeLine(g, '#f2ead8', D.ow * 0.8);
  }
  g.beginPath(); addEll(g, bx2, by2, 2.2, 1.9, 0.3);
  ink(g, P.pawSh, D.ow);
  g.beginPath(); addEll(g, ax, ay, 2.4, 2.0, 0.3);
  ink(g, P.paw, D.ow);
}

// ---------------------------------------------------------------------------------------------
// Head: ears, horns, face
// ---------------------------------------------------------------------------------------------

function drawEars(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P, st } = D;
  const hr = G.hr, r = G.earR;
  const flop = st.pose === 'run' ? -0.5 : st.pose === 'hurt' ? -0.4 : st.pose === 'faint' ? -0.6 : 0;
  g.save();
  g.translate(D.hx, D.hy); g.rotate(st.tilt);
  // far ear
  const fx = 0.3 * hr + flop * 1.5, fy = -0.9 * hr;
  g.beginPath(); addEll(g, fx, fy, r * 0.88, r * 0.95, 0.35);
  ink(g, P.bodyFar, D.ow);
  g.beginPath(); addEll(g, fx + 0.2, fy - 0.2, r * 0.45, r * 0.5, 0.35);
  g.fillStyle = dark(P.earIn, 0.8); g.fill();
  // near ear
  const nx = -0.55 * hr + flop * 2, ny = -0.74 * hr + Math.abs(flop) * 0.8;
  g.beginPath(); addEll(g, nx, ny, r, r * 1.04, -0.35 + flop * 0.5);
  ink(g, P.body, D.ow);
  g.beginPath(); addEll(g, nx + 0.3, ny - 0.4, r * 0.55, r * 0.6, -0.35 + flop * 0.5);
  g.fillStyle = P.earIn; g.fill();
  g.restore();
}

function drawHorns(g: CanvasRenderingContext2D, D: DC, front: boolean): void {
  const { v, G, P, t } = D;
  const style = v.horns;
  if (style === 'none') return;
  const isFront = style === 'unicorn';
  if (front !== isFront) return;
  const hr = G.hr, K = G.hornK;
  g.save();
  g.translate(D.hx, D.hy); g.rotate(D.st.tilt);
  const ow = D.ow;
  // Two anchors on the crown: near (back) and far (front), the far one drawn darker and first.
  const anchors: [number, number, boolean][] = [[0.22 * hr, -0.96 * hr, false], [-0.2 * hr, -0.98 * hr, true]];
  switch (style) {
    case 'nubs':
      for (const [x, y, near] of anchors) {
        g.beginPath(); pathTaperedCapsule(g, x, y + 1.5, x - 0.6 * K, y - 3.2 * K, 2.4 * K, 1.5 * K, true);
        ink(g, near ? P.accent : P.accentFar, ow);
        if (near) { g.beginPath(); addCirc(g, x - 1.2 * K, y - 2.6 * K, 0.7 * K); g.fillStyle = P.accentHi; g.fill(); }
      }
      break;
    case 'curved':
      for (const [x, y, near] of anchors) {
        g.beginPath();
        addTaperQuad(g, x + 1, y + 2, x - 1.5 * K, y - 6.5 * K, x - 7.5 * K, y - 6 * K, 3.4 * K, 0.4, 10);
        ink(g, near ? P.accent : P.accentFar, ow);
        if (near) {
          g.beginPath();
          for (let i = 1; i < 4; i++) {
            const u = i / 4, iu = 1 - u;
            const px = iu * iu * (x + 1) + 2 * iu * u * (x - 1.5 * K) + u * u * (x - 7.5 * K);
            const py = iu * iu * (y + 2) + 2 * iu * u * (y - 6.5 * K) + u * u * (y - 6 * K);
            g.moveTo(px - 1.1 * (1 - u) * K, py - 0.5); g.lineTo(px + 1.1 * (1 - u) * K, py + 0.5);
          }
          strokeLine(g, P.accentSh, ow * 0.8);
        }
      }
      break;
    case 'antlers':
      for (const [x, y, near] of anchors) {
        const c = near ? P.accent : P.accentFar;
        g.beginPath();
        pathTaperedCapsule(g, x, y + 1, x - 2 * K, y - 7 * K, 1.5 * K, 1.0 * K, true);
        pathTaperedCapsule(g, x - 2 * K, y - 7 * K, x - 1 * K, y - 11 * K, 1.0 * K, 0.7 * K, true);
        pathTaperedCapsule(g, x - 1.2 * K, y - 4 * K, x + 2.4 * K, y - 7 * K, 0.95 * K, 0.6 * K, true);
        pathTaperedCapsule(g, x - 2 * K, y - 7 * K, x - 5.5 * K, y - 9.5 * K, 0.9 * K, 0.6 * K, true);
        ink(g, c, ow);
      }
      break;
    case 'crystal':
      for (const [x, y, near] of anchors) {
        for (let i = 0; i < 2; i++) {
          const bx = x + (i ? -1.4 : 1) * K, len = (i ? 5.5 : 8) * K, w = (i ? 1.7 : 2.2) * K, a = i ? -0.55 : -0.2;
          const tx = bx + Math.sin(a) * len, ty = y - Math.cos(a) * len;
          const mx = bx + Math.sin(a) * len * 0.35, my = y - Math.cos(a) * len * 0.35;
          const nx = Math.cos(a) * w, ny = Math.sin(a) * w;
          g.beginPath();
          g.moveTo(bx - nx * 0.6, y + 1.5); g.lineTo(mx - nx, my - ny); g.lineTo(tx, ty); g.lineTo(mx + nx, my + ny); g.lineTo(bx + nx * 0.6, y + 1.5);
          g.closePath();
          ink(g, near ? P.accent : P.accentFar, ow);
          if (near) {
            g.beginPath(); g.moveTo(bx - nx * 0.6, y + 1.5); g.lineTo(mx - nx, my - ny); g.lineTo(tx, ty); g.lineTo(mx, my); g.closePath();
            g.fillStyle = P.accentHi; g.fill();
          }
        }
      }
      break;
    case 'bolt':
      for (const [x, y, near] of anchors) {
        const s = K * 0.95;
        g.beginPath();
        g.moveTo(x - 1.6 * s, y + 1.5); g.lineTo(x - 2.6 * s, y - 4 * s); g.lineTo(x - 0.6 * s, y - 3.6 * s);
        g.lineTo(x - 2.4 * s, y - 9.5 * s); g.lineTo(x + 2.4 * s, y - 2.6 * s); g.lineTo(x + 0.4 * s, y - 3 * s);
        g.lineTo(x + 1.6 * s, y + 1.5); g.closePath();
        ink(g, near ? P.accent : P.accentFar, ow);
      }
      break;
    case 'sprout': {
      const x = 0.02 * hr, y = -0.98 * hr, sw = Math.sin(t * 2.2) * 0.12;
      const lc = P.wing, lcs = dark(P.wing, 0.75);
      g.beginPath(); addTaperQuad(g, x, y + 1.5, x + 0.5, y - 3 * K, x + 0.6 + sw * 8, y - 5 * K, 1.4, 0.9, 6);
      ink(g, dark(P.wing, 0.7), ow);
      const tx = x + 0.6 + sw * 8, ty = y - 5 * K;
      g.beginPath(); addLeaf(g, tx, ty, -2.6 + sw, 5.2 * K, 2.2 * K); ink(g, lc, ow);
      g.beginPath(); addLeaf(g, tx, ty, -0.5 + sw, 5.8 * K, 2.4 * K); ink(g, lc, ow);
      g.beginPath();
      g.moveTo(tx, ty); g.lineTo(tx + Math.cos(-2.6 + sw) * 4 * K, ty + Math.sin(-2.6 + sw) * 4 * K);
      g.moveTo(tx, ty); g.lineTo(tx + Math.cos(-0.5 + sw) * 4.5 * K, ty + Math.sin(-0.5 + sw) * 4.5 * K);
      strokeLine(g, lcs, ow * 0.8);
      break;
    }
    case 'unicorn': {
      const x = 0.5 * hr, y = -0.8 * hr, len = 10 * K, a = 0.32;
      const tx = x + Math.sin(a) * len, ty = y - Math.cos(a) * len;
      const nx = Math.cos(a) * 1.9 * K, ny = Math.sin(a) * 1.9 * K;
      g.beginPath(); g.moveTo(x - nx, y + 1 - ny); g.lineTo(tx, ty); g.lineTo(x + nx, y + 1 + ny); g.closePath();
      ink(g, P.accent, ow);
      g.beginPath();
      for (let i = 1; i < 4; i++) {
        const u = i / 4.2, px = x + (tx - x) * u, py = y + 1 + (ty - y - 1) * u, w = 1 - u;
        g.moveTo(px - nx * w, py - ny * w + 0.8); g.lineTo(px + nx * w, py + ny * w - 0.6);
      }
      strokeLine(g, P.accentSh, ow * 0.9);
      break;
    }
    case 'flame': {
      const fl = Math.sin(t * 9), fl2 = Math.sin(t * 11 + 1);
      g.beginPath();
      addFlame(g, -0.32 * hr, -0.8 * hr, 4.4 * K, 6.5 * K, -1.5 + fl);
      addFlame(g, 0.05 * hr, -0.95 * hr, 5 * K, 9 * K + fl2, -0.8 + fl2 * 1.2);
      addFlame(g, 0.38 * hr, -0.86 * hr, 4 * K, 6 * K, 0.6 + fl);
      ink(g, P.accent, ow);
      g.beginPath();
      addFlame(g, -0.3 * hr, -0.8 * hr, 2.2 * K, 3.8 * K, -1 + fl);
      addFlame(g, 0.05 * hr, -0.92 * hr, 2.6 * K, 5.6 * K + fl2, -0.5 + fl2);
      addFlame(g, 0.38 * hr, -0.84 * hr, 2 * K, 3.4 * K, 0.4 + fl);
      g.fillStyle = mix(P.accent, '#fff6a0', 0.65); g.fill();
      break;
    }
    case 'antenna': {
      const bob = D.st.pose === 'idle' ? Math.sin(t * 3) * 0.6 : Math.sin(t * 9) * 1.2;
      for (const [x, y, near] of anchors) {
        const tx = x - 1.5 * K + bob * (near ? 1 : 0.8), ty = y - 7.5 * K;
        g.beginPath(); g.moveTo(x, y + 1); g.quadraticCurveTo(x - 0.5 * K, y - 4 * K, tx, ty);
        strokeLine(g, INK, ow * 3);
        g.beginPath(); g.moveTo(x, y + 1); g.quadraticCurveTo(x - 0.5 * K, y - 4 * K, tx, ty);
        strokeLine(g, near ? P.bodySh : dark(P.bodySh, 0.8), ow * 1.1);
        g.beginPath(); addCirc(g, tx, ty, 1.9 * K);
        ink(g, near ? P.accent : P.accentFar, ow);
        if (near) { g.beginPath(); addCirc(g, tx - 0.6 * K, ty - 0.6 * K, 0.6 * K); g.fillStyle = '#ffffff'; g.fill(); }
      }
      break;
    }
  }
  g.restore();
}

function drawEye(g: CanvasRenderingContext2D, D: DC, ex: number, ey: number, rx: number, ry: number, near: boolean): void {
  const { P, st } = D;
  const lw = D.ow * 1.25;
  switch (st.eyes) {
    case 'closed': {
      g.beginPath(); g.moveTo(ex - rx * 1.05, ey + ry * 0.05); g.quadraticCurveTo(ex, ey + ry * 0.62, ex + rx * 1.05, ey + ry * 0.05);
      strokeLine(g, INK, lw);
      return;
    }
    case 'happy': {
      g.beginPath(); g.moveTo(ex - rx * 1.05, ey + ry * 0.3); g.quadraticCurveTo(ex, ey - ry * 0.85, ex + rx * 1.05, ey + ry * 0.3);
      strokeLine(g, INK, lw);
      return;
    }
    case 'hurt': {
      const d = near ? 1 : -1;
      g.beginPath();
      g.moveTo(ex - rx * d, ey - ry * 0.55); g.lineTo(ex + rx * 0.9 * d, ey); g.lineTo(ex - rx * d, ey + ry * 0.55);
      strokeLine(g, INK, lw);
      return;
    }
    case 'dizzy':
      drawSpiral(g, ex, ey, Math.max(rx, ry * 0.8), D.t, lw * 0.8);
      return;
    case 'open':
    case 'fierce':
      break;
  }
  const fierce = st.eyes === 'fierce';
  const ryy = fierce ? ry * 0.86 : ry;
  g.beginPath(); addEll(g, ex, ey, rx, ryy);
  ink(g, P.eye, D.ow * 0.6);
  g.save();
  g.beginPath(); addEll(g, ex, ey, rx, ryy); g.clip();
  g.beginPath(); addEll(g, ex + rx * 0.1, ey + ryy * 0.62, rx * 0.8, ryy * 0.45);
  g.fillStyle = P.eyeLow; g.fill();
  if (fierce) {
    // Angled lid: lower toward the middle of the face.
    const d = near ? 1 : -1;
    g.beginPath();
    g.moveTo(ex - rx * 1.5, ey - ryy * (near ? 0.95 : 0.25)); g.lineTo(ex + rx * 1.5, ey - ryy * (near ? 0.25 : 0.95));
    g.lineTo(ex + rx * 1.5 * d, ey - ryy * 2); g.lineTo(ex - rx * 1.5 * d, ey - ryy * 2); g.closePath();
    g.fillStyle = P.body; g.fill();
  }
  g.restore();
  // shine: one big highlight, one small sparkle
  g.fillStyle = '#ffffff';
  g.beginPath(); addCirc(g, ex - rx * 0.3, ey - ryy * (fierce ? 0.15 : 0.38), rx * 0.42); g.fill();
  g.beginPath(); addCirc(g, ex + rx * 0.35, ey + ryy * 0.42, rx * 0.2); g.fill();
  if (fierce) {
    g.beginPath();
    g.moveTo(ex - rx * 1.3, ey - ryy * (near ? 1.05 : 0.38)); g.lineTo(ex + rx * 1.3, ey - ryy * (near ? 0.38 : 1.05));
    strokeLine(g, INK, lw);
  }
}

function drawMouth(g: CanvasRenderingContext2D, D: DC): void {
  const { G, st } = D;
  const hr = G.hr;
  const mx = hr * 0.86, my = hr * 0.5;
  const lw = D.ow * 1.05;
  const fang = G.f >= 0.45;
  // philtrum from the nose
  g.beginPath(); g.moveTo(mx + hr * 0.08, my - hr * 0.2); g.lineTo(mx + hr * 0.05, my - 0.1);
  strokeLine(g, INK, lw * 0.9);
  switch (st.mouth) {
    case 'smile': {
      g.beginPath();
      g.moveTo(mx - 2.1, my - 0.5); g.quadraticCurveTo(mx - 1.0, my + 1.3, mx + 0.05, my - 0.1);
      g.quadraticCurveTo(mx + 1.0, my + 1.3, mx + 2.0, my - 0.5);
      strokeLine(g, INK, lw);
      if (fang) { g.beginPath(); g.moveTo(mx - 1.4, my + 0.45); g.lineTo(mx - 0.9, my + 1.9); g.lineTo(mx - 0.4, my + 0.6); g.closePath(); ink(g, '#ffffff', D.ow * 0.5); }
      break;
    }
    case 'open':
    case 'grin': {
      const w = st.mouth === 'grin' ? 2.6 : 2.3, h = st.mouth === 'grin' ? 3.2 : 4.0;
      g.beginPath(); g.moveTo(mx - w, my - 0.6); g.quadraticCurveTo(mx, my - 0.1, mx + w, my - 0.6);
      g.quadraticCurveTo(mx + w * 0.8, my + h, mx, my + h); g.quadraticCurveTo(mx - w * 0.8, my + h, mx - w, my - 0.6);
      g.closePath();
      ink(g, '#6a2236', D.ow * 0.8);
      g.beginPath(); addEll(g, mx + 0.2, my + h * 0.72, w * 0.55, h * 0.26); g.fillStyle = '#ff7d8e'; g.fill();
      if (fang || st.mouth === 'open') {
        g.beginPath(); g.moveTo(mx - w * 0.75, my - 0.45); g.lineTo(mx - w * 0.5, my + 1.4); g.lineTo(mx - w * 0.25, my - 0.3); g.closePath();
        g.fillStyle = '#ffffff'; g.fill();
      }
      break;
    }
    case 'chew': {
      const c = st.chew;
      if (c > 0.5) {
        g.beginPath(); addEll(g, mx, my + 0.6, 1.2, 0.9 + (c - 0.5)); ink(g, '#6a2236', D.ow * 0.7);
      } else {
        g.beginPath();
        g.moveTo(mx - 1.8, my - 0.2 + c); g.quadraticCurveTo(mx - 0.9, my + 1.2 + c, mx, my + c * 0.5);
        g.quadraticCurveTo(mx + 0.9, my + 1.2 + c, mx + 1.8, my - 0.2 + c);
        strokeLine(g, INK, lw);
      }
      break;
    }
    case 'wavy': {
      g.beginPath(); g.moveTo(mx - 2.2, my + 0.6);
      for (let i = 1; i <= 4; i++) g.lineTo(mx - 2.2 + i * 1.1, my + 0.6 + (i % 2 ? -0.7 : 0.4));
      strokeLine(g, INK, lw);
      break;
    }
    case 'o': {
      g.beginPath(); addEll(g, mx, my + 0.8, 1.15, 1.25); ink(g, '#6a2236', D.ow * 0.7);
      break;
    }
  }
}

function drawHead(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P, st, v } = D;
  const hr = G.hr;
  const ex = G.extras;
  g.save();
  g.translate(D.hx, D.hy); g.rotate(st.tilt);
  if (ex.has('mask')) drawMask(g, D);
  // Final stages get a little brow ridge for a bolder look.
  const ery = G.eyeRy, erx = ery * 0.72;
  const e1x = 0.16 * hr, e1y = -0.05 * hr, e2x = 0.68 * hr, e2y = -0.09 * hr;
  drawEye(g, D, e2x, e2y, erx * 0.8, ery * 0.95, false);
  drawEye(g, D, e1x, e1y, erx, ery, true);
  if (G.f > 0.62 && (st.eyes === 'open' || st.eyes === 'closed')) {
    g.beginPath();
    g.moveTo(e1x - erx * 1.1, e1y - ery * 1.25); g.quadraticCurveTo(e1x, e1y - ery * 1.6, e1x + erx * 1.1, e1y - ery * 1.3);
    g.moveTo(e2x - erx * 0.8, e2y - ery * 1.3); g.quadraticCurveTo(e2x, e2y - ery * 1.55, e2x + erx * 0.8, e2y - ery * 1.2);
    strokeLine(g, P.bodySh, D.ow * 1.6);
  }
  // nose
  g.beginPath(); addEll(g, hr * 0.99, hr * 0.27, 1.45, 1.05, 0.2);
  ink(g, P.nose, D.ow * 0.6);
  g.beginPath(); addCirc(g, hr * 0.94, hr * 0.2, 0.42); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fill();
  drawMouth(g, D);
  if (ex.has('whiskersLong')) drawWhiskers(g, D);
  if (ex.has('monocle')) drawMonocle(g, D, e1x, e1y, ery);
  if (ex.has('goggles')) drawGoggles(g, D);
  g.restore();
  drawHorns(g, D, true);
  g.save();
  g.translate(D.hx, D.hy); g.rotate(st.tilt);
  if (ex.has('tuft')) drawTuft(g, D);
  if (ex.has('flowers')) drawFlowers(g, D);
  if (ex.has('crown')) drawCrown(g, D);
  if (ex.has('chefHat')) drawChefHat(g, D);
  if (ex.has('halo')) drawHalo(g, D);
  if (st.sweat && D.fx) drawSweat(g, -0.75 * hr, -0.6 * hr, 1.8, D.ow);
  if (ex.has('frostBreath') && D.fx && st.pose !== 'sleep' && st.pose !== 'faint') drawFrostBreath(g, D);
  if (st.zzz && D.fx) drawNoseBubble(g, D);
  g.restore();
  void v;
}

// ---------------------------------------------------------------------------------------------
// Wings
// ---------------------------------------------------------------------------------------------

function drawWing(g: CanvasRenderingContext2D, D: DC, near: boolean): void {
  const { v, G, P, st, t } = D;
  const style = v.wings;
  if (style === 'none') return;
  const ax = G.bx - G.brx * 0.12 + (near ? 0 : 3.2), ay = G.by - G.bry * 0.78 - (near ? 0 : 1.6);
  const L = G.wingL * (style === 'stubby' ? 0.72 : style === 'gear' ? 0.85 : 1);
  const base = near ? -0.55 : -0.25;
  g.save();
  g.translate(ax, ay);
  g.rotate(base - st.wing * (near ? 1 : 0.8));
  const c = near ? P.wing : P.wingFar, cs = near ? P.wingSh : P.wingFarSh, ch = near ? P.wingHi : P.wing;
  const ow = D.ow;
  // Wing space: the wing rises along -y, its trailing edge sweeps back toward -x.
  switch (style) {
    case 'stubby': {
      g.beginPath();
      g.moveTo(1.5, 1); g.quadraticCurveTo(1.5, -L * 0.9, -L * 0.3, -L * 0.95);
      g.quadraticCurveTo(-L * 0.8, -L * 0.9, -L * 0.85, -L * 0.45);
      g.quadraticCurveTo(-L * 0.55, -L * 0.42, -L * 0.6, -L * 0.18);
      g.quadraticCurveTo(-L * 0.3, -L * 0.15, -1.5, 1.5); g.closePath();
      ink(g, c, ow);
      g.beginPath(); g.moveTo(-L * 0.1, -L * 0.75); g.quadraticCurveTo(-L * 0.4, -L * 0.6, -L * 0.5, -L * 0.3);
      strokeLine(g, cs, ow * 0.9);
      break;
    }
    case 'bat': {
      const tip = [0.2, -L * 1.05], f1 = [-L * 0.6, -L * 0.9], f2 = [-L * 0.95, -L * 0.42];
      g.beginPath();
      g.moveTo(1.5, 0.5); g.lineTo(tip[0], tip[1]);
      g.quadraticCurveTo(-L * 0.25, -L * 0.75, f1[0], f1[1]);
      g.quadraticCurveTo(-L * 0.6, -L * 0.5, f2[0], f2[1]);
      g.quadraticCurveTo(-L * 0.5, -L * 0.18, -1.5, 1.2); g.closePath();
      ink(g, c, ow);
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(tip[0], tip[1]);
      g.moveTo(-0.2, -L * 0.62); g.lineTo(f1[0], f1[1]);
      g.moveTo(-0.3, -L * 0.5); g.lineTo(f2[0], f2[1]);
      strokeLine(g, cs, ow * 1.3);
      g.beginPath(); g.moveTo(tip[0], tip[1]); g.lineTo(tip[0] + 1.4, tip[1] - 0.8); g.lineTo(tip[0] + 0.4, tip[1] + 1);
      ink(g, '#fbf6ec', ow * 0.5);
      break;
    }
    case 'feather': {
      for (let i = 3; i >= 0; i--) {
        const a = -Math.PI / 2 - 0.15 - i * 0.36;
        const l = L * (1.05 - i * 0.12);
        g.beginPath(); addLeaf(g, 0, 0, a, l, 2.1);
        ink(g, i % 2 ? c : ch, ow);
      }
      g.beginPath(); addEll(g, -1.5, -2.5, 3.2, 3.6, -0.4); ink(g, c, ow);
      break;
    }
    case 'leaf': {
      g.beginPath(); addLeaf(g, 0, 0, -Math.PI / 2 - 0.35, L * 1.05, L * 0.34); ink(g, c, ow);
      g.beginPath(); addLeaf(g, -0.5, 0.5, -Math.PI / 2 - 1.1, L * 0.82, L * 0.28); ink(g, cs, ow);
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(Math.cos(-Math.PI / 2 - 0.35) * L * 0.9, Math.sin(-Math.PI / 2 - 0.35) * L * 0.9);
      strokeLine(g, cs, ow * 0.9);
      break;
    }
    case 'flame': {
      const fl = Math.sin(t * 10 + (near ? 0 : 1)), fl2 = Math.sin(t * 13);
      g.save(); g.rotate(-0.15);
      g.beginPath();
      addFlame(g, -L * 0.15, 1, L * 0.55, L * 1.1 + fl, -L * 0.25 + fl);
      addFlame(g, -L * 0.45, 0.5, L * 0.5, L * 0.85 + fl2, -L * 0.4 + fl2 * 0.8);
      addFlame(g, -L * 0.7, 0, L * 0.4, L * 0.55, -L * 0.3 + fl);
      ink(g, c, ow);
      g.beginPath();
      addFlame(g, -L * 0.15, 0.5, L * 0.28, L * 0.65 + fl, -L * 0.15 + fl);
      addFlame(g, -L * 0.45, 0.2, L * 0.24, L * 0.45 + fl2, -L * 0.2 + fl2 * 0.6);
      g.fillStyle = near ? mix(P.wing, '#fff6a0', 0.6) : mix(P.wingFar, '#fff6a0', 0.35); g.fill();
      g.restore();
      break;
    }
    case 'crystal': {
      const shards: [number, number, number][] = [[-0.2, 1.0, 2.2], [-0.75, 0.82, 1.9], [-1.25, 0.6, 1.6]];
      for (const [a0, lk, w] of shards) {
        const a = -Math.PI / 2 + a0, l = L * lk;
        const tx = Math.cos(a) * l, ty = Math.sin(a) * l, mx = Math.cos(a) * l * 0.38, my = Math.sin(a) * l * 0.38;
        const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
        g.beginPath(); g.moveTo(0, 0); g.lineTo(mx + nx, my + ny); g.lineTo(tx, ty); g.lineTo(mx - nx, my - ny); g.closePath();
        ink(g, c, ow);
        g.beginPath(); g.moveTo(0, 0); g.lineTo(mx + nx, my + ny); g.lineTo(tx, ty); g.closePath();
        g.fillStyle = near ? ch : cs; g.fill();
      }
      break;
    }
    case 'fin': {
      g.beginPath();
      g.moveTo(1.2, 0.6);
      g.quadraticCurveTo(0, -L * 0.6, -L * 0.2, -L * 1.0);
      const n = 4;
      for (let i = 1; i <= n; i++) {
        const a = -Math.PI / 2 - 0.2 - (i / n) * 1.25;
        const r = L * (1.0 - i * 0.1);
        const pa = -Math.PI / 2 - 0.2 - ((i - 0.5) / n) * 1.25;
        g.quadraticCurveTo(Math.cos(pa) * r * 0.78, Math.sin(pa) * r * 0.78, Math.cos(a) * r, Math.sin(a) * r);
      }
      g.lineTo(-1.2, 1.2); g.closePath();
      ink(g, c, ow);
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 - 0.25 - (i / 4) * 1.15;
        g.moveTo(0, 0); g.lineTo(Math.cos(a) * L * (0.85 - i * 0.08), Math.sin(a) * L * (0.85 - i * 0.08));
      }
      strokeLine(g, cs, ow * 0.9);
      break;
    }
    case 'cloud': {
      g.beginPath();
      addCirc(g, -L * 0.1, -L * 0.62, L * 0.36);
      addCirc(g, -L * 0.48, -L * 0.48, L * 0.3);
      addCirc(g, -L * 0.62, -L * 0.15, L * 0.24);
      addCirc(g, 0, -L * 0.2, L * 0.3);
      ink(g, c, ow);
      g.beginPath(); addCirc(g, -L * 0.18, -L * 0.72, L * 0.14); g.fillStyle = near ? '#ffffff' : ch; g.fill();
      break;
    }
    case 'gear': {
      const rot = t * (near ? 1.6 : -1.6);
      g.beginPath(); pathTaperedCapsule(g, 0, 0, -L * 0.35, -L * 0.55, 1.6, 1.2, false); ink(g, cs, ow);
      g.beginPath(); pathGear(g, -L * 0.4, -L * 0.62, L * 0.48, 8, rot);
      ink(g, c, ow);
      g.beginPath(); addCirc(g, -L * 0.4, -L * 0.62, L * 0.18); ink(g, cs, ow * 0.6);
      g.beginPath(); pathGear(g, -L * 0.88, -L * 0.18, L * 0.28, 6, -rot * 1.6 + 0.3);
      ink(g, c, ow);
      g.beginPath(); addCirc(g, -L * 0.88, -L * 0.18, L * 0.09); g.fillStyle = cs; g.fill();
      break;
    }
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Tail
// ---------------------------------------------------------------------------------------------

function drawTail(g: CanvasRenderingContext2D, D: DC): void {
  const { v, G, P, st, t } = D;
  const style = v.tail;
  const ow = D.ow;
  const L = G.tailL;
  g.save();
  g.translate(G.bx - G.brx * 0.84, G.by + G.bry * 0.34);
  g.rotate(-st.tail);
  if (style === 'stub') {
    g.beginPath(); addCirc(g, -1.6, -0.6, 3.9 + G.f);
    ink(g, P.body, ow);
    g.beginPath(); addCirc(g, -2.4, -1.4, 2.2); g.fillStyle = P.belly; g.fill();
    g.restore();
    return;
  }
  if (style === 'bolt') {
    const s = L / 12;
    g.beginPath();
    g.moveTo(1, -2.6 * s); g.lineTo(-4.5 * s, -4.2 * s); g.lineTo(-3.2 * s, -6.4 * s); g.lineTo(-11 * s, -12 * s);
    g.lineTo(-6 * s, -5.6 * s); g.lineTo(-7.6 * s, -3.4 * s); g.lineTo(1, 2.4 * s); g.closePath();
    ink(g, P.accent, ow);
    g.beginPath(); g.moveTo(-3.2 * s, -6.4 * s); g.lineTo(-11 * s, -12 * s); g.lineTo(-5 * s, -5.9 * s); g.closePath();
    g.fillStyle = P.accentHi; g.fill();
    g.beginPath(); pathTaperedCapsule(g, 2, 0, -2.5, -0.5, 3.2, 2.4, false); ink(g, P.body, ow);
    g.restore();
    return;
  }
  // A curved tapering tail; drip droops, the rest curl up behind.
  const droop = style === 'drip';
  const x0 = 0, y0 = 0;
  const cx = -L * 0.62, cy = droop ? -L * 0.1 : L * 0.12;
  const x2 = -L * (droop ? 0.88 : 0.92), y2 = droop ? L * 0.15 : -L * 0.5;
  const mx = 0.25 * x0 + 0.5 * cx + 0.25 * x2, my = 0.25 * y0 + 0.5 * cy + 0.25 * y2;
  const r0 = 3.3 + G.f * 0.6, rm = 2.3 + G.f * 0.3, r2 = 1.5;
  g.beginPath();
  pathTaperedCapsule(g, x0, y0, mx, my, r0, rm, true);
  pathTaperedCapsule(g, mx, my, x2, y2, rm, r2, true);
  ink(g, P.bodySh, ow);
  g.beginPath();
  pathTaperedCapsule(g, x0, y0 - r0 * 0.22, mx, my - rm * 0.22, r0 * 0.74, rm * 0.72, true);
  pathTaperedCapsule(g, mx, my - rm * 0.22, x2 + 0.3, y2 - 0.3, rm * 0.72, r2 * 0.6, true);
  g.fillStyle = P.body; g.fill();
  const ang = Math.atan2(y2 - my, x2 - mx);
  g.translate(x2, y2);
  switch (style) {
    case 'spike': {
      g.save(); g.rotate(ang);
      g.beginPath(); g.moveTo(-1.2, -3.4); g.lineTo(5.5, 0); g.lineTo(-1.2, 3.4); g.lineTo(0.8, 0); g.closePath();
      ink(g, P.accent, ow);
      g.beginPath(); g.moveTo(-1.2, -3.4); g.lineTo(5.5, 0); g.lineTo(0.8, 0); g.closePath(); g.fillStyle = P.accentHi; g.fill();
      g.restore();
      // two back spikes along the tail
      g.translate(-x2, -y2);
      for (let i = 0; i < 2; i++) {
        const u = 0.32 + i * 0.3, iu = 1 - u;
        const px = iu * iu * x0 + 2 * iu * u * cx + u * u * x2, py = iu * iu * y0 + 2 * iu * u * cy + u * u * y2;
        const dx = 2 * iu * (cx - x0) + 2 * u * (x2 - cx), dy = 2 * iu * (cy - y0) + 2 * u * (y2 - cy);
        const len = Math.hypot(dx, dy) || 1, nx = dy / len, ny = -dx / len;
        const r = (r0 + (r2 - r0) * u) * 0.9;
        g.beginPath();
        g.moveTo(px + nx * r - dx / len * 1.4, py + ny * r - dy / len * 1.4);
        g.lineTo(px + nx * (r + 2.6), py + ny * (r + 2.6));
        g.lineTo(px + nx * r + dx / len * 1.4, py + ny * r + dy / len * 1.4); g.closePath();
        ink(g, P.accent, ow);
      }
      break;
    }
    case 'flame': {
      const fl = Math.sin(t * 11), fl2 = Math.sin(t * 7 + 2);
      g.rotate(st.tail);
      g.beginPath(); addFlame(g, 0, 1.5, 5.5 + G.f * 2, 8 + G.f * 4 + fl * 0.8, fl2 * 1.2); ink(g, P.accent, ow);
      g.beginPath(); addFlame(g, 0, 1.2, 3 + G.f, 4.6 + G.f * 2 + fl, fl2 * 0.8); g.fillStyle = mix(P.accent, '#fff6a0', 0.7); g.fill();
      break;
    }
    case 'fin': {
      g.rotate(ang + Math.sin(t * 4) * 0.15);
      g.beginPath();
      g.moveTo(-0.5, 0); g.quadraticCurveTo(2.5, -2.5, 6, -5.5); g.quadraticCurveTo(4, -0.5, 6.4, 4.8);
      g.quadraticCurveTo(2.5, 2.2, -0.5, 0.6); g.closePath();
      ink(g, P.wing, ow);
      g.beginPath(); g.moveTo(0.5, 0.2); g.lineTo(5, -4); g.moveTo(0.5, 0.3); g.lineTo(4.6, 0.2); g.moveTo(0.5, 0.4); g.lineTo(5.2, 3.8);
      strokeLine(g, P.wingSh, ow * 0.8);
      break;
    }
    case 'leaf': {
      const a = ang + Math.sin(t * 2.5) * 0.12;
      g.beginPath(); addLeaf(g, -0.5, 0, a, 9 + G.f * 3, 3.6 + G.f); ink(g, P.wing, ow);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * (7.5 + G.f * 3), Math.sin(a) * (7.5 + G.f * 3));
      strokeLine(g, P.wingSh, ow * 0.9);
      break;
    }
    case 'club': {
      g.rotate(ang);
      const r = 3.7 + G.f * 1.2;
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = -1.6 + i * 1.05, px = 2.4 + Math.cos(a) * r, py = Math.sin(a) * r;
        g.moveTo(px - Math.sin(a) * 1.1, py + Math.cos(a) * 1.1); g.lineTo(2.4 + Math.cos(a) * (r + 2.2), Math.sin(a) * (r + 2.2)); g.lineTo(px + Math.sin(a) * 1.1, py - Math.cos(a) * 1.1);
        g.closePath();
      }
      ink(g, P.accentSh, ow);
      g.beginPath(); addCirc(g, 2.4, 0, r); ink(g, P.accent, ow);
      g.beginPath(); addCirc(g, 1.4, -1.2, r * 0.38); g.fillStyle = P.accentHi; g.fill();
      break;
    }
    case 'drip': {
      const s = 1 + Math.sin(t * 3) * 0.12;
      g.beginPath();
      g.moveTo(0, -1.5); g.quadraticCurveTo(2.8, 1.5 * s, 2.6, 3.6 * s); g.arc(0, 3.6 * s, 2.6, 0, Math.PI); g.quadraticCurveTo(-2.8, 1.5 * s, 0, -1.5);
      g.closePath();
      ink(g, P.accent, ow);
      g.beginPath(); addEll(g, -0.9, 3 * s, 0.7, 1.1); g.fillStyle = 'rgba(255,255,255,0.75)'; g.fill();
      break;
    }
    case 'feather': {
      for (let i = -1; i <= 1; i++) {
        g.beginPath(); addLeaf(g, 0, 0, ang + i * 0.45 + Math.sin(t * 3 + i) * 0.08, 8 + G.f * 3 - Math.abs(i) * 1.5, 1.9);
        ink(g, i === 0 ? P.wing : P.wingSh, ow);
      }
      break;
    }
    case 'whisk': {
      g.rotate(ang);
      g.beginPath();
      g.moveTo(-1, -1.6);
      const n = 5;
      for (let i = 0; i <= n; i++) {
        const a = -0.75 + (i / n) * 1.5 + Math.sin(t * 5 + i) * 0.06;
        g.lineTo(Math.cos(a) * (6.5 + (i % 2) * 1.5), Math.sin(a) * (6.5 + (i % 2) * 1.5));
        if (i < n) { const a2 = a + 0.75 / n * 2 * 0.5; g.lineTo(Math.cos(a2) * 3, Math.sin(a2) * 3); }
      }
      g.lineTo(-1, 1.6); g.closePath();
      ink(g, P.accent, ow);
      break;
    }
    case 'star': {
      const r = 4.2 + G.f * 1.4;
      g.beginPath(); pathStar(g, Math.cos(ang) * 2.5, Math.sin(ang) * 2.5, r, r * 0.46, 5, t * 1.2 - Math.PI / 2);
      ink(g, P.accent, ow);
      g.beginPath(); addCirc(g, Math.cos(ang) * 2.5 - 0.6, Math.sin(ang) * 2.5 - 0.6, r * 0.25); g.fillStyle = P.accentHi; g.fill();
      break;
    }
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Extras
// ---------------------------------------------------------------------------------------------

function drawAura(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P, t } = D;
  const cx = (G.bx + G.hx) / 2, cy = (G.by + G.hy) / 2;
  const pulse = (Math.sin(t * 3) + 1) / 2;
  g.save();
  g.globalAlpha *= 0.22 + 0.1 * pulse;
  g.fillStyle = P.accent;
  g.beginPath(); addEll(g, cx, cy, G.brx * 1.45 + pulse * 2, (G.bry + G.hr) * 1.25 + pulse * 2); g.fill();
  g.globalAlpha *= 1.6;
  g.beginPath(); addEll(g, cx, cy, G.brx * 1.2 + pulse, (G.bry + G.hr) * 1.05 + pulse); g.fill();
  g.restore();
  // rising motes
  for (let i = 0; i < 4; i++) {
    const k = (t * 0.6 + i * 0.25) % 1;
    const x = cx + Math.cos(i * 2.4) * G.brx * 1.15, y = -k * 38;
    g.save(); g.globalAlpha *= Math.sin(k * Math.PI);
    g.beginPath(); addCirc(g, x + Math.sin(t * 2 + i) * 1.5, y, 1.1); g.fillStyle = P.accentHi; g.fill();
    g.restore();
  }
}

function drawShell(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P } = D;
  const cx = G.bx - G.brx * 0.22, cy = G.by - G.bry * 0.22, rx = G.brx * 0.82, ry = G.bry * 0.88;
  g.save();
  g.translate(cx, cy); g.rotate(-0.28);
  g.beginPath(); g.ellipse(0, 0, rx, ry, 0, Math.PI * 1.02, Math.PI * 1.98); g.quadraticCurveTo(0, ry * 0.32, -rx * 0.999, -ry * 0.06); g.closePath();
  ink(g, P.accentSh, D.ow);
  g.beginPath(); g.ellipse(0, -ry * 0.08, rx * 0.9, ry * 0.86, 0, Math.PI * 1.05, Math.PI * 1.95); g.closePath();
  g.fillStyle = P.accent; g.fill();
  // plates
  g.beginPath();
  const hx = 0, hy = -ry * 0.5, hw = rx * 0.28, hh = ry * 0.22;
  g.moveTo(hx - hw, hy); g.lineTo(hx - hw * 0.5, hy - hh); g.lineTo(hx + hw * 0.5, hy - hh); g.lineTo(hx + hw, hy);
  g.lineTo(hx + hw * 0.5, hy + hh); g.lineTo(hx - hw * 0.5, hy + hh); g.closePath();
  g.moveTo(hx - hw, hy); g.lineTo(-rx * 0.85, -ry * 0.25);
  g.moveTo(hx + hw, hy); g.lineTo(rx * 0.85, -ry * 0.25);
  g.moveTo(hx - hw * 0.5, hy - hh); g.lineTo(-rx * 0.35, -ry * 0.88);
  g.moveTo(hx + hw * 0.5, hy - hh); g.lineTo(rx * 0.35, -ry * 0.88);
  g.moveTo(hx - hw * 0.5, hy + hh); g.lineTo(-rx * 0.4, -ry * 0.08);
  g.moveTo(hx + hw * 0.5, hy + hh); g.lineTo(rx * 0.4, -ry * 0.08);
  strokeLine(g, P.accentSh, D.ow * 1.1);
  g.beginPath(); addEll(g, -rx * 0.35, -ry * 0.7, rx * 0.22, ry * 0.08, -0.3); g.fillStyle = P.accentHi; g.fill();
  g.restore();
}

function drawApron(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P } = D;
  const cx = G.bx + G.brx * 0.42, top = G.by - G.bry * 0.35, bot = -2.5, w = G.brx * 0.5;
  g.beginPath();
  g.moveTo(cx - w * 0.6, top); g.lineTo(cx + w * 0.6, top);
  g.quadraticCurveTo(cx + w * 1.1, (top + bot) / 2, cx + w * 0.95, bot);
  g.quadraticCurveTo(cx, bot + 1.5, cx - w * 0.95, bot);
  g.quadraticCurveTo(cx - w * 1.1, (top + bot) / 2, cx - w * 0.6, top); g.closePath();
  ink(g, '#fbf8f2', D.ow);
  g.beginPath(); addEll(g, cx, bot - 0.5, w * 0.9, 1.6); g.fillStyle = '#e4dfe8'; g.fill();
  g.beginPath(); g.moveTo(cx - w * 0.6, top + 0.6); g.lineTo(cx + w * 0.6, top + 0.6); strokeLine(g, P.accent, 1.4);
  // pocket with a little heart
  const py = (top + bot) / 2 + 1.5;
  g.beginPath(); g.rect(cx - w * 0.4, py - 1.6, w * 0.8, 3.4); ink(g, mix(P.accent, '#ffffff', 0.55), D.ow * 0.6);
  drawHeart(g, cx, py - 0.1, 0.8, P.accent, D.ow * 0.5);
  g.beginPath(); g.moveTo(cx - w * 0.55, top); g.lineTo(D.hx - G.hr * 0.3, D.hy + G.hr * 0.75); strokeLine(g, P.accent, 1.1);
}

function drawDrips(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P, t } = D;
  const spots: [number, number, number][] = [
    [G.bx - G.brx * 0.55, G.by + G.bry * 0.55, 0],
    [G.bx + G.brx * 0.15, G.by + G.bry * 0.8, 1.7],
    [hX(D, 0.55 * G.hr, 0.95 * G.hr), hY(D, 0.55 * G.hr, 0.95 * G.hr), 3.1],
  ];
  const col = mix(P.accent, P.body, 0.15);
  for (const [x, y, ph] of spots) {
    const len = 2.4 + 1.6 * ((Math.sin(t * 1.6 + ph) + 1) / 2);
    g.beginPath();
    g.moveTo(x - 1.6, y - 1); g.lineTo(x + 1.6, y - 1); g.lineTo(x + 0.9, y + len);
    g.arc(x, y + len, 0.9, 0, Math.PI); g.closePath();
    addCirc(g, x, y + len + 0.6, 1.25);
    ink(g, col, D.ow * 0.8);
    g.beginPath(); addCirc(g, x - 0.4, y + len + 0.2, 0.35); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fill();
  }
}

function neckPoint(D: DC): [number, number] {
  return [hX(D, -0.05 * D.G.hr, 0.92 * D.G.hr), hY(D, -0.05 * D.G.hr, 0.92 * D.G.hr)];
}

function drawScarfTails(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P, t, st } = D;
  const [nx, ny] = neckPoint(D);
  const x = nx - G.hr * 0.75, y = ny - 0.5;
  const speed = st.pose === 'run' ? 14 : 5, amp = st.pose === 'run' ? 2.2 : 1.2;
  for (let i = 0; i < 2; i++) {
    const w1 = Math.sin(t * speed + i * 1.3) * amp, w2 = Math.sin(t * speed + 1.5 + i) * amp;
    g.beginPath();
    addTaperQuad(g, x, y + i * 1.4, x - 5, y + 1 + w1 + i, x - 10 + i * 1.5, y + 3 + w2 + i * 2, 3.2, 2.6, 8);
    ink(g, i ? P.accentSh : P.accent, D.ow);
  }
}

function drawScarf(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P } = D;
  const [nx, ny] = neckPoint(D);
  g.beginPath(); addEll(g, nx, ny, G.hr * 0.82, 2.4, D.st.tilt * 0.5);
  ink(g, P.accent, D.ow);
  g.beginPath();
  for (let i = -2; i <= 2; i++) { g.moveTo(nx + i * 2.4 - 0.6, ny - 2); g.lineTo(nx + i * 2.4 + 0.6, ny + 2); }
  strokeLine(g, P.accentHi, 1);
  g.beginPath(); addEll(g, nx - G.hr * 0.55, ny + 0.6, 1.8, 2.2); ink(g, P.accentSh, D.ow);
}

function drawBowtie(g: CanvasRenderingContext2D, D: DC): void {
  const { P } = D;
  const [nx0, ny0] = neckPoint(D);
  const nx = nx0 + D.G.hr * 0.25, ny = ny0 + 0.4;
  g.beginPath();
  g.moveTo(nx, ny); g.lineTo(nx - 3.8, ny - 2.6); g.lineTo(nx - 3.8, ny + 2.6); g.closePath();
  g.moveTo(nx, ny); g.lineTo(nx + 3.8, ny - 2.6); g.lineTo(nx + 3.8, ny + 2.6); g.closePath();
  ink(g, P.accent, D.ow);
  g.beginPath(); addEll(g, nx, ny, 1.3, 1.5); ink(g, P.accentSh, D.ow * 0.8);
  g.beginPath(); addCirc(g, nx - 2.4, ny - 0.6, 0.55); addCirc(g, nx + 2.4, ny - 0.6, 0.55); g.fillStyle = P.accentHi; g.fill();
}

function drawMaskTails(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P, t, st } = D;
  const col = mix(P.accent, INK, 0.5);
  const x = hX(D, -0.92 * G.hr, -0.1 * G.hr), y = hY(D, -0.92 * G.hr, -0.1 * G.hr);
  const speed = st.pose === 'run' ? 16 : 6;
  for (let i = 0; i < 2; i++) {
    const w = Math.sin(t * speed + i * 1.7) * 1.6;
    g.beginPath(); addTaperQuad(g, x, y, x - 4, y - 1 + w + i * 2, x - 8 - i, y + 1.5 + w * 1.4 + i * 3, 2.2, 1.6, 6);
    ink(g, col, D.ow);
  }
}

function drawMask(g: CanvasRenderingContext2D, D: DC): void {
  // head space
  const { G, P } = D;
  const hr = G.hr;
  g.save();
  g.beginPath(); addCirc(g, 0, 0, hr); g.clip();
  g.beginPath();
  g.moveTo(-hr * 1.1, -hr * 0.4); g.quadraticCurveTo(hr * 0.4, -hr * 0.52, hr * 1.1, -hr * 0.36);
  g.lineTo(hr * 1.1, hr * 0.16); g.quadraticCurveTo(hr * 0.42, hr * 0.28, -hr * 1.1, hr * 0.12); g.closePath();
  g.fillStyle = mix(P.accent, INK, 0.5); g.fill();
  g.beginPath(); g.moveTo(-hr * 1.1, -hr * 0.4); g.quadraticCurveTo(hr * 0.4, -hr * 0.52, hr * 1.1, -hr * 0.36);
  strokeLine(g, INK, D.ow * 1.2);
  g.beginPath(); g.moveTo(-hr * 1.1, hr * 0.12); g.quadraticCurveTo(hr * 0.42, hr * 0.28, hr * 1.1, hr * 0.16);
  strokeLine(g, INK, D.ow * 1.2);
  g.restore();
  // pale rims so the eyes still read on the dark band
  const ery = G.eyeRy, erx = ery * 0.72;
  g.fillStyle = '#f8f0ff';
  g.beginPath(); addEll(g, 0.16 * hr, -0.05 * hr, erx * 1.35, ery * 1.22); addEll(g, 0.68 * hr, -0.09 * hr, erx * 1.1, ery * 1.18); g.fill();
}

function drawWhiskers(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P, t } = D;
  const hr = G.hr, sw = Math.sin(t * 2) * 0.8;
  const col = light(P.belly, 0.3);
  for (let i = 0; i < 2; i++) {
    const y0 = hr * (0.38 + i * 0.16);
    g.beginPath();
    addTaperQuad(g, hr * 0.9, y0, hr * 1.6, y0 - 1 + i * 2, hr * 2.0 + sw, y0 + 5 + i * 3 + sw, 1.3, 0.3, 8);
    ink(g, col, D.ow * 0.7);
  }
  for (let i = 0; i < 2; i++) {
    const y0 = hr * (0.42 + i * 0.16);
    g.beginPath();
    addTaperQuad(g, -hr * 0.2, y0, -hr * 0.85, y0 - 0.5, -hr * 1.3 - sw, y0 + 4 + i * 2, 1.1, 0.3, 8);
    ink(g, col, D.ow * 0.7);
  }
}

function drawMonocle(g: CanvasRenderingContext2D, D: DC, ex: number, ey: number, ery: number): void {
  const r = ery * 1.3;
  g.beginPath(); addCirc(g, ex, ey, r);
  g.fillStyle = 'rgba(200,235,255,0.25)'; g.fill();
  g.beginPath(); addCirc(g, ex, ey, r); strokeLine(g, INK, D.ow * 2.6);
  g.beginPath(); addCirc(g, ex, ey, r); strokeLine(g, '#f2c64a', D.ow * 1.2);
  g.beginPath(); g.moveTo(ex - r * 0.5, ey - r * 0.4); g.lineTo(ex - r * 0.1, ey - r * 0.75); strokeLine(g, '#ffffff', D.ow * 0.9);
  // chain swinging down to the chest
  g.beginPath(); g.moveTo(ex - r * 0.6, ey + r * 0.8);
  g.quadraticCurveTo(ex - r * 1.6, ey + r * 3.5 + Math.sin(D.t * 2) * 0.6, ex - r * 0.2, ey + r * 4.6);
  g.setLineDash([0.8, 0.9]); strokeLine(g, '#d8a838', D.ow * 1.1); g.setLineDash([]);
}

function drawGoggles(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P } = D;
  const hr = G.hr;
  const y = -0.62 * hr;
  g.beginPath(); g.moveTo(-hr * 0.98, y + 1.5); g.quadraticCurveTo(-hr * 0.3, y - 1.2, hr * 0.2, y);
  strokeLine(g, INK, D.ow * 2 + 2.6);
  g.beginPath(); g.moveTo(-hr * 0.98, y + 1.5); g.quadraticCurveTo(-hr * 0.3, y - 1.2, hr * 0.2, y);
  strokeLine(g, mix(P.accent, '#5a3a2a', 0.5), 2.6);
  const lens = (cx: number, r: number) => {
    g.beginPath(); addCirc(g, cx, y, r); ink(g, '#d8a040', D.ow);
    g.beginPath(); addCirc(g, cx, y, r * 0.72); g.fillStyle = '#7fd4f0'; g.fill();
    g.beginPath(); addEll(g, cx - r * 0.25, y - r * 0.25, r * 0.28, r * 0.18, -0.6); g.fillStyle = '#ffffff'; g.fill();
  };
  lens(0.66 * hr, hr * 0.24);
  lens(0.16 * hr, hr * 0.29);
}

function drawTuft(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P, t } = D;
  const hr = G.hr, sw = Math.sin(t * 3) * 0.4;
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    const x = -0.25 * hr + i * 0.22 * hr, y = -0.88 * hr;
    addTaperQuad(g, x - 1, y + 2, x + 0.5, y - 3.5, x + 3 + i * 0.6 + sw, y - 5.5 + i * 0.8, 2.6, 0.3, 6);
  }
  ink(g, P.body, D.ow);
  g.beginPath();
  addTaperQuad(g, -0.25 * hr, -0.88 * hr + 1.5, -0.25 * hr + 1.2, -0.88 * hr - 3, -0.25 * hr + 3 + sw, -0.88 * hr - 5, 1, 0.2, 5);
  g.fillStyle = P.bodyHi; g.fill();
}

function drawFlowers(g: CanvasRenderingContext2D, D: DC): void {
  const { G, P, t } = D;
  const hr = G.hr;
  const spots: [number, string][] = [[-2.25, P.accent], [-1.75, '#ffffff'], [-1.28, P.cheek]];
  for (let i = 0; i < spots.length; i++) {
    const [a, col] = spots[i];
    const x = Math.cos(a) * hr * 0.98, y = Math.sin(a) * hr * 0.98;
    g.beginPath(); addLeaf(g, x, y, a - 1.2, 4, 1.4); ink(g, '#5fb04a', D.ow * 0.8);
    g.beginPath();
    const spin = t * 0.5 + i;
    for (let k = 0; k < 5; k++) {
      const pa = spin + (k / 5) * TAU;
      addCirc(g, x + Math.cos(pa) * 1.7, y + Math.sin(pa) * 1.7, 1.35);
    }
    ink(g, col, D.ow * 0.8);
    g.beginPath(); addCirc(g, x, y, 1.05); g.fillStyle = '#ffd23a'; g.fill();
  }
}

function drawCrown(g: CanvasRenderingContext2D, D: DC): void {
  const { G } = D;
  const hr = G.hr;
  g.save();
  g.translate(0.02 * hr, -0.94 * hr); g.rotate(-0.12);
  const w = hr * 0.56, h = hr * 0.5;
  g.beginPath();
  g.moveTo(-w, 1); g.lineTo(-w, -h * 0.5); g.lineTo(-w * 0.5, -h * 0.05); g.lineTo(0, -h); g.lineTo(w * 0.5, -h * 0.05);
  g.lineTo(w, -h * 0.5); g.lineTo(w, 1); g.closePath();
  ink(g, '#ffcf3a', D.ow);
  g.beginPath(); g.rect(-w, -0.6, w * 2, 1.6); g.fillStyle = '#e09a20'; g.fill();
  g.beginPath(); addCirc(g, 0, -0.1, 1.1); g.fillStyle = '#e8384a'; g.fill();
  g.beginPath(); addCirc(g, -w * 0.62, 0, 0.75); addCirc(g, w * 0.62, 0, 0.75); g.fillStyle = '#4ab0f0'; g.fill();
  g.beginPath(); addCirc(g, 0, -h, 0.9); addCirc(g, -w, -h * 0.5, 0.75); addCirc(g, w, -h * 0.5, 0.75); g.fillStyle = '#fff2b0'; g.fill();
  g.restore();
}

function drawChefHat(g: CanvasRenderingContext2D, D: DC): void {
  const { G } = D;
  const hr = G.hr;
  g.save();
  g.translate(-0.05 * hr, -0.86 * hr); g.rotate(-0.18);
  const w = hr * 0.62;
  g.beginPath();
  addCirc(g, -w * 0.62, -hr * 0.62, hr * 0.38);
  addCirc(g, w * 0.6, -hr * 0.62, hr * 0.38);
  addCirc(g, 0, -hr * 0.82, hr * 0.44);
  g.rect(-w * 0.85, -hr * 0.6, w * 1.7, hr * 0.6);
  ink(g, '#fbfaf6', D.ow);
  g.beginPath(); g.rect(-w * 0.85, -hr * 0.28, w * 1.7, hr * 0.32); ink(g, '#ece8f0', D.ow * 0.6);
  g.beginPath(); g.moveTo(-w * 0.25, -hr * 0.62); g.lineTo(-w * 0.2, -hr * 0.36); g.moveTo(w * 0.25, -hr * 0.62); g.lineTo(w * 0.2, -hr * 0.36);
  strokeLine(g, '#d4d0dc', D.ow);
  g.restore();
}

function drawHalo(g: CanvasRenderingContext2D, D: DC): void {
  const { G, t } = D;
  const hr = G.hr;
  const y = -hr * 1.42 + Math.sin(t * 2.2) * 0.8;
  g.save();
  g.globalAlpha *= 0.35;
  g.beginPath(); addEll(g, 0, y, hr * 0.72, hr * 0.26); strokeLine(g, '#fff6b0', 4);
  g.restore();
  g.beginPath(); addEll(g, 0, y, hr * 0.62, hr * 0.2); strokeLine(g, INK, D.ow * 2 + 1.8);
  g.beginPath(); addEll(g, 0, y, hr * 0.62, hr * 0.2); strokeLine(g, '#ffd84a', 1.8);
  g.beginPath(); g.ellipse(0, y, hr * 0.62, hr * 0.2, 0, Math.PI * 1.1, Math.PI * 1.5); strokeLine(g, '#fff8d0', 0.8);
}

function drawFrostBreath(g: CanvasRenderingContext2D, D: DC): void {
  const { G, t } = D;
  const hr = G.hr;
  const mx = hr * 1.0, my = hr * 0.55;
  for (let i = 0; i < 3; i++) {
    const k = (t * 0.8 + i / 3) % 1;
    const x = mx + 2 + k * 11, y = my + Math.sin(k * 5 + i) * 1.2 - k * 2;
    const r = 1.2 + k * 2.4;
    g.save();
    g.globalAlpha *= (1 - k) * 0.85;
    g.beginPath(); addCirc(g, x, y, r); addCirc(g, x + r * 0.7, y - r * 0.3, r * 0.7);
    g.fillStyle = '#dff6ff'; g.fill();
    g.beginPath(); addCirc(g, x, y, r); addCirc(g, x + r * 0.7, y - r * 0.3, r * 0.7);
    strokeLine(g, '#9ad4f0', 0.6);
    g.restore();
  }
  const k = (t * 0.8 + 0.5) % 1;
  g.save(); g.globalAlpha *= 1 - k;
  drawSnowflake(g, mx + 4 + k * 12, my - 2 - k * 3, 1.3, '#ffffff');
  g.restore();
}

function drawSnowflake(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  strokeLine(g, color, 0.6);
}

function drawNoseBubble(g: CanvasRenderingContext2D, D: DC): void {
  const { G, t } = D;
  const hr = G.hr;
  const k = (Math.sin(t * 1.4) + 1) / 2;
  const r = 1 + k * 3;
  const x = hr * 1.08 + r * 0.7, y = hr * 0.3 + r * 0.4;
  g.beginPath(); addCirc(g, x, y, r);
  g.fillStyle = 'rgba(200,236,255,0.55)'; g.fill();
  strokeLine(g, 'rgba(120,180,220,0.9)', 0.6);
  g.beginPath(); addCirc(g, x - r * 0.35, y - r * 0.35, r * 0.25); g.fillStyle = '#ffffff'; g.fill();
}

function drawParticles(g: CanvasRenderingContext2D, D: DC): void {
  const { G, st, t, P } = D;
  const ex = G.extras;
  const top = G.hy - G.hr;
  if (ex.has('bubbles')) {
    for (let i = 0; i < 4; i++) {
      const k = (t * 0.35 + i * 0.27) % 1;
      const x = G.bx + (i % 2 ? -1 : 1) * (G.brx * 0.9 + i * 1.5) + Math.sin(t * 2.5 + i * 2) * 1.6;
      const y = -4 - k * 40;
      const r = 1.3 + (i % 3) * 0.55;
      g.save(); g.globalAlpha *= Math.sin(k * Math.PI);
      g.beginPath(); addCirc(g, x, y, r); g.fillStyle = 'rgba(190,232,255,0.35)'; g.fill();
      strokeLine(g, '#7cc4ec', 0.7);
      g.beginPath(); addCirc(g, x - r * 0.35, y - r * 0.35, r * 0.28); g.fillStyle = '#ffffff'; g.fill();
      g.restore();
    }
  }
  if (ex.has('sparkles')) {
    const spots: [number, number][] = [[G.bx - G.brx * 1.1, G.by - G.bry * 0.6], [G.hx + G.hr * 1.3, top + 2], [G.bx - G.brx * 0.3, top - 4], [G.bx + G.brx * 1.2, -4]];
    for (let i = 0; i < spots.length; i++) {
      const s = Math.max(0, Math.sin(t * 3.2 + i * 1.9));
      drawTwinkle(g, spots[i][0], spots[i][1], s * 2.8, i % 2 ? '#fff6c0' : light(P.accent, 0.5), D.ow);
    }
  }
  if (st.hearts) {
    for (let i = 0; i < 2; i++) {
      const k = (t * 0.9 + i * 0.5) % 1;
      g.save(); g.globalAlpha *= Math.sin(k * Math.PI);
      drawHeart(g, G.hx + (i ? 6 : -10) + Math.sin(k * 6 + i) * 1.5, top - 3 - k * 12, 1.8 + k * 0.6, '#ff6f8e', D.ow);
      g.restore();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Samples: every wing, horn, tail, pattern and extra, size and build extremes, coloured by type
// ---------------------------------------------------------------------------------------------

function dv(body: string, belly: string, accent: string, wing: string, eye: string, cheek: string, size: number, build: number,
  wings: DragonVisual['wings'], horns: DragonVisual['horns'], tail: DragonVisual['tail'], pattern: DragonVisual['pattern'], extras: DragonExtra[]): DragonVisual {
  return { body, belly, accent, wing, eye, cheek, size, build, wings, horns, tail, pattern, extras };
}

/** About two dozen visuals for galleries and tests; together they use every style option. */
export const SAMPLE_DRAGONS: DragonVisual[] = [
  // FIRE line
  dv('#f07a3a', '#ffe2a8', '#ffcf3a', '#ff9e4a', '#2a1410', '#ff6f7a', 0.75, 0.1, 'stubby', 'nubs', 'flame', 'none', []),
  dv('#d9482b', '#ffd08a', '#ffb52e', '#ff7a2e', '#2a0e0a', '#ff6f6f', 1.45, 0.5, 'flame', 'flame', 'flame', 'scales', ['aura']),
  // WATER line
  dv('#4fa8e8', '#e8f6ff', '#2f6fc8', '#8fd4ff', '#10203a', '#ff8fb0', 0.75, 0.2, 'fin', 'none', 'fin', 'speckles', ['bubbles']),
  dv('#2f7fd0', '#cfeeff', '#1d5aa0', '#7cc8f0', '#0e1a30', '#ff8fb0', 1.4, 0.8, 'fin', 'curved', 'fin', 'scales', ['shell']),
  // LEAF line
  dv('#7cc850', '#f4f0c0', '#4f9a2e', '#a8e070', '#1a2a10', '#ff8f9a', 0.72, 0, 'leaf', 'sprout', 'leaf', 'spots', ['flowers']),
  dv('#4fa040', '#eef0b8', '#2f6a24', '#8fd060', '#14240e', '#ff8f9a', 1.4, 0.45, 'leaf', 'antlers', 'leaf', 'stripes', ['whiskersLong']),
  // LIGHTNING
  dv('#ffd43a', '#fff4c8', '#3a3456', '#ffe98a', '#1a1420', '#ff6a5a', 1.0, 0.65, 'bat', 'bolt', 'bolt', 'stripes', ['goggles']),
  // EARTH
  dv('#b8875a', '#f0dcb8', '#7a5232', '#d8a878', '#24160c', '#f08a7a', 1.1, 0.1, 'stubby', 'nubs', 'club', 'patches', ['tuft']),
  // ROCK
  dv('#9a9088', '#d8d0c4', '#6a625c', '#bdb4aa', '#1a1614', '#e89a8a', 1.3, 0, 'none', 'crystal', 'club', 'spots', ['shell']),
  // WINGED
  dv('#8ac8f0', '#ffffff', '#f0c040', '#ffffff', '#14203a', '#ff9ab0', 0.95, 0.7, 'feather', 'none', 'feather', 'none', ['tuft', 'scarf']),
  // FROST
  dv('#c8ecff', '#ffffff', '#5aa8e0', '#e8faff', '#14284a', '#ffa8c8', 1.15, 0.4, 'crystal', 'crystal', 'spike', 'speckles', ['frostBreath', 'scarf']),
  // SLIME
  dv('#a070d0', '#ead4ff', '#78d040', '#c8a0f0', '#1e1030', '#ff8fd0', 1.0, 0.2, 'bat', 'antenna', 'drip', 'spots', ['drips']),
  // DARKNESS
  dv('#4a3a6a', '#8a7aa8', '#e04a6a', '#2e2448', '#c8203a', '#e05a8a', 1.25, 0.6, 'bat', 'curved', 'spike', 'stripes', ['mask']),
  // LIGHT
  dv('#fff2c0', '#ffffff', '#ffc83a', '#ffffff', '#3a2a10', '#ffa0a0', 1.3, 0.3, 'feather', 'unicorn', 'star', 'swirl', ['halo', 'sparkles']),
  // COOKING line
  dv('#f4b8c8', '#fff6ea', '#e8604a', '#ffd8e0', '#2a1418', '#ff7a8a', 0.95, 0, 'stubby', 'none', 'whisk', 'patches', ['chefHat', 'apron']),
  dv('#ee9ab4', '#fff2e4', '#c84a5a', '#fff0f4', '#2a1418', '#ff6a7a', 1.5, 0, 'cloud', 'nubs', 'whisk', 'none', ['chefHat', 'bowtie']),
  // METAL
  dv('#9aa8b8', '#dfe6ee', '#5a6a7e', '#c8d4e0', '#101820', '#f0a0a8', 1.2, 0.5, 'gear', 'antenna', 'club', 'scales', ['goggles']),
  // MIND
  dv('#d080d8', '#fbe0ff', '#7a40b8', '#f0b0f8', '#200a30', '#ff7ab8', 1.1, 0.4, 'cloud', 'antenna', 'star', 'swirl', ['monocle', 'whiskersLong']),
  // BRAWL
  dv('#e8a060', '#fff0d8', '#d03030', '#f8c890', '#2a140a', '#ff6a5a', 1.2, 0.3, 'none', 'nubs', 'spike', 'stripes', ['tuft', 'scarf']),
  // FLUFF line
  dv('#f4e4d4', '#ffffff', '#e8a0b0', '#ffffff', '#2a1a1a', '#ff9ab0', 0.7, 0, 'cloud', 'none', 'stub', 'none', ['sparkles']),
  dv('#f8d8e8', '#ffffff', '#f088b0', '#ffffff', '#2a1a24', '#ff8ab0', 1.35, 0.2, 'cloud', 'nubs', 'whisk', 'patches', ['crown', 'bowtie']),
  // legendary
  dv('#34346e', '#8a8ad0', '#ffd040', '#9ad8ff', '#fff4c0', '#ff8ac8', 1.5, 1, 'crystal', 'crystal', 'star', 'speckles', ['crown', 'aura', 'sparkles']),
  // EARTH digger (small, sleek)
  dv('#c8a070', '#f4e4c8', '#8a6440', '#e0c098', '#20140a', '#f09a8a', 0.85, 1, 'stubby', 'nubs', 'spike', 'speckles', ['goggles', 'tuft']),
  // FIRE / ROCK
  dv('#6a4a4a', '#c8a090', '#ff7a2a', '#9a3a2a', '#2a0a06', '#ff7a6a', 1.25, 0.7, 'bat', 'curved', 'club', 'spots', ['monocle']),
];
