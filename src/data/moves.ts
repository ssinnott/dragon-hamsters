// STUB - replaced by the content-core agent.
import type { MoveDef, MoveId } from './schema.ts';

export const MOVES: Record<MoveId, MoveDef> = {
  nibble: { id: 'nibble', name: 'Nibble', type: 'FLUFF', category: 'physical', power: 40, accuracy: 100, pp: 35, priority: 0, contact: true, target: 'foe', effects: [], description: 'A quick little bite.', fx: 'bite' },
};
