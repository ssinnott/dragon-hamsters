// Missions: the board's lock state, launching a squad, walking the node path, building each
// battle, writing results back, and paying out rewards.
import {
  ITEM_IDS, STATUS_NAMES,
  type FoodId, type ItemId, type MissionDef, type MissionId, type MissionNode, type SpeciesId, type StageChanges,
  type StageStat, type TypeId, type VillainId,
} from '../data/schema.ts';
import { MISSIONS, MISSIONS_IN_ORDER, getFood, getItem, getMission, getSpecies, getVillain, isFood } from '../data/index.ts';
import type { BattleSetup, BattleState, MonInit } from '../battle/types.ts';
import { MAX_LEVEL, MISSION_ENERGY, MISSION_FULLNESS, SQUAD_SIZE, type GameState, type OwnedDragon } from './types.ts';
import {
  addDragon, createDragon, dragonName, dragonStats, dragonTypes, findDragon, markSeen, syncFromBattle, toMonInit,
  type AfterBattle, type XpReport,
} from './dragons.ts';
import { nextSeed, stateRng } from './rng.ts';
import { BAG_MAX } from './habitat.ts';
import { intelGrade } from '../battle/matchup.ts';

/** Infiltrate missions pay this much more (DESIGN: +50% coins). */
const INFILTRATE_COIN_BONUS = 1.5;
/** Replays pay this fraction of the coins and this fraction of the dragon chance. */
const REPLAY_COIN_MULT = 0.5;
const REPLAY_DRAGON_MULT = 0.5;
/** A reward dragon joins at about the mission level minus this. */
const REWARD_DRAGON_LEVEL_OFFSET = 2;
/** When every dragon in the reward pool is already owned: this many coins per mission level. */
const CONSOLATION_COINS_PER_LEVEL = 8;
/** Happiness a dragon loses when it faints in a battle (a lost mission means everyone fainted). */
export const FAINT_HAPPINESS = 5;

export type MissionStatus = 'locked' | 'available' | 'cleared';

export function missionStatus(state: GameState, id: MissionId): MissionStatus {
  if ((state.missions[id]?.clears ?? 0) > 0) return 'cleared';
  const def = getMission(id);
  return def.requires.every((r) => (state.missions[r]?.clears ?? 0) > 0) ? 'available' : 'locked';
}

/** The first mission in campaign order that is available and not yet cleared, or null. */
export function nextMission(state: GameState): MissionDef | null {
  return MISSIONS_IN_ORDER.find((m) => missionStatus(state, m.id) === 'available') ?? null;
}

/** Can this squad (1-3 distinct healthy, rested, fed dragons) go on this mission? */
export function canLaunch(state: GameState, id: MissionId, squad: string[]): { ok: boolean; reason?: string } {
  if (!MISSIONS.some((m) => m.id === id)) return { ok: false, reason: 'UNKNOWN MISSION' };
  if (missionStatus(state, id) === 'locked') return { ok: false, reason: 'MISSION LOCKED' };
  if (squad.length < 1) return { ok: false, reason: 'PICK AT LEAST ONE DRAGON' };
  if (squad.length > SQUAD_SIZE) return { ok: false, reason: `A SQUAD HAS AT MOST ${SQUAD_SIZE} DRAGONS` };
  if (new Set(squad).size !== squad.length) return { ok: false, reason: 'EACH DRAGON CAN ONLY GO ONCE' };
  for (const did of squad) {
    const d = findDragon(state, did);
    if (!d) return { ok: false, reason: 'UNKNOWN DRAGON' };
    const name = dragonName(d).toUpperCase();
    if (d.hp <= 0) return { ok: false, reason: `${name} HAS FAINTED` };
    if (d.needs.energy < MISSION_ENERGY) return { ok: false, reason: `${name} IS TOO TIRED` };
    if (d.needs.fullness <= 0) return { ok: false, reason: `${name} IS TOO HUNGRY` };
  }
  return { ok: true };
}

export interface MissionRun {
  missionId: MissionId;
  squad: string[];
  /** A private deep copy of the mission's path; branches splice into it. */
  nodes: MissionNode[];
  index: number;
  /** Coins dropped by defeated villains so far (paid out by completeMission). */
  coins: number;
  defeated: VillainId[];
  xp: Record<string, XpReport[]>;
  outcome: 'active' | 'won' | 'lost' | 'retreated';
  /**
   * Stages the chosen branch routes give the mission's boss (sabotage: rushing in lets the device
   * power him up). encounterSetup adds them to the boss node's own `supercharge`. Absent = none.
   */
  supercharge?: StageChanges;
}

/** Sum two sets of stage changes, clamped to the -6..+6 stage range; zero entries are dropped. */
export function mergeStages(a: StageChanges | undefined, b: StageChanges | undefined): StageChanges | undefined {
  if (!a && !b) return undefined;
  const out: StageChanges = {};
  for (const src of [a, b]) {
    if (!src) continue;
    for (const k of Object.keys(src) as StageStat[]) out[k] = (out[k] ?? 0) + (src[k] ?? 0);
  }
  for (const k of Object.keys(out) as StageStat[]) {
    const v = Math.max(-6, Math.min(6, out[k] ?? 0));
    if (v === 0) delete out[k]; else out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Launch: spends each squad dragon's energy and fullness and remembers the squad. Throws if canLaunch says no. */
export function startMission(state: GameState, id: MissionId, squad: string[]): MissionRun {
  const check = canLaunch(state, id, squad);
  if (!check.ok) throw new Error(`cannot launch ${id}: ${check.reason}`);
  const def = getMission(id);
  const xp: Record<string, XpReport[]> = {};
  for (const did of squad) {
    const d = findDragon(state, did) as OwnedDragon;
    d.needs.energy = Math.max(0, d.needs.energy - MISSION_ENERGY);
    d.needs.fullness = Math.max(0, d.needs.fullness - MISSION_FULLNESS);
    d.missions++;
    xp[did] = [];
  }
  state.squad = [...squad];
  return { missionId: id, squad: [...squad], nodes: clone(def.nodes), index: 0, coins: 0, defeated: [], xp, outcome: 'active' };
}

export function currentNode(run: MissionRun): MissionNode | null {
  return run.nodes[run.index] ?? null;
}

/**
 * Replace the current branch node with the chosen option's nodes. A route's `supercharge` is
 * recorded on the run (run.supercharge) for the boss battle.
 */
export function chooseBranch(run: MissionRun, option: number): void {
  takeRoute(run, run.index, option);
}

/** Splice route `option` of the branch at `run.nodes[at]` into the path (see chooseBranch). */
function takeRoute(run: MissionRun, at: number, option: number): void {
  const node = run.nodes[at];
  if (!node || node.kind !== 'branch') throw new Error('the current node is not a branch');
  const opt = node.options[option];
  if (!opt) throw new Error(`branch has no option ${option}`);
  run.nodes.splice(at, 1, ...clone(opt.nodes));
  if (opt.supercharge) run.supercharge = mergeStages(run.supercharge, opt.supercharge);
}

/** The stages the boss of this boss node starts with: the node's own plus the run's branch routes. */
export function bossSupercharge(run: MissionRun, node: MissionNode): StageChanges | undefined {
  if (node.kind !== 'boss') return undefined;
  return mergeStages(node.supercharge, run.supercharge);
}

/**
 * Rest stop: heal every squad dragon by the node's fraction of max HP; fainted ones get back up.
 * HP only: a status (burn, goop...) stays, and the line says so and how to fix it, so a burned
 * dragon at full HP is never called "tip-top".
 */
export function applyRest(state: GameState, run: MissionRun): string[] {
  const node = currentNode(run);
  if (!node || node.kind !== 'rest') return [];
  const lines: string[] = [];
  const tea = (state.items.herbtea ?? 0) > 0;
  for (const did of run.squad) {
    const d = findDragon(state, did);
    if (!d) continue;
    const name = dragonName(d);
    const max = dragonStats(d).hp;
    const amount = node.heal >= 1 ? max : Math.max(1, Math.floor(max * node.heal));
    const still = d.status
      ? ` still ${STATUS_NAMES[d.status]}. ${tea ? 'Sip a Herbal Tea from the BAG in battle to cure it!' : 'A Herbal Tea (or a nap back home) cures it.'}`
      : '';
    if (d.hp <= 0) {
      d.hp = Math.min(max, amount);
      lines.push(`${name} got back on its paws! (${d.hp} HP)`);
    } else if (d.hp < max) {
      const gained = Math.min(max - d.hp, amount);
      d.hp += gained;
      lines.push(still ? `${name} recovered ${gained} HP, but is${still}` : `${name} recovered ${gained} HP.`);
    } else {
      lines.push(still ? `${name} is rested, but${still}` : `${name} is already in tip-top shape.`);
    }
  }
  return lines;
}

export function advance(run: MissionRun): void {
  run.index = Math.min(run.index + 1, run.nodes.length);
}

/** The BattleSetup for the current battle or boss node. */
export function encounterSetup(state: GameState, run: MissionRun): BattleSetup {
  const node = currentNode(run);
  if (!node || (node.kind !== 'battle' && node.kind !== 'boss')) throw new Error('the current node is not a battle');
  const def = getMission(run.missionId);
  const player: MonInit[] = [];
  for (const did of run.squad) {
    const d = findDragon(state, did);
    if (d) player.push(toMonInit(d));
  }
  const list = node.encounter.enemies;
  const enemy: MonInit[] = list.map((e, i) => {
    const v = getVillain(e.villain);
    const isBoss = node.kind === 'boss' && i === list.length - 1;
    const init: MonInit = {
      kind: 'villain', defId: v.id, ownerRef: null, name: v.name, ability: v.ability,
      level: Math.max(1, Math.min(MAX_LEVEL, Math.round(e.level))), isBoss,
    };
    const stages = isBoss ? bossSupercharge(run, node) : undefined;
    if (stages) init.startStages = stages;
    // The showdown (case 5) is where the boss is caught: it says its `caught` line, not its escape line.
    if (isBoss && def.index === 5) init.caught = true;
    return init;
  });
  return {
    seed: nextSeed(state),
    player,
    enemy,
    items: { ...state.items },
    aiLevel: node.kind === 'boss' ? 'boss' : def.type === 'defend' ? 'elite' : 'minion',
    canRetreat: true,
  };
}

/**
 * Does the path from `nodes[from]` on reach a rest stop (or the end) before the next fight? Story
 * beats are walked past; a branch counts when any of its routes, followed by the rest of the path,
 * does (a wiped squad takes that route: see finishBattle).
 */
function restBeforeFight(nodes: readonly MissionNode[], from: number): boolean {
  for (let i = from; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind === 'rest') return true;
    if (n.kind === 'branch') return restRoute(nodes, i) >= 0;
    if (n.kind !== 'story') return false;
  }
  return true;
}

/** The first route of the branch at `nodes[at]` that reaches a rest stop before the next fight, or -1. */
function restRoute(nodes: readonly MissionNode[], at: number): number {
  const b = nodes[at];
  if (!b || b.kind !== 'branch') return -1;
  const after = nodes.slice(at + 1);
  return b.options.findIndex((o) => restBeforeFight([...o.nodes, ...after], 0));
}

/** Could the squad carry on if every dragon is down? Only if a rest stop comes before the next fight. */
function restBeforeNextFight(run: MissionRun): boolean {
  return restBeforeFight(run.nodes, run.index + 1);
}

/** Said before a route's first story beat when a wiped squad had no choice but to take it. */
const TUCKERED_ROUTE = 'Everyone is too tuckered out for another fight, so the squad sneaks on. ';

/**
 * A won battle that still ends the mission as lost: every squad dragon is down (the last foe and
 * the last dragon fell together, and a double wipe-out goes to the player) and no rest stop comes
 * before the next fight. The battle scene checks it before its outro (no VICTORY! for this one);
 * finishBattle applies it.
 */
export function tuckeredAfterWin(run: MissionRun, battle: BattleState): boolean {
  return battle.winner === 'player' && battle.player.team.every((m) => m.hp <= 0) && !restBeforeNextFight(run);
}

/**
 * After a battle: write the dragons back (syncFromBattle), return the bag counts, bank the coins of
 * defeated villains, take FAINT_HAPPINESS from each dragon that fainted in it, and set the outcome
 * ('lost' when the squad was wiped, or won but too tuckered out to reach the next fight
 * (tuckeredAfterWin); 'retreated' on retreat). A won battle that leaves everyone down right before
 * a branch takes the route that reaches a rest stop in place of the branch (the player gets no
 * choice: the other route would start with a fight nobody can stand up for).
 */
export function finishBattle(state: GameState, run: MissionRun, battle: BattleState): AfterBattle {
  const standing = run.squad.filter((id) => (findDragon(state, id)?.hp ?? 0) > 0);
  const after = syncFromBattle(state, battle);
  // Fainting stings a little (happiness), so the >= 80 battle perk has to be earned back.
  for (const id of standing) {
    const d = findDragon(state, id);
    if (d && d.hp <= 0) d.needs.happiness = Math.max(0, d.needs.happiness - FAINT_HAPPINESS);
  }
  for (const id of ITEM_IDS) state.items[id] = Math.max(0, Math.floor(battle.items[id] ?? 0));
  for (const mon of battle.enemy.team) {
    if (mon.hp > 0) continue;
    run.defeated.push(mon.defId);
    run.coins += getVillain(mon.defId).coins;
  }
  for (const r of after.reports) (run.xp[r.dragonId] ??= []).push(r);
  if (battle.winner === 'enemy') run.outcome = 'lost';
  else if (battle.winner === 'retreat') run.outcome = 'retreated';
  else if (tuckeredAfterWin(run, battle)) run.outcome = 'lost';
  else if (battle.winner === 'player' && run.squad.every((id) => (findDragon(state, id)?.hp ?? 0) <= 0)) {
    // Won, but everyone is down and a branch comes next: the squad cannot take a route that
    // fights first, so it takes the first one that reaches a rest stop (restBeforeNextFight).
    const at = run.index + 1;
    const k = restRoute(run.nodes, at);
    if (k >= 0) {
      takeRoute(run, at, k);
      const first = run.nodes[at];
      if (first?.kind === 'story') first.text = TUCKERED_ROUTE + first.text;
    }
  }
  return after;
}

export interface MissionRewards {
  coins: number;
  food: Partial<Record<FoodId, number>>;
  items: Partial<Record<ItemId, number>>;
  dragon: OwnedDragon | null;
  firstClear: boolean;
  lines: string[];
}

/**
 * Pay out a won mission: coins, food and items, maybe a new dragon; record the clear. Every dragon
 * in the case's reward pool is marked seen in the Dragondex (spotted on the case).
 */
export function completeMission(state: GameState, run: MissionRun): MissionRewards {
  if (run.outcome === 'lost' || run.outcome === 'retreated') throw new Error('only a won mission pays out');
  const def = getMission(run.missionId);
  const rec = state.missions[def.id] ?? { clears: 0, firstClearDay: null };
  const firstClear = rec.clears <= 0;
  const lines: string[] = [];
  const rewards: MissionRewards = { coins: 0, food: {}, items: {}, dragon: null, firstClear, lines };

  let pay = def.rewards.coins;
  if (def.type === 'infiltrate') pay *= INFILTRATE_COIN_BONUS;
  if (!firstClear) pay *= REPLAY_COIN_MULT;
  pay = Math.floor(pay);
  lines.push(firstClear ? 'Case closed! The agency is proud of you.' : 'Case closed again! Replays pay half.');
  if (pay > 0) lines.push(`Mission pay: ${pay} coins${def.type === 'infiltrate' ? ' (+50% for staying sneaky)' : ''}.`);
  if (run.coins > 0) lines.push(`Dropped by the villains: ${run.coins} coins.`);
  rewards.coins = pay + run.coins;

  for (const r of def.rewards.items) {
    const qty = Math.max(0, Math.floor(r.qty));
    if (qty <= 0) continue;
    if (isFood(r.id)) {
      const add = Math.max(0, Math.min(qty, BAG_MAX - state.food[r.id]));
      state.food[r.id] += add;
      rewards.food[r.id] = (rewards.food[r.id] ?? 0) + add;
      lines.push(add > 0 ? `+${add} ${getFood(r.id).name}` : `No room in the pantry for more ${getFood(r.id).name}.`);
    } else {
      const id = r.id;
      const add = Math.max(0, Math.min(qty, BAG_MAX - state.items[id]));
      state.items[id] += add;
      rewards.items[id] = (rewards.items[id] ?? 0) + add;
      lines.push(add > 0 ? `+${add} ${getItem(id).name}` : `No room in the bag for more ${getItem(id).name}.`);
    }
  }

  const dr = def.rewards.dragon;
  if (dr && dr.species.length) {
    // The squad spotted the dragons that live around the case: each gets a Dragondex page.
    for (const sp of dr.species) markSeen(state, sp);
    const rng = stateRng(state);
    const chance = dr.chance * (firstClear ? 1 : REPLAY_DRAGON_MULT);
    if (rng.chance(chance)) {
      const have = new Set<SpeciesId>([...state.dex.owned, ...state.dragons.map((d) => d.speciesId)]);
      // A rescued captive always comes home on the first clear, even if the burrow already has one
      // of its kind (a captive can also live in an earlier case's pool). Otherwise: new species only.
      const pool = def.type === 'rescue' && firstClear ? [...dr.species] : dr.species.filter((s) => !have.has(s));
      const pick = rng.pick(pool);
      if (pick) {
        const level = Math.max(2, Math.min(MAX_LEVEL, Math.round(def.level) - REWARD_DRAGON_LEVEL_OFFSET));
        const d = createDragon(state, pick, level);
        addDragon(state, d);
        rewards.dragon = d;
        const name = getSpecies(pick).name;
        lines.push(def.type === 'rescue'
          ? `The rescued ${name} wants to join the agency! Welcome to the burrow!`
          : `New recruit! ${name} wants to join the agency!`);
      } else {
        const bonus = Math.max(10, Math.round(def.level * CONSOLATION_COINS_PER_LEVEL));
        rewards.coins += bonus;
        lines.push(`Every dragon from this case already lives in your burrow, so the grateful locals chipped in ${bonus} coins instead.`);
      }
    }
  }

  state.coins += rewards.coins;
  state.missions[def.id] = { clears: rec.clears + 1, firstClearDay: rec.firstClearDay ?? state.day };
  state.stats.missionsCleared++;
  run.outcome = 'won';
  return rewards;
}

/** Retreat or quit: the mission ends without rewards (XP already earned is kept). */
export function abandonMission(state: GameState, run: MissionRun): void {
  if (run.outcome === 'active') run.outcome = 'retreated';
  // The squad stays as it is (HP, status, energy spent); sleeping in the Burrow puts it right.
  void state;
}

/** Every distinct villain a mission can field, in order of appearance, including all branch options. */
export function missionVillains(missionId: MissionId): VillainId[] {
  const out: VillainId[] = [];
  const walk = (nodes: readonly MissionNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'battle' || n.kind === 'boss') {
        for (const e of n.encounter.enemies) if (!out.includes(e.villain)) out.push(e.villain);
      } else if (n.kind === 'branch') {
        for (const o of n.options) walk(o.nodes);
      }
    }
  };
  walk(getMission(missionId).nodes);
  return out;
}

/** Intel for the briefing: one type set per distinct villain the mission fields. */
export function intelTypes(missionId: MissionId): TypeId[][] {
  return missionVillains(missionId).map((v) => [...getVillain(v).types]);
}

/** How much each villain counts in a squad dragon's grade: the boss decides the case. */
export const INTEL_WEIGHT = { boss: 3, lieutenant: 2, minion: 1 } as const;

/** The mission's intel with weights (one per intelTypes set) and the boss's index (-1: none). */
export function missionIntel(missionId: MissionId): { types: TypeId[][]; weights: number[]; boss: number } {
  const villains = missionVillains(missionId);
  return {
    types: villains.map((v) => [...getVillain(v).types]),
    weights: villains.map((v) => INTEL_WEIGHT[getVillain(v).role] ?? 1),
    boss: villains.findIndex((v) => getVillain(v).role === 'boss'),
  };
}

/**
 * A dragon's 1-3 star grade for a mission (the briefing's stars): intelGrade over every villain
 * the mission fields, the boss counting 3x and the lieutenant 2x, and never 3 stars for a dragon
 * whose moves cannot hit the boss at least x1 (1 star when they cannot touch him at all).
 */
export function missionGrade(d: OwnedDragon, missionId: MissionId): 1 | 2 | 3 {
  const intel = missionIntel(missionId);
  return intelGrade(dragonTypes(d), d.moves, intel.types, { weights: intel.weights, boss: intel.boss >= 0 ? intel.boss : undefined });
}

/** AUTO-PICK leaves at home anyone more than this many levels below the best dragon that can go. */
export const PICK_LEVEL_GAP = 5;
/** A dragon more than this many levels below a case's level is too low for it (the briefing says so). */
export const TOO_LOW_BELOW_BAND = 3;

/** Is this dragon's level too low for the case (more than TOO_LOW_BELOW_BAND below its level)? */
export function tooLowFor(d: OwnedDragon, missionId: MissionId): boolean {
  return d.level < getMission(missionId).level - TOO_LOW_BELOW_BAND;
}

/**
 * The burrow's dragons in the briefing's order, best pick first: the ones that can go, then among
 * them the ones within PICK_LEVEL_GAP levels of the strongest one or at least at the case's level
 * (a great matchup does not make up for a big level gap), each group by missionGrade and then level.
 */
export function rankForMission(state: GameState, missionId: MissionId): OwnedDragon[] {
  const canGo = new Map(state.dragons.map((d) => [d.id, canLaunch(state, missionId, [d.id]).ok]));
  const top = Math.max(0, ...state.dragons.filter((d) => canGo.get(d.id)).map((d) => d.level));
  const floor = Math.min(top - PICK_LEVEL_GAP, getMission(missionId).level);
  const grade = new Map(state.dragons.map((d) => [d.id, missionGrade(d, missionId)]));
  const tier = (d: OwnedDragon): number => (!canGo.get(d.id) ? 2 : d.level < floor ? 1 : 0);
  return [...state.dragons].sort((a, b) =>
    tier(a) - tier(b) || (grade.get(b.id) ?? 2) - (grade.get(a.id) ?? 2) || b.level - a.level || b.xp - a.xp);
}

/**
 * AUTO-PICK: the first SQUAD_SIZE dragons of rankForMission that can go, in send-out order with the
 * highest level leading (in simulations a lower-level great matchup sent out first often fell
 * before the squad got going).
 */
export function recommendSquad(state: GameState, missionId: MissionId): string[] {
  return rankForMission(state, missionId)
    .filter((d) => canLaunch(state, missionId, [d.id]).ok)
    .slice(0, SQUAD_SIZE)
    .map((d, i) => ({ d, i }))
    .sort((a, b) => b.d.level - a.d.level || a.i - b.i)
    .map(({ d }) => d.id);
}
