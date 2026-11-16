// The battle autopilot: what the scene does by itself when app.debug.autoplay is on (tools/playtest.ts
// runs whole missions with it). Sensible, not clever: the move with the best expected damage, and on
// a forced swap the teammate with the best type matchup against the current foe.
import type { BattleState, PlayerAction } from '../../battle/types.ts';
import { activeMon, legal } from '../../battle/battle.ts';
import { estimateDamage } from '../../battle/damage.ts';
import { matchupGrade } from '../../battle/matchup.ts';
import { getMove } from '../../data/index.ts';

/** The legal swap target with the best matchup grade against the enemy's active (healthier breaks ties), or -1. */
export function bestSwitch(battle: BattleState): number {
  const L = legal(battle);
  const foe = activeMon(battle, 'enemy');
  let best = -1;
  let bestKey = -Infinity;
  battle.player.team.forEach((m, i) => {
    if (!L.switches[i]) return;
    const grade = matchupGrade(m.types, m.moves.map((s) => s.id), foe.types);
    const key = grade * 10 + m.hp / Math.max(1, m.stats.hp) - i * 0.001;
    if (key > bestKey) {
      bestKey = key;
      best = i;
    }
  });
  return best;
}

/** The move slot with the best expected damage (accuracy-weighted, capped at the foe's HP). */
export function bestMove(battle: BattleState): number {
  const L = legal(battle);
  const me = activeMon(battle, 'player');
  const foe = activeMon(battle, 'enemy');
  let best = -1;
  let bestScore = -1;
  me.moves.forEach((slot, i) => {
    if (!L.moves[i] || slot.pp <= 0) return;
    const mv = getMove(slot.id);
    if (mv.effects.some((e) => e.kind === 'firstTurn') && me.volatile.turnsIn !== 0) return;
    const est = estimateDamage(me, foe, slot.id);
    const acc = mv.target === 'self' || mv.effects.some((e) => e.kind === 'sureHit') ? 100 : mv.accuracy;
    const dmg = Math.min(foe.hp, (est.min + est.max) / 2);
    const score = (dmg * acc) / 100 + mv.priority * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  if (best < 0) best = Math.max(0, L.moves.findIndex(Boolean));
  return best;
}

/** A sensible action for the current phase ('switch' phase: a { kind: 'switch' } for submitSwitch). */
export function autoAction(battle: BattleState): PlayerAction {
  const L = legal(battle);
  if (battle.phase === 'switch' || L.mustSwitch) {
    const i = bestSwitch(battle);
    return { kind: 'switch', index: i >= 0 ? i : Math.max(0, L.switches.indexOf(true)) };
  }
  return { kind: 'move', slot: bestMove(battle) };
}
