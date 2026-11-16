// Deterministic randomness for the persistent world. Every random decision the game systems make
// outside a battle (new dragon genes, dig loot, rewards, flavour picks, battle seeds) is drawn from
// GameState.seed, and every draw advances it, so a save made at any moment replays identically.
//
// The generator is mulberry32, the same one the vendored engine uses (src/lib/engine/rng.ts), with
// its whole internal state stored in `state.seed`. Instances are throwaway views over that field:
// two instances made from the same GameState share one stream.
import type { RngInstance } from '../lib/engine/rng.ts';
import type { GameState } from './types.ts';

/** One mulberry32 step on `state.seed`; returns a float in [0, 1). */
function step(state: GameState): number {
  const s = ((state.seed >>> 0) + 0x6d2b79f5) >>> 0;
  state.seed = s;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** An RngInstance whose draws advance `state.seed`, so results replay from a save. */
export function stateRng(state: GameState): RngInstance {
  const next = (): number => step(state);
  return {
    seed(n: number) { state.seed = (Math.trunc(Number(n)) | 0) >>> 0; },
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => (arr.length ? arr[Math.floor(next() * arr.length)] : undefined),
    chance: (p) => next() < p,
  };
}

/** A fresh 31-bit seed drawn from the world stream (for a battle's own RNG). Never zero. */
export function nextSeed(state: GameState): number {
  return 1 + Math.floor(step(state) * 0x7ffffffe);
}

/**
 * Pick one entry by weight (weights <= 0 are never picked). Returns undefined for an empty list or
 * when every weight is zero.
 */
export function weightedPick<T>(rng: RngInstance, entries: readonly { value: T; weight: number }[]): T | undefined {
  let total = 0;
  for (const e of entries) if (e.weight > 0) total += e.weight;
  if (total <= 0) return undefined;
  let roll = rng.next() * total;
  for (const e of entries) {
    if (e.weight <= 0) continue;
    roll -= e.weight;
    if (roll < 0) return e.value;
  }
  // Floating-point leftovers land on the last positive entry.
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].weight > 0) return entries[i].value;
  return undefined;
}
