// The shared app context: the one live GameState, the scene stack, input, and navigation.
//
// Scenes never construct each other directly. They call `app.nav.*`, which src/main.ts wires to
// the scene factories at startup. That keeps every scene module independent (no import cycles
// between screens) and gives tools/playtest.ts one place to drive the game from.
import type { MissionId, TypeId } from '../data/schema.ts';
import type { GameState } from '../game/types.ts';
import type { MissionRun, MissionRewards } from '../game/missions.ts';
import type { Input } from './input.ts';
import type { Scene, SceneManager } from './scene.ts';

/** Who is speaking in a dialog box. 'chief' draws Chief Nibbles' portrait. */
export type Speaker = 'chief' | 'none';

export interface Nav {
  /** Reset the stack to the title screen. */
  title(): void;
  /** New game: Chief Nibbles' intro, then the starter pick; ends in burrow(). */
  intro(): void;
  /** Reset the stack to the Burrow hub. Autosaves. */
  burrow(): void;
  /** Push the roster, optionally opened on one dragon's card. */
  roster(dragonId?: string): void;
  /** Push the Dragondex. */
  dex(): void;
  /** Push the type chart as an overlay, optionally highlighting a matchup (attacker row(s), defender column(s)). */
  typeChart(focus?: { attack?: readonly TypeId[]; defend?: readonly TypeId[] }): void;
  /** Push the pantry shop. */
  shop(): void;
  /** Push the bag (use field items on dragons, see food stock). */
  bag(): void;
  /** Push the mission board. */
  board(): void;
  /** Push the briefing + squad selection for a mission. Launching calls nav.run(). */
  briefing(missionId: MissionId): void;
  /** Reset the stack to [burrow, mission run] for a started run. */
  run(run: MissionRun): void;
  /**
   * Push the battle for the run's current battle/boss node. When the battle ends the battle scene
   * calls finishBattle(), pops itself, then calls onEnd. The run scene decides what happens next.
   */
  battle(run: MissionRun, onEnd: (outcome: 'won' | 'lost' | 'retreated') => void): void;
  /** Replace the top scene with the results screen (rewards null = the mission was lost). */
  results(run: MissionRun, rewards: MissionRewards | null): void;
  /** Push the evolution cutscene for a dragon whose XpReport said evolveTo; calls evolve() itself. */
  evolve(dragonId: string, onDone: () => void): void;
  /** Push a modal message box; lines are shown one at a time (typewriter), then onDone. */
  dialog(lines: string[], onDone?: () => void, speaker?: Speaker): void;
  /** Push a modal yes/no box. */
  confirm(text: string, onYes: () => void, onNo?: () => void): void;
  /** Push the OPTIONS box (sound, music, fast text, save and back to the title). */
  options(): void;
}

export interface AppContext {
  /** The live save. Replaced wholesale by new game / continue. */
  state: GameState;
  scenes: SceneManager;
  input: Input;
  nav: Nav;
  /** Seconds since boot (drives idle animation in every scene). */
  time: number;
  /** Persist app.state now. */
  save(): void;
  /**
   * Live objects scenes publish for tools/playtest.ts (e.g. `battle`: the running BattleState) and
   * switches the playtest sets (e.g. `autoplay`: the battle scene picks actions itself).
   */
  debug: Record<string, unknown>;
}

function unwired(name: string): never {
  throw new Error(`app.nav.${name} used before src/main.ts wired it`);
}

/** Filled in by src/main.ts before the first scene is shown. */
export const app: AppContext = {
  state: null as unknown as GameState,
  scenes: null as unknown as SceneManager,
  input: null as unknown as Input,
  time: 0,
  save: () => {},
  debug: {},
  nav: {
    title: () => unwired('title'),
    intro: () => unwired('intro'),
    burrow: () => unwired('burrow'),
    roster: () => unwired('roster'),
    dex: () => unwired('dex'),
    typeChart: () => unwired('typeChart'),
    shop: () => unwired('shop'),
    bag: () => unwired('bag'),
    board: () => unwired('board'),
    briefing: () => unwired('briefing'),
    run: () => unwired('run'),
    battle: () => unwired('battle'),
    results: () => unwired('results'),
    evolve: () => unwired('evolve'),
    dialog: () => unwired('dialog'),
    confirm: () => unwired('confirm'),
    options: () => unwired('options'),
  },
};

/** Convenience for scenes: the type of a scene factory registered in main.ts. */
export type SceneFactory<A extends unknown[] = []> = (...args: A) => Scene;
