// STUB - replaced by the content-core agent.
import type { AbilityDef, AbilityId } from './schema.ts';

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  kindle: { id: 'kindle', name: 'Kindle', description: 'Powers up FIRE moves when in a pinch.', effect: { kind: 'pinch', type: 'FIRE', mult: 1.5 }, parallel: 'Blaze' },
};
