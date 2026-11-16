// Stat, experience and stage arithmetic (Pokemon Gen V+ formulas, see docs/DESIGN.md "Battle rules").
// Pure functions; everything is integer maths so results match the reference numbers exactly.
import type { PersonalityId, Stats, StatId } from '../data/schema.ts';
import { STAT_IDS } from '../data/schema.ts';
import { PERSONALITIES } from '../data/index.ts';
import { MAX_LEVEL } from '../game/types.ts';

/** Personality (nature) multiplier for one stat, as a percentage: 110, 90 or 100. */
function personalityPct(personality: PersonalityId | null, stat: StatId): number {
  if (!personality || stat === 'hp') return 100;
  // Looked up through the live table (not a map built at import) so test fixtures can be added.
  const p = PERSONALITIES.find((x) => x.id === personality);
  if (!p) throw new Error(`unknown personality: '${personality}'`);
  if (p.up === p.down) return 100;
  if (p.up === stat) return 110;
  if (p.down === stat) return 90;
  return 100;
}

/**
 * Stats at `level`.
 * HP = floor((2B + G + floor(T/4)) * L / 100) + L + 10
 * other = floor((floor((2B + G + floor(T/4)) * L / 100) + 5) * personality)
 */
export function calcStats(base: Stats, level: number, genes: Stats, training: Stats, personality: PersonalityId | null): Stats {
  const out = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } as Stats;
  const L = Math.max(1, Math.floor(level));
  for (const s of STAT_IDS) {
    const core = Math.floor(((2 * base[s] + (genes[s] ?? 0) + Math.floor((training[s] ?? 0) / 4)) * L) / 100);
    if (s === 'hp') out.hp = core + L + 10;
    else out[s] = Math.floor(((core + 5) * personalityPct(personality, s)) / 100);
  }
  return out;
}

/** Total XP needed to reach `level` on the medium-fast curve: level^3 (level 1 needs 0). */
export function xpForLevel(level: number): number {
  const L = Math.floor(level);
  if (L <= 1) return 0;
  return L * L * L;
}

/** The level a dragon with `xp` total experience is at, capped at MAX_LEVEL. */
export function levelForXp(xp: number): number {
  let L = 1;
  while (L < MAX_LEVEL && xpForLevel(L + 1) <= xp) L++;
  return L;
}

/**
 * XP for defeating a foe (Gen V scaled formula):
 * floor(baseXp * foeLevel / 5 * ((2*foeLevel + 10) / (foeLevel + selfLevel + 10))^2.5) + 1, x1.5 for bosses.
 */
export function xpYield(baseXp: number, foeLevel: number, selfLevel: number, isBoss: boolean): number {
  const ratio = (2 * foeLevel + 10) / (foeLevel + selfLevel + 10);
  const raw = Math.floor(((baseXp * foeLevel) / 5) * Math.pow(ratio, 2.5) + 1e-9) + 1;
  return isBoss ? Math.floor(raw * 1.5) : raw;
}

/** Stage multiplier as an exact fraction [numerator, denominator]: (2+n)/2 or 2/(2-n). */
export function stageFraction(stage: number): [number, number] {
  const n = Math.max(-6, Math.min(6, Math.trunc(stage)));
  return n >= 0 ? [2 + n, 2] : [2, 2 - n];
}

/** Stat stage multiplier: (2+n)/2 for n >= 0, 2/(2-n) below. */
export function stageMult(stage: number): number {
  const [a, b] = stageFraction(stage);
  return a / b;
}

/** Accuracy/evasion stage multiplier: (3+n)/3 for n >= 0, 3/(3-n) below. */
export function accStageMult(stage: number): number {
  const n = Math.max(-6, Math.min(6, Math.trunc(stage)));
  return n >= 0 ? (3 + n) / 3 : 3 / (3 - n);
}
