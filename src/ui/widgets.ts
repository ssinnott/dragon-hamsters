// The UI kit: a warm parchment-and-ink palette, retained-mode buttons with mouse + keyboard
// navigation, a scroll list, and immediate-mode drawing helpers (panels, bars, badges, tags,
// wrapped text, the typewriter and its message box).
//
// Everything draws on whole pixels with fillRect, so panels and pills stay crisp under the
// nearest-neighbour upscale of the 640x360 canvas. Text is the engine's 5x7 pixel font
// (size 1: 7 px tall, 6 px advance; size 2 for headings).
import { drawText, measureText, type DrawTextOptions } from '../lib/engine/text.ts';
import { TYPES } from '../data/types.ts';
import { STATUS_SHORT, type StatusId, type TypeId } from '../data/schema.ts';
import type { Input } from './input.ts';
import { drawCoinIcon, drawTypeIcon } from './icons.ts';

type Ctx = CanvasRenderingContext2D;

export interface Rect { x: number; y: number; w: number; h: number }
export const VIEW_W = 640, VIEW_H = 360;

/** The palette. Panels are warm parchment outlined in ink; dark surfaces are a plum night. */
export const UI = {
  /** Outlines, text shadows, the fade colour. */
  ink: '#1b1426',
  inkSoft: '#3a2d4f',
  /** Drop shadows and the modal dim. */
  shadow: 'rgba(27, 20, 38, 0.3)',
  dim: 'rgba(27, 20, 38, 0.6)',

  /** Parchment panel face, its highlight, its shade, and a deep shade for wells and tracks. */
  panel: '#f4e3c0',
  panelLight: '#fff6de',
  panelDark: '#dcc08e',
  panelDeep: '#b8925e',

  /** Dark plum surfaces (HUD chips, battle boxes, the message box name tag). */
  night: '#2e2442',
  nightLight: '#46385f',
  nightDark: '#1f182e',

  /** Title plaques and scrollbar thumbs. */
  wood: '#9a6440',
  woodLight: '#c38a58',
  woodDark: '#663f27',

  /** Text on parchment. */
  text: '#3d2a1c',
  textDim: '#8d6f52',
  /** Text on dark or coloured surfaces. */
  textLight: '#fff6e4',
  textLightDim: '#c2b3d4',

  /** Default button face (honey) and the primary-action accent (coral). */
  button: '#ffd98a',
  accent: '#ef7d4f',
  accentLight: '#ffb08a',
  /** Focus ring. */
  focus: '#ffe45c',
  /** Selected row in lists. */
  select: '#ffe9a8',

  good: '#5cbf4f',
  warn: '#f39c3a',
  bad: '#e04f45',
  gold: '#f6c63c',
  goldDark: '#b8781e',
  goldLight: '#fff0a0',
  info: '#4f9be0',
  /** Unavailable things. */
  disabled: '#cdbfa8',
  disabledText: '#8f8170',

  hpGreen: '#5fd35a',
  hpYellow: '#f6c63c',
  hpRed: '#ee5240',
  /** Empty part of bars. */
  barBg: '#3a2d4f',
};

// ---------------------------------------------------------------------------------------------
// Colour and pixel helpers
// ---------------------------------------------------------------------------------------------

function rgbOf(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const tintCache = new Map<string, string>();

/**
 * Lighten (t > 0, toward warm white) or darken (t < 0, toward ink) a hex colour by |t| (0..1).
 * Non-hex colours come back unchanged.
 */
export function tint(color: string, t: number): string {
  const key = color + '|' + t;
  const hitC = tintCache.get(key);
  if (hitC) return hitC;
  const c = rgbOf(color);
  if (!c) return color;
  const to = t >= 0 ? [255, 250, 236] : [27, 20, 38];
  const k = Math.min(1, Math.abs(t));
  const ch = (i: number): string => Math.round(c[i] + (to[i] - c[i]) * k).toString(16).padStart(2, '0');
  const out = '#' + ch(0) + ch(1) + ch(2);
  if (tintCache.size > 2000) tintCache.clear();
  tintCache.set(key, out);
  return out;
}

/** Perceived brightness 0..1 (non-hex colours count as mid-grey). */
function luma(color: string): number {
  const c = rgbOf(color);
  if (!c) return 0.5;
  return (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255;
}

/** Readable text colour for a surface. */
export function textOn(surface: string): string {
  return luma(surface) > 0.7 ? UI.text : UI.textLight;
}

const CORNERS: readonly (readonly number[])[] = [[], [1], [2, 1], [3, 1, 1], [4, 2, 1, 1], [5, 3, 2, 1, 1]];

/** A pixel-crisp filled rounded rectangle (r 0..5, stepped corners). */
export function fillRoundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, color: string): void {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w <= 0 || h <= 0) return;
  r = Math.max(0, Math.min(Math.floor(r), 5, w >> 1, h >> 1));
  ctx.fillStyle = color;
  ctx.fillRect(x, y + r, w, h - 2 * r);
  const prof = CORNERS[r];
  for (let i = 0; i < r; i++) {
    const ins = prof[i];
    ctx.fillRect(x + ins, y + i, w - 2 * ins, 1);
    ctx.fillRect(x + ins, y + h - 1 - i, w - 2 * ins, 1);
  }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

/** Is (x, y) inside the rect? */
export function hit(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

// ---------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------

export interface PanelOpts {
  fill?: string;
  border?: string;
  /** A wooden name plaque straddling the top edge (it rises 6 px above `y`). */
  title?: string;
  shadow?: boolean;
}

/** The cosy panel: ink outline, chunky rounded corners, inner highlight, bottom shade, soft shadow. */
export function drawPanel(ctx: Ctx, x: number, y: number, w: number, h: number, opts: PanelOpts = {}): void {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const fill = opts.fill ?? UI.panel;
  const border = opts.border ?? UI.ink;
  if (opts.shadow !== false) {
    fillRoundRect(ctx, x + 1, y + 3, w, h, 4, 'rgba(27, 20, 38, 0.16)');
    fillRoundRect(ctx, x, y + 2, w, h, 4, 'rgba(27, 20, 38, 0.2)');
  }
  fillRoundRect(ctx, x, y, w, h, 4, border);
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 2, 3, tint(fill, -0.16));
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 4, 3, fill);
  ctx.fillStyle = tint(fill, 0.5);
  ctx.fillRect(x + 4, y + 1, w - 8, 1);
  ctx.fillRect(x + 1, y + 4, 1, h - 9);
  if (opts.title) drawPlaque(ctx, opts.title, x + 8, Math.max(0, y - 6));
}

/** A small wooden name plaque with light text (panel titles, speaker names). Returns its width. */
export function drawPlaque(ctx: Ctx, text: string, x: number, y: number, opts: { fill?: string; color?: string } = {}): number {
  x = Math.round(x); y = Math.round(y);
  const fill = opts.fill ?? UI.wood;
  const w = measureText(text) + 12, h = 13;
  fillRoundRect(ctx, x, y + 2, w, h, 3, 'rgba(27, 20, 38, 0.25)');
  fillRoundRect(ctx, x, y, w, h, 3, UI.ink);
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 2, 2, tint(fill, -0.25));
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 3, 2, fill);
  ctx.fillStyle = tint(fill, 0.3);
  ctx.fillRect(x + 3, y + 1, w - 6, 1);
  drawText(ctx, text, x + 6, y + 3, { color: opts.color ?? UI.textLight, shadowColor: tint(fill, -0.45) });
  return w;
}

/** A recessed well (list backgrounds, stat blocks): shaded top edge, light bottom edge. */
export function drawInset(ctx: Ctx, x: number, y: number, w: number, h: number, opts: { fill?: string } = {}): void {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const fill = opts.fill ?? tint(UI.panel, -0.06);
  fillRoundRect(ctx, x, y, w, h, 2, tint(fill, -0.3));
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 2, 1, tint(fill, 0.45));
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 3, 1, fill);
  ctx.fillStyle = tint(fill, -0.14);
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
}

/** Standard list-row highlight: a honey bar for the selection, a faint wash on hover. */
export function drawSelection(ctx: Ctx, r: Rect, selected: boolean, hovered: boolean): void {
  if (selected) {
    fillRoundRect(ctx, r.x, r.y, r.w, r.h, 3, UI.ink);
    fillRoundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 2, tint(UI.select, -0.15));
    fillRoundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 3, 2, UI.select);
    ctx.fillStyle = tint(UI.select, 0.6);
    ctx.fillRect(r.x + 3, r.y + 1, r.w - 6, 1);
  } else if (hovered) {
    fillRoundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 2, 'rgba(255, 246, 222, 0.75)');
  }
}

// ---------------------------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------------------------

export interface ButtonSpec {
  label: string;
  rect: Rect;
  onClick: () => void;
  /** Face colour (default honey UI.button). Text colour is picked for contrast unless given. */
  color?: string;
  textColor?: string;
  /** A key that fires the button directly ('1', 'a', 'Enter'). 'Escape' also answers Backspace. */
  hotkey?: string;
  enabled?: () => boolean;
  /** A second, smaller and dimmer line under the label. */
  sub?: string;
  /** Draws an icon centred at (cx, cy) left of the label; it gets about 12 px (16 px for size 2). */
  icon?: (ctx: Ctx, cx: number, cy: number) => void;
  /** Label text size (1 or 2). */
  size?: number;
  visible?: () => boolean;
  /** Content alignment; default 'center'. */
  align?: 'center' | 'left';
}

/** Height of the raised lip under a button face; the face sinks by this much when pressed. */
const LIP = 2;
const PRESS_TIME = 0.12;

export class Button {
  spec: ButtonSpec;
  hovered = false;
  /** The pointer went down on this button and is still held. */
  down = false;
  /** Seconds left of the press animation after the button fired. */
  pressT = 0;

  constructor(spec: ButtonSpec) {
    this.spec = spec;
  }

  get isEnabled(): boolean { return this.spec.enabled ? this.spec.enabled() : true; }
  get isVisible(): boolean { return this.spec.visible ? this.spec.visible() : true; }

  draw(ctx: Ctx, focused = false): void {
    if (!this.isVisible) return;
    const s = this.spec;
    const enabled = this.isEnabled;
    const x = Math.round(s.rect.x), y = Math.round(s.rect.y), w = Math.round(s.rect.w), h = Math.round(s.rect.h);
    const base = enabled ? (s.color ?? UI.button) : UI.disabled;
    const pressed = enabled && (this.pressT > 0 || (this.down && this.hovered));
    const hot = enabled && (this.hovered || focused) && !pressed;
    const face = hot ? tint(base, 0.2) : base;
    const top = pressed ? y + LIP : y;
    const bh = pressed ? h - LIP : h;

    if (focused && enabled) {
      const pulse = 0.5 + 0.5 * Math.sin(now() * 6);
      fillRoundRect(ctx, x - 2, top - 2, w + 4, bh + 4, 5, UI.ink);
      fillRoundRect(ctx, x - 1, top - 1, w + 2, bh + 2, 4, pulse > 0.5 ? UI.focus : tint(UI.focus, 0.3));
    } else if (!pressed && h > 8) {
      // soft contact shadow so the button sits on the panel
      fillRoundRect(ctx, x + 1, y + 2, w - 1, h - 1, 3, 'rgba(27, 20, 38, 0.18)');
    }
    fillRoundRect(ctx, x, top, w, bh, 3, UI.ink);
    const fh = h - 2 - LIP;
    if (!pressed) fillRoundRect(ctx, x + 1, top + 1, w - 2, bh - 2, 2, tint(base, -0.3));
    fillRoundRect(ctx, x + 1, top + 1, w - 2, fh, 2, face);
    if (enabled) {
      ctx.fillStyle = tint(face, 0.45);
      ctx.fillRect(x + 3, top + 1, w - 6, 1);
      if (fh > 6) ctx.fillRect(x + 1, top + 3, 1, fh - 5);
    }

    // content
    const size = Math.max(1, Math.round(s.size ?? 1));
    const textColor = enabled ? (s.textColor ?? textOn(face)) : UI.disabledText;
    const darkText = luma(textColor) < 0.5;
    const shadowColor = darkText ? tint(face, 0.4) : tint(base, -0.5);
    const fx = x + 1, fy = top + 1, fw = w - 2;
    const subGap = size > 1 ? 3 : 2;
    const contentH = 7 * size + (s.sub ? 7 + subGap : 0);
    const ty = fy + Math.floor((fh - contentH) / 2);
    const labelW = measureText(s.label, size);
    const subW = s.sub ? measureText(s.sub, 1) : 0;
    const textW = Math.max(labelW, subW);
    const iconBox = s.icon ? (size > 1 ? 16 : 12) : 0;
    const iconGap = s.icon ? 3 : 0;
    const left = s.align === 'left';
    const startX = left ? fx + 5 : fx + Math.floor((fw - (iconBox + iconGap + textW)) / 2);
    if (s.icon) {
      ctx.save();
      if (!enabled) ctx.globalAlpha = 0.5;
      s.icon(ctx, startX + Math.floor(iconBox / 2), fy + Math.floor(fh / 2));
      ctx.restore();
    }
    const tx = startX + iconBox + iconGap;
    const opts: DrawTextOptions = { size, color: textColor, shadow: enabled, shadowColor };
    if (left) drawText(ctx, s.label, tx, ty, opts);
    else drawText(ctx, s.label, tx + Math.floor((textW - labelW) / 2), ty, opts);
    if (s.sub) {
      const subColor = enabled ? mixColor(textColor, face, 0.38) : UI.disabledText;
      const sy = ty + 7 * size + subGap;
      const sx = left ? tx : tx + Math.floor((textW - subW) / 2);
      drawText(ctx, s.sub, sx, sy, { color: subColor, shadow: false });
    }
  }
}

function mixColor(a: string, b: string, t: number): string {
  const A = rgbOf(a), B = rgbOf(b);
  if (!A || !B) return a;
  const ch = (i: number): string => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0');
  return '#' + ch(0) + ch(1) + ch(2);
}

function hotkeyPressed(input: Input, key: string): boolean {
  if (key === 'Escape') return input.back();
  return input.pressed(key);
}

/**
 * A set of buttons with mouse hover/click, keyboard focus (arrow keys move spatially to the
 * nearest button in that direction, Tab cycles), Enter/Space to activate the focused button, and
 * per-button hotkeys. A click fires on release over the same button it pressed. Disabled and
 * invisible buttons are skipped. Draws the focused button last so its ring is never covered.
 */
export class ButtonGroup {
  buttons: Button[];
  /** Index of the focused button (-1 when nothing is usable). Hovering moves it. */
  focus = 0;
  /** Arrow keys / Tab / Enter / Space drive this group (hotkeys always work). */
  keyboard = true;
  private pressIdx = -1;
  private lastX = Number.NaN;
  private lastY = Number.NaN;

  constructor(buttons: Button[] = []) {
    this.buttons = [...buttons];
  }

  add(b: Button | ButtonSpec): Button {
    const btn = b instanceof Button ? b : new Button(b);
    this.buttons.push(btn);
    return btn;
  }

  /** Remove every button (focus index is kept, so a rebuilt identical layout keeps its place). */
  clear(): void {
    this.buttons = [];
    this.pressIdx = -1;
  }

  /** The focused button, if any. */
  get focused(): Button | null {
    return this.usable(this.focus) ? this.buttons[this.focus] : null;
  }

  private usable(i: number): boolean {
    const b = this.buttons[i];
    return !!b && b.isVisible && b.isEnabled;
  }

  private fixFocus(): void {
    if (this.usable(this.focus)) return;
    this.focus = this.buttons.findIndex((_, i) => this.usable(i));
  }

  private fire(i: number): boolean {
    const b = this.buttons[i];
    b.pressT = PRESS_TIME;
    b.down = false;
    this.focus = i;
    b.spec.onClick();
    return true;
  }

  /** Move focus to the nearest usable button in direction (dx, dy); wraps along a row or column. */
  private moveFocus(dx: number, dy: number): void {
    this.fixFocus();
    const cur = this.buttons[this.focus];
    if (!cur) return;
    const a = cur.spec.rect;
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
    let best = -1, bestScore = Infinity;
    let wrap = -1, wrapScore = Infinity;
    for (let i = 0; i < this.buttons.length; i++) {
      if (i === this.focus || !this.usable(i)) continue;
      const b = this.buttons[i].spec.rect;
      const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
      const along = (bcx - acx) * dx + (bcy - acy) * dy;
      // gap between the two rects across the direction of travel (0 when they overlap)
      const perpGap = dx !== 0
        ? Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h))
        : Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
      const perpCentre = dx !== 0 ? Math.abs(bcy - acy) : Math.abs(bcx - acx);
      // a real candidate lies past our centre: its near edge is beyond the middle of this button
      const beyond = dx > 0 ? b.x >= acx - 1 : dx < 0 ? b.x + b.w <= acx + 1 : dy > 0 ? b.y >= acy - 1 : b.y + b.h <= acy + 1;
      if (along > 1 && beyond) {
        const edgeGap = dx > 0 ? b.x - (a.x + a.w) : dx < 0 ? a.x - (b.x + b.w) : dy > 0 ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
        const score = Math.max(0, edgeGap) + perpGap * 3 + perpCentre * 0.4 + along * 0.05;
        if (score < bestScore) { bestScore = score; best = i; }
      } else if (along < -1 && perpGap === 0) {
        // wrap candidate: the farthest button back along the same row/column
        const score = along + perpCentre * 0.4;
        if (score < wrapScore) { wrapScore = score; wrap = i; }
      }
    }
    if (best >= 0) this.focus = best;
    else if (wrap >= 0) this.focus = wrap;
  }

  /** Handle input; true if a button fired this update. */
  update(input: Input): boolean {
    const dt = 1 / 60;
    for (const b of this.buttons) if (b.pressT > 0) b.pressT = Math.max(0, b.pressT - dt);
    const p = input.pointer;
    const moved = p.x !== this.lastX || p.y !== this.lastY;
    this.lastX = p.x; this.lastY = p.y;

    let hover = -1;
    for (let i = 0; i < this.buttons.length; i++) {
      const b = this.buttons[i];
      b.hovered = p.inside && this.usable(i) && hit(b.spec.rect, p.x, p.y);
      if (b.hovered) hover = i;
    }
    if (hover >= 0 && (moved || p.pressed)) this.focus = hover;

    if (p.pressed) {
      this.pressIdx = hover;
      if (hover >= 0) this.buttons[hover].down = true;
    }
    if (p.released) {
      const i = this.pressIdx;
      this.pressIdx = -1;
      for (const b of this.buttons) b.down = false;
      if (i >= 0 && i === hover && this.usable(i)) return this.fire(i);
    } else if (!p.down && this.pressIdx >= 0) {
      this.pressIdx = -1;
      for (const b of this.buttons) b.down = false;
    }

    for (let i = 0; i < this.buttons.length; i++) {
      const hk = this.buttons[i].spec.hotkey;
      if (hk && this.usable(i) && hotkeyPressed(input, hk)) return this.fire(i);
    }

    if (!this.keyboard) return false;
    this.fixFocus();
    if (this.focus < 0) return false;
    if (input.pressed('ArrowLeft')) this.moveFocus(-1, 0);
    else if (input.pressed('ArrowRight')) this.moveFocus(1, 0);
    else if (input.pressed('ArrowUp')) this.moveFocus(0, -1);
    else if (input.pressed('ArrowDown')) this.moveFocus(0, 1);
    else if (input.pressed('Tab')) {
      const n = this.buttons.length, step = input.held('Shift') ? n - 1 : 1;
      for (let k = 1, i = this.focus; k <= n; k++) {
        i = (i + step) % n;
        if (this.usable(i)) { this.focus = i; break; }
      }
    }
    if (input.confirm() && this.usable(this.focus)) return this.fire(this.focus);
    return false;
  }

  draw(ctx: Ctx): void {
    const f = this.usable(this.focus) ? this.focus : -1;
    for (let i = 0; i < this.buttons.length; i++) if (i !== f) this.buttons[i].draw(ctx, false);
    if (f >= 0) this.buttons[f].draw(ctx, true);
  }
}

// ---------------------------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------------------------

/** A framed meter: ink border, dark trough, fill with a highlight row and a shade row. */
export function drawBar(ctx: Ctx, x: number, y: number, w: number, h: number, frac: number, color: string, opts: { bg?: string; border?: string } = {}): void {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w < 3 || h < 3) return;
  const f = Number.isFinite(frac) ? Math.max(0, Math.min(1, frac)) : 0;
  fillRoundRect(ctx, x, y, w, h, h >= 6 ? 1 : 0, opts.border ?? UI.ink);
  const ix = x + 1, iy = y + 1, iw = w - 2, ih = h - 2;
  const bg = opts.bg ?? UI.barBg;
  ctx.fillStyle = bg;
  ctx.fillRect(ix, iy, iw, ih);
  ctx.fillStyle = tint(bg, -0.3);
  ctx.fillRect(ix, iy, iw, 1);
  let fw = Math.round(iw * f);
  if (f > 0 && fw < 1) fw = 1;
  if (fw <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(ix, iy, fw, ih);
  if (ih >= 3) { ctx.fillStyle = tint(color, 0.45); ctx.fillRect(ix, iy, fw, 1); }
  if (ih >= 4) { ctx.fillStyle = tint(color, -0.22); ctx.fillRect(ix, iy + ih - 1, fw, 1); }
  if (fw < iw) { ctx.fillStyle = tint(color, -0.35); ctx.fillRect(ix + fw - 1, iy, 1, ih); }
}

/** HP colour: green above half, yellow above a fifth, red below. */
export function hpColor(frac: number): string {
  return frac > 0.5 ? UI.hpGreen : frac > 0.2 ? UI.hpYellow : UI.hpRed;
}

// 3x5 "HP" for the tag on HP bars (the 5x7 font would fill the tag edge to edge).
const MINI_HP = ['#.#.##.', '#.#.#.#', '###.##.', '#.#.#..', '#.#.#..'];

/**
 * An HP bar with its little "HP" tag: 9 px tall, `w` wide in total. Bosses get a gold-ringed bar,
 * a gold tag and a sparkle.
 */
export function drawHpBar(ctx: Ctx, x: number, y: number, w: number, hp: number, maxHp: number, opts: { boss?: boolean } = {}): void {
  x = Math.round(x); y = Math.round(y); w = Math.round(w);
  const frac = maxHp > 0 ? hp / maxHp : 0;
  const boss = !!opts.boss;
  const tagW = 13, h = 9;
  const tagFill = boss ? UI.gold : '#f2a33a';
  fillRoundRect(ctx, x, y, tagW, h, 2, UI.ink);
  ctx.fillStyle = tint(tagFill, -0.25);
  ctx.fillRect(x + 1, y + 1, tagW - 2, h - 2);
  ctx.fillStyle = tagFill;
  ctx.fillRect(x + 1, y + 1, tagW - 2, h - 3);
  ctx.fillStyle = tint(tagFill, 0.5);
  ctx.fillRect(x + 2, y + 1, tagW - 4, 1);
  ctx.fillStyle = UI.ink;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) if (MINI_HP[r][c] === '#') ctx.fillRect(x + 3 + c, y + 2 + r, 1, 1);
  const bx = x + tagW - 1, bw = w - tagW + 1;
  if (boss) {
    fillRoundRect(ctx, bx, y, bw, h, 1, UI.ink);
    drawBar(ctx, bx + 1, y + 1, bw - 2, h - 2, frac, hpColor(frac), { border: UI.gold });
    ctx.fillStyle = UI.goldLight;
    ctx.fillRect(bx + 2, y + 1, bw - 4, 1);
    ctx.fillRect(x + 1, y - 1, 1, 3);
    ctx.fillRect(x, y, 3, 1);
  } else {
    drawBar(ctx, bx, y + 1, bw, h - 2, frac, hpColor(frac));
  }
}

// ---------------------------------------------------------------------------------------------
// Badges and tags
// ---------------------------------------------------------------------------------------------

/** Generic pill: ink outline, coloured face with highlight and shade rows, centred text. */
function drawPill(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string): void {
  const r = h >= 12 ? 4 : 3;
  fillRoundRect(ctx, x, y, w, h, r, UI.ink);
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 2, r - 1, tint(fill, -0.2));
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 3, r - 1, fill);
  ctx.fillStyle = tint(fill, 0.4);
  ctx.fillRect(x + r, y + 1, w - 2 * r, 1);
}

/** Height of a type badge / effect tag: 13 px, or 11 px small. */
export function badgeHeight(small = false): number { return small ? 11 : 13; }

/** A rounded pill in the type's colour with its emblem and name. Returns its width. */
export function drawTypeBadge(ctx: Ctx, type: TypeId, x: number, y: number, opts: { small?: boolean } = {}): number {
  x = Math.round(x); y = Math.round(y);
  const info = TYPES[type];
  const color = info?.color || '#9a8f80';
  const dark = info?.dark || tint(color, -0.45);
  const name = String(info?.name || type);
  const small = !!opts.small;
  const h = badgeHeight(small);
  const iconBox = small ? 7 : 9;
  const padL = small ? 2 : 2, gap = small ? 2 : 3, padR = small ? 4 : 5;
  const tw = measureText(name);
  const w = 1 + padL + iconBox + gap + tw + padR + 1;
  drawPill(ctx, x, y, w, h, color);
  drawTypeIcon(ctx, type, x + 1 + padL + (iconBox - 1) / 2, y + (small ? 5 : 6), small ? 2.6 : 3.6, { plain: true });
  drawText(ctx, name, x + 1 + padL + iconBox + gap, y + (small ? 2 : 3), { color: textOn(color) === UI.text ? UI.text : '#ffffff', shadowColor: dark });
  return w;
}

/** Several type badges in a row (2 px apart). Returns the total width. */
export function drawTypeBadges(ctx: Ctx, types: readonly TypeId[], x: number, y: number, opts: { small?: boolean; gap?: number } = {}): number {
  const gap = opts.gap ?? 2;
  let cx = x;
  types.forEach((t, i) => { cx += drawTypeBadge(ctx, t, cx, y, opts) + (i < types.length - 1 ? gap : 0); });
  return cx - x;
}

/** Text and colours for a type multiplier: SUPER X2 / X4 green, X1 neutral, WEAK X0.5 / X0.25 orange, NO EFFECT grey. */
export function effectStyle(mult: number): { text: string; fill: string; color: string } {
  const fmt = (m: number): string => (Math.round(m * 100) / 100).toString();
  if (!(mult > 0)) return { text: 'NO EFFECT', fill: '#57506a', color: '#d8d2e6' };
  if (mult >= 4) return { text: 'SUPER X' + fmt(mult), fill: '#2fa84a', color: '#ffffff' };
  if (mult > 1) return { text: 'SUPER X' + fmt(mult), fill: '#4cbf52', color: '#ffffff' };
  if (mult === 1) return { text: 'X1', fill: '#e6d3ad', color: UI.text };
  if (mult <= 0.25) return { text: 'WEAK X' + fmt(mult), fill: '#d9692b', color: '#ffffff' };
  return { text: 'WEAK X' + fmt(mult), fill: '#f08a3a', color: '#ffffff' };
}

/** The effectiveness tag for a move against the current foe. Returns its width. */
export function drawEffectTag(ctx: Ctx, mult: number, x: number, y: number, opts: { small?: boolean } = {}): number {
  x = Math.round(x); y = Math.round(y);
  const st = effectStyle(mult);
  const small = !!opts.small;
  const h = badgeHeight(small);
  const w = measureText(st.text) + (small ? 8 : 10);
  drawPill(ctx, x, y, w, h, st.fill);
  const dark = luma(st.color) < 0.5;
  if (mult >= 4) {
    // a gold glint along the top: the best possible news
    ctx.fillStyle = UI.goldLight;
    ctx.fillRect(x + 3, y + 1, w - 6, 1);
  }
  drawText(ctx, st.text, x + (small ? 4 : 5), y + (small ? 2 : 3), { color: st.color, shadow: !dark, shadowColor: tint(st.fill, -0.5) });
  return w;
}

const STATUS_FILL: Record<StatusId, string> = {
  burn: '#e8603c', goop: '#9a52c8', zap: '#f2cb36', snooze: '#7f8fb8', frozen: '#8fd8f0',
};

/** A small status pill (BRN, GOO, ZAP, SLP, FRZ). Returns its width. */
export function drawStatusBadge(ctx: Ctx, status: StatusId, x: number, y: number): number {
  x = Math.round(x); y = Math.round(y);
  const fill = STATUS_FILL[status] ?? UI.inkSoft;
  const text = STATUS_SHORT[status] ?? String(status).toUpperCase();
  const w = measureText(text) + 8, h = 11;
  drawPill(ctx, x, y, w, h, fill);
  const color = textOn(fill) === UI.text ? UI.ink : '#ffffff';
  drawText(ctx, text, x + 4, y + 2, { color, shadow: color !== UI.ink, shadowColor: tint(fill, -0.5) });
  return w;
}

// Stars: a 9x8 pixel star, outlined in ink, gold when earned.
const STAR_MASK = [
  '....#....',
  '...###...',
  '...###...',
  '#########',
  '.#######.',
  '..#####..',
  '..##.##..',
  '.##...##.',
];
const starCache = new Map<string, HTMLCanvasElement>();

function starSprite(fill: string, hi: string, outline: string): HTMLCanvasElement {
  const key = fill + hi + outline;
  const hitC = starCache.get(key);
  if (hitC) return hitC;
  const W = 11, H = 10;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const on = (x: number, y: number): boolean => y >= 0 && y < 8 && x >= 0 && x < 9 && STAR_MASK[y][x] === '#';
  g.fillStyle = outline;
  for (let y = -1; y <= 8; y++) for (let x = -1; x <= 9; x++) {
    if (on(x, y)) continue;
    if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) g.fillRect(x + 1, y + 1, 1, 1);
  }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) {
    if (!on(x, y)) continue;
    g.fillStyle = (y <= 3 && x <= 4) || (y === 4 && x <= 2) ? hi : fill;
    g.fillRect(x + 1, y + 1, 1, 1);
  }
  starCache.set(key, c);
  return c;
}

/** `n` gold stars out of `max` (empty ones dim), 10 px apart. Returns the width. */
export function drawStars(ctx: Ctx, n: number, max: number, x: number, y: number): number {
  x = Math.round(x); y = Math.round(y);
  const full = starSprite(UI.gold, UI.goldLight, UI.ink);
  const empty = starSprite(tint(UI.panelDeep, -0.05), tint(UI.panelDeep, 0.2), tint(UI.panelDeep, -0.45));
  for (let i = 0; i < max; i++) ctx.drawImage(i < n ? full : empty, x + i * 10, y);
  return max > 0 ? max * 10 + 1 : 0;
}

/** A coin counter chip (dark pill, gold coin, amount). Returns its width. */
export function drawCoins(ctx: Ctx, amount: number, x: number, y: number): number {
  x = Math.round(x); y = Math.round(y);
  const text = String(Math.floor(amount));
  const h = 13, w = measureText(text) + 21;
  drawPill(ctx, x, y, w, h, UI.night);
  drawCoinIcon(ctx, x + 7, y + 6, 4);
  drawText(ctx, text, x + 14, y + 3, { color: UI.goldLight, shadowColor: UI.nightDark });
  return w;
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

interface LaidLine { text: string; start: number }

/** Word-wrap with the start index of each line in the source text (for the typewriter). */
function layoutLines(text: string, maxWidth: number, size: number): LaidLine[] {
  const adv = 6 * size;
  const maxChars = Math.max(1, Math.floor((maxWidth + size) / adv));
  const out: LaidLine[] = [];
  let pos = 0;
  for (const para of text.split('\n')) {
    let i = 0;
    const n = para.length;
    if (n === 0) out.push({ text: '', start: pos });
    while (i < n) {
      if (n - i <= maxChars) { out.push({ text: para.slice(i), start: pos + i }); break; }
      // last space that keeps the line within maxChars
      let brk = para.lastIndexOf(' ', i + maxChars);
      if (brk <= i) {
        out.push({ text: para.slice(i, i + maxChars), start: pos + i });   // one long word: hard break
        i += maxChars;
      } else {
        out.push({ text: para.slice(i, brk), start: pos + i });
        i = brk + 1;
      }
      while (i < n && para[i] === ' ') i++;
    }
    pos += n + 1;
  }
  return out;
}

/** Split text into lines that fit `maxWidth` px at `size` (respects '\n'). */
export function wrapText(text: string, maxWidth: number, size = 1): string[] {
  return layoutLines(String(text), maxWidth, size).map((l) => l.text);
}

/** Line step for wrapped text: glyph height plus the gap. */
function lineStep(size: number, gap?: number): number {
  return 7 * size + (gap ?? 2 * size + 1);
}

/**
 * Draw word-wrapped text; returns the height used (lines x step, step = 7*size + lineGap,
 * lineGap default 2*size + 1). Alignment applies per line against `x`.
 */
export function drawWrapped(ctx: Ctx, text: string, x: number, y: number, maxWidth: number, opts: DrawTextOptions & { lineGap?: number } = {}): number {
  const size = Math.max(1, Math.round(opts.size ?? 1));
  const step = lineStep(size, opts.lineGap);
  const lines = wrapText(text, maxWidth, size);
  lines.forEach((l, i) => { drawText(ctx, l, x, y + i * step, opts); });
  return lines.length * step;
}

/**
 * Reveals text a character at a time (~60 chars/s by default), pausing briefly after sentence
 * punctuation. `onChar` (optional) is called for each revealed non-space character, for blips.
 */
export class Typewriter {
  cps: number;
  text = '';
  onChar: ((ch: string) => void) | null = null;
  private shown = 0;
  private acc = 0;
  private wait = 0;

  constructor(cps = 60) {
    this.cps = cps;
  }

  set(text: string): void {
    this.text = String(text);
    this.shown = 0;
    this.acc = 0;
    this.wait = 0;
  }

  update(dt: number): void {
    if (this.done) return;
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait > 0) return;
      dt = -this.wait;
      this.wait = 0;
    }
    this.acc += dt * this.cps;
    while (this.acc >= 1 && this.shown < this.text.length) {
      this.acc -= 1;
      const ch = this.text[this.shown++];
      if (ch !== ' ' && ch !== '\n') this.onChar?.(ch);
      const next = this.text[this.shown];
      const endsWord = next === undefined || next === ' ' || next === '\n';
      if (endsWord && (ch === '.' || ch === '!' || ch === '?')) { this.wait = 0.16; this.acc = 0; break; }
      if (endsWord && (ch === ',' || ch === ';' || ch === ':')) { this.wait = 0.07; this.acc = 0; break; }
    }
  }

  /** Reveal everything now. */
  skip(): void {
    this.shown = this.text.length;
    this.wait = 0;
  }

  get done(): boolean { return this.shown >= this.text.length; }
  get visible(): string { return this.text.slice(0, this.shown); }
  /** Characters revealed so far. */
  get count(): number { return this.shown; }
}

/**
 * Draw the revealed part of a typewriter, laid out as the FULL text would wrap (so words never
 * jump to the next line mid-reveal). Returns the height of the full layout.
 */
export function drawTypewriter(ctx: Ctx, tw: Typewriter, x: number, y: number, maxWidth: number, opts: DrawTextOptions & { lineGap?: number } = {}): number {
  const size = Math.max(1, Math.round(opts.size ?? 1));
  const step = lineStep(size, opts.lineGap);
  const lines = layoutLines(tw.text, maxWidth, size);
  const n = tw.count;
  lines.forEach((l, i) => {
    const vis = Math.max(0, Math.min(l.text.length, n - l.start));
    if (vis > 0) drawText(ctx, l.text.slice(0, vis), x, y + i * step, { ...opts, align: 'left' });
  });
  return lines.length * step;
}

export interface MessageBoxOpts {
  /** Text size; default 2 when the text fits the box at size 2, else 1. */
  size?: number;
  /** Show the bouncing "more" arrow (default: when a Typewriter is done). */
  arrow?: boolean;
  /** Speaker name plaque on the top edge. */
  name?: string;
  fill?: string;
}

/**
 * The dialogue / battle message box: a parchment panel with wrapped text. Pass a Typewriter to
 * reveal it without words jumping lines; the "more" arrow bobs once it has finished.
 */
export function drawMessageBox(ctx: Ctx, x: number, y: number, w: number, h: number, text: string | Typewriter, opts: MessageBoxOpts = {}): void {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  drawPanel(ctx, x, y, w, h, { fill: opts.fill ?? UI.panelLight });
  // inner rule, like a letter's margin
  ctx.fillStyle = tint(opts.fill ?? UI.panelLight, -0.1);
  ctx.fillRect(x + 4, y + 4, w - 8, 1);
  ctx.fillRect(x + 4, y + h - 7, w - 8, 1);
  const full = typeof text === 'string' ? text : text.text;
  const padX = 12, innerW = w - padX * 2 - 8;
  let size = opts.size ?? 0;
  if (!size) {
    const lines2 = wrapText(full, innerW, 2);
    size = lines2.length * lineStep(2) - 4 <= h - 16 ? 2 : 1;
  }
  const lineCount = wrapText(full, innerW, size).length;
  const blockH = lineCount * lineStep(size) - (2 * size + 1);
  const ty = y + Math.max(8, Math.floor((h - 3 - blockH) / 2));
  const tOpts: DrawTextOptions = { size, color: UI.text, shadowColor: tint(opts.fill ?? UI.panelLight, -0.16) };
  if (typeof text === 'string') drawWrapped(ctx, text, x + padX, ty, innerW, tOpts);
  else drawTypewriter(ctx, text, x + padX, ty, innerW, tOpts);
  const arrow = opts.arrow ?? (typeof text !== 'string' && text.done && text.text.length > 0);
  if (arrow) {
    const bob = Math.floor(now() * 3) % 2;
    const ax = x + w - 16, ay = y + h - 15 + bob;
    ctx.fillStyle = UI.ink;
    ctx.fillRect(ax - 1, ay - 1, 9, 2); ctx.fillRect(ax, ay + 1, 7, 1); ctx.fillRect(ax + 1, ay + 2, 5, 1);
    ctx.fillRect(ax + 2, ay + 3, 3, 1); ctx.fillRect(ax + 3, ay + 4, 1, 1);
    ctx.fillStyle = UI.accent;
    ctx.fillRect(ax, ay, 7, 1); ctx.fillRect(ax + 1, ay + 1, 5, 1); ctx.fillRect(ax + 2, ay + 2, 3, 1); ctx.fillRect(ax + 3, ay + 3, 1, 1);
  }
  if (opts.name) drawPlaque(ctx, opts.name, x + 10, Math.max(0, y - 7));
}

// ---------------------------------------------------------------------------------------------
// Scroll list
// ---------------------------------------------------------------------------------------------

export interface ScrollListOptions<T> {
  rect: Rect;
  rowH: number;
  items: () => T[];
  drawRow: (ctx: Ctx, item: T, r: Rect, selected: boolean, hovered: boolean) => void;
  /** The selection changed by click or keys. */
  onSelect?: (item: T, i: number) => void;
  /** Double-click, or Enter/Space on the selection. */
  onActivate?: (item: T, i: number) => void;
  /** Shown centred when there are no items. */
  empty?: string;
}

const SCROLLBAR_W = 7;
const DOUBLE_CLICK_UPDATES = 24;

type ListPress =
  | { kind: 'row'; y0: number; s0: number; row: number; dragged: boolean }
  | { kind: 'thumb'; grab: number }
  | { kind: 'track' };

/**
 * A vertical list with wheel / drag / scrollbar scrolling, click to select, double-click or Enter
 * to activate, and Up/Down/PageUp/PageDown/Home/End. The caller draws rows (see drawSelection)
 * and any panel behind it; the list clips rows to its rect and draws its own scrollbar.
 */
export class ScrollList<T> {
  opts: ScrollListOptions<T>;
  selected = 0;
  hovered = -1;
  /** Arrow keys and Enter/Space drive this list. */
  keyboard = true;
  /** Current scroll offset in px (eases toward its target). */
  scroll = 0;
  private target = 0;
  private tick = 0;
  private lastClickRow = -1;
  private lastClickTick = -1000;
  private press: ListPress | null = null;
  private thumbHover = false;

  constructor(opts: ScrollListOptions<T>) {
    this.opts = opts;
  }

  get rect(): Rect { return this.opts.rect; }

  private metrics(n: number): { content: number; max: number; bar: boolean; rowW: number; thumbH: number; thumbY: number; barX: number } {
    const r = this.opts.rect;
    const content = n * this.opts.rowH;
    const max = Math.max(0, content - r.h);
    const bar = max > 0;
    const rowW = r.w - (bar ? SCROLLBAR_W + 2 : 0);
    const thumbH = bar ? Math.max(14, Math.round(r.h * r.h / content)) : r.h;
    const thumbY = r.y + (bar ? Math.round((r.h - thumbH) * (this.scroll / max)) : 0);
    return { content, max, bar, rowW, thumbH, thumbY, barX: r.x + r.w - SCROLLBAR_W };
  }

  /** Scroll so row i is fully visible. */
  ensureVisible(i: number): void {
    const r = this.opts.rect, rowH = this.opts.rowH;
    const top = i * rowH;
    if (top < this.target) this.target = top;
    if (top + rowH > this.target + r.h) this.target = top + rowH - r.h;
  }

  private choose(i: number, items: T[]): void {
    if (i < 0 || i >= items.length) return;
    const changed = i !== this.selected;
    this.selected = i;
    this.ensureVisible(i);
    if (changed) this.opts.onSelect?.(items[i], i);
  }

  private activate(i: number, items: T[]): void {
    if (i >= 0 && i < items.length) this.opts.onActivate?.(items[i], i);
  }

  update(input: Input): void {
    this.tick++;
    const items = this.opts.items();
    const n = items.length;
    const r = this.opts.rect, rowH = this.opts.rowH;
    if (n === 0) this.selected = -1;
    else if (this.selected < 0 || this.selected >= n) this.selected = Math.max(0, Math.min(n - 1, this.selected));
    let m = this.metrics(n);
    const p = input.pointer;
    const over = p.inside && hit(r, p.x, p.y);

    if (input.wheel !== 0 && over) this.target += input.wheel * 0.6;

    // hover
    this.hovered = -1;
    this.thumbHover = m.bar && p.inside && p.x >= m.barX && p.x < m.barX + SCROLLBAR_W && p.y >= m.thumbY && p.y < m.thumbY + m.thumbH;
    if (over && p.x < r.x + m.rowW) {
      const i = Math.floor((p.y - r.y + this.scroll) / rowH);
      if (i >= 0 && i < n) this.hovered = i;
    }

    if (p.pressed && over) {
      if (m.bar && p.x >= m.barX - 1) {
        if (p.y >= m.thumbY && p.y < m.thumbY + m.thumbH) this.press = { kind: 'thumb', grab: p.y - m.thumbY };
        else { this.target += (p.y < m.thumbY ? -1 : 1) * Math.max(rowH, r.h - rowH); this.press = { kind: 'track' }; }
      } else {
        this.press = { kind: 'row', y0: p.y, s0: this.target, row: this.hovered, dragged: false };
      }
    }
    const pr = this.press;
    if (pr && p.down) {
      if (pr.kind === 'thumb' && m.bar) {
        const t = (p.y - pr.grab - r.y) / Math.max(1, r.h - m.thumbH);
        this.target = this.scroll = Math.max(0, Math.min(1, t)) * m.max;
      } else if (pr.kind === 'row') {
        if (Math.abs(p.y - pr.y0) > 3 && m.bar) pr.dragged = true;
        if (pr.dragged) this.target = this.scroll = pr.s0 - (p.y - pr.y0);
      }
    }
    if (p.released && pr) {
      this.press = null;
      if (pr.kind === 'row' && !pr.dragged && pr.row >= 0 && pr.row === this.hovered) {
        this.choose(pr.row, items);
        if (this.lastClickRow === pr.row && this.tick - this.lastClickTick <= DOUBLE_CLICK_UPDATES) {
          this.lastClickRow = -1;
          this.activate(pr.row, items);
        } else {
          this.lastClickRow = pr.row;
          this.lastClickTick = this.tick;
        }
      }
    } else if (!p.down) {
      this.press = null;
    }

    if (this.keyboard && n > 0) {
      const page = Math.max(1, Math.floor(r.h / rowH) - 1);
      if (input.pressed('ArrowUp')) this.choose(Math.max(0, this.selected - 1), items);
      else if (input.pressed('ArrowDown')) this.choose(Math.min(n - 1, this.selected + 1), items);
      else if (input.pressed('PageUp')) this.choose(Math.max(0, this.selected - page), items);
      else if (input.pressed('PageDown')) this.choose(Math.min(n - 1, this.selected + page), items);
      else if (input.pressed('Home')) this.choose(0, items);
      else if (input.pressed('End')) this.choose(n - 1, items);
      else if (input.confirm()) this.activate(this.selected, items);
    }

    m = this.metrics(n);
    this.target = Math.max(0, Math.min(m.max, this.target));
    const d = this.target - this.scroll;
    this.scroll = Math.abs(d) < 0.5 ? this.target : this.scroll + d * 0.35;
  }

  draw(ctx: Ctx): void {
    const items = this.opts.items();
    const n = items.length;
    const r = this.opts.rect, rowH = this.opts.rowH;
    const m = this.metrics(n);
    const s = Math.round(this.scroll);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, m.rowW, r.h);
    ctx.clip();
    const first = Math.max(0, Math.floor(s / rowH));
    const last = Math.min(n - 1, Math.floor((s + r.h) / rowH));
    for (let i = first; i <= last; i++) {
      const row: Rect = { x: r.x, y: r.y + i * rowH - s, w: m.rowW, h: rowH };
      this.opts.drawRow(ctx, items[i], row, i === this.selected, i === this.hovered);
    }
    ctx.restore();
    if (n === 0 && this.opts.empty) {
      drawWrapped(ctx, this.opts.empty, r.x + r.w / 2, r.y + Math.floor(r.h / 2) - 4, r.w - 16, { color: UI.textDim, shadow: false, align: 'center' });
    }
    if (m.bar) {
      const bx = m.barX;
      fillRoundRect(ctx, bx, r.y, SCROLLBAR_W, r.h, 2, tint(UI.panelDeep, -0.35));
      fillRoundRect(ctx, bx + 1, r.y + 1, SCROLLBAR_W - 2, r.h - 2, 1, tint(UI.panelDeep, -0.1));
      const thumb = this.thumbHover || (this.press?.kind === 'thumb') ? UI.woodLight : UI.wood;
      fillRoundRect(ctx, bx, m.thumbY, SCROLLBAR_W, m.thumbH, 2, UI.ink);
      fillRoundRect(ctx, bx + 1, m.thumbY + 1, SCROLLBAR_W - 2, m.thumbH - 2, 1, thumb);
      ctx.fillStyle = tint(thumb, 0.35);
      ctx.fillRect(bx + 1, m.thumbY + 2, 1, m.thumbH - 4);
      ctx.fillStyle = tint(thumb, -0.3);
      const gy = m.thumbY + Math.floor(m.thumbH / 2) - 2;
      ctx.fillRect(bx + 2, gy, 3, 1); ctx.fillRect(bx + 2, gy + 2, 3, 1); ctx.fillRect(bx + 2, gy + 4, 3, 1);
    }
  }
}
