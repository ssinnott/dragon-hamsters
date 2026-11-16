// The damage formula (Pokemon Gen V+ order, flooring after every step) and the stat arithmetic the
// battle and the AI share. See docs/DESIGN.md "Battle rules" and docs/POKEMON_RESEARCH.md section 4.
import type { AbilityEffect, MoveDef, MoveEffect, MoveId } from '../data/schema.ts';
import { getAbility, getMove } from '../data/index.ts';
import type { BattleMon, BattleState } from './types.ts';
import { stageFraction } from './stats.ts';
import { typeEffectiveness } from './matchup.ts';

export interface DamageResult { damage: number; effectiveness: number; crit: boolean }

/**
 * What a combatant does when every move is out of PP: typeless, physical, 50 power, never misses,
 * costs the user 1/4 of its max HP. Internal only: never in MOVES, never sent in a 'useMove' event.
 */
export const STRUGGLE: MoveDef = {
  id: '__struggle', name: 'Desperate Wiggle', type: 'FLUFF', category: 'physical', power: 50, accuracy: 100, pp: 1,
  priority: 0, contact: true, target: 'foe', effects: [{ kind: 'sureHit' }],
  description: 'Out of moves! Wiggles wildly. Hurts the user too.', fx: 'tackle',
};

/** The blow a confused combatant deals itself: typeless, physical, 40 power, cannot crit. */
export const CONFUSION_HIT: MoveDef = {
  id: '__confusion', name: 'Dizzy Bonk', type: 'FLUFF', category: 'physical', power: 40, accuracy: 100, pp: 1,
  priority: 0, contact: false, target: 'self', effects: [], description: 'Bonked itself while dizzy.', fx: 'tackle',
};

/** Typeless moves: no STAB, no type multiplier. */
export function isTypeless(move: MoveDef): boolean {
  return move.id === STRUGGLE.id || move.id === CONFUSION_HIT.id;
}

/** getMove that also knows the engine's internal moves. */
export function battleMove(id: MoveId): MoveDef {
  if (id === STRUGGLE.id) return STRUGGLE;
  if (id === CONFUSION_HIT.id) return CONFUSION_HIT;
  return getMove(id);
}

/** The combatant's ability rule. */
export function abilityOf(mon: BattleMon): AbilityEffect {
  return getAbility(mon.ability).effect;
}

export function findEffect<K extends MoveEffect['kind']>(move: MoveDef, kind: K): Extract<MoveEffect, { kind: K }> | undefined {
  return move.effects.find((e) => e.kind === kind) as Extract<MoveEffect, { kind: K }> | undefined;
}

/** Deals damage through the formula or a fixed amount (as opposed to a status move). */
export function isDamaging(move: MoveDef): boolean {
  return move.power > 0 || move.effects.some((e) => e.kind === 'fixed');
}

/** Does the defender's ability swallow moves of this type (absorb)? */
export function absorbs(defender: BattleMon, move: MoveDef): boolean {
  if (isTypeless(move)) return false;
  const ab = abilityOf(defender);
  return ab.kind === 'absorb' && ab.type === move.type;
}

/** Quick Feet-style statMult on speed while statused also cancels the zap slowdown. */
function ignoresZapSlow(mon: BattleMon): boolean {
  const ab = abilityOf(mon);
  return ab.kind === 'statMult' && ab.stat === 'spe' && ab.when === 'statused';
}

/** A stat after a given stage, the holder's statMult ability and (for speed) the zap halving. */
function statAt(mon: BattleMon, stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe', stage: number): number {
  const [n, d] = stageFraction(stage);
  let v = Math.floor((mon.stats[stat] * n) / d);
  const ab = abilityOf(mon);
  if (ab.kind === 'statMult' && ab.stat === stat && (ab.when === 'always' || mon.status !== null)) v = Math.floor(v * ab.mult);
  if (stat === 'spe' && mon.status === 'zap' && !ignoresZapSlow(mon)) v = Math.floor(v / 2);
  return Math.max(1, v);
}

/** The stat used in battle: base stat x stage x ability x zap (speed). */
export function effectiveStat(mon: BattleMon, stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe'): number {
  return statAt(mon, stat, mon.stages[stat]);
}

/** Critical-hit stage: high-crit move +1, superLuck +1, happiness >= 80 +1. */
export function critStage(attacker: BattleMon, move: MoveDef): number {
  let s = 0;
  if (findEffect(move, 'highCrit')) s++;
  if (abilityOf(attacker).kind === 'superLuck') s++;
  if (attacker.happiness >= 80) s++;
  return s;
}

/** Crit chance by stage (Gen VII+): 1/24, 1/8, 1/2, always. */
export function critChance(stage: number): number {
  return stage <= 0 ? 1 / 24 : stage === 1 ? 1 / 8 : stage === 2 ? 1 / 2 : 1;
}

/** Facade / hex power doubling. */
export function movePower(attacker: BattleMon, defender: BattleMon, move: MoveDef): number {
  let p = move.power;
  if (findEffect(move, 'facade') && attacker.status) p *= 2;
  if (findEffect(move, 'hex') && defender.status) p *= 2;
  return p;
}

/** The fixed damage of a 'fixed' move, or null. */
function fixedDamage(attacker: BattleMon, move: MoveDef): number | null {
  const f = findEffect(move, 'fixed');
  if (!f) return null;
  return f.damage === 'level' ? attacker.level : Math.max(0, Math.floor(f.damage));
}

/** Is the attacker in its pinch-ability window for this move? */
export function pinchActive(attacker: BattleMon, move: MoveDef): boolean {
  const ab = abilityOf(attacker);
  return ab.kind === 'pinch' && !isTypeless(move) && ab.type === move.type && attacker.hp * 3 <= attacker.stats.hp;
}

/**
 * The deterministic core of the formula: crit and the random roll (85..100) are inputs.
 * Steps, flooring after each: base, crit x1.5, random, STAB, type, burn x0.5 (physical), then the
 * attacker's ability (pinch, typeBoost, contactBoost, technician) and the defender's (resist, filter,
 * multiscale). At least 1 unless the type multiplier is 0.
 */
export function computeDamage(attacker: BattleMon, defender: BattleMon, move: MoveDef, crit: boolean, randomPct: number): { damage: number; effectiveness: number } {
  const typeless = isTypeless(move);
  const eff = typeless ? 1 : absorbs(defender, move) ? 0 : typeEffectiveness(move.type, defender.types);
  const fixed = fixedDamage(attacker, move);
  if (fixed !== null) return { damage: eff === 0 ? 0 : fixed, effectiveness: eff === 0 ? 0 : 1 };
  if (eff === 0) return { damage: 0, effectiveness: 0 };
  if (move.power <= 0) return { damage: 0, effectiveness: eff };

  const physical = move.category === 'physical';
  const aStat = physical ? 'atk' : 'spa';
  const dStat = physical ? 'def' : 'spd';
  let aStage = attacker.stages[aStat];
  let dStage = defender.stages[dStat];
  if (crit) {
    if (aStage < 0) aStage = 0;
    if (dStage > 0) dStage = 0;
  }
  const A = statAt(attacker, aStat, aStage);
  const D = statAt(defender, dStat, dStage);
  const power = movePower(attacker, defender, move);

  let d = Math.floor(Math.floor((Math.floor((2 * attacker.level) / 5 + 2) * power * A) / D) / 50) + 2;
  if (crit) d = Math.floor(d * 1.5);
  d = Math.floor((d * randomPct) / 100);
  const atkAb = abilityOf(attacker);
  if (!typeless && attacker.types.includes(move.type)) d = Math.floor(d * (atkAb.kind === 'stab' ? atkAb.mult : 1.5));
  d = Math.floor(d * eff);
  const guts = atkAb.kind === 'statMult' && atkAb.stat === 'atk' && atkAb.when === 'statused';
  if (physical && attacker.status === 'burn' && !guts && !findEffect(move, 'facade')) d = Math.floor(d / 2);

  if (move.id !== CONFUSION_HIT.id) {
    if (pinchActive(attacker, move) && atkAb.kind === 'pinch') d = Math.floor(d * atkAb.mult);
    if (atkAb.kind === 'typeBoost' && !typeless && atkAb.type === move.type) d = Math.floor(d * atkAb.mult);
    if (atkAb.kind === 'contactBoost' && move.contact) d = Math.floor(d * atkAb.mult);
    if (atkAb.kind === 'technician' && move.power <= 60) d = Math.floor(d * 1.5);
    const defAb = abilityOf(defender);
    if (defAb.kind === 'resist' && !typeless && defAb.types.includes(move.type)) d = Math.floor(d * defAb.mult);
    if (defAb.kind === 'filter' && eff > 1) d = Math.floor(d * defAb.mult);
    if (defAb.kind === 'multiscale' && defender.hp >= defender.stats.hp) d = Math.floor(d / 2);
  }
  return { damage: Math.max(1, d), effectiveness: eff };
}

/** Rolls crit and the random factor from the battle RNG (crit first), unless forced by `opts`. */
export function calcDamage(
  state: BattleState, attacker: BattleMon, defender: BattleMon, move: MoveDef,
  opts?: { forceCrit?: boolean; randomFactor?: number },
): DamageResult {
  const typeless = isTypeless(move);
  const immune = !typeless && (absorbs(defender, move) || typeEffectiveness(move.type, defender.types) === 0);
  if (immune || fixedDamage(attacker, move) !== null || move.power <= 0) {
    const r = computeDamage(attacker, defender, move, false, 100);
    return { ...r, crit: false };
  }
  let crit: boolean;
  if (opts?.forceCrit !== undefined) crit = opts.forceCrit;
  else if (move.id === CONFUSION_HIT.id) crit = false;
  else {
    const stage = critStage(attacker, move);
    crit = stage >= 3 ? true : state.rng.next() < critChance(stage);
  }
  const rand = opts?.randomFactor !== undefined
    ? Math.max(85, Math.min(100, Math.round(opts.randomFactor <= 1 ? opts.randomFactor * 100 : opts.randomFactor)))
    : state.rng.int(85, 100);
  const r = computeDamage(attacker, defender, move, crit, rand);
  return { ...r, crit };
}

/** Damage range without RNG and without crits (multi-hit moves: min hits x min roll .. max hits x max roll). */
export function estimateDamage(attacker: BattleMon, defender: BattleMon, moveId: MoveId): { min: number; max: number; effectiveness: number } {
  const move = battleMove(moveId);
  const lo = computeDamage(attacker, defender, move, false, 85);
  const hi = computeDamage(attacker, defender, move, false, 100);
  const mh = findEffect(move, 'multiHit');
  const minHits = mh ? Math.max(1, mh.min) : 1;
  const maxHits = mh ? Math.max(minHits, mh.max) : 1;
  return { min: lo.damage * minHits, max: hi.damage * maxHits, effectiveness: lo.effectiveness };
}
