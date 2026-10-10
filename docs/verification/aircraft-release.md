# Aircraft fixes and GitHub Pages release

2026-10-10, following the independent HEAD-versus-origin/main review.

## Fixes

- Manual aircraft moves and rally orders retain priority over automatic target acquisition until arrival. Explicit attack, attack-move and stop still replace them.
- Aircraft too close to a target choose a forward escape point and re-approach with room to turn and fire, including near map boundaries.
- Flight orders and pass waypoints are serialized for deterministic continuation. Version-1 saves without these fields are migrated.
- Pointer entry updates the camera's coordinates, preventing stale edge-scroll when a menu closes over a stationary pointer.

## Verification

- The original aircraft reproductions failed before the fix: manual retreat never arrived and a close stationary target received no shots over 2,400 ticks.
- Nine aircraft tests cover both factions, 24 heading/corner cases, automatic and explicit attacks, order replacement, arrival/stop, deterministic save continuation and legacy saves.
- Two camera tests failed before the fix and pass after it: centered re-entry remains stationary; true edge entry scrolls along the correct axis.
- Full suite: 94/94 pass. TypeScript check, Vite production build and whitespace check pass.
- Independent read-only review found no actionable issues in the aircraft patch. Its additional 256 fog-enabled heading/corner cases all killed the stationary target.
- `npm run dev -- --port 5174 --strictPort`, real browser input at 1280×850: started an Allies/Lowlands/Regular skirmish, deployed the MCV, queued and placed a generator, observed power and barracks unlock, saved to an empty slot, loaded and resumed. No console warnings/errors. HUD displayed 60 FPS; this is a smoke check, not a long-session performance certification.

## Delivery

The production build uses relative asset paths and includes `.nojekyll`. Source is published to `main`; `gh-pages` contains compiled static files. Public URL verification and temporary-file cleanup are recorded in STATUS.md once complete.

Existing limitations: no fully hand-played victory, no listening test for audio, and no sustained target-laptop frame-pacing measurement.
