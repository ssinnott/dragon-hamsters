// Type matchup arithmetic: the rock-paper-scissors layer. Used by the damage formula, the enemy AI
// and the UI (move tags, WEAK TO line, MATCHUP strip, squad star grades, BRING: counter types).
// Reads the chart live through src/data/index.ts, so it always reflects the authored table.
import type { MoveId, TypeId } from '../data/schema.ts';
import { TYPE_IDS } from '../data/schema.ts';
import { getMove } from '../data/index.ts';
// The chart is not re-exported by src/data/index.ts, so it is read from its table module directly.
import { CHART } from '../data/types.ts';

/** Multiplier of an attack of type `attack` against a defender with `defender` types (product over its types). */
export function typeEffectiveness(attack: TypeId, defender: readonly TypeId[]): number {
  const row = CHART[attack];
  let m = 1;
  const seen: TypeId[] = [];
  for (const d of defender) {
    if (seen.includes(d)) continue;
    seen.push(d);
    const v = row ? row[d] : undefined;
    if (v !== undefined) m *= v;
  }
  return m;
}

/** Type multiplier of a move against a defender's types (status moves report their type's multiplier too). */
export function moveEffectiveness(moveId: MoveId, defenderTypes: readonly TypeId[]): number {
  return typeEffectiveness(getMove(moveId).type, defenderTypes);
}

/** The best multiplier any of the attacker's own types gets against the defender. */
export function bestTypeMultiplier(attackerTypes: readonly TypeId[], defenderTypes: readonly TypeId[]): number {
  let best = 0;
  for (const t of attackerTypes) best = Math.max(best, typeEffectiveness(t, defenderTypes));
  return attackerTypes.length ? best : 1;
}

/** Attacking types that deal more than x1 to these types. */
export function weaknesses(defenderTypes: readonly TypeId[]): TypeId[] {
  return TYPE_IDS.filter((t) => typeEffectiveness(t, defenderTypes) > 1);
}

/** Attacking types that deal less than x1 to these types (including the ones with no effect). */
export function resistances(defenderTypes: readonly TypeId[]): TypeId[] {
  return TYPE_IDS.filter((t) => typeEffectiveness(t, defenderTypes) < 1);
}

/** Attacking types that have no effect at all on these types. */
export function immunities(defenderTypes: readonly TypeId[]): TypeId[] {
  return TYPE_IDS.filter((t) => typeEffectiveness(t, defenderTypes) === 0);
}

/** log2 of a multiplier, floored at x0.25 so immunities count as a very good (not infinite) result. */
function lg(mult: number): number {
  return Math.log2(Math.max(0.25, mult));
}

function isDamagingMove(moveId: MoveId): boolean {
  const m = getMove(moveId);
  return m.power > 0 || m.effects.some((e) => e.kind === 'fixed');
}

/**
 * Best multiplier among the damaging moves (or the own types when it knows no damaging move).
 * `stabOnly` keeps only moves of the combatant's own types (and falls back to the own types too).
 */
function offence(selfTypes: readonly TypeId[], selfMoves: readonly MoveId[], foeTypes: readonly TypeId[], stabOnly = false): number {
  const damaging = selfMoves.filter((id) => isDamagingMove(id) && (!stabOnly || selfTypes.includes(getMove(id).type)));
  if (!damaging.length) return bestTypeMultiplier(selfTypes, foeTypes);
  let best = 0;
  for (const id of damaging) {
    const m = getMove(id);
    const eff = typeEffectiveness(m.type, foeTypes);
    // Fixed-damage moves ignore the multiplier except for immunity.
    best = Math.max(best, m.effects.some((e) => e.kind === 'fixed') ? (eff === 0 ? 0 : 1) : eff);
  }
  return best;
}

/** The three numbers a grade is made of: best move multiplier, best STAB multiplier, their best STAB on us. */
export interface MatchupParts {
  /** Best multiplier any of its damaging moves gets on the foe (coverage counts). */
  offence: number;
  /** Best multiplier its own-type (STAB) moves get on the foe. */
  stab: number;
  /** Best multiplier the foe's own types (its STAB) get on it. */
  defence: number;
}

export function matchupParts(selfTypes: readonly TypeId[], selfMoves: readonly MoveId[], foeTypes: readonly TypeId[]): MatchupParts {
  return {
    offence: offence(selfTypes, selfMoves, foeTypes),
    stab: offence(selfTypes, selfMoves, foeTypes, true),
    defence: bestTypeMultiplier(foeTypes, selfTypes),
  };
}

/**
 * Matchup score in "doublings": how hard it hits the foe minus how hard the foe's types hit it.
 * +1 means e.g. super-effective offence with neutral defence. (A rough number for sorting; the
 * star grade uses the rules in matchupGrade.)
 */
export function matchupScore(selfTypes: readonly TypeId[], selfMoves: readonly MoveId[], foeTypes: readonly TypeId[]): number {
  const p = matchupParts(selfTypes, selfMoves, foeTypes);
  return lg(p.offence) - lg(p.defence);
}

/**
 * 1..3 stars: how well a combatant with these types and moves fares against `foeTypes`.
 *   3  clearly favourable: the foe's STAB does not hit it super-effectively, and either one of its
 *      moves hits super-effectively, or it resists the foe's STAB while its own STAB lands at least
 *      neutrally. (WATER vs WATER resists both ways: 2.)
 *   1  the foe's STAB hits it super-effectively and it has nothing super-effective back, or none
 *      of its moves can touch the foe at all.
 *   2  anything else.
 */
export function matchupGrade(selfTypes: readonly TypeId[], selfMoves: readonly MoveId[], foeTypes: readonly TypeId[]): 1 | 2 | 3 {
  const p = matchupParts(selfTypes, selfMoves, foeTypes);
  if (p.defence <= 1 && (p.offence > 1 || (p.defence < 1 && p.stab >= 1))) return 3;
  if ((p.defence > 1 && p.offence <= 1) || (p.offence === 0 && p.defence >= 1)) return 1;
  return 2;
}

/** The words shown with a grade (battle swap cards, briefing squad picks): one wording everywhere. */
export const GRADE_LABELS: Record<1 | 2 | 3, string> = {
  3: 'GREAT MATCHUP!',
  2: 'EVEN MATCHUP',
  1: 'BAD MATCHUP',
};

/**
 * Grade against several expected enemy type sets (mission intel): the rounded average of the
 * per-set matchupGrade, so one set gives exactly that set's grade.
 */
export function intelGrade(selfTypes: readonly TypeId[], selfMoves: readonly MoveId[], intel: readonly (readonly TypeId[])[]): 1 | 2 | 3 {
  if (!intel.length) return 2;
  let sum = 0;
  for (const foe of intel) sum += matchupGrade(selfTypes, selfMoves, foe);
  const avg = Math.round(sum / intel.length);
  return avg >= 3 ? 3 : avg <= 1 ? 1 : 2;
}

/** Types that would be good to bring against these (super-effective on most of them, ideally resisting them). */
export function counterTypes(intelTypes: readonly TypeId[]): TypeId[] {
  const intel = [...new Set(intelTypes)];
  if (!intel.length) return [];
  const scored: { t: TypeId; score: number; hits: number; order: number }[] = [];
  TYPE_IDS.forEach((t, order) => {
    let hits = 0, resisted = 0, resists = 0, weak = 0;
    for (const i of intel) {
      const out = typeEffectiveness(t, [i]);
      const inc = typeEffectiveness(i, [t]);
      if (out > 1) hits++;
      if (out < 1) resisted++;
      if (inc < 1) resists++;
      if (inc > 1) weak++;
    }
    if (hits === 0) return;
    const score = 3 * hits + resists - 2 * weak - 2 * resisted;
    scored.push({ t, score, hits, order });
  });
  scored.sort((a, b) => b.score - a.score || b.hits - a.hits || a.order - b.order);
  const good = scored.filter((s) => s.score > 0);
  return (good.length ? good : scored.slice(0, 1)).slice(0, 4).map((s) => s.t);
}

/** Tag text and colour for a multiplier, readable on the dark battle panels. */
export function effectivenessLabel(mult: number): { text: string; color: string } {
  if (mult === 0) return { text: 'NO EFFECT', color: '#a8a2b4' };
  if (mult >= 4) return { text: 'SUPER X4', color: '#7dffb2' };
  if (mult > 1) return { text: 'SUPER X2', color: '#72e66c' };
  if (mult <= 0.25) return { text: 'WEAK X0.25', color: '#ff8a4c' };
  if (mult < 1) return { text: 'WEAK X0.5', color: '#ffb04a' };
  return { text: 'X1', color: '#ece6d6' };
}
