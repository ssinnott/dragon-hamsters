// The battle scene's view of each combatant: what the player has been SHOWN so far.
//
// The engine resolves a whole turn the moment the player commits, so its BattleState is always
// "in the future" while the scene plays that turn's events back. Everything the HUD draws (HP, XP,
// level, status, fainted pips) therefore comes from these views, which change only when an event is
// played, and the shown HP/XP values ease toward each event's numbers. When a turn has finished
// playing, syncViews() checks the views against the engine and snaps any difference.
import type { DragonVisual, MoveId, Stats, StatusId, TypeId, VillainVisual } from '../../data/schema.ts';
import { getSpecies, getVillain } from '../../data/index.ts';
import type { BattleMon, BattleState, Side } from '../../battle/types.ts';
import { xpForLevel } from '../../battle/stats.ts';
import { MAX_LEVEL } from '../../game/types.ts';
import { drawDragon, dragonHeight, type CreatureOpts } from '../../art/dragon.ts';
import { drawVillain, villainHeight } from '../../art/villain.ts';

export interface MonView {
  uid: string;
  side: Side;
  /** Index in its side's team. */
  index: number;
  kind: 'dragon' | 'villain';
  name: string;
  types: TypeId[];
  isBoss: boolean;
  moves: MoveId[];
  dragon: DragonVisual | null;
  villain: VillainVisual | null;
  /** Height in px at scale 1 (to the ear / crest tips). */
  h1: number;
  level: number;
  stats: Stats;
  maxHp: number;
  /** HP as of the last played event, and the value the bar shows right now. */
  hp: number;
  shownHp: number;
  hpSpeed: number;
  xp: number;
  shownXp: number;
  xpSpeed: number;
  status: StatusId | null;
  /** Seconds since the status badge last changed (drives its pop). */
  statusAge: number;
  confused: boolean;
  /** SEEDED (loses HP to the foe each turn end) and STUCK (cannot swap out). */
  seeded: boolean;
  stuck: boolean;
  /** Seconds since SEEDED / STUCK last changed (drives the badge pop). */
  volatileAge: number;
  fainted: boolean;
  /** Has been sent out at least once. */
  out: boolean;
}

export function makeView(m: BattleMon): MonView {
  const dragon = m.kind === 'dragon' ? getSpecies(m.defId).visual : null;
  const villain = m.kind === 'villain' ? getVillain(m.defId).visual : null;
  const h1 = dragon ? dragonHeight(dragon, 1) : villain ? villainHeight(villain, 1) : 40;
  return {
    uid: m.uid,
    side: m.side,
    index: Number(m.uid.slice(1)) || 0,
    kind: m.kind,
    name: m.name.toUpperCase(),
    types: [...m.types],
    isBoss: m.isBoss,
    moves: m.moves.map((s) => s.id),
    dragon,
    villain,
    h1: h1 > 0 ? h1 : 40,
    level: m.level,
    stats: { ...m.stats },
    maxHp: m.stats.hp,
    hp: m.hp,
    shownHp: m.hp,
    hpSpeed: 0,
    xp: m.xp,
    shownXp: m.xp,
    xpSpeed: 0,
    status: m.status,
    statusAge: 99,
    confused: m.volatile.confused > 0,
    seeded: m.volatile.seeded,
    stuck: m.volatile.stuck,
    volatileAge: 99,
    fainted: m.hp <= 0,
    out: false,
  };
}

function approach(cur: number, target: number, step: number): number {
  if (cur < target) return Math.min(target, cur + step);
  if (cur > target) return Math.max(target, cur - step);
  return cur;
}

/** Ease the shown HP / XP toward their targets. */
export function tickView(v: MonView, dt: number): void {
  v.shownHp = approach(v.shownHp, v.hp, Math.max(v.hpSpeed, v.maxHp * 0.25) * dt);
  const cap = v.level >= MAX_LEVEL ? v.xp : Math.min(v.xp, xpForLevel(v.level + 1));
  v.shownXp = approach(v.shownXp, cap, Math.max(v.xpSpeed, 20) * dt);
  v.statusAge += dt;
  v.volatileAge += dt;
}

/** Start an HP change that drains or fills over about `dur` seconds. */
export function setHp(v: MonView, hp: number, maxHp: number, dur: number): void {
  v.maxHp = maxHp;
  v.hp = Math.max(0, Math.min(maxHp, hp));
  v.hpSpeed = Math.abs(v.hp - v.shownHp) / Math.max(0.05, dur);
}

export function hpSettled(v: MonView): boolean {
  return Math.abs(v.shownHp - v.hp) < 0.01;
}

export function xpSettled(v: MonView): boolean {
  const cap = v.level >= MAX_LEVEL ? v.xp : Math.min(v.xp, xpForLevel(v.level + 1));
  return Math.abs(v.shownXp - cap) < 0.01;
}

/** 0..1 through the current level, from the shown XP. */
export function xpFrac(v: MonView): number {
  if (v.level >= MAX_LEVEL) return 1;
  const lo = xpForLevel(v.level), hi = xpForLevel(v.level + 1);
  return hi > lo ? Math.max(0, Math.min(1, (v.shownXp - lo) / (hi - lo))) : 1;
}

/** Draw the combatant's art (dragon or villain) with its ground point at (x, y). */
export function drawMon(ctx: CanvasRenderingContext2D, v: MonView, x: number, y: number, opts: CreatureOpts): void {
  if (v.dragon) drawDragon(ctx, v.dragon, x, y, opts);
  else if (v.villain) drawVillain(ctx, v.villain, x, y, opts);
}

/**
 * Snap every view to the engine (called whenever a turn has finished playing). Returns the uids
 * that had drifted, which would mean an event was missed; the HUD can never stay wrong for longer
 * than one turn.
 */
export function syncViews(views: Map<string, MonView>, battle: BattleState): string[] {
  const drift: string[] = [];
  for (const m of [...battle.player.team, ...battle.enemy.team]) {
    const v = views.get(m.uid);
    if (!v) continue;
    const off: string[] = [];
    if (v.hp !== m.hp || v.maxHp !== m.stats.hp) { off.push(`hp ${v.hp}/${v.maxHp}->${m.hp}/${m.stats.hp}`); v.hp = m.hp; v.maxHp = m.stats.hp; v.hpSpeed = v.maxHp; }
    if (v.status !== m.status) { off.push(`status ${v.status}->${m.status}`); v.status = m.status; }
    if (v.level !== m.level) { off.push(`level ${v.level}->${m.level}`); v.level = m.level; v.stats = { ...m.stats }; }
    if (v.xp !== m.xp) { off.push(`xp ${v.xp}->${m.xp}`); v.xp = m.xp; }
    const fainted = m.hp <= 0;
    if (v.fainted !== fainted) { off.push(`fainted ${v.fainted}->${fainted}`); v.fainted = fainted; }
    const conf = m.volatile.confused > 0;
    if (v.confused !== conf) { off.push(`confused ${v.confused}->${conf}`); v.confused = conf; }
    if (v.seeded !== m.volatile.seeded) { off.push(`seeded ${v.seeded}->${m.volatile.seeded}`); v.seeded = m.volatile.seeded; }
    if (v.stuck !== m.volatile.stuck) { off.push(`stuck ${v.stuck}->${m.volatile.stuck}`); v.stuck = m.volatile.stuck; }
    if (off.length) drift.push(`${m.uid} (${off.join(', ')})`);
  }
  return drift;
}
