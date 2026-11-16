// Missions: the board's lock state, launching a squad, walking the node path, building each
// battle, writing results back, and paying out rewards.
import {
  ITEM_IDS,
  type FoodId, type ItemId, type MissionDef, type MissionId, type MissionNode, type SpeciesId, type TypeId, type VillainId,
} from '../data/schema.ts';
import { MISSIONS, MISSIONS_IN_ORDER, getFood, getItem, getMission, getSpecies, getVillain, isFood } from '../data/index.ts';
import type { BattleSetup, BattleState, MonInit } from '../battle/types.ts';
import { MAX_LEVEL, MISSION_ENERGY, MISSION_FULLNESS, SQUAD_SIZE, type GameState, type OwnedDragon } from './types.ts';
import {
  addDragon, createDragon, dragonName, dragonStats, findDragon, syncFromBattle, toMonInit,
  type AfterBattle, type XpReport,
} from './dragons.ts';
import { nextSeed, stateRng } from './rng.ts';
import { BAG_MAX } from './habitat.ts';

/** Infiltrate missions pay this much more (DESIGN: +50% coins). */
const INFILTRATE_COIN_BONUS = 1.5;
/** Replays pay this fraction of the coins and this fraction of the dragon chance. */
const REPLAY_COIN_MULT = 0.5;
const REPLAY_DRAGON_MULT = 0.5;
/** A reward dragon joins at about the mission level minus this. */
const REWARD_DRAGON_LEVEL_OFFSET = 2;
/** When every dragon in the reward pool is already owned: this many coins per mission level. */
const CONSOLATION_COINS_PER_LEVEL = 8;

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

/** Replace the current branch node with the chosen option's nodes. */
export function chooseBranch(run: MissionRun, option: number): void {
  const node = currentNode(run);
  if (!node || node.kind !== 'branch') throw new Error('the current node is not a branch');
  const opt = node.options[option];
  if (!opt) throw new Error(`branch has no option ${option}`);
  run.nodes.splice(run.index, 1, ...clone(opt.nodes));
}

/** Rest stop: heal every squad dragon by the node's fraction of max HP; fainted ones get back up. */
export function applyRest(state: GameState, run: MissionRun): string[] {
  const node = currentNode(run);
  if (!node || node.kind !== 'rest') return [];
  const lines: string[] = [];
  for (const did of run.squad) {
    const d = findDragon(state, did);
    if (!d) continue;
    const name = dragonName(d);
    const max = dragonStats(d).hp;
    const amount = node.heal >= 1 ? max : Math.max(1, Math.floor(max * node.heal));
    if (d.hp <= 0) {
      d.hp = Math.min(max, amount);
      lines.push(`${name} got back on its paws! (${d.hp} HP)`);
    } else if (d.hp < max) {
      const gained = Math.min(max - d.hp, amount);
      d.hp += gained;
      lines.push(`${name} recovered ${gained} HP.`);
    } else {
      lines.push(`${name} is already in tip-top shape.`);
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
    if (isBoss && node.kind === 'boss' && node.supercharge) init.startStages = { ...node.supercharge };
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

/** Could the squad carry on if every dragon is down? Only if a rest stop comes before the next fight. */
function restBeforeNextFight(run: MissionRun): boolean {
  for (let i = run.index + 1; i < run.nodes.length; i++) {
    const k = run.nodes[i].kind;
    if (k === 'rest') return true;
    if (k !== 'story') return false;
  }
  return true;
}

/**
 * After a battle: write the dragons back (syncFromBattle), return the bag counts, bank the coins of
 * defeated villains, and set the outcome ('lost' when the squad was wiped, 'retreated' on retreat).
 */
export function finishBattle(state: GameState, run: MissionRun, battle: BattleState): AfterBattle {
  const after = syncFromBattle(state, battle);
  for (const id of ITEM_IDS) state.items[id] = Math.max(0, Math.floor(battle.items[id] ?? 0));
  for (const mon of battle.enemy.team) {
    if (mon.hp > 0) continue;
    run.defeated.push(mon.defId);
    run.coins += getVillain(mon.defId).coins;
  }
  for (const r of after.reports) (run.xp[r.dragonId] ??= []).push(r);
  const wiped = run.squad.every((id) => {
    const d = findDragon(state, id);
    return !d || d.hp <= 0;
  });
  if (battle.winner === 'enemy') run.outcome = 'lost';
  else if (battle.winner === 'retreat') run.outcome = 'retreated';
  else if (wiped && !restBeforeNextFight(run)) run.outcome = 'lost';
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

/** Pay out a won mission: coins, food and items, maybe a new dragon; record the clear. */
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
    const rng = stateRng(state);
    const chance = dr.chance * (firstClear ? 1 : REPLAY_DRAGON_MULT);
    if (rng.chance(chance)) {
      const have = new Set<SpeciesId>([...state.dex.owned, ...state.dragons.map((d) => d.speciesId)]);
      const pool = dr.species.filter((s) => !have.has(s));
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
