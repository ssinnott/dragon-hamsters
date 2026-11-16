// Scenery: the battle backdrops for the five mission locations, the platforms combatants stand
// on, the Burrow habitat with its five activity stations, the title screen and the blueprint maps
// for the mission path screen. Everything is procedural and drawn into the 640x360 view.
//
// Palette: each location's LocationDef colours (sky / far / mid / floor / accent) are the base of
// its scene; fixed materials (marble, bone, moonlight, balloons...) are mixed toward them so the
// scene still reads with any palette. `t` (seconds) only drives gentle ambient animation.
//
// Cost: the static parts of every scene are rendered once into an offscreen layer (keyed by the
// palette, so new colours just make a new layer) and blitted each frame; only the animated bits
// are drawn live. The battle scene keeps two calm stages clear: the player around (160, 236) and
// the enemy around (470, 150); everything below y = 250 sits under the battle panel and stays plain.
import type { ActivityId, LocationDef } from '../data/schema.ts';
import { ACTIVITIES } from '../data/index.ts';
import { mix, rgba, shade } from '../lib/art/palettes.ts';
import { capsule, circle, ellipse, line, pathRrect, pathStar, poly, rrect } from '../lib/art/shapes.ts';
import { drawText } from '../lib/engine/text.ts';

type Ctx = CanvasRenderingContext2D;

const W = 640;
const H = 360;
const TAU = Math.PI * 2;
const INK = '#1b1426';

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

interface Pal { sky: string; far: string; mid: string; floor: string; accent: string }

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
function hexOr(c: string | undefined, fallback: string): string { return c && HEX.test(c) ? c : fallback; }

function pal(loc: LocationDef): Pal {
  return {
    sky: hexOr(loc.sky, '#203050'), far: hexOr(loc.far, '#304060'), mid: hexOr(loc.mid, '#405070'),
    floor: hexOr(loc.floor, '#605040'), accent: hexOr(loc.accent, '#f0d040'),
  };
}
function palKey(p: Pal): string { return p.sky + p.far + p.mid + p.floor + p.accent; }

/** Stable pseudo-random in [0, 1) for decor index `i` (same answer every frame). */
function rnd(i: number, salt = 0): number {
  let x = (Math.imul(i | 0, 374761393) + Math.imul(salt | 0, 668265263) + 0x5bd1e995) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  x = Math.imul(x, 0x45d9f3b);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

/** Vertical gradient from y0 to y1 with explicit [offset, colour] stops. */
function vg(c: Ctx, y0: number, y1: number, ...stops: [number, string][]): CanvasGradient {
  const g = c.createLinearGradient(0, y0, 0, y1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}
function hgrad(c: Ctx, x0: number, x1: number, ...stops: [number, string][]): CanvasGradient {
  const g = c.createLinearGradient(x0, 0, x1, 0);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}

/** Soft round light: radial fade from `a` alpha at the centre to nothing at radius r. */
function glow(c: Ctx, x: number, y: number, r: number, color: string, a: number, additive = false): void {
  if (r <= 0 || a <= 0) return;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.45, rgba(color, a * 0.45));
  g.addColorStop(1, rgba(color, 0));
  const prev = c.globalCompositeOperation;
  if (additive) c.globalCompositeOperation = 'lighter';
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  c.globalCompositeOperation = prev;
}

function rect(c: Ctx, x: number, y: number, w: number, h: number, fill: string): void {
  c.fillStyle = fill; c.fillRect(x, y, w, h);
}

/** Rows of a ground plane between `top` and `bottom` evenly spaced in depth (vanishing point y = vy). */
function perspRows(top: number, bottom: number, vy: number, n: number): number[] {
  const zt = (bottom - vy) / (top - vy);
  const ys: number[] = [];
  for (let k = 0; k <= n; k++) { const z = zt + (1 - zt) * (k / n); ys.push(vy + (bottom - vy) / z); }
  return ys;
}

/** Perspective tiles: fill(i, j) picks the colour of row i (0 = farthest), column j (0 = right of vx), or null. */
function perspTiles(c: Ctx, top: number, bottom: number, vx: number, vy: number, tileW: number, rows: number,
  fill: (i: number, j: number) => string | null): void {
  const ys = perspRows(top, bottom, vy, rows);
  for (let i = 0; i < rows; i++) {
    const y0 = ys[i], y1 = ys[i + 1];
    const s0 = (y0 - vy) / (bottom - vy), s1 = (y1 - vy) / (bottom - vy);
    const span = Math.ceil((W / 2 + 60) / (tileW * s0)) + 1;
    for (let j = -span; j < span; j++) {
      const f = fill(i, j);
      if (!f) continue;
      const xa = j * tileW, xb = (j + 1) * tileW;
      c.fillStyle = f;
      c.beginPath();
      c.moveTo(vx + xa * s0, y0); c.lineTo(vx + xb * s0, y0);
      c.lineTo(vx + xb * s1, y1); c.lineTo(vx + xa * s1, y1);
      c.closePath(); c.fill();
    }
  }
}

/** Lines converging on (vx, vy) across a floor band: the seams of a tiled or planked floor. */
function perspLines(c: Ctx, top: number, bottom: number, vx: number, vy: number, tileW: number, color: string, lw = 1): void {
  const s0 = (top - vy) / (bottom - vy);
  const span = Math.ceil((W / 2 + 60) / (tileW * s0)) + 1;
  c.strokeStyle = color; c.lineWidth = lw;
  c.beginPath();
  for (let j = -span; j <= span; j++) {
    const x = j * tileW;
    c.moveTo(vx + x * s0, top); c.lineTo(vx + x, bottom);
  }
  c.stroke();
}

/** Catmull-Rom through `pts`, `n` samples per segment. */
function spline(pts: readonly (readonly [number, number])[], n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const last = pts[pts.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

/** A soft cartoon cloud made of overlapping puffs; `w` is its width. */
function cloud(c: Ctx, x: number, y: number, w: number, body: string, shadow: string): void {
  const r = w / 5;
  c.fillStyle = shadow;
  c.beginPath();
  c.ellipse(x, y + r * 0.35, w / 2, r * 0.8, 0, 0, TAU);
  c.fill();
  c.fillStyle = body;
  c.beginPath();
  c.arc(x - w * 0.28, y, r * 0.9, 0, TAU);
  c.arc(x - w * 0.06, y - r * 0.55, r * 1.25, 0, TAU);
  c.arc(x + w * 0.2, y - r * 0.25, r * 1.05, 0, TAU);
  c.arc(x + w * 0.36, y + r * 0.1, r * 0.75, 0, TAU);
  c.fill();
  c.beginPath(); c.ellipse(x, y + r * 0.2, w / 2, r * 0.62, 0, 0, TAU); c.fill();
}

// --- offscreen layer cache ------------------------------------------------------------------

interface Layer { canvas: HTMLCanvasElement; x: number; y: number }
const layerCache = new Map<string, Layer>();
const MAX_LAYERS = 20;

/**
 * Blit a cached static layer covering (x, y, w, h), drawing it first if needed. `draw` paints in
 * full-view coordinates. Without a DOM (never the case in the game) it simply draws directly.
 */
function layer(c: Ctx, key: string, x: number, y: number, w: number, h: number, draw: (g: Ctx) => void): void {
  let L = layerCache.get(key);
  if (L) {
    layerCache.delete(key); layerCache.set(key, L); // most recently used goes last
  } else {
    const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const g = cv ? cv.getContext('2d') : null;
    if (!cv || !g) { c.save(); draw(c); c.restore(); return; }
    cv.width = w; cv.height = h;
    g.translate(-x, -y);
    draw(g);
    L = { canvas: cv, x, y };
    while (layerCache.size >= MAX_LAYERS) {
      const oldest = layerCache.keys().next().value;
      if (oldest === undefined) break;
      layerCache.delete(oldest);
    }
    layerCache.set(key, L);
  }
  c.drawImage(L.canvas, L.x, L.y);
}

// ---------------------------------------------------------------------------------------------
// Battle backdrops
// ---------------------------------------------------------------------------------------------

/** Full 640x360 battle backdrop for `loc` (keyed on loc.id), animated by `t` seconds. */
export function drawBattleBackdrop(ctx: Ctx, loc: LocationDef, t: number): void {
  const p = pal(loc);
  ctx.save();
  switch (loc.id) {
    case 'museum': drawMuseum(ctx, p, t); break;
    case 'docks': drawDocks(ctx, p, t); break;
    case 'zoo': drawZoo(ctx, p, t); break;
    case 'tower': drawTower(ctx, p, t); break;
    case 'lab': drawLab(ctx, p, t); break;
    default: drawMuseum(ctx, p, t); break;
  }
  ctx.restore();
}

// --- museum ----------------------------------------------------------------------------------

const M_HY = 134;

function museumColors(p: Pal) {
  const wall = mix(p.sky, '#5d4b6e', 0.18);
  const marble = mix('#eee6d4', p.far, 0.28);
  return {
    wall, marble,
    marbleD: mix(marble, p.sky, 0.5),
    marbleL: mix(marble, '#ffffff', 0.4),
    gold: mix('#e8b84a', p.accent, 0.3),
    bone: mix('#f3ead2', p.sky, 0.12),
    wood: mix('#6b4a32', p.floor, 0.3),
  };
}

function drawMuseum(c: Ctx, p: Pal, t: number): void {
  layer(c, 'museum' + palKey(p), 0, 0, W, H, (g) => museumStatic(g, p));
  museumAnim(c, p, t);
}

function alcovePath(c: Ctx, close: boolean): void {
  c.beginPath();
  c.moveTo(176, M_HY);
  c.lineTo(176, 72);
  c.ellipse(295, 72, 119, 54, 0, Math.PI, TAU);
  c.lineTo(414, M_HY);
  if (close) c.closePath();
}

function archWindow(c: Ctx, cx: number, top: number, w: number, h: number, glass: string, frame: string, frameD: string): void {
  const x = cx - w / 2, r = w / 2;
  const path = () => {
    c.beginPath();
    c.moveTo(x, top + h); c.lineTo(x, top + r); c.arc(cx, top + r, r, Math.PI, TAU); c.lineTo(x + w, top + h); c.closePath();
  };
  path();
  c.fillStyle = vg(c, top, top + h, [0, mix(glass, '#ffffff', 0.25)], [1, shade(glass, 0.8)]);
  c.fill();
  c.lineWidth = 6; c.strokeStyle = frameD; c.stroke();
  c.lineWidth = 3; c.strokeStyle = frame; c.stroke();
  // mullions and panes
  c.strokeStyle = frameD; c.lineWidth = 2;
  c.beginPath();
  c.moveTo(cx, top + 2); c.lineTo(cx, top + h);
  for (let y = top + r + 6; y < top + h - 4; y += 18) { c.moveTo(x + 1, y); c.lineTo(x + w - 1, y); }
  c.stroke();
  // sill
  rrect(c, x - 6, top + h - 2, w + 12, 6, 2, frame, frameD, 1);
}

function column(c: Ctx, x: number, top: number, bottom: number, w: number, m: string, md: string, ml: string): void {
  const hw = w / 2;
  c.fillStyle = hgrad(c, x - hw, x + hw, [0, md], [0.22, ml], [0.55, m], [1, md]);
  c.fillRect(x - hw, top + 8, w, bottom - top - 16);
  c.fillStyle = rgba(md, 0.9);
  for (let i = 1; i < 4; i++) c.fillRect(Math.round(x - hw + (w * i) / 4), top + 11, 1, bottom - top - 22);
  rrect(c, x - hw - 6, top, w + 12, 8, 2, m, md, 1);
  circle(c, x - hw - 4, top + 8, 3.5, ml, md, 1);
  circle(c, x + hw + 4, top + 8, 3.5, ml, md, 1);
  rrect(c, x - hw - 4, bottom - 10, w + 8, 4, 1, m, md, 1);
  rrect(c, x - hw - 7, bottom - 6, w + 14, 6, 1, ml, md, 1);
}

function boneSeg(c: Ctx, x0: number, y0: number, x1: number, y1: number, r: number, fill: string, out: string): void {
  capsule(c, x0, y0, x1, y1, r, fill, out, 1);
  circle(c, x0, y0, r * 1.35, fill, out, 1);
  circle(c, x1, y1, r * 1.35, fill, out, 1);
}

function dinoSkeleton(c: Ctx, bone: string): void {
  const out = rgba(INK, 0.6);
  const boneD = shade(bone, 0.78);
  // far legs
  boneSeg(c, 284, 80, 278, 100, 2.6, boneD, out); boneSeg(c, 278, 100, 284, 119, 2.3, boneD, out);
  boneSeg(c, 346, 78, 354, 98, 3, boneD, out); boneSeg(c, 354, 98, 348, 119, 2.5, boneD, out);
  ellipse(c, 286, 121, 6, 2.5, boneD, out, 1); ellipse(c, 350, 121, 6, 2.5, boneD, out, 1);
  // spine from tail tip to skull
  const spine = spline([[414, 124], [394, 113], [368, 93], [338, 74], [306, 66], [276, 70], [258, 62], [244, 46], [232, 32], [222, 23]], 6);
  // ribs hang from the back
  c.lineCap = 'round';
  for (let k = 0; k < spine.length; k++) {
    const [sx, sy] = spine[k];
    if (sx < 270 || sx > 342 || k % 2) continue;
    const mid = 1 - Math.abs(sx - 306) / 40;
    const len = 18 + 14 * mid;
    c.beginPath(); c.moveTo(sx, sy + 2); c.quadraticCurveTo(sx + 8, sy + len * 0.6, sx - 3, sy + len);
    c.strokeStyle = out; c.lineWidth = 4.5; c.stroke();
    c.strokeStyle = bone; c.lineWidth = 2.4; c.stroke();
  }
  // belly line joining the rib tips
  c.beginPath(); c.moveTo(272, 92); c.quadraticCurveTo(306, 106, 340, 90);
  c.strokeStyle = out; c.lineWidth = 3; c.stroke(); c.strokeStyle = boneD; c.lineWidth = 1.4; c.stroke();
  // vertebrae
  for (let k = 0; k < spine.length; k++) {
    const [sx, sy] = spine[k];
    const u = k / (spine.length - 1);          // 0 = tail tip, 1 = head
    const r = u < 0.45 ? 1.6 + u * 7.5 : u < 0.62 ? 5 : 5 - (u - 0.62) * 6;
    circle(c, sx, sy, Math.max(1.4, r * 0.8), bone, out, 1);
  }
  // shoulder blade and hip
  c.save(); c.translate(272, 79); c.rotate(-0.4); ellipse(c, 0, 0, 5, 9, bone, out, 1); c.restore();
  ellipse(c, 336, 79, 10, 7, bone, out, 1);
  circle(c, 336, 79, 3, boneD);
  // near legs
  boneSeg(c, 270, 82, 263, 101, 3, bone, out); boneSeg(c, 263, 101, 268, 119, 2.6, bone, out);
  boneSeg(c, 332, 82, 341, 100, 3.4, bone, out); boneSeg(c, 341, 100, 334, 119, 2.8, bone, out);
  ellipse(c, 270, 121, 7, 2.8, bone, out, 1); ellipse(c, 336, 121, 7, 2.8, bone, out, 1);
  // skull: a friendly long-neck head looking left
  c.save(); c.translate(216, 21); c.rotate(-0.12);
  ellipse(c, 0, 0, 11, 6.5, bone, out, 1);
  ellipse(c, -8, 2, 6, 4, bone, out, 1);
  ellipse(c, -3, 4.2, 9, 2.4, boneD);
  circle(c, 2, -1.5, 2.6, INK);
  circle(c, -12, 0, 1, INK);
  c.beginPath(); c.moveTo(-11, 3.5); c.quadraticCurveTo(-5, 6.5, 3, 4);
  c.strokeStyle = INK; c.lineWidth = 1; c.stroke();
  c.restore();
}

function displayCase(c: Ctx, x: number, y: number, w: number, h: number, kind: 'ammonite' | 'geode', p: Pal): void {
  const col = museumColors(p);
  const pedH = Math.round(h * 0.34), gh = h - pedH;
  ellipse(c, x + w / 2, y + h + 1, w * 0.62, 5, rgba('#000000', 0.28));
  rrect(c, x + 3, y + gh, w - 6, pedH, 2, col.wood, shade(col.wood, 0.55), 1);
  rect(c, x + 3, y + gh + pedH - 5, w - 6, 3, shade(col.wood, 0.75));
  rrect(c, x + w / 2 - 9, y + gh + 8, 18, 7, 1, col.gold, shade(col.gold, 0.6), 1);
  rect(c, x + w / 2 - 6, y + gh + 11, 12, 1, shade(col.gold, 0.6));
  // contents, on a little stand
  const cx = x + w / 2, cy = y + gh - 18;
  rect(c, cx - 8, y + gh - 7, 16, 5, col.marbleD);
  if (kind === 'ammonite') {
    const shell = mix('#d9a86a', p.floor, 0.2);
    circle(c, cx, cy, 13, shell, rgba(INK, 0.6), 1);
    c.beginPath();
    for (let a = 0; a < 5.6 * Math.PI; a += 0.2) {
      const r = 12 * Math.exp(-a * 0.11);
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (a === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.strokeStyle = shade(shell, 0.6); c.lineWidth = 1.5; c.stroke();
    for (let a = 0; a < TAU; a += TAU / 12) {
      line(c, cx + Math.cos(a) * 7, cy + Math.sin(a) * 7, cx + Math.cos(a) * 12.5, cy + Math.sin(a) * 12.5, shade(shell, 0.75), 1);
    }
  } else {
    const rock = mix('#7a6a78', p.far, 0.3);
    c.beginPath(); c.arc(cx, cy + 4, 14, Math.PI, TAU); c.closePath();
    c.fillStyle = rock; c.fill(); c.strokeStyle = rgba(INK, 0.6); c.lineWidth = 1; c.stroke();
    c.beginPath(); c.arc(cx, cy + 4, 10, Math.PI, TAU); c.closePath(); c.fillStyle = '#3a2350'; c.fill();
    const gems = ['#b77cff', '#e0a8ff', '#8a4ad8', '#cf96ff', '#9f66f0'];
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i + 0.5) * (Math.PI / 7);
      const bx = cx + Math.cos(a) * 9.5, by = cy + 4 + Math.sin(a) * 9.5;
      const tx = cx + Math.cos(a) * 3, ty = cy + 4 + Math.sin(a) * 3;
      poly(c, [bx - 2, by, tx, ty, bx + 2, by], gems[i % gems.length]);
    }
  }
  // glass box and lid
  c.fillStyle = rgba('#cfeaff', 0.14); c.fillRect(x + 1, y, w - 2, gh);
  c.strokeStyle = rgba('#eaf6ff', 0.6); c.lineWidth = 1; c.strokeRect(x + 1.5, y + 0.5, w - 3, gh - 1);
  poly(c, [x + 5, y + 2, x + 11, y + 2, x + 4, y + gh - 2, x + 2, y + gh - 2], rgba('#ffffff', 0.22));
  rrect(c, x - 1, y - 3, w + 2, 4, 1, col.wood, shade(col.wood, 0.55), 1);
}

function museumStatic(c: Ctx, p: Pal): void {
  const HY = M_HY;
  const col = museumColors(p);
  const { wall, marble, marbleD, marbleL } = col;
  // back wall with faint stone courses
  c.fillStyle = vg(c, 0, HY, [0, shade(wall, 0.6)], [0.5, shade(wall, 0.9)], [1, mix(wall, p.far, 0.55)]);
  c.fillRect(0, 0, W, HY);
  c.fillStyle = rgba('#ffffff', 0.04);
  for (let y = 26, r = 0; y < HY - 8; y += 13, r++) {
    c.fillRect(0, y, W, 1);
    for (let x = (r % 2) * 24; x < W; x += 48) c.fillRect(x, y + 1, 1, 12);
  }
  // moonlit window behind the enemy's stage
  archWindow(c, 485, 32, 54, 90, mix(p.sky, '#9fb8e8', 0.5), marble, marbleD);
  // the alcove, its moulding and a soft spotlight
  alcovePath(c, true);
  c.fillStyle = vg(c, 18, HY, [0, shade(wall, 0.42)], [1, shade(wall, 0.66)]);
  c.fill();
  c.fillStyle = vg(c, 20, HY, [0, rgba('#fff4d8', 0.16)], [1, rgba('#fff4d8', 0.03)]);
  poly(c, [282, 20, 308, 20, 392, HY, 198, HY]);
  alcovePath(c, false);
  c.lineWidth = 8; c.strokeStyle = marbleD; c.stroke();
  c.lineWidth = 4; c.strokeStyle = marble; c.stroke();
  poly(c, [287, 13, 303, 13, 300, 26, 290, 26], marble, marbleD, 1);
  // columns and cornice
  for (const x of [22, 154, 436, 534, 626]) column(c, x, 12, HY - 4, 22, marble, marbleD, marbleL);
  c.fillStyle = vg(c, 0, 12, [0, marbleD], [1, marble]); c.fillRect(0, 0, W, 12);
  rect(c, 0, 12, W, 3, marbleD);
  c.fillStyle = shade(marbleD, 0.8);
  for (let x = 2; x < W; x += 9) c.fillRect(x, 15, 5, 4);
  // skirting
  rect(c, 0, HY - 6, W, 7, marbleD);
  rect(c, 0, HY - 6, W, 1, marble);
  // polished chequered floor
  const floorBase = mix(p.floor, '#d8ccb8', 0.3);
  const tileA = mix(floorBase, '#fff8ea', 0.16), tileB = shade(floorBase, 0.8);
  rect(c, 0, HY, W, H - HY, tileB);
  perspTiles(c, HY, H, 320, HY - 250, 46, 13, (i, j) => ((i + j) & 1 ? tileA : null));
  perspLines(c, HY, H, 320, HY - 250, 46, rgba(INK, 0.12), 1);
  // column reflections and the wall's haze on the far floor
  for (const x of [22, 154, 436, 534, 626]) {
    c.fillStyle = vg(c, HY, HY + 50, [0, rgba(marbleL, 0.16)], [1, rgba(marbleL, 0)]);
    c.fillRect(x - 11, HY + 1, 22, 50);
  }
  c.fillStyle = vg(c, HY, H, [0, rgba(wall, 0.5)], [0.3, rgba(wall, 0.08)], [0.75, rgba(INK, 0.1)], [1, rgba(INK, 0.35)]);
  c.fillRect(0, HY, W, H - HY);
  // plinth and skeleton
  ellipse(c, 300, 138, 112, 5, rgba('#000000', 0.25));
  rrect(c, 194, 118, 212, 19, 2, marbleD, shade(marbleD, 0.7), 1);
  rect(c, 195, 118, 210, 4, marble);
  rrect(c, 287, 125, 26, 8, 1, col.gold, shade(col.gold, 0.6), 1);
  rect(c, 291, 128, 18, 1, shade(col.gold, 0.6));
  dinoSkeleton(c, col.bone);
  // velvet rope barrier
  const rope = mix('#b0283a', p.accent, 0.15);
  const posts = [196, 300, 404];
  for (let i = 0; i < posts.length - 1; i++) {
    c.beginPath(); c.moveTo(posts[i], 133); c.quadraticCurveTo((posts[i] + posts[i + 1]) / 2, 147, posts[i + 1], 133);
    c.strokeStyle = shade(rope, 0.55); c.lineWidth = 4; c.stroke();
    c.strokeStyle = rope; c.lineWidth = 2.5; c.stroke();
  }
  for (const x of posts) {
    ellipse(c, x, 154, 7, 2.5, rgba('#000000', 0.3));
    rrect(c, x - 2, 132, 4, 21, 1, col.gold, shade(col.gold, 0.55), 1);
    ellipse(c, x, 153, 6, 2.2, col.gold, shade(col.gold, 0.55), 1);
    circle(c, x, 131, 3, mix(col.gold, '#ffffff', 0.3), shade(col.gold, 0.55), 1);
  }
  // display cases
  displayCase(c, 10, 146, 62, 92, 'ammonite', p);
  displayCase(c, 568, 108, 58, 84, 'geode', p);
}

function banner(c: Ctx, x: number, top: number, w: number, len: number, color: string, sway: number, emblem: number): void {
  const dark = shade(color, 0.6), light = mix(color, '#ffffff', 0.55);
  const hw = w / 2;
  line(c, x - hw - 4, top, x + hw + 4, top, '#6a4a2a', 2);
  circle(c, x - hw - 5, top, 2, '#c9a24a'); circle(c, x + hw + 5, top, 2, '#c9a24a');
  const pts = [x - hw, top, x + hw, top, x + hw + sway, top + len, x + sway, top + len - 9, x - hw + sway, top + len];
  poly(c, pts, color, dark, 1);
  c.save();
  c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath();
  c.clip();
  c.fillStyle = dark;
  c.fillRect(x - hw, top, 3, len + 4); c.fillRect(x + hw - 3 + sway * 0.5, top, 3, len + 4);
  c.restore();
  const ex = x + sway * 0.45, ey = top + len * 0.42;
  if (emblem === 0) {
    // a bone
    c.save(); c.translate(ex, ey); c.rotate(-0.6);
    capsule(c, -7, 0, 7, 0, 2, light);
    circle(c, -8, -2, 2.6, light); circle(c, -8, 2, 2.6, light); circle(c, 8, -2, 2.6, light); circle(c, 8, 2, 2.6, light);
    c.restore();
  } else if (emblem === 1) {
    // an ammonite spiral
    c.beginPath();
    for (let a = 0; a < 5 * Math.PI; a += 0.25) {
      const r = 9 * Math.exp(-a * 0.12);
      const px = ex + Math.cos(a) * r, py = ey + Math.sin(a) * r;
      if (a === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.strokeStyle = light; c.lineWidth = 2; c.stroke();
  } else {
    // a three-toed footprint
    ellipse(c, ex, ey + 4, 5, 6, light);
    for (const dx of [-5, 0, 5]) ellipse(c, ex + dx, ey - 5 - (dx === 0 ? 2 : 0), 2.2, 3.4, light);
  }
  c.fillStyle = light;
  c.fillRect(x - hw + 5 + sway * 0.1, top + 6, w - 10, 1);
}

function museumAnim(c: Ctx, p: Pal, t: number): void {
  const col = museumColors(p);
  // banners swaying in a draught
  banner(c, 63, 18, 30, 78, p.accent, Math.sin(t * 0.9) * 2, 0);
  banner(c, 113, 18, 30, 78, mix(p.accent, col.wall, 0.35), Math.sin(t * 0.9 + 1.3) * 2, 1);
  banner(c, 580, 18, 34, 82, p.accent, Math.sin(t * 0.8 + 2.1) * 2, 2);
  // moonbeam from the window falling across the enemy's stage, with drifting dust motes
  const shimmer = 0.75 + 0.25 * Math.sin(t * 0.7);
  c.fillStyle = vg(c, 40, 240, [0, rgba('#dfe8ff', 0.13 * shimmer)], [1, rgba('#dfe8ff', 0)]);
  poly(c, [460, 40, 510, 40, 480, 240, 372, 240]);
  for (let i = 0; i < 16; i++) {
    const u = (rnd(i, 3) + t * 0.03 * (0.5 + rnd(i, 4))) % 1;
    const y = 220 - u * 170;
    const x = 470 - (220 - y) * 0.35 + Math.sin(t * 0.8 + i) * 6 + (rnd(i, 5) - 0.5) * 50;
    const a = Math.sin(u * Math.PI) * (0.35 + 0.35 * rnd(i, 6));
    c.fillStyle = rgba('#fff8e0', a);
    c.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  // a glint sliding across the display glass now and then
  for (const [x, y, w, h, off] of [[10, 146, 62, 61, 0], [568, 108, 58, 55, 2.5]] as const) {
    const u = ((t + off) % 5) / 1.2;
    if (u > 1) continue;
    c.save();
    c.beginPath(); c.rect(x + 1, y, w - 2, h); c.clip();
    const gx = x - 20 + u * (w + 40);
    poly(c, [gx, y, gx + 8, y, gx - 12, y + h, gx - 20, y + h], rgba('#ffffff', 0.35 * Math.sin(u * Math.PI)));
    c.restore();
  }
}

// --- docks -----------------------------------------------------------------------------------

const D_HY = 138;

function docksColors(p: Pal) {
  const night = mix(p.sky, '#0a0d24', 0.35);
  return {
    night,
    skyline: mix(p.far, '#0c1030', 0.45),
    water: mix(p.mid, '#0f2648', 0.45),
    wood: mix(p.floor, '#7b5a3c', 0.45),
    moon: '#f8f0cc',
    lamp: mix('#ffd77a', p.accent, 0.3),
    crane: mix(p.mid, '#161a34', 0.55),
  };
}

function drawDocks(c: Ctx, p: Pal, t: number): void {
  const k = 'docks' + palKey(p);
  layer(c, k + 'a', 0, 0, W, 112, (g) => docksSky(g, p));
  docksStars(c, p, t);
  layer(c, k + 'b', 0, 0, W, D_HY + 4, (g) => docksMid(g, p));
  docksWater(c, p, t);
  layer(c, k + 'c', 0, 60, W, H - 60, (g) => docksFront(g, p));
  docksFrontAnim(c, p, t);
}

function docksSky(c: Ctx, p: Pal): void {
  const col = docksColors(p);
  c.fillStyle = vg(c, 0, 112, [0, shade(col.night, 0.6)], [0.6, col.night], [1, mix(col.night, p.far, 0.55)]);
  c.fillRect(0, 0, W, 112);
  glow(c, 108, 50, 80, '#fff2c0', 0.2);
  circle(c, 108, 50, 24, col.moon);
  c.save(); c.beginPath(); c.arc(108, 50, 24, 0, TAU); c.clip();
  circle(c, 116, 56, 24, rgba('#c8bf98', 0.35));
  c.restore();
  for (const [x, y, r] of [[99, 43, 5], [115, 58, 4], [112, 39, 3], [97, 58, 2.5], [121, 46, 2]] as const) circle(c, x, y, r, '#e3d9ad');
}

function docksStars(c: Ctx, p: Pal, t: number): void {
  for (let i = 0; i < 70; i++) {
    const x = rnd(i, 11) * W, y = rnd(i, 12) * 84;
    if (Math.hypot(x - 108, y - 50) < 40) continue;
    const tw = 0.5 + 0.5 * Math.sin(t * (1 + rnd(i, 13) * 2) + i);
    const big = rnd(i, 14) > 0.88;
    c.fillStyle = rgba(mix('#ffffff', p.accent, 0.15), 0.35 + 0.6 * tw * (big ? 1 : 0.7));
    c.fillRect(Math.round(x), Math.round(y), 1, 1);
    if (big) {
      c.fillRect(Math.round(x) - 1, Math.round(y), 3, 1);
      c.fillRect(Math.round(x), Math.round(y) - 1, 1, 3);
    }
  }
}

function crane(c: Ctx, x: number, base: number, top: number, boomL: number, boomR: number, colr: string): void {
  const lw = 2;
  // legs (an A-frame gantry)
  const l1 = x - 22, l2 = x + 22;
  c.strokeStyle = colr; c.lineWidth = 4; c.lineCap = 'butt';
  c.beginPath(); c.moveTo(l1, base); c.lineTo(x - 8, top + 6); c.moveTo(l2, base); c.lineTo(x + 8, top + 6); c.stroke();
  c.lineWidth = lw;
  c.beginPath();
  const n = 5;
  for (let i = 0; i < n; i++) {
    const y0 = base - ((base - top - 6) * i) / n, y1 = base - ((base - top - 6) * (i + 1)) / n;
    const w0 = 22 - (14 * i) / n, w1 = 22 - (14 * (i + 1)) / n;
    c.moveTo(x - w0, y0); c.lineTo(x + w1, y1);
    c.moveTo(x + w0, y0); c.lineTo(x - w1, y1);
    c.moveTo(x - w1, y1); c.lineTo(x + w1, y1);
  }
  c.stroke();
  // boom with lattice
  rect(c, boomL, top, boomR - boomL, 3, colr);
  rect(c, boomL + 6, top + 9, boomR - boomL - 12, 2, colr);
  c.beginPath();
  for (let bx = boomL + 6; bx < boomR - 8; bx += 8) { c.moveTo(bx, top + 3); c.lineTo(bx + 8, top + 9); c.moveTo(bx + 8, top + 3); c.lineTo(bx + 8, top + 9); }
  c.stroke();
  // cab, counterweight and mast
  rect(c, x - 10, top + 11, 14, 9, colr);
  rect(c, boomR - 16, top - 8, 14, 10, colr);
  c.beginPath(); c.moveTo(x, top); c.lineTo(x, top - 16); c.moveTo(x, top - 16); c.lineTo(boomL + 10, top); c.moveTo(x, top - 16); c.lineTo(boomR - 4, top); c.stroke();
}

function docksMid(c: Ctx, p: Pal): void {
  const col = docksColors(p);
  // far shore skyline with a few lit windows
  let x = 0, i = 0;
  while (x < W) {
    const w = 14 + Math.floor(rnd(i, 21) * 26);
    const h = 8 + Math.floor(rnd(i, 22) * 24);
    const top = 106 - h;
    rect(c, x, top, w, h + 2, col.skyline);
    if (rnd(i, 25) > 0.75) rect(c, x + w / 2 - 1, top - 6, 2, 6, col.skyline);
    for (let wy = top + 3; wy < 102; wy += 5) {
      for (let wx = x + 3; wx < x + w - 3; wx += 5) {
        if (rnd(wx * 7 + wy, 23) > 0.8) rect(c, wx, wy, 2, 2, rgba('#ffd98a', 0.75));
      }
    }
    x += w + (rnd(i, 24) > 0.7 ? 4 : 0); i++;
  }
  // lighthouse on the far point
  const lx = 548;
  poly(c, [lx - 7, 106, lx + 7, 106, lx + 4, 70, lx - 4, 70], mix('#d8d0c0', col.skyline, 0.45));
  c.save(); c.beginPath(); c.moveTo(lx - 7, 106); c.lineTo(lx + 7, 106); c.lineTo(lx + 4, 70); c.lineTo(lx - 4, 70); c.closePath(); c.clip();
  for (let y = 74; y < 106; y += 12) rect(c, lx - 10, y, 20, 5, mix('#c04848', col.skyline, 0.45));
  c.restore();
  rect(c, lx - 5, 63, 10, 7, mix('#ffe9a0', col.skyline, 0.2));
  poly(c, [lx - 7, 63, lx + 7, 63, lx, 56], col.skyline);
  // cranes on the far quay
  crane(c, 214, 106, 30, 144, 292, col.crane);
  crane(c, 606, 106, 56, 568, 640, mix(col.crane, col.skyline, 0.4));
  // harbour water
  c.fillStyle = vg(c, 104, D_HY + 4, [0, mix(col.water, col.night, 0.3)], [1, shade(col.water, 0.75)]);
  c.fillRect(0, 104, W, D_HY + 4 - 104);
  rect(c, 0, 104, W, 2, rgba(col.skyline, 0.8));
  // a tugboat at anchor
  const bx = 330, by = 116;
  poly(c, [bx - 34, by - 6, bx + 40, by - 6, bx + 32, by + 4, bx - 28, by + 4], mix('#3a2a3a', col.night, 0.35));
  rect(c, bx - 30, by - 8, 70, 2, mix('#c04848', col.night, 0.45));
  rrect(c, bx - 12, by - 20, 24, 14, 2, mix('#d8d0c0', col.night, 0.55));
  rect(c, bx - 4, by - 30, 7, 10, mix('#c04848', col.night, 0.45));
  for (const px of [bx - 7, bx, bx + 7]) circle(c, px, by - 14, 1.6, '#ffd98a');
  line(c, bx + 18, by - 6, bx + 18, by - 32, mix('#d8d0c0', col.night, 0.55), 1);
}

function docksWater(c: Ctx, p: Pal, t: number): void {
  const col = docksColors(p);
  // moon path and shimmering ripples
  for (let i = 0; i < 26; i++) {
    const y = 108 + (i % 13) * 2.3;
    const near = (y - 106) / 32;
    const wob = Math.sin(t * 2 + i * 1.7) * (3 + near * 4);
    const w = 6 + rnd(i, 31) * 10 + near * 6;
    c.fillStyle = rgba(col.moon, 0.45 * (0.6 + 0.4 * Math.sin(t * 3 + i)));
    c.fillRect(Math.round(108 + wob - w / 2 + (rnd(i, 32) - 0.5) * 16), Math.round(y), Math.round(w), 1);
  }
  for (let i = 0; i < 36; i++) {
    const y = 107 + rnd(i, 33) * 30;
    const speed = 4 + rnd(i, 34) * 6;
    const x = ((rnd(i, 35) * (W + 40) + t * speed) % (W + 40)) - 20;
    const a = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(t * 1.5 + i));
    c.fillStyle = rgba(mix(col.water, '#ffffff', 0.6), a);
    c.fillRect(Math.round(x), Math.round(y), Math.round(5 + rnd(i, 36) * 9), 1);
  }
  // the lighthouse beam sweeps the sky
  const a = Math.sin(t * 0.6);
  const lx = 548, ly = 66;
  const reach = 150, spread = 0.09;
  const ang = Math.PI + 0.25 + (a * 0.5 + 0.5) * 1.6 - 0.8;
  const bright = 0.1 + 0.08 * (1 - Math.abs(a));
  c.save();
  c.globalCompositeOperation = 'lighter';
  const g = c.createRadialGradient(lx, ly, 2, lx, ly, reach);
  g.addColorStop(0, rgba('#fff3c0', bright)); g.addColorStop(1, rgba('#fff3c0', 0));
  c.fillStyle = g;
  c.beginPath(); c.moveTo(lx, ly);
  c.lineTo(lx + Math.cos(ang - spread) * reach, ly + Math.sin(ang - spread) * reach);
  c.lineTo(lx + Math.cos(ang + spread) * reach, ly + Math.sin(ang + spread) * reach);
  c.closePath(); c.fill();
  c.restore();
  glow(c, lx, ly, 10, '#fff3c0', 0.5, true);
  // tugboat mast light blinks
  if ((t % 2) < 1) circle(c, 348, 83, 1.5, '#ff5a4a');
  // crane hook swaying on its cable
  const sway = Math.sin(t * 0.9) * 4;
  const hx = 164 + sway, hy = 76;
  line(c, 164, 40, hx, hy, rgba(col.crane, 1), 1);
  c.strokeStyle = col.crane; c.lineWidth = 2;
  c.beginPath(); c.arc(hx, hy + 4, 3.5, -0.3, Math.PI + 0.9); c.stroke();
  rect(c, hx - 3, hy - 2, 6, 3, col.crane);
}

function crate(c: Ctx, x: number, y: number, w: number, h: number, wood: string, label: string): void {
  const dark = shade(wood, 0.55), light = mix(wood, '#ffffff', 0.2);
  rrect(c, x, y, w, h, 1, wood, rgba(INK, 0.75), 1);
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.strokeStyle = dark; c.lineWidth = 3;
  c.beginPath(); c.moveTo(x + 4, y + 4); c.lineTo(x + w - 4, y + h - 4); c.moveTo(x + w - 4, y + 4); c.lineTo(x + 4, y + h - 4); c.stroke();
  c.restore();
  c.strokeStyle = dark; c.lineWidth = 2; c.strokeRect(x + 3, y + 3, w - 6, h - 6);
  rect(c, x + 1, y + 1, w - 2, 1, light);
  if (label) {
    rect(c, x + w / 2 - label.length * 3 - 2, y + h / 2 - 5, label.length * 6 + 3, 11, mix(wood, '#e8d8b8', 0.55));
    drawText(c, label, x + w / 2, y + h / 2 - 3, { size: 1, color: shade(wood, 0.45), align: 'center', shadow: false });
  }
}

function barrel(c: Ctx, x: number, y: number, w: number, h: number, wood: string): void {
  const dark = shade(wood, 0.55);
  c.save();
  c.beginPath();
  c.moveTo(x + 3, y); c.quadraticCurveTo(x - 2, y + h / 2, x + 3, y + h);
  c.lineTo(x + w - 3, y + h); c.quadraticCurveTo(x + w + 2, y + h / 2, x + w - 3, y); c.closePath();
  c.fillStyle = hgrad(c, x, x + w, [0, dark], [0.35, mix(wood, '#ffffff', 0.12)], [1, dark]);
  c.fill(); c.strokeStyle = rgba(INK, 0.75); c.lineWidth = 1.5; c.stroke();
  c.clip();
  for (const f of [0.2, 0.8]) rect(c, x - 2, y + h * f - 1.5, w + 4, 3, '#4a4a58');
  c.restore();
  ellipse(c, x + w / 2, y, w / 2 - 3, 3, shade(wood, 0.8), rgba(INK, 0.75), 1);
}

function docksFront(c: Ctx, p: Pal): void {
  const col = docksColors(p);
  const HY = D_HY;
  // plank deck
  const wood = col.wood;
  rect(c, 0, HY, W, H - HY, shade(wood, 0.82));
  const ys = perspRows(HY, H, HY - 190, 13);
  for (let i = 0; i < ys.length - 1; i++) {
    const y0 = ys[i], y1 = ys[i + 1];
    c.fillStyle = mix(wood, i % 2 ? '#000000' : '#ffffff', i % 2 ? 0.06 : 0.05);
    c.fillRect(0, y0, W, y1 - y0);
    rect(c, 0, Math.round(y1) - 1, W, 1, shade(wood, 0.5));
    const seg = 60 + (y1 - HY) * 1.4;
    const off = rnd(i, 41) * seg;
    for (let sx = -off; sx < W; sx += seg) {
      rect(c, Math.round(sx), Math.round(y0), 1, Math.max(1, Math.round(y1 - y0) - 1), shade(wood, 0.6));
      circle(c, sx + 4, (y0 + y1) / 2, 0.8, shade(wood, 0.45));
    }
  }
  c.fillStyle = vg(c, HY, H, [0, rgba(col.night, 0.45)], [0.35, rgba(col.night, 0.05)], [1, rgba(INK, 0.4)]);
  c.fillRect(0, HY, W, H - HY);
  // deck edge beam and pilings
  rect(c, 0, HY - 2, W, 5, shade(wood, 0.6));
  rect(c, 0, HY - 2, W, 1, mix(wood, '#ffffff', 0.15));
  const rope = mix('#d8c08a', col.night, 0.25);
  const piles = [36, 144, 268, 392, 520];
  for (let i = 0; i < piles.length - 1; i++) {
    if (i === 1) continue;
    c.beginPath(); c.moveTo(piles[i], HY - 12); c.quadraticCurveTo((piles[i] + piles[i + 1]) / 2, HY - 2, piles[i + 1], HY - 12);
    c.strokeStyle = shade(rope, 0.6); c.lineWidth = 2.5; c.stroke(); c.strokeStyle = rope; c.lineWidth = 1.2; c.stroke();
  }
  for (const x of piles) {
    rrect(c, x - 5, HY - 18, 10, 22, 3, shade(wood, 0.75), rgba(INK, 0.7), 1);
    ellipse(c, x, HY - 18, 5, 2, mix(wood, '#ffffff', 0.1), rgba(INK, 0.7), 1);
    rect(c, x - 5, HY - 13, 10, 2, shade(rope, 0.8));
  }
  // life ring on a pile
  circle(c, 268, HY - 6, 8, '#f2ece0', rgba(INK, 0.7), 1);
  circle(c, 268, HY - 6, 3.5, shade(wood, 0.75), rgba(INK, 0.7), 1);
  c.save(); c.beginPath(); c.arc(268, HY - 6, 8, 0, TAU); c.arc(268, HY - 6, 3.5, 0, TAU, true); c.clip();
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; poly(c, [268, HY - 6, 268 + Math.cos(a) * 10, HY - 6 + Math.sin(a) * 10, 268 + Math.cos(a + 0.5) * 10, HY - 6 + Math.sin(a + 0.5) * 10], '#d8483a'); }
  c.restore();
  // a mooring bollard with a coil of rope
  ellipse(c, 336, 162, 12, 4, rgba('#000000', 0.3));
  rrect(c, 330, 146, 12, 16, 3, '#3a3a48', rgba(INK, 0.8), 1);
  ellipse(c, 336, 146, 9, 3.5, '#52526a', rgba(INK, 0.8), 1);
  for (let k = 0; k < 3; k++) ellipse(c, 312 - k * 1.5, 160 - k * 2.2, 12 - k, 3.5, shade(rope, 0.9 - k * 0.05), rgba(INK, 0.5), 1);
  // stacked crates and barrels frame the scene
  crate(c, -4, 168, 58, 52, mix('#a8783e', wood, 0.35), 'FISH');
  crate(c, 50, 188, 44, 34, mix('#9a6a38', wood, 0.35), '');
  crate(c, 4, 124, 44, 44, mix('#b4864a', wood, 0.35), 'CHEESE');
  barrel(c, 576, 150, 26, 36, mix('#8a5a34', wood, 0.3));
  barrel(c, 604, 156, 26, 36, mix('#7e5230', wood, 0.3));
  ellipse(c, 600, 196, 30, 4, rgba('#000000', 0.25));
  // lamp post
  const lx = 626;
  rect(c, lx - 2, 84, 4, 150, '#2c2c3a');
  rect(c, lx - 5, 226, 10, 8, '#2c2c3a');
  rect(c, lx - 12, 82, 14, 2, '#2c2c3a');
  rrect(c, lx - 18, 84, 12, 14, 2, rgba('#ffe7a0', 0.9), '#2c2c3a', 1);
  poly(c, [lx - 20, 85, lx - 4, 85, lx - 12, 78], '#2c2c3a');
}

function docksFrontAnim(c: Ctx, p: Pal, t: number): void {
  const col = docksColors(p);
  const flick = 0.85 + 0.1 * Math.sin(t * 13) * Math.sin(t * 7.3) + 0.05 * Math.sin(t * 2);
  glow(c, 614, 92, 70 * flick, col.lamp, 0.22, true);
  glow(c, 614, 92, 18, '#fff4c8', 0.6 * flick, true);
  // light pool on the deck under the lamp
  c.fillStyle = rgba(col.lamp, 0.1 * flick);
  c.beginPath(); c.ellipse(600, 222, 56, 12, 0, 0, TAU); c.fill();
  // moths around the lamp
  for (let i = 0; i < 3; i++) {
    const a = t * (2 + i * 0.7) + i * 2;
    const mx = 612 + Math.cos(a) * (10 + i * 4), my = 92 + Math.sin(a * 1.3) * (8 + i * 2);
    c.fillStyle = rgba('#fff0d0', 0.8);
    c.fillRect(Math.round(mx), Math.round(my), 2, 1);
  }
  // little ripples at the pilings
  for (const [i, x] of [36, 144, 392, 520].entries()) {
    const u = (t * 0.6 + i * 0.37) % 1;
    c.strokeStyle = rgba('#cfe0ff', 0.25 * (1 - u));
    c.lineWidth = 1;
    c.beginPath(); c.ellipse(x, D_HY - 1, 6 + u * 10, 1.5 + u * 1.5, 0, Math.PI, TAU); c.stroke();
  }
}

// --- zoo -------------------------------------------------------------------------------------

const Z_HY = 138;

function zooColors(p: Pal) {
  const day = mix(p.sky, '#8fd0f0', 0.45);
  return {
    day,
    trees: mix(p.far, '#3f7d4a', 0.55),
    leaf: mix(p.mid, '#5fa94a', 0.55),
    path: mix(p.floor, '#d9c18e', 0.5),
    grass: mix(p.mid, '#74b84e', 0.6),
    wood: mix('#9a6a3c', p.floor, 0.2),
    rock: mix('#9a8f84', p.far, 0.25),
  };
}

function drawZoo(c: Ctx, p: Pal, t: number): void {
  const k = 'zoo' + palKey(p);
  layer(c, k + 'a', 0, 0, W, 120, (g) => zooSky(g, p));
  zooClouds(c, p, t);
  layer(c, k + 'b', 0, 30, W, 112, (g) => zooBack(g, p));
  zooMidAnim(c, t);
  layer(c, k + 'c', 0, 40, W, H - 40, (g) => zooFront(g, p));
  zooFrontAnim(c, p, t);
}

function zooSky(c: Ctx, p: Pal): void {
  const col = zooColors(p);
  c.fillStyle = vg(c, 0, 120, [0, shade(col.day, 0.82)], [1, mix(col.day, '#ffffff', 0.45)]);
  c.fillRect(0, 0, W, 120);
  glow(c, 64, 36, 60, '#fff6c8', 0.45);
  circle(c, 64, 36, 17, '#fff3b0');
  circle(c, 64, 36, 13, '#fffbe0');
}

function zooClouds(c: Ctx, p: Pal, t: number): void {
  const col = zooColors(p);
  const body = mix('#ffffff', col.day, 0.08), sh = mix(col.day, '#ffffff', 0.55);
  for (let i = 0; i < 5; i++) {
    const w = 50 + rnd(i, 51) * 50;
    const speed = 3 + rnd(i, 52) * 4;
    const x = ((rnd(i, 53) * (W + 200) + t * speed) % (W + 200)) - 100;
    const y = 18 + rnd(i, 54) * 50;
    cloud(c, x, y, w, body, sh);
  }
}

function tree(c: Ctx, x: number, base: number, r: number, leaf: string, trunk: string): void {
  rect(c, x - r * 0.12, base - r * 1.3, r * 0.24, r * 1.3, trunk);
  const dark = shade(leaf, 0.78), light = mix(leaf, '#ffffff', 0.18);
  c.fillStyle = dark;
  c.beginPath();
  c.arc(x - r * 0.55, base - r * 1.25, r * 0.6, 0, TAU);
  c.arc(x + r * 0.55, base - r * 1.25, r * 0.6, 0, TAU);
  c.arc(x, base - r * 1.7, r * 0.75, 0, TAU);
  c.fill();
  c.fillStyle = leaf;
  c.beginPath();
  c.arc(x - r * 0.45, base - r * 1.4, r * 0.48, 0, TAU);
  c.arc(x + r * 0.4, base - r * 1.45, r * 0.5, 0, TAU);
  c.arc(x - r * 0.05, base - r * 1.85, r * 0.55, 0, TAU);
  c.fill();
  circle(c, x - r * 0.2, base - r * 2.05, r * 0.22, light);
}

function zooBack(c: Ctx, p: Pal): void {
  const col = zooColors(p);
  // distant tree line
  c.fillStyle = mix(col.trees, col.day, 0.35);
  c.beginPath(); c.moveTo(0, 140);
  for (let x = 0; x <= W; x += 16) c.lineTo(x, 100 - Math.abs(Math.sin(x * 0.05)) * 10 - rnd(x, 61) * 8);
  c.lineTo(W, 140); c.closePath(); c.fill();
  for (let i = 0; i < 14; i++) {
    const x = 20 + i * 46 + rnd(i, 62) * 20;
    if (x > 540) continue;
    tree(c, x, 132, 16 + rnd(i, 63) * 8, col.trees, shade(col.wood, 0.7));
  }
  // rocky enclosure with a waterfall and pond
  const rock = col.rock, rockD = shade(rock, 0.7), rockL = mix(rock, '#ffffff', 0.25);
  poly(c, [0, 138, 0, 64, 22, 52, 52, 58, 74, 74, 96, 72, 118, 92, 132, 116, 140, 138], rock, rgba(INK, 0.55), 1);
  poly(c, [0, 64, 22, 52, 52, 58, 40, 70, 18, 74], rockL);
  poly(c, [74, 74, 96, 72, 118, 92, 102, 98, 84, 88], rockL);
  poly(c, [0, 110, 30, 100, 54, 116, 30, 126, 0, 124], rockD);
  poly(c, [96, 112, 118, 108, 132, 120, 112, 128], rockD);
  // waterfall bed
  rect(c, 56, 62, 14, 66, mix('#7fd0f0', col.day, 0.2));
  ellipse(c, 70, 132, 46, 7, mix('#5ab8e6', col.day, 0.15), rgba(INK, 0.45), 1);
  // a palm-ish big tree on the right of the enclosure
  tree(c, 168, 136, 22, col.leaf, shade(col.wood, 0.8));
}

function giraffe(c: Ctx, x: number, base: number, t: number): void {
  const body = '#f2c45a', spot = '#b8742e', out = rgba(INK, 0.7);
  const chew = Math.sin(t * 5) * 0.8;
  const bob = Math.sin(t * 0.8) * 1.5;
  const hx = x + 10, hy = 54 + bob;
  // neck
  c.beginPath();
  c.moveTo(x - 7, base); c.quadraticCurveTo(x - 4, hy + 30, hx - 6, hy + 6);
  c.lineTo(hx + 4, hy + 8); c.quadraticCurveTo(x + 8, hy + 34, x + 9, base); c.closePath();
  c.fillStyle = body; c.fill(); c.strokeStyle = out; c.lineWidth = 1.5; c.stroke();
  for (const [sx, sy, r] of [[x - 1, base - 12, 3.5], [x + 3, base - 30, 3], [x + 4, base - 46, 2.6], [x - 2, base - 22, 2.2]] as const) {
    if (sy < hy + 10) continue;
    ellipse(c, sx, sy, r, r * 0.8, spot);
  }
  // mane
  c.strokeStyle = spot; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x - 7, base - 4); c.quadraticCurveTo(x - 5, hy + 30, hx - 6, hy + 8); c.stroke();
  // head
  const flick = (t % 3.2) < 0.18 ? -0.6 : 0;
  c.save(); c.translate(hx + 6, hy + 2); c.rotate(-0.5 + flick);
  ellipse(c, 0, 0, 5, 2.5, body, out, 1);
  c.restore();
  ellipse(c, hx, hy, 8, 6.5, body, out, 1);
  ellipse(c, hx - 8, hy + 3 + chew * 0.5, 6, 4.2, mix(body, '#ffffff', 0.25), out, 1);
  // ossicones
  for (const dx of [-3, 3]) {
    line(c, hx + dx, hy - 5, hx + dx + 1, hy - 12, out, 3);
    line(c, hx + dx, hy - 5, hx + dx + 1, hy - 12, body, 1.6);
    circle(c, hx + dx + 1, hy - 12, 2, '#8a5a2a');
  }
  circle(c, hx - 2, hy - 1, 1.6, INK);
  circle(c, hx - 2.5, hy - 1.5, 0.6, '#ffffff');
  circle(c, hx - 11, hy + 2 + chew * 0.5, 0.8, INK);
  line(c, hx - 12, hy + 5 + chew, hx - 6, hy + 5 + chew * 0.6, out, 1);
}

function zooMidAnim(c: Ctx, t: number): void {
  // waterfall stripes and splash
  c.save(); c.beginPath(); c.rect(56, 62, 14, 66); c.clip();
  for (let i = 0; i < 8; i++) {
    const y = 60 + ((t * 40 + i * 9) % 70);
    rect(c, 58 + (i % 3) * 4, y, 2, 6, rgba('#ffffff', 0.55));
  }
  c.restore();
  for (let i = 0; i < 4; i++) {
    const u = (t * 1.5 + i * 0.25) % 1;
    circle(c, 63 + (i - 1.5) * 5 + u * (i - 1.5) * 4, 128 - Math.sin(u * Math.PI) * 6, 1.5, rgba('#ffffff', 0.8 * (1 - u)));
  }
  for (let i = 0; i < 2; i++) {
    const u = (t * 0.5 + i * 0.5) % 1;
    c.strokeStyle = rgba('#ffffff', 0.5 * (1 - u)); c.lineWidth = 1;
    c.beginPath(); c.ellipse(64, 132, 6 + u * 20, 1 + u * 3, 0, 0, TAU); c.stroke();
  }
  giraffe(c, 250, 128, t);
}

function signArrow(c: Ctx, x: number, y: number, w: number, dir: 1 | -1, text: string, fill: string): void {
  const dark = shade(fill, 0.55);
  const pts = dir > 0
    ? [x, y, x + w - 6, y, x + w, y + 5.5, x + w - 6, y + 11, x, y + 11]
    : [x + 6, y, x + w, y, x + w, y + 11, x + 6, y + 11, x, y + 5.5];
  poly(c, pts, fill, rgba(INK, 0.7), 1);
  drawText(c, text, x + w / 2 + (dir > 0 ? -2 : 2), y + 2, { size: 1, color: dark, align: 'center', shadow: false });
}

function zooFront(c: Ctx, p: Pal): void {
  const col = zooColors(p);
  const HY = Z_HY;
  // grass verges and the paved path
  c.fillStyle = vg(c, HY - 6, H, [0, col.grass], [1, shade(col.grass, 0.75)]);
  c.fillRect(0, HY - 6, W, H - HY + 6);
  c.fillStyle = col.path;
  c.beginPath();
  c.moveTo(150, HY); c.lineTo(560, HY); c.lineTo(W + 200, H); c.lineTo(-260, H); c.closePath(); c.fill();
  c.save(); c.clip();
  const pathD = shade(col.path, 0.86);
  const ys = perspRows(HY, H, HY - 200, 10);
  c.strokeStyle = pathD; c.lineWidth = 1;
  for (let i = 1; i < ys.length; i++) {
    c.beginPath(); c.moveTo(0, ys[i]); c.lineTo(W, ys[i]); c.stroke();
    const s = (ys[i] - (HY - 200)) / (H - (HY - 200));
    const step = 46 * s;
    const off = (i % 2) * step / 2;
    c.beginPath();
    for (let x = 355 + off - step * 12; x < W; x += step) { c.moveTo(x, ys[i - 1]); c.lineTo(x, ys[i]); }
    c.stroke();
  }
  c.restore();
  c.strokeStyle = shade(col.path, 0.7); c.lineWidth = 2;
  c.beginPath(); c.moveTo(150, HY); c.lineTo(-260, H); c.moveTo(560, HY); c.lineTo(W + 200, H); c.stroke();
  c.fillStyle = vg(c, HY, H, [0, rgba(col.day, 0.35)], [0.3, rgba(col.day, 0)], [1, rgba(INK, 0.3)]);
  c.fillRect(0, HY, W, H - HY);
  // enclosure fence
  const wood = col.wood, woodD = shade(wood, 0.6);
  rect(c, 0, 112, W, 4, woodD); rect(c, 0, 112, W, 1, mix(wood, '#ffffff', 0.2));
  rect(c, 0, 125, W, 4, woodD); rect(c, 0, 125, W, 1, mix(wood, '#ffffff', 0.2));
  for (let x = 6; x < W; x += 24) {
    rrect(c, x - 2.5, 106, 5, 34, 1.5, wood, rgba(INK, 0.6), 1);
    rect(c, x - 2.5, 106, 5, 2, mix(wood, '#ffffff', 0.25));
  }
  // signpost
  const sx = 372;
  rect(c, sx - 2, 74, 4, 64, shade(wood, 0.8));
  signArrow(c, sx - 2, 76, 52, 1, 'LIONS', mix('#f2e2b8', wood, 0.15));
  signArrow(c, sx - 52, 90, 54, -1, 'PANDAS', mix('#f2e2b8', wood, 0.15));
  signArrow(c, sx - 2, 104, 58, 1, 'SNACKS', mix('#f2e2b8', wood, 0.15));
  // flower beds at the front corners
  for (let i = 0; i < 18; i++) {
    const fx = rnd(i, 71) * 120, fy = 150 + rnd(i, 72) * 80;
    if (fx > 100 && fy > 190) continue;
    circle(c, fx, fy, 4, shade(col.grass, 0.85));
    circle(c, fx, fy - 2, 2.2, ['#ff7aa0', '#ffd34a', '#ffffff', '#c78aff'][i % 4]);
    circle(c, fx, fy - 2, 0.8, '#ffb000');
  }
  // ticket booth
  const bx = 548, bw = 86, bTop = 90, bBase = 206;
  ellipse(c, bx + bw / 2, bBase + 2, bw * 0.62, 6, rgba('#000000', 0.22));
  rrect(c, bx, bTop + 20, bw, bBase - bTop - 20, 2, mix('#f4ead6', col.path, 0.2), rgba(INK, 0.7), 1);
  rrect(c, bx + 12, bTop + 34, bw - 24, 32, 2, mix('#2a4a5a', col.day, 0.25), rgba(INK, 0.7), 1);
  rect(c, bx + 14, bTop + 36, bw - 28, 10, rgba('#ffffff', 0.15));
  rect(c, bx + 6, bTop + 66, bw - 12, 6, col.wood);
  rect(c, bx + 6, bTop + 66, bw - 12, 1, mix(col.wood, '#ffffff', 0.3));
  rrect(c, bx + bw / 2 - 26, bTop + 80, 52, 12, 2, p.accent, rgba(INK, 0.7), 1);
  drawText(c, 'TICKETS', bx + bw / 2, bTop + 83, { size: 1, color: '#ffffff', align: 'center', shadow: true, shadowColor: shade(p.accent, 0.5) });
  rect(c, bx + 4, bTop + 96, bw - 8, bBase - bTop - 98, mix('#d84a4a', p.accent, 0.3));
  for (let x = bx + 8; x < bx + bw - 6; x += 10) rect(c, x, bTop + 98, 4, bBase - bTop - 102, mix('#ffffff', p.accent, 0.1));
  // striped awning
  const stripes = 7, aw = (bw + 12) / stripes;
  for (let i = 0; i < stripes; i++) {
    const x0 = bx - 6 + i * aw;
    const fill = i % 2 ? '#ffffff' : mix('#e04848', p.accent, 0.3);
    poly(c, [x0 + 4, bTop + 4, x0 + aw + 4, bTop + 4, x0 + aw, bTop + 22, x0, bTop + 22], fill, rgba(INK, 0.6), 1);
    c.beginPath(); c.arc(x0 + aw / 2, bTop + 22, aw / 2, 0, Math.PI); c.fillStyle = fill; c.fill();
    c.strokeStyle = rgba(INK, 0.6); c.lineWidth = 1; c.stroke();
  }
  rect(c, bx - 4, bTop, bw + 14, 5, shade(mix('#e04848', p.accent, 0.3), 0.7));
}

function balloon(c: Ctx, x: number, y: number, r: number, color: string, sx: number, sy: number): void {
  c.strokeStyle = rgba(INK, 0.6); c.lineWidth = 1;
  c.beginPath(); c.moveTo(x, y + r * 1.2); c.quadraticCurveTo((x + sx) / 2 + 3, (y + sy) / 2, sx, sy); c.stroke();
  poly(c, [x - 2, y + r * 1.25, x + 2, y + r * 1.25, x, y + r * 1.05], shade(color, 0.7));
  ellipse(c, x, y, r, r * 1.18, color, rgba(INK, 0.6), 1);
  ellipse(c, x - r * 0.35, y - r * 0.4, r * 0.25, r * 0.38, rgba('#ffffff', 0.55));
}

function zooFrontAnim(c: Ctx, p: Pal, t: number): void {
  // balloons tied to the booth
  const colors = ['#ff5a6a', '#ffd24a', '#4aa8ff', '#6ad46a', '#ff8ad8'];
  const tie = { x: 552, y: 112 };
  for (let i = 0; i < 5; i++) {
    const bx = 530 + i * 9 + Math.sin(t * 1.3 + i) * 3;
    const by = 50 + (i % 2) * 12 + Math.sin(t * 1.7 + i * 2) * 2;
    balloon(c, bx, by, 8, colors[i], tie.x, tie.y);
  }
  // now and then one escapes and floats away
  const cyc = t % 9;
  if (cyc < 6) {
    const u = cyc / 6;
    const ex = 470 - u * 120 + Math.sin(cyc * 2) * 8, ey = 44 - u * 80;
    balloon(c, ex, ey, 7, mix('#c78aff', p.accent, 0.2), ex - 2, ey + 22);
  }
  // pennant flag on the booth fluttering
  const fx = 591, fy = 74;
  line(c, fx, fy, fx, fy + 18, '#4a3a2a', 1.5);
  const f = Math.sin(t * 6) * 2;
  poly(c, [fx, fy, fx + 16, fy + 3 + f, fx, fy + 7], p.accent, rgba(INK, 0.6), 1);
  // butterflies
  for (let i = 0; i < 2; i++) {
    const bx = 120 + i * 300 + Math.sin(t * 0.7 + i * 3) * 50;
    const by = 160 + Math.sin(t * 1.3 + i) * 14 - i * 20;
    const flap = Math.abs(Math.sin(t * 12 + i));
    const colr = i ? '#ffd24a' : '#ff8ad8';
    ellipse(c, bx - 2.5 * flap, by, 2.5 * flap + 0.5, 2.5, colr);
    ellipse(c, bx + 2.5 * flap, by, 2.5 * flap + 0.5, 2.5, colr);
    rect(c, bx - 0.5, by - 2, 1, 4, INK);
  }
}

// --- tower -----------------------------------------------------------------------------------

const T_HY = 146;

function towerColors(p: Pal) {
  return {
    top: mix(p.sky, '#2b1f55', 0.4),
    mid: mix(p.sky, '#d8607a', 0.6),
    low: mix(p.accent, '#ff9a5a', 0.6),
    horizon: mix(p.accent, '#ffd98a', 0.6),
    city: mix(p.far, '#3a2a5a', 0.5),
    concrete: mix(p.floor, '#8f8a9a', 0.45),
    metal: mix(p.mid, '#4a4258', 0.5),
  };
}

function drawTower(c: Ctx, p: Pal, t: number): void {
  const k = 'tower' + palKey(p);
  layer(c, k + 'a', 0, 0, W, T_HY, (g) => towerSky(g, p));
  towerClouds(c, p, t);
  layer(c, k + 'b', 0, 0, W, H, (g) => towerFront(g, p));
  towerAnim(c, p, t);
}

function towerSky(c: Ctx, p: Pal): void {
  const col = towerColors(p);
  c.fillStyle = vg(c, 0, T_HY, [0, col.top], [0.45, col.mid], [0.8, col.low], [1, col.horizon]);
  c.fillRect(0, 0, W, T_HY);
  // a big low sun with streaks of cloud across it
  glow(c, 318, 120, 120, '#ffd98a', 0.4);
  circle(c, 318, 120, 34, mix('#ffe9a0', col.horizon, 0.3));
  circle(c, 318, 120, 28, '#fff2c0');
  for (const [y, x0, x1] of [[108, 270, 372], [118, 252, 350], [127, 296, 400]] as const) {
    capsule(c, x0, y, x1, y, 2.5, rgba(col.mid, 0.8));
  }
}

function towerClouds(c: Ctx, p: Pal, t: number): void {
  const col = towerColors(p);
  // long glowing stratus streaks
  for (let i = 0; i < 6; i++) {
    const w = 80 + rnd(i, 81) * 120;
    const y = 18 + rnd(i, 82) * 74;
    const speed = 2 + rnd(i, 83) * 3;
    const x = ((rnd(i, 84) * (W + w * 2) + t * speed) % (W + w * 2)) - w;
    const lit = mix(col.horizon, '#ffffff', 0.35);
    const body = mix(col.mid, col.low, y / 100);
    capsule(c, x, y, x + w, y, 4, rgba(body, 0.95));
    capsule(c, x + 8, y - 2, x + w - 12, y - 2, 2, rgba(lit, 0.8));
  }
  // birds heading home
  for (let i = 0; i < 4; i++) {
    const u = ((t * 0.04 + i * 0.13) % 1);
    const bx = W + 20 - u * (W + 60) - i * 14;
    const by = 50 + i * 7 + Math.sin(t * 2 + i) * 3;
    const f = Math.sin(t * 9 + i * 1.7) * 2.5;
    c.strokeStyle = rgba('#2a1a3a', 0.8); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(bx - 4, by - f); c.lineTo(bx, by); c.lineTo(bx + 4, by - f); c.stroke();
  }
}

function towerFront(c: Ctx, p: Pal): void {
  const col = towerColors(p);
  const HY = T_HY;
  // the city far below: hazy back row, darker front row, lots of lit windows
  for (let row = 0; row < 2; row++) {
    const base = HY + 4;
    const fill = row === 0 ? mix(col.city, col.low, 0.35) : col.city;
    let x = -10, i = row * 100;
    while (x < W) {
      const w = 18 + Math.floor(rnd(i, 91) * 26);
      const top = (row === 0 ? 104 : 116) + Math.floor(rnd(i, 92) * 18);
      rect(c, x, top, w, base - top, fill);
      if (rnd(i, 93) > 0.7) { rect(c, x + w / 2 - 1, top - 10, 2, 10, fill); }
      if (rnd(i, 95) > 0.75) poly(c, [x, top, x + w / 2, top - 8, x + w, top], fill);
      for (let wy = top + 4; wy < base - 2; wy += 6) {
        for (let wx = x + 3; wx < x + w - 3; wx += 5) {
          if (rnd(wx * 13 + wy * 7 + row, 94) > (row ? 0.72 : 0.82)) rect(c, wx, wy, 2, 3, rgba('#ffd98a', row ? 0.85 : 0.5));
        }
      }
      x += w + 2; i++;
    }
  }
  // wisps of cloud below the roofline
  for (let i = 0; i < 4; i++) {
    const x = 40 + i * 170 + rnd(i, 96) * 40, y = 132 + rnd(i, 97) * 8;
    capsule(c, x, y, x + 90, y, 4, rgba(mix(col.horizon, '#ffffff', 0.4), 0.55));
  }
  // roof deck
  const con = col.concrete;
  c.fillStyle = vg(c, HY, H, [0, mix(con, col.low, 0.25)], [0.5, con], [1, shade(con, 0.8)]);
  c.fillRect(0, HY, W, H - HY);
  perspTiles(c, HY + 6, H, 320, HY - 230, 80, 7, (i, j) => ((i + j) & 1 ? rgba('#ffffff', 0.04) : null));
  perspLines(c, HY + 6, H, 320, HY - 230, 80, rgba(INK, 0.15), 1);
  // helipad ring and H, worn paint in perspective
  const pad = mix(p.accent, '#ffd24a', 0.4);
  c.save();
  c.translate(330, 206); c.scale(1, 0.34);
  c.strokeStyle = rgba(pad, 0.55); c.lineWidth = 6;
  c.beginPath(); c.arc(0, 0, 80, 0, TAU); c.stroke();
  c.fillStyle = rgba('#f4f0e8', 0.45);
  c.fillRect(-30, -42, 13, 84); c.fillRect(17, -42, 13, 84); c.fillRect(-17, -8, 34, 16);
  c.restore();
  c.fillStyle = vg(c, HY, H, [0, rgba(col.horizon, 0.2)], [0.3, rgba(col.horizon, 0)], [1, rgba(INK, 0.35)]);
  c.fillRect(0, HY, W, H - HY);
  // parapet and railing
  rect(c, 0, HY - 4, W, 10, shade(con, 0.75));
  rect(c, 0, HY - 4, W, 2, mix(con, '#ffffff', 0.3));
  const rail = col.metal;
  rect(c, 0, HY - 24, W, 3, rail);
  rect(c, 0, HY - 15, W, 2, rail);
  for (let x = 4; x < W; x += 28) rect(c, x, HY - 24, 3, 20, rail);
  // water tank on stilts
  const wx = 592;
  for (const dx of [-18, -6, 6, 18]) rect(c, wx + dx - 1.5, 112, 3, 64, shade(col.metal, 0.9));
  line(c, wx - 18, 120, wx + 18, 160, shade(col.metal, 0.9), 1.5);
  line(c, wx + 18, 120, wx - 18, 160, shade(col.metal, 0.9), 1.5);
  const tank = mix('#9a6a44', col.low, 0.2);
  rrect(c, wx - 24, 62, 48, 52, 3, tank, rgba(INK, 0.7), 1);
  c.fillStyle = hgrad(c, wx - 24, wx + 24, [0, rgba(INK, 0.25)], [0.35, rgba('#ffffff', 0.12)], [1, rgba(INK, 0.3)]);
  c.fillRect(wx - 23, 63, 46, 50);
  for (const y of [74, 92, 108]) rect(c, wx - 24, y, 48, 2, '#4a4a58');
  poly(c, [wx - 28, 63, wx + 28, 63, wx, 40], shade(tank, 0.8), rgba(INK, 0.7), 1);
  ellipse(c, wx, 176, 30, 4, rgba('#000000', 0.25));
  // air-con unit
  rrect(c, 540, 168, 48, 34, 2, mix('#c8c4cc', con, 0.3), rgba(INK, 0.7), 1);
  circle(c, 564, 185, 12, shade(con, 0.5), rgba(INK, 0.7), 1);
  ellipse(c, 564, 204, 28, 3, rgba('#000000', 0.25));
  // radio mast with a dish
  const mx = 54;
  const metal = mix('#c04848', col.metal, 0.4), metalL = mix('#e8e4ec', col.metal, 0.3);
  c.lineCap = 'butt';
  for (let i = 0; i < 9; i++) {
    const y0 = 186 - i * 20, y1 = y0 - 20;
    const w0 = 18 - i * 1.7, w1 = 18 - (i + 1) * 1.7;
    const colr = i % 2 ? metal : metalL;
    line(c, mx - w0, y0, mx - w1, y1, colr, 2.5);
    line(c, mx + w0, y0, mx + w1, y1, colr, 2.5);
    line(c, mx - w0, y0, mx + w1, y1, colr, 1);
    line(c, mx + w0, y0, mx - w1, y1, colr, 1);
    line(c, mx - w1, y1, mx + w1, y1, colr, 1.5);
  }
  line(c, mx, 6, mx, 0, metalL, 2);
  rect(c, mx - 22, 186, 44, 6, shade(con, 0.6));
  // the dish
  c.save(); c.translate(mx + 18, 104); c.rotate(-0.5);
  ellipse(c, 0, 0, 5, 13, metalL, rgba(INK, 0.6), 1);
  ellipse(c, 1, 0, 3, 10, shade(metalL, 0.85));
  line(c, 0, 0, 10, 0, metalL, 1.5);
  c.restore();
}

function towerAnim(c: Ctx, p: Pal, t: number): void {
  const col = towerColors(p);
  // blinking aircraft-warning light on the mast
  const on = (t % 1.6) < 0.8;
  circle(c, 54, 6, 2.5, on ? '#ff4a4a' : '#7a2a3a');
  if (on) glow(c, 54, 6, 16, '#ff4a4a', 0.5, true);
  // air-con fan
  const a = t * 8;
  c.save(); c.translate(564, 185); c.rotate(a);
  for (let k = 0; k < 3; k++) { c.rotate(TAU / 3); ellipse(c, 0, -6, 3, 6, rgba('#e8e4ec', 0.9)); }
  c.restore();
  circle(c, 564, 185, 2.5, '#4a4a58');
  // windsock on the railing
  const sx = 262, sy = T_HY - 40;
  line(c, sx, sy, sx, T_HY - 4, '#4a4a58', 2);
  const gust = 0.6 + 0.4 * Math.sin(t * 0.9);
  const segs = 4;
  for (let i = 0; i < segs; i++) {
    const x0 = sx + i * 6 * gust, x1 = sx + (i + 1) * 6 * gust;
    const droop0 = (1 - gust) * i * 3 + Math.sin(t * 6 + i) * 0.8;
    const droop1 = (1 - gust) * (i + 1) * 3 + Math.sin(t * 6 + i + 1) * 0.8;
    const r0 = 4 - i * 0.6, r1 = 4 - (i + 1) * 0.6;
    poly(c, [x0, sy + 3 - r0 + droop0, x1, sy + 3 - r1 + droop1, x1, sy + 3 + r1 + droop1, x0, sy + 3 + r0 + droop0],
      i % 2 ? '#ffffff' : '#ff6a3a', rgba(INK, 0.5), 0.5);
  }
  // a few window lights in the city flick on and off
  for (let i = 0; i < 6; i++) {
    const on2 = Math.sin(t * 0.5 + i * 2.3) > 0.2;
    if (on2) rect(c, 30 + i * 103 + Math.floor(rnd(i, 98) * 30), 124 + Math.floor(rnd(i, 99) * 10), 2, 3, mix('#ffe9a0', col.horizon, 0.2));
  }
}

// --- lab -------------------------------------------------------------------------------------

const L_HY = 138;
const TANKS = [196, 252, 308];

function labColors(p: Pal) {
  const wall = mix(p.sky, '#26343e', 0.4);
  return {
    wall,
    panel: mix(wall, '#ffffff', 0.06),
    seam: shade(wall, 0.6),
    pipe: mix(p.mid, '#6a7a84', 0.5),
    floor: mix(p.floor, '#56606c', 0.45),
    goo: mix(p.accent, '#5cff9a', 0.55),
    hazard: mix('#ffcc2a', p.accent, 0.15),
    screen: mix('#0d2a24', p.sky, 0.2),
    glowScreen: mix('#7affc8', p.accent, 0.3),
  };
}

function drawLab(c: Ctx, p: Pal, t: number): void {
  layer(c, 'lab' + palKey(p), 0, 0, W, H, (g) => labStatic(g, p));
  labAnim(c, p, t);
}

function hazardBand(c: Ctx, x: number, y: number, w: number, h: number, yellow: string, phase = 0): void {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  rect(c, x, y, w, h, yellow);
  c.fillStyle = '#1e1a22';
  for (let sx = x - h - 12 + phase; sx < x + w + h; sx += 12) {
    c.beginPath(); c.moveTo(sx, y + h); c.lineTo(sx + h, y); c.lineTo(sx + h + 6, y); c.lineTo(sx + 6, y + h); c.closePath(); c.fill();
  }
  c.restore();
}

function labStatic(c: Ctx, p: Pal): void {
  const col = labColors(p);
  const HY = L_HY;
  // riveted wall panels
  c.fillStyle = vg(c, 0, HY, [0, shade(col.wall, 0.7)], [1, col.wall]);
  c.fillRect(0, 0, W, HY);
  for (let y = 0; y < HY; y += 34) {
    for (let x = (y / 34) % 2 ? -32 : 0; x < W; x += 64) {
      rect(c, x + 2, y + 2, 60, 30, rgba(col.panel, 0.35));
      rect(c, x + 2, y + 2, 60, 1, rgba('#ffffff', 0.06));
      for (const [rx, ry] of [[x + 6, y + 6], [x + 58, y + 6], [x + 6, y + 28], [x + 58, y + 28]]) circle(c, rx, ry, 1.2, rgba('#ffffff', 0.18));
    }
  }
  // overhead pipes
  const pipe = col.pipe, pipeD = shade(pipe, 0.6), pipeL = mix(pipe, '#ffffff', 0.3);
  const pipeH = (y: number, x0: number, x1: number, r: number) => {
    c.fillStyle = vg(c, y - r, y + r, [0, pipeL], [0.4, pipe], [1, pipeD]);
    c.fillRect(x0, y - r, x1 - x0, r * 2);
  };
  const pipeV = (x: number, y0: number, y1: number, r: number) => {
    c.fillStyle = hgrad(c, x - r, x + r, [0, pipeL], [0.4, pipe], [1, pipeD]);
    c.fillRect(x - r, y0, r * 2, y1 - y0);
  };
  pipeH(12, 0, W, 6);
  pipeH(28, 0, 160, 4);
  pipeV(16, 12, HY, 5);
  pipeV(30, 28, HY, 3.5);
  for (const x of [80, 200, 330, 470, 600]) { rect(c, x - 2, 4, 4, 16, pipeD); rect(c, x - 3, 5, 6, 2, pipeL); }
  // valve wheel
  circle(c, 16, 86, 8, null, mix('#d84040', p.accent, 0.1), 1.5);
  line(c, 8, 86, 24, 86, mix('#d84040', p.accent, 0.1), 2); line(c, 16, 78, 16, 94, mix('#d84040', p.accent, 0.1), 2);
  circle(c, 16, 86, 2.5, '#5a5a6a');
  // blast door with hazard frame
  const dx = 60, dw = 84, dTop = 40;
  hazardBand(c, dx - 8, dTop - 8, dw + 16, HY - dTop + 8, col.hazard);
  rect(c, dx, dTop, dw, HY - dTop, mix(col.pipe, col.wall, 0.4));
  rect(c, dx + dw / 2 - 1, dTop, 2, HY - dTop, shade(col.wall, 0.5));
  for (const y of [dTop + 14, HY - 20]) { rect(c, dx + 4, y, dw - 8, 3, pipeD); }
  circle(c, dx + dw / 2, dTop + 42, 12, shade(col.wall, 0.5), pipeD, 2);
  circle(c, dx + dw / 2, dTop + 42, 9, mix(col.screen, col.goo, 0.15));
  drawText(c, 'KEEP OUT', dx + dw / 2, HY - 34, { size: 1, color: col.hazard, align: 'center', shadow: false });
  rrect(c, dx + dw / 2 - 9, dTop - 18, 18, 9, 2, '#3a3a48', rgba(INK, 0.6), 1);
  // glass tanks: bases, caps and the feed pipes (contents are animated)
  for (const tx of TANKS) {
    pipeV(tx + 22, 18, 36, 3);
    rrect(c, tx, 112, 44, HY - 110, 3, mix(pipe, col.wall, 0.2), rgba(INK, 0.7), 1);
    rect(c, tx + 4, 118, 36, 2, pipeL);
    for (const lx of [tx + 10, tx + 22, tx + 34]) circle(c, lx, 126, 1.6, '#3a4048');
    rrect(c, tx - 2, 34, 48, 12, 3, mix(pipe, col.wall, 0.1), rgba(INK, 0.7), 1);
    rect(c, tx + 2, 36, 40, 2, pipeL);
    rect(c, tx + 2, 46, 40, 66, rgba(col.screen, 0.9));
  }
  // big extractor fan behind the enemy's stage
  circle(c, 470, 70, 38, shade(col.wall, 0.75), pipeD, 2);
  circle(c, 470, 70, 32, shade(col.wall, 0.4));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    circle(c, 470 + Math.cos(a) * 35, 70 + Math.sin(a) * 35, 1.4, pipeL);
  }
  // monitor bank and console
  rrect(c, 538, 24, 96, 82, 3, '#2a2e38', rgba(INK, 0.8), 1);
  for (const [sx, sy] of [[542, 28], [588, 28], [542, 66], [588, 66]]) rect(c, sx, sy, 42, 34, col.screen);
  rrect(c, 532, 108, 108, 30, 2, mix(pipe, col.wall, 0.3), rgba(INK, 0.8), 1);
  rect(c, 534, 110, 104, 3, pipeL);
  // grated floor
  const fl = col.floor;
  rect(c, 0, HY, W, H - HY, fl);
  perspTiles(c, HY, H, 320, HY - 240, 52, 10, (i, j) => ((i + j) & 1 ? rgba('#ffffff', 0.05) : rgba('#000000', 0.04)));
  perspLines(c, HY, H, 320, HY - 240, 52, rgba(INK, 0.3), 1);
  const ys = perspRows(HY, H, HY - 240, 10);
  c.fillStyle = rgba(INK, 0.3);
  for (const y of ys) c.fillRect(0, Math.round(y), W, 1);
  // painted hazard border at the wall and around the tank area
  hazardBand(c, 0, HY, W, 6, col.hazard);
  c.fillStyle = vg(c, HY, H, [0, rgba(col.goo, 0.08)], [0.3, rgba(col.goo, 0)], [1, rgba(INK, 0.4)]);
  c.fillRect(0, HY + 6, W, H - HY - 6);
}

function labAnim(c: Ctx, p: Pal, t: number): void {
  const col = labColors(p);
  // tank contents: glowing liquid, rising bubbles, and something floating in each
  for (const [k, tx] of TANKS.entries()) {
    const level = 56 + Math.sin(t * 1.2 + k) * 2;
    const surface = 112 - level;
    const liquid = k === 1 ? mix(col.goo, '#5cc8ff', 0.5) : col.goo;
    c.save(); c.beginPath(); c.rect(tx + 2, 46, 40, 66); c.clip();
    c.fillStyle = vg(c, surface, 112, [0, rgba(liquid, 0.75)], [1, rgba(shade(liquid, 0.5), 0.9)]);
    c.beginPath(); c.moveTo(tx + 2, 112);
    for (let x = 0; x <= 40; x += 4) c.lineTo(tx + 2 + x, surface + Math.sin(t * 3 + x * 0.4 + k) * 1.2);
    c.lineTo(tx + 42, 112); c.closePath(); c.fill();
    for (let i = 0; i < 7; i++) {
      const u = (t * (0.35 + rnd(i + k * 10, 101) * 0.4) + rnd(i + k * 10, 102)) % 1;
      const by = 110 - u * (110 - surface);
      const bx = tx + 8 + rnd(i + k * 10, 103) * 28 + Math.sin(t * 3 + i) * 2;
      circle(c, bx, by, 1 + rnd(i + k * 10, 104) * 1.6, null, rgba('#ffffff', 0.7), 0.5);
    }
    const fy = surface + 22 + Math.sin(t * 1.5 + k * 2) * 4;
    if (k === 0) {
      // a glowing crystal
      c.save(); c.translate(tx + 22, fy); c.rotate(Math.sin(t * 0.8) * 0.3);
      poly(c, [0, -10, 6, 0, 0, 10, -6, 0], mix('#ffffff', liquid, 0.3), rgba(INK, 0.5), 1);
      poly(c, [0, -10, 6, 0, 0, 0], rgba('#ffffff', 0.6));
      c.restore();
      glow(c, tx + 22, fy, 16, '#ffffff', 0.35, true);
    } else if (k === 1) {
      // a rubber duck bobbing at the surface
      const dy = surface - 3 + Math.sin(t * 2) * 1;
      ellipse(c, tx + 22, dy + 2, 8, 5, '#ffd84a', rgba(INK, 0.7), 1);
      circle(c, tx + 27, dy - 4, 4, '#ffd84a', rgba(INK, 0.7), 1);
      poly(c, [tx + 30, dy - 4, tx + 34, dy - 3, tx + 30, dy - 2], '#ff8a2a');
      circle(c, tx + 28, dy - 5, 0.9, INK);
    } else {
      // a spare robot-ferret gear
      c.save(); c.translate(tx + 22, fy); c.rotate(t * 0.6);
      c.beginPath();
      for (let s = 0; s < 16; s++) {
        const a = (s / 16) * TAU, r = s % 2 ? 7 : 9.5;
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath(); c.fillStyle = mix('#b8c0c8', liquid, 0.3); c.fill();
      c.strokeStyle = rgba(INK, 0.5); c.lineWidth = 1; c.stroke();
      circle(c, 0, 0, 3, shade(liquid, 0.5));
      c.restore();
    }
    c.restore();
    // glass highlights
    rect(c, tx + 6, 48, 3, 62, rgba('#ffffff', 0.25));
    rect(c, tx + 11, 48, 1, 62, rgba('#ffffff', 0.15));
    glow(c, tx + 22, 80, 40, liquid, 0.12, true);
  }
  // extractor fan blades turning behind a grille
  c.save(); c.translate(470, 70); c.rotate(t * 1.5);
  for (let k = 0; k < 5; k++) {
    c.rotate(TAU / 5);
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(14, -6, 28, -2); c.quadraticCurveTo(18, 8, 0, 0);
    c.fillStyle = mix(col.pipe, col.wall, 0.3); c.fill();
  }
  c.restore();
  circle(c, 470, 70, 5, col.pipe, rgba(INK, 0.6), 1);
  c.strokeStyle = rgba(shade(col.wall, 0.4), 0.8); c.lineWidth = 1.5;
  c.beginPath();
  for (let y = 44; y <= 96; y += 8) {
    const hw = Math.sqrt(Math.max(0, 32 * 32 - (y - 70) * (y - 70)));
    c.moveTo(470 - hw, y); c.lineTo(470 + hw, y);
  }
  c.stroke();
  // monitors: a scrolling waveform, a bar graph, a radar sweep and blinking text
  const gs = col.glowScreen;
  c.save(); c.beginPath(); c.rect(542, 28, 42, 34); c.clip();
  c.strokeStyle = gs; c.lineWidth = 1;
  c.beginPath();
  for (let x = 0; x <= 42; x += 2) c.lineTo(542 + x, 45 + Math.sin(x * 0.35 + t * 4) * 7 * Math.sin(x * 0.08 + t));
  c.stroke();
  c.restore();
  for (let i = 0; i < 6; i++) {
    const h = 6 + (Math.sin(t * 2 + i * 1.3) * 0.5 + 0.5) * 22;
    rect(c, 592 + i * 6, 60 - h, 4, h, rgba(gs, 0.85));
  }
  circle(c, 563, 83, 14, null, rgba(gs, 0.5), 0.5);
  circle(c, 563, 83, 7, null, rgba(gs, 0.35), 0.5);
  const ra = t * 2;
  line(c, 563, 83, 563 + Math.cos(ra) * 14, 83 + Math.sin(ra) * 14, gs, 1);
  if (Math.sin(t * 3) > -0.2) circle(c, 563 + Math.cos(1.1) * 9, 83 + Math.sin(1.1) * 9, 1.5, '#ff6a5a');
  if ((t % 1.2) < 0.8) drawText(c, 'ERROR', 609, 72, { size: 1, color: '#ff6a5a', align: 'center', shadow: false });
  drawText(c, '42%', 609, 84, { size: 1, color: gs, align: 'center', shadow: false });
  // console buttons blink
  const lights = ['#ff5a4a', '#ffd24a', '#5aff8a', '#5ac8ff'];
  for (let i = 0; i < 12; i++) {
    const on = Math.sin(t * (1.5 + (i % 5) * 0.7) + i * 1.9) > 0;
    const bx = 540 + (i % 6) * 15, by = 118 + Math.floor(i / 6) * 9;
    rect(c, bx, by, 8, 5, on ? lights[i % 4] : shade(lights[i % 4], 0.35));
  }
  // rotating warning beacon above the door
  const ba = t * 4;
  const bx = 102, by = 26;
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = rgba('#ff9a2a', 0.18);
  c.beginPath(); c.moveTo(bx, by);
  c.arc(bx, by, 70, ba - 0.35, ba + 0.35); c.closePath(); c.fill();
  c.restore();
  ellipse(c, bx, by, 6, 5, '#ff8a2a', rgba(INK, 0.6), 1);
  glow(c, bx, by, 14, '#ff8a2a', 0.5 + 0.3 * Math.cos(ba), true);
  // steam puffs from a vent on the big pipe
  for (let i = 0; i < 3; i++) {
    const u = (t * 0.7 + i / 3) % 1;
    circle(c, 400 + Math.sin(u * 5 + i) * 4, 18 + u * 26, 3 + u * 8, rgba('#ffffff', 0.22 * (1 - u)));
  }
}

// ---------------------------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------------------------

/** The oval ground disc a combatant stands on, centred at (cx, cy), `w` px wide, styled for `loc`. */
export function drawPlatform(ctx: Ctx, cx: number, cy: number, w: number, loc: LocationDef): void {
  const p = pal(loc);
  const c = ctx;
  const width = Math.max(16, w);
  const rx = width / 2, ry = Math.max(6, width * 0.17), depth = Math.max(4, Math.round(width * 0.045));
  let top: string, side: string, rim: string;
  switch (loc.id) {
    case 'museum': top = mix(p.floor, '#efe6d6', 0.6); side = shade(top, 0.62); rim = mix('#e8b84a', p.accent, 0.3); break;
    case 'docks': top = mix(p.floor, '#8f6a46', 0.5); side = shade(top, 0.55); rim = mix('#d8c08a', p.sky, 0.2); break;
    case 'zoo': top = mix(p.mid, '#7cc35a', 0.6); side = mix(p.floor, '#8a5e3c', 0.55); rim = shade(top, 0.75); break;
    case 'tower': top = mix(p.floor, '#a6a2ae', 0.5); side = shade(top, 0.6); rim = mix(p.accent, '#ffd24a', 0.4); break;
    case 'lab': top = mix(p.floor, '#7a8794', 0.5); side = shade(top, 0.55); rim = mix(p.accent, '#5cff9a', 0.5); break;
    default: top = p.floor; side = shade(p.floor, 0.6); rim = p.accent; break;
  }
  c.save();
  // soft contact shadow
  ellipse(c, cx, cy + depth + 2, rx * 1.06, ry * 1.12, rgba('#000000', 0.25));
  // thickness
  ellipse(c, cx, cy + depth, rx, ry, side, rgba(INK, 0.55), 1);
  rect(c, cx - rx, cy, rx * 2, depth, side);
  // top face
  ellipse(c, cx, cy, rx, ry, top);
  c.save();
  c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, TAU); c.clip();
  switch (loc.id) {
    case 'museum': {
      c.strokeStyle = rim; c.lineWidth = 2;
      c.beginPath(); c.ellipse(cx, cy, rx * 0.8, ry * 0.8, 0, 0, TAU); c.stroke();
      c.lineWidth = 1; c.strokeStyle = rgba(rim, 0.6);
      c.beginPath(); c.ellipse(cx, cy, rx * 0.68, ry * 0.68, 0, 0, TAU); c.stroke();
      c.save(); c.translate(cx, cy); c.scale(1, ry / rx);
      pathStar(c, 0, 0, rx * 0.5, rx * 0.14, 4, -Math.PI / 2);
      c.fillStyle = rgba(rim, 0.35); c.fill();
      c.restore();
      break;
    }
    case 'docks': {
      const plank = ry * 2 / 5;
      for (let i = 0; i < 6; i++) {
        const y = cy - ry + i * plank;
        rect(c, cx - rx, Math.round(y), rx * 2, 1, shade(top, 0.6));
        const off = (i % 2) * rx * 0.5;
        rect(c, Math.round(cx - rx * 0.5 + off), Math.round(y), 1, Math.round(plank), shade(top, 0.65));
      }
      c.strokeStyle = rim; c.lineWidth = 3; c.setLineDash([4, 3]);
      c.beginPath(); c.ellipse(cx, cy, rx - 2, ry - 1.5, 0, 0, TAU); c.stroke();
      c.setLineDash([]);
      break;
    }
    case 'zoo': {
      for (let i = 0; i < 22; i++) {
        const a = rnd(i, 111) * TAU, r = Math.sqrt(rnd(i, 112));
        const gx = cx + Math.cos(a) * rx * 0.85 * r, gy = cy + Math.sin(a) * ry * 0.8 * r;
        line(c, gx, gy, gx - 1, gy - 3, shade(top, 0.75), 1);
        line(c, gx + 1.5, gy, gx + 2.5, gy - 2.5, mix(top, '#ffffff', 0.2), 1);
      }
      for (let i = 0; i < 4; i++) {
        const fx = cx + (rnd(i, 113) - 0.5) * rx * 1.4, fy = cy + (rnd(i, 114) - 0.5) * ry * 1.2;
        circle(c, fx, fy, 1.8, ['#ffffff', '#ffd34a', '#ff8ad8', '#ffffff'][i]);
      }
      break;
    }
    case 'tower': {
      c.strokeStyle = rgba(rim, 0.85); c.lineWidth = 3;
      c.beginPath(); c.ellipse(cx, cy, rx * 0.78, ry * 0.78, 0, 0, TAU); c.stroke();
      c.lineWidth = 1.5; c.setLineDash([6, 5]);
      c.beginPath(); c.ellipse(cx, cy, rx * 0.55, ry * 0.55, 0, 0, TAU); c.stroke();
      c.setLineDash([]);
      for (let i = 0; i < 5; i++) circle(c, cx + (rnd(i, 115) - 0.5) * rx * 1.5, cy + (rnd(i, 116) - 0.5) * ry * 1.2, 1, shade(top, 0.8));
      break;
    }
    case 'lab': {
      for (const f of [0.35, 0.55]) {
        c.strokeStyle = shade(top, 0.75); c.lineWidth = 1;
        c.beginPath(); c.ellipse(cx, cy, rx * f, ry * f, 0, 0, TAU); c.stroke();
      }
      c.strokeStyle = '#ffcc2a'; c.lineWidth = 4;
      c.beginPath(); c.ellipse(cx, cy, rx - 3, ry - 2, 0, 0, TAU); c.stroke();
      c.strokeStyle = '#1e1a22'; c.setLineDash([5, 5]);
      c.beginPath(); c.ellipse(cx, cy, rx - 3, ry - 2, 0, 0, TAU); c.stroke();
      c.setLineDash([]);
      c.strokeStyle = rgba(rim, 0.7); c.lineWidth = 2;
      c.beginPath(); c.ellipse(cx, cy, rx * 0.75, ry * 0.75, 0, 0, TAU); c.stroke();
      break;
    }
    default: break;
  }
  // sheen on the far half, shade on the near lip
  c.fillStyle = rgba('#ffffff', 0.12);
  c.beginPath(); c.ellipse(cx - rx * 0.15, cy - ry * 0.35, rx * 0.7, ry * 0.45, 0, 0, TAU); c.fill();
  c.restore();
  c.strokeStyle = rgba(INK, 0.55); c.lineWidth = 1;
  c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, TAU); c.stroke();
  c.strokeStyle = rgba('#ffffff', 0.25);
  c.beginPath(); c.ellipse(cx, cy, rx - 1, ry - 1, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
  c.restore();
}

// ---------------------------------------------------------------------------------------------
// The Burrow
// ---------------------------------------------------------------------------------------------

/** Hit boxes of the five activity stations in the Burrow (640x360 view coordinates). */
export const STATIONS: Record<ActivityId, { x: number; y: number; w: number; h: number }> = {
  feed: { x: 20, y: 120, w: 104, h: 114 },
  wheel: { x: 136, y: 84, w: 112, h: 150 },
  nap: { x: 262, y: 144, w: 116, h: 90 },
  dig: { x: 392, y: 108, w: 112, h: 126 },
  play: { x: 518, y: 138, w: 106, h: 96 },
};

const BURROW = {
  soil: '#2e1c14',
  soilD: '#21130d',
  wall: '#8a5a3a',
  wallL: '#b4794a',
  floor: '#9a673e',
  floorD: '#6e4628',
  wood: '#a0683c',
  woodD: '#5e3a22',
  woodL: '#c88a52',
  root: '#6e4630',
  lamp: '#ffcf7a',
  straw: '#e8c66a',
};
const B_FLOOR = 232;      // where the back wall meets the floor
const B_FRONT = 306;      // front lip of the floor
const POSTS = [130, 255, 385, 511];

function chamberPath(c: Ctx): void {
  c.beginPath();
  c.moveTo(12, B_FRONT);
  c.lineTo(12, 86);
  c.quadraticCurveTo(14, 36, 70, 34);
  c.lineTo(570, 34);
  c.quadraticCurveTo(626, 36, 628, 86);
  c.lineTo(628, B_FRONT);
  c.closePath();
}

/** The Burrow habitat background (stations are drawn on top with drawStation). */
export function drawBurrow(ctx: Ctx, t: number): void {
  ctx.save();
  layer(ctx, 'burrow', 0, 0, W, H, burrowStatic);
  burrowAnim(ctx, t);
  ctx.restore();
}

function burrowStatic(c: Ctx): void {
  const B = BURROW;
  // surrounding earth, with the HUD strip kept plain
  c.fillStyle = vg(c, 0, H, [0, '#24150f'], [0.1, B.soil], [1, B.soilD]);
  c.fillRect(0, 0, W, H);
  rect(c, 0, 0, W, 28, '#22140e');
  rect(c, 0, 27, W, 1, '#3a2418');
  for (let i = 0; i < 90; i++) {
    const x = rnd(i, 201) * W, y = 30 + rnd(i, 202) * (H - 30);
    ellipse(c, x, y, 1.5 + rnd(i, 203) * 3, 1 + rnd(i, 204) * 2, rnd(i, 205) > 0.5 ? '#3d271b' : '#1c100b');
  }
  // the chamber
  chamberPath(c);
  const g = c.createRadialGradient(320, 150, 30, 320, 170, 360);
  g.addColorStop(0, B.wallL); g.addColorStop(0.55, B.wall); g.addColorStop(1, '#5a3622');
  c.fillStyle = g; c.fill();
  c.save(); chamberPath(c); c.clip();
  // earth strata and embedded pebbles
  for (let k = 0; k < 7; k++) {
    const y = 60 + k * 26;
    c.strokeStyle = rgba('#000000', 0.07); c.lineWidth = 2;
    c.beginPath();
    for (let x = 0; x <= W; x += 20) c.lineTo(x, y + Math.sin(x * 0.03 + k) * 4);
    c.stroke();
  }
  for (let i = 0; i < 50; i++) {
    const x = 16 + rnd(i, 211) * 608, y = 40 + rnd(i, 212) * 190;
    ellipse(c, x, y, 2 + rnd(i, 213) * 3, 1.5 + rnd(i, 214) * 2, rgba(rnd(i, 215) > 0.5 ? '#ffffff' : '#000000', 0.08));
  }
  // carved nooks behind each station
  for (const id of ['feed', 'wheel', 'nap', 'dig', 'play'] as const) {
    const s = STATIONS[id];
    c.fillStyle = rgba('#000000', 0.12);
    c.beginPath();
    c.moveTo(s.x + 2, B_FLOOR);
    c.lineTo(s.x + 2, s.y + 30);
    c.quadraticCurveTo(s.x + 2, s.y + 6, s.x + 26, s.y + 6);
    c.lineTo(s.x + s.w - 26, s.y + 6);
    c.quadraticCurveTo(s.x + s.w - 2, s.y + 6, s.x + s.w - 2, s.y + 30);
    c.lineTo(s.x + s.w - 2, B_FLOOR);
    c.closePath(); c.fill();
  }
  // tunnels leading off at both sides
  for (const [x, dir] of [[12, 1], [628, -1]] as const) {
    c.fillStyle = '#1c100b';
    c.beginPath(); c.ellipse(x, 214, 16, 24, 0, dir > 0 ? -Math.PI / 2 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI * 1.5); c.fill();
    c.strokeStyle = rgba('#000000', 0.25); c.lineWidth = 3; c.stroke();
  }
  // floor
  c.fillStyle = vg(c, B_FLOOR - 2, B_FRONT, [0, B.floorD], [0.25, B.floor], [1, shade(B.floor, 0.85)]);
  c.beginPath();
  c.moveTo(0, B_FLOOR + 2);
  for (let x = 0; x <= W; x += 32) c.lineTo(x, B_FLOOR - 1 + Math.sin(x * 0.04) * 1.5);
  c.lineTo(W, B_FRONT); c.lineTo(0, B_FRONT); c.closePath(); c.fill();
  rect(c, 0, B_FLOOR - 1, W, 3, rgba('#000000', 0.18));
  // woven rug in the middle of the floor
  const rugs = ['#b8483a', '#e8cf9a', '#3a8a8a', '#e8cf9a', '#b8483a'];
  for (let i = 0; i < rugs.length; i++) {
    ellipse(c, 320, 274, 128 - i * 22, 24 - i * 4.3, rugs[i], i === 0 ? rgba(INK, 0.4) : null, 1);
  }
  for (let a = 0; a < TAU; a += TAU / 36) {
    line(c, 320 + Math.cos(a) * 128, 274 + Math.sin(a) * 24, 320 + Math.cos(a) * 134, 274 + Math.sin(a) * 26, '#e8cf9a', 1);
  }
  // straw bits and pebbles on the floor
  for (let i = 0; i < 40; i++) {
    const x = rnd(i, 221) * W, y = B_FLOOR + 6 + rnd(i, 222) * (B_FRONT - B_FLOOR - 10);
    if (Math.abs(x - 320) < 130 && Math.abs(y - 274) < 26) continue;
    const a = rnd(i, 223) * Math.PI;
    line(c, x, y, x + Math.cos(a) * 4, y + Math.sin(a) * 2, rgba(B.straw, 0.7), 1);
  }
  c.restore();
  // chamber rim
  chamberPath(c);
  c.strokeStyle = '#3a2418'; c.lineWidth = 4; c.stroke();
  // front lip of the floor and the soil band beneath
  c.fillStyle = vg(c, B_FRONT - 2, B_FRONT + 10, [0, '#5a3824'], [1, B.soil]);
  c.fillRect(0, B_FRONT - 2, W, 12);
  rect(c, 0, B_FRONT - 2, W, 1, rgba('#ffffff', 0.12));
  // roots hanging from the ceiling and creeping down the walls
  const rootsAt = [44, 96, 190, 230, 300, 352, 420, 470, 560, 600];
  for (const [i, x] of rootsAt.entries()) {
    const len = 14 + rnd(i, 231) * 26;
    c.strokeStyle = B.root; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(x, 30); c.bezierCurveTo(x + 6, 30 + len * 0.3, x - 6, 30 + len * 0.7, x + 2, 30 + len); c.stroke();
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x + 1, 30 + len * 0.5); c.lineTo(x + 7, 30 + len * 0.62); c.stroke();
  }
  // wooden posts, lintel and knee braces
  for (const x of POSTS) {
    rect(c, x - 5, 50, 10, B_FLOOR - 48, B.wood);
    rect(c, x - 5, 50, 3, B_FLOOR - 48, B.woodL);
    rect(c, x + 3, 50, 2, B_FLOOR - 48, B.woodD);
    rect(c, x - 7, B_FLOOR - 2, 14, 5, B.woodD);
    for (const dir of [-1, 1]) {
      c.strokeStyle = B.woodD; c.lineWidth = 6;
      c.beginPath(); c.moveTo(x, 70); c.lineTo(x + dir * 18, 51); c.stroke();
      c.strokeStyle = B.wood; c.lineWidth = 4; c.stroke();
    }
  }
  rrect(c, 12, 40, 616, 11, 2, B.wood, B.woodD, 1);
  rect(c, 14, 41, 612, 2, B.woodL);
  for (let x = 30; x < 620; x += 60) { circle(c, x, 45.5, 1.5, B.woodD); }
  // a portrait of Chief Nibbles above the snack bar
  const px = 72, py = 92;
  rrect(c, px - 20, py - 20, 40, 34, 2, '#c9a24a', '#6e4a1e', 1);
  rect(c, px - 16, py - 16, 32, 26, '#3a5a6a');
  ellipse(c, px, py + 6, 11, 8, '#8a8a92', INK, 1);
  ellipse(c, px, py - 1, 9, 8, '#9a9aa2', INK, 1);
  circle(c, px - 7, py - 8, 3, '#9a9aa2', INK, 1); circle(c, px + 7, py - 8, 3, '#9a9aa2', INK, 1);
  rect(c, px - 7, py - 3, 6, 4, INK);
  line(c, px - 9, py - 4, px + 2, py - 6, INK, 1);
  circle(c, px + 4, py - 1, 2.5, null, '#e8c84a', 0.8);
  circle(c, px + 4, py - 1, 1, INK);
  circle(c, px, py + 2, 1.2, '#ff8a9a');
  rect(c, px - 12, py + 11, 24, 3, '#c9a24a');
  // a treasure map pinned above the tunnels
  const mx = 412, my = 86;
  poly(c, [mx - 24, my - 16, mx + 22, my - 18, mx + 25, my + 18, mx - 22, my + 20], '#ecd9a8', '#8a6a3a', 1);
  c.strokeStyle = '#a07a4a'; c.lineWidth = 1; c.setLineDash([2, 2]);
  c.beginPath(); c.moveTo(mx - 16, my + 10); c.quadraticCurveTo(mx - 4, my - 12, mx + 10, my + 4); c.stroke();
  c.setLineDash([]);
  line(c, mx + 8, my + 2, mx + 14, my + 8, '#c03a2a', 2); line(c, mx + 14, my + 2, mx + 8, my + 8, '#c03a2a', 2);
  circle(c, mx, my - 16, 2, '#d84a4a');
  // a shelf with a trophy and a potted sprout above the ball pit
  rect(c, 528, 112, 82, 5, B.wood); rect(c, 528, 112, 82, 1, B.woodL);
  poly(c, [540, 112, 544, 117, 548, 112], B.woodD); poly(c, [592, 112, 596, 117, 600, 112], B.woodD);
  rrect(c, 540, 92, 16, 14, 3, '#f2c84a', '#8a6a1e', 1);
  rect(c, 546, 106, 4, 3, '#c9a24a'); rect(c, 542, 109, 12, 3, '#8a6a1e');
  circle(c, 538, 97, 3, null, '#c9a24a', 1); circle(c, 558, 97, 3, null, '#c9a24a', 1);
  poly(c, [582, 100, 600, 100, 598, 112, 584, 112], '#c86a3a', '#6e3a1e', 1);
  line(c, 591, 100, 591, 88, '#4a8a3a', 2);
  ellipse(c, 586, 89, 5, 2.5, '#6ac04a'); ellipse(c, 596, 86, 5, 2.5, '#6ac04a');
  // DHA pennant
  line(c, 558, 70, 558, 92, '#6e4a1e', 2);
  poly(c, [560, 72, 612, 77, 560, 86], '#3a6ab8', '#1e3a6e', 1);
  drawText(c, 'DHA', 576, 76, { size: 1, color: '#ffe9a0', align: 'center', shadow: false });
  // mushrooms at the foot of the posts (their glow pulses in the animated pass)
  for (const x of [POSTS[0] + 10, POSTS[2] - 12, POSTS[3] + 10]) {
    for (const [dx, h, r] of [[0, 7, 4], [6, 5, 3]] as const) {
      rect(c, x + dx - 1, B_FLOOR - h, 2, h, '#f0e6d0');
      c.beginPath(); c.arc(x + dx, B_FLOOR - h, r, Math.PI, TAU); c.fillStyle = '#7ad8c8'; c.fill();
    }
  }
}

function burrowAnim(c: Ctx, t: number): void {
  const B = BURROW;
  // window to the surface: sky, a drifting cloud, grass and a flower
  const wx = 320, wy = 86, wr = 24;
  c.save();
  c.beginPath(); c.arc(wx, wy, wr, 0, TAU); c.clip();
  c.fillStyle = vg(c, wy - wr, wy + wr, [0, '#6ec0f0'], [1, '#bfe8ff']);
  c.fillRect(wx - wr, wy - wr, wr * 2, wr * 2);
  circle(c, wx + 12, wy - 12, 6, '#fff3b0');
  const cxo = ((t * 4) % 80) - 40;
  cloud(c, wx + cxo, wy - 4, 24, '#ffffff', '#dff2ff');
  c.fillStyle = '#5aa84a';
  c.beginPath(); c.moveTo(wx - wr, wy + wr);
  for (let x = -wr; x <= wr; x += 4) c.lineTo(wx + x, wy + 12 - (x / 4 % 2 ? 3 : 0) + Math.sin(t * 2 + x) * 0.6);
  c.lineTo(wx + wr, wy + wr); c.closePath(); c.fill();
  const sway = Math.sin(t * 1.6) * 1.5;
  line(c, wx - 8, wy + 14, wx - 8 + sway, wy + 4, '#3a8a3a', 1.5);
  circle(c, wx - 8 + sway, wy + 3, 2.5, '#ff8ab0'); circle(c, wx - 8 + sway, wy + 3, 1, '#ffd84a');
  c.restore();
  circle(c, wx, wy, wr + 2, null, B.woodD, 2.5);
  circle(c, wx, wy, wr, null, B.woodL, 1.5);
  line(c, wx - wr, wy, wx + wr, wy, B.woodD, 2);
  line(c, wx, wy - wr, wx, wy + wr, B.woodD, 2);
  // a sunbeam from the window onto the nest
  const beam = 0.08 + 0.03 * Math.sin(t * 0.8);
  c.fillStyle = vg(c, wy, 230, [0, rgba('#fff2c0', beam)], [1, rgba('#fff2c0', 0)]);
  poly(c, [wx - 14, wy + 10, wx + 14, wy + 10, wx + 46, 228, wx - 40, 228]);
  for (let i = 0; i < 10; i++) {
    const u = (rnd(i, 241) + t * 0.025) % 1;
    const y = 220 - u * 120;
    const x = wx + (rnd(i, 242) - 0.5) * (20 + (y - wy) * 0.4) + Math.sin(t + i) * 3;
    c.fillStyle = rgba('#fff8e0', 0.6 * Math.sin(u * Math.PI));
    c.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  // bunting draped between the posts
  const flags = ['#e85a5a', '#ffd24a', '#5ac0e8', '#7ad06a', '#ff8ad0', '#ffffff'];
  const anchors = [14, ...POSTS, 626];
  let n = 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    const x0 = anchors[i], x1 = anchors[i + 1];
    if (x0 === 255) continue; // leave the window clear
    const sag = 9 + Math.sin(t * 0.9 + i) * 1.2;
    c.strokeStyle = '#e8d8b0'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x0, 52); c.quadraticCurveTo((x0 + x1) / 2, 52 + sag * 2, x1, 52); c.stroke();
    const count = Math.floor((x1 - x0) / 16);
    for (let k = 1; k < count; k++) {
      const u = k / count;
      const fx = x0 + (x1 - x0) * u;
      const fy = 52 + sag * 2 * 2 * u * (1 - u);
      const flap = Math.sin(t * 2 + n) * 1.2;
      poly(c, [fx - 5, fy, fx + 5, fy, fx + flap, fy + 10], flags[n % flags.length], rgba(INK, 0.35), 0.5);
      n++;
    }
  }
  // hanging lanterns with flickering warm light
  for (const [i, x] of POSTS.entries()) {
    const fl = 0.85 + 0.08 * Math.sin(t * 9 + i * 2) * Math.sin(t * 5.3 + i) + 0.07 * Math.sin(t * 1.3 + i);
    const ly = 66 + Math.sin(t * 0.8 + i) * 0.8;
    glow(c, x + 14, ly, 64 * fl, B.lamp, 0.22, true);
    line(c, x + 14, 51, x + 14, ly - 6, '#3a2418', 1);
    rrect(c, x + 9, ly - 6, 10, 12, 2, rgba('#ffe7a0', 0.95), '#4a2e1a', 1);
    rect(c, x + 8, ly - 7, 12, 2, '#4a2e1a'); rect(c, x + 8, ly + 5, 12, 2, '#4a2e1a');
    glow(c, x + 14, ly, 10, '#fff4c8', 0.7 * fl, true);
  }
  // glowing mushrooms pulse
  for (const [i, x] of [POSTS[0] + 10, POSTS[2] - 12, POSTS[3] + 10].entries()) {
    glow(c, x + 3, B_FLOOR - 6, 14, '#7ad8c8', 0.25 + 0.15 * Math.sin(t * 1.4 + i * 2), true);
  }
}

// --- stations --------------------------------------------------------------------------------

const STATION_NAMES: Record<ActivityId, string> = {
  feed: 'Snack Bar', wheel: 'Hamster Wheel', dig: 'Treasure Tunnels', nap: 'Cozy Nest', play: 'Ball Pit',
};
/** The station's sign text: the activity's name from content, read at draw time. */
function stationName(id: ActivityId): string {
  const def = (ACTIVITIES as Partial<Record<ActivityId, { name?: string }>>)[id];
  return def && def.name ? def.name : STATION_NAMES[id];
}

function stationSign(c: Ctx, cx: number, y: number, text: string): void {
  const B = BURROW;
  const w = text.length * 6 + 7;
  line(c, cx - w / 2 + 6, y - 6, cx - w / 2 + 6, y, '#3a2418', 1);
  line(c, cx + w / 2 - 6, y - 6, cx + w / 2 - 6, y, '#3a2418', 1);
  rrect(c, cx - w / 2, y, w, 11, 2, B.woodL, B.woodD, 1);
  rect(c, cx - w / 2 + 1, y + 1, w - 2, 1, mix(B.woodL, '#ffffff', 0.3));
  drawText(c, text, cx, y + 2, { size: 1, color: '#3a2010', align: 'center', shadow: false });
}

function jar(c: Ctx, x: number, y: number, w: number, h: number, lid: string, fill: (cx: number, cy: number) => void): void {
  c.save();
  pathRrect(c, x, y, w, h, 4);
  c.clip();
  fill(x + w / 2, y);
  c.restore();
  rrect(c, x, y, w, h, 4, rgba('#d8f0ff', 0.25), rgba(INK, 0.6), 1);
  rect(c, x + 3, y + 3, 2, h - 6, rgba('#ffffff', 0.45));
  rrect(c, x - 1, y - 4, w + 2, 6, 2, lid, shade(lid, 0.6), 1);
  rect(c, x + 3, y + h * 0.45, w - 6, 6, '#f4ecd8');
}

function stationFeed(c: Ctx, b: { x: number; y: number; w: number; h: number }, t: number, busy: boolean): void {
  const B = BURROW;
  const cx = b.x + b.w / 2, base = b.y + b.h;
  // shelf with seed jars
  const sy = b.y + 50;
  rect(c, b.x + 6, sy, b.w - 12, 5, B.wood); rect(c, b.x + 6, sy, b.w - 12, 1, B.woodL);
  poly(c, [b.x + 14, sy + 5, b.x + 18, sy + 11, b.x + 22, sy + 5], B.woodD);
  poly(c, [b.x + b.w - 22, sy + 5, b.x + b.w - 18, sy + 11, b.x + b.w - 14, sy + 5], B.woodD);
  jar(c, b.x + 10, sy - 26, 22, 26, '#d84a4a', (jx, jy) => {
    rect(c, jx - 12, jy + 8, 24, 20, '#e8d4a0');
    for (let i = 0; i < 10; i++) ellipse(c, jx - 8 + (i % 4) * 5, jy + 11 + Math.floor(i / 4) * 5, 1.6, 2.4, i % 2 ? '#3a2a1e' : '#f4ecd8');
  });
  jar(c, b.x + 37, sy - 30, 24, 30, '#4a8ad8', (jx, jy) => {
    for (let i = 0; i < 14; i++) circle(c, jx - 9 + (i % 4) * 6, jy + 12 + Math.floor(i / 4) * 5, 2.6, i % 3 ? '#4a5ad0' : '#6a7ae8');
  });
  jar(c, b.x + 66, sy - 24, 20, 24, '#6ac04a', (jx, jy) => {
    for (let i = 0; i < 4; i++) poly(c, [jx - 8 + i * 5, jy + 26, jx - 6 + i * 5, jy + 8, jx - 4 + i * 5, jy + 26], '#ff8a2a', '#c05a1a', 0.5);
  });
  // a dragonfruit, the fanciest snack in the burrow
  const dfx = b.x + 95, dfy = sy - 8;
  for (const [dx, dy] of [[-6, -4], [6, -4], [-4, -9], [4, -9], [0, -11]] as const) poly(c, [dfx + dx * 0.6, dfy + dy * 0.4, dfx + dx, dfy + dy, dfx + dx * 0.3, dfy + dy * 0.8], '#6ac04a');
  ellipse(c, dfx, dfy, 7, 8, '#ff4a8a', '#a02a5a', 1);
  ellipse(c, dfx - 2, dfy - 3, 2, 2.5, rgba('#ffffff', 0.5));
  // trough full of seeds on little legs
  const ty = base - 30;
  rect(c, b.x + 14, ty + 14, 4, 16, B.woodD); rect(c, b.x + b.w - 18, ty + 14, 4, 16, B.woodD);
  ellipse(c, cx, base + 1, b.w * 0.45, 4, rgba('#000000', 0.2));
  c.beginPath();
  c.moveTo(b.x + 6, ty); c.lineTo(b.x + b.w - 6, ty); c.lineTo(b.x + b.w - 12, ty + 18); c.lineTo(b.x + 12, ty + 18); c.closePath();
  c.fillStyle = B.wood; c.fill(); c.strokeStyle = B.woodD; c.lineWidth = 1.5; c.stroke();
  rect(c, b.x + 10, ty + 7, b.w - 20, 2, B.woodD);
  c.beginPath(); c.ellipse(cx, ty, (b.w - 12) / 2, 4, 0, 0, TAU); c.fillStyle = '#e8d4a0'; c.fill();
  for (let i = 0; i < 16; i++) ellipse(c, b.x + 12 + i * 5, ty - 1 + (i % 2), 1.4, 2.2, i % 3 ? '#3a2a1e' : '#f4ecd8');
  // a carrot and a blueberry bundle sticking out
  poly(c, [cx + 18, ty - 2, cx + 30, ty - 16, cx + 23, ty], '#ff8a2a', '#c05a1a', 0.5);
  line(c, cx + 30, ty - 16, cx + 33, ty - 22, '#4a9a3a', 2); line(c, cx + 30, ty - 16, cx + 35, ty - 18, '#4a9a3a', 2);
  circle(c, cx - 22, ty - 3, 3, '#4a5ad0'); circle(c, cx - 17, ty - 4, 3, '#5a6ae0'); circle(c, cx - 20, ty - 7, 3, '#4a5ad0');
  // a cheese cube on the end of the trough
  poly(c, [b.x + 16, ty - 1, b.x + 28, ty - 1, b.x + 28, ty - 9, b.x + 20, ty - 12, b.x + 16, ty - 9], '#ffd24a', '#b88a1a', 1);
  circle(c, b.x + 20, ty - 5, 1.3, '#d8a82a'); circle(c, b.x + 25, ty - 7, 1, '#d8a82a');
  stationSign(c, cx, b.y + 4, stationName('feed'));
  if (busy) {
    for (let i = 0; i < 5; i++) {
      const u = (t * 1.8 + i / 5) % 1;
      const sx = cx - 20 + i * 10 + (u - 0.5) * 8 * (i % 2 ? 1 : -1);
      const syy = ty - 4 - Math.sin(u * Math.PI) * 16;
      ellipse(c, sx, syy, 1.4, 2.2, i % 2 ? '#3a2a1e' : '#f4ecd8');
    }
  }
}

function stationWheel(c: Ctx, b: { x: number; y: number; w: number; h: number }, t: number, busy: boolean): void {
  const B = BURROW;
  const cx = b.x + b.w / 2, base = b.y + b.h;
  const wy = b.y + 78, R = 54, r = 48;
  const rim = '#e2574c', rimD = '#9a2a2a', rimL = '#ff9a7a';
  const ang = busy ? t * 7 : Math.sin(t * 0.7) * 0.04;
  ellipse(c, cx, base + 1, 50, 5, rgba('#000000', 0.22));
  // back rim (depth)
  circle(c, cx + 5, wy - 2, R, null, rimD, 2.5);
  // rungs connecting front and back rims
  for (let k = 0; k < 28; k++) {
    const a = ang + (k / 28) * TAU;
    const x0 = cx + Math.cos(a) * (R - 2), y0 = wy + Math.sin(a) * (R - 2);
    line(c, x0, y0, x0 + 5, y0 - 2, '#d8d0c8', 1.5);
  }
  // A-frame stand
  c.lineCap = 'round';
  for (const dx of [-38, 38]) {
    line(c, cx, wy, cx + dx, base - 2, B.woodD, 7);
    line(c, cx, wy, cx + dx, base - 2, B.wood, 4.5);
  }
  rrect(c, cx - 48, base - 6, 96, 6, 2, B.wood, B.woodD, 1);
  // front rim and spokes
  c.lineWidth = R - r;
  c.strokeStyle = rimD;
  c.beginPath(); c.arc(cx, wy, (R + r) / 2, 0, TAU); c.lineWidth = R - r + 2; c.stroke();
  c.strokeStyle = rim; c.lineWidth = R - r - 1;
  c.beginPath(); c.arc(cx, wy, (R + r) / 2, 0, TAU); c.stroke();
  c.strokeStyle = rimL; c.lineWidth = 1.5;
  c.beginPath(); c.arc(cx, wy, R - 1.5, Math.PI * 1.05, Math.PI * 1.6); c.stroke();
  for (let k = 0; k < 6; k++) {
    const a = ang + (k / 6) * TAU;
    line(c, cx + Math.cos(a) * 6, wy + Math.sin(a) * 6, cx + Math.cos(a) * r, wy + Math.sin(a) * r, '#c8c0c8', 2);
  }
  // rim bolts show the spin
  for (let k = 0; k < 8; k++) {
    const a = ang + (k / 8) * TAU + 0.2;
    circle(c, cx + Math.cos(a) * (R + r) / 2, wy + Math.sin(a) * (R + r) / 2, 1.3, '#ffd0c0');
  }
  circle(c, cx, wy, 7, '#d8d0d8', rgba(INK, 0.7), 1);
  circle(c, cx, wy, 2.5, '#6a6a7a');
  if (busy) {
    c.strokeStyle = rgba('#ffffff', 0.5); c.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      const a = ang * 0.2 + k * 2.1;
      c.beginPath(); c.arc(cx, wy, R + 6, a, a + 0.6); c.stroke();
    }
  }
  stationSign(c, cx, b.y + 4, stationName('wheel'));
}

function stationDig(c: Ctx, b: { x: number; y: number; w: number; h: number }, t: number, busy: boolean): void {
  const B = BURROW;
  const cx = b.x + b.w / 2, base = b.y + b.h;
  // tunnel mouth with a mine frame
  const mx = cx + 14, mTop = b.y + 32, mw = 62;
  c.fillStyle = vg(c, mTop, base, [0, '#140a06'], [1, '#2a1810']);
  c.beginPath(); c.moveTo(mx - mw / 2, base); c.lineTo(mx - mw / 2, mTop + 24);
  c.quadraticCurveTo(mx - mw / 2, mTop, mx, mTop); c.quadraticCurveTo(mx + mw / 2, mTop, mx + mw / 2, mTop + 24);
  c.lineTo(mx + mw / 2, base); c.closePath(); c.fill();
  // rails disappearing into the dark
  line(c, mx - 12, base, mx - 4, base - 30, '#6a6a7a', 1.5);
  line(c, mx + 12, base, mx + 4, base - 30, '#6a6a7a', 1.5);
  for (let k = 0; k < 4; k++) { const y = base - 4 - k * 8; const s = 1 - k * 0.2; rect(c, mx - 14 * s, y, 28 * s, 2, B.woodD); }
  // a lantern glowing inside the tunnel
  const fl = 0.8 + 0.2 * Math.sin(t * 7) * Math.sin(t * 3.1);
  glow(c, mx + 10, mTop + 28, 24 * fl, BURROW.lamp, 0.4, true);
  rrect(c, mx + 7, mTop + 24, 6, 8, 1, '#ffe7a0', '#4a2e1a', 1);
  // timber frame
  for (const dx of [-mw / 2 - 2, mw / 2 - 4]) { rect(c, mx + dx, mTop + 10, 6, base - mTop - 10, B.wood); rect(c, mx + dx, mTop + 10, 2, base - mTop - 10, B.woodL); }
  rrect(c, mx - mw / 2 - 6, mTop + 6, mw + 12, 8, 2, B.wood, B.woodD, 1);
  // dirt pile with a pickaxe and a glinting gem
  const px = b.x + 26, py = base - 2;
  c.beginPath(); c.ellipse(px, py, 28, 20, 0, Math.PI, TAU); c.closePath();
  c.fillStyle = '#7a4a2a'; c.fill(); c.strokeStyle = '#4a2a16'; c.lineWidth = 1; c.stroke();
  for (let i = 0; i < 8; i++) circle(c, px - 18 + rnd(i, 251) * 36, py - 3 - rnd(i, 252) * 12, 1.5 + rnd(i, 253) * 1.5, rnd(i, 254) > 0.5 ? '#5a3420' : '#9a6a44');
  c.save(); c.translate(px + 6, py - 18); c.rotate(-0.5 + (busy ? Math.sin(t * 10) * 0.25 : 0));
  rect(c, -1.5, -2, 3, 28, B.woodL);
  c.beginPath(); c.moveTo(-14, -2); c.quadraticCurveTo(0, -9, 14, -2); c.lineTo(12, 0); c.quadraticCurveTo(0, -5, -12, 0); c.closePath();
  c.fillStyle = '#b8c0cc'; c.fill(); c.strokeStyle = '#4a4a5a'; c.lineWidth = 1; c.stroke();
  c.restore();
  const gx = px - 12, gy = py - 14;
  poly(c, [gx - 5, gy, gx, gy - 6, gx + 5, gy, gx, gy + 5], '#5ad8f0', '#1a6a8a', 1);
  poly(c, [gx - 5, gy, gx, gy - 6, gx, gy], '#c8f4ff');
  const tw = Math.max(0, Math.sin(t * 2.4));
  if (tw > 0.6) {
    c.fillStyle = rgba('#ffffff', (tw - 0.6) * 2.5);
    pathStar(c, gx + 2, gy - 4, 6, 1.2, 4, 0); c.fill();
  }
  stationSign(c, cx, b.y + 4, stationName('dig'));
  if (busy) {
    for (let i = 0; i < 6; i++) {
      const u = (t * 1.6 + i / 6) % 1;
      const dxx = mx - 10 - u * 60 - i * 3;
      const dyy = base - 20 - Math.sin(u * Math.PI) * 30 + u * 14;
      circle(c, dxx, dyy, 2 + (i % 3), i % 2 ? '#7a4a2a' : '#9a6a44');
    }
  }
}

function stationNap(c: Ctx, b: { x: number; y: number; w: number; h: number }, t: number, busy: boolean): void {
  const B = BURROW;
  const cx = b.x + b.w / 2, base = b.y + b.h;
  const ny = base - 16;
  ellipse(c, cx, base, 58, 6, rgba('#000000', 0.22));
  // straw mound
  ellipse(c, cx, ny, 56, 18, '#c89a42', '#7a5a1e', 1);
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * TAU;
    const x0 = cx + Math.cos(a) * 50, y0 = ny + Math.sin(a) * 15;
    const len = 5 + rnd(i, 261) * 6;
    const d = a + (rnd(i, 262) - 0.5) * 1.4;
    line(c, x0, y0, x0 + Math.cos(d) * len, y0 + Math.sin(d) * len * 0.5, i % 3 ? B.straw : '#f4dc8a', 1);
  }
  ellipse(c, cx, ny - 3, 46, 12, '#e0b85a');
  // pillow
  const breathe = busy ? Math.sin(t * 2) * 1.2 : 0;
  rrect(c, cx - 42, ny - 15, 30, 16, 7, '#f4f0ff', '#8a8aa8', 1);
  line(c, cx - 38, ny - 7, cx - 16, ny - 7, rgba('#8a8aa8', 0.5), 1);
  // patchwork quilt
  c.save();
  c.beginPath();
  c.moveTo(cx - 14, ny - 10 - breathe); c.quadraticCurveTo(cx + 12, ny - 18 - breathe, cx + 44, ny - 8);
  c.quadraticCurveTo(cx + 48, ny + 6, cx + 30, ny + 10); c.lineTo(cx - 10, ny + 10);
  c.quadraticCurveTo(cx - 20, ny + 2, cx - 14, ny - 10 - breathe); c.closePath();
  c.save(); c.clip();
  const patches = ['#e86a6a', '#ffd86a', '#6ab0e8', '#8ad87a', '#f0a0d8', '#ffffff'];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) rect(c, cx - 20 + i * 11, ny - 22 + j * 11, 11, 11, patches[(i + j * 2) % patches.length]);
  c.strokeStyle = rgba('#ffffff', 0.7); c.lineWidth = 1; c.setLineDash([2, 2]);
  for (let i = 0; i < 7; i++) { c.beginPath(); c.moveTo(cx - 20 + i * 11, ny - 22); c.lineTo(cx - 20 + i * 11, ny + 12); c.stroke(); }
  for (let j = 0; j < 4; j++) { c.beginPath(); c.moveTo(cx - 20, ny - 22 + j * 11); c.lineTo(cx + 50, ny - 22 + j * 11); c.stroke(); }
  c.setLineDash([]);
  c.restore();
  c.strokeStyle = rgba(INK, 0.6); c.lineWidth = 1; c.stroke();
  c.restore();
  // a little star mobile hanging above
  const my = b.y + 22;
  line(c, cx + 30, b.y + 14, cx + 30, my, '#3a2418', 1);
  const spin = Math.sin(t * 0.8) * 0.4;
  line(c, cx + 30 - 14 * Math.cos(spin), my, cx + 30 + 14 * Math.cos(spin), my, '#6a4a2a', 1);
  for (const [k, dx] of [-14, 14].entries()) {
    const sx = cx + 30 + dx * Math.cos(spin);
    line(c, sx, my, sx, my + 8 + k * 4, '#3a2418', 1);
    c.fillStyle = k ? '#ffd84a' : '#bfe0ff';
    pathStar(c, sx, my + 12 + k * 4, 4.5, 2, 5, -Math.PI / 2); c.fill();
  }
  stationSign(c, cx - 14, b.y + 4, stationName('nap'));
  if (busy) {
    for (let i = 0; i < 3; i++) {
      const u = (t * 0.5 + i / 3) % 1;
      drawText(c, 'Z', cx - 26 + u * 18 + Math.sin(u * 6) * 3, ny - 20 - u * 34, { size: 1 + (i % 2), color: '#ffffff', alpha: 1 - u, shadow: true, shadowColor: '#3a2a5a' });
    }
  }
}

function stationPlay(c: Ctx, b: { x: number; y: number; w: number; h: number }, t: number, busy: boolean): void {
  const cx = b.x + b.w / 2, base = b.y + b.h;
  const BALLS = ['#ff5a6a', '#ffd24a', '#4aa8ff', '#6ad46a', '#ff8ad8', '#ff9a3a'];
  const top = base - 40;
  ellipse(c, cx, base + 1, 52, 5, rgba('#000000', 0.22));
  // back rim
  ellipse(c, cx, top, 46, 9, '#2a6a8a', rgba(INK, 0.6), 1);
  // heap of balls
  for (let i = 0; i < 44; i++) {
    const row = Math.floor(i / 11), col = i % 11;
    const bx = cx - 40 + col * 8 + (row % 2) * 4;
    const by = top - 4 + row * 5 - Math.sin((col / 10) * Math.PI) * 8;
    circle(c, bx, by, 4.5, BALLS[(i * 7 + row) % BALLS.length], rgba(INK, 0.4), 0.5);
    circle(c, bx - 1.3, by - 1.5, 1.2, rgba('#ffffff', 0.7));
  }
  // padded front wall
  c.save();
  pathRrect(c, cx - 48, top + 6, 96, base - top - 6, 6);
  c.clip();
  rect(c, cx - 48, top + 6, 96, base - top - 6, '#3ab0c8');
  for (let i = 0; i < 6; i++) rect(c, cx - 48 + i * 16 + 8, top + 6, 8, base - top - 6, '#ffd24a');
  rect(c, cx - 48, top + 6, 96, 3, rgba('#ffffff', 0.35));
  rect(c, cx - 48, base - 5, 96, 5, rgba('#000000', 0.2));
  c.restore();
  rrect(c, cx - 48, top + 6, 96, base - top - 6, 6, null, rgba(INK, 0.7), 1);
  // a little ladder at the side
  line(c, cx + 50, base, cx + 46, top - 6, '#c88a52', 2); line(c, cx + 58, base, cx + 54, top - 6, '#c88a52', 2);
  for (let k = 0; k < 4; k++) { const y = base - 6 - k * 11; line(c, cx + 49 - k, y, cx + 57 - k, y, '#c88a52', 1.5); }
  stationSign(c, cx - 4, b.y + 4, stationName('play'));
  const n = busy ? 5 : 1;
  for (let i = 0; i < n; i++) {
    const u = ((busy ? t * 1.4 : t * 0.25) + i / n) % 1;
    const bx = cx - 30 + i * 15 + (u - 0.5) * 12;
    const by = top - 8 - Math.sin(u * Math.PI) * (busy ? 30 : 8);
    if (!busy && u > 0.5) continue;
    circle(c, bx, by, 4.5, BALLS[(i + 2) % BALLS.length], rgba(INK, 0.4), 0.5);
    circle(c, bx - 1.3, by - 1.5, 1.2, rgba('#ffffff', 0.7));
  }
}

/** One Burrow station in its STATIONS box. `highlight` adds a soft glow and outline; `busy` animates it in use. */
export function drawStation(ctx: Ctx, id: ActivityId, t: number, opts: { highlight?: boolean; busy?: boolean } = {}): void {
  const b = STATIONS[id];
  if (!b) return;
  const busy = !!opts.busy;
  ctx.save();
  if (opts.highlight) {
    const pulse = 0.75 + 0.25 * Math.sin(t * 4);
    glow(ctx, b.x + b.w / 2, b.y + b.h * 0.55, Math.max(b.w, b.h) * 0.75, '#ffd98a', 0.3 * pulse, true);
  }
  switch (id) {
    case 'feed': stationFeed(ctx, b, t, busy); break;
    case 'wheel': stationWheel(ctx, b, t, busy); break;
    case 'dig': stationDig(ctx, b, t, busy); break;
    case 'nap': stationNap(ctx, b, t, busy); break;
    case 'play': stationPlay(ctx, b, t, busy); break;
    default: break;
  }
  if (opts.highlight) {
    const pulse = 0.6 + 0.4 * Math.sin(t * 4);
    rrect(ctx, b.x - 2, b.y - 2, b.w + 4, b.h + 6, 8, null, rgba('#ffe9a8', 0.85 * pulse), 1);
    const ay = b.y - 12 + Math.sin(t * 5) * 2.5;
    poly(ctx, [b.x + b.w / 2 - 6, ay, b.x + b.w / 2 + 6, ay, b.x + b.w / 2, ay + 7], '#ffe9a8', rgba(INK, 0.8), 1);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Title screen
// ---------------------------------------------------------------------------------------------

const TITLE_DOOR = { x: 486, y: 262 };

function hillFar(x: number): number { return 214 + Math.sin(x * 0.012 + 1) * 10 + Math.sin(x * 0.031) * 4; }
function hillMid(x: number): number { return 246 + Math.sin(x * 0.009 + 2.5) * 16 + Math.sin(x * 0.027 + 1) * 5; }
function hillNear(x: number): number {
  const bump = Math.exp(-Math.pow((x - TITLE_DOOR.x) / 120, 2)) * 52;
  return 312 - bump + Math.sin(x * 0.02) * 4;
}

function hillPath(c: Ctx, f: (x: number) => number): void {
  c.beginPath(); c.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) c.lineTo(x, f(x));
  c.lineTo(W, H); c.closePath();
}

/** The title screen: a starry night over rolling hills and the burrow's glowing round door. */
export function drawTitleBackdrop(ctx: Ctx, t: number): void {
  ctx.save();
  layer(ctx, 'title-sky', 0, 0, W, 260, titleSky);
  titleStars(ctx, t);
  layer(ctx, 'title-hills', 0, 180, W, H - 180, titleHills);
  titleAnim(ctx, t);
  ctx.restore();
}

function titleSkyGradient(c: Ctx): CanvasGradient {
  return vg(c, 0, 260, [0, '#0c0922'], [0.45, '#1c1850'], [0.8, '#3a2a6a'], [1, '#6a4a7c']);
}

function titleSky(c: Ctx): void {
  c.fillStyle = titleSkyGradient(c);
  c.fillRect(0, 0, W, 260);
  // crescent moon: the bite is plain sky, so it goes in before the haze and stars
  circle(c, 572, 54, 19, '#fff4cc');
  c.fillStyle = titleSkyGradient(c);
  c.beginPath(); c.arc(581, 48, 17, 0, TAU); c.fill();
  // a faint band of the galaxy
  c.save();
  c.translate(320, 120); c.rotate(-0.35);
  const g = c.createLinearGradient(0, -40, 0, 40);
  g.addColorStop(0, rgba('#8a7ad8', 0)); g.addColorStop(0.5, rgba('#8a7ad8', 0.12)); g.addColorStop(1, rgba('#8a7ad8', 0));
  c.fillStyle = g; c.fillRect(-420, -40, 840, 80);
  c.restore();
  for (let i = 0; i < 160; i++) {
    const x = rnd(i, 301) * W, y = rnd(i, 302) * 200;
    if (Math.hypot(x - 572, y - 54) < 21) continue;
    c.fillStyle = rgba('#ffffff', 0.15 + rnd(i, 303) * 0.25);
    c.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  glow(c, 572, 54, 64, '#fff2c0', 0.16);
  // soft clouds low on the horizon
  for (let i = 0; i < 6; i++) {
    const x = 40 + i * 118 + rnd(i, 341) * 30, y = 196 + (i % 2) * 9;
    cloud(c, x, y, 64 + rnd(i, 342) * 34, '#54417c', '#47366c');
  }
}

function titleStars(c: Ctx, t: number): void {
  for (let i = 0; i < 46; i++) {
    const x = rnd(i, 311) * W, y = 8 + rnd(i, 312) * 180;
    if (x > 520 && y < 100 && Math.hypot(x - 572, y - 54) < 34) continue;
    const tw = 0.5 + 0.5 * Math.sin(t * (0.8 + rnd(i, 313) * 1.8) + i * 1.3);
    const big = rnd(i, 314) > 0.75;
    const col = ['#ffffff', '#fff0b0', '#c8d8ff'][i % 3];
    c.fillStyle = rgba(col, 0.3 + 0.7 * tw);
    const sx = Math.round(x), sy = Math.round(y);
    c.fillRect(sx, sy, 1, 1);
    if (big) {
      c.fillStyle = rgba(col, 0.6 * tw);
      c.fillRect(sx - 1, sy, 3, 1); c.fillRect(sx, sy - 1, 1, 3);
      if (tw > 0.85) { c.fillStyle = rgba(col, 0.4 * tw); c.fillRect(sx - 3, sy, 7, 1); c.fillRect(sx, sy - 3, 1, 7); }
    }
  }
  // a shooting star every few seconds
  const cyc = t % 7;
  if (cyc < 0.9) {
    const u = cyc / 0.9;
    const sx = 120 + u * 260, sy = 30 + u * 60;
    c.save(); c.globalCompositeOperation = 'lighter';
    const g = c.createLinearGradient(sx - 50, sy - 12, sx, sy);
    g.addColorStop(0, rgba('#ffffff', 0)); g.addColorStop(1, rgba('#ffffff', 0.8 * Math.sin(u * Math.PI)));
    c.strokeStyle = g; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(sx - 50, sy - 12); c.lineTo(sx, sy); c.stroke();
    c.restore();
  }
}

function titleHills(c: Ctx): void {
  hillPath(c, hillFar); c.fillStyle = '#2a2656'; c.fill();
  // tree silhouettes on the far ridge
  for (const [x, s] of [[60, 1], [84, 0.7], [250, 0.8], [600, 0.9]] as const) {
    const y = hillFar(x);
    c.fillStyle = '#211e48';
    c.beginPath(); c.arc(x, y - 12 * s, 11 * s, 0, TAU); c.arc(x - 7 * s, y - 6 * s, 8 * s, 0, TAU); c.arc(x + 7 * s, y - 6 * s, 8 * s, 0, TAU); c.fill();
    rect(c, x - 1.5, y - 4, 3, 6, '#211e48');
  }
  hillPath(c, hillMid); c.fillStyle = vg(c, 220, H, [0, '#21385a'], [1, '#162438']); c.fill();
  hillPath(c, hillNear); c.fillStyle = vg(c, 250, H, [0, '#1f4a44'], [1, '#12302c']); c.fill();
  // rim light from the moon on the near hill
  c.strokeStyle = rgba('#8ad0b0', 0.35); c.lineWidth = 1.5;
  c.beginPath(); for (let x = 0; x <= W; x += 8) c.lineTo(x, hillNear(x)); c.stroke();
  // grass tufts
  for (let i = 0; i < 40; i++) {
    const x = rnd(i, 321) * W, y = hillNear(x) + 2 + rnd(i, 322) * 30;
    c.strokeStyle = rgba('#3a7a5a', 0.8); c.lineWidth = 1;
    c.beginPath(); c.moveTo(x - 2, y); c.lineTo(x - 3, y - 4); c.moveTo(x, y); c.lineTo(x, y - 5); c.moveTo(x + 2, y); c.lineTo(x + 3, y - 4); c.stroke();
  }
  const { x: dx, y: dy } = TITLE_DOOR;
  // stepping-stone path down from the door
  for (let k = 0; k < 6; k++) {
    const u = k / 5;
    const sx = dx - 10 - u * 120 + Math.sin(u * 4) * 14, sy = dy + 28 + u * 64;
    ellipse(c, sx, sy, 9 + u * 6, 3 + u * 2, '#4a5a6a', rgba('#000000', 0.3), 1);
    ellipse(c, sx - 2, sy - 1, 5 + u * 3, 1.5 + u, rgba('#ffffff', 0.12));
  }
  // stone ring and round door
  circle(c, dx, dy, 30, '#5a5a6e', '#2a2a3a', 1.5);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    line(c, dx + Math.cos(a) * 25, dy + Math.sin(a) * 25, dx + Math.cos(a) * 30, dy + Math.sin(a) * 30, '#3a3a4a', 1);
  }
  circle(c, dx, dy, 24, '#8a4a2a', '#3a1e10', 1.5);
  c.save(); c.beginPath(); c.arc(dx, dy, 24, 0, TAU); c.clip();
  for (let x = dx - 24; x < dx + 24; x += 8) rect(c, x, dy - 24, 1, 48, '#5a2e16');
  c.restore();
  circle(c, dx, dy, 22, null, '#c8783a', 0.5);
  circle(c, dx + 9, dy + 2, 2.5, '#e8c84a', '#6a4a10', 0.8);
  // flat ground step and its sill
  ellipse(c, dx, dy + 26, 26, 4, '#3a3a4a');
  // small round window beside the door
  circle(c, dx - 52, dy - 4, 9, '#5a5a6e', '#2a2a3a', 1.5);
  circle(c, dx - 52, dy - 4, 6.5, '#ffd27a');
  line(c, dx - 58.5, dy - 4, dx - 45.5, dy - 4, '#6a3a1a', 1.5); line(c, dx - 52, dy - 10.5, dx - 52, dy + 2.5, '#6a3a1a', 1.5);
  // lantern post
  rect(c, dx + 44, dy - 16, 3, 40, '#2a2a3a');
  rect(c, dx + 40, dy - 18, 11, 3, '#2a2a3a');
  rrect(c, dx + 41, dy - 15, 9, 10, 2, '#ffe7a0', '#2a2a3a', 1);
  // the sign that keeps the burrow secret
  const sx = 586, sy = hillNear(586) - 6;
  rect(c, sx - 1.5, sy - 18, 3, 26, '#4a2e1a');
  rrect(c, sx - 36, sy - 30, 72, 22, 2, '#8a5a32', '#3a2010', 1);
  drawText(c, 'NOTHING TO', sx, sy - 27, { size: 1, color: '#f4e4c0', align: 'center', shadow: false });
  drawText(c, 'SEE HERE', sx, sy - 18, { size: 1, color: '#f4e4c0', align: 'center', shadow: false });
  // bushes
  for (const [x, r] of [[30, 16], [140, 12], [404, 10], [628, 14]] as const) {
    const y = hillNear(x) + 6;
    c.fillStyle = '#163a34';
    c.beginPath(); c.arc(x, y - r * 0.6, r, Math.PI, TAU); c.arc(x + r * 0.9, y - r * 0.3, r * 0.7, Math.PI, TAU); c.fill();
  }
}

function titleAnim(c: Ctx, t: number): void {
  const { x: dx, y: dy } = TITLE_DOOR;
  const pulse = 0.85 + 0.15 * Math.sin(t * 1.6);
  glow(c, dx, dy, 90 * pulse, '#ffb85a', 0.22, true);
  glow(c, dx - 52, dy - 4, 26 * pulse, '#ffd27a', 0.35, true);
  glow(c, dx + 45, dy - 10, 22 * pulse, '#ffe7a0', 0.45, true);
  // warm light leaking around the door's edge
  c.save(); c.globalCompositeOperation = 'lighter';
  c.strokeStyle = rgba('#ffcf7a', 0.55 * pulse); c.lineWidth = 2;
  c.beginPath(); c.arc(dx, dy, 24.5, 0, TAU); c.stroke();
  c.restore();
  // fireflies
  for (let i = 0; i < 14; i++) {
    const bx = rnd(i, 331) * W, by = 230 + rnd(i, 332) * 100;
    const x = bx + Math.sin(t * (0.3 + rnd(i, 333) * 0.4) + i) * 20;
    const y = by + Math.sin(t * (0.5 + rnd(i, 334) * 0.5) + i * 2) * 10;
    const on = 0.5 + 0.5 * Math.sin(t * (1.5 + rnd(i, 335)) + i * 3);
    if (on < 0.2) continue;
    glow(c, x, y, 6, '#d8ff7a', 0.5 * on, true);
    c.fillStyle = rgba('#f4ffc0', on);
    c.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
}

// ---------------------------------------------------------------------------------------------
// Mission map blueprints
// ---------------------------------------------------------------------------------------------

/** A stylised blueprint of `loc` for the mission path screen (calm, so the node trail reads on top). */
export function drawMapBackdrop(ctx: Ctx, loc: LocationDef, t: number): void {
  const p = pal(loc);
  ctx.save();
  layer(ctx, 'map-' + loc.id + palKey(p), 0, 0, W, H, (g) => mapStatic(g, loc, p));
  mapAnim(ctx, p, t);
  ctx.restore();
}

function mapColors(p: Pal) {
  const paper = mix('#173a63', p.sky, 0.22);
  return {
    paper,
    paperD: shade(paper, 0.75),
    ink: mix('#d8ecff', p.accent, 0.1),
    faint: rgba(mix('#d8ecff', p.accent, 0.1), 0.35),
    fill: rgba('#d8ecff', 0.07),
    accent: mix(p.accent, '#ffd24a', 0.3),
  };
}

function mapStatic(c: Ctx, loc: LocationDef, p: Pal): void {
  const m = mapColors(p);
  c.fillStyle = vg(c, 0, H, [0, shade(m.paper, 1.1)], [1, m.paperD]);
  c.fillRect(0, 0, W, H);
  // grid
  c.fillStyle = rgba('#ffffff', 0.05);
  for (let x = 0; x < W; x += 10) c.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 10) c.fillRect(0, y, W, 1);
  c.fillStyle = rgba('#ffffff', 0.08);
  for (let x = 0; x < W; x += 40) c.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 40) c.fillRect(0, y, W, 1);
  // vignette
  const g = c.createRadialGradient(320, 180, 120, 320, 180, 420);
  g.addColorStop(0, rgba('#000000', 0)); g.addColorStop(1, rgba('#000000', 0.35));
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.lineJoin = 'round'; c.lineCap = 'round';
  switch (loc.id) {
    case 'museum': mapMuseum(c, m); break;
    case 'docks': mapDocks(c, m); break;
    case 'zoo': mapZoo(c, m); break;
    case 'tower': mapTower(c, m); break;
    case 'lab': mapLab(c, m); break;
    default: mapMuseum(c, m); break;
  }
  // border frame with tick marks
  c.strokeStyle = m.faint; c.lineWidth = 1;
  c.strokeRect(6.5, 6.5, W - 13, H - 13);
  c.strokeRect(10.5, 10.5, W - 21, H - 21);
  for (let x = 20; x < W - 10; x += 20) { c.beginPath(); c.moveTo(x + 0.5, 6); c.lineTo(x + 0.5, x % 100 === 0 ? 14 : 10); c.moveTo(x + 0.5, H - 6); c.lineTo(x + 0.5, x % 100 === 0 ? H - 14 : H - 10); c.stroke(); }
  // compass rose
  const cx = 606, cy = 36;
  c.strokeStyle = m.faint; c.lineWidth = 1;
  c.beginPath(); c.arc(cx, cy, 11, 0, TAU); c.stroke();
  poly(c, [cx, cy - 17, cx + 3.5, cy, cx, cy + 3, cx - 3.5, cy], m.accent);
  poly(c, [cx, cy + 17, cx + 3.5, cy, cx, cy - 3, cx - 3.5, cy], m.faint);
  drawText(c, 'N', cx - 18, cy - 17, { size: 1, color: m.ink, align: 'center', shadow: false });
  // stamp
  c.save(); c.translate(70, 330); c.rotate(-0.12);
  rrect(c, -50, -10, 100, 18, 2, null, rgba('#ff6a6a', 0.55), 1);
  drawText(c, 'TOP SECRET', 0, -5, { size: 1, color: rgba('#ff6a6a', 0.7), align: 'center', shadow: false });
  c.restore();
}

interface MapInk { paper: string; paperD: string; ink: string; faint: string; fill: string; accent: string }

function label(c: Ctx, m: MapInk, text: string, x: number, y: number): void {
  drawText(c, text, x, y, { size: 1, color: m.faint, align: 'center', shadow: false });
}

function room(c: Ctx, m: MapInk, x: number, y: number, w: number, h: number): void {
  c.fillStyle = m.fill; c.fillRect(x, y, w, h);
  c.strokeStyle = m.ink; c.lineWidth = 2; c.strokeRect(x, y, w, h);
}

function hatch(c: Ctx, m: MapInk, x: number, y: number, w: number, h: number, step = 8): void {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.strokeStyle = m.faint; c.lineWidth = 1;
  c.beginPath();
  for (let s = -h; s < w; s += step) { c.moveTo(x + s, y + h); c.lineTo(x + s + h, y); }
  c.stroke();
  c.restore();
}

function mapMuseum(c: Ctx, m: MapInk): void {
  // outer walls and halls
  room(c, m, 40, 60, 560, 250);
  c.strokeStyle = m.ink; c.lineWidth = 2;
  c.beginPath();
  c.moveTo(220, 60); c.lineTo(220, 150); c.moveTo(220, 190); c.lineTo(220, 310);
  c.moveTo(420, 60); c.lineTo(420, 150); c.moveTo(420, 190); c.lineTo(420, 310);
  c.moveTo(40, 180); c.lineTo(120, 180); c.moveTo(150, 180); c.lineTo(220, 180);
  c.moveTo(420, 200); c.lineTo(500, 200); c.moveTo(530, 200); c.lineTo(600, 200);
  c.stroke();
  // columns in the grand hall
  for (let x = 250; x <= 390; x += 35) for (const y of [84, 286]) { c.beginPath(); c.arc(x, y, 5, 0, TAU); c.strokeStyle = m.ink; c.lineWidth = 1.5; c.stroke(); }
  // the skeleton, drawn as a little dino outline
  c.strokeStyle = m.ink; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(270, 200); c.quadraticCurveTo(300, 170, 340, 190); c.quadraticCurveTo(370, 200, 380, 215);
  c.moveTo(285, 195); c.quadraticCurveTo(275, 150, 262, 140); c.stroke();
  c.beginPath(); c.arc(258, 138, 5, 0, TAU); c.stroke();
  for (const x of [292, 304, 328, 340]) { c.beginPath(); c.moveTo(x, 190); c.lineTo(x, 210); c.stroke(); }
  c.strokeStyle = m.faint; c.setLineDash([3, 3]); c.strokeRect(250, 125, 140, 100); c.setLineDash([]);
  // display cases
  for (let i = 0; i < 4; i++) { c.strokeStyle = m.ink; c.lineWidth = 1.5; c.strokeRect(70 + i * 34, 90, 22, 14); c.strokeRect(450 + i * 34, 240, 22, 14); }
  hatch(c, m, 60, 220, 140, 70);
  // entrance steps
  for (let k = 0; k < 4; k++) { c.strokeStyle = m.faint; c.beginPath(); c.moveTo(280 + k * 3, 316 + k * 4); c.lineTo(360 - k * 3, 316 + k * 4); c.stroke(); }
  label(c, m, 'FOSSIL HALL', 320, 240);
  label(c, m, 'GEMS', 130, 120);
  label(c, m, 'STORES', 130, 200);
  label(c, m, 'EGYPT WING', 510, 120);
  label(c, m, 'GIFT SHOP', 510, 220);
  label(c, m, 'ENTRANCE', 320, 336);
}

function mapDocks(c: Ctx, m: MapInk): void {
  // water hatching below the shoreline
  c.strokeStyle = m.faint; c.lineWidth = 1;
  for (let y = 150; y < 340; y += 12) {
    c.beginPath();
    for (let x = 14; x < W - 14; x += 4) c.lineTo(x, y + Math.sin(x * 0.12 + y) * 2);
    c.stroke();
  }
  // quay and piers
  c.fillStyle = m.paper;
  c.fillRect(14, 14, W - 28, 126);
  c.strokeStyle = m.ink; c.lineWidth = 2;
  c.beginPath(); c.moveTo(14, 140); c.lineTo(W - 14, 140); c.stroke();
  for (const [x, len] of [[90, 120], [250, 160], [420, 110], [550, 140]] as const) {
    c.fillStyle = m.paper; c.fillRect(x - 14, 140, 28, len);
    c.strokeStyle = m.ink; c.strokeRect(x - 14, 140, 28, len);
    for (let y = 150; y < 140 + len; y += 10) { c.beginPath(); c.moveTo(x - 14, y); c.lineTo(x + 14, y); c.strokeStyle = m.faint; c.lineWidth = 1; c.stroke(); }
    c.lineWidth = 2;
  }
  // container stacks and warehouses
  for (let i = 0; i < 6; i++) room(c, m, 40 + i * 30, 40, 24, 12);
  for (let i = 0; i < 6; i++) room(c, m, 40 + i * 30, 60, 24, 12);
  room(c, m, 300, 30, 120, 70); hatch(c, m, 300, 30, 120, 70, 10);
  room(c, m, 450, 40, 80, 50);
  // cranes as X-marks on rails
  for (const x of [240, 460]) { c.strokeStyle = m.ink; c.lineWidth = 1.5; c.strokeRect(x - 10, 112, 20, 20); c.beginPath(); c.moveTo(x - 10, 112); c.lineTo(x + 10, 132); c.moveTo(x + 10, 112); c.lineTo(x - 10, 132); c.stroke(); }
  // ships moored at the piers
  for (const [x, y] of [[140, 220], [310, 250], [480, 200]] as const) {
    c.beginPath(); c.moveTo(x - 24, y - 10); c.lineTo(x + 16, y - 10); c.quadraticCurveTo(x + 30, y, x + 16, y + 10); c.lineTo(x - 24, y + 10); c.closePath();
    c.fillStyle = m.fill; c.fill(); c.strokeStyle = m.ink; c.lineWidth = 1.5; c.stroke();
  }
  // lighthouse
  c.beginPath(); c.arc(600, 300, 10, 0, TAU); c.strokeStyle = m.ink; c.stroke();
  c.beginPath(); c.arc(600, 300, 3, 0, TAU); c.fillStyle = m.accent; c.fill();
  label(c, m, 'WAREHOUSE 7', 360, 105);
  label(c, m, 'CONTAINERS', 115, 80);
  label(c, m, 'HARBOUR', 360, 324);
  label(c, m, 'PIER 3', 250, 306);
}

function mapZoo(c: Ctx, m: MapInk): void {
  // winding main path
  c.strokeStyle = m.ink; c.lineWidth = 2;
  const pathPts = spline([[30, 300], [140, 250], [200, 160], [320, 130], [440, 180], [520, 260], [610, 230]], 10);
  for (const off of [-8, 8]) {
    c.beginPath();
    for (const [i, [x, y]] of pathPts.entries()) { if (i === 0) c.moveTo(x, y + off); else c.lineTo(x, y + off); }
    c.stroke();
  }
  // enclosures
  const encl = (pts: number[], name: string, lx: number, ly: number) => {
    poly(c, pts, m.fill, null);
    c.strokeStyle = m.ink; c.lineWidth = 2; c.setLineDash([6, 3]);
    c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); c.stroke();
    c.setLineDash([]);
    label(c, m, name, lx, ly);
  };
  encl([40, 40, 170, 30, 190, 120, 70, 140], 'LIONS', 115, 84);
  encl([230, 30, 400, 30, 410, 100, 240, 104], 'GIRAFFES', 320, 62);
  encl([450, 44, 576, 52, 568, 150, 470, 140], 'PANDAS', 516, 94);
  encl([240, 200, 420, 210, 400, 300, 260, 300], 'PENGUINS', 330, 260);
  // pond
  c.beginPath(); c.ellipse(330, 240, 40, 16, 0, 0, TAU); c.strokeStyle = m.faint; c.lineWidth = 1; c.stroke();
  // trees as little circles
  for (let i = 0; i < 24; i++) {
    const x = 30 + rnd(i, 401) * 580, y = 160 + rnd(i, 402) * 170;
    if (x > 230 && x < 430 && y > 190 && y < 310) continue;
    c.beginPath(); c.arc(x, y, 5 + rnd(i, 403) * 4, 0, TAU); c.strokeStyle = m.faint; c.stroke();
  }
  // ticket booth at the gate
  room(c, m, 20, 286, 26, 22);
  label(c, m, 'GATE', 33, 316);
}

function mapTower(c: Ctx, m: MapInk): void {
  // an elevation drawing of the tower
  const x0 = 270, x1 = 370, top = 70, base = 330;
  room(c, m, x0, top, x1 - x0, base - top);
  c.strokeStyle = m.faint; c.lineWidth = 1;
  for (let y = top + 16; y < base; y += 16) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); }
  for (let x = x0 + 12; x < x1; x += 14) for (let y = top + 5; y < base - 8; y += 16) c.strokeRect(x, y, 6, 7);
  // lift shaft
  c.strokeStyle = m.ink; c.lineWidth = 1.5; c.setLineDash([4, 3]);
  c.strokeRect(312, top, 16, base - top); c.setLineDash([]);
  // roof, helipad and antenna
  c.strokeStyle = m.ink; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x0 - 10, top); c.lineTo(x1 + 10, top); c.stroke();
  c.beginPath(); c.moveTo(300, top); c.lineTo(320, 20); c.lineTo(340, top); c.moveTo(320, 20); c.lineTo(320, 10); c.stroke();
  for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(304 + k * 4, top - k * 12 - 4); c.lineTo(336 - k * 4, top - k * 12 - 4); c.stroke(); }
  // dimension lines
  c.strokeStyle = m.faint; c.lineWidth = 1;
  c.beginPath(); c.moveTo(400, top); c.lineTo(400, base); c.moveTo(395, top); c.lineTo(405, top); c.moveTo(395, base); c.lineTo(405, base); c.stroke();
  label(c, m, '300 M', 430, 196);
  // neighbouring buildings
  for (const [x, w, h] of [[40, 60, 120], [110, 50, 180], [170, 70, 90], [430, 60, 150], [500, 44, 200], [554, 60, 110]] as const) {
    c.strokeStyle = m.faint; c.lineWidth = 1.5; c.strokeRect(x, base - h, w, h);
    hatch(c, m, x, base - h, w, h, 12);
  }
  c.strokeStyle = m.ink; c.lineWidth = 2; c.beginPath(); c.moveTo(14, base); c.lineTo(W - 14, base); c.stroke();
  label(c, m, 'ROOF', 320, 56);
  label(c, m, 'LOBBY', 320, 316);
}

function mapLab(c: Ctx, m: MapInk): void {
  room(c, m, 40, 56, 536, 264);
  c.strokeStyle = m.ink; c.lineWidth = 2;
  c.beginPath();
  c.moveTo(200, 56); c.lineTo(200, 140); c.moveTo(200, 170); c.lineTo(200, 320);
  c.moveTo(440, 56); c.lineTo(440, 200); c.moveTo(440, 230); c.lineTo(440, 320);
  c.moveTo(200, 200); c.lineTo(300, 200); c.moveTo(330, 200); c.lineTo(440, 200);
  c.stroke();
  // tanks
  for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(240 + i * 50, 106, 16, 0, TAU); c.fillStyle = m.fill; c.fill(); c.strokeStyle = m.ink; c.lineWidth = 1.5; c.stroke(); c.beginPath(); c.arc(240 + i * 50, 106, 6, 0, TAU); c.strokeStyle = m.faint; c.stroke(); }
  // pipe runs
  c.strokeStyle = m.faint; c.lineWidth = 3;
  c.beginPath(); c.moveTo(40, 160); c.lineTo(180, 160); c.lineTo(180, 106); c.lineTo(224, 106); c.moveTo(356, 106); c.lineTo(520, 106); c.lineTo(520, 244); c.stroke();
  // server racks
  for (let i = 0; i < 5; i++) room(c, m, 452 + i * 24, 250, 16, 50);
  // hazard zone
  hatch(c, m, 60, 220, 120, 80, 6);
  c.strokeStyle = m.accent; c.lineWidth = 1.5; c.setLineDash([5, 4]); c.strokeRect(60, 220, 120, 80); c.setLineDash([]);
  label(c, m, 'TANK ROOM', 290, 150);
  label(c, m, 'HAZARD', 120, 210);
  label(c, m, 'SERVERS', 508, 236);
  label(c, m, 'ROBOT BAY', 320, 270);
  label(c, m, 'LOADING', 120, 74);
}

function mapAnim(c: Ctx, p: Pal, t: number): void {
  const m = mapColors(p);
  // a slow scanner line sweeping across the plan
  const u = (t * 0.12) % 1;
  const x = -40 + u * (W + 80);
  c.save(); c.globalCompositeOperation = 'lighter';
  c.fillStyle = hgrad(c, x - 40, x, [0, rgba(m.ink, 0)], [1, rgba(m.ink, 0.07)]);
  c.fillRect(x - 40, 0, 40, H);
  c.fillStyle = rgba(m.ink, 0.12);
  c.fillRect(Math.round(x), 0, 1, H);
  c.restore();
  // compass needle wobble glint
  const g = 0.5 + 0.5 * Math.sin(t * 2);
  circle(c, 606, 36, 2, rgba('#ffffff', 0.3 + 0.5 * g));
}
