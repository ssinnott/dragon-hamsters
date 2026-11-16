# Module APIs

The function-level contract between modules. Shapes are in `src/data/schema.ts`,
`src/battle/types.ts` and `src/game/types.ts`. Imports always name the real `.ts` file
(`import { getMove } from '../data/index.ts'`). No module outside `src/ui/`, `src/art/`,
`src/audio/`, `src/dev/` and `src/main.ts` may touch the DOM, so `src/data`, `src/battle` and
`src/game` all run under Node for the tests. Never edit `src/lib/` (the vendored engine).

## src/data (content)

```ts
// types.ts
export const TYPES: Record<TypeId, TypeInfo>;
export const CHART: Record<TypeId, Partial<Record<TypeId, number>>>; // attacker -> defender -> 0 | 0.5 | 2 (omitted = 1)
export function effectiveness(attack: TypeId, defender: readonly TypeId[]): number;
// moves.ts       export const MOVES: Record<MoveId, MoveDef>;
// abilities.ts   export const ABILITIES: Record<AbilityId, AbilityDef>;
// personalities.ts export const PERSONALITIES: PersonalityDef[];
// items.ts       export const FOODS: Record<FoodId, FoodDef>; export const ITEMS: Record<ItemId, ItemDef>;
// activities.ts  export const ACTIVITIES: Record<ActivityId, ActivityDef>;
// species.ts     export const SPECIES: SpeciesDef[]; export const STARTERS: SpeciesId[]; // [fire, leaf, water] (also re-exported by index.ts)
// villains.ts    export const ORGS: Record<OrgId, OrgDef>; export const VILLAINS: Record<VillainId, VillainDef>;
// missions.ts    export const MISSION_TYPES; export const LOCATIONS; export const MISSIONS: MissionDef[];
// index.ts       getType/getMove/getAbility/getPersonality/getFood/getItem/getActivity/getSpecies/
//                getOrg/getVillain/getMission/getMissionType/getLocation (throw on unknown id),
//                isFood, SPECIES_BY_DEX, MISSIONS_IN_ORDER, and re-exports of every table and STARTERS.
//                tauntingVillains(node: MissionNode): VillainDef[] // whose taunts play before a battle/boss
//                node: the first enemy of a battle; the boss, then his lieutenant(s), before a showdown
```

## src/battle (engine; pure, Node-safe)

```ts
// stats.ts
export function calcStats(base: Stats, level: number, genes: Stats, training: Stats, personality: PersonalityId | null): Stats;
export function xpForLevel(level: number): number;          // total XP to reach `level`: level^3 (level 1 -> 0)
export function levelForXp(xp: number): number;              // inverse, capped at MAX_LEVEL
export function xpYield(baseXp: number, foeLevel: number, selfLevel: number, isBoss: boolean): number;
export function stageMult(stage: number): number;            // (2+n)/2 or 2/(2-n)
export function accStageMult(stage: number): number;         // (3+n)/3 or 3/(3-n)

// matchup.ts  (also used by the UI for the rock-paper-scissors displays)
export function moveEffectiveness(moveId: MoveId, defenderTypes: readonly TypeId[]): number; // as the FIGHT tags show it: fixed-damage moves are x1 (x0 when immune)
export function bestTypeMultiplier(attackerTypes: readonly TypeId[], defenderTypes: readonly TypeId[]): number; // max over attacker's types
export function weaknesses(defenderTypes: readonly TypeId[]): TypeId[];   // attacking types that deal > 1x
export function resistances(defenderTypes: readonly TypeId[]): TypeId[];  // attacking types that deal < 1x (incl. 0)
export function immunities(defenderTypes: readonly TypeId[]): TypeId[];
export interface MatchupParts { offence: number; stab: number; defence: number } // best move mult, best STAB mult, foe's best STAB on us
export function matchupParts(selfTypes, selfMoves, foeTypes): MatchupParts;
/**
 * 1..3 stars: how well a combatant with these types and moves fares against `foeTypes`.
 * 3 = the foe's STAB is not super-effective on it AND (one of its moves is super-effective, or it
 *     resists the foe's STAB while its own STAB lands at least neutrally); WATER vs WATER is 2.
 * 1 = the foe's STAB is super-effective and it has nothing super-effective back (or nothing that
 *     can touch the foe). 2 = everything else. Battle swap cards and briefing squad picks both use it.
 */
export function matchupGrade(selfTypes: readonly TypeId[], selfMoves: readonly MoveId[], foeTypes: readonly TypeId[]): 1 | 2 | 3;
/**
 * Rounded (weighted) average of matchupGrade over several expected enemy type sets (mission intel);
 * one set = that set's grade. opts.weights: one per set (default 1). opts.boss: the boss's set,
 * which caps the grade: 2 at most unless a damaging move hits him at least x1, 1 when none touches him.
 */
export interface IntelGradeOptions { weights?: readonly number[]; boss?: number }
export function intelGrade(selfTypes: readonly TypeId[], selfMoves: readonly MoveId[], intel: readonly (readonly TypeId[])[], opts?: IntelGradeOptions): 1 | 2 | 3;
export const GRADE_LABELS: Record<1 | 2 | 3, string>;       // 'GREAT MATCHUP!' / 'EVEN MATCHUP' / 'BAD MATCHUP', the one wording for star grades
/** Types that would be good to bring against these (super-effective on most of them, ideally resisting them). */
export function counterTypes(intelTypes: readonly TypeId[]): TypeId[];
export function effectivenessLabel(mult: number): { text: string; color: string }; // 'SUPER X2' green, 'X1', 'WEAK X0.5' orange, 'NO EFFECT' grey, 'SUPER X4'

// build.ts
export function buildMon(init: MonInit, side: Side, index: number): BattleMon;
export function defaultMoves(learnset: { level: number; move: MoveId }[], level: number): MoveId[]; // last 4 learned at <= level

// damage.ts
export interface DamageResult { damage: number; effectiveness: number; crit: boolean }
export function calcDamage(state: BattleState, attacker: BattleMon, defender: BattleMon, move: MoveDef, opts?: { forceCrit?: boolean; randomFactor?: number }): DamageResult;
export function estimateDamage(attacker: BattleMon, defender: BattleMon, moveId: MoveId): { min: number; max: number; effectiveness: number }; // no RNG, no crit
export function effectiveStat(mon: BattleMon, stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe'): number;

// battle.ts
export function createBattle(setup: BattleSetup): BattleState;
export function startBattle(state: BattleState): BattleEvent[];   // both leads sent out, entry abilities
export function activeMon(state: BattleState, side: Side): BattleMon;
export function legal(state: BattleState): { moves: boolean[]; switches: boolean[]; items: ItemId[]; retreat: boolean; mustSwitch: boolean };
export function submitTurn(state: BattleState, action: PlayerAction): BattleEvent[];
export function submitSwitch(state: BattleState, index: number): BattleEvent[];  // when phase === 'switch'; fires a waiting enemy entry ability (state.pendingEntry: a double knockout, or a foe knocked out while the player pivots)
export function itemTargetOk(state: BattleState, item: ItemId, index: number): boolean; // the engine's item-target rule (legal().items, submitTurn); the battle scene's target cards use it
// Events (types.ts): { t: 'volatile'; side; uid; seeded; stuck } whenever SEEDED / STUCK change (set by a move, STUCK
// released when the trapper leaves). 'faint' / 'withdraw' / 'sendOut' clear volatile state (and 'faint' the status)
// with no event of their own: a scene clears its copies when it plays them.

// ai.ts
export function chooseEnemyAction(state: BattleState): { kind: 'move'; slot: number } | { kind: 'switch'; index: number };
export function chooseEnemyReplacement(state: BattleState, foeLeaving?: boolean): number; // best matchup vs the player's active, bosses last; foeLeaving (it pivoted or is down too): send order
```

## src/game (systems; pure, Node-safe except storage, which is injected)

```ts
// rng.ts
export function stateRng(state: GameState): RngInstance; // draws advance state.seed so saves replay
export function nextSeed(state: GameState): number;      // a battle seed drawn from the world stream
export function freshSeed(): number;                     // a random non-zero 32-bit seed for a brand-new world (main.ts, intro)
// types.ts (besides the save shapes)
export const TUTORIAL_FLAGS: { burrow; board; roster; dex; typeChart };  // GameState.flags keys of the first-visit tutorials
export const ALL_TUTORIAL_FLAGS: readonly TutorialFlag[];                 // the test API's newGame(..., { skipTutorials: true }) sets them all
// state.ts
export function newGame(seed: number, playerName?: string): GameState;   // no dragons yet; 200 coins; a starter pantry
export interface Storage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export function saveGame(state: GameState, storage?: Storage): void;     // default: window.localStorage when present
export function loadGame(storage?: Storage): GameState | null;           // validates + migrates; null if absent/corrupt
export function clearSave(storage?: Storage): void;
// dragons.ts
export function createDragon(state: GameState, speciesId: SpeciesId, level: number): OwnedDragon; // random genes/personality/ability via stateRng; moves = startingLoadout
/** The loadout a dragon raised from level 1 to `level` would have (auto-equip's rule at every learned move), not just the last four learned. */
export function startingLoadout(species: SpeciesDef, level: number): MoveId[];
export function addDragon(state: GameState, d: OwnedDragon): void;      // pushes, marks dex seen+owned
export function dragonName(d: OwnedDragon): string;
export function dragonStats(d: OwnedDragon): Stats;
export function dragonTypes(d: OwnedDragon): TypeId[];
export function isFainted(d: OwnedDragon): boolean;
export interface MoveSwap { out: MoveId; in: MoveId }
export interface XpReport { dragonId: string; xp: number; levelsGained: number[]; learned: MoveId[]; swapped: MoveSwap[]; evolveTo: SpeciesId | null }
/**
 * Levels up, learns moves, keeps the HP proportion. Auto-equip: a learned move goes into a free
 * slot; with four equipped it replaces the weakest one if it is worth more (autoSwapFor), reported
 * in `swapped` ("SWAPPED X FOR Y", see habitat.swapLines).
 */
export function grantXp(d: OwnedDragon, amount: number): XpReport;
/** power x STAB 1.5 x acc/100 (x expected hits for multi-hit); fixed damage FIXED_MOVE_VALUE (50) x acc; status STATUS_MOVE_VALUE (55). */
export function moveValue(types: readonly TypeId[], id: MoveId): number;
/** The swap auto-equip would make (weakest equipped out; only the first status move counts 55, any other 0; a new status move only if none is equipped), or null. */
export function autoSwapFor(d: OwnedDragon, move: MoveId): MoveSwap | null;
export function foldSwaps(lists: readonly (readonly MoveSwap[] | undefined)[]): MoveSwap[]; // A->B then B->C reads A->C
export interface EvolveReport { from: SpeciesId; to: SpeciesId; learned: MoveId[]; swapped: MoveSwap[] }
export function evolveDragon(state: GameState, d: OwnedDragon): EvolveReport; // evolves and reports the moves learned/swapped
export function evolve(state: GameState, d: OwnedDragon): SpeciesId;   // evolveDragon(...).from; marks dex
export function setLoadout(d: OwnedDragon, moves: MoveId[]): void;      // validates subset of knownMoves, 1-4
export function addTraining(d: OwnedDragon, gains: Partial<Stats>): Partial<Stats>; // respects caps; returns actual gains
export function toMonInit(d: OwnedDragon): MonInit;
export interface AfterBattle { reports: XpReport[]; fainted: string[] }
export function syncFromBattle(state: GameState, battle: BattleState): AfterBattle; // hp/status/xp/level back onto OwnedDragons
// habitat.ts
export interface ActivityResult { ok: boolean; reason?: string; lines: string[]; xp?: XpReport; training?: Partial<Stats>; loot?: { coins: number; food: Partial<Record<FoodId, number>>; items: Partial<Record<ItemId, number>> } }
export function canDoActivity(state: GameState, dragonId: string, activity: ActivityId, food?: FoodId): { ok: boolean; reason?: string };
export function doActivity(state: GameState, dragonId: string, activity: ActivityId, food?: FoodId): ActivityResult;
export function useItemOutside(state: GameState, item: ItemId, dragonId: string): { ok: boolean; line: string };
export interface DayReport { day: number; lines: string[] }
export function endDay(state: GameState): DayReport;  // heals, cures, +80 energy (cap 100), -25 fullness, happiness settles, next day
export const HAPPINESS_SETTLE = 50, HAPPINESS_DRIFT = 10;  // each night happiness above 50 drops by 10 (never below 50)
// The care package: a morning with nothing in the pantry and coins < cheapest food x dragons brings
// CARE_PACKAGE_PER_DRAGON of the cheapest food per dragon (so a broke, starving burrow is never stuck).
export const CARE_PACKAGE_PER_DRAGON = 2;
export function cheapestFood(): FoodId;
export function needsCarePackage(state: GameState): boolean;
export function moodLine(d: OwnedDragon): string;  // e.g. 'HUNGRY!', 'SLEEPY', 'HAPPY'
export const HUNGRY_AT = 30, GLUM_AT = 20, JOYFUL_AT = 80;  // the need thresholds behind moods (the burrow's body language uses them too)
export function xpLines(d: OwnedDragon, r: XpReport): string[];   // result lines for an XP report (incl. swap lines)
export function swapLines(swapped: readonly MoveSwap[]): string[]; // 'SWAPPED X FOR Y!' per swap
// Feeding: a favourite food doubles happiness, and so does being a Snack Bar fan (ACTIVITIES.feed.likedBy: FLUFF, COOKING); they stack.
// shop.ts
export const SHOP: { id: FoodId | ItemId; price: number }[];
export function buy(state: GameState, id: FoodId | ItemId, qty?: number): { ok: boolean; line: string };
// missions.ts
export type MissionStatus = 'locked' | 'available' | 'cleared';
export function missionStatus(state: GameState, id: MissionId): MissionStatus;
export function canLaunch(state: GameState, id: MissionId, squad: string[]): { ok: boolean; reason?: string };
export interface MissionRun {
  missionId: MissionId; squad: string[]; nodes: MissionNode[]; index: number;
  coins: number; defeated: VillainId[]; xp: Record<string, XpReport[]>; outcome: 'active' | 'won' | 'lost' | 'retreated';
  supercharge?: StageChanges;   // what the chosen branch routes give the boss (sabotage rush: +1 ATK / +1 SP.ATK)
}
export function startMission(state: GameState, id: MissionId, squad: string[]): MissionRun; // spends energy/fullness, records squad
export function currentNode(run: MissionRun): MissionNode | null;
export function chooseBranch(run: MissionRun, option: number): void;   // splices the option's nodes in place of the branch; records the route's supercharge on run.supercharge
export function bossSupercharge(run: MissionRun, node: MissionNode): StageChanges | undefined; // boss node's own supercharge + run.supercharge (encounterSetup applies it)
export function mergeStages(a?: StageChanges, b?: StageChanges): StageChanges | undefined;     // summed, clamped to -6..+6
export function applyRest(state: GameState, run: MissionRun): string[]; // HP only (fainted ones get back up); a dragon left with a status is told so ("still BURNED", with the Herbal Tea fix), never "tip-top"
export function advance(run: MissionRun): void;
export function encounterSetup(state: GameState, run: MissionRun): BattleSetup; // for the current battle/boss node; in case 5 the boss gets MonInit.caught (says VillainDef.caught when he faints)
export function tuckeredAfterWin(run: MissionRun, battle: BattleState): boolean; // won, but the whole squad is down and no rest stop comes before the next fight (the scene skips VICTORY!); a branch counts when one of its routes reaches a rest first
// finishBattle: sync; loss or tuckeredAfterWin -> outcome 'lost'; each dragon that fainted in the battle loses
// FAINT_HAPPINESS happiness; a won battle that leaves everyone down right before a branch takes, in its place,
// the first route that reaches a rest stop (its story beat says why).
export function finishBattle(state: GameState, run: MissionRun, battle: BattleState): AfterBattle;
export const FAINT_HAPPINESS = 5;
export interface MissionRewards { coins: number; food: Partial<Record<FoodId, number>>; items: Partial<Record<ItemId, number>>; dragon: OwnedDragon | null; firstClear: boolean; lines: string[] }
export function completeMission(state: GameState, run: MissionRun): MissionRewards; // also marks the case's reward pool seen in the Dragondex; a pool dragon is a species not owned yet, except a rescue's captive, which joins on the first clear regardless
export function abandonMission(state: GameState, run: MissionRun): void;
export function intelTypes(missionId: MissionId): TypeId[][];  // one type set per enemy kind the mission fields
export const INTEL_WEIGHT: { boss: 3; lieutenant: 2; minion: 1 };
export function missionIntel(missionId: MissionId): { types: TypeId[][]; weights: number[]; boss: number }; // intelTypes + a weight per set + the boss's index
export function missionGrade(d: OwnedDragon, missionId: MissionId): 1 | 2 | 3;  // the briefing's stars: intelGrade with missionIntel's weights and boss cap
export const PICK_LEVEL_GAP = 5, TOO_LOW_BELOW_BAND = 3;
export function tooLowFor(d: OwnedDragon, missionId: MissionId): boolean;      // level < case level - 3 (the briefing warns)
// Briefing order: those that can go; then those within PICK_LEVEL_GAP of the best one that can go
// (or at least at the case's level); each group by missionGrade, then level.
export function rankForMission(state: GameState, missionId: MissionId): OwnedDragon[];
export function recommendSquad(state: GameState, missionId: MissionId): string[]; // AUTO-PICK: the top 3 of rankForMission that can go, highest level sent out first
// advice.ts: Chief Nibbles' advice on the MISSION FAILED screen, from the same missionGrade stars and
// the AUTO-PICK a rested burrow would get (recommendSquad), so the results and the briefing agree.
//   send: 3-star dragons that stayed home and AUTO-PICK would bring (or, with none, the dragon it would
//         swap in for a BAD MATCHUP that went); train-pick: 3-star dragons that need levels first;
//   train: every 3-star dragon already went; recruit: nobody grades 3, counter types nobody owns.
export type AdviceKind = 'send' | 'train-pick' | 'train' | 'recruit';
export interface DefeatAdvice { kind: AdviceKind; crew: TypeId[]; dragons: string[]; stars: (1 | 2 | 3)[]; types: TypeId[]; text: string }
export function defeatAdvice(state: GameState, missionId: MissionId, squad: readonly string[]): DefeatAdvice; // pure
export function adviceDragons(state: GameState, advice: DefeatAdvice): OwnedDragon[];
```

## src/ui (kit; browser)

```ts
// input.ts
export interface Pointer { x: number; y: number; down: boolean; pressed: boolean; released: boolean; inside: boolean }
export interface Input {
  readonly pointer: Pointer;
  pressed(key: string): boolean;   // KeyboardEvent.key: 'Enter', ' ', 'Escape', 'ArrowUp', '1', 'a' (lower-case letters)
  held(key: string): boolean;
  readonly wheel: number;          // wheel delta since last update
  confirm(): boolean;              // Enter or Space pressed
  back(): boolean;                 // Escape or Backspace pressed
  beginUpdate(): void;             // drain the queued DOM events into this update's flags
  endUpdate(): void;               // clear per-update flags
  injectClick(x: number, y: number): void; injectKey(key: string): void; // tests/playtest
}
export function createInput(target: HTMLElement, toInternal: (cx: number, cy: number) => { x: number; y: number }): Input;

// scene.ts
export interface Scene {
  readonly name: string;
  enter?(): void; exit?(): void; resume?(): void;
  update(dt: number, input: Input): void;
  draw(ctx: CanvasRenderingContext2D): void;
  readonly overlay?: boolean;     // draw the scene below first (modals)
}
export interface SceneManager {
  push(s: Scene): void; pop(): void; replace(s: Scene): void; reset(s: Scene): void;
  top(): Scene | null; readonly depth: number;
  update(dt: number, input: Input): void; draw(ctx: CanvasRenderingContext2D): void;  // fades between scenes
}
export function createSceneManager(): SceneManager;

// widgets.ts (retained-mode buttons + immediate-mode drawing helpers)
export interface Rect { x: number; y: number; w: number; h: number }
export const VIEW_W = 640, VIEW_H = 360;
export const UI: { ink; panel; panelLight; panelDark; text; textDim; accent; good; warn; bad; gold; ... };
export function hit(r: Rect, x: number, y: number): boolean;
export interface ButtonSpec { label: string; rect: Rect; onClick: () => void; color?: string; textColor?: string; hotkey?: string; enabled?: () => boolean; sub?: string; icon?: (ctx, cx, cy) => void; size?: number; visible?: () => boolean }
export class Button { spec; hovered; constructor(spec: ButtonSpec); draw(ctx, focused: boolean): void }
export class ButtonGroup {          // mouse hover/click + arrow-key focus (spatial nav) + Enter + hotkeys
  constructor(buttons?: Button[]); add(b: Button | ButtonSpec): Button; clear(): void; focus: number;
  keyboard: boolean;                // arrows / Tab / Enter drive it (default true; hotkeys always work)
  showFocus: boolean | null;        // draw the focus ring; null (default) follows `keyboard`
  update(input: Input): boolean;    // true if a button fired this update
  draw(ctx): void;
}
export function drawPanel(ctx, x, y, w, h, opts?: { fill?: string; border?: string; title?: string; shadow?: boolean }): void;
export function drawBar(ctx, x, y, w, h, frac: number, color: string, opts?: { bg?: string; border?: string }): void;
export function drawHpBar(ctx, x, y, w, hp: number, maxHp: number, opts?: { boss?: boolean }): void;  // green > 50%, yellow > 20%, red
export function drawTypeBadge(ctx, type: TypeId, x, y, opts?: { small?: boolean }): number;           // returns width
export function drawTypeBadges(ctx, types: readonly TypeId[], x, y, opts?): number;
export function typeBadgeWidth(type: TypeId, opts?: { small?: boolean }): number;                      // width without drawing
export function typeBadgesWidth(types: readonly TypeId[], opts?: { small?: boolean; gap?: number }): number;
export function drawEffectTag(ctx, mult: number, x, y): number;                                       // SUPER X2 etc, returns width
export function drawStars(ctx, n: number, max: number, x, y): void;
export function wrapText(text: string, maxWidth: number, size?: number): string[];
export function drawWrapped(ctx, text: string, x, y, maxWidth: number, opts?: DrawTextOptions & { lineGap?: number }): number; // returns height
export class Typewriter { constructor(cps?: number); set(text: string): void; update(dt: number): void; skip(): void; readonly done: boolean; readonly visible: string }
export function drawMessageBox(ctx, x, y, w, h, text: string | Typewriter, opts?: { size?; arrow?; name?; fill?; indent?: number }): void; // indent: room for a portrait
export function drawCoins(ctx, amount: number, x, y): number;
export function drawStatusBadge(ctx, status: StatusId, x, y): number;
export class ScrollList<T> { constructor(opts: { rect: Rect; rowH: number; items: () => T[]; drawRow: (ctx, item: T, r: Rect, selected: boolean, hovered: boolean) => void; onSelect?: (item: T, i: number) => void; onActivate?: (item: T, i: number) => void; onClick?: (item: T, i: number) => void /* single click, not a drag */ }); selected: number; update(input): void; draw(ctx): void }
export function movePowerLabel(m: MoveDef): string;      // the power, or '-' for status and fixed-damage moves (everywhere a power is shown)
export function drawKeycap(ctx, key: string, x, y): number;  // hotkey hint key cap
export interface LiveButton { label: string; sub?: string; hotkey?: string; rect: Rect; enabled: boolean }
export const liveButtons: LiveButton[];  // every visible button of every ButtonGroup that updated this step (= what the player can press)
export const STAGE_SHORT: Record<StageStat, string>;
export function itemEffectText(def: ItemDef): string;    // 'HEALS 50% HP', 'BATTLE: +1 ATK +1 SP.ATK'
export function foodEffectText(def: FoodDef, opts?: { happyMult?: number; sep?: string }): string; // 'FULL +35 HAPPY +8'
// icons.ts
export function drawTypeIcon(ctx, type: TypeId, cx, cy, r: number): void;
export function drawFoodIcon(ctx, id: FoodId, cx, cy, s?: number): void;
export function drawItemIcon(ctx, id: ItemId, cx, cy, s?: number): void;
export function drawCoinIcon(ctx, cx, cy, r?: number): void;
export function drawOrgEmblem(ctx, org: OrgId, cx, cy, r: number): void;
export function drawActivityIcon(ctx, id: ActivityId, cx, cy, s?: number): void;
export function drawLock(ctx, cx, cy, s?: number): void;
export function pixelSprite(key: string, rows: readonly string[], pal: Record<string, string>): HTMLCanvasElement; // ink-outlined mask sprite, cached
export function blitSprite(ctx, s: HTMLCanvasElement, cx, cy, scale?: number): void;
export const MISSION_TYPE_COLOR: Record<MissionTypeId, string>;
export function drawMissionTypeIcon(ctx, type: MissionTypeId, cx, cy, scale?: number): void;    // board, briefing
export const MISSION_NODE_FILL: Record<MissionNode['kind'], string>;
export function missionNodeSprite(kind: MissionNode['kind'], t?: number): HTMLCanvasElement;   // mission run trail
export function drawMissionNodeIcon(ctx, kind, cx, cy, t?: number, scale?: number): void;
export function drawTickIcon(ctx, cx, cy): void;
export function drawSpeakerIcon(ctx, cx, cy, on: boolean, color: string): void;              // SOUND switch (title, OPTIONS)
export function drawNoteIcon(ctx, cx, cy, on: boolean, color: string, strike?: string): void; // MUSIC switch
export function drawGearIcon(ctx, cx, cy, color?: string, ink?: string): void;                // the Burrow's OPTIONS button
// app.ts: scenes navigate through app.nav (wired in src/main.ts): title, intro, burrow, roster, dex,
// typeChart, shop, bag, board, briefing, run, battle, results, evolve, dialog, confirm, and
// options(): the OPTIONS box (SOUND, MUSIC, FAST TEXT, SAVE & BACK TO TITLE), pushed over the Burrow.
// battle/hud.ts: the MATCHUP strip's verdict follows Matchup.grade (the active dragon's matchupGrade,
// the SWAP cards' grade) when set, in GRADE_LABELS words; the arrows show the type multipliers.
```

## src/art (browser)

```ts
// dragon.ts / villain.ts
export type Pose = 'idle' | 'walk' | 'attack' | 'hurt' | 'faint' | 'happy' | 'sleep' | 'eat' | 'run' | 'dig';
export interface CreatureOpts {
  scale?: number;          // 1 = a size-1.0 creature about 40 px tall; battle uses ~2
  facing?: 1 | -1;         // 1 faces right (player side), -1 faces left (enemy side)
  t?: number;              // seconds, drives idle bob/blink/wing flap
  pose?: Pose; poseT?: number;  // 0..1 progress through a one-shot pose (attack lunge, hurt recoil, faint sink)
  alpha?: number;
  silhouette?: string | null;  // draw as a flat colour (undiscovered dex entries)
  flash?: number;          // 0..1 white hit flash
}
export function drawDragon(ctx, v: DragonVisual, x: number, y: number, opts?: CreatureOpts): void;   // x,y = ground point between the feet
export function dragonHeight(v: DragonVisual, scale?: number): number;
export function drawVillain(ctx, v: VillainVisual, x: number, y: number, opts?: CreatureOpts): void;
export function villainHeight(v: VillainVisual, scale?: number): number;
export function openEyesTime(v: DragonVisual): number;            // an idle t with open eyes (still frames)
export function dragonPhase(v: DragonVisual): number;             // the blink / bob phase poseState is driven with
export interface DragonHeadGeo { hx: number; hy: number; hr: number; eyeRy: number; phase: number }
export function dragonHeadGeo(v: DragonVisual): DragonHeadGeo;    // head space for overlays (the Chief's patch and mouth)
export interface SpriteBox { l: number; r: number; t: number; b: number }
export function measureDragon(v: DragonVisual): SpriteBox;        // real drawn bounds at scale 1, cached (browser)
export function fitDragon(v: DragonVisual, maxW: number, maxH: number, maxScale: number): { scale: number; dx: number; dy: number };
// backdrops.ts
export function drawBattleBackdrop(ctx, loc: LocationDef, t: number): void;   // full 640x360
export function drawPlatform(ctx, cx: number, cy: number, w: number, loc: LocationDef): void;
export function drawBurrow(ctx, t: number): void;                              // habitat background
export const STATIONS: Record<ActivityId, { x: number; y: number; w: number; h: number }>; // hit boxes in the burrow
export function stationSignRect(id: ActivityId): { x: number; y: number; w: number; h: number }; // each station's name sign (hotkey caps sit on it)
export function drawWallBackdrop(ctx, opts?: { seed?: number; pebbles?: boolean }): void;      // the plain burrow wall (DRAGONS, DEX)
export function drawStation(ctx, id: ActivityId, t: number, opts?: { highlight?: boolean; busy?: boolean }): void;
export function drawTitleBackdrop(ctx, t: number): void;
export function drawMapBackdrop(ctx, loc: LocationDef, t: number): void;       // mission path screen
// fx.ts
export interface Fx {
  move(kind: FxKind, from: { x: number; y: number }, to: { x: number; y: number }, type: TypeId): void; // plays ~0.5-0.8 s
  burst(x: number, y: number, color: string, n?: number): void;
  floatText(x: number, y: number, text: string, color: string): void;
  shake(amount: number): void;
  update(dt: number): void; draw(ctx): void;
  readonly busy: boolean; readonly offsetX: number; readonly offsetY: number;
}
export function createFx(): Fx;
```

## src/audio (browser)

```ts
export type SfxName = 'click' | 'back' | 'select' | 'error' | 'hit' | 'hitSuper' | 'hitWeak' | 'miss' | 'crit' | 'faint'
  | 'heal' | 'levelUp' | 'statUp' | 'statDown' | 'status' | 'coin' | 'eat' | 'evolve' | 'swap' | 'dig' | 'wheel'
  | 'snore' | 'sparkle' | 'victory' | 'defeat' | 'boss' | 'fire' | 'water' | 'leaf' | 'spark' | 'quake' | 'wind'
  | 'ice' | 'goo' | 'shadow' | 'light' | 'cook' | 'metal' | 'psy' | 'punch' | 'rock' | 'fluff';
export type TrackName = 'title' | 'burrow' | 'mission' | 'battle' | 'boss' | 'victory';
export function sfx(name: SfxName): void;
export function music(name: TrackName | null): void;
export function moveSfx(type: TypeId): SfxName;
export function setSound(on: boolean): void; export function setMusic(on: boolean): void;
export function unlockAudio(): void;   // call from the first user gesture
```

## The debug / test surface (src/main.ts, browser)

`window.__game` is installed by index.html before the module graph loads (`ready`, `errors`) and
`api` is filled in by src/main.ts. tools/smoke.ts, tools/playtest.ts and tools/distcheck.ts drive the
real game through it.

```ts
window.__game.api = {
  state(): GameState; scene(): string | null; depth(): number;
  busy(): boolean;                       // a replace/reset fade is running (input is muted)
  step(n?: number): void;                // n fixed updates + 1 render
  run(on: boolean): boolean;             // stop / restart the real-time rAF loop (stopped: only step() advances)
  click(x: number, y: number): void;     // injected click in 640x360 game coordinates
  key(k: string): void;                  // injected key tap ('Enter', 'Escape', 'a', '1', ...)
  buttons(): LiveButton[];               // what the player could press after the latest update
  newGame(seed?, starters? | opts?, opts?: { skipTutorials?: boolean }): GameState;
  goto(name: keyof Nav, ...args): void;
  train(dragonId: string, level: number, evolve?: boolean, short?: number): { id; speciesId; level; moves };
                                         // real XP path (moves learned / auto-equipped), then evolve; `short` stops that many XP before `level`
  adopt(speciesId: SpeciesId, level: number): string;   // a new dragon joins the burrow; returns its id
  debug(): AppContext['debug']; errors(): string[];
};
// app.debug (scenes publish; the playtest reads and sets):
//   autoplay: boolean                                   the battle scene picks its own actions, 12x speed
//   intro    { phase(): 'talk'|'pick'|'react'|'leaving'; line(): number }
//   burrow   { mode(); dragon(id); station(activity) }  station centre to click
//   run      { phase(); node(): MissionNode['kind'] | null; index() }
//   battle   BattleState;  battleUi { menu(); busy(); text(); textDone(); focus(); levelCard(); outro(); banners(); time(); inject(evs) }
//   results  { stage(): 'report'|'evolving'|'reveal'|'leaving'; animating() }
//   evolution { evolved(); revealT(); t() }
```

