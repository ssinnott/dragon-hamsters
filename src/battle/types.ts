// The battle engine's runtime contract. The engine (src/battle/battle.ts) is pure and synchronous:
// the UI hands it one decision, it resolves a whole turn and returns the events that happened, in
// order. The battle scene animates those events one by one; it never computes outcomes itself.
// The state object is mutated in place and is not saved (missions keep no mid-battle state).
import type {
  AbilityId, MoveId, StageStat, Stats, StatusId, TypeId, ItemId, SpeciesId, VillainId, StageChanges,
} from '../data/schema.ts';
import type { RngInstance } from '../lib/engine/rng.ts';

export type Side = 'player' | 'enemy';

/** How cleverly the enemy picks actions. See src/battle/ai.ts. */
export type AiLevel = 'minion' | 'elite' | 'boss';

export interface MoveSlot {
  id: MoveId;
  pp: number;
  maxPp: number;
}

export interface Volatile {
  /** Remaining confused turns; 0 = not confused. */
  confused: number;
  flinch: boolean;
  /** Cannot swap out (set by a 'trap' move; cleared when the trapper leaves). */
  stuck: boolean;
  /** uid of the combatant that trapped this one. */
  stuckBy: string | null;
  seeded: boolean;
  protecting: boolean;
  /** Consecutive successful protects, for the 1/3^n chance. */
  protectChain: number;
  /** Turns this combatant has been in since it last entered (0 on its first turn; for firstTurn moves). */
  turnsIn: number;
}

/** One combatant. Player dragons are built from OwnedDragon, enemies from VillainDef. */
export interface BattleMon {
  /** Unique within the battle, e.g. 'p0', 'e2'. */
  uid: string;
  side: Side;
  kind: 'dragon' | 'villain';
  /** SpeciesId for dragons, VillainId for villains. */
  defId: SpeciesId | VillainId;
  /** OwnedDragon.id for player dragons; used to write results back after the battle. */
  ownerRef: string | null;
  name: string;
  level: number;
  /** Total experience (dragons only; villains 0). */
  xp: number;
  types: TypeId[];
  ability: AbilityId;
  /** Computed stats at `level` (hp is max HP). Recomputed from the fields below on level up. */
  stats: Stats;
  /** IVs, EVs and personality, kept so a mid-battle level up can recompute `stats`. */
  genes: Stats;
  training: Stats;
  personality: string | null;
  /** Training points earned this battle from defeated foes (applied by syncFromBattle, caps there). */
  trainingGain: Partial<Stats>;
  hp: number;
  moves: MoveSlot[];
  status: StatusId | null;
  /** Sleep turns remaining while snoozing. */
  statusTurns: number;
  stages: Record<StageStat, number>;
  volatile: Volatile;
  isBoss: boolean;
  /** A boss caught for good (its org's showdown): when it faints it says its VillainDef.caught line instead of `defeat`. */
  caught?: boolean;
  /** 0-100, dragons only (villains 50). >= 80: 10% to endure a KO at 1 HP and +1 crit stage. <= 20: 15% to loaf instead of acting. */
  happiness: number;
  /** Whether it has been sent out at least once this battle (XP goes to participants). */
  participated: boolean;
}

export interface SideState {
  team: BattleMon[];
  /** Index into team of the active combatant. */
  active: number;
}

export interface BattleState {
  rng: RngInstance;
  turn: number;
  player: SideState;
  enemy: SideState;
  aiLevel: AiLevel;
  /** Battle items available to the player (consumed in place). */
  items: Partial<Record<ItemId, number>>;
  canRetreat: boolean;
  /**
   * 'choose': waiting for submitTurn.
   * 'switch': the player's active fainted (or pivoted) and they must call submitSwitch.
   * 'over': finished; see winner.
   */
  phase: 'choose' | 'switch' | 'over';
  winner: Side | 'retreat' | null;
  /** Enemy swaps used this battle (smart AI swaps at most 2 times). */
  enemySwaps: number;
  /**
   * After a double knockout, or a foe knocked out while the player's dragon tags out after a
   * pivot, the enemy's replacement is sent out while the player still has to pick one: its entry
   * ability (e.g. ATTACK down on the foe) waits here (its uid) and fires right after the player's
   * replacement comes in (submitSwitch). Absent / null when nothing waits.
   */
  pendingEntry?: string | null;
  /** Every event so far. */
  log: BattleEvent[];
}

export type PlayerAction =
  | { kind: 'move'; slot: number }
  | { kind: 'switch'; index: number }
  | { kind: 'item'; item: ItemId; target: number }
  | { kind: 'retreat' };

/**
 * What happened, in order. The scene shows `text` events in the message box and animates the rest;
 * every non-text event that a player should notice is ALSO preceded or followed by a text event, so
 * a scene that only printed text events would still tell the whole story.
 *
 * Implicit clean-ups (no event of their own): on 'faint' the engine clears the combatant's status,
 * stat stages and volatile state (confusion, SEEDED, STUCK, ...); on 'withdraw' and 'sendOut' it
 * clears its stages and volatile state (the status stays). A scene clears its own copies when it
 * plays those events. Mons that the fainted or withdrawn combatant had STUCK are released with a
 * 'volatile' event.
 */
export type BattleEvent =
  | { t: 'text'; text: string }
  | { t: 'sendOut'; side: Side; uid: string; index: number }
  | { t: 'withdraw'; side: Side; uid: string }
  | { t: 'useMove'; side: Side; uid: string; move: MoveId }
  /** `effectiveness` is the type multiplier (0, 0.25, 0.5, 1, 2, 4). */
  | { t: 'damage'; side: Side; uid: string; amount: number; hp: number; maxHp: number; effectiveness: number; crit: boolean; source: 'move' | 'status' | 'recoil' | 'seed' | 'confusion' }
  | { t: 'heal'; side: Side; uid: string; amount: number; hp: number; maxHp: number }
  | { t: 'miss'; side: Side; uid: string }
  | { t: 'protect'; side: Side; uid: string }
  | { t: 'status'; side: Side; uid: string; status: StatusId | null }
  | { t: 'confuse'; side: Side; uid: string; on: boolean }
  /** SEEDED / STUCK changed (set by a move, or STUCK released when the trapper leaves). Both flags are the new values. */
  | { t: 'volatile'; side: Side; uid: string; seeded: boolean; stuck: boolean }
  | { t: 'stages'; side: Side; uid: string; changes: StageChanges }
  | { t: 'ability'; side: Side; uid: string; ability: AbilityId }
  | { t: 'item'; side: Side; uid: string; item: ItemId }
  | { t: 'faint'; side: Side; uid: string }
  | { t: 'xp'; uid: string; amount: number; total: number }
  | { t: 'levelUp'; uid: string; level: number; stats: Stats }
  | { t: 'end'; winner: Side | 'retreat' };

/** Input for one combatant. */
export interface MonInit {
  kind: 'dragon' | 'villain';
  defId: SpeciesId | VillainId;
  ownerRef?: string | null;
  name?: string;
  level: number;
  xp?: number;
  /** Defaults to the species/villain's first ability. */
  ability?: AbilityId;
  /** Defaults to the last four learnset moves at `level`. */
  moves?: MoveId[];
  /** Current HP; defaults to full. 0 = fainted (allowed for player dragons). */
  hp?: number;
  status?: StatusId | null;
  /** IVs 0-31; defaults to 15s (villains) or must be given (dragons). */
  genes?: Stats;
  /** EVs; default zeros. */
  training?: Stats;
  personality?: string;
  happiness?: number;
  isBoss?: boolean;
  /** The org's showdown boss, caught when it faints: it says its VillainDef.caught line instead of `defeat`. */
  caught?: boolean;
  /** Stages applied at battle start (boss supercharge). */
  startStages?: StageChanges;
}

export interface BattleSetup {
  seed: number;
  player: MonInit[];
  enemy: MonInit[];
  items: Partial<Record<ItemId, number>>;
  aiLevel: AiLevel;
  canRetreat: boolean;
}
