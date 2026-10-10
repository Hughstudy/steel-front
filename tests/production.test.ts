import assert from 'node:assert/strict';
import test from 'node:test';
import { MoveState } from '../src/sim/entities.ts';
import type { Entity } from '../src/sim/entities.ts';
import { constructionProblem, definitionOf } from '../src/sim/production.ts';
import { footprintTiles } from '../src/sim/structures.ts';
import type { World } from '../src/sim/world.ts';
import { rules, scenarioWorld, snapshot } from './helpers.ts';

function run(world: World, ticks: number, each?: (world: World) => void): void {
  for (let i = 0; i < ticks; i++) { world.step(); each?.(world); }
}

function runUntil(world: World, limit: number, done: (world: World) => boolean): number {
  for (let i = 0; i < limit; i++) { if (done(world)) return i; world.step(); }
  assert.fail('condition not reached');
}

const first = (world: World, type: string): Entity | undefined => world.entities.find(e => e.type === type);
const balance = (world: World, player = 0): number => {
  const l = world.players[player].ledger;
  return l.initial + l.delivered + l.oil + l.refunded + l.sold - l.spent;
};

function cmd(world: World, kind: 'build' | 'cancel' | 'place' | 'deploy' | 'sell' | 'repair' | 'rally', extra: { ids?: number[]; x?: number; y?: number; target?: number; type?: string } = {}): void {
  world.enqueue({ player: 0, kind, ids: extra.ids ?? [], x: extra.x ?? 0, y: extra.y ?? 0, target: extra.target, type: extra.type });
}

/** Deterministic valid origin near the HQ for a structure (what a player would click). */
function siteFor(world: World, type: string, avoid: Set<number> = new Set()): { x: number; y: number } {
  const def = world.rules.buildings.get(type)!;
  const hq = first(world, 'allied_hq')!;
  const w = world.nav.width;
  const hx = hq.tile % w;
  const hy = (hq.tile / w) | 0;
  for (let radius = 4; radius < 12; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const origin = (hy + dy) * w + hx + dx;
        if (!world.nav.inBounds(hx + dx, hy + dy) || avoid.has(origin)) continue;
        if (constructionProblem(world, 0, def, origin) === '') return { x: hx + dx, y: hy + dy };
      }
    }
  }
  assert.fail(`no site for ${type}`);
}

/** Test-only funding, recorded in the ledger so conservation checks still hold. */
function grant(world: World, credits: number): void {
  world.players[0].ledger.initial += credits - world.players[0].credits;
  world.players[0].credits = credits;
}

function deploy(world: World): void {
  const mcv = first(world, 'allied_mcv')!;
  cmd(world, 'deploy', { ids: [mcv.id] });
  runUntil(world, 50, w => first(w, 'allied_hq') !== undefined);
}

function buildAndPlace(world: World, type: string): Entity {
  cmd(world, 'build', { type });
  const def = world.rules.buildings.get(type)!;
  runUntil(world, def.buildTicks * 4 + 20, w => w.players[0].queues.structure?.[0]?.reason === 'ready');
  const site = siteFor(world, type);
  cmd(world, 'place', { type, ...site });
  runUntil(world, 40, w => first(w, type) !== undefined);
  return first(world, type)!;
}

test('starting credits cover the cheapest power → barracks → factory → truck path from data', () => {
  const r = rules();
  const scenario = r.scenarios.get('m3-outpost')!;
  const setup = scenario.players[0];
  const mcv = r.units.get(setup.units[0].type)!;
  const deployed = String(mcv.capabilities.deploy);
  const truck = [...r.units.values()].find(u => u.faction === setup.faction && typeof u.capabilities.cargo === 'number' && u.producer)!;
  // Sum the prerequisite closure of the truck, excluding what the MCV provides.
  const needed = new Set<string>();
  const visit = (id: string): void => {
    if (id === deployed || needed.has(id)) return;
    needed.add(id);
    for (const p of (r.units.get(id) ?? r.buildings.get(id))!.prerequisites) visit(p);
  };
  visit(truck.id);
  const total = [...needed].reduce((sum, id) => sum + (r.units.get(id) ?? r.buildings.get(id))!.cost, 0);
  assert.deepEqual([...needed].sort(), ['allied_barracks', 'allied_factory', 'allied_power', 'allied_truck']);
  assert.equal(setup.units.length, 1);
  assert.equal(setup.units[0].count, 1);
  assert.ok(setup.credits >= total * 1.15, `credits ${setup.credits} vs path ${total}`);
});

test('bootstrap from one MCV to sustained truck income with an exact ledger', () => {
  const world = scenarioWorld('m3-outpost');
  assert.equal(world.entities.filter(e => e.owner === 0).length, 1);
  deploy(world);
  assert.equal(first(world, 'allied_mcv'), undefined, 'MCV consumed exactly once');
  assert.equal(world.entities.filter(e => e.type === 'allied_hq').length, 1);
  buildAndPlace(world, 'allied_power');
  buildAndPlace(world, 'allied_barracks');
  const factory = buildAndPlace(world, 'allied_factory');
  cmd(world, 'build', { type: 'allied_truck' });
  runUntil(world, 2000, w => first(w, 'allied_truck') !== undefined);
  const truck = first(world, 'allied_truck')!;
  assert.ok(truck.auto, 'produced trucks start hauling');
  const w = world.nav.width;
  const fdef = world.rules.buildings.get('allied_factory')!;
  assert.ok(Math.abs((truck.tile % w) - (factory.tile % w)) <= fdef.footprint.w + 1, 'truck appears at the motor pool');
  const before = world.players[0].ledger.delivered;
  run(world, 3000, x => assert.equal(x.players[0].credits, balance(x)));
  assert.ok(world.players[0].ledger.delivered - before >= 400, 'sustained deliveries');
  cmd(world, 'build', { type: 'allied_rifle' });
  runUntil(world, 600, x => first(x, 'allied_rifle') !== undefined);
  const barracks = first(world, 'allied_barracks')!;
  const rifle = first(world, 'allied_rifle')!;
  const bdef = world.rules.buildings.get('allied_barracks')!;
  assert.ok(Math.abs((rifle.tile % w) - (barracks.tile % w)) <= bdef.footprint.w + 1, 'infantry appears at the barracks');
});

test('low power works at one quarter rate', () => {
  const timing = (low: boolean): number => {
    const world = scenarioWorld('m3-outpost');
    deploy(world);
    grant(world, 100000);
    buildAndPlace(world, 'allied_power');
    buildAndPlace(world, 'allied_barracks');
    // Removing the plant leaves the barracks (the rifle's only prerequisite) without power.
    if (low) world.remove(first(world, 'allied_power')!.id);
    world.step();
    const player = world.players[0];
    assert.equal(player.power.demand > player.power.supply, low);
    cmd(world, 'build', { type: 'allied_rifle' });
    world.step();
    return runUntil(world, 5000, w => first(w, 'allied_rifle') !== undefined);
  };
  const full = timing(false);
  const low = timing(true);
  const ratio = low / full;
  assert.ok(ratio > 3.8 && ratio < 4.2, `low ${low} vs full ${full}`);
});

test('production pauses without funds and resumes after deliveries; total charged equals cost', () => {
  const world = scenarioWorld('m3-outpost');
  deploy(world);
  world.players[0].ledger.initial -= world.players[0].credits - 1000;
  world.players[0].credits = 1000;
  cmd(world, 'build', { type: 'allied_power' });
  world.step();
  const cost = world.rules.buildings.get('allied_power')!.cost;
  run(world, 400);
  const item = world.players[0].queues.structure[0];
  assert.equal(item.reason, 'ready');
  assert.equal(item.paid, cost);
  assert.equal(world.players[0].credits, 200);
  cmd(world, 'place', { type: 'allied_power', ...siteFor(world, 'allied_power') });
  run(world, 5);
  cmd(world, 'build', { type: 'allied_barracks' });
  run(world, 200);
  const head = world.players[0].queues.structure[0];
  assert.equal(head.reason, 'funds');
  const stalled = head.work;
  run(world, 100);
  assert.equal(head.work, stalled, 'no free progress while unpaid');
  world.players[0].credits += 1000;
  world.players[0].ledger.delivered += 1000;
  runUntil(world, 400, w => w.players[0].queues.structure?.[0]?.reason === 'ready');
  assert.equal(world.players[0].queues.structure[0].paid, world.rules.buildings.get('allied_barracks')!.cost);
  assert.equal(world.players[0].credits, balance(world));
});

test('cancelling partial, queued and ready items refunds exactly what was paid, once', () => {
  const world = scenarioWorld('m3-outpost');
  deploy(world);
  const start = world.players[0].credits;
  cmd(world, 'build', { type: 'allied_power' });
  cmd(world, 'build', { type: 'allied_power' });
  run(world, 100);
  const [head, queued] = world.players[0].queues.structure;
  assert.ok(head.paid > 0 && head.paid < 800);
  assert.equal(queued.paid, 0);
  cmd(world, 'cancel', { type: 'allied_power' });
  run(world, 1);
  assert.equal(world.players[0].queues.structure.length, 1, 'the last-queued item is cancelled first');
  cmd(world, 'cancel', { type: 'allied_power' });
  cmd(world, 'cancel', { type: 'allied_power' });
  run(world, 1);
  assert.equal(world.players[0].queues.structure.length, 0);
  assert.equal(world.players[0].credits, start, 'every paid credit returned exactly once');
  cmd(world, 'build', { type: 'allied_power' });
  runUntil(world, 400, w => w.players[0].queues.structure?.[0]?.reason === 'ready');
  cmd(world, 'cancel', { type: 'allied_power' });
  run(world, 2);
  assert.equal(world.players[0].credits, start);
  assert.equal(world.players[0].credits, balance(world));
});

test('invalid or stale placements never consume the ready building', () => {
  const world = scenarioWorld('m3-outpost');
  deploy(world);
  cmd(world, 'build', { type: 'allied_power' });
  runUntil(world, 400, w => w.players[0].queues.structure?.[0]?.reason === 'ready');
  const def = world.rules.buildings.get('allied_power')!;
  const nav = world.nav;
  const river = world.rules.terrain.terrain.findIndex(t => t.id === 'river');
  let water = -1;
  for (let i = 0; i < nav.size && water < 0; i++) if (world.map.tiles[i] === river) water = i;
  const hq = first(world, 'allied_hq')!;
  const attempts = [
    { x: 0, y: 0 },
    { x: water % nav.width, y: (water / nav.width) | 0 },
    { x: hq.tile % nav.width, y: (hq.tile / nav.width) | 0 },
    { x: 110, y: 100 },
  ];
  for (const attempt of attempts) {
    cmd(world, 'place', { type: 'allied_power', ...attempt });
    run(world, 2);
    assert.equal(world.players[0].queues.structure.length, 1);
    assert.equal(world.entities.filter(e => e.type === 'allied_power').length, 0);
    assert.ok(world.players[0].notice.startsWith('cannot place'));
  }
  // Stale: the site was valid when chosen, but a structure appears before execution.
  const site = siteFor(world, 'allied_power');
  cmd(world, 'place', { type: 'allied_power', ...site });
  world.spawnBuilding('supply_dump', -1, nav.index(site.x, site.y));
  run(world, 2);
  assert.equal(world.entities.filter(e => e.type === 'allied_power').length, 0);
  assert.equal(world.players[0].queues.structure.length, 1);
  void def;
});

test('units on a footprint are moved away, never deleted, before the building appears', () => {
  const world = scenarioWorld('m3-outpost');
  deploy(world);
  cmd(world, 'build', { type: 'allied_power' });
  runUntil(world, 400, w => w.players[0].queues.structure?.[0]?.reason === 'ready');
  const site = siteFor(world, 'allied_power');
  const def = world.rules.buildings.get('allied_power')!;
  const tiles = footprintTiles(world, def, world.nav.index(site.x, site.y));
  const squatters = tiles.slice(0, 3).map(tile => world.spawnUnit('allied_rifle', 0, tile));
  cmd(world, 'place', { type: 'allied_power', ...site });
  runUntil(world, 200, w => first(w, 'allied_power') !== undefined);
  for (const unit of squatters) {
    assert.ok(world.get(unit.id), 'unit survives');
    assert.ok(!tiles.includes(unit.tile), 'unit left the footprint by moving');
  }
});

test('a blocked exit holds the finished unit without double charging; prerequisites and producers pause work', () => {
  const world = scenarioWorld('m3-outpost');
  deploy(world);
  grant(world, 100000);
  buildAndPlace(world, 'allied_power');
  const barracks = buildAndPlace(world, 'allied_barracks');
  const def = world.rules.buildings.get('allied_barracks')!;
  // Fill every approach tile.
  const w = world.nav.width;
  const ox = barracks.tile % w;
  const oy = (barracks.tile / w) | 0;
  const blockers: Entity[] = [];
  for (let y = oy - 1; y <= oy + def.footprint.h; y++) {
    for (let x = ox - 1; x <= ox + def.footprint.w; x++) {
      const tile = y * w + x;
      if (world.nav.passable(tile) && world.nav.occupancy[tile] === 0 && world.nav.structure[tile] === 0) blockers.push(world.spawnUnit('allied_rifle', 0, tile));
    }
  }
  const credits = world.players[0].credits;
  cmd(world, 'build', { type: 'allied_rifle' });
  run(world, 300);
  assert.equal(world.players[0].queues.infantry[0].reason, 'exit-blocked');
  assert.equal(credits - world.players[0].credits, 100);
  const count = world.entities.filter(e => e.type === 'allied_rifle').length;
  world.remove(blockers[blockers.length - 1].id);
  run(world, 3);
  assert.equal(world.entities.filter(e => e.type === 'allied_rifle').length, count, 'replaced, not duplicated');
  assert.equal(world.players[0].queues.infantry.length, 0);
  assert.equal(credits - world.players[0].credits, 100, 'charged once');
  // Prerequisite loss pauses queued work; restoring resumes it. A barracks needs a power plant.
  for (const unit of blockers) world.remove(unit.id);
  cmd(world, 'build', { type: 'allied_barracks' });
  run(world, 20);
  const item = world.players[0].queues.structure[0];
  const plant = first(world, 'allied_power')!;
  world.remove(plant.id);
  run(world, 2);
  assert.equal(item.reason, 'prerequisite');
  const frozen = item.work;
  run(world, 50);
  assert.equal(item.work, frozen, 'no progress without the prerequisite');
  cmd(world, 'build', { type: 'allied_barracks' });
  run(world, 1);
  assert.equal(world.players[0].queues.structure.length, 1, 'cannot queue without prerequisites');
  assert.match(world.players[0].notice, /requires/);
  world.spawnBuilding('allied_power', 0, plant.tile);
  runUntil(world, 400, () => item.reason === 'ready');
  // Losing one producer hands work to another eligible producer; losing all pauses visibly.
  cmd(world, 'place', { type: 'allied_barracks', ...siteFor(world, 'allied_barracks') });
  runUntil(world, 40, w => w.entities.filter(e => e.type === 'allied_barracks').length === 2);
  const second = world.entities.filter(e => e.type === 'allied_barracks')[1];
  cmd(world, 'build', { type: 'allied_rifle' });
  run(world, 10);
  world.remove(barracks.id);
  const rifles = world.entities.filter(e => e.type === 'allied_rifle').length;
  runUntil(world, 400, w => w.entities.filter(e => e.type === 'allied_rifle').length > rifles);
  const newest = world.entities.filter(e => e.type === 'allied_rifle').at(-1)!;
  assert.ok(Math.abs((newest.tile % w) - (second.tile % w)) <= 4, 'spawned at the remaining barracks');
  cmd(world, 'build', { type: 'allied_rifle' });
  run(world, 10);
  world.remove(second.id);
  run(world, 2);
  assert.equal(world.players[0].queues.infantry[0].reason, 'prerequisite');
  assert.equal(world.players[0].credits, balance(world));
});

test('MCV deploy failures keep the MCV; HQ is not sellable; sell and repair follow the rules', () => {
  const world = scenarioWorld('m3-outpost');
  const mcv = first(world, 'allied_mcv')!;
  // Park the MCV next to a tree line where the HQ footprint cannot fit.
  const nav = world.nav;
  let bad = -1;
  for (let i = 0; i < nav.size && bad < 0; i++) {
    if (nav.passable(i) && nav.occupancy[i] === 0 && nav.componentOf(i) === world.mainComponent()) {
      const x = i % nav.width;
      const y = (i / nav.width) | 0;
      if (x > 2 && y > 2 && x < 120 && y < 120 && !world.buildable[i + 1]) bad = i;
    }
  }
  nav.occupancy[mcv.tile] = 0;
  mcv.tile = bad;
  nav.occupancy[bad] = mcv.id;
  mcv.x = mcv.prevX = (bad % nav.width) * 1024 + 512;
  mcv.y = mcv.prevY = ((bad / nav.width) | 0) * 1024 + 512;
  cmd(world, 'deploy', { ids: [mcv.id] });
  run(world, 5);
  assert.ok(world.get(mcv.id), 'failed deploy keeps the MCV');
  assert.equal(mcv.status, 'deploy-blocked');
  assert.equal(first(world, 'allied_hq'), undefined);

  const good = scenarioWorld('m3-outpost');
  deploy(good);
  const hq = first(good, 'allied_hq')!;
  cmd(good, 'sell', { target: hq.id });
  run(good, 2);
  assert.ok(good.get(hq.id), 'HQ cannot be sold');
  const plant = buildAndPlace(good, 'allied_power');
  const credits = good.players[0].credits;
  plant.hp = 375;
  cmd(good, 'repair', { target: plant.id });
  run(good, 2000);
  assert.equal(plant.hp, 750);
  assert.ok(!plant.repairing);
  const repairCost = credits - good.players[0].credits;
  assert.ok(repairCost > 0 && repairCost <= 800 * 0.5 * 0.5 + 50, `repair cost ${repairCost}`);
  const before = good.players[0].credits;
  cmd(good, 'sell', { target: plant.id });
  cmd(good, 'sell', { target: plant.id });
  run(good, 2);
  assert.equal(good.get(plant.id), undefined);
  assert.equal(good.players[0].credits - before, 400, 'sold once for half its cost');
  assert.equal(good.players[0].credits, balance(good));
  assert.equal(definitionOf(good, 'allied_power')!.cost, 800);
});

test('rally points route produced units to a reachable tile', () => {
  const world = scenarioWorld('m3-outpost');
  deploy(world);
  grant(world, 100000);
  buildAndPlace(world, 'allied_power');
  const barracks = buildAndPlace(world, 'allied_barracks');
  const river = world.rules.terrain.terrain.findIndex(t => t.id === 'river');
  let water = -1;
  for (let i = 0; i < world.nav.size && water < 0; i++) if (world.map.tiles[i] === river && i % world.nav.width > 40) water = i;
  assert.ok(!world.nav.passable(water));
  cmd(world, 'rally', { target: barracks.id, x: water % world.nav.width, y: (water / world.nav.width) | 0 });
  run(world, 2);
  assert.ok(barracks.rally >= 0 && world.nav.passable(barracks.rally), 'rally resolved to reachable ground');
  const hq = first(world, 'allied_hq')!;
  cmd(world, 'rally', { target: hq.id, x: 30, y: 50 });
  run(world, 2);
  assert.equal(hq.rally, -1, 'structure producers have no rally');
  cmd(world, 'rally', { target: barracks.id, x: 34, y: 56 });
  cmd(world, 'build', { type: 'allied_rifle' });
  runUntil(world, 400, w => first(w, 'allied_rifle') !== undefined);
  const rifle = first(world, 'allied_rifle')!;
  runUntil(world, 1500, () => rifle.moveState === MoveState.Arrived);
  const w = world.nav.width;
  assert.ok(Math.hypot((rifle.tile % w) - (barracks.rally % w), ((rifle.tile / w) | 0) - ((barracks.rally / w) | 0)) <= 2);
});

test('identical base-building runs give identical state', () => {
  const script = (world: World): void => {
    deploy(world);
    buildAndPlace(world, 'allied_power');
    buildAndPlace(world, 'allied_barracks');
    cmd(world, 'build', { type: 'allied_rifle' });
    cmd(world, 'build', { type: 'allied_engineer' });
    run(world, 800);
  };
  const a = scenarioWorld('m3-outpost');
  const b = scenarioWorld('m3-outpost');
  script(a);
  script(b);
  assert.equal(snapshot(a), snapshot(b));
  assert.deepEqual(a.players, b.players);
});
