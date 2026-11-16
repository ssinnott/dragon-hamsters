// Battle HUD drawing: the enemy and player boxes, the WEAK TO row, the always-on MATCHUP strip,
// team pips, the ability banner, the level-up card, the outro banner, and the faces of the menu
// buttons (moves, team cards, items). Pure drawing: the scene owns all state and passes it in.
import { drawText, measureText } from '../../lib/engine/text.ts';
import { getMove, getItem, getType } from '../../data/index.ts';
import type { ItemId, MoveDef, Stats, TypeId } from '../../data/schema.ts';
import type { MoveSlot } from '../../battle/types.ts';
import { weaknesses, typeEffectiveness } from '../../battle/matchup.ts';
import {
  UI, drawBar, drawEffectTag, drawHpBar, drawPanel, drawStars, drawStatusBadge, drawTypeBadge, drawTypeBadges,
  drawWrapped, effectStyle, fillRoundRect, textOn, tint, wrapText, type Rect,
} from '../widgets.ts';
import { drawItemIcon, drawTypeIcon } from '../icons.ts';
import { drawMon, xpFrac, type MonView } from './view.ts';

type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------------------------------------
// Layout (640 x 360)
// ---------------------------------------------------------------------------------------------

export const LAYOUT = {
  enemyGround: { x: 474, y: 150 },
  enemyPlatform: { x: 474, y: 152, w: 150 },
  playerGround: { x: 160, y: 236 },
  playerPlatform: { x: 160, y: 240, w: 190 },
  enemyBox: { x: 6, y: 6, w: 212, h: 50 },
  weakRow: { x: 6, y: 60 },
  strip: { x: 224, y: 6, w: 216, h: 50 },
  playerBox: { x: 376, y: 206, w: 258, h: 48 },
  /** Top of the bottom panel. */
  band: 260,
} as const;

/** Tallest the art may be on each side (px at battle scale, to the ear tips): big bosses are capped
 * so their hats stay clear of the MATCHUP strip, but still tower over their minions. */
const ENEMY_MAX_H = 98;
const BOSS_MAX_H = 112;
const PLAYER_MAX_H = 112;

export function battleScale(v: MonView): number {
  const max = v.side === 'enemy' ? (v.isBoss ? BOSS_MAX_H : ENEMY_MAX_H) : PLAYER_MAX_H;
  return Math.min(2, max / v.h1);
}

// Readable on the dark plum boxes.
export const GOOD = '#72e66c';
export const BAD = '#ff8a5c';
export const EVEN = '#ece6d6';
const NONE = '#a8a2b4';

export function multText(m: number): string {
  return 'X' + (Math.round(m * 100) / 100).toString();
}

// ---------------------------------------------------------------------------------------------
// Little pixel icons
// ---------------------------------------------------------------------------------------------

const CROWN = ['#...#...#', '##.###.##', '#########', '#########', '#.#.#.#.#'];

function drawMask(ctx: Ctx, mask: readonly string[], x: number, y: number, fill: string, outline: string): void {
  const on = (cx: number, cy: number): boolean => cy >= 0 && cy < mask.length && cx >= 0 && cx < mask[cy].length && mask[cy][cx] === '#';
  ctx.fillStyle = outline;
  for (let cy = -1; cy <= mask.length; cy++) {
    for (let cx = -1; cx <= (mask[0]?.length ?? 0); cx++) {
      if (on(cx, cy)) continue;
      if (on(cx - 1, cy) || on(cx + 1, cy) || on(cx, cy - 1) || on(cx, cy + 1)) ctx.fillRect(x + cx, y + cy, 1, 1);
    }
  }
  ctx.fillStyle = fill;
  for (let cy = 0; cy < mask.length; cy++) for (let cx = 0; cx < mask[cy].length; cx++) if (mask[cy][cx] === '#') ctx.fillRect(x + cx, y + cy, 1, 1);
}

/** A 9x5 gold crown (bosses). */
export function drawCrown(ctx: Ctx, x: number, y: number): void {
  drawMask(ctx, CROWN, x, y, UI.gold, UI.ink);
  ctx.fillStyle = UI.goldLight;
  ctx.fillRect(x + 1, y + 2, 2, 1);
  ctx.fillStyle = '#e04f45';
  ctx.fillRect(x + 4, y + 3, 1, 1);
}

/** Small arrow head pointing right (dir 1) or left (dir -1) with its tip at (x, y). */
function arrowHead(ctx: Ctx, x: number, y: number, dir: 1 | -1, color: string): void {
  for (let i = 0; i < 4; i++) {
    const h = 7 - i * 2;
    const px = x - dir * (3 - i);
    ctx.fillStyle = UI.ink;
    ctx.fillRect(px + 1, y - (h >> 1) + 1, 1, h);
    ctx.fillStyle = color;
    ctx.fillRect(px, y - (h >> 1), 1, h);
  }
}

/** A tiny pill with text, like a status badge (DIZZY, etc). Returns its width. */
export function drawPill(ctx: Ctx, text: string, x: number, y: number, fill: string, color = '#ffffff'): number {
  const w = measureText(text) + 8, h = 11;
  fillRoundRect(ctx, x, y, w, h, 3, UI.ink);
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 2, 2, tint(fill, -0.2));
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 3, 2, fill);
  ctx.fillStyle = tint(fill, 0.4);
  ctx.fillRect(x + 3, y + 1, w - 6, 1);
  drawText(ctx, text, x + 4, y + 2, { color, shadowColor: tint(fill, -0.5) });
  return w;
}

/** Team pips: one hamster-ball per member; fainted ones are grey, the active one ringed in gold. */
export function drawPips(ctx: Ctx, team: readonly MonView[], activeUid: string | null, x: number, y: number, side: 'player' | 'enemy'): number {
  const top = side === 'enemy' ? '#e0574a' : '#4f9be0';
  team.forEach((m, i) => {
    const px = x + i * 9;
    const ring = m.uid === activeUid && !m.fainted ? UI.gold : UI.ink;
    fillRoundRect(ctx, px, y, 7, 7, 3, ring);
    if (m.fainted) {
      fillRoundRect(ctx, px + 1, y + 1, 5, 5, 2, '#4a4258');
      ctx.fillStyle = '#7a7088';
      ctx.fillRect(px + 2, y + 2, 1, 1); ctx.fillRect(px + 4, y + 4, 1, 1); ctx.fillRect(px + 4, y + 2, 1, 1); ctx.fillRect(px + 2, y + 4, 1, 1);
      ctx.fillRect(px + 3, y + 3, 1, 1);
    } else {
      fillRoundRect(ctx, px + 1, y + 1, 5, 5, 2, '#fff6e4');
      ctx.fillStyle = m.status ? '#f39c3a' : top;
      ctx.fillRect(px + 2, y + 1, 3, 1); ctx.fillRect(px + 1, y + 2, 5, 1);
      ctx.fillStyle = UI.ink;
      ctx.fillRect(px + 1, y + 3, 5, 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px + 2, y + 2, 1, 1);
    }
  });
  return team.length * 9 - 2;
}

// ---------------------------------------------------------------------------------------------
// Info boxes
// ---------------------------------------------------------------------------------------------

/** The status badge with a little pop when it has just changed (bounce + white flash ring). */
function drawStatusPop(ctx: Ctx, v: MonView, x: number, y: number): number {
  let w = 0;
  if (v.status) {
    const a = v.statusAge;
    const bob = a < 0.3 ? -Math.round(Math.sin((a / 0.3) * Math.PI) * 3) : 0;
    w = drawStatusBadge(ctx, v.status, x, y + bob);
    if (a < 0.25) {
      ctx.save();
      ctx.globalAlpha = 1 - a / 0.25;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      const g = Math.round(2 + a * 16);
      ctx.strokeRect(x - g + 0.5, y + bob - g + 0.5, w + g * 2 - 1, 11 + g * 2 - 1);
      ctx.restore();
    }
    w += 3;
  }
  if (v.confused) w += drawPill(ctx, 'DIZZY', x + w, y, '#d6609e') + 3;
  return w;
}

function drawLevel(ctx: Ctx, level: number, right: number, y: number): number {
  const num = String(level);
  const nw = measureText(num);
  drawText(ctx, num, right - nw, y, { color: UI.textLight });
  drawText(ctx, 'LV', right - nw - 13, y, { color: UI.textLightDim });
  return nw + 13;
}

/** The enemy's box (top left). `slide` 0..1 brings it in from the left. */
export function drawEnemyBox(ctx: Ctx, v: MonView, team: readonly MonView[], activeUid: string | null, slide: number): void {
  const B = LAYOUT.enemyBox;
  const x = Math.round(B.x - (1 - slide) * (B.w + 12)), y = B.y;
  drawPanel(ctx, x, y, B.w, B.h, { fill: UI.night });
  let nx = x + 8;
  if (v.isBoss) { drawCrown(ctx, nx, y + 7); nx += 13; }
  drawText(ctx, v.name, nx, y + 6, { color: v.isBoss ? UI.goldLight : UI.textLight });
  const lvW = drawLevel(ctx, v.level, x + B.w - 8, y + 6);
  const pipsW = team.length * 9 - 2;
  const nameEnd = nx + measureText(v.name);
  const pipsX = x + B.w - 8 - lvW - 7 - pipsW;
  if (pipsX > nameEnd + 4) drawPips(ctx, team, activeUid, pipsX, y + 6, 'enemy');
  drawHpBar(ctx, x + 8, y + 17, B.w - 16, v.shownHp, v.maxHp, { boss: v.isBoss });
  const bw = drawTypeBadges(ctx, v.types, x + 8, y + 30);
  drawStatusPop(ctx, v, x + 8 + bw + 4, y + 31);
  if (pipsX <= nameEnd + 4) drawPips(ctx, team, activeUid, x + B.w - 8 - pipsW, y + 33, 'enemy');
}

/** The WEAK TO row under the enemy box: small badges, biggest multipliers first. */
export function drawWeakRow(ctx: Ctx, v: MonView, slide: number): void {
  const W = LAYOUT.weakRow;
  const weak = weaknesses(v.types).sort((a, b) => typeEffectiveness(b, v.types) - typeEffectiveness(a, v.types));
  const label = 'WEAK TO:';
  const lw = measureText(label);
  const badgeW = (t: TypeId): number => measureText(getType(t).name) + 17;
  let full = weak.reduce((s, t) => s + badgeW(t) + 2, 0) - 2;
  const maxW = 398 - (lw + 14);
  const iconsOnly = full > maxW;
  if (iconsOnly) full = weak.length * 13 - 2;
  const w = 6 + lw + 5 + Math.max(measureText('NOTHING!'), full) + 6;
  const x = Math.round(W.x - (1 - slide) * (w + 12)), y = W.y;
  fillRoundRect(ctx, x, y + 1, w, 17, 3, 'rgba(27, 20, 38, 0.25)');
  fillRoundRect(ctx, x, y, w, 16, 3, UI.ink);
  fillRoundRect(ctx, x + 1, y + 1, w - 2, 14, 2, UI.nightDark);
  ctx.fillStyle = UI.nightLight;
  ctx.fillRect(x + 3, y + 1, w - 6, 1);
  drawText(ctx, label, x + 6, y + 5, { color: UI.textLightDim });
  let bx = x + 6 + lw + 5;
  if (!weak.length) {
    drawText(ctx, 'NOTHING!', bx, y + 5, { color: UI.textLight });
    return;
  }
  for (const t of weak) {
    if (iconsOnly) { drawTypeIcon(ctx, t, bx + 5, y + 8, 5); bx += 13; continue; }
    const bw = drawTypeBadge(ctx, t, bx, y + 3, { small: true });
    if (typeEffectiveness(t, v.types) >= 4) {
      // a double weakness gets a gold spark in its corner
      ctx.fillStyle = UI.ink; ctx.fillRect(bx + bw - 3, y + 1, 4, 4);
      ctx.fillStyle = UI.gold; ctx.fillRect(bx + bw - 2, y + 2, 2, 2);
    }
    bx += bw + 2;
  }
}

/** The player's box (right, above the bottom panel). `slide` 0..1 brings it in from the right. */
export function drawPlayerBox(ctx: Ctx, v: MonView, team: readonly MonView[], activeUid: string | null, slide: number, t: number): void {
  const B = LAYOUT.playerBox;
  const x = Math.round(B.x + (1 - slide) * (B.w + 12)), y = B.y;
  drawPanel(ctx, x, y, B.w, B.h, { fill: UI.night });
  drawText(ctx, v.name, x + 8, y + 6, { color: UI.textLight });
  drawStatusPop(ctx, v, x + 8 + measureText(v.name) + 5, y + 4);
  drawLevel(ctx, v.level, x + B.w - 8, y + 6);
  const barW = 178;
  drawHpBar(ctx, x + 8, y + 17, barW, v.shownHp, v.maxHp);
  const hpNow = Math.max(0, Math.round(v.shownHp));
  const low = v.maxHp > 0 && v.hp / v.maxHp <= 0.2 && v.hp > 0;
  const blink = low && Math.floor(t * 3) % 2 === 0;
  const hpText = `${hpNow}/${v.maxHp}`;
  drawText(ctx, hpText, x + B.w - 8 - measureText(hpText), y + 18, { color: blink ? UI.hpRed : UI.textLight });
  drawText(ctx, 'XP', x + 8, y + 31, { color: UI.textLightDim });
  drawBar(ctx, x + 22, y + 32, barW - 14, 5, xpFrac(v), UI.info);
  drawPips(ctx, team, activeUid, x + B.w - 8 - (team.length * 9 - 2), y + 31, 'player');
}

// ---------------------------------------------------------------------------------------------
// The MATCHUP strip
// ---------------------------------------------------------------------------------------------

export interface Matchup {
  mine: TypeId[];
  theirs: TypeId[];
  /** Your best type multiplier on them, and theirs on you. */
  fwd: number;
  back: number;
}

export type Verdict = 'good' | 'bad' | 'even';

export function verdictOf(m: Matchup): Verdict {
  return m.fwd > m.back ? 'good' : m.fwd < m.back ? 'bad' : 'even';
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  good: 'YOU HAVE THE TYPE ADVANTAGE!',
  bad: 'CAREFUL - THEY HAVE THE ADVANTAGE!',
  even: 'EVEN MATCH',
};

const VERDICT_COLOR: Record<Verdict, string> = { good: GOOD, bad: BAD, even: EVEN };

/** Colour of a multiplier from YOUR point of view (`yours`: you attack; otherwise they do). */
function multColor(m: number, yours: boolean): string {
  if (m === 1) return EVEN;
  if (m === 0) return yours ? NONE : GOOD;
  return (m > 1) === yours ? GOOD : BAD;
}

/**
 * The rock-paper-scissors strip: your types -> X2 -> their types, the reverse arrow, and a verdict.
 * `pulse` (1 -> 0) animates a change: icons hop, the frame flashes in the verdict colour.
 */
export function drawMatchup(ctx: Ctx, m: Matchup | null, pulse: number, appear: number, t: number): void {
  const S = LAYOUT.strip;
  const x = S.x, y = Math.round(S.y - (1 - appear) * (S.h + 12));
  const verdict = m ? verdictOf(m) : 'even';
  const vc = VERDICT_COLOR[verdict];
  const flash = pulse > 0 && Math.floor(pulse * 10) % 2 === 1;
  drawPanel(ctx, x, y, S.w, S.h, { fill: UI.night, border: flash ? vc : UI.ink });
  drawText(ctx, 'YOU', x + 8, y + 5, { color: UI.textLightDim });
  drawText(ctx, 'MATCHUP', x + S.w / 2, y + 5, { color: UI.textLightDim, align: 'center' });
  drawText(ctx, 'FOE', x + S.w - 8, y + 5, { color: UI.textLightDim, align: 'right' });
  if (!m) return;
  const hop = (i: number): number => (pulse > 0 ? -Math.round(Math.abs(Math.sin((1 - pulse) * Math.PI * 3 + i)) * 3 * pulse) : 0);
  const icons = (types: readonly TypeId[], fromX: number, dir: 1 | -1): void => {
    types.forEach((ty, i) => drawTypeIcon(ctx, ty, fromX + dir * i * 15, y + 22 + hop(i), 6));
  };
  icons(m.mine, x + 14, 1);
  icons(m.theirs, x + S.w - 14, -1);
  const ax0 = x + 14 + 15 * Math.max(1, m.mine.length) - 4;
  const ax1 = x + S.w - 14 - 15 * Math.max(1, m.theirs.length) + 4;
  const arrow = (mult: number, ay: number, dir: 1 | -1, yours: boolean): void => {
    const col = multColor(mult, yours);
    const label = multText(mult);
    const lw = measureText(label);
    const mid = Math.round((ax0 + ax1) / 2);
    const lx = mid - Math.ceil(lw / 2);
    drawText(ctx, label, lx, ay - 3, { color: col });
    const seg = (a: number, b: number): void => {
      if (b <= a) return;
      ctx.fillStyle = UI.ink; ctx.fillRect(a + 1, ay + 1, b - a, 1);
      ctx.fillStyle = col; ctx.fillRect(a, ay, b - a, 1);
    };
    const wig = pulse > 0 ? Math.round(Math.sin(t * 30) * pulse * 2) : 0;
    if (dir === 1) {
      seg(ax0, lx - 3);
      seg(lx + lw + 3, ax1 - 1 + wig);
      arrowHead(ctx, ax1 + wig, ay, 1, col);
    } else {
      seg(ax0 + 1 - wig, lx - 3);
      seg(lx + lw + 3, ax1);
      arrowHead(ctx, ax0 - wig, ay, -1, col);
    }
    // a spark runs along the arrow now and then, so the direction of the hit reads at a glance
    const k = ((t * 0.7 + (dir === 1 ? 0 : 0.55)) % 1.6) / 1.2;
    if (k < 1) {
      const span = ax1 - ax0 - 6;
      const sx = Math.round(dir === 1 ? ax0 + span * k : ax1 - span * k);
      if (sx < lx - 4 || sx > lx + lw + 2) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx, ay, 3, 1);
        ctx.fillStyle = tint(col, 0.5);
        ctx.fillRect(sx - dir * 2, ay, 2, 1);
      }
    }
  };
  arrow(m.fwd, y + 18, 1, true);
  arrow(m.back, y + 29, -1, false);
  const vy = y + 38;
  const text = VERDICT_TEXT[verdict];
  drawText(ctx, text, x + Math.floor(S.w / 2), vy - (pulse > 0.6 ? Math.round((pulse - 0.6) * 7) : 0), { color: vc, align: 'center' });
}

// ---------------------------------------------------------------------------------------------
// Banners and cards
// ---------------------------------------------------------------------------------------------

/** "<NAME>'S <ABILITY>" sliding in beside its owner. `u` is 0..1 through its life. */
export function drawAbilityBanner(ctx: Ctx, text: string, side: 'player' | 'enemy', u: number): void {
  const w = measureText(text) + 26, h = 17;
  const k = u < 0.15 ? 1 - Math.pow(1 - u / 0.15, 3) : u > 0.85 ? 1 - (u - 0.85) / 0.15 : 1;
  const y = side === 'enemy' ? 82 : 184;
  const x = side === 'enemy' ? Math.round(6 - (1 - k) * (w + 20)) : Math.round(634 - w + (1 - k) * (w + 20));
  const fill = side === 'enemy' ? '#b8453c' : '#3f78c4';
  fillRoundRect(ctx, x + 1, y + 2, w, h, 3, 'rgba(27, 20, 38, 0.3)');
  fillRoundRect(ctx, x, y, w, h, 3, UI.ink);
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 2, 2, tint(fill, -0.25));
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 3, 2, fill);
  ctx.fillStyle = tint(fill, 0.35);
  ctx.fillRect(x + 3, y + 1, w - 6, 1);
  // a little star on each end
  for (const sx of [x + 6, x + w - 9]) {
    ctx.fillStyle = UI.goldLight;
    ctx.fillRect(sx + 1, y + 5, 1, 5); ctx.fillRect(sx, y + 7, 3, 1);
  }
  drawText(ctx, text, x + 13, y + 5, { color: '#ffffff', shadowColor: tint(fill, -0.55) });
}

const STAT_SHORT: [keyof Stats, string][] = [['hp', 'HP'], ['atk', 'ATK'], ['def', 'DEF'], ['spa', 'SP.ATK'], ['spd', 'SP.DEF'], ['spe', 'SPEED']];

/** The LEVEL UP! card with each stat's increase. `u` 0..1 through its life (pops in, fades out). */
export function drawLevelCard(ctx: Ctx, name: string, level: number, gains: Stats, u: number, t: number): void {
  const w = 252, h = 78;
  const x = Math.round(320 - w / 2);
  const k = u < 0.12 ? 1 - Math.pow(1 - u / 0.12, 3) : 1;
  const y = Math.round(92 + (1 - k) * 20);
  ctx.save();
  if (u > 0.88) ctx.globalAlpha = Math.max(0, 1 - (u - 0.88) / 0.12);
  drawPanel(ctx, x, y, w, h, { fill: UI.night, border: UI.ink });
  ctx.fillStyle = UI.gold;
  ctx.fillRect(x + 4, y + 3, w - 8, 1);
  const title = 'LEVEL UP!';
  const bounce = Math.round(Math.sin(t * 9) * 1.5);
  drawText(ctx, title, 320, y + 7 + bounce, { size: 2, color: UI.gold, align: 'center', shadowColor: UI.goldDark });
  drawText(ctx, `${name} IS NOW LV ${level}!`, 320, y + 26, { color: UI.textLight, align: 'center' });
  STAT_SHORT.forEach(([k2, label], i) => {
    const cx = x + 14 + (i % 3) * 80;
    const cy = y + 42 + Math.floor(i / 3) * 14;
    drawText(ctx, label, cx, cy, { color: UI.textLightDim });
    const g = gains[k2];
    drawText(ctx, (g >= 0 ? '+' : '') + g, cx + measureText(label) + 5, cy, { color: g > 0 ? GOOD : EVEN });
  });
  ctx.restore();
}

/** The big end-of-battle banner. */
export function drawOutroBanner(ctx: Ctx, text: string, color: string, u: number, t: number): void {
  const k = Math.min(1, u / 0.18);
  const ease = 1 - Math.pow(1 - k, 3);
  const tw = measureText(text, 2);
  const w = tw + 48, h = 34;
  const x = Math.round(320 - w / 2);
  const y = Math.round(96 - (1 - ease) * 40);
  ctx.save();
  ctx.globalAlpha = ease;
  fillRoundRect(ctx, x + 2, y + 3, w, h, 5, 'rgba(27, 20, 38, 0.35)');
  fillRoundRect(ctx, x, y, w, h, 5, UI.ink);
  fillRoundRect(ctx, x + 2, y + 2, w - 4, h - 4, 4, tint(color, -0.35));
  fillRoundRect(ctx, x + 2, y + 2, w - 4, h - 6, 4, color);
  ctx.fillStyle = tint(color, 0.45);
  ctx.fillRect(x + 6, y + 2, w - 12, 1);
  drawText(ctx, text, 320, y + 10, { size: 2, color: '#ffffff', align: 'center', shadowColor: tint(color, -0.6) });
  // twinkles around the banner
  for (let i = 0; i < 6; i++) {
    const a = t * 0.9 + i * 1.05;
    const sx = Math.round(320 + Math.cos(a) * (w / 2) * 1.42);
    const sy = Math.round(y + h / 2 + Math.sin(a) * ((h / 2) * 1.42 + 4));
    const on = Math.floor(t * 6 + i) % 3 !== 0;
    if (!on) continue;
    ctx.fillStyle = UI.goldLight;
    ctx.fillRect(sx, sy - 2, 1, 5); ctx.fillRect(sx - 2, sy, 5, 1);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Menu button faces (drawn through ButtonSpec.decorate so they sink with the press)
// ---------------------------------------------------------------------------------------------

function dimOn(face: string, text: string): string {
  return text === UI.text ? tint(face, -0.62) : tint(face, 0.68);
}

export function smallBadgeWidth(t: TypeId): number {
  return measureText(getType(t).name) + 17;
}

function effectTagWidth(mult: number): number {
  return measureText(effectStyle(mult).text) + 8;
}

export function isDamagingMove(m: MoveDef): boolean {
  return m.power > 0 || m.effects.some((e) => e.kind === 'fixed');
}

export function powerText(m: MoveDef): string {
  if (m.effects.some((e) => e.kind === 'fixed')) return 'POW -';
  return m.power > 0 ? `POW ${m.power}` : 'STATUS';
}

/** A move button: name, small type badge, PP, power, and the effectiveness tag vs the foe. */
export function drawMoveFace(ctx: Ctx, face: Rect, enabled: boolean, slot: MoveSlot, foeTypes: readonly TypeId[], hotkey: string): void {
  const mv = getMove(slot.id);
  const base = enabled ? getType(mv.type).color : UI.disabled;
  const col = enabled ? textOn(base) : UI.disabledText;
  const dim = enabled ? dimOn(base, col) : UI.disabledText;
  const sh = col === UI.text ? tint(base, 0.4) : tint(base, -0.5);
  drawText(ctx, hotkey, face.x + 5, face.y + 5, { color: dim, shadow: false });
  drawText(ctx, mv.name.toUpperCase(), face.x + 14, face.y + 5, { color: col, shadowColor: sh, shadow: enabled });
  ctx.save();
  if (!enabled) ctx.globalAlpha = 0.55;
  drawTypeBadge(ctx, mv.type, face.x + face.w - 4 - smallBadgeWidth(mv.type), face.y + 3, { small: true });
  ctx.restore();
  const ppLow = slot.pp <= Math.max(1, Math.floor(slot.maxPp / 4));
  const pp = `PP ${slot.pp}/${slot.maxPp}`;
  drawText(ctx, pp, face.x + 14, face.y + 22, { color: enabled && ppLow ? col : dim, shadow: false });
  drawText(ctx, powerText(mv), face.x + 14 + measureText(pp) + 8, face.y + 22, { color: dim, shadow: false });
  if (enabled && isDamagingMove(mv)) {
    const mult = typeEffectiveness(mv.type, foeTypes);
    drawEffectTag(ctx, mult, face.x + face.w - 4 - effectTagWidth(mult), face.y + face.h - 15, { small: true });
  }
}

/** The info strip for the focused move (category, power, accuracy, priority, description). */
export function drawMoveInfo(ctx: Ctx, r: Rect, slot: MoveSlot | null, noPp: boolean): void {
  drawPanel(ctx, r.x, r.y, r.w, r.h, { fill: UI.panelLight });
  const x = r.x + 8, w = r.w - 16;
  if (noPp) {
    drawText(ctx, 'OUT OF PP!', x, r.y + 7, { color: UI.bad, shadow: false });
    drawWrapped(ctx, 'Every move is used up. Any button makes it wiggle desperately (it hurts itself a bit).', x, r.y + 20, w, { color: UI.text, shadow: false });
    return;
  }
  if (!slot) {
    drawText(ctx, 'BACK', x, r.y + 7, { color: UI.text, shadow: false });
    drawWrapped(ctx, 'Back to the battle menu.', x, r.y + 20, w, { color: UI.textDim, shadow: false });
    return;
  }
  const mv = getMove(slot.id);
  drawText(ctx, mv.name.toUpperCase(), x, r.y + 7, { color: UI.text, shadow: false });
  if (mv.priority !== 0) {
    const p = `PRI ${mv.priority > 0 ? '+' : ''}${mv.priority}`;
    drawText(ctx, p, r.x + r.w - 8 - measureText(p), r.y + 7, { color: mv.priority > 0 ? UI.accent : UI.textDim, shadow: false });
  }
  const catFill = mv.category === 'physical' ? '#e0703a' : mv.category === 'special' ? '#4f7fe0' : '#8d7f92';
  let px = x + drawPill(ctx, mv.category.toUpperCase(), x, r.y + 18, catFill) + 6;
  if (mv.category !== 'status') {
    drawText(ctx, powerText(mv), px, r.y + 20, { color: UI.text, shadow: false });
    px += measureText(powerText(mv)) + 8;
  }
  const sure = mv.target === 'self' || mv.effects.some((e) => e.kind === 'sureHit');
  drawText(ctx, sure ? 'ACC -' : `ACC ${mv.accuracy}%`, px, r.y + 20, { color: UI.text, shadow: false });
  const lines = wrapText(mv.description, w).slice(0, 3);
  lines.forEach((l, i) => drawText(ctx, l, x, r.y + 33 + i * 10, { color: UI.textDim, shadow: false }));
}

/** Matchup grade words under the stars. */
const GRADE_TEXT: Record<1 | 2 | 3, [string, string]> = {
  3: ['GREAT MATCHUP!', '#2f9a3a'],
  2: ['EVEN MATCHUP', UI.textDim],
  1: ['BAD MATCHUP', '#c4561e'],
};

/** A team card (SWAP menu and item targets): mini sprite, name, LV, HP, status, then a grade or a reason. */
export function drawTeamCard(
  ctx: Ctx, face: Rect, enabled: boolean, v: MonView,
  opts: { grade: 1 | 2 | 3 | null; reason: string | null; best: boolean; hotkey: string; t: number },
): void {
  const x = face.x, y = face.y;
  const col = enabled ? UI.text : UI.disabledText;
  const dim = enabled ? UI.textDim : UI.disabledText;
  // the sprite in a little round window
  const wx = x + 4, wy = y + 5, ww = 42, wh = 46;
  fillRoundRect(ctx, wx, wy, ww, wh, 3, enabled ? tint(UI.panelDeep, -0.2) : tint(UI.disabled, -0.25));
  fillRoundRect(ctx, wx + 1, wy + 1, ww - 2, wh - 2, 2, enabled ? '#e9d6ae' : tint(UI.disabled, 0.15));
  ctx.save();
  ctx.beginPath(); ctx.rect(wx + 1, wy + 1, ww - 2, wh - 2); ctx.clip();
  const s = Math.min(0.8, 36 / v.h1);
  drawMon(ctx, v, wx + ww / 2, wy + wh - 5, {
    scale: s, facing: 1, t: opts.t, pose: v.fainted ? 'sleep' : 'idle', alpha: enabled || !v.fainted ? 1 : 0.55,
  });
  ctx.restore();
  drawText(ctx, opts.hotkey, x + face.w - 10, y + 4, { color: dim, shadow: false });
  const tx = x + 52;
  drawText(ctx, v.name, tx, y + 5, { color: col, shadow: false });
  drawText(ctx, 'LV' + v.level, tx, y + 16, { color: dim, shadow: false });
  let sx = tx + measureText('LV' + v.level) + 5;
  if (v.status && v.hp > 0) sx += drawStatusBadge(ctx, v.status, sx, y + 14) + 3;
  const bw = face.w - 52 - 6;
  drawHpBar(ctx, tx, y + 28, bw, v.hp, v.maxHp);
  const hpText = `HP ${v.hp}/${v.maxHp}`;
  drawText(ctx, hpText, tx, y + 40, { color: v.hp <= 0 ? UI.bad : dim, shadow: false });
  const by = y + face.h - 16;
  if (opts.grade && (!opts.reason || v.hp > 0)) {
    drawStars(ctx, opts.grade, 3, x + 6, by);
  }
  const msgX = x + 6 + (opts.grade && (!opts.reason || v.hp > 0) ? 36 : 0);
  if (opts.reason) {
    drawText(ctx, opts.reason, msgX, by + 1, { color: enabled ? UI.textDim : '#9a6a52', shadow: false });
  } else if (opts.grade) {
    const [txt, c] = opts.best && opts.grade === 3 ? ['BEST COUNTER!', '#2f9a3a'] : GRADE_TEXT[opts.grade];
    drawText(ctx, txt, msgX, by + 1, { color: c, shadow: false });
  }
}

/** An item button face: icon, name, count. */
export function drawItemFace(ctx: Ctx, face: Rect, enabled: boolean, item: ItemId, count: number): void {
  const def = getItem(item);
  const col = enabled ? UI.text : UI.disabledText;
  ctx.save();
  if (!enabled) ctx.globalAlpha = 0.5;
  drawItemIcon(ctx, item, face.x + 12, face.y + Math.floor(face.h / 2), 14);
  ctx.restore();
  drawText(ctx, def.name.toUpperCase(), face.x + 23, face.y + Math.floor((face.h - 7) / 2), { color: col, shadow: false });
  const c = 'X' + count;
  drawText(ctx, c, face.x + face.w - 6 - measureText(c), face.y + Math.floor((face.h - 7) / 2), { color: enabled ? UI.accent : UI.disabledText, shadow: false });
}

