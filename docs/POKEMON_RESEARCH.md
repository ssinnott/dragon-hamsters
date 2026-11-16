# Pokemon research: what Dragon Hamsters borrows

## 1. Why this document

The game needs dragon-hamster types whose stats, typing and abilities feel like the Pokemon type each one parallels. It also needs Pokemon-style duels in which the type matchups work as rock-paper-scissors for the player and the villains alike. This document turns three research passes into numbers the build can use directly. They cover real Pokemon data (PokeAPI, Pokemon Showdown, Serebii, Smogon), a stat template for each dragon type, renamed abilities, exact battle formulas, and a balanced 16-type chart. Numbers come from the cited sources unless marked **[mem]** (from memory, not confirmed in a fetched source) or **(design)** (our own choice).

## 2. Stat archetypes by type

### 2.1 BST bands (all 1,025 species, PokeAPI, default forms only)

| Stage | Pokemon mean BST (n) | IQR | Dragon Hamsters uses |
|---|---|---|---|
| Baby | 274 (19) | – | 250–280 (hatchlings, if any) |
| First stage of an evolving line | 308 (327) | 275–330 | **300** |
| Middle stage | 391 (106), median 405 | 365–420 | **400** |
| Final of a 2-stage line | 484 (242) | 466–508 | **485** |
| Final of a 3-stage line | 519 (109) | 500–534 | **525** |
| Single-stage non-legendary | 483 (128) | 455–529 | **480–500** (most mission-reward dragons) |
| Pseudo-legendary | exactly 600 (3-stage line, Slow EXP group) | – | **600** (rare reward line 300 → 420 → 600) |
| Legendary/mythical | 592 (94), median 600, max 720 | 580–615 | **580–680** (bosses) |

- **Starter template.** BST runs 309–318 → 405 → 525–534. Bulbasaur goes 318/405/525, Charizard ends at 534, and the Gen 9 starters go 310 → 530.
- **Shape does not change on evolution.** Stats scale about ×1.6–1.7 from first to final stage with the same proportions. For example, Bulbasaur 45/49/49/65/65/45 becomes Venusaur 80/82/83/100/100/80. So **one template per type serves every stage.**
- **Early strength differs by type.** Rock and Steel first stages average about 335 BST. Bug first stages average 275 and early birds 245–255, and those lines evolve early. (design) ROCK and METAL first stages sit at 320–340 and evolve late. WINGED and SLIME first stages sit at 260–280 and evolve early.

### 2.2 The 18 Pokemon types (fully evolved, non-legendary averages)

Stats are listed as HP/Atk/Def/SpA/SpD/Spe = BST. The average across all finals is 82/91/83/82/81/75 = 495.

| Pokemon type | Final average | High stats | Dump stats | Archetype (examples) | Our type |
|---|---|---|---|---|---|
| Normal | 92/90/72/71/73/83=481 | HP, Spe | Def, SpA | Big-HP generalist (Snorlax 160 HP, Blissey 255 HP) | FLUFF |
| Fire | 81/93/76/98/81/85=514 | SpA, Spe | Def | Special or mixed sweeper (Charizard, Arcanine) | FIRE |
| Water | 83/89/85/84/81/72=494 | balanced (all within ±3) | Spe, slightly | Bulky all-rounder (Blastoise, Vaporeon) | WATER |
| Grass | 78/89/84/88/84/69=492 | SpA, Def | Spe | Defensive support: status, drain (Venusaur) | LEAF |
| Electric | 77/82/71/100/76/92=498 | SpA, Spe | Def, Atk | Fast glass cannon (Jolteon 130 Spe) | LIGHTNING |
| Ground | 90/102/97/66/78/63=495 | HP, Atk, Def | SpA, Spe | Physical tank (Hippowdon, Donphan) | EARTH |
| Rock | 82/104/113/73/80/56=508 | Def, Atk | Spe, SpA | Physical wall that hits hard (Gigalith) | ROCK |
| Flying | 80/85/72/81/74/92=485 | Spe | Def, SpD | Fast pivot or attacker (Talonflame 126 Spe) | WINGED |
| Ice | 92/98/90/83/79/71=512 | HP, Atk | Spe | Bruiser: strong offense, poor defensive typing (Mamoswine) | FROST |
| Poison | 78/86/78/80/83/79=484 | flat; SpD | slightly weak overall | Status attrition and stall (Muk, Toxapex) | SLIME |
| Bug | 68/82/77/77/78/71=453 | – | HP; lowest BST of any type | Weak early, evolves fast (Butterfree) | SLIME (secondary) |
| Dark | 83/104/79/79/75/83=502 | Atk, Spe | SpD | Fast physical trickster (Weavile) | DARKNESS |
| Fairy | 82/72/76/95/95/67=487 | SpD (highest of any type), SpA | Atk (lowest), Spe | Special wall or cleric (Sylveon, Clefable) | LIGHT |
| Steel | 79/97/118/73/91/57=515 | Def (highest), SpD | Spe, SpA | Wall with 10 resistances (Aggron, Bronzong) | METAL |
| Psychic | 79/73/81/101/93/72=498 | SpA (highest), SpD | Atk | Special sweeper or screen setter (Alakazam) | MIND |
| Fighting | 86/117/81/71/77/74=505 | Atk (highest by far) | SpA | Physical wallbreaker (Machamp, Conkeldurr) | BRAWL |
| Ghost | 75/87/86/87/89/71=496 | SpD, SpA | HP | Tricky special attacker (Gengar) | dropped (flavour goes to DARKNESS) |
| Dragon | 87/106/92/97/87/86=554 | every stat | – | Elite powerhouse; pseudo-legendaries (Garchomp 600) | dropped (used as the boss uplift) |

### 2.3 Dragon Hamster type templates

- **How to use.** Base stat = round(weight × BST ÷ 6). Every row sums to 6.00, so the mean weight is exactly 1.00.
- **How they were made.** Each row starts from Report 1's 500-BST stat-share template for the parallel type (weight = share ÷ 83.3). Deviations were then sharpened about ×1.5, rounded to 0.05, and hand-tuned so each type has one or two signature stats and one or two dump stats (design). The sharpening is needed because dual-typed Pokemon blur the raw averages (for example, Rock's raw weights are 0.96/1.16/1.39/0.78/1.01/0.70).

| Our type | Pokemon parallel | HP | Atk | Def | SpA | SpD | Spe | Final at 525 BST | Role |
|---|---|---|---|---|---|---|---|---|---|
| FLUFF | Normal | 1.25 | 1.10 | 0.85 | 0.80 | 0.95 | 1.05 | 109/96/74/70/83/92 | Big-HP generalist, jack of all trades |
| FIRE | Fire | 0.90 | 1.10 | 0.85 | 1.25 | 0.90 | 1.00 | 79/96/74/109/79/88 | Special or mixed sweeper |
| WATER | Water | 1.10 | 1.00 | 1.05 | 1.00 | 1.05 | 0.80 | 96/88/92/88/92/70 | Bulky all-rounder |
| LEAF | Grass | 0.95 | 1.05 | 1.05 | 1.10 | 1.10 | 0.75 | 83/92/92/96/96/66 | Defensive support (status, drain, healing) |
| LIGHTNING | Electric | 0.85 | 0.90 | 0.80 | 1.25 | 0.95 | 1.25 | 74/79/70/109/83/109 | Fast special glass cannon |
| EARTH | Ground | 1.15 | 1.30 | 1.20 | 0.70 | 0.95 | 0.70 | 101/114/105/61/83/61 | Bulky physical tank |
| ROCK | Rock | 0.95 | 1.25 | 1.55 | 0.65 | 0.95 | 0.65 | 83/109/136/57/83/57 | Physical wall that hits hard |
| WINGED | Flying | 0.95 | 1.10 | 0.85 | 0.95 | 0.85 | 1.30 | 83/96/74/83/74/114 | Fast hit-and-run attacker |
| FROST | Ice | 1.15 | 1.15 | 1.00 | 1.05 | 0.90 | 0.75 | 101/101/88/92/79/66 | Bruiser; high HP offsets 4 weaknesses |
| SLIME | Poison + Bug + goo | 1.15 | 0.95 | 1.00 | 0.95 | 1.20 | 0.75 | 101/83/88/83/105/66 | Sticky status wall |
| DARKNESS | Dark | 0.95 | 1.35 | 0.90 | 0.90 | 0.85 | 1.05 | 83/118/79/79/74/92 | Fast physical trickster |
| LIGHT | Fairy | 0.95 | 0.75 | 1.00 | 1.20 | 1.30 | 0.80 | 83/66/88/105/114/70 | Special wall and cleric |
| COOKING | none (Normal/Fairy healers) | 1.30 | 0.70 | 0.95 | 0.95 | 1.25 | 0.85 | 114/61/83/83/109/74 | Bulky healer and buffer |
| METAL | Steel | 0.85 | 1.15 | 1.60 | 0.70 | 1.10 | 0.60 | 74/101/140/61/96/52 | Two-sided wall |
| MIND | Psychic | 0.95 | 0.75 | 0.90 | 1.35 | 1.15 | 0.90 | 83/66/79/118/101/79 | Special sweeper or screen support |
| BRAWL | Fighting | 1.00 | 1.55 | 0.95 | 0.65 | 0.90 | 0.95 | 88/136/83/57/79/83 | Physical wallbreaker |

- **First-stage examples at 300 BST:** ROCK 48/62/78/32/48/32; LIGHTNING 42/45/40/62/48/62; COOKING 65/35/48/48/62/42.
- **How the three "slow, tough" types differ:**
  - EARTH has the most HP and Atk.
  - ROCK has the highest physical Def and low SpD (it falls to special hits).
  - METAL is high on both Def and SpD but has the lowest Spe and HP.
- **Individual dragons can deviate.** Pokemon varies within a type (Rampardos is a 165-Atk glass-cannon Rock; Umbreon is a defensive Dark). Give individual dragons a ±0.15 tilt on one or two stats from the type template, keeping the row sum at 6.00 (design).

**COOKING (no Pokemon parallel).**
- **What it is modelled on.** It is a bulky support type built from the Pokemon healers and food Pokemon:
  - Blissey 255/10/10/75/135/55 and Chansey 250/5/5/35/105/50: enormous HP and SpD, tiny attack.
  - Audino 103/60/86/60/86/50.
  - Alcremie 65/60/75/110/121/64 (cream).
  - Slurpuff 82/80/86/85/75/72 (dessert).
  - Appletun 110/85/80/100/80/30 (apple pie).
- **Stat shape.** It takes the Chansey/Blissey shape (top HP, high SpD, low Atk), toned down so it can still deal damage. Its SpA of 0.95 matches the Alcremie/Appletun "cook attacks with heat and spice" style.
- **Role.** Healing and buffing through food (snack, picnic and feast moves). It survives long enough to use them, as Report 1's template suggested (95/60/80/85/110/70 at 500 BST).
- **Offense.** COOKING should not out-damage FIRE. It gets a modest 3 super-effective targets and pays with 4 weaknesses, FIRE among them (Section 5; FIRE overcooking COOKING was added after the first draft).

**SLIME (Poison + Bug + goo).**
- **Stats.** Pokemon Poison is flat and slightly weak (484 final BST), and Bug is the weakest type (453). Pure-average stats would make SLIME a bad type. So SLIME takes the stat line of the goo and slug Pokemon instead:
  - Muk 105/105/75/65/100/50.
  - Swalot 100/73/83/73/83/55.
  - Gastrodon 111/83/68/92/82/39.
  - Goodra 90/100/70/110/150/80, the slime pseudo-legendary with 150 SpD.
  - Together they give high HP, the best SpD, and slow Speed.
- **Typing.** Defensively, SLIME uses Poison's chart (weak to EARTH) plus Bug's weakness to WINGED. Offensively it keeps Poison's 2× against LEAF and LIGHT.
- **Abilities.** It takes Poison's status abilities (Poison Point, Liquid Ooze) and Goomy's Gooey, which gives −1 Speed on contact: the "sticky, slows you down" behaviour.

**Types we drop.**
- **Ghost.** Its trickster flavour goes to DARKNESS and to the boss ability Decoy Cloak (from Disguise).
- **Bug.** Folded into SLIME.
- **Dragon.** Every creature is a dragon, so a Dragon type would mean nothing. Its stat profile becomes the "elite" uplift instead: Dragon finals average 554, which is +12% over 495. Bosses and the pseudo-legendary reward line sit 10–25% above their stage band (design).

## 3. Abilities by type

**Structure found across all 18 types** (Pokemon Showdown `pokedex.js`; 1,282 forms). "X/Y" below means X of the Y holders are of that type. Every type's abilities fall into five slots:
1. **Pinch boost:** Blaze, Torrent, Overgrow and Swarm each have about 30 holders, all of one type.
2. **Absorb or immunity.**
3. **Contact punish:** 30% chance of a status, or 1/8 chip damage.
4. **Weather or field setter, plus abilities that benefit from it.**
5. **Defensive or flavour trait.**

**Slots per species.** Each species gets 1–2 regular abilities plus 1 rare hidden ability, as in Pokemon (slots "0", "1", "H"). (design) Any type can use a "<Type> Heart" pinch ability (its type's moves ×1.5 at ≤1/3 HP) as the default for its starter-like lines.

**Shared vocabulary.**
- **Weather** from an ability lasts 5 turns (Gen VI+):
  - SUNNY: FIRE moves ×1.5, WATER moves ×0.5.
  - RAIN: WATER moves ×1.5, FIRE moves ×0.5.
  - SANDSTORM: non-ROCK/EARTH/METAL dragons lose 1/16 max HP per turn; ROCK dragons get SpD ×1.5 [mem].
  - SNOW: FROST dragons get Def ×1.5 (Gen IX snow, Serebii); no chip damage.
- **Fields** last 5 turns [mem] and affect grounded dragons only. A dragon is grounded unless it is WINGED or has Floaty Thoughts. Field boosts are ×1.3 (Gen VIII+ terrain).

| Our type | Pokemon original (holders) | Hamster-dragon name | Exact effect |
|---|---|---|---|
| FLUFF | Thick Fat (30 holders across all types) | **Puffball Coat** | FIRE and FROST damage taken ×0.5. |
| FLUFF | Cheek Pouch (6/7 Normal; Skwovet, Greedent, Dedenne, Bunnelby) | **Cheek Stash** | Eating a held snack also restores 1/3 max HP [fraction mem]. |
| FLUFF | Technician (25) | **Little Paws** | Moves with base power ≤60 deal ×1.5. |
| FLUFF | Serene Grace (10/15 Normal) | **Lucky Whiskers** | Added-effect chances ×2 (a 30% flinch becomes 60%). |
| FIRE | Blaze (30/30) | **Ember Heart** | FIRE moves ×1.5 while HP ≤1/3 max. |
| FIRE | Flash Fire (26/27) | **Kindling Belly** | Immune to FIRE moves. After absorbing one, its own FIRE moves are ×1.5 until it swaps out. |
| FIRE | Flame Body (21/21) | **Toasty Fur** | 30% chance to BURN a foe that hits it with a contact move. |
| FIRE | Drought (4/5) | **Sunny Disposition** | On entry, sets SUNNY for 5 turns. |
| WATER | Torrent (30/30) | **Tidal Heart** | WATER moves ×1.5 while HP ≤1/3 max. |
| WATER | Water Absorb (23/28) | **Sponge Cheeks** | Immune to WATER moves; heals 1/4 max HP when hit by one. |
| WATER | Swift Swim (42/47) | **Paddle Paws** | Speed ×2 in RAIN. |
| WATER | Drizzle (3) | **Raincloud Sneeze** | On entry, sets RAIN for 5 turns. |
| LEAF | Overgrow (30/30) | **Sprout Heart** | LEAF moves ×1.5 while HP ≤1/3 max. |
| LEAF | Chlorophyll (38/38) | **Sunbather** | Speed ×2 in SUNNY. |
| LEAF | Effect Spore (11/11) | **Sneezy Spores** | 30% chance that a contact attacker gets GOOP, JOLT or SNOOZE (equal odds); LEAF dragons are immune. |
| LEAF | Harvest (9/9) | **Seed Saver** | At end of each turn, 50% chance to regrow a held snack it used (100% in SUNNY). |
| LIGHTNING | Static (31/31) | **Staticky Fluff** | 30% chance to JOLT a contact attacker. |
| LIGHTNING | Volt Absorb (13/13) | **Battery Belly** | Immune to LIGHTNING moves; heals 1/4 max HP when hit by one. |
| LIGHTNING | Motor Drive (4/4) | **Wheel Runner** | Immune to LIGHTNING moves; +1 Speed when hit by one (the hamster wheel). |
| LIGHTNING | Electric Surge (2) | **Spark Field** | On entry, sets a SPARK FIELD for 5 turns: grounded dragons' LIGHTNING moves ×1.3, and grounded dragons cannot fall into SNOOZE. |
| EARTH | Sand Force (12/18) | **Dune Power** | EARTH, ROCK and METAL moves ×1.3 in SANDSTORM; takes no sand damage. |
| EARTH | Sand Rush (4/10) | **Dune Dasher** | Speed ×2 in SANDSTORM; takes no sand damage. |
| EARTH | Arena Trap (3/3; Showdown rating 5.0) | **Burrow Trap** | Grounded foes cannot swap out or flee. |
| EARTH | Earth Eater (1) | **Dirt Snacker** | Immune to EARTH moves; heals 1/4 max HP when hit by one [fraction mem]. |
| ROCK | Sturdy (33/47) | **Pebble Grit** | At full HP, survives any single hit with 1 HP. |
| ROCK | Rock Head (16/23) | **Hard Noggin** | Takes no recoil damage from its own moves (Struggle still recoils). |
| ROCK | Sand Stream (5) | **Dust Devil** | On entry, sets SANDSTORM for 5 turns. |
| ROCK | Solid Rock (4) | **Boulder Hide** | Super-effective damage taken ×0.75. |
| WINGED | Keen Eye (24/43) | **Hawk Eyes** | Its accuracy cannot be lowered, and it ignores the target's evasion boosts. |
| WINGED | Big Pecks (15/15) | **Puffed Chest** | Its Defense cannot be lowered. |
| WINGED | Gale Wings (3) | **Updraft Dash** | WINGED moves get +1 priority while it is at full HP (Gen VII rule). |
| WINGED | Super Luck (7/9) | **Lucky Feather** | Critical-hit stage +1 (1/24 → 1/8). |
| FROST | Ice Body (20/21) | **Snowcone Nibbler** | Heals 1/16 max HP at end of each turn in SNOW. |
| FROST | Snow Warning (8/8) | **Flurry Sneeze** | On entry, sets SNOW for 5 turns. |
| FROST | Slush Rush (7/7) | **Sled Paws** | Speed ×2 in SNOW. |
| FROST | Ice Scales (2; rating 4.0) | **Rime Scales** | Special damage taken ×0.5. Hidden ability only. |
| SLIME | Poison Point (19/20) | **Goo Prickles** | 30% chance to GOOP a contact attacker. |
| SLIME | Gooey (Goomy line, 5/7 Dragon) | **Tacky Coat** | A contact attacker gets −1 Speed. |
| SLIME | Liquid Ooze (4/4) | **Sour Slime** | HP-draining moves used on it hurt the drainer by the amount they would have healed. |
| SLIME | Poison Heal (3; rating 4.0) | **Goo Glutton** | While GOOPed, heals 1/8 max HP per turn instead of losing it [mem]. |
| DARKNESS | Intimidate (46 total; 11 Dark) | **Spooky Glare** | On entry, the foe's Atk −1. Blocked by Polished Plating. |
| DARKNESS | Pickpocket (7/15) | **Sneaky Paws** | When a foe makes contact, steals its held snack if this dragon holds none. |
| DARKNESS | Moxie (7/16) | **Victory Swagger** | +1 Atk each time it knocks out a foe. |
| DARKNESS | Prankster (7/19) | **Mischief Maker** | Its status moves get +1 priority; they fail against DARKNESS targets. |
| LIGHT | Pixilate (3) | **Glitterize** | Its FLUFF-type moves become LIGHT-type and get ×1.2. |
| LIGHT | Misty Surge (2) | **Twinkle Field** | On entry, sets a TWINKLE FIELD for 5 turns: grounded dragons cannot receive a major status, and DARKNESS damage to grounded dragons is ×0.5 (DARKNESS takes the place of Pokemon's Dragon here). |
| LIGHT | Magic Bounce (6/9; rating 4.0) | **Mirror Shine** | Status moves aimed at it bounce back to the user. |
| LIGHT | Natural Cure (19) | **Fresh Sparkle** | Cures its own major status when it swaps out. |
| COOKING | Hospitality (4/4; Sinistcha, tea) | **Warm Welcome** | Adapted for singles: when it swaps out, the dragon that replaces it heals 1/4 max HP. (Pokemon: heals the doubles partner up to 25% on entry.) |
| COOKING | Ripen (Applin line) | **Double Batch** | Held-snack effects are doubled (twice the healing, twice the stat stages). |
| COOKING | Cud Chew | **Second Helping** | A held snack it eats is eaten again at the end of the next turn. |
| COOKING | Purifying Salt (3/3; rating 4.0) | **Salt Crust** | Immune to all major statuses; DARKNESS damage taken ×0.5 (Ghost in Pokemon). |
| METAL | Clear Body (7/19) | **Polished Plating** | Foes cannot lower its stats. |
| METAL | Iron Barbs (4) | **Rivet Spikes** | Contact attackers lose 1/8 of their max HP. |
| METAL | Download (5/8) | **Diagnostic Scan** | On entry, +1 Atk if the foe's Def is lower than its SpD, otherwise +1 SpA. |
| METAL | Steelworker (1) | **Smithy Spirit** | METAL moves ×1.5. |
| MIND | Synchronize (17/18) | **Mood Mirror** | When a foe gives it BURN, GOOP or JOLT, the foe gets the same status. |
| MIND | Magic Guard (7/10; rating 4.0) | **Zen Bubble** | Takes damage only from direct attacks (no status, weather, recoil or Rivet Spikes damage). |
| MIND | Trace (4/6) | **Copycat Thoughts** | On entry, copies the foe's ability (boss abilities cannot be copied). |
| MIND | Levitate (17/41) | **Floaty Thoughts** | Immune to EARTH moves; not grounded. |
| BRAWL | Guts (11/25) | **Tough Cookie** | Atk ×1.5 while it has a major status; ignores BURN's halving of physical damage. |
| BRAWL | Iron Fist (12/18) | **Power Paws** | Punching moves ×1.2. |
| BRAWL | Defiant (6/16) | **Stubborn Streak** | +2 Atk whenever a foe lowers any of its stats. |
| BRAWL | Justified (7/10) | **Hero's Resolve** | +1 Atk when hit by a DARKNESS move. |

**Boss abilities (8).** Pokemon's boss models:
- Totem Pokemon enter with a +1 to +3 stat aura and call in allies [mem].
- Kingambit's Supreme Overlord scales with fallen allies.
- Tera Raid bosses add HP-threshold shields [mem].
- Our formula: **an entry aura (+1 to one stat), a phase change at 50% HP, and scaling with the number of minions beaten.**

| # | Pokemon original | Boss ability | Exact effect | Why |
|---|---|---|---|---|
| 1 | Supreme Overlord (Kingambit; rating 4.0) | **Crew Boss** | Atk and SpA ×(1 + 0.1·n), where n is the number of the boss's minions defeated earlier in this mission (cap n = 5, so ×1.5). The UI shows a "Crew 3/5" badge. | Fits the "beat the minions, then the boss" mission format. The player can pace the fight or bring a bulky counter. |
| 2 | Pressure (35 holders, mostly legendaries) | **Looming Presence** | Moves aimed at the boss cost 2 PP instead of 1. Entry banner: "The Big Cheese looms over you!" | The classic legendary aura; rewards PP-efficient teams. |
| 3 | Multiscale / Shadow Shield | **Velvet Cape** | Damage taken ×0.5 while at full HP. | The boss always gets to act; no first-turn KO. |
| 4 | Disguise (Mimikyu) | **Decoy Cloak** | The first damaging hit is blocked completely; the boss then loses 1/8 max HP as the decoy breaks. Once per battle. | Ghost trickster flavour for DARKNESS villains. |
| 5 | Anger Shell (Klawf) | **Final Fury** | The first time a hit drops it from above 50% to ≤50% HP: Atk, SpA and Speed +1; Def and SpD −1 [stage sizes mem]. | A visible "phase 2" that rewards burst damage. |
| 6 | Zen Mode / Power Construct / Schooling | **Phase Shift** | At end of turn, once, at ≤50% HP: changes form, takes its phase-2 type and template, and gains +50% of its original max HP as both max and current HP (design). | The dramatic boss transformation; lets the boss change type mid-fight so the player must re-read the type triangle. |
| 7 | Unnerve | **Snack Thief** | While the boss is on the field, the player's dragons cannot eat held snacks. | Counters COOKING and snack strategies; built for "the Big Cheese" mouse crew. |
| 8 | Desolate Land / Primordial Sea / Delta Stream | **Lair Weather** | On entry, sets lair weather for as long as the boss is on the field; no other weather can replace it. Scorched Lair: SUNNY, and WATER moves fail. Flooded Lair: RAIN, and FIRE moves fail. Gale Lair: WINGED dragons lose their weaknesses [mem]. | Gives each villain org's lair a battle identity. |

Avoid on bosses:
- Wonder Guard: unbeatable without super-effective moves.
- Moody: random swings.
- Huge Power combined with Speed Boost: too strong.
- Regenerator and Natural Cure: useless on a boss that never swaps out.

## 4. Battle formulas we adopt

Singles duels using the Gen VII+ rules.

**Stats (Gen III+ formula, unchanged through Gen IX).**
- HP = floor((2·B + S + floor(TP/4)) · L / 100) + L + 10
- Atk/Def/SpA/SpD/Spe = floor((floor((2·B + S + floor(TP/4)) · L / 100) + 5) · T)
- **B:** base stat (template × BST ÷ 6).
- **S, "Spark" (= IV):** 0–31, rolled when a dragon is hatched or recruited.
- **TP, Training Points (= EVs):** earned from habitat activities. Cap 252 per stat and 510 total; every 4 TP adds +1 stat at L100. This is the hook from the habitat to the battles (design).
- **T, Temperament (= nature):** ×1.1 to one stat and ×0.9 to another, or neutral. Never affects HP.
- **Check:** Charizard (base SpA 109, HP 78) at L100 with S31, TP252 and a + temperament gets SpA 348 and HP 360. At L50 with S31, TP0 and neutral it gets HP 153 and SpA 129. These match the known values.

**Damage (Gen V+ formula, Gen VI+ values).** Apply the steps in this order, flooring after each one. This stays within 1–2 HP of Smogon's 4096-based rounding.
1. Base = floor(floor(floor(2·L/5 + 2) · Power · A / D) / 50) + 2. A/D is Atk vs Def for physical moves and SpA vs SpD for special moves, after stages.
2. × Weather: 1.5 for FIRE in SUNNY or WATER in RAIN; 0.5 for the reverse.
3. × Crit: 1.5.
4. × Random: an integer 85–100, divided by 100 (16 equally likely rolls).
5. × STAB: 1.5 when the move matches the user's type (2.0 with an Adaptability-like ability).
6. × Type: the product over the defender's types, so 0, 0.25, 0.5, 1, 2 or 4.
7. × BURN: 0.5 on physical moves (not with Tough Cookie).
8. × Other: screens 0.5, ability and snack modifiers.
9. Minimum 1 damage, unless the type product is 0.

Worked example (design check):
- **Setup.** A L25 middle-stage FIRE dragon (BST 405, base SpA 84, S15, no TP) has SpA 50. It attacks a L25 middle-stage LEAF dragon (base SpD 74 → 45, HP 70).
- **90-power FIRE move:**

  | Case | Damage | % of HP |
  |---|---|---|
  | STAB + 2× | 66–78 | 94–111% (usually a KO) |
  | Crit | 98–116 | – |
  | Neutral | 33–39 | 47–56% |
  | Resisted 0.5× (same defender stats) | 16–19 | 23–27% |

- **60-power move, STAB + 2×:** 44–54 (63–77%).
- **40-power move, no STAB, neutral:** 10–12 (14–17%).
- **Takeaways:** a super-effective hit is worth exactly two neutral hits, which is what makes the rock-paper-scissors matter. (design) Gate 90-power moves to about L30+.

**Critical hits (Gen VII+).**

| Stage | 0 | +1 | +2 | +3 |
|---|---|---|---|---|
| Chance | 1/24 (4.17%) | 1/8 | 1/2 | always |

- **Multiplier:** ×1.5.
- **Stage sources:** a high-crit move +1, Lucky Feather +1, a focus move +2.
- **What a crit ignores:** the attacker's negative offensive stages, the defender's positive defensive stages, and screens [screens mem]. BURN halving still applies [mem].
- **Never crit:** shell-armor-style abilities.

**Stat stages.** Range −6 to +6; they reset on swap-out.

| Stage | −6 | −5 | −4 | −3 | −2 | −1 | 0 | +1 | +2 | +3 | +4 | +5 | +6 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Atk/Def/SpA/SpD/Spe: max(2,2+s)/max(2,2−s) | 0.25 | 0.286 | 0.333 | 0.4 | 0.5 | 0.667 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4 |
| Accuracy/evasion: max(3,3+s)/max(3,3−s) | 0.333 | 0.375 | 0.429 | 0.5 | 0.6 | 0.75 | 1 | 1.333 | 1.667 | 2 | 2.333 | 2.667 | 3 |

- **Accuracy check:** effective stage = user's accuracy stage − target's evasion stage, clamped to ±6. The move hits if randInt(0..99) < min(100, MoveAcc × stage multiplier × modifiers).
- **Modifiers:** compound-eye-style ×1.3; hustle-style ×0.8 on physical moves.
- **Always hit:** moves with "—" accuracy.
- **Typical stage moves** [mem except Swords Dance]: Swords Dance-like +2 Atk; Growl-like −1 Atk; Agility-like +2 Spe.

**Turn order.**
1. Swaps resolve first.
2. Moves are ordered by priority bracket, then by calculated Speed (stat × stage × 0.5 if JOLTED) within a bracket.
3. Speed ties are a random 50/50, re-rolled each turn.

| Priority | Pokemon examples | Our use |
|---|---|---|
| +4 | Protect | Guard moves |
| +3 | Fake Out | First-turn-only flinch move |
| +2 | ExtremeSpeed | Rare dash move |
| +1 | Quick Attack, Aqua Jet, Ice Shard, Bullet Punch, Sucker Punch | Quick moves |
| 0 | everything else | – |
| −4 | Revenge, Avalanche | Revenge move |
| −6 | Roar, Dragon Tail | Forced swap |

PokeAPI confirms Quick Attack +1, ExtremeSpeed +2 and Protect +4.

**Statuses.**
- **Decisions (design):**
  - POISON becomes **GOOP**, because SLIME is our poison type and "goop" is kid-friendly. Toxic becomes **DEEP GOOP**.
  - FREEZE becomes **CHILL**, modelled on Legends: Arceus frostbite: 1/16 HP per turn and a 50% cut to special attack (Serebii). This avoids freeze's swingy 20%-per-turn thaw and makes CHILL the special-attack mirror of BURN.
  - Infatuation is dropped.
- **One major status at a time.**
- **Persistence (design):** major statuses persist through the whole minion → boss chain of a mission. The habitat cures everything between missions, so status pressure builds across a mission.

| Our status | Pokemon status | Exact effect | Immune | Main sources |
|---|---|---|---|---|
| **BURN** | Burn | Loses 1/16 max HP at end of turn; physical damage ×0.5 | FIRE | FIRE (10% on 90-power FIRE moves; Will-O-Wisp-like move at 85% accuracy) |
| **GOOP** | Poison | Loses 1/8 max HP at end of turn (minimum 1) | SLIME, METAL | SLIME |
| **DEEP GOOP** | Bad poison (Toxic) | Loses n/16 max HP, n = 1, 2, 3… (cap 15/16); n resets on swap; becomes GOOP after battle | SLIME, METAL | SLIME status move (90% accuracy) |
| **JOLT** | Paralysis | Speed ×0.5; 25% chance each turn to lose its action | LIGHTNING | LIGHTNING (Thunder Wave-like move at 90%; 10% on 90-power moves) |
| **SNOOZE** | Sleep | Cannot act for 1–3 turns: a 2–4 counter drops by 1 on each move attempt, and it wakes and acts at 0; the counter is kept while swapped out. A Rest-like move always gives 2 turns. | none by type (Spark Field protects) | MIND, LEAF spores, COOKING "food coma" (Hypnosis-like move at 60%) |
| **CHILL** | Frostbite (replaces Freeze) | Loses 1/16 max HP at end of turn; SpA ×0.5 | FROST | FROST |
| DIZZY (volatile) | Confusion | 1–4 turns (a 2–5 counter on move attempts); each attempt has a 33% chance to hit itself with a typeless physical 40-power move using its own Atk vs Def, which cannot crit; clears on swap | – | MIND, LIGHT (Confuse Ray-like move at 100%) |
| FLINCH (volatile) | Flinch | Skips this turn's action; only works if the flinching move went first | – | DARKNESS (Bite-like move, 30%) |

- **End-of-turn order** [mem, approximate]: weather damage → healing (snacks, Snowcone Nibbler) → BURN/GOOP/CHILL damage → binding damage.

**PP and moves.**
- **PP tiers:** 35 (Tackle), 30, 25 (Ember, Water Gun, Bite), 15 (Flamethrower, Surf, Thunderbolt), 10 (Earthquake, Protect), 5 (Fire Blast, Hydro Pump, Recover).
- **Power tiers:**
  - 40 early.
  - 60–80 mid-game.
  - 90 at 100% accuracy (the reliable strong move).
  - 110–120 with a drawback (Fire Blast 85% accuracy, Hydro Pump 80%).
- **Struggle** (when no move has PP): typeless, physical, 50 power, never misses, and costs the user 1/4 max HP as recoil.

**EXP.** Total EXP to reach level n:

| Group | Formula | L5 | L10 | L20 | L30 | L50 | L100 |
|---|---|---|---|---|---|---|---|
| Fast | 4n³/5 | 100 | 800 | 6,400 | 21,600 | 100,000 | 800,000 |
| Medium Fast | n³ | 125 | 1,000 | 8,000 | 27,000 | 125,000 | 1,000,000 |
| Medium Slow | 6/5·n³ − 15n² + 100n − 140 | 135 | 560 | 5,460 | 21,760 | 117,360 | 1,059,860 |
| Slow | 5n³/4 | 156 | 1,250 | 10,000 | 33,750 | 156,250 | 1,250,000 |

- **Group assignment (design, following Pokemon):**
  - Starters are Medium Slow (as Charmander is). It starts slow, then catches up past about L30.
  - Common dragons are Medium Fast.
  - FLUFF and COOKING healers are Fast (Blissey is Fast).
  - The rare 600-BST reward line is Slow, as pseudo-legendaries are by definition.
- **EXP per defeat (Gen V scaled formula, Serebii integer form):** ΔEXP = floor(floor(√A·A²) · B / floor(√C·C²)) + 1, with A = 2L+10, C = L+Lp+10 and B = floor(b·L/5).
  - L is the defeated dragon's level, Lp the winner's level, and b the base yield. Split the result between participants.
  - Multiply by ×1.5 for mission (trainer) battles. This is the Gen V rule; Gen VII may have removed it, per a forum post only. (design) We keep it to reward missions.
- **Base yield b by stage (PokeAPI):** first stage about 60 (Charmander 62), middle about 140 (Charmeleon 142), final about 240 (Charizard 240, Garchomp 270). Bosses 270–300 (design).
- **Check:** a L5 b=51 foe gives a L5 winner 52 EXP and a L10 winner 30 EXP, which matches the source.
- **Mission examples (with ×1.5):**
  - L10 first-stage minion vs a L10 dragon: 181 EXP (Medium Fast L10→11 needs 331).
  - L12 middle-stage minion vs L12: 505 EXP (L12→13 needs 469).
  - L15 final-stage boss vs L12: 1,312 EXP, about 2.5 levels.
  - The level ratio automatically cuts the reward for over-levelled dragons.

## 5. The type chart as rock-paper-scissors

**Pokemon (Gen VI+, 18 types)** has 51 super-effective pairs, 61 resisted pairs and 8 immunities out of 324 (pokemondb and PokeAPI agree). A script enumerated its 3-cycles.
- **Strict triangles** (every reverse matchup is 0.5× or 0×):
  1. Grass > Water > Fire > Grass (the starter triangle)
  2. Fighting > Dark > Psychic > Fighting (Psychic is 0× vs Dark)
  3. Poison > Grass > Ground > Poison
  4. Rock > Flying > Fighting > Rock
  5. Steel > Rock > Fire > Steel
- **Loose triangles** (at least one reverse is 1×): Fire>Ice>Ground, Flying>Fighting>Ice, Grass>Rock>Flying, Ground>Rock>Ice, Ground>Steel>Ice, Ground>Fire>Grass, Ice>Grass>Rock, Rock>Fire>Grass, Rock>Bug>Grass, Steel>Fairy>Fighting, Water>Ground>Electric.
- **Archetypes in the chart:**
  - Steel is the defensive king (10 resistances + 1 immunity).
  - Normal hits nothing super-effectively; its strong stats pay for that.
  - Ice is offensively strong but has 4 weaknesses and 1 resistance.
  - Ghost and Dragon are super-effective against themselves.

**Our 16×16 chart (design).**
- **Balance rules, verified by script:**
  - Every attacking type hits 2–4 types for 2× and is resisted (0.5×) by 2–4 types.
  - It has at most 1 no-effect target, and 0.5× plus 0× is never more than 4.
  - Every defending type has 2–4 weaknesses.
- **Totals:** 48 super-effective (18.8%), 52 resisted (20.3%), 4 immune (1.6%) and 152 neutral out of 256. Pokemon's shares are 15.7%, 18.8% and 2.5%.
- **Change after the first draft (the chart in `src/data/types.ts` is the source of truth).** Two COOKING cells moved:
  - **FIRE → COOKING is 2× (was 0.5×):** fire overcooks the cook's dinner. The first villain org, the Big Cheese Crew, is FLUFF / COOKING / EARTH, and with COOKING resisting FIRE the FIRE starter had no good answer to half of its first opponents (the Big Cheese himself is COOKING / FLUFF). Now FIRE, WATER, WINGED and SLIME all beat COOKING, which keeps its four weaknesses inside the 2–4 rule.
  - **COOKING → COOKING is 0.5× (was 1×):** a chef shrugs off another chef's tricks. Losing the FIRE resistance left COOKING resisting only LEAF; the mirror resistance gives it a second one (like FIRE, WATER, LEAF and METAL) and keeps COOKING's attack resisted by 4 types (FIRE, WATER, METAL, COOKING).
  - The kitchen triangle (COOKING > LEAF > WATER > COOKING) and every other clean triangle are unchanged; `tools/contenttest.ts` re-checks all the balance rules on the live chart.

| Attacking type | 2× against | 0.5× against | 0× | Thematic justification (Pokemon basis unless marked "new") |
|---|---|---|---|---|
| FLUFF | DARKNESS, MIND | ROCK, METAL, BRAWL | – | New 2×: a big warm hug chases off the dark, and a fluffy distraction breaks any concentration. Normal had no 2× targets; FLUFF gets 2 because of the 2-minimum rule. ROCK and METAL resist as in Pokemon; new: pillow punches bounce off a brawler. |
| FIRE | LEAF, FROST, METAL, COOKING | FIRE, WATER, ROCK | – | Burns plants, melts ice and metal. New: overcooks the cook's dinner (COOKING; this was 0.5× in the first draft, see above). Dragon's resistance is gone. |
| WATER | FIRE, EARTH, ROCK, COOKING | WATER, LEAF, WINGED | – | Douses fire, erodes earth and stone. New: floods the kitchen and makes the snacks soggy. New: water rolls off a duck's back (WINGED resists). |
| LEAF | WATER, EARTH, ROCK | FIRE, LEAF, SLIME, COOKING | – | Drinks water; roots crack soil and stone. New: COOKING resists because chefs chop greens into salad. Flying, Steel and Dragon resistances dropped to cap at 4. |
| LIGHTNING | WATER, WINGED | LIGHTNING, LEAF, SLIME | EARTH | Shocks water and birds; grounded by earth. New: rubbery goo insulates (SLIME resists). |
| EARTH | FIRE, LIGHTNING, SLIME, METAL | LEAF, FROST, LIGHT | WINGED | Smothers fire, grounds sparks, buries goo and metal. Rock dropped to cap at 4. New: permafrost won't budge (FROST); you can't bury a sunbeam (LIGHT). Flyers soar over quakes. |
| ROCK | FIRE, FROST, WINGED | BRAWL, EARTH, METAL | – | Smashes fire, ice and birds. Bug's weakness disappears with the SLIME merge. |
| WINGED | BRAWL, SLIME, COOKING | LIGHTNING, ROCK, METAL | – | Out-manoeuvres brawlers; birds eat bugs and slugs (Flying > Bug). New: seagulls snatch your snacks. Flying > Grass dropped so LEAF stays at 4 weaknesses. |
| FROST | LEAF, EARTH, WINGED | FIRE, WATER, FROST, METAL | – | Frost kills crops, freezes the ground, ices wings. Dragon is gone. |
| SLIME | LEAF, LIGHTNING, LIGHT, COOKING | SLIME, EARTH, WINGED | METAL | Weedkiller (Poison > Grass); goo gums up sparkle (Poison > Fairy). New: food poisoning (COOKING); goo gums up the circuits (LIGHTNING). Flying resists Bug; Steel is immune to Poison. Rock's resistance dropped to cap at 4. |
| DARKNESS | MIND, LIGHT | BRAWL, DARKNESS | – | Preys on fearful minds (Dark > Psychic). New: darkness swallows light. LIGHT and DARKNESS are 2× against each other, like Pokemon's Dragon and Ghost mirrors, so whoever strikes first wins. |
| LIGHT | BRAWL, DARKNESS | FIRE, SLIME, METAL | – | Fairy > Fighting/Dark: dazzles bullies, dispels the dark. Fire, Poison and Steel resist as in Pokemon. |
| COOKING | LEAF, FROST, FLUFF | FIRE, WATER, METAL, COOKING | – | All new. Chops veggies; thaws frozen food; no hamster can resist the smell of fresh treats. Fire is its tool, you can't burn soup, pots and pans are metal, and a chef shrugs off another chef's tricks (COOKING, added after the first draft). |
| METAL | FROST, ROCK, LIGHT | FIRE, WATER, LIGHTNING, METAL | – | Shatters ice and rock; tarnishes sparkle (Steel > Fairy). |
| MIND | BRAWL, SLIME | MIND, METAL, FLUFF | DARKNESS | Outsmarts brawlers and sludge (Psychic > Fighting/Poison). New: nothing much goes on inside a fluffy head. Dark is immune as in Pokemon. |
| BRAWL | FLUFF, ROCK, DARKNESS, METAL | SLIME, WINGED, MIND, LIGHT | – | Fighting > Normal/Rock/Dark/Steel. Ice dropped so FROST stays at 4 weaknesses. Ghost's immunity is gone with Ghost. |

Full grid (rows attack, columns defend; **2** = 2×, ½ = 0.5×, 0 = no effect, · = 1×). Abbreviations: FLF FLUFF, FIR FIRE, WAT WATER, LEF LEAF, LTN LIGHTNING, ERT EARTH, RCK ROCK, WNG WINGED, FRS FROST, SLM SLIME, DRK DARKNESS, LGT LIGHT, COK COOKING, MTL METAL, MND MIND, BRL BRAWL.

| Atk \ Def | FLF | FIR | WAT | LEF | LTN | ERT | RCK | WNG | FRS | SLM | DRK | LGT | COK | MTL | MND | BRL |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FLF | · | · | · | · | · | · | ½ | · | · | · | **2** | · | · | ½ | **2** | ½ |
| FIR | · | ½ | ½ | **2** | · | · | ½ | · | **2** | · | · | · | **2** | **2** | · | · |
| WAT | · | **2** | ½ | ½ | · | **2** | **2** | ½ | · | · | · | · | **2** | · | · | · |
| LEF | · | ½ | **2** | ½ | · | **2** | **2** | · | · | ½ | · | · | ½ | · | · | · |
| LTN | · | · | **2** | ½ | ½ | 0 | · | **2** | · | ½ | · | · | · | · | · | · |
| ERT | · | **2** | · | ½ | **2** | · | · | 0 | ½ | **2** | · | ½ | · | **2** | · | · |
| RCK | · | **2** | · | · | · | ½ | · | **2** | **2** | · | · | · | · | ½ | · | ½ |
| WNG | · | · | · | · | ½ | · | ½ | · | · | **2** | · | · | **2** | ½ | · | **2** |
| FRS | · | ½ | ½ | **2** | · | **2** | · | **2** | ½ | · | · | · | · | ½ | · | · |
| SLM | · | · | · | **2** | **2** | ½ | · | ½ | · | ½ | · | **2** | **2** | 0 | · | · |
| DRK | · | · | · | · | · | · | · | · | · | · | ½ | **2** | · | · | **2** | ½ |
| LGT | · | ½ | · | · | · | · | · | · | · | ½ | **2** | · | · | ½ | · | **2** |
| COK | **2** | ½ | ½ | **2** | · | · | · | · | **2** | · | · | · | ½ | ½ | · | · |
| MTL | · | ½ | ½ | · | ½ | · | **2** | · | **2** | · | · | **2** | · | ½ | · | · |
| MND | ½ | · | · | · | · | · | · | · | · | **2** | 0 | · | · | ½ | ½ | **2** |
| BRL | **2** | · | · | · | · | · | **2** | ½ | · | ½ | **2** | ½ | · | **2** | ½ | · |

**Defensive profile.** "Avg ×" is the mean multiplier taken from all 16 attacking types; 1.00 is neutral and lower is tougher.

| Defending type | Weak to (2×) | Resists (0.5×) | Immune | Avg × taken |
|---|---|---|---|---|
| FLUFF | COOKING, BRAWL | MIND | – | 1.09 |
| FIRE | WATER, EARTH, ROCK | FIRE, LEAF, FROST, LIGHT, COOKING, METAL | – | 1.00 |
| WATER | LEAF, LIGHTNING | FIRE, WATER, FROST, COOKING, METAL | – | 0.97 |
| LEAF | FIRE, FROST, SLIME, COOKING | WATER, LEAF, LIGHTNING, EARTH | – | 1.13 |
| LIGHTNING | EARTH, SLIME | LIGHTNING, WINGED, METAL | – | 1.03 |
| EARTH | WATER, LEAF, FROST | ROCK, SLIME | LIGHTNING | 1.06 |
| ROCK | WATER, LEAF, METAL, BRAWL | FLUFF, FIRE, WINGED | – | 1.16 |
| WINGED | LIGHTNING, ROCK, FROST | WATER, SLIME, BRAWL | EARTH | 1.03 |
| FROST | FIRE, ROCK, COOKING, METAL | EARTH, FROST | – | 1.19 |
| SLIME | EARTH, WINGED, MIND | LEAF, LIGHTNING, SLIME, LIGHT, BRAWL | – | 1.03 |
| DARKNESS | FLUFF, LIGHT, BRAWL | DARKNESS | MIND | 1.09 |
| LIGHT | SLIME, DARKNESS, METAL | EARTH, BRAWL | – | 1.13 |
| COOKING | FIRE, WATER, WINGED, SLIME | LEAF, COOKING | – | 1.19 |
| METAL | FIRE, EARTH, BRAWL | FLUFF, ROCK, WINGED, FROST, LIGHT, COOKING, METAL, MIND | SLIME | 0.88 |
| MIND | FLUFF, DARKNESS | MIND, BRAWL | – | 1.06 |
| BRAWL | WINGED, LIGHT, MIND | FLUFF, ROCK, DARKNESS | – | 1.09 |

- **Where weak typing is offset by stats:**
  - METAL stays the defensive type (8 resistances + 1 immunity, down from Steel's 10 + 1); its 0.60 Speed and 0.70 SpA pay for it.
  - FROST, COOKING, ROCK, LIGHT and LEAF take the most damage on average. Their templates make up for it with high HP (FROST, COOKING), Def (ROCK) or SpD (LIGHT, LEAF).
- **Offense** ranges from 0.97 (LIGHTNING, MIND) to 1.16 (FIRE, WATER) average multiplier dealt.

**Clean triangles in our chart.** All 8 strict cycles the script found; each reverse matchup is 0.5× or 0×.

| # | Triangle | Reverse multipliers | Flavour |
|---|---|---|---|
| 1 | **FIRE > LEAF > WATER > FIRE** (starter triangle) | LEAF→FIRE ½, WATER→LEAF ½, FIRE→WATER ½ | Burns, drinks, douses |
| 2 | **COOKING > LEAF > WATER > COOKING** (kitchen triangle) | LEAF→COOKING ½, WATER→LEAF ½, COOKING→WATER ½ | Chop the greens, greens drink the water, water floods the kitchen |
| 3 | **FLUFF > MIND > BRAWL > FLUFF** (hug triangle) | MIND→FLUFF ½, BRAWL→MIND ½, FLUFF→BRAWL ½ | Cuteness breaks concentration, brains beat brawn, brawn bowls over the fluffball |
| 4 | **SLIME > LIGHTNING > WINGED > SLIME** (storm triangle) | LIGHTNING→SLIME ½, WINGED→LIGHTNING ½, SLIME→WINGED ½ | Goo gums up the spark, the spark zaps the bird, the bird eats the slug |
| 5 | **BRAWL > DARKNESS > MIND > BRAWL** (shadow triangle) | DARKNESS→BRAWL ½, MIND→DARKNESS 0, BRAWL→MIND ½ | Pokemon's Fighting > Dark > Psychic |
| 6 | SLIME > LEAF > EARTH > SLIME (garden triangle) | ½, ½, ½ | Pokemon's Poison > Grass > Ground |
| 7 | ROCK > WINGED > BRAWL > ROCK (mountain triangle) | ½, ½, ½ | Pokemon's Rock > Flying > Fighting |
| 8 | METAL > ROCK > FIRE > METAL (forge triangle) | ½, ½, ½ | Pokemon's Steel > Rock > Fire |

- **Five headline triangles.** Rows 1–5 fit the user's "5 of everything". Each villain org can be built around one triangle (design).
- **Mutual pair.** LIGHT ↔ DARKNESS (both 2×).
- **Loose cycles** (at least one reverse is 1×): FIRE>LEAF>EARTH, FIRE>LEAF>ROCK, FIRE>FROST>EARTH, WATER>EARTH>LIGHTNING, LEAF>ROCK>FROST, EARTH>METAL>FROST, WINGED>COOKING>FROST, DARKNESS>LIGHT>BRAWL, LIGHT>BRAWL>METAL.
- **Two starters.** The player starts with 2 dragons. Any two members of a strict triangle cover each other: in A > B > C > A, the third type C beats A but loses to B. So two starters from triangle 1 (or 2) always have an answer to the third.

**Rock-paper-scissors in the battle UI, applied to enemies as well (design).**
- **Same chart for everyone.** Villain dragons use the same chart and types, and every minion and boss shows its type chips.
- **Move buttons.** Each button shows its effectiveness against the current enemy: "SUPER ×2", "OK", "WEAK ×½" or "NO EFFECT".
- **Threat warning.** A warning icon appears when the enemy's type is super-effective against your active dragon. This is our addition; Pokemon does not show it.
- **Triangle widget.** A small widget shows the active matchup's triangle with arrows.
- **Hit messages** use Pokemon wording: "It's super effective!", "It's not very effective…", "It doesn't affect…".
- **Dual types** (rare dragons and bosses) multiply, giving ×4 and ×0.25. The badge shows the product.
- **Boss phase changes.** When a Phase Shift boss changes type, the widget and badges update so the player can re-read the triangle.

## 6. Sources

Stats and species data
- PokeAPI GraphQL, all 1,025 species (base stats, types, evolution and legendary flags): https://graphql.pokeapi.co/v1beta2 (docs: https://pokeapi.co/)
- PokeAPI REST, species, Pokemon, moves and types: https://pokeapi.co/api/v2/pokemon-species/2/ ; https://pokeapi.co/api/v2/pokemon/{name} ; https://pokeapi.co/api/v2/move/{name} ; https://pokeapi.co/api/v2/type/{name}
- Pokemon Database, full stats cross-check: https://pokemondb.net/pokedex/all
- PokeBase, highest average stat per type: https://pokemondb.net/pokebase/438707/which-types-have-the-highest-average-for-each-stat
- NationalDex, pseudo-legendary definition: https://nationaldex.io/pseudo-legendary
- Bulbapedia, pseudo-legendary and base stats (via search results; direct fetches returned 403): https://bulbapedia.bulbagarden.net/wiki/Pseudo-legendary_Pok%C3%A9mon ; https://bulbapedia.bulbagarden.net/wiki/Base_stat
- Type speed analysis: https://jdylanwhite.github.io/projects/pokedex/eda_types.html

Abilities
- Pokemon Showdown data, ability frequencies and ratings: https://play.pokemonshowdown.com/data/pokedex.js ; https://play.pokemonshowdown.com/data/abilities.js
- PokeAPI abilities: https://pokeapi.co/api/v2/ability/{name}
- Pokemon Database abilities: https://pokemondb.net/ability ; https://pokemondb.net/ability/snow-warning ; https://pokemondb.net/ability/gale-wings ; https://pokemondb.net/ability/supreme-overlord ; https://pokemondb.net/ability/hospitality
- Serebii AbilityDex: https://serebii.net/abilitydex/supremeoverlord.shtml ; https://www.serebii.net/abilitydex/hospitality.shtml ; https://www.serebii.net/abilitydex/purifyingsalt.shtml ; https://www.serebii.net/abilitydex/cudchew.shtml ; https://www.serebii.net/abilitydex/weakarmor.shtml ; https://www.serebii.net/abilitydex/prankster.shtml ; https://www.serebii.net/abilitydex/intimidate.shtml ; https://www.serebii.net/abilitydex/protosynthesis.shtml ; https://www.serebii.net/abilitydex/angershell.shtml ; https://www.serebii.net/abilitydex/disguise.shtml ; https://www.serebii.net/abilitydex/sniper.shtml ; https://www.serebii.net/abilitydex/schooling.shtml
- Serebii, Gen IX snow: https://www.serebii.net/scarletviolet/snow.shtml
- Bulbapedia, Pixilate and Electric Terrain (search snippets): https://bulbapedia.bulbagarden.net/wiki/Pixilate_(Ability) ; https://bulbapedia.bulbagarden.net/wiki/Electric_Terrain_(move)
- SuperCheats, Gen VII ability updates: https://www.supercheats.com/pokemon-sun/walkthrough/updated-abilities
- GameWith, Supreme Overlord cap: https://gamewith.ai/pokemon-champions/en/abilities/292

Mechanics
- Smogon, complete damage formula: https://www.smogon.com/bw/articles/bw_complete_damage_formula
- Smogon, priority brackets: https://www.smogon.com/resources/competitive/bw/priority
- Serebii, stats, critical hits, statuses and EXP: https://www.serebii.net/games/stats.shtml ; https://serebii.net/games/criticalhits.shtml ; https://www.serebii.net/games/status.shtml ; https://www.serebii.net/games/exp.shtml
- Serebii, Legends: Arceus frostbite (basis for CHILL): https://serebii.net/legendsarceus/frostbitedrowsy.shtml
- Bulbapedia, Freeze page (frostbite 1/16 HP; search snippet): https://bulbapedia.bulbagarden.net/wiki/Freeze
- Dragonfly Cave, battle mechanics, stat stages and status ailments: https://www.dragonflycave.com/mechanics/battle ; https://www.dragonflycave.com/mechanics/stat-stages ; https://www.dragonflycave.com/mechanics/status-ailments
- Bulbagarden forum, Gen VII trainer-EXP bonus removal (search snippet only): https://bulbagarden.net/threads/sun-and-moons-level-100-grind.244078/
- Veekun, Struggle: https://veekun.com/dex/moves/struggle

Type chart
- Pokemon Database type chart: https://pokemondb.net/type
- Serebii, Gen VI type chart: https://serebii.net/games/typexy.shtml
- Bulbapedia, Generation VI changes (Fairy added; Steel lost Ghost and Dark resistances; search snippet): https://bulbapedia.bulbagarden.net/wiki/Generation_VI
- Our 16×16 chart, triangle list, stat templates, damage example and EXP tables were computed and checked with local Python scripts (design).
