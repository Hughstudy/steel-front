# Steel Front

## Mission
A single-player, WW2 browser RTS in the spirit of Red Alert 2. Deploy as pure static files to GitHub Pages or Caddy. Build exactly one milestone per session; every milestone ends playable.

## Working agreements
- Start by reading this file and STATUS.md. Finish by updating STATUS.md (done / next / known issues), validating, and committing.
- Run `npm run dev` and manually test every milestone. Fix failed acceptance before proceeding.
- Never break the build between commits. Keep files small and single-purpose in engine/, sim/, render/, ui/, data/.
- Give a one-line justification before adding any npm dependency.
- Prefer RA2 behavior when a design choice is ambiguous.

## Constraints
1. TypeScript + Vite + Canvas 2D only. No React/Vue, WebGL, 3D, or game framework. PixiJS only with profiling evidence and prior user approval.
2. `vite build` emits static files; no server-side runtime, accounts, backend, multiplayer, or game networking.
3. All art procedural or CC0 (Kenney); credit every source in ASSETS.md. Never copy reference code or assets.
4. Deterministic fixed-timestep simulation (20 Hz), independent rendering with interpolation. Never tie gameplay state to framerate.
5. All unit/building stats, costs, build times, prerequisite buildings, tech tree, AI build orders in /data/*.json. Adding/rebalancing units must not require engine changes.
6. Target 60 fps with 200 units and projectiles on a midrange laptop. Pool projectiles/particles when introduced; avoid per-frame allocations in hot loops.

## Visual direction
- Isometric 64×32 diamond tiles; 128×128 map.
- Muted WW2 olive, sand, field grey; readable silhouettes, shaded procedural shapes, team-color trim.
- Allies olive + white star; Axis grey + balkenkreuz. Health bars, selection ellipses, muzzle flashes, simple explosion particles.
- RA2-style bottom selection/command bar and top money/power strip. Readable contrast.

## Gameplay by M6
Drag-box selection; right-click move/attack; left-click selection; Ctrl+0–9 set groups, 0–9 recall; double-click selects visible units of type; production hotkeys Q/W/E/R; rally points; valid/invalid placement ghost; sell/repair; WASD + edge scroll + zoom.

Supply dumps → supply trucks fill/haul/deposit at HQ/repeat → money; capturable oil derricks; power plants determine production speed.

Allies (US/UK blend) vs Axis (Germany). Each faction: engineer, rifle squad, MG team, sniper, halftrack, light tank (Stuart/Pz III), medium tank (Sherman/Pz IV), later heavy tank (Pershing/Tiger), towed AT gun, artillery, fighter, supply truck, MCV. Stats: cost, hp, speed, armor class (infantry/light/heavy/building), damage type (small arms/HE/AP with simplified penetration vs armor), range, vision, build time, prerequisite building.

## References — ideas only
- https://chronodivide.com — cursor feedback, camera speed, selection, pacing; gameplay feel benchmark.
- https://github.com/OpenRA/OpenRA — data-driven rules and engine separation.
- https://github.com/spring1944/spring1944 — future unit armor/penetration/range/cost ratio anchors; cite used published values in BALANCE.md (JSON does not support comments).
- https://github.com/gloomyson/SC_Js and https://github.com/baiiab/red-alert-web — Canvas/vanilla JS feasibility; no code/assets copied.

## Milestones
### M0 — Map & camera
Procedurally varied isometric terrain, WASD + edge-scroll pan, zoom, click-to-jump minimap. Acceptance: smooth 60 fps pan/zoom over all 128×128 tiles.
### M1 — Units & control
Animated directional units, box select, right-click move, grid A* with unit avoidance and formation spread. Acceptance: send 20 mixed units across map; none permanently stuck.
### M2 — Economy
Supply dumps, truck fill → haul → deposit loop, money, oil capture. Acceptance: unattended income and trucks recovering from blocked paths.
### M3 — Base building
MCV deployment, power plant, barracks, war factory, HQ, production queues, rally points, placement ghost, power. Acceptance: bootstrap entire base from one MCV; working queues; visibly slower production at low power.
### M4 — Combat
Armor/damage classes, projectiles, turret rotation, veterancy, unexplored shroud and explored dim fog. Acceptance: sensible tank battle; AT shreds tanks, rifles barely scratch, artillery outranges both.
### M5 — Enemy AI
/data/ai.json scripted build orders, base construction, economy expansion, escalating mixed waves, base defense. Difficulty changes data knobs only.
### M6 — Game frame
Menu → skirmish faction/map/difficulty, win/lose on HQ destruction, WebAudio synthesized SFX, localStorage save/load, explosions/screenshake/day tint. Acceptance: complete match without dev tools.

### M7 — AI observer and renewable supplies
Add an AI-versus-AI choice to skirmish setup, with camera controls, full battlefield observation, neutral winner results and save/load. Both AI players retain normal fog-of-war rules. Place one infinite truck supply site near each base on both skirmish maps; finite dumps remain finite and trucks must still load, haul and unload for income. Keep delivery as static files compatible with GitHub Pages.

Acceptance: both AI players deploy, build, haul and fight without player commands; observer input cannot command either army; results identify the winning faction; observer saves continue deterministically; both bases have reachable infinite supplies that survive repeated loads; normal skirmish and finite-dump depletion still work. Run the tests, production build and dev-browser checks, update STATUS.md and commit this single milestone.

### M8 — Optional infinite supply yards
Expose an on/off option in skirmish setup for infinite yards near both bases, in Play and Watch modes. Default on preserves the current behavior; off retains the original finite dumps and oil. Save/load and Play Again/Watch Again preserve the choice, and M7 saves without the option remain compatible. Acceptance: both maps and modes respect on/off, invalid save values are rejected, legacy saves load, and the menu summary reflects the choice. Validate, update STATUS.md, commit and publish the static update.
