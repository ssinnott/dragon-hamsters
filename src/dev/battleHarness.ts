// Battle harness (dev/battle.html): runs the battle scene on its own on the harness test save.
//
// URL options:
//   ?mission=cheese-1   which mission's current node to fight (default cheese-1)
//   ?test=boss          a custom boss encounter that provokes the AI's counter-swap
//                       (a LEAF minion, a WATER robot, then Baron Von Hiss) against the FIRE starter
//   ?test=solo          a single minion at a low level (quick win, XP and a level up)
//   ?xp=1               the lead dragon is a few XP short of its next level
//   ?fast=0|1           settings.fastText (default 1, like a new save)
//   ?auto=1             app.debug.autoplay: the scene plays itself
//   ?status=1           the lead starts BURNED and the second dragon fainted (bag / swap reasons)
// A stand-in "mission run" scene sits under the battle: it pushes the battle on enter, shows the
// outcome when the battle pops itself, and Enter starts a fresh battle.
import { bootHarness } from './harness.ts';
import { app } from '../ui/app.ts';
import type { Scene } from '../ui/scene.ts';
import { UI, drawPanel, ButtonGroup } from '../ui/widgets.ts';
import { drawText } from '../lib/engine/text.ts';
import { startMission, type MissionRun } from '../game/missions.ts';
import { dragonStats } from '../game/dragons.ts';
import { xpForLevel } from '../battle/stats.ts';
import { autoAction, createBattleScene } from '../ui/scenes/battle.ts';
import type { BattleState } from '../battle/types.ts';
import type { MissionNode } from '../data/schema.ts';

const q = new URLSearchParams(location.search);
const missionId = q.get('mission') ?? 'cheese-1';
const test = q.get('test') ?? '';

function customNodes(): MissionNode[] | null {
  if (test === 'boss') {
    return [{
      kind: 'boss', label: 'Test showdown',
      encounter: {
        intro: 'Baron Von Hiss blocks the corridor with two very nervous henchmen.',
        enemies: [{ villain: 'hedge-hisser', level: 9 }, { villain: 'soaker-bot', level: 9 }, { villain: 'baron-von-hiss', level: 9 }],
      },
    }];
  }
  if (test === 'solo') {
    return [{
      kind: 'battle', label: 'Test scuffle',
      encounter: { intro: 'A lone hedge hisser is lurking behind the museum ferns.', enemies: [{ villain: 'hedge-hisser', level: 6 }] },
    }];
  }
  return null;
}

let outcomes: string[] = [];

function makeRun(): MissionRun {
  const s = app.state;
  for (const d of s.dragons) { d.needs.energy = 100; d.needs.fullness = 100; d.hp = dragonStats(d).hp; d.status = null; }
  const squad = s.squad.slice(0, 3);
  const run = startMission(s, missionId, squad);
  const nodes = customNodes();
  if (nodes) { run.nodes = nodes; run.index = 0; }
  else {
    const i = run.nodes.findIndex((n) => n.kind === 'battle' || n.kind === 'boss');
    run.index = Math.max(0, i);
  }
  const lead = s.dragons.find((d) => d.id === squad[0]);
  if (lead && q.get('xp') === '1') lead.xp = xpForLevel(lead.level + 1) - 6;
  if (q.get('status') === '1') {
    if (lead) lead.status = 'burn';
    const second = s.dragons.find((d) => d.id === squad[1]);
    if (second) second.hp = 0;
  }
  return run;
}

function standIn(): Scene {
  const group = new ButtonGroup();
  let last = '';
  const launch = (): void => {
    const run = makeRun();
    app.scenes.push(createBattleScene(run, (o) => {
      last = o;
      outcomes.push(o);
      console.log('[harness] battle ended: ' + o + ' / run outcome ' + run.outcome);
    }));
  };
  group.add({ label: 'NEW BATTLE', rect: { x: 250, y: 200, w: 140, h: 28 }, color: UI.accent, onClick: launch });
  return {
    name: 'run-standin',
    enter() { launch(); },
    update(_dt, input) { group.update(input); },
    draw(ctx) {
      ctx.fillStyle = UI.nightDark;
      ctx.fillRect(0, 0, 640, 360);
      drawPanel(ctx, 160, 110, 320, 140, { title: 'MISSION RUN STAND-IN' });
      drawText(ctx, last ? 'THE BATTLE ENDED: ' + last.toUpperCase() : 'NO BATTLE YET', 320, 150, { color: UI.text, shadow: false, align: 'center' });
      drawText(ctx, 'ENTER FOR ANOTHER ONE', 320, 170, { color: UI.textDim, shadow: false, align: 'center' });
      group.draw(ctx);
    },
  };
}

bootHarness(() => standIn(), {
  seed: Number(q.get('seed') ?? 7),
  setup: (s) => {
    s.settings.fastText = q.get('fast') !== '0';
  },
});
if (q.get('auto') === '1') app.debug.autoplay = true;

const hooks = window.__game;
if (hooks?.api) {
  hooks.api.outcomes = () => outcomes.slice();
  hooks.api.battleMenu = () => {
    const ui = app.debug.battleUi as Record<string, () => unknown> | undefined;
    if (!ui || app.scenes.top()?.name !== 'battle') return null;
    const out: Record<string, unknown> = {};
    for (const [k, f] of Object.entries(ui)) out[k] = f();
    return out;
  };
  hooks.api.autoplay = (on: boolean) => { app.debug.autoplay = on; };
  hooks.api.auto = () => (app.debug.battle ? autoAction(app.debug.battle as BattleState) : null);
  hooks.api.setFast = (on: boolean) => { app.state.settings.fastText = on; };
  hooks.api.resetOutcomes = () => { outcomes = []; };
}
