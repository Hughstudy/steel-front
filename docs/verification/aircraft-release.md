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

The production build uses relative asset paths and includes `.nojekyll`. Source is published to `main`; `gh-pages` contains compiled static files.

- Public URL: https://hughstudy.github.io/steel-front/
- Runtime source commit: `a43a8a9a132652895b6a9cc767a3717218918db7`.
- Deployment commit: `ba5c98ca8d07b54807fccba137e500550dd2f2ad`.
- GitHub Pages reports `built`, with HTTPS enforced. The public HTML, JavaScript and CSS match the local production build byte for byte. `build-info.json` identifies the source commit.
- Real input on the public URL: chose Axis / The Ardennes / Regular, started a battle, selected and deployed the MCV, then queued a Kraftwerk. Funds and production progress updated. No browser warnings/errors.
- Removed the temporary M2/review copies, review JSONL output, npm cache and release staging directory. Permanent verification files, installed dependencies and the usable production build remain.

Existing limitations: no fully hand-played victory, no listening test for audio, and no sustained target-laptop frame-pacing measurement.
