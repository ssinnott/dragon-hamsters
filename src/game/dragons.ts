// Owned dragons: creation, levelling, evolution, loadouts, training, and the bridge to and from the
// battle engine (toMonInit / syncFromBattle).
import { STAT_IDS, type MoveId, type SpeciesDef, type SpeciesId, type Stats, type TypeId } from '../data/schema.ts';
import { PERSONALITIES, getSpecies } from '../data/index.ts';
import { calcStats, levelForXp, xpForLevel } from '../battle/stats.ts';
import { defaultMoves } from '../battle/build.ts';
import type { BattleState, MonInit } from '../battle/types.ts';
import {
  MAX_LEVEL, TRAINING_CAP_STAT, TRAINING_CAP_TOTAL,
  type GameState, type OwnedDragon,
} from './types.ts';
import { stateRng } from './rng.ts';

/** Chance a new dragon gets its species' hidden ability (when it has one). */
const HIDDEN_ABILITY_CHANCE = 0.05;
/** Needs of a newly created dragon. */
const NEW_NEEDS = { fullness: 70, happiness: 60, energy: 100 } as const;

// ---------------------------------------------------------------------------------------------
// Small helpers shared by the other game modules
// ---------------------------------------------------------------------------------------------

/** Every move in the species' learnset at or below `level`, in learn order, without duplicates. */
export function learnedMovesUpTo(species: SpeciesDef, level: number): MoveId[] {
  const out: MoveId[] = [];
  for (const e of species.learnset) if (e.level <= level && !out.includes(e.move)) out.push(e.move);
  return out;
}

/** The loadout a fresh dragon of this species and level starts with (the battle engine's rule). */
export function startingLoadout(species: SpeciesDef, level: number): MoveId[] {
  return defaultMoves(species.learnset, level);
}

/** The dragon with this id, or undefined. */
export function findDragon(state: GameState, id: string): OwnedDragon | undefined {
  return state.dragons.find((d) => d.id === id);
}

/** The dragon with this id; throws if it is not in the burrow (a caller bug). */
export function getDragon(state: GameState, id: string): OwnedDragon {
  const d = findDragon(state, id);
  if (!d) throw new Error(`no dragon with id '${id}'`);
  return d;
}

/** Progress through the current level for an XP bar: XP into the level, XP the level spans, 0..1. */
export function xpProgress(d: OwnedDragon): { into: number; span: number; frac: number } {
  if (d.level >= MAX_LEVEL) return { into: 0, span: 0, frac: 1 };
  const lo = xpForLevel(d.level);
  const span = xpForLevel(d.level + 1) - lo;
  const into = Math.max(0, Math.min(span, d.xp - lo));
  return { into, span, frac: span > 0 ? into / span : 1 };
}

/** The species this dragon would evolve into right now, or null. */
export function pendingEvolution(d: OwnedDragon): SpeciesId | null {
  const evo = getSpecies(d.speciesId).evolvesTo;
  return evo && d.level >= evo.level ? evo.species : null;
}

function markDex(state: GameState, id: SpeciesId, owned: boolean): void {
  if (!state.dex.seen.includes(id)) state.dex.seen.push(id);
  if (owned && !state.dex.owned.includes(id)) state.dex.owned.push(id);
}

/** Record a species as seen in the Dragondex (e.g. a mission's reward pool shown on a card). */
export function markSeen(state: GameState, id: SpeciesId): void {
  markDex(state, id, false);
}

/** Learn a move: into knownMoves, and into a free loadout slot if there is one. */
function learn(d: OwnedDragon, move: MoveId, learned: MoveId[]): void {
  if (d.knownMoves.includes(move)) return;
  d.knownMoves.push(move);
  learned.push(move);
  if (d.moves.length < 4 && !d.moves.includes(move)) d.moves.push(move);
}

/** Keep the same fraction of HP across a max-HP change (fainted stays fainted, full stays full). */
function rescaleHp(d: OwnedDragon, oldMax: number): void {
  const newMax = dragonStats(d).hp;
  if (d.hp <= 0) { d.hp = 0; return; }
  if (oldMax <= 0 || d.hp >= oldMax) { d.hp = newMax; return; }
  d.hp = Math.max(1, Math.min(newMax, Math.round((d.hp * newMax) / oldMax)));
}

// ---------------------------------------------------------------------------------------------
// The API
// ---------------------------------------------------------------------------------------------

/** A new dragon with random genes, personality and ability drawn from the world RNG. Not added yet. */
export function createDragon(state: GameState, speciesId: SpeciesId, level: number): OwnedDragon {
  const species = getSpecies(speciesId);
  const L = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  const rng = stateRng(state);
  const genes = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } as Stats;
  for (const s of STAT_IDS) genes[s] = rng.int(0, 31);
  const personality = (rng.pick(PERSONALITIES) ?? PERSONALITIES[0]).id;
  let ability: string;
  if (species.hiddenAbility && rng.chance(HIDDEN_ABILITY_CHANCE)) ability = species.hiddenAbility;
  else ability = rng.pick(species.abilities) ?? species.hiddenAbility ?? species.abilities[0];

  const d: OwnedDragon = {
    id: 'd' + state.nextDragonId++,
    speciesId: species.id,
    nickname: null,
    level: L,
    xp: xpForLevel(L),
    genes,
    training: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    personality,
    ability,
    knownMoves: learnedMovesUpTo(species, L),
    moves: startingLoadout(species, L),
    hp: 0,
    status: null,
    needs: { ...NEW_NEEDS },
    slotsUsed: 0,
    joinedDay: state.day,
    missions: 0,
    battlesWon: 0,
  };
  // The equipped moves are always known (defaultMoves draws from the same learnset).
  for (const m of d.moves) if (!d.knownMoves.includes(m)) d.knownMoves.push(m);
  d.hp = dragonStats(d).hp;
  return d;
}

/** Add a dragon to the burrow and mark its species seen and owned. */
export function addDragon(state: GameState, d: OwnedDragon): void {
  if (!state.dragons.some((x) => x.id === d.id)) state.dragons.push(d);
  markDex(state, d.speciesId, true);
}

export function dragonName(d: OwnedDragon): string {
  return d.nickname ?? getSpecies(d.speciesId).name;
}

export function dragonStats(d: OwnedDragon): Stats {
  return calcStats(getSpecies(d.speciesId).baseStats, d.level, d.genes, d.training, d.personality);
}

export function dragonTypes(d: OwnedDragon): TypeId[] {
  return [...getSpecies(d.speciesId).types];
}

export function isFainted(d: OwnedDragon): boolean {
  return d.hp <= 0;
}

export interface XpReport {
  dragonId: string;
  /** XP actually added (0 at the level cap). */
  xp: number;
  /** Each level reached, in order. */
  levelsGained: number[];
  /** Moves learned on the way (auto-equipped while the loadout had a free slot). */
  learned: MoveId[];
  /** Set when the dragon is at or past its evolution level; the scene then calls evolve(). */
  evolveTo: SpeciesId | null;
}

/** Add XP: levels up (to MAX_LEVEL), learns moves, keeps the HP proportion, reports evolution. */
export function grantXp(d: OwnedDragon, amount: number): XpReport {
  const species = getSpecies(d.speciesId);
  const cap = xpForLevel(MAX_LEVEL);
  const before = d.xp;
  d.xp = Math.max(d.xp, Math.min(cap, d.xp + Math.max(0, Math.floor(amount))));
  const gained = d.xp - before;
  const levelsGained: number[] = [];
  const learned: MoveId[] = [];
  const newLevel = Math.max(d.level, levelForXp(d.xp));
  if (newLevel > d.level) {
    const oldMax = dragonStats(d).hp;
    for (let L = d.level + 1; L <= newLevel; L++) {
      levelsGained.push(L);
      for (const e of species.learnset) if (e.level === L) learn(d, e.move, learned);
    }
    d.level = newLevel;
    rescaleHp(d, oldMax);
  }
  return { dragonId: d.id, xp: gained, levelsGained, learned, evolveTo: pendingEvolution(d) };
}

/**
 * Evolve into the next species. Keeps nickname, genes, training, XP, level and loadout; the ability
 * keeps its slot; moves the new species knows at this level are learned (filling free loadout
 * slots); HP keeps its proportion. Returns the old species id.
 */
export function evolve(state: GameState, d: OwnedDragon): SpeciesId {
  const from = getSpecies(d.speciesId);
  if (!from.evolvesTo) throw new Error(`${from.id} does not evolve`);
  const to = getSpecies(from.evolvesTo.species);
  const oldMax = dragonStats(d).hp;

  if (!to.abilities.includes(d.ability) && to.hiddenAbility !== d.ability) {
    if (from.hiddenAbility === d.ability && to.hiddenAbility) d.ability = to.hiddenAbility;
    else {
      const slot = Math.max(0, from.abilities.indexOf(d.ability));
      d.ability = to.abilities[slot] ?? to.abilities[0] ?? d.ability;
    }
  }

  d.speciesId = to.id;
  const learned: MoveId[] = [];
  for (const m of learnedMovesUpTo(to, d.level)) learn(d, m, learned);
  rescaleHp(d, oldMax);
  markDex(state, to.id, true);
  return from.id;
}

/** Equip 1-4 distinct moves the dragon knows. Throws on an invalid loadout. */
export function setLoadout(d: OwnedDragon, moves: MoveId[]): void {
  if (!Array.isArray(moves) || moves.length < 1 || moves.length > 4) throw new Error('a loadout has 1 to 4 moves');
  if (new Set(moves).size !== moves.length) throw new Error('a loadout cannot repeat a move');
  for (const m of moves) if (!d.knownMoves.includes(m)) throw new Error(`${dragonName(d)} does not know '${m}'`);
  d.moves = [...moves];
}

/** Add training points within the caps (252 per stat, 510 total). Returns what was actually added. */
export function addTraining(d: OwnedDragon, gains: Partial<Stats>): Partial<Stats> {
  const oldMax = dragonStats(d).hp;
  const out: Partial<Stats> = {};
  let total = STAT_IDS.reduce((a, s) => a + d.training[s], 0);
  for (const s of STAT_IDS) {
    const want = Math.floor(gains[s] ?? 0);
    if (want <= 0) continue;
    const add = Math.max(0, Math.min(want, TRAINING_CAP_STAT - d.training[s], TRAINING_CAP_TOTAL - total));
    if (add <= 0) continue;
    d.training[s] += add;
    total += add;
    out[s] = add;
  }
  if (out.hp) rescaleHp(d, oldMax);
  else d.hp = Math.min(d.hp, dragonStats(d).hp);
  return out;
}

/** The battle engine's input for this dragon (current HP and status carry into battle). */
export function toMonInit(d: OwnedDragon): MonInit {
  return {
    kind: 'dragon',
    defId: d.speciesId,
    ownerRef: d.id,
    name: dragonName(d),
    level: d.level,
    xp: d.xp,
    ability: d.ability,
    moves: [...d.moves],
    hp: Math.max(0, d.hp),
    status: d.hp > 0 ? d.status : null,
    genes: { ...d.genes },
    training: { ...d.training },
    personality: d.personality,
    happiness: d.needs.happiness,
  };
}

export interface AfterBattle {
  reports: XpReport[];
  /** Ids of squad dragons that ended the battle fainted. */
  fainted: string[];
}

/**
 * Write a finished (or abandoned) battle back onto the owned dragons, by ownerRef: XP and level
 * (learning moves on the way), HP, status, the training earned from defeated foes, and win counts.
 * Call it exactly once per battle (finishBattle does).
 */
export function syncFromBattle(state: GameState, battle: BattleState): AfterBattle {
  const reports: XpReport[] = [];
  const fainted: string[] = [];
  const won = battle.winner === 'player';
  for (const mon of battle.player.team) {
    if (!mon.ownerRef) continue;
    const d = findDragon(state, mon.ownerRef);
    if (!d) continue;
    const report = grantXp(d, Math.max(0, mon.xp - d.xp));
    addTraining(d, mon.trainingGain ?? {});
    const max = dragonStats(d).hp;
    if (mon.hp <= 0) d.hp = 0;
    else if (mon.hp >= mon.stats.hp) d.hp = max;
    else d.hp = Math.max(1, Math.min(max, mon.hp));
    d.status = d.hp > 0 ? mon.status : null;
    if (won && mon.participated) d.battlesWon++;
    reports.push(report);
    if (d.hp <= 0) fainted.push(d.id);
  }
  if (won) state.stats.battlesWon++;
  else if (battle.winner === 'enemy') state.stats.battlesLost++;
  return { reports, fainted };
}
