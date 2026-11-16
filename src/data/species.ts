// The Dragondex: 38 dragon hamster species, in Dragondex order.
//
//   1-9    the three starter lines, FIRE / LEAF / WATER, evolving at 16 and 32 (BST ~315 -> ~405 -> ~530)
//   10-34  ten 2-stage lines (~290-330 -> ~485-500, evolving at 18-30) and five single-stage dragons (455-480)
//   35-36  the fossil line: TRICERATOT hatches from the dinosaur egg stolen in the first mission
//   37-38  the two legendaries (590-600), late mission rewards
//
// Every type is the primary type of at least two species; 12 of the 38 are dual-typed.
//
// Base stats (docs/POKEMON_RESEARCH.md section 2): base = weight * BST / 6, where the weights are the
// type's template (TYPES[type].template) for single-typed species and a 65/35 blend of the two
// templates for dual-typed ones, plus a small per-line tilt (+-0.15 on one or two stats, renormalised
// to 6.00). A line shares its tilt, so an evolution keeps its shape and scales it up (a stage that
// gains a second type picks up 35% of that type's template). tools/contenttest.ts checks that every
// single-typed species correlates > 0.5 with its template; all of them sit at 0.78 or higher.
//
// Learnsets: two level-1 moves, a first STAB attack by about level 10, a strong STAB by 30-40 and 1-3
// coverage moves. An evolution's learnset is its pre-evolution's (same levels) plus its own moves,
// including an evolution move at the evolve level, which evolve() teaches on the spot.
//
// Pokemon parallels are noted per line for the docs; every name and every line of lore is our own.
import type {
  DragonExtra, DragonVisual, HornStyle, MoveId, PatternStyle, SpeciesDef, SpeciesId, Stats, TailStyle, WingStyle,
} from './schema.ts';

type Learnset = SpeciesDef['learnset'];

/** Base stats in the usual order: HP, ATTACK, DEFENSE, SP. ATK, SP. DEF, SPEED. */
const st = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): Stats =>
  ({ hp, atk, def, spa, spd, spe });

/** A learnset from [level, move] pairs, sorted by level (entries on the same level keep their order). */
function moves(...entries: [number, MoveId][]): Learnset {
  return entries.map(([level, move]) => ({ level, move })).sort((a, b) => a.level - b.level);
}

/** An evolution's learnset: everything its pre-evolution learns, at the same levels, plus its own moves. */
function extend(base: Learnset, ...entries: [number, MoveId][]): Learnset {
  return [...base, ...moves(...entries)].sort((a, b) => a.level - b.level);
}

function vis(
  body: string, belly: string, accent: string, wing: string, eye: string, cheek: string, size: number, build: number,
  wings: WingStyle, horns: HornStyle, tail: TailStyle, pattern: PatternStyle, extras: DragonExtra[],
): DragonVisual {
  return { body, belly, accent, wing, eye, cheek, size, build, wings, horns, tail, pattern, extras };
}

// ---------------------------------------------------------------------------------------------
// Learnsets
// ---------------------------------------------------------------------------------------------

// FIRE starter line: mixed attacker, special-leaning; METAL claws and, once it flies, WINGED loops.
const EMBERPUFF_MOVES = moves(
  [1, 'nibble'], [1, 'squeak'], [5, 'cinder-sneeze'], [9, 'kindle-dash'], [13, 'hot-potato'],
  [20, 'blaze-roll'], [27, 'scissor-snip'], [34, 'bonfire-burp'], [43, 'overtoast'],
);
const CINDERCHUB_MOVES = extend(EMBERPUFF_MOVES, [16, 'campfire-ring'], [38, 'flare-dive']);
const INFERNIBBLE_MOVES = extend(CINDERCHUB_MOVES, [32, 'loop-de-loop'], [40, 'curl-up']);

// LEAF starter line: bulky special support with seeding, sleep, drain and healing; EARTH coverage
// for the FIRE and SLIME types that threaten it.
const SPROUTLING_MOVES = moves(
  [1, 'nibble'], [1, 'petal-puff'], [5, 'sap-sprout'], [9, 'vine-flick'], [13, 'snoozy-spores'],
  [18, 'sap-sip'], [24, 'mud-pie'], [30, 'sunsoak'], [36, 'blossom-blast'], [44, 'thorn-swipe'],
);
const HEDGEHAM_MOVES = extend(SPROUTLING_MOVES, [16, 'acorn-volley']);
const MOSSQUATCH_MOVES = extend(HEDGEHAM_MOVES, [32, 'cheek-stuff'], [40, 'mudslide']);

// WATER starter line: bulky special attacker with a priority jab, a pivot and FROST coverage.
const PUDDLEPAW_MOVES = moves(
  [1, 'scurry'], [1, 'splish-splash'], [5, 'soggy-socks'], [10, 'puddle-pounce'], [14, 'splash-n-dash'],
  [19, 'hot-spring'], [25, 'curl-up'], [31, 'polar-beam'], [37, 'geyser-gush'],
);
const RIPPLECHEEK_MOVES = extend(PUDDLEPAW_MOVES, [16, 'sink-swirl'], [42, 'hibernate']);
const SPLASHADON_MOVES = extend(RIPPLECHEEK_MOVES, [32, 'cannonball']);

// FLUFF line: the plain physical all-rounder; the final takes off and learns WINGED moves.
const FUZZLET_MOVES = moves(
  [1, 'nibble'], [1, 'squeak'], [4, 'scurry'], [8, 'pitter-pat'], [12, 'cheek-stuff'],
  [15, 'burrow-bump'], [21, 'whisker-swipe'], [27, 'hammy-hoedown'], [33, 'belly-flop'], [41, 'hibernate'],
);
const MARSHMALLORD_MOVES = extend(FUZZLET_MOVES, [18, 'homing-swoop'], [30, 'loop-de-loop'], [46, 'comet-dive']);

// EARTH line: physical tank with ROCK coverage and a mud bath to heal.
const TUNNELTOT_MOVES = moves(
  [1, 'scurry'], [1, 'dust-cloud'], [5, 'burrow-bump'], [10, 'gravel-gnaw'], [14, 'shovel-swipe'],
  [19, 'mud-bath'], [26, 'flex'], [32, 'tunnel-quake'], [40, 'crag-crash'],
);
const RUMBLETUM_MOVES = extend(TUNNELTOT_MOVES, [22, 'belly-flop'], [37, 'sand-trap']);

// COOKING line: the healer and buffer; LEAF and EARTH coverage for what resists COOKING.
const CRUMBKIN_MOVES = moves(
  [1, 'whisk-whack'], [1, 'pepper-puff'], [5, 'squeak'], [9, 'snack-time'], [14, 'warm-milk'],
  [19, 'sap-sip'], [25, 'secret-sauce'], [31, 'boiling-broth'], [38, 'comfort-soup'], [45, 'kitchen-sink'],
);
const GRANDMUFFIN_MOVES = extend(CRUMBKIN_MOVES, [24, 'rolling-pin'], [34, 'food-coma'], [41, 'mudslide']);

// WINGED line: fast physical hit-and-run; the final catches fire.
const FLITTERBIT_MOVES = moves(
  [1, 'scurry'], [1, 'wing-slap'], [6, 'fluster-flap'], [10, 'homing-swoop'], [14, 'preen'],
  [19, 'swoop-swap'], [24, 'night-nibble'], [30, 'loop-de-loop'], [38, 'clear-skies'], [45, 'comet-dive'],
);
const SWOOPERNOVA_MOVES = extend(FLITTERBIT_MOVES, [18, 'kindle-dash'], [36, 'flare-dive']);

// DARKNESS line: fast physical trickster with startles, traps and WINGED coverage for BRAWL.
const SPOOKUMS_MOVES = moves(
  [1, 'nibble'], [1, 'peekaboo'], [5, 'spooky-story'], [9, 'night-nibble'], [13, 'sneaky-scheme'],
  [18, 'jinx'], [23, 'homing-swoop'], [31, 'dusk-crunch'], [38, 'stink-eye'],
);
const GRIMSTER_MOVES = extend(SPOOKUMS_MOVES, [26, 'fluster-flap'], [44, 'loop-de-loop']);

// LIGHT single: special wall and healer; MIND coverage for the SLIME types that threaten it.
const HAMICORN_MOVES = moves(
  [1, 'twinkle-tap'], [1, 'glimmer'], [6, 'dizzy-sparkle'], [11, 'stardust'], [16, 'warm-glow'],
  [22, 'lullaby'], [28, 'glow-up'], [34, 'sunbeam'], [40, 'brainwave'], [46, 'rainbow-ray'],
);

// LIGHT/WINGED single: speedy special support with a LIGHTNING pivot.
const GLIMMERWING_MOVES = moves(
  [1, 'wing-slap'], [1, 'glimmer'], [5, 'breezy-puff'], [10, 'stardust'], [15, 'fluster-flap'],
  [21, 'preen'], [24, 'zip-zap'], [28, 'glow-up'], [33, 'sunbeam'], [39, 'tornado-twirl'], [45, 'clear-skies'],
);

// SLIME line: sticky status wall (goop, seeding, hex); the final soaks up WATER.
const BLOBBIT_MOVES = moves(
  [1, 'nibble'], [1, 'slime-spit'], [5, 'gooey-glomp'], [9, 'stink-cloud'], [13, 'mud-pie'],
  [17, 'leech-lick'], [23, 'sour-splat'], [29, 'curl-up'], [35, 'gloop-geyser'], [43, 'hibernate'],
);
const GOOLIATH_MOVES = extend(BLOBBIT_MOVES, [20, 'hot-spring'], [39, 'goo-hammer']);

// MIND single: special sweeper; BRAWL coverage for the DARKNESS and METAL types MIND cannot dent.
const SMARTYPAWS_MOVES = moves(
  [1, 'brain-bonk'], [1, 'thought-bubble'], [5, 'squeak'], [9, 'brain-fog'], [14, 'think-fast'],
  [19, 'daydream'], [25, 'counting-sheep'], [31, 'deep-thought'], [36, 'brainwave'], [43, 'chi-blast'],
);

// MIND/WATER single: slow, bulky special attacker with FROST coverage.
const THINKTANK_MOVES = moves(
  [1, 'splish-splash'], [1, 'thought-bubble'], [6, 'soggy-socks'], [11, 'think-fast'], [16, 'sink-swirl'],
  [21, 'daydream'], [27, 'hot-spring'], [33, 'brainwave'], [38, 'polar-beam'], [44, 'geyser-gush'],
);

// BRAWL line: physical wallbreaker; DARKNESS and LIGHTNING coverage for MIND, LIGHT and WINGED.
const SCRAPPLING_MOVES = moves(
  [1, 'boop'], [1, 'paw-jab'], [5, 'startle'], [9, 'flex'], [13, 'tough-it-out'],
  [18, 'burrow-toss'], [23, 'lunch-punch'], [29, 'dusk-crunch'], [35, 'haymaker'], [42, 'all-out-brawl'],
);
const CHAMPSTER_MOVES = extend(SCRAPPLING_MOVES, [24, 'hammy-hoedown'], [38, 'bolt-bonk']);

// ROCK single: hard-hitting wall; EARTH for METAL, DARKNESS bites.
const GRANITOOTH_MOVES = moves(
  [1, 'nibble'], [1, 'gravel-gnaw'], [6, 'pebble-flick'], [11, 'stonewall'], [16, 'pebble-pelt'],
  [22, 'shovel-swipe'], [28, 'dusk-crunch'], [34, 'crag-crash'], [40, 'hibernate'], [46, 'boulder-bonk'],
);

// LIGHTNING line: fast special glass cannon with FROST coverage for LEAF and EARTH; the final turns METAL.
const STATICKLE_MOVES = moves(
  [1, 'scurry'], [1, 'tingle-zap'], [5, 'static-cuddle'], [9, 'fizz-nip'], [13, 'wheel-spin'],
  [18, 'zip-zap'], [23, 'flurry-puff'], [31, 'thunder-squeak'], [44, 'megawatt'],
);
const DYNAMUNCH_MOVES = extend(STATICKLE_MOVES, [26, 'magnet-hum'], [35, 'chrome-cannon']);

// METAL line: armoured physical wall with EARTH coverage; the final gets rocket fists (BRAWL).
const CLANKLET_MOVES = moves(
  [1, 'cog-nip'], [1, 'squeaky-hinge'], [5, 'rivet-rap'], [10, 'tin-dome'], [15, 'scissor-snip'],
  [20, 'tune-up'], [26, 'shovel-swipe'], [34, 'anvil-drop'], [42, 'cheek-stuff'],
);
const MECHAMSTER_MOVES = extend(CLANKLET_MOVES, [30, 'haymaker'], [45, 'all-out-brawl']);

// FROST line: big-HP bruiser with EARTH coverage for FIRE and METAL; the final takes to the sea.
const BRRRITO_MOVES = moves(
  [1, 'nibble'], [1, 'flurry-puff'], [5, 'chilly-nip'], [9, 'frost-flick'], [13, 'cold-shoulder'],
  [17, 'snowballs'], [22, 'burrow-bump'], [27, 'curl-up'], [34, 'glacier-slam'], [41, 'brain-freeze'],
);
const GLACIATOR_MOVES = extend(BRRRITO_MOVES, [28, 'splash-n-dash'], [38, 'polar-beam'], [46, 'cannonball']);

// Fossil line (ROCK/EARTH): slow physical wall with two strong STABs; big jaws for MIND and LIGHT.
const TRICERATOT_MOVES = moves(
  [1, 'nibble'], [1, 'gravel-gnaw'], [5, 'burrow-bump'], [9, 'stonewall'], [13, 'pebble-pelt'],
  [18, 'shovel-swipe'], [24, 'curl-up'], [33, 'crag-crash'], [41, 'tunnel-quake'],
);
const TRICERAMPAGE_MOVES = extend(TRICERATOT_MOVES, [30, 'boulder-bonk'], [37, 'dusk-crunch']);

// Legendaries.
const SUNSEEDRA_MOVES = moves(
  [1, 'glimmer'], [1, 'cinder-sneeze'], [7, 'seed-spit'], [14, 'stardust'], [21, 'sunsoak'],
  [28, 'bonfire-burp'], [34, 'blossom-blast'], [40, 'sunbeam'], [46, 'glow-up'], [50, 'rainbow-ray'],
);
const MOONMUNCH_MOVES = moves(
  [1, 'thought-bubble'], [1, 'night-nibble'], [7, 'counting-sheep'], [14, 'jinx'], [21, 'daydream'],
  [28, 'brainwave'], [34, 'nightfall'], [40, 'chi-blast'], [46, 'deep-thought'], [50, 'cheek-cannon'],
);

// ---------------------------------------------------------------------------------------------
// The Dragondex
// ---------------------------------------------------------------------------------------------

export const SPECIES: SpeciesDef[] = [
  // ---- 1-3: FIRE starter line (parallel: Charmander, Charmeleon, Charizard) ----------------------
  {
    id: 'emberpuff', dex: 1, name: 'Emberpuff', category: 'Ember Hamster', types: ['FIRE'],
    baseStats: st(44, 57, 42, 65, 47, 57),
    abilities: ['kindle'], hiddenAbility: 'kindling-belly',
    learnset: EMBERPUFF_MOVES,
    evolvesTo: { species: 'cinderchub', level: 16 },
    backstory: 'Emberpuff keeps a tiny ember glowing in the tip of its tail and fusses over it like a pet. It nests in warm chimney corners and toasts sunflower seeds for breakfast with one careful puff. When it sneezes, sparks fly out, so it always says sorry first.',
    fact: 'Its tail ember is exactly as warm as a mug of cocoa.',
    height: '0.2 m', weight: '0.4 kg', favoriteFood: 'seeds', rarity: 'starter', baseXp: 62,
    visual: vis('#f07a3a', '#ffe2a8', '#ffcf3a', '#ff9e4a', '#2a1410', '#ff6f7a', 0.8, 0.15, 'stubby', 'nubs', 'flame', 'none', []),
  },
  {
    id: 'cinderchub', dex: 2, name: 'Cinderchub', category: 'Cinder Hamster', types: ['FIRE'],
    baseStats: st(58, 74, 54, 85, 61, 74),
    abilities: ['kindle'], hiddenAbility: 'kindling-belly',
    learnset: CINDERCHUB_MOVES,
    evolvesFrom: 'emberpuff', evolvesTo: { species: 'infernibble', level: 32 },
    backstory: 'Cinderchub stores glowing cinders in its cheek pouches the way other hamsters store seeds. It naps on the warm bricks behind bakery ovens and gets very grumpy when the bakers go home. Its little flame wings flap like mad, but they are still a few sizes too small to fly.',
    fact: 'Its cheeks hold enough cinders to toast forty marshmallows at once.',
    height: '0.5 m', weight: '3.2 kg', favoriteFood: 'seeds', rarity: 'starter', baseXp: 142,
    visual: vis('#e85e2c', '#ffd896', '#ffc02e', '#ff8a3a', '#2a1008', '#ff6a6a', 1.05, 0.35, 'flame', 'curved', 'flame', 'speckles', ['tuft']),
  },
  {
    id: 'infernibble', dex: 3, name: 'Infernibble', category: 'Inferno Hamster', types: ['FIRE'],
    baseStats: st(75, 97, 71, 110, 80, 97),
    abilities: ['kindle'], hiddenAbility: 'kindling-belly',
    learnset: INFERNIBBLE_MOVES,
    evolvesFrom: 'cinderchub',
    backstory: 'Infernibble finally took off on wings of pure flame and has been showing off ever since. It loops around volcano rims at sunset and roasts its carrots with a single breath. For all its blaze, it always lets small friends warm their paws by its tail.',
    fact: 'It can melt a snowman from across the street, then it apologises to the snowman.',
    height: '1.1 m', weight: '24.0 kg', favoriteFood: 'carrot', rarity: 'starter', baseXp: 263,
    visual: vis('#d9482b', '#ffd08a', '#ffb52e', '#ff7a2e', '#2a0e0a', '#ff6f6f', 1.4, 0.55, 'flame', 'flame', 'flame', 'scales', ['aura']),
  },

  // ---- 4-6: LEAF starter line (parallel: Bulbasaur, Ivysaur, Venusaur) ---------------------------
  {
    id: 'sproutling', dex: 4, name: 'Sproutling', category: 'Sprout Hamster', types: ['LEAF'],
    baseStats: st(50, 50, 56, 64, 58, 40),
    abilities: ['sprout-heart'], hiddenAbility: 'sneezy-spores',
    learnset: SPROUTLING_MOVES,
    evolvesTo: { species: 'hedgeham', level: 16 },
    backstory: "A seedling sprouts from Sproutling's head, and it waters it every morning with a drop of dew. It lives in sunny vegetable patches and only nibbles the carrot tops that have already fallen off. On cloudy days it stands very still and pretends to be a radish.",
    fact: 'Its sprout grows a tiny bit taller every time someone praises it.',
    height: '0.2 m', weight: '0.5 kg', favoriteFood: 'carrot', rarity: 'starter', baseXp: 64,
    visual: vis('#8fd060', '#f4f0c0', '#4f9a2e', '#b8e888', '#1a2a10', '#ff8f9a', 0.78, 0.05, 'leaf', 'sprout', 'leaf', 'none', []),
  },
  {
    id: 'hedgeham', dex: 5, name: 'Hedgeham', category: 'Hedge Hamster', types: ['LEAF'],
    baseStats: st(64, 64, 71, 81, 74, 51),
    abilities: ['sprout-heart'], hiddenAbility: 'sneezy-spores',
    learnset: HEDGEHAM_MOVES,
    evolvesFrom: 'sproutling', evolvesTo: { species: 'mossquatch', level: 32 },
    backstory: 'Hedgeham hides in garden hedges, and its leafy coat makes it invisible until it starts giggling. It buries acorns everywhere it goes, forgets where, and that is how new woods begin. Little flowers pop open along its back whenever it is happy.',
    fact: 'Gardeners trim around a sleeping Hedgeham very, very carefully.',
    height: '0.5 m', weight: '3.8 kg', favoriteFood: 'berries', rarity: 'starter', baseXp: 141,
    visual: vis('#6cb848', '#eef0b8', '#3a7a26', '#a0d870', '#16260e', '#ff8f9a', 1.05, 0.25, 'leaf', 'sprout', 'leaf', 'spots', ['flowers']),
  },
  {
    id: 'mossquatch', dex: 6, name: 'Mossquatch', category: 'Grove Hamster', types: ['LEAF'],
    baseStats: st(83, 83, 92, 105, 96, 66),
    abilities: ['sprout-heart'], hiddenAbility: 'sneezy-spores',
    learnset: MOSSQUATCH_MOVES,
    evolvesFrom: 'hedgeham',
    backstory: 'Mossquatch is so big and so mossy that hikers often sit down on it for a picnic. It wanders the deep woods in total silence, and its huge pawprints sprout clover overnight. Birds nest in its antlers, and it refuses to move until every chick has flown.',
    fact: 'No photo of a Mossquatch has ever been in focus, because it keeps waving.',
    height: '1.3 m', weight: '41.0 kg', favoriteFood: 'carrot', rarity: 'starter', baseXp: 263,
    visual: vis('#4f9a3a', '#e4e8a8', '#2a5e20', '#86c860', '#14240e', '#ff8f9a', 1.42, 0.35, 'leaf', 'antlers', 'leaf', 'patches', ['flowers', 'whiskersLong']),
  },

  // ---- 7-9: WATER starter line (parallel: Squirtle, Wartortle, Blastoise) ------------------------
  {
    id: 'puddlepaw', dex: 7, name: 'Puddlepaw', category: 'Puddle Hamster', types: ['WATER'],
    baseStats: st(58, 44, 58, 58, 55, 42),
    abilities: ['tidal-heart'], hiddenAbility: 'sponge-cheeks',
    learnset: PUDDLEPAW_MOVES,
    evolvesTo: { species: 'ripplecheek', level: 16 },
    backstory: 'Puddlepaw cannot walk past a puddle without jumping in it, and then jumping in it again. It lives by garden ponds and blows bubbles out of its cheeks to say hello. It loves bath time, which makes it a very unusual hamster indeed.',
    fact: 'Each of its cheeks holds a whole thimble of water.',
    height: '0.2 m', weight: '0.5 kg', favoriteFood: 'berries', rarity: 'starter', baseXp: 63,
    visual: vis('#6ab8f0', '#e8f6ff', '#2f6fc8', '#a0dcff', '#10203a', '#ff9ab8', 0.8, 0.2, 'fin', 'none', 'fin', 'none', ['bubbles']),
  },
  {
    id: 'ripplecheek', dex: 8, name: 'Ripplecheek', category: 'Ripple Hamster', types: ['WATER'],
    baseStats: st(74, 57, 74, 74, 71, 54),
    abilities: ['tidal-heart'], hiddenAbility: 'sponge-cheeks',
    learnset: RIPPLECHEEK_MOVES,
    evolvesFrom: 'puddlepaw', evolvesTo: { species: 'splashadon', level: 32 },
    backstory: 'Ripplecheek swims laps of the town fountain at dawn, drumming the water with its paws to make ripples. It squirts water from its cheeks at anyone who looks thirsty, whether they asked or not. Its fins grow a little longer every time it races a goldfish and wins.',
    fact: 'Its record is twelve laps of the town fountain before breakfast.',
    height: '0.5 m', weight: '3.6 kg', favoriteFood: 'berries', rarity: 'starter', baseXp: 142,
    visual: vis('#4a9ae0', '#dcf0ff', '#1d5aa0', '#88ccf4', '#0e1a30', '#ff8fb0', 1.08, 0.45, 'fin', 'nubs', 'fin', 'speckles', ['bubbles']),
  },
  {
    id: 'splashadon', dex: 9, name: 'Splashadon', category: 'Tidal Hamster', types: ['WATER'],
    baseStats: st(97, 75, 97, 97, 93, 71),
    abilities: ['tidal-heart'], hiddenAbility: 'sponge-cheeks',
    learnset: SPLASHADON_MOVES,
    evolvesFrom: 'ripplecheek',
    backstory: 'Splashadon guards the river mouth with a shell on its back hard enough to stop a rowing boat. One belly flop makes a wave big enough to surf, and young Puddlepaws ride it for free. It snacks on the cheese the fishermen leave out and frowns at anyone who litters.',
    fact: 'One of its splashes can fill a paddling pool. Twice.',
    height: '1.2 m', weight: '38.5 kg', favoriteFood: 'cheese', rarity: 'starter', baseXp: 265,
    visual: vis('#2f7fd0', '#cfeeff', '#16488a', '#7cc8f0', '#0e1a30', '#ff8fb0', 1.45, 0.7, 'fin', 'curved', 'fin', 'scales', ['shell']),
  },

  // ---- 10-11: FLUFF line; the final takes off like a cotton cloud (parallel: Swablu line) ----------
  {
    id: 'fuzzlet', dex: 10, name: 'Fuzzlet', category: 'Fuzzball Hamster', types: ['FLUFF'],
    baseStats: st(66, 54, 42, 39, 47, 47),
    abilities: ['puffball-coat', 'little-paws'], hiddenAbility: 'lucky-whiskers',
    learnset: FUZZLET_MOVES,
    evolvesTo: { species: 'marshmallord', level: 18 },
    backstory: 'Fuzzlet is mostly fluff, and nobody is sure where the fluff stops and the hamster starts. Gangs of them tumble around city parks, squeaking at pigeons and pinching cheese crumbs from picnics. A good brushing makes it twice as big.',
    fact: 'Curled up, it looks exactly like a dandelion clock.',
    height: '0.2 m', weight: '0.2 kg', favoriteFood: 'cheese', rarity: 'common', baseXp: 55,
    visual: vis('#e8dccc', '#fffaf2', '#b89a88', '#fff4ea', '#2a1a1a', '#ff9ab0', 0.75, 0, 'stubby', 'none', 'stub', 'patches', ['tuft']),
  },
  {
    id: 'marshmallord', dex: 11, name: 'Marshmallord', category: 'Marshmallow Hamster', types: ['FLUFF', 'WINGED'],
    baseStats: st(101, 89, 69, 69, 74, 84),
    abilities: ['puffball-coat', 'little-paws'], hiddenAbility: 'lucky-whiskers',
    learnset: MARSHMALLORD_MOVES,
    evolvesFrom: 'fuzzlet',
    backstory: 'Marshmallord grew so soft and so light that it floats off the ground whenever it yawns. It drifts over the rooftops like a little cloud, keeping a watchful eye on the Fuzzlets below. It insists that everyone call it Lord, but it gives hugs to anyone who asks nicely.',
    fact: 'It stays well away from campfires, for obvious reasons.',
    height: '0.9 m', weight: '1.5 kg', favoriteFood: 'berries', rarity: 'common', baseXp: 232,
    visual: vis('#f8f0e8', '#ffffff', '#e0a8c4', '#e4e8ff', '#2a1a24', '#ff8ab0', 1.3, 0.1, 'cloud', 'nubs', 'feather', 'none', ['crown']),
  },

  // ---- 12-13: EARTH line (parallel: Phanpy, Donphan) --------------------------------------------
  {
    id: 'tunneltot', dex: 12, name: 'Tunneltot', category: 'Tunnel Hamster', types: ['EARTH'],
    baseStats: st(58, 71, 61, 36, 43, 36),
    abilities: ['dune-power', 'muddy-fur'], hiddenAbility: 'dirt-snacker',
    learnset: TUNNELTOT_MOVES,
    evolvesTo: { species: 'rumbletum', level: 22 },
    backstory: 'Tunneltot starts digging the moment it wakes up and has never once used a front door. It wears its goggles everywhere, even in bed, in case it needs to dig in its dreams. Its tunnels are so twisty that it often bumps into itself coming the other way.',
    fact: 'It can dig a tunnel as long as a football pitch in one afternoon.',
    height: '0.2 m', weight: '0.6 kg', favoriteFood: 'carrot', rarity: 'common', baseXp: 58,
    visual: vis('#c8a070', '#f4e4c8', '#8a6440', '#e0c098', '#20140a', '#f09a8a', 0.8, 0.3, 'stubby', 'nubs', 'spike', 'speckles', ['goggles']),
  },
  {
    id: 'rumbletum', dex: 13, name: 'Rumbletum', category: 'Rumble Hamster', types: ['EARTH'],
    baseStats: st(94, 114, 98, 57, 69, 57),
    abilities: ['dune-power', 'muddy-fur'], hiddenAbility: 'dirt-snacker',
    learnset: RUMBLETUM_MOVES,
    evolvesFrom: 'tunneltot',
    backstory: 'When Rumbletum gets hungry, its tummy rumbles so loudly that the ground shakes for miles. It lives deep under old railway hills and eats carrots by the wheelbarrow. Scientists once reported its snack time as an earthquake.',
    fact: "The museum's earthquake detector has a sticky note on it: probably just Rumbletum.",
    height: '1.0 m', weight: '52.0 kg', favoriteFood: 'carrot', rarity: 'common', baseXp: 236,
    visual: vis('#a8784a', '#f0dcb8', '#6a4628', '#d0a678', '#24160c', '#f08a7a', 1.3, 0.05, 'stubby', 'curved', 'club', 'patches', ['goggles', 'tuft']),
  },

  // ---- 14-15: COOKING line (parallel: Happiny, Chansey and the cream Alcremie line) ---------------
  {
    id: 'crumbkin', dex: 14, name: 'Crumbkin', category: 'Crumb Hamster', types: ['COOKING'],
    baseStats: st(65, 35, 50, 47, 65, 38),
    abilities: ['second-helping', 'oven-mitts'], hiddenAbility: 'salt-crust',
    learnset: CRUMBKIN_MOVES,
    evolvesTo: { species: 'grandmuffin', level: 24 },
    backstory: 'Crumbkin follows the smell of baking into every kitchen in town and sweeps up the crumbs with its whisk tail. It bakes seed biscuits so small that a dozen fit in one cheek. If you look sad, it will quietly leave one next to you.',
    fact: "Its chef's hat is a folded paper cupcake case.",
    height: '0.2 m', weight: '0.4 kg', favoriteFood: 'seeds', rarity: 'common', baseXp: 58,
    visual: vis('#f2c48a', '#fff6ea', '#c86a2a', '#ffe0b8', '#2a1418', '#ff7a8a', 0.78, 0, 'stubby', 'none', 'whisk', 'speckles', ['chefHat']),
  },
  {
    id: 'grandmuffin', dex: 15, name: 'Grandmuffin', category: 'Baker Hamster', types: ['COOKING'],
    baseStats: st(106, 57, 82, 78, 106, 61),
    abilities: ['second-helping', 'oven-mitts'], hiddenAbility: 'salt-crust',
    learnset: GRANDMUFFIN_MOVES,
    evolvesFrom: 'crumbkin',
    backstory: 'Grandmuffin runs a tiny bakery inside a hollow oak and has never let a single visitor leave hungry. It tucks tired dragons into its warm apron, feeds them soup and will not take no for an answer. It still remembers the birthday of every Crumbkin it ever taught to bake.',
    fact: 'Its secret soup recipe is extra love and a great deal of cheese.',
    height: '0.8 m', weight: '14.5 kg', favoriteFood: 'cheese', rarity: 'common', baseXp: 240,
    visual: vis('#e0a060', '#fff2e4', '#b0502a', '#ffd8b0', '#2a1418', '#ff6a7a', 1.3, 0, 'cloud', 'nubs', 'whisk', 'patches', ['chefHat', 'apron', 'scarf']),
  },

  // ---- 16-17: WINGED line; the final catches fire (parallel: Fletchling, Talonflame) --------------
  {
    id: 'flitterbit', dex: 16, name: 'Flitterbit', category: 'Flutter Hamster', types: ['WINGED'],
    baseStats: st(41, 53, 41, 46, 41, 68),
    abilities: ['lucky-feather', 'night-owl'], hiddenAbility: 'updraft',
    learnset: FLITTERBIT_MOVES,
    evolvesTo: { species: 'swoopernova', level: 18 },
    backstory: 'Flitterbit zips from washing line to washing line so fast that it looks like a blur with a squeak. It lives in rooftop gutters and eats the seeds that fall from bird feeders, which annoys the birds a lot. It cannot hover yet, so it simply never stops flapping.',
    fact: 'It has been timed going faster than a paper aeroplane in a gale.',
    height: '0.2 m', weight: '0.2 kg', favoriteFood: 'seeds', rarity: 'common', baseXp: 55,
    visual: vis('#9aa8f0', '#ffffff', '#f0c040', '#e4e8ff', '#14203a', '#ff9ab0', 0.75, 0.6, 'feather', 'none', 'feather', 'none', ['tuft']),
  },
  {
    id: 'swoopernova', dex: 17, name: 'Swoopernova', category: 'Comet Hamster', types: ['WINGED', 'FIRE'],
    baseStats: st(67, 89, 69, 85, 70, 105),
    abilities: ['lucky-feather', 'night-owl'], hiddenAbility: 'updraft',
    learnset: SWOOPERNOVA_MOVES,
    evolvesFrom: 'flitterbit',
    backstory: 'Swoopernova flies so fast that its feathers catch fire, leaving a glowing streak across the night sky. It nests on the very top of the Sky Tower and races the sunrise every morning. People who spot its streak make a wish, and it secretly tries to grant them.',
    fact: 'It has worn goggles ever since it flew straight into a raincloud.',
    height: '0.9 m', weight: '6.8 kg', favoriteFood: 'dragonfruit', rarity: 'common', baseXp: 234,
    visual: vis('#6a74d8', '#ffe8c8', '#ff8a2a', '#ffb060', '#14203a', '#ff8a8a', 1.3, 0.85, 'feather', 'flame', 'star', 'stripes', ['goggles', 'scarf']),
  },

  // ---- 18-19: DARKNESS line (parallel: Sneasel, Weavile) ----------------------------------------
  {
    id: 'spookums', dex: 18, name: 'Spookums', category: 'Spook Hamster', types: ['DARKNESS'],
    baseStats: st(48, 71, 46, 46, 38, 56),
    abilities: ['spooky-glare', 'mischief-maker'], hiddenAbility: 'victory-strut',
    learnset: SPOOKUMS_MOVES,
    evolvesTo: { species: 'grimster', level: 26 },
    backstory: 'Spookums hides in dark cupboards and jumps out shouting BOO, then giggles so much that nobody is ever scared. It sleeps upside down on coat hooks and sneaks blueberries at midnight. Its glowing yellow eyes make a handy night light.',
    fact: 'It once spooked itself in a mirror and hid for three days.',
    height: '0.3 m', weight: '0.4 kg', favoriteFood: 'berries', rarity: 'uncommon', baseXp: 60,
    visual: vis('#5a4a7a', '#9a8ab8', '#e04a6a', '#3a2e58', '#ffd84a', '#e05a8a', 0.8, 0.4, 'bat', 'nubs', 'spike', 'none', ['mask']),
  },
  {
    id: 'grimster', dex: 19, name: 'Grimster', category: 'Gloom Hamster', types: ['DARKNESS'],
    baseStats: st(78, 114, 73, 73, 61, 90),
    abilities: ['spooky-glare', 'mischief-maker'], hiddenAbility: 'victory-strut',
    learnset: GRIMSTER_MOVES,
    evolvesFrom: 'spookums',
    backstory: 'Grimster prowls the Natural History Museum after closing time, telling ghost stories to the dinosaur skeletons. It glares at strangers with burning yellow eyes, but really it is just very shy. It eats dragonfruit because it is the spookiest-looking fruit, and it still loves a good BOO.',
    fact: 'Every owl in town rates its spooky stories five stars.',
    height: '0.9 m', weight: '9.5 kg', favoriteFood: 'dragonfruit', rarity: 'uncommon', baseXp: 238,
    visual: vis('#433861', '#7a6a98', '#c8203a', '#2a2040', '#ffd84a', '#d04a7a', 1.3, 0.65, 'bat', 'curved', 'spike', 'stripes', ['mask', 'aura']),
  },

  // ---- 20: LIGHT single (parallel: Clefable and Galarian Ponyta as a special wall) -----------------
  {
    id: 'hamicorn', dex: 20, name: 'Hamicorn', category: 'Unicorn Hamster', types: ['LIGHT'],
    baseStats: st(74, 59, 71, 102, 102, 63),
    abilities: ['fresh-sparkle', 'halo-glow'], hiddenAbility: 'glitterize',
    learnset: HAMICORN_MOVES,
    backstory: "Hamicorn's horn glows a soft pink that mends scraped knees and grumpy moods alike. It grazes in moonlit meadows and eats only blueberries that are still sparkling with dew. Seeing one is said to bring a whole week of good luck.",
    fact: 'Its horn glows brighter whenever someone nearby says thank you.',
    height: '0.6 m', weight: '5.5 kg', favoriteFood: 'berries', rarity: 'rare', baseXp: 172,
    visual: vis('#fff0f8', '#ffffff', '#ff8ac4', '#ffe0f0', '#3a1a30', '#ffa0c0', 1.1, 0.4, 'none', 'unicorn', 'star', 'swirl', ['sparkles', 'tuft']),
  },

  // ---- 21: LIGHT/WINGED single (parallel: Togekiss) ----------------------------------------------
  {
    id: 'glimmerwing', dex: 21, name: 'Glimmerwing', category: 'Lantern Hamster', types: ['LIGHT', 'WINGED'],
    baseStats: st(72, 66, 64, 84, 87, 82),
    abilities: ['glitterize', 'raring-to-go'], hiddenAbility: 'updraft',
    learnset: GLIMMERWING_MOVES,
    backstory: 'Glimmerwing flutters around streetlamps on summer nights with its tail glowing like a tiny lantern. It guides lost hamsters home and accepts sunflower seeds as a tip. When it is really happy, its little halo spins.',
    fact: 'A dozen Glimmerwings can light up a whole garden party.',
    height: '0.4 m', weight: '0.9 kg', favoriteFood: 'seeds', rarity: 'uncommon', baseXp: 162,
    visual: vis('#ffd8ec', '#fff8e0', '#ffd040', '#fff4b0', '#3a2a10', '#ffa0a0', 1.0, 0.7, 'feather', 'antenna', 'feather', 'speckles', ['halo', 'sparkles']),
  },

  // ---- 22-23: SLIME line; the final soaks up WATER (parallel: Grimer, Muk; Toxapex) --------------
  {
    id: 'blobbit', dex: 22, name: 'Blobbit', category: 'Blob Hamster', types: ['SLIME'],
    baseStats: st(61, 47, 49, 47, 59, 32),
    abilities: ['goo-prickles', 'tacky-coat'], hiddenAbility: 'goo-shed',
    learnset: BLOBBIT_MOVES,
    evolvesTo: { species: 'gooliath', level: 20 },
    backstory: 'Blobbit is a wobbly hamster made mostly of friendly goo, and it leaves a sticky trail wherever it bounces. It lives under park benches and adores the stinkiest cheese it can find. Nobody has ever hugged one without getting stuck for an hour.',
    fact: 'It can squeeze through a keyhole, and frequently does.',
    height: '0.2 m', weight: '1.1 kg', favoriteFood: 'cheese', rarity: 'common', baseXp: 56,
    visual: vis('#a8d850', '#eaf8c0', '#6a9a20', '#c8ec80', '#1e2a10', '#ff8fb0', 0.75, 0, 'none', 'antenna', 'drip', 'spots', ['drips']),
  },
  {
    id: 'gooliath', dex: 23, name: 'Gooliath', category: 'Goo Hamster', types: ['SLIME', 'WATER'],
    baseStats: st(101, 79, 83, 79, 94, 55),
    abilities: ['goo-prickles', 'tacky-coat'], hiddenAbility: 'goo-shed',
    learnset: GOOLIATH_MOVES,
    evolvesFrom: 'blobbit',
    backstory: 'Gooliath soaked up so many puddles under the Moonlight Docks that it swelled into a giant, jiggly blob. Boats steer around it, and crabs live inside it like a gooey block of flats. It is a gentle giant that only gets cross when someone pokes a Blobbit.',
    fact: 'It weighs about as much as a bathtub full of jelly.',
    height: '1.4 m', weight: '88.0 kg', favoriteFood: 'cheese', rarity: 'common', baseXp: 236,
    visual: vis('#7ab838', '#d8f0b0', '#3a8ac8', '#a8d8f0', '#1e2a10', '#ff8fb0', 1.4, 0.05, 'fin', 'antenna', 'drip', 'spots', ['drips', 'bubbles']),
  },

  // ---- 24: MIND single (parallel: Alakazam, Espeon) ---------------------------------------------
  {
    id: 'smartypaws', dex: 24, name: 'Smartypaws', category: 'Brainy Hamster', types: ['MIND'],
    baseStats: st(66, 58, 70, 112, 89, 70),
    abilities: ['big-brain', 'deep-focus'], hiddenAbility: 'head-in-clouds',
    learnset: SMARTYPAWS_MOVES,
    backstory: 'Smartypaws has read every book in the library, then read them all again upside down in case they made more sense. It wears a monocle it does not need and calls dragonfruit brain food. When it thinks really hard, its fur floats.',
    fact: 'It beat a chess computer once, then stayed to cheer it up.',
    height: '0.4 m', weight: '2.4 kg', favoriteFood: 'dragonfruit', rarity: 'uncommon', baseXp: 168,
    visual: vis('#c890e8', '#f6e4ff', '#7a40b8', '#e8c4f8', '#200a30', '#ff7ab8', 1.05, 0.35, 'cloud', 'antenna', 'stub', 'swirl', ['monocle', 'bowtie']),
  },

  // ---- 25: MIND/WATER single (parallel: Slowbro) -------------------------------------------------
  {
    id: 'thinktank', dex: 25, name: 'Thinktank', category: 'Fishbowl Hamster', types: ['MIND', 'WATER'],
    baseStats: st(80, 59, 80, 98, 93, 69),
    abilities: ['sponge-cheeks', 'deep-focus'], hiddenAbility: 'big-brain',
    learnset: THINKTANK_MOVES,
    backstory: 'Thinktank wears an old fishbowl as a helmet and claims it helps it think deep thoughts. It lives by the aquarium at the City Zoo and gives the goldfish advice about life. Its ideas come out as bubbles, and the best ones pop with a little ding.',
    fact: 'Nobody knows how it gets the fishbowl on and off.',
    height: '0.6 m', weight: '7.2 kg', favoriteFood: 'berries', rarity: 'rare', baseXp: 175,
    visual: vis('#9a7ae0', '#e8e0ff', '#3a7ad0', '#a8d0f8', '#1a1040', '#ff8ac8', 1.15, 0.5, 'cloud', 'crystal', 'fin', 'swirl', ['bubbles', 'whiskersLong']),
  },

  // ---- 26-27: BRAWL line (parallel: Tyrogue, Hitmonchan) ----------------------------------------
  {
    id: 'scrappling', dex: 26, name: 'Scrappling', category: 'Scrapper Hamster', types: ['BRAWL'],
    baseStats: st(52, 80, 49, 34, 41, 54),
    abilities: ['tough-cookie', 'power-paws'], hiddenAbility: 'steady-stance',
    learnset: SCRAPPLING_MOVES,
    evolvesTo: { species: 'champster', level: 24 },
    backstory: 'Scrappling challenges everything to a boxing match, including its own shadow and one very confused sock. It trains on the hamster wheel at dawn and swears by crunchy carrots for strength. Win or lose, it always shakes paws afterwards.',
    fact: 'It won its headband for the most push-ups ever done by a hamster.',
    height: '0.3 m', weight: '0.9 kg', favoriteFood: 'carrot', rarity: 'common', baseXp: 60,
    visual: vis('#f2a49a', '#fff0e4', '#c82838', '#f8c8b8', '#2a140a', '#ff6a5a', 0.8, 0.3, 'stubby', 'nubs', 'club', 'none', ['scarf']),
  },
  {
    id: 'champster', dex: 27, name: 'Champster', category: 'Champion Hamster', types: ['BRAWL'],
    baseStats: st(83, 128, 78, 54, 66, 87),
    abilities: ['tough-cookie', 'power-paws'], hiddenAbility: 'steady-stance',
    learnset: CHAMPSTER_MOVES,
    evolvesFrom: 'scrappling',
    backstory: 'Champster has won every tournament in the Burrow League and keeps its tiny trophies in its cheeks. It coaches young Scrapplings for free and teaches them that real champions help each other up. Its punches are so fast that they whistle.',
    fact: 'Three gyms have banned its victory dance for being far too good.',
    height: '0.9 m', weight: '19.0 kg', favoriteFood: 'cheese', rarity: 'common', baseXp: 240,
    visual: vis('#e07a6a', '#fff0e4', '#b01e30', '#f4b0a0', '#2a140a', '#ff5a4a', 1.3, 0.45, 'none', 'curved', 'club', 'stripes', ['scarf', 'tuft']),
  },

  // ---- 28: ROCK single (parallel: Rampardos, Gigalith) ------------------------------------------
  {
    id: 'granitooth', dex: 28, name: 'Granitooth', category: 'Granite Hamster', types: ['ROCK'],
    baseStats: st(73, 107, 107, 50, 73, 50),
    abilities: ['hard-noggin', 'pebble-grit'], hiddenAbility: 'snack-stash',
    learnset: GRANITOOTH_MOVES,
    backstory: "Granitooth's front teeth are solid granite, and it crunches through rocks like crackers. It lives in old quarries, where it carves little statues of all its friends. To Granitooth, a crunchy carrot is wonderfully soft.",
    fact: 'Its dentist has to use a hammer and chisel.',
    height: '0.6 m', weight: '45.0 kg', favoriteFood: 'carrot', rarity: 'uncommon', baseXp: 165,
    visual: vis('#a8a078', '#e0dcc4', '#6a6440', '#c8c0a0', '#1a1614', '#e89a8a', 1.15, 0.2, 'none', 'crystal', 'club', 'spots', ['whiskersLong']),
  },

  // ---- 29-30: LIGHTNING line; the final turns METAL (parallel: Magnemite, Magnezone; Pikachu) ------
  {
    id: 'statickle', dex: 29, name: 'Statickle', category: 'Static Hamster', types: ['LIGHTNING'],
    baseStats: st(43, 40, 40, 68, 47, 63),
    abilities: ['staticky-fluff', 'wheel-runner'], hiddenAbility: 'battery-belly',
    learnset: STATICKLE_MOVES,
    evolvesTo: { species: 'dynamunch', level: 26 },
    backstory: "Statickle's fur is so full of static that socks stick to it as it scampers past. It runs on its hamster wheel all night to power its own night light, and it gets very cross if anyone unplugs it. Hugging one tickles and makes your hair stand on end.",
    fact: 'Its fluff crackles softly while it dreams.',
    height: '0.2 m', weight: '0.3 kg', favoriteFood: 'seeds', rarity: 'uncommon', baseXp: 60,
    visual: vis('#ffe050', '#fff8d0', '#3a3456', '#fff0a0', '#1a1420', '#ff6a5a', 0.78, 0.4, 'stubby', 'bolt', 'bolt', 'none', ['tuft']),
  },
  {
    id: 'dynamunch', dex: 30, name: 'Dynamunch', category: 'Dynamo Hamster', types: ['LIGHTNING', 'METAL'],
    baseStats: st(70, 73, 89, 95, 83, 84),
    abilities: ['staticky-fluff', 'wheel-runner'], hiddenAbility: 'battery-belly',
    learnset: DYNAMUNCH_MOVES,
    evolvesFrom: 'statickle',
    backstory: 'Dynamunch built a wheel out of scrap gears, and its running now powers a whole street of houses. Its cheeks are lined with copper, so every bite of dragonfruit gives off a little spark. The F.E.R.R.E.T. scientists would love to catch one and plug it in, but it is far too fast for them.',
    fact: 'One lap of its wheel can fully charge a phone.',
    height: '0.8 m', weight: '21.0 kg', favoriteFood: 'dragonfruit', rarity: 'uncommon', baseXp: 240,
    visual: vis('#f2c83a', '#fff2c0', '#5e7080', '#c6d4de', '#1a1420', '#ff6a5a', 1.3, 0.6, 'gear', 'bolt', 'bolt', 'stripes', ['goggles', 'sparkles']),
  },

  // ---- 31-32: METAL line; the final gets rocket fists (parallel: Aron line; Lucario's typing) -------
  {
    id: 'clanklet', dex: 31, name: 'Clanklet', category: 'Clank Hamster', types: ['METAL'],
    baseStats: st(47, 69, 88, 33, 61, 33),
    abilities: ['shiny-plating', 'iron-paws'], hiddenAbility: 'smithy-spirit',
    learnset: CLANKLET_MOVES,
    evolvesTo: { species: 'mechamster', level: 30 },
    backstory: 'Clanklet is covered in tiny metal plates that clink like wind chimes when it walks. It collects lost screws and bolts and polishes them every evening before bed. It gets rusty in the rain, so it carries an umbrella made from a bottle cap.',
    fact: 'You can hear a Clanklet coming from three rooms away.',
    height: '0.3 m', weight: '4.5 kg', favoriteFood: 'seeds', rarity: 'uncommon', baseXp: 62,
    visual: vis('#a8b4c4', '#e4eaf0', '#5a6a7e', '#ccd6e0', '#101820', '#f0a0a8', 0.85, 0.3, 'gear', 'antenna', 'club', 'scales', []),
  },
  {
    id: 'mechamster', dex: 32, name: 'Mechamster', category: 'Mecha Hamster', types: ['METAL', 'BRAWL'],
    baseStats: st(75, 116, 114, 49, 86, 60),
    abilities: ['shiny-plating', 'iron-paws'], hiddenAbility: 'smithy-spirit',
    learnset: MECHAMSTER_MOVES,
    evolvesFrom: 'clanklet',
    backstory: 'Mechamster rebuilt its plates into a full suit of armour with rocket-powered fists. It guards scrapyards at night and runs on engine oil and sunflower seeds, but mostly sunflower seeds. Inside all that steel is the same little Clanklet that loves polishing things.',
    fact: 'It can punch straight through a tin can, then it puts the can in the recycling.',
    height: '1.1 m', weight: '95.0 kg', favoriteFood: 'seeds', rarity: 'uncommon', baseXp: 245,
    visual: vis('#8494a8', '#d8e0ea', '#c03040', '#b8c4d0', '#101820', '#f0a0a8', 1.38, 0.5, 'gear', 'antenna', 'club', 'scales', ['shell']),
  },

  // ---- 33-34: FROST line; the final takes to the sea (parallel: Spheal, Walrein) ------------------
  {
    id: 'brrrito', dex: 33, name: 'Brrrito', category: 'Burrito Hamster', types: ['FROST'],
    baseStats: st(65, 59, 52, 54, 44, 36),
    abilities: ['snowcone-snack', 'icy-fur'], hiddenAbility: 'puffball-coat',
    learnset: BRRRITO_MOVES,
    evolvesTo: { species: 'glaciator', level: 28 },
    backstory: 'Brrrito is always chilly, so it wraps itself in a snowy blanket and rolls about like a burrito. It lives in snowdrifts and supermarket freezers and likes its blueberries frozen solid. Every sneeze leaves a tiny snowflake behind.',
    fact: 'Its snow blanket has never once been in the wash.',
    height: '0.3 m', weight: '0.8 kg', favoriteFood: 'berries', rarity: 'uncommon', baseXp: 60,
    visual: vis('#cdeef8', '#ffffff', '#3aa8c8', '#eefcff', '#14284a', '#ffa8c8', 0.8, 0, 'stubby', 'none', 'stub', 'stripes', ['scarf', 'frostBreath']),
  },
  {
    id: 'glaciator', dex: 34, name: 'Glaciator', category: 'Glacier Hamster', types: ['FROST', 'WATER'],
    baseStats: st(102, 91, 84, 85, 74, 59),
    abilities: ['snowcone-snack', 'icy-fur'], hiddenAbility: 'puffball-coat',
    learnset: GLACIATOR_MOVES,
    evolvesFrom: 'brrrito',
    backstory: 'Glaciator trains in the polar sea by wrestling icebergs, and the icebergs usually lose. Its armour is made of ice that never melts, not even in summer. It finally gave up its snowy blanket, but it keeps it folded under its pillow.',
    fact: 'Its battle cry can start an avalanche, so it mostly uses it to say good morning.',
    height: '1.2 m', weight: '60.0 kg', favoriteFood: 'cheese', rarity: 'uncommon', baseXp: 240,
    visual: vis('#a8e0f4', '#f4fcff', '#1a6a9c', '#d8f6ff', '#0e2238', '#ffa8c8', 1.4, 0.35, 'crystal', 'crystal', 'spike', 'speckles', ['frostBreath']),
  },

  // ---- 35-36: the fossil line, ROCK/EARTH (parallel: Rhyhorn's typing; the Tyrunt fossil line) -------
  {
    id: 'triceratot', dex: 35, name: 'Triceratot', category: 'Fossil Hamster', types: ['ROCK', 'EARTH'],
    baseStats: st(57, 74, 82, 32, 53, 37),
    abilities: ['pebble-grit', 'boulder-hide'], hiddenAbility: 'hard-noggin',
    learnset: TRICERATOT_MOVES,
    evolvesTo: { species: 'tricerampage', level: 30 },
    backstory: 'Triceratot hatched from the dinosaur egg that slept in the Natural History Museum for millions of years. It still carries half of its eggshell on its back and bonks into everything with its stubby horns. It munches crunchy carrots and roars, very squeakily, at anything that moves.',
    fact: 'It is millions of years old, but it was only born last week.',
    height: '0.3 m', weight: '6.0 kg', favoriteFood: 'carrot', rarity: 'rare', baseXp: 65,
    visual: vis('#b8a878', '#ece4c8', '#f4ecd8', '#d4c8a0', '#1a1410', '#f0a08a', 0.85, 0.3, 'none', 'nubs', 'club', 'spots', ['shell']),
  },
  {
    id: 'tricerampage', dex: 36, name: 'Tricerampage', category: 'Dinosaur Hamster', types: ['ROCK', 'EARTH'],
    baseStats: st(86, 111, 124, 48, 80, 56),
    abilities: ['pebble-grit', 'boulder-hide'], hiddenAbility: 'hard-noggin',
    learnset: TRICERAMPAGE_MOVES,
    evolvesFrom: 'triceratot',
    backstory: 'Tricerampage is the mightiest dragon hamster of the dinosaur age, back for a second go. It charges horns first through solid rock and leaves tunnels big enough for a bus. Every week it visits the museum to say hello to its skeleton cousins.',
    fact: "When it stomps, the museum's dinosaur bones rattle with joy.",
    height: '1.6 m', weight: '180.0 kg', favoriteFood: 'cheese', rarity: 'rare', baseXp: 250,
    visual: vis('#9a8a5a', '#e4dcb8', '#6a4220', '#c0b088', '#1a1410', '#f0a08a', 1.45, 0.4, 'stubby', 'curved', 'spike', 'scales', ['tuft']),
  },

  // ---- 37-38: the legendaries (parallel: Ho-Oh and Lugia; Solgaleo and Lunala) ---------------------
  {
    id: 'sunseedra', dex: 37, name: 'Sunseedra', category: 'Sun Hamster', types: ['LIGHT', 'FIRE'],
    baseStats: st(93, 82, 90, 132, 116, 87),
    abilities: ['glitterize'], hiddenAbility: 'velvet-cape',
    learnset: SUNSEEDRA_MOVES,
    backstory: 'Sunseedra is the legendary dragon hamster of the sun, with a mane of golden petals that shines like noon. Old burrow tales say it planted the very first sunflower, which is why every hamster loves seeds. It wakes the dawn each morning and naps through every cloudy day.',
    fact: 'Every sunflower in the field turns to watch it fly past.',
    height: '2.0 m', weight: '85.0 kg', favoriteFood: 'seeds', rarity: 'legendary', baseXp: 300,
    visual: vis('#ffcf5a', '#fff4d8', '#f06aa8', '#ffb04a', '#5a2a10', '#ff8a6a', 1.5, 0.6, 'feather', 'flame', 'star', 'swirl', ['halo', 'aura', 'flowers']),
  },
  {
    id: 'moonmunch', dex: 38, name: 'Moonmunch', category: 'Moon Hamster', types: ['MIND', 'DARKNESS'],
    baseStats: st(84, 94, 89, 117, 103, 103),
    abilities: ['head-in-clouds'], hiddenAbility: 'looming-aura',
    learnset: MOONMUNCH_MOVES,
    backstory: 'Moonmunch is the legendary dragon hamster of the night sky. Each night it nibbles a little more of the moon, which is made of cheese, and each month it feels guilty and puts it all back. Its sweet dreams drift down to every sleeping hamster in the world.',
    fact: 'Its only known weakness is a big warm hug.',
    height: '2.1 m', weight: '72.0 kg', favoriteFood: 'cheese', rarity: 'legendary', baseXp: 300,
    visual: vis('#3a3478', '#9a8ad8', '#ffd040', '#c8b4ff', '#fff4c0', '#ff8ac8', 1.5, 0.8, 'crystal', 'crystal', 'feather', 'speckles', ['crown', 'aura', 'sparkles']),
  },
];

/** The three starter choices (the player takes two): FIRE, LEAF, WATER first stages. */
export const STARTERS: SpeciesId[] = ['emberpuff', 'sproutling', 'puddlepaw'];
