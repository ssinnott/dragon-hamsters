// Every move in the game. Numbers follow Pokemon conventions: weak moves 40ish power at 100%
// accuracy and lots of PP, reliable strong moves 85-90 power, big moves 110-120 with poor accuracy
// or a drawback; quick attacks +1 priority, guards +4, first-turn startles +3. Names are at most
// 14 characters (they sit on a button) and descriptions at most 60.
//
// Per type there is at least: a weak physical, a strong physical, a weak special, a strong special,
// a status move and two utility moves. FLUFF also carries the generic hamster toolkit every dragon
// can learn: SCURRY, CURL UP, HIBERNATE, HAMMY HOEDOWN, CHEEK STUFF, SQUEAK and STARTLE.
//
// Fixed-damage moves (effect 'fixed') have power 0: the engine skips the damage formula for them,
// and the UI shows their power as '-'.
import type { FxKind, MoveDef, MoveEffect, MoveId, StageChanges, StatusId, TypeId } from './schema.ts';

interface Opts {
  priority?: number;
  contact?: boolean;
  effects?: MoveEffect[];
  accuracy?: number;
  /** Hits both foes (doubles), each for 0.75x. */
  spread?: boolean;
}

function phys(id: MoveId, name: string, type: TypeId, power: number, accuracy: number, pp: number, fx: FxKind, description: string, o: Opts = {}): MoveDef {
  return { id, name, type, category: 'physical', power, accuracy, pp, priority: o.priority ?? 0, contact: o.contact ?? true, target: 'foe', effects: o.effects ?? [], description, fx, ...(o.spread ? { spread: true } : {}) };
}

function spec(id: MoveId, name: string, type: TypeId, power: number, accuracy: number, pp: number, fx: FxKind, description: string, o: Opts = {}): MoveDef {
  return { id, name, type, category: 'special', power, accuracy, pp, priority: o.priority ?? 0, contact: o.contact ?? false, target: 'foe', effects: o.effects ?? [], description, fx, ...(o.spread ? { spread: true } : {}) };
}

function stat(id: MoveId, name: string, type: TypeId, target: 'foe' | 'self', pp: number, fx: FxKind, effects: MoveEffect[], description: string, o: Opts = {}): MoveDef {
  return { id, name, type, category: 'status', power: 0, accuracy: target === 'self' ? 100 : o.accuracy ?? 100, pp, priority: o.priority ?? 0, contact: false, target, effects, description, fx };
}

// Effect shorthands.
const inflict = (status: StatusId, chance = 100): MoveEffect => ({ kind: 'inflict', status, chance });
const confuse = (chance = 100): MoveEffect => ({ kind: 'confuse', chance });
const flinch = (chance: number): MoveEffect => ({ kind: 'flinch', chance });
const self = (changes: StageChanges, chance = 100): MoveEffect => ({ kind: 'stages', who: 'self', changes, chance });
const foe = (changes: StageChanges, chance = 100): MoveEffect => ({ kind: 'stages', who: 'foe', changes, chance });
const heal = (fraction: number): MoveEffect => ({ kind: 'heal', fraction });
const drain = (fraction: number): MoveEffect => ({ kind: 'drain', fraction });
const recoil = (fraction: number): MoveEffect => ({ kind: 'recoil', fraction });
const multi: MoveEffect = { kind: 'multiHit', min: 2, max: 5 };
const crit: MoveEffect = { kind: 'highCrit' };

const LIST: MoveDef[] = [
  // ---- FLUFF: the generic hamster toolkit plus plain, sturdy attacks -------------------------
  phys('nibble', 'Nibble', 'FLUFF', 40, 100, 35, 'bite', 'A quick little bite with tiny front teeth.'),
  phys('scurry', 'Scurry', 'FLUFF', 40, 100, 30, 'tackle', 'Scampers in so fast that it always strikes first.', { priority: 1 }),
  phys('startle', 'Startle', 'FLUFF', 40, 100, 10, 'sound', 'Jumps out going BOO! The foe flinches. First turn only.', { priority: 3, effects: [{ kind: 'firstTurn' }] }),
  phys('pitter-pat', 'Pitter Pat', 'FLUFF', 20, 100, 20, 'punch', 'Pats the foe with tiny paws 2 to 5 times.', { effects: [multi] }),
  phys('whisker-swipe', 'Whisker Swipe', 'FLUFF', 70, 100, 20, 'slash', 'A sharp swipe of the whiskers. High critical-hit ratio.', { effects: [crit] }),
  phys('grumpy-chomp', 'Grumpy Chomp', 'FLUFF', 70, 100, 20, 'bite', 'Power doubles if the user has a status problem.', { effects: [{ kind: 'facade' }] }),
  phys('belly-flop', 'Belly Flop', 'FLUFF', 85, 100, 15, 'tackle', 'A big round belly flop. May make the foe flinch.', { effects: [flinch(30)] }),
  spec('seed-spit', 'Seed Spit', 'FLUFF', 40, 100, 30, 'food', 'Spits a sunflower seed at high speed.'),
  spec('cheek-cannon', 'Cheek Cannon', 'FLUFF', 110, 85, 5, 'beam', 'Fires every seed in its cheeks at once. Hard to aim.'),
  stat('curl-up', 'Curl Up', 'FLUFF', 'self', 10, 'shield', [{ kind: 'protect' }], 'Curls into a fluffy ball and blocks every attack.', { priority: 4 }),
  stat('hibernate', 'Hibernate', 'FLUFF', 'self', 5, 'heal', [{ kind: 'rest' }], 'Sleeps for 2 turns to heal all HP and cure its status.'),
  stat('hammy-hoedown', 'Hammy Hoedown', 'FLUFF', 'self', 20, 'buff', [self({ atk: 2 })], 'A wiggly little dance. ATTACK sharply rises.'),
  stat('cheek-stuff', 'Cheek Stuff', 'FLUFF', 'self', 20, 'buff', [self({ def: 1, spd: 1 })], 'Stuffs its cheeks so hits bounce off. DEF and SP. DEF rise.'),
  stat('squeak', 'Squeak', 'FLUFF', 'foe', 40, 'sound', [foe({ atk: -1 })], "A squeak so cute that the foe's ATTACK drops."),
  stat('lullaby', 'Lullaby', 'FLUFF', 'foe', 15, 'sound', [inflict('snooze')], 'Hums a soft lullaby. The foe falls SNOOZING.', { accuracy: 55 }),

  // ---- FIRE: special and mixed sweepers --------------------------------------------------------
  phys('ember-nip', 'Ember Nip', 'FIRE', 40, 100, 30, 'bite', 'A warm little nip. May leave the foe BURNED.', { effects: [inflict('burn', 10)] }),
  phys('kindle-dash', 'Kindle Dash', 'FIRE', 50, 100, 20, 'flame', "Dashes in a trail of sparks. Raises the user's SPEED.", { effects: [self({ spe: 1 })] }),
  phys('blaze-roll', 'Blaze Roll', 'FIRE', 65, 100, 25, 'flame', 'Rolls up in flames, even if FROZEN. May BURN the foe.', { effects: [{ kind: 'thaw' }, inflict('burn', 10)] }),
  phys('flare-dive', 'Flare Dive', 'FIRE', 100, 100, 15, 'flame', 'A blazing dive that thaws the user. Some recoil.', { effects: [{ kind: 'thaw' }, recoil(0.25)] }),
  spec('cinder-sneeze', 'Cinder Sneeze', 'FIRE', 40, 100, 25, 'flame', 'A sneeze of hot sparks. May leave the foe BURNED.', { effects: [inflict('burn', 10)] }),
  spec('campfire-ring', 'Campfire Ring', 'FIRE', 35, 90, 15, 'flame', 'Rings the foe in flames so it cannot swap out.', { effects: [{ kind: 'trap' }] }),
  spec('bonfire-burp', 'Bonfire Burp', 'FIRE', 90, 100, 15, 'flame', 'A huge fiery burp. May leave the foe BURNED.', { effects: [inflict('burn', 10)] }),
  spec('overtoast', 'Overtoast', 'FIRE', 120, 90, 5, 'beam', "Toasts at full blast. Sharply lowers the user's SP. ATK.", { effects: [self({ spa: -2 })] }),
  stat('hot-potato', 'Hot Potato', 'FIRE', 'foe', 15, 'flame', [inflict('burn')], 'Tosses a scorching potato. The foe is BURNED.', { accuracy: 85 }),

  // ---- WATER: bulky all-rounders ---------------------------------------------------------------
  phys('puddle-pounce', 'Puddle Pounce', 'WATER', 40, 100, 25, 'splash', 'Pounces through a puddle so fast it always goes first.', { priority: 1 }),
  phys('splash-n-dash', 'Splash N Dash', 'WATER', 60, 100, 20, 'splash', 'Splashes the foe, then dashes back to swap out.', { effects: [{ kind: 'pivot' }] }),
  phys('cannonball', 'Cannonball', 'WATER', 90, 100, 10, 'splash', 'Dives in tummy first. May make the foe flinch.', { effects: [flinch(20)] }),
  spec('splish-splash', 'Splish Splash', 'WATER', 40, 100, 30, 'splash', "Splashes the foe. May lower the foe's SPEED.", { effects: [foe({ spe: -1 }, 10)] , spread: true }),
  spec('sink-swirl', 'Sink Swirl', 'WATER', 35, 90, 15, 'splash', 'Spins the foe in a swirl so it cannot swap out.', { effects: [{ kind: 'trap' }] }),
  spec('hot-spring', 'Hot Spring', 'WATER', 80, 100, 15, 'splash', 'Steaming water that thaws the user. May BURN the foe.', { effects: [{ kind: 'thaw' }, inflict('burn', 30)] }),
  spec('geyser-gush', 'Geyser Gush', 'WATER', 110, 80, 5, 'beam', 'A mighty geyser of water. Hard to aim.'),
  stat('soggy-socks', 'Soggy Socks', 'WATER', 'foe', 20, 'debuff', [foe({ spe: -2 })], "Soaks the foe's feet. Its SPEED sharply drops."),

  // ---- LEAF: defensive support with status, drain and healing ---------------------------------
  phys('vine-flick', 'Vine Flick', 'LEAF', 45, 100, 25, 'leaf', 'Flicks the foe with a springy vine.'),
  phys('acorn-volley', 'Acorn Volley', 'LEAF', 25, 100, 30, 'leaf', 'Pelts the foe with acorns 2 to 5 times.', { contact: false, effects: [multi] }),
  phys('thorn-swipe', 'Thorn Swipe', 'LEAF', 90, 100, 15, 'slash', 'A swipe with a thorny tail. High critical-hit ratio.', { effects: [crit] }),
  spec('petal-puff', 'Petal Puff', 'LEAF', 40, 100, 30, 'leaf', 'Blows a puff of petals at the foe.'),
  spec('sap-sip', 'Sap Sip', 'LEAF', 60, 100, 15, 'leaf', "Sips the foe's energy. Heals half the damage dealt.", { effects: [drain(0.5)] }),
  spec('blossom-blast', 'Blossom Blast', 'LEAF', 90, 100, 10, 'leaf', "A burst of blossoms. May lower the foe's SP. DEF.", { effects: [foe({ spd: -1 }, 10)] , spread: true }),
  stat('snoozy-spores', 'Snoozy Spores', 'LEAF', 'foe', 15, 'leaf', [inflict('snooze')], 'Sprinkles sleepy spores. The foe falls SNOOZING.', { accuracy: 75 }),
  stat('sap-sprout', 'Sap Sprout', 'LEAF', 'foe', 10, 'leaf', [{ kind: 'seed' }], "Plants a sprout that sips the foe's HP every turn.", { accuracy: 90 }),
  stat('sunsoak', 'Sunsoak', 'LEAF', 'self', 10, 'heal', [heal(0.5)], 'Soaks up the sunshine to heal half its max HP.'),

  // ---- LIGHTNING: fast special glass cannons ---------------------------------------------------
  phys('fizz-nip', 'Fizz Nip', 'LIGHTNING', 45, 100, 30, 'spark', 'A fizzy, crackly nip. May leave the foe ZAPPED.', { effects: [inflict('zap', 10)] }),
  phys('bolt-bonk', 'Bolt Bonk', 'LIGHTNING', 85, 100, 15, 'punch', 'A charged bonk on the head. May leave the foe ZAPPED.', { effects: [inflict('zap', 10)] }),
  phys('wild-wheel', 'Wild Wheel', 'LIGHTNING', 90, 100, 15, 'spark', 'Runs its wheel so fast it flies off. Some recoil.', { effects: [recoil(0.25)] }),
  spec('tingle-zap', 'Tingle Zap', 'LIGHTNING', 40, 100, 30, 'spark', 'A tingly little zap. May leave the foe ZAPPED.', { effects: [inflict('zap', 10)] }),
  spec('zip-zap', 'Zip Zap', 'LIGHTNING', 70, 100, 20, 'spark', 'Zaps the foe, then zips back to swap out.', { effects: [{ kind: 'pivot' }] }),
  spec('thunder-squeak', 'Thunder Squeak', 'LIGHTNING', 90, 100, 15, 'spark', 'A squeak as loud as thunder. May leave the foe ZAPPED.', { effects: [inflict('zap', 10)] }),
  spec('megawatt', 'Megawatt', 'LIGHTNING', 110, 70, 10, 'beam', 'A huge bolt from the sky. May leave the foe ZAPPED.', { effects: [inflict('zap', 30)] }),
  stat('static-cuddle', 'Static Cuddle', 'LIGHTNING', 'foe', 20, 'spark', [inflict('zap')], 'A hug with charged fur. The foe is ZAPPED.', { accuracy: 90 }),
  stat('wheel-spin', 'Wheel Spin', 'LIGHTNING', 'self', 30, 'buff', [self({ spe: 2 })], 'Spins its wheel to warm up. SPEED sharply rises.'),

  // ---- EARTH: bulky physical tanks -------------------------------------------------------------
  phys('burrow-bump', 'Burrow Bump', 'EARTH', 45, 100, 30, 'quake', 'Pops up out of a tunnel right under the foe.'),
  phys('shovel-swipe', 'Shovel Swipe', 'EARTH', 75, 100, 15, 'slash', 'Digs in with shovel claws. High critical-hit ratio.', { effects: [crit] }),
  phys('tunnel-quake', 'Tunnel Quake', 'EARTH', 100, 100, 10, 'quake', 'Collapses every tunnel at once. The ground shakes!', { contact: false , spread: true }),
  spec('mud-pie', 'Mud Pie', 'EARTH', 40, 100, 25, 'goo', "Flings a mud pie. May lower the foe's SPEED.", { effects: [foe({ spe: -1 }, 30)] }),
  spec('sand-trap', 'Sand Trap', 'EARTH', 35, 85, 15, 'quake', 'Sinks the foe in sand so it cannot swap out.', { effects: [{ kind: 'trap' }] }),
  spec('mudslide', 'Mudslide', 'EARTH', 90, 100, 10, 'quake', "A rumbling wave of mud. May lower the foe's SP. DEF.", { effects: [foe({ spd: -1 }, 10)] , spread: true }),
  stat('dust-cloud', 'Dust Cloud', 'EARTH', 'foe', 15, 'debuff', [foe({ acc: -1 })], "Kicks up a cloud of dust. The foe's accuracy drops."),
  stat('mud-bath', 'Mud Bath', 'EARTH', 'self', 10, 'heal', [heal(0.5)], 'A relaxing mud bath that heals half its max HP.'),

  // ---- ROCK: slow walls that hit hard ----------------------------------------------------------
  phys('gravel-gnaw', 'Gravel Gnaw', 'ROCK', 45, 100, 30, 'bite', 'Gnaws on the foe with gravel-hard teeth.'),
  phys('pebble-flick', 'Pebble Flick', 'ROCK', 40, 100, 20, 'rock', 'Flicks a pebble so fast that it always goes first.', { priority: 1, contact: false }),
  phys('pebble-pelt', 'Pebble Pelt', 'ROCK', 25, 90, 15, 'rock', 'Pelts the foe with pebbles 2 to 5 times.', { contact: false, effects: [multi] }),
  phys('crag-crash', 'Crag Crash', 'ROCK', 100, 80, 5, 'rock', 'Hurls jagged crag shards. High critical-hit ratio.', { contact: false, effects: [crit] }),
  phys('boulder-bonk', 'Boulder Bonk', 'ROCK', 120, 80, 5, 'rock', 'A rock-hard headbutt. The user takes big recoil.', { effects: [recoil(0.5)] }),
  spec('gem-glint', 'Gem Glint', 'ROCK', 45, 100, 25, 'sparkle', 'Flashes a shiny gem right in the foe\'s eyes.'),
  spec('geode-beam', 'Geode Beam', 'ROCK', 90, 100, 10, 'beam', "Fires a geode's glow. May raise all the user's stats.", { effects: [self({ atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, 10)] }),
  stat('stonewall', 'Stonewall', 'ROCK', 'self', 15, 'shield', [self({ def: 2 })], 'Hardens up like a pebble. DEFENSE sharply rises.'),

  // ---- WINGED: fast hit-and-run attackers ------------------------------------------------------
  phys('wing-slap', 'Wing Slap', 'WINGED', 40, 100, 35, 'wind', 'Slaps the foe with a tiny wing.'),
  phys('homing-swoop', 'Homing Swoop', 'WINGED', 60, 100, 20, 'wind', 'A swoop that follows the foe. It never misses.', { effects: [{ kind: 'sureHit' }] }),
  phys('swoop-swap', 'Swoop Swap', 'WINGED', 70, 100, 20, 'wind', 'Swoops in to strike, then flies back to swap out.', { effects: [{ kind: 'pivot' }] }),
  phys('loop-de-loop', 'Loop De Loop', 'WINGED', 80, 100, 15, 'wind', 'Loops in from above. May make the foe flinch.', { effects: [flinch(20)] }),
  phys('comet-dive', 'Comet Dive', 'WINGED', 120, 100, 15, 'wind', 'A reckless dive from the clouds. Big recoil.', { effects: [recoil(1 / 3)] }),
  spec('breezy-puff', 'Breezy Puff', 'WINGED', 40, 100, 35, 'wind', 'Flaps up a breezy puff of air.', { spread: true }),
  spec('tornado-twirl', 'Tornado Twirl', 'WINGED', 110, 70, 10, 'wind', 'Twirls into a tornado. May confuse the foe.', { effects: [confuse(30)] , spread: true }),
  stat('fluster-flap', 'Fluster Flap', 'WINGED', 'foe', 15, 'wind', [confuse()], "Flaps wildly in the foe's face. The foe gets confused."),
  stat('preen', 'Preen', 'WINGED', 'self', 10, 'heal', [heal(0.5)], 'Tidies its wing feathers to heal half its max HP.'),
  stat('clear-skies', 'Clear Skies', 'WINGED', 'self', 20, 'wind', [{ kind: 'resetStages' }], 'Blows every stat change away, on both sides.'),

  // ---- FROST: hard-hitting bruisers ------------------------------------------------------------
  phys('chilly-nip', 'Chilly Nip', 'FROST', 45, 100, 30, 'bite', 'An icy nip. May leave the foe FROZEN.', { effects: [inflict('frozen', 10)] }),
  phys('frost-flick', 'Frost Flick', 'FROST', 40, 100, 30, 'ice', 'Flicks an ice chip so fast that it always goes first.', { priority: 1, contact: false }),
  phys('snowballs', 'Snowballs', 'FROST', 25, 100, 30, 'ice', 'Throws snowballs at the foe 2 to 5 times.', { contact: false, effects: [multi] }),
  phys('glacier-slam', 'Glacier Slam', 'FROST', 90, 90, 10, 'ice', 'Slams down like a glacier. May make the foe flinch.', { effects: [flinch(20)] }),
  spec('flurry-puff', 'Flurry Puff', 'FROST', 40, 100, 30, 'ice', 'A puff of snowflakes. May leave the foe FROZEN.', { effects: [inflict('frozen', 10)] , spread: true }),
  spec('polar-beam', 'Polar Beam', 'FROST', 90, 100, 10, 'beam', 'A freezing beam. May leave the foe FROZEN.', { effects: [inflict('frozen', 10)] }),
  spec('brain-freeze', 'Brain Freeze', 'FROST', 110, 85, 5, 'ice', 'So cold it hurts to think. May confuse the foe.', { effects: [confuse(30)] }),
  stat('cold-shoulder', 'Cold Shoulder', 'FROST', 'foe', 20, 'debuff', [foe({ atk: -1, spa: -1 })], "Snubs the foe so coolly its ATK and SP. ATK drop."),
  stat('freeze-frame', 'Freeze Frame', 'FROST', 'self', 20, 'ice', [{ kind: 'resetStages' }], 'Freezes time. Stat changes on both sides reset.'),

  // ---- SLIME: sticky status walls --------------------------------------------------------------
  phys('gooey-glomp', 'Gooey Glomp', 'SLIME', 40, 100, 30, 'goo', 'A sticky hug. May leave the foe GOOPED.', { effects: [inflict('goop', 30)] }),
  phys('slurp', 'Slurp', 'SLIME', 60, 100, 15, 'goo', 'A big wet slurp. Heals half the damage dealt.', { effects: [drain(0.5)] }),
  phys('goo-hammer', 'Goo Hammer', 'SLIME', 90, 100, 10, 'goo', 'Smacks with a hard glob. May leave the foe GOOPED.', { effects: [inflict('goop', 20)] }),
  spec('slime-spit', 'Slime Spit', 'SLIME', 40, 100, 30, 'goo', 'Spits a gob of slime. May leave the foe GOOPED.', { effects: [inflict('goop', 30)] }),
  spec('sour-splat', 'Sour Splat', 'SLIME', 65, 100, 10, 'goo', 'Power doubles if the foe has a status problem.', { effects: [{ kind: 'hex' }] }),
  spec('gloop-geyser', 'Gloop Geyser', 'SLIME', 90, 100, 10, 'goo', 'A geyser of gloop. May leave the foe GOOPED.', { effects: [inflict('goop', 30)] }),
  stat('stink-cloud', 'Stink Cloud', 'SLIME', 'foe', 10, 'goo', [inflict('goop')], 'A truly awful smell. The foe is GOOPED.', { accuracy: 90 }),
  stat('leech-lick', 'Leech Lick', 'SLIME', 'foe', 10, 'goo', [{ kind: 'seed' }], "A slimy lick that sips the foe's HP every turn.", { accuracy: 90 }),

  // ---- DARKNESS: fast physical tricksters ------------------------------------------------------
  phys('night-nibble', 'Night Nibble', 'DARKNESS', 50, 100, 25, 'bite', 'A sneaky bite in the dark. May make the foe flinch.', { effects: [flinch(20)] }),
  phys('peekaboo', 'Peekaboo', 'DARKNESS', 40, 100, 10, 'shadow', 'Peekaboo! The foe flinches. Only on its first turn out.', { priority: 3, effects: [{ kind: 'firstTurn' }] }),
  phys('dusk-crunch', 'Dusk Crunch', 'DARKNESS', 85, 100, 15, 'bite', "A crunchy bite. May lower the foe's DEFENSE.", { effects: [foe({ def: -1 }, 20)] }),
  spec('grumble', 'Grumble', 'DARKNESS', 50, 95, 15, 'sound', "A grumpy grumble that lowers the foe's SP. ATK.", { effects: [foe({ spa: -1 })] }),
  spec('jinx', 'Jinx', 'DARKNESS', 65, 100, 10, 'shadow', 'Power doubles if the foe has a status problem.', { effects: [{ kind: 'hex' }] }),
  spec('spooky-story', 'Spooky Story', 'DARKNESS', 0, 100, 15, 'shadow', 'A tale so scary it deals damage equal to its level.', { effects: [{ kind: 'fixed', damage: 'level' }] }),
  spec('nightfall', 'Nightfall', 'DARKNESS', 90, 100, 15, 'shadow', 'Brings a sudden night. May make the foe flinch.', { effects: [flinch(20)] }),
  stat('sneaky-scheme', 'Sneaky Scheme', 'DARKNESS', 'self', 20, 'buff', [self({ atk: 1, acc: 1 })], 'Plots its next move. ATTACK and accuracy rise.'),
  stat('stink-eye', 'Stink Eye', 'DARKNESS', 'foe', 5, 'shadow', [{ kind: 'trap' }], 'Gives the foe such a look that it cannot swap out.'),

  // ---- LIGHT: special walls and healers --------------------------------------------------------
  phys('twinkle-tap', 'Twinkle Tap', 'LIGHT', 40, 100, 35, 'sparkle', 'A gentle tap that leaves a twinkle behind.'),
  phys('prism-pounce', 'Prism Pounce', 'LIGHT', 90, 90, 10, 'sparkle', "A dazzling pounce. May lower the foe's ATTACK.", { effects: [foe({ atk: -1 }, 10)] }),
  spec('glimmer', 'Glimmer', 'LIGHT', 40, 100, 30, 'sparkle', 'A soft glimmer of light. May confuse the foe.', { effects: [confuse(10)] }),
  spec('stardust', 'Stardust', 'LIGHT', 60, 100, 20, 'sparkle', 'Showers the foe in stardust. It never misses.', { effects: [{ kind: 'sureHit' }] , spread: true }),
  spec('sunbeam', 'Sunbeam', 'LIGHT', 90, 100, 15, 'beam', "A warm beam of light. May lower the foe's SP. ATK.", { effects: [foe({ spa: -1 }, 30)] }),
  spec('rainbow-ray', 'Rainbow Ray', 'LIGHT', 120, 80, 5, 'beam', 'A blinding rainbow. Hard to aim.'),
  stat('dizzy-sparkle', 'Dizzy Sparkle', 'LIGHT', 'foe', 10, 'sparkle', [confuse()], 'Sparkles in swirly patterns. The foe gets confused.'),
  stat('glow-up', 'Glow Up', 'LIGHT', 'self', 20, 'buff', [self({ spa: 1, spd: 1 })], 'Glows brighter and brighter. SP. ATK and SP. DEF rise.'),
  stat('warm-glow', 'Warm Glow', 'LIGHT', 'self', 10, 'heal', [heal(0.5), { kind: 'cure', who: 'self' }], 'Glows warmly to heal half its HP and cure its status.'),

  // ---- COOKING: bulky healers and buffers ------------------------------------------------------
  phys('whisk-whack', 'Whisk Whack', 'COOKING', 40, 100, 35, 'food', 'A whack with a whisk. Lumpy batter not included.'),
  phys('rolling-pin', 'Rolling Pin', 'COOKING', 90, 100, 15, 'food', 'Flattens the foe like cookie dough.'),
  spec('pepper-puff', 'Pepper Puff', 'COOKING', 40, 100, 30, 'food', 'A puff of pepper. The foe may sneeze and flinch.', { effects: [flinch(10)] }),
  spec('boiling-broth', 'Boiling Broth', 'COOKING', 90, 100, 10, 'food', 'A bubbling hot broth. May leave the foe BURNED.', { effects: [inflict('burn', 10)] }),
  spec('kitchen-sink', 'Kitchen Sink', 'COOKING', 120, 80, 5, 'food', 'Throws everything at the foe, even the kitchen sink.'),
  stat('snack-time', 'Snack Time', 'COOKING', 'self', 10, 'food', [heal(0.5)], 'Eats a tasty snack to heal half its max HP.'),
  stat('secret-sauce', 'Secret Sauce', 'COOKING', 'self', 20, 'buff', [self({ atk: 1, spa: 1 })], 'A spoonful of secret sauce. ATK and SP. ATK rise.'),
  stat('comfort-soup', 'Comfort Soup', 'COOKING', 'self', 5, 'heal', [{ kind: 'cure', who: 'team' }], "Shares a pot of soup. Cures the whole team's status."),
  stat('food-coma', 'Food Coma', 'COOKING', 'self', 5, 'food', [{ kind: 'rest' }], 'Eats a feast and naps 2 turns. Heals all HP and status.'),
  stat('warm-milk', 'Warm Milk', 'COOKING', 'foe', 10, 'food', [inflict('snooze')], 'Offers a cup of warm milk. The foe falls SNOOZING.', { accuracy: 75 }),

  // ---- METAL: armoured walls -------------------------------------------------------------------
  phys('cog-nip', 'Cog Nip', 'METAL', 45, 100, 30, 'bite', 'Nips the foe with gear-toothed jaws.'),
  phys('rivet-rap', 'Rivet Rap', 'METAL', 40, 100, 30, 'punch', 'A rapid rivet punch that always goes first.', { priority: 1 }),
  phys('scissor-snip', 'Scissor Snip', 'METAL', 70, 100, 20, 'slash', 'Snips with sharp claws. High critical-hit ratio.', { effects: [crit] }),
  phys('anvil-drop', 'Anvil Drop', 'METAL', 95, 90, 10, 'metal', 'Drops an anvil from nowhere. May make the foe flinch.', { contact: false, effects: [flinch(20)] }),
  spec('magnet-hum', 'Magnet Hum', 'METAL', 45, 100, 25, 'metal', 'A buzzing magnetic hum that rattles the foe.', { spread: true }),
  spec('chrome-cannon', 'Chrome Cannon', 'METAL', 90, 100, 10, 'beam', "A blast of polished chrome. May lower the foe's SP. DEF.", { effects: [foe({ spd: -1 }, 10)] }),
  stat('tune-up', 'Tune Up', 'METAL', 'self', 20, 'buff', [self({ atk: 1, spe: 1 })], 'Oils its gears. ATTACK and SPEED rise.'),
  stat('tin-dome', 'Tin Dome', 'METAL', 'self', 10, 'shield', [{ kind: 'protect' }], 'Hides under a tin cup and blocks every attack.', { priority: 4 }),
  stat('squeaky-hinge', 'Squeaky Hinge', 'METAL', 'foe', 30, 'sound', [foe({ spd: -2 })], "A dreadful squeak. The foe's SP. DEF sharply drops.", { accuracy: 85 }),
  stat('gear-grind', 'Gear Grind', 'METAL', 'foe', 30, 'sound', [foe({ def: -2 })], "Grinds its gears so loudly the foe's DEFENSE sharply drops.", { accuracy: 85 }),

  // ---- MIND: special sweepers ------------------------------------------------------------------
  phys('brain-bonk', 'Brain Bonk', 'MIND', 45, 100, 30, 'psy', 'A thoughtful little headbutt.'),
  phys('big-idea', 'Big Idea', 'MIND', 85, 90, 15, 'psy', 'Bonks the foe with a big idea. May make it flinch.', { effects: [flinch(20)] }),
  spec('thought-bubble', 'Thought Bubble', 'MIND', 40, 100, 30, 'psy', 'Pops a thought bubble on the foe. May confuse it.', { effects: [confuse(10)] }),
  spec('think-fast', 'Think Fast', 'MIND', 60, 100, 20, 'psy', 'A quick mind zap, then it swaps out.', { effects: [{ kind: 'pivot' }] }),
  spec('brainwave', 'Brainwave', 'MIND', 90, 100, 10, 'psy', "A wave of brain power. May lower the foe's SP. DEF.", { effects: [foe({ spd: -1 }, 10)] , spread: true }),
  stat('counting-sheep', 'Counting Sheep', 'MIND', 'foe', 20, 'psy', [inflict('snooze')], 'Counts sheep out loud. The foe falls SNOOZING.', { accuracy: 60 }),
  stat('brain-fog', 'Brain Fog', 'MIND', 'foe', 10, 'psy', [confuse()], "Fills the foe's head with fog. The foe gets confused."),
  stat('deep-thought', 'Deep Thought', 'MIND', 'self', 20, 'buff', [self({ spa: 2 })], 'Thinks very, very hard. SP. ATK sharply rises.'),
  stat('daydream', 'Daydream', 'MIND', 'self', 10, 'heal', [heal(0.5)], 'Drifts into a happy daydream to heal half its HP.'),

  // ---- BRAWL: physical wallbreakers ------------------------------------------------------------
  phys('boop', 'Boop', 'BRAWL', 40, 100, 35, 'punch', 'A firm boop right on the nose.'),
  phys('paw-jab', 'Paw Jab', 'BRAWL', 40, 100, 30, 'punch', 'A lightning-quick jab that always goes first.', { priority: 1 }),
  phys('tough-it-out', 'Tough It Out', 'BRAWL', 70, 100, 20, 'punch', 'Power doubles if the user has a status problem.', { effects: [{ kind: 'facade' }] }),
  phys('lunch-punch', 'Lunch Punch', 'BRAWL', 75, 100, 10, 'punch', 'A hearty punch. Heals half the damage dealt.', { effects: [drain(0.5)] }),
  phys('burrow-toss', 'Burrow Toss', 'BRAWL', 0, 100, 20, 'tackle', 'Tosses the foe. Deals damage equal to its level.', { effects: [{ kind: 'fixed', damage: 'level' }] }),
  phys('haymaker', 'Haymaker', 'BRAWL', 90, 100, 15, 'punch', 'A big wind-up punch. May confuse the foe.', { effects: [confuse(10)] }),
  phys('all-out-brawl', 'All Out Brawl', 'BRAWL', 120, 100, 5, 'punch', "Holds nothing back. Lowers the user's DEF and SP. DEF.", { effects: [self({ def: -1, spd: -1 })] }),
  spec('battle-cry', 'Battle Cry', 'BRAWL', 40, 100, 30, 'sound', 'A tiny but very fierce battle cry.'),
  spec('chi-blast', 'Chi Blast', 'BRAWL', 90, 100, 10, 'beam', 'A ball of fighting spirit. It never misses.', { effects: [{ kind: 'sureHit' }] }),
  stat('flex', 'Flex', 'BRAWL', 'self', 20, 'buff', [self({ atk: 1, def: 1 })], 'Flexes its tiny muscles. ATTACK and DEFENSE rise.'),
];

function byId(list: MoveDef[]): Record<MoveId, MoveDef> {
  const out: Record<MoveId, MoveDef> = {};
  for (const m of list) {
    if (out[m.id]) throw new Error(`duplicate move id: '${m.id}'`);
    out[m.id] = m;
  }
  return out;
}

export const MOVES: Record<MoveId, MoveDef> = byId(LIST);
