// The battle engine: Pokemon-style double battles (two on two; fewer when a team is smaller), pure
// and synchronous. The UI hands in one
// decision; the engine resolves the whole turn and returns what happened as events, in order.
// All randomness comes from state.rng (seeded with setup.seed): same seed + same actions =>
// identical events. Rules: docs/DESIGN.md "Battle rules"; shapes: src/battle/types.ts.
import type { ItemId, MoveDef, StageChanges, StageStat, StatusId, TypeId } from '../data/schema.ts';
import { ITEM_IDS } from '../data/schema.ts';
import { getAbility, getItem, getType, getVillain } from '../data/index.ts';
import { MAX_LEVEL } from '../game/types.ts';
import { makeRng } from '../lib/engine/rng.ts';
import { FIELD_SLOTS, type BattleEvent, type BattleMon, type BattleSetup, type BattleState, type PlayerAction, type Side, type SideState } from './types.ts';
import { buildMon, computeStats, emptyStages, freshVolatile, monDef, STAGE_STATS } from './build.ts';
import {
  CONFUSION_HIT, STRUGGLE, abilityOf, absorbs, battleMove, calcDamage, effectiveStat, findEffect, isDamaging,
  isTypeless, pinchActive,
} from './damage.ts';
import { typeEffectiveness } from './matchup.ts';
import { accStageMult, xpForLevel, xpYield } from './stats.ts';
import { chooseEnemyActions, chooseEnemyReplacement } from './ai.ts';

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
  /** Player field slots whose dragon used a pivot move and will be swapped after the turn. */
  pivots: Set<number>;
}

type EffectResult = 'applied' | 'failed' | 'blocked' | 'none';

function newCtx(s: BattleState): Ctx {
  return { s, ev: [], pending: new Set(), entered: new Set(), snapOut: new Set(), fainted: new Set(), pivots: new Set() };
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

/**
 * A combatant on the field. With `slot`, whoever holds that field slot (fainted or not); without,
 * the first one still standing (or the first slot's, when nobody is). Never undefined.
 */
export function activeMon(state: BattleState, side: Side, slot?: number): BattleMon {
  const st = sideOf(state, side);
  if (slot !== undefined) {
    const i = st.slots[slot] ?? -1;
    return st.team[i >= 0 ? i : 0];
  }
  const live = st.slots.find((i) => i >= 0 && st.team[i].hp > 0);
  return st.team[live ?? st.slots.find((i) => i >= 0) ?? 0];
}

/** The combatants on the field and still standing, in field-slot order. */
export function fieldMons(state: BattleState, side: Side): BattleMon[] {
  const st = sideOf(state, side);
  return st.slots.filter((i) => i >= 0 && st.team[i].hp > 0).map((i) => st.team[i]);
}

/** The field slot `m` stands in, or -1. */
export function fieldSlotOf(state: BattleState, m: BattleMon): number {
  const st = sideOf(state, m.side);
  return st.slots.findIndex((i) => i >= 0 && st.team[i] === m);
}

/** Field slots whose combatant is still standing. */
export function liveSlots(state: BattleState, side: Side): number[] {
  const st = sideOf(state, side);
  return st.slots.map((i, k) => (i >= 0 && st.team[i].hp > 0 ? k : -1)).filter((k) => k >= 0);
}

const isActive = (s: BattleState, m: BattleMon): boolean => fieldSlotOf(s, m) >= 0;

/**
 * The foe a combatant's foe-only effects fall on when it is not aiming at anyone in particular
 * (seeds, entry abilities, self moves' foe effects): the one across from it, else any still up.
 */
function primaryFoe(s: BattleState, m: BattleMon): BattleMon | null {
  const foes = sideOf(s, otherSide(m.side));
  const k = fieldSlotOf(s, m);
  const across = k >= 0 ? foes.slots[k] ?? -1 : -1;
  if (across >= 0 && foes.team[across].hp > 0) return foes.team[across];
  return fieldMons(s, otherSide(m.side))[0] ?? null;
}

/** Reads the phase through a call so TypeScript does not keep a stale narrowing across the turn. */
const isOver = (s: BattleState): boolean => s.phase === 'over';
const allFainted = (s: BattleState, side: Side): boolean => sideOf(s, side).team.every((m) => m.hp <= 0);

/** Team indices that could come in: standing and not on the field. */
export function benchIndices(s: BattleState, side: Side): number[] {
  const st = sideOf(s, side);
  return st.team.map((m, i) => (m.hp > 0 && !st.slots.includes(i) ? i : -1)).filter((i) => i >= 0);
}

function healthyBench(s: BattleState, side: Side): boolean {
  return benchIndices(s, side).length > 0;
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
    const v = getVillain(m.defId);
    const line = (m.caught && v.caught) || v.defeat;
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
    const targets = ab.who === 'self' ? [m] : fieldMons(c.s, otherSide(m.side));
    if (!targets.length) return;
    abilityEvent(c, m);
    say(c, `${poss(m)} ${abName(m)} KICKED IN!`);
    for (const t of targets) applyStages(c, t, ab.changes, ab.who === 'foe');
  } else if (ab.kind === 'pressure') {
    abilityEvent(c, m);
    say(c, `${who(m)} IS PUTTING ON THE PRESSURE!`);
  }
}

function sendOut(c: Ctx, side: Side, slot: number, index: number, opts: { text: boolean; entry: boolean }): void {
  const st = sideOf(c.s, side);
  st.slots[slot] = index;
  const m = st.team[index];
  m.volatile = freshVolatile();
  const first = !m.participated;
  m.participated = true;
  c.entered.add(m.uid);
  if (opts.text) say(c, side === 'player' ? `GO! ${NAME(m)}!` : `THE FOE SENT OUT ${NAME(m)}!`);
  emit(c, { t: 'sendOut', side, uid: m.uid, index, slot });
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
  emit(c, { t: 'withdraw', side: m.side, uid: m.uid, slot: fieldSlotOf(c.s, m) });
  m.stages = emptyStages();
  m.volatile = freshVolatile();
  releaseTrapped(c, m);
}

/** The boss AI's counter-swap: the rock-paper-scissors moment, announced as such. */
function enemySwap(c: Ctx, slot: number, index: number): void {
  const s = c.s;
  const old = activeMon(s, 'enemy', slot);
  const incoming = s.enemy.team[index];
  let threat: TypeId | null = null;
  let best = 1;
  for (const p of fieldMons(s, 'player')) {
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
  sendOut(c, 'enemy', slot, index, { text: false, entry: true });
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
function dealDamage(c: Ctx, user: BattleMon, foe: BattleMon, move: MoveDef, spread = false): number {
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
    const r = calcDamage(s, user, foe, move, spread ? { spread: true } : undefined);
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
      foe.volatile.seededBy = user.uid;
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
  const slot = fieldSlotOf(c.s, user);
  const idx = chooseEnemyReplacement(c.s, slot);
  if (slot < 0 || idx < 0) return;
  withdraw(c, user, true);
  sendOut(c, 'enemy', slot, idx, { text: true, entry: true });
}

/** Effects that land on the target (once per foe hit); the rest act on the user, once per move. */
function onTarget(e: MoveDef['effects'][number]): boolean {
  switch (e.kind) {
    case 'inflict': case 'confuse': case 'flinch': case 'firstTurn': case 'trap': case 'seed': return true;
    case 'stages': return e.who === 'foe';
    default: return false;
  }
}

/**
 * Who a move hits: nobody for a self move; every foe still up for a spread move; otherwise the foe
 * in `targetSlot`, or the other one when that one is down (or no slot was given).
 */
function moveTargets(s: BattleState, user: BattleMon, move: MoveDef, targetSlot: number): BattleMon[] {
  if (move.target !== 'foe') return [];
  const side = otherSide(user.side);
  const foes = fieldMons(s, side);
  if (move.spread) return foes;
  const st = sideOf(s, side);
  const i = targetSlot >= 0 ? st.slots[targetSlot] ?? -1 : -1;
  if (i >= 0 && st.team[i].hp > 0) return [st.team[i]];
  const other = primaryFoe(s, user);
  return other ? [other] : [];
}

/** Protect, absorb, immunity and the accuracy roll for one target. False: the move does not land on it. */
function lands(c: Ctx, user: BattleMon, foe: BattleMon, move: MoveDef, spread: boolean): boolean {
  const s = c.s;
  const damaging = isDamaging(move);
  if (foe.volatile.protecting) {
    emit(c, { t: 'protect', side: foe.side, uid: foe.uid });
    say(c, `${who(foe)} PROTECTED ITSELF!`);
    return false;
  }
  if (absorbs(foe, move)) {
    absorbHit(c, foe);
    return false;
  }
  if (damaging && !isTypeless(move) && typeEffectiveness(move.type, foe.types) === 0) {
    say(c, spread ? `IT DOESN'T AFFECT ${who(foe)}...` : 'IT HAD NO EFFECT!');
    return false;
  }
  if (!findEffect(move, 'sureHit')) {
    const stage = clampStage(user.stages.acc - foe.stages.eva);
    const acc = Math.min(100, move.accuracy * accStageMult(stage));
    if (!(s.rng.int(0, 99) < acc)) {
      emit(c, { t: 'miss', side: foe.side, uid: foe.uid });
      say(c, spread ? `${who(foe)} AVOIDED THE ATTACK!` : damaging ? `${poss(user)} ATTACK MISSED!` : 'BUT IT MISSED!');
      return false;
    }
  }
  return true;
}

/** Resolves a move after the user has been cleared to act. `targetSlot`: the foe's field slot (-1: any). */
function executeMove(c: Ctx, user: BattleMon, move: MoveDef, targetSlot = -1): void {
  const s = c.s;
  const damaging = isDamaging(move);
  if (findEffect(move, 'firstTurn') && user.volatile.turnsIn !== 0) {
    say(c, 'BUT IT FAILED!');
    return;
  }
  const targets = moveTargets(s, user, move, targetSlot);
  if (move.target === 'foe' && !targets.length) {
    say(c, 'BUT THERE WAS NO TARGET!');
    return;
  }
  const spread = targets.length > 1;
  const hit = targets.filter((foe) => lands(c, user, foe, move, spread));
  if (move.target === 'foe' && !hit.length) return;
  // Self moves still have a foe in mind for their foe-side effects (e.g. wiping stat changes).
  const primary = hit[0] ?? primaryFoe(s, user) ?? user;

  let applied = 0;
  let blocked = 0;
  let pivot = false;
  const tally = (e: MoveDef['effects'][number], r: EffectResult): void => {
    if (r === 'applied') applied++;
    if (r === 'blocked') blocked++;
    if (e.kind === 'pivot' && r === 'applied') pivot = true;
  };
  if (!spread) {
    const dealt = damaging ? dealDamage(c, user, primary, move) : 0;
    for (const e of move.effects) tally(e, applyEffect(c, user, primary, move, e, damaging, dealt));
  } else {
    // Each foe takes its hit and its own side effects; the user's own effects (recoil, drain,
    // self stages, pivot) happen once, on the total.
    let total = 0;
    for (const foe of hit) {
      const dealt = damaging ? dealDamage(c, user, foe, move, true) : 0;
      total += dealt;
      for (const e of move.effects) if (onTarget(e)) tally(e, applyEffect(c, user, foe, move, e, damaging, dealt));
    }
    for (const e of move.effects) if (!onTarget(e)) tally(e, applyEffect(c, user, primary, move, e, damaging, total));
  }
  if (move.id === STRUGGLE.id && user.hp > 0) {
    say(c, `${who(user)} IS HIT WITH RECOIL!`);
    hurt(c, user, Math.max(1, Math.floor(user.stats.hp / 4)), 'recoil');
  }
  if (!damaging && applied === 0 && blocked === 0) say(c, 'BUT IT FAILED!');

  for (const foe of hit) faintCheck(c, foe, user);
  faintCheck(c, user, primary);
  if (checkOver(c)) return;
  if (pivot && user.hp > 0 && isActive(s, user) && healthyBench(s, user.side)) {
    if (user.side === 'enemy') enemyPivot(c, user);
    else c.pivots.add(fieldSlotOf(s, user));
  }
}

/** One combatant's move action for the turn (slot index; Struggle when nothing has PP). */
function runMoveAction(c: Ctx, user: BattleMon, slotIndex: number, targetSlot = -1): void {
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
  const aimed = moveTargets(s, user, move, targetSlot);
  if (slot) {
    const cost = aimed.some((f) => f.hp > 0 && abilityOf(f).kind === 'pressure') ? 2 : 1;
    slot.pp = Math.max(0, slot.pp - cost);
  } else {
    say(c, `${who(user)} HAS NO MOVES LEFT!`);
  }
  say(c, `${who(user)} USED ${move.name.toUpperCase()}!`);
  if (slot) emit(c, { t: 'useMove', side: user.side, uid: user.uid, move: slot.id, targets: aimed.map((m) => m.uid) });
  executeMove(c, user, move, targetSlot);
}

// ---------------------------------------------------------------------------------------------
// End of turn
// ---------------------------------------------------------------------------------------------

/** Everyone on the field still standing, fastest first (ties: the player's side, then field slot). */
function bySpeed(s: BattleState): BattleMon[] {
  const mons = [...fieldMons(s, 'player'), ...fieldMons(s, 'enemy')];
  const key = (m: BattleMon): number => (m.side === 'player' ? 0 : 10) + fieldSlotOf(s, m);
  return mons.sort((a, b) => effectiveStat(b, 'spe') - effectiveStat(a, 'spe') || key(a) - key(b));
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
    // The seeder soaks it up while it is on the field; otherwise whoever stands across.
    const seeder = fieldMons(s, otherSide(m.side)).find((f) => f.uid === m.volatile.seededBy);
    const other = seeder ?? primaryFoe(s, m);
    if (lost > 0 && other && other.hp > 0 && other.hp < other.stats.hp) {
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

/** Field slots on `side` that need someone new: their combatant is down (or the slot is empty). */
function emptySlots(s: BattleState, side: Side): number[] {
  const st = sideOf(s, side);
  return st.slots.map((i, k) => (i < 0 || st.team[i].hp <= 0 ? k : -1)).filter((k) => k >= 0);
}

/** Replacements after the turn: the AI fills its empty slots, the player may have to choose. */
function afterTurn(c: Ctx): void {
  const s = c.s;
  if (s.phase === 'over') return;
  // The player's slots that will change hands: knocked out (with someone to send), or tagging
  // out after a pivot. As many as the bench can fill, in slot order.
  const bench = benchIndices(s, 'player').length;
  const wanted = [...new Set([...emptySlots(s, 'player'), ...[...c.pivots].filter((k) => k >= 0 && activeMon(s, 'player', k).hp > 0)])]
    .sort((a, b) => a - b).slice(0, bench);
  const playerLeaving = wanted.length > 0;
  for (const slot of emptySlots(s, 'enemy')) {
    if (!healthyBench(s, 'enemy')) break;
    // The player's replacements are not in yet, so the AI does not pick against leaving dragons
    // (send order decides, as after a double knockout), and the newcomer's entry ability waits for
    // them (submitSwitch) instead of fizzling on a fainted foe or hitting one about to withdraw.
    const idx = chooseEnemyReplacement(s, slot, playerLeaving);
    if (idx < 0) break;
    sendOut(c, 'enemy', slot, idx, { text: true, entry: !playerLeaving });
    if (playerLeaving) s.pendingEntry.push(s.enemy.team[idx].uid);
  }
  if (wanted.length) {
    s.phase = 'switch';
    s.switchSlots = wanted;
    const first = activeMon(s, 'player', wanted[0]);
    if (first.hp > 0 && c.pivots.has(wanted[0])) say(c, `${who(first)} IS READY TO TAG OUT!`);
    else say(c, 'WHO WILL YOU SEND OUT NEXT?');
  } else {
    s.phase = 'choose';
    s.switchSlots = [];
  }
  checkOver(c);
}

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

/**
 * Can the player use `item` on team member `index` right now? Heals need a hurt, conscious target;
 * revives a fainted one; cures a status (or a field dragon's confusion); stat items a dragon on
 * the field, with room left on a stage they raise. legal().items and submitTurn use the same rule.
 */
export function itemTargetOk(s: BattleState, item: ItemId, index: number): boolean {
  const team = s.player.team;
  const m = team[index];
  if (!m) return false;
  const eff = getItem(item).effect;
  switch (eff.kind) {
    case 'heal': return m.hp > 0 && m.hp < m.stats.hp;
    case 'revive': return m.hp <= 0;
    case 'cure': return m.hp > 0 && (m.status !== null || (s.player.slots.includes(index) && m.volatile.confused > 0));
    case 'stages':
      return s.player.slots.includes(index) && m.hp > 0
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
      // A dragon revived where it fell leaves its field slot: it waits on the bench, and the slot
      // is filled at the end of the turn like any other.
      const k = s.player.slots.indexOf(index);
      if (k >= 0) s.player.slots[k] = -1;
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
  // The leads: the first ones standing, one per field slot.
  const leads = (team: BattleMon[]): number[] => {
    const up = team.map((m, i) => (m.hp > 0 ? i : -1)).filter((i) => i >= 0);
    const n = Math.max(1, Math.min(setup.fieldSlots ?? FIELD_SLOTS, FIELD_SLOTS, team.length));
    return Array.from({ length: n }, (_, k) => up[k] ?? (k === 0 ? 0 : -1));
  };
  return {
    rng,
    turn: 0,
    player: { team: player, slots: leads(player) },
    enemy: { team: enemy, slots: leads(enemy) },
    aiLevel: setup.aiLevel,
    items: { ...setup.items },
    canRetreat: setup.canRetreat,
    phase: 'choose',
    switchSlots: [],
    winner: null,
    enemySwaps: 0,
    pendingEntry: [],
    log: [],
  };
}

/** Sends out the leads (foes first) and runs entry abilities in speed order. */
export function startBattle(state: BattleState): BattleEvent[] {
  const c = newCtx(state);
  if (checkOver(c)) return c.ev;
  for (const side of ['enemy', 'player'] as const) {
    sideOf(state, side).slots.forEach((i, k) => {
      if (i >= 0 && sideOf(state, side).team[i].hp > 0) sendOut(c, side, k, i, { text: true, entry: false });
    });
  }
  for (const m of bySpeed(state)) entryAbility(c, m);
  state.phase = 'choose';
  return c.ev;
}

export interface Legal {
  /** The player's field slot these answers are for. */
  slot: number;
  moves: boolean[];
  /** Team indices that may come in. */
  switches: boolean[];
  items: ItemId[];
  retreat: boolean;
  mustSwitch: boolean;
  /** Foe field slots a single-target move may aim at. */
  targets: boolean[];
}

/**
 * What the player may do. In 'choose', for the dragon in field slot `slot` (default: the first one
 * standing); in 'switch', for the next slot waiting for a replacement.
 */
export function legal(state: BattleState, slot?: number): Legal {
  const p = state.player;
  const targets = state.enemy.slots.map((i) => i >= 0 && state.enemy.team[i].hp > 0);
  const k = state.phase === 'switch' ? state.switchSlots[0] ?? 0 : slot ?? liveSlots(state, 'player')[0] ?? 0;
  const me = activeMon(state, 'player', k);
  const benchSet = new Set(benchIndices(state, 'player'));
  const bench = p.team.map((_, i) => benchSet.has(i));
  const none = { slot: k, moves: me.moves.map(() => false), switches: p.team.map(() => false), items: [] as ItemId[], retreat: false, mustSwitch: false, targets };
  if (state.phase === 'over') return none;
  if (state.phase === 'switch') return { ...none, switches: bench, mustSwitch: true };
  if (me.hp <= 0) return none;
  // With no PP left anywhere every button is live: whichever is pressed, the dragon struggles on.
  const anyPp = me.moves.some((m) => m.pp > 0);
  return {
    slot: k,
    moves: me.moves.map((m) => (anyPp ? m.pp > 0 : true)),
    switches: me.volatile.stuck ? bench.map(() => false) : bench,
    items: usableItems(state),
    retreat: state.canRetreat,
    mustSwitch: false,
    targets,
  };
}

function validate(state: BattleState, action: PlayerAction, slot: number): void {
  const L = legal(state, slot);
  const me = activeMon(state, 'player', slot);
  switch (action.kind) {
    case 'move': {
      const ok = Number.isInteger(action.slot) && (me.moves.length === 0 ? action.slot === 0 : L.moves[action.slot] === true);
      if (!ok) throw new Error(`illegal move slot ${action.slot}`);
      if (action.target !== undefined && !(Number.isInteger(action.target) && action.target >= 0 && action.target < state.enemy.slots.length)) {
        throw new Error(`illegal target ${action.target}`);
      }
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

/**
 * Resolve a turn. `actions`: one per player field slot still standing, in slot order (liveSlots);
 * a single action is fine when only one dragon is up. Any retreat ends the battle at once.
 */
export function submitTurn(state: BattleState, actions: PlayerAction | PlayerAction[]): BattleEvent[] {
  if (state.phase !== 'choose') throw new Error(`submitTurn during phase '${state.phase}'`);
  const list = Array.isArray(actions) ? actions : [actions];
  const mine = liveSlots(state, 'player');
  if (list.some((a) => a.kind === 'retreat')) {
    validate(state, { kind: 'retreat' }, mine[0] ?? 0);
  } else {
    if (list.length !== mine.length) throw new Error(`submitTurn: ${mine.length} action(s) needed, got ${list.length}`);
    list.forEach((a, k) => validate(state, a, mine[k]));
    const ins = list.filter((a) => a.kind === 'switch').map((a) => (a.kind === 'switch' ? a.index : -1));
    if (new Set(ins).size !== ins.length) throw new Error('two dragons cannot swap in the same teammate');
    const uses: Partial<Record<ItemId, number>> = {};
    for (const a of list) if (a.kind === 'item') uses[a.item] = (uses[a.item] ?? 0) + 1;
    for (const id of ITEM_IDS) if ((uses[id] ?? 0) > (state.items[id] ?? 0)) throw new Error(`not enough ${id} for every order`);
  }
  const c = newCtx(state);
  state.turn++;

  if (list.some((a) => a.kind === 'retreat')) {
    endBattle(c, 'retreat');
    return c.ev;
  }

  // Both sides decide "at the same time": the AI sees the field as the turn starts.
  const ai = chooseEnemyActions(state);
  const queue: { mon: BattleMon; slot: number; target: number }[] = [];
  list.forEach((a, k) => {
    if (a.kind === 'move') queue.push({ mon: activeMon(state, 'player', mine[k]), slot: a.slot, target: a.target ?? -1 });
  });
  for (const a of ai) if (a.action.kind === 'move') queue.push({ mon: activeMon(state, 'enemy', a.slot), slot: a.action.slot, target: a.action.target });
  for (const q of queue) c.pending.add(q.mon.uid);

  // Switches and items go before any move: the player's first (in slot order), then the AI's.
  list.forEach((a, k) => {
    if (a.kind === 'switch') {
      const me = activeMon(state, 'player', mine[k]);
      withdraw(c, me, true);
      sendOut(c, 'player', mine[k], a.index, { text: true, entry: true });
    } else if (a.kind === 'item') {
      if (itemTargetOk(state, a.item, a.target)) useItem(c, a.item, a.target);
    }
  });
  for (const a of ai) {
    if (a.action.kind !== 'switch') continue;
    const cur = activeMon(state, 'enemy', a.slot);
    const target = state.enemy.team[a.action.index];
    if (target && target.hp > 0 && !state.enemy.slots.includes(a.action.index) && cur.hp > 0 && !cur.volatile.stuck) enemySwap(c, a.slot, a.action.index);
  }

  // Moves: priority, then effective speed, then a coin flip (drawn only for a real tie).
  const before = (a: (typeof queue)[number], b: (typeof queue)[number]): boolean => {
    const pa = priorityOf(a.mon, chosenMove(a.mon, a.slot));
    const pb = priorityOf(b.mon, chosenMove(b.mon, b.slot));
    if (pa !== pb) return pa > pb;
    const sa = effectiveStat(a.mon, 'spe');
    const sb = effectiveStat(b.mon, 'spe');
    if (sa !== sb) return sa > sb;
    return !(state.rng.next() < 0.5);
  };
  // insertion sort: a two-entry queue compares exactly once, as the singles engine did
  for (let i = 1; i < queue.length; i++) {
    const cur = queue[i];
    let j = i - 1;
    while (j >= 0 && !before(queue[j], cur)) {
      queue[j + 1] = queue[j];
      j--;
    }
    queue[j + 1] = cur;
  }
  for (const q of queue) {
    if (isOver(state)) break;
    runMoveAction(c, q.mon, q.slot, q.target);
  }
  if (!isOver(state) && !checkOver(c)) endOfTurn(c);
  if (!isOver(state)) afterTurn(c);
  return c.ev;
}

/** In phase 'switch': send team member `index` into the next field slot waiting for one. */
export function submitSwitch(state: BattleState, index: number): BattleEvent[] {
  if (state.phase !== 'switch') throw new Error(`submitSwitch during phase '${state.phase}'`);
  if (legal(state).switches[index] !== true) throw new Error(`illegal switch to ${index}`);
  const c = newCtx(state);
  const slot = state.switchSlots.shift() ?? 0;
  const cur = activeMon(state, 'player', slot);
  if (cur.hp > 0 && state.player.slots[slot] >= 0) withdraw(c, cur, true);
  sendOut(c, 'player', slot, index, { text: true, entry: true });
  // nobody left to send for the rest: those slots stay empty
  state.switchSlots = state.switchSlots.filter(() => healthyBench(state, 'player'));
  if (state.switchSlots.length) {
    say(c, 'WHO WILL YOU SEND OUT NEXT?');
  } else {
    // enemy replacements that came in meanwhile now meet their foes
    const waiting = state.pendingEntry;
    state.pendingEntry = [];
    for (const uid of waiting) {
      const m = state.enemy.team.find((x) => x.uid === uid);
      if (m && m.hp > 0 && isActive(state, m)) entryAbility(c, m);
    }
    state.phase = 'choose';
  }
  checkOver(c);
  return c.ev;
}
