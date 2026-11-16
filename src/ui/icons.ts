// Tiny pixel icons: type emblems, foods, items, coin, org emblems, activities and a lock.
//
// Every icon is traced with the engine's path helpers (src/lib/art/shapes.ts) in a unit space
// ([-1, 1] on both axes, scaled to the icon radius) into a small offscreen canvas, then turned into
// real pixel art: anti-aliased edge pixels are thresholded to fully on or off, every pixel snaps to
// the nearest colour the icon actually used, and a 1 px outline is grown around the silhouette. The
// result is cached per (icon, size, colours) and blitted on whole pixels, so icons stay crisp under
// the nearest-neighbour upscale at any size from a 7 px badge glyph to a 40 px card emblem.
import {
  pathCapsule, pathEllipse, pathGear, pathPoly, pathRoundedPoly, pathRrect, pathStar,
} from '../lib/art/shapes.ts';
import { TYPES } from '../data/types.ts';
import { FOODS, ITEMS } from '../data/items.ts';
import { ORGS } from '../data/villains.ts';
import type { ActivityId, FoodId, ItemId, MissionNode, MissionTypeId, OrgId, TypeId } from '../data/schema.ts';

const INK = '#1b1426';
const WHITE = '#fffaf0';

type G = CanvasRenderingContext2D;
type Trace = (g: G) => void;

/** Drawing surface handed to an icon painter. Units: the icon spans [-1, 1]. */
interface Pen {
  readonly g: G;
  /** One screen pixel, in the current unit space. */
  readonly px: number;
  /** The radius of a disc that fills the icon without single-pixel nubs at its extremes. */
  readonly edge: number;
  fill(color: string): void;
  stroke(color: string, widthPx?: number): void;
  /** Trace a path, stroke `outline` 1 px outside it (if given), then fill it. */
  part(trace: Trace, fill: string, outline?: string | null): void;
  /** Several traces as one silhouette: every outline first, then every fill. */
  blob(traces: Trace[], fill: string, outline?: string | null): void;
  line(x0: number, y0: number, x1: number, y1: number, color: string, widthPx?: number): void;
}

// ---------------------------------------------------------------------------------------------
// Sprite pipeline
// ---------------------------------------------------------------------------------------------

function parseHex(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: [number, number, number]): string {
  const c = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

/** Mix two hex colours (falls back to `a` for anything that is not hex). */
function mixHex(a: string, b: string, t: number): string {
  const A = parseHex(a), B = parseHex(b);
  if (!A || !B) return a;
  return hex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

function luma(c: string): number {
  const rgb = parseHex(c);
  return rgb ? (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) / 255 : 0.5;
}

const ALPHA_ON = 110;
const cache = new Map<string, HTMLCanvasElement>();
const CACHE_LIMIT = 800;

/**
 * Render (or fetch) one icon sprite. The sprite is (2*ceil(r)+3) px square with the icon centre on
 * its middle pixel, leaving room for the grown outline.
 */
function sprite(key: string, r: number, outline: string | null, paint: (p: Pen) => void): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) return hit;
  const R = Math.max(1, Math.ceil(r));
  const N = 2 * R + 3;
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const palette: [number, number, number][] = [];
  const seen = new Set<string>();
  const use = (c: string): void => {
    if (seen.has(c)) return;
    seen.add(c);
    const rgb = parseHex(c);
    if (rgb) palette.push(rgb);
  };
  const pen: Pen = {
    g,
    get px() { return 1 / (g.getTransform().a || 1); },
    get edge() { return 1 - 0.5 * pen.px; },
    fill(color) { use(color); g.fillStyle = color; g.fill(); },
    stroke(color, widthPx = 1) {
      use(color);
      g.strokeStyle = color; g.lineWidth = widthPx * pen.px; g.lineJoin = 'round'; g.lineCap = 'round';
      g.stroke();
    },
    part(trace, fill, outline2) {
      trace(g);
      if (outline2) pen.stroke(outline2, 2);
      pen.fill(fill);
    },
    blob(traces, fill, outline2) {
      if (outline2) for (const t of traces) { t(g); pen.stroke(outline2, 2); }
      for (const t of traces) { t(g); pen.fill(fill); }
    },
    line(x0, y0, x1, y1, color, widthPx = 1) {
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
      pen.stroke(color, widthPx);
    },
  };
  g.save();
  g.translate(N / 2, N / 2);
  g.scale(r, r);
  paint(pen);
  g.restore();
  quantize(g, N, palette, outline ? parseHex(outline) : null);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, canvas);
  return canvas;
}

/** Threshold alpha, snap every pixel to the icon's own palette, grow a 1 px outline. */
function quantize(g: G, N: number, palette: [number, number, number][], outline: [number, number, number] | null): void {
  const img = g.getImageData(0, 0, N, N);
  const d = img.data;
  const solid = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const o = i * 4;
    if (d[o + 3] < ALPHA_ON || !palette.length) { d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0; continue; }
    let best = palette[0], bestD = Infinity;
    for (const c of palette) {
      const dr = d[o] - c[0], dg = d[o + 1] - c[1], db = d[o + 2] - c[2];
      const dist = dr * dr * 3 + dg * dg * 4 + db * db * 2;
      if (dist < bestD) { bestD = dist; best = c; }
    }
    d[o] = best[0]; d[o + 1] = best[1]; d[o + 2] = best[2]; d[o + 3] = 255;
    solid[i] = 1;
  }
  if (outline) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (solid[i]) continue;
      const near = (x > 0 && solid[i - 1]) || (x < N - 1 && solid[i + 1]) || (y > 0 && solid[i - N]) || (y < N - 1 && solid[i + N]);
      if (!near) continue;
      const o = i * 4;
      d[o] = outline[0]; d[o + 1] = outline[1]; d[o + 2] = outline[2]; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/** Draw a sprite with its centre pixel on (cx, cy), on whole pixels. */
function blit(ctx: G, spr: HTMLCanvasElement, cx: number, cy: number): void {
  const h = (spr.width - 1) / 2;
  ctx.drawImage(spr, Math.round(cx) - h, Math.round(cy) - h);
}

// ---------------------------------------------------------------------------------------------
// Small path helpers (unit space)
// ---------------------------------------------------------------------------------------------

const circ = (x: number, y: number, r: number): Trace => (g) => pathEllipse(g, x, y, r, r);
const ell = (x: number, y: number, rx: number, ry: number, rot = 0): Trace => (g) => pathEllipse(g, x, y, rx, ry, rot);
const polyT = (pts: number[]): Trace => (g) => pathPoly(g, pts);
const roundPoly = (pts: number[], r: number): Trace => (g) => pathRoundedPoly(g, pts, r);
const rrectT = (x: number, y: number, w: number, h: number, r: number): Trace => (g) => pathRrect(g, x, y, w, h, r);
const capsuleT = (x0: number, y0: number, x1: number, y1: number, r: number): Trace => (g) => pathCapsule(g, x0, y0, x1, y1, r);

/** Crescent: disc (0,0,r1) minus disc (ox,oy,r2). */
function crescent(r1: number, ox: number, oy: number, r2: number): Trace {
  return (g) => {
    const d = Math.hypot(ox, oy);
    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const al = Math.atan2(oy, ox);
    const be = Math.acos(Math.max(-1, Math.min(1, a / r1)));
    const ga = Math.acos(Math.max(-1, Math.min(1, (d - a) / r2)));
    g.beginPath();
    g.arc(0, 0, r1, al + be, al - be + Math.PI * 2, false);
    g.arc(ox, oy, r2, al + Math.PI + ga, al + Math.PI - ga, true);
    g.closePath();
  };
}

// ---------------------------------------------------------------------------------------------
// Type emblems
// ---------------------------------------------------------------------------------------------

/** Colours an emblem is painted with. `line` outlines parts on a medallion; null = sprite outline. */
interface EmblemInk { body: string; dark: string; hi: string; line: string | null }
type Emblem = (p: Pen, k: EmblemInk) => void;

const EMBLEMS: Record<TypeId, Emblem> = {
  FLUFF(p, k) {
    // a cotton-soft puff of fur: three notched lobes over a flat bottom, with a curl
    const D = Math.PI / 180;
    p.part((g) => {
      g.beginPath();
      g.moveTo(-0.62, 0.62);
      g.arc(-0.58, 0.28, 0.36, 100 * D, 250 * D, false);
      g.arc(-0.05, -0.14, 0.5, 190 * D, 340 * D, false);
      g.arc(0.58, 0.22, 0.38, 250 * D, 80 * D, false);
      g.closePath();
    }, k.body, k.line);
    p.part(ell(-0.2, -0.36, 0.2, 0.12, -0.3), k.hi);
    p.g.beginPath(); p.g.arc(0.02, 0.2, 0.2, Math.PI * 0.2, Math.PI * 1.6); p.stroke(mixHex(k.body, k.dark, 0.6), 1);
  },
  FIRE(p, k) {
    p.part((g) => {
      g.beginPath();
      g.moveTo(0.08, -1);
      g.quadraticCurveTo(0.8, -0.35, 0.74, 0.32);
      g.quadraticCurveTo(0.68, 0.98, 0, 0.98);
      g.quadraticCurveTo(-0.72, 0.98, -0.74, 0.3);
      g.quadraticCurveTo(-0.76, -0.2, -0.38, -0.58);
      g.quadraticCurveTo(-0.32, -0.18, -0.1, -0.16);
      g.quadraticCurveTo(-0.22, -0.66, 0.08, -1);
      g.closePath();
    }, k.body, k.line);
    p.part((g) => {
      g.beginPath();
      g.moveTo(0.02, -0.12);
      g.quadraticCurveTo(0.44, 0.22, 0.38, 0.55);
      g.quadraticCurveTo(0.3, 0.8, 0, 0.8);
      g.quadraticCurveTo(-0.34, 0.8, -0.36, 0.52);
      g.quadraticCurveTo(-0.36, 0.2, 0.02, -0.12);
      g.closePath();
    }, k.hi);
  },
  WATER(p, k) {
    p.part((g) => {
      g.beginPath();
      g.moveTo(0, -1);
      g.bezierCurveTo(0.22, -0.55, 0.74, -0.12, 0.74, 0.3);
      g.arc(0, 0.3, 0.74, 0, Math.PI, false);
      g.bezierCurveTo(-0.74, -0.12, -0.22, -0.55, 0, -1);
      g.closePath();
    }, k.body, k.line);
    p.part(ell(-0.32, 0.28, 0.13, 0.26, 0.25), k.hi);
  },
  LEAF(p, k) {
    p.part((g) => {
      g.beginPath();
      g.moveTo(-0.72, 0.72);
      g.quadraticCurveTo(-0.95, -0.85, 0.92, -0.92);
      g.quadraticCurveTo(0.85, 0.95, -0.72, 0.72);
      g.closePath();
    }, k.body, k.line);
    p.line(-0.95, 0.95, 0.42, -0.42, k.dark, 1);
    p.part(ell(-0.2, -0.38, 0.2, 0.12, -0.6), k.hi);
  },
  LIGHTNING(p, k) {
    p.part(polyT([0.22, -1, -0.62, 0.18, -0.06, 0.18, -0.36, 1, 0.64, -0.26, 0.08, -0.26, 0.46, -1]), k.body, k.line);
    p.part(polyT([0.2, -0.86, -0.36, 0.06, -0.18, 0.06, 0.32, -0.86]), k.hi);
  },
  EARTH(p, k) {
    const hill: Trace = (g) => {
      g.beginPath();
      g.moveTo(-1, 0.78);
      g.quadraticCurveTo(-0.7, -0.05, -0.28, -0.42);
      g.quadraticCurveTo(0, -0.66, 0.3, -0.4);
      g.quadraticCurveTo(0.72, -0.05, 1, 0.78);
      g.closePath();
    };
    p.part(hill, k.body, k.line);
    // a darker lower stratum, then the strata line and pebbles
    p.g.save();
    hill(p.g); p.g.clip();
    p.part(rrectT(-1.2, 0.18, 2.4, 1, 0), mixHex(k.body, k.dark, 0.45));
    p.g.restore();
    p.g.beginPath();
    p.g.moveTo(-0.82, 0.18); p.g.quadraticCurveTo(-0.4, 0.02, 0, 0.18); p.g.quadraticCurveTo(0.4, 0.34, 0.82, 0.18);
    p.stroke(k.dark, 1);
    p.part(circ(-0.38, 0.5, 0.12), k.dark);
    p.part(circ(0.32, 0.55, 0.1), k.dark);
    p.part(ell(-0.3, -0.22, 0.18, 0.1, -0.5), k.hi);
  },
  ROCK(p, k) {
    const shape: Trace = roundPoly([-0.96, 0.6, -0.86, -0.12, -0.42, -0.66, 0.2, -0.8, 0.78, -0.42, 0.98, 0.24, 0.72, 0.74, -0.42, 0.8], 0.26);
    p.part(shape, k.body, k.line);
    p.g.save();
    shape(p.g); p.g.clip();
    p.part(ell(0.55, 0.62, 0.95, 0.5, -0.5), mixHex(k.body, k.dark, 0.38));
    p.g.restore();
    p.part(ell(-0.42, -0.3, 0.26, 0.14, -0.7), k.hi);
    p.g.beginPath(); p.g.moveTo(0.16, -0.76); p.g.lineTo(0.02, -0.4); p.g.lineTo(0.26, -0.16);
    p.stroke(k.dark, 1);
  },
  WINGED(p, k) {
    p.part((g) => {
      g.beginPath();
      g.moveTo(-0.95, 0.35);
      g.quadraticCurveTo(-0.75, -0.95, 0.98, -0.9);
      g.quadraticCurveTo(0.8, -0.5, 0.5, -0.4);
      g.quadraticCurveTo(0.68, -0.15, 0.3, -0.02);
      g.quadraticCurveTo(0.42, 0.28, 0.02, 0.32);
      g.quadraticCurveTo(0.02, 0.72, -0.42, 0.7);
      g.quadraticCurveTo(-0.9, 0.7, -0.95, 0.35);
      g.closePath();
    }, k.body, k.line);
    p.g.beginPath();
    p.g.moveTo(-0.62, 0.05); p.g.quadraticCurveTo(-0.1, -0.5, 0.5, -0.4);
    p.stroke(k.dark, 1);
    p.part(ell(-0.45, -0.28, 0.2, 0.11, -0.7), k.hi);
  },
  FROST(p, k) {
    const arm = (a: number, w: number, col: string): void => {
      const c = Math.cos(a), s = Math.sin(a);
      p.line(-c * 0.95, -s * 0.95, c * 0.95, s * 0.95, col, w);
      for (const sgn of [1, -1]) {
        const bx = c * 0.55 * sgn, by = s * 0.55 * sgn;
        for (const off of [0.5, -0.5]) {
          const a2 = a + (sgn > 0 ? 0 : Math.PI) + off * 1.6;
          p.line(bx, by, bx + Math.cos(a2) * 0.32, by + Math.sin(a2) * 0.32, col, w);
        }
      }
    };
    const tiny = p.px > 0.2;
    if (tiny) {
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 3, c = Math.cos(a) * 0.95, s = Math.sin(a) * 0.95;
        p.line(-c, -s, c, s, k.body, 1.2);
      }
      return;
    }
    if (k.line) for (let i = 0; i < 3; i++) arm(-Math.PI / 2 + i * Math.PI / 3, 3.2, k.line);
    for (let i = 0; i < 3; i++) arm(-Math.PI / 2 + i * Math.PI / 3, 1.6, k.body);
    p.part(circ(0, 0, 0.2), k.hi);
  },
  SLIME(p, k) {
    p.part((g) => {
      g.beginPath();
      g.moveTo(-0.92, 0.7);
      g.quadraticCurveTo(-1, -0.05, -0.45, -0.42);
      g.quadraticCurveTo(-0.1, -0.95, 0.38, -0.5);
      g.quadraticCurveTo(0.95, -0.2, 0.92, 0.7);
      g.lineTo(0.62, 0.7);
      g.quadraticCurveTo(0.55, 0.98, 0.42, 0.98);
      g.quadraticCurveTo(0.3, 0.98, 0.25, 0.7);
      g.closePath();
    }, k.body, k.line);
    p.part(circ(-0.3, 0.12, 0.13), k.dark);
    p.part(circ(0.28, 0.12, 0.13), k.dark);
    p.part(ell(-0.4, -0.38, 0.18, 0.1, -0.6), k.hi);
  },
  DARKNESS(p, k) {
    p.part(crescent(0.92, 0.46, -0.32, 0.74), k.body, k.line);
    p.part(pathStarT(0.55, 0.45, 0.24, 0.08), k.hi);
  },
  LIGHT(p, k) {
    p.part((g) => pathStar(g, 0, 0.06, 0.95, 0.3, 4, -Math.PI / 2), k.body, k.line);
    p.part((g) => pathStar(g, 0.62, -0.62, 0.36, 0.12, 4, -Math.PI / 2), k.body, k.line);
    p.part(circ(0, 0.06, 0.22), k.hi);
  },
  COOKING(p, k) {
    // chef hat
    p.blob([circ(-0.48, -0.12, 0.42), circ(0.48, -0.12, 0.42), circ(0, -0.42, 0.5), rrectT(-0.56, 0.05, 1.12, 0.85, 0.12)], k.body, k.line);
    p.line(-0.56, 0.4, 0.56, 0.4, k.dark, 1);
    p.line(-0.2, 0.05, -0.2, 0.36, k.dark, 1);
    p.line(0.2, 0.05, 0.2, 0.36, k.dark, 1);
    p.part(ell(-0.2, -0.5, 0.2, 0.12), k.hi);
  },
  METAL(p, k) {
    p.part((g) => pathGear(g, 0, 0, 1, 8, Math.PI / 8, 0.3), k.body, k.line);
    p.part(circ(0, 0, 0.34), k.dark);
    p.part(ell(-0.36, -0.4, 0.16, 0.1, -0.7), k.hi);
  },
  MIND(p, k) {
    p.part((g) => {
      g.beginPath();
      g.moveTo(-1, 0);
      g.quadraticCurveTo(0, -0.95, 1, 0);
      g.quadraticCurveTo(0, 0.95, -1, 0);
      g.closePath();
    }, k.hi, k.line ?? k.dark);
    p.part(circ(0, 0, 0.42), k.body);
    p.g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = i / 24 * Math.PI * 3.2, rr = 0.04 + i / 24 * 0.3;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) p.g.moveTo(x, y); else p.g.lineTo(x, y);
    }
    p.stroke(k.dark, 1);
  },
  BRAWL(p, k) {
    p.blob([rrectT(-0.7, -0.5, 1.4, 1.1, 0.3), circ(-0.48, -0.48, 0.22), circ(-0.16, -0.54, 0.22),
      circ(0.16, -0.54, 0.22), circ(0.48, -0.48, 0.22)], k.body, k.line);
    p.line(-0.32, -0.62, -0.32, -0.15, k.dark, 1);
    p.line(0, -0.68, 0, -0.15, k.dark, 1);
    p.line(0.32, -0.62, 0.32, -0.15, k.dark, 1);
    p.part(capsuleT(-0.5, 0.16, 0.22, 0.16, 0.2), k.body, k.dark);
    p.part(rrectT(-0.55, 0.62, 1.1, 0.34, 0.08), k.hi, k.line);
  },
};

function pathStarT(x: number, y: number, ro: number, ri: number): Trace {
  return (g) => pathStar(g, x, y, ro, ri, 4, -Math.PI / 2);
}

function typeInk(type: TypeId): { color: string; dark: string; light: string } {
  const t = TYPES[type];
  return { color: t?.color || '#9a8f80', dark: t?.dark || '#4a4038', light: t?.light || '#e8dcc8' };
}

/**
 * A type's emblem. By default a round medallion (type-coloured disc, ink rim) that reads on any
 * background; `plain` draws the bare emblem with a dark outline (used inside type badges).
 * @param r radius in px; 4 is badge size, 6-8 is chart/header size
 */
export function drawTypeIcon(ctx: G, type: TypeId, cx: number, cy: number, r: number, opts: { plain?: boolean } = {}): void {
  const c = typeInk(type);
  const emblem = EMBLEMS[type];
  if (!emblem) return;
  const plain = !!opts.plain;
  const key = `t|${type}|${r}|${plain ? 1 : 0}|${c.color}|${c.dark}|${c.light}`;
  const body = mixHex(c.light, WHITE, 0.35);
  const spr = sprite(key, r, plain ? c.dark : INK, (p) => {
    if (plain) {
      emblem(p, { body, dark: c.dark, hi: WHITE, line: null });
      return;
    }
    const big = r >= 7;
    const e = p.edge;
    if (big) {
      p.part(circ(0, 0, e), c.dark);
      p.part(circ(0, 0, e - p.px), c.color);
      p.g.beginPath(); p.g.arc(0, 0, e - 2 * p.px, Math.PI * 1.08, Math.PI * 1.42); p.stroke(c.light, 1);
    } else {
      p.part(circ(0, 0, e), c.color);
    }
    p.g.save();
    const k = big ? 0.66 : 0.76;
    p.g.scale(k, k);
    emblem(p, { body, dark: c.dark, hi: WHITE, line: r >= 8 ? c.dark : null });
    p.g.restore();
  });
  blit(ctx, spr, cx, cy);
}

// ---------------------------------------------------------------------------------------------
// Foods
// ---------------------------------------------------------------------------------------------

type ColorPair = { color: string; accent: string };

const FOOD_PAINT: Record<FoodId, (p: Pen, c: ColorPair) => void> = {
  seeds(p, c) {
    const seed = (x: number, y: number, rot: number, sc: number): void => {
      p.g.save(); p.g.translate(x, y); p.g.rotate(rot); p.g.scale(sc, sc);
      p.part((g) => {
        g.beginPath();
        g.moveTo(0, -0.95);
        g.quadraticCurveTo(0.52, -0.42, 0.44, 0.32);
        g.arc(0, 0.32, 0.44, 0, Math.PI, false);
        g.quadraticCurveTo(-0.52, -0.42, 0, -0.95);
        g.closePath();
      }, c.accent, sc < 1 ? INK : null);
      p.line(0, -0.7, 0, 0.66, c.color, 1);
      if (p.px < 0.14) { p.line(-0.24, -0.18, -0.26, 0.5, c.color, 1); p.line(0.24, -0.18, 0.26, 0.5, c.color, 1); }
      p.g.restore();
    };
    seed(0.04, 0.02, 0.62, 1.08);
  },
  carrot(p, c) {
    p.blob([ell(0.22, -0.62, 0.18, 0.36, 0.5), ell(0.5, -0.5, 0.16, 0.34, 1.0), ell(-0.02, -0.6, 0.15, 0.34, -0.1)], c.accent);
    p.part(roundPoly([0.4, -0.36, -0.82, 0.86, 0.02, -0.5, 0.24, -0.5], 0.12), c.color);
    p.part((g) => { g.beginPath(); g.moveTo(-0.05, -0.42); g.quadraticCurveTo(0.42, -0.6, 0.48, -0.3); g.lineTo(-0.7, 0.8); g.closePath(); }, c.color);
    p.line(-0.1, -0.05, 0.12, 0.05, mixHex(c.color, INK, 0.35), 1);
    p.line(-0.38, 0.3, -0.18, 0.4, mixHex(c.color, INK, 0.35), 1);
    p.part(ell(-0.05, -0.2, 0.08, 0.2, 0.7), mixHex(c.color, WHITE, 0.45));
  },
  berries(p, c) {
    const dark = mixHex(c.color, INK, 0.45), hi = mixHex(c.color, WHITE, 0.55);
    p.part((g) => { g.beginPath(); g.moveTo(0.05, -0.62); g.quadraticCurveTo(0.45, -1.05, 0.88, -0.78); g.quadraticCurveTo(0.5, -0.45, 0.05, -0.62); g.closePath(); }, c.accent);
    for (const [x, y] of [[-0.42, 0.34], [0.42, 0.34], [0, -0.3]] as const) {
      p.part(circ(x, y, 0.5), c.color, dark);
      p.part(circ(x - 0.18, y - 0.18, 0.13), hi);
      p.part((g) => pathStar(g, x + 0.08, y - 0.02, 0.16, 0.06, 5, 0), dark);
    }
  },
  cheese(p, c) {
    const side = mixHex(c.color, c.accent, 0.7), hole = mixHex(c.accent, INK, 0.15);
    p.part(polyT([-0.95, 0.15, 0.85, -0.6, 0.95, -0.2, 0.95, 0.65, -0.95, 0.65]), c.color);
    p.part(polyT([-0.95, 0.15, 0.95, -0.2, 0.95, 0.65, -0.95, 0.65]), side);
    p.part(polyT([-0.95, 0.15, 0.85, -0.6, 0.95, -0.2]), mixHex(c.color, WHITE, 0.35));
    p.part(circ(-0.35, 0.36, 0.17), hole);
    p.part(circ(0.4, 0.22, 0.12), hole);
    p.part(circ(0.55, 0.5, 0.09), hole);
  },
  dragonfruit(p, c) {
    const dark = mixHex(c.color, INK, 0.35);
    p.part(ell(0, 0.08, 0.72, 0.86), c.color);
    for (const [x, y, rot] of [[-0.55, -0.2, -0.9], [0.55, -0.2, 0.9], [-0.5, 0.45, -1.4], [0.5, 0.45, 1.4], [0, -0.8, 0], [0, 0.3, 0]] as const) {
      p.part((g) => { g.beginPath(); g.save(); g.translate(x, y); g.rotate(rot); g.moveTo(-0.16, 0.12); g.quadraticCurveTo(0, -0.1, 0.05, -0.36); g.quadraticCurveTo(0.18, -0.05, 0.16, 0.12); g.closePath(); g.restore(); }, c.accent);
    }
    p.part(ell(-0.28, -0.25, 0.12, 0.22, 0.3), mixHex(c.color, WHITE, 0.5));
    p.line(-0.1, 0.62, 0.15, 0.7, dark, 1);
  },
};

const FOOD_FALLBACK: Record<FoodId, ColorPair> = {
  seeds: { color: '#e6d9a8', accent: '#4a3a30' },
  carrot: { color: '#f08a34', accent: '#4caf3c' },
  berries: { color: '#4a68d8', accent: '#24357a' },
  cheese: { color: '#f6cf3e', accent: '#c8901c' },
  dragonfruit: { color: '#e8488f', accent: '#69c24a' },
};

function colorsOf(def: { color?: string; accent?: string } | undefined, fb: ColorPair): ColorPair {
  return {
    color: def?.color && parseHex(def.color) ? def.color : fb.color,
    accent: def?.accent && parseHex(def.accent) ? def.accent : fb.accent,
  };
}

/** A food icon. @param s size in px (about the icon's diameter), default 14 */
export function drawFoodIcon(ctx: G, id: FoodId, cx: number, cy: number, s = 14): void {
  const paint = FOOD_PAINT[id];
  if (!paint) return;
  const c = colorsOf(FOODS[id], FOOD_FALLBACK[id]);
  const r = s / 2;
  blit(ctx, sprite(`f|${id}|${r}|${c.color}|${c.accent}`, r, INK, (p) => paint(p, c)), cx, cy);
}

// ---------------------------------------------------------------------------------------------
// Battle items
// ---------------------------------------------------------------------------------------------

const ITEM_PAINT: Record<ItemId, (p: Pen, c: ColorPair) => void> = {
  seedcake(p, c) {
    const icing = '#fff3da', icingShade = '#ecd6b0', dark = c.accent;
    p.part(rrectT(-0.82, -0.3, 1.64, 1.12, 0.22), c.color);
    p.line(-0.8, 0.5, 0.8, 0.5, mixHex(c.color, dark, 0.5), 1);
    p.part((g) => {
      g.beginPath();
      g.moveTo(-0.84, -0.18);
      g.quadraticCurveTo(-0.84, -0.62, 0, -0.62);
      g.quadraticCurveTo(0.84, -0.62, 0.84, -0.18);
      g.lineTo(0.84, 0.1); g.quadraticCurveTo(0.7, 0.28, 0.56, 0.1);
      g.lineTo(0.3, 0.02); g.quadraticCurveTo(0.12, 0.42, -0.06, 0.02);
      g.lineTo(-0.4, 0.04); g.quadraticCurveTo(-0.6, 0.24, -0.84, 0.06);
      g.closePath();
    }, icing);
    p.line(-0.6, -0.15, 0.6, -0.15, icingShade, 1);
    for (const [x, y, rot] of [[-0.42, -0.36, 0.5], [0.0, -0.44, -0.3], [0.4, -0.32, 0.9]] as const) p.part(ell(x, y, 0.08, 0.15, rot), dark);
  },
  royalcake(p, c) {
    const top = mixHex(c.color, WHITE, 0.4), side = c.color, dark = c.accent;
    p.part(rrectT(-0.9, 0.12, 1.8, 0.72, 0.18), side);
    p.part(ell(0, 0.12, 0.9, 0.3), top);
    p.part(rrectT(-0.58, -0.42, 1.16, 0.58, 0.14), side);
    p.part(ell(0, -0.42, 0.58, 0.2), top);
    p.line(-0.9, 0.5, 0.9, 0.5, dark, 1);
    p.part(polyT([-0.36, -0.62, -0.36, -0.95, -0.18, -0.76, 0, -1, 0.18, -0.76, 0.36, -0.95, 0.36, -0.62]), '#f7d046');
    p.part(circ(0, -0.8, 0.07), '#e84860');
  },
  peppep(p, c) {
    p.part((g) => {
      g.beginPath();
      g.moveTo(-0.38, -0.42);
      g.quadraticCurveTo(0.2, -0.62, 0.55, -0.3);
      g.quadraticCurveTo(0.75, 0.25, 0.1, 0.72);
      g.quadraticCurveTo(-0.4, 1.0, -0.9, 0.86);
      g.quadraticCurveTo(-0.4, 0.62, -0.42, 0.1);
      g.closePath();
    }, c.color);
    p.part(ell(0.1, -0.12, 0.1, 0.24, 0.6), mixHex(c.color, WHITE, 0.5));
    p.part(capsuleT(-0.36, -0.42, 0.42, -0.42, 0.14), c.accent);
    p.part(capsuleT(0.05, -0.45, 0.32, -0.9, 0.09), c.accent);
  },
  herbtea(p, c) {
    const lightCup = luma(c.accent) > 0.7;
    const cup = lightCup ? c.accent : '#f6efe2', cupDark = mixHex(cup, INK, 0.25);
    const leaf = mixHex(c.color, INK, 0.25);
    p.g.beginPath(); p.g.arc(0.58, 0.15, 0.24, -Math.PI * 0.55, Math.PI * 0.55); p.stroke(cup, 2.2);
    p.part((g) => { g.beginPath(); g.moveTo(-0.8, -0.2); g.lineTo(0.68, -0.2); g.quadraticCurveTo(0.6, 0.72, -0.06, 0.72); g.quadraticCurveTo(-0.72, 0.72, -0.8, -0.2); g.closePath(); }, cup);
    p.part(ell(-0.06, -0.2, 0.74, 0.17), c.color);
    p.part(ell(-0.06, 0.82, 0.72, 0.12), cupDark);
    p.part((g) => { g.beginPath(); g.moveTo(-0.08, -0.32); g.quadraticCurveTo(-0.5, -0.78, 0.0, -1); g.quadraticCurveTo(0.22, -0.6, -0.08, -0.32); g.closePath(); }, leaf);
    p.line(-0.08, -0.34, -0.02, -0.8, mixHex(leaf, WHITE, 0.4), 1);
    p.line(-0.48, 0.1, -0.48, 0.48, cupDark, 1);
  },
  spicybiscuit(p, c) {
    const top = mixHex(c.color, WHITE, 0.25), dark = mixHex(c.color, INK, 0.35);
    p.part(circ(-0.08, 0.14, 0.8), c.color);
    p.part(circ(-0.14, 0.08, 0.64), top);
    for (const [x, y] of [[-0.42, -0.12], [0.18, -0.2], [0.26, 0.32], [-0.28, 0.42], [-0.06, 0.1]] as const) p.part(circ(x, y, 0.1), c.accent);
    p.line(-0.72, 0.56, -0.5, 0.74, dark, 1);
    // a little flame: it's spicy
    p.part((g) => { g.beginPath(); g.moveTo(0.72, -1); g.quadraticCurveTo(1.0, -0.6, 0.86, -0.38); g.quadraticCurveTo(0.72, -0.24, 0.56, -0.38); g.quadraticCurveTo(0.44, -0.62, 0.72, -1); g.closePath(); }, '#ff8a2a');
    p.part(ell(0.72, -0.48, 0.08, 0.1), '#ffe07a');
  },
};

const ITEM_FALLBACK: Record<ItemId, ColorPair> = {
  seedcake: { color: '#d8a868', accent: '#7a5232' },
  royalcake: { color: '#f2d27a', accent: '#b07a28' },
  peppep: { color: '#e43a2a', accent: '#4caf3c' },
  herbtea: { color: '#7ac060', accent: '#3d8a3a' },
  spicybiscuit: { color: '#cf8a44', accent: '#e43a2a' },
};

/** A battle item icon. @param s size in px, default 14 */
export function drawItemIcon(ctx: G, id: ItemId, cx: number, cy: number, s = 14): void {
  const paint = ITEM_PAINT[id];
  if (!paint) return;
  const c = colorsOf(ITEMS[id], ITEM_FALLBACK[id]);
  const r = s / 2;
  blit(ctx, sprite(`i|${id}|${r}|${c.color}|${c.accent}`, r, INK, (p) => paint(p, c)), cx, cy);
}

// ---------------------------------------------------------------------------------------------
// Coin, lock
// ---------------------------------------------------------------------------------------------

/** A gold coin with a star stamped on it. @param r radius in px, default 5 */
export function drawCoinIcon(ctx: G, cx: number, cy: number, r = 5): void {
  blit(ctx, sprite(`coin|${r}`, r, INK, (p) => {
    const e = p.edge;
    p.part(circ(0, 0, e), '#c08424');
    p.part(circ(0, 0, e - p.px), '#f6c63c');
    if (r >= 5) {
      p.g.beginPath(); p.g.arc(0, 0, e - 1.5 * p.px, Math.PI * 0.05, Math.PI * 0.75); p.stroke('#dc9f2a', 1);
    }
    if (r >= 6) {
      p.part((g) => pathStar(g, 0.06, 0.08, 0.5, 0.22, 5, -Math.PI / 2), '#dc9f2a');
      p.part((g) => pathStar(g, -0.04, -0.02, 0.5, 0.22, 5, -Math.PI / 2), '#ffe27a');
    }
    p.part(ell(-0.42, -0.42, 0.2, 0.12, -0.75), '#fff6c8');
  }), cx, cy);
}

/** A brass padlock. @param s size in px, default 12 */
export function drawLock(ctx: G, cx: number, cy: number, s = 12): void {
  const r = s / 2;
  blit(ctx, sprite(`lock|${r}`, r, INK, (p) => {
    p.g.beginPath(); p.g.moveTo(-0.46, 0.05); p.g.lineTo(-0.46, -0.3); p.g.arc(0, -0.3, 0.46, Math.PI, 0); p.g.lineTo(0.46, 0.05);
    p.stroke('#b9b3c4', Math.max(1.5, r * 0.24));
    p.part(rrectT(-0.78, -0.08, 1.56, 1.04, 0.18), '#e2a83a');
    p.part(rrectT(-0.78, -0.08, 1.56, 0.26, 0.12), '#f6d06a');
    p.part(circ(0, 0.32, 0.16), '#5a3a1e');
    p.part(polyT([-0.07, 0.36, 0.07, 0.36, 0.1, 0.68, -0.1, 0.68]), '#5a3a1e');
  }), cx, cy);
}

// ---------------------------------------------------------------------------------------------
// Villain organisations
// ---------------------------------------------------------------------------------------------

const ORG_PAINT: Record<OrgId, (p: Pen) => void> = {
  cheese(p) {
    p.part(polyT([-0.9, 0.12, 0.78, -0.62, 0.9, -0.22, 0.9, 0.58, -0.9, 0.58]), '#f6cf3e', INK);
    p.part(polyT([-0.9, 0.12, 0.9, -0.22, 0.9, 0.58, -0.9, 0.58]), '#e0a82a');
    p.part(polyT([-0.9, 0.12, 0.78, -0.62, 0.9, -0.22]), '#ffe78a');
    p.part(circ(-0.32, 0.33, 0.15), '#a87418');
    p.part(circ(0.42, 0.2, 0.11), '#a87418');
    p.part(circ(0.58, 0.45, 0.08), '#a87418');
  },
  crows(p) {
    p.part((g) => {
      g.beginPath();
      g.moveTo(-0.72, 0.85);
      g.quadraticCurveTo(-0.62, -0.25, 0.75, -0.92);
      g.quadraticCurveTo(0.6, 0.15, -0.72, 0.85);
      g.closePath();
    }, '#6a62a8', INK);
    p.part((g) => {
      g.beginPath();
      g.moveTo(-0.6, 0.72);
      g.quadraticCurveTo(-0.5, -0.1, 0.62, -0.78);
      g.quadraticCurveTo(-0.05, -0.05, -0.6, 0.72);
      g.closePath();
    }, '#8f88c8');
    p.line(-0.85, 0.98, 0.5, -0.62, '#e4defa', 1);
    p.line(0.05, 0.1, 0.3, 0.25, '#3b3560', 1);
  },
  snakes(p) {
    p.g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI * 0.5 + i / 40 * Math.PI * 3.1, rr = 0.78 - i / 40 * 0.62;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr + 0.05;
      if (i === 0) p.g.moveTo(x, y); else p.g.lineTo(x, y);
    }
    const w = 0.3 / p.px;
    p.stroke(INK, w + 2);
    p.g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI * 0.5 + i / 40 * Math.PI * 3.1, rr = 0.78 - i / 40 * 0.62;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr + 0.05;
      if (i === 0) p.g.moveTo(x, y); else p.g.lineTo(x, y);
    }
    p.stroke('#5cb85a', w);
    p.part(ell(0.02, 0.84, 0.3, 0.2), '#5cb85a', INK);
    p.part(circ(0.12, 0.8, 0.07), '#f6e05a');
    p.line(0.3, 0.86, 0.55, 0.9, '#e84860', 1);
  },
  cats(p) {
    const pad = '#f5a8b8';
    p.part(ell(0, 0.35, 0.5, 0.42), pad, INK);
    p.part(ell(-0.62, -0.12, 0.2, 0.26, -0.3), pad, INK);
    p.part(ell(-0.24, -0.5, 0.2, 0.27, -0.1), pad, INK);
    p.part(ell(0.24, -0.5, 0.2, 0.27, 0.1), pad, INK);
    p.part(ell(0.62, -0.12, 0.2, 0.26, 0.3), pad, INK);
    p.part(ell(-0.15, 0.22, 0.14, 0.1, -0.4), '#ffd8e0');
  },
  ferrets(p) {
    const steel = '#b8bccb', dark = '#6c7088';
    p.part(capsuleT(-0.58, 0.58, 0.32, -0.32, 0.17), steel, INK);
    p.part((g) => {
      g.beginPath();
      g.arc(0.5, -0.5, 0.42, 0, Math.PI * 2);
      g.closePath();
    }, steel, INK);
    p.part(rrectT(0.42, -0.98, 0.3, 0.5, 0.04), '#3a2d4f');
    p.part(circ(-0.58, 0.58, 0.28), steel, INK);
    p.part(circ(-0.58, 0.58, 0.1), dark);
    p.line(-0.42, 0.32, 0.22, -0.3, '#eef0f6', 1);
  },
};

/**
 * A villain organisation's crest: a dark medallion ringed in the org's emblem colour with its
 * symbol (cheese wedge, crow feather, coiled snake, cat paw, ferret wrench).
 * @param r radius in px
 */
export function drawOrgEmblem(ctx: G, org: OrgId, cx: number, cy: number, r: number): void {
  const paint = ORG_PAINT[org];
  if (!paint) return;
  const def = ORGS[org];
  const ring = def?.emblem && parseHex(def.emblem) ? def.emblem : '#c8a050';
  const field = mixHex(def?.emblemAccent && parseHex(def.emblemAccent) ? def.emblemAccent : '#2a2140', '#2a2140', 0.5);
  blit(ctx, sprite(`o|${org}|${r}|${ring}|${field}`, r, INK, (p) => {
    const e = p.edge, rim = r >= 8 ? 2 : 1;
    p.part(circ(0, 0, e), ring);
    p.part(circ(0, 0, e - rim * p.px), mixHex(field, INK, 0.2));
    if (r >= 8) { p.g.beginPath(); p.g.arc(0, 0, e - (rim + 1) * p.px, Math.PI * 1.1, Math.PI * 1.45); p.stroke(mixHex(field, WHITE, 0.25), 1); }
    p.g.save();
    p.g.scale(0.66, 0.66);
    paint(p);
    p.g.restore();
  }), cx, cy);
}

// ---------------------------------------------------------------------------------------------
// Burrow activities
// ---------------------------------------------------------------------------------------------

const ACTIVITY_PAINT: Record<ActivityId, (p: Pen) => void> = {
  feed(p) {
    p.blob([circ(-0.35, -0.05, 0.3), circ(0.1, -0.22, 0.34), circ(0.45, 0, 0.28)], '#e6d9a8');
    for (const [x, y, rot] of [[-0.35, -0.12, -0.5], [0.08, -0.3, 0.3], [0.42, -0.05, 0.9]] as const) p.part(ell(x, y, 0.08, 0.16, rot), '#4a3a30');
    p.part((g) => { g.beginPath(); g.moveTo(-0.95, 0.05); g.lineTo(0.95, 0.05); g.quadraticCurveTo(0.85, 0.85, 0, 0.85); g.quadraticCurveTo(-0.85, 0.85, -0.95, 0.05); g.closePath(); }, '#e0603c');
    p.part(rrectT(-0.95, 0.02, 1.9, 0.18, 0.08), '#f4906a');
    p.line(-0.5, 0.45, 0.5, 0.45, '#b04428', 1);
  },
  wheel(p) {
    p.part(polyT([-0.15, 0.4, 0.15, 0.4, 0.55, 1, -0.55, 1]), '#8a5a3c');
    p.part(circ(0, -0.05, 0.92), '#9aa4c4');
    p.part(circ(0, -0.05, 0.92 - 2.2 * p.px), '#f3e2bf');
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.3;
      p.line(0, -0.05, Math.cos(a) * 0.8, -0.05 + Math.sin(a) * 0.8, '#9aa4c4', 1);
    }
    p.part(circ(0, -0.05, 0.16), '#6a7494');
  },
  dig(p) {
    p.blob([ell(0, 0.72, 0.95, 0.3)], '#8a5a3c');
    p.part(circ(-0.45, 0.68, 0.08), '#5e3a28');
    p.part(circ(0.5, 0.75, 0.07), '#5e3a28');
    p.part(capsuleT(0.72, -0.82, 0.02, 0.0, 0.1), '#c08a52');
    p.part(capsuleT(0.56, -0.94, 0.9, -0.62, 0.1), '#c08a52');
    p.part(roundPoly([-0.05, -0.12, 0.2, 0.12, -0.2, 0.6, -0.55, 0.28], 0.12), '#b9bfd0');
    p.line(-0.14, 0.05, -0.32, 0.3, '#eef0f6', 1);
  },
  nap(p) {
    p.part(crescent(0.82, 0.42, -0.3, 0.66), '#f6d65a');
    p.part(ell(-0.45, 0.05, 0.1, 0.18, 0.4), '#fff2b0');
    p.g.save(); p.g.translate(0.45, -0.25);
    p.g.beginPath(); p.g.moveTo(-0.2, -0.45); p.g.lineTo(0.22, -0.45); p.g.lineTo(-0.2, 0.0); p.g.lineTo(0.22, 0.0);
    p.stroke('#ffffff', 1.4);
    p.g.restore();
  },
  play(p) {
    const segs = ['#e84860', '#fffaf0', '#4a90e0', '#fffaf0', '#f6c63c', '#fffaf0'];
    const e = p.edge;
    p.part(circ(0, 0, e), segs[0]);
    for (let i = 0; i < segs.length; i++) {
      const a0 = -Math.PI / 2 + i / segs.length * Math.PI * 2, a1 = a0 + Math.PI * 2 / segs.length;
      p.part((g) => { g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, e, a0, a1); g.closePath(); }, segs[i]);
    }
    p.part(circ(0, 0, 0.18), '#fffaf0');
    p.part(ell(-0.4, -0.45, 0.16, 0.1, -0.7), '#ffffff');
  },
};

/** A burrow activity icon (bowl, wheel, shovel, moon, ball). @param s size in px, default 14 */
export function drawActivityIcon(ctx: G, id: ActivityId, cx: number, cy: number, s = 14): void {
  const paint = ACTIVITY_PAINT[id];
  if (!paint) return;
  const r = s / 2;
  blit(ctx, sprite(`a|${id}|${r}`, r, INK, paint), cx, cy);
}

// ---------------------------------------------------------------------------------------------
// Mask sprites: hand-placed pixel rows ('.' = empty, any other letter = a palette colour), with a
// 1 px ink outline grown around them. Used for the mission-type and mission-node icons, which the
// board, the briefing and the mission run all share.
// ---------------------------------------------------------------------------------------------

const maskCache = new Map<string, HTMLCanvasElement>();

/** A cached outlined sprite for `rows` (unknown letters draw in ink). `key` must be unique per look. */
export function pixelSprite(key: string, rows: readonly string[], pal: Record<string, string>): HTMLCanvasElement {
  const hitC = maskCache.get(key);
  if (hitC) return hitC;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w + 2; c.height = h + 2;
  const g = c.getContext('2d') as G;
  const on = (x: number, y: number): boolean => y >= 0 && y < h && x >= 0 && x < rows[y].length && rows[y][x] !== '.';
  g.fillStyle = INK;
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
    if (on(x, y)) continue;
    if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) g.fillRect(x + 1, y + 1, 1, 1);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < rows[y].length; x++) {
    const ch = rows[y][x];
    if (ch === '.') continue;
    g.fillStyle = pal[ch] ?? INK;
    g.fillRect(x + 1, y + 1, 1, 1);
  }
  maskCache.set(key, c);
  return c;
}

/** Draw a sprite centred on (cx, cy) on whole pixels, scaled by an integer `scale`. */
export function blitSprite(ctx: G, s: HTMLCanvasElement, cx: number, cy: number, scale = 1): void {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s, Math.round(cx - (s.width * scale) / 2), Math.round(cy - (s.height * scale) / 2), s.width * scale, s.height * scale);
}

const MISSION_TYPE_ICONS: Record<MissionTypeId, { rows: string[]; pal: Record<string, string>; color: string }> = {
  retrieve: {
    rows: ['..lllllll..', '.wllllllcb.', 'wwlllllllcb', 'ddddddddddd', '.lllllcccb.', '..llllccb..', '...lllcb...', '....lcb....', '.....b.....'],
    pal: { w: '#ffffff', l: '#a8ecff', c: '#52bde8', b: '#2f7cc0', d: '#2a5f9e' },
    color: '#2a6aa8',
  },
  rescue: {
    rows: ['.rrr...rrr.', 'rwwrr.rrrrr', 'rwrrrrrrrrr', 'rrrrrrrrrrd', '.rrrrrrrrd.', '..rrrrrrd..', '...rrrrd...', '....rrd....', '.....d.....'],
    pal: { r: '#ef5a6f', w: '#ffd0d8', d: '#b8344a' },
    color: '#c23a52',
  },
  sabotage: {
    rows: ['.........y.', '........yoy', '.......f.y.', '......cc...', '...ddddd...', '..ddddddd..', '.dhhdddddd.', '.dhddddddd.',
      '.ddddddddd.', '.ddddddddd.', '.ddddddddd.', '..ddddddd..', '...ddddd...'],
    pal: { d: '#4a4262', h: '#a49ec0', c: '#9a9aa8', f: '#c89a5a', y: '#ffd84a', o: '#ff7a2a' },
    color: '#c45a1c',
  },
  infiltrate: {
    rows: ['.hhmm...hhmm.', 'mmmmmmmmmmmmm', 'mm..mmmmm..mm', 'mm..mmmmm..mm', 'mmmmmm.mmmmmm', '.mmmm...mmmm.'],
    pal: { m: '#5a4a80', h: '#9584c0' },
    color: '#5a3f8a',
  },
  defend: {
    rows: ['ggggggggggg', 'gwwwwgbbbbg', 'gwwwwgbbbbg', 'gwwwwgbbbbg', 'ggggggggggg', 'gbbbbgwwwwg', 'gbbbbgwwwwg', '.gbbbgwwwg.',
      '..gbbgwwg..', '...ggggg...', '....ggg....', '.....g.....'],
    pal: { g: '#e8b83a', w: '#f4f0e8', b: '#4f8fe0' },
    color: '#2f8a3e',
  },
};

/** The text colour that goes with each mission type's icon (names on cards and briefings). */
export const MISSION_TYPE_COLOR: Record<MissionTypeId, string> = {
  retrieve: MISSION_TYPE_ICONS.retrieve.color,
  rescue: MISSION_TYPE_ICONS.rescue.color,
  sabotage: MISSION_TYPE_ICONS.sabotage.color,
  infiltrate: MISSION_TYPE_ICONS.infiltrate.color,
  defend: MISSION_TYPE_ICONS.defend.color,
};

/** A mission type's emblem (diamond, heart, bomb, mask, shield) centred on (cx, cy). */
export function drawMissionTypeIcon(ctx: G, type: MissionTypeId, cx: number, cy: number, scale = 1): void {
  const ic = MISSION_TYPE_ICONS[type];
  if (!ic) return;
  blitSprite(ctx, pixelSprite('mt|' + type, ic.rows, ic.pal), cx, cy, scale);
}

export type MissionNodeKind = MissionNode['kind'];

const NODE_CLAWS = ['c...........c', 'cc.........cc', '.cc.......cc.', '.scc.....ccs.', '..scc...ccs..', '...scc.ccs...', '....sckcs....',
  '...ccs.scc...', '..ccs...scc..', '.bbb.....bbb.', 'bbbb.....bbbb', '.bb.......bb.'];
const NODE_CROWN = ['y.....y.....y', 'yy...yyy...yy', 'yyy.yyyyy.yyy', 'yhhyyyyyyyyyy', 'yyyyyyyyyyyyy', 'yyryyybyyyryy', 'yyyyyyyyyyyyy', 'ddddddddddddd'];
const NODE_FIRE_A = ['......o......', '.....oo......', '.....ooo.....', '....ooyo.....', '....oyyoo....', '...ooyyyo....', '...oyywyoo...',
  '...oywwyyo...', '....owwyo....', 'll.lllllll.ll', 'llllLLLLLllll', '.ll.......ll.'];
const NODE_FIRE_B = ['.......o.....', '......oo.....', '.....ooo.....', '.....oyoo....', '....ooyyo....', '....oyyyoo...', '...ooyywyo...',
  '...oyywwyo...', '....oywwo....', 'll.lllllll.ll', 'llllLLLLLllll', '.ll.......ll.'];
const NODE_SIGN = ['......p......', '.wwwwwwwwww..', 'wwwwwwwwwww..', '.wwwwwwwwww..', '......p......', '..wwwwwwwwww.', '..wwwwwwwwwww',
  '..wwwwwwwwww.', '......p......', '......p......', '......p......', '.....ppp.....'];
const NODE_SCROLL = ['.rrrrrrrrrrr.', 'rRrrrrrrrrrRr', '.rrrrrrrrrrr.', '..ppppppppp..', '..plllllllp..', '..ppppppppp..', '..pllllllpp..',
  '..ppppppppp..', '.rrrrrrrrrrr.', 'rRrrrrrrrrrRr', '.rrrrrrrrrrr.'];
const NODE_TICK = ['......g', '.....gg', 'g...gg.', 'gg.gg..', '.ggg...', '..g....'];

const NODE_PAL: Record<string, string> = {
  c: '#fff0d6', s: '#c8b49a', b: '#8a5a3c', k: INK,
  y: '#f6c63c', h: '#fff0a0', r: '#e04f45', d: '#b8781e',
  o: '#f0702a', w: '#fff3c8', l: '#8a5a3c', L: '#5e3a24',
  p: '#8a5a3c', g: '#5cd34f', f: '#e04f45',
};

/** The disc colour behind each mission node's icon on the trail. */
export const MISSION_NODE_FILL: Record<MissionNodeKind, string> = {
  battle: '#e8603c', boss: '#9a3fb8', rest: '#4f9a5a', branch: '#4f8fe0', story: '#c89a4a',
};

/** A mission node's icon: claws (battle), crown (boss), campfire (rest, flickers with `t`), signpost (branch), scroll (story). */
export function missionNodeSprite(kind: MissionNodeKind, t = 0): HTMLCanvasElement {
  switch (kind) {
    case 'battle': return pixelSprite('n|claws', NODE_CLAWS, NODE_PAL);
    case 'boss': return pixelSprite('n|crown', NODE_CROWN, { ...NODE_PAL, b: '#4f9be0' });
    case 'rest': return Math.floor(t * 5) % 2
      ? pixelSprite('n|fireA', NODE_FIRE_A, { ...NODE_PAL, y: '#ffd84a', w: '#fffbe8' })
      : pixelSprite('n|fireB', NODE_FIRE_B, { ...NODE_PAL, y: '#ffd84a', w: '#fffbe8' });
    case 'branch': return pixelSprite('n|sign', NODE_SIGN, { ...NODE_PAL, w: '#f0cc84' });
    default: return pixelSprite('n|scroll', NODE_SCROLL, { ...NODE_PAL, r: '#d8b07a', R: '#9a6e44', p: '#fff2d2', l: '#b0947a' });
  }
}

/** Draw a mission node's icon centred on (cx, cy). */
export function drawMissionNodeIcon(ctx: G, kind: MissionNodeKind, cx: number, cy: number, t = 0, scale = 1): void {
  blitSprite(ctx, missionNodeSprite(kind, t), cx, cy, scale);
}

/** The little green tick on a cleared stop. */
export function drawTickIcon(ctx: G, cx: number, cy: number): void {
  blitSprite(ctx, pixelSprite('tick', NODE_TICK, NODE_PAL), cx, cy);
}
