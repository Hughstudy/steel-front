import assert from 'node:assert/strict';
import test from 'node:test';
import { MoveState } from '../src/sim/entities.ts';
import type { World } from '../src/sim/world.ts';
import { ids, scenarioWorld } from './helpers.ts';

function assertOccupancy(world: World): void {
  const seen = new Set<number>();
  for (const unit of world.entities) {
    if (unit.kind !== 'unit') continue;
    assert.equal(world.nav.occupancy[unit.tile], unit.id, `unit ${unit.id} does not hold its tile`);
    assert.ok(world.nav.passable(unit.tile), 'unit on blocked tile');
    assert.ok(!seen.has(unit.tile), 'two units share a tile');
    seen.add(unit.tile);
    if (unit.next >= 0) {
      assert.equal(world.nav.occupancy[unit.next], unit.id);
      assert.ok(!seen.has(unit.next));
      seen.add(unit.next);
    }
  }
}

/** Run until every unit settles; checks invariants every tick. Returns ticks used. */
function settle(world: World, bound: number): number {
  for (let t = 1; t <= bound; t++) {
    world.step();
    if (t % 10 === 0) assertOccupancy(world);
    if (world.entities.every(e => e.kind !== 'unit' || e.moveState === MoveState.Arrived || e.moveState === MoveState.Idle || e.moveState === MoveState.Unreachable)) return t;
  }
  const stuck = world.entities.filter(e => e.moveState !== MoveState.Arrived).map(e => `${e.id}:${e.moveState}:${e.reason}`);
  assert.fail(`not settled within ${bound} ticks: ${stuck.join(' ')}`);
}

/**
 * Generous bound: straight-line route length × 1.6 detour factor at the slowest
 * speed (1.15 tiles/s), doubled for congestion, plus 30 s for queuing at a bridge.
 */
function bound(tiles: number): number { return Math.ceil(tiles * 1.6 / 1.15 * 20 * 2 + 600); }

test('20 mixed units cross the river and return through both bridges', () => {
  const world = scenarioWorld('m1-maneuvers');
  const all = ids(world);
  assert.equal(all.length, 20);
  for (const [x, y] of [[95, 60], [38, 60], [95, 92], [38, 92]]) {
    world.enqueue({ player: 0, kind: 'move', ids: all, x, y });
    const ticks = settle(world, bound(60));
    for (const unit of world.entities) assert.equal(unit.moveState, MoveState.Arrived, `unit ${unit.id} ${unit.reason}`);
    const side = x > 64 ? 1 : -1;
    for (const unit of world.entities) assert.ok(((unit.tile % 128) - 64) * side > 0, 'unit on wrong bank');
    assert.ok(ticks > 0);
  }
});

test('opposing groups on the same one-tile bridge both get through', () => {
  const world = scenarioWorld('m1-maneuvers');
  const all = ids(world);
  const east = all.filter((_, i) => i % 2 === 0);
  const west = all.filter((_, i) => i % 2 === 1);
  world.enqueue({ player: 0, kind: 'move', ids: east, x: 80, y: 60 });
  settle(world, bound(45));
  world.enqueue({ player: 0, kind: 'move', ids: east, x: 40, y: 60 });
  world.enqueue({ player: 0, kind: 'move', ids: west, x: 80, y: 60 });
  settle(world, bound(45) * 2);
  for (const id of east) assert.ok((world.get(id)!.tile % 128) < 57);
  for (const id of west) assert.ok((world.get(id)!.tile % 128) > 64);
});

test('rapid replacement orders, a crowded map-edge target and a water click all settle', () => {
  const world = scenarioWorld('m1-maneuvers');
  const all = ids(world);
  for (let k = 0; k < 10; k++) {
    world.enqueue({ player: 0, kind: 'move', ids: all, x: 40 + k * 5, y: 92 - k });
    for (let j = 0; j < 7; j++) world.step();
  }
  settle(world, bound(70));
  world.enqueue({ player: 0, kind: 'move', ids: all, x: 127, y: 0 });
  settle(world, bound(140));
  for (const unit of world.entities) assert.equal(unit.moveState, MoveState.Arrived);
  let riverX = 0;
  while (world.map.tiles[70 * 128 + riverX] !== 2) riverX++;
  world.enqueue({ player: 0, kind: 'move', ids: all, x: riverX + 1, y: 70 });
  settle(world, bound(90));
  for (const unit of world.entities) {
    assert.ok(world.nav.passable(unit.tile));
    assert.equal(unit.moveState, MoveState.Arrived, 'water click resolves to the nearest valid bank');
  }
});

test('a unit ordered onto an occupied slot shoves the idle occupant aside', () => {
  const world = scenarioWorld('m1-maneuvers');
  const [first, second] = ids(world);
  const a = world.get(first)!;
  const b = world.get(second)!;
  world.enqueue({ player: 0, kind: 'move', ids: [first], x: b.tile % 128, y: (b.tile / 128) | 0 });
  settle(world, 400);
  assert.equal(a.moveState, MoveState.Arrived);
  assert.notEqual(a.tile, b.tile);
});

test('a new order cancels stale route jobs and releases old reservations', () => {
  const world = scenarioWorld('m1-maneuvers');
  const all = ids(world);
  world.enqueue({ player: 0, kind: 'move', ids: all, x: 95, y: 60 });
  world.step();
  world.enqueue({ player: 0, kind: 'move', ids: all, x: 30, y: 70 });
  world.step();
  world.step();
  settle(world, bound(30));
  for (const unit of world.entities) {
    assert.ok((unit.tile % 128) < 45, 'stale eastward route used');
    assert.equal(unit.next, -1);
  }
  let held = 0;
  for (let i = 0; i < world.nav.size; i++) if (world.nav.occupancy[i]) held++;
  assert.equal(held, 20, 'only current tiles are held after settling');
});

test('commands for other players or unknown entities are ignored', () => {
  const world = scenarioWorld('m1-maneuvers');
  const before = world.entities.map(e => e.tile);
  world.enqueue({ player: 1, kind: 'move', ids: ids(world), x: 95, y: 60 });
  world.enqueue({ player: 0, kind: 'move', ids: [9999], x: 95, y: 60 });
  for (let i = 0; i < 40; i++) world.step();
  assert.deepEqual(world.entities.map(e => e.tile), before);
});

test('the 20-unit crossing still settles with player buildings placed near the route', () => {
  const world = scenarioWorld('m1-maneuvers');
  // A small base on the west bank between the units and the bridges.
  for (const [type, x, y] of [['allied_hq', 44, 54], ['allied_power', 46, 64], ['allied_barracks', 50, 58], ['allied_factory', 42, 68]] as Array<[string, number, number]>) {
    world.placeBuildingNear(world.rules.buildings.get(type)!, 0, x, y);
  }
  const all = ids(world);
  for (const [x, y] of [[95, 60], [38, 60]]) {
    world.enqueue({ player: 0, kind: 'move', ids: all, x, y });
    settle(world, bound(60));
    for (const unit of world.entities) if (unit.kind === 'unit') assert.equal(unit.moveState, MoveState.Arrived, `unit ${unit.id} ${unit.reason}`);
  }
});
