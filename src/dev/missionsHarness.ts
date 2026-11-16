// Dev harness for the mission screens (dev/missions.html): the mission board, the briefing + squad
// picker, the mission run (node trail) and the results screen, each on a throwaway test save.
//
// URL: ?scene=board|briefing|run|results &mission=<id> &progress=<missions cleared in campaign order>
//      &outcome=won|lost (results) &squad=tired|empty|full (briefing) &tutorial=1 (board)
//
// While src/data/missions.ts is still the one-mission stub, this page fills the tables with a
// believable 25-mission campaign BEFORE src/data/index.ts is evaluated (index.ts builds its lookup
// maps at load time), so the screens can be laid out against realistic content. Only the tables in
// missions.ts are touched, and only when they are the stub; nothing here ships.
import { MISSIONS, MISSION_TYPES, LOCATIONS } from '../data/missions.ts';
import { ORGS, VILLAINS } from '../data/villains.ts';
import { SPECIES } from '../data/species.ts';
import {
  MISSION_TYPE_IDS, ORG_IDS,
  type LocationId, type MissionDef, type MissionNode, type MissionTypeId, type OrgId, type VillainId,
} from '../data/schema.ts';

// ---------------------------------------------------------------------------------------------
// Mock campaign (only when the real one has not landed yet)
// ---------------------------------------------------------------------------------------------

function mockCampaign(): void {
  if (MISSIONS.length >= 25) return;
  Object.assign(MISSION_TYPES, {
    retrieve: { id: 'retrieve', name: 'Retrieve', description: 'Get the stolen thing back.', twist: 'A standard case, with a bonus item for your trouble.' },
    rescue: { id: 'rescue', name: 'Rescue', description: 'Free a captive.', twist: 'The dragon hamster you rescue joins your burrow!' },
    sabotage: { id: 'sabotage', name: 'Sabotage', description: 'Break the villain gadget.', twist: 'Rush the boss while his gadget powers him up, or fight an extra battle to cut the power first.' },
    infiltrate: { id: 'infiltrate', name: 'Infiltrate', description: 'Sneak in.', twist: 'No rest stops, but the enemy is fully scouted. +50% coins.' },
    defend: { id: 'defend', name: 'Defend', description: 'Hold the line.', twist: 'Waves of enemies who fight smart. A rest after wave 2.' },
  });
  Object.assign(LOCATIONS, {
    museum: { id: 'museum', name: 'Natural History Museum', description: 'Bones, gems and a very nervous night guard.', sky: '#c9b79a', far: '#a8916f', mid: '#8a6f55', floor: '#b49a7a', accent: '#b8323a' },
    docks: { id: 'docks', name: 'Moonlight Docks', description: 'Foggy piers and suspicious crates.', sky: '#14183a', far: '#22284d', mid: '#1d3f5e', floor: '#5a4632', accent: '#ffd36b' },
    zoo: { id: 'zoo', name: 'City Zoo', description: 'Penguins, peacocks and one very loud parrot.', sky: '#8fd3f4', far: '#4f9a5a', mid: '#7cbf5a', floor: '#d9c18e', accent: '#ff6f91' },
    tower: { id: 'tower', name: 'Sky Tower', description: 'The tallest building in town. Do not look down.', sky: '#3b2b6b', far: '#5a3f7a', mid: '#e0796b', floor: '#7a7488', accent: '#ffb347' },
    lab: { id: 'lab', name: 'Ferret Labs', description: 'Beakers, cables and blinking buttons.', sky: '#1e2b33', far: '#2f4450', mid: '#3d5866', floor: '#4a5560', accent: '#7dff7a' },
  });
  const bands: Record<OrgId, number[]> = {
    cheese: [5, 7, 9, 11, 14], crows: [13, 15, 17, 19, 22], snakes: [20, 22, 24, 26, 29],
    cats: [27, 29, 31, 33, 36], ferrets: [34, 36, 38, 41, 45],
  };
  const places: Record<OrgId, LocationId[]> = {
    cheese: ['museum', 'docks', 'museum', 'zoo', 'museum'],
    crows: ['docks', 'tower', 'docks', 'zoo', 'tower'],
    snakes: ['zoo', 'docks', 'zoo', 'museum', 'zoo'],
    cats: ['docks', 'museum', 'tower', 'docks', 'docks'],
    ferrets: ['lab', 'tower', 'lab', 'lab', 'lab'],
  };
  const titles: Record<OrgId, string[]> = {
    cheese: ['The Great Egg Heist', 'Squeak for Help', 'Fondue Fiasco', 'The Mouse Hole Lounge', 'Say Cheese!'],
    crows: ['Shiny Business', 'Bird in a Cage', 'The Glitter Cannon', 'Rooftop Rookery', 'Caw of the Wild'],
    snakes: ['Hiss and Tell', 'Toad Away', 'The Hypno Tower', 'Swamp Secrets', 'Sssshowdown'],
    cats: ['Purr-loined', 'Nine Lives Rescue', 'Hot Tin Roof', 'Alley Oops', 'Cat Got Your Tongue'],
    ferrets: ['Robot Butlers', 'Frozen Assets', 'The Big Zap', 'Lab Rats', 'Weasel Words'],
  };
  const objectives: Record<MissionTypeId, string> = {
    retrieve: 'Recover the dinosaur egg', rescue: 'Free the captured hamster', sabotage: 'Break the cheese cannon',
    infiltrate: 'Sneak into the secret lounge', defend: 'Protect the museum vault',
  };
  const pools: Record<OrgId, string[]> = {
    cheese: ['fuzzlet', 'tunneltot', 'crumbkin', 'triceratot'], crows: ['flitterbit', 'spookums', 'hamicorn'],
    snakes: ['blobbit', 'smartypaws', 'sproutling'], cats: ['scrappling', 'granitooth', 'emberpuff'],
    ferrets: ['clanklet', 'statickle', 'brrrito', 'puddlepaw'],
  };
  const crew = (org: OrgId, role: string): VillainId[] =>
    Object.values(VILLAINS).filter((v) => v.org === org && v.role === role).map((v) => v.id);
  const have = new Set(SPECIES.map((s) => s.id));
  const prev: string[] = [];
  ORG_IDS.forEach((org) => {
    const minions = crew(org, 'minion');
    const lt = crew(org, 'lieutenant')[0];
    const boss = ORGS[org].boss;
    MISSION_TYPE_IDS.forEach((type, i) => {
      const L = bands[org][i];
      const m = (k: number, dl = 0) => ({ villain: minions[k % minions.length], level: L + dl });
      const fight = (label: string, a: number, b?: number): MissionNode => ({
        kind: 'battle', label,
        encounter: { enemies: b === undefined ? [m(a)] : [m(a, -1), m(b, 1)], intro: `A ${VILLAINS[minions[a % minions.length]].name} blocks the way!` },
      });
      const rest: MissionNode = { kind: 'rest', label: 'Snack break', text: 'Your squad finds a quiet corner and shares a bag of sunflower seeds.', heal: 0.5 };
      const bossNode = (supercharge = false): MissionNode => ({
        kind: 'boss', label: i === 4 ? 'Final showdown' : 'Boss fight',
        encounter: { enemies: [{ villain: lt, level: L + 1 }, { villain: boss, level: L + 3 }], intro: `${VILLAINS[boss].name} steps out of the shadows, looking very pleased with himself.` },
        ...(supercharge ? { supercharge: { atk: 1, spa: 1 } } : {}),
      });
      const story: MissionNode = { kind: 'story', label: 'Arrival', text: 'Chief Nibbles crackles over the radio: "Stay sharp, agents. And no snacking on the job!"' };
      let nodes: MissionNode[];
      switch (type) {
        case 'retrieve': nodes = [story, fight('Front door', 0), fight('Gift shop', 1), fight('Back stairs', 2), rest, bossNode()]; break;
        case 'rescue': nodes = [fight('The gate', 1), fight('Feeding time', 2, 3), rest, fight('Cage block', 0), bossNode()]; break;
        case 'sabotage': nodes = [fight('Loading bay', 3), {
          kind: 'branch', label: 'The power switch', text: 'The cannon is humming. You can hear it charging up!',
          options: [
            { label: 'Rush the boss', description: 'Charge in now! The machine will power him up (+1 ATK and SP. ATK).', nodes: [rest, bossNode(true)] },
            { label: 'Cut the power', description: 'Fight past one more guard to pull the plug first.', nodes: [fight('Generator room', 2), rest, bossNode()] },
          ],
        }]; break;
        case 'infiltrate': nodes = [fight('Coat check', 0, 1), fight('Velvet rope', 2), bossNode()]; break;
        default: nodes = [fight('Wave 1', 0), fight('Wave 2', 1, 2), rest, fight('Wave 3', 3), fight('Wave 4', 0, 1), bossNode()]; break;
      }
      const id = `${org}-${i + 1}`;
      const def: MissionDef = {
        id, org, type, location: places[org][i], index: i + 1, title: titles[org][i],
        objective: objectives[type],
        briefing: `Agent, we have a situation. ${ORGS[org].name} has been spotted near the ${LOCATIONS[places[org][i]].name}. ` +
          'Our sources say they are up to something cheesy, and not in the fun way. ' +
          'Get in, sort it out, and be home in time for supper. Nibbles out!',
        level: L, nodes,
        rewards: {
          coins: 60 + L * 12,
          items: i % 2 ? [{ id: 'seedcake', qty: 2 }, { id: 'berries', qty: 3 }] : [{ id: 'cheese', qty: 2 }, { id: 'herbtea', qty: 1 }, { id: 'peppep', qty: 1 }],
          dragon: { species: pools[org].filter((s) => have.has(s)), chance: type === 'rescue' ? 1 : 0.3 },
        },
        requires: prev.length ? [prev[prev.length - 1]] : [],
        success: 'The crew scatters like crumbs in the wind. Chief Nibbles is so proud he does a little dance!',
      };
      prev.push(id);
      MISSIONS.push(def);
    });
  });
  MISSIONS.splice(0, MISSIONS.length - 25);
}

mockCampaign();

// ---------------------------------------------------------------------------------------------
// Boot (everything below loads index.ts, so it comes after the tables are filled)
// ---------------------------------------------------------------------------------------------

const { bootHarness } = await import('./harness.ts');
const { MISSIONS_IN_ORDER, getMission } = await import('../data/index.ts');
const missions = await import('../game/missions.ts');
const dragons = await import('../game/dragons.ts');
const { app } = await import('../ui/app.ts');
type GameState = import('../game/types.ts').GameState;

const q = new URLSearchParams(location.search);
const sceneName = q.get('scene') ?? 'board';
// only the screen under test is loaded, so a half-written sibling never breaks this page
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

bootHarness(() => makeScene(), { setup });
extra.mission = getMission(missionId).title;
(window as unknown as { __missions: unknown }).__missions = extra;
