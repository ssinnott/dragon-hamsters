// STUB - replaced by the species agent.
import type { SpeciesDef, SpeciesId } from './schema.ts';

export const SPECIES: SpeciesDef[] = [
  {
    id: 'emberpuff', dex: 1, name: 'Emberpuff', category: 'Ember Hamster', types: ['FIRE'],
    baseStats: { hp: 39, atk: 52, def: 43, spa: 60, spd: 50, spe: 65 }, abilities: ['kindle'],
    learnset: [{ level: 1, move: 'nibble' }], backstory: 'A stub.', fact: 'A stub.', height: '0.2 m', weight: '0.4 kg',
    favoriteFood: 'cheese', rarity: 'starter', baseXp: 62,
    visual: { body: '#e8743a', belly: '#ffd9a0', accent: '#ffcf3a', wing: '#ff9a4a', eye: '#2a1a12', cheek: '#ff7a7a', size: 0.8, build: 0.2, wings: 'stubby', horns: 'nubs', tail: 'flame', pattern: 'none', extras: [] },
  },
];
/** The three starter choices (the player takes two): FIRE, LEAF, WATER first stages. */
export const STARTERS: SpeciesId[] = ['emberpuff'];
