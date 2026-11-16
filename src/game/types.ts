// The save-game contract. GameState is the whole persistent world: it is JSON, it lives in
// localStorage under SAVE_KEY, and nothing else is persisted. Everything here is plain data so
// the systems in src/game/ can be tested in Node without a browser.
import type {
  AbilityId, FoodId, ItemId, MissionId, MoveId, PersonalityId, SpeciesId, Stats, StatusId,
} from '../data/schema.ts';

export const SAVE_KEY = 'dragon-hamsters/save/v1';
export const SAVE_VERSION = 1;

/** Burrow rules (tunable). */
export const MAX_LEVEL = 50;
export const SQUAD_SIZE = 3;
/** Activity slots each dragon gets per day (feeding does not use one). */
export const SLOTS_PER_DAY = 2;
/** Energy each squad dragon spends to go on a mission; a dragon below this cannot be sent. */
export const MISSION_ENERGY = 30;
/** Fullness each squad dragon spends on a mission. */
export const MISSION_FULLNESS = 20;
/** EV caps, as in Pokemon. */
export const TRAINING_CAP_STAT = 252;
export const TRAINING_CAP_TOTAL = 510;

export interface Needs {
  /** 0 starving .. 100 stuffed. At 0 a dragon cannot go on missions and loses happiness daily. */
  fullness: number;
  /** 0 sulking .. 100 overjoyed. Affects battle (see BattleMon.happiness). */
  happiness: number;
  /** 0 exhausted .. 100 bouncing. Spent by activities and missions; restored by nap and sleep. */
  energy: number;
}

export interface OwnedDragon {
  /** Unique id, e.g. 'd1', 'd2'. */
  id: string;
  speciesId: SpeciesId;
  /** Null shows the species name. */
  nickname: string | null;
  level: number;
  /** Total XP (medium-fast curve: level^3). */
  xp: number;
  /** IVs 0-31. */
  genes: Stats;
  /** EVs from activities and battles. */
  training: Stats;
  personality: PersonalityId;
  ability: AbilityId;
  /** Every move it has learned, in learn order. */
  knownMoves: MoveId[];
  /** The equipped loadout, 1-4 moves, a subset of knownMoves. */
  moves: MoveId[];
  /** Current HP (0 = fainted). Persists between missions; nap and sleep restore it. */
  hp: number;
  status: StatusId | null;
  needs: Needs;
  /** Activity slots used today. */
  slotsUsed: number;
  /** Day it joined. */
  joinedDay: number;
  missions: number;
  battlesWon: number;
}

export interface MissionRecord {
  clears: number;
  /** Day of first clear (null if never cleared). */
  firstClearDay: number | null;
}

export interface GameState {
  version: number;
  /** Seed for everything derived (new-dragon genes, rewards). Advanced as it is used. */
  seed: number;
  day: number;
  coins: number;
  /** Player's agent name. */
  playerName: string;
  dragons: OwnedDragon[];
  /** Up to SQUAD_SIZE dragon ids: the last squad sent, used as the default. */
  squad: string[];
  /** Counter for new dragon ids. */
  nextDragonId: number;
  food: Record<FoodId, number>;
  items: Record<ItemId, number>;
  dex: { seen: SpeciesId[]; owned: SpeciesId[] };
  missions: Record<MissionId, MissionRecord>;
  /** One-shot flags: tutorials seen, story beats, etc. */
  flags: Record<string, boolean>;
  settings: { sound: boolean; music: boolean; fastText: boolean };
  stats: { battlesWon: number; battlesLost: number; missionsCleared: number; activities: number };
}
