// Dev harness for the roster, Dragondex, type chart and evolution screens (dev/roster.html).
// URL: ?scene=roster|dex|types|evo, plus: &focus=1 opens the chart on FIRE vs LEAF+WATER;
// &id=d2 opens the roster on (or evolves) that dragon; &empty=1 leaves one dragon and a nearly empty
// Dex; &none=1 an empty burrow; &big=1 a level-45 dragon; &cleared=1 clears the first mission;
// &tut=1 shows Chief Nibbles' first-visit tutorials. window.__nav is app.nav, for opening other
// screens from a headless test (e.g. __nav.typeChart({ attack: ['FIRE'] })).
// The test save gets one starter that is ready to evolve, a few seen-but-unowned species, a hungry
// and a fainted dragon, so every state of these screens shows up.
import { bootHarness } from './harness.ts';
import { app } from '../ui/app.ts';
import type { Scene } from '../ui/scene.ts';
import { SPECIES_BY_DEX, MISSIONS_IN_ORDER, STARTERS } from '../data/index.ts';
import { xpForLevel } from '../battle/stats.ts';
import { dragonStats, grantXp, markSeen } from '../game/dragons.ts';
import { TUTORIAL_FLAGS, type GameState } from '../game/types.ts';
import { createRosterScene } from '../ui/scenes/roster.ts';
import { createDexScene } from '../ui/scenes/dex.ts';
import { createTypeChartScene } from '../ui/scenes/typechart.ts';
import { createEvolutionScene } from '../ui/scenes/evolution.ts';
import { createDialogScene } from '../ui/scenes/dialog.ts';

const params = new URLSearchParams(location.search);
const which = params.get('scene') ?? 'roster';

function setup(s: GameState): void {
  if (!params.get('tut')) for (const f of [TUTORIAL_FLAGS.roster, TUTORIAL_FLAGS.dex, TUTORIAL_FLAGS.typeChart]) s.flags[f] = true;
  // the fire starter has reached its evolution level but put it off
  const fire = s.dragons.find((d) => d.speciesId === STARTERS[0]);
  const evoLevel = SPECIES_BY_DEX.find((sp) => sp.id === STARTERS[0])?.evolvesTo?.level ?? 16;
  if (fire) {
    grantXp(fire, xpForLevel(evoLevel) + 40 - fire.xp);
    fire.hp = dragonStats(fire).hp;
    fire.nickname = null;
    fire.training = { hp: 12, atk: 40, def: 8, spa: 64, spd: 0, spe: 30 };
    fire.missions = 3; fire.battlesWon = 7;
  }
  const d2 = s.dragons[1], d3 = s.dragons[3], d4 = s.dragons[4];
  if (d2) { d2.needs.fullness = 18; d2.slotsUsed = 1; d2.status = 'burn'; }
  if (d3) { d3.hp = 0; d3.needs.energy = 12; d3.slotsUsed = 2; }
  if (d4) { d4.needs.happiness = 92; d4.hp = Math.floor(dragonStats(d4).hp * 0.35); }
  // a few seen but not owned
  for (const sp of SPECIES_BY_DEX.filter((x) => !s.dex.owned.includes(x.id)).slice(0, 5)) markSeen(s, sp.id);
  if (params.get('big') && s.dragons[8]) {
    const big = s.dragons[8];
    grantXp(big, xpForLevel(45) - big.xp);
    big.hp = dragonStats(big).hp;
  }
  if (params.get('none')) s.dragons = [];
  if (params.get('empty')) {
    s.dragons = s.dragons.slice(0, 1);
    s.dex.owned = [s.dragons[0].speciesId];
    s.dex.seen = [...s.dex.owned];
  }
  const m = MISSIONS_IN_ORDER[0];
  if (m && params.get('cleared')) s.missions[m.id] = { clears: 1, firstClearDay: 1 };
}

function first(): Scene {
  switch (which) {
    case 'dex': return createDexScene();
    case 'types': return createTypeChartScene(params.get('focus') ? { attack: ['FIRE'], defend: ['LEAF', 'WATER'] } : undefined);
    case 'evo': {
      const id = params.get('id') ?? app.state.dragons[0].id;
      return createEvolutionScene(id, () => { console.log('[evo] done'); app.nav.roster(id); });
    }
    default: return createRosterScene(params.get('id') ?? undefined);
  }
}

// headless tests open other screens on top: window.__nav.typeChart({ attack: ['FIRE'] })
(window as unknown as { __nav: unknown }).__nav = new Proxy({}, { get: (_t, k: string) => (app.nav as unknown as Record<string, unknown>)[k] });

bootHarness(first, {
  setup,
  nav: {
    roster: (id) => app.scenes.push(createRosterScene(id)),
    dex: () => app.scenes.push(createDexScene()),
    typeChart: (f) => app.scenes.push(createTypeChartScene(f)),
    evolve: (id, onDone) => app.scenes.push(createEvolutionScene(id, onDone)),
    dialog: (lines, onDone, speaker) => app.scenes.push(createDialogScene(lines, onDone, speaker)),
  },
});
