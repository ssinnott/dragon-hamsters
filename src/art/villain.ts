// Villain renderer: twelve animal body plans, nine outfits and thirteen head props, all layerable, driven by
// VillainVisual. Same local space and pose system as dragon.ts: a size-1.0 villain is about 40 units tall,
// authored facing right, origin on the ground between the feet.
//
// Villains are comic henchmen standing on their hind legs: half-lidded shifty eyes that dart about, a smirk,
// paws rubbed together while scheming. Bosses (size 1.3 and up) puff their chests out and get heavy brows
// and a gold tooth: imposing, in a funny way.
//
// Draw order: cape (back), tail, far arm, legs (or coils / treads), torso, outfit, neckwear, head (ears,
// skull, face), head prop, near arm and held item, particles.

import type { Animal, VillainVisual } from '../data/schema.ts';
import { mix, shade } from '../lib/art/palettes.ts';
import { pathTaperedCapsule, pathRoundedPoly } from '../lib/art/shapes.ts';
import {
  INK, poseState, hash01, drawCreatureFrame, enterLocal, localToGround, outlinePx,
  addEll, addCirc, ink, strokeLine, addTaperQuad, addLeaf, dark, light,
  drawTwinkle, drawSweat, drawZzz, drawDirt, drawSpiral, drawDizzyStars, luma,
} from './dragon.ts';
import type { CreatureOpts, CreatureFrame, PoseState } from './dragon.ts';

export type { Pose, CreatureOpts } from './dragon.ts';

const TAU = Math.PI * 2;
const PINK = '#f2a0aa';
const TEETH = '#fbf6ea';

// ---------------------------------------------------------------------------------------------
// Anatomy: one body plan per animal (size-1 local units, facing right)
// ---------------------------------------------------------------------------------------------

type Plan = 'biped' | 'bird' | 'snake' | 'toad' | 'robot';

interface Anat {
  plan: Plan;
  /** Torso ellipse. */
  tx: number; ty: number; trx: number; try_: number;
  /** Head centre and radius (the skull circle; snouts, beaks and ears hang off it). */
  hx: number; hy: number; hr: number;
  /** Legs: hip height, half the stance width, leg radius, foot ellipse. */
  hipY: number; legX: number; legR: number; footRx: number; footRy: number;
  /** Near shoulder, arm reach, arm and hand radii. */
  shX: number; shY: number; armL: number; armR: number; handR: number;
  /** Eyes in head space: near and far. */
  e1x: number; e1y: number; e1r: number; e2x: number; e2y: number; e2r: number;
  /** Mouth point in head space. */
  mx: number; my: number;
  /** Hat seat (head space y) and the headwear scale. */
  hatY: number; hatK: number;
  /** Neck point (body space), where ties, bandanas and collars sit. */
  nx: number; ny: number;
  /** Highest point at rest (negative). */
  top: number;
  /** Slit pupils (cats, snakes). */
  slit: boolean;
}

function anat(a: Partial<Anat> & Pick<Anat, 'plan' | 'tx' | 'ty' | 'trx' | 'try_' | 'hx' | 'hy' | 'hr' | 'top'>): Anat {
  const hr = a.hr;
  return {
    hipY: a.ty + a.try_ * 0.62, legX: 3.6, legR: 2.3, footRx: 3.4, footRy: 1.9,
    shX: a.tx + 2, shY: a.ty - a.try_ * 0.6, armL: 8, armR: 1.8, handR: 2.1,
    e1x: hr * 0.32, e1y: -hr * 0.18, e1r: hr * 0.3, e2x: hr * 0.82, e2y: -hr * 0.24, e2r: hr * 0.22,
    mx: hr * 0.95, my: hr * 0.62, hatY: -hr * 0.82, hatK: hr / 8,
    nx: a.tx + 1.5, ny: a.ty - a.try_ * 0.82, slit: false,
    ...a,
  };
}

const ANAT: Record<Animal, Anat> = {
  mouse: anat({ plan: 'biped', tx: 0, ty: -14, trx: 8, try_: 9, hx: 2.5, hy: -27, hr: 8, top: -39.5 }),
  rat: anat({
    plan: 'biped', tx: -0.5, ty: -14.5, trx: 9.5, try_: 10, hx: 5, hy: -26.5, hr: 7.6, top: -37,
    legX: 4, legR: 2.5, footRx: 3.8, shX: 2.5, armL: 8.5, armR: 2, handR: 2.2,
    e1x: 7.6 * 0.36, e1y: -7.6 * 0.22, e1r: 7.6 * 0.25, e2x: 7.6 * 0.86, e2y: -7.6 * 0.26, e2r: 7.6 * 0.19,
    mx: 7.6 * 1.3, my: 7.6 * 0.7,
  }),
  crow: anat({
    plan: 'bird', tx: 0, ty: -15, trx: 9, try_: 10.5, hx: 3.5, hy: -28, hr: 7.5, top: -38.5,
    legX: 3, legR: 0.8, shX: 0.5, armL: 9.5, armR: 2.4,
    e1x: 7.5 * 0.25, e1y: -7.5 * 0.25, e1r: 7.5 * 0.3, e2x: 7.5 * 0.72, e2y: -7.5 * 0.32, e2r: 7.5 * 0.18,
  }),
  magpie: anat({
    plan: 'bird', tx: 0, ty: -15.5, trx: 8, try_: 10, hx: 3, hy: -28.5, hr: 7, top: -37.5,
    legX: 2.8, legR: 0.8, shX: 0.5, armL: 9.5, armR: 2.2,
    e1x: 7 * 0.25, e1y: -7 * 0.25, e1r: 7 * 0.3, e2x: 7 * 0.72, e2y: -7 * 0.32, e2r: 7 * 0.18,
  }),
  pigeon: anat({
    plan: 'bird', tx: 0, ty: -14, trx: 10, try_: 10.5, hx: 6, hy: -27, hr: 6.2, top: -33.5,
    legX: 3, legR: 0.9, shX: 0, shY: -20, armL: 9.5, armR: 2.6,
    e1x: 6.2 * 0.3, e1y: -6.2 * 0.2, e1r: 6.2 * 0.32, e2x: 6.2 * 0.78, e2y: -6.2 * 0.26, e2r: 6.2 * 0.2,
    nx: 4, ny: -21,
  }),
  snake: anat({
    plan: 'snake', tx: 2.5, ty: -17, trx: 5.2, try_: 7.5, hx: 5, hy: -28.5, hr: 6.8, top: -35.5,
    e1x: 6.8 * 0.22, e1y: -6.8 * 0.42, e1r: 6.8 * 0.33, e2x: 6.8 * 0.8, e2y: -6.8 * 0.45, e2r: 6.8 * 0.26,
    mx: 6.8 * 1.0, my: 6.8 * 0.38, nx: 3.5, ny: -22.5, slit: true, hatY: -6.8 * 0.72,
  }),
  lizard: anat({
    plan: 'biped', tx: 0, ty: -14.5, trx: 7.5, try_: 9.5, hx: 4, hy: -28, hr: 7, top: -35.5,
    legR: 2.1, footRx: 3.6, footRy: 1.7, armR: 1.6,
    e1x: 7 * 0.08, e1y: -7 * 0.62, e1r: 7 * 0.3, e2x: 7 * 0.64, e2y: -7 * 0.68, e2r: 7 * 0.25,
    mx: 7 * 0.9, my: 7 * 0.42, hatY: -7 * 0.88,
  }),
  toad: anat({
    plan: 'toad', tx: 0, ty: -10.5, trx: 13.5, try_: 10, hx: 4.5, hy: -19.5, hr: 8.5, top: -30,
    shX: 5, shY: -11, armL: 9, armR: 2.3, handR: 2.4,
    e1x: -8.5 * 0.22, e1y: -8.5 * 0.78, e1r: 8.5 * 0.3, e2x: 8.5 * 0.56, e2y: -8.5 * 0.84, e2r: 8.5 * 0.25,
    mx: 8.5 * 0.5, my: 8.5 * 0.32, hatY: -8.5 * 0.98, nx: 5, ny: -14,
  }),
  cat: anat({
    plan: 'biped', tx: 0, ty: -14, trx: 8, try_: 9.5, hx: 3, hy: -27.5, hr: 8.3, top: -41,
    e1x: 8.3 * 0.3, e1y: -8.3 * 0.15, e1r: 8.3 * 0.31, e2x: 8.3 * 0.84, e2y: -8.3 * 0.2, e2r: 8.3 * 0.24,
    mx: 8.3 * 1.1, my: 8.3 * 0.55, slit: true,
  }),
  ferret: anat({
    plan: 'biped', tx: 0, ty: -15.5, trx: 6.8, try_: 11, hx: 3, hy: -30, hr: 7, top: -38.5,
    legX: 3, legR: 2, footRx: 3.1, armR: 1.6, handR: 1.9,
    e1x: 7 * 0.32, e1y: -7 * 0.18, e1r: 7 * 0.28, e2x: 7 * 0.86, e2y: -7 * 0.22, e2r: 7 * 0.21,
    mx: 7 * 1.05, my: 7 * 0.66,
  }),
  robot: anat({
    plan: 'robot', tx: 0, ty: -15, trx: 8.5, try_: 9, hx: 0.5, hy: -30.5, hr: 6.8, top: -38.5,
    shX: 1.5, shY: -21.5, armL: 8.5, armR: 1.6, handR: 2.2,
    e1x: 6.8 * 0.05, e1y: -6.8 * 0.08, e1r: 6.8 * 0.26, e2x: 6.8 * 0.62, e2y: -6.8 * 0.08, e2r: 6.8 * 0.26,
    mx: 6.8 * 0.33, my: 6.8 * 0.3, hatY: -6.8 * 0.85, nx: 1, ny: -24,
  }),
  weasel: anat({
    plan: 'biped', tx: 0.5, ty: -15, trx: 6.2, try_: 10.5, hx: 4.5, hy: -31, hr: 6.6, top: -38.5,
    legX: 2.9, legR: 1.9, footRx: 3, armR: 1.5, handR: 1.8, shY: -21,
    e1x: 6.6 * 0.36, e1y: -6.6 * 0.18, e1r: 6.6 * 0.27, e2x: 6.6 * 0.88, e2y: -6.6 * 0.22, e2r: 6.6 * 0.2,
    mx: 6.6 * 1.25, my: 6.6 * 0.55, nx: 2.5, ny: -24.5,
  }),
};

/** Height in px of a villain drawn at `scale` (ground to ear or crest tips; hats stick out above). */
export function villainHeight(v: VillainVisual, scale = 1): number {
  return -ANAT[v.animal].top * v.size * scale;
}

// ---------------------------------------------------------------------------------------------
// Palette (cached per visual object)
// ---------------------------------------------------------------------------------------------

interface VPal {
  body: string; bodySh: string; bodyHi: string; bodyFar: string;
  belly: string; bellySh: string;
  accent: string; accentSh: string; accentHi: string;
  eye: string;
  out: string; outSh: string; outHi: string; outFar: string;
  hat: string; hatSh: string; hatHi: string;
  /** Arm fill (a sleeve when the outfit has one). */
  sleeve: string; sleeveFar: string;
  /** Leg fill (tracksuit trousers recolour them). */
  leg: string; legFar: string;
  hand: string; handFar: string;
  foot: string; footFar: string;
  nose: string; beak: string; beakSh: string;
  /** Labcoat white. */
  coat: string; coatSh: string;
}

const palCache = new WeakMap<VillainVisual, VPal>();

/** Highlight tone that still reads on near-black fur and cloth. */
function hiTone(hex: string, k: number): string {
  const lum = luma(hex);
  return lum < 0.28 ? mix(hex, '#9a9ad0', 0.2 + (0.28 - lum) * 0.9) : light(hex, k);
}
/** Base tone for very dark colours: lifted a touch so the ink outline and shadow still separate from it. */
function liftDark(hex: string): string {
  const lum = luma(hex);
  return lum < 0.17 ? mix(hex, '#6a6a90', (0.17 - lum) * 1.6) : hex;
}

function vpal(v: VillainVisual): VPal {
  let P = palCache.get(v);
  if (P) return P;
  const a = v.animal;
  const sleeves = v.outfit === 'suit' || v.outfit === 'trenchcoat' || v.outfit === 'labcoat' || v.outfit === 'tracksuit';
  const coat = mix(v.outfitColor, '#f6f6fa', 0.8);
  const sleeve = v.outfit === 'labcoat' ? coat : sleeves ? liftDark(v.outfitColor) : liftDark(v.body);
  const leg = v.outfit === 'tracksuit' ? liftDark(v.outfitColor) : liftDark(v.body);
  const hand = a === 'mouse' || a === 'rat' ? mix(PINK, v.body, 0.25)
    : a === 'cat' || a === 'ferret' || a === 'weasel' ? v.belly
      : a === 'robot' ? shade(v.body, 0.85) : liftDark(v.body);
  const foot = a === 'mouse' || a === 'rat' ? mix(PINK, v.body, 0.25)
    : a === 'pigeon' ? '#e8848c' : a === 'crow' || a === 'magpie' ? '#3e3a48'
      : a === 'cat' || a === 'ferret' || a === 'weasel' ? v.belly : liftDark(v.body);
  const beak = a === 'pigeon' ? '#4a4250' : a === 'magpie' ? '#26222e' : '#3e3a4a';
  const hat = v.outfit === 'none' ? '#3a3448' : liftDark(shade(v.outfitColor, 0.82));
  const body = liftDark(v.body), out = liftDark(v.outfitColor);
  P = {
    body, bodySh: dark(body, 0.76), bodyHi: hiTone(body, 0.3), bodyFar: dark(body, 0.72),
    belly: v.belly, bellySh: dark(v.belly, 0.85),
    accent: v.accent, accentSh: dark(v.accent, 0.74), accentHi: light(v.accent, 0.4),
    eye: v.eye,
    out, outSh: dark(out, 0.74), outHi: hiTone(out, 0.28), outFar: dark(out, 0.7),
    hat, hatSh: dark(hat, 0.72), hatHi: hiTone(hat, 0.3),
    sleeve, sleeveFar: dark(sleeve, 0.72),
    leg, legFar: dark(leg, 0.72),
    hand, handFar: dark(hand, 0.75),
    foot, footFar: dark(foot, 0.75),
    nose: a === 'rat' ? '#c8606e' : a === 'weasel' || a === 'ferret' ? '#5a3a3a' : '#e8788a',
    beak, beakSh: dark(beak, 0.7),
    coat, coatSh: dark(coat, 0.84),
  };
  palCache.set(v, P);
  return P;
}

// ---------------------------------------------------------------------------------------------
// Per-draw context
// ---------------------------------------------------------------------------------------------

interface VC {
  v: VillainVisual; A: Anat; P: VPal; st: PoseState; fr: CreatureFrame;
  ow: number; t: number; fx: boolean; boss: boolean; phase: number;
  /** Torso size after the boss chest puff. */
  trx: number; try_: number;
  /** Posed head centre and tilt. */
  hx: number; hy: number; tilt: number;
  /** Shifty pupil direction: -1 back .. 1 forward. */
  look: number;
}

export function drawVillain(ctx: CanvasRenderingContext2D, v: VillainVisual, x: number, y: number, opts: CreatureOpts = {}): void {
  const scale = opts.scale ?? 1;
  const facing: 1 | -1 = opts.facing === -1 ? -1 : 1;
  const t = opts.t ?? 0;
  const A = ANAT[v.animal];
  const P = vpal(v);
  const phase = hash01([v.animal, v.body, v.outfit, v.prop, v.size]);
  const st = poseState(opts.pose ?? 'idle', t, opts.poseT ?? 0, phase);
  if (A.plan === 'snake' && (st.pose === 'walk' || st.pose === 'run')) { st.oy *= 0.3; st.rot *= 0.5; }
  if (st.pose === 'happy') st.paws = 'rest';
  const boss = v.size >= 1.3;
  const S = scale * v.size;
  const fr: CreatureFrame = {
    S, facing, alpha: opts.alpha ?? 1, flash: opts.flash ?? 0, silhouette: opts.silhouette ?? null, st,
    shadowRx: Math.max(A.trx * (A.plan === 'snake' ? 1.6 : 1.1), A.legX + A.footRx + 1),
  };
  const ow = outlinePx(scale, v.size) / S * 0.5;
  const u = (t * 0.5 + phase * 3) % 4.2;
  const look = u < 0.55 ? -1 : u < 0.75 ? 0.1 : u < 2.6 ? 0.85 : u < 2.9 ? 0.2 : 0.85;
  drawCreatureFrame(ctx, x, y, fr, (g, fx) => {
    const D: VC = {
      v, A, P, st, fr, ow, t, fx, boss, phase,
      trx: A.trx * (boss ? 1.07 : 1), try_: A.try_ * (boss ? 1.03 : 1),
      hx: A.hx + st.headDx, hy: A.hy + st.headDy, tilt: st.tilt, look,
    };
    if (v.animal === 'pigeon' && (st.pose === 'walk' || st.pose === 'run')) D.hx += Math.sin(st.step * 2) * 1.6;
    g.save();
    enterLocal(g, fr);
    renderVillain(g, D);
    g.restore();
    if (fx && st.zzz) {
      const pt = localToGround(fr, D.hx + A.hr * 0.6, D.hy - A.hr * 1.2, { x: 0, y: 0 });
      drawZzz(g, pt.x, pt.y, S, t, facing);
    }
  });
}

function renderVillain(g: CanvasRenderingContext2D, D: VC): void {
  const { v, A, st } = D;
  if (v.outfit === 'cape') drawCapeBack(g, D);
  drawVTail(g, D);
  if (A.plan !== 'snake') drawArm(g, D, false);
  drawLegs(g, D, false);
  drawTorso(g, D);
  drawLegs(g, D, true);
  drawOutfit(g, D);
  drawNeckwear(g, D);
  drawVHead(g, D);
  if (A.plan !== 'snake') drawArm(g, D, true);
  if (v.outfit === 'armor' && A.plan !== 'snake') drawPauldron(g, D, true);
  if (!D.fx) return;
  const top = D.hy - A.hr;
  if (st.sweat) drawSweat(g, D.hx - A.hr * 0.85, D.hy - A.hr * 0.55, 1.8, D.ow);
  if (st.eyes === 'dizzy' && st.p < 0.75) drawDizzyStars(g, D.hx, top - 1.5, A.hr * 0.85, D.t, D.ow);
  if (st.hearts) {
    // Villains do not do hearts: they gloat in sparkles.
    for (let i = 0; i < 3; i++) {
      const s = Math.max(0, Math.sin(D.t * 5 + i * 2.1));
      drawTwinkle(g, D.hx + (i - 1) * A.hr * 1.2, top - 3 - (i % 2) * 4, s * 2.6, '#ffe14a', D.ow);
    }
  }
  if (st.dirt) drawDirt(g, A.tx - D.trx * 0.4, D.t, D.ow);
}

// ---------------------------------------------------------------------------------------------
// Shared shading: an inked blob with an underside shadow and a top highlight
// ---------------------------------------------------------------------------------------------

type BlobPath = (g: CanvasRenderingContext2D, k: number, dy: number) => void;

function celBlob(g: CanvasRenderingContext2D, D: VC, path: BlobPath, base: string, sh: string, hi: string | null,
  hiX: number, hiY: number, hiRx: number, hiRy: number, extra?: () => void): void {
  path(g, 1, 0);
  ink(g, sh, D.ow);
  g.save();
  g.clip();
  path(g, 0.985, -0.14);
  g.fillStyle = base; g.fill();
  if (extra) extra();
  if (hi) { g.beginPath(); addEll(g, hiX, hiY, hiRx, hiRy, -0.35); g.fillStyle = hi; g.fill(); }
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Torso
// ---------------------------------------------------------------------------------------------

function drawTorso(g: CanvasRenderingContext2D, D: VC): void {
  const { v, A, P } = D;
  if (A.plan === 'robot') { drawRobotBody(g, D); return; }
  if (A.plan === 'snake') { drawSnakeNeck(g, D); return; }
  const tx = A.tx, ty = A.ty, rx = D.trx, ry = D.try_;
  const pigeon = v.animal === 'pigeon';
  const path: BlobPath = (gg, k, dy) => {
    gg.beginPath();
    addEll(gg, tx, ty + dy * ry, rx * k, ry * k);
    if (pigeon) addCirc(gg, tx + rx * 0.5, ty - ry * 0.32 + dy * ry * 0.6, ry * 0.62 * k);
  };
  celBlob(g, D, path, P.body, P.bodySh, P.bodyHi, tx - rx * 0.35, ty - ry * 0.68, rx * 0.36, ry * 0.15, () => {
    switch (v.animal) {
      case 'magpie':
        g.beginPath(); addEll(g, tx + rx * 0.25, ty + ry * 0.38, rx * 0.88, ry * 0.68); g.fillStyle = P.belly; g.fill();
        g.beginPath(); addEll(g, tx - rx * 0.55, ty - ry * 0.15, rx * 0.35, ry * 0.42, 0.4); g.fillStyle = P.belly; g.fill();
        break;
      case 'pigeon':
        g.beginPath(); addEll(g, tx + rx * 0.5, ty - ry * 0.05, rx * 0.55, ry * 0.75); g.fillStyle = P.belly; g.fill();
        g.save(); g.globalAlpha *= 0.8;
        g.beginPath(); addEll(g, A.nx + 1, A.ny + 1.2, 5.2, 3.4, -0.2); g.fillStyle = P.accent; g.fill();
        g.beginPath(); addEll(g, A.nx + 2.4, A.ny + 2.2, 3, 1.8, -0.2); g.fillStyle = mix(P.accent, '#b070d0', 0.6); g.fill();
        g.restore();
        break;
      case 'crow':
        g.beginPath(); addEll(g, tx + rx * 0.35, ty + ry * 0.2, rx * 0.55, ry * 0.7); g.fillStyle = P.belly; g.fill();
        g.beginPath();
        for (let i = 0; i < 3; i++) { const yy = ty - ry * 0.1 + i * 3; g.moveTo(tx + rx * 0.1, yy); g.quadraticCurveTo(tx + rx * 0.35, yy + 1.4, tx + rx * 0.6, yy); }
        strokeLine(g, P.bodySh, D.ow);
        break;
      case 'toad': {
        g.beginPath(); addEll(g, tx + rx * 0.45, ty + ry * 0.35, rx * 0.5, ry * 0.6); g.fillStyle = P.belly; g.fill();
        g.beginPath();
        const warts: [number, number, number][] = [[-0.55, -0.55, 1.5], [-0.2, -0.75, 1.2], [-0.75, -0.1, 1.3], [-0.35, -0.25, 1], [0.05, -0.5, 0.9]];
        for (const [wx, wy, wr] of warts) addCirc(g, tx + rx * wx, ty + ry * wy, wr);
        g.fillStyle = P.accent; g.fill();
        break;
      }
      case 'lizard':
        g.beginPath(); addEll(g, tx + rx * 0.38, ty + ry * 0.15, rx * 0.5, ry * 0.75); g.fillStyle = P.belly; g.fill();
        g.beginPath();
        for (let i = 0; i < 4; i++) { const yy = ty - ry * 0.35 + i * 3.2; g.moveTo(tx + rx * 0.0, yy); g.lineTo(tx + rx * 0.85, yy + 0.4); }
        strokeLine(g, P.bellySh, D.ow * 0.8);
        break;
      default:
        g.beginPath(); addEll(g, tx + rx * 0.36, ty + ry * 0.18, rx * 0.55, ry * 0.72); g.fillStyle = P.belly; g.fill();
        if (v.animal === 'weasel' || v.animal === 'ferret') {
          g.beginPath(); addEll(g, tx + rx * 0.4, ty - ry * 0.55, rx * 0.5, ry * 0.4); g.fillStyle = P.belly; g.fill();
        }
        if (v.animal === 'cat') {
          g.beginPath();
          for (let i = 0; i < 3; i++) { const xx = tx - rx * 0.75 + i * 2.6; g.moveTo(xx, ty - ry * 0.85); g.lineTo(xx - 1, ty - ry * 0.35); }
          strokeLine(g, P.accent, 1.6);
        }
    }
  });
  if (v.animal === 'lizard') {
    // dorsal crest along the back
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = Math.PI * (1.15 + i * 0.12), x = tx + Math.cos(a) * rx, y = ty + Math.sin(a) * ry;
      g.moveTo(x - 1.4, y + 0.6); g.lineTo(x + Math.cos(a) * 2.6, y + Math.sin(a) * 2.6); g.lineTo(x + 1.4, y + 0.3); g.closePath();
    }
    ink(g, P.accent, D.ow * 0.8);
  }
}

function drawRobotBody(g: CanvasRenderingContext2D, D: VC): void {
  const { A, P, t } = D;
  const x0 = A.tx - D.trx, y0 = A.ty - D.try_, w = D.trx * 2, h = D.try_ * 2;
  // neck
  g.beginPath(); g.rect(A.hx - 2, y0 - 3, 4, 4); ink(g, P.bodySh, D.ow);
  g.beginPath(); g.rect(A.hx - 2, y0 - 2, 4, 0.9); g.fillStyle = P.bodyHi; g.fill();
  pathRoundedPoly(g, [x0, y0, x0 + w, y0, x0 + w, y0 + h, x0, y0 + h], 3);
  ink(g, P.bodySh, D.ow);
  g.save(); g.clip();
  pathRoundedPoly(g, [x0, y0 - 1, x0 + w, y0 - 1, x0 + w, y0 + h - 2.2, x0, y0 + h - 2.2], 3);
  g.fillStyle = P.body; g.fill();
  g.fillStyle = P.bodyHi; g.fillRect(x0 + 1.5, y0 + 1, w * 0.45, 1.2);
  g.restore();
  // chest panel with blinking lights
  const px = A.tx - D.trx * 0.15, py = A.ty - D.try_ * 0.45, pw = D.trx * 1.05, ph = D.try_ * 0.95;
  pathRoundedPoly(g, [px, py, px + pw, py, px + pw, py + ph, px, py + ph], 1.5);
  ink(g, P.belly, D.ow * 0.8);
  for (let i = 0; i < 3; i++) {
    const on = Math.sin(t * 4 + i * 2.1) > -0.2;
    g.beginPath(); addCirc(g, px + pw * (0.22 + i * 0.28), py + ph * 0.3, 1.1);
    ink(g, on ? P.accent : P.accentSh, D.ow * 0.5);
  }
  g.beginPath();
  g.moveTo(px + pw * 0.15, py + ph * 0.68); g.lineTo(px + pw * 0.85, py + ph * 0.68);
  g.moveTo(px + pw * 0.15, py + ph * 0.84); g.lineTo(px + pw * 0.6, py + ph * 0.84);
  strokeLine(g, P.bellySh, D.ow * 1.2);
  // rivets
  g.fillStyle = P.bodySh;
  for (const [rx, ry] of [[x0 + 1.6, y0 + 1.8], [x0 + w - 1.6, y0 + 1.8], [x0 + 1.6, y0 + h - 2], [x0 + w - 1.6, y0 + h - 2]]) {
    g.beginPath(); addCirc(g, rx, ry, 0.65); g.fill();
  }
}

function snakeNeckPath(g: CanvasRenderingContext2D, D: VC, w: number, off: number): void {
  const { A } = D;
  const x0 = A.tx - 3.5 + off, y0 = -6.5, x1 = D.hx - 1.5 + off, y1 = D.hy + A.hr * 0.45;
  addTaperQuad(g, x0, y0, A.tx + 6 + off, -15, x1, y1, w, w * 0.72, 12);
}

function drawSnakeNeck(g: CanvasRenderingContext2D, D: VC): void {
  const { P } = D;
  g.beginPath(); snakeNeckPath(g, D, 9.5, 0);
  ink(g, P.bodySh, D.ow);
  g.save(); g.clip();
  g.beginPath(); snakeNeckPath(g, D, 8.2, -0.8); g.fillStyle = P.body; g.fill();
  g.beginPath(); snakeNeckPath(g, D, 3.8, 3.4); g.fillStyle = P.belly; g.fill();
  g.restore();
  // belly scale lines
  g.beginPath();
  for (let i = 0; i < 5; i++) {
    const u = 0.15 + i * 0.17, iu = 1 - u;
    const x = iu * iu * (D.A.tx - 0.1) + 2 * iu * u * (D.A.tx + 9.4) + u * u * (D.hx + 1.9);
    const y = iu * iu * -6.5 + 2 * iu * u * -15 + u * u * (D.hy + D.A.hr * 0.45);
    g.moveTo(x - 1.6, y); g.lineTo(x + 1.6, y + 0.3);
  }
  strokeLine(g, P.bellySh, D.ow * 0.8);
  // diamond markings down the back
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    const u = 0.2 + i * 0.25, iu = 1 - u;
    const x = iu * iu * (D.A.tx - 6.5) + 2 * iu * u * (D.A.tx + 3) + u * u * (D.hx - 4.5);
    const y = iu * iu * -6.5 + 2 * iu * u * -15 + u * u * (D.hy + D.A.hr * 0.45);
    g.moveTo(x, y - 1.6); g.lineTo(x + 1.3, y); g.lineTo(x, y + 1.6); g.lineTo(x - 1.3, y); g.closePath();
  }
  g.fillStyle = P.accent; g.fill();
}

// ---------------------------------------------------------------------------------------------
// Legs, coils, treads
// ---------------------------------------------------------------------------------------------

function drawLegs(g: CanvasRenderingContext2D, D: VC, front: boolean): void {
  const { A, P, st, v } = D;
  switch (A.plan) {
    case 'snake': if (!front) drawCoils(g, D); return;
    case 'robot': if (!front) drawTreads(g, D); return;
    case 'toad': drawToadLegs(g, D, front); return;
    case 'bird': case 'biped': break;
  }
  if (front) return;
  const stance = D.boss ? 1.18 : 1;
  for (const near of [false, true]) {
    const side = near ? 1 : -1;
    const ph = st.step + (near ? 0 : Math.PI);
    const lift = Math.max(0, Math.sin(ph)) * 2.6 * st.stepAmp;
    const swing = Math.cos(ph) * 2.2 * st.stepAmp;
    const hipX = A.tx + side * A.legX * 0.55, hipY = A.hipY;
    const fx = A.tx + side * A.legX * stance + swing, fy = -A.footRy - lift + (A.plan === 'bird' ? 0.9 : 0);
    if (A.plan === 'bird') {
      const col = near ? P.foot : P.footFar;
      g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(fx, fy);
      strokeLine(g, INK, A.legR * 2 + D.ow * 2);
      g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(fx, fy);
      strokeLine(g, col, A.legR * 2);
      g.beginPath();
      g.moveTo(fx - 2.4, fy + 0.6); g.lineTo(fx, fy); g.lineTo(fx + 3.2, fy + 0.7);
      g.moveTo(fx, fy); g.lineTo(fx + 2.2, fy + 1.1);
      strokeLine(g, INK, 1.2 + D.ow * 2);
      g.beginPath();
      g.moveTo(fx - 2.4, fy + 0.6); g.lineTo(fx, fy); g.lineTo(fx + 3.2, fy + 0.7);
      g.moveTo(fx, fy); g.lineTo(fx + 2.2, fy + 1.1);
      strokeLine(g, col, 1.2);
      continue;
    }
    const lc = near ? P.leg : P.legFar;
    g.beginPath(); pathTaperedCapsule(g, hipX, hipY, fx - 0.4, fy - 0.6, A.legR * 1.15, A.legR, false);
    ink(g, lc, D.ow);
    if (v.outfit === 'tracksuit') {
      g.beginPath(); g.moveTo(hipX + 0.3, hipY + 1); g.lineTo(fx - 0.1, fy - 1.4); strokeLine(g, '#ffffff', 0.9);
    }
    const fc = near ? P.foot : P.footFar;
    g.beginPath(); addEll(g, fx + 0.9, fy, A.footRx, A.footRy);
    ink(g, fc, D.ow);
    if (near) {
      g.beginPath(); g.moveTo(fx + A.footRx * 0.5, fy - 0.5); g.lineTo(fx + A.footRx * 0.5, fy + 0.8);
      g.moveTo(fx + A.footRx * 0.95, fy - 0.4); g.lineTo(fx + A.footRx * 0.95, fy + 0.7);
      strokeLine(g, dark(fc, 0.75), D.ow * 0.9);
    }
  }
}

function drawToadLegs(g: CanvasRenderingContext2D, D: VC, front: boolean): void {
  const { A, P, st } = D;
  const hop = Math.max(0, Math.sin(st.step)) * 1.5 * st.stepAmp;
  if (!front) {
    g.beginPath(); addEll(g, A.tx + D.trx * 0.15, -4.8, 5.5, 4.2, -0.3); ink(g, P.bodyFar, D.ow);
    g.beginPath(); addEll(g, A.tx + D.trx * 0.38, -1.5, 4, 1.6); ink(g, P.bodyFar, D.ow);
    return;
  }
  const hx = A.tx - D.trx * 0.42, hy = -6.2 - hop;
  const path: BlobPath = (gg, k, dy) => { gg.beginPath(); addEll(gg, hx, hy + dy * 5.2, 6.8 * k, 5.2 * k, -0.35); };
  celBlob(g, D, path, P.body, P.bodySh, P.bodyHi, hx - 2, hy - 3, 2.5, 1, () => {
    g.beginPath(); addCirc(g, hx - 2.5, hy + 0.5, 1.2); addCirc(g, hx + 1.5, hy - 1.5, 0.9); g.fillStyle = P.accent; g.fill();
  });
  // webbed hind foot
  const fx = hx + 4.5, fy = -1.4;
  g.beginPath();
  g.moveTo(fx - 4, fy - 1.3); g.lineTo(fx + 2, fy - 1.6); g.lineTo(fx + 5, fy - 1.8); g.lineTo(fx + 4, fy);
  g.lineTo(fx + 5.4, fy + 0.6); g.lineTo(fx + 2, fy + 1.2); g.lineTo(fx - 4, fy + 1.1); g.closePath();
  ink(g, P.body, D.ow);
}

function drawCoils(g: CanvasRenderingContext2D, D: VC): void {
  const { A, P, st, t } = D;
  const wig = st.stepAmp > 0 ? Math.sin(st.step) * 1.5 : Math.sin(t * 1.5) * 0.3;
  // tail tip curling out of the bottom coil
  const tx0 = A.tx - 13 + wig, ty0 = -3;
  g.beginPath(); addTaperQuad(g, tx0 + 3, ty0, tx0 - 3, ty0 - 0.5, tx0 - 4 + Math.sin(t * 2) * 0.8, ty0 - 6, 4, 0.8, 8);
  ink(g, P.body, D.ow);
  const coil = (cx: number, cy: number, rx: number, ry: number) => {
    const path: BlobPath = (gg, k, dy) => { gg.beginPath(); addEll(gg, cx, cy + dy * ry, rx * k, ry * k); };
    celBlob(g, D, path, P.body, P.bodySh, P.bodyHi, cx - rx * 0.3, cy - ry * 0.55, rx * 0.35, ry * 0.18, () => {
      g.beginPath(); addEll(g, cx + rx * 0.1, cy + ry * 0.75, rx * 0.8, ry * 0.32); g.fillStyle = P.belly; g.fill();
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const x = cx - rx * 0.6 + i * rx * 0.4, y = cy - ry * 0.35;
        g.moveTo(x, y - 1.3); g.lineTo(x + 1.2, y); g.lineTo(x, y + 1.3); g.lineTo(x - 1.2, y); g.closePath();
      }
      g.fillStyle = P.accent; g.fill();
    });
  };
  coil(A.tx - 2.5 + wig, -3.8, 12.5, 4.2);
  coil(A.tx - 1 - wig * 0.6, -8, 9.5, 3.7);
}

function drawTreads(g: CanvasRenderingContext2D, D: VC): void {
  const { A, P, st, t } = D;
  const x0 = A.tx - 10, y0 = -7, w = 20, h = 7;
  pathRoundedPoly(g, [x0, y0, x0 + w, y0, x0 + w, y0 + h, x0, y0 + h], 3.4);
  ink(g, '#3a3e4a', D.ow);
  g.beginPath(); g.rect(x0 + 2, y0 + 0.6, w - 4, 1); g.fillStyle = '#5a6070'; g.fill();
  const spin = st.stepAmp > 0 ? st.step * 1.3 : t * 0.3;
  for (let i = 0; i < 3; i++) {
    const cx = x0 + 4 + i * 6, cy = y0 + 3.8;
    g.beginPath(); addCirc(g, cx, cy, 2.3); ink(g, P.body, D.ow * 0.8);
    g.beginPath();
    for (let k = 0; k < 2; k++) {
      const a = spin + k * Math.PI / 2;
      g.moveTo(cx - Math.cos(a) * 1.8, cy - Math.sin(a) * 1.8); g.lineTo(cx + Math.cos(a) * 1.8, cy + Math.sin(a) * 1.8);
    }
    strokeLine(g, P.bodySh, D.ow);
  }
  // tread teeth along the bottom
  g.fillStyle = INK;
  const off = (spin * 2) % 3;
  for (let x = x0 + 2 + off; x < x0 + w - 1.5; x += 3) g.fillRect(x, y0 + h - 0.2, 1.2, 0.9);
}

// ---------------------------------------------------------------------------------------------
// Tails
// ---------------------------------------------------------------------------------------------

function drawVTail(g: CanvasRenderingContext2D, D: VC): void {
  const { v, A, P, st, t } = D;
  const sway = Math.sin(t * 1.8 + D.phase * 6) * 0.15 + st.tail * 0.6;
  const bx = A.tx - D.trx * 0.82, by = A.ty + D.try_ * 0.5;
  g.save();
  g.translate(bx, by);
  g.rotate(-sway);
  switch (v.animal) {
    case 'mouse':
      g.beginPath(); addTaperQuad(g, 1, 0, -10, 6, -14, -6, 2, 0.6, 14);
      ink(g, PINK, D.ow);
      break;
    case 'rat': {
      g.beginPath(); addTaperQuad(g, 1, 0, -11, 7, -16, -3, 3.2, 0.8, 14);
      ink(g, mix(PINK, '#c88a90', 0.4), D.ow);
      g.beginPath();
      for (let i = 1; i < 7; i++) {
        const u = i / 7, iu = 1 - u;
        const x = iu * iu + 2 * iu * u * -11 + u * u * -16, y = 2 * iu * u * 7 + u * u * -3;
        const w = (3.2 + (0.8 - 3.2) * u) * 0.5;
        g.moveTo(x - w * 0.5, y - w); g.lineTo(x + w * 0.5, y + w);
      }
      strokeLine(g, '#b06a74', D.ow * 0.8);
      break;
    }
    case 'cat': {
      g.beginPath(); addTaperQuad(g, 1, 0, -12, 2, -10, -16, 3.4, 2.4, 14);
      ink(g, P.body, D.ow);
      g.beginPath();
      for (let i = 1; i < 4; i++) {
        const u = i / 4.3, iu = 1 - u;
        const x = iu * iu + 2 * iu * u * -12 + u * u * -10, y = 2 * iu * u * 2 + u * u * -16;
        addEll(g, x, y, 1.6, 0.8, 0.6 - u);
      }
      g.fillStyle = P.accent; g.fill();
      break;
    }
    case 'ferret':
    case 'weasel': {
      const fl = v.animal === 'ferret' ? 1.25 : 1;
      g.beginPath(); addTaperQuad(g, 1, 0, -9, 4, -14 * fl, -5 * fl, 4.5 * fl, 3 * fl, 12);
      ink(g, P.body, D.ow);
      g.save();
      g.beginPath(); addTaperQuad(g, 1, 0, -9, 4, -14 * fl, -5 * fl, 4.5 * fl, 3 * fl, 12); g.clip();
      g.beginPath(); addCirc(g, -14 * fl, -5 * fl, 4 * fl); g.fillStyle = P.accent; g.fill();
      g.restore();
      break;
    }
    case 'lizard': {
      g.translate(0, -1.5);
      g.beginPath(); addTaperQuad(g, 2, -1, -8, 9, -20, 4, 5.5, 1, 14);
      ink(g, P.body, D.ow);
      g.beginPath();
      for (let i = 1; i < 4; i++) {
        const u = i / 4, iu = 1 - u;
        const x = iu * iu * 2 + 2 * iu * u * -8 + u * u * -20, y = iu * iu * -1 + 2 * iu * u * 9 + u * u * 4;
        addEll(g, x, y - 0.6, 1.4 * (1 - u * 0.6), 0.7, -0.3);
      }
      g.fillStyle = P.accent; g.fill();
      g.beginPath(); addCirc(g, -20 + 0.6, 4 - 0.6, 0.2); g.fill();
      break;
    }
    case 'crow':
      for (let i = 2; i >= 0; i--) {
        g.beginPath(); addLeaf(g, 1, -1, Math.PI * (0.78 + i * 0.07), 11 - i, 2.4);
        ink(g, i === 1 ? P.body : P.bodySh, D.ow);
      }
      break;
    case 'magpie':
      for (let i = 1; i >= 0; i--) {
        g.beginPath(); addLeaf(g, 1, -1, Math.PI * (0.84 + i * 0.06), 18 - i * 2, 2.3);
        ink(g, i ? P.bodySh : P.body, D.ow);
        g.beginPath(); addLeaf(g, -3, -1 + 0.2 * i, Math.PI * (0.84 + i * 0.06), 11 - i, 0.9);
        g.fillStyle = P.accent; g.fill();
      }
      break;
    case 'pigeon':
      g.beginPath(); addLeaf(g, 1, -1, Math.PI * 0.88, 9, 3); ink(g, P.bodySh, D.ow);
      g.beginPath(); addLeaf(g, 1, -1, Math.PI * 0.8, 8, 2.6); ink(g, P.body, D.ow);
      g.beginPath(); addEll(g, -6.5, 1.2, 1.8, 2.2, 0.5); g.fillStyle = INK; g.fill();
      break;
    case 'robot': {
      // a power cord with a plug: the most villainous of tails
      g.rotate(sway * 0.6);
      g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-6, 4, -8, 10, -14, 9.5);
      strokeLine(g, INK, 1.4 + D.ow * 2);
      g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-6, 4, -8, 10, -14, 9.5);
      strokeLine(g, '#5a5e6a', 1.4);
      g.beginPath(); g.rect(-18, 7.8, 4.2, 3.4); ink(g, '#2e3240', D.ow);
      g.beginPath(); g.moveTo(-18, 8.6); g.lineTo(-19.6, 8.6); g.moveTo(-18, 10.4); g.lineTo(-19.6, 10.4);
      strokeLine(g, '#e0c060', 0.9);
      break;
    }
    case 'snake':
    case 'toad':
      break;
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Arms (paws, wings, robot claws) and held items
// ---------------------------------------------------------------------------------------------

function armTarget(D: VC, near: boolean, sx: number, sy: number): [number, number] {
  const { A, st, t } = D;
  const tx = A.tx, ty = A.ty, rx = D.trx, ry = D.try_, L = A.armL;
  switch (st.paws) {
    case 'rest': {
      const sp = st.pose === 'happy' ? 16 : D.boss ? 9 : 7, rub = Math.sin(t * sp) * 0.75;
      return near ? [tx + rx * 0.84 + rub * 0.4, ty + ry * 0.46 + rub] : [tx + rx * 1.04 - rub * 0.4, ty + ry * 0.38 - rub];
    }
    case 'walk': { const s = Math.sin(st.step) * 3 * st.stepAmp * (near ? 1 : -1); return [sx + 1.5 + s, sy + L * 0.92]; }
    case 'attack': {
      const k = st.p < 0.22 ? -0.5 : st.p < 0.56 ? 1 : 1 - (st.p - 0.56) / 0.44;
      return near ? [sx + 2 + L * 1.05 * k, sy + 2 - k * 1.5] : [sx - 2.5, sy + L * 0.72];
    }
    case 'up': { const b = Math.sin(t * 15 + (near ? 0 : 1)) * 0.9; return near ? [sx + 4.5, sy - L * 0.4 + b] : [sx - 4.5, sy - L * 0.45 + b]; }
    case 'limp': return near ? [sx - 1, sy + L] : [sx - 2.5, sy + L * 0.95];
    case 'fold': return near ? [tx + rx * 0.1, ty - ry * 0.32] : [tx + rx * 0.85, ty - ry * 0.42];
    case 'eat': return near ? [D.hx + A.hr * 0.9, D.hy + A.hr * 0.95 + st.chew * 0.5] : [tx + rx * 0.85, ty - ry * 0.15];
    case 'dig': {
      const s = Math.sin(t * 20) * (near ? 1 : -1);
      return [sx + L * 0.75 + s * 1.5, sy + L * 0.8 - Math.max(0, s) * 2.5];
    }
  }
}

function drawArm(g: CanvasRenderingContext2D, D: VC, near: boolean): void {
  const { v, A, P, st } = D;
  const sx = A.shX + (near ? 0 : -3.2), sy = A.shY + (near ? 0 : 0.7);
  let [hx, hy] = armTarget(D, near, sx, sy);
  // arms stretch a little, never like taffy
  const reach = Math.hypot(hx - sx, hy - sy), maxReach = A.armL * 1.2;
  if (reach > maxReach) { hx = sx + (hx - sx) * maxReach / reach; hy = sy + (hy - sy) * maxReach / reach; }
  if (!near && v.outfit === 'armor') drawPauldron(g, D, false);
  if (A.plan === 'bird') {
    // wing-arm: a feathered blade from the shoulder to the "hand" with three finger feathers
    const col = near ? P.body : P.bodyFar;
    const dx = hx - sx, dy = hy - sy, len = Math.hypot(dx, dy) || 1, a = Math.atan2(dy, dx);
    const cx = sx + dx * 0.5 - dy / len * 2, cy = sy + dy * 0.5 + dx / len * 2;
    for (let i = -1; i <= 1; i++) {
      g.beginPath(); addLeaf(g, hx - Math.cos(a) * 1.5, hy - Math.sin(a) * 1.5, a + i * 0.4, 4.5 - Math.abs(i), 1.2);
      ink(g, i === 0 ? col : dark(col, 0.85), D.ow * 0.9);
    }
    g.beginPath(); addTaperQuad(g, sx, sy, cx, cy, hx, hy, A.armR * 2.2, A.armR * 1.1, 10);
    ink(g, col, D.ow);
    if (v.animal === 'magpie' && near) {
      g.beginPath(); addTaperQuad(g, sx + dx * 0.15, sy + dy * 0.15, cx, cy, sx + dx * 0.6, sy + dy * 0.6, 2.2, 1.6, 6);
      g.fillStyle = P.belly; g.fill();
    }
    if (v.animal === 'pigeon' && near) {
      g.beginPath();
      for (let i = 0; i < 2; i++) { const u = 0.45 + i * 0.2; g.moveTo(sx + dx * u - 1.2, sy + dy * u - 0.8); g.lineTo(sx + dx * u + 1.2, sy + dy * u + 0.8); }
      strokeLine(g, INK, 1.1);
    }
    if (P.sleeve !== P.body) {
      g.beginPath(); addTaperQuad(g, sx, sy, sx + dx * 0.25 - dy / len, sy + dy * 0.25 + dx / len, sx + dx * 0.48, sy + dy * 0.48, A.armR * 2.3, A.armR * 1.8, 6);
      ink(g, near ? P.sleeve : P.sleeveFar, D.ow);
    }
  } else if (A.plan === 'robot') {
    const ex = (sx + hx) / 2 - 1, ey = (sy + hy) / 2 + 1.2;
    g.beginPath(); pathTaperedCapsule(g, sx, sy, ex, ey, A.armR, A.armR, false); pathTaperedCapsule(g, ex, ey, hx, hy, A.armR, A.armR * 0.9, true);
    ink(g, near ? P.sleeve === P.body ? P.bodySh : P.sleeve : P.sleeveFar, D.ow);
    g.beginPath(); addCirc(g, ex, ey, A.armR * 1.15); ink(g, near ? P.body : P.bodyFar, D.ow * 0.8);
    const a = Math.atan2(hy - ey, hx - ex), open = st.paws === 'attack' ? 0.7 : 0.35 + Math.sin(D.t * 3) * 0.1;
    for (const s of [-1, 1]) {
      g.beginPath();
      addTaperQuad(g, hx, hy, hx + Math.cos(a + s * open) * 2.2, hy + Math.sin(a + s * open) * 2.2, hx + Math.cos(a + s * 0.15) * 3.6, hy + Math.sin(a + s * 0.15) * 3.6, 1.6, 0.5, 5);
      ink(g, near ? P.hand : P.handFar, D.ow * 0.8);
    }
  } else {
    const dx = hx - sx, dy = hy - sy, len = Math.hypot(dx, dy) || 1;
    let cx: number, cy: number;
    if (st.paws === 'fold') { cx = sx - 1; cy = hy + 2.5; }
    else if (st.paws === 'attack') { cx = sx + dx * 0.5; cy = sy + dy * 0.5 + 1; }
    else if (dy > 1) { cx = sx + dx * 0.12 - 0.6; cy = sy + dy * 0.85; }
    else { cx = sx + dx * 0.7; cy = sy + 2.5; }
    g.beginPath(); addTaperQuad(g, sx, sy, cx, cy, hx, hy, A.armR * 2.3, A.armR * 1.8, 10);
    ink(g, near ? P.sleeve : P.sleeveFar, D.ow);
    if (v.outfit === 'tracksuit') {
      g.beginPath(); g.moveTo(sx + 0.5, sy - 0.6); g.quadraticCurveTo(cx + 0.5, cy - 0.8, hx - dx / len * 2, hy - dy / len * 2 - 0.6);
      strokeLine(g, '#ffffff', 0.8);
    }
    if (P.sleeve !== P.body) {
      g.beginPath(); addCirc(g, hx - dx / len * 1.4, hy - dy / len * 1.4, A.armR * 1.05);
      ink(g, near ? dark(P.sleeve, 0.85) : P.sleeveFar, D.ow * 0.8);
    }
    g.beginPath(); addCirc(g, hx, hy, A.handR);
    ink(g, near ? P.hand : P.handFar, D.ow);
  }
  if (near && st.seed) drawSnack(g, D, hx, hy);
}

function drawSnack(g: CanvasRenderingContext2D, D: VC, x: number, y: number): void {
  if (D.v.animal === 'robot') {
    // a battery: robots snack on volts
    g.beginPath(); g.rect(x - 1.6, y - 5.5, 3.2, 5); ink(g, '#58c060', D.ow * 0.8);
    g.beginPath(); g.rect(x - 0.8, y - 6.4, 1.6, 0.9); ink(g, '#c0c4cc', D.ow * 0.6);
    g.beginPath(); g.moveTo(x - 0.8, y - 3); g.lineTo(x + 0.8, y - 3); g.moveTo(x, y - 3.8); g.lineTo(x, y - 2.2); strokeLine(g, '#ffffff', 0.6);
    return;
  }
  const bite = D.st.chew > 0.5 ? 0.7 : 0;
  g.beginPath(); g.moveTo(x - 2.4, y - 0.6); g.lineTo(x + 3.2 - bite, y - 1.2); g.lineTo(x - 2, y - 5.2); g.closePath();
  ink(g, '#ffd23a', D.ow * 0.8);
  g.beginPath(); addCirc(g, x - 0.8, y - 2.2, 0.6); addCirc(g, x + 0.9, y - 1.6, 0.45); g.fillStyle = '#e0a020'; g.fill();
}

function drawPauldron(g: CanvasRenderingContext2D, D: VC, near: boolean): void {
  const { A, P } = D;
  if (A.plan === 'snake') return;
  const x = A.shX + (near ? -0.3 : -3.5), y = A.shY - 0.6 + (near ? 0 : 0.6), r = A.armR * 1.9 + 0.6;
  g.beginPath(); g.arc(x, y, r, Math.PI * 0.95, Math.PI * 2.05); g.closePath();
  ink(g, near ? P.out : P.outFar, D.ow);
  if (near) {
    g.beginPath(); g.arc(x, y - r * 0.15, r * 0.6, Math.PI * 1.15, Math.PI * 1.6); strokeLine(g, P.outHi, D.ow * 1.2);
    g.beginPath(); addCirc(g, x, y - r * 0.45, 0.6); g.fillStyle = P.outSh; g.fill();
  }
}

// ---------------------------------------------------------------------------------------------
// Outfits
// ---------------------------------------------------------------------------------------------

function drawCapeBack(g: CanvasRenderingContext2D, D: VC): void {
  const { A, P, st, t } = D;
  const move = st.pose === 'run' ? 1 : st.pose === 'walk' ? 0.5 : 0;
  const sw = Math.sin(t * 2.4 + D.phase * 5) * 1.1 + move * (2.5 + Math.sin(t * 9) * 1.2);
  const sx = A.tx - D.trx * 0.5, sy = Math.max(A.ny - 0.5, D.hy + A.hr * 0.55);
  const fx = A.tx + D.trx * 0.45;
  const hem = -0.8 - move * 2.5;
  const back = A.tx - D.trx * 1.8 - sw - move * 3;
  const midY = sy + (hem - sy) * 0.45;
  const lining = mix(P.accent, '#b8283a', 0.55);
  g.beginPath();
  g.moveTo(fx, sy + 1); g.lineTo(sx, sy);
  g.quadraticCurveTo(back + 1.5, midY, back, hem - move * 1.5);
  const n = 4;
  for (let i = 1; i <= n; i++) {
    const x = back + (fx - back) * (i / n), xm = back + (fx - back) * ((i - 0.5) / n);
    g.quadraticCurveTo(xm, hem + 1.3, x, hem + (i === n ? 0 : -0.4));
  }
  g.closePath();
  ink(g, P.out, D.ow);
  // the lining shows where the hem flares out behind
  g.beginPath();
  g.moveTo(sx + 0.4, sy + 0.8);
  g.quadraticCurveTo(back + 3.2, midY + 1, back + 2.6 + (fx - back) * 0.18, hem + 0.1);
  g.quadraticCurveTo(back + (fx - back) * 0.1, hem + 1.1, back + 0.3, hem - move * 1.5 - 0.2);
  g.quadraticCurveTo(back + 1.6, midY, sx, sy);
  g.closePath();
  g.fillStyle = lining; g.fill();
  g.beginPath();
  g.moveTo(sx + 2, sy + 2); g.quadraticCurveTo(back + 6, midY + 2, back + (fx - back) * 0.45, hem + 0.2);
  strokeLine(g, P.outSh, D.ow * 1.1);
}

function coatPath(g: CanvasRenderingContext2D, D: VC, k: number, dy: number): void {
  const { A } = D;
  const tx = A.tx, ty = A.ty, rx = D.trx, ry = D.try_;
  g.beginPath();
  addEll(g, tx, ty + 0.2 + dy * ry, rx * 1.06 * k, ry * 1.02 * k);
  const top = ty - ry * 0.1 + dy * ry, hem = A.plan === 'toad' ? -1.5 : -2.6;
  g.moveTo(tx - rx * 1.0 * k, top); g.lineTo(tx + rx * 1.0 * k, top); g.lineTo(tx + rx * 1.18 * k, hem + dy * 3);
  g.quadraticCurveTo(tx, hem + 1.4 + dy * 3, tx - rx * 1.24 * k, hem + dy * 3); g.closePath();
}

function drawOutfit(g: CanvasRenderingContext2D, D: VC): void {
  const { v, A, P } = D;
  const tx = A.tx, ty = A.ty, rx = D.trx, ry = D.try_;
  const vx = tx + rx * 0.62, ny = Math.max(A.ny, D.hy + A.hr * 0.72);
  const ow = D.ow;
  switch (v.outfit) {
    case 'none':
    case 'cape':
    case 'bandana':
      return;
    case 'suit': {
      const path: BlobPath = (gg, k, dy) => { gg.beginPath(); addEll(gg, tx, ty + 0.4 + dy * ry, rx * 1.05 * k, ry * 1.02 * k); };
      celBlob(g, D, path, P.out, P.outSh, P.outHi, tx - rx * 0.4, ty - ry * 0.7, rx * 0.3, ry * 0.12, () => {
        const vb = ty + ry * 0.2;
        g.beginPath(); g.moveTo(vx - 3.2, ny - 1.5); g.lineTo(vx + 4, ny - 1.5); g.lineTo(vx + 0.8, vb); g.closePath();
        g.fillStyle = '#f8f6f0'; g.fill();
        g.beginPath(); g.moveTo(vx - 0.1, ny - 0.4); g.lineTo(vx + 1.7, ny - 0.4); g.lineTo(vx + 1.5, vb - 2.4); g.lineTo(vx + 0.8, vb - 0.6); g.lineTo(vx + 0.1, vb - 2.4); g.closePath();
        g.fillStyle = mix(P.accent, '#c8303a', 0.45); g.fill();
        g.beginPath(); g.moveTo(vx - 0.1, ny - 0.4); g.lineTo(vx + 1.7, ny - 0.4); g.lineTo(vx + 1.3, ny + 1); g.lineTo(vx + 0.3, ny + 1); g.closePath();
        g.fillStyle = mix(P.accent, '#8a1a2a', 0.5); g.fill();
        g.beginPath(); g.moveTo(vx - 3.2, ny - 1.5); g.lineTo(vx - 0.2, vb - 1); g.moveTo(vx + 4, ny - 1.5); g.lineTo(vx + 2, vb - 1);
        strokeLine(g, P.outSh, ow * 1.4);
        g.beginPath(); addCirc(g, vx + 0.9, ty + ry * 0.4, 0.65); addCirc(g, vx + 0.9, ty + ry * 0.65, 0.65); g.fillStyle = P.outSh; g.fill();
        g.beginPath(); g.moveTo(tx - rx * 0.25, ty - ry * 0.32); g.lineTo(tx - rx * 0.05, ty - ry * 0.52); g.lineTo(tx + rx * 0.1, ty - ry * 0.32); g.closePath();
        g.fillStyle = mix(P.accent, '#ffffff', 0.3); g.fill();
      });
      return;
    }
    case 'tracksuit': {
      const path: BlobPath = (gg, k, dy) => { gg.beginPath(); addEll(gg, tx, ty + 0.4 + dy * ry, rx * 1.05 * k, ry * 1.02 * k); };
      celBlob(g, D, path, P.out, P.outSh, P.outHi, tx - rx * 0.4, ty - ry * 0.7, rx * 0.3, ry * 0.12, () => {
        g.beginPath(); g.moveTo(vx + 0.6, ny); g.lineTo(vx + 0.9, ty + ry * 1.1); strokeLine(g, '#e8e8f0', 0.9);
        g.beginPath(); g.moveTo(tx - rx * 1.1, ty + ry * 0.75); g.lineTo(tx + rx * 1.1, ty + ry * 0.75); strokeLine(g, P.outSh, 2.2);
        g.beginPath(); g.moveTo(tx - rx * 0.6, ty - ry * 0.95); g.lineTo(tx - rx * 0.85, ty + ry * 0.55); g.moveTo(tx - rx * 0.4, ty - ry * 0.98); g.lineTo(tx - rx * 0.65, ty + ry * 0.6);
        strokeLine(g, '#ffffff', 0.8);
      });
      g.beginPath(); addEll(g, A.nx + 0.5, ny + 0.4, 3.6, 1.4); ink(g, P.outSh, ow * 0.8);
      g.beginPath(); addCirc(g, vx + 0.8, ny + 2.2, 0.55); g.fillStyle = '#d0d0d8'; g.fill();
      return;
    }
    case 'trenchcoat': {
      const path: BlobPath = (gg, k, dy) => coatPath(gg, D, k, dy);
      celBlob(g, D, path, P.out, P.outSh, P.outHi, tx - rx * 0.4, ty - ry * 0.7, rx * 0.3, ry * 0.12, () => {
        g.beginPath(); g.moveTo(vx + 1.5, ny); g.lineTo(vx + 2.6, -2); strokeLine(g, P.outSh, ow * 1.2);
        g.beginPath(); g.rect(tx - rx * 1.3, ty + ry * 0.22, rx * 2.6, 2.2); g.fillStyle = P.outSh; g.fill();
        g.beginPath();
        for (let i = 0; i < 3; i++) { addCirc(g, vx - 0.3, ty - ry * 0.35 + i * 3.2, 0.55); addCirc(g, vx + 3.1, ty - ry * 0.32 + i * 3.2, 0.55); }
        g.fillStyle = P.outSh; g.fill();
      });
      g.beginPath(); g.rect(vx - 0.5, ty + ry * 0.22 - 0.3, 2.6, 2.8); ink(g, '#d8b048', ow * 0.7);
      g.beginPath(); g.rect(vx + 0.2, ty + ry * 0.22 + 0.4, 1.2, 1.4); g.fillStyle = P.outSh; g.fill();
      // popped collar
      g.beginPath();
      g.moveTo(A.nx - 4, ny + 1.5); g.lineTo(A.nx - 5.2, ny - 4.5); g.lineTo(A.nx - 0.5, ny + 1.5); g.closePath();
      g.moveTo(A.nx + 1.5, ny + 2.2); g.lineTo(A.nx + 5.2, ny - 3.6); g.lineTo(A.nx + 4.2, ny + 3.2); g.closePath();
      ink(g, P.out, ow);
      return;
    }
    case 'labcoat': {
      const path: BlobPath = (gg, k, dy) => coatPath(gg, D, k, dy);
      celBlob(g, D, path, P.coat, P.coatSh, '#ffffff', tx - rx * 0.4, ty - ry * 0.7, rx * 0.3, ry * 0.12, () => {
        g.beginPath(); g.moveTo(vx - 0.6, ny - 1); g.lineTo(vx + 2.6, ny - 1); g.lineTo(vx + 2.4, -1); g.lineTo(vx + 0.5, -1); g.closePath();
        g.fillStyle = P.out; g.fill();
        g.beginPath(); g.moveTo(vx - 0.6, ny - 1); g.lineTo(vx + 0.5, -1); g.moveTo(vx + 2.6, ny - 1); g.lineTo(vx + 2.4, -1);
        strokeLine(g, P.coatSh, ow * 1.2);
        g.beginPath(); g.moveTo(tx - rx * 1.2, ty + ry * 0.75); g.lineTo(tx - rx * 0.2, ty + ry * 0.75);
        strokeLine(g, P.coatSh, ow);
      });
      // breast pocket with pens
      const px = tx - rx * 0.2, py = ty - ry * 0.28;
      g.beginPath(); g.rect(px - 0.9, py - 3.2, 1, 3.4); ink(g, '#e04a4a', ow * 0.5);
      g.beginPath(); g.rect(px + 0.6, py - 2.6, 1, 2.8); ink(g, '#4a7ae0', ow * 0.5);
      g.beginPath(); g.rect(px - 1.8, py, 4.4, 3); ink(g, P.coat, ow * 0.7);
      return;
    }
    case 'apron': {
      const top = ty - ry * 0.55, hem = A.plan === 'toad' ? -1.6 : -3;
      const x0 = tx - rx * 0.15, x1 = tx + rx * 0.9;
      g.beginPath(); g.moveTo(x0 - rx * 0.3, ty + ry * 0.05); g.lineTo(tx - rx * 0.98, ty + ry * 0.12); strokeLine(g, INK, 1.6 + ow * 2);
      g.beginPath(); g.moveTo(x0 - rx * 0.3, ty + ry * 0.05); g.lineTo(tx - rx * 0.98, ty + ry * 0.12); strokeLine(g, P.out, 1.6);
      g.beginPath();
      g.moveTo(x0, top); g.lineTo(x1, top); g.quadraticCurveTo(x1 + rx * 0.25, (top + hem) / 2, x1 + rx * 0.22, hem);
      g.quadraticCurveTo((x0 + x1) / 2, hem + 1.2, x0 - rx * 0.4, hem); g.quadraticCurveTo(x0 - rx * 0.35, (top + hem) / 2, x0, top); g.closePath();
      ink(g, P.out, ow);
      g.beginPath(); g.moveTo(x0 + 0.5, top + 0.8); g.lineTo(x1 - 0.5, top + 0.8); strokeLine(g, P.outHi, 0.9);
      const py = (top + hem) / 2 + 1;
      g.beginPath(); g.rect((x0 + x1) / 2 - 2.6, py - 1.5, 5.2, 3.4); ink(g, P.outHi, ow * 0.7);
      g.beginPath(); g.moveTo(x0 + 0.4, top); g.lineTo(A.nx - 1.5, ny - 0.5); strokeLine(g, P.outSh, 1.2);
      g.beginPath(); addEll(g, tx - rx * 1.0, ty + ry * 0.1, 1.6, 1.1, 0.6); addEll(g, tx - rx * 1.0, ty + ry * 0.1, 1.6, 1.1, -0.6);
      ink(g, P.out, ow * 0.7);
      return;
    }
    case 'armor': {
      const path: BlobPath = (gg, k, dy) => { gg.beginPath(); addEll(gg, tx + 0.3, ty - 0.8 + dy * ry, rx * 1.06 * k, ry * 0.9 * k); };
      celBlob(g, D, path, P.out, P.outSh, P.outHi, tx - rx * 0.2, ty - ry * 0.55, rx * 0.45, ry * 0.18, () => {
        g.beginPath(); g.moveTo(vx + 0.8, ty - ry * 0.9); g.lineTo(vx + 0.6, ty + ry * 0.8); strokeLine(g, P.outSh, ow * 1.3);
        g.beginPath(); g.rect(tx - rx * 1.2, ty + ry * 0.48, rx * 2.4, 2.4); g.fillStyle = '#4a3a30'; g.fill();
      });
      g.beginPath(); g.rect(vx - 0.6, ty + ry * 0.48 - 0.3, 2.6, 3); ink(g, '#e0c050', ow * 0.7);
      g.fillStyle = P.outHi;
      for (let i = 0; i < 4; i++) {
        const a = Math.PI * (1.2 + i * 0.2);
        g.beginPath(); addCirc(g, tx + 0.3 + Math.cos(a) * rx * 0.88, ty - 0.8 + Math.sin(a) * ry * 0.76, 0.55); g.fill();
      }
      return;
    }
  }
}

function drawNeckwear(g: CanvasRenderingContext2D, D: VC): void {
  const { v, A, P, t } = D;
  const nx = A.nx, ny = A.ny, ow = D.ow;
  if (v.outfit === 'bandana') {
    g.beginPath(); g.moveTo(nx - 4.8, ny - 0.2); g.lineTo(nx + 4.8, ny - 0.4); g.lineTo(nx + 1.4, ny + 6.2); g.closePath();
    ink(g, P.out, ow);
    g.beginPath(); g.moveTo(nx - 4.8, ny - 0.2); g.lineTo(nx + 4.8, ny - 0.4); g.lineTo(nx + 4, ny + 1.4); g.lineTo(nx - 4.2, ny + 1.4); g.closePath();
    g.fillStyle = P.outSh; g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (const [dx, dy] of [[-1.5, 2.6], [1.6, 2.4], [0.4, 4.4], [3.2, 1.4], [-3.2, 0.9]]) { g.beginPath(); addCirc(g, nx + dx, ny + dy, 0.5); g.fill(); }
    const fl = Math.sin(t * 4) * 0.6;
    g.beginPath(); addLeaf(g, nx - 4.6, ny + 0.4, Math.PI * 0.75 + fl * 0.2, 3.8, 1.2); addLeaf(g, nx - 4.6, ny + 0.4, Math.PI * 0.95 + fl * 0.15, 3.4, 1.1);
    ink(g, P.out, ow * 0.8);
    g.beginPath(); addCirc(g, nx - 4.6, ny + 0.4, 1.1); ink(g, P.outSh, ow * 0.8);
    return;
  }
  if (v.outfit === 'cape') {
    // a tall dramatic collar fanning up behind the head
    const lining = mix(P.accent, '#b8283a', 0.55);
    const cy = Math.max(ny, D.hy + A.hr * 0.75);
    g.beginPath();
    g.moveTo(nx - 3.5, cy + 1.5); g.lineTo(nx - 9.5, cy - 9.5); g.quadraticCurveTo(nx - 5, cy - 8, nx - 2.5, cy - 7.5);
    g.lineTo(nx + 0.5, cy + 1.5); g.closePath();
    ink(g, P.out, ow);
    g.beginPath(); g.moveTo(nx - 3.2, cy + 0.2); g.lineTo(nx - 8, cy - 8); g.quadraticCurveTo(nx - 5, cy - 7, nx - 3, cy - 6.4); g.lineTo(nx - 0.6, cy + 0.2); g.closePath();
    g.fillStyle = lining; g.fill();
    g.beginPath(); g.moveTo(nx + 2.2, cy + 1.6); g.lineTo(nx + 6, cy - 3.2); g.lineTo(nx + 5, cy + 2.6); g.closePath();
    ink(g, P.out, ow);
    g.beginPath(); addCirc(g, nx + 2.6, cy + 1.6, 1.3); ink(g, '#ffd23a', ow * 0.8);
    return;
  }
}

// ---------------------------------------------------------------------------------------------
// Head: ears, skull, face
// ---------------------------------------------------------------------------------------------

function headPath(D: VC): BlobPath {
  const { v, A } = D;
  const r = A.hr;
  return (g, k, dy) => {
    const o = dy * r;
    g.beginPath();
    switch (v.animal) {
      case 'mouse': addCirc(g, 0, o, r * k); addEll(g, r * 0.85, r * 0.3 + o * 0.6, r * 0.62 * k, r * 0.42 * k, 0.12); break;
      case 'rat': addCirc(g, 0, o, r * k); addEll(g, r * 0.95, r * 0.34 + o * 0.6, r * 0.9 * k, r * 0.44 * k, 0.1); break;
      case 'cat': addCirc(g, 0, o, r * k); addEll(g, r * 0.9, r * 0.4 + o * 0.6, r * 0.42 * k, r * 0.32 * k); break;
      case 'ferret': addCirc(g, 0, o, r * k); addEll(g, r * 0.88, r * 0.32 + o * 0.6, r * 0.58 * k, r * 0.4 * k, 0.1); break;
      case 'weasel': addCirc(g, 0, o, r * k); addEll(g, r * 1.0, r * 0.32 + o * 0.6, r * 0.92 * k, r * 0.36 * k, 0.12); break;
      case 'snake': addEll(g, 0, o, r * 1.05 * k, r * 0.86 * k); addEll(g, r * 0.72, r * 0.15 + o * 0.6, r * 0.78 * k, r * 0.56 * k, 0.08); break;
      case 'lizard':
        addCirc(g, 0, o, r * k); addEll(g, r * 0.75, r * 0.25 + o * 0.6, r * 0.8 * k, r * 0.55 * k, 0.05);
        addCirc(g, A.e1x, A.e1y + o * 0.4, A.e1r * 1.4 * k); addCirc(g, A.e2x, A.e2y + o * 0.4, A.e2r * 1.4 * k);
        break;
      case 'toad':
        addEll(g, 0, o, r * 1.2 * k, r * 0.85 * k);
        addCirc(g, A.e1x, A.e1y + o * 0.4, A.e1r * 1.45 * k); addCirc(g, A.e2x, A.e2y + o * 0.4, A.e2r * 1.45 * k);
        break;
      default: addCirc(g, 0, o, r * k);
    }
  };
}

function drawEarsBack(g: CanvasRenderingContext2D, D: VC): void {
  const { v, A, P, st } = D;
  const r = A.hr, ow = D.ow;
  const droop = st.pose === 'hurt' || st.pose === 'faint' ? 0.35 : 0;
  const round = (x: number, y: number, er: number, near: boolean, inner: string) => {
    g.beginPath(); addEll(g, x, y, er, er * 1.02, near ? -0.3 - droop : 0.3 + droop);
    ink(g, near ? P.body : P.bodyFar, ow);
    g.beginPath(); addEll(g, x + 0.25, y - 0.25, er * 0.58, er * 0.62, near ? -0.3 : 0.3);
    g.fillStyle = near ? inner : dark(inner, 0.8); g.fill();
  };
  switch (v.animal) {
    case 'mouse': round(r * 0.28, -r * 1.02, r * 0.58, false, PINK); round(-r * 0.58 - droop * 2, -r * 0.84 + droop * 2, r * 0.68, true, PINK); break;
    case 'rat': round(r * 0.14, -r * 0.98, r * 0.42, false, PINK); round(-r * 0.52 - droop * 2, -r * 0.82 + droop * 2, r * 0.5, true, PINK); break;
    case 'ferret': case 'weasel': round(r * 0.28, -r * 0.92, r * 0.33, false, P.belly); round(-r * 0.52, -r * 0.8, r * 0.38, true, P.belly); break;
    case 'cat': {
      const tri = (bx0: number, bx1: number, by: number, tx: number, ty: number, near: boolean) => {
        g.beginPath(); g.moveTo(bx0, by); g.lineTo(tx, ty); g.lineTo(bx1, by + 1); g.closePath();
        ink(g, near ? P.body : P.bodyFar, ow);
        g.beginPath(); g.moveTo(bx0 + (tx - bx0) * 0.25 + 0.6, by - 0.5); g.lineTo(tx + (near ? 0.3 : -0.2), ty + 2.2); g.lineTo(bx1 - 1, by); g.closePath();
        g.fillStyle = near ? PINK : dark(PINK, 0.8); g.fill();
      };
      tri(r * 0.05, r * 0.78, -r * 0.62, r * 0.55, -r * 1.62, false);
      tri(-r * 0.88, -r * 0.12, -r * 0.62, -r * 0.62 - droop * 3, -r * 1.55 + droop * 4, true);
      break;
    }
    case 'crow': case 'magpie': {
      g.beginPath();
      for (let i = 0; i < 3; i++) addLeaf(g, -r * 0.2 + i * 0.6, -r * 0.82, -Math.PI * (0.62 + i * 0.1), r * (0.55 - i * 0.08), 1.3);
      ink(g, v.animal === 'crow' ? P.accent : P.body, ow);
      break;
    }
    default: break;
  }
}

function drawVHead(g: CanvasRenderingContext2D, D: VC): void {
  const { v, A, P } = D;
  const r = A.hr, ow = D.ow;
  g.save();
  g.translate(D.hx, D.hy);
  g.rotate(D.tilt);
  if (v.animal === 'robot') { drawRobotHead(g, D); g.restore(); drawProp(g, D); return; }
  drawEarsBack(g, D);
  if (v.animal === 'weasel') {
    g.beginPath(); pathTaperedCapsule(g, -r * 0.3, r * 0.6, -r * 0.4 + (A.nx - D.hx) * 0.3, (A.ny - D.hy) + 1, r * 0.55, r * 0.62, false);
    ink(g, P.body, ow);
  }
  celBlob(g, D, headPath(D), P.body, P.bodySh, P.bodyHi, -r * 0.3, -r * 0.6, r * 0.4, r * 0.17, () => {
    switch (v.animal) {
      case 'mouse': case 'ferret':
        g.beginPath(); addEll(g, r * 0.95, r * 0.42, r * 0.5, r * 0.3, 0.1); g.fillStyle = P.belly; g.fill();
        break;
      case 'weasel':
        g.beginPath(); addEll(g, r * 0.95, r * 0.55, r * 0.85, r * 0.22, 0.12); g.fillStyle = P.belly; g.fill();
        break;
      case 'cat':
        g.beginPath(); addEll(g, r * 0.95, r * 0.45, r * 0.42, r * 0.3); g.fillStyle = P.belly; g.fill();
        g.beginPath();
        for (let i = 0; i < 3; i++) { const x = -r * 0.25 + i * r * 0.22; g.moveTo(x, -r * 0.98); g.lineTo(x + 0.3, -r * 0.62 + Math.abs(i - 1)); }
        strokeLine(g, P.accent, 1.5);
        break;
      case 'snake': case 'lizard':
        g.beginPath(); addEll(g, r * 0.75, r * 0.58, r * 0.7, r * 0.22, 0.05); g.fillStyle = P.belly; g.fill();
        break;
      case 'toad':
        g.beginPath(); addEll(g, r * 0.35, r * 0.62, r * 0.85, r * 0.28); g.fillStyle = P.belly; g.fill();
        break;
      case 'magpie':
        g.beginPath(); addEll(g, r * 0.2, r * 0.3, r * 0.5, r * 0.3, -0.3); g.fillStyle = mix(P.accent, P.body, 0.4); g.fill();
        break;
      default: break;
    }
  });
  if (v.animal === 'ferret') drawFerretMask(g, D);
  if (v.animal === 'rat') {
    g.beginPath();
    for (let i = 0; i < 3; i++) addTaperQuad(g, -r * 0.4 + i * 1.6, -r * 0.88, -r * 0.3 + i * 1.6, -r * 1.25, r * 0.02 + i * 1.8, -r * 1.35, 2, 0.3, 5);
    ink(g, P.body, ow);
  }
  if (v.animal === 'lizard') {
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = Math.PI * (1.0 + i * 0.13), x = Math.cos(a) * r, y = Math.sin(a) * r;
      g.moveTo(x - 1.2, y + 0.5); g.lineTo(x + Math.cos(a) * 2.6, y + Math.sin(a) * 2.6); g.lineTo(x + 1.2, y - 0.2); g.closePath();
    }
    ink(g, P.accent, ow * 0.8);
  }
  // eyes (far first)
  drawVEye(g, D, A.e2x, A.e2y, A.e2r, false);
  drawVEye(g, D, A.e1x, A.e1y, A.e1r, true);
  drawSnout(g, D);
  if (v.prop === 'monocle' || v.prop === 'sunglasses' || v.prop === 'eyepatch' || v.prop === 'goggles') drawFaceProp(g, D);
  g.restore();
  drawProp(g, D);
}

function drawFerretMask(g: CanvasRenderingContext2D, D: VC): void {
  const { A, P } = D;
  const r = A.hr;
  g.save();
  headPath(D)(g, 1, 0); g.clip();
  g.beginPath();
  g.moveTo(-r * 0.25, -r * 0.42); g.quadraticCurveTo(r * 0.6, -r * 0.6, r * 1.25, -r * 0.2);
  g.lineTo(r * 1.1, r * 0.12); g.quadraticCurveTo(r * 0.6, r * 0.2, r * 0.2, r * 0.18); g.quadraticCurveTo(-r * 0.2, r * 0.1, -r * 0.25, -r * 0.42);
  g.closePath();
  g.fillStyle = P.accent; g.fill();
  g.restore();
}

function drawVEye(g: CanvasRenderingContext2D, D: VC, ex: number, ey: number, r: number, near: boolean): void {
  const { A, P, st, boss } = D;
  const lw = D.ow * 1.3;
  const rx = r * 0.86, ry = r;
  switch (st.eyes) {
    case 'closed':
      g.beginPath(); g.moveTo(ex - rx, ey + ry * 0.1); g.quadraticCurveTo(ex, ey + ry * 0.55, ex + rx, ey + ry * 0.1);
      strokeLine(g, INK, lw);
      return;
    case 'happy':
      // smug, satisfied arcs
      g.beginPath(); g.moveTo(ex - rx, ey + ry * 0.25); g.quadraticCurveTo(ex, ey - ry * 0.75, ex + rx, ey + ry * 0.25);
      strokeLine(g, INK, lw);
      return;
    case 'hurt': {
      const d = near ? 1 : -1;
      g.beginPath(); g.moveTo(ex - rx * d, ey - ry * 0.55); g.lineTo(ex + rx * 0.9 * d, ey); g.lineTo(ex - rx * d, ey + ry * 0.55);
      strokeLine(g, INK, lw);
      return;
    }
    case 'dizzy':
      drawSpiral(g, ex, ey, r, D.t, lw * 0.8);
      return;
    case 'open':
    case 'fierce':
      break;
  }
  const fierce = st.eyes === 'fierce';
  g.beginPath(); addEll(g, ex, ey, rx, ry);
  ink(g, '#fbf8ee', D.ow * 0.8);
  g.save();
  g.beginPath(); addEll(g, ex, ey, rx, ry); g.clip();
  const lk = fierce ? 0.9 : D.look;
  if (A.slit) {
    const cx = ex + lk * rx * 0.25, cy = ey + ry * 0.08;
    g.beginPath(); addCirc(g, cx, cy, rx * 0.82); g.fillStyle = P.eye; g.fill();
    g.beginPath(); addEll(g, cx, cy, rx * 0.17, ry * 0.62); g.fillStyle = INK; g.fill();
  } else {
    const cx = ex + lk * rx * 0.42, cy = ey + ry * 0.15;
    g.beginPath(); addCirc(g, cx, cy, rx * 0.56); g.fillStyle = P.eye; g.fill();
    g.beginPath(); addCirc(g, cx, cy, rx * 0.3); g.fillStyle = INK; g.fill();
  }
  g.beginPath(); addCirc(g, ex + lk * rx * 0.3 - rx * 0.2, ey - ry * 0.05, rx * 0.17); g.fillStyle = '#ffffff'; g.fill();
  // heavy upper lid: lower toward the middle of the face (scheming), lower still when angry
  const outer = fierce ? -0.75 : -0.62, inner = fierce ? 0.05 : -0.22;
  const yl = ey + ry * (near ? outer : inner), yr = ey + ry * (near ? inner : outer);
  const lidCol = D.v.animal === 'ferret' ? P.accent : P.body;
  g.beginPath(); g.moveTo(ex - rx * 1.3, yl - 0.15 * ry); g.lineTo(ex + rx * 1.3, yr - 0.15 * ry);
  g.lineTo(ex + rx * 1.3, ey - ry * 1.5); g.lineTo(ex - rx * 1.3, ey - ry * 1.5); g.closePath();
  g.fillStyle = lidCol; g.fill();
  g.restore();
  g.beginPath(); g.moveTo(ex - rx * 1.05, yl - 0.1 * ry); g.lineTo(ex + rx * 1.05, yr - 0.1 * ry);
  strokeLine(g, INK, lw);
  // villain brow
  const bw = boss ? lw * 2.1 : lw * 1.2;
  const by0 = ey - ry * (near ? 1.25 : 0.95) - (boss ? 0.4 : 0), by1 = ey - ry * (near ? 0.95 : 1.25) - (boss ? 0.4 : 0);
  g.beginPath(); g.moveTo(ex - rx * 1.15, by0 - (fierce && near ? 0.4 : 0)); g.lineTo(ex + rx * 1.15, by1 + (fierce && near ? 0.7 : 0));
  strokeLine(g, INK, bw);
}

function drawSnout(g: CanvasRenderingContext2D, D: VC): void {
  const { v, A, P, st, t } = D;
  const r = A.hr, ow = D.ow;
  switch (v.animal) {
    case 'crow': case 'magpie': case 'pigeon': drawBeak(g, D); return;
    case 'mouse': case 'rat': case 'ferret': case 'weasel': case 'cat': {
      const nose: Record<string, [number, number, number]> = {
        mouse: [r * 1.42, r * 0.2, r * 0.17], rat: [r * 1.8, r * 0.22, r * 0.17], ferret: [r * 1.4, r * 0.18, r * 0.15],
        weasel: [r * 1.86, r * 0.18, r * 0.14], cat: [r * 1.26, r * 0.22, r * 0.12],
      };
      const [nx, ny, nr] = nose[v.animal];
      if (v.animal === 'cat') {
        g.beginPath(); g.moveTo(nx - nr * 1.5, ny - nr); g.lineTo(nx + nr * 0.8, ny - nr * 1.1); g.lineTo(nx - nr * 0.2, ny + nr * 0.9); g.closePath();
        ink(g, P.nose, ow * 0.6);
      } else {
        g.beginPath(); addCirc(g, nx, ny, nr); ink(g, P.nose, ow * 0.7);
        g.beginPath(); addCirc(g, nx - nr * 0.35, ny - nr * 0.35, nr * 0.3); g.fillStyle = '#ffffff'; g.fill();
      }
      drawVMouth(g, D);
      if (v.animal === 'mouse' || v.animal === 'rat') {
        const tc = v.animal === 'rat' ? '#f4e2a0' : TEETH;
        const tx = A.mx + r * 0.05, ty = A.my - r * 0.05;
        if (st.mouth !== 'open' && st.mouth !== 'grin') {
          g.beginPath(); g.rect(tx - 1.1, ty, 1.1, 1.9); g.rect(tx, ty, 1.1, 1.9); ink(g, tc, ow * 0.6);
        }
      }
      if (v.animal !== 'ferret' && v.animal !== 'weasel') {
        // whiskers
        const sw = Math.sin(t * 2 + D.phase * 4) * 0.4;
        g.beginPath();
        for (let i = 0; i < 2; i++) {
          g.moveTo(nx - r * 0.35, ny + r * 0.12 + i * 1.3); g.quadraticCurveTo(nx + r * 0.3, ny + i * 1.5 - 0.6, nx + r * 0.75, ny - 0.8 + i * 2.4 + sw);
          g.moveTo(r * 0.1, r * 0.35 + i * 1.3); g.quadraticCurveTo(-r * 0.4, r * 0.3 + i * 1.5, -r * 0.75, r * 0.15 + i * 2.2 - sw);
        }
        strokeLine(g, INK, ow * 0.7);
      }
      return;
    }
    case 'snake': {
      g.beginPath(); addCirc(g, r * 1.32, -r * 0.08, 0.45); addCirc(g, r * 1.08, -r * 0.12, 0.4); g.fillStyle = INK; g.fill();
      const k = (t * 0.8 + D.phase) % 1.6;
      const flick = st.mouth === 'open' ? 1 : k < 0.3 ? Math.sin((k / 0.3) * Math.PI) : 0;
      if (flick > 0.02) {
        const tx = r * 1.45, ty = r * 0.36, L = 2 + flick * 5;
        g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + L, ty + 0.2); g.lineTo(tx + L + 1.6, ty - 1.1); g.moveTo(tx + L, ty + 0.2); g.lineTo(tx + L + 1.6, ty + 1.4);
        strokeLine(g, INK, 1 + ow * 2); 
        g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + L, ty + 0.2); g.lineTo(tx + L + 1.6, ty - 1.1); g.moveTo(tx + L, ty + 0.2); g.lineTo(tx + L + 1.6, ty + 1.4);
        strokeLine(g, '#e8384a', 1);
      }
      drawVMouth(g, D);
      return;
    }
    case 'lizard': case 'toad': {
      const nxp = v.animal === 'lizard' ? r * 1.4 : r * 1.1, nyp = v.animal === 'lizard' ? r * 0.02 : -r * 0.1;
      g.beginPath(); addCirc(g, nxp, nyp, 0.45); addCirc(g, nxp - 1.4, nyp - 0.2, 0.4); g.fillStyle = INK; g.fill();
      if (v.animal === 'toad') {
        const sac = 0.5 + 0.5 * Math.sin(t * 3 + D.phase * 5);
        g.beginPath(); addEll(g, r * 0.55, r * 0.78 + sac * 0.6, r * 0.42 + sac * 0.8, r * 0.22 + sac * 0.6);
        ink(g, light(P.belly, 0.15), ow * 0.7);
      }
      drawVMouth(g, D);
      return;
    }
    case 'robot':
      return;
  }
}

function drawBeak(g: CanvasRenderingContext2D, D: VC): void {
  const { v, A, P, st } = D;
  const r = A.hr, ow = D.ow;
  const open = st.mouth === 'open' || st.mouth === 'grin' ? 1 : st.mouth === 'o' ? 0.45 : st.mouth === 'chew' ? st.chew * 0.6 : st.mouth === 'wavy' ? 0.25 : 0;
  let u0x: number, u0y: number, tipx: number, tipy: number, bx: number, by: number, lowTipx: number, lowTipy: number, bot: number;
  if (v.animal === 'pigeon') { u0x = r * 0.72; u0y = -r * 0.18; tipx = r * 1.55; tipy = r * 0.2; bx = r * 0.78; by = r * 0.22; lowTipx = r * 1.4; lowTipy = r * 0.3; bot = r * 0.4; }
  else if (v.animal === 'magpie') { u0x = r * 0.62; u0y = -r * 0.3; tipx = r * 1.85; tipy = r * 0.14; bx = r * 0.7; by = r * 0.16; lowTipx = r * 1.65; lowTipy = r * 0.24; bot = r * 0.42; }
  else { u0x = r * 0.55; u0y = -r * 0.42; tipx = r * 2.05; tipy = r * 0.2; bx = r * 0.7; by = r * 0.22; lowTipx = r * 1.75; lowTipy = r * 0.32; bot = r * 0.52; }
  const drop = open * r * 0.55;
  // inside of the mouth when open
  if (open > 0.05) {
    g.beginPath(); g.moveTo(bx, by); g.lineTo(lowTipx * 0.95, tipy + drop * 0.5); g.lineTo(bx, by + drop * 0.8); g.closePath();
    g.fillStyle = '#6a2236'; g.fill();
  }
  g.beginPath(); g.moveTo(bx, by); g.lineTo(lowTipx, lowTipy + drop); g.quadraticCurveTo(r * 1.0, bot + drop * 0.8, r * 0.6, bot); g.closePath();
  ink(g, P.beakSh, ow);
  g.beginPath(); g.moveTo(u0x, u0y); g.quadraticCurveTo(r * 1.35, u0y - r * 0.02, tipx, tipy); g.lineTo(bx, by); g.closePath();
  ink(g, P.beak, ow);
  g.beginPath(); g.moveTo(u0x + r * 0.15, u0y + r * 0.12); g.quadraticCurveTo(r * 1.2, u0y + r * 0.1, tipx - r * 0.35, tipy - r * 0.08);
  strokeLine(g, light(P.beak, 0.35), ow * 1.1);
  if (v.animal === 'pigeon') { g.beginPath(); addEll(g, r * 0.92, -r * 0.14, r * 0.2, r * 0.13); ink(g, '#f0ecf0', ow * 0.6); }
  if (D.boss && open < 0.05) {
    g.beginPath(); g.moveTo(r * 1.15, by + 0.2); g.lineTo(r * 1.35, by + 1.6); g.lineTo(r * 1.5, by + 0.2); g.closePath(); ink(g, '#ffd23a', ow * 0.5);
  }
}

function drawVMouth(g: CanvasRenderingContext2D, D: VC): void {
  const { A, st, boss, v } = D;
  const mx = A.mx, my = A.my, ow = D.ow, lw = ow * 1.15;
  const wide = v.animal === 'toad' || v.animal === 'lizard' || v.animal === 'snake';
  switch (st.mouth) {
    case 'smile': {
      if (wide) {
        const w = v.animal === 'toad' ? A.hr * 0.95 : A.hr * 0.8;
        g.beginPath(); g.moveTo(mx - w, my - 0.8); g.quadraticCurveTo(mx, my + 1.6, mx + w * 0.75, my - 1.6);
        strokeLine(g, INK, lw);
        g.beginPath(); g.moveTo(mx + w * 0.75, my - 1.6); g.lineTo(mx + w * 0.85, my - 2.4); strokeLine(g, INK, lw);
      } else {
        // a smirk: one corner hooked up
        g.beginPath(); g.moveTo(mx - 2.4, my - 0.4); g.quadraticCurveTo(mx - 0.2, my + 1.4, mx + 2.2, my - 1.2);
        g.lineTo(mx + 2.6, my - 1.9);
        strokeLine(g, INK, lw);
      }
      if (boss) {
        g.beginPath(); g.rect(mx - 0.2, my + 0.3, 1.2, 1.4); ink(g, '#ffd23a', ow * 0.6);
      }
      return;
    }
    case 'open':
    case 'grin': {
      const w = wide ? A.hr * 0.75 : 2.8, h = st.mouth === 'open' ? 4 : 2.8;
      g.beginPath(); g.moveTo(mx - w, my - 0.6); g.quadraticCurveTo(mx, my + 0.2, mx + w, my - 1.2);
      g.quadraticCurveTo(mx + w * 0.7, my + h, mx, my + h); g.quadraticCurveTo(mx - w * 0.8, my + h * 0.9, mx - w, my - 0.6); g.closePath();
      ink(g, '#5a1a2c', ow * 0.8);
      g.save(); g.clip();
      g.fillStyle = TEETH;
      g.beginPath(); g.rect(mx - w, my - 1.6, w * 2, 1.7); g.fill();
      if (st.mouth === 'grin') { g.beginPath(); g.rect(mx - w, my + h - 1.2, w * 2, 1.4); g.fill(); }
      if (boss) { g.fillStyle = '#ffd23a'; g.beginPath(); g.rect(mx + 0.3, my - 1.6, 1.1, 1.7); g.fill(); }
      g.beginPath(); addEll(g, mx, my + h * 0.75, w * 0.5, h * 0.25); g.fillStyle = '#ff7d8e'; g.fill();
      g.restore();
      return;
    }
    case 'chew': {
      const c = st.chew;
      g.beginPath(); g.moveTo(mx - 2, my + c * 0.6); g.quadraticCurveTo(mx, my + 1.4 + c, mx + 2, my + c * 0.6);
      strokeLine(g, INK, lw);
      return;
    }
    case 'wavy': {
      g.beginPath(); g.moveTo(mx - 2.4, my + 0.4);
      for (let i = 1; i <= 4; i++) g.lineTo(mx - 2.4 + i * 1.2, my + 0.4 + (i % 2 ? -0.8 : 0.4));
      strokeLine(g, INK, lw);
      return;
    }
    case 'o': {
      g.beginPath(); addEll(g, mx, my + 0.6, 1.2, 1.4); ink(g, '#5a1a2c', ow * 0.7);
      return;
    }
  }
}

function drawRobotHead(g: CanvasRenderingContext2D, D: VC): void {
  const { A, P, st, t } = D;
  const r = A.hr, ow = D.ow;
  // metal ferret ears
  for (const [x, near] of [[r * 0.65, false], [-r * 0.7, true]] as [number, boolean][]) {
    g.beginPath(); addCirc(g, x, -r * 0.88, r * 0.32); ink(g, near ? P.body : P.bodyFar, ow);
    g.beginPath(); addCirc(g, x, -r * 0.88, r * 0.15); g.fillStyle = P.accentSh; g.fill();
  }
  const x0 = -r * 1.05, y0 = -r * 0.85, w = r * 2.15, h = r * 1.65;
  pathRoundedPoly(g, [x0, y0, x0 + w, y0, x0 + w, y0 + h, x0, y0 + h], 2.6);
  ink(g, P.bodySh, ow);
  g.save(); g.clip();
  pathRoundedPoly(g, [x0, y0 - 1, x0 + w, y0 - 1, x0 + w, y0 + h - 1.6, x0, y0 + h - 1.6], 2.6);
  g.fillStyle = P.body; g.fill();
  g.fillStyle = P.bodyHi; g.fillRect(x0 + 1.4, y0 + 0.8, w * 0.5, 1);
  g.restore();
  // screen face
  const sx = -r * 0.5, sy = -r * 0.52, sw = r * 1.42, sh = r * 1.05;
  pathRoundedPoly(g, [sx, sy, sx + sw, sy, sx + sw, sy + sh, sx, sy + sh], 1.6);
  ink(g, '#1c2630', ow * 0.7);
  g.save();
  g.globalAlpha *= 0.12; g.fillStyle = P.eye; g.fillRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
  g.restore();
  // bolt on the near side
  g.beginPath(); addCirc(g, -r * 0.8, r * 0.1, r * 0.17); ink(g, P.bodySh, ow * 0.6);
  // pixel face, in the eye colour
  const glow = P.eye, px = 1.05;
  const eye = (cx: number, cy: number, near: boolean) => {
    g.fillStyle = glow;
    switch (st.eyes) {
      case 'closed': g.fillRect(cx - px * 1.5, cy, px * 3, px); return;
      case 'happy': g.fillRect(cx - px * 1.5, cy, px, px); g.fillRect(cx - px * 0.5, cy - px, px, px); g.fillRect(cx + px * 0.5, cy, px, px); return;
      case 'hurt': {
        const d = near ? 1 : -1;
        g.fillRect(cx - px * 1.5 * d - (d < 0 ? px : 0), cy - px, px, px); g.fillRect(cx - px * 0.5, cy, px, px); g.fillRect(cx - px * 1.5 * d - (d < 0 ? px : 0), cy + px, px, px);
        return;
      }
      case 'dizzy': g.fillRect(cx - px * 1.5, cy - px * 1.5, px * 3, px); g.fillRect(cx + px * 0.5, cy - px * 0.5, px, px * 2); g.fillRect(cx - px * 1.5, cy + px * 0.5, px * 2, px); return;
      case 'open': case 'fierce': {
        const lk = st.eyes === 'fierce' ? 0.6 : D.look * 0.6;
        g.fillRect(cx - px + lk, cy - px * 1.5, px * 2, px * 3);
        if (st.eyes === 'fierce' || D.boss) {
          const d = near ? 1 : -1;
          g.fillRect(cx - px * 1.8, cy - px * (near ? 3 : 2.2), px * 3.6, px * 0.8);
          g.fillStyle = '#1c2630';
          g.fillRect(cx - px * 1.2 * d - px * 0.5, cy - px * 1.6, px, px);
        }
        return;
      }
    }
  };
  const ey = sy + sh * 0.4;
  eye(sx + sw * 0.3, ey, true);
  eye(sx + sw * 0.72, ey, false);
  // pixel mouth
  g.fillStyle = glow;
  const mx = sx + sw * 0.52, my = sy + sh * 0.78;
  switch (st.mouth) {
    case 'open': case 'grin': g.fillRect(mx - px * 2, my - px, px * 4, px * 1.8); break;
    case 'o': g.fillRect(mx - px * 0.5, my - px * 0.5, px, px); break;
    case 'wavy': for (let i = 0; i < 4; i++) g.fillRect(mx - px * 2 + i * px, my - (i % 2) * px, px, px); break;
    case 'chew': g.fillRect(mx - px * 1.5, my - st.chew * px, px * 3, px); break;
    case 'smile': g.fillRect(mx - px * 2, my - px, px, px); g.fillRect(mx - px, my, px * 2.5, px); g.fillRect(mx + px * 1.5, my - px, px, px); break;
  }
  // scan line
  g.save(); g.globalAlpha *= 0.25; g.fillStyle = '#ffffff';
  g.fillRect(sx + 0.6, sy + ((t * 6) % sh), sw - 1.2, 0.5);
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

function drawFaceProp(g: CanvasRenderingContext2D, D: VC): void {
  const { v, A, t } = D;
  const ow = D.ow, r = A.hr;
  const e1x = A.e1x, e1y = A.e1y, e1r = A.e1r, e2x = A.e2x, e2y = A.e2y, e2r = A.e2r;
  switch (v.prop) {
    case 'monocle': {
      const mr = e1r * 1.35;
      g.beginPath(); addCirc(g, e1x, e1y, mr); g.fillStyle = 'rgba(200,235,255,0.22)'; g.fill();
      g.beginPath(); addCirc(g, e1x, e1y, mr); strokeLine(g, INK, ow * 2 + 1.2);
      g.beginPath(); addCirc(g, e1x, e1y, mr); strokeLine(g, '#f2c64a', 1.2);
      const gl = (Math.sin(t * 1.3 + D.phase * 7) + 1) / 2;
      g.beginPath(); g.moveTo(e1x - mr * 0.5, e1y - mr * 0.3); g.lineTo(e1x - mr * 0.1 + gl * 0.6, e1y - mr * 0.7); strokeLine(g, '#ffffff', 0.8);
      g.beginPath(); g.moveTo(e1x - mr * 0.55, e1y + mr * 0.8);
      g.quadraticCurveTo(e1x - mr * 1.4, e1y + mr * 3.2 + Math.sin(t * 2) * 0.5, e1x - mr * 0.6, e1y + mr * 4.4);
      g.setLineDash([0.8, 0.9]); strokeLine(g, '#d8a838', 1); g.setLineDash([]);
      return;
    }
    case 'sunglasses': {
      g.beginPath(); g.moveTo(-r * 0.95, -r * 0.35); g.lineTo(e1x - e1r, e1y - e1r * 0.4); strokeLine(g, INK, 1.2 + ow * 2);
      g.beginPath();
      pathRoundedPoly(g, [e2x - e2r * 1.0, e2y - e2r * 0.8, e2x + e2r * 1.25, e2y - e2r * 0.9, e2x + e2r * 1.1, e2y + e2r * 0.8, e2x - e2r * 0.9, e2y + e2r * 0.85], 1.2);
      ink(g, '#262a3e', ow * 0.8);
      g.beginPath();
      pathRoundedPoly(g, [e1x - e1r * 1.3, e1y - e1r * 0.85, e1x + e1r * 1.3, e1y - e1r * 0.85, e1x + e1r * 1.2, e1y + e1r * 0.9, e1x - e1r * 1.15, e1y + e1r * 0.95], 1.4);
      ink(g, '#262a3e', ow * 0.8);
      g.beginPath(); g.moveTo(e1x + e1r * 1.3, e1y - e1r * 0.5); g.lineTo(e2x - e2r * 1.0, e2y - e2r * 0.45); strokeLine(g, '#1e1a26', 1.2);
      g.beginPath(); g.moveTo(e1x - e1r * 0.8, e1y - e1r * 0.4); g.lineTo(e1x + e1r * 0.2, e1y - e1r * 0.4); strokeLine(g, '#ffffff', 0.9);
      g.beginPath(); g.moveTo(e1x - e1r * 0.5, e1y + e1r * 0.15); g.lineTo(e1x + e1r * 0.5, e1y - e1r * 0.15); strokeLine(g, 'rgba(160,200,255,0.55)', 0.8);
      g.beginPath(); g.moveTo(e2x - e2r * 0.4, e2y - e2r * 0.45); g.lineTo(e2x + e2r * 0.1, e2y - e2r * 0.45); strokeLine(g, 'rgba(255,255,255,0.6)', 0.7);
      return;
    }
    case 'eyepatch': {
      g.beginPath(); g.moveTo(-r * 0.98, -r * 0.62); g.lineTo(r * 0.6, -r * 0.95); strokeLine(g, INK, 1.1 + ow * 2);
      g.beginPath(); g.moveTo(-r * 0.98, -r * 0.62); g.lineTo(r * 0.6, -r * 0.95); strokeLine(g, '#2a2430', 1.1);
      g.beginPath(); addEll(g, e1x, e1y + 0.2, e1r * 1.25, e1r * 1.15, 0.1); ink(g, '#2a2430', ow);
      g.beginPath(); addEll(g, e1x - e1r * 0.35, e1y - e1r * 0.35, e1r * 0.35, e1r * 0.18, -0.4); g.fillStyle = '#4a4458'; g.fill();
      return;
    }
    case 'goggles': {
      const y = (e1y + e2y) / 2;
      g.beginPath(); g.moveTo(-r * 0.98, y + 0.5); g.lineTo(e1x - e1r * 1.4, e1y); strokeLine(g, INK, 2.2 + ow * 2);
      g.beginPath(); g.moveTo(-r * 0.98, y + 0.5); g.lineTo(e1x - e1r * 1.4, e1y); strokeLine(g, '#5a4a3a', 2.2);
      const lens = (cx: number, cy: number, lr: number) => {
        g.beginPath(); addCirc(g, cx, cy, lr); ink(g, '#c89a3a', ow);
        g.save(); g.globalAlpha *= 0.55;
        g.beginPath(); addCirc(g, cx, cy, lr * 0.74); g.fillStyle = '#7ae0a8'; g.fill();
        g.restore();
        g.beginPath(); addEll(g, cx - lr * 0.25, cy - lr * 0.3, lr * 0.3, lr * 0.16, -0.6); g.fillStyle = '#ffffff'; g.fill();
      };
      lens(e2x, e2y, e2r * 1.45);
      lens(e1x, e1y, e1r * 1.45);
      return;
    }
    default: return;
  }
}

function drawProp(g: CanvasRenderingContext2D, D: VC): void {
  const { v, A, P, t } = D;
  const r = A.hr, K = A.hatK, ow = D.ow, Y = A.hatY;
  g.save();
  g.translate(D.hx, D.hy); g.rotate(D.tilt);
  switch (v.prop) {
    case 'cheeseHat': {
      g.translate(0, Y + 1); g.rotate(-0.08);
      g.beginPath(); g.moveTo(-6.5 * K, 0.5); g.lineTo(-6.5 * K, -6 * K); g.lineTo(7.5 * K, 0.3); g.closePath();
      ink(g, '#ffd23a', ow);
      g.beginPath(); g.moveTo(-6.5 * K, -6 * K); g.lineTo(-4.6 * K, -7.4 * K); g.lineTo(8.6 * K, -0.6 * K); g.lineTo(7.5 * K, 0.3); g.closePath();
      ink(g, '#ffe680', ow);
      g.beginPath(); addCirc(g, -3.5 * K, -2 * K, 1.3 * K); addCirc(g, 0.5 * K, -1.2 * K, 0.9 * K); addCirc(g, -4.6 * K, -4.4 * K, 0.7 * K); addEll(g, 3 * K, -5 * K, 1.1 * K, 0.4 * K, 0.4);
      g.fillStyle = '#e0a020'; g.fill();
      break;
    }
    case 'fedora': {
      g.translate(0, Y + 0.5); g.rotate(-0.1);
      g.beginPath(); addEll(g, 0.5 * K, 0, 11 * K, 2.2 * K); ink(g, P.hat, ow);
      g.beginPath(); g.moveTo(-5.5 * K, 0); g.lineTo(-5 * K, -5.2 * K); g.quadraticCurveTo(-1 * K, -7.6 * K, 0.5 * K, -5.6 * K);
      g.quadraticCurveTo(2.5 * K, -7.4 * K, 5.5 * K, -5.4 * K); g.lineTo(6 * K, 0); g.closePath();
      ink(g, P.hat, ow);
      g.beginPath(); g.rect(-5.4 * K, -2.2 * K, 11.3 * K, 1.8 * K); g.fillStyle = mix(P.hatSh, INK, 0.4); g.fill();
      g.beginPath(); g.moveTo(-4.4 * K, -4.6 * K); g.quadraticCurveTo(-1.5 * K, -6.4 * K, -0.2 * K, -5 * K); strokeLine(g, P.hatHi, ow);
      break;
    }
    case 'tophat': {
      g.translate(0, Y + 0.5); g.rotate(-0.12);
      g.beginPath(); addEll(g, 0.3 * K, 0, 9.5 * K, 2 * K); ink(g, '#2a2632', ow);
      g.beginPath(); g.moveTo(-5.4 * K, 0); g.lineTo(-6 * K, -12.5 * K); g.lineTo(6.4 * K, -12.5 * K); g.lineTo(5.8 * K, 0); g.closePath();
      ink(g, '#2a2632', ow);
      g.beginPath(); g.rect(-5.5 * K, -3.4 * K, 11.3 * K, 2.6 * K); g.fillStyle = v.outfit === 'none' ? '#c8303a' : P.out; g.fill();
      g.beginPath(); addEll(g, 0.2 * K, -12.5 * K, 6.2 * K, 1.4 * K); ink(g, '#3a3644', ow * 0.7);
      g.beginPath(); g.moveTo(-4.5 * K, -11 * K); g.lineTo(-4.2 * K, -4.5 * K); strokeLine(g, '#4a4656', 1.2);
      break;
    }
    case 'crown': {
      g.translate(0, Y + 0.8); g.rotate(-0.1);
      const w = 6 * K, h = 6 * K;
      g.beginPath();
      g.moveTo(-w, 1); g.lineTo(-w * 1.05, -h * 0.75); g.lineTo(-w * 0.5, -h * 0.25); g.lineTo(0, -h); g.lineTo(w * 0.5, -h * 0.25);
      g.lineTo(w * 1.05, -h * 0.75); g.lineTo(w, 1); g.closePath();
      ink(g, '#ffcf3a', ow);
      g.beginPath(); g.rect(-w, -1.2 * K, w * 2, 2 * K); g.fillStyle = '#e09a20'; g.fill();
      g.beginPath(); addCirc(g, 0, -0.2 * K, 1.2 * K); g.fillStyle = '#e8384a'; g.fill();
      g.beginPath(); addCirc(g, -w * 0.6, -0.2 * K, 0.8 * K); addCirc(g, w * 0.6, -0.2 * K, 0.8 * K); g.fillStyle = '#4ab0f0'; g.fill();
      g.beginPath(); addCirc(g, 0, -h, 1 * K); addCirc(g, -w * 1.05, -h * 0.75, 0.8 * K); addCirc(g, w * 1.05, -h * 0.75, 0.8 * K); g.fillStyle = '#fff2b0'; g.fill();
      const s = Math.max(0, Math.sin(t * 2.5 + D.phase * 4));
      drawTwinkle(g, w * 0.9, -h * 0.9, s * 2.2, '#ffffff', ow);
      break;
    }
    case 'chefHat': {
      g.translate(0, Y + 1); g.rotate(-0.15);
      const w = 6 * K;
      g.beginPath();
      addCirc(g, -w * 0.6, -6 * K, 3.4 * K); addCirc(g, w * 0.6, -6 * K, 3.4 * K); addCirc(g, 0, -8 * K, 3.8 * K);
      g.rect(-w * 0.85, -6 * K, w * 1.7, 6 * K);
      ink(g, '#fbfaf6', ow);
      g.beginPath(); g.rect(-w * 0.85, -2.6 * K, w * 1.7, 2.8 * K); ink(g, '#ece8f0', ow * 0.6);
      g.beginPath(); g.moveTo(-w * 0.25, -6 * K); g.lineTo(-w * 0.2, -3.4 * K); g.moveTo(w * 0.25, -6 * K); g.lineTo(w * 0.2, -3.4 * K);
      strokeLine(g, '#d4d0dc', ow);
      break;
    }
    case 'beret': {
      g.translate(-0.5 * K, Y + 0.2); g.rotate(-0.22);
      g.beginPath(); addEll(g, 0, -1.6 * K, 8.2 * K, 3.2 * K); ink(g, P.hat, ow);
      g.beginPath(); addEll(g, -1 * K, -2.6 * K, 5 * K, 1.2 * K); g.fillStyle = P.hatHi; g.fill();
      g.beginPath(); g.moveTo(0, -4.6 * K); g.lineTo(0.6 * K, -6.4 * K); strokeLine(g, INK, 1.2 + ow * 2);
      g.beginPath(); g.moveTo(0, -4.6 * K); g.lineTo(0.6 * K, -6.4 * K); strokeLine(g, P.hat, 1.2);
      break;
    }
    case 'helmet': {
      const metal = mix(P.hat, '#a8b0bc', 0.6);
      g.beginPath(); g.arc(0, Y * 0.2, r * 1.12, Math.PI * 1.02, Math.PI * 1.98); g.closePath();
      ink(g, metal, ow);
      g.beginPath(); g.arc(0, Y * 0.2, r * 1.12, Math.PI * 1.15, Math.PI * 1.4); strokeLine(g, light(metal, 0.5), ow * 1.4);
      g.beginPath(); g.rect(-r * 1.25, Y * 0.2 - 1.2, r * 2.5, 2.4); ink(g, dark(metal, 0.8), ow);
      g.beginPath(); g.moveTo(-r * 0.2, Y * 0.2 - r * 1.1); g.lineTo(-r * 0.15, Y * 0.2 - 1); strokeLine(g, dark(metal, 0.7), ow * 1.2);
      const on = (Math.sin(t * 3) + 1) / 2;
      if (D.fx) {
        g.save(); g.globalAlpha *= 0.25 + on * 0.2;
        g.beginPath(); addCirc(g, r * 0.8, Y * 0.2 - r * 0.62, 3.2 * K); g.fillStyle = '#fff3a0'; g.fill();
        g.restore();
      }
      g.beginPath(); addCirc(g, r * 0.8, Y * 0.2 - r * 0.62, 1.8 * K); ink(g, '#ffe680', ow);
      g.beginPath(); addCirc(g, r * 0.8 - 0.5 * K, Y * 0.2 - r * 0.62 - 0.5 * K, 0.6 * K); g.fillStyle = '#ffffff'; g.fill();
      break;
    }
    case 'headphones': {
      g.beginPath(); g.arc(-r * 0.05, -r * 0.05, r * 1.08, Math.PI * 1.05, Math.PI * 1.85); strokeLine(g, INK, 2 + ow * 2);
      g.beginPath(); g.arc(-r * 0.05, -r * 0.05, r * 1.08, Math.PI * 1.05, Math.PI * 1.85); strokeLine(g, P.hat, 2);
      g.beginPath(); addEll(g, -r * 0.62, -r * 0.1, r * 0.42, r * 0.5, 0.2); ink(g, P.hat, ow);
      g.beginPath(); addEll(g, -r * 0.62, -r * 0.1, r * 0.22, r * 0.3, 0.2); g.fillStyle = mix(P.accent, '#ffffff', 0.2); g.fill();
      // spy microphone boom
      g.beginPath(); g.moveTo(-r * 0.5, r * 0.25); g.quadraticCurveTo(-r * 0.1, r * 0.95, r * 0.55, r * 0.85); strokeLine(g, INK, 0.8 + ow * 2);
      g.beginPath(); g.moveTo(-r * 0.5, r * 0.25); g.quadraticCurveTo(-r * 0.1, r * 0.95, r * 0.55, r * 0.85); strokeLine(g, '#5a5a66', 0.8);
      g.beginPath(); addCirc(g, r * 0.6, r * 0.85, 0.9 * K); ink(g, '#2a2632', ow * 0.6);
      break;
    }
    case 'antenna': {
      g.beginPath(); g.arc(0, 0, r * 1.02, Math.PI * 1.1, Math.PI * 1.9); strokeLine(g, INK, 1.4 + ow * 2);
      g.beginPath(); g.arc(0, 0, r * 1.02, Math.PI * 1.1, Math.PI * 1.9); strokeLine(g, '#6a6a78', 1.4);
      const bob = Math.sin(t * 5) * 0.8, bx = -r * 0.1, by = -r * 1.02;
      g.beginPath(); g.moveTo(bx, by);
      for (let i = 1; i <= 6; i++) g.lineTo(bx + (i % 2 ? 1 : -1) * 0.9 * K + bob * i / 6, by - i * 1.3 * K);
      strokeLine(g, INK, 0.7 + ow * 2);
      g.beginPath(); g.moveTo(bx, by);
      for (let i = 1; i <= 6; i++) g.lineTo(bx + (i % 2 ? 1 : -1) * 0.9 * K + bob * i / 6, by - i * 1.3 * K);
      strokeLine(g, '#b0b4c0', 0.7);
      const on = Math.sin(t * 6) > 0;
      g.beginPath(); addCirc(g, bx + bob, by - 8.4 * K, 1.6 * K); ink(g, on ? '#ff4a4a' : '#a02a3a', ow);
      if (on) { g.beginPath(); addCirc(g, bx + bob - 0.5, by - 8.9 * K, 0.5 * K); g.fillStyle = '#ffffff'; g.fill(); }
      break;
    }
    default: break;
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Samples: every animal, every outfit, every prop, five boss-sized
// ---------------------------------------------------------------------------------------------

function vv(animal: Animal, body: string, belly: string, accent: string, eye: string, outfit: VillainVisual['outfit'], outfitColor: string, prop: VillainVisual['prop'], size: number): VillainVisual {
  return { animal, body, belly, accent, eye, outfit, outfitColor, prop, size };
}

/** Sample villain visuals for galleries and tests. */
export const SAMPLE_VILLAINS: VillainVisual[] = [
  vv('mouse', '#a89c94', '#ebe0d8', '#f0c040', '#2a1a1a', 'bandana', '#d0383a', 'none', 0.85),
  vv('mouse', '#9a8a80', '#e4d6cc', '#f0c040', '#1e1414', 'suit', '#3a3048', 'cheeseHat', 1.5),
  vv('rat', '#6e625e', '#b8aca4', '#e0b040', '#401010', 'trenchcoat', '#8a6a40', 'fedora', 1.15),
  vv('crow', '#2a2a3a', '#46465c', '#5a8ad8', '#f0d040', 'suit', '#45405e', 'sunglasses', 1.0),
  vv('magpie', '#22243a', '#f4f4f8', '#3a7ad8', '#1a1a24', 'cape', '#5a2a6a', 'beret', 1.0),
  vv('pigeon', '#8a92a8', '#b0b8cc', '#4ac0a0', '#c83a2a', 'tracksuit', '#3a5ad0', 'headphones', 0.9),
  vv('crow', '#1e1e2c', '#3a3a4e', '#e8c040', '#ff5a3a', 'cape', '#2a1a3a', 'tophat', 1.45),
  vv('snake', '#5ab05a', '#e8e0a0', '#2e7a3a', '#f0c030', 'none', '#2a2a3a', 'monocle', 1.0),
  vv('snake', '#7a4ab0', '#e8d0a0', '#f0c040', '#ff4a4a', 'cape', '#2a1a4a', 'crown', 1.55),
  vv('lizard', '#7ac8a0', '#f0f0c0', '#f08a3a', '#3a1a10', 'labcoat', '#5a7ad0', 'goggles', 1.0),
  vv('toad', '#8a9a3a', '#e8e0a0', '#c89a30', '#d06a10', 'apron', '#6a4a8a', 'chefHat', 1.1),
  vv('cat', '#e89a4a', '#fff0d8', '#b8602a', '#60c040', 'tracksuit', '#3a3a44', 'eyepatch', 1.0),
  vv('cat', '#f2f0f4', '#ffffff', '#c8c0d8', '#3ab0e0', 'cape', '#b02a3a', 'crown', 1.5),
  vv('ferret', '#d8c0a0', '#fff4e0', '#6a4a34', '#2a1a10', 'labcoat', '#4a8a5a', 'goggles', 1.0),
  vv('robot', '#9aa4b0', '#5a6470', '#ff5a3a', '#7affd0', 'armor', '#6a7a8a', 'antenna', 1.1),
  vv('weasel', '#9a6a3a', '#f8ecd0', '#2a1a10', '#2a1010', 'suit', '#2a3a5a', 'helmet', 1.0),
  vv('ferret', '#ece4d4', '#ffffff', '#4a3a2a', '#c02a2a', 'armor', '#4a5a6a', 'helmet', 1.5),
];
