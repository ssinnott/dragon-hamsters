// STUB - replaced by the content-core agent.
import type { FoodDef, FoodId, ItemDef, ItemId } from './schema.ts';

export const FOODS: Record<FoodId, FoodDef> = {
  seeds: { id: 'seeds', name: 'Sunflower Seeds', description: '', price: 5, fullness: 25, happiness: 5, xp: 0, color: '#d8c070', accent: '#403020' },
  carrot: { id: 'carrot', name: 'Carrot', description: '', price: 8, fullness: 35, happiness: 8, xp: 0, color: '#f08030', accent: '#40a040' },
  berries: { id: 'berries', name: 'Blueberries', description: '', price: 10, fullness: 15, happiness: 20, xp: 0, color: '#4060d0', accent: '#203080' },
  cheese: { id: 'cheese', name: 'Cheese Cube', description: '', price: 12, fullness: 30, happiness: 15, xp: 0, color: '#f0d040', accent: '#c0a020' },
  dragonfruit: { id: 'dragonfruit', name: 'Dragonfruit', description: '', price: 40, fullness: 40, happiness: 30, xp: 60, color: '#e04090', accent: '#60c040' },
};
export const ITEMS: Record<ItemId, ItemDef> = {
  seedcake: { id: 'seedcake', name: 'Seed Cake', description: '', price: 20, effect: { kind: 'heal', fraction: 0.5 }, fieldUse: true, color: '#d0a060', accent: '#806030' },
  royalcake: { id: 'royalcake', name: 'Royal Seed Cake', description: '', price: 60, effect: { kind: 'heal', fraction: 1 }, fieldUse: true, color: '#f0d060', accent: '#c08020' },
  peppep: { id: 'peppep', name: 'Pep Pepper', description: '', price: 50, effect: { kind: 'revive', fraction: 0.5 }, fieldUse: true, color: '#e03020', accent: '#40a040' },
  herbtea: { id: 'herbtea', name: 'Herbal Tea', description: '', price: 15, effect: { kind: 'cure' }, fieldUse: true, color: '#60b060', accent: '#305030' },
  spicybiscuit: { id: 'spicybiscuit', name: 'Spicy Biscuit', description: '', price: 35, effect: { kind: 'stages', changes: { atk: 1, spa: 1 } }, fieldUse: false, color: '#c07030', accent: '#e03020' },
};
