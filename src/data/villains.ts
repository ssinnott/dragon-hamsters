// STUB - replaced by the villains agent.
import type { OrgDef, OrgId, VillainDef, VillainId } from './schema.ts';

const org = (id: OrgId, order: number): OrgDef => ({ id, name: id, short: id, order, boss: 'big-cheese', motto: '', description: '', lair: '', themeTypes: ['FLUFF'], emblem: '#f0d040', emblemAccent: '#202020' });
export const ORGS: Record<OrgId, OrgDef> = {
  cheese: org('cheese', 1), crows: org('crows', 2), snakes: org('snakes', 3), cats: org('cats', 4), ferrets: org('ferrets', 5),
};
export const VILLAINS: Record<VillainId, VillainDef> = {
  'big-cheese': {
    id: 'big-cheese', name: 'The Big Cheese', org: 'cheese', role: 'boss', types: ['COOKING', 'DARKNESS'],
    baseStats: { hp: 90, atk: 80, def: 70, spa: 60, spd: 70, spe: 50 }, ability: 'kindle',
    learnset: [{ level: 1, move: 'nibble' }], baseXp: 180, coins: 50, taunt: 'Stub.', defeat: 'Stub.', description: 'Stub.',
    visual: { animal: 'mouse', body: '#9a8a80', belly: '#e0d0c8', accent: '#f0d040', eye: '#101010', outfit: 'suit', outfitColor: '#303040', prop: 'cheeseHat', size: 1.4 },
  },
};
