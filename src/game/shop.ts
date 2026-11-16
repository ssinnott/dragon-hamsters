// The Pantry Shop: every food and every battle item, at the prices in the content tables.
import { FOOD_IDS, ITEM_IDS, type FoodId, type ItemId } from '../data/schema.ts';
import { FOODS, ITEMS, isFood } from '../data/index.ts';
import type { GameState } from './types.ts';
import { BAG_MAX } from './habitat.ts';

/** Shop shelves: the five foods, then the five items. */
export const SHOP: { id: FoodId | ItemId; price: number }[] = [
  ...FOOD_IDS.map((id) => ({ id, price: FOODS[id].price })),
  ...ITEM_IDS.map((id) => ({ id, price: ITEMS[id].price })),
];

/** Display name of a shop entry. */
export function shopName(id: FoodId | ItemId): string {
  return isFood(id) ? FOODS[id].name : ITEMS[id as ItemId].name;
}

/** How many the player already has (pantry for food, bag for items). */
export function owned(state: GameState, id: FoodId | ItemId): number {
  return isFood(id) ? state.food[id] ?? 0 : state.items[id as ItemId] ?? 0;
}

/** Buy `qty` (default 1). Checks coins and shelf space; changes nothing on a refusal. */
export function buy(state: GameState, id: FoodId | ItemId, qty: number = 1): { ok: boolean; line: string } {
  const entry = SHOP.find((e) => e.id === id);
  if (!entry) return { ok: false, line: 'THE SHOP DOES NOT SELL THAT' };
  const n = Math.floor(qty);
  if (!Number.isFinite(n) || n < 1) return { ok: false, line: 'PICK HOW MANY TO BUY' };
  const name = shopName(id);
  const have = owned(state, id);
  if (have + n > BAG_MAX) return { ok: false, line: `NO ROOM FOR MORE ${name.toUpperCase()}` };
  const cost = entry.price * n;
  if (cost > state.coins) return { ok: false, line: `NOT ENOUGH COINS! YOU NEED ${cost - state.coins} MORE.` };
  state.coins -= cost;
  if (isFood(id)) state.food[id] = have + n;
  else state.items[id as ItemId] = have + n;
  return { ok: true, line: `Bought ${n > 1 ? n + ' x ' : ''}${name} for ${cost} coins. Thank you, agent!` };
}
