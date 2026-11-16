// The content contract. Every table under src/data/ is typed by this file, and the battle engine,
// the game systems and the UI read content ONLY through these shapes. Behaviour is data: a move's
// side effects and an ability's rule are discriminated unions the battle engine interprets, so new
// content never needs new engine code unless it needs a new `kind`.
//
// Text rule for every player-facing string in content: the engine's pixel font draws A-Z, 0-9,
// space and . , : ; ! ? ' " - + / ( ) % > < & = * [ ] # @ $ _ and the glyphs ▶ ♥ ← → ↑ ↓ ★.
// Lowercase is upper-cased at draw time, so write content in normal sentence case; anything else
// (accents, em dashes, curly quotes, ellipsis characters) draws as a blank. tools/contenttest.ts
// enforces this.

// ---------------------------------------------------------------------------------------------
// Types and stats
// ---------------------------------------------------------------------------------------------

/** The sixteen elemental types. Order is the type chart's row/column order. */
export const TYPE_IDS = [
  'FLUFF', 'FIRE', 'WATER', 'LEAF', 'LIGHTNING', 'EARTH', 'ROCK', 'WINGED',
  'FROST', 'SLIME', 'DARKNESS', 'LIGHT', 'COOKING', 'METAL', 'MIND', 'BRAWL',
] as const;
export type TypeId = (typeof TYPE_IDS)[number];

export type StatId = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export const STAT_IDS: readonly StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export type Stats = Record<StatId, number>;
/** Display names for the six stats (HP, ATTACK, DEFENSE, SP. ATK, SP. DEF, SPEED). */
export const STAT_NAMES: Record<StatId, string> = {
  hp: 'HP', atk: 'ATTACK', def: 'DEFENSE', spa: 'SP. ATK', spd: 'SP. DEF', spe: 'SPEED',
};

/** Stats that have in-battle stages (-6..+6). acc/eva are accuracy and evasion. */
export type StageStat = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'acc' | 'eva';
export type StageChanges = Partial<Record<StageStat, number>>;

export interface TypeInfo {
  id: TypeId;
  /** Display name, e.g. 'FIRE'. */
  name: string;
  /** Badge fill. */
  color: string;
  /** Outline / shadow tone of `color`. */
  dark: string;
  /** Highlight tone of `color`. */
  light: string;
  /** One line of flavour for the type chart screen. */
  blurb: string;
  /** The Pokemon type(s) this parallels, e.g. 'Fire' or 'Poison + Bug'. Shown in the codex. */
  parallel: string;
  /** Archetype, e.g. 'Fast special attackers'. */
  role: string;
  /**
   * Relative stat weights for the type's archetype (average about 1.0). Species base stats are
   * authored from these so that, e.g., every ROCK dragon is slow and armoured like a Rock Pokemon.
   */
  template: Stats;
}

// ---------------------------------------------------------------------------------------------
// Status conditions
// ---------------------------------------------------------------------------------------------

/**
 * Major (persistent) status. One at a time, survives switching, cured by items/moves/abilities.
 *   burn   BURNED   - loses 1/16 max HP each turn end; physical damage dealt x0.5
 *   goop   GOOPED   - (poison) loses 1/8 max HP each turn end
 *   zap    ZAPPED   - (paralysis) speed x0.5; 25% chance each turn to be unable to move
 *   snooze SNOOZING - (sleep) cannot act for 1-3 of its own turns, then wakes
 *   frozen FROZEN   - cannot act; 20% chance to thaw each turn; hit by a FIRE move thaws it
 */
export type StatusId = 'burn' | 'goop' | 'zap' | 'snooze' | 'frozen';
export const STATUS_NAMES: Record<StatusId, string> = {
  burn: 'BURNED', goop: 'GOOPED', zap: 'ZAPPED', snooze: 'SNOOZING', frozen: 'FROZEN',
};
/** Three-letter badge text for HP boxes. */
export const STATUS_SHORT: Record<StatusId, string> = {
  burn: 'BRN', goop: 'GOO', zap: 'ZAP', snooze: 'SLP', frozen: 'FRZ',
};

// ---------------------------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------------------------

export type MoveId = string;
export type MoveCategory = 'physical' | 'special' | 'status';

/** Which particle effect the battle scene plays for a move. */
export type FxKind =
  | 'tackle' | 'slash' | 'bite' | 'punch' | 'flame' | 'splash' | 'leaf' | 'spark' | 'quake'
  | 'rock' | 'wind' | 'ice' | 'goo' | 'shadow' | 'sparkle' | 'food' | 'metal' | 'psy'
  | 'buff' | 'debuff' | 'heal' | 'shield' | 'beam' | 'sound';

/**
 * A move's side effects, applied in array order after damage (or instead of damage for status
 * moves). `chance` is a percentage 1-100; 100 means always.
 *
 * For damaging moves the 'foe' of an effect is the target that was hit; effects with chance < 100
 * only roll when the move dealt damage. For status moves (power 0) the whole move fails with
 * "BUT IT FAILED!" if none of its effects could apply.
 */
export type MoveEffect =
  /** Inflict a major status on the target (fails on a target that already has one, or is immune by type: FIRE can't burn, SLIME/METAL can't be gooped, LIGHTNING can't be zapped, FROST can't freeze). */
  | { kind: 'inflict'; status: StatusId; chance: number }
  /** Confuse the target for 2-5 of its turns (33% chance per turn to hit itself with a 40-power typeless physical blow). */
  | { kind: 'confuse'; chance: number }
  /** Target flinches (loses its action) if it has not acted yet this turn. */
  | { kind: 'flinch'; chance: number }
  /** Change stat stages of the user ('self') or the target ('foe'). */
  | { kind: 'stages'; who: 'self' | 'foe'; changes: StageChanges; chance: number }
  /** User restores `fraction` of its max HP. */
  | { kind: 'heal'; fraction: number }
  /** User restores `fraction` of the damage it just dealt. */
  | { kind: 'drain'; fraction: number }
  /** User takes `fraction` of the damage it just dealt. */
  | { kind: 'recoil'; fraction: number }
  /** Hits min..max times (2-5 uses Pokemon's 35/35/15/15 split); each hit rolls crit separately. */
  | { kind: 'multiHit'; min: number; max: number }
  /** +1 critical-hit stage for this move. */
  | { kind: 'highCrit' }
  /** Blocks every move aimed at the user this turn. Consecutive uses succeed with 1/3, 1/9, ... chance. */
  | { kind: 'protect' }
  /** Target becomes STUCK (cannot swap out) while the user stays in battle. */
  | { kind: 'trap' }
  /** Cure major status of the user ('self') or of every member of the user's team ('team'). */
  | { kind: 'cure'; who: 'self' | 'team' }
  /** Ignore the damage formula: deal the user's level, or a flat number, as damage (type immunity still applies). */
  | { kind: 'fixed'; damage: 'level' | number }
  /** Reset every stat stage of both active combatants to 0. */
  | { kind: 'resetStages' }
  /** Target is SEEDED: loses 1/8 max HP at each turn end and the opposing active heals that much. LEAF types are immune. */
  | { kind: 'seed' }
  /** After hitting, the user swaps out (the player chooses who comes in; AI picks). Does nothing if no healthy teammate. */
  | { kind: 'pivot' }
  /** Never misses, ignoring accuracy and evasion stages. */
  | { kind: 'sureHit' }
  /** User fully heals, cures its status, then falls asleep for exactly 2 turns. */
  | { kind: 'rest' }
  /** Usable while FROZEN; thaws the user first. */
  | { kind: 'thaw' }
  /** Power doubles if the user has a major status (Facade). */
  | { kind: 'facade' }
  /** Power doubles if the target has a major status (Hex). */
  | { kind: 'hex' }
  /** Only works on the user's first turn after entering battle; always flinches (Fake Out). */
  | { kind: 'firstTurn' };

export interface MoveDef {
  id: MoveId;
  name: string;
  type: TypeId;
  category: MoveCategory;
  /** Base power; 0 for status moves. */
  power: number;
  /** Percent 1-100. Ignored when effects include sureHit. Status moves aimed at self use 100. */
  accuracy: number;
  pp: number;
  /** -3..+3; 0 is normal. Protect is +4. */
  priority: number;
  /** Makes contact (triggers contact abilities like static fur). Most physical moves do. */
  contact: boolean;
  /** 'self' for self-buffs/heals; 'foe' for everything aimed at the opponent. */
  target: 'foe' | 'self';
  effects: MoveEffect[];
  /** One line, at most 60 characters, for the move info panel. */
  description: string;
  fx: FxKind;
}

// ---------------------------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------------------------

export type AbilityId = string;

/**
 * An ability's rule. The battle engine implements every kind here; content may only use these.
 * "Contact" means a move with `contact: true` that hit.
 */
export type AbilityEffect =
  /** Moves of `type` deal x`mult` while the holder is at or below 1/3 HP (Blaze/Torrent/Overgrow). */
  | { kind: 'pinch'; type: TypeId; mult: number }
  /** When hit by contact, `chance`% to inflict `status` on the attacker (Static, Flame Body). */
  | { kind: 'contactStatus'; status: StatusId; chance: number }
  /** When hit by contact, the attacker's stages change (Gooey: { spe: -1 }). */
  | { kind: 'contactStages'; changes: StageChanges }
  /** Immune to moves of `type`; when hit by one, heals `heal` of max HP and applies `boost` (Levitate: heal 0; Volt Absorb: heal 0.25; Motor Drive: boost spe +1). */
  | { kind: 'absorb'; type: TypeId; heal: number; boost?: StageChanges }
  /** Damage taken from moves of these types is multiplied by `mult` (Thick Fat: FIRE+FROST x0.5). */
  | { kind: 'resist'; types: TypeId[]; mult: number }
  /** On entering battle, change stages of the opposing active ('foe', Intimidate) or the holder ('self'). */
  | { kind: 'entry'; who: 'foe' | 'self'; changes: StageChanges }
  /** At full HP, a hit that would knock it out leaves it at 1 HP instead. */
  | { kind: 'sturdy' }
  /** Heals `fraction` of max HP at each turn end. */
  | { kind: 'regenTurn'; fraction: number }
  /** +1 speed stage at each turn end. */
  | { kind: 'speedBoost' }
  /** A stat is multiplied by `mult`, always or only while the holder has a major status (Huge Power / Guts / Quick Feet / Marvel Scale). While `when: 'statused'` applies to atk, the burn halving is ignored. */
  | { kind: 'statMult'; stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe'; mult: number; when: 'always' | 'statused' }
  /** Same-type attack bonus becomes `mult` instead of 1.5 (Adaptability: 2). */
  | { kind: 'stab'; mult: number }
  /** Super-effective damage taken is multiplied by `mult` (Filter: 0.75). */
  | { kind: 'filter'; mult: number }
  /** Moves with base power <= 60 get x1.5. */
  | { kind: 'technician' }
  /** Status moves get +1 priority. */
  | { kind: 'prankster' }
  /** +1 attack stage after knocking out a foe. */
  | { kind: 'moxie' }
  /** Heals `fraction` of max HP when swapped out. */
  | { kind: 'switchHeal'; fraction: number }
  /** Major status is cured when swapped out. */
  | { kind: 'switchCure' }
  /** Cannot get these statuses. */
  | { kind: 'statusImmune'; statuses: StatusId[] }
  /** Cannot flinch or be confused. */
  | { kind: 'innerFocus' }
  /** +1 critical-hit stage on every move. */
  | { kind: 'superLuck' }
  /** At full HP, damage taken is halved. */
  | { kind: 'multiscale' }
  /** Opposing moves use 2 PP instead of 1. */
  | { kind: 'pressure' }
  /** `chance`% to cure its own major status at each turn end. */
  | { kind: 'shedSkin'; chance: number }
  /** No recoil damage. */
  | { kind: 'rockHead' }
  /** Opponents cannot lower its stages. */
  | { kind: 'clearBody' }
  /** Secondary-effect chances of its moves are doubled. */
  | { kind: 'sereneGrace' }
  /** Moves of `type` always deal x`mult`. */
  | { kind: 'typeBoost'; type: TypeId; mult: number }
  /** Contact moves deal x`mult` (Tough Claws: 1.3). */
  | { kind: 'contactBoost'; mult: number };

export interface AbilityDef {
  id: AbilityId;
  name: string;
  /** One line, at most 60 characters. */
  description: string;
  effect: AbilityEffect;
  /** The Pokemon ability this parallels, for the codex and docs. */
  parallel: string;
}

// ---------------------------------------------------------------------------------------------
// Personalities (natures): +10% to one stat, -10% to another, or neutral.
// ---------------------------------------------------------------------------------------------

export type PersonalityId = string;
export interface PersonalityDef {
  id: PersonalityId;
  name: string;
  up: Exclude<StatId, 'hp'> | null;
  down: Exclude<StatId, 'hp'> | null;
  /** Short flavour, e.g. 'Races everyone to the food bowl.' */
  blurb: string;
}

// ---------------------------------------------------------------------------------------------
// Food, items, activities (the Burrow)
// ---------------------------------------------------------------------------------------------

export type FoodId = 'seeds' | 'carrot' | 'berries' | 'cheese' | 'dragonfruit';
export const FOOD_IDS: readonly FoodId[] = ['seeds', 'carrot', 'berries', 'cheese', 'dragonfruit'];

export interface FoodDef {
  id: FoodId;
  name: string;
  description: string;
  price: number;
  /** Added to fullness (0-100). */
  fullness: number;
  /** Added to happiness (0-100); doubled for a dragon whose favourite food this is. */
  happiness: number;
  /** Flat XP granted when eaten (0 for most foods). */
  xp: number;
  /** Icon colours. */
  color: string;
  accent: string;
}

export type ItemId = 'seedcake' | 'royalcake' | 'peppep' | 'herbtea' | 'spicybiscuit';
export const ITEM_IDS: readonly ItemId[] = ['seedcake', 'royalcake', 'peppep', 'herbtea', 'spicybiscuit'];

export type ItemEffect =
  /** Restore a fraction of max HP to a non-fainted dragon. */
  | { kind: 'heal'; fraction: number }
  /** Revive a fainted dragon to a fraction of max HP. */
  | { kind: 'revive'; fraction: number }
  /** Cure major status and confusion. */
  | { kind: 'cure' }
  /** Change the active dragon's stages (battle only). */
  | { kind: 'stages'; changes: StageChanges };

export interface ItemDef {
  id: ItemId;
  name: string;
  description: string;
  price: number;
  effect: ItemEffect;
  /** Usable from the Burrow bag outside battle (heal/revive/cure are; stages are battle only). */
  fieldUse: boolean;
  color: string;
  accent: string;
}

export type ActivityId = 'feed' | 'wheel' | 'dig' | 'nap' | 'play';
export const ACTIVITY_IDS: readonly ActivityId[] = ['feed', 'wheel', 'dig', 'nap', 'play'];

export interface ActivityDef {
  id: ActivityId;
  /** Station name in the Burrow, e.g. 'SNACK BAR'. */
  name: string;
  /** Verb for the result line, e.g. 'RAN ON THE WHEEL'. */
  verb: string;
  description: string;
  /** Energy spent (negative = restored). */
  energy: number;
  /** Fullness spent (negative = restored; feeding is handled by the chosen food instead). */
  fullness: number;
  /** Happiness gained (before the likedBy bonus). */
  happiness: number;
  /** Training points (EVs) granted per session. */
  training: Partial<Stats>;
  /** XP granted as a fraction of the XP needed for the dragon's next level (e.g. 0.15). */
  xpFraction: number;
  /** Types that love this activity: double happiness, and for 'dig' better loot. */
  likedBy: TypeId[];
  /** Whether it uses one of the dragon's daily activity slots (feeding does not). */
  usesSlot: boolean;
}

// ---------------------------------------------------------------------------------------------
// Dragon hamster species
// ---------------------------------------------------------------------------------------------

export type SpeciesId = string;

export type WingStyle = 'none' | 'stubby' | 'bat' | 'feather' | 'leaf' | 'flame' | 'crystal' | 'fin' | 'cloud' | 'gear';
export type HornStyle = 'none' | 'nubs' | 'curved' | 'antlers' | 'crystal' | 'bolt' | 'sprout' | 'unicorn' | 'flame' | 'antenna';
export type TailStyle = 'stub' | 'spike' | 'flame' | 'fin' | 'leaf' | 'club' | 'bolt' | 'drip' | 'feather' | 'whisk' | 'star';
export type PatternStyle = 'none' | 'spots' | 'stripes' | 'scales' | 'speckles' | 'swirl' | 'patches';
export type DragonExtra =
  | 'chefHat' | 'goggles' | 'drips' | 'aura' | 'mask' | 'scarf' | 'crown' | 'tuft' | 'bubbles'
  | 'sparkles' | 'bowtie' | 'apron' | 'halo' | 'shell' | 'whiskersLong' | 'monocle' | 'flowers' | 'frostBreath';

/** How the procedural renderer draws a species. Colours are hex strings. */
export interface DragonVisual {
  body: string;
  belly: string;
  accent: string;
  /** Wing membrane / fin colour. */
  wing: string;
  eye: string;
  /** Cheek blush colour. */
  cheek: string;
  /** 0.7 (tiny first stage) .. 1.5 (big final stage). */
  size: number;
  /** 0 = round dumpling, 1 = sleek and long. */
  build: number;
  wings: WingStyle;
  horns: HornStyle;
  tail: TailStyle;
  pattern: PatternStyle;
  extras: DragonExtra[];
}

export type Rarity = 'starter' | 'common' | 'uncommon' | 'rare' | 'legendary';

export interface SpeciesDef {
  id: SpeciesId;
  /** Dragondex number, 1..N, unique, in evolution-line order. */
  dex: number;
  name: string;
  /** Dex category, e.g. 'EMBER HAMSTER'. */
  category: string;
  types: [TypeId] | [TypeId, TypeId];
  baseStats: Stats;
  /** One or two regular abilities; a new dragon gets one at random. */
  abilities: AbilityId[];
  /** Rare ability (5% of new dragons). */
  hiddenAbility?: AbilityId;
  /** Sorted by level; level-1 entries are known from the start. Up to 4 most recent are equipped. */
  learnset: { level: number; move: MoveId }[];
  evolvesTo?: { species: SpeciesId; level: number };
  evolvesFrom?: SpeciesId;
  /** Two to four sentences of Pokedex-style lore. */
  backstory: string;
  /** Short dex fact line, e.g. 'Its cheeks hold enough embers to toast 40 marshmallows.' */
  fact: string;
  height: string;
  weight: string;
  favoriteFood: FoodId;
  rarity: Rarity;
  /** Experience yield base (Pokemon base experience): ~50-70 first stage, ~140 mid, ~220-270 final. */
  baseXp: number;
  visual: DragonVisual;
}

// ---------------------------------------------------------------------------------------------
// Villains
// ---------------------------------------------------------------------------------------------

export type OrgId = 'cheese' | 'crows' | 'snakes' | 'cats' | 'ferrets';
export const ORG_IDS: readonly OrgId[] = ['cheese', 'crows', 'snakes', 'cats', 'ferrets'];
export type VillainId = string;

export type Animal = 'mouse' | 'rat' | 'crow' | 'magpie' | 'pigeon' | 'snake' | 'lizard' | 'toad' | 'cat' | 'ferret' | 'robot' | 'weasel';
export type Outfit = 'none' | 'suit' | 'trenchcoat' | 'labcoat' | 'bandana' | 'tracksuit' | 'cape' | 'apron' | 'armor';
export type VillainProp =
  | 'none' | 'cheeseHat' | 'fedora' | 'monocle' | 'sunglasses' | 'eyepatch' | 'goggles' | 'tophat'
  | 'crown' | 'antenna' | 'chefHat' | 'beret' | 'headphones' | 'helmet';

export interface VillainVisual {
  animal: Animal;
  body: string;
  belly: string;
  accent: string;
  eye: string;
  outfit: Outfit;
  outfitColor: string;
  prop: VillainProp;
  /** 0.8 .. 1.6; bosses are big. */
  size: number;
}

export interface OrgDef {
  id: OrgId;
  name: string;
  /** Short tag for tight UI, e.g. 'BIG CHEESE CREW'. */
  short: string;
  /** Campaign order 1..5. */
  order: number;
  boss: VillainId;
  motto: string;
  description: string;
  lair: string;
  /** The (usually three) types its crew fields. Shown as mission intel. */
  themeTypes: TypeId[];
  emblem: string;
  emblemAccent: string;
}

export interface VillainDef {
  id: VillainId;
  name: string;
  org: OrgId;
  role: 'minion' | 'lieutenant' | 'boss';
  types: [TypeId] | [TypeId, TypeId];
  baseStats: Stats;
  ability: AbilityId;
  /** Like a species learnset: an enemy of level L knows the last four moves with level <= L. */
  learnset: { level: number; move: MoveId }[];
  baseXp: number;
  /** Coins dropped when defeated, before the mission's own reward. */
  coins: number;
  /** Shown on the battle intro, e.g. 'Hand over the cheese and nobody gets nibbled.' */
  taunt: string;
  /** Shown when it faints. */
  defeat: string;
  description: string;
  visual: VillainVisual;
}

// ---------------------------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------------------------

export type MissionTypeId = 'retrieve' | 'rescue' | 'sabotage' | 'infiltrate' | 'defend';
export const MISSION_TYPE_IDS: readonly MissionTypeId[] = ['retrieve', 'rescue', 'sabotage', 'infiltrate', 'defend'];

export interface MissionTypeDef {
  id: MissionTypeId;
  name: string;
  description: string;
  /** The player-facing rule twist, e.g. 'No rest stops - but the enemy is fully scouted.' */
  twist: string;
}

export type LocationId = 'museum' | 'docks' | 'zoo' | 'tower' | 'lab';
export const LOCATION_IDS: readonly LocationId[] = ['museum', 'docks', 'zoo', 'tower', 'lab'];

export interface LocationDef {
  id: LocationId;
  name: string;
  description: string;
  /** Backdrop colours, far to near. */
  sky: string;
  far: string;
  mid: string;
  floor: string;
  accent: string;
}

export interface EncounterSpec {
  /** In the order they are sent out. A boss encounter puts the boss LAST. */
  enemies: { villain: VillainId; level: number }[];
  /** Line shown before the battle starts. */
  intro: string;
}

export type MissionNode =
  | { kind: 'story'; label: string; text: string }
  | { kind: 'battle'; label: string; encounter: EncounterSpec }
  /** Heals every squad dragon by `heal` of max HP (fainted ones revive to that fraction). */
  | { kind: 'rest'; label: string; text: string; heal: number }
  /**
   * The player picks one route; its nodes are spliced in. A route's `supercharge` is applied to the
   * mission's boss at the start of the boss battle (sabotage: rushing in lets the device power him up;
   * cutting the power first costs an extra battle but leaves him normal).
   */
  | { kind: 'branch'; label: string; text: string; options: { label: string; description: string; nodes: MissionNode[]; supercharge?: StageChanges }[] }
  /** Final battle. `supercharge` stages are applied to the boss at battle start (sabotage missions). */
  | { kind: 'boss'; label: string; encounter: EncounterSpec; supercharge?: StageChanges };

export type MissionId = string;

export interface MissionDef {
  id: MissionId;
  org: OrgId;
  type: MissionTypeId;
  location: LocationId;
  /** 1..5 within the org's arc; 5 is the showdown where the boss is finally caught. */
  index: number;
  title: string;
  /** Short objective, e.g. 'RECOVER THE DINOSAUR EGG'. */
  objective: string;
  /** Three to five sentences, told by the agency chief. */
  briefing: string;
  /** Average enemy level; shown on the board. */
  level: number;
  nodes: MissionNode[];
  rewards: {
    coins: number;
    items: { id: ItemId | FoodId; qty: number }[];
    /** `chance` 0..1 to award one of `species` the player does not own yet (rescue missions use 1). */
    dragon?: { species: SpeciesId[]; chance: number };
  };
  /** Missions that must be cleared first. */
  requires: MissionId[];
  /** Shown on the results screen after a win. */
  success: string;
}
