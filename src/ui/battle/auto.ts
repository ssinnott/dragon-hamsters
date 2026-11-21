// The battle autopilot: what the scene does by itself when app.debug.autoplay is on (tools/playtest.ts
// runs whole missions with it, and tools/gametest.ts plays its campaigns with it). Sensible, not
// clever: for each dragon on the field, the move and target with the best expected damage (a spread
// move counts its hit on every foe), and on a forced swap the teammate with the best type matchup
// against the foes on the field.
import type { BattleMon, BattleState, PlayerAction } from '../../battle/types.ts';
import { activeMon, fieldMons, legal, liveSlots } from '../../battle/battle.ts';
import { SPREAD_MULT, estimateDamage } from '../../battle/damage.ts';
import { matchupGrade } from '../../battle/matchup.ts';
import { getMove } from '../../data/index.ts';

/** The legal swap target with the best matchup grade against the foes on the field (healthier breaks ties), or -1. */
export function bestSwitch(battle: BattleState, slot?: number): number {
  const L = legal(battle, slot);
  const foes = fieldMons(battle, 'enemy');
  let best = -1;
  let bestKey = -Infinity;
  battle.player.team.forEach((m, i) => {
    if (!L.switches[i]) return;
    const grade = foes.length ? foes.reduce((t, f) => t + matchupGrade(m.types, m.moves.map((s) => s.id), f.types), 0) / foes.length : 0;
    const key = grade * 10 + m.hp / Math.max(1, m.stats.hp) - i * 0.001;
    if (key > bestKey) {
      bestKey = key;
      best = i;
    }
  });
  return best;
}

/** Expected damage of `moveId` from `me` into `foe` (accuracy-weighted, capped at its HP). */
function expected(me: BattleMon, foe: BattleMon, moveId: string, mult: number): number {
  const mv = getMove(moveId);
  const acc = mv.target === 'self' || mv.effects.some((e) => e.kind === 'sureHit') ? 100 : mv.accuracy;
  const est = estimateDamage(me, foe, moveId);
  return (Math.min(foe.hp, ((est.min + est.max) / 2) * mult) * acc) / 100;
}

/**
 * The best move slot and foe field slot for the dragon in player field slot `slot` (default: the
 * first one standing). Spread moves score their hit on every foe.
 */
export function bestMoveAndTarget(battle: BattleState, slot?: number): { slot: number; target: number } {
  const L = legal(battle, slot);
  const me = activeMon(battle, 'player', L.slot);
  const foes = battle.enemy.slots.map((i, k) => ({ k, m: i >= 0 ? battle.enemy.team[i] : null })).filter((f) => f.m && f.m.hp > 0) as { k: number; m: BattleMon }[];
  let best = { slot: -1, target: foes[0]?.k ?? 0 };
  let bestScore = -1;
  me.moves.forEach((ms, i) => {
    if (!L.moves[i] || ms.pp <= 0) return;
    const mv = getMove(ms.id);
    if (mv.effects.some((e) => e.kind === 'firstTurn') && me.volatile.turnsIn !== 0) return;
    if (mv.spread && foes.length > 1) {
      const score = foes.reduce((t, f) => t + expected(me, f.m, ms.id, SPREAD_MULT), 0) + mv.priority * 0.01;
      if (score > bestScore) { bestScore = score; best = { slot: i, target: foes[0].k }; }
      return;
    }
    for (const f of foes) {
      const score = expected(me, f.m, ms.id, 1) + mv.priority * 0.01;
      if (score > bestScore) { bestScore = score; best = { slot: i, target: f.k }; }
    }
  });
  if (best.slot < 0) best.slot = Math.max(0, L.moves.indexOf(true));
  return best;
}

/** The move slot with the best expected damage for the first dragon standing (singles helper). */
export function bestMove(battle: BattleState): number {
  return bestMoveAndTarget(battle).slot;
}

/** A whole turn: one move order per dragon on the field, in field-slot order (submitTurn's input). */
export function autoTurn(battle: BattleState): PlayerAction[] {
  return liveSlots(battle, 'player').map((slot) => {
    const b = bestMoveAndTarget(battle, slot);
    return { kind: 'move', slot: b.slot, target: b.target };
  });
}

/** In the 'switch' phase, the replacement for the next empty slot (a { kind: 'switch' } for submitSwitch). */
export function autoSwitch(battle: BattleState): PlayerAction {
  const L = legal(battle);
  const i = bestSwitch(battle);
  return { kind: 'switch', index: i >= 0 ? i : Math.max(0, L.switches.indexOf(true)) };
}
