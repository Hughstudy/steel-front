# Steel Front implementation plan for Claude Code

Continue Steel Front from its completed M0 map and camera build to a complete single-player WW2 RTS. This document gives implementation order, design defaults, data contracts, acceptance checks, and review handoff requirements. **The next implementation session is M1 only.** Complete one milestone per session and stop at its verified, committed checkpoint.

Prepared 2026-10-10. Implementation baseline: commit `63d215a`, `Build M0 isometric battlefield and camera controls`. Later documentation commits do not change that runtime baseline. Read current Git state and STATUS.md before starting; preserve work added after this plan.

## 1 Working contract

Read `AGENTS.md`, `PROJECT.md`, `STATUS.md`, and this document at the beginning of each session. The user's current instructions and PROJECT.md requirements govern scope; design choices below are implementation defaults for unresolved details, not descriptions of existing functionality.

- Build exactly one milestone per session. Fix that milestone's failed acceptance checks before moving on. This full roadmap does not authorize silently combining M1 through M6 in one session.
- Keep each completed milestone playable from an ordinary URL. Intermediate M1 through M4 builds can expose a clearly labelled sandbox scenario; they must be usable without console commands.
- End with a passing build, meaningful tests, manual play through `npm run dev`, updated STATUS.md, verification evidence, and a Git commit.
- Keep modules small and single-purpose. Prefer roughly 100–250 lines where practical; split by responsibility rather than enforcing an arbitrary line count.
- Explain every new npm dependency in one sentence before adding it. None is currently needed for the planned gameplay systems. Use built-in Node tests unless a real limitation justifies another tool.
- Favor RA2 behavior for ambiguous interaction choices. Preserve the explicitly required modern right-click move/attack convention.
- Do not rewrite working M0 systems merely to match a preferred architecture. Refactor where the next feature requires a clean seam.
- Do not copy reference-project code, art, sounds, fonts, or sprites. Keep ASSETS.md current for procedural assets and any verified CC0 assets.
- Do not publish or configure the Linux VM during these implementation sessions. Deliver static files and deployment instructions; deployment is a separate user-directed action.

## 2 Product requirements

The game is a single-player skirmish RTS: Allies against Axis on a 128×128 isometric tile map. Players deploy an MCV, build a base, collect supplies and oil income, produce armies, explore under fog, and destroy the opposing HQ.

| Area | Required result |
| --- | --- |
| Stack | TypeScript, Vite, HTML5 Canvas 2D, ordinary HTML/CSS HUD |
| Exclusions | No React/Vue, WebGL, 3D, game framework, backend, accounts, multiplayer, or game networking |
| Deployment | `vite build` produces static files for Caddy or any static HTTP server; retain relative asset URLs |
| Simulation | Deterministic 20 Hz updates, render interpolation, simulation independent of display refresh rate |
| Rules | Unit/building statistics, costs, build times, prerequisites, tech tree, and AI orders in root `data/*.json` |
| Art | Original procedural graphics or documented CC0 assets; muted olive, sand, field grey |
| Map | 64×32 diamond tiles, 128×128 tiles; pan, zoom, minimap |
| HUD | Top money/power strip; bottom selection information and commands; readable contrast |
| Performance | Target 60 FPS with 200 units plus active projectiles on a midrange laptop |
| Memory | Reuse hot-path buffers; pool projectiles and cosmetic particles |

Allies use olive trim and white stars; Axis uses field-grey trim and the specified Balkenkreuz-style unit marking. Keep silhouettes readable at normal gameplay zoom.

Both factions eventually require: engineer, rifle squad, MG team, sniper, halftrack, light tank, medium tank, heavy tank, towed AT gun, artillery, fighter, supply truck, and MCV. Light tanks are Stuart/Pz III, medium tanks Sherman/Pz IV, and heavy tanks Pershing/Tiger. Complete the requested roster by M4 so M5 can use it.

## 3 Current baseline and integration points

M0 is implemented and recorded as passing in STATUS.md. Recheck the baseline locally; do not present its prior measurements as new measurements.

| Existing files | Current behavior and how to extend it |
| --- | --- |
| `src/main.ts` | Composes camera, map, renderer, input, HUD and loop. The simulation callback currently only records tick count. Replace that placeholder with world updates in M1. |
| `src/engine/loop.ts` | Fixed 20 Hz clock, interpolated rendering, bounded catch-up. Preserve its separation of update and render. |
| `src/engine/coordinates.ts` | Tile/world projection. Tile coordinates denote the north vertex; tile center adds 0.5 to both axes. |
| `src/engine/camera.ts` | Camera smoothing, bounds, cursor-anchored zoom from 35% to 180%. Camera coordinates are projected world pixels. |
| `src/engine/input.ts` | WASD/arrows, edge scroll, middle drag, zoom, reset and grid. Add coordinated gameplay input without duplicate listeners or competing shortcuts. |
| `src/sim/terrain.ts` | Seeded tile and scenery arrays. Scenery is decorative today; M1 must deliberately define collision rules. |
| `src/render/terrain-renderer.ts` | Cached ground followed by depth-ordered props. Units must join the prop depth pass; drawing every unit afterward would put units in front of all trees/buildings. |
| `src/render/ground.ts`, `props.ts` | Original procedural texture and prop atlases. Reuse this asset approach for units/buildings. |
| `src/ui/hud.ts`, `minimap.ts`, `styles.css` | Responsive HUD, terrain inspection, camera controls, help, minimap and frame counter. Extend rather than replacing the visual direction. |
| `data/map.json` | Terrain seed, palette and generation configuration for The Lowlands. |
| `tests/*.test.ts` | 13 baseline tests: transforms, camera, fixed clock, seeded terrain, and connected road network. |

Important baseline facts:

- The default map seed is `19440917`.
- `data/map.json` currently places the **camera** at tile `(57,59)`, a bridge. This is not a valid assumption for a future player base or MCV spawn. Add separately validated scenario/player spawns.
- The ground cache contains 64 canvases using approximately 137 MB of raw pixel storage, before browser overhead. Avoid duplicating these caches during renderer refactoring or loading saves.
- No units, economy, gameplay buildings, weapons, AI, saves, or victory logic exist yet.
- The current FPS tooltip measures application frame work, not a full GPU/compositor profile. Report actual frame intervals as well when assessing performance.

Baseline commands:

```sh
npm ci
npm test
npm run build
npm run dev
```

Use the installed toolchain if already present and unchanged. Node 22.12+ is documented; the baseline was tested on Node 26. `npm test` uses Node's TypeScript stripping, so new simulation modules imported directly by tests must use compatible syntax and resolvable imports, or the test script must explicitly compile them first. Avoid TypeScript parameter properties in directly executed simulation modules.

## 4 Design defaults to carry through the milestones

These choices resolve gaps in the brief. Keep them consistent unless new implementation evidence or a user instruction requires a change; record any replacement and its reason in STATUS.md.

| Decision | Default |
| --- | --- |
| Base bootstrap | MCV deploys into HQ. HQ combines construction-yard and supply-deposit roles. |
| Starting economy | M3 onward starts with one MCV and data-defined credits covering power plant → barracks → war factory → first supply truck, plus a margin. No hidden free income or unit grants. |
| HQ objective | One strategic HQ per player in v1. Before deployment the starting MCV is the provisional objective. After deployment, destruction of the strategic HQ ends that player's match. |
| HQ removal | Do not permit selling the strategic HQ or packing it back into an MCV in v1. Disable these actions with a visible reason. |
| Basic tech tree | HQ → power plant → barracks → war factory. HQ constructs buildings; barracks produces infantry; war factory produces ground vehicles and guns. All relationships are data references. |
| Aircraft support | Add one minimal airfield in M4 using the M3 building/queue infrastructure. This is a supporting design addition for the explicitly required fighter; no runway simulation, fuel, or ammunition logistics. |
| Heavy tanks | Introduce after light/medium combat works in M4. Use prerequisites, cost and build time in JSON; no separate research system is required. |
| Rifle squads | One selectable simulation entity, drawn with several decorative soldiers. No per-soldier pathfinding or losses in v1. |
| Halftracks and AT guns | Halftracks are combat vehicles; passenger transport is outside the brief. AT guns move as crewed/towed silhouettes and can have a data-defined setup delay, without a tractor attachment system. |
| Ground navigation | Eight neighbors with no diagonal corner cutting, integer path costs, and a matching admissible heuristic. All v1 ground units must fit the existing one-tile bridge route. |
| Transient blockers | Moving units are handled by occupancy/reservations and yielding, not permanently carved into the static route grid. |
| Fog | Separate currently-visible and permanently-explored masks per player; invisible enemy units disappear, and known buildings use frozen last-seen information. |
| Background behavior | Pause gameplay while the page is hidden. Never grant offline income or run a large catch-up burst on return. |
| Aircraft | Separate air movement layer with continuous flight/holding patterns. Ignore ground blockers; use weapon target-layer rules. |
| Scope limit | No naval units, campaigns, multiplayer, destructible terrain, complex transport, or additional resource types in v1. |

## 5 Target architecture

The following is a responsibility map. Create files only as their milestone needs them. Exact filenames may vary if responsibilities stay clear.

```text
src/
  main.ts                         composition and application startup
  engine/
    loop.ts                       fixed updates and render interpolation
    coordinates.ts                projection and coordinate conversion
    camera.ts                     presentation camera
    input.ts                      input routing and camera controls
    random.ts                     serializable seeded gameplay PRNG
    pool.ts                       reusable bounded storage when needed
    spatial-index.ts              reusable nearby-entity lookup
  sim/
    rules.ts                      typed rule loading and validation
    world.ts                      authoritative match state and ordered updates
    commands.ts                   tick-stamped commands and validation
    entities.ts                   common entity state and identity
    navigation-grid.ts            static walkability, occupancy and revision
    pathfinder.ts                  bounded deterministic A* jobs
    formations.ts                 reachable destination assignment
    movement.ts                   reservations, movement, yielding, recovery
    economy.ts                    deposits, credits and resource stock
    truck-ai.ts                   hauling state machine
    capture.ts                    engineer capture and oil ownership
    construction.ts               deployment, placement and footprints
    production.ts                 queues, costs, build time and spawning
    power.ts                      supply, demand and work-rate calculation
    combat.ts                     orders, acquisition, firing and damage
    projectiles.ts                pooled authoritative projectile state
    visibility.ts                 fog masks and information access
    veterancy.ts                   experience and data-defined bonuses
    ai.ts                         scripted opponent state and commands
    victory.ts                    terminal match state
    save.ts                       versioned simulation serialization
  render/
    terrain-renderer.ts           cached ground surfaces
    ground.ts / props.ts          procedural terrain and scenery atlases
    unit-atlas.ts                 cached faction/direction/animation sprites
    building-atlas.ts             cached building silhouettes
    scene-renderer.ts             depth ordering for props and entities
    effects.ts                    presentation-only particles and feedback
    fog-renderer.ts               shroud and explored dim overlays
  ui/
    hud.ts / minimap.ts            visible game information and commands
    selection.ts                  click/box/group selection and hit testing
    production-panel.ts           queues, prerequisites and progress
    placement.ts                  placement ghost and validation feedback
    menus.ts                      setup, pause, result and save controls
    audio.ts                      gesture-unlocked synthesized SFX
    styles.css                    shared visual system

data/
  map.json                        existing map generation defaults
  maps.json                       map presets and validated player spawns
  scenarios.json                  playable milestone fixtures
  terrain.json                    terrain/prop movement and placement rules
  factions.json                   faction mappings and visual identity
  units.json                      all unit definitions
  buildings.json                  all building definitions
  weapons.json                    weapons and targeting parameters
  armor.json                      armor/damage/penetration interactions
  economy.json                    cargo, resources and oil settings
  production.json                 queues, refunds and low-power rate
  ai.json                         build orders, waves and difficulty knobs
  game.json                       global rules, timing and limits

tests/                            pure simulation and integration tests
  fixtures/                       reproducible scenario/command fixtures
docs/verification/M1.md … M6.md   actual check results and reproduction steps
BALANCE.md                        sourced ratios and normalization rationale
ASSETS.md                         artwork and sound provenance
STATUS.md                         current milestone, next work, known issues
```

### Simulation contracts

1. `World` owns all authoritative state: tick, entity IDs, players, entities, resources, queues, visibility, commands, scheduled work and gameplay PRNG. It must run headlessly without `document`, Canvas, localStorage, or audio.
2. Commands are serializable records with scheduled tick, monotonically increasing sequence, player, command kind, entity IDs and tile/world target. UI actions enqueue commands; the simulation validates and executes them. AI uses the same command API.
3. Use stable entity IDs and explicit tie breakers. Never depend on render order, wall-clock time, asynchronous completion order, or `Math.random()` for gameplay.
4. Store positions in unprojected tile space. Prefer integer fixed-point coordinates with a shared scale such as 1024 units per tile, with carried remainders for speeds and work rates. Projection to isometric pixels belongs to rendering/input conversion.
5. Define units for every rule field. Simulation durations use integer ticks at 20 ticks/second; distances use tiles; credit amounts are integers. Authors must not confuse pixels with tiles or seconds with ticks.
6. A deterministic per-tick order should be explicit: snapshot prior transforms; consume commands; AI scheduling; bounded navigation jobs; movement/reservations; economy/construction/production; current visibility; combat/projectile impacts; destruction/capture/experience resolution; final visibility/objective state. Newly emitted commands/events have a documented execution tick; do not recursively mutate systems from callbacks.
7. Buffer removal/spawn events where necessary and resolve them in stable order. Later systems must not attack or credit a dead entity just because it remains in an array until cleanup.
8. Rendering interpolates previous/current transforms and angles. Render rate, camera position, minimap state, sound and particles must never change simulation results.
9. Pathfinding budgets count node expansions per simulation tick, not milliseconds from `performance.now()`. Replays with the same seed and tick-stamped commands must produce identical state after equal tick counts.
10. Allocate at load, spawn and command boundaries where needed. Reuse arrays, heaps and visible-entity buffers during ordinary updates/rendering. Avoid giant generic ECS or event-bus infrastructure before a concrete need exists.

### Rules and validation

Use TypeScript interfaces plus a small handwritten validator unless a demonstrated need justifies another dependency. Validate the complete set of rules before starting a scenario, and surface readable errors.

| File or record | Required fields or concepts |
| --- | --- |
| Unit | ID, faction, name, cost, HP, speed, movement class/layer, footprint or radius, armor class, armor rating if used, weapon references, range via weapon, vision, build time, prerequisites, producer capability, turn rate, visual archetype |
| Optional unit capabilities | Cargo, capture, MCV deployment, turret, setup delay, air movement, repair eligibility |
| Building | ID, faction, cost, HP/armor, build time, footprint, prerequisites, buildable terrain, construction radius, power output/demand, producer categories, docking/exit offsets, sell/refund policy, visual archetype |
| Weapon | Damage type, base damage, cooldown, range, projectile speed/type, penetration, target layers, splash/falloff where applicable, accuracy if used |
| Terrain and props | Movement permissions/costs by movement class, placement permission, blocking footprint, vision behavior if implemented |
| Economy | Starting credits, dump stock, cargo value/capacity, load/unload rate, docking limits, oil payout interval/value, capture duration |
| Production | Queue categories/limits, low-power multiplier, cancel/refund behavior, exit retry timing |
| AI | Difficulty presets, opening orders, production priorities, desired economy, expansion rules, wave timers/composition, defense/retry limits |
| Scenario and map | Seed/preset, camera start, distinct player spawns, starting entities/credits, resource and neutral-object placements |

Validate unique IDs, all loaded references, allowed enum values, finite/ranged numbers, positive durations, legal footprints and prerequisite cycles. Introduce bootstrap-affordability and matching-producer checks with M3, then enforce complete faction-roster reachability in M4. Integer ticks and credit calculations must not overflow normal integer ranges.

Keep validation consistent with staged implementation. M1/M2 scenario units can explicitly use `buildable: false`, `producerCapability: null` and an empty prerequisite list while retaining provisional cost/build-time fields. Populate real producer/prerequisite relationships in M3. Do not create dangling building IDs, weaken validation of active content, or implement construction early just to satisfy future schemas.

Generic engine branches on capabilities such as `cargo`, `deploy`, movement layer or weapon behavior are expected. Branches on content IDs such as `if (unit.id === 'sherman')` for statistics or prerequisites are not. A new unit using existing capabilities must be addable through JSON and reusable visual parameters.

Keep JSON valid: no comments. Put balancing rationale and sources in BALANCE.md. Balance values invented for early fixtures must be labelled provisional rather than attributed to Spring:1944.

## 6 Input and presentation contract

| Input | Behavior and delivery milestone |
| --- | --- |
| Left click | Select owned unit/building; empty ground clears selection — M1, buildings in M3 |
| Left drag | Box-select owned units; use a small drag threshold to distinguish clicks — M1 |
| Shift click/drag | Add or toggle selection consistently — M1 |
| Right click | Move on ground; context-sensitive capture/attack from M2/M4; cancels active placement first — M1 onward |
| Ctrl+0–9 / 0–9 | Store/recall live owned units; handle removed members safely — M1 |
| Double click | Select owned visible units of that type on screen — M1 |
| WASD / arrows | Camera pan in battlefield context; preserve edge scrolling and middle drag — existing/M1 |
| Mouse wheel / + / − | Cursor-anchored zoom; preserve button equivalents — existing |
| Home / Space | Return camera when battlefield has focus; never steal Space from focused buttons — existing |
| Q/W/E/R production | Production-panel context shortcuts with visible labels — M3 |
| Escape | Cancel placement/active interaction, close modal, then pause menu according to explicit priority — M3/M6 |
| Rally point | Select a producer and right-click a valid destination; show the marker — M3 |
| Sell / repair | Explicit HUD modes/actions with clear cursor and cancel behavior — M3 |

W is both a camera key and a requested production shortcut. Resolve this with explicit input contexts: battlefield focus uses WASD; a keyboard-focused production panel uses its labelled Q/W/E/R shortcuts, and consumes them before camera handling. Panel visibility alone does not activate this context. Clear held camera keys when entering or leaving production focus so a prior W hold cannot continue panning. Arrow keys and edge scrolling remain available outside modals/text entry. Display the active context and provide an obvious way to return focus to the battlefield. Never pan and enqueue a unit from the same W key event.

Modal dialogs, text fields, HUD buttons and browser modifier shortcuts must not dispatch gameplay orders. Handle pointer cancellation, lost capture, blur and hidden-page transitions. Test selection/hit detection at both zoom extremes and non-default device pixel ratios. Selection/HUD inspection must obey fog once M4 exists.

## 7 M1 Units and control

**Playable outcome:** a clearly labelled maneuver scenario with 20 mixed units that the player can select and command across The Lowlands. Economy, construction and combat remain later milestones.

### Implementation order

1. Introduce validated unit, terrain/prop and scenario definitions. Start with rifle squads, light tanks, halftracks and supply trucks, including future cost/build-time/prerequisite fields. Use existing render archetypes when extending the roster later.
2. Create the headless world, stable entity IDs, seeded gameplay PRNG, tick-stamped move commands and previous/current transforms. Replace the placeholder simulation callback in main.ts. Explicitly gate gameplay updates while the page is hidden: M0 only resets its clock on visibility changes, which does not itself guarantee a pause if a browser still schedules callbacks. Resume without accumulating hidden time.
3. Build authoritative walkability from terrain plus explicitly blocking prop footprints. Water blocks ground units; bridges permit them. Decorative grass/hedges need not block movement; trees, rocks and cottages must have deliberate, data-defined behavior. Validate spawns and bridge approaches after applying props and unit clearance.
4. Implement A* with reusable typed arrays, an open heap and stable tie breakers. For eight-neighbor paths, use integer cardinal/diagonal costs such as 10/14 with an octile heuristic. Diagonal motion must not pass between blocked corners. Movement distance/time must match route geometry.
5. Queue path jobs with a fixed expansion budget per tick. New orders invalidate old requests/results. No asynchronous path completion may change entity processing order.
6. Allocate reachable, distinct destination slots near the order target. Use deterministic ordering and bounded search; prefer nearby compatible slots rather than forcing the exact clicked tile. Confirm connectivity for each movement class. If there are fewer legal slots than units, report that condition and use explicit waiting/reassignment behavior.
7. Add occupancy and next-step reservations. A mover can wait, yield, sidestep, replan, or backtrack to a passing space. Detect lack of progress over simulation ticks. Head-on traffic on a one-tile bridge needs one side to back out; repeatedly asking A* for the same path is insufficient. Use deterministic priority with aging so a low-priority unit cannot starve forever.
8. Add procedural directional sprites and movement animation. Cache variants by archetype/faction/direction/frame. Interleave unit ground-contact depth with scenery; keep selection markers readable without revealing entities through future fog.
9. Implement selection, right-click movement, order cursor/marker feedback, groups, double-click selection and the selected-unit HUD. Keep camera behavior intact while units move.
10. Add a resettable M1 scenario through ordinary UI. The fixed test force should contain 20 entities, for example 8 rifle squads, 4 light tanks, 4 halftracks and 4 trucks. A rifle squad counts as one entity.

### Navigation outcomes

Orders need explicit states such as pending, moving, temporarily waiting, arrived, and unreachable. Keep reason codes for inspection. A temporarily obstructed reachable order must recover; a permanently impossible order must terminate visibly after bounded attempts. Do not silently label reachable orders unreachable to make the acceptance test pass.

Never resolve congestion by teleporting, moving through water/buildings, disabling collision, or permanently stacking units. Release reservations when an order changes or an entity is removed. New building footprints in M3 must invalidate affected paths through a grid revision mechanism.

### Acceptance and tests

- With seed `19440917`, send the 20-unit fixture across the river and back through both bridges. Every known-reachable order must arrive within a documented generous simulation-tick bound derived from route length, slowest speed and congestion allowance.
- Repeat with opposing groups on the same bridge, a crowded destination, an occupied approach, forest/cottage boundaries, a map-edge target and rapid replacement orders. Units may wait, but no order remains indefinitely stalled after the obstruction clears.
- Click water, a blocked footprint and a disconnected area. Show unreachable/nearest-valid feedback consistently; do not crash or leave an infinite search.
- Verify that no unit crosses forbidden tiles or cuts blocked diagonal corners. The initial navigation grid and clearances must permit the expected cross-river routes.
- Record a fixed command log, advance at simulated render rates of 30/60/144 FPS, and compare authoritative snapshots after the same tick count. Compare simulation ticks rather than wall time because hidden-page time is intentionally discarded.
- Manually test click/box/Shift selection, groups, double click, right click, zoomed hit testing, pan during movement, pointer cancellation, field guide and HUD focus.
- Check frame intervals while issuing a 20-unit cross-map order. Begin a 200-unit movement stress fixture to expose pathfinding spikes; the final 200-unit-plus-projectile requirement is completed in M4.
- Keep all baseline tests passing. Test that hidden-page callbacks cannot advance the authoritative tick and that resuming does not catch up hidden time. Record the actual browser, viewport, host and timing samples.

**Stop after M1:** update STATUS.md and `docs/verification/M1.md`, commit a passing playable build, and report the commit. Do not start hauling or production in this session.

## 8 M2 Economy

**Playable outcome:** a logistics scenario with a supplied HQ/depot fixture, several trucks, an engineer, supply dumps and neutral oil derricks. The player can assign collection/capture orders and observe sustained income. The scenario-supplied HQ is an explicit fixture, not early completion of M3 construction.

### Implementation order

1. Add economy definitions and validated supply-dump, depot and oil-object state. Use integer stock, cargo and credits. Put loading rates, unloading rates, cargo value/capacity and oil intervals in JSON.
2. Render dumps, crates, trucks with load indication, HQ deposit area and derricks. Show funds and selected cargo/status in the HUD.
3. Implement truck states: seeking dump → travel → wait for load slot → load → seek depot → travel → wait for deposit slot → unload → repeat. Add explicit waiting-for-route, no-resource and no-depot states with readable reasons.
4. Choose reachable targets using deterministic route cost and stable ID tie breakers. Reuse M1 routing and recovery instead of a second movement implementation.
5. Reserve loading and deposit approach slots with bounded leases. Release them on cancellation, death/removal, target invalidation or timeout. Multiple trucks must be able to queue without occupying the only exit forever.
6. Reduce resource stock only as cargo loads; add credits only as cargo unloads. Partial loads and deposits conserve value. A missing depot preserves cargo and causes retry when a depot becomes available.
7. Reassign when a dump is exhausted. A player-issued manual move suspends the collection order; an explicit collect command resumes it. Autonomy must not continually override the player's latest command.
8. Add engineer capture at a reachable adjacent tile. Require uninterrupted progress for a data-defined duration; movement/death interrupts capture. Successful capture consumes the engineer once and transfers ownership. Oil income pays on simulation ticks to the current owner only.
9. Place resources and neutral objectives through scenario/map data and deterministic generation rules. Keep both future starting sectors supplied with reachable resources.

### Acceptance and tests

- Leave the scenario untouched for at least five minutes of simulation time. Confirm repeated deliveries and a ledger matching actual delivered cargo plus oil income.
- Run several trucks through a single depot. Verify correct slot queues and continued hauling.
- Exhaust one dump and confirm automatic reassignment. Exhaust all resources and show a stable idle reason rather than repeated failed searches.
- Block a route or dock with a unit, then reopen it. The affected truck must recover automatically without resetting the scenario.
- Remove/invalidate a depot in a controlled test, then provide another. Loaded trucks must retain cargo and find a legal destination.
- Capture oil, interrupt a capture, and attempt conflicting captures. Ownership and engineer consumption occur exactly once; payment switches to the new owner at the defined tick boundary.
- Automated tests cover stock/cargo/credit conservation, no duplicate deposits, reservation expiry, deterministic target selection and repeated-run state equality.

**Stop after M2:** commit the playable logistics scenario and its evidence. Construction, queues and power are M3 work.

## 9 M3 Base building

**Playable outcome:** begin with one MCV and starting credits, deploy an HQ, construct a working base, produce troops/trucks, and sustain the economy through actual deliveries.

### Bootstrap and definitions

MCV deployment creates the HQ without a credit or power prerequisite. Validate the full HQ footprint, map bounds and accessible approach/exit tiles. Failed or cancelled deployment keeps the MCV; successful deployment atomically replaces it, preventing duplicate HQs or lost constructors.

Define the initial tech relationships in JSON: HQ unlocks power plant; power plant unlocks barracks; barracks unlocks war factory. A valid producer capability is separate from prerequisites. The HQ owns the construction queue and truck deposit capability. Barracks produces infantry. War factory produces vehicles, trucks and guns. MCV is the starting constructor; rebuilding/producing additional MCVs is outside v1 unless the user expands scope.

Starting credits must demonstrably cover the cheapest valid power plant → barracks → war factory → supply truck path, plus a reasonable buffer. Test this relationship from the data instead of hardcoding an unexplained starter windfall. Deployment itself must not require a building that the player cannot yet build.

### Implementation order

1. Add building definitions, footprints, construction radius, producer categories, docking/exits, costs, build times and prerequisite references. Use generic building systems shared by both factions.
2. Implement MCV deploy preview/action and construction mode. Build progress ends in a ready-to-place building; it is not active, collidable, powered or productive before placement.
3. Share authoritative placement validation between ghost feedback and the final command. Check terrain, full footprint, static/dynamic occupancy, friendly construction range, HQ limits and usable approach/exit tiles. Revalidate at execution even if the ghost was green earlier.
4. Obstructing units must move before placement; never delete or teleport them. Placement adds blockers and updates navigation revisions. Removing a building releases its footprint and docking/reservations.
5. Add one shared queue per production category for v1. Additional producers provide eligible spawn points, not hidden free production multipliers. Queue state includes type, amount paid, work progress, producer eligibility and pause reason.
6. Use progressive credit charging tied to accumulated work, consistent with RA2 pacing. Compute cumulative integer cost due from progress and charge only the difference. Insufficient funds pause unpaid work; do not accumulate free progress that later completes instantly.
7. Cancellation refunds only amounts actually paid, according to JSON policy, exactly once. Completed placed buildings use a separate sell-refund policy. Test cancel/requeue/ready-to-place cancellation for credit exploits.
8. Evaluate live ownership/prerequisites and producer availability. Loss of a prerequisite pauses affected queued work with a reason; restoration resumes it. A ready unit with a blocked exit waits without being duplicated or charged twice. Producer destruction uses another eligible producer or visibly pauses.
9. Compute completed-building power supply and demand every simulation update where it changes. Under-construction buildings contribute neither. Low power applies a data-defined fractional work rate, initially 1/4 as a tuning default, to production/construction. With zero power, retain that slow rate so rebuilding a plant remains possible.
10. Show funds, power totals/status, build-time progress, missing prerequisites, queue count, cost and pause reasons. Add focused Q/W/E/R production shortcuts using the input context contract.
11. Implement rally points, sell mode and credit-consuming repair. Rally destinations must be validated or resolved to a nearby reachable tile. Repair rate/cost and sell refunds are rules data. Strategic HQ selling remains unavailable.
12. Replace the M2 fixture start with a validated one-MCV scenario. Preserve the M2 logistics fixture for regression testing.

### Acceptance and tests

- Starting from exactly one MCV, deploy HQ, place the required buildings, produce the first truck and establish sustained income without hidden grants or console help.
- Produce infantry and vehicles and verify their distinct producer exits and rally points.
- Try invalid terrain, occupied tiles, out-of-range construction, map edges and stale placement validity. No failed attempt may consume the MCV or ready building.
- Measure the same item under full and low power. At a configured 1/4 work rate and sufficient funds, it should require approximately four times the simulation ticks, allowing fixed-point rounding.
- Spend down available credits during production; progress pauses and later resumes as trucks deliver funds.
- Cancel partial, queued and ready items. Verify exact balance changes and no repeated refunds.
- Block exits, remove prerequisites and destroy/remove producers in tests. Recovery must preserve item identity, accounting and valid paths.
- Re-run truck blockage and 20-unit movement tests with newly placed buildings on the map.
- Test input focus so W never both pans and orders production; Space activates focused buttons normally.

**Stop after M3:** a base can be bootstrapped and operated entirely through the HUD. Do not begin damage or AI in this session.

## 10 M4 Combat and fog

**Playable outcome:** a combat sandbox with both factions' complete roster, functional weapons, fog and meaningful counters. An explicit scenario/reset UI supplies enemy forces before the scripted M5 opponent exists.

### Balance sources

Before assigning final combat relationships, inspect published [Spring 1944](https://github.com/spring1944/spring1944) unit/weapon definitions. Record the repository revision, source file links, original values and units, normalized ratios, and every simplification in BALANCE.md. Use armor/penetration/range/cost relationships as anchors; Steel Front values are normalized game values, not claims of historical accuracy. Never invent values and attribute them to the reference.

Keep exact numeric balance in JSON. A small readable damage model is preferable to a detailed ballistics simulation. Use small-arms, HE and AP damage types against infantry/light/heavy/building armor, with a simple data-defined penetration factor where appropriate. Document how the armor multiplier and penetration factor interact so armor is not accidentally penalized twice.

### Implementation order

1. Extend rules for weapons, armor interactions, penetration, reload ticks, range, target layers, projectile travel, splash/falloff, body/turret turn rates, vision and veterancy.
2. Implement attack orders and auto-acquisition over a reusable spatial index. Validate ownership, visibility, range, target layer and weapon readiness. A moving or removed target must not leave a dangling reference.
3. Separate authoritative projectiles from cosmetic tracers/particles. Projectiles and impact timing update on simulation ticks. Preallocate bounded pools with a deterministic capacity policy; reserve capacity before consuming a shot or defer firing when full. Visual particle overflow may drop effects without dropping damage.
4. Resolve movement, projectile hits, splash, HP changes, deaths and kill credit in a stable documented order. A destroyed target cannot grant duplicate experience or be hit again as a live entity. No render-only hit detection.
5. Animate turrets independently from hulls and gate firing by an aim tolerance when specified in data. Show muzzle flashes, hit feedback, health bars and selection states. Interpolate headings across the shortest angle.
6. Award veterancy from data-defined experience thresholds and bonuses. Apply bonuses from base definitions plus current level rather than repeatedly multiplying already modified values.
7. Add per-player visible/explored masks, updating from owned vision sources. Newly unseen units disappear; explored terrain dims; unexplored tiles receive opaque shroud. Previously observed buildings may retain a frozen last-seen silhouette/state, never their current hidden health or activity.
8. Apply information visibility consistently to main view, minimap, selection, hover details, targeting, commands, health bars, projectiles/effects and AI. Do not expose unseen enemies through query APIs used by the HUD.
9. Complete both factions' engineer, rifle, MG, sniper, halftrack, light/medium/heavy tank, AT, artillery, fighter, truck and starting MCV roles. Introduce heavy tanks after core counters work; use existing tech prerequisites and longer cost/build times rather than adding a research subsystem.
10. Add the minimal airfield definition and building appearance using M3 systems, with a data-defined war-factory prerequisite. Produce fighters through it. Fighters use air movement, holding patterns and attack passes; weapons specify valid air/ground targets. Each faction's fighter provides an air counter. Fuel/rearming and separate anti-air unit types are outside this v1 plan.
11. AT guns may use a setup delay before firing. Artillery uses longer range and HE splash. Rifle squads and MG/sniper fire primarily counter infantry. Truck/engineer/MCV behavior must not acquire arbitrary weapons just because other units can attack.
12. Profile 200 mixed units with active projectiles while panning/zooming and updating fog. Optimize measured hotspots while retaining Canvas 2D. PixiJS still requires user approval and evidence that Canvas is the bottleneck.

### Acceptance and tests

- Repeatable equal-condition tests show AT destroying heavy armor substantially faster than rifle squads. Rifle fire only marginally damages tanks. Artillery's configured firing range exceeds tank and AT range.
- Include close-range and approach-range scenarios; a costlier unit is not automatically expected to win every matchup. Record observed time-to-kill and the intended counter relationships in BALANCE.md.
- Projectiles have travel time; splash respects radius/falloff; invalid target layers do not take hits. Pool exhaustion cannot make outcomes depend on frame rate.
- Promotions persist, apply bonuses once, and do not duplicate kill credit. Destroyed entities release navigation, production and docking state.
- Move enemies out of sight and inspect the map, minimap, hover and selection HUD. Their live positions/HP/activity must not leak. Re-enter sight and update frozen building knowledge correctly.
- Every required unit is reachable through legal production prerequisites in the combat sandbox, except the deliberately starting-only MCV.
- Run identical combat commands through different render schedules and compare final authoritative state after equal tick counts.
- Record a 200-unit-plus-projectile performance run with host/browser/viewport, frame intervals, simulation time, render time, visible counts and peak pool use. Separate steady state from loading or resize pauses.

**Stop after M4:** counters, visibility and the entire roster work. Scripted enemy base management is M5.

## 11 M5 Scripted enemy AI

**Playable outcome:** the opponent starts from its own MCV, develops a base/economy, defends itself, and sends escalating mixed forces. The player can fight it through the normal game UI.

### Implementation order

1. Define `/data/ai.json` with per-faction opening steps, economic targets, production priorities, expansion triggers, wave schedule/composition, defense radius/reserves, and bounded retry intervals. Difficulty selects different data values, not different code branches.
2. Use the same validated commands, costs, prerequisites, power system, placement rules, navigation and production queues as the player. The AI must not directly spawn armies or buildings or ignore payment.
3. Implement a tick-driven planner with a deterministic action budget. Its main concerns are bootstrap, income maintenance, prerequisite recovery, production, defense and attack scheduling. Prevent two subsystems from continually replacing each other's orders.
4. Search buildable sites near owned construction support, leaving approach/exit corridors. Failed placement must advance a bounded candidate search and retry later, rather than looping within one tick.
5. Maintain supply trucks, choose reachable dumps, expand to further supplies when worthwhile/depleted, and capture reachable oil. Expansion here means stronger map/economy control, not an unrequested second strategic HQ system.
6. Assemble affordable waves from actual produced units. Timers request a target composition; insufficient resources or unfinished units delay launch. Keep a data-defined defense reserve and protect workers.
7. Defend against observed threats using the same vision rules as the player. A scripted opposing starting sector may be a declared strategic destination; it is not permission to track hidden moving units.
8. Recover from depleted resources, lost trucks, destroyed power/prerequisites, blocked exits and failed paths when remaining credits/resources make recovery possible. Prioritize restoring essential production before issuing impossible wave orders. If the last truck is lost with no affordable replacement or oil income, use a data-defined bankruptcy fallback: sell an eligible non-objective building only if doing so enables recovery, otherwise enter a stable stalled state with bounded reassessment. Never invent free credits/units or spin on impossible actions.
9. Provide development evidence of AI intentions through a clearly marked optional diagnostic panel or test logs. Ordinary player HUD must not reveal enemy plans or hidden state.

### Acceptance and tests

- Each faction and difficulty completes a legal opening, reaches income and sustains production without negative credits, free entities or ignored power.
- Observe at least three escalating waves with mixed roles. Record launch ticks, composition and actual arrival, rather than merely checking that a timer fired.
- Destroy/remove a power plant, truck and prerequisite building in controlled scenarios with sufficient remaining credits or viable income. Confirm recovery attempts and resumed production. Separately test irrecoverable bankruptcy for stable behavior and no retry spin.
- Exhaust a nearby dump and verify movement to further supplies or oil expansion.
- Attack the enemy base and confirm defense without permanently abandoning its economy or sending every unit away.
- Replay the same seed/orders/difficulty and obtain identical AI commands and authoritative snapshots.
- Demonstrate that difficulty behavior changes by editing JSON values alone. Prefer economy/tempo/composition knobs over unexplained combat cheats.

**Stop after M5:** the opponent functions over a sustained skirmish. The final menu/result/save experience is M6.

## 12 M6 Complete match and static delivery

**Playable outcome:** launch a URL, choose a skirmish, play to victory or defeat, save/load, and start another match without opening developer tools.

### Application flow

Implement explicit application states: main menu → skirmish setup → loading/starting → playing ↔ paused → results. Menus provide faction, map and difficulty selection; at least two named, data-defined map presets may share the procedural generator. Validate both sides' spawns, buildable base area, resource access and traversable combat routes for each preset.

Keep milestone sandboxes available only as labelled development/testing scenarios, not the normal default match. New matches must create fresh world state and release old listeners, loops, caches and audio references.

### Implementation order

1. Add menu/setup/pause/result UI and accessible controls. The selected configuration must actually affect faction rules, map seed/layout and AI difficulty.
2. Implement the strategic objective rule explicitly. Before deployment, an existing starting MCV keeps a player alive; losing it before HQ deployment causes defeat. Successful deployment transfers the objective to HQ. Its destruction ends the match. Simultaneous objective destruction in the same tick is a draw. Freeze gameplay outcomes after the terminal state.
3. Complete any remaining required controls: groups and double click from M1, production shortcuts/rally/sell/repair from M3, contextual attack from M4. Test shortcut contexts from every menu/modal.
4. Add WebAudio-synthesized selection/order/production/fire/impact/explosion SFX after a user gesture unlocks audio. Provide mute/volume controls, cap simultaneous voices, and avoid excessive sounds from large selections. Audio never controls simulation timing.
5. Add pooled explosions and particles, bounded screenshake and a subtle day tint. These are presentation-only; respect reduced-motion preference for shake. They must not reduce visibility contrast or hide important command feedback.
6. Implement versioned localStorage saves with a rules/schema version and compatibility validation. Save the authoritative state at a simulation-tick boundary. Validate completely before replacing an active match; keep the current match usable if loading fails.
7. Save map seed/preset and mutable map state; tick/PRNG/ID/command sequence counters; players/objectives; entities and orders; resource stock/cargo; production and payment progress; projectiles; visibility/exploration and known-building records; AI decisions/timers; and scheduled events. Include accumulated movement/work/loading remainders, scheduler counters, and authoritative pool/free-list order, or use a canonical allocation policy that provably reproduces subsequent IDs and slot reuse.
8. Preserve navigation paths, reservations, pending jobs and scheduler position, or provide a formally deterministic rebuild that is covered by continuation tests. Reinitializing them ad hoc can change combat/economy outcomes after loading. If in-progress path heaps are serialized, encode typed arrays compactly and budget storage size; do not write all map caches into localStorage.
9. Rebuild rendering caches, DOM and audio state after load; never serialize Canvas contexts or object references. Handle malformed JSON, incompatible versions and localStorage quota errors with readable messages and no partial state replacement. Persist user audio/control preferences separately from the match.
10. Pause while a modal pause state or hidden page applies, resume without catch-up, and keep saved game timing independent of wall time. Verify reload during hauling, construction, combat and pending movement.
11. Build `dist/`, test it via static preview and at a subdirectory URL. No Vite development endpoint, remote asset URL, account or backend may be required by the deployed game. Document Caddy deployment in README.md without deploying to the user's VM.

### Acceptance and tests

- Start a normal match as each faction. Complete at least one victory and one defeat against the AI; verify predeployment MCV loss and simultaneous HQ loss in deterministic fixtures.
- Finish a match, return to the menu, and start another. Ensure no duplicate game loops, handlers, timers, resources or lingering sounds.
- Save during hauling, production and combat, reload, then advance the same commands to the same future tick. Include partial fractional progress, reused projectile slots and pending A* jobs. Compare authoritative state with an uninterrupted run.
- Try malformed, incompatible and oversized saves. The active match must remain intact and the user must receive useful feedback.
- Play a complete match without developer tools or console commands. Menus, build requirements, power, queue pauses, victory and load failures must explain themselves in the UI.
- Test audio unlock, mute persistence, pause/resume, hidden-tab behavior, zoom/selection under fog and compact HUD layout.
- Repeat the performance scenario with 200 units, projectiles, fog, AI and effects active. Confirm cosmetic limits preserve gameplay results.
- Verify production root/subdirectory hosting, relative assets, page reload, both maps/factions/difficulties, and clean browser console.

**Stop after M6:** deliver the complete static game, exact verification results, final commit and remaining known limitations for review.

## 13 Verification and performance protocol

Automated tests should protect observable invariants, not restate implementation details. Use pure headless simulation fixtures wherever possible and manual browser testing for input, visual layering, responsiveness and playability.

| Milestone | Essential automated coverage |
| --- | --- |
| M1 | Walkability/corner rules, reachable destinations, bridge congestion recovery, stale-order cancellation, deterministic command replay |
| M2 | Resource/credit conservation, partial deposits, target depletion, docking leases, capture ownership and payment |
| M3 | Bootstrap affordability, prerequisite graph, atomic deployment/placement, progress/payment/refunds, low-power rate, blocked exits |
| M4 | Armor/penetration and range relationships, projectile lifetime, splash, kill credit, promotions, visibility information rules, deterministic combat |
| M5 | Legal build orders, payment, recovery, wave composition, deterministic AI, difficulty chosen from data |
| M6 | Save validation and continuation, objective transitions, pause/resume, fresh match state, complete application flow |

For each milestone:

1. Read Git status first and preserve unrelated work. Reproduce any baseline failures before attributing them to new changes.
2. Run focused tests while implementing. Add regression coverage for a real bug or acceptance invariant; avoid a large suite of cosmetic implementation-mirroring tests.
3. Run `npm test` and `npm run build` after the milestone's final source changes. Record actual commands, counts and results.
4. Run `npm run dev`, open the printed URL, and execute that milestone's manual scenario plus relevant earlier regressions. Browser QA must exercise the actual controls, not merely call internal functions.
5. Run the production build through `npm run preview`; verify representative interaction and inspect the browser console. M6 additionally tests a static subdirectory URL.
6. Capture useful screenshots of the resulting scenario and controls. Keep screenshots/logs concise; no dependency directories, browser profiles or machine secrets in Git.
7. Update STATUS.md and the milestone verification note, inspect the diff for unintended edits, and commit only a passing build. Stop at the milestone boundary.

If the environment cannot perform browser/manual verification, state the exact missing check and how to run it. Do not substitute unit tests for playability evidence or mark the milestone accepted without the required check.

### Measuring the performance requirement

Use a repeatable scenario, seed and command sequence. Record operating system, CPU/GPU if available, browser/version, viewport, device pixel ratio, unit count, active/peak projectiles, visible scenery, and effects settings. Do not call the test host a midrange laptop without identifying it.

After warm-up, sample at least 60 seconds of representative camera movement and gameplay. Record frame interval median/p95, simulation tick work, rendering work, long stalls, and any garbage-collection pressure visible in available tooling. Target approximately 16.7 ms frame intervals on a 60 Hz display without sustained drops or control hitches. A single FPS badge sample is not a complete benchmark. Distinguish render cadence, application CPU work and browser compositing time.

Use the 200-unit scenario from M1 onward, adding projectiles/fog in M4 and AI/effects by M6. If measurements miss budget, identify the dominant cost before optimizing: path job budget, spatial queries, depth sorting, fog recomputation, chunk/cache size, sprite blits or DOM updates. Cache static drawing, update HUD on changes or a modest cadence, and avoid per-frame `map/filter/sort` allocations over fresh collections. Reuse scratch buffers and bound worst-case work.

Do not lower unit counts, disable required fog, reduce the map size, or omit active combat to claim the final performance criterion passed. Do not switch render frameworks without the required approval.

## 14 Review handoff

The user intends to return to Codex for review. Leave enough evidence for a reviewer to reproduce the behavior without reconstructing the implementation chat.

Update STATUS.md with completed scope, next milestone, known issues, run instructions and verification summary. Put detailed scenario evidence in `docs/verification/M1.md` through `M6.md` as milestones complete. These are records of checks actually performed, not pre-filled claims.

Use this structure for each verification note:

```text
Milestone and date
Base implementation commit
Implementation scope and changed systems
Design decisions and departures from the plan
New dependencies and one-line justifications, if any
Commands run and actual results
Browser and hardware context
Scenario seed, setup and exact player actions
Expected outcome and observed outcome
Performance samples and measurement method
Screenshots or concise logs
Known issues and checks not performed
Steps for the reviewer to reproduce
```

In the final chat handoff for each implementation session, report the completed milestone, commit hash, build/test/manual results, any material limitation, and the next milestone. Never mark later milestones done because their schemas or hooks exist.

Review should particularly check:

- Rules are data-driven and both factions' content is reachable through valid prerequisites.
- Build times and prerequisite buildings affect actual production and are visible in the UI.
- No gameplay decisions depend on rendering, wall time, camera or cosmetic random calls.
- Navigation cannot permanently strand reachable units at bottlenecks.
- Money, cargo, queues, damage and experience cannot be duplicated.
- Enemy information cannot leak around fog through minimap, HUD or AI targeting.
- Saves reproduce continuation rather than merely restoring approximate positions.
- The production build is genuinely static and behaves without dev tools.
- Existing M0 camera/map behavior remains usable through all later work.

## 15 Reference usage

Use these projects for the roles specified by the user. Read the relevant primary material when implementing the associated system; no source code or assets are to be copied.

- [Chrono Divide](https://chronodivide.com/): compare cursor feedback, selection responsiveness, camera feel and pacing through observation.
- [OpenRA](https://github.com/OpenRA/OpenRA): use the idea of data-defined rules and generic engine behavior as an architectural reference.
- [Spring 1944](https://github.com/spring1944/spring1944): source the published unit/weapon relationships used in M4 balance and cite precise revisions/files in BALANCE.md.
- [SC Js](https://github.com/gloomyson/SC_Js) and [red alert web](https://github.com/baiiab/red-alert-web): feasibility references for a Canvas/vanilla-JavaScript RTS.
- [Vite documentation](https://vite.dev/guide/) and [TypeScript documentation](https://www.typescriptlang.org/docs/): consult current primary documentation when changing build configuration or toolchain behavior.

## 16 Prompt to start the next Claude Code session

```text
Work in this Steel Front repository. Read AGENTS.md, PROJECT.md, STATUS.md,
and CLAUDE_PLAN.md, then inspect the current source and Git state.

Implement M1 only, following section 7 and the shared architecture/data/input
contracts. Preserve the completed M0 map and camera. Print the M1 file plan
before editing. No new npm dependency without a one-line justification.

Complete the playable 20-unit maneuver scenario, deterministic simulation,
selection/orders, directional rendering, A*, formation spread, and recovery
from bridge congestion. Use the plan's acceptance scenarios to verify it.
Run npm test, npm run build, npm run dev for manual testing, and production
preview. Fix acceptance failures before finishing. Record actual results in
STATUS.md and docs/verification/M1.md, then commit the passing build.

Stop after M1 and report the commit, verification evidence, known issues,
and next step. Do not begin M2. The user will request an independent review.
```

For a later session, select the next milestone from STATUS.md and use its corresponding section. If the user requests a review fix, fix the reviewed milestone first; do not use the remaining roadmap as permission to advance prematurely.
