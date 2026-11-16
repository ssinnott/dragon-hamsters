// Turning a MonInit (an owned dragon or a villain at some level) into a battle combatant.
import type { MoveId, StageStat, Stats, TypeId } from '../data/schema.ts';
import { getMove, getSpecies, getVillain } from '../data/index.ts';
import { MAX_LEVEL } from '../game/types.ts';
import type { BattleMon, MonInit, Side, Volatile } from './types.ts';
import { calcStats, xpForLevel } from './stats.ts';

/** Bosses get this much max HP (their HP bar is drawn gold). */
export const BOSS_HP_MULT = 1.5;
export const STAGE_STATS: readonly StageStat[] = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];

const ZERO_STATS: Stats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const VILLAIN_GENES: Stats = { hp: 15, atk: 15, def: 15, spa: 15, spd: 15, spe: 15 };

export function emptyStages(): Record<StageStat, number> {
  return { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
}

export function freshVolatile(): Volatile {
  return { confused: 0, flinch: false, stuck: false, stuckBy: null, seeded: false, protecting: false, protectChain: 0, turnsIn: 0 };
}

/** The content definition behind a combatant: base stats, types, XP yield and learnset. */
export function monDef(m: { kind: 'dragon' | 'villain'; defId: string }): {
  name: string; types: TypeId[]; baseStats: Stats; baseXp: number; learnset: { level: number; move: MoveId }[]; defaultAbility: string; isBossRole: boolean;
} {
  if (m.kind === 'dragon') {
    const s = getSpecies(m.defId);
    return { name: s.name, types: [...s.types], baseStats: s.baseStats, baseXp: s.baseXp, learnset: s.learnset, defaultAbility: s.abilities[0] ?? '', isBossRole: false };
  }
  const v = getVillain(m.defId);
  return { name: v.name, types: [...v.types], baseStats: v.baseStats, baseXp: v.baseXp, learnset: v.learnset, defaultAbility: v.ability, isBossRole: v.role === 'boss' };
}

/** Recomputes a combatant's stats at its current level (boss HP bonus included). */
export function computeStats(mon: BattleMon): Stats {
  const st = calcStats(monDef(mon).baseStats, mon.level, mon.genes, mon.training, mon.personality);
  if (mon.isBoss) st.hp = Math.floor(st.hp * BOSS_HP_MULT);
  return st;
}

/** The last four distinct moves learned at or below `level` (most recent last). */
export function defaultMoves(learnset: { level: number; move: MoveId }[], level: number): MoveId[] {
  const learned = learnset
    .map((e, i) => ({ ...e, i }))
    .filter((e) => e.level <= level)
    .sort((a, b) => a.level - b.level || a.i - b.i);
  const order: MoveId[] = [];
  for (const e of learned) {
    const at = order.indexOf(e.move);
    if (at >= 0) order.splice(at, 1);
    order.push(e.move);
  }
  return order.slice(-4);
}

function clampStage(n: number): number {
  return Math.max(-6, Math.min(6, Math.trunc(n)));
}

export function buildMon(init: MonInit, side: Side, index: number): BattleMon {
  const def = monDef(init);
  const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(init.level)));
  const genes: Stats = { ...(init.genes ?? VILLAIN_GENES) };
  const training: Stats = { ...ZERO_STATS, ...(init.training ?? {}) };
  const personality = init.personality ?? null;
  const moveIds = (init.moves && init.moves.length ? [...init.moves] : defaultMoves(def.learnset, level)).slice(0, 4);
  const moves = moveIds.map((id) => {
    const m = getMove(id);
    return { id, pp: m.pp, maxPp: m.pp };
  });
  const stages = emptyStages();
  if (init.startStages) {
    for (const k of STAGE_STATS) {
      const v = init.startStages[k];
      if (v) stages[k] = clampStage(v);
    }
  }
  const mon: BattleMon = {
    uid: (side === 'player' ? 'p' : 'e') + index,
    side,
    kind: init.kind,
    defId: init.defId,
    ownerRef: init.ownerRef ?? null,
    name: init.name ?? def.name,
    level,
    xp: init.kind === 'dragon' ? Math.max(init.xp ?? 0, xpForLevel(level)) : 0,
    types: def.types,
    ability: init.ability ?? def.defaultAbility,
    stats: { ...ZERO_STATS },
    genes,
    training,
    personality,
    trainingGain: {},
    hp: 0,
    moves,
    status: init.status ?? null,
    statusTurns: init.status === 'snooze' ? 2 : 0,
    stages,
    volatile: freshVolatile(),
    isBoss: init.isBoss ?? def.isBossRole,
    ...(init.caught ? { caught: true } : {}),
    happiness: Math.max(0, Math.min(100, init.happiness ?? (init.kind === 'dragon' ? 70 : 50))),
    participated: false,
  };
  mon.stats = computeStats(mon);
  const hp = init.hp === undefined ? mon.stats.hp : Math.floor(init.hp);
  mon.hp = Math.max(0, Math.min(mon.stats.hp, hp));
  if (mon.hp === 0) {
    mon.status = null;
    mon.statusTurns = 0;
  }
  return mon;
}
