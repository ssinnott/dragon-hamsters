# Dragon Hamsters

*Secret agents of the Burrow.* A Pokemon-style creature game where every creature is a small dragon
hamster. Raise a burrow of them, feed and train them, and send squads of three on secret missions
against five villain gangs. Battles are Pokemon single battles with a sixteen-type
rock-paper-scissors chart that the enemies follow too, and that stays on screen for the whole fight.

Strict TypeScript on the shared [game-engine](https://github.com/ssinnott/game-engine), vendored
into `src/lib/` with `git subtree`. There are no runtime dependencies, and nothing is compiled to
disk while you develop.

**Play it:** https://ssinnott.github.io/dragon-hamsters/

```sh
npm install
npm run dev        # http://localhost:8080
npm run build      # dist/index.html, one self-contained file
```

Every push to `main` runs the full set of checks below in GitHub Actions and, if they all pass,
publishes `dist/index.html` to GitHub Pages (`.github/workflows/pages.yml`; the repository's Pages
source must be set to "GitHub Actions").

Mouse, touch or keyboard: arrows to move, Enter or Space to choose, Escape to go back.

## The game

- **Start** by picking two of three starters (Emberpuff, Sproutling, Puddlepaw). They sit on the
  FIRE > LEAF > WATER triangle, so any two of them cover each other.
- **The Burrow** is home. Each dragon has fullness, happiness and energy, and five stations: the
  Snack Bar, the Hamster Wheel, the Treasure Tunnels, the Cozy Nest and the Ball Pit. Training there
  raises a dragon's stats (Pokemon EVs). SLEEP ends the day.
- **Missions.** Five gangs: The Big Cheese's Crew (mice), Caw-sa Nostra (crows), the Sssyndicate
  (snakes and toads), the Alley Cat Cartel and F.E.R.R.E.T. (a ferret mad scientist and his
  robots). Each runs five cases, one of each type:
  - **Retrieve:** the first case gets the stolen dinosaur egg back from the museum.
  - **Rescue:** a captured dragon hamster joins you.
  - **Sabotage:** rush the boss while his gadget powers him up, or cut the power first.
  - **Infiltrate:** the enemy roster is scouted in advance.
  - **Defend:** hold off waves.

  Every case is a trail of minion fights, rest stops and choices, then the boss.
- **Rewards** are coins, food, items, XP, and sometimes a dragon you don't own yet. There are 38
  species in the Dragondex, each with a Pokedex-style backstory, and 3-stage starter lines that
  evolve.
- **Battles** use Pokemon's Gen V+ maths: stats from base stats, genes (IVs), training (EVs) and
  personality (natures), STAB, crits, stat stages, five statuses, and abilities.

### Rock-paper-scissors, both ways

Each of the sixteen types (FLUFF, FIRE, WATER, LEAF, LIGHTNING, EARTH, ROCK, WINGED, FROST, SLIME,
DARKNESS, LIGHT, COOKING, METAL, MIND, BRAWL) parallels a Pokemon type in its stat shape, its
abilities and its matchups. COOKING is our own: a bulky healer.
[docs/POKEMON_RESEARCH.md](docs/POKEMON_RESEARCH.md) has the measured per-type stat averages, the
abilities, the formulas and the chart with its eight clean triangles.

Villains have types too, and the battle screen always shows the matchup:
- a MATCHUP strip with the multiplier in each direction
- the foe's WEAK TO list
- a SUPER / WEAK tag on every move
- star grades when you swap
- the type chart, one key away

Bosses play it back at you: when their active villain is badly matched, they swap in one that
resists you, and the message tells you why.

## Layout

```
src/lib/        the vendored game-engine (git subtree; change it upstream, never here)
src/data/       content: schema.ts (the contract), types and chart, moves, abilities,
                personalities, items, activities, species, villains, missions
src/battle/     the battle engine: pure, deterministic, Node-tested
src/game/       save/load, dragons, the Burrow, shop, missions
src/art/        procedural dragon hamsters and villains, backdrops, battle effects
src/ui/         input, scenes, widgets, icons, and every screen under scenes/
src/audio/      synthesized sound effects and music on the engine's audio stack
src/dev/, dev/  galleries and per-screen harnesses
tools/          dev server, build, and the checks below
docs/           DESIGN.md (rules), API.md (module contracts), POKEMON_RESEARCH.md
```

## Checks

| | |
|---|---|
| `npm run typecheck` | `tsc` under `strict`, zero errors |
| `npm run contenttest` | every content table: references, font-safe text, chart balance rules, the type-template shape of each species' stats, mission structure |
| `npm run battletest` | the formulas against worked Pokemon examples, a scenario per move-effect and ability kind, determinism, a 500-battle fuzz |
| `npm run gametest` | save/load (including corrupt saves), every activity, the mission lifecycle through the real engine, first-mission winnability for every starter pair; `--sim` plays the whole campaign |
| `npm run smoke` | boots the page in headless Chromium and reaches the Burrow |
| `npm run playtest` | plays the real game end to end (intro, Burrow, every screen, a case per gang) and screenshots each screen to `screenshots/playtest/` |
| `npm run distcheck` | builds `dist/index.html` and boots it from `file://` |

## Updating the engine

```sh
# in game-engine
git subtree split --prefix=src -b split
# here
git subtree pull --prefix=src/lib <game-engine remote or path> split --squash
```
