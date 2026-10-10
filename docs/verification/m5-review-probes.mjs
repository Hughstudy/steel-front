/**
 * Review-only diagnostics for the M5 snapshot; these are not npm regression tests.
 * Usage: node --experimental-strip-types docs/verification/m5-review-probes.mjs /path/to/snapshot
 * Expected defects print "observed" rather than failing the process. Fixture/import
 * failures still throw. No source, saved game, or data files are modified.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) throw new Error('Supply the root of the source snapshot to review.');
const root = resolve(process.argv[2]);
const fromRoot = path => import(pathToFileURL(resolve(root, path)).href);
const { rules, lowlands, scenarioWorld } = await fromRoot('tests/helpers.ts');
const { World } = await fromRoot('src/sim/world.ts');
const { constructionProblem } = await fromRoot('src/sim/production.ts');
const { Placement, drawFootprint } = await fromRoot('src/ui/placement.ts');
const { updateFog, canSee } = await fromRoot('src/sim/fog.ts');
const results = [];
const run = (world, ticks) => { for (let i = 0; i < ticks; i++) world.step(); };
const xy = (world, tile) => [tile % world.nav.width, Math.floor(tile / world.nav.width)];
const order = (world, kind, extra = {}) => world.enqueue({ player: 0, kind, ids: [], x: 0, y: 0, ...extra });
function report(finding, observed, evidence) {
  const result = { finding, status: observed ? 'observed' : 'not-observed', evidence };
  results.push(result);
  console.log(JSON.stringify(result, null, 2));
}
function emptyWorld() {
  const width = 128, height = 128, size = width * height;
  const map = { width, height, seed: 1, tiles: new Uint8Array(size), variants: new Uint8Array(size), props: new Uint8Array(size) };
  const world = new World(rules(), map, 1);
  world.addPlayer('allies', 0);
  world.fogEnabled = false;
  return world;
}

// 1. A capture/harvest order should replace the earlier movement destination.
{
  const cases = [];
  for (const type of ['allied_engineer', 'allied_truck']) {
    const world = emptyWorld();
    const unit = world.spawnUnit(type, 0, world.nav.index(20, 20));
    const engineer = type === 'allied_engineer';
    const target = world.spawnBuilding(engineer ? 'oil_derrick' : 'supply_dump', -1, world.nav.index(10, 20));
    order(world, 'move', { ids: [unit.id], x: 110, y: 20 });
    run(world, 40);
    const oldGoal = unit.goal;
    const before = { tick: world.tick, tile: xy(world, unit.tile), goal: xy(world, unit.goal) };
    order(world, engineer ? 'capture' : 'harvest', { ids: [unit.id], x: 10, y: 20, target: target.id });
    run(world, 400);
    cases.push({ type, oldGoalRetained: unit.goal === oldGoal, before,
      after: { tick: world.tick, tile: xy(world, unit.tile), goal: xy(world, unit.goal),
        task: unit.task, status: unit.status, targetOwner: target.owner, targetStock: target.stock } });
  }
  report('Economy orders retain an earlier move destination', cases.every(c => c.oldGoalRetained), cases);
}

// 2. This mirrors the reviewed main.ts input gate, then calls the actual simulation.
// It is not a browser-input test: recheck that gate before using this probe on later revisions.
{
  const world = new World(rules(), lowlands(), 1);
  world.addPlayer('allies', 0); world.fogEnabled = false;
  const river = world.rules.terrain.terrain.findIndex(t => t.id === 'river');
  let water = -1;
  for (let x = 0; x < world.nav.width; x++) {
    const tile = world.nav.index(x, 70);
    if (world.map.tiles[tile] === river) { water = tile; break; }
  }
  assert.ok(water >= 0, 'Fixture requires a river tile on row 70');
  const fighter = world.spawnUnit('allied_fighter', 0, water);
  const target = world.nav.nearestInComponent(world.nav.index(90, 70), world.mainComponent());
  assert.ok(target >= 0, 'Fixture requires a reachable ground destination');
  const component = world.nav.componentOf(fighter.next >= 0 ? fighter.next : fighter.tile);
  const resolved = component >= 0 ? world.nav.nearestInComponent(target, component) : -1;
  order(world, 'move', { ids: [fighter.id], x: target % world.nav.width, y: Math.floor(target / world.nav.width) });
  world.step();
  report('Reviewed input gate rejects aircraft over water', resolved < 0 && fighter.goal === target,
    { mode: 'Mirrored UI predicate plus actual simulation command', spawn: xy(world, water),
      movement: world.rules.units.get(fighter.type).movement, component, uiWouldEnqueue: resolved >= 0,
      target: xy(world, target), simulationAccepts: fighter.goal === target });
}

// 3. Only player 0 issues commands, but placement moves player 1's stationary truck.
{
  const world = scenarioWorld('m3-outpost');
  world.addPlayer('axis', 5000);
  const mcv = world.entities.find(e => e.type === 'allied_mcv');
  assert.ok(mcv, 'Fixture requires an Allied MCV');
  order(world, 'deploy', { ids: [mcv.id] }); world.step();
  order(world, 'build', { type: 'allied_power' }); run(world, 301);
  const def = world.rules.buildings.get('allied_power');
  let site = -1;
  for (let tile = 0; tile < world.nav.size; tile++) {
    if (constructionProblem(world, 0, def, tile) === '') { site = tile; break; }
  }
  assert.ok(site >= 0, 'Fixture requires a legal generator site');
  const enemy = world.spawnUnit('axis_truck', 1, site);
  const initial = { id: enemy.id, owner: enemy.owner, tile: enemy.tile, goal: enemy.goal, orderId: enemy.orderId };
  order(world, 'place', { x: site % world.nav.width, y: Math.floor(site / world.nav.width), type: 'allied_power' });
  world.step();
  const afterPlace = { tile: enemy.tile, goal: enemy.goal, orderId: enemy.orderId };
  run(world, 120);
  report('Building placement orders hostile units to move', afterPlace.orderId > initial.orderId && enemy.tile !== initial.tile,
    { player1CommandsIssued: 0, initial, afterPlace, final: { tile: enemy.tile, goal: enemy.goal,
      orderId: enemy.orderId, building: world.entities.find(e => e.type === 'allied_power')?.tile } });
}

// 4. Attack-move locks onto a truck inside minimum range; idle fire is the control.
{
  const cases = [];
  for (const command of ['idle', 'attack', 'amove']) {
    const world = new World(rules(), lowlands(), 11);
    world.addPlayer('allies', 0); world.addPlayer('axis', 0); world.fogEnabled = false;
    const gun = world.spawnUnit('allied_artillery', 0, world.nav.index(30, 60));
    const near = world.spawnUnit('axis_truck', 1, world.nav.index(32, 60));
    const far = world.spawnUnit('axis_medium_tank', 1, world.nav.index(42, 60));
    far.cooldowns = [1e9, 1e9]; // Keep the target from killing the gun during the probe.
    const initialFarHP = far.hp;
    if (command !== 'idle') order(world, command, { ids: [gun.id], target: near.id, x: 46, y: 60 });
    let shots = 0;
    for (let i = 0; i < 1600; i++) { world.step(); shots += world.events.filter(e => e.kind === 'fire' && e.id === gun.id).length; }
    cases.push({ command, shots, nearHP: near.hp, farHP: far.hp, initialFarHP,
      distanceToNear: Math.hypot(gun.x - near.x, gun.y - near.y) / world.subTile,
      position: [gun.x / world.subTile, gun.y / world.subTile], attack: gun.attack, amove: gun.amove });
  }
  const idle = cases.find(c => c.command === 'idle'), advancing = cases.find(c => c.command === 'amove');
  report('Artillery attack-move stalls on a target inside minimum range',
    idle.shots > 0 && advancing.shots === 0 && advancing.farHP === advancing.initialFarHP && advancing.amove >= 0, cases);
}

// 5. Compare the default start with one known-valid alternate anchor, without searching.
{
  const cases = [];
  for (const anchor of [null, { x: 96, y: 64 }]) {
    const r = rules(), base = r.scenarios.get('m5-skirmish');
    const world = new World(r, lowlands(), 7);
    world.loadScenario({ ...base, players: base.players.map((p, i) => i === 1 && anchor ? { ...p, anchor } : p) });
    run(world, 20000);
    const player = world.players[1], hq = world.entities.find(e => e.type === 'axis_hq');
    cases.push({ anchor: anchor ?? base.players[1].anchor, start: player.start, hq: hq?.tile,
      startComponent: world.nav.componentOf(player.start), oil: player.ledger.oil, delivered: player.ledger.delivered,
      engineers: world.entities.filter(e => e.owner === 1 && e.type === 'axis_engineer').length,
      derrickOwners: world.entities.filter(e => e.type === 'oil_derrick').map(e => e.owner) });
  }
  report('AI oil expansion fails when its start anchor remains walkable',
    cases[0].startComponent < 0 && cases[0].oil > 0 && cases[1].startComponent >= 0 && cases[1].oil === 0, cases);
}

// 6. Record actual footprint fill calls, without a DOM or rendering a browser canvas.
{
  const world = new World(rules(), lowlands(), 11);
  world.addPlayer('allies', 5000); world.addPlayer('axis', 5000);
  world.placeBuildingNear(world.rules.buildings.get('allied_hq'), 0, 25, 60);
  const enemy = world.placeBuildingNear(world.rules.buildings.get('axis_power'), 1, 95, 60);
  updateFog(world, true);
  const placement = new Placement(); placement.start('place', 'allied_power');
  const pointer = [enemy.tile % world.nav.width + 1, Math.floor(enemy.tile / world.nav.width) + 1];
  const fills = [];
  const context = { beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    fill() { fills.push(this.fillStyle); }, fillStyle: '', strokeStyle: '', lineWidth: 1 };
  const sample = () => {
    placement.update(world, 0, ...pointer); fills.length = 0;
    drawFootprint(context, world, world.rules.buildings.get('allied_power'), placement.origin, 'bad');
    return { visible: canSee(world, 0, enemy), explored: world.players[0].fog.explored[enemy.tile],
      problem: placement.problem, fills: [...fills], passable: world.nav.passable(enemy.tile) };
  };
  const before = sample();
  world.remove(enemy.id); world.step();
  const after = sample();
  report('Placement ghost reveals structures in unexplored terrain',
    !before.visible && before.explored === 0 && after.explored === 0 && JSON.stringify(before.fills) !== JSON.stringify(after.fills),
    { before, after });
}
console.log(JSON.stringify({ snapshot: root, observed: results.filter(r => r.status === 'observed').length,
  total: results.length, note: 'Review diagnostics only; observed defects are not test-process failures.' }, null, 2));
