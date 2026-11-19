// The enemy's decisions, one per enemy on the field (doubles). Three levels (docs/DESIGN.md "Enemy AI"):
//   minion  a random foe and a random usable move, leaning towards damage;
//   elite   the best expected damage on either foe about 75% of the time, otherwise sensible
//           status/buff use;
//   boss    reads the type matchup: takes a KO on either foe, otherwise focuses the foe it is best
//           matched against: heals when low, buffs when safe; and swaps to a teammate that resists
//           your dragons when its own is badly matched
//           (at most twice a battle, never on the turn it came in, never into a worse matchup).
// All randomness comes from state.rng, so the battle stays deterministic.
import type { MoveDef, TypeId } from '../data/schema.ts';
import type { BattleMon, BattleState } from './types.ts';
import { SPREAD_MULT, abilityOf, absorbs, battleMove, effectiveStat, estimateDamage, findEffect, isDamaging } from './damage.ts';
import { typeEffectiveness } from './matchup.ts';
import { accStageMult } from './stats.ts';

/** `target`: the player's field slot a foe-aimed move goes at. */
export type EnemyAction = { kind: 'move'; slot: number; target: number } | { kind: 'switch'; index: number };

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
  /** The player's field slot it is aimed at. */
  target: number;
}

/** Combatants on the field still standing, with their field slots. */
function field(s: BattleState, side: 'player' | 'enemy'): { mon: BattleMon; slot: number }[] {
  const st = s[side];
  return st.slots.map((i, k) => ({ i, k })).filter(({ i }) => i >= 0 && st.team[i].hp > 0).map(({ i, k }) => ({ mon: st.team[i], slot: k }));
}

const onField = (s: BattleState, side: 'player' | 'enemy', i: number): boolean => s[side].slots.includes(i);

function hitChance(user: BattleMon, foe: BattleMon, move: MoveDef): number {
  if (move.target === 'self' || findEffect(move, 'sureHit')) return 1;
  const stage = Math.max(-6, Math.min(6, user.stages.acc - foe.stages.eva));
  return Math.min(1, (move.accuracy / 100) * accStageMult(stage));
}

function hasHealthyBench(s: BattleState, side: 'player' | 'enemy'): boolean {
  return s[side].team.some((m, i) => !onField(s, side, i) && m.hp > 0);
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

/**
 * Every usable move of `me` aimed at `foe` (field slot `target`). A spread move counts its hit on
 * every foe (0.75x each when there are two); its target is just where it is pointed.
 */
function options(s: BattleState, me: BattleMon, foe: BattleMon, target: number): Option[] {
  const foes = field(s, 'player').map((f) => f.mon);
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
      const hit = move.spread && foes.length > 1 ? foes : [foe];
      const mult = hit.length > 1 ? SPREAD_MULT : 1;
      let max = 0;
      for (const f of hit) {
        const est = estimateDamage(me, f, slot.id);
        max += est.max;
        expected += Math.min(((est.min + est.max) / 2) * mult, f.hp) * hitChance(me, f, move);
        if (Math.floor(est.min * mult) >= f.hp && f.hp > 0) ko = true;
      }
      if (max <= 0) useless = true;
      // Secondary bonuses: draining when hurt, and a small nudge for added effects.
      if (findEffect(move, 'drain') && me.hp < me.stats.hp) expected *= 1.15;
      if (findEffect(move, 'recoil')) expected *= 0.9;
    } else if (!statusMoveUseful(s, me, foe, move)) {
      useless = true;
    }
    out.push({ slot: i, move, damaging, useless, expected, ko, hitChance: hc, target });
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
function sensibleStatus(me: BattleMon, foe: BattleMon, opts: Option[]): Option[] {
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

/** A combatant's matchup against the player's field: the worst one (and who it is against). */
function worstMatchup(mon: BattleMon, foes: readonly BattleMon[]): { score: number; foe: BattleMon | null } {
  let score = Infinity;
  let foe: BattleMon | null = null;
  for (const f of foes) {
    const sc = monMatchup(mon, f);
    if (sc < score) { score = sc; foe = f; }
  }
  return { score: foe ? score : 0, foe };
}

/**
 * The teammate the boss in enemy field slot `slot` would counter-swap to, or -1. It swaps when it
 * is badly matched against one of your dragons, to a teammate that resists that dragon and is
 * better matched against your whole field. `taken`: team indices already picked this turn.
 */
export function counterSwapTarget(s: BattleState, slot = 0, taken: ReadonlySet<number> = new Set()): number {
  const i0 = s.enemy.slots[slot] ?? -1;
  if (i0 < 0) return -1;
  const me = s.enemy.team[i0];
  const foes = field(s, 'player').map((f) => f.mon);
  if (s.aiLevel !== 'boss' || s.enemySwaps >= MAX_ENEMY_SWAPS) return -1;
  if (me.hp <= 0 || !foes.length || me.volatile.turnsIn === 0 || me.volatile.stuck) return -1;
  const { score: mine, foe } = worstMatchup(me, foes);
  if (mine > -1 || !foe) return -1;
  let best = -1;
  let bestScore = mine;
  s.enemy.team.forEach((t, i) => {
    if (onField(s, 'enemy', i) || taken.has(i) || t.hp <= 0 || t.hp < t.stats.hp * 0.3) return;
    if (incoming(foe.types, t) >= 1) return; // must resist the dragon it is running from
    const sc = worstMatchup(t, foes).score;
    if (sc > bestScore) {
      bestScore = sc;
      best = i;
    }
  });
  return best;
}

function bossChoice(s: BattleState, me: BattleMon, foe: BattleMon, opts: Option[]): Option {
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

/** The decision for the enemy in field slot `slot` (default: the first one standing). */
export function chooseEnemyAction(state: BattleState, slot?: number, taken: ReadonlySet<number> = new Set()): EnemyAction {
  const mine = field(state, 'enemy');
  const k = slot ?? mine[0]?.slot ?? 0;
  const me = state.enemy.team[state.enemy.slots[k] ?? 0];
  const foes = field(state, 'player');
  if (!foes.length || !me) return { kind: 'move', slot: 0, target: 0 };
  // Everything against every foe (sure KOs and the best damage can be on either one).
  const all = foes.flatMap((f) => options(state, me, f.mon, f.slot));
  if (!all.length) return { kind: 'move', slot: 0, target: foes[0].slot }; // out of PP: the battle uses the internal struggle
  const move = (o: Option): EnemyAction => ({ kind: 'move', slot: o.slot, target: o.target });
  // Minions (and elites' fallbacks) pick a foe at random; a draw only when there is a choice.
  const randomFoe = (): { mon: BattleMon; slot: number } => (foes.length > 1 ? state.rng.pick(foes) ?? foes[0] : foes[0]);
  if (state.aiLevel === 'boss') {
    // Never swap away from a sure knockout.
    if (!all.some((o) => o.ko && !o.useless)) {
      const swap = counterSwapTarget(state, k, taken);
      if (swap >= 0) return { kind: 'switch', index: swap };
    }
    const kos = all.filter((o) => o.ko && o.damaging && !o.useless);
    if (kos.length) {
      kos.sort((a, b) => b.hitChance - a.hitChance || b.move.priority - a.move.priority || a.slot - b.slot || a.target - b.target);
      return move(kos[0]);
    }
    // Focus the foe it is best matched against (the first on a tie).
    let focus = foes[0];
    for (const f of foes) if (monMatchup(me, f.mon) > monMatchup(me, focus.mon)) focus = f;
    return move(bossChoice(state, me, focus.mon, options(state, me, focus.mon, focus.slot)));
  }
  if (state.aiLevel === 'elite') {
    const live = all.filter((o) => !o.useless);
    const pool = live.length ? live : all;
    if (state.rng.next() < 0.75) {
      const best = bestDamage(pool);
      if (best) return move(best);
    }
    const f = randomFoe();
    const vs = options(state, me, f.mon, f.slot);
    const liveVs = vs.filter((o) => !o.useless);
    const poolVs = liveVs.length ? liveVs : vs;
    const sensible = sensibleStatus(me, f.mon, poolVs);
    if (sensible.length && state.rng.next() < 0.6) return move(state.rng.pick(sensible) ?? sensible[0]);
    return move(weightedPick(state, poolVs));
  }
  const f = randomFoe();
  return move(weightedPick(state, options(state, me, f.mon, f.slot)));
}

/** One decision per enemy on the field and still standing, in field-slot order. */
export function chooseEnemyActions(state: BattleState): { slot: number; action: EnemyAction }[] {
  const taken = new Set<number>();
  return field(state, 'enemy').map(({ slot }) => {
    const action = chooseEnemyAction(state, slot, taken);
    if (action.kind === 'switch') taken.add(action.index);
    return { slot, action };
  });
}

/**
 * Who comes in after a faint (or an enemy pivot) in enemy field slot `_slot`: the best average
 * matchup against the player's field; bosses stay last. `foeLeaving`: player dragons are about to
 * be replaced (they pivoted, or are down too), so matchups do not count and send order decides,
 * as after a double knockout.
 */
export function chooseEnemyReplacement(state: BattleState, _slot = 0, foeLeaving = false): number {
  const foes = foeLeaving ? [] : field(state, 'player').map((f) => f.mon);
  let best = -1;
  let bestKey = -Infinity;
  state.enemy.team.forEach((m, i) => {
    if (onField(state, 'enemy', i) || m.hp <= 0) return;
    const score = foes.length ? foes.reduce((t, f) => t + monMatchup(m, f), 0) / foes.length : 0;
    // Bosses are held back for the finale; then the matchup; then send order.
    const key = (m.isBoss ? 0 : 1000) + score * 10 - i * 0.01;
    if (key > bestKey) {
      bestKey = key;
      best = i;
    }
  });
  return best;
}
