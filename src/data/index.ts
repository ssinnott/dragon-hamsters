// Lookups over the content tables. Every accessor throws on an unknown id: a bad reference is a
// content bug, and tools/contenttest.ts walks every reference so it fails there first.
import type {
  AbilityDef, AbilityId, ActivityDef, ActivityId, FoodDef, FoodId, ItemDef, ItemId, LocationDef,
  LocationId, MissionDef, MissionId, MissionNode, MissionTypeDef, MissionTypeId, MoveDef, MoveId, OrgDef, OrgId,
  PersonalityDef, PersonalityId, SpeciesDef, SpeciesId, TypeId, TypeInfo, VillainDef, VillainId,
} from './schema.ts';
import { TYPES, CHART, effectiveness, TYPE_CYCLES, TYPE_CYCLE_NAMES } from './types.ts';
import { MOVES } from './moves.ts';
import { ABILITIES } from './abilities.ts';
import { PERSONALITIES } from './personalities.ts';
import { FOODS, ITEMS } from './items.ts';
import { ACTIVITIES } from './activities.ts';
import { SPECIES, STARTERS } from './species.ts';
import { ORGS, VILLAINS } from './villains.ts';
import { MISSION_TYPES, LOCATIONS, MISSIONS } from './missions.ts';

function must<T>(v: T | undefined, what: string, id: string): T {
  if (v === undefined) throw new Error(`unknown ${what}: '${id}'`);
  return v;
}

const speciesById = new Map<SpeciesId, SpeciesDef>(SPECIES.map((s) => [s.id, s]));
const missionById = new Map<MissionId, MissionDef>(MISSIONS.map((m) => [m.id, m]));
const personalityById = new Map<PersonalityId, PersonalityDef>(PERSONALITIES.map((p) => [p.id, p]));

export const getType = (id: TypeId): TypeInfo => must(TYPES[id], 'type', id);
export const getMove = (id: MoveId): MoveDef => must(MOVES[id], 'move', id);
export const getAbility = (id: AbilityId): AbilityDef => must(ABILITIES[id], 'ability', id);
export const getPersonality = (id: PersonalityId): PersonalityDef => must(personalityById.get(id), 'personality', id);
export const getFood = (id: FoodId): FoodDef => must(FOODS[id], 'food', id);
export const getItem = (id: ItemId): ItemDef => must(ITEMS[id], 'item', id);
export const getActivity = (id: ActivityId): ActivityDef => must(ACTIVITIES[id], 'activity', id);
export const getSpecies = (id: SpeciesId): SpeciesDef => must(speciesById.get(id), 'species', id);
export const getOrg = (id: OrgId): OrgDef => must(ORGS[id], 'org', id);
export const getVillain = (id: VillainId): VillainDef => must(VILLAINS[id], 'villain', id);
export const getMission = (id: MissionId): MissionDef => must(missionById.get(id), 'mission', id);
export const getMissionType = (id: MissionTypeId): MissionTypeDef => must(MISSION_TYPES[id], 'mission type', id);
export const getLocation = (id: LocationId): LocationDef => must(LOCATIONS[id], 'location', id);

/** Is this id a food (as opposed to a battle item)? Mission rewards mix both. */
export const isFood = (id: string): id is FoodId => Object.prototype.hasOwnProperty.call(FOODS, id);

/**
 * The villains whose taunts the squad hears before a battle or boss node, in the order shown: the
 * first enemy of a battle; in a boss encounter the boss (last), then each lieutenant in front of
 * him, who steps up first. Any other node: none.
 */
export function tauntingVillains(node: MissionNode): VillainDef[] {
  if (node.kind === 'battle') {
    const first = node.encounter.enemies[0];
    return first ? [getVillain(first.villain)] : [];
  }
  if (node.kind !== 'boss') return [];
  const list = node.encounter.enemies.map((e) => getVillain(e.villain));
  const boss = list[list.length - 1];
  return boss ? [boss, ...list.slice(0, -1).filter((v) => v.role === 'lieutenant')] : [];
}

/** Species in Dragondex order. */
export const SPECIES_BY_DEX: readonly SpeciesDef[] = [...SPECIES].sort((a, b) => a.dex - b.dex);
/** Missions in campaign order (org order, then index). */
export const MISSIONS_IN_ORDER: readonly MissionDef[] = [...MISSIONS].sort(
  (a, b) => ORGS[a.org].order - ORGS[b.org].order || a.index - b.index,
);

export {
  CHART, effectiveness, TYPE_CYCLES, TYPE_CYCLE_NAMES,
  TYPES, MOVES, ABILITIES, PERSONALITIES, FOODS, ITEMS, ACTIVITIES, SPECIES, STARTERS, ORGS, VILLAINS,
  MISSION_TYPES, LOCATIONS, MISSIONS,
};
