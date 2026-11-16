// Game-systems tests (src/game/*), run under Node: node tools/gametest.ts [--sim] [--seed N]
//
// Covers the save contract, dragons (creation, XP, moves, evolution, training), every Burrow
// activity and refusal, the shop, and the mission lifecycle end to end through the real battle
// engine with a simple autopilot. It finishes with a campaign simulation: three missions by
// default, the whole campaign with --sim. The simulation only fails the run on an exception; losing
// a mission is reported, never an error. Exit code 1 on any failure.
//
// Every expectation is derived from the content tables, so the tests keep working as content is
// rebalanced. Checks that need content the tables do not have (say, no species evolves yet) are
// reported as skipped rather than passed.
import {
  FOODS, ITEMS, MISSIONS, MISSIONS_IN_ORDER, MOVES, PERSONALITIES, SPECIES,
  getActivity, getMission, getMove, getSpecies, getVillain,
} from '../src/data/index.ts';
import { STARTERS } from '../src/data/index.ts';
import {
  ACTIVITY_IDS, FOOD_IDS, ITEM_IDS, STAT_IDS,
  type ActivityId, type FoodId, type MissionId, type SpeciesDef, type SpeciesId,
} from '../src/data/schema.ts';
import { xpForLevel, levelForXp } from '../src/battle/stats.ts';
import { defaultMoves } from '../src/battle/build.ts';
import { activeMon, createBattle, legal, startBattle, submitSwitch, submitTurn } from '../src/battle/battle.ts';
import { estimateDamage } from '../src/battle/damage.ts';
import type { BattleState } from '../src/battle/types.ts';
import {
  MAX_LEVEL, MISSION_ENERGY, MISSION_FULLNESS, SAVE_KEY, SAVE_VERSION, SLOTS_PER_DAY, SQUAD_SIZE,
  TRAINING_CAP_STAT, TRAINING_CAP_TOTAL,
  type GameState, type OwnedDragon,
} from '../src/game/types.ts';
import { nextSeed, stateRng } from '../src/game/rng.ts';
import { clearSave, loadGame, memoryStorage, newGame, parseSave, saveGame, type Storage } from '../src/game/state.ts';
import {
  STATUS_MOVE_VALUE, addDragon, addTraining, autoSwapFor, createDragon, dragonName, dragonStats, dragonTypes, evolve,
  evolveDragon, foldSwaps, grantXp, isFainted, moveValue, setLoadout, syncFromBattle, toMonInit, type XpReport,
} from '../src/game/dragons.ts';
import { canDoActivity, doActivity, endDay, moodLine, swapLines as swapLinesFor, useItemOutside } from '../src/game/habitat.ts';
import { SHOP, buy } from '../src/game/shop.ts';
import {
  abandonMission, advance, applyRest, canLaunch, chooseBranch, completeMission, currentNode, encounterSetup,
  finishBattle, intelTypes, missionStatus, nextMission, startMission, type MissionRun,
} from '../src/game/missions.ts';

// ---------------------------------------------------------------------------------------------
// A tiny harness
// ---------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const FULL_SIM = args.includes('--sim');
const seedArg = args.indexOf('--seed');
const SIM_SEED = seedArg >= 0 ? Number(args[seedArg + 1]) || 1 : 20240611;

let failures = 0;
let passed = 0;
const skipped: string[] = [];

class Fail extends Error {}

function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Fail(msg);
}
function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) throw new Fail(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
}
function deepEq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Fail(`${msg}:\n    expected ${b}\n    got      ${a}`);
}
function skip(msg: string): void {
  skipped.push(msg);
}

function test(name: string, fn: () => void): void {
  const t0 = Date.now();
  try {
    fn();
    passed++;
    console.log(`  ok   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}`);
    console.log('       ' + (e instanceof Error ? (e instanceof Fail ? e.message : e.stack ?? e.message) : String(e)).split('\n').join('\n       '));
  }
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const FIRE = STARTERS[0];
const WATER = STARTERS[2] ?? STARTERS[STARTERS.length - 1];

/** A new game with the fire and water starters at `level`. */
function gameWithStarters(seed = 7, level = 5): GameState {
  const s = newGame(seed);
  for (const sp of [FIRE, WATER]) addDragon(s, createDragon(s, sp, level));
  return s;
}

function speciesOfType(pred: (s: SpeciesDef) => boolean): SpeciesDef | undefined {
  return SPECIES.find(pred);
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------------------------
// The autopilot: never swaps by choice, always picks the move with the best expected damage.
// ---------------------------------------------------------------------------------------------

function bestMoveSlot(battle: BattleState): number {
  const me = activeMon(battle, 'player');
  const foe = activeMon(battle, 'enemy');
  const lg = legal(battle);
  let best = -1;
  let bestScore = -1;
  me.moves.forEach((slot, i) => {
    if (!lg.moves[i]) return;
    const est = estimateDamage(me, foe, slot.id);
    const acc = getMove(slot.id).accuracy;
    const score = ((est.min + est.max) / 2) * (Math.min(100, acc) / 100);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  // No usable move at all: slot 0 (the engine turns it into its out-of-PP struggle).
  return best >= 0 ? best : 0;
}

/** Fight a battle to the end. Throws if it does not end in a sane number of turns. */
function autopilot(battle: BattleState, maxTurns = 400): void {
  startBattle(battle);
  let steps = 0;
  while (battle.phase !== 'over') {
    if (++steps > maxTurns) throw new Error(`battle still going after ${maxTurns} decisions`);
    if (battle.phase === 'switch') {
      const lg = legal(battle);
      const idx = lg.switches.findIndex(Boolean);
      if (idx < 0) throw new Error('switch phase with no legal switch');
      submitSwitch(battle, idx);
      continue;
    }
    submitTurn(battle, { kind: 'move', slot: bestMoveSlot(battle) });
  }
}

/** Evolve every dragon whose report says so (as the results scene does). */
function evolveReported(state: GameState, reports: XpReport[]): string[] {
  const out: string[] = [];
  for (const r of reports) {
    if (!r.evolveTo) continue;
    const d = state.dragons.find((x) => x.id === r.dragonId);
    if (!d) continue;
    // A big XP jump could pass two evolution levels: evolve until settled.
    while (getSpecies(d.speciesId).evolvesTo && d.level >= (getSpecies(d.speciesId).evolvesTo?.level ?? Infinity)) {
      const from = evolve(state, d);
      out.push(`${getSpecies(from).name} -> ${getSpecies(d.speciesId).name}`);
    }
  }
  return out;
}

/**
 * Walk a launched mission to its end with the autopilot. Branches take option `branchPick` (or the
 * last option if there are fewer). Returns the run and any evolutions that happened.
 */
function playMission(state: GameState, run: MissionRun, branchPick = 0): { run: MissionRun; evolutions: string[]; battles: number } {
  const evolutions: string[] = [];
  let battles = 0;
  let guard = 0;
  while (run.outcome === 'active') {
    if (++guard > 200) throw new Error('mission path did not end');
    const node = currentNode(run);
    if (!node) break;
    if (node.kind === 'story') advance(run);
    else if (node.kind === 'rest') { applyRest(state, run); advance(run); }
    else if (node.kind === 'branch') chooseBranch(run, Math.min(branchPick, node.options.length - 1));
    else {
      const battle = createBattle(encounterSetup(state, run));
      autopilot(battle);
      battles++;
      const after = finishBattle(state, run, battle);
      evolutions.push(...evolveReported(state, after.reports));
      if (run.outcome === 'active') advance(run);
    }
  }
  return { run, evolutions, battles };
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

console.log('gametest: src/game systems');

test('newGame', () => {
  const s = newGame(1234);
  eq(s.version, SAVE_VERSION, 'version');
  eq(s.day, 1, 'day');
  eq(s.coins, 200, 'coins');
  eq(s.playerName, 'AGENT', 'default player name');
  eq(newGame(1, 'ZED').playerName, 'ZED', 'given player name');
  deepEq(s.food, { seeds: 5, carrot: 3, berries: 2, cheese: 1, dragonfruit: 0 }, 'pantry');
  deepEq(s.items, { seedcake: 3, royalcake: 0, peppep: 0, herbtea: 1, spicybiscuit: 0 }, 'bag');
  eq(s.dragons.length, 0, 'no dragons');
  eq(s.squad.length, 0, 'no squad');
  eq(s.nextDragonId, 1, 'nextDragonId');
  deepEq(s.dex, { seen: [], owned: [] }, 'dex');
  deepEq(s.missions, {}, 'missions');
  deepEq(s.flags, {}, 'flags');
  deepEq(s.settings, { sound: true, music: true, fastText: true }, 'settings');
  deepEq(s.stats, { battlesWon: 0, battlesLost: 0, missionsCleared: 0, activities: 0 }, 'stats');
  for (const f of FOOD_IDS) ok(f in s.food, `pantry has ${f}`);
  for (const i of ITEM_IDS) ok(i in s.items, `bag has ${i}`);
});

test('stateRng advances the saved seed and replays', () => {
  const a = newGame(99);
  const b = newGame(99);
  const ra = stateRng(a);
  const draws = [ra.next(), ra.int(1, 6), ra.range(2, 3), ra.chance(0.5) ? 1 : 0];
  ok(a.seed !== 99, 'seed advanced');
  const rb = stateRng(b);
  deepEq([rb.next(), rb.int(1, 6), rb.range(2, 3), rb.chance(0.5) ? 1 : 0], draws, 'same seed, same draws');
  // Two views over one state share a single stream.
  const c = newGame(5);
  const d = newGame(5);
  const c1 = stateRng(c);
  const c2 = stateRng(c);
  const mixed = [c1.next(), c2.next(), c1.next()];
  const rd = stateRng(d);
  deepEq(mixed, [rd.next(), rd.next(), rd.next()], 'instances share the stream');
  // Replay from a save made mid-stream.
  const e = newGame(77);
  stateRng(e).next();
  const snapshot = clone(e);
  const after = [stateRng(e).next(), stateRng(e).next()];
  deepEq([stateRng(snapshot).next(), stateRng(snapshot).next()], after, 'replays from a snapshot');
  for (let i = 0; i < 200; i++) {
    const n = stateRng(e).int(3, 5);
    ok(n >= 3 && n <= 5 && Number.isInteger(n), 'int in range');
    const sd = nextSeed(e);
    ok(sd >= 1 && sd <= 0x7fffffff, 'battle seed in range');
  }
});

test('createDragon: determinism and shape', () => {
  const a = newGame(4242);
  const b = newGame(4242);
  const da = createDragon(a, FIRE, 5);
  const db = createDragon(b, FIRE, 5);
  deepEq(da, db, 'same seed, same dragon');
  eq(da.id, 'd1', 'first id');
  eq(createDragon(a, FIRE, 5).id, 'd2', 'second id');
  eq(a.nextDragonId, 3, 'nextDragonId advanced');
  const sp = getSpecies(FIRE);
  eq(da.level, 5, 'level');
  eq(da.xp, xpForLevel(5), 'xp at level');
  for (const s of STAT_IDS) ok(da.genes[s] >= 0 && da.genes[s] <= 31 && Number.isInteger(da.genes[s]), `gene ${s} in 0-31`);
  for (const s of STAT_IDS) eq(da.training[s], 0, `training ${s}`);
  ok(PERSONALITIES.some((p) => p.id === da.personality), 'personality from table');
  ok(sp.abilities.includes(da.ability) || sp.hiddenAbility === da.ability, 'ability from species');
  deepEq(da.knownMoves, [...new Set(sp.learnset.filter((e) => e.level <= 5).map((e) => e.move))], 'knownMoves = learnset <= level');
  deepEq(da.moves, defaultMoves(sp.learnset, 5), 'moves = defaultMoves');
  eq(da.hp, dragonStats(da).hp, 'full hp');
  deepEq(da.needs, { fullness: 70, happiness: 60, energy: 100 }, 'needs');
  eq(da.status, null, 'no status');
  eq(da.nickname, null, 'no nickname');
  eq(dragonName(da), sp.name, 'name is species name');
  deepEq(dragonTypes(da), [...sp.types], 'types');
  // Different seeds give different genes (overwhelmingly likely across 6 stats).
  const dc = createDragon(newGame(1), FIRE, 5);
  ok(JSON.stringify(dc.genes) !== JSON.stringify(da.genes), 'different seed, different genes');
  // Hidden abilities appear about 5% of the time.
  const hid = speciesOfType((s) => !!s.hiddenAbility);
  if (hid) {
    const g = newGame(31337);
    let n = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) if (createDragon(g, hid.id, 10).ability === hid.hiddenAbility) n++;
    ok(n > N * 0.02 && n < N * 0.09, `hidden ability rate ${n}/${N} near 5%`);
  } else skip('hidden ability rate (no species has a hidden ability)');
  // addDragon marks the dex.
  const g = newGame(3);
  addDragon(g, createDragon(g, FIRE, 5));
  ok(g.dex.seen.includes(FIRE) && g.dex.owned.includes(FIRE), 'dex seen + owned');
  addDragon(g, g.dragons[0]);
  eq(g.dragons.length, 1, 'adding twice does not duplicate');
});

test('XP curve, level ups and learned moves', () => {
  eq(xpForLevel(1), 0, 'L1');
  eq(xpForLevel(5), 125, 'L5');
  eq(xpForLevel(10), 1000, 'L10');
  eq(levelForXp(124), 4, 'levelForXp below 5');
  eq(levelForXp(125), 5, 'levelForXp at 5');
  eq(levelForXp(10 ** 9), MAX_LEVEL, 'level cap');

  const s = newGame(11);
  const d = createDragon(s, FIRE, 5);
  addDragon(s, d);
  // Half HP before levelling: proportion is kept.
  const max0 = dragonStats(d).hp;
  d.hp = Math.floor(max0 / 2);
  const r = grantXp(d, xpForLevel(8) - d.xp);
  eq(d.level, 8, 'reached level 8');
  deepEq(r.levelsGained, [6, 7, 8], 'levelsGained');
  eq(r.xp, xpForLevel(8) - xpForLevel(5), 'xp reported');
  const max1 = dragonStats(d).hp;
  ok(max1 > max0, 'max hp grew');
  ok(Math.abs(d.hp / max1 - Math.floor(max0 / 2) / max0) < 0.06, `hp proportion kept (${d.hp}/${max1})`);
  // A fainted dragon stays fainted through a level up.
  d.hp = 0;
  grantXp(d, xpForLevel(9) - d.xp);
  eq(d.hp, 0, 'fainted stays fainted');
  // Cap.
  const capR = grantXp(d, 10 ** 9);
  eq(d.level, MAX_LEVEL, 'capped at MAX_LEVEL');
  eq(d.xp, xpForLevel(MAX_LEVEL), 'xp capped');
  ok(capR.xp > 0, 'xp reported up to the cap');
  eq(grantXp(d, 500).xp, 0, 'no xp past the cap');

  // Learned moves: auto-equip into a free slot, otherwise known only.
  let withLater: { sp: SpeciesDef; e: SpeciesDef['learnset'][number] } | undefined;
  for (const sp of SPECIES) {
    const e = sp.learnset.find((le) => le.level > 2 && !sp.learnset.some((o) => o.level < le.level && o.move === le.move));
    if (e) { withLater = { sp, e }; break; }
  }
  if (!withLater) { skip('learned moves (no learnset has a new move above level 2)'); return; }
  const { sp, e } = withLater;
  const g = newGame(12);
  const a = createDragon(g, sp.id, e.level - 1);
  addDragon(g, a);
  setLoadout(a, [a.knownMoves[0]]);
  const ra = grantXp(a, xpForLevel(e.level) - a.xp);
  ok(ra.learned.includes(e.move), 'move learned at its level');
  ok(a.moves.includes(e.move), 'auto-equipped into a free slot');
  ok(a.knownMoves.includes(e.move), 'in knownMoves');
  // Full loadout: find a learn level where the dragon already has four moves equipped.
  const full = SPECIES.flatMap((x) => x.learnset.map((le) => ({ x, le })))
    .find(({ x, le }) => le.level > 1 && defaultMoves(x.learnset, le.level - 1).length === 4
      && !x.learnset.some((o) => o.level < le.level && o.move === le.move));
  if (!full) { skip('learning with a full loadout (no learnset has 5+ moves)'); return; }
  const b = createDragon(g, full.x.id, full.le.level - 1);
  const before = [...b.moves];
  const expected = autoSwapFor(b, full.le.move);
  const rb = grantXp(b, xpForLevel(full.le.level) - b.xp);
  ok(rb.learned.includes(full.le.move), 'learned with a full loadout');
  ok(b.knownMoves.includes(full.le.move), 'known after learning');
  eq(b.moves.length, 4, 'still four moves equipped');
  if (expected) {
    deepEq(rb.swapped, [expected], 'swap reported');
    deepEq(b.moves, before.map((m) => (m === expected.out ? expected.in : m)), 'swapped into the weakest slot');
  } else {
    deepEq(rb.swapped, [], 'no swap reported');
    deepEq(b.moves, before, 'full loadout unchanged when the new move is not better');
  }
});

test('auto-equip: a better move replaces the weakest equipped one', () => {
  // A level-up into a full loadout: every swap the content produces must follow the rule.
  let swaps = 0;
  let keeps = 0;
  for (const sp of SPECIES) {
    const g = newGame(13);
    const d = createDragon(g, sp.id, 1);
    for (let L = 2; L <= MAX_LEVEL; L++) {
      const learnHere = sp.learnset.filter((le) => le.level === L && !d.knownMoves.includes(le.move)).map((le) => le.move);
      const beforeMoves = [...d.moves];
      const types = getSpecies(d.speciesId).types;
      const r = grantXp(d, xpForLevel(L) - d.xp);
      for (const x of r.swapped) {
        swaps++;
        ok(beforeMoves.includes(x.out) && !d.moves.includes(x.out), `${sp.id} L${L}: ${x.out} left the loadout`);
        ok(d.moves.includes(x.in) && learnHere.includes(x.in), `${sp.id} L${L}: ${x.in} is a new move in the loadout`);
        ok(d.moves.indexOf(x.in) === beforeMoves.indexOf(x.out), `${sp.id} L${L}: swapped in place`);
        const statusIn = getMove(x.in).category === 'status' && !getMove(x.in).effects.some((e) => e.kind === 'fixed');
        if (!statusIn) ok(moveValue(types, x.in) > moveValue(types, x.out) || getMove(x.out).category === 'status', `${sp.id} L${L}: ${x.in} beats ${x.out}`);
      }
      if (beforeMoves.length === 4 && learnHere.length && !r.swapped.length) keeps++;
      eq(d.moves.length, Math.min(4, d.knownMoves.length), `${sp.id} L${L}: loadout stays full`);
      eq(new Set(d.moves).size, d.moves.length, `${sp.id} L${L}: no duplicates`);
      const statusEquipped = d.moves.filter((m) => getMove(m).category === 'status').length;
      if (beforeMoves.length === 4) ok(statusEquipped <= Math.max(1, beforeMoves.filter((m) => getMove(m).category === 'status').length), `${sp.id} L${L}: no extra status moves`);
    }
  }
  ok(swaps > 0, 'the content produces at least one swap');
  // A hand-made case: a weak non-STAB move goes, a strong STAB move comes in, the report says so.
  const g = newGame(14);
  const fire = getSpecies(FIRE);
  const d = createDragon(g, FIRE, 5);
  const allMoves = Object.keys(MOVES);
  const weak = allMoves.find((m) => getMove(m).category !== 'status' && getMove(m).power > 0 && getMove(m).power <= 40 && !fire.types.includes(getMove(m).type) && !getMove(m).effects.some((e) => e.kind === 'multiHit'));
  const strong = allMoves.filter((m) => getMove(m).type === fire.types[0] && getMove(m).category !== 'status' && getMove(m).power >= 80)
    .find((m) => !d.knownMoves.includes(m));
  const st = allMoves.filter((m) => getMove(m).category === 'status');
  if (!weak || !strong || st.length < 3) { skip('auto-equip hand-made case (content lacks the moves)'); return; }
  d.knownMoves = [weak, st[0], st[1], st[2]];
  d.moves = [weak, st[0], st[1], st[2]];
  // Two extra status moves count 0, so they go before the weak attack does.
  const sw = autoSwapFor(d, strong);
  deepEq(sw, { out: st[1], in: strong }, 'a second status move is the first to go');
  d.moves = [weak, st[0], ...allMoves.filter((m) => getMove(m).category !== 'status' && getMove(m).power >= 60 && fire.types.includes(getMove(m).type) && m !== strong).slice(0, 2)];
  if (d.moves.length === 4) {
    d.knownMoves = [...d.moves];
    deepEq(autoSwapFor(d, strong), { out: weak, in: strong }, 'the weak non-STAB attack goes before the one status move');
    eq(autoSwapFor(d, st[2]), null, 'a second status move is never swapped in');
    eq(autoSwapFor(d, weak), null, 'an equipped move is not swapped');
  }
  ok(moveValue(fire.types, strong) > moveValue(fire.types, weak), 'STAB power beats weak power');
  eq(moveValue(fire.types, st[0]), STATUS_MOVE_VALUE, 'status value');
  ok(swapLinesFor([{ out: weak, in: strong }])[0] === `SWAPPED ${getMove(weak).name.toUpperCase()} FOR ${getMove(strong).name.toUpperCase()}!`, 'swap line text');
  // Folding: A->B then B->C reads as A->C.
  deepEq(foldSwaps([[{ out: 'a', in: 'b' }], [{ out: 'b', in: 'c' }, { out: 'x', in: 'y' }]]), [{ out: 'a', in: 'c' }, { out: 'x', in: 'y' }], 'foldSwaps');
  void keeps;
});

test('evolution', () => {
  const sp = speciesOfType((s) => !!s.evolvesTo);
  if (!sp || !sp.evolvesTo) { skip('evolution (no species evolves)'); return; }
  const target = getSpecies(sp.evolvesTo.species);
  const s = newGame(21);
  const d = createDragon(s, sp.id, Math.max(1, sp.evolvesTo.level - 1));
  addDragon(s, d);
  d.nickname = 'Sparky';
  addTraining(d, { atk: 40 });
  const r0 = grantXp(d, 1);
  eq(r0.evolveTo, sp.evolvesTo.level <= d.level ? target.id : null, 'no evolution below the level');
  const r = grantXp(d, xpForLevel(sp.evolvesTo.level) - d.xp);
  eq(r.evolveTo, target.id, 'evolveTo reported at the level');
  const keep = { nickname: d.nickname, genes: { ...d.genes }, training: { ...d.training }, xp: d.xp, level: d.level, moves: [...d.moves] };
  d.hp = Math.floor(dragonStats(d).hp / 2);
  const frac = d.hp / dragonStats(d).hp;
  const knownBefore = [...d.knownMoves];
  const sim = clone(d);
  const evo = evolveDragon(clone(s), sim);
  const old = evolve(s, d);
  eq(old, sp.id, 'returns the old species');
  eq(evo.from, sp.id, 'report: old species');
  eq(evo.to, target.id, 'report: new species');
  deepEq(evo.learned, d.knownMoves.filter((m) => !knownBefore.includes(m)), 'report: newly learned moves');
  deepEq(sim, d, 'evolveDragon and evolve do the same thing');
  for (const x of evo.swapped) ok(keep.moves.includes(x.out) && d.moves.includes(x.in) && !d.moves.includes(x.out), `swap ${x.out} -> ${x.in}`);
  eq(d.speciesId, target.id, 'species switched');
  eq(d.nickname, keep.nickname, 'nickname kept');
  deepEq(d.genes, keep.genes, 'genes kept');
  deepEq(d.training, keep.training, 'training kept');
  eq(d.xp, keep.xp, 'xp kept');
  eq(d.level, keep.level, 'level kept');
  for (const m of keep.moves) ok(d.moves.includes(m) || evo.swapped.some((x) => x.out === m), `kept equipped move ${m} (or swapped it for a better one)`);
  for (const le of target.learnset) if (le.level <= d.level) ok(d.knownMoves.includes(le.move), `learned ${le.move} from the new species`);
  ok(s.dex.owned.includes(target.id) && s.dex.seen.includes(target.id), 'dex marks the evolution');
  ok(Math.abs(d.hp / dragonStats(d).hp - frac) < 0.05, 'hp proportion kept');
  ok(target.abilities.includes(d.ability) || target.hiddenAbility === d.ability, 'ability valid for the new species');
  if (!target.evolvesTo) {
    let threw = false;
    try { evolve(s, d); } catch { threw = true; }
    ok(threw, 'a final stage cannot evolve');
  }
});

test('loadouts and training caps', () => {
  const s = gameWithStarters(31, 20);
  const d = s.dragons[0];
  const known = d.knownMoves;
  let threw = 0;
  for (const bad of [[], ['no-such-move'], [known[0], known[0]], [...known, ...known].slice(0, 5)]) {
    try { setLoadout(d, bad); } catch { threw++; }
  }
  eq(threw, 4, 'invalid loadouts throw');
  setLoadout(d, [known[0]]);
  deepEq(d.moves, [known[0]], 'single-move loadout');
  const g1 = addTraining(d, { spe: 300 });
  eq(g1.spe, TRAINING_CAP_STAT, 'per-stat cap');
  eq(d.training.spe, TRAINING_CAP_STAT, 'stored per-stat cap');
  const g2 = addTraining(d, { atk: 200, def: 200 });
  eq((g2.atk ?? 0) + (g2.def ?? 0), TRAINING_CAP_TOTAL - TRAINING_CAP_STAT, 'total cap');
  eq(STAT_IDS.reduce((a, k) => a + d.training[k], 0), TRAINING_CAP_TOTAL, 'stored total cap');
  deepEq(addTraining(d, { hp: 4 }), {}, 'nothing past the total cap');
  // Training HP while at full HP keeps the dragon at full HP.
  const e = s.dragons[1];
  addTraining(e, { hp: 252 });
  eq(e.hp, dragonStats(e).hp, 'full hp stays full after hp training');
});

test('toMonInit', () => {
  const s = gameWithStarters(41, 12);
  const d = s.dragons[0];
  d.status = 'burn';
  d.hp = 10;
  const m = toMonInit(d);
  eq(m.kind, 'dragon', 'kind');
  eq(m.defId, d.speciesId, 'defId');
  eq(m.ownerRef, d.id, 'ownerRef');
  eq(m.level, d.level, 'level');
  eq(m.xp, d.xp, 'xp');
  eq(m.hp, 10, 'hp');
  eq(m.status, 'burn', 'status');
  eq(m.ability, d.ability, 'ability');
  deepEq(m.moves, d.moves, 'moves');
  deepEq(m.genes, d.genes, 'genes');
  eq(m.happiness, d.needs.happiness, 'happiness');
  ok(m.moves !== d.moves && m.genes !== d.genes, 'copies, not references');
});

/** A fresh one-dragon state for activity tests. */
function activityState(species: SpeciesId = FIRE, level = 10): { s: GameState; d: OwnedDragon } {
  const s = newGame(51);
  const d = createDragon(s, species, level);
  addDragon(s, d);
  return { s, d };
}

test('activities: wheel, dig, nap, play', () => {
  for (const id of ACTIVITY_IDS) {
    if (id === 'feed') continue;
    const a = getActivity(id);
    const { s, d } = activityState();
    d.needs.energy = 80;
    d.needs.fullness = 60;
    d.needs.happiness = 40;
    d.hp = Math.max(1, d.hp - 5);
    const before = clone(d);
    const coins0 = s.coins;
    const r = doActivity(s, d.id, id);
    ok(r.ok, `${id} ok`);
    ok(r.lines.length > 0, `${id} has lines`);
    ok(r.lines.some((l) => l.includes(dragonName(d))), `${id} lines use the dragon's name`);
    eq(d.slotsUsed, a.usesSlot ? 1 : 0, `${id} slot`);
    eq(d.needs.energy, Math.max(0, Math.min(100, before.needs.energy - a.energy)), `${id} energy`);
    eq(d.needs.fullness, Math.max(0, Math.min(100, before.needs.fullness - a.fullness)), `${id} fullness`);
    const liked = dragonTypes(d).some((t) => a.likedBy.includes(t));
    eq(d.needs.happiness, Math.min(100, before.needs.happiness + a.happiness * (liked ? 2 : 1)), `${id} happiness`);
    for (const st of STAT_IDS) eq(d.training[st], before.training[st] + (a.training[st] ?? 0), `${id} training ${st}`);
    if (a.xpFraction > 0) ok(d.xp > before.xp && r.xp && r.xp.xp > 0, `${id} gives xp`);
    else eq(d.xp, before.xp, `${id} gives no xp`);
    eq(s.stats.activities, 1, `${id} counted`);
    if (id === 'dig') {
      ok(r.loot && r.loot.coins > 0, 'dig finds coins');
      eq(s.coins, coins0 + (r.loot?.coins ?? 0), 'dig coins banked');
    }
    if (id === 'nap') {
      eq(d.hp, dragonStats(d).hp, 'nap heals fully');
    }
  }
  // Nap cures status and restores energy even when the dragon has fainted.
  const { s, d } = activityState();
  d.hp = 0;
  d.status = 'goop';
  d.needs.energy = 10;
  const r = doActivity(s, d.id, 'nap');
  ok(r.ok, 'fainted dragon can nap');
  eq(d.hp, dragonStats(d).hp, 'nap revives to full');
  eq(d.status, null, 'nap cures status');
  eq(d.needs.energy, Math.min(100, 10 - getActivity('nap').energy), 'nap restores energy');
  // Two slots a day.
  const t = activityState();
  ok(doActivity(t.s, t.d.id, 'wheel').ok && doActivity(t.s, t.d.id, 'play').ok, 'two slots');
  eq(t.d.slotsUsed, SLOTS_PER_DAY, 'slots used');
});

test('activities: feeding', () => {
  const { s, d } = activityState();
  const fav = getSpecies(d.speciesId).favoriteFood;
  const other = FOOD_IDS.find((f) => f !== fav && FOODS[f].xp === 0) ?? FOOD_IDS.find((f) => f !== fav) as FoodId;
  s.food[fav] = 2;
  s.food[other] = 2;
  d.needs.fullness = 10;
  d.needs.happiness = 10;
  let r = doActivity(s, d.id, 'feed', fav);
  ok(r.ok, 'feed favourite ok');
  eq(s.food[fav], 1, 'pantry used');
  eq(d.slotsUsed, 0, 'feeding uses no slot');
  eq(d.needs.fullness, Math.min(100, 10 + FOODS[fav].fullness), 'fullness');
  eq(d.needs.happiness, Math.min(100, 10 + FOODS[fav].happiness * 2), 'favourite doubles happiness');
  ok(r.lines.some((l) => /favourite/i.test(l)), 'favourite line');
  d.needs.fullness = 10;
  d.needs.happiness = 10;
  r = doActivity(s, d.id, 'feed', other);
  ok(r.ok, 'feed other ok');
  eq(d.needs.happiness, Math.min(100, 10 + FOODS[other].happiness), 'normal happiness');
  // Dragonfruit (or whichever food gives XP) grants XP.
  const xpFood = FOOD_IDS.find((f) => FOODS[f].xp > 0);
  if (xpFood) {
    s.food[xpFood] = 1;
    d.needs.fullness = 10;
    const xp0 = d.xp;
    r = doActivity(s, d.id, 'feed', xpFood);
    ok(r.ok && r.xp, 'xp food ok');
    eq(d.xp - xp0, FOODS[xpFood].xp, 'xp food grants its xp');
  } else skip('xp food (no food gives xp)');
  // The Snack Bar's fans (ACTIVITIES.feed.likedBy) get double happiness from any food, x4 from a favourite.
  const fanSp = SPECIES.find((x) => x.types.some((t) => getActivity('feed').likedBy.includes(t)));
  ok(!getSpecies(d.speciesId).types.some((t) => getActivity('feed').likedBy.includes(t)), 'fixture is not a Snack Bar fan');
  if (!fanSp) { skip('Snack Bar fans (no species of a likedBy type)'); return; }
  const g = newGame(42);
  const fan = createDragon(g, fanSp.id, 10);
  addDragon(g, fan);
  const fanFav = fanSp.favoriteFood;
  const plain = FOOD_IDS.find((f) => f !== fanFav && FOODS[f].xp === 0) as FoodId;
  g.food[fanFav] = 1;
  g.food[plain] = 1;
  fan.needs.fullness = 10; fan.needs.happiness = 10;
  r = doActivity(g, fan.id, 'feed', plain);
  eq(fan.needs.happiness, Math.min(100, 10 + FOODS[plain].happiness * 2), 'Snack Bar fan: double happiness');
  ok(r.lines.some((l) => /LOVES the Snack Bar/i.test(l)), 'Snack Bar fan line');
  fan.needs.fullness = 10; fan.needs.happiness = 10;
  doActivity(g, fan.id, 'feed', fanFav);
  eq(fan.needs.happiness, Math.min(100, 10 + FOODS[fanFav].happiness * 4), 'Snack Bar fan + favourite food: x4');
});

test('activities: every refusal', () => {
  const refuse = (s: GameState, id: string, act: ActivityId, reason: string | RegExp, food?: FoodId): void => {
    const before = JSON.stringify(s);
    const c = canDoActivity(s, id, act, food);
    const r = doActivity(s, id, act, food);
    ok(!c.ok && !r.ok, `${act} refused`);
    if (typeof reason === 'string') { eq(c.reason, reason, `${act} reason`); eq(r.reason, reason, `${act} result reason`); }
    else ok(reason.test(c.reason ?? ''), `${act} reason ${c.reason}`);
    eq(JSON.stringify(s), before, `${act} refusal changes nothing`);
  };
  let { s, d } = activityState();
  d.needs.energy = 5;
  refuse(s, d.id, 'wheel', 'TOO TIRED');
  refuse(s, d.id, 'dig', 'TOO TIRED');
  refuse(s, d.id, 'play', 'TOO TIRED');
  ({ s, d } = activityState());
  d.slotsUsed = SLOTS_PER_DAY;
  for (const a of ['wheel', 'dig', 'nap', 'play'] as ActivityId[]) refuse(s, d.id, a, 'NO ACTIVITY SLOTS LEFT TODAY');
  ({ s, d } = activityState());
  d.needs.fullness = 0;
  refuse(s, d.id, 'play', 'TOO HUNGRY TO PLAY');
  refuse(s, d.id, 'wheel', 'TOO HUNGRY TO PLAY');
  refuse(s, d.id, 'dig', 'TOO HUNGRY TO PLAY');
  ({ s, d } = activityState());
  d.hp = 0;
  for (const a of ['wheel', 'dig', 'play'] as ActivityId[]) refuse(s, d.id, a, 'FAINTED - NEEDS A NAP');
  refuse(s, d.id, 'feed', 'FAINTED - NEEDS A NAP', 'seeds');
  ({ s, d } = activityState());
  s.food.cheese = 0;
  refuse(s, d.id, 'feed', 'NO ' + FOODS.cheese.name.toUpperCase() + ' IN THE PANTRY', 'cheese');
  refuse(s, d.id, 'feed', 'PICK A FOOD FIRST');
  d.needs.fullness = 100;
  refuse(s, d.id, 'feed', /FULL/, 'seeds');
  refuse(s, 'd999', 'wheel', 'NO SUCH DRAGON');
  ({ s, d } = activityState());
  ok(canDoActivity(s, d.id, 'nap').ok, 'nap allowed at full energy');
});

test('dig: diggers find better loot', () => {
  const dig = getActivity('dig');
  const digger = speciesOfType((sp) => sp.types.some((t) => dig.likedBy.includes(t)));
  const other = speciesOfType((sp) => !sp.types.some((t) => dig.likedBy.includes(t)));
  if (!digger || !other) { skip('dig loot comparison (needs a digger and a non-digger species)'); return; }
  const total = (sp: SpeciesId): { coins: number; food: number; items: number } => {
    const { s, d } = activityState(sp, 10);
    const out = { coins: 0, food: 0, items: 0 };
    for (let i = 0; i < 400; i++) {
      d.slotsUsed = 0;
      d.needs.energy = 100;
      d.needs.fullness = 100;
      const r = doActivity(s, d.id, 'dig');
      ok(r.ok && r.loot, 'dig ok');
      out.coins += r.loot.coins;
      out.food += Object.values(r.loot.food).reduce((a, n) => a + (n ?? 0), 0);
      out.items += Object.values(r.loot.items).reduce((a, n) => a + (n ?? 0), 0);
      s.food = { seeds: 0, carrot: 0, berries: 0, cheese: 0, dragonfruit: 0 };
      s.items = { seedcake: 0, royalcake: 0, peppep: 0, herbtea: 0, spicybiscuit: 0 };
    }
    return out;
  };
  const a = total(digger.id);
  const b = total(other.id);
  ok(a.coins > b.coins, `diggers find more coins (${a.coins} vs ${b.coins})`);
  ok(a.food > b.food, `diggers find more food (${a.food} vs ${b.food})`);
  ok(b.food > 0 && b.items > 0, 'anyone finds food and, rarely, items');
  ok(b.items < b.food && b.food < 400, 'coins mostly, food sometimes, items rarely');
});

test('items outside battle', () => {
  const { s, d } = activityState();
  const max = dragonStats(d).hp;
  const heal = ITEM_IDS.find((i) => ITEMS[i].effect.kind === 'heal' && ITEMS[i].fieldUse);
  const revive = ITEM_IDS.find((i) => ITEMS[i].effect.kind === 'revive' && ITEMS[i].fieldUse);
  const cure = ITEM_IDS.find((i) => ITEMS[i].effect.kind === 'cure' && ITEMS[i].fieldUse);
  const battleOnly = ITEM_IDS.find((i) => !ITEMS[i].fieldUse);
  ok(heal && revive && cure && battleOnly, 'item table has heal, revive, cure and a battle-only item');
  for (const i of ITEM_IDS) s.items[i] = 1;
  let r = useItemOutside(s, heal, d.id);
  ok(!r.ok, 'heal refused at full hp');
  eq(s.items[heal], 1, 'refusal keeps the item');
  d.hp = 1;
  r = useItemOutside(s, heal, d.id);
  ok(r.ok && d.hp > 1 && d.hp <= max, 'heal');
  eq(s.items[heal], 0, 'heal used up');
  r = useItemOutside(s, heal, d.id);
  ok(!r.ok && /NO .* IN THE BAG/.test(r.line), 'none left');
  r = useItemOutside(s, revive, d.id);
  ok(!r.ok, 'revive refused when not fainted');
  d.hp = 0;
  r = useItemOutside(s, revive, d.id);
  ok(r.ok && d.hp > 0, 'revive');
  r = useItemOutside(s, cure, d.id);
  ok(!r.ok, 'cure refused without status');
  d.status = 'zap';
  r = useItemOutside(s, cure, d.id);
  ok(r.ok && d.status === null, 'cure');
  r = useItemOutside(s, battleOnly, d.id);
  ok(!r.ok && s.items[battleOnly] === 1, 'battle-only item refused');
});

test('endDay', () => {
  const s = gameWithStarters(61, 10);
  const [a, b] = s.dragons;
  a.hp = 1; a.status = 'burn'; a.needs = { fullness: 20, happiness: 50, energy: 10 }; a.slotsUsed = 2;
  b.hp = 0; b.needs = { fullness: 90, happiness: 50, energy: 70 }; b.slotsUsed = 1;
  const r = endDay(s);
  eq(s.day, 2, 'day advanced');
  eq(r.day, 2, 'report day');
  for (const d of s.dragons) {
    eq(d.hp, dragonStats(d).hp, 'healed');
    eq(d.status, null, 'cured');
    eq(d.slotsUsed, 0, 'slots reset');
  }
  eq(a.needs.energy, 90, 'energy +80');
  eq(b.needs.energy, 100, 'energy capped');
  eq(a.needs.fullness, 0, 'fullness floored');
  eq(b.needs.fullness, 65, 'fullness -25');
  eq(a.needs.happiness, 35, 'starving costs happiness');
  eq(b.needs.happiness, 50, 'fed dragon keeps happiness');
  ok(r.lines.some((l) => l.includes(dragonName(a)) && /starving|hungry|tummy/i.test(l)), 'report names the hungry dragon');
  ok(r.lines.length >= 2, 'report has lines');
  eq(moodLine(a), 'STARVING!', 'mood starving');
  a.needs.fullness = 20;
  eq(moodLine(a), 'HUNGRY!', 'mood hungry');
  a.needs.fullness = 80; a.needs.energy = 5;
  eq(moodLine(a), 'SLEEPY', 'mood sleepy');
  a.needs.energy = 100; a.needs.happiness = 90;
  ok(moodLine(a).length > 0 && moodLine(a) !== 'HUNGRY!', 'mood happy');
});

test('shop', () => {
  eq(SHOP.length, 10, 'ten shelves');
  for (const f of FOOD_IDS) eq(SHOP.find((e) => e.id === f)?.price, FOODS[f].price, `food price ${f}`);
  for (const i of ITEM_IDS) eq(SHOP.find((e) => e.id === i)?.price, ITEMS[i].price, `item price ${i}`);
  const s = newGame(71);
  let r = buy(s, 'seeds', 3);
  ok(r.ok, 'buy seeds');
  eq(s.food.seeds, 8, 'seeds added');
  eq(s.coins, 200 - FOODS.seeds.price * 3, 'coins spent');
  r = buy(s, 'seedcake');
  ok(r.ok && s.items.seedcake === 4, 'buy an item');
  s.coins = 0;
  const before = JSON.stringify(s);
  r = buy(s, 'royalcake');
  ok(!r.ok && /COINS/.test(r.line), 'not enough coins');
  r = buy(s, 'seeds', 0);
  ok(!r.ok, 'zero quantity refused');
  eq(JSON.stringify(s), before, 'refusals change nothing');
});

test('save / load round trip and corrupt saves', () => {
  const mem = memoryStorage();
  eq(loadGame(mem), null, 'nothing saved yet');
  const s = gameWithStarters(81, 9);
  doActivity(s, s.dragons[0].id, 'wheel');
  doActivity(s, s.dragons[1].id, 'dig');
  s.flags.introSeen = true;
  s.missions[MISSIONS[0].id] = { clears: 1, firstClearDay: 1 };
  ok(saveGame(s, mem), 'saved');
  ok(mem.getItem(SAVE_KEY), 'stored under SAVE_KEY');
  const back = loadGame(mem);
  ok(back, 'loaded');
  deepEq(back, s, 'round trip is exact');
  // The loaded world replays the same randomness.
  deepEq(createDragon(back, FIRE, 5), createDragon(s, FIRE, 5), 'rng replays after load');
  clearSave(mem);
  eq(loadGame(mem), null, 'cleared');

  const good = JSON.parse(JSON.stringify(gameWithStarters(82, 9))) as Record<string, unknown>;
  const variants: [string, string][] = [
    ['not json', '{"version":1,'],
    ['not an object', '[1,2,3]'],
    ['empty object', '{}'],
    ['newer version', JSON.stringify({ ...good, version: SAVE_VERSION + 1 })],
    ['dragons not an array', JSON.stringify({ ...good, dragons: 'lots' })],
    ['coins not a number', JSON.stringify({ ...good, coins: 'heaps' })],
    ['dragon without genes', JSON.stringify({ ...good, dragons: [{ ...(good.dragons as object[])[0], genes: undefined }] })],
    ['dragon needs broken', JSON.stringify({ ...good, dragons: [{ ...(good.dragons as object[])[0], needs: 5 }] })],
    ['food missing', JSON.stringify({ ...good, food: null })],
    ['duplicate dragon ids', JSON.stringify({ ...good, dragons: [(good.dragons as object[])[0], (good.dragons as object[])[0]] })],
    ['null', 'null'],
  ];
  for (const [what, raw] of variants) {
    mem.setItem(SAVE_KEY, raw);
    let res: GameState | null = null;
    let threw = false;
    try { res = loadGame(mem); } catch { threw = true; }
    ok(!threw, `${what}: does not throw`);
    eq(res, null, `${what}: returns null`);
  }
  // A storage that throws is treated as no save.
  const broken: Storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
  eq(loadGame(broken), null, 'throwing storage loads null');
  eq(saveGame(s, broken), false, 'throwing storage reports a failed save');
  clearSave(broken);

  // Stale content is repaired, not rejected.
  const stale = clone(gameWithStarters(83, 9));
  const d0 = stale.dragons[0];
  d0.knownMoves.push('move-that-was-removed');
  d0.moves = ['move-that-was-removed'];
  stale.dragons[1].speciesId = 'species-that-was-removed';
  stale.missions['mission-that-was-removed'] = { clears: 2, firstClearDay: 1 };
  stale.squad = [d0.id, stale.dragons[1].id];
  stale.dex.owned.push('species-that-was-removed');
  const fixed = parseSave(JSON.stringify(stale));
  ok(fixed, 'stale save loads');
  eq(fixed.dragons.length, 1, 'dragon of a removed species dropped');
  ok(!fixed.dragons[0].knownMoves.includes('move-that-was-removed'), 'removed move forgotten');
  ok(fixed.dragons[0].moves.length >= 1, 'empty loadout rebuilt');
  for (const m of fixed.dragons[0].moves) ok(fixed.dragons[0].knownMoves.includes(m), 'loadout known');
  deepEq(fixed.squad, [d0.id], 'squad pruned');
  ok(!('mission-that-was-removed' in fixed.missions), 'removed mission dropped');
  ok(!fixed.dex.owned.includes('species-that-was-removed'), 'dex pruned');
});

test('missions: status, canLaunch, intel', () => {
  const s = gameWithStarters(91, 10);
  const first = MISSIONS_IN_ORDER[0];
  eq(missionStatus(s, first.id), 'available', 'first mission available');
  eq(nextMission(s)?.id, first.id, 'nextMission');
  const locked = MISSIONS.find((m) => m.requires.length > 0);
  if (locked) {
    eq(missionStatus(s, locked.id), 'locked', 'later mission locked');
    eq(canLaunch(s, locked.id, [s.dragons[0].id]).reason, 'MISSION LOCKED', 'locked refusal');
  } else skip('locked missions (no mission has requirements)');
  const [a, b] = s.dragons;
  eq(canLaunch(s, first.id, []).ok, false, 'empty squad');
  eq(canLaunch(s, first.id, [a.id, a.id]).ok, false, 'duplicate dragon');
  eq(canLaunch(s, first.id, ['d1', 'd2', 'd3', 'd4']).ok, false, 'too many');
  eq(canLaunch(s, first.id, ['nobody']).ok, false, 'unknown dragon');
  eq(canLaunch(s, 'no-such-mission', [a.id]).ok, false, 'unknown mission');
  a.needs.energy = MISSION_ENERGY - 1;
  ok(/TIRED/.test(canLaunch(s, first.id, [a.id, b.id]).reason ?? ''), 'tired refusal');
  a.needs.energy = 100; a.needs.fullness = 0;
  ok(/HUNGRY/.test(canLaunch(s, first.id, [a.id]).reason ?? ''), 'hungry refusal');
  a.needs.fullness = 50; a.hp = 0;
  ok(/FAINTED/.test(canLaunch(s, first.id, [a.id]).reason ?? ''), 'fainted refusal');
  a.hp = dragonStats(a).hp;
  ok(canLaunch(s, first.id, [a.id, b.id]).ok, 'healthy squad ok');
  ok(SQUAD_SIZE === 3, 'squad size');

  // Intel: one entry per distinct villain across every encounter, branch options included.
  for (const m of MISSIONS) {
    const intel = intelTypes(m.id);
    const villains = new Set<string>();
    const walk = (nodes: typeof m.nodes): void => {
      for (const n of nodes) {
        if (n.kind === 'battle' || n.kind === 'boss') for (const e of n.encounter.enemies) villains.add(e.villain);
        if (n.kind === 'branch') for (const o of n.options) walk(o.nodes);
      }
    };
    walk(m.nodes);
    eq(intel.length, villains.size, `${m.id} intel size`);
    [...villains].forEach((v, i) => deepEq(intel[i], [...getVillain(v).types], `${m.id} intel ${v}`));
  }
});

test('missions: lifecycle through the real battle engine', () => {
  const first = MISSIONS_IN_ORDER[0];
  const s = gameWithStarters(101, Math.min(MAX_LEVEL, first.level + 25));
  const squad = s.dragons.map((d) => d.id);
  const pristine = JSON.stringify(getMission(first.id).nodes);
  const before = clone(s.dragons);
  const run = startMission(s, first.id, squad);
  eq(run.outcome, 'active', 'active');
  eq(run.index, 0, 'index 0');
  deepEq(s.squad, squad, 'squad remembered');
  s.dragons.forEach((d, i) => {
    eq(d.needs.energy, before[i].needs.energy - MISSION_ENERGY, 'energy spent');
    eq(d.needs.fullness, Math.max(0, before[i].needs.fullness - MISSION_FULLNESS), 'fullness spent');
    eq(d.missions, 1, 'mission counted');
  });
  ok(run.nodes !== getMission(first.id).nodes, 'nodes copied');
  (run.nodes as unknown[]).push({ kind: 'story', label: 'x', text: 'x' });
  eq(JSON.stringify(getMission(first.id).nodes), pristine, 'deep copy: mission data untouched');
  run.nodes.pop();

  // The first battle's setup.
  while (currentNode(run) && currentNode(run)?.kind !== 'battle' && currentNode(run)?.kind !== 'boss') {
    const n = currentNode(run);
    if (n?.kind === 'branch') chooseBranch(run, 0);
    else { if (n?.kind === 'rest') applyRest(s, run); advance(run); }
  }
  const node = currentNode(run);
  ok(node && (node.kind === 'battle' || node.kind === 'boss'), 'reached a battle');
  const setup = encounterSetup(s, run);
  eq(setup.player.length, squad.length, 'squad in battle');
  setup.player.forEach((p, i) => eq(p.ownerRef, squad[i], 'squad order'));
  eq(setup.enemy.length, node.encounter.enemies.length, 'enemies');
  setup.enemy.forEach((e, i) => {
    eq(e.kind, 'villain', 'villain init');
    eq(e.defId, node.encounter.enemies[i].villain, 'villain id');
    eq(!!e.isBoss, node.kind === 'boss' && i === setup.enemy.length - 1, 'isBoss only on the last enemy of a boss node');
  });
  eq(setup.aiLevel, node.kind === 'boss' ? 'boss' : first.type === 'defend' ? 'elite' : 'minion', 'aiLevel');
  deepEq(setup.items, s.items, 'items copied');
  ok(setup.items !== (s.items as unknown), 'items are a copy');
  eq(setup.canRetreat, true, 'can retreat');
  ok(Number.isInteger(setup.seed) && setup.seed > 0, 'seed');

  // Use an item in battle: finishBattle must write the count back.
  const battle = createBattle(setup);
  startBattle(battle);
  const healItem = ITEM_IDS.find((i) => ITEMS[i].effect.kind === 'heal' && (s.items[i] ?? 0) > 0);
  const items0 = { ...s.items };
  const active = activeMon(battle, 'player');
  if (healItem && battle.phase === 'choose' && legal(battle).items.includes(healItem)) {
    active.hp = Math.max(1, Math.floor(active.stats.hp / 3));
    submitTurn(battle, { kind: 'item', item: healItem, target: battle.player.active });
  }
  let steps = 0;
  while (battle.phase !== 'over') {
    if (++steps > 400) throw new Error('battle did not end');
    if (battle.phase === 'switch') submitSwitch(battle, legal(battle).switches.findIndex(Boolean));
    else submitTurn(battle, { kind: 'move', slot: bestMoveSlot(battle) });
  }
  eq(battle.winner, 'player', 'over-levelled squad wins');
  const after = finishBattle(s, run, battle);
  if (healItem && (battle.items[healItem] ?? 0) < (items0[healItem] ?? 0)) eq(s.items[healItem], items0[healItem] - 1, 'used item written back');
  for (const i of ITEM_IDS) eq(s.items[i], battle.items[i] ?? 0, `bag ${i} synced`);
  eq(run.defeated.length, setup.enemy.length, 'all foes defeated');
  eq(run.coins, setup.enemy.reduce((a, e) => a + getVillain(e.defId).coins, 0), 'villain coins banked');
  ok(after.reports.length === squad.length, 'a report per squad dragon');
  ok(after.reports.some((r) => r.xp > 0), 'xp earned');
  for (const r of after.reports) {
    const d = s.dragons.find((x) => x.id === r.dragonId);
    ok(d, 'report for a squad dragon');
    const mon = battle.player.team.find((m) => m.ownerRef === d.id);
    ok(mon, 'battle mon for the dragon');
    eq(d.xp, Math.min(xpForLevel(MAX_LEVEL), mon.xp), 'xp synced');
    eq(d.hp > 0, mon.hp > 0, 'hp synced');
  }
  eq(s.stats.battlesWon, 1, 'battle counted');
  ok(s.dragons.some((d) => d.battlesWon === 1), 'dragon battlesWon');
  eq(run.outcome, 'active', 'still active after a win');
  advance(run);

  // The rest of the path.
  const coins0 = s.coins;
  const food0 = { ...s.food };
  const bag0 = { ...s.items };
  const res = playMission(s, run, 1);
  eq(res.run.outcome, 'active', 'path finished (completeMission sets won)');
  const rewards = completeMission(s, run);
  eq(run.outcome, 'won', 'won');
  ok(rewards.firstClear, 'first clear');
  const pay = Math.floor(first.rewards.coins * (first.type === 'infiltrate' ? 1.5 : 1));
  const consolation = (r: { lines: string[] }): boolean => r.lines.some((l) => /instead/.test(l));
  if (!consolation(rewards)) eq(rewards.coins, pay + run.coins, 'coins = mission pay + villain drops');
  else ok(rewards.coins > pay + run.coins, 'consolation coins added');
  eq(s.coins, coins0 + rewards.coins, 'coins banked');
  for (const it of first.rewards.items) {
    if (it.id in s.food) eq(s.food[it.id as FoodId], Math.min(99, food0[it.id as FoodId] + it.qty), `food reward ${it.id}`);
    else eq(s.items[it.id as keyof typeof s.items], Math.min(99, bag0[it.id as keyof typeof bag0] + it.qty), `item reward ${it.id}`);
  }
  eq(missionStatus(s, first.id), 'cleared', 'cleared');
  deepEq(s.missions[first.id], { clears: 1, firstClearDay: s.day }, 'record');
  eq(s.stats.missionsCleared, 1, 'stats');
  ok(rewards.lines.length > 0, 'reward lines');
  const dr = first.rewards.dragon;
  if (dr && dr.chance >= 1) ok(rewards.dragon || consolation(rewards), 'guaranteed dragon (or coins when all owned)');
  if (rewards.dragon) {
    ok(s.dragons.includes(rewards.dragon) && s.dex.owned.includes(rewards.dragon.speciesId), 'reward dragon added');
    ok(dr?.species.includes(rewards.dragon.speciesId), 'reward dragon from the pool');
    eq(rewards.dragon.level, Math.max(2, first.level - 2), 'reward dragon level');
  }
  for (const m of MISSIONS) if (m.requires.length && m.requires.every((r) => r === first.id)) eq(missionStatus(s, m.id), 'available', `${m.id} unlocked`);

  // Replay: half pay, not a first clear.
  endDay(s);
  const run2 = startMission(s, first.id, squad);
  playMission(s, run2, 0);
  ok(run2.outcome === 'active', 'replay path finished');
  const coinsBefore = s.coins;
  const r2 = completeMission(s, run2);
  ok(!r2.firstClear, 'replay is not a first clear');
  const half = Math.floor(first.rewards.coins * (first.type === 'infiltrate' ? 1.5 : 1) * 0.5);
  if (!consolation(r2)) eq(r2.coins, half + run2.coins, 'replay pays half');
  eq(s.coins, coinsBefore + r2.coins, 'replay coins banked');
  eq(s.missions[first.id].clears, 2, 'two clears');
  eq(s.missions[first.id].firstClearDay, 1, 'first clear day kept');
});

test('missions: retreat, loss and rest stops', () => {
  const first = MISSIONS_IN_ORDER[0];
  // Retreat.
  let s = gameWithStarters(111, 10);
  let run = startMission(s, first.id, [s.dragons[0].id]);
  while (currentNode(run) && !['battle', 'boss'].includes(currentNode(run)?.kind ?? '')) {
    const n = currentNode(run);
    if (n?.kind === 'branch') chooseBranch(run, 0); else advance(run);
  }
  let battle = createBattle(encounterSetup(s, run));
  startBattle(battle);
  submitTurn(battle, { kind: 'retreat' });
  eq(battle.winner, 'retreat', 'engine retreat');
  finishBattle(s, run, battle);
  eq(run.outcome, 'retreated', 'outcome retreated');
  abandonMission(s, run);
  eq(run.outcome, 'retreated', 'abandon keeps retreated');
  eq(missionStatus(s, first.id), 'available', 'not cleared');
  let threw = false;
  try { completeMission(s, run); } catch { threw = true; }
  ok(threw, 'a retreated mission does not pay');
  // abandonMission on an active run.
  s = gameWithStarters(112, 10);
  run = startMission(s, first.id, [s.dragons[0].id]);
  abandonMission(s, run);
  eq(run.outcome, 'retreated', 'abandon');

  // Loss: one level-1 dragon at 1 HP.
  s = newGame(113);
  const weak = createDragon(s, FIRE, 1);
  addDragon(s, weak);
  weak.hp = 1;
  run = startMission(s, first.id, [weak.id]);
  while (currentNode(run) && !['battle', 'boss'].includes(currentNode(run)?.kind ?? '')) {
    const n = currentNode(run);
    if (n?.kind === 'branch') chooseBranch(run, 0); else advance(run);
  }
  battle = createBattle(encounterSetup(s, run));
  autopilot(battle);
  eq(battle.winner, 'enemy', 'a level-1 dragon at 1 HP loses');
  const after = finishBattle(s, run, battle);
  eq(run.outcome, 'lost', 'outcome lost');
  deepEq(after.fainted, [weak.id], 'fainted reported');
  ok(isFainted(weak), 'dragon fainted');
  eq(s.stats.battlesLost, 1, 'loss counted');

  // Rest stops heal and revive.
  const withRest = MISSIONS.find((m) => m.nodes.some((n) => n.kind === 'rest'));
  if (!withRest) { skip('rest stops (no mission has one)'); return; }
  s = gameWithStarters(114, 10);
  s.missions = {};
  for (const m of MISSIONS) s.missions[m.id] = { clears: 1, firstClearDay: 1 };
  const [a, b] = s.dragons;
  run = startMission(s, withRest.id, [a.id, b.id]);
  run.index = run.nodes.findIndex((n) => n.kind === 'rest');
  const restNode = currentNode(run);
  ok(restNode && restNode.kind === 'rest', 'at rest');
  a.hp = 0;
  b.hp = 1;
  const lines = applyRest(s, run);
  eq(lines.length, 2, 'a line per dragon');
  ok(a.hp > 0, 'fainted dragon revived');
  ok(b.hp > 1, 'hurt dragon healed');
  eq(a.hp, Math.max(1, restNode.heal >= 1 ? dragonStats(a).hp : Math.floor(dragonStats(a).hp * restNode.heal)), 'revive amount');
});

test('missions: branches splice and supercharge', () => {
  const m = MISSIONS.find((x) => x.nodes.some((n) => n.kind === 'branch'));
  if (!m) { skip('branches (no mission has a branch)'); return; }
  const s = gameWithStarters(121, 10);
  for (const x of MISSIONS) s.missions[x.id] = { clears: 1, firstClearDay: 1 };
  const bi = m.nodes.findIndex((n) => n.kind === 'branch');
  const branch = m.nodes[bi];
  if (branch.kind !== 'branch') return;
  const refresh = (): void => { for (const d of s.dragons) d.needs = { fullness: 100, happiness: 60, energy: 100 }; };
  branch.options.forEach((opt, oi) => {
    refresh();
    const run = startMission(s, m.id, [s.dragons[0].id]);
    run.index = bi;
    const len = run.nodes.length;
    chooseBranch(run, oi);
    eq(run.nodes.length, len - 1 + opt.nodes.length, `option ${oi} spliced`);
    deepEq(run.nodes.slice(bi, bi + opt.nodes.length), opt.nodes, `option ${oi} nodes in place`);
    ok(opt.nodes.length === 0 || run.nodes[bi] !== opt.nodes[0], 'spliced nodes are copies');
  });
  let threw = false;
  refresh();
  const run = startMission(s, m.id, [s.dragons[1].id]);
  try { chooseBranch(run, 0); } catch { threw = true; }
  ok(threw || m.nodes[0].kind === 'branch', 'chooseBranch only on a branch node');
  // A boss node's own supercharge still applies (no mission uses one today: build one).
  refresh();
  const r = startMission(s, m.id, [s.dragons[0].id]);
  const bossNode = r.nodes.find((n) => n.kind === 'boss');
  ok(bossNode && bossNode.kind === 'boss', 'mission has a boss node');
  r.nodes = [{ ...bossNode, supercharge: { spe: 2 } }];
  r.index = 0;
  const setup = encounterSetup(s, r);
  const boss = setup.enemy[setup.enemy.length - 1];
  ok(boss.isBoss, 'boss flagged');
  deepEq(boss.startStages, { spe: 2 }, 'boss node supercharge');
  for (const e of setup.enemy.slice(0, -1)) ok(!e.startStages && !e.isBoss, 'lieutenant not supercharged');
  // ...and merges with a route's (clamped to +6).
  r.supercharge = { spe: 5, atk: 1 };
  deepEq(encounterSetup(s, r).enemy.at(-1)?.startStages, { spe: 6, atk: 1 }, 'route + node supercharge merge, clamped');
});

test('sabotage: rushing supercharges the boss, cutting the power does not', () => {
  const sabotage = MISSIONS.filter((x) => x.type === 'sabotage');
  ok(sabotage.length > 0, 'there are sabotage missions');
  const s = gameWithStarters(122, 50);
  for (const x of MISSIONS) s.missions[x.id] = { clears: 1, firstClearDay: 1 };
  for (const mdef of sabotage) {
    const branches = mdef.nodes.filter((n) => n.kind === 'branch');
    eq(branches.length, 1, `${mdef.id}: one branch`);
    const br = branches[0];
    if (br.kind !== 'branch') continue;
    const bossNodes = mdef.nodes.filter((n) => n.kind === 'boss');
    eq(bossNodes.length, 1, `${mdef.id}: one boss node outside the branch`);
    const bn = bossNodes[0];
    ok(bn.kind === 'boss' && !bn.supercharge, `${mdef.id}: the boss node itself carries no supercharge`);
    const rushIdx = br.options.findIndex((o) => o.supercharge);
    ok(rushIdx >= 0, `${mdef.id}: a rush route`);
    deepEq(br.options[rushIdx].supercharge, { atk: 1, spa: 1 }, `${mdef.id}: rush route gives +1 ATK/SP.ATK`);
    eq(br.options.filter((o) => o.supercharge).length, 1, `${mdef.id}: only the rush route supercharges`);
    br.options.forEach((opt, oi) => {
      for (const d of s.dragons) { d.needs = { fullness: 100, happiness: 60, energy: 100 }; d.hp = dragonStats(d).hp; }
      const run = startMission(s, mdef.id, s.dragons.map((d) => d.id));
      // Walk the real path: the branch is chosen through chooseBranch, the boss built by encounterSetup.
      let bossSetup: ReturnType<typeof encounterSetup> | null = null;
      for (let guard = 0; guard < 50 && run.outcome === 'active' && currentNode(run); guard++) {
        const node = currentNode(run);
        if (!node) break;
        if (node.kind === 'branch') { chooseBranch(run, oi); continue; }
        if (node.kind === 'boss') { bossSetup = encounterSetup(s, run); break; }
        advance(run);
      }
      ok(bossSetup, `${mdef.id} option ${oi}: reached the boss`);
      const bossInit = bossSetup.enemy[bossSetup.enemy.length - 1];
      ok(bossInit.isBoss, `${mdef.id}: boss flagged`);
      if (opt.supercharge) {
        deepEq(run.supercharge, opt.supercharge, `${mdef.id}: the run records the route's supercharge`);
        deepEq(bossInit.startStages, { atk: 1, spa: 1 }, `${mdef.id}: rushed boss is supercharged`);
        // ...and the engine applies it: the boss starts the battle at +1/+1.
        const battle = createBattle(bossSetup);
        startBattle(battle);
        const bossMon = battle.enemy.team[battle.enemy.team.length - 1];
        eq(bossMon.stages.atk, 1, `${mdef.id}: boss ATK stage in battle`);
        eq(bossMon.stages.spa, 1, `${mdef.id}: boss SP.ATK stage in battle`);
      } else {
        ok(!run.supercharge, `${mdef.id}: cutting the power records nothing`);
        ok(!bossInit.startStages, `${mdef.id}: boss not supercharged after cutting the power`);
      }
      for (const e of bossSetup.enemy.slice(0, -1)) ok(!e.startStages, `${mdef.id}: only the boss is supercharged`);
      abandonMission(s, run);
    });
  }
});

test('syncFromBattle: training from defeated foes, statuses, levels', () => {
  const first = MISSIONS_IN_ORDER[0];
  const s = gameWithStarters(131, 5);
  const run = startMission(s, first.id, s.dragons.map((d) => d.id));
  while (currentNode(run) && !['battle', 'boss'].includes(currentNode(run)?.kind ?? '')) {
    const n = currentNode(run);
    if (n?.kind === 'branch') chooseBranch(run, 0); else advance(run);
  }
  const battle = createBattle(encounterSetup(s, run));
  autopilot(battle);
  const before = clone(s.dragons);
  const after = syncFromBattle(s, battle);
  for (const mon of battle.player.team) {
    const d = s.dragons.find((x) => x.id === mon.ownerRef) as OwnedDragon;
    const b = before.find((x) => x.id === d.id) as OwnedDragon;
    for (const st of STAT_IDS) ok(d.training[st] >= b.training[st], 'training never drops');
    const gain = STAT_IDS.reduce((a, st) => a + (mon.trainingGain[st] ?? 0), 0);
    eq(STAT_IDS.reduce((a, st) => a + d.training[st] - b.training[st], 0), gain, 'training gained as earned');
    eq(d.status, mon.hp > 0 ? mon.status : null, 'status synced');
    eq(d.level, levelForXp(d.xp), 'level matches xp');
    const r = after.reports.find((x) => x.dragonId === d.id);
    ok(r, 'report');
    eq(r.levelsGained.length, d.level - b.level, 'levels reported');
  }
});

// ---------------------------------------------------------------------------------------------
// The first case must be winnable with any two starters
// ---------------------------------------------------------------------------------------------

/** Autopilot win rate needed on the first case for every starter pair (fresh LV5 starters, no care). */
const FIRST_CASE_MIN_WIN = 0.7;
const FIRST_CASE_SEEDS = 60;

test(`first case: every starter pair wins >= ${FIRST_CASE_MIN_WIN * 100}% (autopilot, ${FIRST_CASE_SEEDS} seeds x both leads)`, () => {
  const first = MISSIONS_IN_ORDER[0];
  ok(STARTERS.length === 3, 'three starters');
  const rows: string[] = [];
  const bad: string[] = [];
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]] as const) {
    let wins = 0;
    let runs = 0;
    const perLead: string[] = [];
    for (const order of [[a, b], [b, a]]) {
      let w = 0;
      for (let k = 0; k < FIRST_CASE_SEEDS; k++) {
        const s = newGame(1000 + k * 7919);
        for (const i of order) addDragon(s, createDragon(s, STARTERS[i], 5));
        const run = startMission(s, first.id, s.dragons.map((d) => d.id));
        playMission(s, run);
        if (run.outcome === 'active') w++;
      }
      perLead.push(`${getSpecies(STARTERS[order[0]]).name} lead ${Math.round((100 * w) / FIRST_CASE_SEEDS)}%`);
      wins += w;
      runs += FIRST_CASE_SEEDS;
    }
    const rate = wins / runs;
    const name = `${getSpecies(STARTERS[a]).name} + ${getSpecies(STARTERS[b]).name}`;
    rows.push(`    ${name.padEnd(26)} ${String(Math.round(rate * 100)).padStart(3)}%  (${perLead.join(', ')})`);
    if (rate < FIRST_CASE_MIN_WIN) bad.push(`${name} ${Math.round(rate * 100)}%`);
  }
  console.log(`  ${first.id} autopilot win rates:`);
  for (const r of rows) console.log(r);
  ok(bad.length === 0, `first case too hard for: ${bad.join(', ')}`);
});

// ---------------------------------------------------------------------------------------------
// Campaign simulation
// ---------------------------------------------------------------------------------------------

const SIM_MAX_ATTEMPTS = 6;
const SIM_MAX_DAYS = 600;

/** Daily care: feed up to good fullness (favourite food first, buying seeds if the pantry is bare), wheel, play. */
function dailyCare(s: GameState): void {
  // No loadout editing: learned moves auto-equip (a better move replaces the weakest one).
  for (const d of s.dragons) {
    for (let k = 0; k < 3 && d.needs.fullness < 75 && d.hp > 0; k++) {
      const fav = getSpecies(d.speciesId).favoriteFood;
      let food: FoodId | undefined = s.food[fav] > 0 ? fav : FOOD_IDS.filter((f) => s.food[f] > 0 && FOODS[f].xp === 0)
        .sort((a, b) => FOODS[a].price - FOODS[b].price)[0];
      if (!food) {
        const cheapest = [...FOOD_IDS].sort((a, b) => FOODS[a].price - FOODS[b].price)[0];
        if (!buy(s, cheapest, 5).ok && !buy(s, cheapest, 1).ok) break;
        food = cheapest;
      }
      const r = doActivity(s, d.id, 'feed', food);
      if (!r.ok) break;
      if (r.xp) evolveReported(s, [r.xp]);
    }
    // Wheel and Ball Pit, like a sensible keeper: a dragon that would end up too tired for
    // today's mission naps in the Cozy Nest instead.
    for (const act of ['wheel', 'play'] as ActivityId[]) {
      const cost = getActivity(act).energy;
      const pick: ActivityId = d.needs.energy - cost < MISSION_ENERGY ? 'nap' : act;
      if (pick === 'nap' && d.needs.energy >= 100) continue;
      const r = doActivity(s, d.id, pick);
      if (r.xp) evolveReported(s, [r.xp]);
    }
  }
}

/** The three highest-level dragons that can go on a mission. */
function pickSquad(s: GameState, missionId: MissionId): string[] {
  return s.dragons
    .filter((d) => canLaunch(s, missionId, [d.id]).ok)
    .sort((a, b) => b.level - a.level || b.xp - a.xp)
    .slice(0, SQUAD_SIZE)
    .map((d) => d.id);
}

interface SimLine { mission: string; day: number; levels: string; result: string; attempts: number; note: string }

function simulateCampaign(seed: number, maxMissions: number): { lines: SimLine[]; cleared: number; days: number; dragons: number } {
  const s = newGame(seed);
  for (const sp of [FIRE, WATER]) addDragon(s, createDragon(s, sp, 5));
  const order = MISSIONS_IN_ORDER.slice(0, maxMissions);
  const lines: SimLine[] = [];
  let ti = 0;
  let attempts = 0;
  let replay: MissionId | null = null;
  while (ti < order.length && s.day <= SIM_MAX_DAYS) {
    dailyCare(s);
    const target = order[ti];
    const id = replay ?? target.id;
    const isReplay = replay !== null;
    replay = null;
    if (missionStatus(s, id) === 'locked') {
      lines.push({ mission: id, day: s.day, levels: '-', result: 'LOCKED', attempts, note: 'campaign order is blocked' });
      break;
    }
    const squad = pickSquad(s, id);
    if (squad.length === 0) { endDay(s); continue; }
    const levels = squad.map((sid) => 'L' + (s.dragons.find((d) => d.id === sid)?.level ?? 0)).join('/');
    const day = s.day;
    const run = startMission(s, id, squad);
    const { evolutions } = playMission(s, run, (day + ti) % 2);
    let note = evolutions.length ? 'evolved: ' + evolutions.join(', ') : '';
    let result: string = run.outcome === 'active' ? 'WON' : run.outcome.toUpperCase();
    if (run.outcome === 'active') {
      const rw = completeMission(s, run);
      if (rw.dragon) note += (note ? '; ' : '') + 'joined: ' + getSpecies(rw.dragon.speciesId).name + ' L' + rw.dragon.level;
    }
    if (isReplay) {
      lines.push({ mission: id, day, levels, result, attempts: 0, note: ('replay to train up' + (note ? '; ' + note : '')) });
    } else {
      attempts++;
      if (result === 'WON') {
        lines.push({ mission: id, day, levels, result, attempts, note });
        ti++;
        attempts = 0;
      } else {
        lines.push({ mission: id, day, levels, result, attempts, note });
        if (attempts >= SIM_MAX_ATTEMPTS) {
          lines.push({ mission: id, day: s.day, levels, result: 'STUCK', attempts, note: `gave up after ${attempts} attempts` });
          break;
        }
        replay = ti > 0 ? order[ti - 1].id : null;
      }
    }
    endDay(s);
  }
  return { lines, cleared: ti, days: s.day, dragons: s.dragons.length };
}

function printSim(title: string, sim: ReturnType<typeof simulateCampaign>): void {
  console.log(`  ${title}`);
  console.log('    day  mission                squad            result     tries  notes');
  for (const l of sim.lines) {
    console.log(`    ${String(l.day).padStart(3)}  ${l.mission.padEnd(22)} ${l.levels.padEnd(16)} ${l.result.padEnd(10)} ${String(l.attempts || '-').padStart(5)}  ${l.note}`);
  }
  console.log(`    cleared ${sim.cleared} mission(s) by day ${sim.days} with ${sim.dragons} dragon(s)`);
}

test(`campaign simulation (${FULL_SIM ? 'full' : 'first 3 missions'}, seed ${SIM_SEED})`, () => {
  const t0 = Date.now();
  const sim = simulateCampaign(SIM_SEED, FULL_SIM ? MISSIONS_IN_ORDER.length : 3);
  printSim(`simulation finished in ${Date.now() - t0} ms`, sim);
  // Losses are fine; only exceptions fail the run. The world must still be a valid save afterwards.
});

test('a played world survives save and load', () => {
  const s = newGame(SIM_SEED + 1);
  for (const sp of [FIRE, WATER]) addDragon(s, createDragon(s, sp, 5));
  dailyCare(s);
  const first = MISSIONS_IN_ORDER[0];
  const run = startMission(s, first.id, pickSquad(s, first.id));
  playMission(s, run);
  if (run.outcome === 'active') completeMission(s, run);
  endDay(s);
  const mem = memoryStorage();
  ok(saveGame(s, mem), 'saved');
  deepEq(loadGame(mem), s, 'round trip after play');
});

// ---------------------------------------------------------------------------------------------

console.log(`\ngametest: ${passed} passed, ${failures} failed${skipped.length ? `, ${skipped.length} skipped` : ''}`);
for (const sk of skipped) console.log(`  skipped: ${sk}`);
if (failures > 0) process.exit(1);
