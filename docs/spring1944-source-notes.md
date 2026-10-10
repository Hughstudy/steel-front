# Spring: 1944 balance source notes

These are reference values taken from the open-source game Spring: 1944 (S44). They are anchors for balancing Steel Front. They are not Steel Front values. Normalise them before use.

## Provenance

| Item | Value |
|---|---|
| Repository | https://github.com/spring1944/spring1944 |
| Default branch | `master` |
| Pinned commit SHA | `36b570c251a924a372e8054e3ccf5d03b656a83e` |
| Commit date | 2026-08-15T13:39:59Z ("Merge pull request #483 from GoogleFrog/master", ZK map startbox support) |
| Date retrieved | 2026-10-10 |
| How the SHA was found | GitHub API `GET /repos/spring1944/spring1944/commits/HEAD`. Paths came from `GET /repos/spring1944/spring1944/git/trees/<sha>?recursive=1`, which returned 6,992 blobs and was not truncated. |
| License | GitHub's API reports no SPDX license. `README.md` points to `docs/License.txt`, which says: "All Lua code included in this game is licensed under the GPL by their respective authors, unless otherwise stated in the script. All other information in this game is hereby released under the Creative Commons BY-NC 3.0 license." The full texts are in `docs/GNU_PUBLIC_LICENSE.txt` and `docs/CC_LICENSE.txt`. The armor gadget's own header says "GNU LGPL, v2.1 or later". |

License source: https://raw.githubusercontent.com/spring1944/spring1944/36b570c251a924a372e8054e3ccf5d03b656a83e/docs/License.txt

License caution: unit and weapon data counts as "other information", so it falls under CC BY-NC 3.0, a non-commercial license that requires attribution. Two things are generally treated as safe: balance ratios used as inspiration, and your own independently chosen numbers. Copying S44 data tables or Lua code verbatim would carry the BY-NC (data) or GPL (code) obligations. This note is not legal advice.

All links below use this prefix (`R/`):
`R/` = `https://raw.githubusercontent.com/spring1944/spring1944/36b570c251a924a372e8054e3ccf5d03b656a83e/`

## How S44 definitions are structured (read before using the numbers)

1. **Classes and inheritance.** `gamedata/unitdefs_pre.lua` defines `Def:New`. When a child is created, its keys are copied first, and the parent then fills only the keys the child left empty. The child always wins. With `A:New(B)`, B's keys override A's. Unit base classes are in `BaseClasses/Units/*.lua` and weapon base classes in `BaseClasses/Weapons/**/*.lua`. Per-unit tables are in `units/<side>/**.lua` and per-weapon tables in `weapons/**.lua`. In the tables, "inherited" means the value comes from a base class and not from the unit or weapon's own file.
2. **Post-processing changes many raw values at load time.** The tables show the raw value from the file. Where post-processing changes a value, the result is in a separate column marked *(post)*. Those numbers are computed from the formulas in the source and are not literal values in the source files.
   - `gamedata/unitdefs_post.lua` (R/gamedata/unitdefs_post.lua):
     - `maxvelocity = customParams.maxvelocitykmh / 13.5`.
     - Every unit with `customparams.feartarget` (infantry, infantry guns) gets `maxvelocity × 0.5` (`infSpeedMult`).
     - **Ground vehicles that can move, cannot fly and have `footprintX > 1` ignore their `maxDamage`.** For them, `maxdamage = 3.25 ^ log10(mass) × 50` (`power_base` 3.25 and `scale_factor` 50 are mod-option defaults). If `mass` is not set, it defaults to `maxDamage`, so the file's `maxDamage` only acts as a mass proxy.
     - All other units get `maxdamage × maxDamageMul`.
     - `sightdistance` is overwritten by the unit's category, times `LoSMult` 0.6: INFANTRY 650, HARDVEH 125, OPENVEH 150, SOFTVEH 200, DEPLOYED 650, BUILDING 300, SHIP 300. Units with `cloakCost` set (snipers and scouts) then get sight × 0.5 and radar 0. Aircraft (`AIR`) match no category, so they keep the class value.
   - `gamedata/weapondefs_post.lua` (R/gamedata/weapondefs_post.lua):
     - **Every weapon without `customparams.no_range_adjust`** gets these multipliers:
       - `range × 0.6`
       - `weaponVelocity × 0.6^(2/3)` (= 0.711)
       - `accuracy`, `sprayAngle` and `targetMoveError × 1/√0.6` (= 1.291)
     - Penetration decay is rescaled to match the shorter ranges (see the armor section).
     - Howitzers and grenades get `weaponVelocity = sqrt(range × 120)`.
     - Damage-type multipliers from `gamedata/damagedefs.lua` are expanded per armor type. **The `default` entry is also multiplied**, so smallarm default damage becomes 1/6 of the file value.
3. **Units.** S44 does not state a metre conversion. Ranges, sight and speeds are Spring engine units (elmos; `maxVelocity` is elmos per sim frame, 30 frames/s, by engine convention). Reload is in seconds. Armor and penetration are in mm, per the comments in `game_armor.lua`.
4. **Infantry cost is per squad, not per soldier.** `BaseClasses/Units/Infantry.lua` sets `buildCostMetal = 65` with the comment "used only for power XP calcs". The real price is the squad's `buildCostMetal` in `LuaRules/Configs/side_squad_defs/<side>.lua`. Cost is in "command" points; `buildTime` defaults to `buildCostMetal`.

## Unit table

Column notes:
- **Cost**: `buildCostMetal`.
- **HP raw**: `maxDamage` as written in the file.
- **HP (post)**: the value computed by `unitdefs_post.lua`.
- **Speed**: `maxvelocitykmh` where set (kmh); otherwise `maxVelocity` (elmo/frame). The *(post)* value is `maxvelocity` in engine units after `/13.5` or `×0.5`.
- **Sight (post)**: the category-derived `sightdistance` after the 0.6 multiplier.
- **Armor**: `customParams.armour.<piece>.<side> = {thickness mm, slope deg}`. "–" means no slope was given.

### US / Allies

| Unit (S44 key) | Source | Cost | HP raw → (post) | Speed raw → (post) | Sight (post) | Armor (mm @ slope°) | Weapons (weapon slot names) | Other |
|---|---|---|---|---|---|---|---|---|
| M1 Garand Rifle (`usrifle`) | R/units/us/infantry/USInfantry.lua ; base R/BaseClasses/Units/Infantry.lua | Per soldier: 65 (inherited, "XP calcs only"). Squads: `us_platoon_hq` (4 rifle + 2 Thompson) **570**; `us_platoon_rifle` (8 rifle, 2 Thompson, 2 BAR) **1675**. Source: R/LuaRules/Configs/side_squad_defs/us.lua | 100 (inherited) × `maxDamageMul` 1.0 → **100** | 1.6 (inherited) → **0.8** | INFANTRY → **390** | none | `M1Garand`, `Mk2` grenade | `mass` 50; `damageModifier` 0.265; `flankingBonusMax/Min` 1.5/0.675 |
| Browning M1919A4 MG (`usmg`) | same USInfantry.lua; class `LMGInf` | 75 (class, "XP only"). Squad `us_platoon_mg` (3 MG + 1 scout): **1200** | 100 → **100** | 1.6 (inherited from Infantry; LMGInf does not override) → **0.8** | **390** | none | `M1919A4Browning` | A deployed variant also exists: `USMG_Sandbag` (`SandbagMG` class, maxDamage 1600, weapon `m1919a4browning_deployed`). The HMGInf class (maxVelocity 0.8) is not used by `usmg` |
| M1903A4 Sniper (`ussniper`) | same; class `SniperInf` | 300 (class, "XP only"). Squad `us_platoon_sniper` (sniper + scout): **1100** | 100 → **100** | 1.6 → **0.8** | 390 × 0.5 (cloak) → **195** | none | `M1903Springfield` | `minCloakDistance` 220 (× 0.6 post = 132); `decloakOnFire` true |
| Field Engineer (`ushqengineer`) | same; class `EngineerInf` | **260** (class value; built directly from HQ/barracks) | 100 → **100** | 1.6 → **0.8** | **390** | none | none | `workerTime` 15, `buildDistance` 128, `reclaimSpeed` 30, `canclearmines` true |
| M5A1 Stuart (`usm5stuart`) | R/units/us/tanks/USM5Stuart.lua ; base R/BaseClasses/Units/Tanks.lua (`LightTank`) | **1725** | 1520 → **2126.7** (mass proxy) | 58 kmh → **4.30** | HARDVEH → **75** | Hull F 29@50, S 29@–, R 25@-2, top 13. Turret F 44@13 ("not mantlet"), S 32@1, R 32@2, top 13 | `M637mmAP`, `M637mmCanister`, `M637mmHE`, `M1919A4Browning`, `M2BrowningAA` | `maxammo` 27; `turretturnspeed` 25.7; damageGroup `lightTanks`; `turnRate` 150 |
| M4A3 Sherman (`usm4a4sherman`; display name "M4A3 Sherman") | R/units/us/tanks/USShermans.lua ; base `MediumTank` | **2550** | 3180 → **3103.2** | 42 kmh (ShermanBase) → **3.11** | **75** | Hull F 64@48, S 38@–, R 38@21, top 20. Turret F 76@33, S 51@3, R 51@2, top 20 | `M375mmAP`, `M375mmHE`, 2× `M1919A4Browning`, `M2BrowningAA` | `maxammo` 20; `turretturnspeed` 26.5; damageGroup `mediumTanks` |
| **Heavy option:** M4A3E2 Sherman Jumbo (`usm4jumbo`) | same USShermans.lua (`USM4A4Sherman:New(HeavyTank)`) | **6530** | 4267 → **3607.2** | 35 kmh → **2.59** | **75** | Hull F 102@49, S 76@–, R 38@10 (thickness inherited from ShermanBase), top 20 (inherited). Turret F 152@12 ("not mantlet"), S 152@10, R 152@0, top 25 | Same as M4A3: `M375mmAP` / `M375mmHE` | damageGroup `heavyTanks`. **M26 Pershing: not found** (no Pershing file in the tree) |
| (Alt. heavy) M36 GMC Jackson (`usm36jackson`) | R/units/us/guns/USM36Jackson.lua (`MediumTank:New(TankDestroyer):New(OpenTopped)`) | **5410** | 3100 → **3063.0** | 44 kmh → **3.26** | OPENVEH → **90** | Hull F 38@55, S 19@38, R 19@42, top 10. Turret F 32@47, S 32@20, R 25@14, top 0 | `m390mmap`, `M2BrowningAA` | `maxammo` 13; `turretturnspeed` 10; damageGroup `lightTanks` (from OpenTopped) |
| **M1 57mm AT gun** | **not found.** The US gun files are M5 3-inch, M2 105mm, M1 Bofors, M1 4.5in, M7 Priest, M10 and M36. A 57mm weapon exists only as the British `QF6Pdr57mmAP` (weapon table) | – | – | – | – | – | – | Closest US towed AT gun is below |
| (US AT gun substitute) 3-Inch M5 (`usm5gun`) | R/units/us/guns/USM5Gun.lua ; base R/BaseClasses/Units/Gun.lua (`ATInfGun`) | **600** (tractor `USM5Gun_Truck` is also 600) | 300 (inherited InfantryGun) → **300** | 0.75 → **0.375** (needs crew) | DEPLOYED → **390** | none (`armor_front` = 1 flag only) | `M7ap` (resolves to `M7AP`, 3-inch/76.2mm) | `maxammo` 4; deployed variant `USM5Gun_Stationary` uses class `ATGun` (maxDamage 1500) |
| M2A1 105mm howitzer (`usm2gun`; display name "105mm M2") | R/units/us/guns/USM2Gun.lua ; base `HInfGun` | **1800** (inherited HInfGun; tractor `HGunTractor` also 1800) | 300 → **300** | 0.1 → **0.05** | **390** | none | `M2HE`, `M2smoke` | `maxammo` 4; deployed variant `USM2Gun_Stationary` (`HGun`, maxDamage 1500) |
| P-51D Mustang (`usp51dmustang`) | R/units/us/aircraft/USP51DMustang.lua ; base R/BaseClasses/Units/Aircraft.lua (`Fighter`) | **1080** | 346.5 → **346.5** (aircraft are not mass-scaled) | `maxVelocity` 24 (not changed) | `sightdistance` 0 (Aircraft base); `airSightDistance` 4000 | none | 6× `m2browningamg` | `maxAcc` 0.622; `maxFuel` 180 (Fighter); `cruiseAlt` 1500 |
| M3A1 Halftrack (`usm3halftrack`) | R/units/us/vehicles/USM3Halftrack.lua ; base R/BaseClasses/Units/Vehicles.lua (`HalfTrack`) | **1200** | 930 → **1653.8** | 72 kmh → **5.33** | OPENVEH → **90** | Hull F 13@30, S 6@–, R 6@–, top 0; turret 0 | `M2Browning` (.50), `M2BrowningAA` | `transportCapacity` 11; `supplyRange` 200. **Ambiguity:** `HalfTrack:New(USM3Base)` lets USM3Base (a `Vehicle`) override customParams, so `damageGroup` resolves to `unarmouredVehicles`, not HalfTrack's `armouredVehicles`. That is my reading of the inheritance code and has not been checked in game |
| GMC 2.5t supply truck (`usgmctruck`) | R/units/us/vehicles/USGMCTruck.lua ; base `Truck` + `TransportTruck` | **510** (TransportTruck) | maxDamage 300, `mass` 300 → **926.8** | `maxVelocity` 3.6 (raw elmo/frame, no kmh) | SOFTVEH → **120** | none | none | `transportCapacity` 15, `transportMass` 750; S44 says it must be deployed to resupply ammo |
| (Engineer vehicle) CCKW-353 (`usgmcengvehicle`) | R/units/us/vehicles/USGMCEngVehicle.lua ; base `EngineerVehicle` | **2700** | 1800 → **2318.9** | `maxVelocity` 3.4 | SOFTVEH → **120** | none | none | `workerTime` 30 |

### Germany / Axis

| Unit (S44 key) | Source | Cost | HP raw → (post) | Speed raw → (post) | Sight (post) | Armor (mm @ slope°) | Weapons | Other |
|---|---|---|---|---|---|---|---|---|
| Kar98k Rifle (`gerrifle`) | R/units/ger/infantry/GERInfantry.lua | 65 (XP only). Squads: `ger_platoon_hq` (4 rifle + 2 MP40) **610**; `ger_platoon_rifle` (7 rifle, 2 MP40, 1 MG42) **1830**. Source: R/LuaRules/Configs/side_squad_defs/ger.lua | 100 × `maxDamageMul` **1.1** → **110** | 1.6 → **0.8** | **390** | none | `k98k`, `Model24` grenade | |
| MG42 team (`germg42`) | same | Squad `ger_platoon_mg` (3 MG42 + 1 scout): **1220** | 100 × 1.1 → **110** | 1.6 → **0.8** | **390** | none | `MG42` | Deployed `GERMG42_Sandbag` uses `MG42_deployed` |
| K98k sniper (`gersniper`, "K98k Heckenschutze") | same | Squad `ger_platoon_sniper` (sniper + scout): **1110** | 110 | 0.8 | **195** | none | `k98kscope` | Same SniperInf class as the US sniper |
| Feldpionier (`gerhqengineer`) | same | **260** | 110 | 0.8 | 390 | none | none | same EngineerInf class |
| PzKpfw III Ausf L (`gerpanzeriii`) | R/units/ger/tanks/GERPanzerIII.lua (`MediumTank`) | **2150** | 2130 → **2527.6** | 40 kmh → **2.96** | **75** | Hull F 70@12, S 30@–, R 53@16, top 17. Turret F 50@15, S 30@25, R 30@12, top 10 | `KwK50mmL60AP`, `KwK50mmL60HE`, 2× `MG34` | `maxammo` 12 |
| PzKpfw IV Ausf H (`gerpanzeriv`) | R/units/ger/tanks/GERPanzerIV.lua (`MediumTank`) | **2587** | 2600 → **2799.2** | **25** kmh → **1.85** (as written) | **75** | Hull F 80@10, S 35@–, R 20@-8, top 10. Turret F 50@11, S 38@26 ("30mm + 8mm skirt"), R 38@17, top 16 | `KwK75mmL48AP`, `KwK75mmL48HE`, 2× `MG34` | `maxammo` 17; `turretturnspeed` 16 |
| PzKpfw VI Tiger Ausf E (`gertiger`) | R/units/ger/tanks/GERTiger.lua (`HeavyTank`) | **6592** | 5700 → **4183.5** | 45.4 kmh → **3.36** | **75** | Hull F 102@10, S 82@–, R 82@-9, top 26. Turret F 100@12 ("turret face not mantlet"), S 82@–, R 82@–, top 40 | `KwK88mmL56AP`, `KwK88mmL56HE`, 2× `MG34` | `maxammo` 17; `turretturnspeed` 12; HeavyTank `acceleration` 0.043 |
| 7.5cm PaK 40 (`gerpak40`) | R/units/ger/guns/GERPaK40.lua (`ATInfGun`) | **840** (tractor `ATGunTractor` 840) | 300 → **300** | 0.75 → **0.375** | **390** | none | **`KwK75mmL48AP`** (it reuses the PzIV gun's AP weapon) | `maxammo` 4; deployed `GERPaK40_Stationary` (`ATGun`, maxDamage 1500) |
| 10.5cm leFH 18M (`gerlefh18`) | R/units/ger/guns/GERLeFH18.lua (`HInfGun`) | **1800** | 300 → **300** | 0.1 → **0.05** | **390** | none | `leFH18HE`, `leFH18smoke` | `maxammo` 4 |
| Bf 109K-4 (`gerbf109`) | R/units/ger/aircraft/GERBf109.lua (`Interceptor`) | **985** | 224.7 → **224.7** | `maxVelocity` 22.85 | 0; air 4000 | none | 2× `mg15115mm`, 1× `mk10830mm` | `maxAcc` 0.803; `maxFuel` 120 (Interceptor) |
| SdKfz 251/1 Halftrack (`gersdkfz251`) | R/units/ger/vehicles/GERSdKfz251.lua (`HalfTrack`) | **1100** | 850 → **1579.4** | 52.5 kmh → **3.89** | **90** | Hull F 9@18, S 10@35, R 9@-30, top 0 | 2× `MG34` (front 90° arc, rear 180° arc) | `transportCapacity` 10; damageGroup `armouredVehicles` |

## Weapon table

Column notes:
- **Range**, **reload**, **damage** and **projectile velocity** are raw file values.
- **Range (post)**: range × 0.6 for weapons without `no_range_adjust`.
- **Damage default**: `damage.default` before damage-type expansion. See the damage-type section for per-armor-type results.
- **Penetration**: `customparams.armor_penetration_100m / armor_penetration_1000m` in mm.
- "inh." means the value was inherited from the named base class.

Weapon base classes are in R/BaseClasses/Weapons/Infantry/SmallArms.lua and R/BaseClasses/Weapons/Cannon.lua.

### Small arms

| Weapon key | Source | Class | Range raw → post | Reload s | Burst / burstRate | Damage default (type) | Accuracy / sprayAngle / movingAccuracy | Velocity | Other |
|---|---|---|---|---|---|---|---|---|---|
| `M1Garand` | R/weapons/Infantry/Rifles.lua | RifleClass | 535 → 321 | **1.7** | – | 33 inh. (`smallarm`) | 210 / 100 / 888 (inh.) | 1500 inh. (SmallArm; LaserCannon) | AoE 1 (inh.) |
| `k98k` | same | RifleClass | 665 → 399 | **2.8** | – | 33 inh. (`smallarm`) | 210 / 100 / 888 | 1500 | |
| `M1903Springfield` | same | local `SniperRifleClass` (redefined in Rifles.lua) | 1040 → 624 | 10 | – | default 625, **infantry 1700 (explicit)**, sandbags 325 | 0 / 100 / **888** (overrides the class's 1777) | 1500 | `fearaoe` 90 |
| `k98kscope` (K98kScope) | same | SniperRifleClass | 1040 → 624 | 10 | – | 625 / infantry 1700 / sandbags 325 | 0 / 100 / 1777 | 1500 | |
| `M1919A4Browning` | R/weapons/Infantry/MachineGuns.lua | MGClass | 820 → 492 | **3** | **7 / 0.14** | 33 inh. (`smallarm`) | 220 inh. / 460 / 999 inh. | 1500 | `fearaoe` 45 (suppression); deployed version: range 1020, sprayAngle 400 |
| `MG42` | same | MGClass | 850 → 510 | **2.55** | **11 / 0.0175** | 33 inh. (`smallarm`) | 100 / 530 / 999 | 1500 | deployed version `MG42_Deployed`: range 1040, sprayAngle 360 |
| `MG34` (Panzer and SdKfz 251 MG) | same | MGClass | 945 → 567 | 2.55 | 10 / 0.069 | 33 inh. | 100 / 300 / 999 | 1500 | |
| `M2Browning` (.50 cal, M3 halftrack) | same | HeavyMGClass | 880 → 528 | 2 | 3 / 0.1 (burstRate inh.) | **50** inh. (`smallarm`) | 220 inh. / 350 inh. / 500 | **3000** inh. | `armor_penetration_100m/1000m` **29/20**; `interceptedByShieldType` 16 lets it damage the `armouredvehicles` armor type (see armor notes) |
| `m2browningamg` (P-51) | same | M2Browning + AMG | 900 (`no_range_adjust`) | 0.65 | 6 / 0.085 | 50 | 600 / 1200 (AMG) / 500 | 3000 | pen 29/20 inherited |
| `M2BrowningAA` | same | M2Browning + AAMG | 1170 (`no_range_adjust`) | 0.75 | 4 | 50 | 900 / 250 / 1200 | 3000 | `onlytargetcategory` AIR |

### Tank, anti-tank and field guns

All AP rounds have `damagetype` **`kinetic`** (`AP` base class). All HE rounds have **`explosive`** (`HE` base class), with `edgeEffectiveness` 0.2 inherited unless stated. The tank-gun base `TankGun` sets accuracy 100, movingAccuracy 600 and tolerance 300. AP shells set no `areaOfEffect` in S44 files (**not found**; the engine default applies).

| Weapon key | Source | Calibre class (ammo `weaponcost` per shot) | Range raw → post | Reload s | Damage default | Pen 100m / 1000m (mm) | AoE / edge | Velocity | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `M637mmAP` (37mm M6, M5 Stuart) | R/weapons/Armour/LightGun.lua | LightGun (8) | 1010 → 606 | 2.5 | **933** | **63 / 46** | – | 1768 | |
| `M637mmHE` | same | LightGun | 1010 → 606 | 2.5 | 228 | (HE formula) | 44 / 0.2 | 1584 | |
| `M637mmCanister` | same | LightGun → LaserCannon | 550 → 330 | 2.5 | 150 (`smallarm`), 122 projectiles | – | 10 / 1 | 1400 | sprayAngle 3000 |
| `KwK50mmL60AP` (PzIII) | R/weapons/Armour/LightMediumGun.lua | LightMediumGun (10) | 1125 → 675 | 4.95 | **1435** | **69 / 47** | – | 1670 | HE: dmg 330, AoE 55, vel 1100 |
| `QF6Pdr57mmAP` (British 57mm; **US M1 57mm not found**) | same | LightMediumGun (10) | 1200 → 720 | 4.95 | **1795** | **86 / 66** | – | 1800 | Listed only as a 57mm penetration reference. HE: dmg 760, AoE 55 |
| `M375mmAP` (Sherman, Jumbo) | R/weapons/Armour/MediumGun.lua | MediumGun (12) | **1270 → 762** | 5.25 | **2557** | **71 / 57** | – | 1176 | |
| `M375mmHE` | same | MediumGun | 1270 → 762 | 5.25 | 1334 | (HE formula) | 88 / 0.2 | 926 | |
| `KwK75mmL48AP` (PzIV **and PaK 40**) | same | MediumGun (**16**, overridden) | **1520 → 912** | 6.45 | **2613** | **91 / 81** | – | 1480 | |
| `KwK75mmL48HE` | same | MediumGun | 1520 → 912 | 6.45 | 1280 | (HE formula) | 87 / 0.2 | 1096 | |
| `M7AP` (3-inch M5 AT gun; Sherman 76) | same | MediumGun (16) | 1545 → 927 | 6.75 | 2646 | **100 / 81** | – | 1674 | |
| `KwK88mmL56AP` (Tiger I) | R/weapons/Armour/MediumHeavyGun.lua | MediumHeavyGun (20) | **2110 → 1266** | 9.15 | **3154** | **120 / 100** | – | 1490 | |
| `KwK88mmL56HE` | same | MediumHeavyGun | 2110 → 1266 | 9.15 | 1940 | (HE formula) | 100 / 0.2 | 1250 | |
| `M390mmAP` (M36 Jackson) | same | MediumHeavyGun (20) | 2110 → 1266 | 9.15 | 3303 | **151 / 137** | – | 1490 | |

### Artillery

| Weapon key | Source | Class | Range raw → post | Reload s | Damage default (`explosive`) | AoE / edge | Accuracy | Velocity | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `M2HE` (US 105mm M2) | R/weapons/Arty/Howitzers.lua | Howitzer + HowitzerHE | **7200 → 4320** | 11.25 | **4360** | 131 / 0.2 | 1050 (→ ×1.291 post) | 1200 base; post `sqrt(range×120)` = 720 | `weaponcost` 30. The source's `name` field reads "10.5cm LeFH 18/40" (copied from leFH in the source) |
| `leFH18HE` (GER leFH 18) | same | Howitzer + HowitzerHE | **7200 → 4320** | 11.25 | **4200** | 129 / 0.2 | 1050 | same as M2 | `weaponcost` 30 |
| `M2Smoke` / `leFH18Smoke` | same | HowitzerSmoke | 7200 | 11.25 | 10 | 30 | 1050 | – | `smokeradius` 250, `smokeduration` 40 |

Howitzer accuracy also improves with "zeroing" in R/LuaRules/Gadgets/unit_indirectFireAccuracy.lua (`ZEROING_FACTOR` 0.75, `MIN_ZEROING` 0.15).

### Aircraft guns

| Weapon key | Source | Range | Reload | Burst / rate | Damage (type) | AoE | Velocity | Notes |
|---|---|---|---|---|---|---|---|---|
| `m2browningamg` (P-51, ×6) | R/weapons/Infantry/MachineGuns.lua | 900 (`no_range_adjust`) | 0.65 | 6 / 0.085 | 50 (`smallarm`) | 1 | 3000 | see small arms |
| `mg15115mm` (Bf 109, ×2) | R/weapons/Aircraft/AirAutoCannons.lua | 900 (`no_range_adjust`) | 1.2 | 6 / 0.08 | 40 (`explosive`, via AutoCannonHE) | 8 | 2100 | edgeEffectiveness resolves to 0.5 (AirAutoCannon's inherited AutoCannon value wins over AutoCannonHE's 0.05) |
| `mk10830mm` (Bf 109, ×1) | same | 700 | 3 | 3 / 0.25 | 182 (`explosive`) | 25 | 1750 | sprayAngle 1400 |

The `AirAutoCannon` base sets both `sprayangle = 1200` and `sprayAngle = 950`. After key lower-casing, which one survives is ambiguous.

## Damage types vs armor types

Source: R/gamedata/damagedefs.lua. These multipliers apply to `damage.default`. The weapon file's explicit per-type damages override them, as with the sniper's `infantry = 1700`.

| damagetype | infantry | guns | unarmouredvehicles | armouredvehicles | light/medium/heavy tanks | planes | default |
|---|---|---|---|---|---|---|---|
| `smallarm` | **5/4** | 1/6 | 1 | 5/6 | 0 | 2/3 | 1/6 |
| `kinetic` (AP) | (not listed → default 1) | (default 1) | 2 | 7/5 | 9/10 | (default 1) | 1 |
| `explosive` (HE) | **3/2** | 3/5 | 1 | 1/2 | 1/3 | (not listed → unchanged) | (unchanged) |
| `shapedcharge` (HEAT) | – | – | – | – | 9/10 | – | – |

Examples computed from these rules (not literal source values):
- Rifles and MG bullets (33): 41.25 vs infantry.
- M2 .50 (50): 62.5 vs infantry.
- M2HE (4360): 6540 vs infantry, 1453 vs tanks before the armor check.

## Simple rate-of-fire comparisons

These are computed from the raw values above; they are not S44 values. Each assumes every shot hits an infantry target, uses the Spring convention that `reloadTime` runs from one burst start to the next, and ignores accuracy, spray and suppression.

| Weapon | dmg vs infantry × shots / reload | DPS vs infantry |
|---|---|---|
| M1 Garand | 41.25 × 1 / 1.7 | **24.3** |
| Kar98k | 41.25 × 1 / 2.8 | **14.7** |
| BAR | 41.25 × 3 / 2.25 | 55.0 |
| M1919A4 | 41.25 × 7 / 3.0 | **96.3** |
| MG42 | 41.25 × 11 / 2.55 | **177.9** |
| MG34 | 41.25 × 10 / 2.55 | 161.8 |
| M2 .50 | 62.5 × 3 / 2.0 | 93.8 |
| Sniper (M1903 / K98k scope) | 1700 / 10 | 170 (one shot kills any 100–110 HP infantryman) |

## How S44 models armor and penetration

Source: R/LuaRules/Gadgets/game_armor.lua (helper: R/LuaRules/Gadgets/api_vector.lua). Parameters are set in `gamedata/weapondefs_post.lua`.

1. **Data.**
   - Each armored unit lists `armour[piece][side] = {thickness (mm), slope (deg)}`. The pieces are `base` (hull), `turret` or `super`. The sides are `front`, `side`, `rear` and `top`.
   - Each AP weapon lists `armor_penetration_100m` and `armor_penetration_1000m` (mm); `armor_penetration` (point-blank) is the alternative form.
   - `armor_hit_side` can force a side; mortars and air AT guns use `"top"`.
2. **Penetration vs distance.**
   - Penetration falls off exponentially: `pen(d) = pen0 × exp(d × k)`.
   - The constants are `pen0 = (p100/p1000)^(1/9) × p100` and `k = ln(p1000/p100)/900`.
   - `d` is the distance in elmos from where the projectile was spawned (the firing unit's flare) to the piece that was hit. The "100m/1000m" labels are applied to elmo distances in the code with no conversion.
   - `weapondefs_post.lua` divides `k` by the 0.6 range multiplier, so falloff per elmo is steeper to match the shorter ranges. For example, 88mm L/56 gives about 118 mm at 100 and 87 at 1000 elmos, and 75mm M3 about 70 / 48 (computed).
3. **Which face is hit.**
   - The face comes from the shot direction relative to the hull, or to the turret if the turret was hit.
   - If |dot(shot, up)| > √½ the shot hits the **top**.
   - Otherwise the front / side / rear arcs are split using the piece's collision-box length/width ratio.
4. **Slope.**
   - With the `sloped_armour` mod option (default on), the face normal is tilted up by `slope`.
   - Effective thickness = `thickness / |cos(angle between shot and tilted normal)|`.
   - For a level, head-on shot this is simply `thickness / cos(slope)`. That gives these frontal effective values (computed, not in source):

     | Tank | Hull | Turret |
     |---|---|---|
     | Sherman | 64/cos48 ≈ **95.6** | 76/cos33 ≈ 90.6 |
     | Tiger | 102/cos10 ≈ **103.6** | 100/cos12 ≈ 102.2 |
     | PzIV | ≈ 81.2 | ≈ 50.9 |
     | PzIII | ≈ 71.6 | ≈ 51.8 |
     | Stuart | ≈ 45.1 | ≈ 45.2 |
     | Jumbo | ≈ 155.5 | ≈ 155.4 |
     | M36 | ≈ 66.3 | ≈ 46.9 |
5. **Ricochet.**
   - If `1.5 × pen < effectiveArmor` (`OVERMATCH` = 1.5) **and** the impact angle is steeper than 60° from the normal (`dot < cos 60°`), the shell bounces and does **0 damage**.
   - The bounced projectile is respawned at 20% velocity.
6. **Damage scaling (no hard pen / no-pen threshold).**
   - `mult = pen^8.75 / (pen^8.75 + armor^8.75)`, where `ARMOR_POWER` = 8.75 (the old value 3.7 is commented out).
   - Damage = `damage × mult`. When pen equals armor the shot does 50% damage. The curve is a steep logistic in the ratio pen/armor:
     - ratio 1.2 → about 83%
     - ratio 0.8 → about 12%
     - ratio 0.67 → about 3%
7. **HE vs armor.** `explosive` weapons without AP data get `pen = 1.9 × sqrt(damage)` (`HE_MULT`). Example: 75mm M3 HE 1334 → about 69 mm (computed).
8. **Small arms.**
   - Any `smallarm` weapon does **0** to a unit that has armor data.
   - Exception: weapons with `interceptedByShieldType == 16` (the `HeavyMGClass` .50 cal / 13mm guns) still do damage when the target's armor type is `armouredvehicles` (halftracks, armored cars). They do not damage tanks.
9. **Kinetic multipliers** from `damagedefs` (e.g. 9/10 vs tanks) are applied first; the armor multiplier then scales the result.

Worked examples (computed with raw 100m pen against head-on effective hull armor; not S44 values):

| Matchup | Pen / armor (mm) | Damage multiplier |
|---|---|---|
| 75mm M3 AP vs Tiger hull | 71 / 103.6 | ≈ 0.035 |
| 75mm M3 AP vs PzIV hull | 71 / 81.2 | ≈ 0.24 |
| 88mm L/56 vs Sherman hull | 120 / 95.6 | ≈ 0.88 |
| 88mm L/56 vs Jumbo hull | 120 / 155.5 | ≈ 0.09 |
| 37mm vs PzIV hull | 63 / 81.2 | ≈ 0.10 |
| 57mm 6pdr vs PzIV hull | 86 / 81.2 | ≈ 0.62 |

## Key ratios (derived from the raw values above)

- **Tiger vs Sherman frontal armor.**
  - Hull, raw thickness: 102 / 64 = **1.59×**.
  - Hull, effective head-on (slope included): 103.6 / 95.6 = **1.08×**. The Sherman's 48° glacis closes most of the gap.
  - Turret: 100 / 76 = 1.32× raw; 102.2 / 90.6 = 1.13× effective.
- **AP penetration at 100 (raw mm).**

  | Gun | Pen | vs 37mm |
  |---|---|---|
  | 88mm KwK36 | 120 | 1.90× |
  | 75mm KwK40 / PaK 40 | 91 | 1.44× |
  | 57mm 6pdr (British) | 86 | 1.37× |
  | 75mm M3 (Sherman) | 71 | 1.13× |
  | 37mm M6 | 63 | 1.00× |

  - 88mm vs the Sherman's 75mm: 120 / 71 = **1.69×**.
  - 88mm vs 57mm: **1.40×**.
  - Also in source: 90mm M3 151, 76mm M7 100, 50mm KwK39 69.
- **Artillery range vs tank gun range (raw; the 0.6 post multiplier keeps the ratio).**
  - 105mm (M2 or leFH 18, 7200) vs 75mm M3 (1270): **5.7×**.
  - vs KwK40 (1520): 4.7×.
  - vs 88mm KwK36 (2110): 3.4×.
- **Rifle vs MG DPS against infantry (computed above).**
  - M1919A4 / M1 Garand ≈ 96.3 / 24.3 = **4.0×**.
  - MG42 / Kar98k ≈ 177.9 / 14.7 = **12.1×**.
  - MG42 / M1919A4 = 1.85×.
- **Cost (command points).**
  - Tiger 6592 vs Sherman 2550: **2.6×**.
  - Tiger vs PzIV 2587: 2.5×.
  - Jumbo 6530 vs Sherman: 2.6×.
  - PaK 40 840 vs 3-inch M5 600.
  - 105mm howitzers: 1800 each.
- **Effective HP after the mass formula.** Tiger 4183.5 vs Sherman 3103.2 = **1.35×**, compared with 1.79× in the raw `maxDamage`.

## Not found or ambiguous

- **US M1 57mm AT gun:** no unit or weapon. Only the British `QF6Pdr57mmAP` exists, shown above as a 57mm reference.
- **M26 Pershing:** not in the repository. The M4A3E2 Jumbo (heavy) and M36 Jackson (90mm) are given as alternatives.
- **AP shell `areaOfEffect` / `edgeEffectiveness`:** not set in S44 files (engine defaults).
- **Per-soldier infantry cost:** not a real cost. S44 sells squads; the per-unit `buildCostMetal` is for XP only.
- **US M3 halftrack `damageGroup`:** resolves to `unarmouredVehicles` by the inheritance order (see the unit table). Not verified in game.
- **`AirAutoCannon` duplicate `sprayangle` / `sprayAngle` keys:** which value survives is not determined.
- **The `.50calproof` weapon** listed on tanks is a utility "weapon" and was not analysed.
- **Elmo to metre scale:** not defined in the S44 code examined. The armor gadget labels elmo distances as metres.
