import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entity } from '../src/sim/entities.ts';
import type { World } from '../src/sim/world.ts';
import { scenarioWorld, snapshot } from './helpers.ts';

const trucks = (world: World): Entity[] => world.entities.filter(e => e.type === 'allied_truck');
const dumps = (world: World): Entity[] => world.entities.filter(e => e.type === 'supply_dump');
const hq = (world: World): Entity => world.entities.find(e => e.type === 'allied_hq')!;
const totalStock = (world: World): number => world.entities.reduce((sum, e) => sum + e.stock, 0);
const totalCargo = (world: World): number => world.entities.reduce((sum, e) => sum + e.cargo, 0);

function run(world: World, ticks: number, each?: (world: World) => void): void {
  for (let i = 0; i < ticks; i++) { world.step(); each?.(world); }
}

test('five unattended minutes: repeated deliveries and an exact credit ledger', () => {
  const world = scenarioWorld('m2-logistics');
  const initial = totalStock(world);
  let deliveries = 0;
  let previous = 0;
  run(world, 6000, w => {
    if (w.players[0].ledger.delivered > previous && w.players[0].ledger.delivered % 200 === 0) deliveries++;
    previous = w.players[0].ledger.delivered;
    // Value is never created or destroyed: stock + cargo + delivered is constant.
    assert.equal(totalStock(w) + totalCargo(w) + w.players[0].ledger.delivered, initial);
  });
  const player = world.players[0];
  assert.ok(deliveries >= 20, `expected sustained deliveries, got ${deliveries}`);
  assert.equal(player.credits, player.ledger.delivered + player.ledger.oil);
});

test('several trucks share one depot through bounded dock slots', () => {
  const world = scenarioWorld('m2-logistics');
  const depot = hq(world);
  const slots = world.rules.buildings.get(depot.type)!.dockSlots;
  let maxConcurrent = 0;
  run(world, 3000, w => {
    const unloading = trucks(w).filter(t => t.task === 'unload').length;
    maxConcurrent = Math.max(maxConcurrent, unloading);
    assert.ok((depot.docks?.length ?? 0) <= slots);
    const tiles = new Set(depot.docks!.map(lease => lease.tile));
    assert.equal(tiles.size, depot.docks!.length, 'two leases on one approach tile');
  });
  assert.ok(maxConcurrent >= 1);
  assert.ok(world.players[0].ledger.delivered >= 2000);
});

test('an exhausted dump triggers reassignment; with nothing left trucks idle with a stable reason', () => {
  const world = scenarioWorld('m2-logistics');
  for (const dump of dumps(world)) dump.stock = 30;
  // Ten small dumps across both banks: trucks must keep reassigning to farther ones.
  run(world, 12000);
  assert.equal(dumps(world).length, 0, 'all small dumps were emptied and cleared');
  const before = world.players[0].ledger.delivered;
  assert.equal(before + totalCargo(world), 30 * 10);
  run(world, 600);
  for (const truck of trucks(world)) {
    assert.equal(truck.cargo, 0);
    assert.equal(truck.status, 'no-resource');
    assert.ok(truck.timer > 0, 'searches are rate-limited');
  }
});

test('a missing depot preserves cargo; a new depot resumes deliveries', () => {
  const world = scenarioWorld('m2-logistics');
  run(world, 900);
  world.remove(hq(world).id);
  run(world, 1200);
  const loaded = trucks(world).filter(t => t.cargo > 0);
  assert.ok(loaded.length > 0);
  for (const truck of loaded) assert.equal(truck.status, 'no-depot');
  const delivered = world.players[0].ledger.delivered;
  const cargo = totalCargo(world);
  world.placeBuildingNear(world.rules.buildings.get('allied_hq')!, 0, 30, 60);
  run(world, 1500);
  assert.ok(world.players[0].ledger.delivered >= delivered + cargo, 'held cargo was delivered to the new depot');
});

test('trucks recover from a unit parked on the docking approach', () => {
  const world = scenarioWorld('m2-logistics');
  const depot = hq(world);
  const rifles = world.entities.filter(e => e.type === 'allied_rifle');
  // Park infantry on approach tiles; idle units get shoved aside by trucks.
  const def = world.rules.buildings.get(depot.type)!;
  const ox = depot.tile % 128;
  const oy = (depot.tile / 128) | 0;
  world.enqueue({ player: 0, kind: 'move', ids: [rifles[0].id], x: ox + def.footprint.w, y: oy + 1 });
  world.enqueue({ player: 0, kind: 'move', ids: [rifles[1].id], x: ox - 1, y: oy + 1 });
  run(world, 4000);
  assert.ok(world.players[0].ledger.delivered >= 3000, `delivered ${world.players[0].ledger.delivered}`);
});

test('a manual move suspends hauling; an explicit collect order resumes it', () => {
  const world = scenarioWorld('m2-logistics');
  const truck = trucks(world)[0];
  run(world, 50);
  world.enqueue({ player: 0, kind: 'move', ids: [truck.id], x: 30, y: 60 });
  run(world, 600);
  assert.equal(truck.auto, false);
  assert.equal(truck.task, '');
  const dump = dumps(world)[1];
  world.enqueue({ player: 0, kind: 'harvest', ids: [truck.id], x: 0, y: 0, target: dump.id });
  run(world, 1200);
  assert.ok(dump.stock < 3000, 'truck loaded from the ordered dump');
});

test('engineer capture: interruption resets, ownership and consumption happen once, payment follows owner', () => {
  const world = scenarioWorld('m2-logistics');
  const derrick = world.entities.filter(e => e.type === 'oil_derrick').sort((a, b) => Math.abs(a.tile % 128 - 20) - Math.abs(b.tile % 128 - 20))[0];
  const engineer = world.entities.find(e => e.type === 'allied_engineer')!;
  world.enqueue({ player: 0, kind: 'capture', ids: [engineer.id], x: 0, y: 0, target: derrick.id });
  let progressed = false;
  for (let i = 0; i < 2000 && engineer.timer < 20; i++) { world.step(); progressed ||= engineer.timer > 0; }
  assert.ok(progressed && engineer.timer >= 20, 'capture started');
  // Interrupt by moving away: progress resets.
  world.enqueue({ player: 0, kind: 'move', ids: [engineer.id], x: 25, y: 50 });
  run(world, 5);
  assert.equal(engineer.task, '');
  assert.equal(engineer.timer, 0);
  assert.equal(derrick.owner, -1);
  world.enqueue({ player: 0, kind: 'capture', ids: [engineer.id], x: 0, y: 0, target: derrick.id });
  let capturedAt = -1;
  for (let i = 0; i < 3000 && capturedAt < 0; i++) { world.step(); if (derrick.owner === 0) capturedAt = world.tick; }
  assert.ok(capturedAt > 0);
  assert.equal(world.get(engineer.id), undefined, 'engineer consumed');
  const engineers = world.entities.filter(e => e.type === 'allied_engineer').length;
  assert.equal(engineers, 0);
  const oilBefore = world.players[0].ledger.oil;
  run(world, world.rules.economy.oilIntervalTicks * 3);
  assert.equal(world.players[0].ledger.oil - oilBefore, world.rules.economy.oilPayout * 3);
});

test('two engineers racing for one derrick: it changes hands once and one engineer survives', () => {
  const world = scenarioWorld('m2-logistics');
  const derrick = world.entities.find(e => e.type === 'oil_derrick')!;
  const first = world.entities.find(e => e.type === 'allied_engineer')!;
  const spare = world.search.nearestFree(world, first.tile, first.tile, 50);
  const second = world.spawnUnit('allied_engineer', 0, spare);
  world.enqueue({ player: 0, kind: 'capture', ids: [first.id, second.id], x: 0, y: 0, target: derrick.id });
  let changes = 0;
  let owner = derrick.owner;
  run(world, 3000, () => { if (derrick.owner !== owner) { changes++; owner = derrick.owner; } });
  assert.equal(changes, 1);
  const alive = [first, second].filter(e => world.get(e.id));
  assert.equal(alive.length, 1, 'exactly one engineer consumed');
  assert.equal(alive[0].status, 'already captured');
});

test('identical runs give identical economy state', () => {
  const a = scenarioWorld('m2-logistics');
  const b = scenarioWorld('m2-logistics');
  run(a, 2500);
  run(b, 2500);
  assert.equal(snapshot(a), snapshot(b));
  assert.equal(JSON.stringify(a.players), JSON.stringify(b.players));
});

test('hauling keeps going with newly placed buildings crowding the depot', () => {
  const world = scenarioWorld('m2-logistics');
  const depot = hq(world);
  const w = world.nav.width;
  for (const type of ['allied_power', 'allied_barracks', 'allied_factory']) {
    world.placeBuildingNear(world.rules.buildings.get(type)!, 0, (depot.tile % w) + 4, ((depot.tile / w) | 0) + 1);
  }
  run(world, 3000, x => assert.equal(x.players[0].credits, x.players[0].ledger.initial + x.players[0].ledger.delivered + x.players[0].ledger.oil));
  assert.ok(world.players[0].ledger.delivered >= 2000, `delivered ${world.players[0].ledger.delivered}`);
});
