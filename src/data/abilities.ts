// Every ability. Each type gets three, renamed from the signature abilities of its Pokemon parallel
// (docs/POKEMON_RESEARCH.md section 3): a pinch boost, an absorb or immunity, a contact punish, or
// a defensive trait. Then a few generic ones any dragon can roll, and the boss abilities villains
// use (pressure, multiscale and a double intimidate; SPOOKY GLARE, SNACK STASH, SHINY PLATING,
// BOULDER HIDE, TRUE COLORS and VICTORY STRUT also suit bosses well).
// Names are at most 14 characters and descriptions at most 60.
import type { AbilityDef, AbilityEffect, AbilityId } from './schema.ts';

const a = (id: AbilityId, name: string, effect: AbilityEffect, description: string, parallel: string): AbilityDef =>
  ({ id, name, description, effect, parallel });

const LIST: AbilityDef[] = [
  // ---- FLUFF ----
  a('puffball-coat', 'Puffball Coat', { kind: 'resist', types: ['FIRE', 'FROST'], mult: 0.5 },
    'Thick fluff halves damage from FIRE and FROST moves.', 'Thick Fat'),
  a('little-paws', 'Little Paws', { kind: 'technician' },
    'Its moves with 60 power or less hit 1.5x as hard.', 'Technician'),
  a('lucky-whiskers', 'Lucky Whiskers', { kind: 'sereneGrace' },
    'Twitchy whiskers double the odds of its moves\' extra effects.', 'Serene Grace'),

  // ---- FIRE ----
  a('kindle', 'Kindle Heart', { kind: 'pinch', type: 'FIRE', mult: 1.5 },
    'Powers up its FIRE moves when its HP is low.', 'Blaze'),
  a('toasty-fur', 'Toasty Fur', { kind: 'contactStatus', status: 'burn', chance: 30 },
    'Touching its toasty fur may leave the attacker BURNED.', 'Flame Body'),
  a('kindling-belly', 'Kindling Belly', { kind: 'absorb', type: 'FIRE', heal: 0, boost: { atk: 1, spa: 1 } },
    'Eats FIRE moves as fuel: its ATTACK and SP. ATK rise.', 'Flash Fire'),

  // ---- WATER ----
  a('tidal-heart', 'Tidal Heart', { kind: 'pinch', type: 'WATER', mult: 1.5 },
    'Powers up its WATER moves when its HP is low.', 'Torrent'),
  a('sponge-cheeks', 'Sponge Cheeks', { kind: 'absorb', type: 'WATER', heal: 0.25 },
    'Soaks up WATER moves to heal 1/4 of its max HP.', 'Water Absorb'),
  a('damp-fur', 'Damp Fur', { kind: 'statusImmune', statuses: ['burn'] },
    'Always a little soggy, so it can never be BURNED.', 'Water Veil'),

  // ---- LEAF ----
  a('sprout-heart', 'Sprout Heart', { kind: 'pinch', type: 'LEAF', mult: 1.5 },
    'Powers up its LEAF moves when its HP is low.', 'Overgrow'),
  a('sneezy-spores', 'Sneezy Spores', { kind: 'contactStatus', status: 'snooze', chance: 20 },
    'Touching it may puff sleepy spores: the attacker SNOOZES.', 'Effect Spore'),
  a('sap-snacker', 'Sap Snacker', { kind: 'absorb', type: 'LEAF', heal: 0, boost: { atk: 1 } },
    'Munches LEAF moves instead of getting hurt: ATTACK rises.', 'Sap Sipper'),

  // ---- LIGHTNING ----
  a('staticky-fluff', 'Staticky Fluff', { kind: 'contactStatus', status: 'zap', chance: 30 },
    'Touching its staticky fluff may leave the attacker ZAPPED.', 'Static'),
  a('battery-belly', 'Battery Belly', { kind: 'absorb', type: 'LIGHTNING', heal: 0.25 },
    'Soaks up LIGHTNING moves to heal 1/4 of its max HP.', 'Volt Absorb'),
  a('wheel-runner', 'Wheel Runner', { kind: 'absorb', type: 'LIGHTNING', heal: 0, boost: { spe: 1 } },
    'LIGHTNING moves just spin its wheel faster: SPEED rises.', 'Motor Drive'),

  // ---- EARTH ----
  a('dirt-snacker', 'Dirt Snacker', { kind: 'absorb', type: 'EARTH', heal: 0.25 },
    'Gobbles EARTH moves like snacks to heal 1/4 of its HP.', 'Earth Eater'),
  a('dune-power', 'Dune Power', { kind: 'typeBoost', type: 'EARTH', mult: 1.3 },
    'Its EARTH moves always hit 1.3x as hard.', 'Sand Force'),
  a('muddy-fur', 'Muddy Fur', { kind: 'contactStages', changes: { acc: -1 } },
    'Touching it gets mud in the eyes: attacker accuracy drops.', 'Gooey (accuracy instead of Speed)'),

  // ---- ROCK ----
  a('pebble-grit', 'Pebble Grit', { kind: 'sturdy' },
    'At full HP, it survives any single hit with 1 HP left.', 'Sturdy'),
  a('hard-noggin', 'Hard Noggin', { kind: 'rockHead' },
    'Its rock-hard head never takes recoil damage.', 'Rock Head'),
  a('boulder-hide', 'Boulder Hide', { kind: 'filter', mult: 0.75 },
    'Super-effective hits only deal 3/4 damage to it.', 'Solid Rock'),

  // ---- WINGED ----
  a('lucky-feather', 'Lucky Feather', { kind: 'superLuck' },
    'A lucky feather helps it land critical hits more often.', 'Super Luck'),
  a('updraft', 'Updraft', { kind: 'speedBoost' },
    'Rides the wind: its SPEED rises at the end of every turn.', 'Speed Boost'),
  a('night-owl', 'Night Owl', { kind: 'statusImmune', statuses: ['snooze'] },
    'Stays wide awake, so it can never fall SNOOZING.', 'Insomnia'),

  // ---- FROST ----
  a('frost-heart', 'Frost Heart', { kind: 'pinch', type: 'FROST', mult: 1.5 },
    'Powers up its FROST moves when its HP is low.', 'Blaze (FROST version)'),
  a('icy-fur', 'Icy Fur', { kind: 'contactStatus', status: 'frozen', chance: 10 },
    'Touching its icy fur may leave the attacker FROZEN.', 'Flame Body (FROST version)'),
  a('snowcone-snack', 'Snowcone Snack', { kind: 'regenTurn', fraction: 1 / 16 },
    'Nibbles a snowcone: heals 1/16 of its HP every turn.', 'Ice Body'),

  // ---- SLIME ----
  a('goo-prickles', 'Goo Prickles', { kind: 'contactStatus', status: 'goop', chance: 30 },
    'Touching its prickly goo may leave the attacker GOOPED.', 'Poison Point'),
  a('tacky-coat', 'Tacky Coat', { kind: 'contactStages', changes: { spe: -1 } },
    'Sticky goo slows down anyone who touches it: SPEED -1.', 'Gooey'),
  a('goo-shed', 'Goo Shed', { kind: 'shedSkin', chance: 33 },
    'Sheds its goo. May cure its own status each turn.', 'Shed Skin'),

  // ---- DARKNESS ----
  a('spooky-glare', 'Spooky Glare', { kind: 'entry', who: 'foe', changes: { atk: -1 } },
    "A spooky glare on entry lowers the foe's ATTACK.", 'Intimidate'),
  a('victory-strut', 'Victory Strut', { kind: 'moxie' },
    'Struts after a knockout: its ATTACK rises.', 'Moxie'),
  a('mischief-maker', 'Mischief Maker', { kind: 'prankster' },
    'Its status moves get +1 priority. Sneaky!', 'Prankster'),

  // ---- LIGHT ----
  a('fresh-sparkle', 'Fresh Sparkle', { kind: 'switchCure' },
    'Its status problem is cured whenever it swaps out.', 'Natural Cure'),
  a('glitterize', 'Glitterize', { kind: 'typeBoost', type: 'LIGHT', mult: 1.3 },
    'Extra glitter makes its LIGHT moves hit 1.3x as hard.', 'Pixilate'),
  a('halo-glow', 'Halo Glow', { kind: 'regenTurn', fraction: 1 / 16 },
    'A gentle halo heals 1/16 of its HP every turn.', 'Rain Dish'),

  // ---- COOKING ----
  a('second-helping', 'Second Helping', { kind: 'switchHeal', fraction: 1 / 3 },
    'Grabs a snack on the way out: heals 1/3 HP when it swaps.', 'Regenerator'),
  a('salt-crust', 'Salt Crust', { kind: 'statusImmune', statuses: ['burn', 'goop', 'zap', 'snooze', 'frozen'] },
    'A crust of salt keeps out every status problem.', 'Purifying Salt'),
  a('oven-mitts', 'Oven Mitts', { kind: 'resist', types: ['FIRE'], mult: 0.5 },
    'Oven mitts on! Damage from FIRE moves is halved.', 'Heatproof'),

  // ---- METAL ----
  a('shiny-plating', 'Shiny Plating', { kind: 'clearBody' },
    'Polished so smooth that foes cannot lower its stats.', 'Clear Body'),
  a('smithy-spirit', 'Smithy Spirit', { kind: 'typeBoost', type: 'METAL', mult: 1.5 },
    'A born blacksmith: its METAL moves hit 1.5x as hard.', 'Steelworker'),
  a('iron-paws', 'Iron Paws', { kind: 'contactBoost', mult: 1.3 },
    'Metal-capped paws: its contact moves hit 1.3x as hard.', 'Tough Claws'),

  // ---- MIND ----
  a('head-in-clouds', 'Head In Clouds', { kind: 'absorb', type: 'EARTH', heal: 0 },
    'Floats on daydreams, so EARTH moves cannot touch it.', 'Levitate'),
  a('deep-focus', 'Deep Focus', { kind: 'innerFocus' },
    'Too focused to flinch or get confused.', 'Inner Focus'),
  a('big-brain', 'Big Brain', { kind: 'statMult', stat: 'spa', mult: 1.2, when: 'always' },
    'Its enormous brain makes its SP. ATK 1.2x higher.', 'Pure Power (SP. ATK, toned down)'),

  // ---- BRAWL ----
  a('tough-cookie', 'Tough Cookie', { kind: 'statMult', stat: 'atk', mult: 1.5, when: 'statused' },
    'ATTACK x1.5 while it has a status problem. Shrugs off BURN.', 'Guts'),
  a('power-paws', 'Power Paws', { kind: 'contactBoost', mult: 1.2 },
    'Well-trained paws: its contact moves hit 1.2x as hard.', 'Iron Fist'),
  a('steady-stance', 'Steady Stance', { kind: 'innerFocus' },
    'Feet planted firmly: it never flinches or gets confused.', 'Steadfast + Own Tempo'),

  // ---- Generic: any dragon may roll these ----
  a('snack-stash', 'Snack Stash', { kind: 'regenTurn', fraction: 1 / 16 },
    'Nibbles snacks from its cheeks: heals 1/16 HP every turn.', 'Leftovers (as an ability)'),
  a('zoomy-feet', 'Zoomy Feet', { kind: 'statMult', stat: 'spe', mult: 1.5, when: 'statused' },
    'SPEED x1.5 while it has a status problem.', 'Quick Feet'),
  a('true-colors', 'True Colors', { kind: 'stab', mult: 2 },
    'Moves of its own type get x2 instead of x1.5.', 'Adaptability'),
  a('raring-to-go', 'Raring To Go', { kind: 'entry', who: 'self', changes: { spe: 1 } },
    'Bounces into battle raring to go: its SPEED rises.', 'Speed Boost (once, on entry)'),

  // ---- Boss abilities ----
  a('looming-aura', 'Looming Aura', { kind: 'pressure' },
    'Looms over the foe: its moves cost 2 PP instead of 1.', 'Pressure'),
  a('velvet-cape', 'Velvet Cape', { kind: 'multiscale' },
    'A plush velvet cape halves damage taken at full HP.', 'Multiscale'),
  a('menacing-aura', 'Menacing Aura', { kind: 'entry', who: 'foe', changes: { atk: -1, spa: -1 } },
    "On entry, the foe's ATTACK and SP. ATK both drop.", 'Intimidate (both attack stats)'),
];

function byId(list: AbilityDef[]): Record<AbilityId, AbilityDef> {
  const out: Record<AbilityId, AbilityDef> = {};
  for (const x of list) {
    if (out[x.id]) throw new Error(`duplicate ability id: '${x.id}'`);
    out[x.id] = x;
  }
  return out;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = byId(LIST);
