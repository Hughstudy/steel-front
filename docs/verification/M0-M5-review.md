# M0–M5 independent code review

Reviewed 2026-10-10 (Asia/Singapore). Baseline: `e67f5c03435f4a07955e04bf17c11794c1a1b820` (`Build M5 skirmish AI`).

## Assessment

M0–M5 contain substantial implementations of their planned systems, including a real computer opponent. The completion claims are supported by code and meaningful tests, but seven reproduced gameplay/control defects prevent an unqualified acceptance. All findings below are P2: normal-priority functional fixes. No P0/P1 defect was confirmed in this review.

The review used a frozen Git archive because Claude was actively changing the working tree for M6. It does not certify M6 or count its unfinished features as defects. At the final source comparison, the reported code paths still existed in the working tree; M6 edits mainly added match outcome/statistics/save support around them. No runtime implementation was changed by this review.

## Verified results

- `npm run build`: **PASS**, strict TypeScript and Vite static production output (61 modules).
- `npm test`: **69/69 PASS** on the frozen M5 baseline.
- Independent normal-command bootstrap for **both factions**: one MCV and 5,000 credits → HQ → power → barracks → factory → truck at tick 1,464; 400 credits delivered by tick 2,120. Each ledger was 5,000 + 400 − 4,100 = 1,300, with power 100 supply / 50 demand.
- Additional congestion probe: **200 units in four 50-unit columns**, then swapped opposing destinations across the bridges. All settled, with no Waiting/Unreachable units; initial destinations at tick 3,732, swap at tick 12,974. This establishes eventual recovery for that case, not fast traffic or frame pacing.
- Browser: frozen development build at localhost:5188, native 631 × 878 viewport. Real clicks deployed the MCV and queued a generator, which completed for 800 credits. Real production-tab and keyboard input reproduced finding R5. Scenario switching worked. No browser warning/error logs were observed.
- New focused headless probes reproduced R1–R4 and R6–R7; manual browser steps reproduced R5. The existing 69 tests missed these cases.

## Milestone coverage

| Milestone | Implementation and evidence | Qualification |
|---|---|---|
| M0 — map/camera | Procedural 128×128 terrain, isometric camera, zoom, minimap, fixed-step loop; existing camera/terrain/clock tests pass. | Sustained real-time 60 FPS on a midrange laptop is not independently established. |
| M1 — units/control | Directional sprites, selection/groups, A*, formation spread and congestion recovery; existing and additional traffic checks pass. | Aircraft introduced by M4 expose a movement-input regression (R4). |
| M2 — economy | Truck load/haul/deposit, integer ledger, oil capture and unattended income; tests pass. | Resource/capture orders fail to replace an in-progress move promptly (R3). |
| M3 — base building | Both factions bootstrap legally; queues, progressive payment, power, placement, rally, sell and repair are implemented. | Production focus is lost (R5); placement can command hostile units (R6). |
| M4 — combat/fog | Weapons, armor, penetration, projectiles, turrets, veterancy, fog and remembered structures exist; counter-matchup and replay tests pass. | Artillery attack-move can stall (R1); previews leak hidden structure state (R2); aircraft normal moves can be rejected (R4). |
| M5 — enemy AI | JSON build orders/difficulty, legal command planning, economy, mixed waves, defense and recovery; both factions × three difficulties tested. | Oil expansion fails after a valid MCV relocation (R7). |

## Findings

Source line numbers below refer to the reviewed M5 commit; ongoing M6 changes can shift them.

### R1 — [P2] Artillery attack-move can lock forever on an enemy inside minimum range

**Locations:** `src/sim/combat.ts:230–234`, `245–248`; firing rejection at `178`.

`sighted()` selects the nearest hostile without considering minimum firing range. `chase()` then treats a sufficiently close target as in range and stops movement. The firing loop correctly refuses the shot, leaving the artillery unable to fire, reposition, finish its order, or choose another target. AI artillery uses the same attack-move path.

**Reproduction:** Allied howitzer at (30,60), unarmed Axis truck at (32,60), passive Axis tank at (42,60). Run 1,600 ticks (80 simulated seconds). Idle howitzer fires 10 shots and destroys the tank. Attack-move toward (46,60) fires zero shots, moves only to (31,60), and keeps targeting the truck; the tank remains at 467 HP. Explicit attack on the close truck also stalls. Only the tank's cooldown is held to isolate the test; weapon statistics are unchanged.

**Fix direction:** minimum range must participate in engagement movement/selection. Reposition for explicit close attacks and avoid allowing an impossible close target to block attack-move indefinitely.

**Regression check:** run idle, explicit-attack and attack-move cases with enemies inside the dead zone and another valid target outside it; verify useful firing or movement resumes.

### R2 — [P2] Placement and movement feedback reveal hidden enemy structures

**Locations:** `src/ui/placement.ts:67`, `97–106`; `src/main.ts:434–437` draws placement after fog. Related cursor check: `src/main.ts:344`.

The preview reads live `nav.structure` and collision state even on unexplored tiles. Its footprint colors reveal occupied tiles over the shroud, while rejection text distinguishes an unseen building from empty distant ground. The movement cursor similarly changes based on hidden structure passability. This contradicts the M4 shared-visibility guarantee.

**Reproduction:** Over a distant Axis power plant, player 0 has `canSee=false` and `explored=0`. Placement returns `structure` and paints all four occupied cells `rgba(225,80,60,.5)`. Remove that building while it remains unseen: the same preview returns `range`, paints `.42` alpha instead, and passability changes from false to true. The UI therefore exposes current hidden state rather than last-seen knowledge.

**Fix direction:** use visible/remembered information for presentation previews, or reject unexplored placement before checking live collisions. Keep authoritative command validation strict without exposing hidden rejection detail.

**Regression check:** hidden building creation/removal must not change cursor, ghost colors or rejection wording until the site becomes visible.

### R3 — [P2] New capture/harvest orders leave the old movement route active

**Locations:** `src/sim/world.ts:429–433`, `442–445`; task waiting in `capture.ts:37–39` and `truck-ai.ts:52`.

`cancelTask()` clears task metadata but leaves the path and movement goal. The new capture or harvesting state waits while movement continues, so the unit can travel farther away for its entire previous journey before responding to the replacement order.

**Reproduction:** On open ground, move an engineer/truck from (20,20) toward (110,20). At tick 40, issue capture/harvest against a derrick/dump at (10,20). After 400 more ticks (20 seconds), the engineer is at (44,20), the truck at (55,20), both still target (110,20), and the resource/capture target is untouched.

**Fix direction:** replacement resource/capture commands should clear the old route while safely completing any current tile transition, then start the new task promptly. Apply the same reasoning to the shared deposit path.

**Regression check:** replace a long move and an existing haul route with a new capture/harvest/unload command while the unit is between tiles. Existing economy tests resume hauling after the preceding move has settled and miss this case.

### R4 — [P2] Ordinary right-click movement rejects aircraft over blocked ground

**Location:** `src/main.ts:231–236`.

The UI requires the lead selected unit to have a valid ground navigation component before enqueuing a move. Aircraft ignore ground navigation, but their current tile is still used by this guard. Flying over water, trees or a building can therefore make valid movement commands disappear, and an aircraft leading a mixed selection can suppress that selection's order.

**Reproduction:** A fighter over river tile (52,70) on the real Lowlands map has movement `air` and ground component `-1`. The UI guard rejects a move to (90,70). The same command sent to `World.enqueue()` is accepted and sets its goal to tile 9,050 on the next tick. Ctrl+right-click attack-move bypasses the faulty guard.

**Fix direction:** separate air and ground movement validation before applying the ground preview. Valid air orders must not depend on the terrain beneath the aircraft.

**Regression check:** normal move from above river, scenery and a building, both with an aircraft alone and in a mixed selection.

### R5 — [P2] Switching production tabs discards keyboard focus

**Locations:** `src/ui/production-panel.ts:115–124` (DOM replacement), `51` and `72–94` (keyboard handler).

Tab changes rebuild both the tabs and cards with `replaceChildren()`, deleting the focused button. Focus falls to the document body, while production hotkeys are handled only under the production root. The next Q/W/E/R or digit no longer reaches that handler; W can fall back to camera controls and digits to control groups.

**Browser reproduction:** Focus the Generator Station card, press W: Infantry becomes active, but `document.activeElement.tagName` becomes `BODY`. Press E: Infantry remains active. Independently, switch to Combat Sandbox (producers already available), click Vehicles, then press 1. The M3 Halftrack remains unqueued (`.is-queued` count zero), with focus still on `BODY`.

**Fix direction:** retain stable tab/card nodes or restore focus to a stable production element after rebuilding; preserve keyboard context when prerequisites change, too.

**Regression check:** click a tab → digit builds; focus a card → W → E → digit builds; newly unlocked catalog items do not silently return focus to the battlefield.

### R6 — [P2] Building placement gives orders to hostile units

**Location:** `src/sim/production.ts:345–349`.

Pending placement evacuates stationary occupants without checking ownership. A player can place a finished building over an enemy unit to order that enemy out of the way. MCV deployment uses the same routine. Hostile occupancy should not confer control over the enemy.

**Reproduction:** Use ordinary player-0 commands to deploy an MCV and fully pay for a generator. Put a stationary player-1 truck on a valid footprint, then issue player-0 placement. The truck changes goal from `-1` to `5262` and orderId from 0 to 1 with zero player-1 commands. After 120 ticks it moves from tile 5,263 to 5,262, and the generator occupies tile 5,263.

**Fix direction:** evacuate only eligible friendly units. Hostile occupants should block placement or make it wait without changing their orders.

**Regression check:** friendly units make way, hostile units keep their command state, and placement/deployment cannot bypass enemy occupancy.

### R7 — [P2] AI abandons oil capture after relocating its MCV

**Locations:** `src/sim/ai.ts:405`, `416`.

Capture filtering derives a ground component from the original spawn, then rejects derricks whose origin tile has no component. Every derrick blocks its own origin. The default scenario works accidentally because the deployed HQ also blocks the original spawn, producing `-1` and skipping that rejection. When the AI moves its MCV before deployment, the original spawn can stay passable and every derrick is filtered out.

**Reproduction:** Change only the Axis scenario anchor to (96,64). The AI legally logs `1 move MCV to 97,62 to deploy`, then `81 deploy MCV`. At tick 20,000 it has 12,400 delivered credits, zero oil income, no engineers and all four derricks neutral. The default anchor produces 11,400 oil income and three captured derricks over the same duration.

**Fix direction:** compare reachable approach/perimeter tiles with the current base or engineer's connected region, not occupied building origins and the obsolete spawn position.

**Regression check:** several valid starting anchors, including one requiring relocation, must still produce engineers and capture reachable friendly-side derricks.

## Reproduce the headless findings

The runner is separate from the normal test suite and does not change game files or install dependencies. It reports observed defects rather than introducing intentionally failing tests into `npm test`.

From the repository root:

```sh
review_root=$(mktemp -d /private/tmp/steel-front-m5-check.XXXXXX)
git archive e67f5c03435f4a07955e04bf17c11794c1a1b820 | tar -x -C "$review_root"
node --experimental-strip-types docs/verification/m5-review-probes.mjs "$review_root"
```

R5 needs the real browser steps above because it depends on focus behavior when a DOM node is removed. Browser evidence: [production controls after clicking Vehicles and pressing 1](m5-review-browser.jpg).

## Limits and next work

- Fix the seven findings and add focused regressions; rerun the standard suite and build afterward.
- Complete M6 separately, then review the final match lifecycle, save/load and an entire human-played match. No M6 acceptance is claimed here.
- Measure sustained frame intervals with 200 units plus projectiles in a visible browser on a defined target machine. A passing CPU benchmark or a momentary 60 FPS HUD reading is insufficient to establish that target.
- Existing historical STATUS sections retain obsolete statements such as “no units/economy/combat/AI yet”; interpret them by milestone date/section, not as the current implementation state.

