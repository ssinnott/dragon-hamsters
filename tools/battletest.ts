// Battle engine tests: node tools/battletest.ts (exit 1 on any failure).
//
// The content tables are authored concurrently, so these tests never depend on specific content
// ids. They register their own fixtures under 'test-' ids (moves, abilities, villains, a species,
// personalities) BEFORE src/data/index.ts is first loaded (it builds its species map at import),
// install a known type chart for the unit tests, and finally restore the real chart and fuzz 500
// random battles over whatever species and villains exist at run time.
import type {
  AbilityEffect, MoveDef, MoveEffect, Stats, StatusId, TypeId, ItemId, StageChanges,
} from '../src/data/schema.ts';
import { ITEM_IDS, TYPE_IDS } from '../src/data/schema.ts';
import { MOVES } from '../src/data/moves.ts';
import { ABILITIES } from '../src/data/abilities.ts';
import { SPECIES } from '../src/data/species.ts';
import { VILLAINS } from '../src/data/villains.ts';
import { PERSONALITIES } from '../src/data/personalities.ts';
import { CHART } from '../src/data/types.ts';
import { ITEMS } from '../src/data/items.ts';
import { MAX_LEVEL } from '../src/game/types.ts';
import { makeRng } from '../src/lib/engine/rng.ts';
import type { AiLevel, BattleEvent, BattleMon, BattleState, MonInit, PlayerAction } from '../src/battle/types.ts';

// ---------------------------------------------------------------------------------------------
// Fixtures (registered before the battle modules, and with them src/data/index.ts, load)
// ---------------------------------------------------------------------------------------------

const ABILITY_FIXTURES: Record<string, AbilityEffect> = {
  'test-plain': { kind: 'typeBoost', type: 'METAL', mult: 1 },
  'test-pinch': { kind: 'pinch', type: 'FIRE', mult: 1.5 },
  'test-static': { kind: 'contactStatus', status: 'burn', chance: 100 },
  'test-gooey': { kind: 'contactStages', changes: { spe: -1 } },
  'test-sponge': { kind: 'absorb', type: 'WATER', heal: 0.25 },
  'test-motor': { kind: 'absorb', type: 'LIGHTNING', heal: 0, boost: { spe: 1 } },
  'test-thickfat': { kind: 'resist', types: ['FIRE', 'FROST'], mult: 0.5 },
  'test-intimidate': { kind: 'entry', who: 'foe', changes: { atk: -1 } },
  'test-bulkup': { kind: 'entry', who: 'self', changes: { def: 1 } },
  'test-sturdy': { kind: 'sturdy' },
  'test-regen': { kind: 'regenTurn', fraction: 0.125 },
  'test-speedboost': { kind: 'speedBoost' },
  'test-hugepower': { kind: 'statMult', stat: 'atk', mult: 2, when: 'always' },
  'test-guts': { kind: 'statMult', stat: 'atk', mult: 1.5, when: 'statused' },
  'test-quickfeet': { kind: 'statMult', stat: 'spe', mult: 1.5, when: 'statused' },
  'test-adapt': { kind: 'stab', mult: 2 },
  'test-filter': { kind: 'filter', mult: 0.75 },
  'test-technician': { kind: 'technician' },
  'test-prankster': { kind: 'prankster' },
  'test-moxie': { kind: 'moxie' },
  'test-regenerator': { kind: 'switchHeal', fraction: 1 / 3 },
  'test-naturalcure': { kind: 'switchCure' },
  'test-insomnia': { kind: 'statusImmune', statuses: ['snooze'] },
  'test-innerfocus': { kind: 'innerFocus' },
  'test-superluck': { kind: 'superLuck' },
  'test-multiscale': { kind: 'multiscale' },
  'test-pressure': { kind: 'pressure' },
  'test-shedskin': { kind: 'shedSkin', chance: 100 },
  'test-rockhead': { kind: 'rockHead' },
  'test-clearbody': { kind: 'clearBody' },
  'test-serene': { kind: 'sereneGrace' },
  'test-firepower': { kind: 'typeBoost', type: 'FIRE', mult: 1.5 },
  'test-claws': { kind: 'contactBoost', mult: 1.3 },
};
for (const [id, effect] of Object.entries(ABILITY_FIXTURES)) {
  ABILITIES[id] = { id, name: id.replace('test-', 'T '), description: 'Test fixture.', effect, parallel: 'test' };
}

type MoveSpec = Pick<MoveDef, 'type' | 'category' | 'power'> & Partial<MoveDef>;
function mv(id: string, spec: MoveSpec): void {
  MOVES[id] = {
    id, name: id.replace('test-', 'T '), accuracy: 100, pp: 30, priority: 0, contact: spec.category === 'physical',
    target: 'foe', effects: [], description: 'Test fixture.', fx: 'tackle', ...spec,
  };
}
mv('test-wait', { type: 'FLUFF', category: 'status', power: 0, target: 'self', pp: 64 });
mv('test-tackle', { type: 'FLUFF', category: 'physical', power: 40, pp: 64 });
mv('test-strike', { type: 'FLUFF', category: 'physical', power: 80, contact: false });
mv('test-plain140', { type: 'FLUFF', category: 'physical', power: 140, contact: false });
mv('test-flame', { type: 'FIRE', category: 'special', power: 90 });
mv('test-flame60', { type: 'FIRE', category: 'special', power: 60 });
mv('test-water40', { type: 'WATER', category: 'special', power: 40 });
mv('test-water', { type: 'WATER', category: 'special', power: 60 });
mv('test-spark', { type: 'LIGHTNING', category: 'special', power: 60 });
mv('test-special130', { type: 'FLUFF', category: 'special', power: 130 });
mv('test-ember-burn', { type: 'FIRE', category: 'special', power: 40, effects: [{ kind: 'inflict', status: 'burn', chance: 100 }] });
for (const st of ['burn', 'goop', 'zap', 'snooze', 'frozen'] as StatusId[]) {
  mv(`test-${st}-status`, { type: 'FLUFF', category: 'status', power: 0, effects: [{ kind: 'inflict', status: st, chance: 100 }] });
}
mv('test-confuse', { type: 'MIND', category: 'status', power: 0, effects: [{ kind: 'confuse', chance: 100 }] });
mv('test-flinch', { type: 'DARKNESS', category: 'physical', power: 20, effects: [{ kind: 'flinch', chance: 100 }] });
mv('test-flinch30', { type: 'FLUFF', category: 'physical', power: 10, effects: [{ kind: 'flinch', chance: 30 }] });
mv('test-buff', { type: 'FLUFF', category: 'status', power: 0, target: 'self', effects: [{ kind: 'stages', who: 'self', changes: { atk: 2 }, chance: 100 }] });
mv('test-debuff', { type: 'FLUFF', category: 'status', power: 0, effects: [{ kind: 'stages', who: 'foe', changes: { atk: -1 }, chance: 100 }] });
mv('test-heal', { type: 'COOKING', category: 'status', power: 0, target: 'self', effects: [{ kind: 'heal', fraction: 0.5 }] });
mv('test-drain', { type: 'LEAF', category: 'special', power: 60, effects: [{ kind: 'drain', fraction: 0.5 }] });
mv('test-recoil', { type: 'FLUFF', category: 'physical', power: 90, effects: [{ kind: 'recoil', fraction: 1 / 3 }] });
mv('test-multi', { type: 'FLUFF', category: 'physical', power: 20, effects: [{ kind: 'multiHit', min: 2, max: 5 }] });
mv('test-multi3', { type: 'FLUFF', category: 'physical', power: 20, effects: [{ kind: 'multiHit', min: 3, max: 3 }] });
mv('test-highcrit', { type: 'FLUFF', category: 'physical', power: 70, effects: [{ kind: 'highCrit' }] });
mv('test-protect', { type: 'FLUFF', category: 'status', power: 0, priority: 4, target: 'self', effects: [{ kind: 'protect' }] });
mv('test-trap', { type: 'DARKNESS', category: 'status', power: 0, effects: [{ kind: 'trap' }] });
mv('test-cure-self', { type: 'COOKING', category: 'status', power: 0, target: 'self', effects: [{ kind: 'cure', who: 'self' }] });
mv('test-cure-team', { type: 'COOKING', category: 'status', power: 0, target: 'self', effects: [{ kind: 'cure', who: 'team' }] });
mv('test-fixed-level', { type: 'FLUFF', category: 'physical', power: 0, effects: [{ kind: 'fixed', damage: 'level' }] });
mv('test-fixed-20', { type: 'MIND', category: 'special', power: 0, effects: [{ kind: 'fixed', damage: 20 }] });
mv('test-reset', { type: 'FROST', category: 'status', power: 0, effects: [{ kind: 'resetStages' }] });
mv('test-seed', { type: 'LEAF', category: 'status', power: 0, effects: [{ kind: 'seed' }] });
mv('test-pivot', { type: 'FLUFF', category: 'physical', power: 30, effects: [{ kind: 'pivot' }] });
mv('test-surehit', { type: 'FLUFF', category: 'physical', power: 20, accuracy: 50, effects: [{ kind: 'sureHit' }] });
mv('test-inaccurate', { type: 'FLUFF', category: 'physical', power: 10, accuracy: 50 });
mv('test-rest', { type: 'MIND', category: 'status', power: 0, target: 'self', effects: [{ kind: 'rest' }] });
mv('test-thaw', { type: 'FIRE', category: 'physical', power: 20, effects: [{ kind: 'thaw' }] });
mv('test-facade', { type: 'FLUFF', category: 'physical', power: 70, contact: false, effects: [{ kind: 'facade' }] });
mv('test-hex', { type: 'FLUFF', category: 'special', power: 65, effects: [{ kind: 'hex' }] });
mv('test-firstturn', { type: 'FLUFF', category: 'physical', power: 10, priority: 3, effects: [{ kind: 'firstTurn' }] });
mv('test-quick', { type: 'FLUFF', category: 'physical', power: 10, priority: 1 });

const BASE80: Stats = { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 };
const VISUAL = {
  body: '#e8743a', belly: '#ffd9a0', accent: '#ffcf3a', wing: '#ff9a4a', eye: '#2a1a12', cheek: '#ff7a7a', size: 1, build: 0.5,
  wings: 'stubby', horns: 'nubs', tail: 'stub', pattern: 'none', extras: [],
} as const;
SPECIES.push({
  id: 'test-blob', dex: 9000, name: 'Testblob', category: 'Test Hamster', types: ['FLUFF'], baseStats: BASE80,
  abilities: ['test-plain'], learnset: [{ level: 1, move: 'test-tackle' }], backstory: 'A test fixture.', fact: 'A test fixture.',
  height: '0.2 m', weight: '0.3 kg', favoriteFood: 'seeds', rarity: 'common', baseXp: 100, visual: { ...VISUAL, extras: [] },
});
for (const [id, role] of [['test-goon', 'minion'], ['test-boss', 'boss']] as const) {
  VILLAINS[id] = {
    id, name: id === 'test-goon' ? 'Test Goon' : 'Test Boss', org: 'cheese', role, types: ['FLUFF'],
    baseStats: { hp: 60, atk: 110, def: 80, spa: 80, spd: 80, spe: 80 }, ability: 'test-plain',
    learnset: [{ level: 1, move: 'test-wait' }], baseXp: 100, coins: 10, taunt: 'Test taunt.', defeat: 'Not fair!',
    ...(role === 'boss' ? { caught: 'You got me!' } : {}),
    description: 'A test fixture.',
    visual: { animal: 'mouse', body: '#999999', belly: '#dddddd', accent: '#f0d040', eye: '#101010', outfit: 'none', outfitColor: '#303040', prop: 'none', size: 1 },
  };
}
PERSONALITIES.push(
  { id: 'test-modest', name: 'Test Modest', up: 'spa', down: 'atk', blurb: 'Test.' },
  { id: 'test-neutral', name: 'Test Neutral', up: null, down: null, blurb: 'Test.' },
);

// A known chart for the unit tests (the research chart, docs/POKEMON_RESEARCH.md section 5),
// installed into the live CHART object and restored before the fuzz.
const TEST_CHART: Record<TypeId, Partial<Record<TypeId, number>>> = {
  FLUFF: { DARKNESS: 2, MIND: 2, ROCK: 0.5, METAL: 0.5, BRAWL: 0.5 },
  FIRE: { LEAF: 2, FROST: 2, METAL: 2, FIRE: 0.5, WATER: 0.5, ROCK: 0.5, COOKING: 0.5 },
  WATER: { FIRE: 2, EARTH: 2, ROCK: 2, COOKING: 2, WATER: 0.5, LEAF: 0.5, WINGED: 0.5 },
  LEAF: { WATER: 2, EARTH: 2, ROCK: 2, FIRE: 0.5, LEAF: 0.5, SLIME: 0.5, COOKING: 0.5 },
  LIGHTNING: { WATER: 2, WINGED: 2, LIGHTNING: 0.5, LEAF: 0.5, SLIME: 0.5, EARTH: 0 },
  EARTH: { FIRE: 2, LIGHTNING: 2, SLIME: 2, METAL: 2, LEAF: 0.5, FROST: 0.5, LIGHT: 0.5, WINGED: 0 },
  ROCK: { FIRE: 2, FROST: 2, WINGED: 2, EARTH: 0.5, METAL: 0.5, BRAWL: 0.5 },
  WINGED: { SLIME: 2, COOKING: 2, BRAWL: 2, LIGHTNING: 0.5, ROCK: 0.5, METAL: 0.5 },
  FROST: { LEAF: 2, EARTH: 2, WINGED: 2, FIRE: 0.5, WATER: 0.5, FROST: 0.5, METAL: 0.5 },
  SLIME: { LEAF: 2, LIGHTNING: 2, LIGHT: 2, COOKING: 2, EARTH: 0.5, WINGED: 0.5, SLIME: 0.5, METAL: 0 },
  DARKNESS: { MIND: 2, LIGHT: 2, DARKNESS: 0.5, BRAWL: 0.5 },
  LIGHT: { BRAWL: 2, DARKNESS: 2, FIRE: 0.5, SLIME: 0.5, METAL: 0.5 },
  COOKING: { FLUFF: 2, LEAF: 2, FROST: 2, FIRE: 0.5, WATER: 0.5, METAL: 0.5 },
  METAL: { ROCK: 2, FROST: 2, LIGHT: 2, FIRE: 0.5, WATER: 0.5, LIGHTNING: 0.5, METAL: 0.5 },
  MIND: { SLIME: 2, BRAWL: 2, FLUFF: 0.5, MIND: 0.5, METAL: 0.5, DARKNESS: 0 },
  BRAWL: { FLUFF: 2, ROCK: 2, DARKNESS: 2, METAL: 2, SLIME: 0.5, WINGED: 0.5, MIND: 0.5, LIGHT: 0.5 },
};
const REAL_CHART: Record<string, Partial<Record<TypeId, number>>> = {};
function setChart(src: Record<string, Partial<Record<TypeId, number>>>): void {
  for (const t of TYPE_IDS) {
    const row = CHART[t] ?? (CHART[t] = {});
    for (const k of Object.keys(row)) delete row[k as TypeId];
    Object.assign(row, src[t] ?? {});
  }
}
for (const t of TYPE_IDS) REAL_CHART[t] = { ...(CHART[t] ?? {}) };
setChart(TEST_CHART);

// Now the modules under test (they pull in src/data/index.ts, which sees the fixtures).
const { createBattle, startBattle, submitTurn, submitSwitch, legal, activeMon } = await import('../src/battle/battle.ts');
const { calcDamage, computeDamage, estimateDamage, effectiveStat, critStage, critChance, STRUGGLE } = await import('../src/battle/damage.ts');
const M = await import('../src/battle/matchup.ts');
const { buildMon, defaultMoves, computeStats } = await import('../src/battle/build.ts');
const { calcStats, xpForLevel, levelForXp, xpYield, stageMult, accStageMult } = await import('../src/battle/stats.ts');
const { chooseEnemyAction, chooseEnemyReplacement } = await import('../src/battle/ai.ts');
const { getMove, getSpecies } = await import('../src/data/index.ts');

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

let current = '';
let passed = 0;
const failures: string[] = [];
function check(cond: boolean, msg: string): void {
  if (cond) passed++;
  else failures.push(`${current}: ${msg}`);
}
function eq<T>(actual: T, expected: T, msg: string): void {
  const same = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
  check(same, `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function within(v: number, lo: number, hi: number, msg: string): void {
  check(v >= lo && v <= hi, `${msg}: ${v} not in [${lo}, ${hi}]`);
}
function test(name: string, fn: () => void): void {
  current = name;
  const before = failures.length;
  try {
    fn();
  } catch (e) {
    failures.push(`${name}: threw ${(e as Error).stack ?? e}`);
  }
  if (failures.length === before) passed++;
}
function throws(fn: () => unknown, msg: string): void {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(threw, `${msg}: expected a throw`);
}

const G31: Stats = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const ZERO: Stats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

function pInit(o: Partial<MonInit> = {}): MonInit {
  return { kind: 'dragon', defId: 'test-blob', level: 30, genes: G31, training: ZERO, moves: ['test-tackle'], ability: 'test-plain', ...o };
}
function eInit(o: Partial<MonInit> = {}): MonInit {
  return { kind: 'villain', defId: 'test-goon', level: 30, moves: ['test-wait'], ability: 'test-plain', ...o };
}
interface MkOpts {
  p?: Partial<MonInit>[]; e?: Partial<MonInit>[]; seed?: number; ai?: AiLevel;
  items?: Partial<Record<ItemId, number>>; retreat?: boolean; setup?: (s: BattleState) => void; noStart?: boolean;
}
function mk(o: MkOpts = {}): BattleState {
  const st = createBattle({
    seed: o.seed ?? 1, player: (o.p ?? [{}]).map(pInit), enemy: (o.e ?? [{}]).map(eInit),
    items: o.items ?? {}, aiLevel: o.ai ?? 'minion', canRetreat: o.retreat ?? true,
  });
  o.setup?.(st);
  if (!o.noStart) startBattle(st);
  return st;
}
const P = (st: BattleState): BattleMon => activeMon(st, 'player');
const E = (st: BattleState): BattleMon => activeMon(st, 'enemy');
const T = (evs: BattleEvent[]): string[] => evs.filter((e): e is Extract<BattleEvent, { t: 'text' }> => e.t === 'text').map((e) => e.text);
const has = (evs: BattleEvent[], sub: string): boolean => T(evs).some((t) => t.includes(sub));
const count = (evs: BattleEvent[], sub: string): number => T(evs).filter((t) => t.includes(sub)).length;
const mvA = (slot = 0): PlayerAction => ({ kind: 'move', slot });
/** The text lines of one combatant's action: from "<WHO> USED" up to the next "... USED" line. */
function seg(evs: BattleEvent[], who: string): string[] {
  const t = T(evs);
  const i = t.findIndex((x) => x.startsWith(`${who} USED`));
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i; j < t.length; j++) {
    if (j > i && t[j].includes(' USED ')) break;
    out.push(t[j]);
  }
  return out;
}
const segHas = (evs: BattleEvent[], who: string, sub: string): boolean => seg(evs, who).some((x) => x.includes(sub));
const dmgTo = (evs: BattleEvent[], uid: string): Extract<BattleEvent, { t: 'damage' }>[] =>
  evs.filter((e): e is Extract<BattleEvent, { t: 'damage' }> => e.t === 'damage' && e.uid === uid);
/** Player strictly faster than the enemy. */
const fast = (s: BattleState): void => { s.player.team[0].stats.spe = 999; s.enemy.team[0].stats.spe = 1; };
const slow = (s: BattleState): void => { s.player.team[0].stats.spe = 1; s.enemy.team[0].stats.spe = 999; };
const bigHp = (m: BattleMon): void => { m.stats.hp = 9999; m.hp = 9999; };
const coveredMoveKinds = new Set<string>();
const coveredAbilityKinds = new Set<string>();
const coverMove = (k: MoveEffect['kind']): void => { coveredMoveKinds.add(k); };
const coverAbility = (k: AbilityEffect['kind']): void => { coveredAbilityKinds.add(k); };

// ---------------------------------------------------------------------------------------------
// Fixture sanity
// ---------------------------------------------------------------------------------------------

test('fixtures are visible through src/data/index.ts', () => {
  eq(getSpecies('test-blob').name, 'Testblob', 'species fixture');
  eq(getMove('test-tackle').power, 40, 'move fixture');
});

// ---------------------------------------------------------------------------------------------
// stats.ts
// ---------------------------------------------------------------------------------------------

test('stat formula matches the Charizard reference numbers', () => {
  const zard: Stats = { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 };
  const s100 = calcStats(zard, 100, G31, { ...ZERO, hp: 252, spa: 252 }, 'test-modest');
  eq(s100.spa, 348, 'L100 SpA, 31 IV, 252 EV, +SpA personality');
  eq(s100.hp, 360, 'L100 HP, 31 IV, 252 EV');
  const s50 = calcStats(zard, 50, G31, ZERO, null);
  eq(s50.hp, 153, 'L50 HP');
  eq(s50.spa, 129, 'L50 SpA');
  eq(s50.atk, 104, 'L50 Atk neutral');
  eq(calcStats(zard, 50, G31, ZERO, 'test-modest').atk, 93, 'L50 Atk with -Atk personality (x0.9, floored)');
  eq(calcStats(zard, 50, G31, ZERO, 'test-neutral'), s50, 'neutral personality changes nothing');
  eq(calcStats(BASE80, 5, ZERO, ZERO, null).hp, Math.floor(160 * 5 / 100) + 15, 'low level HP');
});

test('experience curve and yield', () => {
  eq(xpForLevel(1), 0, 'L1');
  eq(xpForLevel(5), 125, 'L5');
  eq(xpForLevel(50), 125000, 'L50');
  eq(levelForXp(124), 4, '124 xp');
  eq(levelForXp(125), 5, '125 xp');
  eq(levelForXp(0), 1, '0 xp');
  eq(levelForXp(1e9), MAX_LEVEL, 'capped');
  eq(xpYield(51, 5, 5, false), 52, 'L5 Rattata vs L5');
  eq(xpYield(51, 5, 10, false), 30, 'L5 Rattata vs L10');
  eq(xpYield(51, 5, 5, true), 78, 'boss x1.5');
  eq(xpYield(100, 30, 30, false), 601, 'even levels: b*L/5 + 1');
});

test('stage multipliers', () => {
  eq([-6, -2, -1, 0, 1, 2, 6].map(stageMult), [0.25, 0.5, 2 / 3, 1, 1.5, 2, 4], 'stat stages');
  eq([-6, -3, -1, 0, 1, 3, 6].map(accStageMult), [1 / 3, 0.5, 0.75, 1, 4 / 3, 2, 3], 'accuracy stages');
  eq(stageMult(9), 4, 'clamped to +6');
});

// ---------------------------------------------------------------------------------------------
// build.ts
// ---------------------------------------------------------------------------------------------

test('buildMon and defaultMoves', () => {
  eq(defaultMoves([{ level: 1, move: 'a' }, { level: 3, move: 'b' }, { level: 5, move: 'c' }, { level: 7, move: 'd' }, { level: 9, move: 'e' }, { level: 20, move: 'f' }], 10),
    ['b', 'c', 'd', 'e'], 'last four at or below level');
  eq(defaultMoves([{ level: 1, move: 'a' }, { level: 5, move: 'b' }, { level: 8, move: 'a' }], 10), ['b', 'a'], 'relearned move moves to the end');
  const m = buildMon(pInit({ level: 12, startStages: { atk: 2, spe: -9 } }), 'player', 2);
  eq(m.uid, 'p2', 'uid');
  eq(m.stats, calcStats(BASE80, 12, G31, ZERO, null), 'stats at level');
  eq(m.hp, m.stats.hp, 'full HP by default');
  eq(m.stages.atk, 2, 'start stages');
  eq(m.stages.spe, -6, 'start stages clamped');
  eq(m.xp, xpForLevel(12), 'xp defaults to the level threshold');
  const v = buildMon(eInit({ moves: undefined }), 'enemy', 0);
  eq(v.moves.map((s) => s.id), ['test-wait'], 'villain learnset default');
  eq(v.genes, { hp: 15, atk: 15, def: 15, spa: 15, spd: 15, spe: 15 }, 'villain genes default to 15');
  eq(v.happiness, 50, 'villain happiness');
  eq(v.isBoss, false, 'minion is not a boss');
});

test('bosses get x1.5 max HP', () => {
  const plain = buildMon(eInit(), 'enemy', 0);
  const boss = buildMon(eInit({ defId: 'test-boss' }), 'enemy', 1);
  eq(boss.isBoss, true, 'boss role defaults to isBoss');
  eq(boss.stats.hp, Math.floor(plain.stats.hp * 1.5), 'boss HP');
  eq(boss.hp, boss.stats.hp, 'starts full');
  eq(boss.stats.atk, plain.stats.atk, 'other stats unchanged');
  eq(buildMon(eInit({ isBoss: true }), 'enemy', 0).stats.hp, Math.floor(plain.stats.hp * 1.5), 'MonInit.isBoss');
  eq(computeStats(boss).hp, boss.stats.hp, 'recompute keeps the bonus');
});

// ---------------------------------------------------------------------------------------------
// matchup.ts
// ---------------------------------------------------------------------------------------------

test('type effectiveness: dual types and immunities', () => {
  eq(M.typeEffectiveness('FIRE', ['LEAF']), 2, 'FIRE > LEAF');
  eq(M.typeEffectiveness('FIRE', ['LEAF', 'FROST']), 4, 'x4');
  eq(M.typeEffectiveness('WATER', ['LEAF', 'WATER']), 0.25, 'x0.25');
  eq(M.typeEffectiveness('FIRE', ['LEAF', 'WATER']), 1, '2 x 0.5');
  eq(M.typeEffectiveness('LIGHTNING', ['EARTH']), 0, 'immune');
  eq(M.typeEffectiveness('LIGHTNING', ['EARTH', 'WATER']), 0, 'immunity wins over weakness');
  eq(M.moveEffectiveness('test-flame', ['METAL']), 2, 'moveEffectiveness');
  // Fixed-damage moves ignore the chart except for immunity: the FIGHT tag must say x1, not SUPER/WEAK.
  eq(M.moveEffectiveness('test-fixed-20', ['BRAWL']), 1, 'fixed move vs a type its type hits x2 shows x1');
  eq(M.moveEffectiveness('test-fixed-20', ['FLUFF']), 1, 'fixed move vs a type that resists its type shows x1');
  eq(M.moveEffectiveness('test-fixed-20', ['DARKNESS']), 0, 'fixed move vs an immune type shows NO EFFECT');
  eq(M.moveEffectiveness('test-fixed-level', ['DARKNESS']), 1, 'FLUFF fixed move vs DARKNESS (x2 by type) shows x1');
  eq(M.moveEffectiveness('test-debuff', ['DARKNESS']), 2, 'status moves still report their type multiplier');
  eq(M.bestTypeMultiplier(['FLUFF', 'WATER'], ['FIRE']), 2, 'best of the attacker types');
  eq(M.weaknesses(['FIRE']), ['WATER', 'EARTH', 'ROCK'], 'weaknesses');
  eq(M.resistances(['EARTH']), ['LIGHTNING', 'ROCK', 'SLIME'], 'resistances include immunities');
  eq(M.immunities(['WINGED', 'DARKNESS']), ['EARTH', 'MIND'], 'immunities');
});

test('matchup grades, intel and counter types', () => {
  eq(M.matchupGrade(['FIRE'], ['test-flame'], ['LEAF']), 3, 'FIRE vs LEAF');
  eq(M.matchupGrade(['LEAF'], ['test-drain'], ['FIRE']), 1, 'LEAF vs FIRE');
  eq(M.matchupGrade(['FLUFF'], ['test-tackle'], ['FLUFF']), 2, 'neutral');
  eq(M.matchupGrade(['FLUFF'], ['test-tackle', 'test-flame'], ['LEAF']), 3, 'a coverage move counts');
  eq(M.matchupGrade(['FLUFF'], [], ['DARKNESS']), 3, 'no moves: own types');
  eq(M.matchupGrade(['FIRE'], ['test-flame'], ['WATER']), 1, 'FIRE vs WATER');
  eq(M.intelGrade(['FIRE'], ['test-flame'], [['LEAF'], ['FROST'], ['FLUFF']]), 3, 'intel average (3, 3, 2) rounds to 3');
  eq(M.intelGrade(['FIRE'], ['test-flame'], [['LEAF'], ['FROST'], ['WATER']]), 2, 'intel average (3, 3, 1) rounds to 2');
  eq(M.intelGrade(['FIRE'], ['test-flame'], []), 2, 'no intel');
  // Resisted both ways is even, whatever neutral coverage it carries (battle-03-swap: Puddlepaw vs Soaker Bot).
  eq(M.matchupGrade(['WATER'], ['test-water'], ['WATER']), 2, 'WATER vs WATER: STAB only');
  eq(M.matchupGrade(['WATER'], ['test-tackle', 'test-water'], ['WATER']), 2, 'WATER vs WATER: neutral coverage is not enough');
  eq(M.matchupGrade(['WATER'], ['test-tackle', 'test-water', 'test-drain'], ['WATER']), 3, 'WATER vs WATER with a super-effective LEAF move');
  eq(M.matchupGrade(['FIRE'], ['test-flame'], ['FIRE']), 2, 'mirror match');
  // Resisting their STAB while your own STAB lands neutrally is favourable.
  eq(M.matchupGrade(['METAL'], [], ['FLUFF']), 3, 'METAL resists FLUFF and hits it neutrally');
  eq(M.matchupGrade(['FLUFF'], [], ['METAL']), 2, '...and the other way round is only even');
  // Hit super-effectively with nothing super-effective back: 1, even with a neutral STAB.
  eq(M.matchupGrade(['EARTH'], [], ['WATER']), 1, 'EARTH vs WATER');
  // Two-way super-effective is even.
  eq(M.matchupGrade(['FIRE'], ['test-flame'], ['LEAF', 'EARTH']), 2, 'SE both ways');
  // Can't touch them at all.
  eq(M.matchupGrade(['FLUFF'], ['test-spark'], ['EARTH']), 1, 'only immune moves');
  eq(M.matchupGrade(['FLUFF'], ['test-fixed-level'], ['FLUFF']), 2, 'fixed damage counts as neutral');
  const parts = M.matchupParts(['WATER'], ['test-tackle', 'test-water'], ['WATER']);
  eq(parts, { offence: 1, stab: 0.5, defence: 0.5 }, 'matchupParts');
  // Over every pair of single types (STAB only): never 3 stars both ways, and 3 vs 1 mirror each other.
  for (const a of TYPE_IDS) {
    for (const b of TYPE_IDS) {
      const ab = M.matchupGrade([a], [], [b]);
      const ba = M.matchupGrade([b], [], [a]);
      check(!(ab === 3 && ba === 3), `${a} and ${b} are not both 3 stars`);
      if (M.typeEffectiveness(b, [a]) < 1 && M.typeEffectiveness(a, [b]) < 1) check(ab === 2 && ba === 2, `${a}/${b} resist each other: even`);
      if (ab === 1) check(ba !== 1, `${a}/${b}: not both 1 star`);
    }
  }
  // intelGrade of one set is that set's grade.
  for (const foe of [['LEAF'], ['WATER'], ['FLUFF'], ['FROST', 'ROCK']] as TypeId[][]) {
    eq(M.intelGrade(['FIRE'], ['test-flame'], [foe]), M.matchupGrade(['FIRE'], ['test-flame'], foe), `intel of one set: ${foe}`);
  }
  eq(M.GRADE_LABELS[3], 'GREAT MATCHUP!', 'grade label');
  const c = M.counterTypes(['FIRE']);
  check(c.length > 0 && c.length <= 4, 'counter list size');
  check(c.every((t) => M.typeEffectiveness(t, ['FIRE']) > 1), `counters hit FIRE super-effectively: ${c}`);
  check(c[0] === 'WATER', `WATER (hits and resists FIRE) leads: ${c}`);
  eq(M.counterTypes([]), [], 'empty intel');
});

test('effectiveness labels', () => {
  eq(M.effectivenessLabel(2).text, 'SUPER X2', 'x2');
  eq(M.effectivenessLabel(4).text, 'SUPER X4', 'x4');
  eq(M.effectivenessLabel(1).text, 'X1', 'x1');
  eq(M.effectivenessLabel(0.5).text, 'WEAK X0.5', 'x0.5');
  eq(M.effectivenessLabel(0.25).text, 'WEAK X0.25', 'x0.25');
  eq(M.effectivenessLabel(0).text, 'NO EFFECT', 'x0');
  for (const m of [0, 0.25, 0.5, 1, 2, 4]) {
    const hex = M.effectivenessLabel(m).color;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    check(0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35, `label colour ${hex} is light enough for a dark panel`);
  }
});

// ---------------------------------------------------------------------------------------------
// damage.ts
// ---------------------------------------------------------------------------------------------

function duo(level: number, pTypes: TypeId[], eTypes: TypeId[], tweak?: (p: BattleMon, e: BattleMon) => void): { st: BattleState; p: BattleMon; e: BattleMon } {
  const st = mk({
    p: [{ level }], e: [{ level }], noStart: true,
    setup: (s) => {
      s.player.team[0].types = pTypes;
      s.enemy.team[0].types = eTypes;
      tweak?.(s.player.team[0], s.enemy.team[0]);
    },
  });
  return { st, p: P(st), e: E(st) };
}
const rolls = (a: BattleMon, d: BattleMon, id: string, crit = false): number[] => {
  const out: number[] = [];
  for (let r = 85; r <= 100; r++) out.push(computeDamage(a, d, getMove(id), crit, r).damage);
  return out;
};

test('damage formula: L50 Charizard Flamethrower (research worked example)', () => {
  const { st, p, e } = duo(50, ['FIRE'], ['LEAF'], (p, e) => { p.stats.spa = 129; e.stats.spd = 120; });
  eq(rolls(p, e, 'test-flame'), [110, 110, 114, 114, 116, 116, 120, 120, 120, 122, 122, 126, 126, 128, 128, 132], 'all 16 rolls');
  eq(computeDamage(p, e, getMove('test-flame'), true, 85).damage, 168, 'crit min');
  eq(computeDamage(p, e, getMove('test-flame'), true, 100).damage, 198, 'crit max');
  const est = estimateDamage(p, e, 'test-flame');
  eq([est.min, est.max, est.effectiveness], [110, 132, 2], 'estimateDamage');
  eq(calcDamage(st, p, e, getMove('test-flame'), { forceCrit: false, randomFactor: 0.85 }).damage, 110, 'calcDamage randomFactor as a fraction');
  eq(calcDamage(st, p, e, getMove('test-flame'), { forceCrit: true, randomFactor: 100 }), { damage: 198, effectiveness: 2, crit: true }, 'calcDamage forced crit');
});

test('damage formula: L25 middle-stage table from the research doc', () => {
  const { p, e } = duo(25, ['FIRE'], ['LEAF'], (p, e) => { p.stats.spa = 50; e.stats.spd = 45; });
  const r = (id: string, crit = false): number[] => { const x = rolls(p, e, id, crit); return [x[0], x[15]]; };
  eq(r('test-flame'), [66, 78], 'STAB + x2');
  eq(r('test-flame', true), [98, 116], 'crit');
  e.types = ['FLUFF'];
  eq(r('test-flame'), [33, 39], 'neutral');
  eq(r('test-water40'), [10, 12], '40 power, no STAB, neutral');
  e.types = ['FIRE'];
  eq(r('test-flame'), [16, 19], 'resisted');
  e.types = ['LEAF'];
  eq(r('test-flame60'), [44, 54], '60 power STAB + x2');
});

test('STAB, burn, crit stages and the minimum of 1', () => {
  const { p, e } = duo(30, ['FIRE'], ['FLUFF']);
  const plain = computeDamage(p, e, getMove('test-strike'), false, 100).damage;
  p.types = ['FLUFF'];
  eq(computeDamage(p, e, getMove('test-strike'), false, 100).damage, Math.floor(plain * 1.5), 'STAB x1.5');
  p.ability = 'test-adapt'; coverAbility('stab');
  eq(computeDamage(p, e, getMove('test-strike'), false, 100).damage, Math.floor(plain * 2), 'stab ability x2');
  p.ability = 'test-plain';
  p.types = ['FIRE'];
  p.status = 'burn';
  eq(computeDamage(p, e, getMove('test-strike'), false, 100).damage, Math.floor(plain / 2), 'burn halves physical');
  eq(computeDamage(p, e, getMove('test-flame'), false, 100).damage > 0, true, 'special still hits');
  p.status = null;
  // Crits ignore the attacker's drops and the defender's boosts.
  const critBase = computeDamage(p, e, getMove('test-strike'), true, 100).damage;
  p.stages.atk = -2; e.stages.def = 2;
  eq(computeDamage(p, e, getMove('test-strike'), true, 100).damage, critBase, 'crit ignores -atk / +def');
  check(computeDamage(p, e, getMove('test-strike'), false, 100).damage < plain, 'non-crit respects them');
  p.stages.atk = 2; e.stages.def = 0;
  check(computeDamage(p, e, getMove('test-strike'), true, 100).damage > critBase, 'crit keeps +atk');
  p.stages.atk = 0;
  e.stats.def = 9999;
  eq(computeDamage(p, e, getMove('test-tackle'), false, 85).damage, 1, 'minimum 1');
  e.types = ['ROCK', 'METAL'];
  check(computeDamage(p, e, getMove('test-tackle'), false, 85).damage >= 1, 'minimum 1 when resisted');
});

test('critical-hit chances by stage', () => {
  const { st, p, e } = duo(30, ['FLUFF'], ['FLUFF'], (_p, e) => bigHp(e));
  eq(critStage(p, getMove('test-tackle')), 0, 'stage 0');
  eq(critStage(p, getMove('test-highcrit')), 1, 'high-crit move'); coverMove('highCrit');
  p.ability = 'test-superluck'; coverAbility('superLuck');
  eq(critStage(p, getMove('test-highcrit')), 2, '+ superLuck');
  p.happiness = 80;
  eq(critStage(p, getMove('test-highcrit')), 3, '+ happiness 80');
  eq([0, 1, 2, 3].map(critChance), [1 / 24, 1 / 8, 1 / 2, 1], 'chances');
  let crits = 0;
  for (let i = 0; i < 200; i++) if (calcDamage(st, p, e, getMove('test-highcrit')).crit) crits++;
  eq(crits, 200, 'stage 3 always crits');
  p.ability = 'test-plain'; p.happiness = 50;
  crits = 0;
  for (let i = 0; i < 24000; i++) if (calcDamage(st, p, e, getMove('test-tackle')).crit) crits++;
  within(crits, 850, 1150, 'stage 0 ~ 1/24');
  crits = 0;
  for (let i = 0; i < 8000; i++) if (calcDamage(st, p, e, getMove('test-highcrit')).crit) crits++;
  within(crits, 880, 1120, 'stage 1 ~ 1/8');
});

test('facade and hex double their power; facade ignores burn', () => {
  coverMove('facade'); coverMove('hex');
  const { p, e } = duo(30, ['WATER'], ['FLUFF']);
  const normal = computeDamage(p, e, getMove('test-facade'), false, 100).damage;
  check(normal < computeDamage(p, e, getMove('test-plain140'), false, 100).damage, 'healthy facade is 70 power');
  p.status = 'burn';
  eq(computeDamage(p, e, getMove('test-facade'), false, 100).damage, computeDamage({ ...p, status: null }, e, getMove('test-plain140'), false, 100).damage, 'burned facade = 140 power, no burn halving');
  p.status = null;
  const hexPlain = computeDamage(p, e, getMove('test-hex'), false, 100).damage;
  e.status = 'goop';
  eq(computeDamage(p, e, getMove('test-hex'), false, 100).damage, computeDamage(p, e, getMove('test-special130'), false, 100).damage, 'hex vs statused = 130 power');
  check(hexPlain < computeDamage(p, e, getMove('test-hex'), false, 100).damage, 'hex vs healthy is weaker');
});

test('effectiveStat: stages, zap, statMult', () => {
  coverAbility('statMult');
  const { p } = duo(30, ['FLUFF'], ['FLUFF'], (p) => { p.stats.spe = 100; p.stats.atk = 100; });
  eq(effectiveStat(p, 'spe'), 100, 'base');
  p.stages.spe = 2;
  eq(effectiveStat(p, 'spe'), 200, '+2');
  p.stages.spe = -1;
  eq(effectiveStat(p, 'spe'), 66, '-1 floors');
  p.stages.spe = 0; p.status = 'zap';
  eq(effectiveStat(p, 'spe'), 50, 'zap halves speed');
  p.ability = 'test-quickfeet';
  eq(effectiveStat(p, 'spe'), 150, 'quick-feet statMult while statused (and no zap halving)');
  p.status = null;
  eq(effectiveStat(p, 'spe'), 100, 'statused-only multiplier off when healthy');
  p.ability = 'test-hugepower';
  eq(effectiveStat(p, 'atk'), 200, 'always x2');
  p.ability = 'test-guts'; p.status = 'burn';
  eq(effectiveStat(p, 'atk'), 150, 'guts while statused');
});

test('damage abilities: pinch, typeBoost, contactBoost, technician, resist, filter, multiscale, guts', () => {
  const { p, e } = duo(30, ['FIRE'], ['FLUFF'], (_p, e) => bigHp(e));
  const flame = (): number => computeDamage(p, e, getMove('test-flame'), false, 100).damage;
  const base = flame();
  p.ability = 'test-pinch'; coverAbility('pinch');
  eq(flame(), base, 'pinch off at full HP');
  p.hp = Math.floor(p.stats.hp / 3);
  eq(flame(), Math.floor(base * 1.5), 'pinch at <= 1/3 HP');
  p.hp = p.stats.hp;
  p.ability = 'test-firepower'; coverAbility('typeBoost');
  eq(flame(), Math.floor(base * 1.5), 'typeBoost');
  p.ability = 'test-claws'; coverAbility('contactBoost');
  const tackle0 = computeDamage({ ...p, ability: 'test-plain' }, e, getMove('test-tackle'), false, 100).damage;
  eq(computeDamage(p, e, getMove('test-tackle'), false, 100).damage, Math.floor(tackle0 * 1.3), 'contactBoost on contact');
  const strike0 = computeDamage({ ...p, ability: 'test-plain' }, e, getMove('test-strike'), false, 100).damage;
  eq(computeDamage(p, e, getMove('test-strike'), false, 100).damage, strike0, 'no contactBoost without contact');
  p.ability = 'test-technician'; coverAbility('technician');
  eq(computeDamage(p, e, getMove('test-tackle'), false, 100).damage, Math.floor(tackle0 * 1.5), 'technician on 40 power');
  eq(computeDamage(p, e, getMove('test-strike'), false, 100).damage, strike0, 'technician skips 80 power');
  p.ability = 'test-plain';
  e.ability = 'test-thickfat'; coverAbility('resist');
  eq(flame(), Math.floor(base * 0.5), 'resist');
  e.ability = 'test-filter'; e.types = ['LEAF']; coverAbility('filter');
  const seNoFilter = computeDamage(p, { ...e, ability: 'test-plain' }, getMove('test-flame'), false, 100).damage;
  eq(computeDamage(p, e, getMove('test-flame'), false, 100).damage, Math.floor(seNoFilter * 0.75), 'filter on super-effective');
  e.types = ['FLUFF'];
  eq(flame(), base, 'filter off when neutral');
  e.ability = 'test-multiscale'; coverAbility('multiscale');
  eq(flame(), Math.floor(base / 2), 'multiscale at full HP');
  e.hp -= 1;
  eq(flame(), base, 'multiscale off below full');
  e.ability = 'test-plain';
  // Guts: x1.5 attack while statused and burn does not halve.
  p.ability = 'test-guts'; p.status = 'burn';
  const gutsBurned = computeDamage(p, e, getMove('test-strike'), false, 100).damage;
  eq(gutsBurned, computeDamage({ ...p, ability: 'test-plain', status: null, stats: { ...p.stats, atk: Math.floor(p.stats.atk * 1.5) } }, e, getMove('test-strike'), false, 100).damage, 'guts ignores the burn halving');
});

// ---------------------------------------------------------------------------------------------
// battle.ts: flow
// ---------------------------------------------------------------------------------------------

test('start of battle: send-outs, entry abilities, supercharge', () => {
  coverAbility('entry');
  const st = mk({ e: [{ ability: 'test-intimidate', startStages: { atk: 1, spa: 1 } }], noStart: true });
  const evs = startBattle(st);
  eq(evs.filter((e) => e.t === 'sendOut').map((e) => (e as { side: string }).side), ['enemy', 'player'], 'foe first, then player');
  check(has(evs, 'THE FOE SENT OUT TEST GOON!') && has(evs, 'GO! TESTBLOB!'), 'send-out lines');
  check(has(evs, "THE FOE'S TEST GOON IS SUPERCHARGED!"), 'supercharge line');
  eq(E(st).stages.atk, 1, 'start stages kept');
  eq(P(st).stages.atk, -1, 'intimidate-style entry lowers the foe');
  check(evs.some((e) => e.t === 'ability'), 'ability event');
  check(has(evs, "TESTBLOB'S ATTACK FELL!"), 'stage line');
  eq(P(st).participated && E(st).participated, true, 'participated set on send-out');
  const st2 = mk({ p: [{ ability: 'test-bulkup' }] });
  eq(P(st2).stages.def, 1, 'self entry');
  const st3 = mk({ e: [{ ability: 'test-pressure' }] });
  check(has(st3.log, 'IS PUTTING ON THE PRESSURE!'), 'pressure announced');
});

test('turn order: speed, priority, zap, ties, prankster', () => {
  const order = (st: BattleState, evs: BattleEvent[]): string[] => evs.filter((e) => e.t === 'useMove').map((e) => (e as { side: string }).side);
  let st = mk({ e: [{ moves: ['test-tackle'] }], setup: fast });
  eq(order(st, submitTurn(st, mvA())), ['player', 'enemy'], 'faster first');
  st = mk({ e: [{ moves: ['test-tackle'] }], setup: slow });
  eq(order(st, submitTurn(st, mvA())), ['enemy', 'player'], 'slower last');
  st = mk({ p: [{ moves: ['test-quick'] }], e: [{ moves: ['test-tackle'] }], setup: slow });
  eq(order(st, submitTurn(st, mvA())), ['player', 'enemy'], 'priority beats speed');
  // zap: 100 vs 60 becomes 50 vs 60.
  let zapOrder = 0;
  for (let seed = 1; seed <= 40; seed++) {
    st = mk({ seed, e: [{ moves: ['test-tackle'] }], setup: (s) => { s.player.team[0].stats.spe = 100; s.enemy.team[0].stats.spe = 60; s.player.team[0].status = 'zap'; } });
    const t = T(submitTurn(st, mvA()));
    const eIdx = t.findIndex((x) => x.startsWith("THE FOE'S TEST GOON USED"));
    const pIdx = t.findIndex((x) => x.startsWith('TESTBLOB USED') || x.includes("CAN'T MOVE"));
    if (eIdx >= 0 && pIdx >= 0 && eIdx < pIdx) zapOrder++;
  }
  eq(zapOrder, 40, 'zapped dragon moves after a foe it would otherwise outspeed');
  // ties: both orders happen, decided by the battle RNG.
  const seen = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    st = mk({ seed, e: [{ moves: ['test-tackle'] }], setup: (s) => { s.player.team[0].stats.spe = 77; s.enemy.team[0].stats.spe = 77; } });
    seen.add(order(st, submitTurn(st, mvA())).join(','));
  }
  eq(seen.size, 2, 'speed ties go both ways');
  coverAbility('prankster');
  st = mk({ p: [{ moves: ['test-buff'], ability: 'test-prankster' }], e: [{ moves: ['test-quick'] }], setup: slow });
  eq(order(st, submitTurn(st, mvA())), ['enemy', 'player'], 'prankster +1 against a +1 quick move: speed decides');
});

test('prankster status move beats a faster foe', () => {
  let st = mk({ p: [{ moves: ['test-buff'], ability: 'test-prankster' }], e: [{ moves: ['test-tackle'] }], setup: slow });
  let evs = submitTurn(st, mvA());
  eq(evs.filter((e) => e.t === 'useMove').map((e) => (e as { side: string }).side), ['player', 'enemy'], 'prankster first');
  st = mk({ p: [{ moves: ['test-buff'] }], e: [{ moves: ['test-tackle'] }], setup: slow });
  evs = submitTurn(st, mvA());
  eq(evs.filter((e) => e.t === 'useMove').map((e) => (e as { side: string }).side), ['enemy', 'player'], 'without prankster the foe is first');
});

test('player switch and item go before moves', () => {
  const st = mk({ p: [{}, {}], e: [{ moves: ['test-tackle'] }], setup: (s) => { s.player.team[0].stats.spe = 999; } });
  const evs = submitTurn(st, { kind: 'switch', index: 1 });
  const kinds = evs.map((e) => e.t);
  check(kinds.indexOf('withdraw') < kinds.indexOf('useMove'), 'withdraw before the foe moves');
  eq(dmgTo(evs, 'p1').length, 1, 'the incoming dragon takes the hit');
  eq(dmgTo(evs, 'p0').length, 0, 'the old one does not');
  check(has(evs, 'TESTBLOB, COME BACK!') && has(evs, 'GO! TESTBLOB!'), 'switch lines');
  eq(st.player.active, 1, 'active index');
});

test('moves resolve fully in order; a fainted combatant does not act', () => {
  const st = mk({ e: [{ moves: ['test-tackle'] }], setup: (s) => { fast(s); s.enemy.team[0].hp = 1; } });
  const evs = submitTurn(st, mvA());
  eq(evs.filter((e) => e.t === 'useMove').length, 1, 'only the player moved');
  check(has(evs, "THE FOE'S TEST GOON FAINTED!"), 'faint line with foe prefix');
  check(has(evs, 'TEST GOON: "NOT FAIR!"'), 'villain defeat line');
  eq(st.winner, 'player', 'winner');
  eq(st.phase, 'over', 'phase');
  eq(evs[evs.length - 1].t, 'end', 'end is last');
});

test('a caught boss says its caught line instead of its escape line', () => {
  const ko = (init: Partial<MonInit>): BattleEvent[] => {
    const st = mk({ e: [{ moves: ['test-tackle'], ...init }], setup: (s) => { fast(s); s.enemy.team[0].hp = 1; } });
    return submitTurn(st, mvA());
  };
  let evs = ko({ defId: 'test-boss', isBoss: true, caught: true });
  check(has(evs, 'THE FOE\'S TEST BOSS FAINTED!'), 'faint line');
  check(has(evs, 'TEST BOSS: "YOU GOT ME!"'), 'caught line');
  check(!has(evs, 'NOT FAIR!'), 'no escape line when caught');
  evs = ko({ defId: 'test-boss', isBoss: true });
  check(has(evs, 'TEST BOSS: "NOT FAIR!"') && !has(evs, 'YOU GOT ME!'), 'not caught: the usual defeat line');
  evs = ko({ defId: 'test-goon', caught: true });
  check(has(evs, 'TEST GOON: "NOT FAIR!"'), 'no caught line written: falls back to the defeat line');
  eq(buildMon(eInit({ caught: true }), 'enemy', 0).caught, true, 'buildMon keeps the caught flag');
  eq(buildMon(eInit(), 'enemy', 0).caught, undefined, 'and leaves it off otherwise');
});

// ---------------------------------------------------------------------------------------------
// battle.ts: every move effect
// ---------------------------------------------------------------------------------------------

test('inflict: status moves, damaging moves, type and ability immunities', () => {
  coverMove('inflict');
  let st = mk({ p: [{ moves: ['test-burn-status'] }], setup: fast });
  let evs = submitTurn(st, mvA());
  eq(E(st).status, 'burn', 'burned');
  check(has(evs, "THE FOE'S TEST GOON WAS BURNED!"), 'burn line');
  check(evs.some((e) => e.t === 'status' && e.status === 'burn'), 'status event');
  evs = submitTurn(st, mvA());
  check(has(evs, 'BUT IT FAILED!'), 'already statused -> fails');
  const immune: [StatusId, TypeId][] = [['burn', 'FIRE'], ['goop', 'SLIME'], ['goop', 'METAL'], ['zap', 'LIGHTNING'], ['frozen', 'FROST']];
  for (const [status, type] of immune) {
    st = mk({ p: [{ moves: [`test-${status}-status`] }], setup: (s) => { fast(s); s.enemy.team[0].types = [type]; } });
    evs = submitTurn(st, mvA());
    eq(E(st).status, null, `${type} immune to ${status}`);
    check(has(evs, "CAN'T BE"), `${type} immunity explained`);
    check(!segHas(evs, 'TESTBLOB', 'BUT IT FAILED!'), 'no double message');
  }
  st = mk({ p: [{ moves: ['test-snooze-status'] }], e: [{ ability: 'test-insomnia' }], setup: fast });
  evs = submitTurn(st, mvA());
  coverAbility('statusImmune');
  eq(E(st).status, null, 'statusImmune ability');
  check(has(evs, 'PROTECTED IT!'), 'ability line');
  st = mk({ p: [{ moves: ['test-ember-burn'] }], e: [{}], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
  submitTurn(st, mvA());
  eq(E(st).status, 'burn', 'damaging move with a 100% burn');
});

test('status ticks: burn 1/16, goop 1/8, minimum 1', () => {
  const st = mk({ setup: (s) => { s.enemy.team[0].status = 'burn'; s.player.team[0].status = 'goop'; } });
  const evs = submitTurn(st, { kind: 'move', slot: 0 });
  const eBurn = evs.find((e) => e.t === 'damage' && e.uid === 'e0' && e.source === 'status') as Extract<BattleEvent, { t: 'damage' }>;
  eq(eBurn?.amount, Math.floor(E(st).stats.hp / 16), 'burn 1/16');
  const pGoop = evs.find((e) => e.t === 'damage' && e.uid === 'p0' && e.source === 'status') as Extract<BattleEvent, { t: 'damage' }>;
  eq(pGoop?.amount, Math.floor(P(st).stats.hp / 8), 'goop 1/8');
  check(has(evs, 'IS HURT BY ITS BURN!') && has(evs, 'IS HURT BY THE GOOP!'), 'tick lines');
  const st2 = mk({ p: [{ moves: ['test-wait'] }], setup: (s) => { const e = s.enemy.team[0]; e.stats.hp = 10; e.hp = 10; e.status = 'burn'; } });
  const evs2 = submitTurn(st2, mvA());
  eq(dmgTo(evs2, 'e0').filter((d) => d.source === 'status')[0]?.amount, 1, 'minimum 1');
});

test('snooze: 1-3 skipped turns, then wakes and acts', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const st = mk({ seed, p: [{ moves: ['test-snooze-status', 'test-wait'] }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
    const evs: BattleEvent[] = [...submitTurn(st, mvA(0))];
    // It fell asleep before its own action, so this turn already counted as one asleep turn.
    const turns = E(st).statusTurns + 1;
    within(turns, 1, 3, 'sleep length');
    for (let i = 0; i < 4; i++) evs.push(...submitTurn(st, mvA(1)));
    eq(count(evs, "THE FOE'S TEST GOON IS FAST ASLEEP."), turns, 'skips 1-3 turns');
    check(count(evs, "THE FOE'S TEST GOON WOKE UP!") === 1, 'wakes once');
    check(has(evs, "THE FOE'S TEST GOON USED T WAIT!"), 'acts after waking');
    eq(E(st).status, null, 'status cleared');
  }
});

test('frozen: cannot act, 20% thaw, fire hits and thaw moves melt it', () => {
  coverMove('thaw');
  let thawed = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const st = mk({ seed, e: [{}], setup: (s) => { s.enemy.team[0].status = 'frozen'; } });
    const evs = submitTurn(st, { kind: 'move', slot: 0 });
    if (has(evs, "THE FOE'S TEST GOON THAWED OUT!")) thawed++;
    else check(has(evs, 'IS FROZEN SOLID!'), 'frozen line');
  }
  within(thawed, 35, 90, '20% thaw chance');
  let st = mk({ p: [{ moves: ['test-flame'] }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); s.enemy.team[0].status = 'frozen'; s.enemy.team[0].types = ['FLUFF']; } });
  let evs = submitTurn(st, mvA());
  eq(E(st).status, null, 'FIRE hit thaws');
  check(has(evs, 'THAWED OUT!'), 'thaw line');
  st = mk({ e: [{ moves: ['test-thaw'] }], setup: (s) => { s.enemy.team[0].status = 'frozen'; bigHp(s.player.team[0]); } });
  evs = submitTurn(st, mvA());
  check(has(evs, "THE FOE'S TEST GOON THAWED OUT!") && has(evs, "THE FOE'S TEST GOON USED T THAW!"), 'thaw move works while frozen');
});

test('zap: 25% full paralysis', () => {
  let stuck = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const st = mk({ seed, setup: (s) => { s.player.team[0].status = 'zap'; bigHp(s.enemy.team[0]); } });
    if (has(submitTurn(st, mvA()), "TESTBLOB IS ZAPPED! IT CAN'T MOVE!")) stuck++;
  }
  within(stuck, 70, 135, '25% of 400');
});

test('confuse: 2-5 confused turns, self-hits, snaps out', () => {
  coverMove('confuse');
  let selfHits = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const st = mk({ seed, p: [{ moves: ['test-confuse', 'test-wait'] }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
    const evs: BattleEvent[] = [...submitTurn(st, mvA(0))];
    check(has(evs, "THE FOE'S TEST GOON BECAME CONFUSED!"), 'confused line');
    check(evs.some((e) => e.t === 'confuse' && e.on), 'confuse event');
    const n = E(st).volatile.confused + 1; // it already spent one confused turn this turn
    within(n, 2, 5, 'confusion length');
    for (let i = 0; i < 6; i++) evs.push(...submitTurn(st, mvA(1)));
    eq(count(evs, "THE FOE'S TEST GOON IS CONFUSED!"), n, 'confused for exactly its turns');
    eq(count(evs, 'SNAPPED OUT OF ITS CONFUSION!'), 1, 'snaps out once');
    check(evs.some((e) => e.t === 'confuse' && !e.on), 'confuse off event');
    selfHits += dmgTo(evs, 'e0').filter((d) => d.source === 'confusion').length;
    const st2 = mk({ seed, p: [{ moves: ['test-confuse'] }], e: [{ ability: 'test-innerfocus' }], setup: fast });
    const evs2 = submitTurn(st2, mvA());
    eq(E(st2).volatile.confused, 0, 'innerFocus blocks confusion');
    check(has(evs2, 'KEPT IT FOCUSED!') && !segHas(evs2, 'TESTBLOB', 'BUT IT FAILED!'), 'innerFocus line');
  }
  check(selfHits > 10, `self-hits happen (${selfHits})`);
});

test('flinch: only when the target has not acted yet; innerFocus; sereneGrace', () => {
  coverMove('flinch'); coverAbility('innerFocus'); coverAbility('sereneGrace');
  let st = mk({ p: [{ moves: ['test-flinch'] }], e: [{ moves: ['test-tackle'] }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
  let evs = submitTurn(st, mvA());
  check(has(evs, "THE FOE'S TEST GOON FLINCHED!"), 'flinched');
  eq(evs.filter((e) => e.t === 'useMove').length, 1, 'foe lost its action');
  eq(E(st).volatile.flinch, false, 'flinch reset at turn end');
  st = mk({ p: [{ moves: ['test-flinch'] }], e: [{ moves: ['test-tackle'] }], setup: (s) => { slow(s); bigHp(s.enemy.team[0]); } });
  evs = submitTurn(st, mvA());
  check(!has(evs, 'FLINCHED'), 'no flinch when the foe already moved');
  st = mk({ p: [{ moves: ['test-flinch'] }], e: [{ moves: ['test-tackle'], ability: 'test-innerfocus' }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
  evs = submitTurn(st, mvA());
  check(!has(evs, 'FLINCHED') && has(evs, 'KEPT IT FOCUSED!'), 'innerFocus');
  const rate = (ability: string): number => {
    let n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const s2 = mk({ seed, p: [{ moves: ['test-flinch30'], ability }], e: [{ moves: ['test-tackle'] }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); bigHp(s.player.team[0]); } });
      if (has(submitTurn(s2, mvA()), 'FLINCHED')) n++;
    }
    return n;
  };
  within(rate('test-plain'), 85, 155, '30% flinch');
  within(rate('test-serene'), 200, 280, 'sereneGrace doubles it to 60%');
});

test('stages: self and foe, caps, clearBody', () => {
  coverMove('stages'); coverAbility('clearBody');
  let st = mk({ p: [{ moves: ['test-buff', 'test-debuff'] }], setup: fast });
  let evs = submitTurn(st, mvA(0));
  eq(P(st).stages.atk, 2, '+2');
  check(has(evs, "TESTBLOB'S ATTACK ROSE SHARPLY!"), 'rose sharply');
  check(evs.some((e) => e.t === 'stages' && e.uid === 'p0' && e.changes.atk === 2), 'stages event');
  submitTurn(st, mvA(0)); submitTurn(st, mvA(0));
  eq(P(st).stages.atk, 6, 'capped at +6');
  evs = submitTurn(st, mvA(0));
  check(has(evs, "WON'T GO ANY HIGHER!") && !segHas(evs, 'TESTBLOB', 'BUT IT FAILED!'), 'cap line');
  check(!evs.some((e) => e.t === 'stages'), 'no stages event when nothing changed');
  evs = submitTurn(st, mvA(1));
  eq(E(st).stages.atk, -1, 'foe -1');
  check(has(evs, "THE FOE'S TEST GOON'S ATTACK FELL!"), 'fell line');
  st = mk({ p: [{ moves: ['test-debuff'] }], e: [{ ability: 'test-clearbody' }], setup: fast });
  evs = submitTurn(st, mvA());
  eq(E(st).stages.atk, 0, 'clearBody blocks drops');
  check(has(evs, 'PREVENTS STAT DROPS!') && !segHas(evs, 'TESTBLOB', 'BUT IT FAILED!'), 'clearBody line');
});

test('heal, drain, recoil, rockHead', () => {
  coverMove('heal'); coverMove('drain'); coverMove('recoil'); coverAbility('rockHead');
  let st = mk({ p: [{ moves: ['test-heal'] }], setup: (s) => { s.player.team[0].hp = 10; } });
  let evs = submitTurn(st, mvA());
  const healEv = evs.find((e) => e.t === 'heal' && e.uid === 'p0') as Extract<BattleEvent, { t: 'heal' }>;
  eq(healEv?.amount, Math.floor(P(st).stats.hp / 2), 'heals half');
  st = mk({ p: [{ moves: ['test-heal'] }] });
  evs = submitTurn(st, mvA());
  check(has(evs, 'HP IS ALREADY FULL!'), 'full HP');
  st = mk({ p: [{ moves: ['test-drain'] }], setup: (s) => { fast(s); s.player.team[0].hp = 1; bigHp(s.enemy.team[0]); } });
  evs = submitTurn(st, mvA());
  const dealt = dmgTo(evs, 'e0')[0].amount;
  const drained = evs.find((e) => e.t === 'heal' && e.uid === 'p0') as Extract<BattleEvent, { t: 'heal' }>;
  eq(drained?.amount, Math.max(1, Math.floor(dealt / 2)), 'drains half the damage');
  check(has(evs, 'HAD ITS ENERGY DRAINED!'), 'drain line');
  st = mk({ p: [{ moves: ['test-recoil'] }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
  evs = submitTurn(st, mvA());
  const hit = dmgTo(evs, 'e0')[0].amount;
  eq(dmgTo(evs, 'p0').find((d) => d.source === 'recoil')?.amount, Math.max(1, Math.floor(hit / 3)), 'recoil 1/3 of damage');
  st = mk({ p: [{ moves: ['test-recoil'], ability: 'test-rockhead' }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
  evs = submitTurn(st, mvA());
  eq(dmgTo(evs, 'p0').length, 0, 'rockHead: no recoil');
});

test('multiHit: 2-5 split, separate hits and crits, fixed counts', () => {
  coverMove('multiHit');
  const counts = [0, 0, 0, 0, 0, 0];
  let mixedCrits = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const st = mk({ seed, p: [{ moves: ['test-multi'], ability: 'test-superluck', happiness: 100 }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
    const evs = submitTurn(st, mvA());
    const hits = dmgTo(evs, 'e0').filter((d) => d.source === 'move');
    counts[hits.length]++;
    check(has(evs, `IT HIT ${hits.length} TIMES!`), 'hit count line');
    const crits = new Set(hits.map((h) => h.crit));
    if (crits.size === 2) mixedCrits++;
  }
  within(counts[2], 170, 250, '2 hits ~35%');
  within(counts[3], 170, 250, '3 hits ~35%');
  within(counts[4], 60, 125, '4 hits ~15%');
  within(counts[5], 60, 125, '5 hits ~15%');
  eq(counts[0] + counts[1], 0, 'never fewer than 2');
  check(mixedCrits > 100, 'each hit rolls its own crit');
  const st = mk({ p: [{ moves: ['test-multi3'] }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
  eq(dmgTo(submitTurn(st, mvA()), 'e0').length, 3, 'fixed 3 hits');
  const st2 = mk({ p: [{ moves: ['test-multi'] }], setup: (s) => { fast(s); s.enemy.team[0].hp = 1; } });
  eq(dmgTo(submitTurn(st2, mvA()), 'e0').length, 1, 'stops when the target faints');
});

test('protect: blocks, chains at 1/3, resets', () => {
  coverMove('protect');
  let st = mk({ p: [{ moves: ['test-protect', 'test-tackle'] }], e: [{ moves: ['test-tackle'] }], setup: slow });
  let evs = submitTurn(st, mvA(0));
  eq(dmgTo(evs, 'p0').length, 0, 'blocked');
  check(count(evs, 'TESTBLOB PROTECTED ITSELF!') === 2, 'protect on use and on block');
  check(evs.filter((e) => e.t === 'protect').length === 2, 'protect events');
  eq(P(st).volatile.protecting, false, 'protecting expires at turn end');
  eq(P(st).volatile.protectChain, 1, 'chain kept');
  submitTurn(st, mvA(1));
  eq(P(st).volatile.protectChain, 0, 'another move resets the chain');
  let second = 0;
  for (let seed = 1; seed <= 600; seed++) {
    st = mk({ seed, p: [{ moves: ['test-protect'] }], e: [{ moves: ['test-tackle'] }], setup: (s) => { slow(s); bigHp(s.player.team[0]); } });
    submitTurn(st, mvA());
    evs = submitTurn(st, mvA());
    if (dmgTo(evs, 'p0').length === 0) second++;
  }
  within(second, 150, 250, 'second protect in a row ~1/3');
});

test('trap: STUCK until the trapper leaves', () => {
  coverMove('trap');
  const st = mk({ p: [{ moves: ['test-tackle'] }, {}], e: [{ moves: ['test-trap'] }, {}], setup: (s) => { slow(s); s.enemy.team[0].hp = 1; } });
  let evs = submitTurn(st, mvA());
  check(has(evs, "TESTBLOB CAN'T ESCAPE NOW!"), 'trap line');
  // The trapper fainted right after (the player's tackle), which frees the player.
  eq(P(st).volatile.stuck, false, 'freed when the trapper faints');
  const vol = evs.filter((e) => e.t === 'volatile' && e.uid === 'p0') as Extract<BattleEvent, { t: 'volatile' }>[];
  eq(vol.map((e) => e.stuck), [true, false], 'volatile events: stuck, then released');
  const faintAt = evs.findIndex((e) => e.t === 'faint' && e.uid === 'e0');
  check(faintAt >= 0 && evs.indexOf(vol[1]) > faintAt, 'released after the trapper faints');
  const st2 = mk({ p: [{ moves: ['test-wait'] }, {}], e: [{ moves: ['test-trap'] }, {}], setup: slow });
  evs = submitTurn(st2, mvA());
  eq(P(st2).volatile.stuck, true, 'stuck');
  eq(P(st2).volatile.stuckBy, 'e0', 'stuckBy');
  eq(legal(st2).switches, [false, false], 'no switching while stuck');
  throws(() => submitTurn(st2, { kind: 'switch', index: 1 }), 'switch while stuck');
  eq(legal(st2).retreat, true, 'retreat still allowed');
});

test('cure self and team', () => {
  coverMove('cure');
  let st = mk({ p: [{ moves: ['test-cure-self'] }], setup: (s) => { s.player.team[0].status = 'goop'; } });
  let evs = submitTurn(st, mvA());
  eq(P(st).status, null, 'self cured');
  check(evs.some((e) => e.t === 'status' && e.uid === 'p0' && e.status === null), 'status event');
  st = mk({ p: [{ moves: ['test-cure-team'] }, {}, {}], setup: (s) => { s.player.team[0].status = 'burn'; s.player.team[1].status = 'zap'; } });
  evs = submitTurn(st, mvA());
  eq(st.player.team.map((m) => m.status), [null, null, null], 'team cured');
  check(has(evs, 'A SOOTHING CALM WASHED OVER THE TEAM!'), 'team line');
  st = mk({ p: [{ moves: ['test-cure-self'] }] });
  check(has(submitTurn(st, mvA()), 'BUT IT FAILED!'), 'nothing to cure');
});

test('fixed damage and type immunity', () => {
  coverMove('fixed');
  let st = mk({ p: [{ moves: ['test-fixed-level'], level: 37 }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
  let evs = submitTurn(st, mvA());
  eq(dmgTo(evs, 'e0')[0]?.amount, 37, 'level damage');
  st = mk({ p: [{ moves: ['test-fixed-20'] }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
  eq(dmgTo(submitTurn(st, mvA()), 'e0')[0]?.amount, 20, 'flat damage ignores the chart (MIND vs FLUFF is x0.5)');
  st = mk({ p: [{ moves: ['test-fixed-20'] }], setup: (s) => { fast(s); s.enemy.team[0].types = ['DARKNESS']; } });
  evs = submitTurn(st, mvA());
  eq(dmgTo(evs, 'e0').length, 0, 'immune');
  check(has(evs, 'IT HAD NO EFFECT!'), 'no effect line');
});

test('effectiveness messages', () => {
  let st = mk({ p: [{ moves: ['test-flame'] }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); s.enemy.team[0].types = ['LEAF']; } });
  let evs = submitTurn(st, mvA());
  check(has(evs, "IT'S SUPER EFFECTIVE!"), 'super');
  eq(dmgTo(evs, 'e0')[0].effectiveness, 2, 'event effectiveness');
  st = mk({ p: [{ moves: ['test-flame'] }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); s.enemy.team[0].types = ['WATER', 'ROCK']; } });
  evs = submitTurn(st, mvA());
  check(has(evs, "IT'S NOT VERY EFFECTIVE..."), 'not very');
  eq(dmgTo(evs, 'e0')[0].effectiveness, 0.25, 'x0.25');
  st = mk({ p: [{ moves: ['test-spark'] }], setup: (s) => { fast(s); s.enemy.team[0].types = ['EARTH']; } });
  evs = submitTurn(st, mvA());
  check(has(evs, 'IT HAD NO EFFECT!') && dmgTo(evs, 'e0').length === 0, 'no effect');
});

test('resetStages', () => {
  coverMove('resetStages');
  let st = mk({ p: [{ moves: ['test-reset'] }], setup: (s) => { fast(s); s.player.team[0].stages.atk = 2; s.enemy.team[0].stages.def = -1; } });
  const evs = submitTurn(st, mvA());
  eq([P(st).stages.atk, E(st).stages.def], [0, 0], 'both reset');
  check(evs.filter((e) => e.t === 'stages').length === 2 && has(evs, 'ALL STAT CHANGES WERE WIPED AWAY!'), 'events and line');
  st = mk({ p: [{ moves: ['test-reset'] }] });
  check(has(submitTurn(st, mvA()), 'BUT IT FAILED!'), 'nothing to reset');
});

test('seed: 1/8 drain to the opposing active; LEAF is immune', () => {
  coverMove('seed');
  let st = mk({ p: [{ moves: ['test-seed'] }], setup: (s) => { fast(s); s.player.team[0].hp = 10; } });
  const evs = submitTurn(st, mvA());
  eq(E(st).volatile.seeded, true, 'seeded');
  check(evs.some((e) => e.t === 'volatile' && e.uid === 'e0' && e.seeded && !e.stuck), 'volatile event for SEEDED');
  const sap = dmgTo(evs, 'e0').find((d) => d.source === 'seed');
  eq(sap?.amount, Math.floor(E(st).stats.hp / 8), '1/8');
  const gain = evs.find((e) => e.t === 'heal' && e.uid === 'p0') as Extract<BattleEvent, { t: 'heal' }>;
  eq(gain?.amount, sap?.amount, 'the seeder heals the same');
  st = mk({ p: [{ moves: ['test-seed'] }], setup: (s) => { fast(s); s.enemy.team[0].types = ['LEAF']; } });
  const evs2 = submitTurn(st, mvA());
  eq(E(st).volatile.seeded, false, 'LEAF immune');
  check(has(evs2, "IS A LEAF TYPE, SO THE SEEDS WON'T STICK!"), 'LEAF line');
});

test('pivot: player chooses after the turn; enemy swaps at once', () => {
  coverMove('pivot');
  const st = mk({ p: [{ moves: ['test-pivot'] }, {}], e: [{ moves: ['test-tackle'] }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
  let evs = submitTurn(st, mvA());
  eq(st.phase, 'switch', 'phase switch after a pivot');
  check(legal(st).mustSwitch && legal(st).switches[1] && !legal(st).switches[0], 'legal in switch phase');
  eq(dmgTo(evs, 'p0').length, 1, 'the pivoting dragon still takes this turn\'s hit');
  throws(() => submitTurn(st, mvA()), 'submitTurn during switch phase');
  evs = submitSwitch(st, 1);
  check(evs.some((e) => e.t === 'withdraw' && e.uid === 'p0') && evs.some((e) => e.t === 'sendOut' && e.uid === 'p1'), 'swap events');
  eq(st.phase, 'choose', 'back to choose');
  check(st.player.team[0].hp > 0, 'pivoted dragon is fine');
  const st2 = mk({ p: [{ moves: ['test-tackle'] }], e: [{ moves: ['test-pivot'] }, {}], setup: (s) => { slow(s); bigHp(s.enemy.team[1]); } });
  evs = submitTurn(st2, mvA());
  eq(st2.enemy.active, 1, 'enemy swapped immediately');
  eq(dmgTo(evs, 'e1').length, 1, 'the player\'s move hits the newcomer');
  eq(st2.phase, 'choose', 'player keeps choosing');
  const st3 = mk({ p: [{ moves: ['test-pivot'] }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
  submitTurn(st3, mvA());
  eq(st3.phase, 'choose', 'no teammate: no pivot');
});

test('pivot knockout: the foe\'s replacement waits for the dragon that really comes in', () => {
  // The pivot knocks the foe out; its replacement has an entry ability (ATTACK down on the foe).
  // The pivoting dragon is leaving, so the drop must land on the dragon that replaces it, and the
  // AI must not pick its replacement against the leaving dragon (send order, as after a double KO).
  const setup = (s: BattleState): void => {
    fast(s);
    s.enemy.team[0].hp = 1;
    s.player.team[0].types = ['FIRE'];
    s.enemy.team[1].types = ['LEAF'];
    s.enemy.team[2].types = ['WATER'];
  };
  let st = mk({ ai: 'elite', p: [{ moves: ['test-pivot'] }, {}], e: [{}, { ability: 'test-intimidate' }, {}], setup });
  let evs = submitTurn(st, mvA());
  eq(st.phase, 'switch', 'the pivot still tags out');
  eq(st.enemy.active, 1, 'replacement by send order, not by its matchup vs the leaving FIRE dragon');
  check(!evs.some((e) => e.t === 'ability'), 'no entry ability on the leaving dragon');
  eq(st.player.team[0].stages.atk, 0, 'the leaving dragon keeps its ATTACK');
  eq(st.pendingEntry, st.enemy.team[1].uid, 'entry ability waits');
  evs = submitSwitch(st, 1);
  check(evs.some((e) => e.t === 'ability' && e.uid === st.enemy.team[1].uid), 'entry ability fires after the swap');
  eq(P(st).uid, 'p1', 'the replacement is in');
  eq(P(st).stages.atk, -1, 'the replacement gets the ATTACK drop');
  eq(st.pendingEntry ?? null, null, 'nothing waits any more');
  // Without a pivot the AI still picks by matchup (WATER vs the FIRE dragon that stays).
  st = mk({ ai: 'elite', p: [{ moves: ['test-tackle'] }, {}], e: [{}, {}, { ability: 'test-intimidate' }], setup });
  evs = submitTurn(st, mvA());
  eq(st.enemy.active, 2, 'plain knockout: best matchup');
  eq(st.phase, 'choose', 'plain knockout: no switch');
  eq(P(st).stages.atk, -1, 'plain knockout: entry fires at once');
  check(!st.pendingEntry, 'plain knockout: nothing waits');
  // The foe falls to its burn at the end of a turn in which the player pivoted: same rule.
  st = mk({
    p: [{ moves: ['test-pivot'] }, {}], e: [{ moves: ['test-wait'] }, { ability: 'test-intimidate' }],
    setup: (s) => { fast(s); bigHp(s.enemy.team[0]); s.enemy.team[0].hp = 600; s.enemy.team[0].status = 'burn'; },
  });
  evs = submitTurn(st, mvA());
  check(has(evs, 'IS HURT BY ITS BURN!'), 'burn at the end of the turn');
  eq(st.enemy.active, 1, 'replaced after the burn');
  eq(st.phase, 'switch', 'still tags out');
  eq(st.player.team[0].stages.atk, 0, 'end-of-turn KO: the leaving dragon is untouched');
  submitSwitch(st, 1);
  eq(P(st).stages.atk, -1, 'end-of-turn KO: the replacement gets the drop');
});

test('accuracy, evasion and sureHit', () => {
  coverMove('sureHit');
  const rate = (id: string, setup: (s: BattleState) => void): number => {
    let hits = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const st = mk({ seed, p: [{ moves: [id] }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); setup(s); } });
      if (dmgTo(submitTurn(st, mvA()), 'e0').some((d) => d.source === 'move')) hits++;
    }
    return hits;
  };
  within(rate('test-tackle', (s) => { s.enemy.team[0].stages.eva = 6; }), 160, 240, '100% move vs +6 evasion ~1/3');
  eq(rate('test-tackle', (s) => { s.enemy.team[0].stages.eva = 6; s.player.team[0].stages.acc = 6; }), 600, 'accuracy cancels evasion');
  within(rate('test-inaccurate', () => {}), 250, 350, '50% move');
  eq(rate('test-surehit', (s) => { s.enemy.team[0].stages.eva = 6; s.player.team[0].stages.acc = -6; }), 600, 'sureHit never misses');
  const st = mk({ p: [{ moves: ['test-inaccurate'] }], seed: 3, setup: fast });
  let missed = false;
  for (let i = 0; i < 20 && !missed; i++) {
    const evs = submitTurn(st, mvA());
    if (evs.some((e) => e.t === 'miss')) {
      missed = true;
      check(has(evs, "TESTBLOB'S ATTACK MISSED!"), 'miss line');
      check(evs.some((e) => e.t === 'miss' && e.uid === 'e0'), 'miss event names the target');
    }
  }
  check(missed, 'a miss happened');
});

test('rest: full heal, cured, asleep exactly 2 turns', () => {
  coverMove('rest');
  const st = mk({ p: [{ moves: ['test-rest'] }], setup: (s) => { s.player.team[0].hp = 1; s.player.team[0].status = 'burn'; } });
  const evs: BattleEvent[] = [...submitTurn(st, mvA())];
  eq(P(st).hp, P(st).stats.hp, 'full HP');
  eq(P(st).status, 'snooze', 'asleep');
  eq(P(st).statusTurns, 2, 'two turns');
  evs.push(...submitTurn(st, mvA()), ...submitTurn(st, mvA()), ...submitTurn(st, mvA()));
  eq(count(evs, 'TESTBLOB IS FAST ASLEEP.'), 2, 'sleeps 2 turns');
  check(has(evs, 'TESTBLOB WOKE UP!'), 'wakes on the third');
  const st2 = mk({ p: [{ moves: ['test-rest'], ability: 'test-insomnia' }], setup: (s) => { s.player.team[0].hp = 1; } });
  check(has(submitTurn(st2, mvA()), 'KEEPS IT WIDE AWAKE!'), 'insomnia blocks rest');
});

test('firstTurn: works on the first turn in, fails later', () => {
  coverMove('firstTurn');
  const st = mk({ p: [{ moves: ['test-firstturn'] }, { moves: ['test-firstturn'] }], e: [{ moves: ['test-tackle'] }], setup: (s) => { slow(s); bigHp(s.enemy.team[0]); bigHp(s.player.team[0]); } });
  let evs = submitTurn(st, mvA());
  check(has(evs, 'FLINCHED!'), 'first turn flinches');
  evs = submitTurn(st, mvA());
  check(has(evs, 'BUT IT FAILED!'), 'second turn fails');
  submitTurn(st, { kind: 'switch', index: 1 });
  evs = submitTurn(st, mvA());
  check(has(evs, 'FLINCHED!'), 'works again on the newcomer\'s first turn');
});

// ---------------------------------------------------------------------------------------------
// battle.ts: abilities in play
// ---------------------------------------------------------------------------------------------

test('pinch flares up in battle', () => {
  const st = mk({ p: [{ moves: ['test-flame'], ability: 'test-pinch' }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); s.player.team[0].hp = 5; } });
  const evs = submitTurn(st, mvA());
  check(has(evs, "TESTBLOB'S T PINCH FLARED UP!") && evs.some((e) => e.t === 'ability'), 'flare line and event');
});

test('contactStatus and contactStages', () => {
  coverAbility('contactStatus'); coverAbility('contactStages');
  let st = mk({ e: [{ ability: 'test-static' }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
  let evs = submitTurn(st, mvA());
  eq(P(st).status, 'burn', 'contact burns the attacker');
  check(has(evs, 'STRUCK BACK!'), 'ability line');
  st = mk({ p: [{ moves: ['test-strike'] }], e: [{ ability: 'test-static' }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
  submitTurn(st, mvA());
  eq(P(st).status, null, 'no contact, no burn');
  st = mk({ e: [{ ability: 'test-gooey' }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
  submitTurn(st, mvA());
  eq(P(st).stages.spe, -1, 'contact lowers attacker speed');
});

test('absorb: heal and boost instead of damage', () => {
  coverAbility('absorb');
  let st = mk({ p: [{ moves: ['test-water'] }], e: [{ ability: 'test-sponge' }], setup: (s) => { fast(s); s.enemy.team[0].hp = 10; } });
  let evs = submitTurn(st, mvA());
  eq(dmgTo(evs, 'e0').length, 0, 'no damage');
  const h = evs.find((e) => e.t === 'heal' && e.uid === 'e0') as Extract<BattleEvent, { t: 'heal' }>;
  eq(h?.amount, Math.floor(E(st).stats.hp / 4), 'heals 1/4');
  check(has(evs, 'SOAKED UP THE ATTACK!'), 'line');
  st = mk({ p: [{ moves: ['test-water'] }], e: [{ ability: 'test-sponge' }], setup: fast });
  check(has(submitTurn(st, mvA()), 'MADE IT IMMUNE!'), 'full HP: immune line');
  st = mk({ p: [{ moves: ['test-spark'] }], e: [{ ability: 'test-motor' }], setup: fast });
  evs = submitTurn(st, mvA());
  eq(E(st).stages.spe, 1, 'boost');
  eq(dmgTo(evs, 'e0').length, 0, 'no damage');
});

test('resist and multiscale messages in battle', () => {
  let st = mk({ p: [{ moves: ['test-flame'] }], e: [{ ability: 'test-thickfat' }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); } });
  check(has(submitTurn(st, mvA()), 'SOFTENED THE BLOW!'), 'resist line');
  st = mk({ e: [{ ability: 'test-multiscale' }], setup: fast });
  check(has(submitTurn(st, mvA()), 'SOFTENED THE BLOW!'), 'multiscale line');
});

test('sturdy and the happy-dragon endure', () => {
  coverAbility('sturdy');
  const st = mk({ p: [{ moves: ['test-plain140'] }], e: [{ ability: 'test-sturdy' }], setup: (s) => { fast(s); s.player.team[0].stats.atk = 999; s.enemy.team[0].stats.def = 1; } });
  let evs = submitTurn(st, mvA());
  eq(E(st).hp, 1, 'left at 1 HP');
  check(has(evs, 'HUNG ON THANKS TO ITS T STURDY!'), 'sturdy line');
  evs = submitTurn(st, mvA());
  eq(E(st).hp, 0, 'not at full HP: knocked out');
  let endured = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const s2 = mk({ seed, p: [{ happiness: 100 }], e: [{ moves: ['test-plain140'] }], setup: (s) => { slow(s); s.enemy.team[0].stats.atk = 999; s.player.team[0].stats.def = 1; } });
    const e2 = submitTurn(s2, mvA());
    if (has(e2, "TESTBLOB TOUGHED IT OUT SO YOU WOULDN'T WORRY!")) {
      endured++;
      eq(P(s2).hp, 1, 'endure leaves 1 HP');
    }
  }
  within(endured, 22, 62, 'endure ~10%');
});

test('happiness: loafing at 20 or less', () => {
  let loafed = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const st = mk({ seed, p: [{ happiness: 10 }], setup: (s) => bigHp(s.enemy.team[0]) });
    if (!has(submitTurn(st, mvA()), 'TESTBLOB USED')) loafed++;
  }
  within(loafed, 35, 95, 'loafs ~15%');
  const st = mk({ p: [{ happiness: 21 }], setup: (s) => bigHp(s.enemy.team[0]) });
  let all = true;
  for (let i = 0; i < 40; i++) if (!has(submitTurn(st, mvA()), 'TESTBLOB USED')) all = false;
  check(all, 'happiness 21 never loafs');
});

test('regenTurn, speedBoost, shedSkin at turn end', () => {
  coverAbility('regenTurn'); coverAbility('speedBoost'); coverAbility('shedSkin');
  let st = mk({ p: [{ moves: ['test-wait'] }], e: [{ ability: 'test-regen' }], setup: (s) => { s.enemy.team[0].hp = 5; } });
  let evs = submitTurn(st, mvA());
  check(evs.some((e) => e.t === 'heal' && e.uid === 'e0' && e.amount === Math.floor(E(st).stats.hp / 8)), 'regen 1/8');
  st = mk({ e: [{ ability: 'test-speedboost' }] });
  submitTurn(st, mvA()); submitTurn(st, mvA());
  eq(E(st).stages.spe, 2, '+1 per turn');
  st = mk({ e: [{ ability: 'test-shedskin' }], setup: (s) => { s.enemy.team[0].status = 'goop'; } });
  evs = submitTurn(st, mvA());
  eq(E(st).status, null, 'shed');
  const kinds = evs.map((e) => (e.t === 'damage' ? `d:${e.source}` : e.t));
  check(kinds.indexOf('d:status') < kinds.lastIndexOf('status'), 'status damage ticks before the shed');
});

test('moxie, pressure, switchHeal, switchCure', () => {
  coverAbility('moxie'); coverAbility('pressure'); coverAbility('switchHeal'); coverAbility('switchCure');
  let st = mk({ p: [{ ability: 'test-moxie' }], e: [{}, {}], setup: (s) => { fast(s); s.enemy.team[0].hp = 1; } });
  submitTurn(st, mvA());
  eq(P(st).stages.atk, 1, 'moxie after a KO');
  st = mk({ e: [{ ability: 'test-pressure' }] });
  submitTurn(st, mvA());
  eq(P(st).moves[0].pp, P(st).moves[0].maxPp - 2, 'pressure: 2 PP');
  st = mk({ p: [{ ability: 'test-regenerator' }, {}], setup: (s) => { s.player.team[0].hp = 10; } });
  submitTurn(st, { kind: 'switch', index: 1 });
  eq(st.player.team[0].hp, 10 + Math.floor(st.player.team[0].stats.hp / 3), 'heals 1/3 on the way out');
  st = mk({ p: [{ ability: 'test-naturalcure' }, {}], setup: (s) => { s.player.team[0].status = 'goop'; } });
  const evs = submitTurn(st, { kind: 'switch', index: 1 });
  eq(st.player.team[0].status, null, 'cured on the way out');
  check(has(evs, 'SHOOK OFF ITS GOOP!'), 'line');
  eq(st.player.team[0].stages, { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 }, 'stages reset on switch-out');
});

// ---------------------------------------------------------------------------------------------
// battle.ts: fainting, switching, XP
// ---------------------------------------------------------------------------------------------

test('forced switch after a faint', () => {
  const st = mk({ p: [{}, {}], e: [{ moves: ['test-tackle'] }], setup: (s) => { slow(s); s.player.team[0].hp = 1; } });
  const evs = submitTurn(st, mvA());
  check(has(evs, 'TESTBLOB FAINTED!'), 'faint line');
  eq(st.phase, 'switch', 'switch phase');
  eq(legal(st).mustSwitch, true, 'mustSwitch');
  eq(legal(st).switches, [false, true], 'only the healthy one');
  throws(() => submitTurn(st, mvA()), 'no turn while switching');
  throws(() => submitSwitch(st, 0), 'cannot send out the fainted one');
  const evs2 = submitSwitch(st, 1);
  check(evs2.some((e) => e.t === 'sendOut' && e.uid === 'p1') && !evs2.some((e) => e.t === 'withdraw'), 'sends out without a withdraw');
  eq(st.phase, 'choose', 'choose again');
});

test('enemy replacement and the end', () => {
  const st = mk({ e: [{}, {}], setup: (s) => { fast(s); s.enemy.team[0].hp = 1; } });
  const evs = submitTurn(st, mvA());
  check(has(evs, 'THE FOE SENT OUT TEST GOON!'), 'replacement line');
  eq(st.enemy.active, 1, 'next enemy');
  eq(st.phase, 'choose', 'battle goes on');
  E(st).hp = 1;
  const evs2 = submitTurn(st, mvA());
  eq(st.winner, 'player', 'won');
  eq(evs2.filter((e) => e.t === 'end').length, 1, 'one end event');
  throws(() => submitTurn(st, mvA()), 'no turns after the end');
});

test('double knockouts', () => {
  // Last foe and last dragon both go down (recoil): the player wins.
  let st = mk({ p: [{ moves: ['test-recoil'] }], setup: (s) => { fast(s); s.player.team[0].hp = 1; s.enemy.team[0].hp = 1; } });
  let evs = submitTurn(st, mvA());
  eq([P(st).hp, E(st).hp], [0, 0], 'both down');
  eq(st.winner, 'player', 'player wins a double wipe-out');
  // Both actives go down with teammates left: the AI replaces, the player must switch.
  st = mk({ p: [{ moves: ['test-recoil'] }, {}], e: [{}, {}], setup: (s) => { fast(s); s.player.team[0].hp = 1; s.enemy.team[0].hp = 1; } });
  evs = submitTurn(st, mvA());
  eq(st.enemy.active, 1, 'enemy replaced');
  eq(st.phase, 'switch', 'player must switch');
  check(evs.filter((e) => e.t === 'faint').length === 2, 'two faints');
  // The enemy's replacement has an entry ability: it waits for the player's replacement, then fires.
  st = mk({
    p: [{ moves: ['test-recoil'] }, {}], e: [{}, { ability: 'test-intimidate' }],
    setup: (s) => { fast(s); s.player.team[0].hp = 1; s.enemy.team[0].hp = 1; },
  });
  evs = submitTurn(st, mvA());
  eq(st.phase, 'switch', 'double KO: player must switch');
  check(!evs.some((e) => e.t === 'ability'), 'entry ability does not fizzle on the fainted active');
  eq(st.pendingEntry, st.enemy.team[1].uid, 'entry ability waits');
  evs = submitSwitch(st, 1);
  check(evs.some((e) => e.t === 'ability' && e.uid === st.enemy.team[1].uid), 'entry ability fires after the player switches in');
  eq(P(st).stages.atk, -1, "the player's replacement gets the ATTACK drop");
  eq(st.pendingEntry ?? null, null, 'nothing waits any more');
  const sendAt = evs.findIndex((e) => e.t === 'sendOut' && e.side === 'player');
  check(sendAt >= 0 && sendAt < evs.findIndex((e) => e.t === 'ability'), 'after the send-out');
  // Burn finishes the last foe while the player is also finished by seeds the same turn end.
  st = mk({ setup: (s) => { s.player.team[0].hp = 1; s.enemy.team[0].hp = 1; s.enemy.team[0].status = 'burn'; s.player.team[0].status = 'burn'; s.player.team[0].stats.spe = 999; s.player.team[0].moves[0].id = 'test-wait'; } });
  evs = submitTurn(st, mvA());
  eq(st.phase, 'over', 'over');
  eq(evs.filter((e) => e.t === 'faint').length, 1, 'the battle stops at the first wipe-out');
});

test('XP: participants full, bench half, fainted none; training gain', () => {
  const st = mk({
    p: [{ level: 30 }, { level: 20 }, { level: 25, hp: 0 }], e: [{}],
    setup: (s) => { fast(s); s.enemy.team[0].hp = 1; },
  });
  const evs = submitTurn(st, mvA());
  const xp = evs.filter((e): e is Extract<BattleEvent, { t: 'xp' }> => e.t === 'xp');
  eq(xp.map((e) => e.uid), ['p0', 'p1'], 'eligible dragons');
  eq(xp[0].amount, xpYield(100, 30, 30, false), 'participant full share');
  eq(xp[1].amount, Math.floor(xpYield(100, 30, 20, false) / 2), 'bench half share');
  eq(xp[0].total, xpForLevel(30) + xp[0].amount, 'running total');
  check(has(evs, `TESTBLOB GAINED ${xp[0].amount} XP!`), 'xp line');
  eq(st.player.team[0].trainingGain, { atk: 2 }, 'training +2 in the foe\'s best base stat (ATK)');
  eq(st.player.team[1].trainingGain, {}, 'bench gets no training');
  const boss = mk({ e: [{ defId: 'test-boss' }], setup: (s) => { fast(s); s.enemy.team[0].hp = 1; } });
  const bx = submitTurn(boss, mvA()).find((e) => e.t === 'xp') as Extract<BattleEvent, { t: 'xp' }>;
  eq(bx.amount, xpYield(100, 30, 30, true), 'boss x1.5');
  const maxed = mk({ p: [{ level: MAX_LEVEL }], setup: (s) => { fast(s); s.enemy.team[0].hp = 1; } });
  eq(submitTurn(maxed, mvA()).filter((e) => e.t === 'xp').length, 0, 'no XP at the level cap');
});

test('level ups recompute stats and raise HP by the max-HP delta', () => {
  const st = mk({ p: [{ level: 5 }], e: [{ level: 30 }], setup: (s) => { fast(s); s.enemy.team[0].hp = 1; s.player.team[0].hp = 10; } });
  const before = P(st).stats.hp;
  const evs = submitTurn(st, mvA());
  const ups = evs.filter((e): e is Extract<BattleEvent, { t: 'levelUp' }> => e.t === 'levelUp');
  const gained = xpYield(100, 30, 5, false);
  const expectLevel = levelForXp(xpForLevel(5) + gained);
  check(ups.length === expectLevel - 5 && ups.length > 1, `several level ups (${ups.length})`);
  eq(ups.map((u) => u.level), Array.from({ length: expectLevel - 5 }, (_, i) => 6 + i), 'consecutive');
  eq(P(st).level, expectLevel, 'level');
  eq(P(st).stats, calcStats(BASE80, expectLevel, G31, ZERO, null), 'stats recomputed');
  eq(ups[ups.length - 1].stats, P(st).stats, 'event carries the stats');
  eq(P(st).hp, 10 + (P(st).stats.hp - before), 'HP rises by the max-HP delta');
  check(has(evs, `TESTBLOB GREW TO LV. ${expectLevel}!`), 'level line');
});

// ---------------------------------------------------------------------------------------------
// battle.ts: retreat, items, struggle, determinism
// ---------------------------------------------------------------------------------------------

test('retreat', () => {
  let st = mk({ retreat: true });
  const evs = submitTurn(st, { kind: 'retreat' });
  eq(st.winner, 'retreat', 'winner retreat');
  eq(st.phase, 'over', 'over');
  check(evs.some((e) => e.t === 'end' && e.winner === 'retreat'), 'end event');
  st = mk({ retreat: false });
  eq(legal(st).retreat, false, 'not offered');
  throws(() => submitTurn(st, { kind: 'retreat' }), 'refused');
});

test('battle items: heal, revive, cure, stages; the item is the turn', () => {
  const byKind = (k: string): ItemId | undefined => ITEM_IDS.find((id) => ITEMS[id]?.effect.kind === k);
  const healId = byKind('heal'); const reviveId = byKind('revive'); const cureId = byKind('cure'); const stagesId = byKind('stages');
  check(!!healId && !!reviveId && !!cureId && !!stagesId, 'one item of each kind exists');
  if (!healId || !reviveId || !cureId || !stagesId) return;
  const items = { [healId]: 2, [reviveId]: 1, [cureId]: 1, [stagesId]: 1 } as Partial<Record<ItemId, number>>;
  const st = mk({ p: [{}, { hp: 0 }], e: [{ moves: ['test-tackle'] }], items, setup: (s) => { bigHp(s.player.team[0]); s.player.team[0].hp = 5; s.player.team[0].status = 'burn'; } });
  eq(legal(st).items.includes(healId), true, 'heal listed');
  throws(() => submitTurn(st, { kind: 'item', item: healId, target: 1 }), 'heal on a fainted dragon refused');
  throws(() => submitTurn(st, { kind: 'item', item: reviveId, target: 0 }), 'revive on a healthy dragon refused');
  let evs = submitTurn(st, { kind: 'item', item: healId, target: 0 });
  const fx = ITEMS[healId].effect as { kind: 'heal'; fraction: number };
  const h = evs.find((e) => e.t === 'heal' && e.uid === 'p0') as Extract<BattleEvent, { t: 'heal' }>;
  eq(h?.amount, Math.min(Math.floor(P(st).stats.hp * fx.fraction), P(st).stats.hp - 5), 'heal amount');
  eq(st.items[healId], 1, 'count decremented');
  check(evs.some((e) => e.t === 'item' && e.item === healId), 'item event');
  check(evs.some((e) => e.t === 'useMove' && e.side === 'enemy'), 'the foe still moves');
  check(!evs.some((e) => e.t === 'useMove' && e.side === 'player'), 'the player did not');
  evs = submitTurn(st, { kind: 'item', item: reviveId, target: 1 });
  const rf = ITEMS[reviveId].effect as { kind: 'revive'; fraction: number };
  eq(st.player.team[1].hp, Math.max(1, Math.floor(st.player.team[1].stats.hp * rf.fraction)), 'revived');
  eq(legal(st).switches[1], true, 'revived dragon can be sent out');
  submitTurn(st, { kind: 'item', item: cureId, target: 0 });
  eq(P(st).status, null, 'cured');
  const sf = ITEMS[stagesId].effect as { kind: 'stages'; changes: StageChanges };
  submitTurn(st, { kind: 'item', item: stagesId, target: 0 });
  eq(P(st).stages.atk, sf.changes.atk ?? 0, 'stage item');
  eq(legal(st).items.includes(stagesId), false, 'used up');
});

test('out of PP: the internal struggle', () => {
  const st = mk({ e: [{ moves: ['test-tackle'] }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); s.player.team[0].moves[0].pp = 0; } });
  eq(legal(st).moves, [true], 'any button struggles');
  const evs = submitTurn(st, mvA());
  check(has(evs, 'TESTBLOB HAS NO MOVES LEFT!') && has(evs, `TESTBLOB USED ${STRUGGLE.name.toUpperCase()}!`), 'struggle lines');
  check(!evs.some((e) => e.t === 'useMove' && e.side === 'player'), 'no useMove for the internal move');
  eq(dmgTo(evs, 'p0').find((d) => d.source === 'recoil')?.amount, Math.floor(P(st).stats.hp / 4), 'recoil 1/4 max HP');
  check(dmgTo(evs, 'e0').length === 1, 'it hits');
  eq(MOVES[STRUGGLE.id], undefined, 'not in MOVES');
  const st2 = mk({ p: [{ ability: 'test-rockhead' }], setup: (s) => { fast(s); bigHp(s.enemy.team[0]); s.player.team[0].moves[0].pp = 0; } });
  check(dmgTo(submitTurn(st2, mvA()), 'p0').some((d) => d.source === 'recoil'), 'rockHead does not stop struggle recoil');
  const st3 = mk({ e: [{ moves: ['test-tackle'] }], setup: (s) => { bigHp(s.player.team[0]); s.enemy.team[0].moves[0].pp = 0; } });
  check(has(submitTurn(st3, mvA()), "THE FOE'S TEST GOON HAS NO MOVES LEFT!"), 'enemy struggles too');
});

function scriptedRun(seed: number): string {
  const st = mk({
    seed, ai: 'boss', items: { seedcake: 2 },
    p: [{ moves: ['test-tackle', 'test-multi', 'test-confuse', 'test-flinch30'], happiness: 90 }, { moves: ['test-highcrit', 'test-drain'] }],
    e: [{ moves: ['test-tackle', 'test-burn-status', 'test-buff'] }, { moves: ['test-strike', 'test-heal'] }],
  });
  const pick = makeRng(seed * 7 + 1);
  for (let turn = 0; turn < 200 && st.phase !== 'over'; turn++) {
    const L = legal(st);
    if (L.mustSwitch) { submitSwitch(st, L.switches.indexOf(true)); continue; }
    const slots = L.moves.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
    submitTurn(st, { kind: 'move', slot: pick.pick(slots) ?? 0 });
  }
  return JSON.stringify(st.log);
}

test('determinism: same seed and actions give the same events', () => {
  for (const seed of [1, 2, 99, 12345]) eq(scriptedRun(seed) === scriptedRun(seed), true, `seed ${seed} replays`);
  check(new Set([1, 2, 3, 4].map(scriptedRun)).size > 1, 'different seeds differ');
});

// ---------------------------------------------------------------------------------------------
// ai.ts
// ---------------------------------------------------------------------------------------------

test('minion AI leans towards damage', () => {
  let dmg = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const st = mk({ seed, e: [{ moves: ['test-tackle', 'test-cure-self'] }] });
    const a = chooseEnemyAction(st);
    if (a.kind === 'move' && a.slot === 0) dmg++;
  }
  within(dmg, 260, 300, 'damage move chosen most of the time');
});

test('elite AI picks the best expected damage most of the time', () => {
  let best = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const st = mk({ seed, ai: 'elite', e: [{ moves: ['test-tackle', 'test-strike', 'test-buff'] }], setup: (s) => bigHp(s.player.team[0]) });
    const a = chooseEnemyAction(st);
    if (a.kind === 'move' && a.slot === 1) best++;
  }
  within(best, 300, 390, 'strike (80 power) ~75%+');
});

test('boss AI: KOs, heals, buffs', () => {
  let st = mk({ ai: 'boss', e: [{ moves: ['test-buff', 'test-tackle'] }], setup: (s) => { s.player.team[0].hp = 3; } });
  eq(chooseEnemyAction(st), { kind: 'move', slot: 1 }, 'takes the KO');
  st = mk({ ai: 'boss', p: [{ moves: ['test-wait'] }], e: [{ moves: ['test-tackle', 'test-heal'] }], setup: (s) => { s.enemy.team[0].hp = Math.floor(s.enemy.team[0].stats.hp * 0.3); bigHp(s.player.team[0]); } });
  eq(chooseEnemyAction(st), { kind: 'move', slot: 1 }, 'heals when low');
  st = mk({ ai: 'boss', p: [{ moves: ['test-wait'] }], e: [{ moves: ['test-tackle', 'test-buff'] }], setup: (s) => bigHp(s.player.team[0]) });
  eq(chooseEnemyAction(st), { kind: 'move', slot: 1 }, 'buffs when safe');
  st.enemy.team[0].stages.atk = 2;
  eq(chooseEnemyAction(st), { kind: 'move', slot: 0 }, 'stops buffing at +2');
  st = mk({ ai: 'boss', e: [{ moves: ['test-firstturn', 'test-tackle'] }], setup: (s) => bigHp(s.player.team[0]) });
  st.enemy.team[0].volatile.turnsIn = 3;
  eq(chooseEnemyAction(st), { kind: 'move', slot: 1 }, 'no first-turn move later on');
});

test('boss AI counter-swaps: the rock-paper-scissors moment', () => {
  const setup = (s: BattleState): void => {
    s.player.team[0].types = ['FIRE'];
    s.enemy.team[0].types = ['LEAF'];
    s.enemy.team[1].types = ['WATER'];
    bigHp(s.player.team[0]);
    bigHp(s.enemy.team[0]);
  };
  const st = mk({ ai: 'boss', p: [{ moves: ['test-flame'] }], e: [{ moves: ['test-tackle'] }, { moves: ['test-water'] }], setup });
  eq(chooseEnemyAction(st).kind, 'move', 'never on the turn it came in');
  submitTurn(st, mvA());
  if (E(st).hp <= 0) { check(false, 'setup: the lead should survive a hit'); return; }
  eq(chooseEnemyAction(st), { kind: 'switch', index: 1 }, 'swaps to the resisting teammate');
  const evs = submitTurn(st, mvA());
  check(has(evs, "THE FOE'S TEST GOON SAW YOUR FIRE TYPE COMING AND SWAPPED IN TEST GOON!"), 'the swap line');
  eq(st.enemy.active, 1, 'swapped');
  eq(st.enemySwaps, 1, 'counted');
  check(evs.findIndex((e) => e.t === 'sendOut') < evs.findIndex((e) => e.t === 'useMove'), 'swap before moves');
  check(dmgTo(evs, 'e1').length > 0 && dmgTo(evs, 'e1')[0].effectiveness === 0.5, 'the fire move hits the water type for x0.5');
  // Limits: at most two swaps, never into a worse matchup, minions and elites never swap.
  const st2 = mk({ ai: 'boss', p: [{ moves: ['test-flame'] }], e: [{ moves: ['test-tackle'] }, { moves: ['test-water'] }], setup });
  st2.enemy.team[0].volatile.turnsIn = 2;
  st2.enemySwaps = 2;
  eq(chooseEnemyAction(st2).kind, 'move', 'max two swaps');
  const st3 = mk({ ai: 'boss', p: [{ moves: ['test-flame'] }], e: [{ moves: ['test-tackle'] }, { moves: ['test-tackle'] }], setup: (s) => { setup(s); s.enemy.team[1].types = ['FROST']; } });
  st3.enemy.team[0].volatile.turnsIn = 2;
  eq(chooseEnemyAction(st3).kind, 'move', 'no swap into another weak type');
  const st4 = mk({ ai: 'elite', p: [{ moves: ['test-flame'] }], e: [{ moves: ['test-tackle'] }, { moves: ['test-water'] }], setup });
  st4.enemy.team[0].volatile.turnsIn = 2;
  eq(chooseEnemyAction(st4).kind, 'move', 'elites do not swap');
});

test('AI replacement: best matchup, bosses last', () => {
  const st = mk({
    ai: 'elite', p: [{ moves: ['test-flame'] }], e: [{}, {}, {}],
    setup: (s) => { s.player.team[0].types = ['FIRE']; s.enemy.team[1].types = ['LEAF']; s.enemy.team[2].types = ['WATER']; s.enemy.team[0].hp = 0; },
  });
  eq(chooseEnemyReplacement(st), 2, 'WATER vs FIRE');
  const st2 = mk({
    ai: 'boss', p: [{ moves: ['test-flame'] }], e: [{}, { defId: 'test-boss' }, {}],
    setup: (s) => { s.player.team[0].types = ['FIRE']; s.enemy.team[1].types = ['WATER']; s.enemy.team[2].types = ['LEAF']; s.enemy.team[0].hp = 0; },
  });
  eq(chooseEnemyReplacement(st2), 2, 'the boss is held back');
});

// ---------------------------------------------------------------------------------------------
// Coverage of every effect kind
// ---------------------------------------------------------------------------------------------

const ALL_MOVE_KINDS: Record<MoveEffect['kind'], true> = {
  inflict: true, confuse: true, flinch: true, stages: true, heal: true, drain: true, recoil: true, multiHit: true,
  highCrit: true, protect: true, trap: true, cure: true, fixed: true, resetStages: true, seed: true, pivot: true,
  sureHit: true, rest: true, thaw: true, facade: true, hex: true, firstTurn: true,
};
const ALL_ABILITY_KINDS: Record<AbilityEffect['kind'], true> = {
  pinch: true, contactStatus: true, contactStages: true, absorb: true, resist: true, entry: true, sturdy: true,
  regenTurn: true, speedBoost: true, statMult: true, stab: true, filter: true, technician: true, prankster: true,
  moxie: true, switchHeal: true, switchCure: true, statusImmune: true, innerFocus: true, superLuck: true,
  multiscale: true, pressure: true, shedSkin: true, rockHead: true, clearBody: true, sereneGrace: true,
  typeBoost: true, contactBoost: true,
};
test('every MoveEffect and AbilityEffect kind is exercised', () => {
  const missingM = Object.keys(ALL_MOVE_KINDS).filter((k) => !coveredMoveKinds.has(k));
  const missingA = Object.keys(ALL_ABILITY_KINDS).filter((k) => !coveredAbilityKinds.has(k));
  eq(missingM, [], 'move effect kinds without a test');
  eq(missingA, [], 'ability kinds without a test');
});

// ---------------------------------------------------------------------------------------------
// Fuzz: 500 random battles over the live tables
// ---------------------------------------------------------------------------------------------

setChart(REAL_CHART);

test('matchup grades on the real chart and content', () => {
  // The screenshot case: Puddlepaw (WATER) at LV10 against a Soaker Bot (WATER).
  const pud = getSpecies('puddlepaw');
  const soaker = VILLAINS['soaker-bot'];
  check(!!pud && !!soaker, 'puddlepaw and soaker-bot exist');
  const g = M.matchupGrade(pud.types, defaultMoves(pud.learnset, 10), soaker.types);
  check(g <= 2, `Puddlepaw vs Soaker Bot is at most 2 stars (got ${g})`);
  // Every starter: STAB-only against the starter it beats is 3, against the one that beats it 1.
  const tri: TypeId[] = ['FIRE', 'LEAF', 'WATER'];
  tri.forEach((t, i) => {
    const prey = tri[(i + 1) % 3];
    const pred = tri[(i + 2) % 3];
    eq(M.matchupGrade([t], [], [prey]), 3, `${t} vs ${prey}`);
    eq(M.matchupGrade([t], [], [pred]), 1, `${t} vs ${pred}`);
    eq(M.matchupGrade([t], [], [t]), 2, `${t} mirror`);
  });
});

const FONT_OK = /^[A-Z0-9 .,:;!?'"\-+/()%><&=*[\]#@$_▶♥←→↑↓★]+$/;

const HUD = await import('../src/ui/battle/hud.ts');

test('MATCHUP strip: the verdict is the SWAP cards grade, in the same words', () => {
  // The review case: FLUFF/WINGED hits METAL x0.5 and METAL hits it x1. The SWAP card calls that an
  // EVEN MATCHUP, so the strip must not say "they have the advantage".
  const fw = M.bestTypeMultiplier(['FLUFF', 'WINGED'], ['METAL']), bk = M.bestTypeMultiplier(['METAL'], ['FLUFF', 'WINGED']);
  check(fw < 1 && bk === 1, `the review case still holds (x${fw} / x${bk})`);
  eq(HUD.verdictOf({ mine: ['FLUFF', 'WINGED'], theirs: ['METAL'], fwd: fw, back: bk, grade: M.matchupGrade(['FLUFF', 'WINGED'], [], ['METAL']) }), 'even', 'resisted but not beaten: even');
  for (const a of TYPE_IDS) for (const b of TYPE_IDS) {
    const grade = M.matchupGrade([a], [], [b]);
    const m = { mine: [a], theirs: [b], fwd: M.bestTypeMultiplier([a], [b]), back: M.bestTypeMultiplier([b], [a]), grade };
    const v = HUD.verdictOf(m);
    eq(v, grade === 3 ? 'good' : grade === 1 ? 'bad' : 'even', `${a} vs ${b}: verdict follows the grade`);
    if (v === 'bad') check(m.back > 1 || m.fwd === 0, `${a} vs ${b}: a bad verdict means their type really beats yours`);
  }
  eq(HUD.VERDICT_TEXT.good, M.GRADE_LABELS[3], 'good reads like the swap cards');
  eq(HUD.VERDICT_TEXT.even, M.GRADE_LABELS[2], 'even reads like the swap cards');
  check(HUD.VERDICT_TEXT.bad.includes(M.GRADE_LABELS[1]), 'bad reads like the swap cards');
  for (const t of Object.values(HUD.VERDICT_TEXT)) check(FONT_OK.test(t), `font-safe verdict: ${t}`);
});


function validate(st: BattleState, evs: BattleEvent[], tag: string): string | null {
  const all = [...st.player.team, ...st.enemy.team];
  const byUid = new Map(all.map((m) => [m.uid, m]));
  for (const e of evs) {
    switch (e.t) {
      case 'text':
        if (!e.text || !FONT_OK.test(e.text)) return `${tag}: bad text ${JSON.stringify(e.text)}`;
        break;
      case 'damage':
        if (!(e.amount > 0) || !Number.isInteger(e.amount) || e.hp < 0 || e.hp > e.maxHp || !byUid.has(e.uid)) return `${tag}: bad damage ${JSON.stringify(e)}`;
        if (![0, 0.25, 0.5, 1, 2, 4].includes(e.effectiveness)) return `${tag}: odd effectiveness ${e.effectiveness}`;
        break;
      case 'heal':
        if (!(e.amount > 0) || e.hp < 1 || e.hp > e.maxHp || !byUid.has(e.uid)) return `${tag}: bad heal ${JSON.stringify(e)}`;
        break;
      case 'sendOut': {
        const team = e.side === 'player' ? st.player.team : st.enemy.team;
        if (team[e.index]?.uid !== e.uid) return `${tag}: bad sendOut ${JSON.stringify(e)}`;
        break;
      }
      case 'useMove':
        if (!MOVES[e.move]) return `${tag}: useMove of an unknown move ${e.move}`;
        if (!byUid.has(e.uid)) return `${tag}: bad uid`;
        break;
      case 'xp': case 'levelUp':
        if (!byUid.has(e.uid) || byUid.get(e.uid)?.side !== 'player') return `${tag}: bad ${e.t}`;
        break;
      case 'end':
        if (e !== evs[evs.length - 1]) return `${tag}: end is not last`;
        break;
      default:
        if ('uid' in e && !byUid.has(e.uid)) return `${tag}: unknown uid in ${e.t}`;
    }
  }
  for (const m of all) {
    if (!Number.isInteger(m.hp) || m.hp < 0 || m.hp > m.stats.hp) return `${tag}: ${m.uid} hp ${m.hp}/${m.stats.hp}`;
    for (const v of Object.values(m.stages)) if (v < -6 || v > 6) return `${tag}: stage out of range`;
    for (const s of m.moves) if (s.pp < 0 || s.pp > s.maxPp) return `${tag}: pp out of range`;
    if (m.level < 1 || m.level > MAX_LEVEL) return `${tag}: level`;
  }
  if (st.phase === 'choose' && (P(st).hp <= 0 || E(st).hp <= 0)) return `${tag}: choose phase with a fainted active`;
  if (st.phase === 'switch' && !legal(st).switches.some(Boolean)) return `${tag}: switch phase with nobody to send`;
  if (st.phase === 'over' && st.winner === null) return `${tag}: over without a winner`;
  if (st.phase !== 'over' && st.winner !== null) return `${tag}: winner while running`;
  return null;
}

test('fuzz: 500 random battles', () => {
  const realSpecies = SPECIES.filter((s) => !s.id.startsWith('test-'));
  const realVillains = Object.values(VILLAINS).filter((v) => !v.id.startsWith('test-'));
  const speciesPool = realSpecies.length ? realSpecies : SPECIES;
  const villainPool = realVillains.length ? realVillains : Object.values(VILLAINS);
  const allMoves = Object.keys(MOVES);
  const allAbilities = Object.keys(ABILITIES);
  const personalities = PERSONALITIES.map((p) => p.id);
  const levels: AiLevel[] = ['minion', 'elite', 'boss'];
  let finished = 0;
  let firstError: string | null = null;
  for (let n = 0; n < 500 && !firstError; n++) {
    const r = makeRng(1000 + n * 7919);
    const wild = n >= 400; // the last 100 battles use random moves and abilities from every table
    const movesFor = (learnset: { level: number; move: string }[], level: number): string[] => {
      if (wild) return Array.from({ length: r.int(1, 4) }, () => r.pick(allMoves) ?? 'test-tackle');
      const ms = defaultMoves(learnset, level).filter((id) => MOVES[id]);
      return ms.length ? ms : [r.pick(allMoves) ?? 'test-tackle'];
    };
    const abilityFor = (ids: (string | undefined)[]): string => {
      const own = ids.filter((id): id is string => !!id && !!ABILITIES[id]);
      return wild || !own.length ? (r.pick(allAbilities) ?? 'test-plain') : (r.pick(own) ?? own[0]);
    };
    const pc = r.int(1, 3);
    const player: MonInit[] = [];
    for (let i = 0; i < pc; i++) {
      const sp = r.pick(speciesPool) ?? SPECIES[0];
      const level = r.int(3, MAX_LEVEL);
      const g = (): number => r.int(0, 31);
      player.push({
        kind: 'dragon', defId: sp.id, ownerRef: `d${i}`, level, moves: movesFor(sp.learnset, level),
        ability: abilityFor([...sp.abilities, sp.hiddenAbility]),
        genes: { hp: g(), atk: g(), def: g(), spa: g(), spd: g(), spe: g() },
        training: { hp: r.int(0, 80), atk: r.int(0, 80), def: r.int(0, 80), spa: r.int(0, 80), spd: r.int(0, 80), spe: r.int(0, 80) },
        personality: r.pick(personalities), happiness: r.int(0, 100),
        status: r.chance(0.15) ? (r.pick(['burn', 'goop', 'zap', 'snooze', 'frozen'] as StatusId[]) ?? null) : null,
        hp: i > 0 && r.chance(0.15) ? 0 : undefined,
      });
    }
    const ec = r.int(1, 3);
    const enemy: MonInit[] = [];
    for (let i = 0; i < ec; i++) {
      const asDragon = r.chance(0.1);
      const level = r.int(3, MAX_LEVEL);
      if (asDragon) {
        const sp = r.pick(speciesPool) ?? SPECIES[0];
        enemy.push({ kind: 'dragon', defId: sp.id, level, moves: movesFor(sp.learnset, level), ability: abilityFor(sp.abilities), genes: G31 });
      } else {
        const v = r.pick(villainPool) ?? Object.values(VILLAINS)[0];
        enemy.push({
          kind: 'villain', defId: v.id, level, moves: movesFor(v.learnset, level), ability: abilityFor([v.ability]),
          isBoss: i === ec - 1 && r.chance(0.3), startStages: r.chance(0.1) ? { atk: 1, spa: 1 } : undefined,
        });
      }
    }
    const items: Partial<Record<ItemId, number>> = {};
    for (const id of ITEM_IDS) if (r.chance(0.5)) items[id] = r.int(1, 3);
    const st = createBattle({ seed: n + 1, player, enemy, items, aiLevel: r.pick(levels) ?? 'minion', canRetreat: r.chance(0.5) });
    const tag = `battle ${n}`;
    firstError = validate(st, startBattle(st), `${tag} start`);
    let turns = 0;
    while (!firstError && st.phase !== 'over' && turns < 300) {
      const L = legal(st);
      let evs: BattleEvent[];
      if (L.mustSwitch) {
        const opts = L.switches.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
        evs = submitSwitch(st, r.pick(opts) ?? 0);
      } else {
        turns++;
        const roll = r.next();
        const sw = L.switches.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
        const moves = L.moves.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
        let action: PlayerAction = { kind: 'move', slot: r.pick(moves) ?? 0 };
        if (roll < 0.1 && sw.length) action = { kind: 'switch', index: r.pick(sw) ?? sw[0] };
        else if (roll < 0.17 && L.items.length) {
          const item = r.pick(L.items) as ItemId;
          const kind = ITEMS[item].effect.kind;
          const targets = st.player.team.map((m, i) => {
            const ok = kind === 'heal' ? m.hp > 0 && m.hp < m.stats.hp
              : kind === 'revive' ? m.hp <= 0
                : kind === 'cure' ? m.hp > 0 && (m.status !== null || (i === st.player.active && m.volatile.confused > 0))
                  : i === st.player.active;
            return ok ? i : -1;
          }).filter((i) => i >= 0);
          if (targets.length) action = { kind: 'item', item, target: r.pick(targets) ?? targets[0] };
        } else if (roll < 0.175 && L.retreat) action = { kind: 'retreat' };
        evs = submitTurn(st, action);
      }
      firstError = validate(st, evs, `${tag} turn ${turns}`);
    }
    if (!firstError && st.phase !== 'over') firstError = `${tag}: did not finish in 300 turns`;
    if (!firstError) {
      const ends = st.log.filter((e) => e.t === 'end');
      if (ends.length !== 1 || st.log[st.log.length - 1].t !== 'end') firstError = `${tag}: expected exactly one final end event`;
      finished++;
    }
  }
  check(firstError === null, firstError ?? '');
  eq(finished, 500, 'battles finished');
});

// ---------------------------------------------------------------------------------------------

if (failures.length) {
  console.log(`battletest: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(1);
}
console.log(`battletest: all ${passed} checks passed`);
