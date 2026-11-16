// The Burrow: the five activity stations, using bag items outside battle, ending the day, moods.
// All numbers come from the ACTIVITIES / FOODS / ITEMS tables; the rules here only combine them.
import {
  FOOD_IDS, ITEM_IDS, STAT_IDS, STAT_NAMES, STATUS_NAMES,
  type ActivityDef, type ActivityId, type FoodId, type ItemId, type Stats,
} from '../data/schema.ts';
import { ACTIVITIES, getFood, getItem, getMove, getSpecies } from '../data/index.ts';
import { xpForLevel } from '../battle/stats.ts';
import { MAX_LEVEL, MISSION_ENERGY, SLOTS_PER_DAY, type GameState, type OwnedDragon } from './types.ts';
import {
  dragonName, dragonStats, dragonTypes, findDragon, grantXp, isFainted, addTraining, type XpReport,
} from './dragons.ts';
import { stateRng, weightedPick } from './rng.ts';

/** Needs live in 0..100. */
const NEED_MAX = 100;
/** endDay: energy restored, fullness spent, and the happiness lost by a dragon left at 0 fullness. */
const NIGHT_ENERGY = 60;
const NIGHT_FULLNESS = 25;
const STARVING_HAPPINESS = 15;
/** At or below this fullness a dragon counts as hungry (mood line, morning report). */
const HUNGRY_AT = 30;
/** At or below this happiness a dragon counts as glum (battle loafing starts at 20). */
const GLUM_AT = 20;
/** Bag cap, so a pantry never overflows its shelves. */
export const BAG_MAX = 99;

/** Dig loot: coins every time; food sometimes; an item rarely; a jackpot very rarely. */
const DIG = {
  coinsMin: 6, coinsMax: 14, coinsPerLevel: 0.5,
  foodChance: 0.3, itemChance: 0.05, jackpotChance: 0.02, jackpotMult: 4,
  /** Diggers (the activity's likedBy types) find more of everything. */
  likedCoins: 1.5, likedFoodChance: 0.5, likedItemChance: 0.12, likedJackpotChance: 0.04,
} as const;

export interface ActivityResult {
  ok: boolean;
  reason?: string;
  lines: string[];
  xp?: XpReport;
  training?: Partial<Stats>;
  loot?: { coins: number; food: Partial<Record<FoodId, number>>; items: Partial<Record<ItemId, number>> };
}

const clampNeed = (v: number): number => Math.max(0, Math.min(NEED_MAX, Math.round(v)));

function likes(d: OwnedDragon, a: ActivityDef): boolean {
  return dragonTypes(d).some((t) => a.likedBy.includes(t));
}

/** Whether `dragonId` can do `activity` right now (with `food` for the Snack Bar). */
export function canDoActivity(state: GameState, dragonId: string, activity: ActivityId, food?: FoodId): { ok: boolean; reason?: string } {
  const d = findDragon(state, dragonId);
  if (!d) return { ok: false, reason: 'NO SUCH DRAGON' };
  const a = ACTIVITIES[activity];
  if (!a) return { ok: false, reason: 'THAT STATION IS CLOSED' };
  if (activity !== 'nap' && isFainted(d)) return { ok: false, reason: 'FAINTED - NEEDS A NAP' };
  if (activity === 'feed') {
    if (!food) return { ok: false, reason: 'PICK A FOOD FIRST' };
    if (!FOOD_IDS.includes(food)) return { ok: false, reason: 'THAT IS NOT FOOD' };
    if ((state.food[food] ?? 0) <= 0) return { ok: false, reason: 'NO ' + getFood(food).name.toUpperCase() + ' IN THE PANTRY' };
    if (d.needs.fullness >= NEED_MAX) return { ok: false, reason: 'TOO FULL TO EAT ANOTHER BITE' };
  }
  if (a.usesSlot && d.slotsUsed >= SLOTS_PER_DAY) return { ok: false, reason: 'NO ACTIVITY SLOTS LEFT TODAY' };
  if (a.energy > 0 && d.needs.energy < a.energy) return { ok: false, reason: 'TOO TIRED' };
  if (activity !== 'feed' && activity !== 'nap' && (d.needs.fullness <= 0 || d.needs.fullness < a.fullness)) {
    return { ok: false, reason: 'TOO HUNGRY TO PLAY' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Result text
// ---------------------------------------------------------------------------------------------

/** A few friendly openers per station; {N} is the dragon's name. */
const FLAVOUR: Record<Exclude<ActivityId, 'feed'>, string[]> = {
  wheel: [
    '{N} ran so fast the wheel squeaked a happy tune!',
    '{N} sprinted on the wheel, tiny wings flapping for extra speed!',
    '{N} raced the wheel and won. Probably.',
  ],
  dig: [
    '{N} dug a twisty tunnel, sneezing out little clouds of dirt.',
    '{N} burrowed deep into the Treasure Tunnels, claws a-blur!',
    '{N} dug and dug until only a wiggly tail was showing.',
  ],
  nap: [
    '{N} curled up in the Cozy Nest and snored softly.',
    '{N} took a toasty nap with its tail tucked over its nose.',
    '{N} napped in a perfect fluffy circle. Zzz.',
  ],
  play: [
    '{N} cannonballed into the Ball Pit! Balls everywhere!',
    '{N} played hide and seek in the Ball Pit and found itself.',
    '{N} juggled three balls with its tail. What a show!',
  ],
};

const fill = (s: string, name: string): string => s.split('{N}').join(name);

function trainingLine(gains: Partial<Stats>): string | null {
  const parts = STAT_IDS.filter((s) => (gains[s] ?? 0) > 0).map((s) => `${STAT_NAMES[s]} +${gains[s]}`);
  return parts.length ? 'TRAINING: ' + parts.join(', ') + '.' : null;
}

/** Lines for an XP report: XP gained, level ups, moves learned, an evolution glow. */
export function xpLines(d: OwnedDragon, r: XpReport): string[] {
  const name = dragonName(d);
  const out: string[] = [];
  if (r.xp > 0) out.push(`${name} gained ${r.xp} XP!`);
  if (r.levelsGained.length) out.push(`${name} grew to level ${r.levelsGained[r.levelsGained.length - 1]}!`);
  for (const m of r.learned) {
    const mv = getMove(m).name;
    out.push(d.moves.includes(m) ? `${name} learned ${mv}!` : `${name} learned ${mv}! Equip it from the DRAGONS screen.`);
  }
  if (r.evolveTo) out.push(`Huh? ${name} is starting to glow!`);
  return out;
}

/** XP for an activity: a fraction of what the dragon's next level needs (at least 1). */
function activityXp(d: OwnedDragon, a: ActivityDef): number {
  if (a.xpFraction <= 0 || d.level >= MAX_LEVEL) return 0;
  const span = xpForLevel(d.level + 1) - xpForLevel(d.level);
  return Math.max(1, Math.round(span * a.xpFraction));
}

// ---------------------------------------------------------------------------------------------
// Doing an activity
// ---------------------------------------------------------------------------------------------

/** Do an activity. A refusal changes nothing and returns ok: false with the reason as its only line. */
export function doActivity(state: GameState, dragonId: string, activity: ActivityId, food?: FoodId): ActivityResult {
  const check = canDoActivity(state, dragonId, activity, food);
  if (!check.ok) return { ok: false, reason: check.reason, lines: [check.reason ?? 'NOT RIGHT NOW'] };
  const d = findDragon(state, dragonId) as OwnedDragon;
  const a = ACTIVITIES[activity];
  state.stats.activities++;
  if (activity === 'feed') return feed(state, d, food as FoodId);

  const name = dragonName(d);
  const rng = stateRng(state);
  const liked = likes(d, a);
  const lines: string[] = [fill(rng.pick(FLAVOUR[activity]) ?? '{N} ' + a.verb + '!', name)];
  const result: ActivityResult = { ok: true, lines };

  d.slotsUsed++;
  const energyBefore = d.needs.energy;
  d.needs.energy = clampNeed(d.needs.energy - a.energy);
  d.needs.fullness = clampNeed(d.needs.fullness - a.fullness);
  const joy = a.happiness * (liked ? 2 : 1);
  d.needs.happiness = clampNeed(d.needs.happiness + joy);

  if (activity === 'nap') {
    const max = dragonStats(d).hp;
    const healed = d.hp < max;
    const cured = d.status;
    d.hp = max;
    d.status = null;
    if (healed) lines.push(`${name} woke up with full HP!`);
    if (cured) lines.push(`${name} is no longer ${STATUS_NAMES[cured]}!`);
    if (d.needs.energy > energyBefore) lines.push(`ENERGY +${d.needs.energy - energyBefore}. ${name} feels refreshed.`);
  }

  if (liked && joy > 0) lines.push(`${name} LOVES the ${a.name}! Double happiness!`);
  else if (joy > 0 && activity === 'play') lines.push(`${name} giggled the whole time. Happiness +${joy}!`);

  const gains = addTraining(d, a.training);
  if (Object.keys(a.training).length) {
    const tl = trainingLine(gains);
    lines.push(tl ?? `${name} has maxed out this kind of training.`);
    result.training = gains;
  }

  if (activity === 'dig') {
    const loot = rollLoot(state, d, liked);
    result.loot = loot;
    lines.push(...lootLines(name, loot, liked));
  }

  const xp = activityXp(d, a);
  if (xp > 0) {
    const r = grantXp(d, xp);
    result.xp = r;
    lines.push(...xpLines(d, r));
  }
  return result;
}

function feed(state: GameState, d: OwnedDragon, food: FoodId): ActivityResult {
  const f = getFood(food);
  const name = dragonName(d);
  const favourite = getSpecies(d.speciesId).favoriteFood === food;
  state.food[food] = Math.max(0, (state.food[food] ?? 0) - 1);
  const before = { ...d.needs };
  d.needs.fullness = clampNeed(d.needs.fullness + f.fullness);
  d.needs.happiness = clampNeed(d.needs.happiness + f.happiness * (favourite ? 2 : 1));
  const lines = [`${name} munched the ${f.name}. Nom nom!`];
  if (favourite) lines.push(`${f.name} is ${name}'s favourite! Double happiness!`);
  const parts: string[] = [];
  if (d.needs.fullness > before.fullness) parts.push(`FULLNESS +${d.needs.fullness - before.fullness}`);
  if (d.needs.happiness > before.happiness) parts.push(`HAPPINESS +${d.needs.happiness - before.happiness}`);
  if (parts.length) lines.push(parts.join(', ') + '.');
  const result: ActivityResult = { ok: true, lines };
  if (f.xp > 0 && d.level < MAX_LEVEL) {
    const r = grantXp(d, f.xp);
    result.xp = r;
    lines.push(`A magical tingle! ${name} feels stronger.`);
    lines.push(...xpLines(d, r));
  }
  return result;
}

/** Dig loot for one session. Food and items are weighted towards the cheap ones (1 / price). */
function rollLoot(state: GameState, d: OwnedDragon, liked: boolean): NonNullable<ActivityResult['loot']> {
  const rng = stateRng(state);
  let coins = rng.int(DIG.coinsMin, DIG.coinsMax) + Math.floor(d.level * DIG.coinsPerLevel);
  if (liked) coins = Math.round(coins * DIG.likedCoins);
  if (rng.chance(liked ? DIG.likedJackpotChance : DIG.jackpotChance)) coins *= DIG.jackpotMult;
  const loot: NonNullable<ActivityResult['loot']> = { coins, food: {}, items: {} };
  state.coins += coins;
  if (rng.chance(liked ? DIG.likedFoodChance : DIG.foodChance)) {
    const f = weightedPick(rng, FOOD_IDS.map((id) => ({ value: id, weight: 1 / Math.max(1, getFood(id).price) })));
    if (f && state.food[f] < BAG_MAX) {
      state.food[f]++;
      loot.food[f] = 1;
    }
  }
  if (rng.chance(liked ? DIG.likedItemChance : DIG.itemChance)) {
    const it = weightedPick(rng, ITEM_IDS.map((id) => ({ value: id, weight: 1 / Math.max(1, getItem(id).price) })));
    if (it && state.items[it] < BAG_MAX) {
      state.items[it]++;
      loot.items[it] = 1;
    }
  }
  return loot;
}

function lootLines(name: string, loot: NonNullable<ActivityResult['loot']>, liked: boolean): string[] {
  const lines: string[] = [];
  if (liked) lines.push(`${name} is a born digger!`);
  lines.push(`${name} dug up ${loot.coins} coins!`);
  for (const f of FOOD_IDS) if (loot.food[f]) lines.push(`Bonus find: ${getFood(f).name}! Into the pantry it goes.`);
  for (const it of ITEM_IDS) if (loot.items[it]) lines.push(`Wow! Something shiny in the dirt: ${getItem(it).name}!`);
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Items outside battle
// ---------------------------------------------------------------------------------------------

/** Use a field item from the bag on a dragon. A refusal keeps the item. */
export function useItemOutside(state: GameState, item: ItemId, dragonId: string): { ok: boolean; line: string } {
  const d = findDragon(state, dragonId);
  if (!d) return { ok: false, line: 'NO SUCH DRAGON' };
  const def = getItem(item);
  if ((state.items[item] ?? 0) <= 0) return { ok: false, line: 'NO ' + def.name.toUpperCase() + ' IN THE BAG' };
  if (!def.fieldUse) return { ok: false, line: `${def.name} only works in battle.` };
  const name = dragonName(d);
  const max = dragonStats(d).hp;
  const e = def.effect;
  let line: string;
  switch (e.kind) {
    case 'heal': {
      if (isFainted(d)) return { ok: false, line: `${name} has fainted. Try a nap or a revive.` };
      if (d.hp >= max) return { ok: false, line: `${name} is already at full HP.` };
      const amount = Math.min(max - d.hp, Math.max(1, Math.floor(max * e.fraction)));
      d.hp += amount;
      line = `${name} nibbled the ${def.name} and recovered ${amount} HP!`;
      break;
    }
    case 'revive': {
      if (!isFainted(d)) return { ok: false, line: `${name} has not fainted.` };
      d.hp = Math.max(1, Math.min(max, Math.floor(max * e.fraction)));
      d.status = null;
      line = `${name} perked right up! Back on its paws with ${d.hp} HP.`;
      break;
    }
    case 'cure': {
      if (isFainted(d)) return { ok: false, line: `${name} has fainted. Try a nap or a revive.` };
      if (!d.status) return { ok: false, line: `${name} is feeling fine already.` };
      line = `${name} sipped the ${def.name}. No longer ${STATUS_NAMES[d.status]}!`;
      d.status = null;
      break;
    }
    default:
      return { ok: false, line: `${def.name} only works in battle.` };
  }
  state.items[item]--;
  return { ok: true, line };
}

// ---------------------------------------------------------------------------------------------
// Sleep and moods
// ---------------------------------------------------------------------------------------------

export interface DayReport {
  /** The new day. */
  day: number;
  lines: string[];
}

const NIGHT_LINES = [
  'Everyone curled up in one big fluffy pile and slept until morning.',
  'The burrow snored in harmony all night long.',
  'Chief Nibbles tucked everyone in and read a spy story. Zzz.',
  'A cosy night of tail-tucked dreams about mountains of seeds.',
];

/** SLEEP: heal and cure everyone, restore energy, spend fullness, reset slots, next day. */
export function endDay(state: GameState): DayReport {
  const lines: string[] = [NIGHT_LINES[(state.day - 1) % NIGHT_LINES.length]];
  let mended = false;
  const warnings: string[] = [];
  for (const d of state.dragons) {
    const max = dragonStats(d).hp;
    if (d.hp < max || d.status) mended = true;
    d.hp = max;
    d.status = null;
    d.needs.energy = clampNeed(d.needs.energy + NIGHT_ENERGY);
    d.needs.fullness = clampNeed(d.needs.fullness - NIGHT_FULLNESS);
    if (d.needs.fullness <= 0) d.needs.happiness = clampNeed(d.needs.happiness - STARVING_HAPPINESS);
    d.slotsUsed = 0;
    const name = dragonName(d);
    if (d.needs.fullness <= 0) warnings.push(`${name} is starving and grumpy! Visit the Snack Bar.`);
    else if (d.needs.fullness <= HUNGRY_AT) warnings.push(`${name}'s tummy is rumbling.`);
    if (d.needs.happiness <= GLUM_AT) warnings.push(`${name} is feeling glum. The Ball Pit would cheer it up.`);
  }
  state.day++;
  if (mended && state.dragons.length) lines.push('Scrapes mended, sniffles gone: the whole burrow is healed.');
  lines.push(...warnings);
  if (state.dragons.length && !warnings.length) lines.push('Everyone woke up bright-eyed and ready for action!');
  if (FOOD_IDS.every((f) => (state.food[f] ?? 0) <= 0)) lines.push('The pantry is empty! The Pantry Shop sells snacks.');
  lines.push(`Day ${state.day} begins!`);
  return { day: state.day, lines };
}

/** A one-word (or two) mood for the roster and the burrow, most urgent first. */
export function moodLine(d: OwnedDragon): string {
  if (isFainted(d)) return 'FAINTED';
  if (d.needs.fullness <= 0) return 'STARVING!';
  if (d.status) return STATUS_NAMES[d.status] + '!';
  if (d.needs.fullness <= HUNGRY_AT) return 'HUNGRY!';
  if (d.needs.energy < MISSION_ENERGY) return 'SLEEPY';
  if (d.needs.happiness <= GLUM_AT) return 'GRUMPY';
  if (d.needs.happiness >= 80) return 'OVERJOYED';
  if (d.needs.happiness >= 50) return 'HAPPY';
  return 'CONTENT';
}
