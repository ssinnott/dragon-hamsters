// Battle effects: a small particle and timed-animation system. `move(kind, from, to, type)` plays
// the visual for every FxKind (impacts at the target for contact moves, projectiles or beams that
// travel from -> to and then burst, a quake that shakes the screen, buff/debuff arrows, heal plus
// signs, a shield bubble and sound rings), coloured from the move's type (TYPES is read at call
// time, so a content change is picked up immediately). Damage numbers pop with floatText, and
// `offsetX` / `offsetY` carry the decaying screen shake for the scene to translate by.
//
// Points: `from` is the user and `to` the target, both roughly at the combatants' body centres.
// The self-directed kinds (buff, debuff, heal, shield) play at `from`: pass the affected combatant
// there (for a move that lowers the foe's stats, that is the foe). All randomness comes from a
// private seeded RNG so a replay looks the same.
import type { FxKind, TypeId } from '../data/schema.ts';
import { TYPES } from '../data/types.ts';
import { makeRng } from '../lib/engine/rng.ts';
import { mix, rgba, shade } from '../lib/art/palettes.ts';
import { pathStar } from '../lib/art/shapes.ts';
import { drawTextOutlined } from '../lib/engine/text.ts';

type Ctx = CanvasRenderingContext2D;

export interface FxPoint { x: number; y: number }

export interface Fx {
  /** Play the effect for a move of this kind and type; takes about 0.5-0.8 s. */
  move(kind: FxKind, from: FxPoint, to: FxPoint, type: TypeId): void;
  /** A quick radial burst of particles. */
  burst(x: number, y: number, color: string, n?: number): void;
  /** A number or word that pops, rises and fades (damage numbers, 'MISS', 'CRIT!'). */
  floatText(x: number, y: number, text: string, color: string): void;
  /** Kick the screen shake (pixels); it decays on its own. */
  shake(amount: number): void;
  update(dt: number): void;
  draw(ctx: Ctx): void;
  /** True while any effect, particle, floating text or shake is still running. */
  readonly busy: boolean;
  readonly offsetX: number;
  readonly offsetY: number;
}

const TAU = Math.PI * 2;
const INK = '#1b1426';
const MAX_PARTICLES = 700;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

type Shape =
  | 'dot' | 'spark' | 'square' | 'leaf' | 'drop' | 'star' | 'plus' | 'shard' | 'smoke' | 'bubble'
  | 'heart' | 'note' | 'arrowUp' | 'arrowDown' | 'flame';

interface Particle {
  x: number; y: number; vx: number; vy: number; ax: number; ay: number; drag: number;
  life: number; max: number; delay: number;
  size: number; grow: number; alpha: number;
  color: string; color2: string | null; shape: Shape;
  rot: number; vr: number; glow: boolean;
}
type PartInit = Partial<Particle> & { x: number; y: number };

interface Task {
  delay: number; dur: number; age: number; u: number;
  started: boolean; done: boolean; layer: 0 | 1;
  start: (() => void) | null;
  tick: ((dt: number, u: number, local: number) => void) | null;
  draw: ((ctx: Ctx, u: number, local: number) => void) | null;
  end: (() => void) | null;
}
type TaskInit = Partial<Pick<Task, 'delay' | 'layer' | 'start' | 'tick' | 'draw' | 'end'>> & { dur: number };

interface Floater { x: number; y: number; text: string; color: string; age: number; dur: number }

interface Tint { c: string; light: string; dark: string }

function tintOf(type: TypeId): Tint {
  const info = (TYPES as Partial<Record<TypeId, { color?: string; light?: string; dark?: string }>>)[type];
  const c = info && info.color && HEX.test(info.color) ? info.color : '#ffffff';
  const light = info && info.light && HEX.test(info.light) ? info.light : mix(c, '#ffffff', 0.5);
  const dark = info && info.dark && HEX.test(info.dark) ? info.dark : shade(c, 0.55);
  return { c, light, dark };
}

const outQuad = (u: number) => u * (2 - u);
const inQuad = (u: number) => u * u;
const inOutQuad = (u: number) => (u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u);
const outBack = (u: number) => { const k = 1.70158; return 1 + (k + 1) * Math.pow(u - 1, 3) + k * Math.pow(u - 1, 2); };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const fade = (u: number, from = 0.65) => (u < from ? 1 : Math.max(0, 1 - (u - from) / (1 - from)));

// --- shape painters (drawn at the origin; the caller sets transform, colour and alpha) --------

function heartPath(c: Ctx, s: number): void {
  c.beginPath();
  c.moveTo(0, s * 0.9);
  c.bezierCurveTo(-s * 1.2, 0, -s * 0.9, -s, 0, -s * 0.35);
  c.bezierCurveTo(s * 0.9, -s, s * 1.2, 0, 0, s * 0.9);
  c.closePath();
}

function arrowPts(s: number, up: boolean): number[] {
  const d = up ? 1 : -1;
  return [0, -s * d, s * 0.85, -s * 0.05 * d, s * 0.32, -s * 0.05 * d, s * 0.32, s * d, -s * 0.32, s * d, -s * 0.32, -s * 0.05 * d, -s * 0.85, -s * 0.05 * d];
}

function polyPath(c: Ctx, pts: readonly number[]): void {
  c.beginPath(); c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
}

function gearPath(c: Ctx, r: number, teeth: number): void {
  c.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i / (teeth * 2)) * TAU, a1 = ((i + 1) / (teeth * 2)) * TAU;
    const rr = i % 2 ? r * 0.72 : r;
    c.lineTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
    c.lineTo(Math.cos(a1) * rr, Math.sin(a1) * rr);
  }
  c.closePath();
}

/** A tapered sweeping stroke (claw marks, gusts) along a quadratic curve. */
function sweep(c: Ctx, x0: number, y0: number, x1: number, y1: number, bend: number, w: number, from: number, to: number, outer: string, inner: string): void {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const cx = (x0 + x1) / 2 + nx * bend, cy = (y0 + y1) / 2 + ny * bend;
  const N = 12;
  const left: number[] = [], right: number[] = [];
  for (let i = 0; i <= N; i++) {
    const s = from + (to - from) * (i / N);
    const px = (1 - s) * (1 - s) * x0 + 2 * (1 - s) * s * cx + s * s * x1;
    const py = (1 - s) * (1 - s) * y0 + 2 * (1 - s) * s * cy + s * s * y1;
    const tx = 2 * (1 - s) * (cx - x0) + 2 * s * (x1 - cx), ty = 2 * (1 - s) * (cy - y0) + 2 * s * (y1 - cy);
    const tl = Math.hypot(tx, ty) || 1;
    const k = Math.sin(Math.PI * (i / N)) * w;
    left.push(px - (ty / tl) * k, py + (tx / tl) * k);
    right.push(px + (ty / tl) * k, py - (tx / tl) * k);
  }
  const outline = (scale: number) => {
    c.beginPath();
    for (let i = 0; i <= N; i++) {
      const mx = (left[i * 2] + right[i * 2]) / 2, my = (left[i * 2 + 1] + right[i * 2 + 1]) / 2;
      const lx = mx + (left[i * 2] - mx) * scale, ly = my + (left[i * 2 + 1] - my) * scale;
      if (i === 0) c.moveTo(lx, ly); else c.lineTo(lx, ly);
    }
    for (let i = N; i >= 0; i--) {
      const mx = (left[i * 2] + right[i * 2]) / 2, my = (left[i * 2 + 1] + right[i * 2 + 1]) / 2;
      c.lineTo(mx + (right[i * 2] - mx) * scale, my + (right[i * 2 + 1] - my) * scale);
    }
    c.closePath();
  };
  outline(1); c.fillStyle = outer; c.fill();
  outline(0.4); c.fillStyle = inner; c.fill();
}

// ---------------------------------------------------------------------------------------------

/** Create an independent effects layer (one per battle scene). */
export function createFx(): Fx {
  const rng = makeRng(0x0d4a9);
  let parts: Particle[] = [];
  let tasks: Task[] = [];
  let incoming: Task[] = [];
  let floaters: Floater[] = [];
  let shakeAmt = 0;
  let offX = 0, offY = 0;

  // --- primitives ----------------------------------------------------------------------------

  function spawn(o: PartInit): void {
    if (parts.length >= MAX_PARTICLES) return;
    parts.push({
      vx: 0, vy: 0, ax: 0, ay: 0, drag: 0, life: 0, max: 0.5, delay: 0, size: 3, grow: 1, alpha: 1,
      color: '#ffffff', color2: null, shape: 'dot', rot: 0, vr: 0, glow: false, ...o,
    });
  }

  function add(o: TaskInit): void {
    incoming.push({
      delay: o.delay ?? 0, dur: o.dur, age: 0, u: 0, started: false, done: false, layer: o.layer ?? 0,
      start: o.start ?? null, tick: o.tick ?? null, draw: o.draw ?? null, end: o.end ?? null,
    });
  }

  function later(delay: number, fn: () => void): void { add({ delay, dur: 0, start: fn }); }

  function shake(amount: number): void { if (amount > shakeAmt) shakeAmt = amount; }

  function flash(x: number, y: number, r: number, color: string, dur: number, delay = 0): void {
    add({
      delay, dur, layer: 1,
      draw: (c, u) => {
        const rr = r * (0.55 + 0.6 * outQuad(u));
        const a = 1 - u;
        c.globalCompositeOperation = 'lighter';
        const g = c.createRadialGradient(x, y, 0, x, y, rr);
        g.addColorStop(0, rgba('#ffffff', 0.85 * a));
        g.addColorStop(0.35, rgba(color, 0.55 * a));
        g.addColorStop(1, rgba(color, 0));
        c.fillStyle = g;
        c.beginPath(); c.arc(x, y, rr, 0, TAU); c.fill();
      },
    });
  }

  function ring(x: number, y: number, r0: number, r1: number, color: string, dur: number, width: number, delay = 0, squash = 1): void {
    add({
      delay, dur,
      draw: (c, u) => {
        const r = lerp(r0, r1, outQuad(u));
        c.globalAlpha = 1 - u;
        c.strokeStyle = color; c.lineWidth = Math.max(0.5, width * (1 - u * 0.6));
        c.beginPath(); c.ellipse(x, y, r, r * squash, 0, 0, TAU); c.stroke();
      },
    });
  }

  function starburst(x: number, y: number, r: number, fill: string, edge: string, points: number, dur: number, delay = 0): void {
    const rot = rng.range(0, TAU);
    add({
      delay, dur, layer: 1,
      draw: (c, u) => {
        const s = u < 0.3 ? outBack(u / 0.3) : 1 + (u - 0.3) * 0.2;
        c.globalAlpha = fade(u, 0.45);
        pathStar(c, x, y, r * s, r * s * 0.46, points, rot); c.fillStyle = edge; c.fill();
        pathStar(c, x, y, r * s * 0.66, r * s * 0.3, points, rot); c.fillStyle = fill; c.fill();
      },
    });
  }

  function debris(x: number, y: number, color: string, n: number, speed: number, delay = 0): void {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU), v = rng.range(0.4, 1) * speed;
      spawn({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, ay: 420, drag: 1.2, delay,
        max: rng.range(0.35, 0.6), size: rng.range(2, 3.5), color, shape: 'square', rot: a, vr: rng.range(-12, 12),
      });
    }
  }

  function sparks(x: number, y: number, color: string, n: number, speed: number, delay = 0): void {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU), v = rng.range(0.5, 1) * speed;
      spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 5, delay, max: rng.range(0.2, 0.38), size: rng.range(1.2, 2), color, shape: 'spark', glow: true });
    }
  }

  function stars(x: number, y: number, color: string, n: number, speed: number, delay = 0, spread = 0): void {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU), v = rng.range(0.3, 1) * speed;
      spawn({
        x: x + rng.range(-spread, spread), y: y + rng.range(-spread, spread), vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        drag: 3, delay, max: rng.range(0.35, 0.6), size: rng.range(2.5, 4), grow: 0.3, color, shape: 'star', glow: true, rot: rng.range(0, TAU), vr: rng.range(-4, 4),
      });
    }
  }

  interface ProjOpts {
    delay?: number; dur: number; arc?: number; wobble?: number; wobbleFreq?: number;
    easing?: (u: number) => number; jitter?: number;
    head: (c: Ctx, x: number, y: number, ang: number, u: number, age: number) => void;
    trail?: (x: number, y: number, ang: number) => void; trailEvery?: number;
    hit?: (x: number, y: number) => void;
  }

  /** Something that flies from a to b (with optional arc and wobble) and calls `hit` on arrival. */
  function projectile(a: FxPoint, b: FxPoint, o: ProjOpts): void {
    const j = o.jitter ?? 0;
    const tx = b.x + (j ? rng.range(-j, j) : 0), ty = b.y + (j ? rng.range(-j, j) : 0);
    const ease = o.easing ?? ((u: number) => u);
    const dx = tx - a.x, dy = ty - a.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const pos = (u: number): FxPoint => {
      const e = ease(Math.max(0, Math.min(1, u)));
      const lateral = (o.wobble ?? 0) * Math.sin(e * Math.PI * (o.wobbleFreq ?? 2)) * (1 - e * 0.6);
      const lift = (o.arc ?? 0) * 4 * e * (1 - e);
      return { x: a.x + dx * e + nx * lateral, y: a.y + dy * e + ny * lateral - lift };
    };
    let cur = pos(0);
    let acc = 0;
    add({
      delay: o.delay ?? 0, dur: o.dur, layer: 1,
      tick: (dt, u) => {
        cur = pos(u);
        if (o.trail) {
          acc += dt;
          const every = o.trailEvery ?? 0.02;
          let guard = 0;
          while (acc >= every && guard++ < 8) {
            acc -= every;
            const n = pos(u + 0.03);
            o.trail(cur.x, cur.y, Math.atan2(n.y - cur.y, n.x - cur.x));
          }
        }
      },
      draw: (c, u, age) => {
        const n = pos(u + 0.03), p = pos(u - 0.03);
        o.head(c, cur.x, cur.y, Math.atan2(n.y - p.y, n.x - p.x), u, age);
      },
      end: () => { if (o.hit) o.hit(tx, ty); },
    });
  }

  // --- heads ---------------------------------------------------------------------------------

  function fireball(c: Ctx, x: number, y: number, age: number, k: Tint): void {
    const f = 1 + Math.sin(age * 45) * 0.12;
    c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(x, y, 0, x, y, 13 * f);
    g.addColorStop(0, rgba('#fff4c0', 0.9)); g.addColorStop(0.4, rgba(k.c, 0.7)); g.addColorStop(1, rgba(k.c, 0));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, 13 * f, 0, TAU); c.fill();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = k.c; c.beginPath(); c.arc(x, y, 6.5 * f, 0, TAU); c.fill();
    c.fillStyle = '#ffe58a'; c.beginPath(); c.arc(x, y, 4 * f, 0, TAU); c.fill();
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x - 1, y - 1, 1.8, 0, TAU); c.fill();
  }

  function drop(c: Ctx, x: number, y: number, ang: number, r: number, fill: string): void {
    c.save(); c.translate(x, y); c.rotate(ang);
    c.beginPath(); c.moveTo(r * 2.2, 0); c.quadraticCurveTo(r * 0.4, -r * 1.2, -r, 0); c.quadraticCurveTo(r * 0.4, r * 1.2, r * 2.2, 0);
    c.fillStyle = fill; c.fill();
    c.fillStyle = rgba('#ffffff', 0.8); c.beginPath(); c.arc(0, -r * 0.35, r * 0.35, 0, TAU); c.fill();
    c.restore();
  }

  function leafShape(c: Ctx, x: number, y: number, rot: number, s: number, k: Tint): void {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.beginPath(); c.moveTo(-s, 0); c.quadraticCurveTo(0, -s * 0.75, s, 0); c.quadraticCurveTo(0, s * 0.75, -s, 0);
    c.fillStyle = k.c; c.fill(); c.strokeStyle = k.dark; c.lineWidth = 1; c.stroke();
    c.strokeStyle = k.light; c.beginPath(); c.moveTo(-s * 0.8, 0); c.lineTo(s * 0.8, 0); c.stroke();
    c.restore();
  }

  function shard(c: Ctx, x: number, y: number, ang: number, s: number, k: Tint): void {
    c.save(); c.translate(x, y); c.rotate(ang);
    polyPath(c, [s * 1.4, 0, 0, -s * 0.38, -s * 0.9, 0, 0, s * 0.38]);
    c.fillStyle = k.light; c.fill(); c.strokeStyle = k.c; c.lineWidth = 1; c.stroke();
    polyPath(c, [s * 1.4, 0, 0, -s * 0.38, 0, 0]); c.fillStyle = rgba('#ffffff', 0.85); c.fill();
    c.restore();
  }

  function blob(c: Ctx, x: number, y: number, ang: number, age: number, r: number, k: Tint): void {
    const wob = Math.sin(age * 30) * 0.12;
    c.save(); c.translate(x, y); c.rotate(ang);
    c.beginPath(); c.ellipse(0, 0, r * (1.25 + wob), r * (0.85 - wob), 0, 0, TAU);
    c.fillStyle = k.c; c.fill(); c.strokeStyle = k.dark; c.lineWidth = 1.2; c.stroke();
    c.fillStyle = rgba(k.light, 0.9); c.beginPath(); c.arc(r * 0.3, -r * 0.35, r * 0.3, 0, TAU); c.fill();
    c.restore();
  }

  function fist(c: Ctx, x: number, y: number, ang: number, s: number, k: Tint): void {
    c.save(); c.translate(x, y); c.rotate(ang); c.scale(s, s);
    c.lineJoin = 'round';
    c.beginPath(); c.roundRect(-11, -10, 20, 20, 6);
    c.fillStyle = k.light; c.fill(); c.strokeStyle = INK; c.lineWidth = 2; c.stroke();
    c.strokeStyle = rgba(INK, 0.7); c.lineWidth = 1.2;
    c.beginPath();
    for (const fy of [-5, 0, 5]) { c.moveTo(3, fy); c.lineTo(9, fy); }
    c.stroke();
    c.beginPath(); c.roundRect(-6, 6, 10, 6, 3); c.fillStyle = k.light; c.fill(); c.strokeStyle = INK; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = rgba('#ffffff', 0.6); c.fillRect(-7, -7, 6, 3);
    c.restore();
  }

  function jaw(c: Ctx, x: number, y: number, dir: 1 | -1, k: Tint): void {
    const w = 30;
    c.beginPath();
    c.moveTo(x - w - 4, y - dir * 2);
    c.quadraticCurveTo(x, y + dir * 8, x + w + 4, y - dir * 2);
    c.lineTo(x + w + 4, y - dir * 10);
    c.quadraticCurveTo(x, y - dir * 2, x - w - 4, y - dir * 10);
    c.closePath();
    c.fillStyle = k.dark; c.fill(); c.strokeStyle = INK; c.lineWidth = 1.5; c.stroke();
    for (let i = 0; i < 6; i++) {
      const tx = x - w + 6 + i * ((w * 2 - 12) / 5);
      const curve = (1 - Math.pow((tx - x) / w, 2)) * 4;
      const base = y + dir * curve - dir * 3;
      const len = i === 0 || i === 5 ? 14 : 10;
      polyPath(c, [tx - 4.5, base, tx + 4.5, base, tx, base + dir * len]);
      c.fillStyle = '#ffffff'; c.fill(); c.strokeStyle = INK; c.lineWidth = 1.2; c.stroke();
    }
  }

  function pie(c: Ctx, x: number, y: number, rot: number, k: Tint): void {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.beginPath(); c.ellipse(0, 1, 12, 7, 0, 0, TAU); c.fillStyle = '#d89a50'; c.fill(); c.strokeStyle = INK; c.lineWidth = 1.5; c.stroke();
    c.beginPath(); c.ellipse(0, -1, 9.5, 4.5, 0, 0, TAU); c.fillStyle = k.c; c.fill();
    c.strokeStyle = '#b87a38'; c.lineWidth = 1;
    for (const dx of [-6, 0, 6]) { c.beginPath(); c.moveTo(dx - 2, 4); c.lineTo(dx + 2, 6); c.stroke(); }
    c.beginPath(); c.arc(0, -4, 4, 0, TAU); c.fillStyle = '#fff8ec'; c.fill();
    c.beginPath(); c.arc(0, -8, 2.2, 0, TAU); c.fillStyle = '#e8384a'; c.fill();
    c.restore();
  }

  function rockShape(c: Ctx, x: number, y: number, rot: number, pts: number[], fill: string): void {
    c.save(); c.translate(x, y); c.rotate(rot);
    polyPath(c, pts);
    c.fillStyle = fill; c.fill(); c.strokeStyle = INK; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = rgba('#ffffff', 0.25);
    c.beginPath(); c.moveTo(pts[0] * 0.6, pts[1] * 0.6); c.lineTo(pts[2] * 0.6, pts[3] * 0.6); c.lineTo(0, 0); c.closePath(); c.fill();
    c.restore();
  }

  function twinkle(c: Ctx, x: number, y: number, s: number, color: string): void {
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = color;
    pathStar(c, x, y, s, s * 0.28, 4, 0); c.fill();
    c.fillStyle = '#ffffff';
    pathStar(c, x, y, s * 0.5, s * 0.15, 4, 0); c.fill();
    c.globalCompositeOperation = 'source-over';
  }

  // --- the move library --------------------------------------------------------------------------

  const KINDS: Record<FxKind, (a: FxPoint, b: FxPoint, k: Tint) => void> = {
    tackle: (_a, b, k) => {
      const d = 0.1;
      later(d, () => shake(3));
      flash(b.x, b.y, 34, k.light, 0.25, d);
      starburst(b.x, b.y, 22, '#ffffff', k.c, 8, 0.3, d);
      ring(b.x, b.y, 8, 44, k.light, 0.35, 3, d);
      debris(b.x, b.y, k.c, 8, 150, d);
      sparks(b.x, b.y, '#ffffff', 6, 220, d);
    },

    slash: (_a, b, k) => {
      for (let i = 0; i < 3; i++) {
        const ox = (i - 1) * 13;
        add({
          delay: i * 0.07, dur: 0.26, layer: 1,
          draw: (c, u) => {
            const head = Math.min(1, u / 0.4), tail = u < 0.4 ? 0 : (u - 0.4) / 0.6;
            c.globalAlpha = fade(u, 0.7);
            sweep(c, b.x + ox - 22, b.y - 30, b.x + ox + 20, b.y + 28, 8, 4, tail, outQuad(head), rgba(k.c, 0.95), '#ffffff');
          },
        });
      }
      later(0.1, () => { shake(2); sparks(b.x, b.y, '#ffffff', 8, 220); debris(b.x, b.y, k.c, 5, 120); flash(b.x, b.y, 26, k.light, 0.2); });
    },

    bite: (_a, b, k) => {
      add({
        dur: 0.5, layer: 1,
        draw: (c, u) => {
          const close = u < 0.34 ? inQuad(u / 0.34) : 1;
          const gap = 40 - 30 * close;
          const shiver = u > 0.34 && u < 0.5 ? Math.sin(u * 120) * 1.5 : 0;
          c.globalAlpha = fade(u, 0.72);
          jaw(c, b.x + shiver, b.y - gap, 1, k);
          jaw(c, b.x - shiver, b.y + gap, -1, k);
        },
      });
      later(0.17, () => { shake(3); flash(b.x, b.y, 30, k.light, 0.22); debris(b.x, b.y, k.c, 7, 140); sparks(b.x, b.y, '#ffffff', 5, 180); });
    },

    punch: (a, b, k) => {
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const sx = b.x - ux * 74, sy = b.y - uy * 74, ex = b.x - ux * 14, ey = b.y - uy * 14;
      add({
        dur: 0.36, layer: 1,
        draw: (c, u) => {
          const m = Math.min(1, u / 0.36), e = inQuad(m);
          const x = lerp(sx, ex, e), y = lerp(sy, ey, e);
          c.globalAlpha = fade(u, 0.7);
          c.strokeStyle = rgba(k.light, 0.7); c.lineWidth = 2; c.lineCap = 'round';
          c.beginPath();
          for (const off of [-9, 0, 9]) {
            const px = -uy * off, py = ux * off;
            c.moveTo(x - ux * 14 + px, y - uy * 14 + py); c.lineTo(x - ux * (30 + Math.abs(off)) + px, y - uy * (30 + Math.abs(off)) + py);
          }
          c.stroke();
          fist(c, x, y, Math.atan2(uy, ux), 0.75 + 0.45 * e, k);
        },
      });
      later(0.13, () => {
        shake(5);
        starburst(b.x, b.y, 30, '#fff6c0', k.c, 10, 0.34);
        flash(b.x, b.y, 40, k.light, 0.28);
        ring(b.x, b.y, 10, 50, '#ffffff', 0.3, 3);
        debris(b.x, b.y, k.c, 8, 170);
      });
    },

    flame: (a, b, k) => {
      for (let i = 0; i < 3; i++) {
        const last = i === 2;
        projectile(a, b, {
          delay: i * 0.08, dur: 0.34, arc: 10 + i * 8, jitter: 8,
          head: (c, x, y, _ang, _u, age) => fireball(c, x, y, age, k),
          trail: (x, y) => spawn({
            x: x + rng.range(-3, 3), y: y + rng.range(-3, 3), vx: rng.range(-15, 15), vy: rng.range(-55, -20),
            max: rng.range(0.18, 0.32), size: rng.range(3, 5), grow: 0.2, color: '#fff0a0', color2: k.c, glow: true,
          }),
          trailEvery: 0.014,
          hit: (x, y) => {
            for (let n = 0; n < 9; n++) {
              spawn({
                x: x + rng.range(-12, 12), y: y + rng.range(-6, 10), vx: rng.range(-50, 50), vy: rng.range(-140, -60), drag: 1.5,
                max: rng.range(0.3, 0.5), size: rng.range(4, 7), grow: 0.2, color: '#fff0a0', color2: k.c, shape: 'flame', glow: true,
              });
            }
            for (let n = 0; n < 3; n++) spawn({ x, y: y - 6, vx: rng.range(-20, 20), vy: rng.range(-50, -30), max: 0.5, size: 4, grow: 2.2, alpha: 0.45, color: shade(k.dark, 0.6), shape: 'smoke' });
            flash(x, y, 30, k.c, 0.25);
            if (last) { shake(2); ring(x, y, 8, 40, k.light, 0.3, 2); }
          },
        });
      }
    },

    splash: (a, b, k) => {
      const N = 12;
      for (let i = 0; i < N; i++) {
        projectile(a, b, {
          delay: i * 0.022, dur: 0.32, arc: 34, jitter: 9,
          head: (c, x, y, ang) => drop(c, x, y, ang, 3.2, k.light),
          hit: (x, y) => {
            for (let n = 0; n < 2; n++) {
              spawn({ x, y, vx: rng.range(-80, 80), vy: rng.range(-150, -70), ay: 480, max: rng.range(0.3, 0.45), size: 2.4, color: k.light, shape: 'drop' });
            }
          },
        });
      }
      later(N * 0.022 + 0.3, () => {
        shake(2);
        ring(b.x, b.y + 8, 6, 44, k.light, 0.4, 2, 0, 0.4);
        ring(b.x, b.y + 8, 4, 30, '#ffffff', 0.35, 1.5, 0.08, 0.4);
        flash(b.x, b.y, 28, k.light, 0.2);
        for (let n = 0; n < 10; n++) {
          const a2 = -Math.PI / 2 + rng.range(-1, 1);
          spawn({ x: b.x, y: b.y, vx: Math.cos(a2) * rng.range(80, 170), vy: Math.sin(a2) * rng.range(120, 220), ay: 520, max: 0.5, size: 2.6, color: k.light, shape: 'drop' });
        }
      });
    },

    leaf: (a, b, k) => {
      for (let i = 0; i < 6; i++) {
        const spin = rng.range(10, 16) * (i % 2 ? 1 : -1);
        projectile(a, b, {
          delay: i * 0.055, dur: 0.42, arc: rng.range(-10, 30), wobble: rng.range(10, 24) * (i % 2 ? 1 : -1), wobbleFreq: 1.5, jitter: 10,
          head: (c, x, y, _ang, _u, age) => leafShape(c, x, y, age * spin + i, 6, k),
          hit: (x, y) => {
            for (let n = 0; n < 2; n++) spawn({ x, y, vx: rng.range(-90, 90), vy: rng.range(-80, 10), ay: 160, drag: 1.5, max: 0.5, size: 4, color: k.c, shape: 'leaf', rot: rng.range(0, TAU), vr: rng.range(-10, 10) });
            sparks(x, y, k.light, 2, 120);
          },
        });
      }
      later(0.055 * 5 + 0.42, () => { shake(2); flash(b.x, b.y, 26, k.light, 0.2); });
    },

    spark: (a, b, k) => {
      let pts: number[] = [];
      let regen = 0;
      let flick = 1;
      const make = () => {
        const out: number[] = [];
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const n = 10;
        for (let s = 0; s <= n; s++) {
          const u = s / n, off = s === 0 || s === n ? 0 : rng.range(-16, 16) * Math.sin(u * Math.PI);
          out.push(a.x + dx * u + nx * off, a.y + dy * u + ny * off);
        }
        return out;
      };
      add({
        dur: 0.34, layer: 1,
        tick: (dt) => { regen -= dt; if (regen <= 0) { regen = 0.045; pts = make(); flick = rng.chance(0.25) ? 0.45 : 1; } },
        draw: (c, u) => {
          if (pts.length < 4) return;
          const grow = Math.min(1, u / 0.22);
          const count = Math.max(2, Math.round((pts.length / 2) * grow));
          c.globalAlpha = fade(u, 0.6) * flick;
          c.globalCompositeOperation = 'lighter';
          c.lineJoin = 'round'; c.lineCap = 'round';
          for (const [w, col] of [[8, rgba(k.c, 0.4)], [3.5, k.light], [1.5, '#ffffff']] as const) {
            c.strokeStyle = col; c.lineWidth = w;
            c.beginPath();
            for (let s = 0; s < count; s++) { if (s === 0) c.moveTo(pts[0], pts[1]); else c.lineTo(pts[s * 2], pts[s * 2 + 1]); }
            c.stroke();
          }
        },
      });
      later(0.1, () => {
        shake(3);
        flash(b.x, b.y, 40, k.light, 0.3);
        sparks(b.x, b.y, k.light, 10, 260);
        sparks(b.x, b.y, '#ffffff', 6, 200);
        const bolts: number[][] = [];
        for (let i = 0; i < 4; i++) {
          const a0 = rng.range(0, TAU), pl: number[] = [b.x, b.y];
          let x = b.x, y = b.y;
          for (let s = 0; s < 3; s++) { x += Math.cos(a0 + rng.range(-0.8, 0.8)) * 10; y += Math.sin(a0 + rng.range(-0.8, 0.8)) * 10; pl.push(x, y); }
          bolts.push(pl);
        }
        add({
          dur: 0.28, layer: 1,
          draw: (c, u) => {
            c.globalAlpha = (1 - u) * (Math.sin(u * 60) > -0.3 ? 1 : 0.3);
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = k.light; c.lineWidth = 2;
            c.beginPath();
            for (const pl of bolts) { c.moveTo(pl[0], pl[1]); for (let s = 2; s < pl.length; s += 2) c.lineTo(pl[s], pl[s + 1]); }
            c.stroke();
          },
        });
      });
    },

    ice: (a, b, k) => {
      for (let i = 0; i < 5; i++) {
        projectile(a, b, {
          delay: i * 0.05, dur: 0.24, jitter: 12,
          head: (c, x, y, ang) => shard(c, x, y, ang, 9, k),
          trail: (x, y) => spawn({ x, y, vx: rng.range(-10, 10), vy: rng.range(-10, 10), max: 0.25, size: 1.5, color: '#ffffff', glow: true }),
          trailEvery: 0.025,
          hit: (x, y) => { sparks(x, y, '#ffffff', 3, 150); },
        });
      }
      later(0.2 + 0.24, () => {
        shake(2);
        flash(b.x, b.y, 34, k.light, 0.28);
        ring(b.x, b.y, 8, 42, '#ffffff', 0.35, 2);
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * TAU + rng.range(-0.2, 0.2), v = rng.range(110, 190);
          spawn({ x: b.x, y: b.y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, drag: 4, max: 0.45, size: 6, grow: 0.5, color: k.light, shape: 'shard', rot: ang });
        }
        for (let i = 0; i < 8; i++) {
          spawn({ x: b.x + rng.range(-30, 30), y: b.y + rng.range(-30, 10), vx: rng.range(-10, 10), vy: rng.range(10, 35), max: rng.range(0.5, 0.75), size: 2.5, color: '#ffffff', shape: 'star', glow: true, vr: rng.range(-3, 3) });
        }
      });
    },

    goo: (a, b, k) => {
      for (let i = 0; i < 3; i++) {
        const last = i === 2;
        projectile(a, b, {
          delay: i * 0.1, dur: 0.4, arc: 46, jitter: 10,
          head: (c, x, y, ang, _u, age) => blob(c, x, y, ang, age, 6, k),
          trail: (x, y) => spawn({ x, y, vy: rng.range(0, 20), ay: 320, max: 0.32, size: 2, color: k.c }),
          trailEvery: 0.05,
          hit: (x, y) => {
            add({
              dur: 0.45,
              draw: (c, u) => {
                c.globalAlpha = fade(u, 0.5) * 0.9;
                c.fillStyle = k.c;
                c.beginPath(); c.ellipse(x, y, 14 + 4 * outQuad(Math.min(1, u * 3)), 9, 0, 0, TAU); c.fill();
                for (const dx of [-8, 2, 9]) { c.fillRect(x + dx - 1.5, y, 3, 6 + u * 14 + dx * 0.4); c.beginPath(); c.arc(x + dx, y + 6 + u * 14 + dx * 0.4, 2, 0, TAU); c.fill(); }
                c.fillStyle = rgba(k.light, 0.8); c.beginPath(); c.arc(x - 4, y - 3, 3, 0, TAU); c.fill();
              },
            });
            for (let n = 0; n < 6; n++) spawn({ x, y, vx: rng.range(-110, 110), vy: rng.range(-140, -30), ay: 460, max: 0.5, size: rng.range(2.5, 4.5), color: k.c });
            if (last) shake(2);
          },
        });
      }
    },

    shadow: (a, b, k) => {
      const core = mix(k.dark, INK, 0.6);
      projectile(a, b, {
        delay: 0.05, dur: 0.42, arc: 10,
        head: (c, x, y, _ang, _u, age) => {
          const g = c.createRadialGradient(x, y, 2, x, y, 18);
          g.addColorStop(0, rgba(k.c, 0.6)); g.addColorStop(1, rgba(k.c, 0));
          c.fillStyle = g; c.beginPath(); c.arc(x, y, 18, 0, TAU); c.fill();
          c.fillStyle = core; c.beginPath(); c.arc(x, y, 9, 0, TAU); c.fill();
          c.strokeStyle = k.light; c.lineWidth = 1.5;
          for (let s = 0; s < 2; s++) { const r0 = age * 12 + s * Math.PI; c.beginPath(); c.arc(x, y, 11 + s * 2, r0, r0 + 1.6); c.stroke(); }
          c.fillStyle = rgba(k.light, 0.9); c.beginPath(); c.arc(x - 3, y - 3, 2, 0, TAU); c.fill();
        },
        trail: (x, y) => spawn({ x: x + rng.range(-4, 4), y: y + rng.range(-4, 4), vx: rng.range(-15, 15), vy: rng.range(-15, 15), max: 0.4, size: 5, grow: 2, alpha: 0.5, color: core, shape: 'smoke' }),
        trailEvery: 0.02,
        hit: (x, y) => {
          shake(3);
          add({
            dur: 0.35,
            draw: (c, u) => {
              c.globalAlpha = 0.55 * (1 - u);
              const g = c.createRadialGradient(x, y, 0, x, y, 30 + 20 * u);
              g.addColorStop(0, rgba(core, 1)); g.addColorStop(1, rgba(core, 0));
              c.fillStyle = g; c.beginPath(); c.arc(x, y, 30 + 20 * u, 0, TAU); c.fill();
            },
          });
          ring(x, y, 6, 50, core, 0.4, 5);
          ring(x, y, 6, 40, k.c, 0.35, 3, 0.05);
          const angs = Array.from({ length: 7 }, (_v, i) => (i / 7) * TAU + rng.range(-0.3, 0.3));
          add({
            dur: 0.4, layer: 1,
            draw: (c, u) => {
              const len = 34 * outQuad(Math.min(1, u * 2));
              c.globalAlpha = fade(u, 0.5);
              c.lineCap = 'round';
              for (const [w, col] of [[4, core], [1.5, k.light]] as const) {
                c.strokeStyle = col; c.lineWidth = w;
                c.beginPath();
                for (const an of angs) {
                  c.moveTo(x + Math.cos(an) * 8, y + Math.sin(an) * 8);
                  c.quadraticCurveTo(x + Math.cos(an + 0.5) * len * 0.6, y + Math.sin(an + 0.5) * len * 0.6, x + Math.cos(an) * len, y + Math.sin(an) * len);
                }
                c.stroke();
              }
            },
          });
          sparks(x, y, k.light, 8, 200);
        },
      });
    },

    sparkle: (a, b, k) => {
      for (let i = 0; i < 10; i++) {
        const sz = rng.range(3.5, 5.5);
        projectile(a, b, {
          delay: i * 0.03, dur: 0.36, wobble: rng.range(-16, 16), wobbleFreq: 2, jitter: 10,
          head: (c, x, y, _ang, _u, age) => twinkle(c, x, y, sz + Math.sin(age * 30) * 1.5, i % 2 ? k.light : '#ffffff'),
          trail: (x, y) => spawn({ x, y, max: 0.3, size: 1.5, color: k.light, glow: true, vy: rng.range(-10, 10), vx: rng.range(-10, 10) }),
          trailEvery: 0.03,
        });
      }
      later(0.27 + 0.36, () => {
        flash(b.x, b.y, 38, k.light, 0.3);
        ring(b.x, b.y, 8, 40, '#ffffff', 0.3, 1.5);
        stars(b.x, b.y, k.light, 7, 150);
        stars(b.x, b.y, '#ffffff', 5, 120);
        shake(1);
      });
    },

    food: (a, b, k) => {
      projectile(a, b, {
        dur: 0.46, arc: 64,
        head: (c, x, y, _ang, _u, age) => pie(c, x, y, age * 9, k),
        hit: (x, y) => {
          shake(2);
          starburst(x, y, 20, '#fff8ec', k.c, 9, 0.3);
          for (let n = 0; n < 10; n++) spawn({ x, y, vx: rng.range(-130, 130), vy: rng.range(-170, -40), ay: 480, max: 0.5, size: rng.range(2.5, 4), color: '#fff4e0' });
          for (let n = 0; n < 8; n++) spawn({ x, y, vx: rng.range(-120, 120), vy: rng.range(-150, -30), ay: 480, max: 0.5, size: 2.2, color: '#d89a50', shape: 'square', vr: rng.range(-10, 10) });
          for (let n = 0; n < 3; n++) spawn({ x, y, vx: rng.range(-80, 80), vy: rng.range(-130, -60), ay: 420, max: 0.5, size: 2.6, color: k.c });
          for (let n = 0; n < 2; n++) spawn({ x: x + rng.range(-10, 10), y: y - 10, vy: rng.range(-60, -40), max: 0.6, size: 4, color: k.light, shape: 'heart', delay: 0.05 * n });
        },
      });
    },

    metal: (a, b, k) => {
      const steel = mix('#c8ccd8', k.c, 0.3);
      for (let i = 0; i < 3; i++) {
        const last = i === 2;
        const spin = (i % 2 ? 1 : -1) * 18;
        projectile(a, b, {
          delay: i * 0.07, dur: 0.3, jitter: 10, arc: 6,
          head: (c, x, y, _ang, _u, age) => {
            c.save(); c.translate(x, y); c.rotate(age * spin);
            gearPath(c, 7.5, 8); c.fillStyle = steel; c.fill(); c.strokeStyle = INK; c.lineWidth = 1.2; c.stroke();
            c.beginPath(); c.arc(0, 0, 2.4, 0, TAU); c.fillStyle = shade(steel, 0.5); c.fill();
            c.restore();
          },
          hit: (x, y) => {
            sparks(x, y, '#ffffff', 6, 300);
            sparks(x, y, k.light, 4, 220);
            ring(x, y, 4, 26, '#ffffff', 0.25, 1.5);
            flash(x, y, 20, k.light, 0.18);
            shake(last ? 3 : 1.5);
          },
        });
      }
    },

    psy: (a, b, k) => {
      for (let i = 0; i < 6; i++) {
        add({
          delay: i * 0.05, dur: 0.3,
          draw: (c, u) => {
            const e = inOutQuad(u);
            const x = lerp(a.x, b.x, e), y = lerp(a.y, b.y, e);
            const r = 6 + 16 * e;
            c.globalCompositeOperation = 'lighter';
            c.globalAlpha = 0.9 * (1 - u * 0.5);
            c.strokeStyle = i % 2 ? k.c : k.light; c.lineWidth = 2.5;
            c.beginPath(); c.ellipse(x, y, r, r * 0.8, 0, 0, TAU); c.stroke();
          },
        });
      }
      later(0.5, () => {
        shake(1.5);
        flash(b.x, b.y, 32, k.light, 0.25);
        for (let j = 0; j < 3; j++) {
          add({
            delay: j * 0.06, dur: 0.3,
            draw: (c, u, age) => {
              const r = 10 + 32 * outQuad(u);
              c.globalAlpha = 1 - u;
              c.strokeStyle = j % 2 ? k.light : k.c; c.lineWidth = 2;
              c.beginPath();
              for (let s = 0; s <= 40; s++) {
                const th = (s / 40) * TAU;
                const rr = r * (1 + 0.12 * Math.sin(th * 6 + age * 20));
                if (s === 0) c.moveTo(b.x + Math.cos(th) * rr, b.y + Math.sin(th) * rr * 0.85); else c.lineTo(b.x + Math.cos(th) * rr, b.y + Math.sin(th) * rr * 0.85);
              }
              c.stroke();
            },
          });
        }
        stars(b.x, b.y, k.light, 6, 90, 0, 10);
      });
    },

    rock: (_a, b, k) => {
      const fill = mix('#9a8a7a', k.c, 0.35);
      for (let i = 0; i < 4; i++) {
        const ox = rng.range(-26, 26);
        const r = 8 + (i % 2) * 3;
        const pts: number[] = [];
        for (let s = 0; s < 7; s++) { const an = (s / 7) * TAU; const rr = r * rng.range(0.72, 1); pts.push(Math.cos(an) * rr, Math.sin(an) * rr); }
        const spin = rng.range(-6, 6);
        projectile({ x: b.x + ox * 1.3, y: b.y - 150 - i * 10 }, { x: b.x + ox * 0.6, y: b.y + rng.range(-6, 12) }, {
          delay: i * 0.08, dur: 0.26, easing: inQuad,
          head: (c, x, y, _ang, _u, age) => rockShape(c, x, y, age * spin, pts, fill),
          hit: (x, y) => {
            shake(3);
            for (let n = 0; n < 4; n++) spawn({ x, y: y + 4, vx: rng.range(-60, 60), vy: rng.range(-50, -15), drag: 2, max: 0.45, size: 5, grow: 2.2, alpha: 0.6, color: mix(fill, '#e8dcc8', 0.4), shape: 'smoke' });
            debris(x, y, fill, 4, 130);
            flash(x, y, 18, k.light, 0.15);
          },
        });
      }
    },

    wind: (a, b, k) => {
      for (let i = 0; i < 4; i++) {
        projectile(a, b, {
          delay: i * 0.06, dur: 0.32, wobble: (i % 2 ? 1 : -1) * 14, wobbleFreq: 1, jitter: 12,
          head: (c, x, y, ang) => {
            c.save(); c.translate(x, y); c.rotate(ang);
            c.lineCap = 'round';
            c.strokeStyle = rgba(k.light, 0.9); c.lineWidth = 2.5;
            c.beginPath(); c.arc(-4, 0, 10, -1.1, 1.1); c.stroke();
            c.strokeStyle = rgba(k.light, 0.5); c.lineWidth = 1.5;
            c.beginPath(); c.moveTo(-8, -5); c.lineTo(-26, -5); c.moveTo(-10, 4); c.lineTo(-22, 4); c.stroke();
            c.restore();
          },
        });
      }
      later(0.48, () => {
        shake(1.5);
        add({
          dur: 0.34, layer: 1,
          draw: (c, u, age) => {
            c.globalAlpha = fade(u, 0.55);
            c.strokeStyle = k.light; c.lineCap = 'round';
            for (let j = 0; j < 3; j++) {
              const r = 10 + j * 9 + u * 10;
              const a0 = age * 14 + j * 2.1;
              c.lineWidth = 2.5 - j * 0.5;
              c.beginPath(); c.ellipse(b.x, b.y - j * 4, r, r * 0.45, 0, a0, a0 + 2.4); c.stroke();
            }
          },
        });
        for (let n = 0; n < 8; n++) {
          const an = rng.range(0, TAU);
          spawn({ x: b.x + Math.cos(an) * 12, y: b.y + Math.sin(an) * 6, vx: -Math.sin(an) * 140, vy: Math.cos(an) * 40 - 30, drag: 2, max: 0.4, size: 2, color: k.light, shape: n % 3 ? 'dot' : 'leaf', vr: 12 });
        }
      });
    },

    beam: (a, b, k) => {
      add({
        dur: 0.2,
        draw: (c, u) => {
          const r = 3 + 8 * u;
          c.globalCompositeOperation = 'lighter';
          const g = c.createRadialGradient(a.x, a.y, 0, a.x, a.y, r * 2.2);
          g.addColorStop(0, rgba('#ffffff', 0.9)); g.addColorStop(0.4, rgba(k.c, 0.6)); g.addColorStop(1, rgba(k.c, 0));
          c.fillStyle = g; c.beginPath(); c.arc(a.x, a.y, r * 2.2, 0, TAU); c.fill();
        },
      });
      for (let i = 0; i < 10; i++) {
        const an = rng.range(0, TAU), d = rng.range(24, 36);
        spawn({ x: a.x + Math.cos(an) * d, y: a.y + Math.sin(an) * d, vx: -Math.cos(an) * d / 0.18, vy: -Math.sin(an) * d / 0.18, max: 0.18, size: 2, color: k.light, glow: true });
      }
      let acc = 0;
      add({
        delay: 0.16, dur: 0.4, layer: 1,
        tick: (dt, u) => {
          acc += dt;
          if (u > 0.12 && acc > 0.04) { acc = 0; sparks(b.x, b.y, k.light, 2, 200); }
        },
        draw: (c, u, age) => {
          const w = 14 * (u < 0.15 ? outQuad(u / 0.15) : 1 - inQuad((u - 0.15) / 0.85));
          const ext = Math.min(1, u / 0.12);
          const ex = lerp(a.x, b.x, ext), ey = lerp(a.y, b.y, ext);
          c.globalCompositeOperation = 'lighter';
          c.lineCap = 'round';
          for (const [lw, col] of [[w * 2, rgba(k.c, 0.35)], [w, rgba(k.light, 0.85)], [w * 0.35, '#ffffff']] as const) {
            if (lw <= 0.2) continue;
            c.strokeStyle = col; c.lineWidth = lw;
            c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(ex, ey); c.stroke();
          }
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          c.strokeStyle = rgba('#ffffff', 0.6); c.lineWidth = 1.5;
          for (let j = 0; j < 4; j++) {
            const s = (age * 3 + j / 4) % 1;
            if (s > ext) continue;
            c.beginPath(); c.ellipse(a.x + dx * s, a.y + dy * s, 2.5, w * 0.9 + 2, Math.atan2(dy, dx), 0, TAU); c.stroke();
          }
          void len;
          const g = c.createRadialGradient(ex, ey, 0, ex, ey, w * 2 + 6);
          g.addColorStop(0, rgba('#ffffff', 0.9)); g.addColorStop(1, rgba(k.c, 0));
          c.fillStyle = g; c.beginPath(); c.arc(ex, ey, w * 2 + 6, 0, TAU); c.fill();
        },
      });
      later(0.22, () => { shake(4); flash(b.x, b.y, 44, k.light, 0.35); starburst(b.x, b.y, 18, '#ffffff', k.c, 8, 0.3); });
    },

    quake: (_a, b, k) => {
      const gy = b.y + 28;
      add({ dur: 0.62, tick: (_dt, u) => shake(6 * (1 - u) + 1) });
      const cracks: number[][] = [];
      for (const base of [0.1, -0.15, Math.PI - 0.1, Math.PI + 0.2, 0.9, Math.PI - 0.9]) {
        const pl: number[] = [b.x, gy];
        let x = b.x, y = gy;
        const segs = 5;
        for (let s = 0; s < segs; s++) {
          const an = base + rng.range(-0.5, 0.5);
          x += Math.cos(an) * rng.range(8, 13); y += Math.sin(an) * rng.range(8, 13) * 0.35;
          pl.push(x, y);
        }
        cracks.push(pl);
      }
      add({
        dur: 0.66,
        draw: (c, u) => {
          const grow = outQuad(Math.min(1, u / 0.3));
          c.globalAlpha = fade(u, 0.55);
          c.lineCap = 'round'; c.lineJoin = 'round';
          for (const [w, col] of [[3, INK], [1, k.light]] as const) {
            c.strokeStyle = col; c.lineWidth = w;
            c.beginPath();
            for (const pl of cracks) {
              const n = Math.max(2, Math.round((pl.length / 2) * grow));
              c.moveTo(pl[0], pl[1]);
              for (let s = 1; s < n; s++) c.lineTo(pl[s * 2], pl[s * 2 + 1]);
            }
            c.stroke();
          }
        },
      });
      ring(b.x, gy, 10, 76, k.light, 0.45, 3, 0, 0.3);
      ring(b.x, gy, 8, 56, '#ffffff', 0.4, 2, 0.12, 0.3);
      const dust = mix(k.c, '#c8b090', 0.5);
      for (let i = 0; i < 10; i++) {
        const dir = i % 2 ? 1 : -1;
        spawn({ x: b.x + rng.range(-30, 30), y: gy + rng.range(-4, 4), vx: dir * rng.range(40, 120), vy: rng.range(-40, -8), drag: 2, delay: i * 0.03, max: 0.55, size: 6, grow: 2.4, alpha: 0.7, color: dust, shape: 'smoke' });
      }
      for (let i = 0; i < 7; i++) {
        spawn({ x: b.x + rng.range(-24, 24), y: gy, vx: rng.range(-60, 60), vy: rng.range(-260, -150), ay: 760, delay: rng.range(0, 0.2), max: 0.55, size: rng.range(3, 5), color: mix('#8a7a6a', k.c, 0.3), shape: 'square', vr: rng.range(-10, 10) });
      }
    },

    buff: (a, _b, k) => {
      add({
        dur: 0.7,
        draw: (c, u) => {
          const al = Math.sin(Math.PI * u);
          c.globalCompositeOperation = 'lighter';
          c.fillStyle = (() => {
            const g = c.createLinearGradient(0, a.y - 54, 0, a.y + 40);
            g.addColorStop(0, rgba(k.c, 0)); g.addColorStop(1, rgba(k.c, 0.32 * al));
            return g;
          })();
          c.beginPath(); c.ellipse(a.x, a.y - 6, 34, 48, 0, 0, TAU); c.fill();
        },
      });
      ring(a.x, a.y + 34, 10, 40, k.light, 0.5, 2, 0, 0.3);
      for (let i = 0; i < 6; i++) {
        spawn({ x: a.x + rng.range(-28, 28), y: a.y + rng.range(10, 34), vy: rng.range(-110, -80), delay: i * 0.07, max: 0.5, size: 7, color: k.light, shape: 'arrowUp' });
      }
      for (let i = 0; i < 6; i++) {
        spawn({ x: a.x + rng.range(-30, 30), y: a.y + rng.range(-20, 30), vy: rng.range(-60, -30), delay: rng.range(0, 0.3), max: 0.4, size: 2.5, color: '#ffffff', shape: 'star', glow: true });
      }
    },

    debuff: (a, _b, k) => {
      const gloom = mix(k.c, '#3a4a8a', 0.35);
      add({
        dur: 0.7,
        draw: (c, u) => {
          const al = Math.sin(Math.PI * u);
          const g = c.createRadialGradient(a.x, a.y, 4, a.x, a.y, 50);
          g.addColorStop(0, rgba(k.dark, 0.3 * al)); g.addColorStop(1, rgba(k.dark, 0));
          c.fillStyle = g; c.beginPath(); c.arc(a.x, a.y, 50, 0, TAU); c.fill();
          const r = lerp(46, 12, inOutQuad(u));
          c.globalAlpha = al; c.strokeStyle = gloom; c.lineWidth = 2.5;
          c.beginPath(); c.ellipse(a.x, a.y + 34, r, r * 0.3, 0, 0, TAU); c.stroke();
        },
      });
      for (let i = 0; i < 6; i++) {
        spawn({ x: a.x + rng.range(-28, 28), y: a.y - 40 + rng.range(-8, 8), vy: rng.range(80, 110), delay: i * 0.07, max: 0.5, size: 7, color: gloom, shape: 'arrowDown' });
      }
    },

    heal: (a, _b, k) => {
      add({
        dur: 0.7,
        draw: (c, u) => {
          const al = Math.sin(Math.PI * u);
          c.globalCompositeOperation = 'lighter';
          const r = 40 + 8 * Math.sin(u * 12);
          const g = c.createRadialGradient(a.x, a.y, 0, a.x, a.y, r);
          g.addColorStop(0, rgba(k.light, 0.35 * al)); g.addColorStop(1, rgba(k.light, 0));
          c.fillStyle = g; c.beginPath(); c.arc(a.x, a.y, r, 0, TAU); c.fill();
        },
      });
      for (let i = 0; i < 9; i++) {
        spawn({ x: a.x + rng.range(-30, 30), y: a.y + rng.range(0, 30), vx: rng.range(-10, 10), vy: rng.range(-90, -55), delay: i * 0.05, max: 0.5, size: 4.5, color: k.light, shape: 'plus' });
      }
      stars(a.x, a.y, '#ffffff', 5, 40, 0.15, 24);
    },

    shield: (a, _b, k) => {
      const hexes = Array.from({ length: 7 }, () => ({ an: rng.range(0, TAU), r: rng.range(0.3, 0.8) }));
      add({
        dur: 0.78, layer: 1,
        draw: (c, u, age) => {
          const R = 46 * (u < 0.3 ? outBack(u / 0.3) : 1);
          if (R <= 1) return;
          const al = fade(u, 0.7);
          c.globalAlpha = al;
          c.fillStyle = rgba(k.c, 0.18); c.beginPath(); c.arc(a.x, a.y, R, 0, TAU); c.fill();
          c.strokeStyle = rgba(k.light, 0.9); c.lineWidth = 2; c.stroke();
          c.strokeStyle = rgba('#ffffff', 0.35); c.lineWidth = 1;
          c.beginPath(); c.arc(a.x, a.y, R - 4, 0, TAU); c.stroke();
          c.strokeStyle = rgba('#ffffff', 0.75); c.lineWidth = 3; c.lineCap = 'round';
          c.beginPath(); c.arc(a.x, a.y, R * 0.75, 3.5, 4.3); c.stroke();
          c.strokeStyle = rgba(k.light, 0.5); c.lineWidth = 1;
          for (const h of hexes) {
            const an = h.an + age * 0.8, hx = a.x + Math.cos(an) * R * h.r, hy = a.y + Math.sin(an) * R * h.r;
            c.beginPath();
            for (let s = 0; s < 6; s++) { const ha = (s / 6) * TAU; c.lineTo(hx + Math.cos(ha) * 5, hy + Math.sin(ha) * 5); }
            c.closePath(); c.stroke();
          }
          c.save();
          c.beginPath(); c.arc(a.x, a.y, R, 0, TAU); c.clip();
          const sx = a.x - R + (u * 2.2 % 1) * R * 2.4;
          c.fillStyle = rgba('#ffffff', 0.25);
          c.beginPath(); c.moveTo(sx, a.y - R); c.lineTo(sx + 8, a.y - R); c.lineTo(sx - 12, a.y + R); c.lineTo(sx - 20, a.y + R); c.closePath(); c.fill();
          c.restore();
        },
      });
      later(0.15, () => {
        for (let i = 0; i < 8; i++) {
          const an = (i / 8) * TAU;
          spawn({ x: a.x + Math.cos(an) * 46, y: a.y + Math.sin(an) * 46, vx: Math.cos(an) * 30, vy: Math.sin(an) * 30, max: 0.35, size: 3, color: k.light, shape: 'star', glow: true });
        }
      });
    },

    sound: (a, b, k) => {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      for (let i = 0; i < 6; i++) {
        add({
          delay: i * 0.07, dur: 0.38,
          draw: (c, u) => {
            const e = outQuad(u);
            const x = lerp(a.x, b.x, e * 0.92), y = lerp(a.y, b.y, e * 0.92);
            const r = 8 + 14 * e;
            c.globalAlpha = 1 - u * 0.7;
            c.strokeStyle = i % 2 ? k.c : k.light; c.lineWidth = 3; c.lineCap = 'round';
            c.beginPath(); c.arc(x - Math.cos(ang) * r, y - Math.sin(ang) * r, r, ang - 0.9, ang + 0.9); c.stroke();
          },
        });
      }
      for (let i = 0; i < 3; i++) {
        spawn({
          x: a.x + rng.range(-8, 8), y: a.y + rng.range(-10, 10),
          vx: Math.cos(ang) * rng.range(180, 240) + rng.range(-20, 20), vy: Math.sin(ang) * rng.range(180, 240) - 30,
          delay: i * 0.1, max: 0.55, size: 6, color: k.light, shape: 'note', vr: rng.range(-2, 2),
        });
      }
      later(0.46, () => {
        shake(1.5);
        ring(b.x, b.y, 8, 36, k.light, 0.3, 2);
        ring(b.x, b.y, 6, 28, '#ffffff', 0.3, 1.5, 0.08);
      });
    },
  };

  // --- drawing particles -----------------------------------------------------------------------

  function drawParticle(c: Ctx, q: Particle): void {
    const k = q.life / q.max;
    const a = q.alpha * (k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4));
    if (a <= 0.01) return;
    const s = Math.max(0.2, q.size * (1 + (q.grow - 1) * k));
    const col = q.color2 ? mix(q.color, q.color2, Math.min(1, k * 1.4)) : q.color;
    c.globalAlpha = a;
    c.globalCompositeOperation = q.glow ? 'lighter' : 'source-over';
    c.fillStyle = col; c.strokeStyle = col;
    switch (q.shape) {
      case 'dot':
        c.beginPath(); c.arc(q.x, q.y, s, 0, TAU); c.fill();
        break;
      case 'smoke':
        c.globalAlpha = a * 0.7;
        c.beginPath(); c.arc(q.x, q.y, s, 0, TAU); c.fill();
        c.globalAlpha = a * 0.35;
        c.beginPath(); c.arc(q.x - s * 0.3, q.y - s * 0.3, s * 0.6, 0, TAU); c.fillStyle = mix(col, '#ffffff', 0.3); c.fill();
        break;
      case 'spark': {
        const sp = Math.hypot(q.vx, q.vy) || 1;
        const len = s * 2 + sp * 0.035;
        c.lineWidth = s; c.lineCap = 'round';
        c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x - (q.vx / sp) * len, q.y - (q.vy / sp) * len); c.stroke();
        break;
      }
      case 'square':
        c.save(); c.translate(q.x, q.y); c.rotate(q.rot);
        c.fillRect(-s / 2, -s / 2, s, s);
        c.restore();
        break;
      case 'leaf':
        c.save(); c.translate(q.x, q.y); c.rotate(q.rot);
        c.beginPath(); c.moveTo(-s, 0); c.quadraticCurveTo(0, -s * 0.75, s, 0); c.quadraticCurveTo(0, s * 0.75, -s, 0); c.fill();
        c.strokeStyle = mix(col, '#ffffff', 0.45); c.lineWidth = 0.8;
        c.beginPath(); c.moveTo(-s * 0.7, 0); c.lineTo(s * 0.7, 0); c.stroke();
        c.restore();
        break;
      case 'drop':
        c.save(); c.translate(q.x, q.y); c.rotate(Math.atan2(q.vy, q.vx));
        c.beginPath(); c.moveTo(s * 1.8, 0); c.quadraticCurveTo(0, -s, -s, 0); c.quadraticCurveTo(0, s, s * 1.8, 0); c.fill();
        c.restore();
        break;
      case 'star':
        pathStar(c, q.x, q.y, s, s * 0.32, 4, q.rot); c.fill();
        break;
      case 'plus': {
        const w = s * 0.42;
        c.globalCompositeOperation = 'source-over';
        c.fillStyle = INK;
        c.fillRect(q.x - s - 1, q.y - w / 2 - 1, s * 2 + 2, w + 2); c.fillRect(q.x - w / 2 - 1, q.y - s - 1, w + 2, s * 2 + 2);
        c.fillStyle = col;
        c.fillRect(q.x - s, q.y - w / 2, s * 2, w); c.fillRect(q.x - w / 2, q.y - s, w, s * 2);
        c.fillStyle = rgba('#ffffff', 0.7);
        c.fillRect(q.x - s + 1, q.y - w / 2, s - 1, 1);
        break;
      }
      case 'shard':
        c.save(); c.translate(q.x, q.y); c.rotate(q.rot);
        polyPath(c, [s * 1.3, 0, 0, -s * 0.35, -s * 0.8, 0, 0, s * 0.35]); c.fill();
        polyPath(c, [s * 1.3, 0, 0, -s * 0.35, 0, 0]); c.fillStyle = rgba('#ffffff', 0.8); c.fill();
        c.restore();
        break;
      case 'bubble':
        c.lineWidth = 1;
        c.beginPath(); c.arc(q.x, q.y, s, 0, TAU); c.stroke();
        c.fillStyle = rgba('#ffffff', 0.8); c.fillRect(q.x - s * 0.5, q.y - s * 0.5, 1, 1);
        break;
      case 'heart':
        c.save(); c.translate(q.x, q.y);
        heartPath(c, s); c.fill(); c.strokeStyle = INK; c.lineWidth = 1; c.stroke();
        c.restore();
        break;
      case 'note':
        c.save(); c.translate(q.x, q.y); c.rotate(q.rot * 0.2);
        c.beginPath(); c.ellipse(0, s * 0.55, s * 0.5, s * 0.36, -0.4, 0, TAU); c.fill();
        c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(s * 0.42, s * 0.45); c.lineTo(s * 0.42, -s * 0.9); c.quadraticCurveTo(s * 1.1, -s * 0.6, s * 0.9, -s * 0.1); c.stroke();
        c.restore();
        break;
      case 'arrowUp':
      case 'arrowDown': {
        c.save(); c.translate(q.x, q.y);
        const pts = arrowPts(s, q.shape === 'arrowUp');
        polyPath(c, pts);
        c.strokeStyle = INK; c.lineWidth = 2.5; c.lineJoin = 'round'; c.stroke();
        c.fillStyle = col; c.fill();
        c.fillStyle = rgba('#ffffff', 0.55);
        c.fillRect(-s * 0.32 + 1, q.shape === 'arrowUp' ? 0 : -s + 1, 2, s - 2);
        c.restore();
        break;
      }
      case 'flame':
        c.save(); c.translate(q.x, q.y);
        c.beginPath(); c.moveTo(0, -s * 1.6); c.quadraticCurveTo(s, -s * 0.2, 0, s); c.quadraticCurveTo(-s, -s * 0.2, 0, -s * 1.6); c.fill();
        c.restore();
        break;
      default:
        break;
    }
  }

  function drawFloater(c: Ctx, f: Floater): void {
    const u = f.age / f.dur;
    const pop = u < 0.12 ? 0.4 + 0.95 * outQuad(u / 0.12) : u < 0.24 ? 1.35 - 0.35 * ((u - 0.12) / 0.12) : 1;
    const y = f.y - 26 * outQuad(Math.min(1, u / 0.6));
    c.globalAlpha = fade(u, 0.7);
    c.globalCompositeOperation = 'source-over';
    c.translate(Math.round(f.x), Math.round(y));
    c.scale(pop, pop);
    drawTextOutlined(c, f.text, 0, -7, { size: 2, color: f.color, outline: INK, thickness: 1, align: 'center', shadowOffset: 2 });
  }

  // --- the public object -----------------------------------------------------------------------

  const fx: Fx = {
    move(kind, from, to, type) {
      const play = KINDS[kind];
      if (!play) return;
      play({ x: from.x, y: from.y }, { x: to.x, y: to.y }, tintOf(type));
    },

    burst(x, y, color, n = 12) {
      const col = HEX.test(color) ? color : '#ffffff';
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, TAU), v = rng.range(60, 170);
        spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3.5, max: rng.range(0.3, 0.55), size: rng.range(1.8, 3.4), grow: 0.4, color: col, glow: i % 3 === 0 });
      }
      flash(x, y, 22, col, 0.2);
    },

    floatText(x, y, text, color) {
      let yy = y;
      for (const f of floaters) if (f.age < 0.25 && Math.abs(f.x - x) < 30 && Math.abs(f.y - yy) < 14) yy = f.y - 16;
      floaters.push({ x, y: yy, text, color: HEX.test(color) ? color : '#ffffff', age: 0, dur: 0.85 });
    },

    shake,

    update(dt) {
      const d = Math.max(0, Math.min(0.1, dt));
      if (incoming.length) { tasks.push(...incoming); incoming = []; }
      for (const tk of tasks) {
        tk.age += d;
        if (tk.age < tk.delay) continue;
        const local = tk.age - tk.delay;
        if (!tk.started) { tk.started = true; if (tk.start) tk.start(); }
        tk.u = tk.dur > 0 ? Math.min(1, local / tk.dur) : 1;
        if (tk.tick) tk.tick(d, tk.u, local);
        if (local >= tk.dur) { tk.done = true; if (tk.end) tk.end(); }
      }
      tasks = tasks.filter((tk) => !tk.done);
      for (const q of parts) {
        if (q.delay > 0) { q.delay -= d; continue; }
        q.vx += q.ax * d; q.vy += q.ay * d;
        if (q.drag) { const f = Math.exp(-q.drag * d); q.vx *= f; q.vy *= f; }
        q.x += q.vx * d; q.y += q.vy * d;
        q.rot += q.vr * d;
        q.life += d;
      }
      parts = parts.filter((q) => q.life < q.max);
      for (const f of floaters) f.age += d;
      floaters = floaters.filter((f) => f.age < f.dur);
      if (shakeAmt > 0) {
        offX = Math.round(rng.range(-1, 1) * shakeAmt);
        offY = Math.round(rng.range(-1, 1) * shakeAmt * 0.6);
        shakeAmt *= Math.exp(-d * 9);
        if (shakeAmt < 0.3) { shakeAmt = 0; offX = 0; offY = 0; }
      }
    },

    draw(ctx) {
      for (const layerNo of [0, 1] as const) {
        for (const tk of tasks) {
          if (!tk.started || tk.done || !tk.draw || tk.layer !== layerNo) continue;
          ctx.save();
          tk.draw(ctx, tk.u, tk.age - tk.delay);
          ctx.restore();
        }
        if (layerNo === 0) {
          ctx.save();
          for (const q of parts) if (q.delay <= 0) drawParticle(ctx, q);
          ctx.restore();
        }
      }
      for (const f of floaters) { ctx.save(); drawFloater(ctx, f); ctx.restore(); }
    },

    get busy() { return tasks.length > 0 || incoming.length > 0 || parts.length > 0 || floaters.length > 0 || shakeAmt > 0; },
    get offsetX() { return offX; },
    get offsetY() { return offY; },
  };
  return fx;
}
