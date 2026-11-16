// STUB - replaced by the content-core agent.
import type { ActivityDef, ActivityId } from './schema.ts';

export const ACTIVITIES: Record<ActivityId, ActivityDef> = {
  feed: { id: 'feed', name: 'Snack Bar', verb: 'had a snack', description: '', energy: 0, fullness: 0, happiness: 0, training: {}, xpFraction: 0, likedBy: [], usesSlot: false },
  wheel: { id: 'wheel', name: 'Hamster Wheel', verb: 'ran on the wheel', description: '', energy: 20, fullness: 10, happiness: 5, training: { spe: 12 }, xpFraction: 0.1, likedBy: ['LIGHTNING', 'WINGED'], usesSlot: true },
  dig: { id: 'dig', name: 'Treasure Tunnels', verb: 'dug for treasure', description: '', energy: 20, fullness: 10, happiness: 5, training: { atk: 6, def: 6 }, xpFraction: 0.1, likedBy: ['EARTH', 'ROCK', 'METAL'], usesSlot: true },
  nap: { id: 'nap', name: 'Cozy Nest', verb: 'took a nap', description: '', energy: -50, fullness: 5, happiness: 5, training: {}, xpFraction: 0, likedBy: ['FLUFF', 'COOKING'], usesSlot: true },
  play: { id: 'play', name: 'Ball Pit', verb: 'played in the ball pit', description: '', energy: 15, fullness: 10, happiness: 25, training: { spa: 6, spd: 6 }, xpFraction: 0.1, likedBy: ['WATER', 'LIGHT'], usesSlot: true },
};
