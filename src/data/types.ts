// The sixteen dragon types: colours, archetype stat templates and the type chart.
//
// Templates come from docs/POKEMON_RESEARCH.md section 2.3: each row is the parallel Pokemon type's
// fully-evolved stat share, sharpened so every type has one or two signature stats and one or two
// dump stats. Every row sums to 6.00 (mean weight 1.00); a species' base stat is roughly
// weight * BST / 6, so ROCK dragons are slow walls, LIGHTNING dragons fast special attackers, etc.
//
// The chart is the research's 16x16 proposal (section 5) with one thematic change for COOKING:
// FIRE overcooks it (FIRE -> COOKING x2 instead of x0.5) and a chef shrugs off another chef's
// tricks (COOKING -> COOKING x0.5). tools/contenttest.ts re-checks every balance rule:
//   - every attacking type is x2 against 2-4 types and resisted (x0.5 or x0) by 2-4 types;
//   - every defending type has at least 2 weaknesses and at least 1 resistance;
//   - at most 1 immunity per attacking type, at most 6 in the whole chart;
//   - FIRE > LEAF > WATER > FIRE is a clean cycle, plus at least 4 more (see TYPE_CYCLES).
import { type Stats, type TypeId, type TypeInfo } from './schema.ts';

const t = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): Stats => ({ hp, atk, def, spa, spd, spe });

export const TYPES: Record<TypeId, TypeInfo> = {
  FLUFF: {
    id: 'FLUFF', name: 'FLUFF', color: '#957f74', dark: '#4f423c', light: '#ece0d6',
    blurb: 'Soft, round and surprisingly hard to knock over.',
    parallel: 'Normal', role: 'Big-HP all-rounders',
    template: t(1.25, 1.10, 0.85, 0.80, 0.95, 1.05),
  },
  FIRE: {
    id: 'FIRE', name: 'FIRE', color: '#d9481a', dark: '#7a2208', light: '#ffb07a',
    blurb: 'Warm cheeks, hot tempers and very toasty sneezes.',
    parallel: 'Fire', role: 'Special or mixed sweepers',
    template: t(0.90, 1.10, 0.85, 1.25, 0.90, 1.00),
  },
  WATER: {
    id: 'WATER', name: 'WATER', color: '#2a6cd0', dark: '#143a78', light: '#94c4ff',
    blurb: 'Splashy swimmers that never, ever skip bath time.',
    parallel: 'Water', role: 'Bulky all-rounders',
    template: t(1.10, 1.00, 1.05, 1.00, 1.05, 0.80),
  },
  LEAF: {
    id: 'LEAF', name: 'LEAF', color: '#358a2c', dark: '#1a4e14', light: '#a8e48c',
    blurb: 'Sprouts, seeds and extremely sneezy pollen.',
    parallel: 'Grass', role: 'Defensive support: status, drain and healing',
    template: t(0.95, 1.05, 1.05, 1.10, 1.10, 0.75),
  },
  LIGHTNING: {
    id: 'LIGHTNING', name: 'LIGHTNING', color: '#a87e00', dark: '#5c4400', light: '#ffe46a',
    blurb: 'Wheel-powered speedsters full of static fuzz.',
    parallel: 'Electric', role: 'Fast special glass cannons',
    template: t(0.85, 0.90, 0.80, 1.25, 0.95, 1.25),
  },
  EARTH: {
    id: 'EARTH', name: 'EARTH', color: '#8a5226', dark: '#4a2a0e', light: '#dcaa74',
    blurb: 'Expert diggers who live for a really good tunnel.',
    parallel: 'Ground', role: 'Bulky physical tanks',
    template: t(1.15, 1.30, 1.20, 0.70, 0.95, 0.70),
  },
  ROCK: {
    id: 'ROCK', name: 'ROCK', color: '#77703e', dark: '#3e3a1c', light: '#d2c992',
    blurb: 'Pebble-crunching dragons with stony hides.',
    parallel: 'Rock', role: 'Slow physical walls that hit hard',
    template: t(0.95, 1.25, 1.55, 0.65, 0.95, 0.65),
  },
  WINGED: {
    id: 'WINGED', name: 'WINGED', color: '#5c66cc', dark: '#2c327a', light: '#bcc4ff',
    blurb: 'Tiny wings, big swoops and no fear of heights.',
    parallel: 'Flying', role: 'Fast hit-and-run attackers',
    template: t(0.95, 1.10, 0.85, 0.95, 0.85, 1.30),
  },
  FROST: {
    id: 'FROST', name: 'FROST', color: '#16879c', dark: '#08454f', light: '#a0eaf6',
    blurb: 'Snow-loving dragons with chilly breath and warm hearts.',
    parallel: 'Ice', role: 'Hard-hitting bruisers with big HP',
    template: t(1.15, 1.15, 1.00, 1.05, 0.90, 0.75),
  },
  SLIME: {
    id: 'SLIME', name: 'SLIME', color: '#5f8a10', dark: '#324a06', light: '#cbec7c',
    blurb: 'Gooey, gloopy and very proud of it.',
    parallel: 'Poison + Bug', role: 'Sticky status walls',
    template: t(1.15, 0.95, 1.00, 0.95, 1.20, 0.75),
  },
  DARKNESS: {
    id: 'DARKNESS', name: 'DARKNESS', color: '#433861', dark: '#1c1630', light: '#9a8cc4',
    blurb: 'Night owls who love a good spooky story.',
    parallel: 'Dark + Ghost', role: 'Fast physical tricksters',
    template: t(0.95, 1.35, 0.90, 0.90, 0.85, 1.05),
  },
  LIGHT: {
    id: 'LIGHT', name: 'LIGHT', color: '#c4508a', dark: '#6e2248', light: '#ffc6e2',
    blurb: 'Sparkly dragons that glow softly in the dark.',
    parallel: 'Fairy', role: 'Special walls and healers',
    template: t(0.95, 0.75, 1.00, 1.20, 1.30, 0.80),
  },
  COOKING: {
    id: 'COOKING', name: 'COOKING', color: '#bc6a10', dark: '#663604', light: '#ffd08a',
    blurb: 'Snack-slinging chefs who keep the whole team fed.',
    parallel: 'None: our own, built like Chansey and the Fairy healers', role: 'Bulky healers and buffers',
    template: t(1.30, 0.70, 0.95, 0.95, 1.25, 0.85),
  },
  METAL: {
    id: 'METAL', name: 'METAL', color: '#5e7080', dark: '#2c3640', light: '#c6d4de',
    blurb: 'Shiny, clanky and very, very hard to dent.',
    parallel: 'Steel', role: 'Armoured walls on both sides',
    template: t(0.85, 1.15, 1.60, 0.70, 1.10, 0.60),
  },
  MIND: {
    id: 'MIND', name: 'MIND', color: '#8a44c4', dark: '#46206a', light: '#dcb4ff',
    blurb: 'Big brains in very small, very fluffy heads.',
    parallel: 'Psychic', role: 'Special sweepers',
    template: t(0.95, 0.75, 0.90, 1.35, 1.15, 0.90),
  },
  BRAWL: {
    id: 'BRAWL', name: 'BRAWL', color: '#b02838', dark: '#5c0e18', light: '#f4a0a8',
    blurb: 'Tiny fists of fury. Mostly fury.',
    parallel: 'Fighting', role: 'Physical wallbreakers',
    template: t(1.00, 1.55, 0.95, 0.65, 0.90, 0.95),
  },
};

/** attacker -> defender -> multiplier; omitted pairs are 1. */
export const CHART: Record<TypeId, Partial<Record<TypeId, number>>> = {
  // A big warm hug chases off the dark and breaks any concentration; bounces off stone, steel and muscle.
  FLUFF: { DARKNESS: 2, MIND: 2, ROCK: 0.5, METAL: 0.5, BRAWL: 0.5 },
  // Burns plants, melts ice and metal, overcooks the cook's dinner.
  FIRE: { LEAF: 2, FROST: 2, METAL: 2, COOKING: 2, FIRE: 0.5, WATER: 0.5, ROCK: 0.5 },
  // Douses fire, erodes earth and stone, makes the snacks soggy; rolls off a duck's back.
  WATER: { FIRE: 2, EARTH: 2, ROCK: 2, COOKING: 2, WATER: 0.5, LEAF: 0.5, WINGED: 0.5 },
  // Drinks water, roots crack soil and stone; chefs chop greens into salad.
  LEAF: { WATER: 2, EARTH: 2, ROCK: 2, FIRE: 0.5, LEAF: 0.5, SLIME: 0.5, COOKING: 0.5 },
  // Shocks swimmers and flyers; rubbery goo insulates; earth grounds it completely.
  LIGHTNING: { WATER: 2, WINGED: 2, LIGHTNING: 0.5, LEAF: 0.5, SLIME: 0.5, EARTH: 0 },
  // Smothers fire, grounds sparks, buries goo and metal; flyers soar over the quake.
  EARTH: { FIRE: 2, LIGHTNING: 2, SLIME: 2, METAL: 2, LEAF: 0.5, FROST: 0.5, LIGHT: 0.5, WINGED: 0 },
  // Smashes fire, ice and birds.
  ROCK: { FIRE: 2, FROST: 2, WINGED: 2, EARTH: 0.5, METAL: 0.5, BRAWL: 0.5 },
  // Out-flies brawlers, gobbles slugs, snatches snacks.
  WINGED: { BRAWL: 2, SLIME: 2, COOKING: 2, LIGHTNING: 0.5, ROCK: 0.5, METAL: 0.5 },
  // Frosts crops, freezes the ground, ices wings.
  FROST: { LEAF: 2, EARTH: 2, WINGED: 2, FIRE: 0.5, WATER: 0.5, FROST: 0.5, METAL: 0.5 },
  // Weedkiller, gums up sparks and sparkle, food poisoning; slides off rust-proof metal.
  SLIME: { LEAF: 2, LIGHTNING: 2, LIGHT: 2, COOKING: 2, SLIME: 0.5, EARTH: 0.5, WINGED: 0.5, METAL: 0 },
  // Preys on fearful minds and swallows the light.
  DARKNESS: { MIND: 2, LIGHT: 2, DARKNESS: 0.5, BRAWL: 0.5 },
  // Dazzles bullies and dispels the dark.
  LIGHT: { BRAWL: 2, DARKNESS: 2, FIRE: 0.5, SLIME: 0.5, METAL: 0.5 },
  // Chops veggies, thaws frozen food, and no fluffball can resist fresh treats.
  COOKING: { FLUFF: 2, LEAF: 2, FROST: 2, FIRE: 0.5, WATER: 0.5, METAL: 0.5, COOKING: 0.5 },
  // Shatters ice and rock, tarnishes sparkle.
  METAL: { FROST: 2, ROCK: 2, LIGHT: 2, FIRE: 0.5, WATER: 0.5, LIGHTNING: 0.5, METAL: 0.5 },
  // Outsmarts brawlers and sludge; nothing much goes on inside a fluffy head; the dark can't be read.
  MIND: { BRAWL: 2, SLIME: 2, MIND: 0.5, METAL: 0.5, FLUFF: 0.5, DARKNESS: 0 },
  // Bowls over fluffballs, cracks rocks, punches out the dark and dents metal.
  BRAWL: { FLUFF: 2, ROCK: 2, DARKNESS: 2, METAL: 2, SLIME: 0.5, WINGED: 0.5, MIND: 0.5, LIGHT: 0.5 },
};

/**
 * The clean rock-paper-scissors triangles in CHART: in [A, B, C], A beats B, B beats C and C beats A
 * (each x2), and every reverse matchup is resisted (x0.5 or x0). The starter triangle comes first.
 */
export const TYPE_CYCLES: TypeId[][] = [
  ['FIRE', 'LEAF', 'WATER'],
  ['COOKING', 'LEAF', 'WATER'],
  ['FLUFF', 'MIND', 'BRAWL'],
  ['SLIME', 'LIGHTNING', 'WINGED'],
  ['BRAWL', 'DARKNESS', 'MIND'],
  ['SLIME', 'LEAF', 'EARTH'],
  ['ROCK', 'WINGED', 'BRAWL'],
  ['METAL', 'ROCK', 'FIRE'],
];

/** A display name for each entry of TYPE_CYCLES, same order. */
export const TYPE_CYCLE_NAMES: string[] = [
  'STARTER TRIANGLE', 'KITCHEN TRIANGLE', 'HUG TRIANGLE', 'STORM TRIANGLE',
  'SHADOW TRIANGLE', 'GARDEN TRIANGLE', 'MOUNTAIN TRIANGLE', 'FORGE TRIANGLE',
];

/** Multiplier of an attack of type `attack` against a defender with `defender` types (product over its types). */
export function effectiveness(attack: TypeId, defender: readonly TypeId[]): number {
  let m = 1;
  for (const d of defender) m *= CHART[attack][d] ?? 1;
  return m;
}
