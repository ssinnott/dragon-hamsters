// The Pantry: five foods (fed at the Snack Bar) and five battle items, as in docs/DESIGN.md.
// Seeds are the cheap staple, cheese the filling one, berries the happy treat and dragonfruit the
// rare XP snack. Fullness and happiness are 0-100 needs; a favourite food doubles the happiness.
import type { FoodDef, FoodId, ItemDef, ItemId } from './schema.ts';

export const FOODS: Record<FoodId, FoodDef> = {
  seeds: {
    id: 'seeds', name: 'Sunflower Seeds', price: 5, fullness: 30, happiness: 4, xp: 0,
    description: 'Stripy sunflower seeds. Cheap, crunchy and filling.',
    color: '#e2c878', accent: '#3a2c1c',
  },
  carrot: {
    id: 'carrot', name: 'Crunchy Carrot', price: 10, fullness: 50, happiness: 8, xp: 0,
    description: 'A fresh, crunchy carrot. Keeps little teeth in tip-top shape.',
    color: '#f07a26', accent: '#3e9a34',
  },
  berries: {
    id: 'berries', name: 'Blueberry Bundle', price: 15, fullness: 20, happiness: 25, xp: 0,
    description: 'A bundle of juicy blueberries. A sweet treat that lifts any mood.',
    color: '#4a5cd0', accent: '#2a8a3a',
  },
  cheese: {
    id: 'cheese', name: 'Cheese Cube', price: 22, fullness: 70, happiness: 15, xp: 0,
    description: 'A chunky cube of cheese. Very filling. Do not tell the mice.',
    color: '#f2d040', accent: '#c09a1a',
  },
  dragonfruit: {
    id: 'dragonfruit', name: 'Dragonfruit', price: 45, fullness: 40, happiness: 30, xp: 150,
    description: 'A rare, magical fruit. Every bite teaches something new: +150 XP.',
    color: '#e8408e', accent: '#6cc040',
  },
};

export const ITEMS: Record<ItemId, ItemDef> = {
  seedcake: {
    id: 'seedcake', name: 'Seed Cake', price: 20, effect: { kind: 'heal', fraction: 0.5 }, fieldUse: true,
    description: 'A dense little cake of pressed seeds. Restores half of max HP.',
    color: '#d4a464', accent: '#7a5428',
  },
  royalcake: {
    id: 'royalcake', name: 'Royal Seed Cake', price: 70, effect: { kind: 'heal', fraction: 1 }, fieldUse: true,
    description: 'A golden layer cake fit for a hamster king. Restores all HP.',
    color: '#f4d464', accent: '#c07a1c',
  },
  peppep: {
    id: 'peppep', name: 'Pep Pepper', price: 60, effect: { kind: 'revive', fraction: 0.5 }, fieldUse: true,
    description: 'So peppy it gets a fainted dragon back up with half its HP.',
    color: '#e0301c', accent: '#40a040',
  },
  herbtea: {
    id: 'herbtea', name: 'Herbal Tea', price: 15, effect: { kind: 'cure' }, fieldUse: true,
    description: 'A soothing cup of herbal tea. Cures status problems and confusion.',
    color: '#6cb460', accent: '#f2ead8',
  },
  spicybiscuit: {
    id: 'spicybiscuit', name: 'Spicy Biscuit', price: 35, effect: { kind: 'stages', changes: { atk: 1, spa: 1 } }, fieldUse: false,
    description: 'A fiery biscuit for battle. Raises ATTACK and SP. ATK by one stage.',
    color: '#c47634', accent: '#e0301c',
  },
};
