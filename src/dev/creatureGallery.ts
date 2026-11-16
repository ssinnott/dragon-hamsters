// Creature gallery (dev/creatures.html): every sample dragon and villain at battle and burrow scale,
// a row of every pose for one of each, a mock battle exchange, and the flash / silhouette / fade modes.
// URL options: ?t=1.25 freezes the clock (screenshots), ?zoom=3 sets the CSS pixel scale,
// ?focus=dragon:3 or ?focus=villain:1 shows one sample close up in every pose at scale 3;
// add &pose=faint for a filmstrip of that pose at poseT 0, 0.125 .. 1.
// ?focus=outfits and ?focus=props layer every outfit / prop on every animal.

import { drawDragon, dragonHeight, SAMPLE_DRAGONS, POSES } from '../art/dragon.ts';
import type { Pose } from '../art/dragon.ts';
import { drawVillain, villainHeight, SAMPLE_VILLAINS } from '../art/villain.ts';
import { drawText } from '../lib/engine/text.ts';
import type { Animal, DragonVisual, Outfit, VillainProp, VillainVisual } from '../data/schema.ts';

const ANIMALS: Animal[] = ['mouse', 'rat', 'crow', 'magpie', 'pigeon', 'snake', 'lizard', 'toad', 'cat', 'ferret', 'robot', 'weasel'];
const OUTFITS: Outfit[] = ['none', 'suit', 'trenchcoat', 'labcoat', 'bandana', 'tracksuit', 'cape', 'apron', 'armor'];
const PROPS: VillainProp[] = ['none', 'cheeseHat', 'fedora', 'monocle', 'sunglasses', 'eyepatch', 'goggles', 'tophat', 'crown', 'antenna', 'chefHat', 'beret', 'headphones', 'helmet'];
const OUTFIT_COLORS = ['#3a3048', '#2a3a5a', '#8a6a40', '#4a8a5a', '#d0383a', '#3a5ad0', '#5a2a6a', '#6a4a8a', '#6a7a8a'];

function matrixSection(kind: 'outfits' | 'props'): Section {
  const cols = kind === 'outfits' ? OUTFITS.length : PROPS.length;
  const cellW = (W - 50) / cols, rowH = 46;
  return {
    title: `EVERY ${kind === 'outfits' ? 'OUTFIT' : 'PROP'} ON EVERY ANIMAL`, h: ANIMALS.length * rowH + 14, bg: '#efe4d0',
    draw(y, t) {
      for (let c = 0; c < cols; c++) {
        const name = kind === 'outfits' ? OUTFITS[c] : PROPS[c];
        drawText(ctx, name.slice(0, 7), 50 + c * cellW + cellW / 2, y + 2, { color: '#5a4a6a', align: 'center', shadow: false });
      }
      ANIMALS.forEach((animal, r) => {
        const base = SAMPLE_VILLAINS.find((v) => v.animal === animal)!;
        label(animal.slice(0, 6), 22, y + 14 + r * rowH + 24, '#5a4a6a');
        for (let c = 0; c < cols; c++) {
          const v: VillainVisual = kind === 'outfits'
            ? { ...base, outfit: OUTFITS[c], outfitColor: OUTFIT_COLORS[c], prop: 'none', size: 0.85 }
            : { ...base, outfit: 'none', prop: PROPS[c], size: 0.85 };
          drawVillain(ctx, v, 50 + c * cellW + cellW / 2, y + 14 + (r + 1) * rowH - 4, { t: t + r * 0.3 + c * 0.17, facing: -1 });
        }
      });
    },
  };
}

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

const sections: Section[] = focus === 'outfits' || focus === 'props' ? [matrixSection(focus)] : focus ? focusSections() : ([
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
      const xs = [44, 128, 212, 330, 520];
      pick.forEach((idx, i) => {
        const v = SAMPLE_DRAGONS[idx];
        const cx = xs[i], gy = y + 138;
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
  {
    title: 'BATTLE MOCK: LUNGE, HIT FLASH, RECOIL', h: 150, bg: '#efe4d0',
    draw(y, t) {
      const d = SAMPLE_DRAGONS[1], v = SAMPLE_VILLAINS[8];
      const u = t % 4.8;
      const gy = y + 128;
      ctx.fillStyle = '#d8c8a8';
      ctx.beginPath(); ctx.ellipse(170, gy + 2, 90, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(470, gy + 2, 90, 14, 0, 0, Math.PI * 2); ctx.fill();
      const dragonAttack = u < 1.2 ? u / 1.2 : null;
      const villainHurt = u >= 0.5 && u < 1.6 ? (u - 0.5) / 1.1 : null;
      const villainAttack = u >= 2.4 && u < 3.6 ? (u - 2.4) / 1.2 : null;
      const dragonHurt = u >= 2.9 && u < 4.0 ? (u - 2.9) / 1.1 : null;
      drawDragon(ctx, d, 170, gy, {
        scale: 2, t, facing: 1,
        pose: dragonAttack != null ? 'attack' : dragonHurt != null ? 'hurt' : 'idle',
        poseT: dragonAttack ?? dragonHurt ?? 0,
        flash: dragonHurt != null ? Math.max(0, 1 - dragonHurt * 4) : 0,
      });
      drawVillain(ctx, v, 470, gy, {
        scale: 2, t, facing: -1,
        pose: villainAttack != null ? 'attack' : villainHurt != null ? 'hurt' : 'idle',
        poseT: villainAttack ?? villainHurt ?? 0,
        flash: villainHurt != null ? Math.max(0, 1 - villainHurt * 4) : 0,
      });
    },
  },
  {
    title: 'MODES: SILHOUETTE, ALPHA 0.5, FACING, FLASH', h: 84, bg: '#3a2f4f',
    draw(y, t) {
      const gy = y + 64;
      const pulse = (Math.sin(t * 4) + 1) / 2;
      drawDragon(ctx, SAMPLE_DRAGONS[13], 50, gy, { t, silhouette: '#241c34' });
      drawVillain(ctx, SAMPLE_VILLAINS[6], 130, gy, { t, silhouette: '#241c34', facing: -1 });
      drawDragon(ctx, SAMPLE_DRAGONS[3], 220, gy, { t, alpha: 0.5 });
      drawVillain(ctx, SAMPLE_VILLAINS[9], 300, gy, { t, alpha: 0.5 });
      drawDragon(ctx, SAMPLE_DRAGONS[6], 380, gy, { t, facing: 1 });
      drawDragon(ctx, SAMPLE_DRAGONS[6], 440, gy, { t, facing: -1 });
      drawDragon(ctx, SAMPLE_DRAGONS[11], 520, gy, { t, flash: pulse });
      drawVillain(ctx, SAMPLE_VILLAINS[13], 600, gy, { t, flash: pulse, facing: -1 });
      label('SILHOUETTE', 90, gy + 5, '#d8ccf0');
      label('ALPHA', 260, gy + 5, '#d8ccf0');
      label('FACING', 410, gy + 5, '#d8ccf0');
      label('FLASH', 560, gy + 5, '#d8ccf0');
    },
  },
  {
    title: 'BURROW CROWD: 12 DRAGONS AT SCALE 1', h: 86, bg: '#c8a878',
    draw(y, t) {
      const loop: Pose[] = ['walk', 'walk', 'idle', 'eat', 'walk', 'sleep', 'walk', 'happy', 'dig', 'walk', 'run', 'walk'];
      for (let i = 0; i < 12; i++) {
        const v = SAMPLE_DRAGONS[(i * 5) % SAMPLE_DRAGONS.length];
        const pose = loop[i];
        const speed = pose === 'run' ? 60 : pose === 'walk' ? 18 : 0;
        const span = 560, raw = (i * 47 + t * speed) % (span * 2);
        const x = 40 + (raw < span ? raw : span * 2 - raw);
        const facing: 1 | -1 = speed === 0 ? (i % 2 ? -1 : 1) : raw < span ? 1 : -1;
        drawDragon(ctx, v, speed ? x : 40 + ((i * 47) % span), y + 74, { t: t + i, pose, facing });
      }
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
