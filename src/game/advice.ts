// Chief Nibbles' advice after a lost case (the MISSION FAILED screen). It is built from the same
// star grades (missionGrade) and the same AUTO-PICK ranking (recommendSquad) the briefing uses, so
// the Chief never tells the kid one thing while the briefing's stars and AUTO-PICK say another:
//
//   send        a dragon with a GREAT MATCHUP (3 stars) that stayed home and that AUTO-PICK would
//               bring after a good rest: "Send INFERNIBBLE next time!"; or, with nobody great at
//               home, the dragon AUTO-PICK would swap in for one with a BAD MATCHUP
//   train-pick  a 3-star dragon that stayed home but is too low for the case (or so far below the
//               strongest that AUTO-PICK leaves it out): "Train it up first!"
//   train       every 3-star dragon was already in the squad: the types were right, they need levels
//   recruit     nobody in the burrow grades 3 stars: name counter types nobody owns yet
//
// Types the burrow already has are never suggested (a dragon of that type would be graded already),
// and nothing is said about a dragon that was brought along.
import type { MissionId, TypeId } from '../data/schema.ts';
import { getType } from '../data/index.ts';
import { counterTypes } from '../battle/matchup.ts';
import { intelTypes, missionGrade, recommendSquad, tooLowFor } from './missions.ts';
import { dragonName, dragonStats, dragonTypes, findDragon } from './dragons.ts';
import type { GameState, OwnedDragon } from './types.ts';

export type AdviceKind = 'send' | 'train-pick' | 'train' | 'recruit';

export interface DefeatAdvice {
  kind: AdviceKind;
  /** The crew's most common types, most common first (at most two). */
  crew: TypeId[];
  /** 'send' / 'train-pick': the dragons named (ids, at most two, strongest first). */
  dragons: string[];
  /** Their briefing star grades (missionGrade), one per `dragons` entry. */
  stars: (1 | 2 | 3)[];
  /** 'recruit': counter types no dragon in the burrow has (at most two). */
  types: TypeId[];
  /** The Chief's words: the crew, then the advice. */
  text: string;
}

const typeName = (t: TypeId): string => { try { return getType(t).name; } catch { return t; } };

/** A copy of the world after a good night's sleep: everyone healed, rested and fed. */
function rested(state: GameState): GameState {
  const copy = JSON.parse(JSON.stringify(state)) as GameState;
  for (const d of copy.dragons) {
    d.hp = dragonStats(d).hp;
    d.status = null;
    d.needs.energy = 100;
    d.needs.fullness = Math.max(d.needs.fullness, 50);
  }
  return copy;
}

const names = (ds: readonly OwnedDragon[]): string => ds.map((d) => dragonName(d).toUpperCase()).join(' and ');

/** What the Chief tells a squad that just lost `missionId`. Pure: `state` is not changed. */
export function defeatAdvice(state: GameState, missionId: MissionId, squad: readonly string[]): DefeatAdvice {
  const intel = intelTypes(missionId);
  const counts = new Map<TypeId, number>();
  for (const set of intel) for (const t of set) counts.set(t, (counts.get(t) ?? 0) + 1);
  const crew = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
  const crewText = crew.length ? `Their crew is mostly ${crew.map(typeName).join(' and ')}.` : 'That crew is a slippery bunch.';

  const grades = new Map(state.dragons.map((d) => [d.id, missionGrade(d, missionId)]));
  const grade = (d: OwnedDragon): 1 | 2 | 3 => grades.get(d.id) ?? 2;
  const byLevel = (a: OwnedDragon, b: OwnedDragon): number => b.level - a.level || b.xp - a.xp;
  const find = (id: string): OwnedDragon | undefined => findDragon(state, id);
  const brought = new Set(squad);
  const team = squad.map(find).filter((d): d is OwnedDragon => !!d);
  const worst = team.length ? Math.min(...team.map(grade)) : 0;
  const great = state.dragons.filter((d) => grade(d) === 3);
  const out = (kind: AdviceKind, dragons: OwnedDragon[], types: TypeId[], advice: string): DefeatAdvice =>
    ({ kind, crew, dragons: dragons.map((d) => d.id), stars: dragons.map(grade), types, text: `${crewText} ${advice}` });
  const one = (ds: readonly OwnedDragon[]): boolean => ds.length === 1;
  const solved = Object.values(state.missions).some((r) => (r?.clears ?? 0) > 0);
  const training = solved ? 'the Hamster Wheel and replaying a case you already solved are great training!'
    : 'a few days on the Hamster Wheel will do it!';

  // AUTO-PICK after a good rest: a better matchup than someone who went, that stayed home
  const next = recommendSquad(rested(state), missionId).map(find).filter((d): d is OwnedDragon => !!d);
  const better = next.filter((d) => !brought.has(d.id) && grade(d) > worst && !tooLowFor(d, missionId))
    .sort((a, b) => grade(b) - grade(a) || byLevel(a, b));
  const stars = better.filter((d) => grade(d) === 3).slice(0, 2);
  if (stars.length) {
    return out('send', stars, [],
      `${names(stars)} ${one(stars) ? 'has a GREAT MATCHUP' : 'have GREAT MATCHUPS'} against them. Send ${one(stars) ? 'it' : 'them'} next time!`);
  }
  if (better.length) {
    // nobody great at home, but AUTO-PICK would swap out a dragon with a BAD MATCHUP
    const swapIn = better.slice(0, 1);
    const weak = team.filter((d) => grade(d) === worst).slice(0, 1);
    return out('send', swapIn, [],
      `${names(weak)} has a BAD MATCHUP against them. Send ${names(swapIn)} instead: AUTO-PICK agrees!`);
  }
  // a great matchup that stayed home because it needs more levels
  const low = great.filter((d) => !brought.has(d.id)).sort(byLevel).slice(0, 2);
  if (low.length) {
    return out('train-pick', low, [],
      `${names(low)} ${one(low) ? 'has a GREAT MATCHUP' : 'have GREAT MATCHUPS'} against them, but ${one(low) ? 'needs' : 'need'} more levels first. Train ${one(low) ? 'it' : 'them'} up!`);
  }
  // every great matchup was already in the squad: the types were right
  if (great.length) {
    const all = team.every((d) => grade(d) === 3);
    const lead = all ? 'Your squad had the right types. They just need'
      : `${names(great)} ${one(great) ? 'has' : 'have'} the right type for this case. The squad just needs`;
    return out('train', [], [], `${lead} more levels: ${training}`);
  }
  // nobody grades 3 stars: counter types nobody in the burrow has yet
  const owned = new Set(state.dragons.flatMap((d) => dragonTypes(d)));
  const types = counterTypes(intel.flat()).filter((t) => !owned.has(t)).slice(0, 2);
  if (types.length) {
    return out('recruit', [], types,
      `Nobody in the burrow has a great matchup here yet. A ${types.map(typeName).join(' or ')} dragon would! Keep solving cases to find one, and train up your squad meanwhile.`);
  }
  return out('train', [], [], `Train up your squad and try again: ${training}`);
}

/** The dragons the advice names, for drawing (missing ones skipped). */
export function adviceDragons(state: GameState, advice: DefeatAdvice): OwnedDragon[] {
  return advice.dragons.map((id) => findDragon(state, id)).filter((d): d is OwnedDragon => !!d);
}
