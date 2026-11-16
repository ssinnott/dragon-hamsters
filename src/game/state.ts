// The persistent world: a new game, and saving / loading it as JSON.
//
// Storage is injected (tests pass an in-memory Storage); the default is globalThis.localStorage
// when the platform has one. Loading never throws: a missing, newer, unparseable or structurally
// broken save returns null. A structurally sound save whose content references went stale (a
// species, move or mission id that no longer exists) is repaired instead of rejected, so a content
// update never strands a player's burrow.
import {
  FOOD_IDS, ITEM_IDS, STAT_IDS,
  type FoodId, type ItemId, type Stats, type StatusId,
} from '../data/schema.ts';
import { ABILITIES, MISSIONS, MOVES, PERSONALITIES, SPECIES } from '../data/index.ts';
import {
  MAX_LEVEL, SAVE_KEY, SAVE_VERSION, SLOTS_PER_DAY, SQUAD_SIZE, TRAINING_CAP_STAT, TRAINING_CAP_TOTAL,
  type GameState, type MissionRecord, type OwnedDragon,
} from './types.ts';
import { dragonStats, learnedMovesUpTo, startingLoadout } from './dragons.ts';

/** Starting pantry and bag (DESIGN: a starter pantry). */
const START_FOOD: Record<FoodId, number> = { seeds: 5, carrot: 3, berries: 2, cheese: 1, dragonfruit: 0 };
const START_ITEMS: Record<ItemId, number> = { seedcake: 3, royalcake: 0, peppep: 0, herbtea: 1, spicybiscuit: 0 };
const START_COINS = 200;

/** A brand-new world: day 1, 200 coins, a starter pantry, no dragons yet (the starter screen adds two). */
export function newGame(seed: number, playerName: string = 'AGENT'): GameState {
  return {
    version: SAVE_VERSION,
    seed: (Math.trunc(Number(seed)) | 0) >>> 0,
    day: 1,
    coins: START_COINS,
    playerName,
    dragons: [],
    squad: [],
    nextDragonId: 1,
    food: { ...START_FOOD },
    items: { ...START_ITEMS },
    dex: { seen: [], owned: [] },
    missions: {},
    flags: {},
    settings: { sound: true, music: true, fastText: true },
    stats: { battlesWon: 0, battlesLost: 0, missionsCleared: 0, activities: 0 },
  };
}

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** globalThis.localStorage when present and reachable (sandboxed pages can throw on access). */
function defaultStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

/** A simple in-memory Storage (tests, and a fallback for platforms without localStorage). */
export function memoryStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

/** Serialise the world. Returns false when there is no storage or it refused (quota, privacy mode). */
export function saveGame(state: GameState, storage?: Storage): boolean {
  const s = storage ?? defaultStorage();
  if (!s) return false;
  try {
    s.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** The saved world, validated and repaired; null if absent, corrupt or from a newer version. */
export function loadGame(storage?: Storage): GameState | null {
  const s = storage ?? defaultStorage();
  if (!s) return null;
  let raw: string | null;
  try {
    raw = s.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (raw === null || raw === undefined) return null;
  return parseSave(raw);
}

export function clearSave(storage?: Storage): void {
  const s = storage ?? defaultStorage();
  if (!s) return;
  try {
    s.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear if the storage is unreachable.
  }
}

/** Parse and validate a save string. Never throws; null when it is not a usable save. */
export function parseSave(json: string): GameState | null {
  try {
    const data: unknown = JSON.parse(json);
    const migrated = migrate(data);
    return migrated ? validate(migrated) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Migration and validation
// ---------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;

/** Thrown inside validate() to reject a structurally broken save. Caught by parseSave. */
class Corrupt extends Error {}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Bring an older save up to SAVE_VERSION. Version 1 is the first, so only it is accepted. */
function migrate(data: unknown): Obj | null {
  if (!isObj(data) || !isNum(data.version)) return null;
  if (data.version > SAVE_VERSION || data.version < 1) return null;
  // Future versions: `if (data.version === 1) { ...; data.version = 2; }` and so on.
  return data;
}

function need(cond: boolean, what: string): void {
  if (!cond) throw new Corrupt(what);
}

/** A required finite number, clamped and optionally rounded down. */
function reqNum(v: unknown, what: string, lo: number, hi: number): number {
  need(isNum(v), what);
  return clamp(Math.floor(v as number), lo, hi);
}

/** An optional finite number with a default. */
function optNum(v: unknown, def: number, lo: number, hi: number): number {
  return isNum(v) ? clamp(Math.floor(v), lo, hi) : def;
}

function reqStats(v: unknown, what: string, lo: number, hi: number): Stats {
  need(isObj(v), what);
  const o = v as Obj;
  const out = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } as Stats;
  for (const s of STAT_IDS) out[s] = reqNum(o[s], `${what}.${s}`, lo, hi);
  return out;
}

function strArray(v: unknown, what: string): string[] {
  need(Array.isArray(v) && (v as unknown[]).every((x) => typeof x === 'string'), what);
  return [...(v as string[])];
}

const STATUS_IDS: readonly StatusId[] = ['burn', 'goop', 'zap', 'snooze', 'frozen'];
const speciesIds = (): Set<string> => new Set(SPECIES.map((s) => s.id));

function validate(o: Obj): GameState | null {
  try {
    return validateOrThrow(o);
  } catch (e) {
    if (e instanceof Corrupt) return null;
    return null;
  }
}

function validateOrThrow(o: Obj): GameState {
  const known = speciesIds();

  need(Array.isArray(o.dragons), 'dragons');
  const dragons: OwnedDragon[] = [];
  const ids = new Set<string>();
  for (const raw of o.dragons as unknown[]) {
    const d = validateDragon(raw, known);
    if (!d) continue; // stale species: dropped
    need(!ids.has(d.id), 'duplicate dragon id');
    ids.add(d.id);
    dragons.push(d);
  }

  need(isObj(o.food), 'food');
  const food = {} as Record<FoodId, number>;
  for (const f of FOOD_IDS) {
    const v = (o.food as Obj)[f];
    food[f] = v === undefined ? 0 : reqNum(v, `food.${f}`, 0, 9999);
  }
  need(isObj(o.items), 'items');
  const items = {} as Record<ItemId, number>;
  for (const it of ITEM_IDS) {
    const v = (o.items as Obj)[it];
    items[it] = v === undefined ? 0 : reqNum(v, `items.${it}`, 0, 9999);
  }

  need(isObj(o.dex), 'dex');
  const dexObj = o.dex as Obj;
  const owned = new Set(strArray(dexObj.owned, 'dex.owned').filter((s) => known.has(s)));
  for (const d of dragons) owned.add(d.speciesId);
  const seen = new Set(strArray(dexObj.seen, 'dex.seen').filter((s) => known.has(s)));
  for (const s of owned) seen.add(s);

  need(isObj(o.missions), 'missions');
  const missionIds = new Set(MISSIONS.map((m) => m.id));
  const missions: Record<string, MissionRecord> = {};
  for (const [id, rec] of Object.entries(o.missions as Obj)) {
    need(isObj(rec), `missions.${id}`);
    const r = rec as Obj;
    const clears = reqNum(r.clears, `missions.${id}.clears`, 0, 1e9);
    const fcd = r.firstClearDay;
    need(fcd === null || fcd === undefined || isNum(fcd), `missions.${id}.firstClearDay`);
    if (!missionIds.has(id)) continue; // a mission that no longer exists
    missions[id] = { clears, firstClearDay: isNum(fcd) ? Math.max(1, Math.floor(fcd)) : null };
  }

  const squadRaw = o.squad === undefined ? [] : strArray(o.squad, 'squad');
  const squad = [...new Set(squadRaw.filter((id) => ids.has(id)))].slice(0, SQUAD_SIZE);

  let maxNumericId = 0;
  for (const d of dragons) {
    const m = /^d(\d+)$/.exec(d.id);
    if (m) maxNumericId = Math.max(maxNumericId, Number(m[1]));
  }
  const nextDragonId = Math.max(optNum(o.nextDragonId, 1, 1, 1e9), maxNumericId + 1);

  const flags: Record<string, boolean> = {};
  if (isObj(o.flags)) for (const [k, v] of Object.entries(o.flags)) if (typeof v === 'boolean') flags[k] = v;

  const st = isObj(o.settings) ? o.settings : {};
  const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : true);
  const stats = isObj(o.stats) ? o.stats : {};

  return {
    version: SAVE_VERSION,
    seed: reqNum(o.seed, 'seed', -0x80000000, 0xffffffff) >>> 0,
    day: reqNum(o.day, 'day', 1, 1e9),
    coins: reqNum(o.coins, 'coins', 0, 1e9),
    playerName: typeof o.playerName === 'string' && o.playerName.trim() ? o.playerName : 'AGENT',
    dragons,
    squad,
    nextDragonId,
    food,
    items,
    dex: { seen: [...seen], owned: [...owned] },
    missions,
    flags,
    settings: { sound: bool(st.sound), music: bool(st.music), fastText: bool(st.fastText) },
    stats: {
      battlesWon: optNum(stats.battlesWon, 0, 0, 1e9),
      battlesLost: optNum(stats.battlesLost, 0, 0, 1e9),
      missionsCleared: optNum(stats.missionsCleared, 0, 0, 1e9),
      activities: optNum(stats.activities, 0, 0, 1e9),
    },
  };
}

/** A validated dragon; null when its species no longer exists (the dragon is dropped). */
function validateDragon(raw: unknown, known: Set<string>): OwnedDragon | null {
  need(isObj(raw), 'dragon');
  const o = raw as Obj;
  need(typeof o.id === 'string' && o.id.length > 0, 'dragon.id');
  need(typeof o.speciesId === 'string', 'dragon.speciesId');
  const speciesId = o.speciesId as string;
  const level = reqNum(o.level, 'dragon.level', 1, MAX_LEVEL);
  const xp = reqNum(o.xp, 'dragon.xp', 0, 1e12);
  const genes = reqStats(o.genes, 'dragon.genes', 0, 31);
  const training = reqStats(o.training, 'dragon.training', 0, TRAINING_CAP_STAT);
  need(typeof o.personality === 'string', 'dragon.personality');
  need(typeof o.ability === 'string', 'dragon.ability');
  const knownRaw = strArray(o.knownMoves, 'dragon.knownMoves');
  const movesRaw = strArray(o.moves, 'dragon.moves');
  need(isNum(o.hp), 'dragon.hp');
  need(isObj(o.needs), 'dragon.needs');
  const needsObj = o.needs as Obj;
  const needs = {
    fullness: reqNum(needsObj.fullness, 'needs.fullness', 0, 100),
    happiness: reqNum(needsObj.happiness, 'needs.happiness', 0, 100),
    energy: reqNum(needsObj.energy, 'needs.energy', 0, 100),
  };
  need(o.nickname === null || o.nickname === undefined || typeof o.nickname === 'string', 'dragon.nickname');

  if (!known.has(speciesId)) return null;
  const species = SPECIES.find((s) => s.id === speciesId)!;

  // Training over the total cap (hand-edited save): trim from the largest stat down.
  let total = STAT_IDS.reduce((a, s) => a + training[s], 0);
  while (total > TRAINING_CAP_TOTAL) {
    const top = STAT_IDS.reduce((a, s) => (training[s] > training[a] ? s : a), STAT_IDS[0]);
    const cut = Math.min(training[top], total - TRAINING_CAP_TOTAL);
    training[top] -= cut;
    total -= cut;
  }

  const neutral = PERSONALITIES.find((p) => p.up === p.down) ?? PERSONALITIES[0];
  const personality = PERSONALITIES.some((p) => p.id === o.personality) ? (o.personality as string) : neutral.id;
  const ability = Object.prototype.hasOwnProperty.call(ABILITIES, o.ability as string)
    ? (o.ability as string)
    : species.abilities[0];

  // Moves: drop ids that no longer exist; an empty loadout is rebuilt from the learnset.
  const moveExists = (m: string): boolean => Object.prototype.hasOwnProperty.call(MOVES, m);
  const knownMoves = [...new Set(knownRaw.filter(moveExists))];
  let moves = [...new Set(movesRaw.filter((m) => moveExists(m) && knownMoves.includes(m)))].slice(0, 4);
  if (moves.length === 0) {
    for (const m of learnedMovesUpTo(species, level)) if (!knownMoves.includes(m)) knownMoves.push(m);
    moves = startingLoadout(species, level);
  }

  const status = STATUS_IDS.includes(o.status as StatusId) ? (o.status as StatusId) : null;

  const d: OwnedDragon = {
    id: o.id as string,
    speciesId,
    nickname: typeof o.nickname === 'string' && o.nickname.trim() ? o.nickname : null,
    level,
    xp,
    genes,
    training,
    personality,
    ability,
    knownMoves,
    moves,
    hp: 0,
    status,
    needs,
    slotsUsed: optNum(o.slotsUsed, 0, 0, SLOTS_PER_DAY),
    joinedDay: optNum(o.joinedDay, 1, 1, 1e9),
    missions: optNum(o.missions, 0, 0, 1e9),
    battlesWon: optNum(o.battlesWon, 0, 0, 1e9),
  };
  d.hp = clamp(Math.floor(o.hp as number), 0, dragonStats(d).hp);
  if (d.hp === 0) d.status = null;
  return d;
}
