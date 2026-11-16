// The five Burrow stations (docs/DESIGN.md, "The Burrow"). Every type loves exactly one of them:
// a dragon doing its favourite activity gets double happiness (and better loot when digging).
import type { ActivityDef, ActivityId } from './schema.ts';

export const ACTIVITIES: Record<ActivityId, ActivityDef> = {
  feed: {
    id: 'feed', name: 'Snack Bar', verb: 'had a tasty snack',
    description: 'Feed one food from the pantry. A favourite food makes it twice as happy. Uses no slot.',
    energy: 0, fullness: 0, happiness: 0, training: {}, xpFraction: 0,
    likedBy: ['FLUFF', 'COOKING'], usesSlot: false,
  },
  wheel: {
    id: 'wheel', name: 'Hamster Wheel', verb: 'ran on the wheel',
    description: 'Round and round and round! Trains SPEED and earns a little XP.',
    energy: 20, fullness: 10, happiness: 5, training: { spe: 16 }, xpFraction: 0.1,
    likedBy: ['LIGHTNING', 'WINGED', 'FIRE', 'BRAWL'], usesSlot: true,
  },
  dig: {
    id: 'dig', name: 'Treasure Tunnels', verb: 'dug for treasure',
    description: 'Dig for coins, snacks and the odd lost item. Trains ATTACK and DEFENSE.',
    energy: 20, fullness: 12, happiness: 5, training: { atk: 8, def: 8 }, xpFraction: 0,
    likedBy: ['EARTH', 'ROCK', 'METAL', 'DARKNESS'], usesSlot: true,
  },
  nap: {
    id: 'nap', name: 'Cozy Nest', verb: 'took a cozy nap',
    description: 'A snooze in the softest bedding. Restores energy and all HP, and cures status.',
    energy: -50, fullness: 5, happiness: 5, training: {}, xpFraction: 0,
    likedBy: ['MIND', 'LEAF', 'FROST'], usesSlot: true,
  },
  play: {
    id: 'play', name: 'Ball Pit', verb: 'played in the ball pit',
    description: 'Bounce, tumble and squeak! Lots of happiness. Trains SP. ATK and SP. DEF.',
    energy: 15, fullness: 8, happiness: 20, training: { spa: 8, spd: 8 }, xpFraction: 0.1,
    likedBy: ['WATER', 'LIGHT', 'SLIME'], usesSlot: true,
  },
};
