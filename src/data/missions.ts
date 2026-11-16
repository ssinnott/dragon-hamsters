// The case files: the five mission types, the five locations and the 25 missions of the campaign,
// five per villain org in campaign order cheese -> crows -> snakes -> cats -> ferrets.
//
// How the missions are put together (docs/DESIGN.md "Missions"):
//   - Each org's arc uses every mission type once, in a different order per org (a 5x5 Latin
//     square, so every column differs too). Case 5 is the showdown where the boss is caught:
//        cheese   retrieve    rescue      sabotage    defend      infiltrate
//        crows    defend      infiltrate  retrieve    rescue      sabotage
//        snakes   sabotage    defend      infiltrate  retrieve    rescue
//        cats     rescue      sabotage    defend      infiltrate  retrieve
//        ferrets  infiltrate  retrieve    rescue      sabotage    defend
//   - Node shapes: retrieve = 3 battles, rest, boss. Rescue = 2 battles, rest, 1 battle, boss.
//     Sabotage = battle, branch, rest, boss. Infiltrate = 2 battles, boss, no rest. Defend = 4 waves
//     of 1-2 enemies, rest after wave 2, boss. A boss encounter is [lieutenant, boss], with a minion
//     in front in a few late cases.
//   - Sabotage branch: the boss node stays outside the branch (tools/contenttest.ts requires every
//     mission to end with its one boss node), and the branch can only splice nodes in before it, so
//     a route cannot change the boss node's `supercharge`. The routes are therefore "rush on" (a
//     story beat) or "cut the power" (one extra battle: more XP, training and villain coins).
//   - Levels: `level` is the design band for the org and case. Minions fight at the band -1..+1,
//     the lieutenant at +1 and the boss at +3. The first two cases use single-enemy battles (the
//     player has two level-5 starters); after that battles field 1-2 enemies.
//   - Rewards: 60 + 12 * level coins (src/game/missions.ts adds +50% for infiltrate), 2 foods or
//     items (3 for retrieve, its bonus, and for showdowns), and a dragon for every case:
//       * cheese-1 hatches the stolen dinosaur egg: Triceratot, chance 1.
//       * Rescue frees the captive named in the briefing (a pool of one, chance 1). Captives appear
//         in no other pool, so a rescue always brings a new dragon.
//       * Other cases have a themed pool of 2-4 first stages (chance 0.35, showdowns 0.4) that live
//         at that place and mostly counter the NEXT org's types, e.g. the cheese pools hold ROCK,
//         FROST, METAL, FLUFF and BRAWL dragons for the crows. Each starter appears in a mid-game
//         pool, so the one the player did not pick can still turn up. The two legendaries only
//         appear in the last two showdowns.
import type {
  EncounterSpec, FoodId, ItemId, LocationDef, LocationId, MissionDef, MissionNode, MissionTypeDef,
  MissionTypeId, OrgId, SpeciesId, VillainId,
} from './schema.ts';

// ---------------------------------------------------------------------------------------------
// Mission types
// ---------------------------------------------------------------------------------------------

export const MISSION_TYPES: Record<MissionTypeId, MissionTypeDef> = {
  retrieve: {
    id: 'retrieve',
    name: 'Retrieve',
    description: 'Something precious has been pinched. Fight your way in, grab it back and bring it home.',
    twist: 'Three battles, a snack break, then the boss. Bring the loot home for a bonus item reward!',
  },
  rescue: {
    id: 'rescue',
    name: 'Rescue',
    description: 'A dragon hamster has been dragon-napped! Break in, free the captive and get everyone out safe.',
    twist: 'The dragon you free joins your burrow for sure! Two battles, a snack break, one more battle, then the boss.',
  },
  sabotage: {
    id: 'sabotage',
    name: 'Sabotage',
    description: 'The villains have built a terrible gadget. Get to it and switch it off for good.',
    twist: 'Halfway in, pick a route: rush on to the boss, or fight one extra battle to cut the power for more XP and coins.',
  },
  infiltrate: {
    id: 'infiltrate',
    name: 'Infiltrate',
    description: "Sneak deep into the villains' hideout, past the guards, all the way to the boss.",
    twist: 'No snack breaks, but every guard has been scouted in advance, and sneaky agents earn +50% coins.',
  },
  defend: {
    id: 'defend',
    name: 'Defend',
    description: 'The villains are coming for something we must protect. Hold the line, wave after wave!',
    twist: 'Four waves of 1-2 tough, clever enemies, with a snack break after wave 2. Then the boss comes in person.',
  },
};

// ---------------------------------------------------------------------------------------------
// Locations (backdrop colours far to near; src/art/backdrops.ts mixes its materials toward them)
// ---------------------------------------------------------------------------------------------

export const LOCATIONS: Record<LocationId, LocationDef> = {
  museum: {
    id: 'museum',
    name: 'Natural History Museum',
    description: 'Marble halls full of dinosaur bones, glittering gems and dusty treasures. After dark, every statue seems to be watching you.',
    // Warm sandstone walls, honey marble, polished parquet and red velvet banners.
    sky: '#c9b79a', far: '#a8916f', mid: '#8a6f55', floor: '#b49a7a', accent: '#b8323a',
  },
  docks: {
    id: 'docks',
    name: 'Moonlight Docks',
    description: 'Creaky piers, foggy warehouses and stacks of fishy crates under a big silver moon. If something is being smuggled, it goes through here.',
    // Deep night blue, an inky skyline, dark harbour water, tarred planks and warm lamplight.
    sky: '#14183a', far: '#22284d', mid: '#1d3f5e', floor: '#5a4632', accent: '#ffd36b',
  },
  zoo: {
    id: 'zoo',
    name: 'City Zoo',
    description: 'Penguins, elephants, a petting farm and a boating lake, all behind one very squeaky gate. The monkeys see everything, but they never tell.',
    // Bright summer sky, leafy trees, fresh grass, a sandy path and pink balloons.
    sky: '#8fd3f4', far: '#4f9a5a', mid: '#7cbf5a', floor: '#d9c18e', accent: '#ff6f91',
  },
  tower: {
    id: 'tower',
    name: 'Sky Tower',
    description: 'The tallest building in the city, with a sky cafe, a rooftop garden and a giant antenna on top. Try not to look down.',
    // A violet sunset over the rooftops, coral clouds, grey concrete and golden beacon lights.
    sky: '#3b2b6b', far: '#5a3f7a', mid: '#e0796b', floor: '#7a7488', accent: '#ffb347',
  },
  lab: {
    id: 'lab',
    name: 'Ferret Labs',
    description: 'A gleaming maze of beakers, cables, blinking buttons and robot arms. Everything hums, and some of it bites.',
    // Dark teal steel, cool pipework, a scuffed grey floor and bubbling green goo.
    sky: '#1e2b33', far: '#2f4450', mid: '#3d5866', floor: '#4a5560', accent: '#7dff7a',
  },
};

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

/** Average enemy level per case 1..5 (the design bands). */
const BANDS: Record<OrgId, readonly number[]> = {
  cheese: [5, 7, 9, 11, 14],
  crows: [13, 15, 17, 19, 22],
  snakes: [20, 22, 24, 26, 29],
  cats: [27, 29, 31, 33, 36],
  ferrets: [34, 36, 38, 41, 45],
};

/** Each org's lieutenant and boss (src/data/villains.ts). */
const LEADERS: Record<OrgId, { lieutenant: VillainId; boss: VillainId }> = {
  cheese: { lieutenant: 'vinnie-grater', boss: 'big-cheese' },
  crows: { lieutenant: 'duchess-dazzle', boss: 'godfeather' },
  snakes: { lieutenant: 'captain-croak', boss: 'baron-von-hiss' },
  cats: { lieutenant: 'clawdia-crush', boss: 'don-whiskerino' },
  ferrets: { lieutenant: 'icegor', boss: 'dr-ferretstein' },
};

/** Rest stops heal this fraction of max HP; the first two cases heal fully while the squad is small. */
const REST_HEAL = 0.5;
const FULL_HEAL = 1;
/** Chance to recruit from a themed pool; showdowns are a little more generous. */
const POOL_CHANCE = 0.35;
const SHOWDOWN_CHANCE = 0.4;

type Enemy = EncounterSpec['enemies'][number];
type Offset = -1 | 0 | 1;
type Reward = { id: ItemId | FoodId; qty: number };

/** One route of a sabotage branch. */
interface Route { label: string; description: string; nodes: MissionNode[] }

/** Node builders bound to one mission's org and level band. */
interface Kit {
  /** A minion at the band level plus `d`. */
  m(villain: VillainId, d?: Offset): Enemy;
  battle(label: string, intro: string, ...enemies: Enemy[]): MissionNode;
  /** The showdown encounter: any minions given go first, then the lieutenant (+1) and the boss (+3). */
  boss(label: string, intro: string, ...minions: Enemy[]): MissionNode;
  rest(label: string, text: string, heal?: number): MissionNode;
  story(label: string, text: string): MissionNode;
  /** A sabotage crossroads: rush on (a story beat) or cut the power (one more battle). */
  branch(label: string, text: string, rush: Route, cut: Route): MissionNode;
}

function kit(org: OrgId, level: number): Kit {
  const { lieutenant, boss } = LEADERS[org];
  return {
    m: (villain, d = 0) => ({ villain, level: level + d }),
    battle: (label, intro, ...enemies) => ({ kind: 'battle', label, encounter: { enemies, intro } }),
    boss: (label, intro, ...minions) => ({
      kind: 'boss', label,
      encounter: { enemies: [...minions, { villain: lieutenant, level: level + 1 }, { villain: boss, level: level + 3 }], intro },
    }),
    rest: (label, text, heal = REST_HEAL) => ({ kind: 'rest', label, text, heal }),
    story: (label, text) => ({ kind: 'story', label, text }),
    branch: (label, text, rush, cut) => ({ kind: 'branch', label, text, options: [rush, cut] }),
  };
}

const item = (id: ItemId | FoodId, qty: number): Reward => ({ id, qty });

interface CaseFile {
  org: OrgId;
  index: number;
  type: MissionTypeId;
  location: LocationId;
  title: string;
  objective: string;
  briefing: string;
  path: (k: Kit) => MissionNode[];
  items: Reward[];
  dragons: SpeciesId[];
  /** Defaults: 1 for a rescue, SHOWDOWN_CHANCE for case 5, POOL_CHANCE otherwise. */
  chance?: number;
  success: string;
}

/** Turn the case files (in campaign order) into MissionDefs: ids, levels, coins and unlocks. */
function build(files: CaseFile[]): MissionDef[] {
  return files.map((f, i) => {
    const level = BANDS[f.org][f.index - 1];
    const chance = f.chance ?? (f.type === 'rescue' ? 1 : f.index === 5 ? SHOWDOWN_CHANCE : POOL_CHANCE);
    const prev = files[i - 1];
    return {
      id: `${f.org}-${f.index}`,
      org: f.org,
      type: f.type,
      location: f.location,
      index: f.index,
      title: f.title,
      objective: f.objective,
      briefing: f.briefing,
      level,
      nodes: f.path(kit(f.org, level)),
      rewards: { coins: 60 + 12 * level, items: f.items, dragon: { species: f.dragons, chance } },
      requires: prev ? [`${prev.org}-${prev.index}`] : [],
      success: f.success,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// The case files, in campaign order
// ---------------------------------------------------------------------------------------------

const CASES: CaseFile[] = [
  // ==== THE BIG CHEESE'S CREW (FLUFF / COOKING / EARTH) ======================================
  {
    org: 'cheese', index: 1, type: 'retrieve', location: 'museum',
    title: 'The Great Egg Heist',
    objective: 'Recover the dinosaur egg',
    briefing:
      'Welcome to the Agency, agent. Last night someone tunnelled into the Natural History Museum and pinched its greatest treasure: a dinosaur egg, millions of years old. ' +
      'The tunnel smells of cheddar, so it has to be the Big Cheese and his crew. ' +
      "Our spies say he wants that egg for the world's biggest omelette! " +
      'Get in there and get it back before he finds a big enough frying pan.',
    path: (k) => [
      k.story('Museum steps',
        'Chief Nibbles crackles over the radio: "Follow the trail of cracker crumbs, agent. And check your types: a move marked SUPER hits twice as hard!"'),
      k.battle('Fossil hall',
        'A Crumb Snatcher is licking the glass of the trilobite case. It spins round, cheeks stuffed with crackers.',
        k.m('crumb-snatcher', -1)),
      k.battle('Gem gallery',
        'The floor bulges, cracks and pops. A Tunnel Rat in a hard hat pokes its head up between two very surprised sapphires.',
        k.m('tunnel-rat')),
      k.battle('Museum cafe',
        'The museum cafe smells of hot cheese. The Fondue Flinger is greasing a frying pan the size of a paddling pool.',
        k.m('fondue-flinger')),
      k.rest('Gift shop',
        'You hide behind a rack of dinosaur plushies and share a bag of sunflower seeds. Everyone feels ready for anything.', FULL_HEAL),
      k.boss('Dinosaur hall',
        `Under the great T-rex skeleton, the Big Cheese is polishing the egg with his hanky. Vinnie Grater steps in front of him. "Boss, we got company. Want me to grate 'em?"`),
    ],
    items: [item('seedcake', 2), item('berries', 2), item('herbtea', 1)],
    dragons: ['triceratot'],
    chance: 1,
    success:
      "You snatched the egg right out from under the Big Cheese's nose! He squeezed down a mouse hole, squeaking that he would have his omelette yet. " +
      'The curator was so grateful that she asked the agency to look after the egg, and just as you got it home, it went crack...',
  },
  {
    org: 'cheese', index: 2, type: 'rescue', location: 'docks',
    title: 'The Cheesecake Caper',
    objective: 'Rescue the kidnapped Crumbkin',
    briefing:
      "Bad news, agent. With no egg for his omelette, the Big Cheese has moved on to plan B: the world's biggest cheesecake. " +
      'He has kidnapped a Crumbkin, the best little baker in town, and locked it in the galley of a cheese barge at the Moonlight Docks. ' +
      "If we don't get it out, that poor thing will be whisking until next Tuesday. Bring it home safe!",
    path: (k) => [
      k.battle('Fish market',
        'Behind the fish market, a Crumb Snatcher is stuffing fish fingers into its cheeks. It drops one when it sees you.',
        k.m('crumb-snatcher', -1)),
      k.battle('Gangplank',
        'Something round and furry is snoring across the gangplank of the cheese barge. Nobody gets past the Doormouse, mostly because nobody can wake him up.',
        k.m('doormouse')),
      k.rest('Rope locker',
        'You hide in the rope locker and nibble a seed. From somewhere below deck comes the sound of a tiny, very tired whisk.', FULL_HEAL),
      k.battle('Barge deck',
        'The Fondue Flinger is stirring a bathtub of cream cheese on deck. It looks up, ladle dripping.',
        k.m('fondue-flinger', 1)),
      k.boss('The galley',
        'In the galley, the Crumbkin is tied to a giant whisk while the Big Cheese licks a mixing spoon. Vinnie Grater cracks his knuckles. "Not you again!"'),
    ],
    items: [item('cheese', 2), item('seedcake', 1)],
    dragons: ['crumbkin'],
    success:
      'You untied the Crumbkin, and it baked your whole squad a thank-you biscuit on the spot. ' +
      'The Big Cheese escaped on a raft made from a giant cracker, yelling that you had ruined his cheesecake. ' +
      'The Crumbkin has asked to join the agency so it can bake for the whole burrow.',
  },
  {
    org: 'cheese', index: 3, type: 'sabotage', location: 'zoo',
    title: 'Melt-o-Matic Mayhem',
    objective: 'Switch off the Cheese Ray',
    briefing:
      'Agent, the Big Cheese has built a giant Cheese Ray called the Melt-o-Matic, and he has pointed it at the boating lake at the City Zoo. ' +
      'One zap and the whole lake turns into bubbling fondue, ducks and all. He plans to dip every cracker in the city in it. ' +
      'Get to that ray and switch it off before the flamingos get cheesy!',
    path: (k) => [
      k.battle('Zoo gates',
        'Two mice in a zebra costume are blocking the zoo gates. The front half is a Crumb Snatcher. The back half is a very cross Tunnel Rat.',
        k.m('crumb-snatcher', -1), k.m('tunnel-rat')),
      k.branch('Ray cable',
        'The Melt-o-Matic is humming on the lakeshore. Its power cable runs to a fuse box, and two of the crew are guarding it.',
        {
          label: 'Rush the lake',
          description: 'Dash past the guards, straight to the Cheese Ray and the boss. Quicker, but less XP.',
          nodes: [k.story('Duck dash', 'You sneak past the fuse box behind a family of ducks. The ducks do not seem to mind.')],
        },
        {
          label: 'Cut the power',
          description: 'Fight the fuse box guards and pull the plug. One more battle for more XP and coins.',
          nodes: [k.battle('Fuse box',
            'The Fondue Flinger is guarding the fuse box. The Doormouse is guarding it too, by sleeping on top of it.',
            k.m('fondue-flinger'), k.m('doormouse', 1))],
        }),
      k.rest('Penguin pool', 'The penguins let you rest by their pool and share their ice cubes. Very refreshing.'),
      k.boss('Lakeshore',
        `The Big Cheese sits in the Melt-o-Matic's driving seat with a fondue fork in one paw. Vinnie Grater rolls up his sleeves. "Leave this one to me, boss."`),
    ],
    items: [item('carrot', 2), item('herbtea', 1)],
    dragons: ['fuzzlet', 'blobbit', 'flitterbit'],
    success:
      'You yanked the big red lever, and the Melt-o-Matic fizzled out with a sad little pfft. ' +
      'The Big Cheese paddled away on a giant rubber duck, shaking his fist at you. The flamingos have asked for your autograph.',
  },
  {
    org: 'cheese', index: 4, type: 'defend', location: 'tower',
    title: 'The Royal Cheddar',
    objective: 'Guard the Royal Wheel of Cheddar',
    briefing:
      "Agent, it's the Grand Cheese Festival, and the Royal Wheel of Cheddar is on show at the top of the Sky Tower. " +
      "It's the biggest cheese in the world, and you can guess who wants it. " +
      'Our spies say the whole crew is coming tonight with ladders, ropes and a very big fork. ' +
      'Hold the line, wave after wave. That cheese belongs to everyone!',
    path: (k) => [
      k.battle('Wave 1',
        'Here they come! A Crumb Snatcher swings in through the window on a string of sausages.',
        k.m('crumb-snatcher', -1)),
      k.battle('Wave 2',
        'A Tunnel Rat drills up through the floor, and a Fondue Flinger climbs out after it carrying a pot of hot cheese.',
        k.m('tunnel-rat'), k.m('fondue-flinger')),
      k.rest('Viewing deck', 'A quick breather by the big windows. The whole city twinkles below, and the cheese smells amazing.'),
      k.battle('Wave 3',
        'The lift doors open, and the Doormouse sleepwalks out in his pyjamas with his fists up. He seems to be fighting in his sleep.',
        k.m('doormouse', 1)),
      k.battle('Wave 4',
        'The last wave! A Crumb Snatcher and a Tunnel Rat are trying to roll the cheese away on a skateboard.',
        k.m('crumb-snatcher'), k.m('tunnel-rat', 1)),
      k.boss('Cheese stage',
        'A helicopter shaped like a cheese grater lands on the roof. Out step Vinnie Grater and the Big Cheese himself, wearing his best bib and holding a knife and fork.'),
    ],
    items: [item('cheese', 2), item('seedcake', 2)],
    dragons: ['brrrito', 'scrappling', 'flitterbit'],
    success:
      'The Royal Wheel of Cheddar is safe! The Big Cheese clung to his grater-copter as it wobbled off into the night, wailing that he could still smell it. ' +
      'The festival crowd gave your squad a standing ovation and a slice each.',
  },
  {
    org: 'cheese', index: 5, type: 'infiltrate', location: 'museum',
    title: 'The Mouse Hole Lounge',
    objective: 'Catch the Big Cheese',
    briefing:
      "This is it, agent. We've found the crew's hideout: the Mouse Hole Lounge, a velvet club hidden behind the skirting board of the Natural History Museum. " +
      "Our scouts have listed every guard inside, so you'll know exactly who to bring. " +
      'Squeeze in, get past the bouncer and catch the Big Cheese before he cooks up another scheme. ' +
      "Stay sneaky: there's no time for snack breaks on this one!",
    path: (k) => [
      k.battle('Skirting board',
        'Behind a crack in the skirting board, a Tunnel Rat and a Crumb Snatcher are playing cards, using crackers as chips.',
        k.m('tunnel-rat', -1), k.m('crumb-snatcher')),
      k.battle('Velvet rope',
        'A velvet rope, a red carpet and one enormous sleepy bouncer. The Doormouse lifts his sunglasses and blinks at you.',
        k.m('doormouse', 1)),
      k.boss('The lounge',
        'The Big Cheese is lounging on a sofa made of crackers, sipping a milkshake. He chokes on his straw when he sees you. Vinnie Grater sighs and picks up his grater.'),
    ],
    items: [item('cheese', 3), item('peppep', 1), item('spicybiscuit', 1)],
    dragons: ['granitooth', 'clanklet', 'spookums'],
    success:
      'Gotcha! The Big Cheese tried to hide inside his own hat, but it smelled far too tasty to fool anyone. ' +
      "He's under arrest, and the Big Cheese Crew is disbanded! The Mouse Hole Lounge is now a cafe for retired museum mice. " +
      'But in his pocket you found a note, signed with a single black feather...',
  },

  // ==== CAW-SA NOSTRA (WINGED / DARKNESS / LIGHT) ============================================
  {
    org: 'crows', index: 1, type: 'defend', location: 'museum',
    title: 'The Sapphire Squeaker',
    objective: 'Guard the crown jewels till dawn',
    briefing:
      'Agent, that black feather belongs to Caw-sa Nostra, a flock of crows who steal anything shiny. ' +
      'Tonight the crown jewels are on show at the Natural History Museum, including the Sapphire Squeaker, a royal gem that squeaks if anyone touches it. ' +
      'The crows are coming for it, wave after wave. ' +
      "Hold the jewel room until dawn, and don't let a single beak through that skylight!",
    path: (k) => [
      k.battle('Wave 1',
        'Tap, tap, tap. A Stool Pigeon in a trenchcoat is pecking at the skylight, pretending to be a very large raindrop.',
        k.m('stool-pigeon', -1)),
      k.battle('Wave 2',
        'The lights go out and a mirror ball drops from the ceiling. While a Disco Pigeon boogies, a Crowbar Crook creeps towards the jewel case.',
        k.m('crowbar-crook'), k.m('disco-pigeon', -1)),
      k.rest('Coat room',
        'You catch your breath in the coat room. Chief Nibbles radios: "Halfway to dawn, agent. Eat a seed and keep your eyes on that skylight!"'),
      k.battle('Wave 3',
        'A Two-Tone Magpie lands on the jewel case and says sorry. Then it tries to open the case anyway.',
        k.m('two-tone-magpie', 1)),
      k.battle('Wave 4',
        'The sky is getting lighter. One last swoop: a Stool Pigeon and a Crowbar Crook dive through the skylight together.',
        k.m('stool-pigeon'), k.m('crowbar-crook', 1)),
      k.boss('Jewel room',
        'With a swish of velvet, Duchess Dazzle lands on top of the crown. Behind her, a big old crow steps out of the shadows. It is the Godfeather himself, and he is smiling at the Sapphire Squeaker.'),
    ],
    items: [item('berries', 2), item('seedcake', 2)],
    dragons: ['spookums', 'smartypaws', 'granitooth'],
    success:
      'Dawn breaks, and the Sapphire Squeaker is still squeaking safely in its case. ' +
      'The Godfeather flapped away over the rooftops, promising softly that he would have it next time. ' +
      'The royal jewel keeper sent the agency a thank-you card with real glitter on it.',
  },
  {
    org: 'crows', index: 2, type: 'infiltrate', location: 'docks',
    title: 'The Shiny Things Auction',
    objective: "Crash the crows' secret auction",
    briefing:
      'Agent, every stolen spoon, key and earring in the city ends up in one place: a secret auction in a warehouse at the Moonlight Docks. ' +
      'Caw-sa Nostra sells the loot to the highest bidder, and tonight the Godfeather himself is running the show. ' +
      'Our scouts have listed every guard on the doors, so pick your squad wisely. ' +
      'Sneak in, crash that auction and give the city its shiny things back!',
    path: (k) => [
      k.battle('Loading bay',
        'Two lookouts guard the loading bay. The Stool Pigeon is hiding behind a newspaper with eye holes cut in it. Very subtle.',
        k.m('stool-pigeon', -1), k.m('two-tone-magpie')),
      k.battle('Back door',
        'A Crowbar Crook is checking invitations at the back door. It takes one look at your fake moustaches and reaches for its crowbar.',
        k.m('crowbar-crook', 1)),
      k.boss('Auction floor',
        'The auction is in full swing. Duchess Dazzle is showing off a stolen crown, and the bidders gasp. Then the Godfeather bangs his gavel and points it straight at you.'),
    ],
    items: [item('carrot', 3), item('herbtea', 2)],
    dragons: ['blobbit', 'brrrito', 'scrappling'],
    success:
      'You crashed the auction, and every stolen trinket went straight back to its owner. ' +
      'The Godfeather swept out through a skylight, murmuring that you had cost him a fortune. The docks have never been so shiny.',
  },
  {
    org: 'crows', index: 3, type: 'retrieve', location: 'zoo',
    title: "The Zookeeper's Keys",
    objective: "Get back the zoo's golden key ring",
    briefing:
      'Agent, Caw-sa Nostra has swiped the golden key ring from the City Zoo, every single key, just because they were shiny. ' +
      "Now the zookeepers can't open a single cage, and the animals are missing breakfast. " +
      'The elephants are sulking and the monkeys are writing very angry letters. ' +
      'Get those keys back before lunchtime, or nobody at the zoo will ever stop complaining!',
    path: (k) => [
      k.battle('Ticket booth',
        'A Disco Pigeon has taken over the ticket booth and is selling tickets to its own dance show. Nobody is buying.',
        k.m('disco-pigeon', -1)),
      k.battle('Monkey house',
        'A Crowbar Crook is trying stolen keys in the monkey house door, one by one. A Stool Pigeon holds the torch, and the monkeys are cheering them on.',
        k.m('crowbar-crook'), k.m('stool-pigeon', -1)),
      k.battle('Bird garden',
        'In the bird garden, a Two-Tone Magpie is hanging zoo keys on a tree like baubles. It apologises to every branch.',
        k.m('two-tone-magpie', 1)),
      k.rest('Picnic lawn', 'You take a snack break on the picnic lawn. A kind old tortoise shares its lettuce, very, very slowly.'),
      k.boss('Big aviary',
        'At the top of the big aviary, the Godfeather sits on a nest made of keys. Duchess Dazzle is wearing the golden key ring as a necklace, and it really suits her.'),
    ],
    items: [item('berries', 2), item('seedcake', 2), item('spicybiscuit', 1)],
    dragons: ['flitterbit', 'fuzzlet', 'emberpuff'],
    success:
      'You got the golden key ring back, and breakfast was served at last. ' +
      'The Godfeather flapped off with one tiny key in his beak, croaking that you could keep the rest for now. ' +
      'The elephants have stopped sulking. Mostly.',
  },
  {
    org: 'crows', index: 4, type: 'rescue', location: 'tower',
    title: 'A Light in the Tower',
    objective: 'Free the caged Glimmerwing',
    briefing:
      'Agent, the crows have done something truly rotten. ' +
      'They caught a Glimmerwing, a sweet little lantern dragon, and locked it in a birdcage at the top of the Sky Tower to light up their nest. ' +
      'Its tail glows a little fainter every night, because it misses its streetlamps. ' +
      'Climb that tower, open that cage and bring it home. The Agency never leaves anyone in the dark!',
    path: (k) => [
      k.battle('Lobby',
        'Two pigeons in borrowed uniforms are pretending to be lift attendants. They have pressed every button at once.',
        k.m('stool-pigeon', -1), k.m('disco-pigeon')),
      k.battle('Stairwell',
        'The lift is jammed, so you take the stairs. All 300 of them. A Crowbar Crook is waiting on the landing, swinging its crowbar.',
        k.m('crowbar-crook')),
      k.rest('Rooftop garden',
        'Halfway up, you rest in the rooftop garden. High above, a tiny golden light is blinking in a cage. Hang on, little one!'),
      k.battle('Antenna ladder',
        'A Two-Tone Magpie and a Crowbar Crook block the antenna ladder. The magpie says sorry for being in the way, but it does not move an inch.',
        k.m('two-tone-magpie', 1), k.m('crowbar-crook')),
      k.boss('The Rookery',
        'You climb into the Rookery, a huge nest of stolen spoons and keys. The caged Glimmerwing flickers hopefully as the Godfeather turns, very slowly, to face you.'),
    ],
    items: [item('seedcake', 2), item('peppep', 1)],
    dragons: ['glimmerwing'],
    success:
      'You opened the cage, and the Glimmerwing lit up like a firework. ' +
      'The Godfeather flew off into the night, muttering that he had plans for something much shinier: the moon. ' +
      "The Glimmerwing has decided to be your burrow's night light.",
  },
  {
    org: 'crows', index: 5, type: 'sabotage', location: 'tower',
    title: 'The Moon Magnet',
    objective: 'Stop the Moon Magnet',
    briefing:
      'This is it, agent. The Godfeather has bolted a giant Moon Magnet to the top of the Sky Tower, and tonight he plans to pull down the moon itself, the shiniest thing in the sky. ' +
      'If he does, the tides will go wonky, the owls will get lost and every bedtime story will be ruined. ' +
      "Stop that magnet, catch the Godfeather and clip Caw-sa Nostra's wings for good!",
    path: (k) => [
      k.battle('Tower gates',
        'The whole flock is out tonight. A Crowbar Crook and a Disco Pigeon are keeping watch at the tower gates, and the moon is already wobbling.',
        k.m('crowbar-crook', -1), k.m('disco-pigeon')),
      k.branch('Magnet cable',
        'The Moon Magnet is humming louder and louder. Its power cable runs down to a fuse room, guarded by two of the flock.',
        {
          label: 'Rush the roof',
          description: 'No time to lose! Race up the fire escape to the Godfeather. Quicker, but less XP.',
          nodes: [k.story('Fire escape',
            'You race up the fire escape three steps at a time. The moon looks very, very close now, and rather worried.')],
        },
        {
          label: 'Cut the power',
          description: 'Fight the fuse room guards and pull the plug. One more battle for more XP and coins.',
          nodes: [k.battle('Fuse room',
            'In the fuse room, a Two-Tone Magpie is guarding the big switch. A Stool Pigeon is guarding the Two-Tone Magpie.',
            k.m('two-tone-magpie'), k.m('stool-pigeon', 1))],
        }),
      k.rest('Water tank', 'You catch your breath behind the rooftop water tank. Just one more ladder to go.'),
      k.boss('Moon Magnet',
        'On the roof, the Godfeather stands at the controls of the Moon Magnet, his feathers silver in the moonlight. Duchess Dazzle fluffs her cape. "Darling, you are just in time to watch."'),
    ],
    items: [item('dragonfruit', 1), item('royalcake', 1), item('seedcake', 2)],
    dragons: ['smartypaws', 'spookums', 'flitterbit'],
    success:
      'You knocked the Moon Magnet off its stand, and the moon bobbed back into place with a happy wobble. ' +
      'The Godfeather got tangled in his own stolen necklaces, and Caw-sa Nostra is disbanded! Every shiny thing is going home. ' +
      'In the Rookery you found a gooey green business card. It says: THE SSSYNDICATE. WE SSSEE YOU.',
  },

  // ==== THE SSSYNDICATE (SLIME / MIND / LEAF) ================================================
  {
    org: 'snakes', index: 1, type: 'sabotage', location: 'zoo',
    title: 'You Are Getting Sleepy',
    objective: 'Stop the giant Hypno-Spiral',
    briefing:
      'Agent, meet the Sssyndicate: snakes, toads and lizards who hypnotise, swindle and smuggle. ' +
      'Their boss, Baron Von Hiss, has hidden a giant Hypno-Spiral behind the sea lion stadium at the City Zoo. ' +
      'At the noon show it will start spinning, and every visitor will hand him their pocket money and their sandwiches. ' +
      "Shut it down, agent, and whatever you do, don't stare at the spiral!",
    path: (k) => [
      k.battle('Hedge maze',
        'The zoo hedge maze is quiet. Too quiet. One of the hedges has a tail, and one of the potted ferns is wearing sunglasses.',
        k.m('hedge-hisser', -1), k.m('chameleon-con')),
      k.branch('Spiral cable',
        'Behind the stadium, the Hypno-Spiral is already turning. A thick cable runs from it to a generator in the reptile house.',
        {
          label: 'Rush the stadium',
          description: 'Shut your eyes and run straight to the Baron. Quicker, but less XP.',
          nodes: [k.story('Eyes shut!',
            'You run through the stadium with your eyes squeezed shut, following the smell of fish to the stage. It works, mostly.')],
        },
        {
          label: 'Cut the power',
          description: 'Fight the reptile house guards and pull the plug. One more battle for more XP and coins.',
          nodes: [k.battle('Reptile house',
            'A Pendulum Python is guarding the generator, swinging its watch at a Swamp Smuggler, who is already fast asleep. Then the python spots you.',
            k.m('pendulum-python', 1), k.m('swamp-smuggler'))],
        }),
      k.rest('Sea lion pool', 'The sea lions give your squad a round of applause and a fish each. You politely eat sunflower seeds instead.'),
      k.boss('Stadium stage',
        'On stage, Baron Von Hiss swirls his cape in front of the spinning spiral. Captain Croak hops forward, his cheeks bulging with stolen sandwiches.'),
    ],
    items: [item('carrot', 2), item('herbtea', 2)],
    dragons: ['sproutling', 'scrappling', 'flitterbit'],
    success:
      'You jammed the Hypno-Spiral with a beach ball, and everybody woke up feeling a bit silly. ' +
      'Baron Von Hiss vanished in a puff of purple smoke, hissing that it had been his best trick yet. ' +
      'The sea lions now put on a show about you.',
  },
  {
    org: 'snakes', index: 2, type: 'defend', location: 'museum',
    title: 'The Eye of the Serpent',
    objective: 'Protect the Eye of the Serpent',
    briefing:
      'Agent, the Natural History Museum has a gem called the Eye of the Serpent, a swirly green opal as big as a melon. ' +
      'Legend says anyone who swings it on a chain can hypnotise a whole city, and Baron Von Hiss has read the legend. ' +
      'The Sssyndicate is sliding into the museum tonight, wave after wave. ' +
      'Guard that gem, and if anyone says look into my eyes, look at your paws!',
    path: (k) => [
      k.battle('Wave 1',
        'A Swamp Smuggler oozes up through a drain in the gem hall, leaving a long and very sticky trail.',
        k.m('swamp-smuggler', -1)),
      k.battle('Wave 2',
        'A new tour guide arrives with one very leafy tourist. The guide is a Chameleon Con. The tourist is a Hedge Hisser in a sun hat.',
        k.m('chameleon-con'), k.m('hedge-hisser', -1)),
      k.rest('Mummy room',
        'You catch your breath in the mummy room. One of the mummies seems to be offering you a seed. You decide not to ask.'),
      k.battle('Wave 3',
        'A Pendulum Python slithers in, swinging its watch at the security cameras. Two of them are already snoring.',
        k.m('pendulum-python', 1)),
      k.battle('Wave 4',
        'The last wave! A Swamp Smuggler is wearing a Chameleon Con as a disguise. Or maybe it is the other way round.',
        k.m('swamp-smuggler'), k.m('chameleon-con', 1)),
      k.boss('Gem hall',
        'The lights dim and a spotlight snaps on. Baron Von Hiss rises out of a giant top hat, and Captain Croak plays a drumroll on his own belly.'),
    ],
    items: [item('seedcake', 3), item('berries', 2)],
    dragons: ['granitooth', 'hamicorn', 'spookums'],
    success:
      'The Eye of the Serpent is safe, and the only one hypnotised tonight was the Baron, by his own reflection in the gem. ' +
      'He slithered off into an air vent, hissing that this was not over. The museum has made your squad honorary night guards.',
  },
  {
    org: 'snakes', index: 3, type: 'infiltrate', location: 'lab',
    title: 'Deal at Ferret Labs',
    objective: 'Stop the Hypno-Ray deal',
    briefing:
      "Agent, Baron Von Hiss has booked a meeting at Ferret Labs, a gadget shop where the city's crooks do their shopping. " +
      "He's buying a Hypno-Ray, a gadget that could put the whole city to sleep at once. " +
      'Our scouts have listed every snake on his guard, so choose your squad carefully. ' +
      "Sneak in, break up that deal, and let's find out who these ferret scientists really are.",
    path: (k) => [
      k.battle('Car park',
        'In the lab car park, a Chameleon Con is disguised as a parking meter. It is not a very good parking meter.',
        k.m('chameleon-con', -1), k.m('swamp-smuggler')),
      k.battle('Showroom',
        "The gadget showroom is full of freeze rays and robot butlers. A Pendulum Python and a Hedge Hisser are guarding the Baron's shopping trolley.",
        k.m('pendulum-python', 1), k.m('hedge-hisser')),
      k.boss('Test chamber',
        'In the test chamber, Baron Von Hiss is counting coins into a ferret-shaped piggy bank. The Hypno-Ray sits on a velvet cushion, gift-wrapped with a bow.'),
    ],
    items: [item('spicybiscuit', 1), item('berries', 2)],
    dragons: ['clanklet', 'smartypaws', 'brrrito'],
    success:
      'You smashed the Hypno-Ray, and the Baron slipped away through the air vents, hissing that he had paid extra for the bow. ' +
      'The ferret scientists hid behind their clipboards and said nothing. One of them was taking notes about you.',
  },
  {
    org: 'snakes', index: 4, type: 'retrieve', location: 'docks',
    title: 'Penguins Overboard',
    objective: 'Bring back the baby penguins',
    briefing:
      "Agent, this is serious. The Sssyndicate hypnotised the zookeepers and smuggled all six of the City Zoo's baby penguins out in a laundry basket! " +
      'Captain Croak is loading them onto his lily-pad raft at the Moonlight Docks, to sell them to a rich collector across the sea. ' +
      'Get down there and bring those chicks home. Their parents are counting on you!',
    path: (k) => [
      k.battle('Fish crates',
        'Something in a fish crate is going mmf, mmf. It is a Swamp Smuggler, and its cheeks look suspiciously penguin-shaped.',
        k.m('swamp-smuggler', -1)),
      k.battle('Foggy pier',
        'A Hedge Hisser is hiding in a coil of rope on the foggy pier, while a Pendulum Python hypnotises the seagulls.',
        k.m('hedge-hisser'), k.m('pendulum-python')),
      k.battle('Lily-pad raft',
        'A Chameleon Con is disguised as a lifebuoy. It would be very convincing if it would only stop blushing.',
        k.m('chameleon-con', 1)),
      k.rest('Lighthouse',
        'You rest in the lighthouse. From the window you can count six tiny penguins on the raft below. They are waving.'),
      k.boss("Captain's deck",
        "Captain Croak stands at the wheel of his raft, cheeks full of stolen fish fingers. Baron Von Hiss is wearing a captain's hat on top of his top hat."),
    ],
    items: [item('seedcake', 2), item('peppep', 1), item('cheese', 2)],
    dragons: ['puddlepaw', 'blobbit', 'scrappling'],
    success:
      'All six baby penguins are safe and back at the zoo, and one of them now insists on wearing your scarf. ' +
      'The Baron and Captain Croak escaped by hopping from lily pad to lily pad out to sea. Penguin parents everywhere salute you.',
  },
  {
    org: 'snakes', index: 5, type: 'rescue', location: 'zoo',
    title: 'The Sunken Greenhouse',
    objective: 'Rescue Thinktank, catch the Baron',
    briefing:
      "We've found their lair, agent: the Sunken Greenhouse, a steamy swamp hidden under the City Zoo. " +
      'Baron Von Hiss has kidnapped Thinktank, the clever fishbowl dragon from the zoo aquarium. ' +
      'He wants to use its fishbowl as a giant lens to hypnotise the whole city in one go. ' +
      'Free Thinktank and catch that snake once and for all!',
    path: (k) => [
      k.battle('Secret stairs',
        'Behind the aquarium, a secret staircase leads down into warm green fog. A Hedge Hisser and a Swamp Smuggler are on guard at the bottom.',
        k.m('hedge-hisser', -1), k.m('swamp-smuggler')),
      k.battle('Mushroom grove',
        'Glowing mushrooms light the way. A Pendulum Python is practising its hypnosis on them, and they all look very sleepy.',
        k.m('pendulum-python', 1)),
      k.rest('Lily pond', 'You rest on a big lily pad in the middle of the swamp. Somewhere ahead, a fishbowl is glowing.'),
      k.battle('Vine bridge',
        'On a wobbly vine bridge, a Chameleon Con is pretending to be part of the bridge. So is a Hedge Hisser.',
        k.m('chameleon-con', 1), k.m('hedge-hisser')),
      k.boss("Baron's stage",
        'Thinktank sits in a cage in the middle of a round stage, its fishbowl pointed up at the city. Baron Von Hiss raises his pocket watch as a Pendulum Python and Captain Croak move to block your way.',
        k.m('pendulum-python')),
    ],
    items: [item('royalcake', 1), item('dragonfruit', 1), item('herbtea', 2)],
    dragons: ['thinktank'],
    success:
      "Thinktank is free, and its first idea out of the cage was brilliant: it fogged up its fishbowl, so the Baron's hypnosis bounced right back at him. " +
      'Baron Von Hiss is fast asleep and tied in a knot, and the Sssyndicate is disbanded! ' +
      'Under his cape you found a napkin that smells of fish, with a big pawprint on it...',
  },

  // ==== THE ALLEY CAT CARTEL (BRAWL / ROCK / FIRE) ===========================================
  {
    org: 'cats', index: 1, type: 'rescue', location: 'docks',
    title: 'Tunneltot in Trouble',
    objective: 'Rescue the kidnapped Tunneltot',
    briefing:
      'Agent, that pawprint belongs to the Alley Cat Cartel, the toughest tomcats in town. ' +
      "They have kidnapped a little Tunneltot and are making it dig a tunnel into the cold vault at the Moonlight Docks fish market, where the whole city's fish is kept. " +
      "The poor thing hasn't had a carrot break in two days! " +
      'Get it out of there, and watch your tail: these cats fight dirty.',
    path: (k) => [
      k.battle('Back alley',
        'In the back alley, an Alley Scrapper is picking a fight with a dustbin. A Hot Tin Tom is hopping from paw to paw beside it.',
        k.m('alley-scrapper', -1), k.m('hot-tin-tom')),
      k.battle('Fish market',
        'A Stone Cold Cat is lounging on the ice counter of the fish market, wearing sunglasses in the dark.',
        k.m('stone-cold-cat', 1)),
      k.rest('Net loft',
        'You rest up in the net loft. Through the floorboards you can hear a tiny shovel going scrape, scrape, sniff.'),
      k.battle('The tunnel',
        'At the mouth of the tunnel, a Chimney Cat and an Alley Scrapper are shouting "Dig faster!" down the hole.',
        k.m('chimney-cat'), k.m('alley-scrapper', 1)),
      k.boss('Vault door',
        'Clawdia Crush is headbutting the vault door, and it is starting to dent. Lounging on a pile of fish crates, Don Whiskerino licks a paw and looks up at you.'),
    ],
    items: [item('carrot', 3), item('seedcake', 2)],
    dragons: ['tunneltot'],
    success:
      "You pulled the Tunneltot out just as Clawdia's headbutt dented the vault door. " +
      'Don Whiskerino bounded away over the rooftops, yowling that there were plenty more fish in the sea. ' +
      "The Tunneltot hasn't stopped hugging your squad.",
  },
  {
    org: 'cats', index: 2, type: 'sabotage', location: 'tower',
    title: 'Catnap City',
    objective: 'Switch off the giant sunlamp',
    briefing:
      'Agent, the cats have bolted a giant sunlamp to the top of the Sky Tower. ' +
      'When it switches on at noon, the whole city will turn into one big warm windowsill, and everybody will curl up for a nap. ' +
      'While the city snores, the Cartel plans to empty every fish shop, sausage stall and milk bottle in town. ' +
      'Get up there and switch it off, and try not to yawn on the way!',
    path: (k) => [
      k.battle('Tower lobby',
        'The tower lobby is already toasty. A Hot Tin Tom is hopping about on the warm floor tiles, and a Stone Cold Cat is pretending not to sweat.',
        k.m('hot-tin-tom', -1), k.m('stone-cold-cat')),
      k.branch('Sunlamp cable',
        'The sunlamp is warming up and the whole tower feels cosy. A huge cable runs down to a generator on floor 40, guarded by the Cartel.',
        {
          label: 'Rush the roof',
          description: 'Race straight up to the Don before you get sleepy. Quicker, but less XP.',
          nodes: [k.story('Yawning stairs',
            'You race up the stairs, yawning all the way. Three window cleaners are already asleep on their mops.')],
        },
        {
          label: 'Cut the power',
          description: 'Fight the generator guards and pull the plug. One more battle for more XP and coins.',
          nodes: [k.battle('Floor 40',
            'On floor 40, a Chimney Cat is guarding the generator, and an Alley Scrapper is trying to arm-wrestle it.',
            k.m('chimney-cat', 1), k.m('alley-scrapper'))],
        }),
      k.rest('Sky cafe', 'The sky cafe is empty, apart from a dozing waiter. You help yourselves to a snack and leave a big tip.'),
      k.boss('The rooftop',
        'Under the blazing sunlamp, Don Whiskerino is sprawled on a velvet cushion, soaking up the warmth. Clawdia Crush cracks a walnut on her forehead and steps forward.'),
    ],
    items: [item('herbtea', 2), item('spicybiscuit', 1)],
    dragons: ['emberpuff', 'granitooth', 'scrappling'],
    success:
      'You flicked off the giant sunlamp, and the whole city woke up with a big stretch. ' +
      'Don Whiskerino slid down the side of the tower on his velvet cape, yowling that you had switched off his sunshine. ' +
      'Somewhere, a lot of cats are very grumpy.',
  },
  {
    org: 'cats', index: 3, type: 'defend', location: 'museum',
    title: 'The Golden Sardine',
    objective: 'Defend the Golden Sardine',
    briefing:
      'Agent, the Natural History Museum has just put the Golden Sardine on show: a fish made of solid gold, found in an ancient shipwreck. ' +
      'Don Whiskerino has wanted it since he was a kitten, and the whole Cartel is coming for it tonight. ' +
      "They'll come through the windows, the doors and probably the chimney. " +
      'Hold the treasure hall, agent: that sardine stays right where it is!',
    path: (k) => [
      k.battle('Wave 1',
        'An Alley Scrapper kicks open the front doors and shadow-boxes its way down the hall.',
        k.m('alley-scrapper', -1)),
      k.battle('Wave 2',
        'A Stone Cold Cat strolls in through a window, cool as you like. A Hot Tin Tom bounces in behind it, paws smoking.',
        k.m('stone-cold-cat'), k.m('hot-tin-tom', -1)),
      k.rest('Staff room',
        "You rest in the staff room. Someone has left a box of biscuits labelled DO NOT EAT. You don't. Agents have manners."),
      k.battle('Wave 3',
        'A cloud of soot puffs out of the old fireplace. Out tumbles a Chimney Cat, coughing and grinning.',
        k.m('chimney-cat', 1)),
      k.battle('Wave 4',
        'The last wave! A Hot Tin Tom and an Alley Scrapper charge in together, yowling at the top of their lungs.',
        k.m('hot-tin-tom'), k.m('alley-scrapper', 1)),
      k.boss('Treasure hall',
        'The skylight swings open, and Don Whiskerino drops in on a rope, cape flapping. A Stone Cold Cat and Clawdia Crush land beside him.',
        k.m('stone-cold-cat')),
    ],
    items: [item('seedcake', 2), item('peppep', 1)],
    dragons: ['clanklet', 'sproutling', 'hamicorn'],
    success:
      'The Golden Sardine is still shining in its case. ' +
      'Don Whiskerino escaped up the chimney, covered in soot and sulking that he would steal something shinier next time. ' +
      'The museum has given the sardine a new sign: GUARDED BY THE DHA.',
  },
  {
    org: 'cats', index: 4, type: 'infiltrate', location: 'lab',
    title: 'The Robo-Cat Fitting',
    objective: "Stop the Don's robot suit",
    briefing:
      'Agent, Don Whiskerino has gone shopping at Ferret Labs. ' +
      'The ferret scientists are building him a giant robot cat suit with rocket boots and nine extendable claws, and tonight is his fitting. ' +
      'If he gets that suit, no fish in the city will ever be safe. ' +
      'Our scouts have listed every cat on guard, so pick your squad and sneak in. And agent: keep a close eye on those ferrets.',
    path: (k) => [
      k.battle('Loading dock',
        'A Chimney Cat and a Stone Cold Cat are guarding the loading dock, arguing about who gets to try on the robot suit first.',
        k.m('chimney-cat', -1), k.m('stone-cold-cat')),
      k.battle('Workshop',
        'In the workshop, a Hot Tin Tom is using a robot arm to scratch behind its ears. An Alley Scrapper is waiting for its turn.',
        k.m('hot-tin-tom', 1), k.m('alley-scrapper')),
      k.boss('Fitting room',
        'Don Whiskerino stands on a little stool while a robot tailor measures his tummy. It is taking a long time. Clawdia Crush spots you and growls.'),
    ],
    items: [item('royalcake', 1), item('carrot', 3)],
    dragons: ['clanklet', 'emberpuff', 'brrrito'],
    success:
      'You tangled the robot suit in a ball of wool, and it fell apart in a heap of bolts. ' +
      'Don Whiskerino stormed off, yowling that those ferrets owed him a refund. ' +
      'On the workbench you found blueprints stamped TOP SECRET: F.E.R.R.E.T. PLAN Z. Chief Nibbles will want to see these.',
  },
  {
    org: 'cats', index: 5, type: 'retrieve', location: 'docks',
    title: 'The Fish Crate Club',
    objective: 'Recover the Sunstone',
    briefing:
      'This is the big one, agent. Don Whiskerino has stolen the Sunstone, a glowing golden gem that old burrow tales say holds a little piece of the sun. ' +
      "He's using it to heat his secret boxing gym, the Fish Crate Club at the Moonlight Docks, so his cats can nap in the warm all winter. " +
      'Get in there, take back the Sunstone and catch the Don. This fat cat is out of lives!',
    path: (k) => [
      k.battle('Fish crates',
        'Behind a wall of fish crates, you find the club door. A Hot Tin Tom and a Chimney Cat are warming their paws on it.',
        k.m('hot-tin-tom', -1), k.m('chimney-cat')),
      k.battle('Boxing ring',
        'In the boxing ring, an Alley Scrapper is sparring with a punch bag shaped like a dog. A Stone Cold Cat is the referee, and a very bad one.',
        k.m('alley-scrapper'), k.m('stone-cold-cat', -1)),
      k.battle('Locker room',
        'The locker room is full of steam and old socks. A Chimney Cat leaps out of a locker in a cloud of soot.',
        k.m('chimney-cat', 1)),
      k.rest('Bait shed', 'You rest in the bait shed. It smells terrible, but nobody would ever look for you in here.'),
      k.boss("The Don's throne",
        "The Sunstone glows on a velvet cushion beside Don Whiskerino's throne, keeping the whole club toasty. The Don rises slowly as Clawdia Crush and an Alley Scrapper crack their knuckles.",
        k.m('alley-scrapper')),
    ],
    items: [item('royalcake', 1), item('peppep', 1), item('dragonfruit', 2)],
    dragons: ['sunseedra', 'scrappling'],
    success:
      'You grabbed the Sunstone, and its warm glow filled the whole club. ' +
      'Don Whiskerino got stuck halfway through his own cat flap, and the Alley Cat Cartel is disbanded! ' +
      `As he was led away, the Don purred: "You think I'm bad? Wait till you meet the ferrets." ` +
      'High above the docks, something golden circled once in the sky.',
  },

  // ==== F.E.R.R.E.T. (METAL / LIGHTNING / FROST / WATER) =====================================
  {
    org: 'ferrets', index: 1, type: 'infiltrate', location: 'lab',
    title: 'Plan Z',
    objective: 'Find out what Plan Z is',
    briefing:
      "Agent, those blueprints say F.E.R.R.E.T. PLAN Z, and that's all we know. " +
      "F.E.R.R.E.T. is the Furry Evil Robotics and Rodent Engineering Team, the ferret scientists who have been selling gadgets to every gang you've caught. " +
      'Their boss, Dr. Ferretstein, is up to something huge at Ferret Labs. ' +
      'Sneak in and find out what Plan Z is, and stay out of sight of the robots: they report everything!',
    path: (k) => [
      k.battle('Security gate',
        'A Clankbot 3000 is guarding the security gate, with a Voltage Weasel plugged into its back to charge its batteries.',
        k.m('clankbot', -1), k.m('voltage-weasel')),
      k.battle('Cold storage',
        'You tiptoe through the cold storage wing, past shelves of ice cream and frozen evil plans. A Cryo Ferret spots your footprints in the frost.',
        k.m('cryo-ferret', 1)),
      k.boss('Main lab',
        'In the main lab, a giant screen flashes PLAN Z: ZAP THE CITY. Dr. Ferretstein spins round in his chair, and Icegor drops a tray of test tubes. "Master! Visitors!"'),
    ],
    items: [item('spicybiscuit', 1), item('seedcake', 2)],
    dragons: ['clanklet', 'brrrito', 'smartypaws'],
    success:
      'Now we know: Plan Z is a giant Weather Machine to zap the city with lightning and snow, and an army of robots to take over while everyone shivers. ' +
      'Dr. Ferretstein escaped in his rocket-powered lab chair, cackling that Plan Z was already under way. Time to get to work, agent.',
  },
  {
    org: 'ferrets', index: 2, type: 'retrieve', location: 'zoo',
    title: 'The Snow Machine Snatch',
    objective: "Get back the zoo's snow machine",
    briefing:
      'Agent, F.E.R.R.E.T. has stolen the snow machine from the penguin house at the City Zoo, the one that keeps the penguins snowy all year round. ' +
      'Dr. Ferretstein needs it for his Weather Machine. ' +
      'Without it, the penguins are sweating and the polar bear has started wearing sunglasses. ' +
      'The robots are still loading it into a van, so hurry!',
    path: (k) => [
      k.battle('Penguin house',
        'A Soaker Bot is hosing down the empty penguin house. It has already soaked three zookeepers and a very cross puffin.',
        k.m('soaker-bot', -1)),
      k.battle('Polar walk',
        'On the polar walk, a Cryo Ferret is testing its freeze ray on a Clankbot 3000. The Clankbot is not enjoying it.',
        k.m('cryo-ferret'), k.m('clankbot')),
      k.battle('Zoo car park',
        'In the car park, a Voltage Weasel is starting the getaway van. Sparks fly every time it touches anything.',
        k.m('voltage-weasel', 1)),
      k.rest('Ice cream kiosk',
        'You rest in the shade behind the ice cream kiosk. The penguins waddle over to share it. They are very hot.'),
      k.boss('Getaway van',
        'The snow machine is strapped to the roof of the van. Dr. Ferretstein leans out of the window, and a Soaker Bot and Icegor jump out to stop you.',
        k.m('soaker-bot')),
    ],
    items: [item('royalcake', 1), item('berries', 3), item('herbtea', 2)],
    dragons: ['brrrito', 'hamicorn', 'fuzzlet'],
    success:
      'The snow machine is back where it belongs, and the penguins threw a snowball party to celebrate. ' +
      'Dr. Ferretstein sped off in the van, shouting that he still had his lightning. ' +
      'Icegor stayed for one snowball, then ran after him crying "Wait for me, master!"',
  },
  {
    org: 'ferrets', index: 3, type: 'rescue', location: 'lab',
    title: 'Statickle Unplugged',
    objective: 'Unplug the captured Statickle',
    briefing:
      'Agent, we know how Dr. Ferretstein is powering Plan Z. ' +
      'He has caught a Statickle and plugged it into a giant hamster wheel he calls the Mega Battery. ' +
      'It has been running for three days straight, and it is very, very tired. ' +
      "Get into Ferret Labs, unplug that poor thing and bring it home for a long nap. No dragon hamster is anybody's battery!",
    path: (k) => [
      k.battle('Cable tunnel',
        'The cable tunnel crackles with electricity. A Voltage Weasel is jogging along the cables, and a Clankbot 3000 is vacuuming behind it.',
        k.m('voltage-weasel', -1), k.m('clankbot')),
      k.battle('Robot laundry',
        'In the robot laundry, a Soaker Bot is washing socks on MAXIMUM. You are about to get very wet.',
        k.m('soaker-bot', 1)),
      k.rest('Broom cupboard',
        'You hide in a broom cupboard and catch your breath. Through the wall you can hear a little wheel squeaking, round and round.'),
      k.battle('Power room',
        'The power room hums. A Cryo Ferret is keeping the cables cool, and a Voltage Weasel is shouting "Faster!" at the wheel next door.',
        k.m('cryo-ferret', 1), k.m('voltage-weasel')),
      k.boss('Mega Battery',
        'In the middle of the room, a tiny Statickle is running on a giant glowing wheel. Dr. Ferretstein is reading the power meter and rubbing his paws. Icegor gulps: "Master, it is the agent again!"'),
    ],
    items: [item('peppep', 1), item('seedcake', 2)],
    dragons: ['statickle'],
    success:
      'You unplugged the Mega Battery, and the Statickle fell asleep in your paws before you even got out of the lab. ' +
      'Dr. Ferretstein fled down a laundry chute, screaming about his electricity bill. Without its battery, Plan Z is running on fumes.',
  },
  {
    org: 'ferrets', index: 4, type: 'sabotage', location: 'lab',
    title: 'The Robot Factory',
    objective: 'Shut down the robot factory',
    briefing:
      'Agent, this is the heart of Plan Z: a robot factory deep under Ferret Labs, building a new Clankbot every minute. ' +
      'Dr. Ferretstein wants an army big enough to march on the Sky Tower and take over the city. ' +
      'Get down there and shut that factory off before the robots outnumber the pigeons. ' +
      'And if a robot asks you to fold its laundry, say no!',
    path: (k) => [
      k.battle('Assembly line',
        'Robots are rolling off the assembly line one after another. The newest Clankbot 3000 opens its eyes, sees you and beeps. A Voltage Weasel cheers.',
        k.m('clankbot', -1), k.m('voltage-weasel')),
      k.branch('Factory cable',
        'The assembly line is clanking faster and faster. A huge power cable runs to the factory fuse box, guarded by the lab crew.',
        {
          label: 'Rush the control room',
          description: 'Dodge the conveyor belts and race straight to the doctor. Quicker, but less XP.',
          nodes: [k.story('Conveyor dash',
            'You ride a conveyor belt past a hundred half-built robots. One of them waves. You wave back. It seems only polite.')],
        },
        {
          label: 'Cut the power',
          description: 'Fight the fuse box guards and pull the plug. One more battle for more XP and coins.',
          nodes: [k.battle('Fuse box',
            'A Cryo Ferret and a Soaker Bot are guarding the fuse box. Ice and water: this could get slippery.',
            k.m('cryo-ferret'), k.m('soaker-bot', 1))],
        }),
      k.rest('Spare parts bin',
        'You hide in a bin of spare parts and share a snack. A robot hand pats you on the head. It is surprisingly comforting.'),
      k.boss('Control room',
        'In the control room, Dr. Ferretstein is pulling levers with all four paws while Icegor presses buttons at random. A brand-new Clankbot 3000 rolls in front of them.',
        k.m('clankbot')),
    ],
    items: [item('royalcake', 1), item('spicybiscuit', 2)],
    dragons: ['clanklet', 'brrrito', 'spookums'],
    success:
      'The factory ground to a halt, and every half-built robot sat down for a rest. ' +
      'Dr. Ferretstein leapt into an escape pod, howling that he would use the robots he already had, and blasted off towards the Sky Tower. ' +
      'This is it, agent. Get some sleep: tomorrow, we end Plan Z.',
  },
  {
    org: 'ferrets', index: 5, type: 'defend', location: 'tower',
    title: 'Battle for the Sky Tower',
    objective: 'Save the city from Plan Z',
    briefing:
      'Agent, this is it: Dr. Ferretstein is marching every robot he has left on the Sky Tower, ' +
      'to bolt his Weather Machine to the top and zap the whole city with lightning, snow and endless Mondays. ' +
      'Hold that tower, wave after wave, and when the doctor shows up, catch him for good. ' +
      'The whole city is counting on you, and so am I. Nibbles out!',
    path: (k) => [
      k.story('Tower top',
        'Chief Nibbles radios in: "Every dragon in the burrow is cheering for you, agent. Now go and give those robots a good clanking!"'),
      k.battle('Wave 1',
        'The first robots clank out of the evening fog. A Clankbot 3000 and a Soaker Bot are climbing the tower walls on suction cups.',
        k.m('clankbot', -1), k.m('soaker-bot', -1)),
      k.battle('Wave 2',
        'A Voltage Weasel zips up the lightning rod, and a Cryo Ferret freezes the stairs behind it. Here comes wave two!',
        k.m('voltage-weasel'), k.m('cryo-ferret')),
      k.rest('Sky cafe',
        'The sky cafe sends up a tray of hot cocoa and seed cakes, on the house. Far below, the whole city is watching.'),
      k.battle('Wave 3',
        'The robots are getting desperate. A Clankbot 3000 has strapped a Voltage Weasel to its back like a jet pack.',
        k.m('clankbot', 1), k.m('voltage-weasel')),
      k.battle('Wave 4',
        'The last wave! A Cryo Ferret and a Soaker Bot try a combo: water, then ice. The whole roof is turning into a skating rink.',
        k.m('cryo-ferret', 1), k.m('soaker-bot', 1)),
      k.boss('Weather Machine',
        'With a roar of rockets, the Weather Machine lands on the roof with Dr. Ferretstein at the controls. A Voltage Weasel and Icegor leap out, and the sky crackles with lightning.',
        k.m('voltage-weasel')),
    ],
    items: [item('dragonfruit', 3), item('royalcake', 2)],
    dragons: ['moonmunch', 'sunseedra'],
    success:
      'With a fizz, a bang and a puff of very confused snow, the Weather Machine fell to pieces. ' +
      'Dr. Ferretstein is caught at last, still clutching a slice of self-buttering toast, and F.E.R.R.E.T. is disbanded! ' +
      'Every gang is behind bars and the city is safe. ' +
      'Chief Nibbles took off his monocle to wipe away a tear: you are the best agent the Dragon Hamster Agency has ever had. ' +
      'High above the tower, the moon gave you a wink.',
  },
];

export const MISSIONS: MissionDef[] = build(CASES);
