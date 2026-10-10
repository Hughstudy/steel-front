# Steel Front balance

All combat numbers live in `data/units.json`, `data/weapons.json` and `data/combat.json`. This file explains where they come from and what they produce in play. Regenerate the tables below from the JSON if the data changes.

## Source anchors: Spring: 1944

Tank, gun and artillery values are anchored on the open-source RTS **Spring: 1944** (S44), <https://github.com/spring1944/spring1944>, pinned at commit `36b570c251a924a372e8054e3ccf5d03b656a83e` (retrieved 2026-10-10). The raw extraction, with per-value source links, is in `docs/spring1944-source-notes.md`.

**Licence and attribution.** S44 game data is released under Creative Commons BY-NC 3.0 and its Lua code under the GPL (`docs/License.txt` in that repository). Steel Front copies no S44 code, tables or assets. It uses S44 values only as *ratios*: relative armour, penetration, range, reload and durability between historical vehicles. Every number below has been transformed by the formulas in this file and then hand-tuned. Credit: balance ratios inspired by Spring: 1944, by the Spring: 1944 development team. This note is not legal advice.

## Normalisation formulas

S44 units (elmos, seconds, mm, mass-derived HP) were converted to Steel Front units (tiles, 20 Hz ticks, integer HP):

| Quantity | Formula | Notes |
|---|---|---|
| Vehicle HP | `S44 post-processed maxdamage / 6`, rounded | S44 computes vehicle HP from mass: `3.25^log10(mass) × 50`. |
| Armour value (mm) | Effective frontal hull: `thickness / cos(slope)`, rounded, lightly tuned | One number per unit; no facing or flanking model yet. |
| Weapon range (tiles) | `4 + S44 range (after ×0.6 post-processing) / 250` | Artillery is capped at 16 tiles so it stays on the 128×128 map. |
| Reload (ticks) | `S44 reload seconds × 12` | Faster than real time (20 ticks/s), matching RA2-paced fights. |
| AP damage | `S44 damage / 20`, rounded | Then scaled by penetration and armour class. |
| Penetration (mm) | S44 penetration at 100 m, as written | |

**Damage per hit** (integer, `src/sim/combat.ts` `damageOf`):

```
damage × class% × pen% × (100 + vetDamage%) × (100 − vetArmor%) / 1e8, minimum 1 when class% > 0
pen% (AP only) = clamp(floor(penetration² × 100 / armour²), minPenetrationPercent = 15, 100)
```

The squared penetration ratio makes under-penetrating guns fall off steeply: a 37 mm gun (63 mm) against a Tiger (104 mm) does 36%, while the 88 mm (120 mm) always penetrates a Sherman. Small arms and HE ignore armour thickness and use only the class percentage.

## Substitutions and provisional values

- **Allied heavy tank:** the plan suggested an M26 Pershing, which does not exist in S44. Steel Front uses the **M4A3E2 "Jumbo"** Sherman, which S44 does define: heavy armour, the same 75 mm gun and slow.
- **Allied AT gun:** the M1 57 mm gun is not in S44 (only the British 6-pdr is). Steel Front uses the **3-inch Gun M5**, which S44 does define.
- **Not from S44** (chosen for RA2-style play): all small arms (rifles, MGs, snipers, coax and halftrack MGs), fighters and their guns, halftrack and truck stats, towed-gun HP, every price (S44 has a different economy), and vision radii.
- **Towed-gun armour class `gun`:** towed guns are small, crewed targets. They shrug off AP shot (15%) but die quickly to small arms (50%) and HE (100%). This gives the intended counter loop: AT gun beats tank, infantry and MGs beat AT gun, and tanks beat AT guns only from outside the guns' range or with support.

## Armour classes (`data/combat.json`, percent of damage taken)

| Class | small | he | ap |
|---|---|---|---|
| infantry | 100 | 100 | 25 |
| light | 25 | 60 | 100 |
| heavy | 4 | 30 | 100 |
| building | 8 | 70 | 45 |
| aircraft | 60 | 0 | 60 |
| gun | 50 | 100 | 15 |

Veterancy (`combat.veterancy`) promotes at 100% and 300% of the unit's own cost in kills. Veteran gives +10% damage, 10% faster reload and 10% damage reduction; elite gives +25%, 20% and 25%.

## Units

| Unit | Name | Cost | HP | Class | Armor (mm) | Speed | Vision | Weapons |
|---|---|---|---|---|---|---|---|---|
| `allied_rifle` | Rifle Squad | 100 | 125 | infantry | 0 | 1.15 | 6 | rifle_garand |
| `allied_mg` | MG Team (M1919) | 250 | 110 | infantry | 0 | 1.0 | 6 | mg_browning |
| `allied_sniper` | Sniper | 400 | 70 | infantry | 0 | 1.1 | 9 | sniper_springfield |
| `allied_engineer` | Combat Engineer | 500 | 75 | infantry | 0 | 1.1 | 5 | — |
| `allied_halftrack` | M3 Halftrack | 450 | 260 | light | 13 | 2.2 | 7 | hmg_m2 |
| `allied_light_tank` | M5 Stuart | 650 | 354 | light | 45 | 2.0 | 7 | gun_37mm, coax_mg |
| `allied_medium_tank` | M4 Sherman | 950 | 517 | heavy | 96 | 1.8 | 7 | gun_75mm_m3, coax_mg |
| `allied_heavy_tank` | M4A3E2 Jumbo | 2200 | 601 | heavy | 155 | 1.2 | 7 | gun_75mm_m3, coax_mg |
| `allied_at_gun` | 3-inch Gun M5 | 600 | 160 | gun | 12 | 0.8 | 6 | at_3inch |
| `allied_artillery` | M2A1 Howitzer | 900 | 180 | gun | 10 | 0.7 | 6 | how_m2a1 |
| `allied_truck` | Supply Truck | 800 | 300 | light | 8 | 1.6 | 5 | — |
| `allied_fighter` | P-51 Mustang | 1200 | 220 | aircraft | 0 | 7.0 | 8 | air_browning |
| `allied_mcv` | M4 Mobile Construction Vehicle | 3000 | 1000 | heavy | 30 | 0.9 | 6 | — |
| `axis_rifle` | Grenadier Squad | 100 | 125 | infantry | 0 | 1.15 | 6 | rifle_kar98 |
| `axis_mg` | MG42 Team | 250 | 110 | infantry | 0 | 1.0 | 6 | mg_mg42 |
| `axis_sniper` | Scharfschütze | 400 | 70 | infantry | 0 | 1.1 | 9 | sniper_kar98 |
| `axis_engineer` | Pioniere | 500 | 75 | infantry | 0 | 1.1 | 5 | — |
| `axis_halftrack` | Sd.Kfz. 251 | 450 | 270 | light | 14 | 2.1 | 7 | hmg_mg34 |
| `axis_light_tank` | Panzer III | 800 | 421 | light | 72 | 1.8 | 7 | gun_50mm, coax_mg |
| `axis_medium_tank` | Panzer IV | 950 | 467 | heavy | 81 | 1.7 | 7 | gun_75mm_kwk40, coax_mg |
| `axis_heavy_tank` | Tiger I | 2300 | 697 | heavy | 104 | 1.3 | 7 | gun_88mm, coax_mg |
| `axis_at_gun` | PaK 40 | 650 | 160 | gun | 12 | 0.8 | 6 | at_pak40 |
| `axis_artillery` | leFH 18 | 900 | 180 | gun | 10 | 0.7 | 6 | how_lefh18 |
| `axis_truck` | Opel Blitz | 800 | 300 | light | 8 | 1.6 | 5 | — |
| `axis_fighter` | Bf 109 | 1200 | 220 | aircraft | 0 | 7.0 | 8 | air_mg151 |
| `axis_mcv` | Bau-Kraftwagen | 3000 | 1000 | heavy | 30 | 0.9 | 6 | — |

## Weapons

| Weapon | Type | Damage | Pen (mm) | Range | Reload (ticks) | Splash | Setup | Targets |
|---|---|---|---|---|---|---|---|---|
| `rifle_garand` (M1 Garand volley) | small | 12 | 0 | 5 | 20 | 0 | 0 | ground |
| `rifle_kar98` (Kar98k volley) | small | 13 | 0 | 5.5 | 22 | 0 | 0 | ground |
| `mg_browning` (M1919 Browning) | small | 8 | 0 | 6 | 4 | 0 | 0 | ground/air |
| `mg_mg42` (MG42) | small | 6 | 0 | 6 | 3 | 0 | 0 | ground/air |
| `sniper_springfield` (M1903 Springfield) | small | 70 | 0 | 9 | 60 | 0 | 0 | ground |
| `sniper_kar98` (Kar98k scoped) | small | 72 | 0 | 9 | 62 | 0 | 0 | ground |
| `hmg_m2` (M2 .50 cal) | small | 7 | 0 | 5.5 | 4 | 0 | 0 | ground/air |
| `hmg_mg34` (MG34 mount) | small | 6 | 0 | 5.5 | 4 | 0 | 0 | ground/air |
| `coax_mg` (Coaxial MG) | small | 7 | 0 | 5 | 5 | 0 | 0 | ground |
| `gun_37mm` (37 mm M6) | ap | 47 | 63 | 6.4 | 30 | 0 | 0 | ground |
| `gun_50mm` (5 cm KwK 39) | ap | 72 | 69 | 6.7 | 59 | 0 | 0 | ground |
| `gun_75mm_m3` (75 mm M3) | ap | 128 | 71 | 7.0 | 63 | 0 | 0 | ground |
| `gun_75mm_kwk40` (7.5 cm KwK 40) | ap | 131 | 91 | 7.6 | 77 | 0 | 0 | ground |
| `gun_88mm` (8.8 cm KwK 36) | ap | 158 | 120 | 9.1 | 110 | 0 | 0 | ground |
| `at_3inch` (3-inch Gun M5 (M7 AP)) | ap | 132 | 100 | 8.2 | 81 | 0 | 30 | ground |
| `at_pak40` (7.5 cm PaK 40) | ap | 131 | 91 | 8.1 | 77 | 0 | 30 | ground |
| `how_m2a1` (105 mm M2A1) | he | 170 | 0 | 16 | 135 | 1.6 | 40 | ground |
| `how_lefh18` (10.5 cm leFH 18) | he | 168 | 0 | 16 | 135 | 1.6 | 40 | ground |
| `air_browning` (6× .50 cal wing guns) | small | 9 | 0 | 4.5 | 3 | 0 | 0 | air/ground |
| `air_mg151` (MG 151/20 + MG 131) | small | 10 | 0 | 4.5 | 4 | 0 | 0 | air/ground |

## Observed matchups

These come from a headless duel harness: two sides on the open west-bank meadow with fog off, both idle and auto-acquiring, 20 ticks/s, seed 11. Each line shows the starting distance, the winner, the time to kill and the survivors.

| Matchup | Distance (tiles) | Result |
|---|---|---|
| 1 Rifle Squad vs 1 Grenadier Squad | 4 | Grenadiers win, 9.9 s (Kar98 out-ranges slightly) |
| 1 MG Team (M1919) vs 2 Grenadier Squads | 5 | MG wins, 6.3 s |
| 1 Sherman vs 1 Panzer IV | 6 | Sherman wins, 12.9 s (cheaper Pz IV is more fragile) |
| 3 Shermans vs 1 Tiger | 7 | Shermans win, 19.2 s, 2 survive |
| 1 Jumbo vs 1 Tiger | 7 | Tiger wins, 33.9 s |
| 1 3-inch Gun vs 1 Panzer IV | 7 / 8 | Gun wins, 13.8 s |
| 1 3-inch Gun vs 1 Tiger | 8 | Gun wins, 21.9 s |
| 1 PaK 40 vs 1 Sherman | 7 | PaK wins, 17.1 s |
| 1 PaK 40 vs 1 Jumbo | 8 | PaK wins, 51.8 s (Jumbo armour 155 mm vs 91 mm pen) |
| 3 Rifle Squads vs 1 PaK 40 | 4 | Rifles win, 8.1 s, no losses |
| 1 MG Team vs 1 PaK 40 | 5 | MG wins, 7.9 s |
| 1 Stuart vs 3 Grenadier Squads | 5 | Stuart wins, 39.3 s |
| 4 Rifle Squads vs 1 Panzer III | 4 | Panzer III wins, 15.1 s |
| 1 M2A1 Howitzer vs 3 Grenadier Squads | 12 | Howitzer wins, 9.9 s (out of rifle range) |
| 1 P-51 vs 1 Bf 109 | 8 | P-51 wins, 12.0 s |

`tests/combat.test.ts` asserts the key relationships: AT guns beat equal-cost rifles on a Tiger, artillery out-ranges tanks and AT guns, and fighters counter fighters.

## Computer opponent difficulty

Every AI level is limited by income: it spends credits as soon as they arrive. Faster decisions alone therefore do not make a stronger opponent. Difficulty is set per level in `data/ai.json`. Two knobs carry most of the gap:

- `incomePercent` scales this computer player's truck deliveries and oil payouts (Recruit 75%, Regular 100%, Veteran 130%). Human players always earn the base amount. This is an explicit, documented AI handicap/bonus, as in many RTS games.
- `waveCommitPercent` sets how much of the army beyond the home reserve a wave commits. Veteran commits all of it (waves from 8 units, every 3000 ticks, at most 40); Recruit and Regular send exactly the scheduled size.

Waves draw units round-robin across unit types, so attacks are mixed arms.

Measured AI-vs-AI over 8 games per pairing (2 maps × 2 spawns × 2 factions):

| Pairing | Won–lost–drawn |
|---|---|
| Veteran vs Recruit | 8–0–0 |
| Veteran vs Regular | 8–0–0 |
| Regular vs Recruit | 7–1–0 |

Against a passive player who only deploys, time to defeat (Recruit / Regular / Veteran):

| Map | Recruit | Regular | Veteran |
|---|---|---|---|
| Lowlands | 14.3 min | 9.6 min | 7.3 min |
| Ardennes | 11.3 min | 11.1 min | 10.1 min |

Each map gives both spawns two oil derricks on their own half. Even so, mirror matches are decided by terrain: the Lowlands favours the west spawn and the Ardennes the east.
