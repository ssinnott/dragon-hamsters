// The battle screen: a Pokemon-style single battle with the rock-paper-scissors type matchup on
// screen the whole time (docs/DESIGN.md "Battle screen and the rock-paper-scissors UI").
//
// How it works: the engine (src/battle/battle.ts) resolves a whole turn the moment the player
// commits and hands back that turn's events. This scene plays them back one at a time through a
// queue: every event gets a "step" that animates it (typewriter text, lunges, effects, HP drains,
// banners) and the next event starts when the step is done. Everything the HUD shows comes from the
// per-combatant views in ../battle/view.ts, which only change when an event plays, so the screen
// never runs ahead of (or out of step with) what the player has been told.
//
// Menus (FIGHT / SWAP / BAG / RETREAT / [?] TYPES) appear only while the queue is empty and the
// engine waits for a decision. With app.debug.autoplay on, the scene picks its own actions
// (autoAction) and fast-forwards, so tools/playtest.ts can run whole missions.
import type { Scene } from '../scene.ts';
import type { Input } from '../input.ts';
import { app } from '../app.ts';
import {
  ButtonGroup, Typewriter, UI, drawMessageBox, drawPanel, drawPlaque, drawWrapped, fillRoundRect, tint,
} from '../widgets.ts';
import { drawItemIcon, drawTypeIcon } from '../icons.ts';
import { drawText } from '../../lib/engine/text.ts';
import { ITEM_IDS, type FxKind, type ItemId, type Stats, type StatusId, type TypeId } from '../../data/schema.ts';
import { getAbility, getItem, getLocation, getMission, getMove, getType } from '../../data/index.ts';
import type { BattleEvent, BattleState, PlayerAction, Side } from '../../battle/types.ts';
import { activeMon, createBattle, itemTargetOk, legal, startBattle, submitSwitch, submitTurn } from '../../battle/battle.ts';
import { bestTypeMultiplier, effectivenessLabel, matchupGrade, moveEffectiveness } from '../../battle/matchup.ts';
import { xpForLevel } from '../../battle/stats.ts';
import { encounterSetup, finishBattle, tuckeredAfterWin, type MissionRun } from '../../game/missions.ts';
import { drawBattleBackdrop, drawPlatform } from '../../art/backdrops.ts';
import { createFx } from '../../art/fx.ts';
import { drawDizzyStars, type Pose } from '../../art/dragon.ts';
import { moveSfx, music, setMusic, setSound, sfx } from '../../audio/index.ts';
import {
  LAYOUT, battleScale, drawAbilityBanner, drawEnemyBox, drawItemFace, drawLevelCard, drawMatchup, drawMoveFace,
  drawMoveInfo, drawOutroBanner, drawPlayerBox, drawTeamCard, drawWeakRow, verdictOf, type Matchup,
} from '../battle/hud.ts';
import { drawMon, hpSettled, makeView, setHp, syncViews, tickView, xpSettled, type MonView } from '../battle/view.ts';
import { autoAction } from '../battle/auto.ts';

export { autoAction } from '../battle/auto.ts';

type Ctx = CanvasRenderingContext2D;
type Outcome = 'won' | 'lost' | 'retreated';
type MenuKind = 'main' | 'fight' | 'swap' | 'bag' | 'target' | 'retreat';

/** One combatant's place on the field: who stands there and what its sprite is doing. */
interface Slot {
  side: Side;
  uid: string | null;
  /** 'enter' pop-in, 'leave' shrink-back, 'faint' flop, 'gone' nothing drawn. */
  anim: 'idle' | 'enter' | 'leave' | 'faint' | 'flee' | 'gone';
  animT: number;
  animDur: number;
  landed: boolean;
  /** A one-shot pose on top of idle (attack, hurt, happy). */
  pose: Pose | null;
  poseT: number;
  poseDur: number;
  flash: number;
  dodge: number;
  /** Info box slide 0..1 and whether it should be showing. */
  box: number;
  boxOn: boolean;
}

/** The playback of one event. */
interface Step {
  /** Seconds still to wait (text: counted only once the typewriter has finished). */
  left: number;
  /** Extra condition before the step may end (HP bar settled, etc). */
  until: (() => boolean) | null;
  text: boolean;
  /** Enter/click may cut it short (after `minAge` seconds). */
  skippable: boolean;
  minAge: number;
  age: number;
  onDone: (() => void) | null;
}

const ENTER_DUR = 0.55;
const LEAVE_DUR = 0.32;
const FAINT_DUR = 0.9;
const DODGE_DUR = 0.36;
const INTRO_DUR = 0.42;
/** fx kinds that play on one combatant (passed as `from`). */
const SELF_FX = new Set<FxKind>(['buff', 'debuff', 'heal', 'shield']);
const STATUS_COLOR: Record<StatusId, string> = {
  burn: '#ff8a4a', goop: '#c47ae8', zap: '#ffe14a', snooze: '#a8b8e8', frozen: '#a8ecff',
};
const HEAL_COLOR = '#9cf6ff';

// Bottom panel geometry.
const MSG_FULL = { x: 4, y: 264, w: 632, h: 92 };
const MSG_LEFT = { x: 4, y: 264, w: 332, h: 92 };
const MOVE_INFO = { x: 442, y: 264, w: 194, h: 92 };
const ITEM_INFO = { x: 318, y: 264, w: 318, h: 92 };
const SMALL_BACK = { x: 574, y: 334, w: 56, h: 18 };

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const outQuad = (u: number): number => u * (2 - u);
const inQuad = (u: number): number => u * u;
const outBack = (u: number): number => { const k = 1.70158; return 1 + (k + 1) * Math.pow(u - 1, 3) + k * Math.pow(u - 1, 2); };
const otherSide = (s: Side): Side => (s === 'player' ? 'enemy' : 'player');

export function createBattleScene(run: MissionRun, onEnd: (outcome: Outcome) => void): Scene {
  let battle: BattleState;
  const views = new Map<string, MonView>();
  let playerTeam: MonView[] = [];
  let enemyTeam: MonView[] = [];
  const fx = createFx();
  const tw = new Typewriter(100);
  const group = new ButtonGroup();
  const queue: BattleEvent[] = [];
  let step: Step | null = null;
  let skipRequested = false;
  let time = 0;
  let introT = 0;
  let finished = false;
  let ended = false;
  let victorySide: Side | null = null;

  const slots: Record<Side, Slot> = { player: newSlot('player'), enemy: newSlot('enemy') };

  let matchup: Matchup | null = null;
  let matchPulse = 0;
  let stripAppear = 0;

  let menu: MenuKind | null = null;
  let forced = false;
  let pickedItem: ItemId | null = null;
  let itemNote: string | null = null;
  let lastMoveSlot = 0;
  let lastItemFocus = 0;

  let banners: { side: Side; text: string; age: number; dur: number }[] = [];
  let floats: { item: ItemId; x: number; y: number; age: number }[] = [];
  let levelCard: { name: string; level: number; gains: Stats; age: number; dur: number } | null = null;
  let outro: { text: string; color: string; age: number } | null = null;
  /** The fx the last move played and on whom, so the follow-up event does not play it twice. */
  let lastMoveFx: { at: string; kind: FxKind } | null = null;
  const bossSeen = new Set<string>();

  function newSlot(side: Side): Slot {
    return {
      side, uid: null, anim: 'gone', animT: 0, animDur: 0, landed: true, pose: null, poseT: 0, poseDur: 0,
      flash: 0, dodge: 0, box: 0, boxOn: false,
    };
  }

  const fast = (): boolean => !!app.state?.settings?.fastText;
  /** fastText halves the text timings. */
  const pace = (): number => (fast() ? 0.5 : 1);
  const autoplay = (): boolean => !!app.debug?.autoplay;

  function view(uid: string): MonView {
    const v = views.get(uid);
    if (!v) throw new Error(`battle scene: unknown combatant '${uid}'`);
    return v;
  }

  function activeView(side: Side): MonView | null {
    const uid = slots[side].uid;
    return uid ? views.get(uid) ?? null : null;
  }

  function ground(side: Side): { x: number; y: number } {
    return side === 'enemy' ? LAYOUT.enemyGround : LAYOUT.playerGround;
  }

  const facing = (side: Side): 1 | -1 => (side === 'enemy' ? -1 : 1);

  /** Body centre of whoever stands on `side` (fx anchor). */
  function bodyOf(side: Side): { x: number; y: number } {
    const g = ground(side);
    const v = activeView(side);
    const h = v ? v.h1 * battleScale(v) : 70;
    return { x: g.x, y: Math.round(g.y - h * 0.45) };
  }

  function topOf(side: Side): number {
    const g = ground(side);
    const v = activeView(side);
    return Math.round(g.y - (v ? v.h1 * battleScale(v) : 70));
  }

  function onField(uid: string): Side | null {
    for (const s of ['player', 'enemy'] as const) {
      const sl = slots[s];
      if (sl.uid === uid && sl.anim !== 'gone' && sl.anim !== 'leave') return s;
    }
    return null;
  }

  function playPose(side: Side, pose: Pose, dur: number): void {
    const sl = slots[side];
    sl.pose = pose;
    sl.poseT = 0;
    sl.poseDur = dur;
  }

  // -------------------------------------------------------------------------------------------
  // Matchup strip
  // -------------------------------------------------------------------------------------------

  function updateMatchup(): void {
    const p = activeView('player');
    const e = activeView('enemy');
    if (!p || !e) return;
    const next: Matchup = {
      mine: [...p.types], theirs: [...e.types],
      fwd: bestTypeMultiplier(p.types, e.types), back: bestTypeMultiplier(e.types, p.types),
      // the SWAP cards' grade for the dragon on the field decides the verdict (one answer everywhere)
      grade: matchupGrade(p.types, p.moves, e.types),
    };
    const key = (m: Matchup): string => `${m.mine.join()}|${m.theirs.join()}|${m.fwd}|${m.back}|${m.grade}`;
    if (matchup && key(matchup) !== key(next)) {
      matchPulse = 1;
      const was = verdictOf(matchup), now = verdictOf(next);
      if (was !== now) sfx(now === 'good' ? 'statUp' : now === 'bad' ? 'statDown' : 'select', { volume: 0.6 });
    }
    matchup = next;
  }

  // -------------------------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------------------------

  function showText(text: string): void {
    tw.cps = fast() ? 200 : 100;
    tw.set(text);
  }

  /** Who a line of text is about, by the engine's wording ("THE FOE'S X ..." / "X ..."). */
  function sideOfLine(text: string): Side | null {
    for (const s of ['enemy', 'player'] as const) {
      const v = activeView(s);
      if (!v) continue;
      const who = s === 'enemy' && !v.name.startsWith('THE ') ? `THE FOE'S ${v.name}` : v.name;
      if (text.startsWith(who + ' ')) return s;
    }
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // Event playback
  // -------------------------------------------------------------------------------------------

  function mkStep(left: number, until: (() => boolean) | null = null, opts: Partial<Step> = {}): Step {
    return { left, until, text: false, skippable: false, minAge: 0, age: 0, onDone: null, ...opts };
  }

  function floatOver(side: Side, text: string, color: string, dy = 0): void {
    const b = bodyOf(side);
    const top = topOf(side);
    fx.floatText(b.x, Math.round((b.y + top) / 2) + dy, text, color);
  }

  function begin(e: BattleEvent): Step {
    switch (e.t) {
      case 'text': {
        showText(e.text);
        // A desperate wiggle has no useMove event: animate the lunge from its line.
        if (/ USED DESPERATE WIGGLE!$/.test(e.text)) {
          const s = sideOfLine(e.text);
          if (s) {
            playPose(s, 'attack', 0.5);
            fx.move('tackle', bodyOf(s), bodyOf(otherSide(s)), 'FLUFF');
            sfx('fluff');
          }
        }
        const next = queue[0];
        const long = !next || next.t === 'text' || next.t === 'levelUp' || next.t === 'end'
          || (next.t === 'xp' && !onField(next.uid));
        // A line followed by an animation stays up while it plays; a line followed by another line
        // (or by the menu) holds long enough to read, longer lines a little longer.
        const len = e.text.length;
        const hold = (!long ? 0.16 : len <= 26 ? 0.42 : 0.3 + 0.026 * len) * pace();
        return mkStep(hold, () => tw.done, { text: true, skippable: true });
      }

      case 'sendOut': {
        const sl = slots[e.side];
        const v = view(e.uid);
        sl.uid = e.uid;
        sl.anim = 'enter';
        sl.animT = 0;
        sl.animDur = ENTER_DUR;
        sl.landed = false;
        sl.pose = null;
        sl.flash = 0;
        sl.boxOn = true;
        v.out = true;
        v.confused = false;
        v.seeded = false;
        v.stuck = false;
        const g = ground(e.side);
        fx.burst(g.x - facing(e.side) * 64, g.y - 64, getType(v.types[0]).color, 16);
        const bossEntrance = v.isBoss && !bossSeen.has(v.uid);
        if (bossEntrance) bossSeen.add(v.uid);
        sfx(bossEntrance ? 'boss' : 'swap');
        updateMatchup();
        // The boss's grand entrance gets a banner (the mission screen already played its taunt).
        if (bossEntrance && e.side === 'enemy') {
          banners = banners.filter((x) => x.side !== 'enemy');
          banners.push({ side: 'enemy', text: `BOSS BATTLE: ${v.name}!`, age: 0, dur: 2.2 });
        }
        return mkStep(ENTER_DUR + 0.04);
      }

      case 'withdraw': {
        const sl = slots[e.side];
        const wv = view(e.uid);
        wv.confused = false;
        wv.seeded = false;
        wv.stuck = false;
        if (sl.uid === e.uid) {
          sl.anim = 'leave';
          sl.animT = 0;
          sl.animDur = LEAVE_DUR;
          sl.boxOn = false;
          const b = bodyOf(e.side);
          fx.burst(b.x, b.y, '#ffffff', 10);
        }
        sfx('swap', { pitch: 0.85 });
        return mkStep(LEAVE_DUR + 0.04);
      }

      case 'useMove': {
        const mv = getMove(e.move);
        const foe = otherSide(e.side);
        const from = bodyOf(e.side), to = bodyOf(foe);
        playPose(e.side, mv.target === 'self' ? 'happy' : 'attack', mv.target === 'self' ? 0.55 : 0.5);
        const selfFx = SELF_FX.has(mv.fx);
        const onFoe = selfFx && mv.target === 'foe';
        fx.move(mv.fx, onFoe ? to : from, to, mv.type);
        const foeUid = slots[foe].uid;
        lastMoveFx = { at: selfFx ? (onFoe ? foeUid ?? '' : e.uid) : foeUid ?? '', kind: mv.fx };
        sfx(moveSfx(mv.type));
        return mkStep(0.42);
      }

      case 'damage': {
        const v = view(e.uid);
        const frac = v.maxHp > 0 ? e.amount / v.maxHp : 0;
        const dur = 0.22 + 0.45 * Math.min(1, frac);
        setHp(v, e.hp, e.maxHp, dur);
        const side = onField(e.uid);
        if (side) {
          const sl = slots[side];
          const b = bodyOf(side);
          if (e.source === 'move' || e.source === 'confusion' || e.source === 'recoil') {
            playPose(side, 'hurt', 0.42);
            sl.flash = 1;
            const col = e.source === 'move' ? effectivenessLabel(e.effectiveness).color : '#ece6d6';
            floatOver(side, '-' + e.amount, col);
            if (e.crit) floatOver(side, 'CRIT!', UI.gold, -16);
            if (e.source !== 'move') fx.burst(b.x, b.y, '#ffffff', 8);
          } else {
            sl.flash = 0.55;
            const col = e.source === 'seed' ? '#a8e48c' : STATUS_COLOR[v.status ?? 'burn'];
            fx.burst(b.x, b.y, col, 12);
            floatOver(side, '-' + e.amount, col);
            playPose(side, 'hurt', 0.35);
          }
        }
        if (e.source === 'move') {
          if (e.crit) sfx('crit');
          else if (e.effectiveness > 1) sfx('hitSuper');
          else if (e.effectiveness < 1) sfx('hitWeak');
          else sfx('hit');
          if (e.crit || e.effectiveness > 1) fx.shake(e.crit && e.effectiveness > 1 ? 7 : e.crit ? 6 : 4);
        } else if (e.source === 'seed') {
          sfx('leaf', { volume: 0.6 });
        } else {
          sfx('hit', { volume: 0.6, pitch: 0.9 });
        }
        // The bar keeps draining under the next line of text; only a knockout (or another hit) waits for it.
        const nextT = queue[0]?.t;
        const wait = e.hp <= 0 || nextT === 'damage' || nextT === 'faint' || nextT === 'heal';
        return wait ? mkStep(dur + 0.05, () => hpSettled(v)) : mkStep(Math.min(dur, 0.3));
      }

      case 'heal': {
        const v = view(e.uid);
        const dur = 0.25 + 0.4 * Math.min(1, e.amount / Math.max(1, e.maxHp));
        if (v.fainted && e.hp > 0) v.fainted = false;
        setHp(v, e.hp, e.maxHp, dur);
        const side = onField(e.uid);
        if (side) {
          const b = bodyOf(side);
          const dup = lastMoveFx && lastMoveFx.at === e.uid && lastMoveFx.kind === 'heal';
          if (!dup) fx.move('heal', b, b, 'LEAF');
          floatOver(side, '+' + e.amount, HEAL_COLOR);
        }
        sfx('heal');
        return mkStep(dur + 0.08, () => hpSettled(v));
      }

      case 'miss': {
        const side = onField(e.uid);
        if (side) {
          slots[side].dodge = DODGE_DUR;
          floatOver(side, 'MISS', '#d8d2e6');
        }
        sfx('miss');
        return mkStep(0.4);
      }

      case 'protect': {
        const side = onField(e.uid);
        const dup = lastMoveFx && lastMoveFx.at === e.uid && lastMoveFx.kind === 'shield';
        if (side && !dup) {
          const b = bodyOf(side);
          fx.move('shield', b, b, view(e.uid).types[0]);
        }
        sfx('sparkle');
        return mkStep(dup ? 0.2 : 0.45);
      }

      case 'status': {
        const v = view(e.uid);
        const was = v.status;
        v.status = e.status;
        v.statusAge = 0;
        const side = onField(e.uid);
        if (e.status) {
          if (side) {
            const b = bodyOf(side);
            fx.burst(b.x, b.y, STATUS_COLOR[e.status], 14);
          }
          sfx('status');
        } else if (was) {
          if (side) {
            const b = bodyOf(side);
            fx.burst(b.x, b.y, '#ffffff', 10);
          }
          sfx('sparkle');
        }
        return mkStep(0.3);
      }

      case 'volatile': {
        const v = view(e.uid);
        const added = (e.seeded && !v.seeded) || (e.stuck && !v.stuck);
        v.seeded = e.seeded;
        v.stuck = e.stuck;
        v.volatileAge = 0;
        return mkStep(added ? 0.2 : 0.05);
      }

      case 'confuse': {
        const v = view(e.uid);
        v.confused = e.on;
        const side = onField(e.uid);
        if (side && e.on) {
          const b = bodyOf(side);
          fx.burst(b.x, topOf(side) + 4, '#ff9ad6', 12);
          sfx('psy');
        }
        return mkStep(e.on ? 0.4 : 0.15);
      }

      case 'stages': {
        const side = onField(e.uid);
        const vals = Object.values(e.changes).filter((n): n is number => typeof n === 'number');
        const up = vals.some((n) => n > 0), down = vals.some((n) => n < 0);
        if (side) {
          const b = bodyOf(side);
          const dupUp = lastMoveFx?.at === e.uid && lastMoveFx.kind === 'buff';
          const dupDown = lastMoveFx?.at === e.uid && lastMoveFx.kind === 'debuff';
          if (up && !dupUp) fx.move('buff', b, b, 'FIRE');
          if (down && !dupDown) fx.move('debuff', b, b, 'WATER');
          if (up && !down) playPose(side, 'happy', 0.5);
        }
        if (up) sfx('statUp');
        if (down) sfx('statDown', { delay: up ? 0.15 : 0 });
        return mkStep(0.5);
      }

      case 'ability': {
        const v = view(e.uid);
        const name = abilityName(e.ability);
        banners = banners.filter((b) => b.side !== e.side);
        banners.push({ side: e.side, text: `${v.name}'S ${name}`, age: 0, dur: 1.7 });
        sfx('sparkle', { pitch: 1.2 });
        return mkStep(0.35);
      }

      case 'item': {
        const side = onField(e.uid);
        let x: number, y: number;
        if (side) {
          const b = bodyOf(side);
          x = b.x; y = topOf(side) - 4;
        } else {
          const B = LAYOUT.playerBox;
          x = B.x + B.w - 30; y = B.y - 6;
        }
        floats.push({ item: e.item, x, y, age: 0 });
        fx.burst(x, y, getItem(e.item).color, 10);
        sfx('eat');
        return mkStep(0.55);
      }

      case 'faint': {
        const v = view(e.uid);
        // the engine quietly clears status and volatile state on a knockout
        v.fainted = true;
        v.status = null;
        v.confused = false;
        v.seeded = false;
        v.stuck = false;
        const side = onField(e.uid);
        if (side) {
          const sl = slots[side];
          sl.anim = 'faint';
          sl.animT = 0;
          sl.animDur = FAINT_DUR;
          sl.pose = null;
          sl.flash = 0;
        }
        sfx('faint');
        return mkStep(FAINT_DUR * 0.85);
      }

      case 'xp': {
        const v = view(e.uid);
        v.xp = e.total;
        const cap = Math.min(e.total, xpForLevel(v.level + 1));
        if (onField(e.uid)) {
          v.xpSpeed = Math.abs(cap - v.shownXp) / 0.6;
          sfx('coin', { volume: 0.5, pitch: 1.3 });
          return mkStep(0.12, () => xpSettled(v));
        }
        v.shownXp = cap;
        return mkStep(0.05);
      }

      case 'levelUp': {
        const v = view(e.uid);
        const gains = { ...e.stats };
        for (const k of Object.keys(gains) as (keyof Stats)[]) gains[k] = e.stats[k] - v.stats[k];
        const oldMax = v.maxHp;
        v.level = e.level;
        v.stats = { ...e.stats };
        // The engine keeps the HP lost: same arithmetic, so the bar stays true.
        if (v.hp > 0) {
          v.hp = Math.max(1, Math.min(e.stats.hp, v.hp + (e.stats.hp - oldMax)));
          v.shownHp = Math.max(0, Math.min(e.stats.hp, v.shownHp + (e.stats.hp - oldMax)));
        }
        v.maxHp = e.stats.hp;
        v.shownXp = Math.max(v.shownXp, xpForLevel(e.level));
        const dur = 1.9 * pace();
        levelCard = { name: v.name, level: e.level, gains, age: 0, dur };
        sfx('levelUp');
        const side = onField(e.uid);
        if (side) {
          const b = bodyOf(side);
          playPose(side, 'happy', 1.1);
          fx.move('sparkle', b, b, 'LIGHT');
        }
        return mkStep(dur, null, { skippable: true, minAge: 0.25, onDone: () => { if (levelCard) levelCard.age = Math.max(levelCard.age, levelCard.dur * 0.88); } });
      }

      case 'end': {
        ended = true;
        const w = e.winner;
        music(null);
        if (w === 'player' && tuckeredAfterWin(run, battle)) {
          // The last foe and the last squad dragon fell together and no rest stop comes before the
          // next fight: the battle is won but the mission ends here, so no VICTORY! and no confetti.
          outro = { text: 'TUCKERED OUT!', color: '#8a6fb0', age: 0 };
          sfx('defeat');
          showText('BUT YOUR WHOLE SQUAD IS TOO TUCKERED OUT TO GO ON!');
          return mkStep(1.8 * (0.7 + 0.3 * pace()), () => tw.done, { text: true, skippable: true, minAge: 0.6, onDone: finish });
        }
        if (w === 'player') {
          victorySide = 'player';
          outro = { text: 'VICTORY!', color: '#e9a72a', age: 0 };
          sfx('victory');
          // confetti!
          const colors = ['#ffd24a', '#ef7d4f', '#4f9be0', '#5cbf4f', '#e86fb0'];
          colors.forEach((c, i) => fx.burst(220 + i * 50, 104 + (i % 2) * 22, c, 14));
        } else if (w === 'enemy') {
          victorySide = 'enemy';
          outro = { text: 'TUCKERED OUT!', color: '#8a6fb0', age: 0 };
          sfx('defeat');
        } else {
          outro = { text: 'SCURRIED TO SAFETY!', color: '#4f9be0', age: 0 };
          sfx('swap');
          const sl = slots.player;
          if (sl.uid && sl.anim === 'idle') { sl.anim = 'flee'; sl.animT = 0; sl.animDur = 1.1; sl.pose = null; }
        }
        return mkStep(1.8 * (0.7 + 0.3 * pace()), null, { skippable: true, minAge: 0.6, onDone: finish });
      }
    }
  }

  function abilityName(id: string): string {
    try {
      return getAbility(id).name.toUpperCase();
    } catch {
      return id.toUpperCase();
    }
  }

  function finish(): void {
    if (finished) return;
    finished = true;
    delete app.debug.battleUi;
    const outcome: Outcome = battle.winner === 'player' ? 'won' : battle.winner === 'retreat' ? 'retreated' : 'lost';
    finishBattle(app.state, run, battle);
    app.save();
    app.scenes.pop();
    onEnd(outcome);
  }

  // -------------------------------------------------------------------------------------------
  // Actions and menus
  // -------------------------------------------------------------------------------------------

  function act(a: PlayerAction): void {
    let evs: BattleEvent[];
    try {
      if (battle.phase === 'switch') {
        if (a.kind !== 'switch') return;
        evs = submitSwitch(battle, a.index);
      } else {
        evs = submitTurn(battle, a);
      }
    } catch (err) {
      console.warn('[battle] action rejected', a, err);
      sfx('error');
      return;
    }
    if (a.kind === 'move') lastMoveSlot = a.slot;
    closeMenu();
    lastMoveFx = null;
    queue.push(...evs);
  }

  function closeMenu(): void {
    menu = null;
    forced = false;
    pickedItem = null;
    itemNote = null;
    group.clear();
  }

  function back(to: MenuKind = 'main'): void {
    sfx('back');
    openMenu(to);
  }

  function myName(): string {
    return activeView('player')?.name ?? 'YOUR DRAGON';
  }

  function foeTypes(): readonly TypeId[] {
    return activeView('enemy')?.types ?? [];
  }

  function openMenu(kind: MenuKind): void {
    menu = kind;
    group.clear();
    group.keyboard = true;
    const L = legal(battle);
    const me = activeMon(battle, 'player');
    switch (kind) {
      case 'main': {
        const anySwitch = L.switches.some(Boolean);
        const bagCount = ITEM_IDS.reduce((n, id) => n + (battle.items[id] ?? 0), 0);
        group.add({
          label: 'FIGHT', sub: 'PICK A MOVE', size: 2, rect: { x: 342, y: 266, w: 106, h: 88 }, color: UI.accent, hotkey: 'f',
          icon: (g, cx, cy) => drawTypeIcon(g, me.types[0], cx, cy, 7),
          onClick: () => { sfx('click'); openMenu('fight'); },
        });
        group.add({
          label: 'SWAP', sub: anySwitch ? 'TEAM' : me.volatile.stuck ? 'STUCK!' : 'NO ONE', rect: { x: 454, y: 266, w: 88, h: 42 },
          hotkey: 's', enabled: () => anySwitch, icon: swapIcon,
          onClick: () => { sfx('click'); forced = false; openMenu('swap'); },
        });
        group.add({
          label: 'BAG', sub: bagCount > 0 ? `${bagCount} ITEM${bagCount === 1 ? '' : 'S'}` : 'EMPTY', rect: { x: 454, y: 312, w: 88, h: 42 },
          hotkey: 'b', enabled: () => bagCount > 0, icon: (g, cx, cy) => drawItemIcon(g, 'seedcake', cx, cy, 12),
          onClick: () => { sfx('click'); openMenu('bag'); },
        });
        group.add({
          label: 'RETREAT', sub: 'RUN HOME', rect: { x: 548, y: 266, w: 88, h: 42 }, color: '#f0b49a', hotkey: 'r',
          enabled: () => L.retreat, icon: retreatIcon,
          onClick: () => { sfx('click'); openMenu('retreat'); },
        });
        group.add({
          label: 'TYPES', sub: 'CHART', rect: { x: 548, y: 312, w: 88, h: 42 }, color: '#a9d2f2', hotkey: 't', icon: helpIcon,
          onClick: () => {
            sfx('click');
            const p = activeView('player'), e = activeView('enemy');
            app.nav.typeChart({ attack: p ? [...p.types] : [], defend: e ? [...e.types] : [] });
          },
        });
        group.focus = 0;
        break;
      }
      case 'fight': {
        const ft = [...foeTypes()];
        me.moves.forEach((slot, i) => {
          const mv = getMove(slot.id);
          const key = String(i + 1);
          group.add({
            label: '', rect: { x: 6 + (i % 2) * 218, y: 266 + Math.floor(i / 2) * 46, w: 212, h: 43 },
            color: getType(mv.type).color, hotkey: key, enabled: () => L.moves[i] === true,
            decorate: (g, face, en) => drawMoveFace(g, face, en, slot, ft, key),
            onClick: () => { sfx('select'); act({ kind: 'move', slot: i }); },
          });
        });
        group.add({ label: 'BACK', rect: SMALL_BACK, hotkey: 'Escape', color: UI.panelDark, onClick: () => back() });
        group.focus = lastMoveSlot < me.moves.length && L.moves[lastMoveSlot] ? lastMoveSlot : Math.max(0, L.moves.indexOf(true));
        break;
      }
      case 'swap':
      case 'target': {
        addTeamCards(kind);
        break;
      }
      case 'bag': {
        const usable = new Set(L.items);
        ITEM_IDS.forEach((id, k) => {
          const count = battle.items[id] ?? 0;
          const ok = usable.has(id);
          group.add({
            label: '', rect: { x: 6 + Math.floor(k / 3) * 156, y: 266 + (k % 3) * 30, w: 150, h: 28 },
            color: ok ? UI.panelLight : UI.disabled,
            decorate: (g, face) => drawItemFace(g, face, ok, id, count),
            onClick: () => pickItem(id, ok, count),
          });
        });
        group.add({ label: 'BACK', rect: SMALL_BACK, hotkey: 'Escape', color: UI.panelDark, onClick: () => back() });
        const firstOk = ITEM_IDS.findIndex((id) => usable.has(id));
        group.focus = usable.has(ITEM_IDS[lastItemFocus]) ? lastItemFocus : Math.max(0, firstOk);
        break;
      }
      case 'retreat': {
        group.add({
          label: 'YES, RUN!', sub: 'END THE MISSION', size: 2, rect: { x: 342, y: 266, w: 144, h: 88 }, color: UI.bad, hotkey: 'y',
          onClick: () => { sfx('select'); act({ kind: 'retreat' }); },
        });
        group.add({
          label: 'NO WAY!', sub: 'KEEP FIGHTING', size: 2, rect: { x: 492, y: 266, w: 144, h: 88 }, color: UI.good, hotkey: 'Escape',
          onClick: () => back(),
        });
        group.focus = 1;
        break;
      }
    }
  }

  function pickItem(id: ItemId, ok: boolean, count: number): void {
    lastItemFocus = ITEM_IDS.indexOf(id);
    if (!ok) {
      sfx('error');
      itemNote = count <= 0 ? 'NONE LEFT IN THE BAG!' : 'NOBODY NEEDS THAT RIGHT NOW.';
      return;
    }
    sfx('click');
    if (getItem(id).effect.kind === 'stages') {
      act({ kind: 'item', item: id, target: battle.player.active });
      return;
    }
    pickedItem = id;
    openMenu('target');
  }

  /** Why a team member can or cannot be picked for the current menu. */
  function cardState(kind: 'swap' | 'target', i: number): { ok: boolean; reason: string | null } {
    const m = battle.player.team[i];
    const active = i === battle.player.active;
    if (kind === 'swap') {
      const L = legal(battle);
      if (L.switches[i]) return { ok: true, reason: null };
      if (m.hp <= 0) return { ok: false, reason: 'FAINTED' };
      if (active) return { ok: false, reason: 'ALREADY OUT!' };
      return { ok: false, reason: "STUCK! CAN'T SWAP" };
    }
    const item = pickedItem;
    if (!item) return { ok: false, reason: null };
    const eff = getItem(item).effect;
    // the engine's rule decides; the scene only words the reason
    if (itemTargetOk(battle, item, i)) return { ok: true, reason: eff.kind === 'revive' ? 'NEEDS A PEP!' : null };
    switch (eff.kind) {
      case 'heal': return { ok: false, reason: m.hp <= 0 ? 'FAINTED' : 'ALREADY FULL HP' };
      case 'revive': return { ok: false, reason: 'NOT FAINTED' };
      case 'cure': return { ok: false, reason: m.hp <= 0 ? 'FAINTED' : 'FEELING FINE' };
      case 'stages': return { ok: false, reason: active && m.hp > 0 ? 'MAXED OUT!' : 'NOT IN BATTLE' };
    }
  }

  function addTeamCards(kind: 'swap' | 'target'): void {
    const team = battle.player.team;
    const n = Math.max(1, team.length);
    const hasBack = kind === 'target' || !forced;
    const area = hasBack ? 546 : 630;
    const cw = Math.min(206, Math.floor((area - (n - 1) * 6) / n));
    const ft = [...foeTypes()];
    const states = team.map((_, i) => cardState(kind, i));
    const grades = team.map((m) => (m.hp > 0 ? matchupGrade(m.types, m.moves.map((s) => s.id), ft) : null));
    // the best counter among the pickable ones
    let best = -1;
    if (kind === 'swap') {
      team.forEach((m, i) => {
        if (!states[i].ok) return;
        const g = grades[i] ?? 0;
        const bg = best >= 0 ? grades[best] ?? 0 : -1;
        if (g > bg || (g === bg && best >= 0 && m.hp / m.stats.hp > team[best].hp / team[best].stats.hp)) best = i;
      });
    }
    team.forEach((m, i) => {
      const v = view(m.uid);
      const key = String(i + 1);
      const st = states[i];
      group.add({
        label: '', rect: { x: 6 + i * (cw + 6), y: 268, w: cw, h: 88 }, color: UI.panelLight, hotkey: key,
        enabled: () => st.ok,
        decorate: (g, face, en) => drawTeamCard(g, face, en, v, {
          grade: kind === 'swap' ? grades[i] : null, reason: st.reason, best: i === best && kind === 'swap', hotkey: key, t: time,
        }),
        onClick: () => {
          sfx('select');
          if (kind === 'swap') act({ kind: 'switch', index: i });
          else if (pickedItem) act({ kind: 'item', item: pickedItem, target: i });
        },
      });
    });
    if (hasBack) {
      group.add({
        label: 'BACK', rect: { x: 558, y: 268, w: 78, h: 88 }, hotkey: 'Escape', color: UI.panelDark,
        onClick: () => back(kind === 'target' ? 'bag' : 'main'),
      });
    }
    group.focus = best >= 0 ? best : Math.max(0, states.findIndex((s) => s.ok));
  }

  /** Nothing is playing: hand the turn to the player (or the autopilot). */
  function idle(): void {
    if (finished || ended) return;
    if (menu !== null && !autoplay()) return;
    // let the bars finish filling or draining before the turn is handed over
    for (const v of views.values()) if (!hpSettled(v) || !xpSettled(v)) return;
    const drift = syncViews(views, battle);
    if (drift.length) console.warn('[battle] display resynced to the engine for', drift.join(', '));
    if (battle.phase === 'over') {
      // The engine always ends with an 'end' event; this is only a safety net.
      finish();
      return;
    }
    if (autoplay()) {
      if (menu) closeMenu();
      act(autoAction(battle));
      return;
    }
    if (battle.phase === 'switch') {
      forced = true;
      openMenu('swap');
    } else {
      openMenu('main');
    }
  }

  // -------------------------------------------------------------------------------------------
  // Simulation tick
  // -------------------------------------------------------------------------------------------

  function tickSlot(sl: Slot, dt: number): void {
    sl.flash = Math.max(0, sl.flash - dt / 0.28);
    sl.dodge = Math.max(0, sl.dodge - dt);
    if (sl.pose) {
      sl.poseT += dt;
      if (sl.poseT >= sl.poseDur) sl.pose = null;
    }
    if (sl.anim === 'enter' || sl.anim === 'leave' || sl.anim === 'faint' || sl.anim === 'flee') {
      sl.animT += dt;
      if (sl.anim === 'enter' && !sl.landed && sl.animT >= sl.animDur * 0.72) {
        sl.landed = true;
        const g = ground(sl.side);
        fx.burst(g.x, g.y - 3, '#f4e3c0', 8);
        const v = sl.uid ? views.get(sl.uid) : null;
        if (v?.isBoss) fx.shake(4);
        sfx('fluff', { volume: 0.45 });
      }
      if (sl.animT >= sl.animDur) {
        if (sl.anim === 'enter') sl.anim = 'idle';
        else {
          sl.anim = 'gone';
          sl.boxOn = false;
        }
      }
    }
    const target = sl.boxOn ? 1 : 0;
    if (sl.box < target) sl.box = Math.min(1, sl.box + dt / 0.22);
    else if (sl.box > target) sl.box = Math.max(0, sl.box - dt / 0.18);
  }

  function tick(dt: number): void {
    time += dt;
    introT += dt;
    fx.update(dt);
    for (const v of views.values()) tickView(v, dt);
    tickSlot(slots.player, dt);
    tickSlot(slots.enemy, dt);
    tw.update(dt);
    matchPulse = Math.max(0, matchPulse - dt / 0.9);
    if (matchup) stripAppear = Math.min(1, stripAppear + dt / 0.3);
    for (const b of banners) b.age += dt;
    banners = banners.filter((b) => b.age < b.dur);
    for (const f of floats) f.age += dt;
    floats = floats.filter((f) => f.age < 1);
    if (levelCard) {
      levelCard.age += dt;
      if (levelCard.age >= levelCard.dur) levelCard = null;
    }
    if (outro) outro.age += dt;
    if (introT < INTRO_DUR || finished) return;

    if (step) {
      step.age += dt;
      if (skipRequested) {
        if (step.text) {
          if (!tw.done) tw.skip();
          else step.left = 0;
        } else if (step.skippable && step.age >= step.minAge) {
          step.left = 0;
        }
      }
      if (!step.text || tw.done) step.left -= dt;
      if (step.left <= 0 && (!step.until || step.until())) {
        const done = step;
        step = null;
        done.onDone?.();
      }
    }
    skipRequested = false;
    let guard = 0;
    while (!step && queue.length && !finished && guard++ < 64) {
      const e = queue.shift() as BattleEvent;
      step = begin(e);
    }
    if (!step && !queue.length) idle();
  }

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  function drawSlot(ctx: Ctx, sl: Slot): void {
    if (!sl.uid || sl.anim === 'gone') return;
    const v = view(sl.uid);
    const g = ground(sl.side);
    const f = facing(sl.side);
    let x = g.x, y = g.y;
    let scale = battleScale(v);
    let alpha = 1;
    let pose: Pose = 'idle';
    let poseT = 0;
    const u = sl.animDur > 0 ? clamp01(sl.animT / sl.animDur) : 1;
    if (sl.anim === 'enter') {
      // pop out of a burst beside the platform, arc over it, then drop on
      const sx = g.x - f * 64, sy = g.y - 64;
      if (u < 0.4) {
        const k = u / 0.4;
        const e = outQuad(k);
        x = sx + (g.x - sx) * e;
        y = sy + (g.y - 34 - sy) * e - Math.sin(k * Math.PI) * 14;
        scale *= 0.2 + 0.8 * Math.min(1.08, outBack(k));
        alpha = Math.min(1, k * 4);
      } else if (u < 0.72) {
        const k = (u - 0.4) / 0.32;
        y = g.y - 34 * (1 - inQuad(k));
      } else {
        const k = (u - 0.72) / 0.28;
        y = g.y - Math.sin(k * Math.PI) * 4 * (1 - k);
      }
    } else if (sl.anim === 'leave') {
      scale *= 1 - 0.85 * inQuad(u);
      alpha = 1 - u * 0.9;
      y = g.y - 12 * u;
    } else if (sl.anim === 'faint') {
      pose = 'faint';
      poseT = u;
    } else if (sl.anim === 'flee') {
      // turn tail and scamper off the side of the screen
      const k = Math.max(0, u - 0.15) / 0.85;
      x = g.x - f * 300 * inQuad(k);
      y = g.y - Math.abs(Math.sin(u * 18)) * 3;
    }
    if (sl.anim !== 'faint') {
      if (sl.pose) { pose = sl.pose; poseT = clamp01(sl.poseT / Math.max(0.01, sl.poseDur)); }
      else if (victorySide === sl.side && ended) pose = 'happy';
      else if (v.status === 'snooze') pose = 'sleep';
    }
    if (sl.dodge > 0) x -= f * Math.sin((1 - sl.dodge / DODGE_DUR) * Math.PI) * 16;
    const fleeing = sl.anim === 'flee';
    if (fleeing) pose = 'run';
    drawMon(ctx, v, x, y, { scale, facing: fleeing ? (f === 1 ? -1 : 1) : f, t: time, pose, poseT, alpha, flash: sl.flash });
    if (v.confused && sl.anim === 'idle' && pose !== 'faint') {
      ctx.save();
      const h = v.h1 * scale;
      ctx.translate(Math.round(x + f * h * 0.14), Math.round(y - h * 0.94));
      ctx.scale(2, 2);
      drawDizzyStars(ctx, 0, 0, 9, time, 1);
      ctx.restore();
    }
  }

  function drawFloats(ctx: Ctx): void {
    for (const f of floats) {
      const u = f.age;
      const rise = Math.round(22 * outQuad(Math.min(1, u / 0.7)));
      ctx.save();
      ctx.globalAlpha = u > 0.75 ? Math.max(0, 1 - (u - 0.75) / 0.25) : 1;
      const pop = u < 0.12 ? 10 + Math.round(10 * (u / 0.12)) : 20;
      drawItemIcon(ctx, f.item, Math.round(f.x), Math.round(f.y - rise), pop);
      ctx.restore();
    }
  }

  function drawBottom(ctx: Ctx): void {
    const top = LAYOUT.band;
    ctx.fillStyle = UI.nightDark;
    ctx.fillRect(0, top, 640, 360 - top);
    ctx.fillStyle = UI.ink;
    ctx.fillRect(0, top - 1, 640, 1);
    ctx.fillStyle = UI.nightLight;
    ctx.fillRect(0, top, 640, 1);
    if (menu === null) {
      drawMessageBox(ctx, MSG_FULL.x, MSG_FULL.y, MSG_FULL.w, MSG_FULL.h, tw);
      return;
    }
    switch (menu) {
      case 'main':
        drawPrompt(ctx);
        break;
      case 'fight': {
        const me = activeMon(battle, 'player');
        const noPp = !me.moves.some((m) => m.pp > 0);
        const f = group.focus;
        drawMoveInfo(ctx, MOVE_INFO, f >= 0 && f < me.moves.length ? me.moves[f] : null, noPp);
        for (let i = me.moves.length; i < 4; i++) {
          const r = { x: 6 + (i % 2) * 218, y: 266 + Math.floor(i / 2) * 46, w: 212, h: 41 };
          fillRoundRect(ctx, r.x, r.y, r.w, r.h, 3, tint(UI.nightDark, 0.12));
          drawText(ctx, '-', r.x + r.w / 2, r.y + 17, { color: UI.textLightDim, align: 'center', shadow: false });
        }
        break;
      }
      case 'swap':
        drawPlaque(ctx, forced ? 'WHO WILL YOU SEND OUT NEXT?' : 'SWAP: WHO SHOULD GO IN?', 10, top - 9);
        break;
      case 'target':
        drawPlaque(ctx, `WHO GETS THE ${getItem(pickedItem ?? 'seedcake').name.toUpperCase()}?`, 10, top - 9);
        break;
      case 'bag':
        drawItemInfo(ctx);
        break;
      case 'retreat':
        drawMessageBox(ctx, MSG_LEFT.x, MSG_LEFT.y, MSG_LEFT.w, MSG_LEFT.h,
          'RETREAT TO THE BURROW? THE MISSION ENDS, BUT EVERYONE KEEPS THEIR XP.', { arrow: false });
        break;
    }
    group.draw(ctx);
  }

  /** The main menu's message: the question, plus a rock-paper-scissors tip for the current matchup. */
  function drawPrompt(ctx: Ctx): void {
    const r = MSG_LEFT;
    drawMessageBox(ctx, r.x, r.y, r.w, r.h, '', { arrow: false });
    const q = `WHAT WILL ${myName()} DO?`;
    const qh = drawWrapped(ctx, q, r.x + 12, r.y + 12, r.w - 28, { size: 2, color: UI.text, shadowColor: tint(UI.panelLight, -0.16) });
    const tip = tipText();
    if (tip) drawWrapped(ctx, tip, r.x + 12, Math.max(r.y + 14 + qh, r.y + r.h - 31), r.w - 28, { color: UI.textDim, shadow: false });
  }

  /**
   * A rock-paper-scissors tip that only states true type facts: "their type beats yours" only when
   * their type really hits yours super-effectively (the strip's FOE arrow is above X1), "bounces
   * off" when yours is resisted, and a SUPER-tag hint when a move can do better than the types.
   */
  function tipText(): string {
    if (!matchup) return '';
    const canSwap = legal(battle).switches.some(Boolean);
    const { fwd, back } = matchup;
    if (back > 1 && fwd > 1) return 'TIP: YOU BOTH HIT HARD HERE. STRIKE FIRST!';
    if (back > 1) return canSwap ? 'TIP: THEIR TYPE BEATS YOURS. A SWAP COULD HELP!' : 'TIP: THEIR TYPE BEATS YOURS. HIT HARD AND FAST!';
    if (fwd > 1) return 'TIP: YOUR TYPE BEATS THEIRS. GO GET THEM!';
    const me = activeMon(battle, 'player');
    const foe = activeView('enemy');
    const superMove = !!foe && me.moves.some((m) => m.pp > 0 && moveEffectiveness(m.id, foe.types) > 1 && getMove(m.id).power > 0);
    if (superMove) return fwd < 1 ? 'TIP: YOUR TYPE BOUNCES OFF THEIRS, BUT A MOVE WITH A SUPER TAG HITS HARD!' : 'TIP: A MOVE WITH A SUPER TAG HITS TWICE AS HARD!';
    if (fwd === 0) return canSwap ? 'TIP: YOUR TYPE HAS NO EFFECT ON THEIRS. TRY ANOTHER MOVE OR SWAP!' : 'TIP: YOUR TYPE HAS NO EFFECT ON THEIRS. TRY ANOTHER MOVE!';
    if (fwd < 1) return canSwap ? 'TIP: YOUR TYPE BOUNCES OFF THEIRS. TRY ANOTHER MOVE OR SWAP!' : 'TIP: YOUR TYPE BOUNCES OFF THEIRS. TRY ANOTHER MOVE!';
    return 'TIP: [?] TYPES SHOWS WHO BEATS WHO.';
  }

  function drawItemInfo(ctx: Ctx): void {
    const r = ITEM_INFO;
    drawPanel(ctx, r.x, r.y, r.w, r.h, { fill: UI.panelLight });
    const f = group.focus;
    const id = f >= 0 && f < ITEM_IDS.length ? ITEM_IDS[f] : null;
    if (!id) {
      drawText(ctx, 'BACK', r.x + 10, r.y + 8, { color: UI.text, shadow: false });
      drawWrapped(ctx, 'Back to the battle menu.', r.x + 10, r.y + 22, r.w - 20, { color: UI.textDim, shadow: false });
      return;
    }
    const def = getItem(id);
    const count = battle.items[id] ?? 0;
    drawItemIcon(ctx, id, r.x + 18, r.y + 15, 18);
    drawText(ctx, def.name.toUpperCase(), r.x + 32, r.y + 8, { color: UI.text, shadow: false });
    drawText(ctx, `YOU HAVE ${count}`, r.x + 32, r.y + 18, { color: UI.textDim, shadow: false });
    drawWrapped(ctx, def.description, r.x + 10, r.y + 33, r.w - 20, { color: UI.text, shadow: false });
    const usable = legal(battle).items.includes(id);
    const note = itemNote && ITEM_IDS[lastItemFocus] === id ? itemNote
      : !usable ? (count <= 0 ? 'NONE LEFT IN THE BAG!' : 'NOBODY NEEDS THAT RIGHT NOW.') : null;
    if (note) drawText(ctx, note, r.x + 10, r.y + 74, { color: UI.bad, shadow: false });
    else drawText(ctx, 'ENTER OR CLICK TO USE', r.x + 10, r.y + 74, { color: UI.textDim, shadow: false });
  }

  function drawIntro(ctx: Ctx): void {
    if (introT >= INTRO_DUR) return;
    const k = outQuad(clamp01(introT / INTRO_DUR));
    const h = Math.round(180 * (1 - k));
    ctx.fillStyle = UI.ink;
    ctx.fillRect(0, 0, 640, h);
    ctx.fillRect(0, 360 - h, 640, h);
    ctx.fillStyle = UI.gold;
    if (h > 2) { ctx.fillRect(0, h - 2, 640, 2); ctx.fillRect(0, 360 - h, 640, 2); }
  }

  // -------------------------------------------------------------------------------------------
  // The scene
  // -------------------------------------------------------------------------------------------

  const scene: Scene = {
    name: 'battle',

    enter() {
      const setup = encounterSetup(app.state, run);
      battle = createBattle(setup);
      app.debug.battle = battle;
      app.debug.battleUi = {
        menu: () => menu,
        busy: () => step !== null || queue.length > 0,
        /** The message box's line (full text) and whether it has finished typing. */
        text: () => tw.text,
        textDone: () => tw.done,
        focus: () => group.focus,
        levelCard: () => (levelCard ? levelCard.age : -1),
        outro: () => (outro ? outro.age : -1),
        banners: () => banners.length,
        time: () => time,
        /** Dev only: play extra events (the views resync to the engine at the next menu). */
        inject: (evs: BattleEvent[]) => { closeMenu(); queue.push(...evs); },
      };
      for (const m of [...battle.player.team, ...battle.enemy.team]) views.set(m.uid, makeView(m));
      playerTeam = battle.player.team.map((m) => view(m.uid));
      enemyTeam = battle.enemy.team.map((m) => view(m.uid));
      // (the mission screen shows the encounter's intro and the villain's taunt before the battle)
      queue.push(...startBattle(battle));
      const s = app.state.settings;
      if (s) { setSound(s.sound); setMusic(s.music); }
      music(battle.enemy.team.some((m) => m.isBoss) ? 'boss' : 'battle');
    },

    update(dt: number, input: Input) {
      if (finished) return;
      const auto = autoplay();
      if (menu === null) {
        if (input.confirm() || input.pointer.pressed) skipRequested = true;
      } else if (!auto) {
        group.update(input);
      }
      const n = auto ? 12 : 1;
      for (let i = 0; i < n && !finished; i++) tick(dt);
    },

    draw(ctx: Ctx) {
      if (!battle) return;
      const loc = getLocation(getMission(run.missionId).location);
      ctx.fillStyle = UI.ink;
      ctx.fillRect(0, 0, 640, 360);
      ctx.save();
      ctx.translate(fx.offsetX, fx.offsetY);
      drawBattleBackdrop(ctx, loc, time);
      const EP = LAYOUT.enemyPlatform, PP = LAYOUT.playerPlatform;
      drawPlatform(ctx, EP.x, EP.y, EP.w, loc);
      drawPlatform(ctx, PP.x, PP.y, PP.w, loc);
      drawSlot(ctx, slots.enemy);
      drawSlot(ctx, slots.player);
      fx.draw(ctx);
      drawFloats(ctx);
      const ev = activeView('enemy');
      if (ev && slots.enemy.box > 0) {
        const k = outQuad(slots.enemy.box);
        drawWeakRow(ctx, ev, k);
        drawEnemyBox(ctx, ev, enemyTeam, slots.enemy.uid, k);
      }
      if (stripAppear > 0) drawMatchup(ctx, matchup, matchPulse, outQuad(stripAppear), time);
      const pv = activeView('player');
      if (pv && slots.player.box > 0) drawPlayerBox(ctx, pv, playerTeam, slots.player.uid, outQuad(slots.player.box), time);
      for (const b of banners) drawAbilityBanner(ctx, b.text, b.side, b.age / b.dur);
      ctx.restore();
      if (levelCard) drawLevelCard(ctx, levelCard.name, levelCard.level, levelCard.gains, levelCard.age / levelCard.dur, time);
      if (outro) drawOutroBanner(ctx, outro.text, outro.color, outro.age, time);
      drawBottom(ctx);
      drawIntro(ctx);
    },
  };
  return scene;
}

// ---------------------------------------------------------------------------------------------
// Small icons for the main menu buttons
// ---------------------------------------------------------------------------------------------

function swapIcon(ctx: Ctx, cx: number, cy: number): void {
  drawText(ctx, '→', cx - 2, cy - 7, { color: UI.text, shadow: false });
  drawText(ctx, '←', cx - 3, cy - 1, { color: UI.text, shadow: false });
}

function retreatIcon(ctx: Ctx, cx: number, cy: number): void {
  fillRoundRect(ctx, cx - 6, cy - 6, 12, 12, 3, UI.ink);
  fillRoundRect(ctx, cx - 5, cy - 5, 10, 10, 2, '#fff6de');
  drawText(ctx, '←', cx - 2, cy - 3, { color: UI.bad, shadow: false });
}

function helpIcon(ctx: Ctx, cx: number, cy: number): void {
  fillRoundRect(ctx, cx - 6, cy - 6, 12, 12, 4, UI.ink);
  fillRoundRect(ctx, cx - 5, cy - 5, 10, 10, 3, '#4f9be0');
  drawText(ctx, '?', cx - 2, cy - 3, { color: '#ffffff', shadow: false });
}
