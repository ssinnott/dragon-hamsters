// The enemy's decisions. Three levels (docs/DESIGN.md "Enemy AI"):
//   minion  a random usable move, leaning towards damage;
//   elite   the best expected damage about 75% of the time, otherwise sensible status/buff use;
//   boss    reads the type matchup: takes KOs, heals when low, buffs when safe, and swaps to a
//           teammate that resists your active dragon when its own active is badly matched
//           (at most twice a battle, never on the turn it came in, never into a worse matchup).
// All randomness comes from state.rng, so the battle stays deterministic.
import type { MoveDef, TypeId } from '../data/schema.ts';
import type { BattleMon, BattleState } from './types.ts';
import { abilityOf, absorbs, battleMove, effectiveStat, estimateDamage, findEffect, isDamaging } from './damage.ts';
import { typeEffectiveness } from './matchup.ts';
import { accStageMult } from './stats.ts';

export type EnemyAction = { kind: 'move'; slot: number } | { kind: 'switch'; index: number };

/** Enemy counter-swaps allowed per battle. */
export const MAX_ENEMY_SWAPS = 2;

interface Option {
  slot: number;
  move: MoveDef;
  damaging: boolean;
  /** Would surely fail or do nothing useful right now. */
  useless: boolean;
  /** Expected damage (hit chance included), capped at the foe's HP. */
  expected: number;
  /** Guaranteed KO if it hits. */
  ko: boolean;
  hitChance: number;
}

const enemyActive = (s: BattleState): BattleMon => s.enemy.team[s.enemy.active];
const playerActive = (s: BattleState): BattleMon => s.player.team[s.player.active];

function hitChance(user: BattleMon, foe: BattleMon, move: MoveDef): number {
  if (move.target === 'self' || findEffect(move, 'sureHit')) return 1;
  const stage = Math.max(-6, Math.min(6, user.stages.acc - foe.stages.eva));
  return Math.min(1, (move.accuracy / 100) * accStageMult(stage));
}

function hasHealthyBench(s: BattleState, side: 'player' | 'enemy'): boolean {
  const st = s[side];
  return st.team.some((m, i) => i !== st.active && m.hp > 0);
}

function statusBlocked(foe: BattleMon, status: string): boolean {
  if (foe.status) return true;
  const t = foe.types;
  if (status === 'burn' && t.includes('FIRE')) return true;
  if (status === 'goop' && (t.includes('SLIME') || t.includes('METAL'))) return true;
  if (status === 'zap' && t.includes('LIGHTNING')) return true;
  if (status === 'frozen' && t.includes('FROST')) return true;
  const ab = abilityOf(foe);
  return ab.kind === 'statusImmune' && (ab.statuses as string[]).includes(status);
}

/** Could this status move do anything at all right now? */
function statusMoveUseful(s: BattleState, me: BattleMon, foe: BattleMon, move: MoveDef): boolean {
  if (move.target === 'foe' && absorbs(foe, move)) return false;
  for (const e of move.effects) {
    switch (e.kind) {
      case 'inflict': if (!statusBlocked(foe, e.status)) return true; break;
      case 'confuse': if (foe.volatile.confused === 0 && abilityOf(foe).kind !== 'innerFocus') return true; break;
      case 'stages': {
        const who = e.who === 'self' ? me : foe;
        for (const [k, v] of Object.entries(e.changes)) {
          const cur = who.stages[k as keyof typeof who.stages];
          if (v === undefined || v === 0) continue;
          if (e.who === 'foe' && v < 0 && abilityOf(foe).kind === 'clearBody') continue;
          // Buffs past +2 or debuffs past -2 are not worth a turn.
          if (v > 0 && cur < 2) return true;
          if (v < 0 && cur > -2) return true;
        }
        break;
      }
      case 'heal': if (me.hp < me.stats.hp * 0.75) return true; break;
      case 'rest': if (me.status !== 'snooze' && (me.hp < me.stats.hp * 0.5 || me.status)) return true; break;
      case 'cure':
        if (e.who === 'self' ? me.status !== null : s.enemy.team.some((m) => m.hp > 0 && m.status)) return true;
        break;
      case 'protect': if (me.volatile.protectChain === 0) return true; break;
      case 'trap': if (!foe.volatile.stuck) return true; break;
      case 'seed': if (!foe.volatile.seeded && !foe.types.includes('LEAF')) return true; break;
      case 'resetStages': {
        const sum = (m: BattleMon) => Object.values(m.stages).reduce((a, b) => a + b, 0);
        if (sum(foe) > 0 || sum(me) < 0) return true;
        break;
      }
      case 'pivot': if (hasHealthyBench(s, 'enemy')) return true; break;
      case 'flinch': if (foe.hp > 0) return true; break;
      default: break;
    }
  }
  return false;
}

function options(s: BattleState): Option[] {
  const me = enemyActive(s);
  const foe = playerActive(s);
  const out: Option[] = [];
  me.moves.forEach((slot, i) => {
    if (slot.pp <= 0) return;
    const move = battleMove(slot.id);
    const damaging = isDamaging(move);
    let useless = false;
    let expected = 0;
    let ko = false;
    const hc = hitChance(me, foe, move);
    if (findEffect(move, 'firstTurn') && me.volatile.turnsIn !== 0) useless = true;
    if (damaging) {
      const est = estimateDamage(me, foe, slot.id);
      if (est.max <= 0) useless = true;
      expected = Math.min((est.min + est.max) / 2, foe.hp) * hc;
      ko = est.min >= foe.hp && foe.hp > 0;
      // Secondary bonuses: draining when hurt, and a small nudge for added effects.
      if (findEffect(move, 'drain') && me.hp < me.stats.hp) expected *= 1.15;
      if (findEffect(move, 'recoil')) expected *= 0.9;
    } else if (!statusMoveUseful(s, me, foe, move)) {
      useless = true;
    }
    out.push({ slot: i, move, damaging, useless, expected, ko, hitChance: hc });
  });
  return out;
}

function weightedPick(s: BattleState, opts: Option[]): Option {
  const w = opts.map((o) => (o.useless ? 0.15 : o.damaging ? 3 : 1));
  const total = w.reduce((a, b) => a + b, 0);
  let r = s.rng.next() * total;
  for (let i = 0; i < opts.length; i++) {
    r -= w[i];
    if (r < 0) return opts[i];
  }
  return opts[opts.length - 1];
}

function bestDamage(opts: Option[]): Option | null {
  let best: Option | null = null;
  for (const o of opts) {
    if (!o.damaging || o.useless) continue;
    if (!best || o.expected > best.expected + 1e-9 || (Math.abs(o.expected - best.expected) < 1e-9 && o.hitChance > best.hitChance)) best = o;
  }
  return best;
}

/** A status/buff move worth spending the turn on. */
function sensibleStatus(s: BattleState, opts: Option[]): Option[] {
  const me = enemyActive(s);
  const foe = playerActive(s);
  return opts.filter((o) => {
    if (o.damaging || o.useless) return false;
    const m = o.move;
    if (findEffect(m, 'heal') || findEffect(m, 'rest')) return me.hp <= me.stats.hp * 0.5;
    if (findEffect(m, 'protect')) return false;
    if (findEffect(m, 'pivot')) return false;
    if (findEffect(m, 'inflict') || findEffect(m, 'confuse') || findEffect(m, 'seed')) return foe.hp > foe.stats.hp * 0.3;
    return me.hp > me.stats.hp * 0.5;
  });
}

/** Best multiplier any of the attacker's types (as a threat) gets against `mon`, abilities included. */
function incoming(attackerTypes: readonly TypeId[], mon: BattleMon): number {
  let best = 0;
  const ab = abilityOf(mon);
  for (const t of attackerTypes) {
    let m = typeEffectiveness(t, mon.types);
    if (ab.kind === 'absorb' && ab.type === t) m = 0;
    if (ab.kind === 'resist' && ab.types.includes(t)) m *= ab.mult;
    best = Math.max(best, m);
  }
  return attackerTypes.length ? best : 1;
}

/** Best multiplier among `mon`'s usable damaging moves against `foe` (its types when it has none). */
function outgoing(mon: BattleMon, foe: BattleMon): number {
  let best = -1;
  for (const slot of mon.moves) {
    if (slot.pp <= 0) continue;
    const m = battleMove(slot.id);
    if (!isDamaging(m)) continue;
    let eff = absorbs(foe, m) ? 0 : typeEffectiveness(m.type, foe.types);
    if (findEffect(m, 'fixed')) eff = eff === 0 ? 0 : 1;
    best = Math.max(best, eff);
  }
  if (best < 0) {
    best = 0;
    for (const t of mon.types) best = Math.max(best, typeEffectiveness(t, foe.types));
  }
  return best;
}

const lg = (x: number): number => Math.log2(Math.max(0.25, x));

/** Matchup in doublings: offence minus defence. Negative is bad for `mon`. */
export function monMatchup(mon: BattleMon, foe: BattleMon): number {
  return lg(outgoing(mon, foe)) - lg(incoming(foe.types, mon));
}

/** The teammate the boss would counter-swap to, or -1. */
export function counterSwapTarget(s: BattleState): number {
  const me = enemyActive(s);
  const foe = playerActive(s);
  if (s.aiLevel !== 'boss' || s.enemySwaps >= MAX_ENEMY_SWAPS) return -1;
  if (me.hp <= 0 || foe.hp <= 0 || me.volatile.turnsIn === 0 || me.volatile.stuck) return -1;
  const mine = monMatchup(me, foe);
  if (mine > -1) return -1;
  let best = -1;
  let bestScore = mine;
  s.enemy.team.forEach((t, i) => {
    if (i === s.enemy.active || t.hp <= 0 || t.hp < t.stats.hp * 0.3) return;
    if (incoming(foe.types, t) >= 1) return; // must resist the player's dragon's types
    const sc = monMatchup(t, foe);
    if (sc > bestScore) {
      bestScore = sc;
      best = i;
    }
  });
  return best;
}

function bossChoice(s: BattleState, opts: Option[]): Option {
  const me = enemyActive(s);
  const foe = playerActive(s);
  const live = opts.filter((o) => !o.useless);
  const pool = live.length ? live : opts;

  // 1. Take a sure KO (prefer accuracy, then priority).
  const kos = pool.filter((o) => o.ko && o.damaging);
  if (kos.length) {
    kos.sort((a, b) => b.hitChance - a.hitChance || b.move.priority - a.move.priority || a.slot - b.slot);
    return kos[0];
  }

  // How hard can the player's dragon hit back?
  let threat = 0;
  for (const slot of foe.moves) {
    if (slot.pp <= 0) continue;
    threat = Math.max(threat, estimateDamage(foe, me, slot.id).max);
  }

  // 2. Heal when low, if healing actually outpaces the damage coming in.
  if (me.hp <= me.stats.hp * 0.4) {
    const heals = pool.filter((o) => !o.damaging && (findEffect(o.move, 'heal') || findEffect(o.move, 'rest')));
    for (const h of heals) {
      const amount = findEffect(h.move, 'rest') ? me.stats.hp - me.hp : Math.floor(me.stats.hp * (findEffect(h.move, 'heal')?.fraction ?? 0));
      if (me.hp + amount > threat) return h;
    }
  }

  // 3. Buff when safe.
  const myFaster = effectiveStat(me, 'spe') >= effectiveStat(foe, 'spe');
  if (me.hp > me.stats.hp * 0.6 && threat < me.hp * 0.35) {
    const buffs = pool.filter((o) => !o.damaging && o.move.effects.some((e) => e.kind === 'stages' && e.who === 'self'));
    if (buffs.length) return buffs[0];
  }

  // 4. Status the foe while it is healthy (sometimes).
  if (!foe.status && foe.hp > foe.stats.hp * 0.5) {
    const sts = pool.filter((o) => !o.damaging && (findEffect(o.move, 'inflict') || findEffect(o.move, 'confuse') || findEffect(o.move, 'seed')));
    if (sts.length && s.rng.next() < 0.5) return sts[0];
  }

  // 5. Otherwise the best expected damage; slower and about to be KO'd? use priority if it helps.
  const best = bestDamage(pool);
  if (best) {
    if (!myFaster && threat >= me.hp) {
      const quick = pool.filter((o) => o.damaging && o.move.priority > 0 && o.expected > 0);
      quick.sort((a, b) => b.expected - a.expected);
      if (quick.length && quick[0].expected >= best.expected * 0.5) return quick[0];
    }
    return best;
  }
  return weightedPick(s, pool);
}

export function chooseEnemyAction(state: BattleState): EnemyAction {
  const opts = options(state);
  if (!opts.length) return { kind: 'move', slot: 0 }; // out of PP: the battle uses the internal struggle
  if (state.aiLevel === 'boss') {
    // Never swap away from a sure knockout.
    if (!opts.some((o) => o.ko && !o.useless)) {
      const swap = counterSwapTarget(state);
      if (swap >= 0) return { kind: 'switch', index: swap };
    }
    return { kind: 'move', slot: bossChoice(state, opts).slot };
  }
  if (state.aiLevel === 'elite') {
    const live = opts.filter((o) => !o.useless);
    const pool = live.length ? live : opts;
    if (state.rng.next() < 0.75) {
      const best = bestDamage(pool);
      if (best) return { kind: 'move', slot: best.slot };
    }
    const sensible = sensibleStatus(state, pool);
    if (sensible.length && state.rng.next() < 0.6) {
      return { kind: 'move', slot: (state.rng.pick(sensible) ?? sensible[0]).slot };
    }
    return { kind: 'move', slot: weightedPick(state, pool).slot };
  }
  return { kind: 'move', slot: weightedPick(state, opts).slot };
}

/** Who comes in after a faint (or an enemy pivot): best matchup vs the player's active; bosses stay last. */
export function chooseEnemyReplacement(state: BattleState): number {
  const foe = playerActive(state);
  let best = -1;
  let bestKey = -Infinity;
  state.enemy.team.forEach((m, i) => {
    if (i === state.enemy.active || m.hp <= 0) return;
    const score = foe && foe.hp > 0 ? monMatchup(m, foe) : 0;
    // Bosses are held back for the finale; then the matchup; then send order.
    const key = (m.isBoss ? 0 : 1000) + score * 10 - i * 0.01;
    if (key > bestKey) {
      bestKey = key;
      best = i;
    }
  });
  return best;
}
