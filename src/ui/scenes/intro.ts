// The new-game intro: Chief Nibbles' welcome in the Burrow, the starter pick around the
// FIRE > LEAF > WATER > FIRE triangle, and the Chief's reaction to the pair you chose.
//
// Phases:
//   talk   the Chief briefs you (Enter / Space / click advances; Escape skips the briefing)
//   pick   three starters on pedestals at the corners of the type triangle; pick two
//   react  the Chief sizes up your pair and hands you the first case, then nav.burrow()
//
// entering the scene puts a fresh newGame() into app.state (keeping the sound settings). Nothing is
// saved until the pick is confirmed, so backing out to the title leaves an old save untouched.
import { app } from '../app.ts';
import type { Scene } from '../scene.ts';
import type { Input } from '../input.ts';
import { drawText, drawTextOutlined, measureText } from '../../lib/engine/text.ts';
import {
  Button, ButtonGroup, Typewriter, UI, VIEW_H, VIEW_W, drawBar, drawInset, drawMessageBox, drawPanel,
  drawTypeBadge, fillRoundRect, tint, wrapText, type Rect,
} from '../widgets.ts';
import { drawActivityIcon, drawFoodIcon, drawOrgEmblem, drawTypeIcon } from '../icons.ts';
import { drawBurrow } from '../../art/backdrops.ts';
import { drawDragon, dragonHeight, type Pose } from '../../art/dragon.ts';
import { drawVillain } from '../../art/villain.ts';
import { createFx } from '../../art/fx.ts';
import { ORGS, STARTERS, TYPES, effectiveness, getSpecies, getVillain } from '../../data/index.ts';
import { ACTIVITY_IDS, FOOD_IDS, ORG_IDS, STAT_IDS, type SpeciesDef, type StatId, type TypeId } from '../../data/schema.ts';
import { newGame } from '../../game/state.ts';
import { freshSeed } from '../../game/rng.ts';
import { addDragon, createDragon, markSeen } from '../../game/dragons.ts';
import { music, sfx } from '../../audio/index.ts';
import { drawChief } from '../chief.ts';

type Ctx = CanvasRenderingContext2D;

const STARTER_LEVEL = 5;
const LINE_STEP = 10;


const easeOut = (u: number): number => 1 - (1 - u) * (1 - u) * (1 - u);
const clamp01 = (u: number): number => Math.max(0, Math.min(1, u));

// ---------------------------------------------------------------------------------------------
// The Chief's lines
// ---------------------------------------------------------------------------------------------

interface Line {
  text: string;
  /** The Chief's pose while saying it ('attack' plays once as a lunge). */
  pose?: Pose;
  /** An illustration beside the Chief: the WANTED poster, a dragon in a teacup, the duties list. */
  picture?: Picture;
}

type Picture = 'poster' | 'teacup' | 'duties';

const BRIEFING: Line[] = [
  { text: 'Ah, there you are! Welcome to the Secret Burrow, hidden headquarters of the Dragon Hamster Agency. Mind the sunflower seeds.' },
  { text: "I'm Chief Nibbles. Retired field agent, part-time napper. The eye patch? Lost a staring contest with a pigeon. Never again." },
  { text: 'Dragon hamsters are rare and wonderful: fluffy as a muffin, brave as a lion, and they fit in a teacup. Most of the time.', pose: 'happy', picture: 'teacup' },
  { text: 'But trouble is brewing! Five villain gangs are on the loose: mice, crows, snakes, cats and ferrets in very suspicious hats.', pose: 'attack', picture: 'poster' },
  { text: 'Your job: look after a burrow of dragon hamsters, keep them fed and happy, and send them on secret missions to stop those rascals.', picture: 'duties' },
  { text: "Every agent starts with two partners. Come and meet the candidates, they've been practising their best poses all morning!", pose: 'happy' },
];

/** The Chief's first reaction, keyed by the chosen pair's types (sorted, joined with '+'). */
const PAIR_JOKES: Record<string, string> = {
  'FIRE+LEAF': '{FIRE} and {LEAF}! A little campfire and a little garden. Just keep the sneezing away from the leaves, please.',
  'FIRE+WATER': '{FIRE} and {WATER}! One lights the campfire and the other puts it out. Very responsible camping.',
  'LEAF+WATER': '{LEAF} and {WATER}! A garden with its very own sprinkler. Expect lots of growing, and possibly a rainbow.',
};

function typeName(t: TypeId): string {
  return TYPES[t]?.name ?? t;
}

/** The first villain organisation's boss, for the case tease. */
function firstBossName(): string {
  try {
    const first = Object.values(ORGS).sort((a, b) => a.order - b.order)[0];
    return first ? getVillain(first.boss).name : 'The Big Cheese';
  } catch {
    return 'The Big Cheese';
  }
}

/** The Chief's lines after the pick: a joke about the pair, how they cover each other, the first case. */
function reactionLines(a: SpeciesDef, b: SpeciesDef, all: SpeciesDef[]): Line[] {
  const ta = a.types[0], tb = b.types[0];
  const key = [ta, tb].sort().join('+');
  let joke = PAIR_JOKES[key] ?? '{A} and {B}! What a team. I can already hear the villains packing their suitcases.';
  joke = joke.replace('{A}', a.name).replace('{B}', b.name);
  for (const s of [a, b]) joke = joke.split('{' + s.types[0] + '}').join(s.name);

  // Coverage inside the starter triangle: what each beats, and what neither of them beats.
  const triangle = all.map((s) => s.types[0]);
  const beats = (t: TypeId): TypeId | undefined => triangle.find((o) => o !== t && effectiveness(t, [o]) > 1);
  const ba = beats(ta), bb = beats(tb);
  const gap = triangle.find((o) => effectiveness(ta, [o]) <= 1 && effectiveness(tb, [o]) <= 1);
  let tip: string;
  if (ba && bb && gap) {
    tip = `${a.name} beats ${typeName(ba)} and ${b.name} beats ${typeName(bb)}, so they've got each other's backs. ` +
      `Nobody here beats ${typeName(gap)} though, so watch out for those!`;
  } else {
    tip = 'Remember the triangle: every type beats one type and loses to another. Bring the right partner for the job!';
  }
  return [
    { text: joke, pose: 'happy' },
    { text: tip },
    { text: 'Now, to business. Last night somebody pinched the dinosaur egg from the Natural History Museum!', pose: 'attack' },
    { text: `Every crumb at the scene points to ${firstBossName()}. When you're ready, check the MISSIONS board in the Burrow. Squeak you later, agent!`, pose: 'happy' },
  ];
}

// ---------------------------------------------------------------------------------------------
// The Chief's message box (the intro stages its own talk so the Burrow stays bright behind him)
// ---------------------------------------------------------------------------------------------

class Talk {
  lines: Line[] = [];
  index = 0;
  tw: Typewriter;
  /** Seconds since the current line started. */
  lineAge = 0;
  active = false;
  private onDone: (() => void) | null = null;
  private blips = 0;

  constructor() {
    const fast = app.state?.settings?.fastText !== false;
    this.tw = new Typewriter(fast ? 72 : 42);
    this.tw.onChar = () => {
      this.blips++;
      if (this.blips % 3 === 0) sfx('click', { volume: 0.22, pitch: 0.62 });
    };
  }

  start(lines: Line[], onDone: () => void): void {
    this.lines = lines;
    this.index = 0;
    this.onDone = onDone;
    this.active = true;
    this.lineAge = 0;
    this.tw.set(lines[0]?.text ?? '');
  }

  get line(): Line | undefined { return this.lines[this.index]; }

  /** Finish everything now (Escape). */
  skip(): void {
    if (!this.active) return;
    this.active = false;
    this.onDone?.();
  }

  update(dt: number, input: Input): void {
    if (!this.active) return;
    this.tw.update(dt);
    this.lineAge += dt;
    if (input.confirm() || input.pointer.pressed) {
      if (!this.tw.done) { this.tw.skip(); return; }
      if (this.index < this.lines.length - 1) {
        this.index++;
        this.lineAge = 0;
        this.tw.set(this.lines[this.index].text);
        sfx('select', { volume: 0.5 });
      } else {
        sfx('click');
        this.active = false;
        this.onDone?.();
      }
    }
  }

  /** Box height that fits the longest line. */
  boxH(textW: number): number {
    const n = Math.max(1, ...this.lines.map((l) => wrapText(l.text, textW, 1).length));
    return Math.max(52, n * LINE_STEP - 3 + 30);
  }

  draw(ctx: Ctx, t: number, slide: number): void {
    const x = 12, w = VIEW_W - 24;
    // the message box's text column: drawMessageBox wraps in w - 32 - indent
    const textX = x + 16, textW = w - 36;
    const h = this.boxH(textW);
    const y = VIEW_H - 12 - h + slide;
    drawMessageBox(ctx, x, y, w, h, this.tw, { arrow: false, size: 1, indent: textX - x - 12, name: 'CHIEF NIBBLES' });
    const n = this.lines.length;
    if (n > 1) {
      const pipW = 4, gap = 3, total = n * pipW + (n - 1) * gap;
      let px = Math.round(x + w / 2 - total / 2);
      for (let i = 0; i < n; i++) {
        fillRoundRect(ctx, px, y + h - 9, pipW, 3, 1, i <= this.index ? UI.accent : tint(UI.panelDark, -0.05));
        px += pipW + gap;
      }
    }
    if (this.tw.done && Math.floor(t * 2.5) % 2 === 0) {
      const last = this.index === n - 1;
      drawText(ctx, last ? '★' : '▶', x + w - 18, y + h - 16, { color: UI.accent, shadowColor: tint(UI.accent, -0.55) });
    }
    // the skip hint, on a small dark chip above the box's right end
    const hint = 'ESC: SKIP';
    const hw = measureText(hint) + 10;
    fillRoundRect(ctx, x + w - hw - 4, y - 15, hw, 12, 3, 'rgba(27, 20, 38, 0.7)');
    drawText(ctx, hint, x + w - hw + 1, y - 13, { color: UI.textLightDim, shadowColor: UI.ink });
  }

  /** Top of the box (for staging things above it). */
  top(): number {
    return VIEW_H - 12 - this.boxH(VIEW_W - 64);
  }
}

// ---------------------------------------------------------------------------------------------
// Starter-pick layout
// ---------------------------------------------------------------------------------------------

/** Ground points of the three pedestals: top, bottom-right, bottom-left (clockwise). */
const SPOTS = [{ x: 166, y: 106 }, { x: 266, y: 246 }, { x: 66, y: 246 }];
const CENTROID = { x: 166, y: 199 };
const PED_RX = 30;
const STARTER_SCALE = 1.6;

const CARD: Rect = { x: 340, y: 40, w: 290, h: 214 };
const CONFIRM_RECT: Rect = { x: 340, y: 266, w: 290, h: 30 };
const HINT_Y = 312;
const STAT_SHORT: Record<StatId, string> = { hp: 'HP', atk: 'ATTACK', def: 'DEFENSE', spa: 'SP. ATK', spd: 'SP. DEF', spe: 'SPEED' };
const STAT_COLOR: Record<StatId, string> = {
  hp: '#5fd35a', atk: '#f2843a', def: '#f6c63c', spa: '#5aa8f0', spd: '#8ad0a0', spe: '#f070a8',
};
const STAT_MAX = 100;
const HINT = "EACH ONE BEATS ONE TYPE AND LOSES TO ANOTHER. PICK TWO - THEY'LL COVER EACH OTHER!";

/** First sentences of a backstory that fit two lines of `width`; cut at a word with '...' if needed. */
function excerpt(text: string, width: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [text];
  let best = '';
  for (const s of sentences) {
    const next = best ? best + ' ' + s : s;
    if (wrapText(next, width).length <= 2) best = next; else break;
  }
  if (best) return wrapText(best, width);
  const words = sentences[0].split(' ');
  let cut = '';
  for (const w of words) {
    const next = cut ? cut + ' ' + w : w;
    if (wrapText(next + '...', width).length <= 2) cut = next; else break;
  }
  return wrapText(cut + '...', width);
}

// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

type Phase = 'talk' | 'pick' | 'react' | 'leaving';

export function createIntroScene(): Scene {
  const species = STARTERS.map((id) => getSpecies(id));
  const types = species.map((s) => s.types[0]);
  const talk = new Talk();
  const fx = createFx();
  let phase: Phase = 'talk';
  let phaseAge = 0;
  let age = 0;

  // pick state
  const picked: number[] = [];
  let shown = 0;
  let hintFlash = 0;
  let hintText = HINT;
  const wobble = [0, 0, 0];
  const pickAge = [0, 0, 0];
  let chosen: SpeciesDef[] = [];

  const group = new ButtonGroup();
  const starterBtns: Button[] = species.map((s, i) => {
    const h = dragonHeight(s.visual, STARTER_SCALE);
    const spot = SPOTS[i];
    return group.add({
      label: '',
      rect: { x: spot.x - PED_RX - 4, y: Math.round(spot.y - h - 14), w: PED_RX * 2 + 8, h: Math.round(h + 34) },
      hotkey: String(i + 1),
      onClick: () => togglePick(i),
    });
  });
  const confirmBtn = group.add({
    get label() {
      const n = picked.length;
      return n >= 2 ? "THESE TWO, PLEASE!" : n === 1 ? 'PICK ONE MORE' : 'PICK TWO';
    },
    size: 2,
    color: UI.accent,
    rect: CONFIRM_RECT,
    enabled: () => picked.length === 2,
    onClick: () => askConfirm(),
  });
  group.focus = 0;

  function setPhase(p: Phase): void {
    phase = p;
    phaseAge = 0;
  }

  function flashHint(text: string): void {
    hintText = text;
    hintFlash = 2.2;
  }

  function togglePick(i: number): void {
    shown = i;
    const at = picked.indexOf(i);
    const spot = SPOTS[i];
    const h = dragonHeight(species[i].visual, STARTER_SCALE);
    if (at >= 0) {
      picked.splice(at, 1);
      sfx('back');
      flashHint(`${species[i].name.toUpperCase()} HOPS BACK DOWN. NO HARD FEELINGS!`);
    } else if (picked.length >= 2) {
      sfx('error');
      wobble[i] = 0.5;
      flashHint('TWO IS THE LIMIT! UNPICK ONE FIRST: PICK IT AGAIN, OR PRESS ESC.');
    } else {
      picked.push(i);
      pickAge[i] = 0;
      sfx('select');
      sfx('sparkle', { volume: 0.5, delay: 0.05 });
      fx.burst(spot.x, spot.y - h * 0.5, TYPES[types[i]]?.color ?? UI.gold, 14);
      if (picked.length === 2) {
        flashHint(`${species[picked[0]].name.toUpperCase()} AND ${species[picked[1]].name.toUpperCase()}! PRESS THE BIG BUTTON WHEN YOU'RE SURE.`);
        group.focus = group.buttons.indexOf(confirmBtn);
      } else {
        flashHint(`${species[i].name.toUpperCase()} IS IN! PICK ONE MORE.`);
      }
    }
  }

  function askConfirm(): void {
    if (picked.length !== 2) return;
    sfx('click');
    const [a, b] = picked.map((i) => species[i].name);
    app.nav.confirm(`TAKE ${a.toUpperCase()} AND ${b.toUpperCase()} AS YOUR PARTNERS? THE THIRD ONE WILL BE FINE, IT HAS A BIG NAP PLANNED.`, () => commit());
  }

  /** Create both dragons, record the third as seen, and save the new world. */
  function commit(): void {
    const s = app.state;
    const ids: string[] = [];
    for (const i of picked) {
      const d = createDragon(s, species[i].id, STARTER_LEVEL);
      addDragon(s, d);
      ids.push(d.id);
    }
    species.forEach((sp, i) => { if (!picked.includes(i)) markSeen(s, sp.id); });
    s.squad = ids;
    s.flags.introDone = true;
    app.save();
    chosen = picked.map((i) => species[i]);
    sfx('victory');
    for (let k = 0; k < 3; k++) fx.burst(380 + k * 70, 150, [UI.gold, UI.accent, '#7fd4f0'][k], 18);
    setPhase('react');
    talk.start(reactionLines(chosen[0], chosen[1], species), () => leave());
  }

  function leave(): void {
    if (phase === 'leaving') return;
    setPhase('leaving');
    app.nav.burrow();
  }

  function startPick(): void {
    setPhase('pick');
    sfx('sparkle');
    group.focus = 0;
  }

  // ---- drawing -------------------------------------------------------------------------------

  function drawBriefingStage(ctx: Ctx, t: number): void {
    drawBurrow(ctx, t);
    // a soft vignette so the Chief and the box read clearly over the busy burrow
    const g = ctx.createRadialGradient(VIEW_W / 2, 150, 120, VIEW_W / 2, 150, 420);
    g.addColorStop(0, 'rgba(27, 20, 38, 0)');
    g.addColorStop(1, 'rgba(27, 20, 38, 0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  function chiefPose(): { pose: Pose; poseT: number } {
    const line = talk.line;
    const pose = line?.pose ?? 'idle';
    if (pose === 'attack') {
      const u = talk.lineAge / 0.7;
      return u < 1 ? { pose: 'attack', poseT: u } : { pose: 'idle', poseT: 0 };
    }
    return { pose, poseT: 0 };
  }

  function drawPoster(ctx: Ctx, t: number, k: number): void {
    const w = 236, h = 132;
    const x = 372, y = 54;
    ctx.save();
    const cx = x + w / 2, cy = y + h / 2;
    popIn(ctx, cx, cy, k, 0.03);
    drawPanel(ctx, x, y, w, h, { fill: '#f6e2b0' });
    // pins
    for (const px of [x + 10, x + w - 12]) {
      fillRoundRect(ctx, px, y + 4, 5, 5, 2, UI.ink);
      fillRoundRect(ctx, px + 1, y + 5, 3, 3, 1, UI.bad);
    }
    drawTextOutlined(ctx, 'WANTED!', cx, y + 10, { size: 2, color: '#d8402e', outline: UI.ink, align: 'center', shadow: false });
    const orgs = Object.values(ORGS).sort((a, b) => a.order - b.order).slice(0, 5);
    drawInset(ctx, x + 10, y + 32, w - 20, 70, { fill: '#e8cf98' });
    const n = orgs.length;
    orgs.forEach((org, i) => {
      try {
        const v = getVillain(org.boss).visual;
        const vx = x + 10 + Math.round(((i + 0.5) * (w - 20)) / n);
        drawVillain(ctx, v, vx, y + 96, { scale: 0.62, t: t + i * 0.37, facing: i % 2 ? -1 : 1 });
      } catch { /* a boss still being written: leave the gap */ }
    });
    drawText(ctx, 'REWARD: A MOUNTAIN OF SEEDS', cx, y + 111, { align: 'center', color: UI.text, shadow: false });
    ctx.restore();
  }

  /** Pop-in transform about (cx, cy): scale k and a slight tilt. Call inside save/restore. */
  function popIn(ctx: Ctx, cx: number, cy: number, k: number, tilt: number): void {
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.scale(k, k);
    ctx.translate(-cx, -cy);
  }

  /** "They fit in a teacup": a starter peeking out of a spotty teacup on its saucer. */
  function drawTeacup(ctx: Ctx, t: number, k: number): void {
    const cx = 480, rimY = 150;
    ctx.save();
    popIn(ctx, cx, rimY + 20, k, -0.02);
    ctx.lineJoin = 'round';
    // soft glow behind
    const g = ctx.createRadialGradient(cx, rimY, 4, cx, rimY, 90);
    g.addColorStop(0, 'rgba(255, 240, 200, 0.55)'); g.addColorStop(1, 'rgba(255, 240, 200, 0)');
    ctx.fillStyle = g; ctx.fillRect(cx - 100, rimY - 100, 200, 200);
    // saucer
    ctx.fillStyle = UI.ink;
    ctx.beginPath(); ctx.ellipse(cx, rimY + 46, 62, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8e0f0';
    ctx.beginPath(); ctx.ellipse(cx, rimY + 45, 60, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fbf7ff';
    ctx.beginPath(); ctx.ellipse(cx, rimY + 44, 46, 7, 0, 0, Math.PI * 2); ctx.fill();
    // inside of the cup (behind the dragon)
    ctx.fillStyle = UI.ink;
    ctx.beginPath(); ctx.ellipse(cx, rimY, 43, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c87a5a';
    ctx.beginPath(); ctx.ellipse(cx, rimY, 41, 9, 0, 0, Math.PI * 2); ctx.fill();
    // the dragon, sitting in the tea
    const sp = species[1] ?? species[0];
    drawDragon(ctx, sp.visual, cx - 2, rimY + 22, { scale: 1.7, t, pose: 'happy', facing: 1 });
    // the bowl's front half, painted over the dragon's lower body
    const bowl = (): void => {
      ctx.beginPath();
      ctx.moveTo(cx - 43, rimY);
      ctx.bezierCurveTo(cx - 42, rimY + 34, cx - 26, rimY + 46, cx, rimY + 46);
      ctx.bezierCurveTo(cx + 26, rimY + 46, cx + 42, rimY + 34, cx + 43, rimY);
      ctx.ellipse(cx, rimY, 43, 11, 0, 0, Math.PI, false);
      ctx.closePath();
    };
    // handle
    ctx.strokeStyle = UI.ink; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.ellipse(cx + 46, rimY + 16, 11, 13, 0, -1.4, 1.6); ctx.stroke();
    ctx.strokeStyle = '#f6d6e6'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(cx + 46, rimY + 16, 11, 13, 0, -1.4, 1.6); ctx.stroke();
    bowl(); ctx.lineWidth = 2.5; ctx.strokeStyle = UI.ink; ctx.stroke();
    const body = ctx.createLinearGradient(cx - 43, 0, cx + 43, 0);
    body.addColorStop(0, '#f6d6e6'); body.addColorStop(0.4, '#fff4fa'); body.addColorStop(1, '#e2b4cc');
    bowl(); ctx.fillStyle = body; ctx.fill();
    // polka dots and a gold rim
    ctx.save(); bowl(); ctx.clip();
    ctx.fillStyle = '#ef7d9a';
    for (const [dx, dy] of [[-28, 12], [-8, 24], [14, 14], [30, 28], [-22, 34], [4, 38], [34, 6]] as const) {
      ctx.beginPath(); ctx.arc(cx + dx, rimY + dy, 3.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = UI.gold; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, rimY, 42, 10, 0, 0, Math.PI, false); ctx.stroke();
    // steam curls
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const sx = cx - 30 + i * 62, ph = t * 2 + i * 2;
      ctx.beginPath();
      for (let k2 = 0; k2 <= 10; k2++) {
        const yy = rimY - 6 - k2 * 3, xx = sx + Math.sin(ph + k2 * 0.6) * 3;
        if (k2 === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** "Your job": a little checklist card that ticks itself off as the Chief reads it out. */
  function drawDuties(ctx: Ctx, k: number, lineAge: number): void {
    const x = 384, y = 70, w = 220, h = 116;
    ctx.save();
    popIn(ctx, x + w / 2, y + h / 2, k, 0.025);
    drawPanel(ctx, x, y, w, h, { title: 'AGENT DUTIES', fill: UI.panelLight });
    const rows: [string, (cx: number, cy: number) => void][] = [
      ['FEED THEM SNACKS', (cx, cy) => drawFoodIcon(ctx, FOOD_IDS[0], cx, cy, 16)],
      ['KEEP THEM HAPPY', (cx, cy) => drawActivityIcon(ctx, ACTIVITY_IDS[ACTIVITY_IDS.length - 1], cx, cy, 16)],
      ['STOP THE VILLAINS', (cx, cy) => drawOrgEmblem(ctx, ORG_IDS[0], cx, cy, 8)],
    ];
    rows.forEach(([label, icon], r) => {
      const ry = y + 18 + r * 30;
      drawInset(ctx, x + 10, ry, w - 20, 24);
      icon(x + 24, ry + 12);
      drawText(ctx, label, x + 40, ry + 9, { color: UI.text, shadow: false });
      // the tick box, ticked one after another
      const bx = x + w - 32, by = ry + 5;
      fillRoundRect(ctx, bx, by, 14, 14, 2, UI.ink);
      fillRoundRect(ctx, bx + 1, by + 1, 12, 12, 1, '#fffaf0');
      if (lineAge > 0.6 + r * 0.7) {
        ctx.fillStyle = UI.good;
        const tick = [[2, 6], [3, 7], [4, 8], [5, 9], [6, 8], [7, 7], [8, 6], [9, 5], [10, 4], [11, 3]];
        for (const [tx, ty] of tick) ctx.fillRect(bx + tx, by + ty, 2, 2);
      }
    });
    ctx.restore();
  }

  function drawTalk(ctx: Ctx, t: number): void {
    drawBriefingStage(ctx, t);
    const intro = clamp01(phaseAge / 0.45);
    const top = talk.top();
    // the Chief waddles in from the left on the first line
    const chiefX = Math.round(150 - (1 - easeOut(intro)) * 220);
    const { pose, poseT } = chiefPose();
    drawChief(ctx, chiefX, top - 6, 2.6, t, !talk.tw.done && intro >= 1, { pose: intro < 1 ? 'walk' : pose, poseT });
    const line = talk.line;
    if (line?.picture) {
      const k = 0.6 + 0.4 * easeOut(clamp01(talk.lineAge / 0.3));
      if (line.picture === 'poster') drawPoster(ctx, t, k);
      else if (line.picture === 'teacup') drawTeacup(ctx, t, k);
      else drawDuties(ctx, k, talk.lineAge);
    }
    const slide = Math.round((1 - easeOut(clamp01(phaseAge / 0.3))) * 110);
    talk.draw(ctx, age, slide);
  }

  function drawReact(ctx: Ctx, t: number): void {
    drawBriefingStage(ctx, t);
    const top = talk.top();
    const { pose, poseT } = chiefPose();
    drawChief(ctx, 140, top - 6, 2.4, t, !talk.tw.done, { pose, poseT });
    chosen.forEach((s, i) => {
      const enter = easeOut(clamp01((phaseAge - i * 0.15) / 0.5));
      const x = Math.round(390 + i * 110 + (1 - enter) * 300);
      drawDragon(ctx, s.visual, x, top - 8, { scale: 2.1, t: t + i * 0.3, pose: 'happy', facing: -1 });
    });
    talk.draw(ctx, age, 0);
  }

  /** A pedestal: a stone drum with the type's medallion on the front; gold rim when picked. */
  function drawPedestal(ctx: Ctx, i: number, x: number, y: number, isPicked: boolean, focused: boolean, t: number): void {
    const type = types[i];
    const col = TYPES[type]?.color ?? '#8a7a6a';
    const rx = PED_RX, ry = 8, depth = 14;
    ctx.save();
    // soft shadow
    ctx.fillStyle = 'rgba(10, 6, 16, 0.35)';
    ctx.beginPath(); ctx.ellipse(x + 2, y + depth + 4, rx + 4, ry, 0, 0, Math.PI * 2); ctx.fill();
    // drum side
    ctx.fillStyle = UI.ink;
    ctx.fillRect(x - rx - 1, y, rx * 2 + 2, depth);
    ctx.beginPath(); ctx.ellipse(x, y + depth, rx + 1, ry + 1, 0, 0, Math.PI * 2); ctx.fill();
    const side = ctx.createLinearGradient(x - rx, 0, x + rx, 0);
    side.addColorStop(0, tint(col, -0.45)); side.addColorStop(0.35, tint(col, -0.1)); side.addColorStop(1, tint(col, -0.55));
    ctx.fillStyle = side;
    ctx.fillRect(x - rx, y, rx * 2, depth);
    ctx.beginPath(); ctx.ellipse(x, y + depth, rx, ry, 0, 0, Math.PI); ctx.fill();
    // top face
    ctx.fillStyle = UI.ink;
    ctx.beginPath(); ctx.ellipse(x, y, rx + 1, ry + 1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = isPicked ? UI.gold : tint(col, 0.35);
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = isPicked ? UI.goldLight : tint(col, 0.6);
    ctx.beginPath(); ctx.ellipse(x, y - 1, rx - 4, ry - 3, 0, 0, Math.PI * 2); ctx.fill();
    if (focused) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.strokeStyle = pulse > 0.5 ? UI.focus : tint(UI.focus, 0.4);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y, rx + 4, ry + 3, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    drawTypeIcon(ctx, type, x, y + depth / 2 + 2, 6);
  }

  /** A fat arrow from p to q, bowed outward, in the attacker's colour, with marching dashes. */
  function drawBeatsArrow(ctx: Ctx, from: number, to: number, t: number): void {
    const a = SPOTS[from], b = SPOTS[to];
    const ay = a.y - 14, by = b.y - 14;
    const mx = (a.x + b.x) / 2, my = (ay + by) / 2;
    let nx = mx - CENTROID.x, ny = my - (CENTROID.y - 14);
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    const cx = mx + nx * 26, cy = my + ny * 26;
    const qp = (u: number): { x: number; y: number } => ({
      x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * cx + u * u * b.x,
      y: (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * cy + u * u * by,
    });
    const u0 = 0.27, u1 = 0.71;
    const col = TYPES[types[from]]?.color ?? UI.accent;
    const light = TYPES[types[from]]?.light ?? tint(col, 0.5);
    const path = (): void => {
      ctx.beginPath();
      for (let k = 0; k <= 16; k++) {
        const p = qp(u0 + (u1 - u0) * (k / 16));
        if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
    };
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    path(); ctx.strokeStyle = UI.ink; ctx.lineWidth = 9; ctx.stroke();
    path(); ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.stroke();
    path(); ctx.setLineDash([3, 7]); ctx.lineDashOffset = -t * 22; ctx.strokeStyle = light; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);
    // head
    const end = qp(u1 + 0.02), before = qp(u1 - 0.04);
    const ang = Math.atan2(end.y - before.y, end.x - before.x);
    const tip = { x: end.x + Math.cos(ang) * 9, y: end.y + Math.sin(ang) * 9 };
    const head = (grow: number): void => {
      ctx.beginPath();
      ctx.moveTo(tip.x + Math.cos(ang) * grow, tip.y + Math.sin(ang) * grow);
      ctx.lineTo(end.x + Math.cos(ang + 2.1) * (9 + grow), end.y + Math.sin(ang + 2.1) * (9 + grow));
      ctx.lineTo(end.x + Math.cos(ang - 2.1) * (9 + grow), end.y + Math.sin(ang - 2.1) * (9 + grow));
      ctx.closePath();
    };
    head(2); ctx.fillStyle = UI.ink; ctx.fill();
    head(0); ctx.fillStyle = col; ctx.fill();
    ctx.restore();
    // BEATS label at the bow of the arrow
    const lp = qp(0.5);
    const label = 'BEATS';
    const lw = measureText(label) + 10;
    const lx = Math.round(lp.x + nx * 14 - lw / 2), ly = Math.round(lp.y + ny * 14 - 6);
    fillRoundRect(ctx, lx, ly, lw, 13, 3, UI.ink);
    fillRoundRect(ctx, lx + 1, ly + 1, lw - 2, 11, 2, tint(col, -0.25));
    fillRoundRect(ctx, lx + 1, ly + 1, lw - 2, 10, 2, col);
    drawText(ctx, label, lx + 5, ly + 3, { color: '#ffffff', shadowColor: tint(col, -0.55) });
  }

  function drawStarter(ctx: Ctx, i: number, t: number): void {
    const s = species[i];
    const spot = SPOTS[i];
    const isPicked = picked.includes(i);
    const focused = group.focused === starterBtns[i];
    const hovered = starterBtns[i].hovered;
    const wob = wobble[i] > 0 ? Math.sin(wobble[i] * 40) * 3 * (wobble[i] / 0.5) : 0;
    const x = Math.round(spot.x + wob);
    drawPedestal(ctx, i, x, spot.y, isPicked, focused || hovered, t);
    const pose: Pose = isPicked ? 'happy' : 'idle';
    drawDragon(ctx, s.visual, x, spot.y + 1, { scale: STARTER_SCALE, t: t + i * 0.4, pose, facing: i === 2 ? 1 : i === 1 ? -1 : 1 });
    const h = dragonHeight(s.visual, STARTER_SCALE);
    // focus arrow above the head
    if (focused) {
      const bob = Math.floor(t * 4) % 2;
      drawText(ctx, '↓', x - 2, Math.round(spot.y - h - 22 + bob), { color: UI.focus, shadowColor: UI.ink });
    }
    // name plate under the pedestal
    const name = s.name.toUpperCase();
    const nw = measureText(name);
    const ny = spot.y + 26;
    const plateW = nw + 12 + (isPicked ? 10 : 0);
    const px = Math.round(x - plateW / 2);
    fillRoundRect(ctx, px, ny - 3, plateW, 13, 3, UI.ink);
    fillRoundRect(ctx, px + 1, ny - 2, plateW - 2, 11, 2, isPicked ? UI.goldDark : UI.nightLight);
    fillRoundRect(ctx, px + 1, ny - 2, plateW - 2, 10, 2, isPicked ? UI.gold : UI.night);
    if (isPicked) drawText(ctx, '★', px + 5, ny, { color: '#ffffff', shadowColor: UI.goldDark });
    drawText(ctx, name, px + 6 + (isPicked ? 10 : 0), ny, { color: isPicked ? UI.text : UI.textLight, shadowColor: isPicked ? UI.goldLight : UI.ink, shadow: !isPicked });
  }

  function drawCard(ctx: Ctx): void {
    const i = shown;
    const s = species[i];
    const type = types[i];
    const { x, y, w, h } = CARD;
    drawPanel(ctx, x, y, w, h, { title: 'DRAGON FILE' });
    const px = x + 12, pw = w - 24;
    // name, dex number
    drawText(ctx, s.name, px, y + 14, { size: 2, color: UI.text, shadowColor: tint(UI.panel, -0.2) });
    const isPicked = picked.includes(i);
    if (!isPicked) drawText(ctx, 'NO. ' + String(s.dex).padStart(3, '0'), x + w - 12, y + 18, { align: 'right', color: UI.textDim, shadow: false });
    // category + type badge
    drawText(ctx, s.category, px, y + 36, { color: UI.textDim, shadow: false });
    const bw = measureText(TYPES[type]?.name ?? type) + 23;
    drawTypeBadge(ctx, type, x + w - 12 - bw, y + 33);
    // backstory excerpt
    const lines = excerpt(s.backstory, pw);
    drawInset(ctx, px - 4, y + 52, pw + 8, 26);
    lines.forEach((l, k) => drawText(ctx, l, px, y + 57 + k * LINE_STEP, { color: UI.text, shadow: false }));
    // the triangle in words: what it beats, what it loses to
    const beats = types.filter((o) => o !== type && effectiveness(type, [o]) > 1);
    const loses = types.filter((o) => o !== type && effectiveness(o, [type]) > 1);
    let bx = px;
    const by = y + 86;
    drawText(ctx, 'BEATS', bx, by + 3, { color: UI.good, shadowColor: tint(UI.panel, -0.2) });
    bx += measureText('BEATS') + 5;
    for (const o of beats) bx += drawTypeBadge(ctx, o, bx, by, { small: false }) + 3;
    let lx = x + w / 2 + 6;
    drawText(ctx, 'LOSES TO', lx, by + 3, { color: UI.bad, shadowColor: tint(UI.panel, -0.2) });
    lx += measureText('LOSES TO') + 5;
    for (const o of loses) lx += drawTypeBadge(ctx, o, lx, by, { small: false }) + 3;
    // base stats
    const sy = y + 108;
    const total = STAT_IDS.reduce((a, k) => a + s.baseStats[k], 0);
    drawText(ctx, 'BASE STATS', px, sy, { color: UI.textDim, shadow: false });
    drawText(ctx, 'TOTAL ' + total, x + w - 12, sy, { align: 'right', color: UI.textDim, shadow: false });
    STAT_IDS.forEach((k, r) => {
      const ry = sy + 12 + r * 11;
      drawText(ctx, STAT_SHORT[k], px, ry + 1, { color: UI.text, shadow: false });
      const barX = px + 50, barW = pw - 50 - 24;
      drawBar(ctx, barX, ry, barW, 9, s.baseStats[k] / STAT_MAX, STAT_COLOR[k]);
      drawText(ctx, String(s.baseStats[k]), x + w - 12, ry + 1, { align: 'right', color: UI.text, shadow: false });
    });
    // picked stamp
    if (isPicked) {
      const k = easeOut(clamp01(pickAge[i] / 0.25));
      const sc = 1.6 - 0.6 * k;
      ctx.save();
      const cx = x + w - 62, cy = y + 18;
      ctx.translate(cx, cy); ctx.rotate(-0.1); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
      ctx.globalAlpha *= k;
      const label = 'PICKED!';
      const lw = measureText(label, 2) + 12;
      fillRoundRect(ctx, cx - lw / 2, cy - 10, lw, 20, 3, '#c9473d');
      fillRoundRect(ctx, cx - lw / 2 + 2, cy - 8, lw - 4, 16, 2, '#fff1dc');
      drawText(ctx, label, cx, cy - 7, { size: 2, align: 'center', color: '#c9473d', shadow: false });
      ctx.restore();
    }
  }

  function drawPick(ctx: Ctx, t: number): void {
    drawBurrow(ctx, t);
    ctx.fillStyle = 'rgba(27, 20, 38, 0.64)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const glow = ctx.createRadialGradient(CENTROID.x, CENTROID.y - 20, 10, CENTROID.x, CENTROID.y - 20, 190);
    glow.addColorStop(0, 'rgba(255, 214, 150, 0.22)');
    glow.addColorStop(1, 'rgba(255, 214, 150, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const fade = easeOut(clamp01(phaseAge / 0.35));
    ctx.save();
    ctx.globalAlpha *= fade;
    drawTextOutlined(ctx, 'PICK YOUR PARTNERS', 166, 10, { size: 2, color: UI.gold, outline: UI.ink, align: 'center', shadowColor: 'rgba(0,0,0,0.5)' });

    // arrows first, so pedestals and dragons sit on top of their ends
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      if (a !== b && effectiveness(types[a], [types[b]]) > 1) drawBeatsArrow(ctx, a, b, t);
    }
    // picked counter in the middle of the triangle
    const cnt = `PICKED ${picked.length}/2`;
    const cw = measureText(cnt) + 14;
    const ccx = Math.round(CENTROID.x - cw / 2), ccy = CENTROID.y - 6;
    fillRoundRect(ctx, ccx, ccy, cw, 15, 4, UI.ink);
    fillRoundRect(ctx, ccx + 1, ccy + 1, cw - 2, 13, 3, picked.length === 2 ? UI.goldDark : UI.nightLight);
    fillRoundRect(ctx, ccx + 1, ccy + 1, cw - 2, 12, 3, picked.length === 2 ? UI.gold : UI.night);
    drawText(ctx, cnt, CENTROID.x, ccy + 4, { align: 'center', color: picked.length === 2 ? UI.text : UI.textLight, shadow: picked.length !== 2 });

    for (let i = 0; i < 3; i++) drawStarter(ctx, i, t);
    drawCard(ctx);
    confirmBtn.draw(ctx, group.focused === confirmBtn);

    // hint strip
    const flashing = hintFlash > 0;
    const text = flashing ? hintText : HINT;
    const hy = HINT_Y;
    fillRoundRect(ctx, 8, hy, VIEW_W - 16, 32, 4, UI.ink);
    fillRoundRect(ctx, 9, hy + 1, VIEW_W - 18, 30, 3, tint(UI.night, 0.06));
    const lines = wrapText(text, VIEW_W - 60);
    const ty = hy + Math.round((32 - (lines.length * LINE_STEP - 3)) / 2);
    drawText(ctx, flashing ? '!' : '★', 22, hy + 12, { color: flashing ? UI.accentLight : UI.gold, shadowColor: UI.ink });
    lines.forEach((l, k) => drawText(ctx, l, 36, ty + k * LINE_STEP, { color: flashing ? UI.accentLight : UI.textLight, shadowColor: UI.ink }));
    ctx.restore();
  }

  return {
    name: 'intro',
    enter() {
      // for tools/playtest.ts: which part of the intro is showing
      app.debug.intro = { phase: () => phase, line: () => talk.index };
      const prev = app.state;
      const fresh = newGame(freshSeed(), prev?.playerName || 'AGENT');
      if (prev?.settings) fresh.settings = { ...prev.settings };
      app.state = fresh;
      music('burrow');
      setPhase('talk');
      talk.start(BRIEFING, () => startPick());
    },
    update(dt: number, input: Input) {
      age += dt;
      phaseAge += dt;
      fx.update(dt);
      if (phase === 'talk') {
        if (phaseAge < 0.45) return;   // the Chief is still waddling in
        if (input.back()) { sfx('back'); talk.skip(); return; }
        talk.update(dt, input);
      } else if (phase === 'pick') {
        hintFlash = Math.max(0, hintFlash - dt);
        for (let i = 0; i < 3; i++) { wobble[i] = Math.max(0, wobble[i] - dt); pickAge[i] += dt; }
        if (input.back()) {
          if (picked.length) {
            const i = picked.pop()!;
            shown = i;
            sfx('back');
            flashHint(`${species[i].name.toUpperCase()} HOPS BACK DOWN. NO HARD FEELINGS!`);
          } else {
            sfx('back');
            app.nav.confirm('BACK TO THE TITLE SCREEN? THE CANDIDATES WILL WAIT. THEY ARE VERY PATIENT.', () => app.nav.title());
          }
          return;
        }
        group.update(input);
        const f = starterBtns.indexOf(group.focused as Button);
        if (f >= 0) shown = f;
      } else if (phase === 'react') {
        if (input.back()) { sfx('back'); talk.skip(); return; }
        talk.update(dt, input);
      }
    },
    draw(ctx: Ctx) {
      const t = app.time;
      if (phase === 'talk') drawTalk(ctx, t);
      else if (phase === 'pick') drawPick(ctx, t);
      else drawReact(ctx, t);
      fx.draw(ctx);
    },
  };
}
