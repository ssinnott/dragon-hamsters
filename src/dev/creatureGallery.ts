// Creature gallery (dev/creatures.html): every sample dragon and villain at battle and burrow scale,
// a row of every pose for one of each, a mock battle exchange, and the flash / silhouette / fade modes.
// URL options: ?t=1.25 freezes the clock (screenshots), ?zoom=3 sets the CSS pixel scale,
// ?focus=dragon:3 or ?focus=villain:1 shows one sample close up in every pose at scale 3;
// add &pose=faint for a filmstrip of that pose at poseT 0, 0.125 .. 1.

import { drawDragon, dragonHeight, SAMPLE_DRAGONS, POSES } from '../art/dragon.ts';
import type { Pose } from '../art/dragon.ts';
import { drawVillain, villainHeight, SAMPLE_VILLAINS } from '../art/villain.ts';
import { drawText } from '../lib/engine/text.ts';
import type { DragonVisual, VillainVisual } from '../data/schema.ts';

const W = 640;

const params = new URLSearchParams(location.search);
const frozen = params.has('t') ? Number(params.get('t')) : null;

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

interface Section { title: string; h: number; bg: string; draw: (y: number, t: number) => void }

function label(text: string, x: number, y: number, color = '#5a4a6a', align: 'left' | 'center' = 'center'): void {
  drawText(ctx, text, x, y, { color, align, shadow: false });
}

function dragonLabel(v: DragonVisual): [string, string] {
  return [`${v.wings}/${v.horns}`, `${v.tail} ${v.pattern === 'none' ? '' : v.pattern}`.trim()];
}

/** poseT for one-shot poses: play over 1.2 s, hold 0.5 s, repeat. */
function oneShot(t: number, offset = 0): number {
  const u = (t + offset) % 1.7;
  return Math.min(1, u / 1.2);
}

function villainLabel(v: VillainVisual): [string, string, string] {
  return [`${v.animal}${v.size >= 1.3 ? ' BOSS' : ''}`, v.outfit === 'none' ? '-' : v.outfit, v.prop === 'none' ? '-' : v.prop];
}

const POSE_DRAGON = SAMPLE_DRAGONS[0];
const POSE_VILLAIN = SAMPLE_VILLAINS[2];

const focus = params.get('focus');

function focusSections(): Section[] {
  const [kind, idxText] = (focus ?? '').split(':');
  const idx = Math.max(0, Number(idxText) || 0);
  const dragon = kind === 'dragon' ? SAMPLE_DRAGONS[idx % SAMPLE_DRAGONS.length] : null;
  const villain = kind === 'villain' ? SAMPLE_VILLAINS[idx % SAMPLE_VILLAINS.length] : null;
  const size = dragon ? dragon.size : villain ? villain.size : 1;
  const scale = Math.max(2, Math.min(4, 3.2 / size));
  const rowH = Math.ceil(46 * size * scale) + 30;
  const strip = params.get('pose') as Pose | null;
  const frames: { pose: Pose; poseT: number | null; name: string }[] = strip
    ? Array.from({ length: 9 }, (_, i) => ({ pose: strip, poseT: i / 8, name: `${strip} ${(i / 8).toFixed(2)}` }))
    : POSES.map((pose) => ({ pose, poseT: null, name: pose }));
  const perRow = 3, cellW = W / perRow;
  const rows = Math.ceil(frames.length / perRow);
  return [{
    title: `CLOSE-UP: ${kind} ${idx} AT SCALE ${scale.toFixed(1)}`, h: rows * rowH, bg: '#efe4d0',
    draw(y, t) {
      frames.forEach((f, i) => {
        const cx = cellW * (i % perRow) + cellW / 2, gy = y + Math.floor(i / perRow) * rowH + rowH - 18;
        const o = { scale, t, pose: f.pose, poseT: f.poseT ?? oneShot(t, i * 0.13), facing: (i % 2 ? -1 : 1) as 1 | -1 };
        if (dragon) drawDragon(ctx, dragon, cx, gy, o);
        if (villain) drawVillain(ctx, villain, cx, gy, o);
        label(f.name, cx, gy + 6);
      });
    },
  }];
}

const sections: Section[] = focus ? focusSections() : ([
  {
    title: 'DRAGONS AT SCALE 1 (BURROW)', h: 3 * 86 + 4, bg: '#efe4d0',
    draw(y, t) {
      SAMPLE_DRAGONS.forEach((v, i) => {
        const col = i % 8, row = Math.floor(i / 8);
        const cx = 40 + col * 80, gy = y + row * 86 + 64;
        drawDragon(ctx, v, cx, gy, { t: t + i * 0.37 });
        const [a, b] = dragonLabel(v);
        label(a, cx, gy + 5);
        label(b, cx, gy + 13);
      });
    },
  },
  {
    title: 'DRAGONS AT SCALE 2 (BATTLE)', h: 150, bg: '#3a2f4f',
    draw(y, t) {
      const pick = [19, 4, 0, 13, 21];
      pick.forEach((idx, i) => {
        const v = SAMPLE_DRAGONS[idx];
        const cx = 64 + i * 128, gy = y + 138;
        drawDragon(ctx, v, cx, gy, { scale: 2, t: t + i * 0.5, facing: i % 2 ? -1 : 1 });
        label(`H ${Math.round(dragonHeight(v, 2))}`, cx, gy + 3, '#bfb0d8');
      });
    },
  },
  {
    title: 'DRAGON POSES', h: 92, bg: '#efe4d0',
    draw(y, t) {
      POSES.forEach((pose: Pose, i) => {
        const cx = 34 + i * 64, gy = y + 72;
        drawDragon(ctx, POSE_DRAGON, cx, gy, { scale: 1.3, t, pose, poseT: oneShot(t, i * 0.13) });
        label(pose, cx, gy + 6);
      });
    },
  },
  {
    title: 'VILLAINS AT SCALE 1', h: 2 * 106 + 4, bg: '#3a2f4f',
    draw(y, t) {
      SAMPLE_VILLAINS.forEach((v, i) => {
        const col = i % 9, row = Math.floor(i / 9);
        const cx = 36 + col * 71, gy = y + row * 106 + 76;
        drawVillain(ctx, v, cx, gy, { t: t + i * 0.41, facing: -1 });
        const [a, b, c] = villainLabel(v);
        label(a, cx, gy + 5, '#d8ccf0');
        label(b, cx, gy + 13, '#a898c8');
        label(c, cx, gy + 21, '#a898c8');
      });
    },
  },
  {
    title: 'VILLAINS AT SCALE 2', h: 150, bg: '#efe4d0',
    draw(y, t) {
      const pick = [12, 14, 7, 3, 1];
      pick.forEach((idx, i) => {
        const v = SAMPLE_VILLAINS[idx];
        const cx = 64 + i * 128, gy = y + 138;
        drawVillain(ctx, v, cx, gy, { scale: idx === 12 || idx === 1 ? 1.4 : 2, t: t + i * 0.5, facing: -1 });
        label(`H ${Math.round(villainHeight(v, 2))}`, cx, gy + 3);
      });
    },
  },
  {
    title: 'VILLAIN POSES', h: 92, bg: '#3a2f4f',
    draw(y, t) {
      POSES.forEach((pose: Pose, i) => {
        const cx = 34 + i * 64, gy = y + 74;
        drawVillain(ctx, POSE_VILLAIN, cx, gy, { scale: 1.1, t, pose, poseT: oneShot(t, i * 0.13), facing: -1 });
        label(pose, cx, gy + 6, '#d8ccf0');
      });
    },
  },
]);

function totalHeight(): number {
  return 18 + sections.reduce((s, sec) => s + sec.h + 14, 0);
}

function frame(now: number): void {
  const t = frozen ?? now / 1000;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#1b1426';
  ctx.fillRect(0, 0, W, canvas.height);
  drawText(ctx, 'DRAGON HAMSTERS: CREATURE GALLERY', 6, 5, { color: '#ffd84a' });
  let y = 18;
  const t0 = performance.now();
  for (const sec of sections) {
    ctx.fillStyle = sec.bg;
    ctx.fillRect(0, y, W, sec.h + 14);
    drawText(ctx, sec.title, 6, y + 3, { color: sec.bg === '#3a2f4f' ? '#e8dcff' : '#3a2f4f', shadow: false });
    sec.draw(y + 12, t);
    y += sec.h + 14;
  }
  const ms = performance.now() - t0;
  drawText(ctx, `${ms.toFixed(1)} MS`, W - 6, 5, { color: '#8a7aa8', align: 'right' });
  if (window.__game) window.__game.ready = true;
  if (frozen == null) requestAnimationFrame(frame);
}

function layout(): void {
  const h = totalHeight();
  if (canvas.height !== h) canvas.height = h;
  const zoomParam = Number(params.get('zoom'));
  const zoom = zoomParam > 0 ? zoomParam : Math.max(1, Math.floor(window.innerWidth / W));
  canvas.style.width = `${W * zoom}px`;
  canvas.style.height = `${canvas.height * zoom}px`;
}

layout();
window.addEventListener('resize', () => { layout(); if (frozen != null) requestAnimationFrame(frame); });
requestAnimationFrame(frame);
