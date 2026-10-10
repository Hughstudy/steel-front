# Steel Front status

## Done — M5: Skirmish AI
Completed 2026-10-10. The default scenario "Skirmish vs AI" pits your MCV against a computer-controlled Axis MCV across the river, at Recruit, Regular or Veteran difficulty (selector in the top bar).

- The data-driven planner (`data/ai.json`, `src/sim/ai.ts`) uses only legal commands. It handles bootstrap, spaced building placement, power, trucks and engineers, composition-weighted production, defence, escalating attack-move waves, and recovery or bankruptcy fallback, all deterministically.
- Attack-move for everyone: Ctrl/⌘+right-click or the ATK-MOVE button.
- Details and evidence: `docs/verification/M5.md`.

## Verification (M5)
- `npm test`: 69/69 pass. `npm run build`: pass.
- Browser dev: deployed and built a base with real clicks. The AI's first wave stayed hidden by fog until in sight. Ctrl+right-click and the ATK-MOVE button both gave real attack-move orders. The difficulty select restarted with a Veteran AI.
- Preview: wave timings were identical to the headless run; p99 tick 0.3 ms. No console messages.
- Not done: a complete hand-played match to victory or defeat (victory rules arrive in M6).

## Next — M6: Complete match and static delivery
Menus and skirmish setup, the objective/victory rule, WebAudio, effects polish, versioned saves, a second map preset, subdirectory hosting test, and Caddy docs.

---

## Done — M4: Combat and fog
Completed 2026-10-10. The default scenario "Combat Sandbox" gives each side a base and a mixed army on opposite banks. "Battle Stress (200)" is a 100 v 100 profiling battle.

- Data-driven weapons, armour classes, penetration, projectiles, splash, setup, turrets, veterancy, and a full roster including towed guns, howitzers and fighters (Airfield).
- Deterministic fog of war with explored memory. One visibility rule covers the view, minimap, panel, orders and effects. Remembered structures appear as ghosts with no live information.
- Right-click attack with a crosshair cursor, effects and projectile rendering, rank chevrons, and aircraft at altitude.
- Balance anchored on Spring: 1944 ratios (CC BY-NC data, used as ratios only): see `BALANCE.md`.
- Details and evidence: `docs/verification/M4.md`.

## Verification (M4)
- `npm test`: 60/60 pass. `npm run build`: pass.
- Browser dev: real drag-select, right-click move and right-click attack (all 19 armed units targeted the clicked squad). The battle shows effects, promotions, fog and minimap shroud.
- Preview: 200-unit battle benchmark. Frame CPU median 0.2 ms, p95 1.5 ms, max 5.6 ms. Sim tick max 5.5 ms; projectile peak 20. No console messages.
- Not measured: long-session real-time frame pacing.

---

## Done — M3: Base building
Completed 2026-10-10. Default scenario "Forward Outpost": one MCV and 5000 credits. Deploy an HQ, then build a generator, barracks and motor pool from the production panel, produce trucks, infantry and vehicles, set rally points, and sell or repair. Everything is reachable through the HUD.

- Data-driven tech tree, production categories and policies (`data/production.json`). Progressive payment, low power at 1/4 rate, exact refunds, shared placement validation with evacuation of units on the footprint.
- Q/W/E production keyboard context that never pans the camera.
- Details and evidence: `docs/verification/M3.md`.

## Verification (M3)
- `npm test`: 50/50 pass. `npm run build`: pass.
- Browser dev: the full MCV → HQ → power → barracks → motor pool → truck → income loop, rally, sell and keyboard focus were done with real clicks and keys. Preview: invalid placement feedback, 200-unit benchmark, no console messages.
- Not measured: real-time frame pacing (the pane was hidden).

---

## Public repository — M2

Prepared 2026-10-10 for `https://github.com/Hughstudy/steel-front` (public, `main`).

- Publication uses the committed M2 code from `a5479bf`; this status note is the only addition.
- Verified an isolated snapshot of that commit: `npm run build` passes; `npm test` passes all 37 tests.
- In-progress M3 changes remain local and are excluded from this publication. M3 remains the next milestone.

## Done — M2: Economy
Completed 2026-10-10. Playable "Logistics Exercise" (default scenario): an HQ fixture, three supply trucks, an engineer and two rifle squads, with 10 supply dumps and 4 oil derricks placed from `data/maps.json`.

- Integer stock/cargo/credits; truck hauling state machine with dock leases, deterministic target choice and readable idle reasons; engineer capture; oil income; per-player ledger.
- Context right-click (haul / unload / capture), FUNDS counter, structure intel panel, cargo and capture progress bars.
- Details and evidence: `docs/verification/M2.md`.

## Verification (M2)
- `npm test`: 37/37 pass. `npm run build`: pass.
- Browser dev and preview: capture and haul orders were issued with real clicks. A 5-minute untouched preview run produced 9200 credits, which equals the ledger exactly. No console messages.
- Not measured: real-time frame pacing (the pane was hidden).

---

## Done — M1: Units & control
Completed 2026-10-10. Playable "Maneuver Exercise": 20 mixed Allied units (8 rifle squads, 4 Stuarts, 4 halftracks, 4 supply trucks) on the west bank, plus a labelled 200-unit stress scenario. Both are reachable from HUD buttons.

- Data-driven, validated rules: `data/game.json`, `terrain.json`, `factions.json`, `units.json`, `scenarios.json`.
- Headless deterministic `World`: fixed-point positions, tick-stamped commands, atomic budgeted A* jobs, distance-field heuristic, formation slots, tile reservations, shove/yield with aging priority, and no-progress recovery.
- Procedural 16-direction unit sprites, with turrets and infantry walk frames, interleaved with scenery depth.
- Selection: click, Shift toggle, box drag, double-click by type, Ctrl+0–9 / 0–9 groups (double tap centres), right-click move with marker feedback, X stop, Esc clear, cursor feedback, selection panel and minimap dots.
- Gameplay pauses while the page is hidden; resuming never replays hidden time.
- Details and evidence: `docs/verification/M1.md`.

## Verification (M1)
- `npm test`: 28/28 pass. `npm run build`: pass.
- Headless acceptance: 20 units crossed both bridges and back; head-on bridge traffic, rapid re-orders, a map-edge crowd and a water click all settle; 200 units cross the map. The tests check occupancy invariants.
- Browser (dev and production preview): selection, groups, double-click, Shift, right-click and zoom-limit hit testing were exercised with real input. No console errors.
- Not measured: 60 Hz frame intervals (the browser pane was hidden, so rAF was throttled). A CPU benchmark is recorded instead.

---

## Done — M0: Map & camera
Completed 2026-10-10 (Asia/Singapore). Playable reconnaissance build; no later milestone work started.

- TypeScript + Vite, pure Canvas 2D, no runtime npm dependencies. Static `dist/` build with relative asset URLs for Caddy/subdirectory hosting.
- Seeded 128×128 battlefield of 64×32 isometric tiles: meadow, forests, riverbanks, river, connected roads/bridges, farmland, rocks, cottages and ruins. Scenery is decorative, not simulation buildings.
- Terrain settings and palette in `data/map.json`; all art original procedural drawing, credited in ASSETS.md.
- Smooth WASD/arrows and edge scroll, Shift fast pan, middle mouse drag, cursor-anchored wheel zoom (35–180%), zoom buttons, Home/Space reset, G grid toggle.
- Isometric minimap with click/drag navigation and camera footprint; terrain inspection; top resource placeholders and bottom command HUD; working field guide.
- Deterministic 20 Hz clock with render interpolation and bounded background catch-up; camera controls are presentation state, independent of simulation ticks.
- Cached ground chunks, reusable prop sprites, viewport culling and diagonal scenery depth order. Render loops reuse state rather than allocating collections each frame.

## Verification
- `npm run build`: PASS (strict TypeScript + Vite production build).
- `npm test`: PASS, 13 tests. Includes seeded map reproducibility, all roads/bridges connected by four-neighbor paths, camera bounds and transforms, zoom anchoring/limits, frame-rate-independent camera smoothing, deterministic tick ordering, and background catch-up.
- Ran `npm run dev`; manually tested in the Codex browser at 1440×900, 1024×768, and the native narrow ~630×880 panel.
- Manual PASS: WASD directions, Shift fast traversal, right-edge scrolling, wheel and button zoom including 35%/180% limits, minimap corner jumps and drag, Home/button reset, grid toggle, field guide open/close, keyboard Space activation of zoom button.
- Observed steady 60 FPS while traversing/zooming the full 128×128 map, including forest-heavy overview and map edges. HUD render work samples approximately 0.3–0.8 ms with 6–36 visible chunks on this host. Brief resize/reload samples are excluded from steady-state observations.
- `npm run preview`: static production build loads and responds to pan/reset; browser console returned no warnings/errors. No dev tools needed for play.
- Captured production preview: `docs/m0-preview.jpg`.
- Fixed during manual QA: disconnected road artwork, diagonal approach-road gaps, overlapping bridge lanes, and Space intercepting focused HUD buttons.

## Implementation handoff

- Added `CLAUDE_PLAN.md`: full M1–M6 implementation order, architecture/data contracts, design defaults, acceptance scenarios and review evidence requirements.
- Added `CLAUDE.md`: entry instructions for Claude Code. Start with the M1 prompt at the end of the plan.
- This is a documentation-only handoff. M0 remains the only implemented milestone; no M1 runtime work has begun.
- Handoff check: existing 13 tests and the production build still pass; no browser re-test was needed for these documentation-only changes.

## (historical) M1 plan
- Data-driven unit definitions including future cost/build time/prerequisite fields.
- Render animated directional units; box select and right-click move.
- Grid A*, unit avoidance/recovery, and formation spread.
- Acceptance: select 20 mixed units and send them across the map; none permanently stuck.

## Known issues / scope
- No M0 functional blockers found. Hardware measurements are local browser observations, not a benchmark of a separate midrange laptop or the future 200-unit scenario.
- The 64 ground chunk caches use about 137 MB of raw canvas storage before browser overhead. Revisit memory/LOD if target-laptop profiling warrants it.
- Desktop keyboard/mouse experience; compact HUD supports widths down to 550 px. Phone/touch play is outside this milestone.
- No units, economy, gameplay buildings, combat, AI, save/load or win/lose yet; resource counters intentionally display dashes.
- This workspace initially contained no source, instructions, status file or Git repository; PROJECT.md preserves the combined user brief.

## Run
`npm install`, then `npm run dev`. `npm run build` emits the static files for deployment. Local QA servers are stopped after verification; restart with the command above.
