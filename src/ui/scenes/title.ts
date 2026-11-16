// The title screen: a starry night over the burrow's glowing door, a big bouncy logo, the three
// starters hopping in a row, and NEW GAME / CONTINUE plus SOUND and MUSIC switches.
//
// CONTINUE is offered when the live state (or the save on disk) has dragons in it. NEW GAME over an
// existing burrow asks first. The switches write app.state.settings and save, so they stick.
import { app } from '../app.ts';
import type { Scene } from '../scene.ts';
import type { Input } from '../input.ts';
import { drawText, measureText } from '../../lib/engine/text.ts';
import { ButtonGroup, UI, VIEW_W, fillRoundRect, hit, tint, type Rect } from '../widgets.ts';
import { drawTitleBackdrop } from '../../art/backdrops.ts';
import { drawDragon, dragonHeight } from '../../art/dragon.ts';
import { STARTERS, getSpecies } from '../../data/index.ts';
import { loadGame } from '../../game/state.ts';
import { music, setMusic, setSound, sfx } from '../../audio/index.ts';

type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------------------------------------
// The logo: chunky size-5 letters with a thick ink outline, a two-tone face and a 3D extrusion,
// each pre-rendered once and then bobbed in a wave.
// ---------------------------------------------------------------------------------------------

const LOGO_SIZE = 5;
const GLYPH_W = 5 * LOGO_SIZE, GLYPH_H = 7 * LOGO_SIZE;
const ADVANCE = 6 * LOGO_SIZE;
const OUT = 3;
const DEPTH = 4;

interface LetterStyle { top: string; mid: string; bottom: string; side: string }

const DRAGON_STYLE: LetterStyle = { top: '#fff2a0', mid: '#ffc93c', bottom: '#ff8a2a', side: '#b8401c' };
const HAMSTER_STYLE: LetterStyle = { top: '#fff8ec', mid: '#ffd9c4', bottom: '#f4a0a0', side: '#9a4a6a' };

const letterCache = new Map<string, HTMLCanvasElement>();

function letterSprite(ch: string, style: LetterStyle): HTMLCanvasElement {
  const key = ch + style.top;
  const hitC = letterCache.get(key);
  if (hitC) return hitC;
  const w = GLYPH_W + OUT * 2, h = GLYPH_H + OUT * 2 + DEPTH;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const at = (x: number, y: number, color: string): void => {
    drawText(g, ch, x, y, { size: LOGO_SIZE, color, shadow: false });
  };
  // ink outline around the face and every extrusion layer (rounded: skip the far corners)
  for (let oy = 0; oy <= DEPTH; oy++) {
    for (let dy = -OUT; dy <= OUT; dy++) for (let dx = -OUT; dx <= OUT; dx++) {
      if (dx * dx + dy * dy > OUT * OUT + 1) continue;
      at(OUT + dx, OUT + dy + oy, UI.ink);
    }
  }
  for (let oy = DEPTH; oy >= 1; oy--) at(OUT, OUT + oy, style.side);
  // the face in three bands, top lightest
  at(OUT, OUT, style.bottom);
  g.save(); g.beginPath(); g.rect(0, 0, w, OUT + Math.round(GLYPH_H * 0.62)); g.clip(); at(OUT, OUT, style.mid); g.restore();
  g.save(); g.beginPath(); g.rect(0, 0, w, OUT + LOGO_SIZE * 2); g.clip(); at(OUT, OUT, style.top); g.restore();
  // a one-pixel glint along the top edge of each top-row block
  g.save(); g.beginPath(); g.rect(0, OUT, w, 1); g.clip(); at(OUT, OUT, '#ffffff'); g.restore();
  letterCache.set(key, c);
  return c;
}

/** Draw one logo word centred on cx; letters pop in one by one, then bob in a travelling wave. */
function drawLogoWord(ctx: Ctx, word: string, cx: number, y: number, style: LetterStyle, t: number, age: number, delay: number): void {
  const width = word.length * ADVANCE - LOGO_SIZE;
  let x = Math.round(cx - width / 2);
  for (let i = 0; i < word.length; i++, x += ADVANCE) {
    const ch = word[i];
    if (ch === ' ') continue;
    // pop-in: each letter grows past full size and settles back
    const u = Math.max(0, Math.min(1, (age - delay - i * 0.06) / 0.34));
    if (u <= 0) continue;
    const k = u < 0.6 ? 1.3 * (1 - (1 - u / 0.6) * (1 - u / 0.6)) : 1.3 - 0.3 * ((u - 0.6) / 0.4);
    const wave = Math.sin(t * 3.1 - i * 0.55);
    const bob = u >= 1 ? -Math.max(0, wave) * 4 : 0;
    const spr = letterSprite(ch, style);
    if (u >= 1) {
      ctx.drawImage(spr, x - OUT, Math.round(y - OUT + bob));
    } else {
      const w = Math.max(1, Math.round(spr.width * k)), h = Math.max(1, Math.round(spr.height * k));
      const mx = x - OUT + spr.width / 2, my = y - OUT + spr.height / 2;
      ctx.drawImage(spr, Math.round(mx - w / 2), Math.round(my - h / 2), w, h);
    }
  }
}

/** The red ribbon under the logo. */
function drawRibbon(ctx: Ctx, text: string, cx: number, y: number): void {
  const tw = measureText(text);
  const w = tw + 28, h = 15;
  const x = Math.round(cx - w / 2);
  const red = '#c9473d', redDark = '#8a2a2a';
  // folded tails behind each end, with a V notch cut into the outer edge
  const th = h, ty = y + 4, half = (th - 1) / 2, reach = 14, notch = 5;
  const inset = (r: number): number => Math.round(notch * (1 - Math.abs(Math.max(0, Math.min(th - 1, r)) - half) / half));
  for (const side of [-1, 1]) {
    const outer = side < 0 ? x - reach : x + w + reach;
    const inner = side < 0 ? x + 6 : x + w - 6;
    const span = (r: number, grow: number, color: string): void => {
      const a = outer - side * (inset(r) - grow);
      const lo = Math.min(a, inner), hi = Math.max(a, inner);
      ctx.fillStyle = color;
      ctx.fillRect(lo, ty + r, hi - lo, 1);
    };
    for (let r = -1; r <= th; r++) span(r, 1, UI.ink);
    for (let r = 0; r < th; r++) span(r, 0, r === 0 ? tint(redDark, 0.25) : redDark);
  }
  fillRoundRect(ctx, x, y, w, h, 2, UI.ink);
  ctx.fillStyle = tint(red, -0.2);
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = red;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 3);
  ctx.fillStyle = tint(red, 0.35);
  ctx.fillRect(x + 2, y + 1, w - 4, 1);
  drawText(ctx, text, cx, y + 4, { align: 'center', color: '#fff6e4', shadowColor: redDark });
}

// ---------------------------------------------------------------------------------------------
// Little pixel icons for the switches
// ---------------------------------------------------------------------------------------------

function drawSpeakerIcon(ctx: Ctx, cx: number, cy: number, on: boolean, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(cx - 5, cy - 2, 3, 4);
  ctx.fillRect(cx - 2, cy - 3, 1, 6);
  ctx.fillRect(cx - 1, cy - 4, 1, 8);
  ctx.fillRect(cx, cy - 5, 1, 10);
  if (on) {
    ctx.fillRect(cx + 2, cy - 1, 1, 2);
    ctx.fillRect(cx + 3, cy - 3, 1, 1); ctx.fillRect(cx + 4, cy - 2, 1, 4); ctx.fillRect(cx + 3, cy + 2, 1, 1);
  } else {
    for (let k = 0; k < 4; k++) { ctx.fillRect(cx + 2 + k, cy - 2 + k, 1, 1); ctx.fillRect(cx + 5 - k, cy - 2 + k, 1, 1); }
  }
}

function drawNoteIcon(ctx: Ctx, cx: number, cy: number, on: boolean, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(cx - 4, cy + 1, 3, 3); ctx.fillRect(cx - 5, cy + 2, 1, 1);
  ctx.fillRect(cx - 2, cy - 5, 1, 7);
  ctx.fillRect(cx + 2, cy, 3, 3); ctx.fillRect(cx + 1, cy + 1, 1, 1);
  ctx.fillRect(cx + 4, cy - 6, 1, 7);
  ctx.fillRect(cx - 2, cy - 6, 7, 2);
  if (!on) {
    ctx.fillStyle = UI.bad;
    for (let k = -5; k <= 5; k++) ctx.fillRect(cx + k, cy - k, 1, 1);
  }
}

// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

interface Hopper { speciesId: string; x: number; boing: number }

export function createTitleScene(): Scene {
  /** app.time when the scene was entered: the logo's drop-in runs on the global clock, so it plays
   *  even when a dialog sits on top of the title from the first frame. */
  let born = 0;
  const group = new ButtonGroup();
  const hasSave = (): boolean => !!app.state && app.state.dragons.length > 0;

  const hoppers: Hopper[] = STARTERS.map((id, i) => ({ speciesId: id, x: 250 + i * 70, boing: 0 }));
  const GROUND = 304;

  function saveSummary(): string {
    const s = app.state;
    if (!hasSave()) return 'NO SAVE YET';
    const n = s.dragons.length;
    return `DAY ${s.day} - ${n} DRAGON${n === 1 ? '' : 'S'}`;
  }

  function startNew(): void {
    if (hasSave()) {
      const s = app.state;
      const n = s.dragons.length;
      app.nav.confirm(
        `START A NEW GAME? YOUR SAVED BURROW (DAY ${s.day}, ${n} DRAGON${n === 1 ? '' : 'S'}) WILL BE ERASED FOR GOOD. NO TAKE-BACKS!`,
        () => app.nav.intro(),
      );
    } else {
      app.nav.intro();
    }
  }

  function toggleSound(): void {
    const st = app.state.settings;
    st.sound = !st.sound;
    setSound(st.sound);
    sfx('click');
    app.save();
  }

  function toggleMusic(): void {
    const st = app.state.settings;
    st.music = !st.music;
    setMusic(st.music);
    sfx('click');
    app.save();
  }

  const BW = 180, BX = Math.round(VIEW_W / 2 - BW / 2);
  group.add({
    label: 'NEW GAME', size: 2, hotkey: 'n', color: UI.accent,
    rect: { x: BX, y: 138, w: BW, h: 28 },
    onClick: () => { sfx('select'); startNew(); },
  });
  group.add({
    label: 'CONTINUE', size: 2, hotkey: 'c',
    rect: { x: BX, y: 172, w: BW, h: 38 },
    enabled: hasSave,
    get sub() { return saveSummary(); },
    onClick: () => { sfx('select'); app.nav.burrow(); },
  });
  const half = (BW - 6) / 2;
  group.add({
    get label() { return app.state.settings.sound ? 'SOUND ON' : 'SOUND OFF'; },
    hotkey: 's', color: '#d8ecf4',
    rect: { x: BX, y: 216, w: half, h: 22 },
    icon: (ctx, cx, cy) => drawSpeakerIcon(ctx, cx, cy, app.state.settings.sound, UI.text),
    onClick: toggleSound,
  });
  group.add({
    get label() { return app.state.settings.music ? 'MUSIC ON' : 'MUSIC OFF'; },
    hotkey: 'm', color: '#e4dcf6',
    rect: { x: BX + BW - half, y: 216, w: half, h: 22 },
    icon: (ctx, cx, cy) => drawNoteIcon(ctx, cx, cy, app.state.settings.music, UI.text),
    onClick: toggleMusic,
  });

  function hopperRect(h: Hopper): Rect {
    const v = getSpecies(h.speciesId).visual;
    const ht = dragonHeight(v, 1.5);
    return { x: h.x - 22, y: GROUND - ht - 14, w: 44, h: ht + 16 };
  }

  return {
    name: 'title',
    enter() {
      born = app.time;
      // Back on the title after a new game was started but not finished: offer the old save again.
      if (!hasSave()) {
        const saved = loadGame();
        if (saved && saved.dragons.length > 0) app.state = saved;
      }
      setSound(app.state.settings.sound);
      setMusic(app.state.settings.music);
      music('title');
      group.focus = hasSave() ? 1 : 0;
    },
    resume() {
      group.focus = hasSave() ? 1 : 0;
    },
    update(dt: number, input: Input) {
      for (const h of hoppers) h.boing = Math.max(0, h.boing - dt);
      const p = input.pointer;
      if (p.pressed) {
        for (const h of hoppers) {
          if (hit(hopperRect(h), p.x, p.y)) { h.boing = 0.9; sfx('fluff', { volume: 0.6, pitch: 1.3 }); }
        }
      }
      group.update(input);
    },
    draw(ctx: Ctx) {
      const t = app.time;
      const age = t - born;
      drawTitleBackdrop(ctx, t);

      drawLogoWord(ctx, 'DRAGON', VIEW_W / 2, 16, DRAGON_STYLE, t, age, 0.05);
      drawLogoWord(ctx, 'HAMSTERS', VIEW_W / 2, 60, HAMSTER_STYLE, t + 0.4, age, 0.35);
      if (age > 0.9) {
        ctx.save();
        ctx.globalAlpha *= Math.min(1, (age - 0.9) / 0.3);
        drawRibbon(ctx, 'SECRET AGENTS OF THE BURROW', VIEW_W / 2, 108);
        ctx.restore();
      }

      // the three starters hop along in a row, a beat apart
      hoppers.forEach((h, i) => {
        const v = getSpecies(h.speciesId).visual;
        const boing = h.boing > 0;
        drawDragon(ctx, v, h.x, GROUND, {
          scale: 1.5, t: t * (boing ? 1.6 : 1) + i * 0.21, pose: 'happy', facing: 1,
        });
      });

      group.draw(ctx);

      // footer
      ctx.fillStyle = 'rgba(27, 20, 38, 0.55)';
      ctx.fillRect(0, 344, VIEW_W, 16);
      drawText(ctx, '(C) THE DRAGON HAMSTER AGENCY', 8, 348, { color: UI.textLightDim, shadowColor: UI.ink });
      drawText(ctx, 'ARROWS + ENTER, OR JUST CLICK', VIEW_W - 8, 348, { align: 'right', color: UI.textLightDim, shadowColor: UI.ink });
    },
  };
}
