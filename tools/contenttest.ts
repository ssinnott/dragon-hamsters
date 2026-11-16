// Content validation: node tools/contenttest.ts
//
// Walks every content table through src/data/index.ts and checks the rules the rest of the game
// relies on: unique ids and names, the pixel-font character set, every cross-reference, learnsets,
// evolutions, the type chart's balance rules, effect-kind coverage, counts, stat archetypes and the
// mission structure. Prints one 'ok: <check>' line per passing check and one 'FAIL: <check>: <why>'
// line per problem ('warn:' lines are advisory and never fail the run). Exits 1 on any failure.
import { readFileSync } from 'node:fs';
import type {
  AbilityEffect, EncounterSpec, MissionNode, MoveDef, MoveEffect, SpeciesDef, Stats, StatId, TypeId,
} from '../src/data/schema.ts';
import {
  ACTIVITY_IDS, FOOD_IDS, ITEM_IDS, LOCATION_IDS, MISSION_TYPE_IDS, ORG_IDS, STAT_IDS, TYPE_IDS,
} from '../src/data/schema.ts';
import {
  ABILITIES, ACTIVITIES, FOODS, ITEMS, LOCATIONS, MISSIONS, MISSION_TYPES, MOVES, ORGS, PERSONALITIES,
  SPECIES, TYPES, VILLAINS,
} from '../src/data/index.ts';
import { CHART, TYPE_CYCLES, TYPE_CYCLE_NAMES, effectiveness } from '../src/data/types.ts';
import { STARTERS } from '../src/data/species.ts';
import { MAX_LEVEL } from '../src/game/types.ts';
import { FONT_CHARS } from '../src/lib/engine/text.ts';

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

let failedChecks = 0;
let passedChecks = 0;

function report(prefix: 'FAIL' | 'warn', name: string, errs: string[]): void {
  const shown = errs.slice(0, 40);
  for (const e of shown) console.log(`${prefix}: ${name}: ${e}`);
  if (errs.length > shown.length) console.log(`${prefix}: ${name}: ...and ${errs.length - shown.length} more`);
}

function run(fn: () => string[]): string[] {
  try {
    return fn();
  } catch (e) {
    return [`threw ${e instanceof Error ? e.message : String(e)}`];
  }
}

/** A hard check: any returned message is a failure. */
function check(name: string, fn: () => string[]): void {
  const errs = run(fn);
  if (errs.length === 0) {
    passedChecks++;
    console.log(`ok: ${name}`);
    return;
  }
  failedChecks++;
  report('FAIL', name, errs);
}

/** An advisory check: messages are printed as warnings and never fail the run. */
function advise(name: string, fn: () => string[]): void {
  const errs = run(fn);
  if (errs.length === 0) console.log(`ok: ${name}`);
  else report('warn', name, errs);
}

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isType = (t: unknown): t is TypeId => typeof t === 'string' && (TYPE_IDS as readonly string[]).includes(t);
const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The union members' `kind` strings of a type alias in schema.ts, read from the source. */
function schemaKinds(alias: string): string[] {
  const src = readFileSync(new URL('../src/data/schema.ts', import.meta.url), 'utf8');
  const start = src.indexOf(`export type ${alias} =`);
  if (start < 0) throw new Error(`schema.ts has no 'export type ${alias}'`);
  const end = src.indexOf('export ', start + 10);
  const block = src.slice(start, end < 0 ? undefined : end);
  return [...new Set([...block.matchAll(/kind: '([A-Za-z]+)'/g)].map((m) => m[1]))];
}

/** The string literals of a plain string-union alias in schema.ts (e.g. FxKind). */
function schemaLiterals(alias: string): string[] {
  const src = readFileSync(new URL('../src/data/schema.ts', import.meta.url), 'utf8');
  const start = src.indexOf(`export type ${alias} =`);
  if (start < 0) throw new Error(`schema.ts has no 'export type ${alias}'`);
  const end = src.indexOf(';', start);
  return [...src.slice(start, end).matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
}

/** Every battle/boss encounter of a mission, branches included. */
function encounters(nodes: readonly MissionNode[], out: { label: string; enc: EncounterSpec }[] = []): { label: string; enc: EncounterSpec }[] {
  for (const n of nodes) {
    if (n.kind === 'battle' || n.kind === 'boss') out.push({ label: n.label, enc: n.encounter });
    else if (n.kind === 'branch') for (const o of n.options) encounters(o.nodes, out);
  }
  return out;
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

const statVec = (s: Stats): number[] => STAT_IDS.map((k: StatId) => s[k]);
const bst = (s: Stats): number => statVec(s).reduce((x, y) => x + y, 0);

/** Relative luminance contrast of white text on a #rrggbb fill. */
function whiteContrast(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number): number => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return 1.05 / (L + 0.05);
}

const mult = (a: TypeId, d: TypeId): number => CHART[a]?.[d] ?? 1;

/** All clean directed 3-cycles A>B>C>A (each x2, every reverse < 1), normalised to start at the lowest type index. */
function cleanCycles(): string[] {
  const out = new Set<string>();
  const idx = (t: TypeId): number => TYPE_IDS.indexOf(t);
  for (const a of TYPE_IDS) for (const b of TYPE_IDS) for (const c of TYPE_IDS) {
    if (a === b || b === c || a === c) continue;
    if (mult(a, b) === 2 && mult(b, c) === 2 && mult(c, a) === 2 && mult(b, a) < 1 && mult(c, b) < 1 && mult(a, c) < 1) {
      out.add(normCycle([a, b, c], idx));
    }
  }
  return [...out].sort();
}

function normCycle(cyc: readonly TypeId[], idx: (t: TypeId) => number): string {
  let best = 0;
  for (let i = 1; i < cyc.length; i++) if (idx(cyc[i]) < idx(cyc[best])) best = i;
  return [...cyc.slice(best), ...cyc.slice(0, best)].join('>');
}

// ---------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------

const RECORD_TABLES: { name: string; table: Record<string, { id: string; name?: string; title?: string }> }[] = [
  { name: 'TYPES', table: TYPES },
  { name: 'MOVES', table: MOVES },
  { name: 'ABILITIES', table: ABILITIES },
  { name: 'FOODS', table: FOODS },
  { name: 'ITEMS', table: ITEMS },
  { name: 'ACTIVITIES', table: ACTIVITIES },
  { name: 'ORGS', table: ORGS },
  { name: 'VILLAINS', table: VILLAINS },
  { name: 'MISSION_TYPES', table: MISSION_TYPES },
  { name: 'LOCATIONS', table: LOCATIONS },
];
const LIST_TABLES: { name: string; list: readonly { id: string; name?: string; title?: string }[] }[] = [
  { name: 'PERSONALITIES', list: PERSONALITIES },
  { name: 'SPECIES', list: SPECIES },
  { name: 'MISSIONS', list: MISSIONS },
];

const speciesById = new Map<string, SpeciesDef>(SPECIES.map((s) => [s.id, s]));

// ---------------------------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------------------------

function sameKeys(name: string, table: object, ids: readonly string[]): string[] {
  const errs: string[] = [];
  const keys = Object.keys(table);
  if (keys.length !== ids.length) errs.push(`${name} has ${keys.length} entries, expected ${ids.length}`);
  for (const id of ids) if (!has(table, id)) errs.push(`${name} is missing '${id}'`);
  for (const k of keys) if (!ids.includes(k)) errs.push(`${name} has unexpected key '${k}'`);
  return errs;
}

check('counts: 16 types', () => sameKeys('TYPES', TYPES, TYPE_IDS));
check('counts: 5 foods', () => sameKeys('FOODS', FOODS, FOOD_IDS));
check('counts: 5 items', () => sameKeys('ITEMS', ITEMS, ITEM_IDS));
check('counts: 5 activities', () => sameKeys('ACTIVITIES', ACTIVITIES, ACTIVITY_IDS));
check('counts: 5 orgs', () => sameKeys('ORGS', ORGS, ORG_IDS));
check('counts: 5 mission types', () => sameKeys('MISSION_TYPES', MISSION_TYPES, MISSION_TYPE_IDS));
check('counts: 5 locations', () => sameKeys('LOCATIONS', LOCATIONS, LOCATION_IDS));

check('counts: 25 missions, 5 per org with indices 1..5 and each mission type once', () => {
  const errs: string[] = [];
  if (MISSIONS.length !== 25) errs.push(`MISSIONS has ${MISSIONS.length} missions, expected 25`);
  for (const org of ORG_IDS) {
    const ms = MISSIONS.filter((m) => m.org === org);
    if (ms.length !== 5) errs.push(`org '${org}' has ${ms.length} missions, expected 5`);
    const idx = ms.map((m) => m.index).sort((a, b) => a - b).join(',');
    if (idx !== '1,2,3,4,5') errs.push(`org '${org}' mission indices are [${idx}], expected [1,2,3,4,5]`);
    for (const t of MISSION_TYPE_IDS) {
      const n = ms.filter((m) => m.type === t).length;
      if (n !== 1) errs.push(`org '${org}' has ${n} '${t}' missions, expected exactly 1`);
    }
  }
  for (const m of MISSIONS) if (!(ORG_IDS as readonly string[]).includes(m.org)) errs.push(`mission '${m.id}' has unknown org '${m.org}'`);
  return errs;
});

check('counts: 3 STARTERS are FIRE, LEAF and WATER first stages', () => {
  const errs: string[] = [];
  const want: TypeId[] = ['FIRE', 'LEAF', 'WATER'];
  if (STARTERS.length !== 3) errs.push(`STARTERS has ${STARTERS.length} entries, expected 3`);
  STARTERS.forEach((id, i) => {
    const s = speciesById.get(id);
    if (!s) { errs.push(`STARTERS[${i}] '${id}' is not a species`); return; }
    if (want[i] && s.types[0] !== want[i]) errs.push(`STARTERS[${i}] '${id}' is ${s.types.join('/')}, expected primary type ${want[i]}`);
    if (s.evolvesFrom) errs.push(`STARTERS[${i}] '${id}' evolves from '${s.evolvesFrom}', so it is not a first stage`);
    if (!s.evolvesTo) errs.push(`STARTERS[${i}] '${id}' has no evolution, so it is not the first stage of a line`);
  });
  return errs;
});

check('counts: 120-150 moves, 45-55 abilities, 21 personalities', () => {
  const errs: string[] = [];
  const nm = Object.keys(MOVES).length;
  const na = Object.keys(ABILITIES).length;
  if (nm < 120 || nm > 150) errs.push(`${nm} moves, expected 120-150`);
  if (na < 45 || na > 55) errs.push(`${na} abilities, expected 45-55`);
  if (PERSONALITIES.length !== 21) errs.push(`${PERSONALITIES.length} personalities, expected 21`);
  return errs;
});

// ---------------------------------------------------------------------------------------------
// Ids and names
// ---------------------------------------------------------------------------------------------

check('ids: record keys match ids, ids and names unique per table', () => {
  const errs: string[] = [];
  const dupNames = (table: string, items: { id: string; label: string }[]): void => {
    const seen = new Map<string, string>();
    for (const { id, label } of items) {
      if (typeof label !== 'string' || label.trim() === '') { errs.push(`${table}.${id} has an empty name`); continue; }
      const key = label.trim().toUpperCase();
      const prev = seen.get(key);
      if (prev !== undefined) errs.push(`${table}: name '${label}' is used by both '${prev}' and '${id}'`);
      else seen.set(key, id);
    }
  };
  for (const { name, table } of RECORD_TABLES) {
    for (const [k, v] of Object.entries(table)) if (v.id !== k) errs.push(`${name}['${k}'].id is '${v.id}'`);
    dupNames(name, Object.values(table).map((v) => ({ id: v.id, label: v.name ?? v.title ?? '' })));
  }
  for (const { name, list } of LIST_TABLES) {
    const seen = new Set<string>();
    for (const v of list) {
      if (seen.has(v.id)) errs.push(`${name}: id '${v.id}' appears twice`);
      seen.add(v.id);
    }
    dupNames(name, list.map((v) => ({ id: v.id, label: v.name ?? v.title ?? '' })));
  }
  return errs;
});

check('ids: moves and abilities use kebab-case ids', () => {
  const errs: string[] = [];
  for (const id of Object.keys(MOVES)) if (!KEBAB.test(id)) errs.push(`move id '${id}' is not kebab-case`);
  for (const id of Object.keys(ABILITIES)) if (!KEBAB.test(id)) errs.push(`ability id '${id}' is not kebab-case`);
  return errs;
});

advise('ids: species, villain, mission and personality ids are kebab-case', () => {
  const errs: string[] = [];
  for (const s of SPECIES) if (!KEBAB.test(s.id)) errs.push(`species id '${s.id}' is not kebab-case`);
  for (const id of Object.keys(VILLAINS)) if (!KEBAB.test(id)) errs.push(`villain id '${id}' is not kebab-case`);
  for (const m of MISSIONS) if (!KEBAB.test(m.id)) errs.push(`mission id '${m.id}' is not kebab-case`);
  for (const p of PERSONALITIES) if (!KEBAB.test(p.id)) errs.push(`personality id '${p.id}' is not kebab-case`);
  return errs;
});

check('ids: species dex numbers are unique and run 1..N', () => {
  const errs: string[] = [];
  const dex = SPECIES.map((s) => s.dex).sort((a, b) => a - b);
  dex.forEach((d, i) => { if (d !== i + 1) errs.push(`dex numbers are [${dex.join(',')}], expected 1..${SPECIES.length}`); });
  return errs.slice(0, 1);
});

check('names: moves and abilities at most 14 characters, species at most 12', () => {
  const errs: string[] = [];
  for (const m of Object.values(MOVES)) if (m.name.length > 14) errs.push(`move '${m.id}' name '${m.name}' is ${m.name.length} characters`);
  for (const a of Object.values(ABILITIES)) if (a.name.length > 14) errs.push(`ability '${a.id}' name '${a.name}' is ${a.name.length} characters`);
  for (const s of SPECIES) if (s.name.length > 12) errs.push(`species '${s.id}' name '${s.name}' is ${s.name.length} characters`);
  return errs;
});

check('names: move and ability descriptions at most 60 characters', () => {
  const errs: string[] = [];
  for (const m of Object.values(MOVES)) if (m.description.length > 60 || m.description.trim() === '') errs.push(`move '${m.id}' description is ${m.description.length} characters`);
  for (const a of Object.values(ABILITIES)) if (a.description.length > 60 || a.description.trim() === '') errs.push(`ability '${a.id}' description is ${a.description.length} characters`);
  return errs;
});

// ---------------------------------------------------------------------------------------------
// Text: every string uses the pixel font
// ---------------------------------------------------------------------------------------------

check('text: every string in every table uses only pixel-font characters', () => {
  const allowed = new Set<string>([...FONT_CHARS, ...'abcdefghijklmnopqrstuvwxyz']);
  const errs: string[] = [];
  const seen = new Set<object>();
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'string') {
      const bad = [...new Set([...v].filter((ch) => !allowed.has(ch)))];
      if (bad.length) errs.push(`${path} = "${v.length > 50 ? v.slice(0, 47) + '...' : v}" has ${bad.map((ch) => `'${ch}' (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`).join(', ')}`);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (v !== null && typeof v === 'object') {
      if (seen.has(v)) return;
      seen.add(v);
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    }
  };
  for (const { name, table } of RECORD_TABLES) walk(table, name);
  for (const { name, list } of LIST_TABLES) list.forEach((x, i) => walk(x, `${name}[${i}:${x.id}]`));
  walk(TYPE_CYCLE_NAMES, 'TYPE_CYCLE_NAMES');
  return errs;
});

// ---------------------------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------------------------

check('refs: every move, ability, species, villain, mission, food and item reference resolves', () => {
  const errs: string[] = [];
  const move = (where: string, id: string): void => { if (!has(MOVES, id)) errs.push(`${where}: unknown move '${id}'`); };
  const ability = (where: string, id: string): void => { if (!has(ABILITIES, id)) errs.push(`${where}: unknown ability '${id}'`); };
  const species = (where: string, id: string): void => { if (!speciesById.has(id)) errs.push(`${where}: unknown species '${id}'`); };
  const villain = (where: string, id: string): void => { if (!has(VILLAINS, id)) errs.push(`${where}: unknown villain '${id}'`); };
  const type = (where: string, t: unknown): void => { if (!isType(t)) errs.push(`${where}: unknown type '${String(t)}'`); };
  const missionIds = new Set(MISSIONS.map((m) => m.id));

  for (const m of Object.values(MOVES)) type(`move '${m.id}'`, m.type);
  for (const a of Object.values(ABILITIES)) {
    const e = a.effect;
    if (e.kind === 'pinch' || e.kind === 'absorb' || e.kind === 'typeBoost') type(`ability '${a.id}'`, e.type);
    if (e.kind === 'resist') e.types.forEach((t) => type(`ability '${a.id}'`, t));
  }
  for (const act of Object.values(ACTIVITIES)) act.likedBy.forEach((t) => type(`activity '${act.id}' likedBy`, t));

  for (const s of SPECIES) {
    const w = `species '${s.id}'`;
    s.types.forEach((t) => type(w, t));
    if (s.types.length === 2 && s.types[0] === s.types[1]) errs.push(`${w}: repeats type ${s.types[0]}`);
    if (!s.abilities.length) errs.push(`${w}: has no abilities`);
    s.abilities.forEach((id) => ability(w, id));
    if (s.hiddenAbility !== undefined) ability(`${w} hiddenAbility`, s.hiddenAbility);
    s.learnset.forEach((e) => move(`${w} learnset`, e.move));
    if (s.evolvesTo) species(`${w} evolvesTo`, s.evolvesTo.species);
    if (s.evolvesFrom) species(`${w} evolvesFrom`, s.evolvesFrom);
    if (!has(FOODS, s.favoriteFood)) errs.push(`${w}: unknown favoriteFood '${s.favoriteFood}'`);
  }
  STARTERS.forEach((id, i) => species(`STARTERS[${i}]`, id));

  for (const v of Object.values(VILLAINS)) {
    const w = `villain '${v.id}'`;
    if (!has(ORGS, v.org)) errs.push(`${w}: unknown org '${v.org}'`);
    v.types.forEach((t) => type(w, t));
    ability(w, v.ability);
    v.learnset.forEach((e) => move(`${w} learnset`, e.move));
    if (!['minion', 'lieutenant', 'boss'].includes(v.role)) errs.push(`${w}: unknown role '${v.role}'`);
  }
  for (const o of Object.values(ORGS)) {
    villain(`org '${o.id}' boss`, o.boss);
    o.themeTypes.forEach((t) => type(`org '${o.id}' themeTypes`, t));
  }
  for (const m of MISSIONS) {
    const w = `mission '${m.id}'`;
    if (!has(MISSION_TYPES, m.type)) errs.push(`${w}: unknown mission type '${m.type}'`);
    if (!has(LOCATIONS, m.location)) errs.push(`${w}: unknown location '${m.location}'`);
    for (const r of m.requires) if (!missionIds.has(r)) errs.push(`${w}: requires unknown mission '${r}'`);
    for (const { label, enc } of encounters(m.nodes)) {
      if (!enc.enemies.length) errs.push(`${w} node '${label}': encounter has no enemies`);
      enc.enemies.forEach((e) => villain(`${w} node '${label}'`, e.villain));
    }
    for (const it of m.rewards.items) if (!has(FOODS, it.id) && !has(ITEMS, it.id)) errs.push(`${w} rewards: unknown food/item '${it.id}'`);
    m.rewards.dragon?.species.forEach((id) => species(`${w} rewards.dragon`, id));
  }
  return errs;
});

// ---------------------------------------------------------------------------------------------
// Learnsets and evolutions
// ---------------------------------------------------------------------------------------------

function learnsetErrors(where: string, ls: readonly { level: number; move: string }[]): string[] {
  const errs: string[] = [];
  if (!ls.some((e) => e.level === 1)) errs.push(`${where}: learnset has no level-1 move`);
  for (let i = 0; i < ls.length; i++) {
    const L = ls[i].level;
    if (!Number.isInteger(L) || L < 1 || L > MAX_LEVEL) errs.push(`${where}: learnset level ${L} for '${ls[i].move}' is outside 1..${MAX_LEVEL}`);
    if (i > 0 && L < ls[i - 1].level) errs.push(`${where}: learnset is not sorted ('${ls[i].move}' at ${L} after '${ls[i - 1].move}' at ${ls[i - 1].level})`);
  }
  return errs;
}

check('learnsets: species and villain learnsets are sorted with a level-1 move', () => {
  const errs: string[] = [];
  for (const s of SPECIES) errs.push(...learnsetErrors(`species '${s.id}'`, s.learnset));
  for (const v of Object.values(VILLAINS)) errs.push(...learnsetErrors(`villain '${v.id}'`, v.learnset));
  return errs;
});

advise('learnsets: no move is listed twice in one learnset', () => {
  const errs: string[] = [];
  const dup = (w: string, ls: readonly { move: string }[]): void => {
    const seen = new Set<string>();
    for (const e of ls) { if (seen.has(e.move)) errs.push(`${w}: '${e.move}' appears twice`); seen.add(e.move); }
  };
  for (const s of SPECIES) dup(`species '${s.id}'`, s.learnset);
  for (const v of Object.values(VILLAINS)) dup(`villain '${v.id}'`, v.learnset);
  return errs;
});

/** The DRAGONS screen's known-moves grid holds this many moves (2 columns x 7 rows). */
const KNOWN_MOVES_GRID = 14;

check(`learnsets: no evolution line learns more than ${KNOWN_MOVES_GRID} moves (the DRAGONS screen grid)`, () => {
  const errs: string[] = [];
  for (const s of SPECIES) {
    if (s.evolvesFrom) continue;
    const moves = new Set<string>();
    const line: string[] = [];
    for (let cur: typeof s | undefined = s; cur; cur = cur.evolvesTo ? speciesById.get(cur.evolvesTo.species) : undefined) {
      line.push(cur.id);
      for (const e of cur.learnset) moves.add(e.move);
      if (line.length > 5) break;
    }
    if (moves.size > KNOWN_MOVES_GRID) errs.push(`line ${line.join(' > ')} learns ${moves.size} moves`);
  }
  return errs;
});

check('evolutions: links mirror each other and evolve levels are 2..MAX_LEVEL', () => {
  const errs: string[] = [];
  for (const s of SPECIES) {
    if (s.evolvesTo) {
      const L = s.evolvesTo.level;
      if (!Number.isInteger(L) || L <= 1 || L > MAX_LEVEL) errs.push(`species '${s.id}' evolves at level ${L}, expected 2..${MAX_LEVEL}`);
      const next = speciesById.get(s.evolvesTo.species);
      if (next && next.evolvesFrom !== s.id) errs.push(`species '${s.id}' evolves to '${next.id}', but '${next.id}'.evolvesFrom is '${next.evolvesFrom ?? '(none)'}'`);
      if (s.evolvesTo.species === s.id) errs.push(`species '${s.id}' evolves into itself`);
    }
    if (s.evolvesFrom) {
      const prev = speciesById.get(s.evolvesFrom);
      if (prev && prev.evolvesTo?.species !== s.id) errs.push(`species '${s.id}' evolves from '${prev.id}', but '${prev.id}'.evolvesTo is '${prev.evolvesTo?.species ?? '(none)'}'`);
    }
  }
  return errs;
});

// ---------------------------------------------------------------------------------------------
// The type chart
// ---------------------------------------------------------------------------------------------

check('chart: values are 0, 0.5 or 2 between known types', () => {
  const errs: string[] = [];
  for (const a of Object.keys(CHART)) {
    if (!isType(a)) { errs.push(`CHART has unknown attacking type '${a}'`); continue; }
    for (const [d, v] of Object.entries(CHART[a])) {
      if (!isType(d)) errs.push(`CHART.${a} has unknown defending type '${d}'`);
      if (v !== 0 && v !== 0.5 && v !== 2) errs.push(`CHART.${a}.${d} = ${v}; use 0, 0.5 or 2 (omit 1)`);
    }
  }
  for (const a of TYPE_IDS) if (!CHART[a]) errs.push(`CHART has no row for ${a}`);
  return errs;
});

check('chart: every attacking type is x2 vs 2-4 types and resisted by 2-4, at most 1 immunity', () => {
  const errs: string[] = [];
  for (const a of TYPE_IDS) {
    const se = TYPE_IDS.filter((d) => mult(a, d) === 2);
    const res = TYPE_IDS.filter((d) => mult(a, d) < 1);
    const imm = TYPE_IDS.filter((d) => mult(a, d) === 0);
    if (se.length < 2 || se.length > 4) errs.push(`${a} is super effective vs ${se.length} types (${se.join(', ') || 'none'}), expected 2-4`);
    if (res.length < 2 || res.length > 4) errs.push(`${a} is resisted by ${res.length} types (${res.join(', ') || 'none'}), expected 2-4`);
    if (imm.length > 1) errs.push(`${a} has ${imm.length} immunities (${imm.join(', ')}), expected at most 1`);
  }
  return errs;
});

check('chart: every defending type has >= 2 weaknesses and >= 1 resistance; <= 6 immunities overall', () => {
  const errs: string[] = [];
  for (const d of TYPE_IDS) {
    const weak = TYPE_IDS.filter((a) => mult(a, d) === 2);
    const res = TYPE_IDS.filter((a) => mult(a, d) < 1);
    if (weak.length < 2) errs.push(`${d} is weak to only ${weak.length} types (${weak.join(', ') || 'none'})`);
    if (res.length < 1) errs.push(`${d} resists nothing`);
  }
  const imm = TYPE_IDS.flatMap((a) => TYPE_IDS.filter((d) => mult(a, d) === 0).map((d) => `${a}->${d}`));
  if (imm.length > 6) errs.push(`${imm.length} immunities (${imm.join(', ')}), expected at most 6`);
  return errs;
});

check('chart: FIRE > LEAF > WATER > FIRE plus at least 4 more clean 3-cycles; TYPE_CYCLES lists them all', () => {
  const errs: string[] = [];
  const all = cleanCycles();
  const idx = (t: TypeId): number => TYPE_IDS.indexOf(t);
  const starter = normCycle(['FIRE', 'LEAF', 'WATER'], idx);
  if (!all.includes(starter)) errs.push('FIRE > LEAF > WATER > FIRE is not a clean cycle (each must be x2 on the next and resisted by it)');
  if (all.length < 5) errs.push(`only ${all.length} clean 3-cycles (${all.join(' | ') || 'none'}), expected at least 5`);
  const first = TYPE_CYCLES[0]?.join('>');
  if (first !== 'FIRE>LEAF>WATER') errs.push(`TYPE_CYCLES[0] is ${first ?? '(missing)'}, expected FIRE>LEAF>WATER`);
  const listed = TYPE_CYCLES.map((c) => normCycle(c, idx));
  TYPE_CYCLES.forEach((c, i) => {
    if (c.length !== 3) errs.push(`TYPE_CYCLES[${i}] has ${c.length} types, expected 3`);
    else if (!all.includes(listed[i])) errs.push(`TYPE_CYCLES[${i}] ${c.join('>')} is not a clean cycle in CHART`);
  });
  if (new Set(listed).size !== listed.length) errs.push('TYPE_CYCLES lists a cycle twice');
  for (const c of all) if (!listed.includes(c)) errs.push(`clean cycle ${c} is missing from TYPE_CYCLES`);
  if (TYPE_CYCLE_NAMES.length !== TYPE_CYCLES.length) errs.push(`TYPE_CYCLE_NAMES has ${TYPE_CYCLE_NAMES.length} names for ${TYPE_CYCLES.length} cycles`);
  return errs;
});

check('chart: effectiveness() multiplies over dual types', () => {
  const errs: string[] = [];
  for (const a of TYPE_IDS) for (const d1 of TYPE_IDS) for (const d2 of TYPE_IDS) {
    if (d1 === d2) continue;
    const want = mult(a, d1) * mult(a, d2);
    const got = effectiveness(a, [d1, d2]);
    if (got !== want) errs.push(`effectiveness(${a}, [${d1}, ${d2}]) = ${got}, expected ${want}`);
  }
  return errs;
});

// ---------------------------------------------------------------------------------------------
// Types table
// ---------------------------------------------------------------------------------------------

check('types: colours, text and stat templates', () => {
  const errs: string[] = [];
  const hex = /^#[0-9a-fA-F]{6}$/;
  const fams = new Map<string, string>();
  for (const id of TYPE_IDS) {
    const t = TYPES[id];
    if (!t) continue;
    for (const k of ['color', 'dark', 'light'] as const) if (!hex.test(t[k])) errs.push(`${id}.${k} '${t[k]}' is not #rrggbb`);
    if (hex.test(t.color) && whiteContrast(t.color) < 3) errs.push(`${id}.color ${t.color} gives white text a contrast of only ${fmt(whiteContrast(t.color))} (need >= 3)`);
    const prev = fams.get(t.color.toLowerCase());
    if (prev) errs.push(`${id} and ${prev} share the colour ${t.color}`);
    fams.set(t.color.toLowerCase(), id);
    for (const k of ['name', 'blurb', 'parallel', 'role'] as const) if (!t[k] || !t[k].trim()) errs.push(`${id}.${k} is empty`);
    const w = statVec(t.template);
    const mean = w.reduce((a, b) => a + b, 0) / 6;
    if (w.some((x) => !(x > 0))) errs.push(`${id}.template has a non-positive weight`);
    if (mean < 0.95 || mean > 1.05) errs.push(`${id}.template averages ${fmt(mean)}, expected about 1.0`);
  }
  return errs;
});

check('types: stat templates keep the research archetypes', () => {
  const errs: string[] = [];
  const T = (id: TypeId): Stats => TYPES[id].template;
  const top = (id: TypeId): StatId => STAT_IDS.reduce((b, k) => (T(id)[k] > T(id)[b] ? k : b), 'hp' as StatId);
  const low = (id: TypeId): StatId => STAT_IDS.reduce((b, k) => (T(id)[k] < T(id)[b] ? k : b), 'hp' as StatId);
  const want: [string, boolean][] = [
    ['ROCK has its highest weight in DEF', top('ROCK') === 'def'],
    ['ROCK has its lowest weight in SPE or SPA', low('ROCK') === 'spe' || low('ROCK') === 'spa'],
    ['LIGHTNING has SPA and SPE >= 1.2', T('LIGHTNING').spa >= 1.2 && T('LIGHTNING').spe >= 1.2],
    ['COOKING has its highest weight in HP and SPD >= 1.2', top('COOKING') === 'hp' && T('COOKING').spd >= 1.2],
    ['BRAWL has its highest weight in ATK', top('BRAWL') === 'atk'],
    ['METAL has its highest weight in DEF', top('METAL') === 'def'],
    ['MIND has its highest weight in SPA', top('MIND') === 'spa'],
    ['WINGED has its highest weight in SPE', top('WINGED') === 'spe'],
    ['LIGHT has its highest weight in SPD', top('LIGHT') === 'spd'],
    ['FLUFF has its highest weight in HP', top('FLUFF') === 'hp'],
  ];
  for (const [what, ok] of want) if (!ok) errs.push(what);
  return errs;
});

// ---------------------------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------------------------

const MOVE_KINDS = schemaKinds('MoveEffect');
const ABILITY_KINDS = schemaKinds('AbilityEffect');
const FX_KINDS = schemaLiterals('FxKind');
const UTILITY_KINDS = new Set(['multiHit', 'drain', 'recoil', 'trap', 'pivot', 'protect', 'heal', 'seed', 'hex', 'facade', 'firstTurn', 'fixed', 'resetStages', 'rest', 'thaw', 'sureHit', 'highCrit', 'cure']);

function stageErrors(where: string, changes: Record<string, number | undefined>): string[] {
  const errs: string[] = [];
  const keys = Object.keys(changes);
  if (!keys.length) errs.push(`${where}: empty stage change`);
  for (const k of keys) {
    const v = changes[k];
    if (!['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'].includes(k)) errs.push(`${where}: unknown stage stat '${k}'`);
    if (v === undefined || !Number.isInteger(v) || v === 0 || Math.abs(v) > 6) errs.push(`${where}: stage change ${k} ${v}`);
  }
  return errs;
}

function moveEffectErrors(m: MoveDef, e: MoveEffect): string[] {
  const w = `move '${m.id}' effect '${e.kind}'`;
  const errs: string[] = [];
  if ('chance' in e && !(e.chance >= 1 && e.chance <= 100)) errs.push(`${w}: chance ${e.chance} is outside 1..100`);
  if (e.kind === 'stages') errs.push(...stageErrors(w, e.changes));
  if ((e.kind === 'heal' || e.kind === 'drain' || e.kind === 'recoil') && !(e.fraction > 0 && e.fraction <= 1)) errs.push(`${w}: fraction ${e.fraction}`);
  if (e.kind === 'multiHit' && !(e.min >= 2 && e.max >= e.min && e.max <= 5)) errs.push(`${w}: hits ${e.min}..${e.max}`);
  if (e.kind === 'fixed' && e.damage !== 'level' && !(e.damage > 0)) errs.push(`${w}: damage ${e.damage}`);
  return errs;
}

check('moves: numbers follow the conventions', () => {
  const errs: string[] = [];
  for (const m of Object.values(MOVES)) {
    const w = `move '${m.id}'`;
    const kinds = m.effects.map((e) => e.kind);
    const fixed = kinds.includes('fixed');
    if (m.category === 'status') {
      if (m.power !== 0) errs.push(`${w}: status move with power ${m.power}`);
      if (m.contact) errs.push(`${w}: status move marked contact`);
      if (!m.effects.length) errs.push(`${w}: status move with no effects`);
    } else {
      if (fixed ? m.power !== 0 : !(m.power >= 10 && m.power <= 150)) errs.push(`${w}: ${m.category} power ${m.power}${fixed ? ' (fixed-damage moves use 0)' : ''}`);
      if (m.target !== 'foe') errs.push(`${w}: damaging move must target 'foe'`);
    }
    if (m.category === 'special' && m.contact) errs.push(`${w}: special move marked contact`);
    if (!(Number.isInteger(m.accuracy) && m.accuracy >= 1 && m.accuracy <= 100)) errs.push(`${w}: accuracy ${m.accuracy}`);
    if (m.target === 'self' && m.accuracy !== 100) errs.push(`${w}: self-targeted move with accuracy ${m.accuracy}`);
    if (!(Number.isInteger(m.pp) && m.pp >= 5 && m.pp <= 40)) errs.push(`${w}: pp ${m.pp}, expected 5-40`);
    if (!(Number.isInteger(m.priority) && m.priority >= -3 && m.priority <= 4)) errs.push(`${w}: priority ${m.priority}`);
    if (m.priority === 4 && !kinds.includes('protect')) errs.push(`${w}: priority +4 is reserved for protect moves`);
    if (kinds.includes('protect') && m.priority !== 4) errs.push(`${w}: protect moves use priority +4`);
    if (kinds.includes('firstTurn') && m.priority !== 3) errs.push(`${w}: firstTurn moves use priority +3`);
    if (!FX_KINDS.includes(m.fx)) errs.push(`${w}: unknown fx '${m.fx}'`);
    if (!['physical', 'special', 'status'].includes(m.category)) errs.push(`${w}: unknown category '${m.category}'`);
    for (const e of m.effects) {
      if (!MOVE_KINDS.includes(e.kind)) errs.push(`${w}: effect kind '${e.kind}' is not in schema.ts`);
      errs.push(...moveEffectErrors(m, e));
    }
  }
  return errs;
});

check('moves: every type has 7+ moves covering weak/strong physical and special, status and 2 utility', () => {
  const errs: string[] = [];
  const all = Object.values(MOVES);
  for (const t of TYPE_IDS) {
    const ms = all.filter((m) => m.type === t);
    const need: [string, (m: MoveDef) => boolean][] = [
      ['a weak physical move (35-50 power)', (m) => m.category === 'physical' && m.power >= 35 && m.power <= 50],
      ['a strong physical move (80-100 power)', (m) => m.category === 'physical' && m.power >= 80 && m.power <= 100],
      ['a weak special move (35-50 power)', (m) => m.category === 'special' && m.power >= 35 && m.power <= 50],
      ['a strong special move (90-120 power)', (m) => m.category === 'special' && m.power >= 90 && m.power <= 120],
      ['a status move', (m) => m.category === 'status'],
    ];
    if (ms.length < 7) errs.push(`${t} has ${ms.length} moves, expected at least 7`);
    for (const [what, ok] of need) if (!ms.some(ok)) errs.push(`${t} has no ${what}`);
    const util = ms.filter((m) => m.priority !== 0 || m.effects.some((e) => UTILITY_KINDS.has(e.kind)));
    if (util.length < 2) errs.push(`${t} has ${util.length} utility moves (${util.map((m) => m.id).join(', ') || 'none'}), expected 2`);
  }
  return errs;
});

check('moves: FLUFF carries the generic hamster toolkit', () => {
  const errs: string[] = [];
  const fluff = Object.values(MOVES).filter((m) => m.type === 'FLUFF');
  const stagesOf = (m: MoveDef, who: 'self' | 'foe'): Record<string, number> =>
    Object.assign({}, ...m.effects.filter((e): e is Extract<MoveEffect, { kind: 'stages' }> => e.kind === 'stages' && e.who === who).map((e) => e.changes));
  const want: [string, (m: MoveDef) => boolean][] = [
    ['a +1 priority attack (scurry)', (m) => m.category !== 'status' && m.priority === 1],
    ['a protect move (curl up)', (m) => m.effects.some((e) => e.kind === 'protect')],
    ['a rest move (hibernate)', (m) => m.effects.some((e) => e.kind === 'rest')],
    ['a +2 ATTACK dance', (m) => m.target === 'self' && stagesOf(m, 'self').atk === 2],
    ['a DEF + SP. DEF cheek buff', (m) => m.target === 'self' && (stagesOf(m, 'self').def ?? 0) > 0 && (stagesOf(m, 'self').spd ?? 0) > 0],
    ['an ATTACK-lowering squeak', (m) => m.category === 'status' && (stagesOf(m, 'foe').atk ?? 0) < 0],
    ['a first-turn startle', (m) => m.effects.some((e) => e.kind === 'firstTurn')],
  ];
  for (const [what, ok] of want) if (!fluff.some(ok)) errs.push(`FLUFF has no ${what}`);
  return errs;
});

check('moves: every MoveEffect kind in schema.ts is used by at least two moves', () => {
  const errs: string[] = [];
  if (!MOVE_KINDS.length) return ['could not read MoveEffect kinds from schema.ts'];
  for (const k of MOVE_KINDS) {
    const users = Object.values(MOVES).filter((m) => m.effects.some((e) => e.kind === k)).map((m) => m.id);
    if (users.length < 2) errs.push(`kind '${k}' is used by ${users.length} moves (${users.join(', ') || 'none'})`);
  }
  return errs;
});

// ---------------------------------------------------------------------------------------------
// Abilities, personalities, foods, items, activities
// ---------------------------------------------------------------------------------------------

function abilityEffectErrors(id: string, e: AbilityEffect): string[] {
  const w = `ability '${id}' (${e.kind})`;
  const errs: string[] = [];
  if (!ABILITY_KINDS.includes(e.kind)) errs.push(`${w}: kind is not in schema.ts`);
  if ('chance' in e && !(e.chance >= 1 && e.chance <= 100)) errs.push(`${w}: chance ${e.chance}`);
  if ('mult' in e && !(e.mult > 0 && e.mult <= 2.5)) errs.push(`${w}: mult ${e.mult}`);
  if ('fraction' in e && !(e.fraction > 0 && e.fraction <= 1)) errs.push(`${w}: fraction ${e.fraction}`);
  if (e.kind === 'absorb' && !(e.heal >= 0 && e.heal <= 1)) errs.push(`${w}: heal ${e.heal}`);
  if (e.kind === 'absorb' && e.boost) errs.push(...stageErrors(w, e.boost));
  if (e.kind === 'entry' || e.kind === 'contactStages') errs.push(...stageErrors(w, e.changes));
  if (e.kind === 'statusImmune' && !e.statuses.length) errs.push(`${w}: no statuses`);
  if (e.kind === 'resist' && !e.types.length) errs.push(`${w}: no types`);
  return errs;
}

check('abilities: effects are well formed and every AbilityEffect kind is used', () => {
  const errs: string[] = [];
  if (!ABILITY_KINDS.length) return ['could not read AbilityEffect kinds from schema.ts'];
  for (const a of Object.values(ABILITIES)) {
    errs.push(...abilityEffectErrors(a.id, a.effect));
    if (!a.parallel || !a.parallel.trim()) errs.push(`ability '${a.id}' has no parallel`);
  }
  for (const k of ABILITY_KINDS) if (!Object.values(ABILITIES).some((a) => a.effect.kind === k)) errs.push(`kind '${k}' is used by no ability`);
  return errs;
});

check('personalities: one per (up, down) pair plus one neutral', () => {
  const errs: string[] = [];
  const stats = ['atk', 'def', 'spa', 'spd', 'spe'];
  const pairs = new Map<string, string>();
  let neutral = 0;
  for (const p of PERSONALITIES) {
    if (p.up === null || p.down === null) {
      if (p.up !== p.down) errs.push(`personality '${p.id}' has only one of up/down set`);
      else neutral++;
      continue;
    }
    if (p.up === p.down) errs.push(`personality '${p.id}' raises and lowers the same stat`);
    const key = `${p.up}/${p.down}`;
    if (pairs.has(key)) errs.push(`personalities '${pairs.get(key)}' and '${p.id}' are both ${key}`);
    pairs.set(key, p.id);
    if (!p.blurb.trim()) errs.push(`personality '${p.id}' has no blurb`);
  }
  for (const u of stats) for (const d of stats) if (u !== d && !pairs.has(`${u}/${d}`)) errs.push(`no personality raises ${u} and lowers ${d}`);
  if (neutral !== 1) errs.push(`${neutral} neutral personalities, expected 1`);
  return errs;
});

check('foods and items: prices, numbers and effects', () => {
  const errs: string[] = [];
  for (const f of Object.values(FOODS)) {
    if (!(f.price > 0)) errs.push(`food '${f.id}' price ${f.price}`);
    if (!(f.fullness >= 0 && f.fullness <= 100) || !(f.happiness >= 0 && f.happiness <= 100) || !(f.xp >= 0)) errs.push(`food '${f.id}' has out-of-range numbers`);
    if (!f.description.trim()) errs.push(`food '${f.id}' has no description`);
  }
  if (FOODS.dragonfruit && !(FOODS.dragonfruit.xp > 0)) errs.push('dragonfruit grants no XP');
  const prices = FOOD_IDS.map((id) => FOODS[id]?.price ?? 0);
  if (prices.some((p, i) => i > 0 && p < prices[i - 1])) errs.push(`food prices are not in pantry order (seeds cheapest .. dragonfruit dearest): ${prices.join(', ')}`);
  for (const it of Object.values(ITEMS)) {
    if (!(it.price > 0)) errs.push(`item '${it.id}' price ${it.price}`);
    if (!it.description.trim()) errs.push(`item '${it.id}' has no description`);
    const e = it.effect;
    if ((e.kind === 'heal' || e.kind === 'revive') && !(e.fraction > 0 && e.fraction <= 1)) errs.push(`item '${it.id}' fraction ${e.fraction}`);
    if (e.kind === 'stages') errs.push(...stageErrors(`item '${it.id}'`, e.changes));
    if (it.fieldUse !== (e.kind !== 'stages')) errs.push(`item '${it.id}': fieldUse should be ${e.kind !== 'stages'} for a '${e.kind}' item`);
  }
  return errs;
});

check('activities: numbers and likes', () => {
  const errs: string[] = [];
  for (const a of Object.values(ACTIVITIES)) {
    if (!a.verb.trim() || !a.description.trim()) errs.push(`activity '${a.id}' is missing a verb or description`);
    if (a.usesSlot !== (a.id !== 'feed')) errs.push(`activity '${a.id}' usesSlot should be ${a.id !== 'feed'}`);
    if (!(a.xpFraction >= 0 && a.xpFraction <= 0.5)) errs.push(`activity '${a.id}' xpFraction ${a.xpFraction}`);
    for (const [k, v] of Object.entries(a.training)) if (!(STAT_IDS as readonly string[]).includes(k) || !(v! > 0)) errs.push(`activity '${a.id}' training ${k} ${v}`);
  }
  if (ACTIVITIES.nap && !(ACTIVITIES.nap.energy < 0)) errs.push('nap should restore energy (negative energy cost)');
  const liked = new Set(Object.values(ACTIVITIES).flatMap((a) => a.likedBy));
  for (const t of TYPE_IDS) if (!liked.has(t)) errs.push(`no activity is liked by ${t}`);
  return errs;
});

// ---------------------------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------------------------

check('species: single-typed base stats correlate > 0.5 with their type template', () => {
  const errs: string[] = [];
  const rows: string[] = [];
  for (const s of [...SPECIES].sort((a, b) => a.dex - b.dex)) {
    const v = statVec(s.baseStats);
    if (v.some((x) => !(Number.isInteger(x) && x > 0))) errs.push(`species '${s.id}' has a non-positive or fractional base stat`);
    const rs = s.types.map((t) => (TYPES[t] ? pearson(v, statVec(TYPES[t].template)) : NaN));
    rows.push(`  #${String(s.dex).padStart(3)} ${s.id.padEnd(16)} ${s.types.join('/').padEnd(18)} BST ${String(bst(s.baseStats)).padStart(3)}  r ${rs.map((r) => (r >= 0 ? ' ' : '') + r.toFixed(2)).join(' ')}`);
    if (s.types.length === 1 && !(rs[0] > 0.5)) errs.push(`species '${s.id}' (${s.types[0]}) correlates ${rs[0].toFixed(2)} with the ${s.types[0]} template, need > 0.5`);
  }
  console.log(`species archetypes (${SPECIES.length} species; r = Pearson correlation of base stats with each type's template):`);
  for (const r of rows) console.log(r);
  return errs;
});

check('species: every non-starter first or single stage is in a mission reward pool', () => {
  const errs: string[] = [];
  const pooled = new Set(MISSIONS.flatMap((m) => m.rewards.dragon?.species ?? []));
  for (const s of SPECIES) {
    if (s.evolvesFrom || STARTERS.includes(s.id)) continue;
    if (!pooled.has(s.id)) errs.push(`species '${s.id}' is in no mission's rewards.dragon pool`);
  }
  for (const id of pooled) {
    const s = speciesById.get(id);
    if (s?.evolvesFrom) errs.push(`species '${id}' is a reward but evolves from '${s.evolvesFrom}' (pools should hold first stages)`);
  }
  return errs;
});

advise('species: dragondex size and abilities per species', () => {
  const errs: string[] = [];
  if (SPECIES.length < 30) errs.push(`only ${SPECIES.length} species; the design calls for about 36`);
  for (const s of SPECIES) if (s.abilities.length > 2) errs.push(`species '${s.id}' has ${s.abilities.length} regular abilities (1-2 expected)`);
  return errs;
});

// ---------------------------------------------------------------------------------------------
// Villains and missions
// ---------------------------------------------------------------------------------------------

check('villains: org bosses have role boss and belong to their org', () => {
  const errs: string[] = [];
  for (const o of Object.values(ORGS)) {
    const b = VILLAINS[o.boss];
    if (!b) continue;
    if (b.role !== 'boss') errs.push(`org '${o.id}' boss '${b.id}' has role '${b.role}'`);
    if (b.org !== o.id) errs.push(`org '${o.id}' boss '${b.id}' belongs to org '${b.org}'`);
  }
  return errs;
});

check('missions: every mission ends with a boss node whose last enemy is its org boss', () => {
  const errs: string[] = [];
  for (const m of MISSIONS) {
    const last = m.nodes[m.nodes.length - 1];
    if (!last) { errs.push(`mission '${m.id}' has no nodes`); continue; }
    if (last.kind !== 'boss') { errs.push(`mission '${m.id}' ends with a '${last.kind}' node, expected 'boss'`); continue; }
    const enemies = last.encounter.enemies;
    const boss = ORGS[m.org]?.boss;
    const lastEnemy = enemies[enemies.length - 1]?.villain;
    if (lastEnemy !== boss) errs.push(`mission '${m.id}' boss node ends with '${lastEnemy ?? '(nobody)'}', expected org boss '${boss}'`);
    const bossNodes = m.nodes.filter((n) => n.kind === 'boss').length;
    if (bossNodes !== 1) errs.push(`mission '${m.id}' has ${bossNodes} boss nodes, expected 1`);
  }
  return errs;
});

check('missions: rescue missions award a dragon with chance 1', () => {
  const errs: string[] = [];
  for (const m of MISSIONS) {
    if (m.type !== 'rescue') continue;
    if (!m.rewards.dragon) errs.push(`rescue mission '${m.id}' has no rewards.dragon`);
    else if (m.rewards.dragon.chance !== 1) errs.push(`rescue mission '${m.id}' dragon chance is ${m.rewards.dragon.chance}, expected 1`);
  }
  for (const m of MISSIONS) {
    const d = m.rewards.dragon;
    if (d && (!(d.chance >= 0 && d.chance <= 1) || !d.species.length)) errs.push(`mission '${m.id}' dragon reward has chance ${d.chance} and ${d.species.length} species`);
  }
  return errs;
});

check('missions: enemy levels are 1..MAX_LEVEL', () => {
  const errs: string[] = [];
  for (const m of MISSIONS) for (const { label, enc } of encounters(m.nodes)) {
    for (const e of enc.enemies) if (!(Number.isInteger(e.level) && e.level >= 1 && e.level <= MAX_LEVEL)) errs.push(`mission '${m.id}' node '${label}': '${e.villain}' at level ${e.level}`);
  }
  return errs;
});

advise('missions: board levels follow the design bands', () => {
  const errs: string[] = [];
  const bands: Record<string, number[]> = {
    cheese: [5, 7, 9, 11, 14], crows: [13, 15, 17, 19, 22], snakes: [20, 22, 24, 26, 29], cats: [27, 29, 31, 33, 36], ferrets: [34, 36, 38, 41, 45],
  };
  for (const m of MISSIONS) {
    const want = bands[m.org]?.[m.index - 1];
    if (want !== undefined && m.level !== want) errs.push(`mission '${m.id}' level ${m.level}, design band says ${want}`);
  }
  return errs;
});

advise('villains: every type appears somewhere on the enemy side', () => {
  const seen = new Set(Object.values(VILLAINS).flatMap((v) => v.types));
  return TYPE_IDS.filter((t) => !seen.has(t)).map((t) => `no villain is ${t}`);
});

// ---------------------------------------------------------------------------------------------

console.log(failedChecks ? `contenttest: ${failedChecks} check(s) FAILED, ${passedChecks} passed` : `contenttest: all ${passedChecks} checks passed`);
process.exit(failedChecks ? 1 : 0);
