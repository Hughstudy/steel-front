# Steel Front status

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

## Next — M1 (next session)
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
