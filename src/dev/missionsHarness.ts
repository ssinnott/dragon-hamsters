// Dev harness for the mission screens (dev/missions.html): the mission board, the briefing + squad
// picker, the mission run (node trail) and the results screen, each on a throwaway test save.
//
// URL: ?scene=board|briefing|run|results &mission=<id> &progress=<missions cleared in campaign order>
//      &outcome=won|lost (results) &squad=tired|empty (briefing) &tutorial=1 (board) &at=<node> (run)
//      &real=1 (navigate to the real dialog/confirm/type chart/battle/evolution scenes) &auto=1
//      (battles play themselves). With the stub navigation, the battle placeholder takes W / L / R.

import { bootHarness } from './harness.ts';
import { MISSIONS_IN_ORDER, getMission } from '../data/index.ts';
import * as missions from '../game/missions.ts';
import * as dragons from '../game/dragons.ts';
import { app } from '../ui/app.ts';
import type { GameState } from '../game/types.ts';

const q = new URLSearchParams(location.search);
const sceneName = q.get('scene') ?? 'board';
// Only the screen under test is loaded, so a half-written sibling never breaks this page.
const { createBoardScene } = sceneName === 'board' ? await import('../ui/scenes/board.ts') : { createBoardScene: null };
const { createBriefingScene } = sceneName === 'briefing' ? await import('../ui/scenes/briefing.ts') : { createBriefingScene: null };
const { createMissionRunScene } = sceneName === 'run' ? await import('../ui/scenes/missionRun.ts') : { createMissionRunScene: null };
const { createResultsScene } = sceneName === 'results' ? await import('../ui/scenes/results.ts') : { createResultsScene: null };
const progress = Number(q.get('progress') ?? '2');
const missionId = q.get('mission') ?? MISSIONS_IN_ORDER[Math.min(progress, MISSIONS_IN_ORDER.length - 1)].id;

function setup(s: GameState): void {
  MISSIONS_IN_ORDER.slice(0, progress).forEach((m, i) => { s.missions[m.id] = { clears: i === 0 ? 3 : 1, firstClearDay: 1 }; });
  if (q.get('tutorial') === '1') s.flags.boardTutorial = false;
  const sq = q.get('squad');
  if (sq === 'tired') {
    s.dragons[1].needs.energy = 10;
    s.dragons[3].hp = 0;
    s.dragons[4].needs.fullness = 0;
    s.dragons[5].hp = Math.floor(s.dragons[5].hp / 3);
  }
  if (sq === 'empty') s.squad = [];
}

const extra: Record<string, unknown> = {};

function makeScene() {
  const s = app.state;
  if (createBriefingScene) return createBriefingScene(missionId);
  if (sceneName === 'run' || sceneName === 'results') {
    const squad = s.dragons.slice(0, 3).map((d) => d.id);
    for (const id of squad) { const d = dragons.getDragon(s, id); d.needs.energy = 100; d.needs.fullness = 80; }
    const run = missions.startMission(s, missionId, squad);
    if (sceneName === 'run') {
      const at = Number(q.get('at') ?? '0');
      for (let i = 0; i < at; i++) { const n = missions.currentNode(run); if (n?.kind === 'branch') missions.chooseBranch(run, 1); missions.advance(run); }
      return createMissionRunScene!(run);
    }
    // fake a mission's worth of XP: some level-ups, a learned move, and damage
    const amounts = [900, 3500, 300];
    run.squad.forEach((id, i) => {
      const d = dragons.getDragon(s, id);
      run.xp[id].push(dragons.grantXp(d, Math.floor(amounts[i] * 0.4)));
      run.xp[id].push(dragons.grantXp(d, Math.floor(amounts[i] * 0.6)));
      d.hp = Math.max(1, Math.floor(d.hp * (0.3 + i * 0.3)));
    });
    if (q.get('outcome') === 'lost') {
      run.outcome = 'lost';
      dragons.getDragon(s, run.squad[0]).hp = 0;
      return createResultsScene!(run, null);
    }
    run.coins = 42;
    run.index = run.nodes.length;
    const rewards = missions.completeMission(s, run);
    extra.rewards = rewards;
    return createResultsScene!(run, rewards);
  }
  return createBoardScene!();
}

// ?real=1 wires navigation to the real scenes (dialog, confirm, type chart, battle, evolution and
// these four), so a whole case can be played end to end; ?auto=1 lets the battle play itself.
let nav: Parameters<typeof bootHarness>[1] extends infer O ? O extends { nav?: infer N } ? N : never : never = {};
if (q.get('real') === '1') {
  const [dlg, tc, bat, evo, brd, brf, mr, res] = await Promise.all([
    import('../ui/scenes/dialog.ts'), import('../ui/scenes/typechart.ts'), import('../ui/scenes/battle.ts'),
    import('../ui/scenes/evolution.ts'), import('../ui/scenes/board.ts'), import('../ui/scenes/briefing.ts'),
    import('../ui/scenes/missionRun.ts'), import('../ui/scenes/results.ts'),
  ]);
  nav = {
    dialog: (lines, onDone, speaker) => app.scenes.push(dlg.createDialogScene(lines, onDone, speaker)),
    confirm: (text, onYes, onNo) => app.scenes.push(dlg.createConfirmScene(text, onYes, onNo)),
    typeChart: (focus) => app.scenes.push(tc.createTypeChartScene(focus)),
    battle: (run, onEnd) => app.scenes.push(bat.createBattleScene(run, onEnd)),
    evolve: (id, onDone) => app.scenes.push(evo.createEvolutionScene(id, onDone)),
    board: () => app.scenes.push(brd.createBoardScene()),
    briefing: (id) => app.scenes.push(brf.createBriefingScene(id)),
    run: (run) => app.scenes.reset(mr.createMissionRunScene(run)),
    results: (run, rewards) => app.scenes.replace(res.createResultsScene(run, rewards)),
  };
  if (q.get('auto') === '1') app.debug.autoplay = true;
}

bootHarness(() => makeScene(), { setup, nav });
if (q.get('auto') === '1') app.debug.autoplay = true;
extra.mission = getMission(missionId).title;
(window as unknown as { __missions: unknown }).__missions = extra;
