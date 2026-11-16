// The battle engine: Pokemon-style single battles, pure and synchronous. The UI hands in one
// decision; the engine resolves the whole turn and returns what happened as events, in order.
// All randomness comes from state.rng (seeded with setup.seed): same seed + same actions =>
// identical events. Rules: docs/DESIGN.md "Battle rules"; shapes: src/battle/types.ts.
import type { ItemId, MoveDef, StageChanges, StageStat, StatusId, TypeId } from '../data/schema.ts';
import { ITEM_IDS } from '../data/schema.ts';
import { getAbility, getItem, getType, getVillain } from '../data/index.ts';
import { MAX_LEVEL } from '../game/types.ts';
import { makeRng } from '../lib/engine/rng.ts';
import type { BattleEvent, BattleMon, BattleSetup, BattleState, PlayerAction, Side, SideState } from './types.ts';
import { buildMon, computeStats, emptyStages, freshVolatile, monDef, STAGE_STATS } from './build.ts';
import {
  CONFUSION_HIT, STRUGGLE, abilityOf, absorbs, battleMove, calcDamage, effectiveStat, findEffect, isDamaging,
  isTypeless, pinchActive,
} from './damage.ts';
import { typeEffectiveness } from './matchup.ts';
import { accStageMult, xpForLevel, xpYield } from './stats.ts';
import { chooseEnemyAction, chooseEnemyReplacement } from './ai.ts';

// ---------------------------------------------------------------------------------------------
// Per-call context and text helpers
// ---------------------------------------------------------------------------------------------

interface Ctx {
  s: BattleState;
  ev: BattleEvent[];
  /** uids with a queued move this turn that has not run yet (flinch only lands on these). */
  pending: Set<string>;
  /** uids that entered this turn (their turnsIn is not advanced at turn end). */
  entered: Set<string>;
  /** uids whose confusion ran out this turn (announced at turn end). */
  snapOut: Set<string>;
  /** uids whose faint has been announced during this call. */
  fainted: Set<string>;
  /** The player's active used a pivot move and will be swapped after the turn. */
  pivot: boolean;
}

type EffectResult = 'applied' | 'failed' | 'blocked' | 'none';

function newCtx(s: BattleState): Ctx {
  return { s, ev: [], pending: new Set(), entered: new Set(), snapOut: new Set(), fainted: new Set(), pivot: false };
}

function emit(c: Ctx, e: BattleEvent): void {
  c.ev.push(e);
  c.s.log.push(e);
}

function say(c: Ctx, text: string): void {
  emit(c, { t: 'text', text: text.toUpperCase() });
}

const NAME = (m: BattleMon): string => m.name.toUpperCase();

/** Sentence subject: player dragons by name, foes as "THE FOE'S NAME" (names already starting with THE stay as they are). */
function who(m: BattleMon): string {
  const n = NAME(m);
  return m.side === 'enemy' && !n.startsWith('THE ') ? `THE FOE'S ${n}` : n;
}

const poss = (m: BattleMon): string => `${who(m)}'S`;
const abName = (m: BattleMon): string => getAbility(m.ability).name.toUpperCase();

const STAGE_NAMES: Record<StageStat, string> = {
  atk: 'ATTACK', def: 'DEFENSE', spa: 'SP. ATK', spd: 'SP. DEF', spe: 'SPEED', acc: 'ACCURACY', eva: 'EVASION',
};
const STATUS_GAIN: Record<StatusId, string> = {
  burn: 'WAS BURNED!', goop: 'WAS COVERED IN GOOP!', zap: 'WAS ZAPPED! IT MAY BE UNABLE TO MOVE!',
  snooze: 'FELL ASLEEP!', frozen: 'WAS FROZEN SOLID!',
};
const STATUS_IMMUNE: Record<StatusId, string> = {
  burn: "CAN'T BE BURNED!", goop: "CAN'T BE GOOPED!", zap: "CAN'T BE ZAPPED!", snooze: "CAN'T FALL ASLEEP!", frozen: "CAN'T BE FROZEN!",
};
const STATUS_NOUN: Record<StatusId, string> = {
  burn: 'BURN', goop: 'GOOP', zap: 'ZAPS', snooze: 'SLEEPINESS', frozen: 'ICE',
};
const LOAF_LINES = [
  'IS LOAFING AROUND!',
  'TURNED AWAY AND SULKED!',
  'WOULD RATHER BE SNACKING!',
  'PRETENDED NOT TO HEAR YOU!',
];

// ---------------------------------------------------------------------------------------------
// Side helpers
// ---------------------------------------------------------------------------------------------

const sideOf = (s: BattleState, side: Side): SideState => (side === 'player' ? s.player : s.enemy);
const otherSide = (side: Side): Side => (side === 'player' ? 'enemy' : 'player');

export function activeMon(state: BattleState, side: Side): BattleMon {
  const st = sideOf(state, side);
  return st.team[st.active];
}

const foeOf = (s: BattleState, m: BattleMon): BattleMon => activeMon(s, otherSide(m.side));
const isActive = (s: BattleState, m: BattleMon): boolean => activeMon(s, m.side) === m;
/** Reads the phase through a call so TypeScript does not keep a stale narrowing across the turn. */
const isOver = (s: BattleState): boolean => s.phase === 'over';
const allFainted = (s: BattleState, side: Side): boolean => sideOf(s, side).team.every((m) => m.hp <= 0);

function healthyBench(s: BattleState, side: Side): boolean {
  const st = sideOf(s, side);
  return st.team.some((m, i) => i !== st.active && m.hp > 0);
}

/** Tell the scene a combatant's SEEDED / STUCK flags changed. */
function volatileEvent(c: Ctx, m: BattleMon): void {
  emit(c, { t: 'volatile', side: m.side, uid: m.uid, seeded: m.volatile.seeded, stuck: m.volatile.stuck });
}

function releaseTrapped(c: Ctx, trapper: BattleMon): void {
  for (const m of sideOf(c.s, otherSide(trapper.side)).team) {
    if (m.volatile.stuckBy === trapper.uid) {
      m.volatile.stuck = false;
      m.volatile.stuckBy = null;
      volatileEvent(c, m);
    }
  }
}

function clampStage(n: number): number {
  return Math.max(-6, Math.min(6, n));
}

// ---------------------------------------------------------------------------------------------
// HP, stages, status
// ---------------------------------------------------------------------------------------------

type DamageSource = 'move' | 'status' | 'recoil' | 'seed' | 'confusion';

/** Takes HP (never below 0) and emits the damage event. Returns the HP actually lost. */
function hurt(c: Ctx, m: BattleMon, amount: number, source: DamageSource, effectiveness = 1, crit = false): number {
  if (m.hp <= 0) return 0;
  const dealt = Math.max(0, Math.min(m.hp, Math.floor(amount)));
  if (dealt <= 0) return 0;
  m.hp -= dealt;
  emit(c, { t: 'damage', side: m.side, uid: m.uid, amount: dealt, hp: m.hp, maxHp: m.stats.hp, effectiveness, crit, source });
  return dealt;
}

/** Restores HP (never above max) and emits the heal event. Returns the HP actually gained. */
function heal(c: Ctx, m: BattleMon, amount: number): number {
  if (m.hp <= 0) return 0;
  const gained = Math.max(0, Math.min(m.stats.hp - m.hp, Math.floor(amount)));
  if (gained <= 0) return 0;
  m.hp += gained;
  emit(c, { t: 'heal', side: m.side, uid: m.uid, amount: gained, hp: m.hp, maxHp: m.stats.hp });
  return gained;
}

function abilityEvent(c: Ctx, m: BattleMon): void {
  emit(c, { t: 'ability', side: m.side, uid: m.uid, ability: m.ability });
}

/**
 * Changes stat stages. `byFoe` marks a change made by the opponent (clearBody blocks its drops).
 * Returns how many stats changed, and whether a message explained a non-change.
 */
function applyStages(c: Ctx, target: BattleMon, changes: StageChanges, byFoe: boolean): { n: number; explained: boolean } {
  if (target.hp <= 0) return { n: 0, explained: false };
  let explained = false;
  let ch = changes;
  if (byFoe && abilityOf(target).kind === 'clearBody' && STAGE_STATS.some((k) => (changes[k] ?? 0) < 0)) {
    abilityEvent(c, target);
    say(c, `${poss(target)} ${abName(target)} PREVENTS STAT DROPS!`);
    explained = true;
    ch = {};
    for (const k of STAGE_STATS) if ((changes[k] ?? 0) > 0) ch[k] = changes[k];
  }
  const applied: StageChanges = {};
  const lines: string[] = [];
  let n = 0;
  for (const k of STAGE_STATS) {
    const v = ch[k];
    if (!v) continue;
    const cur = target.stages[k];
    const next = clampStage(cur + v);
    const d = next - cur;
    if (d === 0) {
      lines.push(`${poss(target)} ${STAGE_NAMES[k]} WON'T GO ANY ${v > 0 ? 'HIGHER' : 'LOWER'}!`);
      explained = true;
      continue;
    }
    target.stages[k] = next;
    applied[k] = d;
    n++;
    const verb = d >= 3 ? 'ROSE DRASTICALLY!' : d === 2 ? 'ROSE SHARPLY!' : d === 1 ? 'ROSE!'
      : d === -1 ? 'FELL!' : d === -2 ? 'HARSHLY FELL!' : 'SEVERELY FELL!';
    lines.push(`${poss(target)} ${STAGE_NAMES[k]} ${verb}`);
  }
  if (n) emit(c, { t: 'stages', side: target.side, uid: target.uid, changes: applied });
  for (const l of lines) say(c, l);
  return { n, explained };
}

function typeImmuneToStatus(m: BattleMon, st: StatusId): boolean {
  const t = m.types;
  if (st === 'burn') return t.includes('FIRE');
  if (st === 'goop') return t.includes('SLIME') || t.includes('METAL');
  if (st === 'zap') return t.includes('LIGHTNING');
  if (st === 'frozen') return t.includes('FROST');
  return false;
}

function abilityBlocksStatus(m: BattleMon, st: StatusId): boolean {
  const ab = abilityOf(m);
  return ab.kind === 'statusImmune' && ab.statuses.includes(st);
}

/** Could `st` be given to `m` right now? */
function canInflict(m: BattleMon, st: StatusId): boolean {
  return m.hp > 0 && m.status === null && !typeImmuneToStatus(m, st) && !abilityBlocksStatus(m, st);
}

/** Inflicts a major status. `explain` prints why it could not (status moves); otherwise fails silently. */
function inflict(c: Ctx, target: BattleMon, st: StatusId, explain: boolean): EffectResult {
  if (target.hp <= 0 || target.status !== null) return 'failed';
  if (typeImmuneToStatus(target, st)) {
    if (!explain) return 'failed';
    say(c, `${who(target)} ${STATUS_IMMUNE[st]}`);
    return 'blocked';
  }
  if (abilityBlocksStatus(target, st)) {
    if (!explain) return 'failed';
    abilityEvent(c, target);
    say(c, `${poss(target)} ${abName(target)} PROTECTED IT!`);
    return 'blocked';
  }
  target.status = st;
  target.statusTurns = st === 'snooze' ? c.s.rng.int(1, 3) : 0;
  say(c, `${who(target)} ${STATUS_GAIN[st]}`);
  emit(c, { t: 'status', side: target.side, uid: target.uid, status: st });
  return 'applied';
}

function cureStatus(c: Ctx, m: BattleMon): void {
  m.status = null;
  m.statusTurns = 0;
  emit(c, { t: 'status', side: m.side, uid: m.uid, status: null });
}

// ---------------------------------------------------------------------------------------------
// Fainting, experience, the end
// ---------------------------------------------------------------------------------------------

function levelUp(c: Ctx, m: BattleMon): void {
  const oldMax = m.stats.hp;
  m.level++;
  m.stats = computeStats(m);
  if (m.hp > 0) m.hp = Math.max(1, Math.min(m.stats.hp, m.hp + (m.stats.hp - oldMax)));
  say(c, `${NAME(m)} GREW TO LV. ${m.level}!`);
  emit(c, { t: 'levelUp', uid: m.uid, level: m.level, stats: { ...m.stats } });
}

/** XP for every eligible player dragon, and training points for the participants. */
function awardXp(c: Ctx, foe: BattleMon): void {
  const def = monDef(foe);
  for (const m of c.s.player.team) {
    if (m.hp <= 0 || m.kind !== 'dragon' || m.level >= MAX_LEVEL) continue;
    const full = xpYield(def.baseXp, foe.level, m.level, foe.isBoss);
    const amount = m.participated ? full : Math.floor(full / 2);
    if (amount <= 0) continue;
    m.xp = Math.min(m.xp + amount, xpForLevel(MAX_LEVEL));
    say(c, `${NAME(m)} GAINED ${amount} XP!`);
    emit(c, { t: 'xp', uid: m.uid, amount, total: m.xp });
    while (m.level < MAX_LEVEL && m.xp >= xpForLevel(m.level + 1)) levelUp(c, m);
  }
  // Training: +2 in the defeated foe's highest base stat for every participant still standing.
  let best: keyof typeof def.baseStats = 'hp';
  for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const) if (def.baseStats[k] > def.baseStats[best]) best = k;
  for (const m of c.s.player.team) {
    if (m.hp <= 0 || !m.participated || m.kind !== 'dragon') continue;
    m.trainingGain[best] = (m.trainingGain[best] ?? 0) + 2;
  }
}

/** Announces a knockout (once), cleans up, pays out XP for foes, triggers moxie. */
function faintCheck(c: Ctx, m: BattleMon, killer: BattleMon | null): void {
  if (m.hp > 0 || c.fainted.has(m.uid)) return;
  c.fainted.add(m.uid);
  emit(c, { t: 'faint', side: m.side, uid: m.uid });
  say(c, `${who(m)} FAINTED!`);
  if (m.side === 'enemy' && m.kind === 'villain') {
    const line = getVillain(m.defId).defeat;
    if (line) say(c, `${NAME(m)}: "${line}"`);
  }
  m.status = null;
  m.statusTurns = 0;
  m.stages = emptyStages();
  m.volatile = freshVolatile();
  releaseTrapped(c, m);
  if (m.side === 'enemy') awardXp(c, m);
  if (killer && killer.hp > 0 && killer.side !== m.side && isActive(c.s, killer) && abilityOf(killer).kind === 'moxie') {
    abilityEvent(c, killer);
    say(c, `${poss(killer)} ${abName(killer)} KICKED IN!`);
    applyStages(c, killer, { atk: 1 }, false);
  }
}

function endBattle(c: Ctx, winner: Side | 'retreat'): void {
  const s = c.s;
  s.phase = 'over';
  s.winner = winner;
  if (winner === 'player') say(c, 'YOU WON THE BATTLE!');
  else if (winner === 'enemy') say(c, 'YOUR SQUAD IS ALL TUCKERED OUT! TIME TO REGROUP...');
  else say(c, 'YOUR SQUAD SCURRIED BACK TO SAFETY!');
  emit(c, { t: 'end', winner });
}

/** Ends the battle if a side is wiped out. A double wipe-out goes to the player. */
function checkOver(c: Ctx): boolean {
  const s = c.s;
  if (s.phase === 'over') return true;
  if (allFainted(s, 'enemy')) {
    endBattle(c, 'player');
    return true;
  }
  if (allFainted(s, 'player')) {
    endBattle(c, 'enemy');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Entering and leaving
// ---------------------------------------------------------------------------------------------

function entryAbility(c: Ctx, m: BattleMon): void {
  if (m.hp <= 0) return;
  const ab = abilityOf(m);
  if (ab.kind === 'entry') {
    const target = ab.who === 'self' ? m : foeOf(c.s, m);
    if (target.hp <= 0) return;
    abilityEvent(c, m);
    say(c, `${poss(m)} ${abName(m)} KICKED IN!`);
    applyStages(c, target, ab.changes, ab.who === 'foe');
  } else if (ab.kind === 'pressure') {
    abilityEvent(c, m);
    say(c, `${who(m)} IS PUTTING ON THE PRESSURE!`);
  }
}

function sendOut(c: Ctx, side: Side, index: number, opts: { text: boolean; entry: boolean }): void {
  const st = sideOf(c.s, side);
  st.active = index;
  const m = st.team[index];
  m.volatile = freshVolatile();
  const first = !m.participated;
  m.participated = true;
  c.entered.add(m.uid);
  if (opts.text) say(c, side === 'player' ? `GO! ${NAME(m)}!` : `THE FOE SENT OUT ${NAME(m)}!`);
  emit(c, { t: 'sendOut', side, uid: m.uid, index });
  if (first && STAGE_STATS.some((k) => m.stages[k] !== 0)) {
    const changes: StageChanges = {};
    for (const k of STAGE_STATS) if (m.stages[k] !== 0) changes[k] = m.stages[k];
    say(c, `${who(m)} IS SUPERCHARGED!`);
    emit(c, { t: 'stages', side, uid: m.uid, changes });
  }
  if (opts.entry) entryAbility(c, m);
}

function withdraw(c: Ctx, m: BattleMon, text: boolean): void {
  if (text) say(c, m.side === 'player' ? `${NAME(m)}, COME BACK!` : `THE FOE CALLED BACK ${NAME(m)}!`);
  const ab = abilityOf(m);
  if (m.hp > 0 && ab.kind === 'switchHeal' && m.hp < m.stats.hp) {
    abilityEvent(c, m);
    say(c, `${poss(m)} ${abName(m)} PATCHED IT UP!`);
    heal(c, m, Math.max(1, Math.floor(m.stats.hp * ab.fraction)));
  }
  if (m.hp > 0 && ab.kind === 'switchCure' && m.status) {
    abilityEvent(c, m);
    say(c, `${poss(m)} ${abName(m)} SHOOK OFF ITS ${STATUS_NOUN[m.status]}!`);
    cureStatus(c, m);
  }
  emit(c, { t: 'withdraw', side: m.side, uid: m.uid });
  m.stages = emptyStages();
  m.volatile = freshVolatile();
  releaseTrapped(c, m);
}

/** The boss AI's counter-swap: the rock-paper-scissors moment, announced as such. */
function enemySwap(c: Ctx, index: number): void {
  const s = c.s;
  const old = activeMon(s, 'enemy');
  const incoming = s.enemy.team[index];
  const p = activeMon(s, 'player');
  let threat: TypeId | null = null;
  let best = 1;
  if (p.hp > 0) {
    for (const t of p.types) {
      const e = typeEffectiveness(t, old.types);
      if (e > best) {
        best = e;
        threat = t;
      }
    }
  }
  if (threat) say(c, `${who(old)} SAW YOUR ${getType(threat).name.toUpperCase()} TYPE COMING AND SWAPPED IN ${NAME(incoming)}!`);
  else say(c, `THE FOE SWAPPED ${NAME(old)} FOR ${NAME(incoming)}!`);
  withdraw(c, old, false);
  sendOut(c, 'enemy', index, { text: false, entry: true });
  s.enemySwaps++;
}

// ---------------------------------------------------------------------------------------------
// Using a move
// ---------------------------------------------------------------------------------------------

/** Sleep, freeze, loafing, flinch, confusion and zap checks. False = the turn is lost. */
function canAct(c: Ctx, m: BattleMon, move: MoveDef): boolean {
  const s = c.s;
  if (m.status === 'snooze') {
    if (m.statusTurns > 0) {
      m.statusTurns--;
      say(c, `${who(m)} IS FAST ASLEEP.`);
      return false;
    }
    say(c, `${who(m)} WOKE UP!`);
    cureStatus(c, m);
  }
  if (m.status === 'frozen') {
    if (findEffect(move, 'thaw') || s.rng.next() < 0.2) {
      say(c, `${who(m)} THAWED OUT!`);
      cureStatus(c, m);
    } else {
      say(c, `${who(m)} IS FROZEN SOLID!`);
      return false;
    }
  }
  if (m.happiness <= 20 && s.rng.next() < 0.15) {
    say(c, `${who(m)} ${s.rng.pick(LOAF_LINES) ?? LOAF_LINES[0]}`);
    return false;
  }
  if (m.volatile.flinch) {
    say(c, `${who(m)} FLINCHED!`);
    return false;
  }
  if (m.volatile.confused > 0) {
    m.volatile.confused--;
    if (m.volatile.confused === 0) c.snapOut.add(m.uid);
    say(c, `${who(m)} IS CONFUSED!`);
    if (s.rng.next() < 1 / 3) {
      say(c, 'IT HURT ITSELF IN ITS CONFUSION!');
      const r = calcDamage(s, m, m, CONFUSION_HIT, { forceCrit: false });
      if (hurt(c, m, r.damage, 'confusion') > 0) faintCheck(c, m, null);
      return false;
    }
  }
  if (m.status === 'zap' && s.rng.next() < 0.25) {
    say(c, `${who(m)} IS ZAPPED! IT CAN'T MOVE!`);
    return false;
  }
  return true;
}

function rollHits(c: Ctx, min: number, max: number): number {
  const lo = Math.max(1, Math.floor(min));
  const hi = Math.max(lo, Math.floor(max));
  if (lo === hi) return lo;
  if (lo === 2 && hi === 5) {
    const r = c.s.rng.int(1, 100);
    return r <= 35 ? 2 : r <= 70 ? 3 : r <= 85 ? 4 : 5;
  }
  return c.s.rng.int(lo, hi);
}

/** Sturdy and the happy-dragon endure turn a KO into 1 HP. */
function hitFor(c: Ctx, target: BattleMon, damage: number, eff: number, crit: boolean): { dealt: number; saved: 'sturdy' | 'endure' | null } {
  let amount = damage;
  let saved: 'sturdy' | 'endure' | null = null;
  if (amount >= target.hp && target.hp > 1) {
    if (abilityOf(target).kind === 'sturdy' && target.hp >= target.stats.hp) {
      amount = target.hp - 1;
      saved = 'sturdy';
    } else if (target.happiness >= 80 && c.s.rng.next() < 0.1) {
      amount = target.hp - 1;
      saved = 'endure';
    }
  }
  return { dealt: hurt(c, target, amount, 'move', eff, crit), saved };
}

function contactPunish(c: Ctx, holder: BattleMon, attacker: BattleMon): void {
  if (attacker.hp <= 0) return;
  const ab = abilityOf(holder);
  if (ab.kind === 'contactStatus') {
    if (c.s.rng.int(1, 100) > ab.chance || !canInflict(attacker, ab.status)) return;
    abilityEvent(c, holder);
    say(c, `${poss(holder)} ${abName(holder)} STRUCK BACK!`);
    inflict(c, attacker, ab.status, false);
  } else if (ab.kind === 'contactStages') {
    abilityEvent(c, holder);
    say(c, `${poss(holder)} ${abName(holder)} STRUCK BACK!`);
    applyStages(c, attacker, ab.changes, true);
  }
}

/** The damage part of a move: hits, crits, sturdy/endure, thaw, contact abilities, effectiveness text. */
function dealDamage(c: Ctx, user: BattleMon, foe: BattleMon, move: MoveDef): number {
  const s = c.s;
  const typeless = isTypeless(move);
  const eff0 = typeless ? 1 : typeEffectiveness(move.type, foe.types);
  if (pinchActive(user, move) && move.power > 0) {
    abilityEvent(c, user);
    say(c, `${poss(user)} ${abName(user)} FLARED UP!`);
  }
  const defAb = abilityOf(foe);
  const fixed = !!findEffect(move, 'fixed');
  if (!fixed && !typeless) {
    const soft = (defAb.kind === 'resist' && defAb.types.includes(move.type))
      || (defAb.kind === 'filter' && eff0 > 1)
      || (defAb.kind === 'multiscale' && foe.hp >= foe.stats.hp);
    if (soft) {
      abilityEvent(c, foe);
      say(c, `${poss(foe)} ${abName(foe)} SOFTENED THE BLOW!`);
    }
  }
  const mh = findEffect(move, 'multiHit');
  const hits = mh ? rollHits(c, mh.min, mh.max) : 1;
  let total = 0;
  let landed = 0;
  let eff = eff0;
  for (let i = 0; i < hits; i++) {
    if (foe.hp <= 0 || user.hp <= 0) break;
    const r = calcDamage(s, user, foe, move);
    eff = r.effectiveness;
    const { dealt, saved } = hitFor(c, foe, r.damage, r.effectiveness, r.crit);
    total += dealt;
    landed++;
    if (r.crit) say(c, 'A CRITICAL HIT!');
    if (saved === 'sturdy') {
      abilityEvent(c, foe);
      say(c, `${who(foe)} HUNG ON THANKS TO ITS ${abName(foe)}!`);
    } else if (saved === 'endure') {
      say(c, foe.side === 'player' ? `${who(foe)} TOUGHED IT OUT SO YOU WOULDN'T WORRY!` : `${who(foe)} TOUGHED IT OUT!`);
    }
    if (foe.status === 'frozen' && foe.hp > 0 && !typeless && move.type === 'FIRE') {
      say(c, `${who(foe)} THAWED OUT!`);
      cureStatus(c, foe);
    }
    if (move.contact) contactPunish(c, foe, user);
  }
  if (mh) say(c, `IT HIT ${landed} TIME${landed === 1 ? '' : 'S'}!`);
  if (!fixed && !typeless) {
    if (eff > 1) say(c, "IT'S SUPER EFFECTIVE!");
    else if (eff > 0 && eff < 1) say(c, "IT'S NOT VERY EFFECTIVE...");
  }
  return total;
}

/** One side effect of a move. */
function applyEffect(c: Ctx, user: BattleMon, foe: BattleMon, move: MoveDef, e: MoveDef['effects'][number], damaging: boolean, dealt: number): EffectResult {
  const s = c.s;
  const roll = (chance: number): boolean => {
    if (chance >= 100) return true;
    if (damaging && dealt <= 0) return false;
    const ch = abilityOf(user).kind === 'sereneGrace' ? Math.min(100, chance * 2) : chance;
    return s.rng.int(1, 100) <= ch;
  };
  switch (e.kind) {
    case 'inflict':
      if (foe.hp <= 0 || !roll(e.chance)) return 'failed';
      return inflict(c, foe, e.status, !damaging);
    case 'confuse':
      if (foe.hp <= 0 || foe.volatile.confused > 0 || !roll(e.chance)) return 'failed';
      if (abilityOf(foe).kind === 'innerFocus') {
        abilityEvent(c, foe);
        say(c, `${poss(foe)} ${abName(foe)} KEPT IT FOCUSED!`);
        return 'blocked';
      }
      foe.volatile.confused = s.rng.int(2, 5);
      say(c, `${who(foe)} BECAME CONFUSED!`);
      emit(c, { t: 'confuse', side: foe.side, uid: foe.uid, on: true });
      return 'applied';
    case 'flinch':
    case 'firstTurn': {
      if (foe.hp <= 0 || !c.pending.has(foe.uid)) return 'failed';
      if (e.kind === 'flinch' && !roll(e.chance)) return 'failed';
      if (abilityOf(foe).kind === 'innerFocus') {
        abilityEvent(c, foe);
        say(c, `${poss(foe)} ${abName(foe)} KEPT IT FOCUSED!`);
        return 'blocked';
      }
      foe.volatile.flinch = true;
      return 'applied';
    }
    case 'stages': {
      const target = e.who === 'self' ? user : foe;
      if (target.hp <= 0 || !roll(e.chance)) return 'failed';
      const r = applyStages(c, target, e.changes, e.who === 'foe');
      return r.n > 0 ? 'applied' : r.explained ? 'blocked' : 'failed';
    }
    case 'heal':
      if (user.hp <= 0) return 'failed';
      if (user.hp >= user.stats.hp) {
        say(c, `${poss(user)} HP IS ALREADY FULL!`);
        return 'blocked';
      }
      say(c, `${who(user)} REGAINED HEALTH!`);
      heal(c, user, Math.max(1, Math.floor(user.stats.hp * e.fraction)));
      return 'applied';
    case 'drain':
      if (dealt <= 0 || user.hp <= 0 || user.hp >= user.stats.hp) return 'failed';
      say(c, `${who(foe)} HAD ITS ENERGY DRAINED!`);
      heal(c, user, Math.max(1, Math.floor(dealt * e.fraction)));
      return 'applied';
    case 'recoil':
      if (dealt <= 0 || user.hp <= 0 || abilityOf(user).kind === 'rockHead') return 'failed';
      say(c, `${who(user)} IS HIT WITH RECOIL!`);
      hurt(c, user, Math.max(1, Math.floor(dealt * e.fraction)), 'recoil');
      return 'applied';
    case 'protect': {
      const chain = user.volatile.protectChain;
      if (chain > 0 && !(s.rng.next() < Math.pow(1 / 3, chain))) {
        user.volatile.protectChain = 0;
        return 'failed';
      }
      user.volatile.protecting = true;
      user.volatile.protectChain = chain + 1;
      say(c, `${who(user)} PROTECTED ITSELF!`);
      emit(c, { t: 'protect', side: user.side, uid: user.uid });
      return 'applied';
    }
    case 'trap':
      if (foe.hp <= 0 || foe.volatile.stuck) return 'failed';
      foe.volatile.stuck = true;
      foe.volatile.stuckBy = user.uid;
      volatileEvent(c, foe);
      say(c, `${who(foe)} CAN'T ESCAPE NOW!`);
      return 'applied';
    case 'cure': {
      const mons = e.who === 'self' ? [user] : sideOf(s, user.side).team;
      const sick = mons.filter((m) => m.hp > 0 && m.status !== null);
      if (!sick.length) return 'failed';
      if (e.who === 'team') say(c, 'A SOOTHING CALM WASHED OVER THE TEAM!');
      for (const m of sick) {
        say(c, `${who(m)} SHOOK OFF ITS ${STATUS_NOUN[m.status as StatusId]}!`);
        cureStatus(c, m);
      }
      return 'applied';
    }
    case 'resetStages': {
      let any = false;
      for (const m of [user, foe]) {
        if (!STAGE_STATS.some((k) => m.stages[k] !== 0)) continue;
        const changes: StageChanges = {};
        for (const k of STAGE_STATS) if (m.stages[k] !== 0) changes[k] = -m.stages[k];
        m.stages = emptyStages();
        emit(c, { t: 'stages', side: m.side, uid: m.uid, changes });
        any = true;
      }
      if (!any) return 'failed';
      say(c, 'ALL STAT CHANGES WERE WIPED AWAY!');
      return 'applied';
    }
    case 'seed':
      if (foe.hp <= 0 || foe.volatile.seeded) return 'failed';
      if (foe.types.includes('LEAF')) {
        if (damaging) return 'failed';
        say(c, `${who(foe)} IS A LEAF TYPE, SO THE SEEDS WON'T STICK!`);
        return 'blocked';
      }
      foe.volatile.seeded = true;
      volatileEvent(c, foe);
      say(c, `${who(foe)} WAS SEEDED!`);
      return 'applied';
    case 'pivot':
      return user.hp > 0 && healthyBench(s, user.side) ? 'applied' : 'failed';
    case 'rest':
      if (user.hp <= 0 || user.status === 'snooze') return 'failed';
      if (abilityBlocksStatus(user, 'snooze')) {
        abilityEvent(c, user);
        say(c, `${poss(user)} ${abName(user)} KEEPS IT WIDE AWAKE!`);
        return 'blocked';
      }
      if (user.hp >= user.stats.hp && user.status === null) {
        say(c, `${poss(user)} HP IS ALREADY FULL!`);
        return 'blocked';
      }
      say(c, `${who(user)} CURLED UP FOR A NAP AND BECAME HEALTHY!`);
      heal(c, user, user.stats.hp);
      user.status = 'snooze';
      user.statusTurns = 2;
      emit(c, { t: 'status', side: user.side, uid: user.uid, status: 'snooze' });
      return 'applied';
    case 'multiHit': case 'highCrit': case 'fixed': case 'sureHit': case 'thaw': case 'facade': case 'hex':
      return 'none';
  }
}

/** Absorb abilities swallow moves of their type (healing and/or boosting instead). */
function absorbHit(c: Ctx, holder: BattleMon): void {
  const ab = abilityOf(holder);
  if (ab.kind !== 'absorb') return;
  abilityEvent(c, holder);
  const canHeal = ab.heal > 0 && holder.hp < holder.stats.hp;
  const boost = ab.boost && STAGE_STATS.some((k) => (ab.boost?.[k] ?? 0) !== 0) ? ab.boost : undefined;
  if (!canHeal && !boost) {
    say(c, `${poss(holder)} ${abName(holder)} MADE IT IMMUNE!`);
    return;
  }
  say(c, `${poss(holder)} ${abName(holder)} SOAKED UP THE ATTACK!`);
  if (canHeal) {
    say(c, `${who(holder)} REGAINED HEALTH!`);
    heal(c, holder, Math.max(1, Math.floor(holder.stats.hp * ab.heal)));
  }
  if (boost) applyStages(c, holder, boost, false);
}

function enemyPivot(c: Ctx, user: BattleMon): void {
  const idx = chooseEnemyReplacement(c.s);
  if (idx < 0) return;
  withdraw(c, user, true);
  sendOut(c, 'enemy', idx, { text: true, entry: true });
}

/** Resolves a move after the user has been cleared to act. */
function executeMove(c: Ctx, user: BattleMon, move: MoveDef): void {
  const s = c.s;
  const foe = foeOf(s, user);
  const foeWasUp = foe.hp > 0;
  const damaging = isDamaging(move);
  if (findEffect(move, 'firstTurn') && user.volatile.turnsIn !== 0) {
    say(c, 'BUT IT FAILED!');
    return;
  }
  if (move.target === 'foe') {
    if (foe.hp <= 0) {
      say(c, 'BUT THERE WAS NO TARGET!');
      return;
    }
    if (foe.volatile.protecting) {
      emit(c, { t: 'protect', side: foe.side, uid: foe.uid });
      say(c, `${who(foe)} PROTECTED ITSELF!`);
      return;
    }
    if (absorbs(foe, move)) {
      absorbHit(c, foe);
      return;
    }
    if (damaging && !isTypeless(move) && typeEffectiveness(move.type, foe.types) === 0) {
      say(c, 'IT HAD NO EFFECT!');
      return;
    }
    if (!findEffect(move, 'sureHit')) {
      const stage = clampStage(user.stages.acc - foe.stages.eva);
      const acc = Math.min(100, move.accuracy * accStageMult(stage));
      if (!(s.rng.int(0, 99) < acc)) {
        emit(c, { t: 'miss', side: foe.side, uid: foe.uid });
        say(c, damaging ? `${poss(user)} ATTACK MISSED!` : 'BUT IT MISSED!');
        return;
      }
    }
  }

  const dealt = damaging ? dealDamage(c, user, foe, move) : 0;
  let applied = 0;
  let blocked = 0;
  let pivot = false;
  for (const e of move.effects) {
    const r = applyEffect(c, user, foe, move, e, damaging, dealt);
    if (r === 'applied') applied++;
    if (r === 'blocked') blocked++;
    if (e.kind === 'pivot' && r === 'applied') pivot = true;
  }
  if (move.id === STRUGGLE.id && user.hp > 0) {
    say(c, `${who(user)} IS HIT WITH RECOIL!`);
    hurt(c, user, Math.max(1, Math.floor(user.stats.hp / 4)), 'recoil');
  }
  if (!damaging && applied === 0 && blocked === 0) say(c, 'BUT IT FAILED!');

  if (foeWasUp) faintCheck(c, foe, user);
  faintCheck(c, user, foe);
  if (checkOver(c)) return;
  if (pivot && user.hp > 0 && isActive(s, user) && healthyBench(s, user.side)) {
    if (user.side === 'enemy') enemyPivot(c, user);
    else c.pivot = true;
  }
}

/** One combatant's move action for the turn (slot index; Struggle when nothing has PP). */
function runMoveAction(c: Ctx, user: BattleMon, slotIndex: number): void {
  c.pending.delete(user.uid);
  const s = c.s;
  if (s.phase === 'over' || user.hp <= 0 || !isActive(s, user)) return;
  const usable = user.moves.some((m) => m.pp > 0);
  let slot = usable ? user.moves[slotIndex] : undefined;
  if (usable && (!slot || slot.pp <= 0)) slot = user.moves.find((m) => m.pp > 0);
  const move = slot ? battleMove(slot.id) : STRUGGLE;
  if (!canAct(c, user, move)) {
    checkOver(c);
    return;
  }
  if (slot) {
    const foe = foeOf(s, user);
    const cost = foe.hp > 0 && abilityOf(foe).kind === 'pressure' ? 2 : 1;
    slot.pp = Math.max(0, slot.pp - cost);
  } else {
    say(c, `${who(user)} HAS NO MOVES LEFT!`);
  }
  say(c, `${who(user)} USED ${move.name.toUpperCase()}!`);
  if (slot) emit(c, { t: 'useMove', side: user.side, uid: user.uid, move: slot.id });
  executeMove(c, user, move);
}

// ---------------------------------------------------------------------------------------------
// End of turn
// ---------------------------------------------------------------------------------------------

function bySpeed(s: BattleState): BattleMon[] {
  const p = activeMon(s, 'player');
  const e = activeMon(s, 'enemy');
  return effectiveStat(e, 'spe') > effectiveStat(p, 'spe') ? [e, p] : [p, e];
}

function endOfTurn(c: Ctx): void {
  const s = c.s;
  const mons = bySpeed(s);
  // 1. burn / goop
  for (const m of mons) {
    if (m.hp <= 0 || (m.status !== 'burn' && m.status !== 'goop')) continue;
    const burn = m.status === 'burn';
    say(c, burn ? `${who(m)} IS HURT BY ITS BURN!` : `${who(m)} IS HURT BY THE GOOP!`);
    if (hurt(c, m, Math.max(1, Math.floor(m.stats.hp / (burn ? 16 : 8))), 'status') > 0) faintCheck(c, m, null);
    if (checkOver(c)) return;
  }
  // 2. seeds
  for (const m of mons) {
    if (m.hp <= 0 || !m.volatile.seeded) continue;
    say(c, `${poss(m)} HEALTH IS SAPPED BY THE SEEDS!`);
    const lost = hurt(c, m, Math.max(1, Math.floor(m.stats.hp / 8)), 'seed');
    const other = foeOf(s, m);
    if (lost > 0 && other.hp > 0 && other.hp < other.stats.hp) {
      say(c, `${who(other)} SOAKED UP THE STOLEN HEALTH!`);
      heal(c, other, lost);
    }
    if (lost > 0) faintCheck(c, m, null);
    if (checkOver(c)) return;
  }
  // 3. regenTurn, 4. speedBoost, 5. shedSkin
  for (const m of mons) {
    const ab = abilityOf(m);
    if (m.hp > 0 && ab.kind === 'regenTurn' && m.hp < m.stats.hp) {
      abilityEvent(c, m);
      say(c, `${poss(m)} ${abName(m)} RESTORED SOME HP!`);
      heal(c, m, Math.max(1, Math.floor(m.stats.hp * ab.fraction)));
    }
  }
  for (const m of mons) {
    if (m.hp > 0 && abilityOf(m).kind === 'speedBoost' && m.stages.spe < 6) {
      abilityEvent(c, m);
      say(c, `${poss(m)} ${abName(m)} KICKED IN!`);
      applyStages(c, m, { spe: 1 }, false);
    }
  }
  for (const m of mons) {
    const ab = abilityOf(m);
    if (m.hp > 0 && ab.kind === 'shedSkin' && m.status !== null && s.rng.int(1, 100) <= ab.chance) {
      abilityEvent(c, m);
      say(c, `${poss(m)} ${abName(m)} SHOOK OFF ITS ${STATUS_NOUN[m.status]}!`);
      cureStatus(c, m);
    }
  }
  // 6. volatile bookkeeping
  for (const m of mons) {
    if (c.snapOut.has(m.uid) && m.hp > 0 && m.volatile.confused === 0) {
      say(c, `${who(m)} SNAPPED OUT OF ITS CONFUSION!`);
      emit(c, { t: 'confuse', side: m.side, uid: m.uid, on: false });
    }
    m.volatile.flinch = false;
    if (!m.volatile.protecting) m.volatile.protectChain = 0;
    m.volatile.protecting = false;
    if (m.hp > 0 && !c.entered.has(m.uid)) m.volatile.turnsIn++;
  }
}

/** Replacements after the turn: the AI sends its next fighter, the player may have to choose. */
function afterTurn(c: Ctx): void {
  const s = c.s;
  if (s.phase === 'over') return;
  const e = activeMon(s, 'enemy');
  if (e.hp <= 0 && healthyBench(s, 'enemy')) {
    const idx = chooseEnemyReplacement(s);
    if (idx >= 0) sendOut(c, 'enemy', idx, { text: true, entry: true });
  }
  const p = activeMon(s, 'player');
  if (p.hp <= 0) {
    s.phase = healthyBench(s, 'player') ? 'switch' : s.phase;
    if (s.phase === 'switch') say(c, 'WHO WILL YOU SEND OUT NEXT?');
  } else if (c.pivot && healthyBench(s, 'player')) {
    s.phase = 'switch';
    say(c, `${who(p)} IS READY TO TAG OUT!`);
  } else {
    s.phase = 'choose';
  }
  checkOver(c);
}

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

/**
 * Can the player use `item` on team member `index` right now? Heals need a hurt, conscious target;
 * revives a fainted one; cures a status (or the active one's confusion); stat items the active
 * dragon, with room left on a stage they raise. legal().items and submitTurn use the same rule.
 */
export function itemTargetOk(s: BattleState, item: ItemId, index: number): boolean {
  const team = s.player.team;
  const m = team[index];
  if (!m) return false;
  const eff = getItem(item).effect;
  switch (eff.kind) {
    case 'heal': return m.hp > 0 && m.hp < m.stats.hp;
    case 'revive': return m.hp <= 0;
    case 'cure': return m.hp > 0 && (m.status !== null || (index === s.player.active && m.volatile.confused > 0));
    case 'stages':
      return index === s.player.active && m.hp > 0
        && STAGE_STATS.some((k) => { const v = eff.changes[k] ?? 0; return (v > 0 && m.stages[k] < 6) || (v < 0 && m.stages[k] > -6); });
  }
}

function usableItems(s: BattleState): ItemId[] {
  return ITEM_IDS.filter((id) => (s.items[id] ?? 0) > 0 && s.player.team.some((_, i) => itemTargetOk(s, id, i)));
}

function useItem(c: Ctx, item: ItemId, index: number): void {
  const s = c.s;
  const def = getItem(item);
  const m = s.player.team[index];
  s.items[item] = Math.max(0, (s.items[item] ?? 0) - 1);
  const nm = def.name.toUpperCase();
  const article = /^[AEIOU]/.test(nm) ? 'AN' : 'A';
  say(c, `YOU GAVE ${NAME(m)} ${article} ${nm}!`);
  emit(c, { t: 'item', side: 'player', uid: m.uid, item });
  const eff = def.effect;
  switch (eff.kind) {
    case 'heal': {
      const gained = heal(c, m, Math.max(1, Math.floor(m.stats.hp * eff.fraction)));
      say(c, `${NAME(m)} RECOVERED ${gained} HP!`);
      break;
    }
    case 'revive': {
      m.hp = Math.max(1, Math.floor(m.stats.hp * eff.fraction));
      m.status = null;
      m.statusTurns = 0;
      emit(c, { t: 'heal', side: m.side, uid: m.uid, amount: m.hp, hp: m.hp, maxHp: m.stats.hp });
      say(c, `${NAME(m)} PERKED RIGHT BACK UP!`);
      break;
    }
    case 'cure':
      if (m.status) cureStatus(c, m);
      if (m.volatile.confused > 0) {
        m.volatile.confused = 0;
        emit(c, { t: 'confuse', side: m.side, uid: m.uid, on: false });
      }
      say(c, `${NAME(m)} FEELS ALL BETTER!`);
      break;
    case 'stages':
      applyStages(c, m, eff.changes, false);
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export function createBattle(setup: BattleSetup): BattleState {
  if (!setup.player.length || !setup.enemy.length) throw new Error('createBattle: both sides need at least one combatant');
  const rng = makeRng(setup.seed);
  const player = setup.player.map((m, i) => buildMon(m, 'player', i));
  const enemy = setup.enemy.map((m, i) => buildMon(m, 'enemy', i));
  for (const m of [...player, ...enemy]) if (m.status === 'snooze') m.statusTurns = rng.int(1, 3);
  const firstUp = (team: BattleMon[]): number => Math.max(0, team.findIndex((m) => m.hp > 0));
  return {
    rng,
    turn: 0,
    player: { team: player, active: firstUp(player) },
    enemy: { team: enemy, active: firstUp(enemy) },
    aiLevel: setup.aiLevel,
    items: { ...setup.items },
    canRetreat: setup.canRetreat,
    phase: 'choose',
    winner: null,
    enemySwaps: 0,
    log: [],
  };
}

/** Sends out both leads (foe first) and runs entry abilities in speed order. */
export function startBattle(state: BattleState): BattleEvent[] {
  const c = newCtx(state);
  if (checkOver(c)) return c.ev;
  sendOut(c, 'enemy', state.enemy.active, { text: true, entry: false });
  sendOut(c, 'player', state.player.active, { text: true, entry: false });
  for (const m of bySpeed(state)) entryAbility(c, m);
  state.phase = 'choose';
  return c.ev;
}

export function legal(state: BattleState): { moves: boolean[]; switches: boolean[]; items: ItemId[]; retreat: boolean; mustSwitch: boolean } {
  const p = state.player;
  const me = p.team[p.active];
  const bench = p.team.map((m, i) => i !== p.active && m.hp > 0);
  if (state.phase === 'over') {
    return { moves: me.moves.map(() => false), switches: p.team.map(() => false), items: [], retreat: false, mustSwitch: false };
  }
  if (state.phase === 'switch') {
    return { moves: me.moves.map(() => false), switches: bench, items: [], retreat: false, mustSwitch: true };
  }
  // With no PP left anywhere every button is live: whichever is pressed, the dragon struggles on.
  const anyPp = me.moves.some((m) => m.pp > 0);
  return {
    moves: me.moves.map((m) => (anyPp ? m.pp > 0 : true)),
    switches: me.volatile.stuck ? bench.map(() => false) : bench,
    items: usableItems(state),
    retreat: state.canRetreat,
    mustSwitch: false,
  };
}

function validate(state: BattleState, action: PlayerAction): void {
  const L = legal(state);
  const me = activeMon(state, 'player');
  switch (action.kind) {
    case 'move': {
      const ok = Number.isInteger(action.slot) && (me.moves.length === 0 ? action.slot === 0 : L.moves[action.slot] === true);
      if (!ok) throw new Error(`illegal move slot ${action.slot}`);
      return;
    }
    case 'switch':
      if (L.switches[action.index] !== true) throw new Error(`illegal switch to ${action.index}`);
      return;
    case 'item':
      if ((state.items[action.item] ?? 0) <= 0 || !itemTargetOk(state, action.item, action.target)) {
        throw new Error(`illegal item ${action.item} on ${action.target}`);
      }
      return;
    case 'retreat':
      if (!L.retreat) throw new Error('cannot retreat from this battle');
      return;
  }
}

function priorityOf(m: BattleMon, move: MoveDef): number {
  return move.priority + (abilityOf(m).kind === 'prankster' && move.category === 'status' ? 1 : 0);
}

function chosenMove(m: BattleMon, slot: number): MoveDef {
  const s = m.moves[slot];
  if (s && s.pp > 0) return battleMove(s.id);
  const any = m.moves.find((x) => x.pp > 0);
  return any ? battleMove(any.id) : STRUGGLE;
}

export function submitTurn(state: BattleState, action: PlayerAction): BattleEvent[] {
  if (state.phase !== 'choose') throw new Error(`submitTurn during phase '${state.phase}'`);
  validate(state, action);
  const c = newCtx(state);
  state.turn++;
  const me = activeMon(state, 'player');

  if (action.kind === 'retreat') {
    endBattle(c, 'retreat');
    return c.ev;
  }

  // Both sides decide "at the same time": the AI sees the field as the turn starts.
  const ai = chooseEnemyAction(state);
  const foe = activeMon(state, 'enemy');
  const queue: { mon: BattleMon; slot: number }[] = [];
  if (action.kind === 'move') queue.push({ mon: me, slot: action.slot });
  if (ai.kind === 'move') queue.push({ mon: foe, slot: ai.slot });
  for (const q of queue) c.pending.add(q.mon.uid);

  // Switches and items go before any move: the player's first, then the AI's.
  if (action.kind === 'switch') {
    withdraw(c, me, true);
    sendOut(c, 'player', action.index, { text: true, entry: true });
  } else if (action.kind === 'item') {
    useItem(c, action.item, action.target);
  }
  if (ai.kind === 'switch') {
    const target = state.enemy.team[ai.index];
    if (target && target.hp > 0 && ai.index !== state.enemy.active && !foe.volatile.stuck) enemySwap(c, ai.index);
  }

  // Moves: priority, then effective speed, then a coin flip.
  if (queue.length === 2) {
    const [a, b] = queue;
    const pa = priorityOf(a.mon, chosenMove(a.mon, a.slot));
    const pb = priorityOf(b.mon, chosenMove(b.mon, b.slot));
    const sa = effectiveStat(a.mon, 'spe');
    const sb = effectiveStat(b.mon, 'spe');
    const bFirst = pb > pa || (pb === pa && (sb > sa || (sb === sa && state.rng.next() < 0.5)));
    if (bFirst) queue.reverse();
  }
  for (const q of queue) {
    if (isOver(state)) break;
    runMoveAction(c, q.mon, q.slot);
  }
  if (!isOver(state) && !checkOver(c)) endOfTurn(c);
  if (!isOver(state)) afterTurn(c);
  return c.ev;
}

export function submitSwitch(state: BattleState, index: number): BattleEvent[] {
  if (state.phase !== 'switch') throw new Error(`submitSwitch during phase '${state.phase}'`);
  if (legal(state).switches[index] !== true) throw new Error(`illegal switch to ${index}`);
  const c = newCtx(state);
  const cur = activeMon(state, 'player');
  if (cur.hp > 0) withdraw(c, cur, true);
  sendOut(c, 'player', index, { text: true, entry: true });
  state.phase = 'choose';
  checkOver(c);
  return c.ev;
}
