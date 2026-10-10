import assert from 'node:assert/strict';
import test from 'node:test';
import { captureWorld, loadMatch, serializeMatch } from '../src/sim/save.ts';
import { World } from '../src/sim/world.ts';
import { lowlands, rules } from './helpers.ts';

function arena(): World {
  const world = new World(rules(), lowlands(), 11);
  world.addPlayer('allies', 0);
  world.addPlayer('axis', 0);
  world.fogEnabled = false;
  return world;
}

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) world.step();
}

test('a fighter obeys a manual retreat despite nearby automatically acquired enemies', () => {
  for (const owner of [0, 1]) {
    const world = arena();
    const faction = owner === 0 ? 'allied' : 'axis';
    const enemy = owner === 0 ? 'axis' : 'allied';
    const fighter = world.spawnUnit(`${faction}_fighter`, owner, world.nav.index(35, 60));
    world.spawnUnit(`${enemy}_mcv`, 1 - owner, world.nav.index(38, 60));
    world.enqueue({ player: owner, kind: 'move', ids: [fighter.id], x: 10, y: 60 });
    run(world, 400);
    const distance = Math.hypot(fighter.x / world.subTile - 10.5, fighter.y / world.subTile - 60.5);
    assert.ok(distance < 6, `${faction} fighter must arrive near retreat destination, is ${distance.toFixed(2)} tiles away`);
  }
});

test('a fighter ordered to attack a nearby stationary squad makes a firing pass', () => {
  const world = arena();
  const fighter = world.spawnUnit('allied_fighter', 0, world.nav.index(30, 60));
  const target = world.spawnUnit('axis_rifle', 1, world.nav.index(33, 60));
  const hp = target.hp;
  world.enqueue({ player: 0, kind: 'attack', ids: [fighter.id], x: 33, y: 60, target: target.id });
  let shots = 0;
  for (let i = 0; i < 2400; i++) {
    world.step();
    shots += world.events.filter(event => event.kind === 'fire' && event.id === fighter.id).length;
  }
  assert.ok(shots > 0, 'fighter fires instead of circling indefinitely');
  assert.ok(target.hp < hp, 'the firing pass damages its target');
});

test('both factions can strafe close targets automatically or by order, including map corners', () => {
  const approaches = [
    [30, 60, 33, 60, 32], [30, 60, 30, 57, 128],
    [30, 60, 27, 60, 0], [30, 60, 30, 63, 192],
    [3, 3, 0, 0, 32], [124, 124, 127, 127, 160],
  ];
  for (const command of ['idle', 'attack']) for (const owner of [0, 1]) for (const [x, y, tx, ty, heading] of approaches) {
    const world = arena();
    const faction = owner === 0 ? 'allied' : 'axis';
    const enemy = owner === 0 ? 'axis' : 'allied';
    const fighter = world.spawnUnit(`${faction}_fighter`, owner, world.nav.index(x, y));
    const target = world.spawnUnit(`${enemy}_rifle`, 1 - owner, world.nav.index(tx, ty));
    fighter.facing = fighter.prevFacing = heading;
    if (command === 'attack') world.enqueue({ player: owner, kind: 'attack', ids: [fighter.id], x: tx, y: ty, target: target.id });
    run(world, 2400);
    assert.ok(!world.get(target.id), `${command}: ${faction} fighter from ${x},${y} at heading ${heading} destroys target ${tx},${ty}`);
    assert.ok(fighter.x >= 0 && fighter.y >= 0 && fighter.x < 128 * world.subTile && fighter.y < 128 * world.subTile, 'aircraft remain inside the map');
    assert.ok(!world.nav.occupancy.includes(fighter.id), 'aircraft never reserve ground tiles');
  }
});

test('stop cancels aircraft transit and holds near the stop location', () => {
  const world = arena();
  const fighter = world.spawnUnit('allied_fighter', 0, world.nav.index(35, 60));
  world.enqueue({ player: 0, kind: 'move', ids: [fighter.id], x: 100, y: 60 });
  run(world, 40);
  const x = fighter.x;
  const y = fighter.y;
  world.enqueue({ player: 0, kind: 'stop', ids: [fighter.id], x: 0, y: 0 });
  run(world, 400);
  const distance = Math.hypot(fighter.x - x, fighter.y - y) / world.subTile;
  assert.ok(distance < 6, `stopped aircraft holds near its position, ${distance.toFixed(2)} tiles away`);
});

test('explicit attack and attack-move supersede an aircraft manual move', () => {
  for (const command of ['attack', 'amove'] as const) {
    const world = arena();
    const fighter = world.spawnUnit('allied_fighter', 0, world.nav.index(30, 60));
    const target = world.spawnUnit('axis_rifle', 1, world.nav.index(33, 60));
    world.enqueue({ player: 0, kind: 'move', ids: [fighter.id], x: 10, y: 60 });
    run(world, 3);
    world.enqueue({ player: 0, kind: command, ids: [fighter.id], x: 46, y: 60, target: target.id });
    run(world, 2400);
    assert.ok(!world.get(target.id), `${command} interrupts the move and destroys the squad`);
    if (command === 'amove') {
      const distance = Math.hypot(fighter.x / world.subTile - 46.5, fighter.y / world.subTile - 60.5);
      assert.ok(distance < 6, `attack-move resumes after combat, ${distance.toFixed(2)} tiles from goal`);
    }
  }
});

test('a new manual move interrupts an aircraft attack or attack-move engagement', () => {
  for (const command of ['attack', 'amove'] as const) {
    const world = arena();
    const fighter = world.spawnUnit('allied_fighter', 0, world.nav.index(35, 60));
    const target = world.spawnUnit('axis_mcv', 1, world.nav.index(38, 60));
    world.enqueue({ player: 0, kind: command, ids: [fighter.id], x: 46, y: 60, target: target.id });
    run(world, 30);
    assert.equal(fighter.attack, target.id, `${command} has engaged the target`);
    world.enqueue({ player: 0, kind: 'move', ids: [fighter.id], x: 10, y: 60 });
    run(world, 400);
    const distance = Math.hypot(fighter.x / world.subTile - 10.5, fighter.y / world.subTile - 60.5);
    assert.ok(distance < 6, `${command} is cancelled and retreat completes`);
  }
});

test('a fighter automatically engages nearby enemies again after reaching its manual destination', () => {
  const world = arena();
  const fighter = world.spawnUnit('allied_fighter', 0, world.nav.index(30, 60));
  const target = world.spawnUnit('axis_rifle', 1, world.nav.index(43, 60));
  world.enqueue({ player: 0, kind: 'move', ids: [fighter.id], x: 40, y: 60 });
  let arrived = false;
  for (let i = 0; i < 2400 && world.get(target.id); i++) {
    world.step();
    const distance = Math.hypot(fighter.x / world.subTile - 40.5, fighter.y / world.subTile - 60.5);
    arrived ||= distance < world.rules.combat.air.holdRadius + 0.5;
    if (world.events.some(event => event.kind === 'fire' && event.id === fighter.id)) assert.ok(arrived, 'manual movement completes before firing');
  }
  assert.ok(arrived, 'fighter reached its manual destination');
  assert.ok(!world.get(target.id), 'auto-acquisition resumes and destroys the nearby squad');
});

test('aircraft movement and attack passes continue deterministically after saving and loading', () => {
  for (const command of ['move', 'attack', 'amove'] as const) {
    const original = arena();
    const fighter = original.spawnUnit('allied_fighter', 0, original.nav.index(30, 60));
    const target = original.spawnUnit('axis_mcv', 1, original.nav.index(33, 60));
    original.enqueue({ player: 0, kind: command, ids: [fighter.id], x: 10, y: 60, target: target.id });
    run(original, 6);
    if (command === 'move') assert.ok(fighter.airMove, 'save during an unfinished manual move');
    else assert.ok(fighter.airPass >= 0, 'save during the egress leg of an attack pass');
    const setup = { kind: 'scenario', id: 'm4-combat', difficulty: 'normal' } as const;
    const text = serializeMatch(original, setup, 'aircraft regression', 'fixed');
    const { world: copy } = loadMatch(text, original.rules, () => lowlands());
    assert.equal(serializeMatch(copy, setup, 'aircraft regression', 'fixed'), text, `${command} exact save round trip`);
    run(original, 900);
    run(copy, 900);
    assert.deepEqual(captureWorld(copy), captureWorld(original), `${command} deterministic continuation`);
  }
});

test('version 1 saves without aircraft flight fields retain unfinished moves and remain playable', () => {
  for (const command of ['move', 'attack'] as const) {
    const original = arena();
    const fighter = original.spawnUnit('allied_fighter', 0, original.nav.index(30, 60));
    const target = original.spawnUnit('axis_rifle', 1, original.nav.index(33, 60));
    original.enqueue({ player: 0, kind: command, ids: [fighter.id], x: 10, y: 60, target: target.id });
    run(original, 6);
    const setup = { kind: 'scenario', id: 'm4-combat', difficulty: 'normal' } as const;
    const legacy = JSON.parse(serializeMatch(original, setup, 'legacy aircraft', 'fixed'));
    for (const entity of legacy.world.entities) { delete entity.airMove; delete entity.airPass; }
    const { world: restored } = loadMatch(JSON.stringify(legacy), original.rules, () => lowlands());
    const restoredFighter = restored.get(fighter.id)!;
    assert.equal(restoredFighter.airMove, command === 'move', 'only an unfinished manual move is restored as a move');
    assert.equal(restoredFighter.airPass, -1, 'legacy attacks begin a fresh pass');
    run(restored, 2400);
    if (command === 'move') {
      const distance = Math.hypot(restoredFighter.x / restored.subTile - 10.5, restoredFighter.y / restored.subTile - 60.5);
      assert.ok(distance < 6, 'the restored move reaches its destination');
    } else assert.ok(!restored.get(target.id), 'the restored attack destroys its target');
    // A migrated save can be saved and loaded again without changing its state.
    const migrated = serializeMatch(restored, setup, 'legacy aircraft', 'fixed');
    const { world: again } = loadMatch(migrated, original.rules, () => lowlands());
    assert.equal(serializeMatch(again, setup, 'legacy aircraft', 'fixed'), migrated);
  }
});
