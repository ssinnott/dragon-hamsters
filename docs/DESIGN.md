# Dragon Hamsters: design

A Pokemon-style creature game where every creature is a small dragon hamster. You keep a burrow of
them, look after them, and send squads of three on secret missions against five villain
organisations. Battles are Pokemon single battles: four moves, sixteen types, a rock-paper-scissors
type chart that applies to enemies too and is on screen for the whole fight.

Companion documents: [POKEMON_RESEARCH.md](POKEMON_RESEARCH.md) (what we borrowed from Pokemon and
why: stat archetypes by type, abilities by type, the formulas, our 16x16 chart) and the contracts in
`src/data/schema.ts`, `src/battle/types.ts` and `src/game/types.ts`, which are the source of truth
for every shape named here.

## The premise

You are the new keeper of the **Secret Burrow**, hidden HQ of the **Dragon Hamster Agency (DHA)**.
Your mentor is **Chief Nibbles**, a retired grey dragon hamster agent with an eye patch and a
monocle (no relation to any villain's monocle, he insists). On day one Nibbles hands you two of
three starter dragons and the first case file: the dinosaur egg has been stolen from the Natural
History Museum.

## Core loop

```
Burrow (feed, train, rest)  ->  Mission board  ->  briefing + squad of 3  ->  mission path
     ^                                                                            |
     |               rewards: coins, food, items, XP, sometimes a new dragon      |
     +-------------------------------- results <-------------------------- battles, rest stops, boss
```

A **day** lasts until you choose SLEEP in the Burrow. Each dragon gets two activity slots per day;
missions cost energy and fullness, so a squad can usually run one or two missions a day before it
needs to sleep. Sleeping heals everyone, cures status, restores **80 energy** (capped at 100), and
costs 25 fullness. The numbers are tuned so a full day (wheel 20 + play 15 + one mission 30 = 65
energy) is paid back by one night with room to spare: at +60 a busy dragon slowly ran dry and had
to spend slots napping.

## Rule of five

| | the five |
|---|---|
| Activities | Snack Bar (feed), Hamster Wheel, Treasure Tunnels (dig), Cozy Nest (nap), Ball Pit (play) |
| Foods | Sunflower Seeds, Crunchy Carrot, Blueberry Bundle, Cheese Cube, Dragonfruit |
| Battle items | Seed Cake, Royal Seed Cake, Pep Pepper (revive), Herbal Tea (cure), Spicy Biscuit (+1 ATK/SP.ATK) |
| Villain orgs | Big Cheese Crew (mice), Caw-sa Nostra (crows), Sssyndicate (snakes and toads), Alley Cat Cartel, F.E.R.R.E.T. (ferret robotics) |
| Mission types | Retrieve, Rescue, Sabotage, Infiltrate, Defend |
| Locations | Natural History Museum, Moonlight Docks, City Zoo, Sky Tower, Ferret Labs |
| Missions per org | 5 (one of each type), the fifth is the showdown where the boss is caught |

Dragons are not limited to five: there are about 36 species in the Dragondex.

## Types

Sixteen: FLUFF, FIRE, WATER, LEAF, LIGHTNING, EARTH, ROCK, WINGED, FROST, SLIME, DARKNESS, LIGHT,
COOKING, METAL, MIND, BRAWL. Each parallels a Pokemon type (COOKING is ours: a bulky support type
built like Chansey/Fairy, food themed). Each type carries a **stat template** (relative weights),
and every species' base stats are authored from its type's template so the archetypes hold: ROCK
dragons are slow walls with big DEFENSE, LIGHTNING dragons are fast special attackers, BRAWL
dragons hit hard physically and are weak specially, and so on. The full chart and templates live in
`src/data/types.ts`; the reasoning is in POKEMON_RESEARCH.md.

The starter triangle is FIRE > LEAF > WATER > FIRE, and the starter screen draws it.

## Battle rules (Pokemon Gen V+ formulas)

- **Stats**: HP = floor((2B + G + floor(T/4)) * L / 100) + L + 10; others =
  floor((floor((2B + G + floor(T/4)) * L / 100) + 5) * personality), personality 1.1 / 0.9 / 1.
  B base, G genes (IV 0-31), T training (EV 0-252, 510 total), L level (1-50).
- **Damage**: floor(floor(floor(2L/5 + 2) * P * A / D) / 50) + 2, then x targets(1) x crit(1.5)
  x random(0.85..1.00, integer percent) x STAB(1.5) x type x burn(0.5 physical) x ability/other
  modifiers. At least 1 unless the type multiplier is 0.
- **Crits**: stage 0 = 1/24, 1 = 1/8, 2 = 1/2, 3+ = always. Crits ignore the attacker's negative
  and the defender's positive stages.
- **Stages** -6..+6: (2+n)/2 or 2/(2-n). Accuracy/evasion use (3+n)/3 or 3/(3-n).
- **Order**: priority, then effective speed (stages, zap x0.5), ties broken by the battle RNG.
  Switching and items always go before moves.
- **Status**: see `StatusId` in schema.ts (BURNED, GOOPED, ZAPPED, SNOOZING, FROZEN), plus volatile
  confusion, flinch, STUCK (trapped) and SEEDED.
- **XP**: medium-fast curve, total XP for level n is n^3. Yield per defeated foe =
  floor(baseXp * foeLevel / 5 * ((2*foeLevel + 10) / (foeLevel + selfLevel + 10))^2.5) + 1, x1.5
  for bosses. Every non-fainted squad dragon that participated gets the full amount; squad dragons
  that did not take part get half (the agency's "Exp Share").
- **Training from battle**: each participant gains 2 training points in the defeated foe's highest
  base stat (capped as usual).
- **Happiness**: at 80+ a dragon has 10% to endure a knockout at 1 HP ("toughed it out so you
  wouldn't worry!") and +1 crit stage; at 20 or less it has 15% to loaf around instead of obeying.
- **Bosses**: max HP x1.5 and `isBoss` (the HP bar is drawn gold). Sabotage missions may supercharge
  them.
- **Enemy AI**: minions pick a random usable move, leaning towards damage; elites pick the best
  expected damage most of the time; bosses evaluate type matchups, KO chances, buffs and heals, and
  **swap to a teammate that resists your active dragon** when their active one is badly matched
  (at most twice a battle). That is the rock-paper-scissors played back at you.
- **Retreat** ends the mission (you keep XP already earned).

## The Burrow (habitat)

A cosy underground cross-section with five stations. Dragons wander between them. Each dragon has
three needs, 0-100: **fullness**, **happiness**, **energy**.

| Station | Activity | Energy | Effect |
|---|---|---|---|
| Snack Bar | feed one food from the pantry | 0 | fullness + happiness (x2 for its favourite food, and x2 again for FLUFF / COOKING, who love the Snack Bar); dragonfruit gives XP; no slot used |
| Hamster Wheel | run | -20 | SPEED training, a little XP; LIGHTNING / WINGED love it |
| Treasure Tunnels | dig | -20 | ATTACK/DEFENSE training, loot (coins, food, rarely an item); EARTH/ROCK/METAL dig better |
| Cozy Nest | nap | +50 | full HP, cure status |
| Ball Pit | play | -15 | big happiness, SP.ATK/SP.DEF training, a little XP |

The Burrow also has the **Pantry Shop** (buy food and items with coins), the roster, the Dragondex,
the type chart, and the SLEEP button that ends the day. The game autosaves on every scene change.

## Missions

Five orgs, campaign order: Big Cheese Crew (mice; FLUFF/COOKING/EARTH), Caw-sa Nostra (crows;
WINGED/DARKNESS/LIGHT), the Sssyndicate (snakes and toads; SLIME/MIND/LEAF), the Alley Cat Cartel
(BRAWL/ROCK/FIRE), F.E.R.R.E.T. (ferret scientists and robots; METAL/LIGHTNING/FROST/WATER). Each
org has a boss, a lieutenant and four minion kinds. Every type appears somewhere on the enemy side,
so the collection matters: you need counters for each org.

Each org runs a five-mission arc, one of each mission type. Every mission is a path of nodes:
minion battles, rest stops, maybe a branch, then the boss encounter (lieutenant first, boss last).
In missions 1-4 the boss escapes after losing ("You haven't seen the last of me!"); in mission 5 he
is caught. The first mission of the next org unlocks when the previous org's showdown is cleared.

| Type | Shape | Twist |
|---|---|---|
| Retrieve | 3 battles, rest, boss | standard; bonus item reward |
| Rescue | 2 battles, rest, 1 battle, boss | the rescued captive is a dragon hamster who joins you (chance 1.0) |
| Sabotage | battle, branch, rest, boss | branch: rush the boss while the device supercharges him (+1 ATK/SP.ATK), or take an extra battle to cut the power first |
| Infiltrate | 2 battles, boss, no rest | the briefing scouts the exact enemy roster; +50% coins |
| Defend | 4 waves, rest after wave 2, boss | waves of 1-2 enemies; elite AI |

Level bands (average enemy level per mission index 1..5): cheese 5/7/9/11/14, crows 13/15/17/19/22,
snakes 20/22/24/26/29, cats 27/29/31/33/36, ferrets 34/36/38/41/45. Minions sit at the band ±1,
lieutenants +1, bosses +3. Starters begin at level 5.

**Rewards**: coins, food, items, XP, and a chance at a new dragon the player does not own yet, drawn
from the mission's themed pool (rescue: guaranteed). Replays pay 50% coins and halve the dragon
chance. The dinosaur egg, once recovered, hatches into a fossil dragon as the museum's thank-you.

## Screens

All drawn on the 640x360 canvas with the engine's pixel font (A-Z, digits, basic punctuation).
Every screen works with mouse/touch alone and with keyboard alone (arrows, Enter/Space, Esc).

1. **Title**: logo, a few dragon hamsters bouncing; NEW GAME / CONTINUE.
2. **Intro + starter pick**: Chief Nibbles' briefing; pick 2 of 3 starters around the drawn
   FIRE > LEAF > WATER triangle; optional nicknames are skipped (no text entry) in favour of the
   species name.
3. **Burrow**: the habitat, HUD (day, coins), station click -> choose dragon -> activity vignette ->
   result card. Buttons: MISSIONS, DRAGONS, SHOP, DEX, TYPES, SLEEP.
4. **Roster / dragon card**: stats with bars, types, ability, personality, needs, backstory, the
   4-move loadout editor over all known moves.
5. **Dragondex**: all species; unseen ones are silhouettes.
6. **Type chart**: the 16x16 grid with hover/selection explaining a row and a column.
7. **Mission board**: five org tabs, five mission cards each (locked / available / cleared).
8. **Briefing + squad**: briefing text, objective, mission type twist, **intel** (the org's theme
   types, or the exact roster for infiltrate), "BRING:" counter types, and squad selection where
   each dragon shows a matchup grade (1-3 stars) against the intel.
9. **Mission path**: the node trail across the location, current node highlighted.
10. **Battle**: below.
11. **Results**: rewards, XP bars filling, level ups, moves learned, evolutions, a new dragon's
    reveal card with its backstory.

### Battle screen and the rock-paper-scissors UI

```
+---------------------------------------------------------------+
| [enemy box: NAME  Lv12  HP bar  type badges  status]           |
|   WEAK TO: (badges)                         enemy sprite ->  o |
|            [ MATCHUP: your types  -x2->  their types           |
|                        <-x0.5-                         ]       |
|  o <- player sprite          [player box: NAME Lv HP xp bar]   |
+---------------------------------------------------------------+
| message box / action menu: FIGHT  SWAP  BAG  RETREAT  [?]      |
| FIGHT: 4 move buttons: name, type badge, PP, power, and a tag  |
|        SUPER x2 / x1 / WEAK x0.5 / NO EFFECT vs the current foe |
+---------------------------------------------------------------+
```

The type matchup is present at all times: the MATCHUP strip (best multiplier each way), the
per-move tags, the enemy's WEAK TO line, star grades in the swap menu, and the [?] overlay that opens
the type chart with the current matchup's row and column highlighted. When the enemy AI swaps to
counter you, the message says so ("BARON VON HISS SAW YOUR FIRE COMING AND SWAPPED IN A WATER
TOAD!").

## Art direction

Procedural, chunky and cute, drawn with the engine's shape helpers: round hamster bodies, cheek
blush, tiny wings, stubby horns and dragon tails, outlined in a dark ink (#1b1426). Species differ by
`DragonVisual` (colours, wings, horns, tail, pattern, extras, size and build); villains by
`VillainVisual` (animal, outfit, prop). Each type has a colour family used for badges, move buttons,
particles and the dragons themselves.

## Code layout and ownership

```
src/lib/        the vendored game-engine (git subtree; never edit here)
src/data/       content: schema.ts (contract), types, moves, abilities, personalities, items,
                activities, species, villains, missions, index.ts (lookups)
src/battle/     types.ts (contract), stats, damage, matchup, build, battle, ai
src/game/       types.ts (contract), rng, state (save/load), dragons, habitat, shop, missions
src/art/        dragon, villain, backdrops, fx
src/ui/         input, scene manager, widgets + icons, scenes/*
src/audio/      sfx, tracks, index (the audio singleton)
src/dev/        galleries for checking art in a browser
tools/          server, build, smoke, contenttest, battletest, gametest, playtest
```

`npm run check` = typecheck + contenttest + battletest + gametest + smoke.
