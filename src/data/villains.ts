// The five villain organisations and their crews: 30 villains, six per org (a boss, a lieutenant
// and four minion kinds), in campaign order cheese -> crows -> snakes -> cats -> ferrets.
//
// How the numbers were made (docs/POKEMON_RESEARCH.md section 2.3 and docs/DESIGN.md "Missions"):
//   - Base stats = round(weight * BST / 6) from TYPES[type].template. Dual types blend the two
//     templates (60/40 for a clear primary type, 50/50 otherwise), then each villain gets a small
//     personal tilt of +-0.1 to 0.15 on one or two stats (portly bosses are slow, thieves are fast).
//   - BST by role and org order 1..5: minions about 290 / 325 / 360 / 395 / 430, lieutenants
//     420 / 445 / 470 / 495 / 520, bosses 500 / 525 / 550 / 575 / 600.
//   - baseXp: minions 55-65 rising by about 20 per org to 135-145; lieutenants 150-200; bosses
//     220-300. Coins rise the same way.
//   - Learnsets: an enemy of level L knows the last four entries at or below L, so every learnset
//     cycles through four roles in a fixed order (for example STAB, coverage, status, second STAB).
//     A new entry always pushes out the older move of the same role, so ANY level from 1 to 50
//     shows one move of each role. Weak moves come first; the 85-90 power moves arrive inside the
//     org's own level band (cheese 4-17, crows 12-25, snakes 19-32, cats 26-39, ferrets 33-48).
//   - Lieutenants and bosses always carry a coverage move that hits one of their own weaknesses
//     super effectively, so the obvious counter is never a free win.
import type {
  Animal, MoveId, OrgDef, OrgId, Outfit, Stats, VillainDef, VillainId, VillainProp, VillainVisual,
} from './schema.ts';

type Entry = [level: number, move: MoveId];

const learn = (...entries: Entry[]): VillainDef['learnset'] => entries.map(([level, move]) => ({ level, move }));

const stats = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): Stats =>
  ({ hp, atk, def, spa, spd, spe });

const look = (
  animal: Animal, body: string, belly: string, accent: string, eye: string,
  outfit: Outfit, outfitColor: string, prop: VillainProp, size: number,
): VillainVisual => ({ animal, body, belly, accent, eye, outfit, outfitColor, prop, size });

// ---------------------------------------------------------------------------------------------
// Organisations
// ---------------------------------------------------------------------------------------------

export const ORGS: Record<OrgId, OrgDef> = {
  cheese: {
    id: 'cheese',
    name: "The Big Cheese's Crew",
    short: 'Big Cheese Crew',
    order: 1,
    boss: 'big-cheese',
    motto: 'Grate minds steal alike.',
    description:
      'A mob of mice and rats who run every crumb racket in town, from the museum cafe to the docks deli. ' +
      'They tip their tiny hats and say thank you, then pinch your snacks anyway. ' +
      'Right now the whole crew is working on one very big, very eggy job.',
    lair: 'The Mouse Hole Lounge, a velvet speakeasy behind the museum skirting board',
    themeTypes: ['FLUFF', 'COOKING', 'EARTH'],
    emblem: '#f2c335',
    emblemAccent: '#3b2d4f',
  },
  crows: {
    id: 'crows',
    name: 'Caw-sa Nostra',
    short: 'Caw-sa Nostra',
    order: 2,
    boss: 'godfeather',
    motto: "If it glitters, it's ours.",
    description:
      'A flock of crows, magpies and pigeons who steal anything shiny: keys, coins, crowns and, very nearly, the moon. ' +
      'They rule the rooftops and the docks with a beak of iron and a strict no-scratches policy. ' +
      "Every caper ends with another heap of loot in the boss's nest.",
    lair: 'The Rookery, a nest of stolen shiny things on top of the Sky Tower',
    themeTypes: ['WINGED', 'DARKNESS', 'LIGHT'],
    emblem: '#a59cf0',
    emblemAccent: '#1d1830',
  },
  snakes: {
    id: 'snakes',
    name: 'The Sssyndicate',
    short: 'Sssyndicate',
    order: 3,
    boss: 'baron-von-hiss',
    motto: 'Look deep into our eyesss...',
    description:
      'A slippery ring of snakes, lizards and toads who hypnotise guards and smuggle stolen goods through the swamp. ' +
      'Their con artists can talk anyone into anything, and their smugglers hide treasure where nobody wants to look. ' +
      'Everything they touch ends up a little bit sticky.',
    lair: 'The Sunken Greenhouse, a steamy swamp hidden beneath the City Zoo',
    themeTypes: ['SLIME', 'MIND', 'LEAF'],
    emblem: '#7cd65a',
    emblemAccent: '#2e1f3a',
  },
  cats: {
    id: 'cats',
    name: 'The Alley Cat Cartel',
    short: 'Alley Cat Cartel',
    order: 4,
    boss: 'don-whiskerino',
    motto: 'Nine lives. Zero rules.',
    description:
      'The toughest tomcats in the city, who run the back alleys, the fish market and every warm rooftop. ' +
      'They settle arguments by arm-wrestling and knock things off tables just to watch them fall. ' +
      'If something goes missing near a sunny windowsill, they took it.',
    lair: 'The Fish Crate Club, a backstreet boxing gym by the Moonlight Docks',
    themeTypes: ['BRAWL', 'ROCK', 'FIRE'],
    emblem: '#f08a4a',
    emblemAccent: '#3a1a1e',
  },
  ferrets: {
    id: 'ferrets',
    name: 'F.E.R.R.E.T.',
    short: 'F.E.R.R.E.T.',
    order: 5,
    boss: 'dr-ferretstein',
    motto: "Tomorrow's evil, built today!",
    description:
      'The Furry Evil Robotics & Rodent Engineering Team: a lab full of mad ferret scientists, sneaky weasel engineers and clanking robots. ' +
      'They build freeze rays, lightning cannons and very bad robot butlers. ' +
      'Rumour has it every gang in the city buys its gadgets from them.',
    lair: 'Ferret Labs, a gleaming tower of beakers, cables and blinking buttons',
    themeTypes: ['METAL', 'LIGHTNING', 'FROST', 'WATER'],
    emblem: '#7ad8e8',
    emblemAccent: '#1e2433',
  },
};

// ---------------------------------------------------------------------------------------------
// Villains
// ---------------------------------------------------------------------------------------------

const INK_EYE = '#2a1a14';

const LIST: VillainDef[] = [
  // ==== THE BIG CHEESE'S CREW (org 1: FLUFF / COOKING / EARTH) ================================
  {
    id: 'big-cheese', name: 'The Big Cheese', org: 'cheese', role: 'boss', types: ['COOKING', 'FLUFF'],
    // COOKING 60 / FLUFF 40 at 500, tilted portly: +HP, -speed.
    baseStats: stats(115, 72, 76, 78, 94, 65), ability: 'snack-stash',
    // Weak to FIRE, WATER, WINGED, SLIME, BRAWL: mud flung at FIRE, parsley garnish at WATER.
    learnset: learn(
      [1, 'whisk-whack'], [1, 'mud-pie'], [1, 'squeak'], [1, 'petal-puff'],
      [13, 'rolling-pin'], [20, 'mudslide'], [26, 'secret-sauce'], [32, 'sap-sip'],
      [40, 'boiling-broth'], [47, 'kitchen-sink'],
    ),
    baseXp: 220, coins: 60,
    taunt: "Say cheese, agent! This omelette isn't going to cook itself.",
    defeat: "Curds and whey! This isn't over! To the mouse hole, boys!",
    description:
      'A portly mouse in a pinstripe suit and a hat made from a wedge of aged cheddar, which he nibbles when he gets nervous. ' +
      "He dreams of cooking the world's biggest omelette, and only a dinosaur egg is big enough. He has never once shared a cracker.",
    visual: look('mouse', '#a8968c', '#eee0d4', '#f2c335', '#3a2418', 'suit', '#383250', 'cheeseHat', 1.5),
  },
  {
    id: 'vinnie-grater', name: 'Vinnie Grater', org: 'cheese', role: 'lieutenant', types: ['EARTH', 'FLUFF'],
    // EARTH 60 / FLUFF 40 at 420, tilted towards ATTACK.
    baseStats: stats(83, 92, 74, 45, 67, 59), ability: 'puffball-coat',
    // Weak to WATER, LEAF, FROST, COOKING, BRAWL: chews live wires for WATER, grates LEAF and FROST.
    learnset: learn(
      [1, 'burrow-bump'], [1, 'fizz-nip'], [1, 'cheek-stuff'], [1, 'whisk-whack'],
      [11, 'shovel-swipe'], [18, 'bolt-bonk'], [25, 'hammy-hoedown'], [33, 'rolling-pin'],
      [41, 'tunnel-quake'], [48, 'wild-wheel'],
    ),
    baseXp: 150, coins: 30,
    taunt: "The boss says you're a problem. I solve problems. With a grater.",
    defeat: 'Ow, my whiskers! Boss, I need a sick day!',
    description:
      "The Big Cheese's right-hand rat and the toughest tunnel-digger in town. " +
      'He carries a cheese grater everywhere and grates on everybody\'s nerves. Secretly, he knits tiny scarves for the whole crew.',
    visual: look('rat', '#6a5c62', '#b9aaa8', '#cfd6de', '#9a2a2a', 'tracksuit', '#5b3f86', 'fedora', 1.2),
  },
  {
    id: 'crumb-snatcher', name: 'Crumb Snatcher', org: 'cheese', role: 'minion', types: ['FLUFF'],
    baseStats: stats(54, 51, 40, 37, 40, 58), ability: 'raring-to-go',
    learnset: learn(
      [1, 'nibble'], [1, 'squeak'], [1, 'scurry'], [1, 'cheek-stuff'],
      [10, 'whisker-swipe'], [16, 'sneaky-scheme'], [23, 'grumpy-chomp'], [30, 'hammy-hoedown'],
      [38, 'belly-flop'], [46, 'curl-up'],
    ),
    baseXp: 56, coins: 8,
    taunt: 'Ooh, is that a seed? Is that YOUR seed? Not anymore!',
    defeat: 'Aw, nuts! I dropped all my crumbs!',
    description:
      'A speedy little pickpocket mouse with a red bandana and very sticky paws. ' +
      'Its cheeks are always stuffed with stolen crumbs, so it talks like it has its mouth full. Because it does.',
    visual: look('mouse', '#b5967a', '#f2e2cc', '#d8483a', INK_EYE, 'bandana', '#d8483a', 'none', 0.9),
  },
  {
    id: 'tunnel-rat', name: 'Tunnel Rat', org: 'cheese', role: 'minion', types: ['EARTH'],
    baseStats: stats(57, 64, 59, 34, 42, 39), ability: 'dirt-snacker',
    learnset: learn(
      [1, 'burrow-bump'], [1, 'dust-cloud'], [1, 'gravel-gnaw'], [1, 'nibble'],
      [11, 'shovel-swipe'], [18, 'stonewall'], [25, 'pebble-pelt'], [32, 'crag-crash'],
      [40, 'tunnel-quake'], [47, 'mud-bath'],
    ),
    baseXp: 60, coins: 9,
    taunt: "You'll never find our secret tunnel. Wait. You're standing in it.",
    defeat: 'Cave-in! Everybody back to the burrow!',
    description:
      'A hard-hatted digger rat who has tunnelled under every bank, bakery and cheese shop in the city. ' +
      'It can chew through solid rock, but it still cannot find its own lunchbox.',
    visual: look('rat', '#7c6b5c', '#c7b6a2', '#e89a2a', INK_EYE, 'apron', '#e0a82a', 'helmet', 1.0),
  },
  {
    id: 'fondue-flinger', name: 'Fondue Flinger', org: 'cheese', role: 'minion', types: ['COOKING'],
    baseStats: stats(56, 34, 46, 53, 60, 41), ability: 'second-helping',
    learnset: learn(
      [1, 'pepper-puff'], [1, 'hot-potato'], [1, 'seed-spit'], [1, 'secret-sauce'],
      [17, 'boiling-broth'], [24, 'snack-time'], [31, 'bonfire-burp'], [42, 'kitchen-sink'],
    ),
    baseXp: 58, coins: 9,
    taunt: 'Hot cheese, coming through! Mind the drips!',
    defeat: 'Ack! My fondue went cold!',
    description:
      'The crew cook, a rat in a splattered apron who flings bubbling fondue and the odd hot potato. ' +
      'Its food is delicious, but nobody has ever seen it wash a pot.',
    visual: look('rat', '#8c7c76', '#dccbbf', '#f2c335', INK_EYE, 'apron', '#ece4d4', 'chefHat', 1.0),
  },
  {
    id: 'doormouse', name: 'Doormouse', org: 'cheese', role: 'minion', types: ['COOKING', 'EARTH'],
    // COOKING 60 / EARTH 40 at 300: the round, sleepy, very sturdy bouncer.
    baseStats: stats(70, 47, 53, 43, 55, 32), ability: 'pebble-grit',
    learnset: learn(
      [1, 'burrow-bump'], [1, 'warm-milk'], [1, 'whisk-whack'], [1, 'curl-up'],
      [17, 'shovel-swipe'], [24, 'food-coma'], [31, 'rolling-pin'], [38, 'belly-flop'],
      [46, 'tunnel-quake'],
    ),
    baseXp: 64, coins: 10,
    taunt: "Zzz... Hm? What's the password? No password, no entry... zzz.",
    defeat: "Wake me up when it's lunchtime...",
    description:
      'The bouncer at the Mouse Hole Lounge, a round and dozy dormouse who naps standing up. ' +
      "Nobody gets past him, mostly because he has fallen asleep across the doorway. He offers every visitor a cup of warm milk.",
    visual: look('mouse', '#c8955e', '#f6e4c4', '#b83a4a', INK_EYE, 'suit', '#2c2a38', 'sunglasses', 1.1),
  },

  // ==== CAW-SA NOSTRA (org 2: WINGED / DARKNESS / LIGHT) ======================================
  {
    id: 'godfeather', name: 'The Godfeather', org: 'crows', role: 'boss', types: ['DARKNESS', 'WINGED'],
    // DARKNESS 60 / WINGED 40 at 525; an old bird: a little bulkier, a little slower.
    baseStats: stats(92, 109, 81, 81, 74, 88), ability: 'spooky-glare',
    // Weak to FLUFF, LIGHT, LIGHTNING, ROCK, FROST: rivets and anvils for ROCK and FROST.
    learnset: learn(
      [1, 'night-nibble'], [1, 'rivet-rap'], [1, 'sneaky-scheme'], [1, 'wing-slap'],
      [18, 'dusk-crunch'], [21, 'anvil-drop'], [23, 'stink-eye'], [25, 'loop-de-loop'],
      [36, 'comet-dive'], [45, 'crag-crash'],
    ),
    baseXp: 240, coins: 80,
    taunt: 'Caw me old-fashioned, but I like my agents plucked.',
    defeat: 'Fly, my birds, fly! The Godfeather always comes back!',
    description:
      'The silver-beaked boss of Caw-sa Nostra, a big old crow in a dark suit and fedora who speaks so softly that everyone has to lean in. ' +
      'His nest is lined with stolen keys, spoons and lost earrings. He has never paid for a breadcrumb in his life.',
    visual: look('crow', '#2b2838', '#5a5470', '#c4cad8', '#e0a020', 'suit', '#45404f', 'fedora', 1.5),
  },
  {
    id: 'duchess-dazzle', name: 'Duchess Dazzle', org: 'crows', role: 'lieutenant', types: ['LIGHT', 'WINGED'],
    // LIGHT 60 / WINGED 40 at 445, tilted towards SP. ATK.
    baseStats: stats(70, 59, 70, 89, 83, 74), ability: 'glitterize',
    // Weak to DARKNESS, METAL, LIGHTNING, ROCK, FROST: polished chrome for ROCK and FROST.
    learnset: learn(
      [1, 'glimmer'], [1, 'magnet-hum'], [1, 'dizzy-sparkle'], [1, 'breezy-puff'],
      [16, 'stardust'], [21, 'chrome-cannon'], [23, 'glow-up'], [28, 'tornado-twirl'],
      [34, 'sunbeam'], [42, 'geode-beam'],
    ),
    baseXp: 162, coins: 42,
    taunt: "Darling, that badge is FAR too shiny for you. I'll take it.",
    defeat: 'My feathers! My jewels! Somebody fetch my fainting couch!',
    description:
      'A magpie jewel thief who wears three stolen tiaras at once and calls everyone darling. ' +
      'She can spot a lost earring from the top of the Sky Tower. Her cape is lined with pockets, and every pocket is full.',
    visual: look('magpie', '#1f2230', '#f4f4f8', '#3fb8b0', '#3a2a20', 'cape', '#8a2a6a', 'crown', 1.2),
  },
  {
    id: 'stool-pigeon', name: 'Stool Pigeon', org: 'crows', role: 'minion', types: ['WINGED'],
    baseStats: stats(51, 59, 45, 51, 45, 69), ability: 'night-owl',
    learnset: learn(
      [1, 'wing-slap'], [1, 'fluster-flap'], [1, 'pitter-pat'], [1, 'lullaby'],
      [14, 'homing-swoop'], [20, 'night-nibble'], [26, 'loop-de-loop'], [33, 'preen'],
      [41, 'comet-dive'],
    ),
    baseXp: 76, coins: 12,
    taunt: "Coo! I seen nothin'. I know nothin'. Now scram!",
    defeat: "Okay, okay! I'll talk! Coo...",
    description:
      'The flock lookout, a pigeon in a trenchcoat who loiters around statues listening to everything. ' +
      'It reports every rumour straight back to the boss, then sells you the same rumour for a bread roll.',
    visual: look('pigeon', '#8a8fa0', '#c4c8d4', '#4fb07a', '#e86a2a', 'trenchcoat', '#a8885a', 'fedora', 0.95),
  },
  {
    id: 'crowbar-crook', name: 'Crowbar Crook', org: 'crows', role: 'minion', types: ['DARKNESS'],
    baseStats: stats(52, 80, 50, 44, 46, 58), ability: 'victory-strut',
    learnset: learn(
      [1, 'night-nibble'], [1, 'sneaky-scheme'], [1, 'rivet-rap'], [1, 'peekaboo'],
      [20, 'dusk-crunch'], [24, 'stink-eye'], [30, 'anvil-drop'], [40, 'loop-de-loop'],
    ),
    baseXp: 82, coins: 13,
    taunt: 'No lock can stop me. No door, no window, no cookie jar!',
    defeat: 'My crowbar! Who crowbarred my crowbar?',
    description:
      'A crow safecracker who never goes anywhere without its trusty crowbar. ' +
      'It has opened bank vaults, treasure chests and, once, by accident, a tin of sardines. It still smells.',
    visual: look('crow', '#2e2b3c', '#4e4964', '#d04040', '#e0a020', 'bandana', '#d04040', 'eyepatch', 1.0),
  },
  {
    id: 'disco-pigeon', name: 'Disco Pigeon', org: 'crows', role: 'minion', types: ['LIGHT'],
    baseStats: stats(51, 40, 53, 64, 61, 51), ability: 'glitterize',
    learnset: learn(
      [1, 'glimmer'], [1, 'dizzy-sparkle'], [1, 'breezy-puff'], [1, 'glow-up'],
      [15, 'stardust'], [21, 'warm-glow'], [28, 'tornado-twirl'], [35, 'sunbeam'],
      [43, 'rainbow-ray'],
    ),
    baseXp: 78, coins: 12,
    taunt: 'Let me hear you coo! It is time to boogie!',
    defeat: 'The music... stopped... coo...',
    description:
      'A pigeon with shimmering neck feathers, mirrored sunglasses and the dance moves to match. ' +
      'It dazzles the guards with a disco routine while the rest of the flock grabs the loot.',
    visual: look('pigeon', '#9a9cb4', '#d8daea', '#c050c0', '#e86a2a', 'suit', '#ecebf4', 'sunglasses', 1.0),
  },
  {
    id: 'two-tone-magpie', name: 'Two-Tone Magpie', org: 'crows', role: 'minion', types: ['DARKNESS', 'LIGHT'],
    // DARKNESS 50 / LIGHT 50 at 335: an even mixed attacker.
    baseStats: stats(53, 59, 53, 59, 59, 52), ability: 'mischief-maker',
    learnset: learn(
      [1, 'night-nibble'], [1, 'dizzy-sparkle'], [1, 'twinkle-tap'], [1, 'wing-slap'],
      [17, 'jinx'], [22, 'sneaky-scheme'], [28, 'prism-pounce'], [35, 'dusk-crunch'],
      [42, 'stink-eye'],
    ),
    baseXp: 85, coins: 14,
    taunt: 'Black, white and sneaky all over. Guess which side I am on!',
    defeat: 'Even my good side is bruised now!',
    description:
      'Half shadow and half sparkle, this magpie never quite decides whether it is good or bad, so it says sorry while it steals. ' +
      'Its nest is perfectly sorted: dark loot on the left, shiny loot on the right.',
    visual: look('magpie', '#1f2230', '#f4f4f8', '#4a6ad8', '#3a2a20', 'none', '#2a2a3a', 'beret', 0.95),
  },

  // ==== THE SSSYNDICATE (org 3: SLIME / MIND / LEAF) ==========================================
  {
    id: 'baron-von-hiss', name: 'Baron Von Hiss', org: 'snakes', role: 'boss', types: ['MIND', 'SLIME'],
    // MIND 60 / SLIME 40 at 550, tilted towards SP. ATK.
    baseStats: stats(94, 67, 86, 119, 107, 77), ability: 'looming-aura',
    // Weak to FLUFF, DARKNESS, EARTH, WINGED: frosty hypnosis for EARTH and WINGED, then sunbeams.
    learnset: learn(
      [1, 'thought-bubble'], [1, 'flurry-puff'], [1, 'brain-fog'], [1, 'slime-spit'],
      [20, 'brainwave'], [24, 'polar-beam'], [26, 'counting-sheep'], [29, 'gloop-geyser'],
      [36, 'sunbeam'], [44, 'brain-freeze'],
    ),
    baseXp: 260, coins: 100,
    taunt: 'You are getting sleepy... very sleepy... and very, very defeated.',
    defeat: "Cursssesss! You haven't ssseen the lassst of me!",
    description:
      "A long, elegant snake in a magician's cape and a monocle (no relation to Chief Nibbles' monocle, they both insist). " +
      "He is the city's greatest hypnotist and its worst magician. With one swing of his pocket watch, whole zoos have handed him their keys.",
    visual: look('snake', '#6a4a9a', '#d8c8e8', '#f2c335', '#e8d040', 'cape', '#2a1f3a', 'monocle', 1.5),
  },
  {
    id: 'captain-croak', name: 'Captain Croak', org: 'snakes', role: 'lieutenant', types: ['SLIME', 'LEAF'],
    // SLIME 60 / LEAF 40 at 470, tilted towards ATTACK.
    baseStats: stats(84, 85, 80, 71, 91, 59), ability: 'tacky-coat',
    // Weak to WINGED, MIND, FIRE, FROST, COOKING: a cannonball for FIRE and COOKING, crags for WINGED.
    learnset: learn(
      [1, 'gooey-glomp'], [1, 'puddle-pounce'], [1, 'leech-lick'], [1, 'vine-flick'],
      [18, 'slurp'], [22, 'cannonball'], [27, 'soggy-socks'], [29, 'goo-hammer'],
      [36, 'crag-crash'], [44, 'thorn-swipe'],
    ),
    baseXp: 175, coins: 55,
    taunt: "Har! What be in me cheeks? Nothin' ye need to know about, matey!",
    defeat: 'Abandon ship! Every toad for himself! Ribbit!',
    description:
      'A barrel-bellied toad captain who smuggles stolen goods through the swamp on a raft of lily pads. ' +
      'He hides the loot in his enormous cheeks, which is why he never says much. His tongue is faster than any lock.',
    visual: look('toad', '#6a7a3a', '#d8d4a0', '#9aa84a', '#e88a20', 'bandana', '#2a4a8a', 'eyepatch', 1.25),
  },
  {
    id: 'swamp-smuggler', name: 'Swamp Smuggler', org: 'snakes', role: 'minion', types: ['SLIME'],
    baseStats: stats(74, 56, 59, 50, 72, 44), ability: 'goo-prickles',
    learnset: learn(
      [1, 'gooey-glomp'], [1, 'stink-cloud'], [1, 'puddle-pounce'], [1, 'cheek-stuff'],
      [21, 'slurp'], [26, 'leech-lick'], [31, 'goo-hammer'], [38, 'cannonball'],
      [45, 'sour-splat'],
    ),
    baseXp: 98, coins: 16,
    taunt: 'Mmf mmf! (Translation: nothing to see here!)',
    defeat: 'Bleh! Ptoo! There goes the loot!',
    description:
      'A wart-covered toad who carries stolen goods across the swamp inside its cheeks. ' +
      'The guards find it far too gooey to search, which is exactly the plan. It is grumpy, sticky and surprisingly polite.',
    visual: look('toad', '#5a6a3a', '#c8c490', '#8a9a3a', '#e88a20', 'trenchcoat', '#6a5a3a', 'fedora', 1.0),
  },
  {
    id: 'hedge-hisser', name: 'Hedge Hisser', org: 'snakes', role: 'minion', types: ['LEAF'],
    baseStats: stats(57, 63, 63, 66, 60, 51), ability: 'sneezy-spores',
    learnset: learn(
      [1, 'petal-puff'], [1, 'snoozy-spores'], [1, 'slime-spit'], [1, 'sap-sprout'],
      [20, 'sap-sip'], [25, 'sunsoak'], [30, 'blossom-blast'], [37, 'gloop-geyser'],
      [45, 'acorn-volley'],
    ),
    baseXp: 100, coins: 16,
    taunt: "Ssshh! You didn't sssee me in this hedge. Nobody ever doesss.",
    defeat: 'Ssso much for the perfect hiding ssspot.',
    description:
      'A leaf-green snake who hides in hedges, flower beds and salads. It puffs sleepy spores at passing guards and waits for the snoring. ' +
      'It is very proud of its camouflage, even though it always forgets to hide its tail.',
    visual: look('snake', '#4a9a3a', '#d0e8a0', '#2a6a2a', '#e8d040', 'none', '#3a6a2a', 'none', 1.0),
  },
  {
    id: 'pendulum-python', name: 'Pendulum Python', org: 'snakes', role: 'minion', types: ['MIND'],
    baseStats: stats(63, 45, 54, 81, 69, 48), ability: 'deep-focus',
    learnset: learn(
      [1, 'thought-bubble'], [1, 'counting-sheep'], [1, 'brain-bonk'], [1, 'deep-thought'],
      [24, 'brainwave'], [28, 'brain-fog'], [33, 'jinx'], [40, 'daydream'],
      [47, 'big-idea'],
    ),
    baseXp: 102, coins: 17,
    taunt: 'Watch the pendulum... back and forth... back and forth...',
    defeat: 'I got dizzy... from my own... pendulum...',
    description:
      'A trainee hypnotist who swings a golden pocket watch at everything: guards, doors, its own reflection. ' +
      'It has hypnotised itself four times this week. Baron Von Hiss says it shows great promise.',
    visual: look('snake', '#c8a040', '#f4e4b0', '#7a4a2a', '#b060e0', 'cape', '#4a2a6a', 'tophat', 1.0),
  },
  {
    id: 'chameleon-con', name: 'Chameleon Con', org: 'snakes', role: 'minion', types: ['LEAF', 'MIND'],
    // LEAF 50 / MIND 50 at 365, tilted towards SPEED.
    baseStats: stats(58, 55, 53, 75, 68, 56), ability: 'goo-shed',
    learnset: learn(
      [1, 'petal-puff'], [1, 'brain-fog'], [1, 'thought-bubble'], [1, 'sap-sprout'],
      [21, 'sap-sip'], [26, 'snoozy-spores'], [31, 'brainwave'], [38, 'blossom-blast'],
      [45, 'dizzy-sparkle'],
    ),
    baseXp: 106, coins: 18,
    taunt: "Who, me? I'm just a very handsome potted plant.",
    defeat: 'Drat! I must have turned the wrong colour.',
    description:
      'A smooth-talking lizard who changes colour to match any disguise: a guard, a tour guide, a potted fern. ' +
      'It has sold the City Zoo to three different tourists. It always blushes bright pink when it gets caught.',
    visual: look('lizard', '#5ac06a', '#e0f0b0', '#e86ab0', '#e8a020', 'suit', '#8a6a4a', 'sunglasses', 1.0),
  },

  // ==== THE ALLEY CAT CARTEL (org 4: BRAWL / ROCK / FIRE) =====================================
  {
    id: 'don-whiskerino', name: 'Don Whiskerino', org: 'cats', role: 'boss', types: ['FIRE', 'BRAWL'],
    // FIRE 50 / BRAWL 50 at 575; a fat cat: +HP, -speed.
    baseStats: stats(106, 127, 86, 91, 86, 79), ability: 'velvet-cape',
    // Weak to WATER, EARTH, WINGED, MIND: static-charged paws for WATER and WINGED, thorny claws later.
    learnset: learn(
      [1, 'paw-jab'], [1, 'fizz-nip'], [1, 'flex'], [1, 'ember-nip'],
      [24, 'haymaker'], [29, 'bolt-bonk'], [33, 'hot-potato'], [36, 'flare-dive'],
      [42, 'thorn-swipe'], [49, 'all-out-brawl'],
    ),
    baseXp: 280, coins: 120,
    taunt: 'You got guts, coming into my alley. Let us see if you got nine lives.',
    defeat: 'Bah! I still got eight lives left! Scatter, cats!',
    description:
      'The fattest cat in town, who wears a crown, a velvet cape and nine gold medals he awarded himself. ' +
      'He started out as a scrappy kitten fighting over fish heads and now owns every alley in the city. He is very ticklish under the chin, which is a closely guarded secret.',
    visual: look('cat', '#ece8e0', '#fffaf2', '#c8b8a8', '#40b0e0', 'cape', '#8a1a2a', 'crown', 1.55),
  },
  {
    id: 'clawdia-crush', name: 'Clawdia Crush', org: 'cats', role: 'lieutenant', types: ['ROCK', 'BRAWL'],
    // ROCK 50 / BRAWL 50 at 495.
    baseStats: stats(80, 116, 103, 54, 76, 66), ability: 'hard-noggin',
    // Weak to WATER, LEAF, BRAWL, METAL, LIGHT, MIND: fiery headbutts for LEAF and METAL.
    learnset: learn(
      [1, 'gravel-gnaw'], [1, 'ember-nip'], [1, 'stonewall'], [1, 'boop'],
      [27, 'boulder-bonk'], [29, 'blaze-roll'], [32, 'flex'], [35, 'haymaker'],
      [41, 'flare-dive'], [48, 'crag-crash'],
    ),
    baseXp: 188, coins: 68,
    taunt: 'Arm-wrestle you? Nah. Headbutt you? Yeah!',
    defeat: "I'm not crying! I just got grit in my eye!",
    description:
      'The cartel champion arm-wrestler, a stony-headed tabby who has never lost a headbutt. ' +
      'She cracks walnuts on her forehead for breakfast. Don Whiskerino calls her his little pebble, and nobody else is allowed to.',
    visual: look('cat', '#8a8a80', '#d8d4c8', '#4a4a44', '#e8c020', 'tracksuit', '#c83a4a', 'none', 1.2),
  },
  {
    id: 'alley-scrapper', name: 'Alley Scrapper', org: 'cats', role: 'minion', types: ['BRAWL'],
    baseStats: stats(59, 101, 62, 41, 59, 68), ability: 'tough-cookie',
    learnset: learn(
      [1, 'boop'], [1, 'flex'], [1, 'night-nibble'], [1, 'paw-jab'],
      [20, 'tough-it-out'], [26, 'stink-eye'], [30, 'whisker-swipe'], [34, 'haymaker'],
      [41, 'all-out-brawl'], [48, 'hammy-hoedown'],
    ),
    baseXp: 118, coins: 20,
    taunt: 'You wanna go? You wanna GO? Let us go!',
    defeat: "That's it. I'm taking a nap. A long one.",
    description:
      'A scruffy alley cat who picks fights with bins, brooms and its own tail. ' +
      'It has a torn ear, a loud yowl and a heart of gold it would never admit to. It always lands on its feet, except today.',
    visual: look('cat', '#5a4a44', '#b8a898', '#2a2220', '#e8c020', 'bandana', '#3a6ab0', 'eyepatch', 1.0),
  },
  {
    id: 'stone-cold-cat', name: 'Stone Cold Cat', org: 'cats', role: 'minion', types: ['ROCK'],
    baseStats: stats(63, 82, 95, 43, 63, 49), ability: 'pebble-grit',
    learnset: learn(
      [1, 'gravel-gnaw'], [1, 'cold-shoulder'], [1, 'pebble-flick'], [1, 'stonewall'],
      [26, 'crag-crash'], [31, 'chilly-nip'], [35, 'boulder-bonk'], [42, 'flex'],
    ),
    baseXp: 122, coins: 21,
    taunt: "Chill out. You're about to get the cold shoulder.",
    defeat: 'Not cool, man. Not cool.',
    description:
      'The coolest cat in the cartel, who wears sunglasses at night and has a hide as hard as a cobblestone. ' +
      'It never hurries, never smiles and never, ever admits that it loves belly rubs.',
    visual: look('cat', '#5a5e66', '#a8acb4', '#3a3e46', '#7ac040', 'trenchcoat', '#2a2a30', 'sunglasses', 1.0),
  },
  {
    id: 'hot-tin-tom', name: 'Hot Tin Tom', org: 'cats', role: 'minion', types: ['FIRE'],
    baseStats: stats(60, 72, 50, 82, 59, 72), ability: 'toasty-fur',
    learnset: learn(
      [1, 'cinder-sneeze'], [1, 'battle-cry'], [1, 'kindle-dash'], [1, 'hot-potato'],
      [24, 'bonfire-burp'], [29, 'chi-blast'], [33, 'overtoast'], [40, 'sneaky-scheme'],
    ),
    baseXp: 120, coins: 20,
    taunt: 'Hot, hot, HOT! Ow! Ow! Hot! Let us fight!',
    defeat: 'Finally! Somewhere cool to lie down!',
    description:
      'A jumpy ginger tom who spent so long dancing on hot tin roofs that his fur started to smoulder. ' +
      'He coughs up fiery furballs and lobs hot potatoes at anyone who gets close. He is still hopping.',
    visual: look('cat', '#e07a30', '#f8d8b0', '#b04a18', '#7ac040', 'none', '#c84020', 'none', 0.95),
  },
  {
    id: 'chimney-cat', name: 'Chimney Cat', org: 'cats', role: 'minion', types: ['FIRE', 'ROCK'],
    // FIRE 50 / ROCK 50 at 400.
    baseStats: stats(62, 78, 80, 63, 62, 55), ability: 'kindling-belly',
    learnset: learn(
      [1, 'ember-nip'], [1, 'dust-cloud'], [1, 'gravel-gnaw'], [1, 'peekaboo'],
      [23, 'blaze-roll'], [28, 'hot-potato'], [32, 'crag-crash'], [37, 'flare-dive'],
      [44, 'stonewall'],
    ),
    baseXp: 126, coins: 22,
    taunt: "Peekaboo! Bet you didn't expect me down the chimney!",
    defeat: "Achoo! Too much soot! I'm out!",
    description:
      'A soot-black cat burglar in a sweep\'s top hat who slips in and out of houses through the chimney. ' +
      'Its fur is full of glowing embers and brick dust, so it leaves a little cloud wherever it goes. It has never once wiped its paws.',
    visual: look('cat', '#2a2630', '#5a5260', '#e86a2a', '#f2c335', 'suit', '#3a3440', 'tophat', 1.0),
  },

  // ==== F.E.R.R.E.T. (org 5: METAL / LIGHTNING / FROST / WATER) ===============================
  {
    id: 'dr-ferretstein', name: 'Dr. Ferretstein', org: 'ferrets', role: 'boss', types: ['METAL', 'LIGHTNING'],
    // METAL 50 / LIGHTNING 50 at 600, tilted from ATTACK to SP. ATK: he lets his gadgets do the hitting.
    baseStats: stats(85, 88, 120, 113, 103, 91), ability: 'menacing-aura',
    // Weak to EARTH (x4), FIRE, BRAWL: a boiling hot spring covers EARTH and FIRE.
    learnset: learn(
      [1, 'tingle-zap'], [1, 'magnet-hum'], [1, 'splish-splash'], [1, 'deep-thought'],
      [30, 'thunder-squeak'], [33, 'chrome-cannon'], [36, 'hot-spring'], [43, 'static-cuddle'],
      [47, 'megawatt'],
    ),
    baseXp: 300, coins: 150,
    taunt: 'Behold my greatest invention: your defeat! Mwa-ha-ha!',
    defeat: 'Impossible! My calculations! To the escape pod!',
    description:
      'The maddest scientist in the city, a wiry ferret with wild white fur, singed goggles and a lab coat full of scorch marks. ' +
      'He invented the freeze ray, the lightning cannon and self-buttering toast, and only one of those works properly. He plans to rule the city with an army of robots.',
    visual: look('ferret', '#f0eadc', '#fffaf0', '#6a4a40', '#3ad07a', 'labcoat', '#e8eef4', 'goggles', 1.6),
  },
  {
    id: 'icegor', name: 'Icegor', org: 'ferrets', role: 'lieutenant', types: ['FROST', 'WATER'],
    // FROST 60 / WATER 40 at 520.
    baseStats: stats(99, 94, 88, 89, 83, 67), ability: 'snowcone-snack',
    // Weak to ROCK, LEAF, LIGHTNING: WATER covers ROCK, FROST covers LEAF, a shovel for LIGHTNING.
    learnset: learn(
      [1, 'chilly-nip'], [1, 'puddle-pounce'], [1, 'burrow-bump'], [1, 'cold-shoulder'],
      [28, 'glacier-slam'], [32, 'cannonball'], [36, 'shovel-swipe'], [42, 'tin-dome'],
      [48, 'tunnel-quake'],
    ),
    baseXp: 200, coins: 80,
    taunt: 'Yesss, master! Icegor will freeze the nosy agent!',
    defeat: 'Master! Icegor needs a hot water bottle!',
    description:
      "Dr. Ferretstein's hunched and loyal lab assistant, a stoat whose fur turned snow white after an accident with the freeze ray. " +
      'He mops up spills, sharpens icicles and says yes master about two hundred times a day. He is secretly scared of the robots.',
    visual: look('weasel', '#f4f8fc', '#cfe0ec', '#2a3040', '#40a0e0', 'apron', '#4a6a8a', 'headphones', 1.2),
  },
  {
    id: 'clankbot', name: 'Clankbot 3000', org: 'ferrets', role: 'minion', types: ['METAL'],
    baseStats: stats(60, 81, 113, 50, 78, 43), ability: 'shiny-plating',
    learnset: learn(
      [1, 'cog-nip'], [1, 'tune-up'], [1, 'rivet-rap'], [1, 'squeaky-hinge'],
      [26, 'scissor-snip'], [33, 'anvil-drop'], [38, 'bolt-bonk'], [43, 'tin-dome'],
    ),
    baseXp: 138, coins: 25,
    taunt: 'BEEP. INTRUDER DETECTED. PREPARE FOR TIDYING.',
    defeat: 'SYSTEM... ERROR... NEED... OIL...',
    description:
      'A boxy security robot that clanks, squeaks and sometimes tries to vacuum the floor in the middle of a fight. ' +
      'It was built to guard the lab and to fold the laundry. It is much better at the laundry.',
    visual: look('robot', '#8a96a4', '#c4ccd6', '#f2c335', '#ff4a3a', 'armor', '#5a6674', 'antenna', 1.05),
  },
  {
    id: 'voltage-weasel', name: 'Voltage Weasel', org: 'ferrets', role: 'minion', types: ['LIGHTNING'],
    baseStats: stats(61, 65, 56, 90, 68, 90), ability: 'staticky-fluff',
    learnset: learn(
      [1, 'tingle-zap'], [1, 'static-cuddle'], [1, 'magnet-hum'], [1, 'wheel-spin'],
      [30, 'thunder-squeak'], [38, 'sneaky-scheme'], [42, 'chrome-cannon'], [46, 'megawatt'],
    ),
    baseXp: 140, coins: 26,
    taunt: "Zzzap! I've been running on my wheel ALL day. I'm fully charged!",
    defeat: 'Bzzt... battery... low...',
    description:
      'A weasel engineer with a battery pack on its back and fur that crackles with static. ' +
      'It powers the whole lab by sprinting on a giant hamster wheel, which it finds deeply embarrassing. Do not shake paws with it.',
    visual: look('weasel', '#a8743a', '#f4dcb0', '#f2d030', INK_EYE, 'apron', '#4a5a6a', 'goggles', 1.0),
  },
  {
    id: 'cryo-ferret', name: 'Cryo Ferret', org: 'ferrets', role: 'minion', types: ['FROST'],
    baseStats: stats(82, 75, 72, 82, 65, 54), ability: 'icy-fur',
    learnset: learn(
      [1, 'flurry-puff'], [1, 'cold-shoulder'], [1, 'frost-flick'], [1, 'freeze-frame'],
      [28, 'polar-beam'], [36, 'chrome-cannon'], [41, 'brain-freeze'], [47, 'tin-dome'],
    ),
    baseXp: 142, coins: 26,
    taunt: 'Hold still. This freeze ray only tickles. Mostly.',
    defeat: 'Brrr! Somebody turn the heater on!',
    description:
      "A lab ferret in frosty goggles who runs the cold-storage wing, where the doctor keeps his ice cream and his evil plans. " +
      'Its freeze ray is only slightly dangerous and always slightly sticky.',
    visual: look('ferret', '#c8b8a0', '#f4ece0', '#5a4438', '#40b0e0', 'labcoat', '#dde8f0', 'goggles', 1.0),
  },
  {
    id: 'soaker-bot', name: 'Soaker Bot', org: 'ferrets', role: 'minion', types: ['WATER'],
    baseStats: stats(81, 72, 83, 72, 76, 51), ability: 'sponge-cheeks',
    learnset: learn(
      [1, 'splish-splash'], [1, 'soggy-socks'], [1, 'cog-nip'], [1, 'puddle-pounce'],
      [29, 'hot-spring'], [37, 'tune-up'], [40, 'anvil-drop'], [44, 'geyser-gush'],
    ),
    baseXp: 145, coins: 27,
    taunt: 'HOSE MODE ACTIVATED. YOU ARE DUE FOR A BATH.',
    defeat: 'GLUB. GLUB. SHORT... CIRCUIT...',
    description:
      'A barrel-shaped cleaning robot with a hose for an arm, built to mop the lab floors. ' +
      'Somebody turned its dial up to MAXIMUM, and now it soaks everyone it meets. It has never been dry a day in its life.',
    visual: look('robot', '#4a8ac8', '#a8d0f0', '#f0f4f8', '#40e0ff', 'none', '#2a5a8a', 'helmet', 1.05),
  },
];

function byId(list: VillainDef[]): Record<VillainId, VillainDef> {
  const out: Record<VillainId, VillainDef> = {};
  for (const v of list) {
    if (out[v.id]) throw new Error(`duplicate villain id: '${v.id}'`);
    out[v.id] = v;
  }
  return out;
}

export const VILLAINS: Record<VillainId, VillainDef> = byId(LIST);
