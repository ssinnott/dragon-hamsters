// STUB - replaced by the missions agent.
import type { LocationDef, LocationId, MissionDef, MissionTypeDef, MissionTypeId } from './schema.ts';

const mt = (id: MissionTypeId): MissionTypeDef => ({ id, name: id, description: '', twist: '' });
export const MISSION_TYPES: Record<MissionTypeId, MissionTypeDef> = {
  retrieve: mt('retrieve'), rescue: mt('rescue'), sabotage: mt('sabotage'), infiltrate: mt('infiltrate'), defend: mt('defend'),
};
const loc = (id: LocationId): LocationDef => ({ id, name: id, description: '', sky: '#203050', far: '#304060', mid: '#405070', floor: '#605040', accent: '#f0d040' });
export const LOCATIONS: Record<LocationId, LocationDef> = {
  museum: loc('museum'), docks: loc('docks'), zoo: loc('zoo'), tower: loc('tower'), lab: loc('lab'),
};
export const MISSIONS: MissionDef[] = [
  {
    id: 'cheese-1', org: 'cheese', type: 'retrieve', location: 'museum', index: 1, title: 'The Great Egg Heist',
    objective: 'Recover the dinosaur egg', briefing: 'Stub.', level: 5,
    nodes: [{ kind: 'boss', label: 'Showdown', encounter: { enemies: [{ villain: 'big-cheese', level: 7 }], intro: 'Stub.' } }],
    rewards: { coins: 100, items: [], dragon: { species: ['emberpuff'], chance: 0.3 } }, requires: [], success: 'Stub.',
  },
];
