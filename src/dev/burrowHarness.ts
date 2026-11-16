// Dev harness for the Burrow hub, the Pantry Shop and the Bag (dev/burrow.html).
// URL: ?scene=burrow|shop|bag   &many=1 gives the burrow 15 dragons   &tutorial=1 shows the first-visit
// tutorial   &cleared=1 marks the first case cleared (no MISSIONS nag)   &poor=1 leaves 12 coins
// &empty=1 empties the pantry and bag   &evo=1 puts the first dragon one activity away from evolving.
// The test save has a hungry, a tired, a fainted, a burned and an overjoyed dragon so every mood shows.
import { bootHarness } from './harness.ts';
import { app } from '../ui/app.ts';
import { SPECIES_BY_DEX } from '../data/index.ts';
import { FOOD_IDS, ITEM_IDS } from '../data/schema.ts';
import { addDragon, createDragon, dragonStats } from '../game/dragons.ts';
import { xpForLevel } from '../battle/stats.ts';
import { getSpecies } from '../data/index.ts';
import type { GameState } from '../game/types.ts';
import { createBurrowScene } from '../ui/scenes/burrow.ts';
import { createShopScene } from '../ui/scenes/shop.ts';
import { createBagScene } from '../ui/scenes/bag.ts';

const params = new URLSearchParams(location.search);
const which = params.get('scene') ?? 'burrow';

function setup(s: GameState): void {
  if (params.get('many')) {
    const extra = SPECIES_BY_DEX.filter((sp) => !s.dragons.some((d) => d.speciesId === sp.id)).slice(0, 15 - s.dragons.length);
    extra.forEach((sp, i) => addDragon(s, createDragon(s, sp.id, 7 + (i * 5) % 30)));
  }
  const [a, b, c, d, e] = s.dragons;
  if (a) { a.needs.fullness = 18; a.needs.happiness = 55; }
  if (b) { b.needs.energy = 12; b.slotsUsed = 1; }
  if (c) { c.hp = Math.floor(dragonStats(c).hp * 0.4); c.status = 'burn'; }
  if (d) { d.needs.happiness = 92; d.needs.fullness = 80; }
  if (e) { e.hp = 0; e.slotsUsed = 2; }
  if (params.get('many')) {
    s.dragons[7].needs.fullness = 0;
    s.dragons[9].needs.happiness = 95;
    s.dragons[11].needs.energy = 20;
  }
  if (params.get('evo') && a) {
    // one wheel session away from levelling into its evolution
    const lv = (getSpecies(a.speciesId).evolvesTo?.level ?? 16) - 1;
    a.level = lv;
    a.xp = xpForLevel(lv + 1) - 3;
    a.hp = dragonStats(a).hp;
    a.needs.fullness = 70;
  }
  if (params.get('tutorial')) s.flags.burrowTutorial = false;
  if (params.get('cleared')) s.missions['cheese-1'] = { clears: 1, firstClearDay: 1 };
  if (params.get('poor')) s.coins = 12;
  if (params.get('empty')) {
    for (const f of FOOD_IDS) s.food[f] = 0;
    for (const i of ITEM_IDS) s.items[i] = 0;
  }
}

bootHarness(() => createBurrowScene(), {
  setup,
  nav: {
    shop: () => app.scenes.push(createShopScene()),
    bag: () => app.scenes.push(createBagScene()),
  },
});

if (which === 'shop' || which === 'bag') {
  // open the overlay over the burrow once the first fade is done
  setTimeout(() => (which === 'shop' ? app.nav.shop() : app.nav.bag()), 50);
}
