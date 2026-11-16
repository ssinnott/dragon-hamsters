// STUB - replaced by the content-core agent. Type list, colours, archetype templates and the chart.
import { TYPE_IDS, type Stats, type TypeId, type TypeInfo } from './schema.ts';

const flat: Stats = { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 };
export const TYPES: Record<TypeId, TypeInfo> = Object.fromEntries(TYPE_IDS.map((id) => [id, {
  id, name: id, color: '#888888', dark: '#444444', light: '#cccccc', blurb: '', parallel: '', role: '', template: flat,
}])) as Record<TypeId, TypeInfo>;

/** attacker -> defender -> multiplier; omitted pairs are 1. */
export const CHART: Record<TypeId, Partial<Record<TypeId, number>>> = Object.fromEntries(TYPE_IDS.map((id) => [id, {}])) as Record<TypeId, Partial<Record<TypeId, number>>>;

/** Multiplier of an attack of type `attack` against a defender with `defender` types (product over its types). */
export function effectiveness(attack: TypeId, defender: readonly TypeId[]): number {
  let m = 1;
  for (const d of defender) m *= CHART[attack][d] ?? 1;
  return m;
}
