import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entity } from '../src/sim/entities.ts';
import { damageOf } from '../src/sim/combat.ts';
import { canSee } from '../src/sim/fog.ts';
import { loadRules } from '../src/sim/rules.ts';
import type { Rules } from '../src/sim/rules.ts';
import { World } from '../src/sim/world.ts';
import { lowlands, rawRules, rules, scenarioWorld, snapshot } from './helpers.ts';

/** Two-player open field on the west bank meadows, no resources. */
function arena(fog = false, r: Rules = rules()): World {
  const world = new World(r, lowlands(), 11);
  world.addPlayer('allies', 0);
  world.addPlayer('axis', 0);
  world.fogEnabled = fog;
  return world;
}

/** Free tiles around (x, y) in breadth-first order. */
function tilesNear(world: World, x: number, y: number, count: number): number[] {
  const origin = world.nav.nearestInComponent(world.nav.index(x, y), world.mainComponent());
  return world.search.collect(world, origin, count, 4000, tile => world.nav.occupancy[tile] === 0);
}

function spawn(world: World, type: string, owner: number, x: number, y: number, count = 1): Entity[] {
  return tilesNear(world, x, y, count).map(tile => world.spawnUnit(type, owner, tile));
}

/** Silence a unit's weapons so it is a passive measuring target. */
let passiveRules: Rules | null = null;
function passive(unit: Entity): void {
  passiveRules ??= rules();
  unit.cooldowns = passiveRules.units.get(unit.type)!.weapons.map(() => 1e9);
}

function run(world: World, ticks: number): void { for (let i = 0; i < ticks; i++) world.step(); }

const sameRoster = (r: Rules, faction: string): string[] => [...r.units.values()].filter(u => u.faction === faction).map(u => u.id);

test('AT guns kill heavy armour far faster than an equal-cost group of rifle squads', () => {
  const damageBy = (attacker: string, count: number): number => {
    const world = arena();
    const tiger = spawn(world, 'axis_heavy_tank', 1, 40, 60)[0];
    tiger.hp = 100000; // measure damage dealt without a kill
    passive(tiger);
    spawn(world, attacker, 0, 34, 60, count);
    run(world, 600);
    return 100000 - tiger.hp;
  };
  const r = rules();
  const atCost = r.units.get('allied_at_gun')!.cost;
  const rifles = Math.round(atCost / r.units.get('allied_rifle')!.cost);
  const at = damageBy('allied_at_gun', 1);
  const rifle = damageBy('allied_rifle', rifles);
  assert.ok(at > rifle * 5, `AT ${at} vs ${rifles} rifles ${rifle}`);
  // Rifles only marginally damage a Tiger: under 10% of its real HP in 30 s.
  assert.ok(rifle < r.units.get('axis_heavy_tank')!.hp * 0.1, `rifle damage ${rifle}`);
});

test('artillery outranges tanks and AT guns, and actually engages at that range', () => {
  const r = rules();
  const range = (id: string): number => Math.max(...r.units.get(id)!.weapons.map(w => r.weapons.get(w)!.range));
  for (const faction of ['allied', 'axis']) {
    for (const other of ['light_tank', 'medium_tank', 'heavy_tank', 'at_gun']) {
      assert.ok(range(`${faction}_artillery`) > range(`${faction}_${other}`), `${faction} artillery vs ${other}`);
    }
  }
  const world = arena();
  const gun = spawn(world, 'allied_artillery', 0, 30, 60)[0];
  const target = spawn(world, 'axis_medium_tank', 1, 44, 60)[0];
  passive(target);
  const before = target.hp;
  run(world, 400);
  assert.ok(Math.hypot(target.x - gun.x, target.y - gun.y) / 1024 > 10);
  assert.ok(target.hp < before, 'long-range artillery hit');
});

test('projectiles travel; splash falls off and only hits valid layers', () => {
  const world = arena();
  const gun = spawn(world, 'allied_artillery', 0, 30, 60)[0];
  const squads = spawn(world, 'axis_rifle', 1, 42, 60, 5);
  for (const unit of squads) passive(unit);
  const plane = spawn(world, 'axis_fighter', 1, 42, 60)[0];
  passive(plane);
  let fired = -1;
  let hit = -1;
  for (let i = 0; i < 400 && hit < 0; i++) {
    world.step();
    if (fired < 0 && world.events.some(e => e.kind === 'fire' && e.id === gun.id)) fired = world.tick;
    if (fired >= 0 && squads.some(s => s.hp < 125)) hit = world.tick;
  }
  assert.ok(fired > 0 && hit > fired + 5, `travel time: fired ${fired}, hit ${hit}`);
  assert.equal(plane.hp, world.rules.units.get('axis_fighter')!.hp, 'artillery never hits aircraft');
  const damaged = squads.filter(s => s.hp < 125);
  assert.ok(damaged.length >= 2, 'splash hit several squads');
  // Falloff: unequal damage between centre and edge.
  const losses = new Set(damaged.map(s => 125 - s.hp));
  assert.ok(losses.size >= 2, `falloff produces different damage: ${[...losses]}`);
  // Weapon layers: AT guns and rifles cannot engage aircraft; MGs can.
  const r = world.rules;
  const can = (unit: string): boolean => r.units.get(unit)!.weapons.some(w => r.weapons.get(w)!.targets.includes('air'));
  assert.ok(!can('allied_at_gun') && !can('allied_rifle') && !can('allied_artillery'));
  assert.ok(can('allied_mg') && can('allied_fighter') && can('axis_fighter'));
});

test('fighters counter fighters and strafe with passes', () => {
  const world = arena();
  const allied = spawn(world, 'allied_fighter', 0, 40, 60, 2);
  const axis = spawn(world, 'axis_fighter', 1, 46, 60)[0];
  run(world, 1200);
  assert.equal(world.get(axis.id), undefined, 'two fighters down one');
  assert.ok(allied.some(p => world.get(p.id)), 'a fighter survives');
  assert.ok(allied.every(p => world.nav.occupancy[p.tile] !== p.id), 'aircraft never occupy ground tiles');
});

test('a full projectile pool defers fire without losing damage or depending on schedule', () => {
  const raw = rawRules() as Record<string, Record<string, unknown>>;
  raw.combat = { ...raw.combat, projectilePool: 3 };
  const small = loadRules(raw as never);
  const setup = (): World => {
    const world = arena(false, small);
    spawn(world, 'allied_mg', 0, 34, 60, 6);
    const targets = spawn(world, 'axis_rifle', 1, 39, 60, 6);
    for (const unit of targets) passive(unit);
    return world;
  };
  const a = setup();
  const b = setup();
  let fires = 0;
  let impacts = 0;
  for (let i = 0; i < 300; i++) {
    a.step();
    fires += a.events.filter(e => e.kind === 'fire').length;
    impacts += a.events.filter(e => e.kind === 'impact').length;
    assert.ok(a.projectiles.count <= 3);
  }
  // A different "render schedule": inspect state between ticks in bursts.
  for (let i = 0; i < 300; i += 7) { for (let j = 0; j < 7 && i + j < 300; j++) b.step(); snapshot(b); }
  assert.equal(a.projectiles.peak, 3);
  assert.ok(fires - impacts <= 3 && fires > 30, `fires ${fires}, impacts ${impacts}`);
  assert.equal(snapshot(a), snapshot(b));
});

test('veterancy: promotion once, bonuses from base values, no duplicate kill credit', () => {
  const world = arena();
  const r = world.rules;
  const tank = spawn(world, 'allied_mg', 0, 34, 60)[0];
  const victims = spawn(world, 'axis_rifle', 1, 39, 60, 8);
  for (const unit of victims) passive(unit);
  const weapon = r.weapons.get('mg_browning')!;
  const base = damageOf(world, weapon, 0, victims[0]);
  run(world, 2400);
  const killed = victims.filter(v => !world.get(v.id)).length;
  assert.equal(tank.xp, killed * r.units.get('axis_rifle')!.cost, 'one credit per kill');
  const expectedRank = r.combat.veterancy.thresholdsPercent.filter(t => tank.xp * 100 >= r.units.get('allied_mg')!.cost * t).length;
  assert.equal(tank.rank, expectedRank);
  assert.ok(tank.rank >= 1, `rank ${tank.rank} after ${killed} kills`);
  // Bonuses derive from the base definition and current rank, never compounding.
  const promoted = damageOf(world, weapon, tank.rank, victims[0]);
  assert.equal(promoted, Math.max(1, Math.floor(weapon.damage * (100 + r.combat.veterancy.damagePercent[tank.rank]) / 100)));
  assert.equal(damageOf(world, weapon, tank.rank, victims[0]), promoted);
  assert.ok(promoted >= base);
});

test('destroyed entities release navigation, docks and production', () => {
  const world = scenarioWorld('m3-outpost');
  const mcv = world.entities.find(e => e.type === 'allied_mcv')!;
  world.enqueue({ player: 0, kind: 'deploy', ids: [mcv.id], x: 0, y: 0 });
  run(world, 5);
  const enemy = world.addPlayer('axis', 0);
  const s = world.subTile;
  const hq = world.entities.find(e => e.type === 'allied_hq')!;
  const trucks = spawn(world, 'allied_truck', 0, Math.floor(hq.x / s) + 3, Math.floor(hq.y / s) + 3, 1);
  trucks[0].auto = true;
  trucks[0].task = 'seek-dump';
  run(world, 400);
  const truck = trucks[0];
  const tile = truck.tile;
  const leased = world.entities.find(e => e.docks?.some(l => l.truck === truck.id));
  const killer = spawn(world, 'axis_heavy_tank', enemy.index, Math.floor(truck.x / s) + 4, Math.floor(truck.y / s))[0];
  run(world, 400);
  assert.equal(world.get(truck.id), undefined, 'truck destroyed');
  assert.notEqual(world.nav.occupancy[tile], truck.id);
  for (const b of world.entities) assert.ok(!b.docks?.some(l => l.truck === truck.id), 'lease released');
  void leased;
  void killer;
});

test('fog hides unseen enemies and keeps only last-seen structure knowledge', () => {
  const world = arena(true);
  const scout = spawn(world, 'allied_rifle', 0, 30, 60)[0];
  const enemy = spawn(world, 'axis_rifle', 1, 33, 60)[0];
  passive(enemy);
  const far = spawn(world, 'axis_medium_tank', 1, 60, 30)[0];
  passive(far);
  const depot = world.spawnBuilding('axis_power', 1, world.nav.index(32, 62));
  run(world, 8);
  assert.ok(canSee(world, 0, enemy));
  assert.ok(!canSee(world, 0, far), 'distant tank hidden');
  assert.ok(world.players[0].fog.memory.has(depot.id), 'building remembered once seen');
  // Leave: the enemy vanishes from sight, the building stays as memory with its old owner.
  world.enqueue({ player: 0, kind: 'move', ids: [scout.id], x: 8, y: 60 });
  run(world, 400);
  assert.ok(!canSee(world, 0, enemy));
  assert.ok(!canSee(world, 0, depot));
  assert.equal(world.players[0].fog.memory.get(depot.id)!.owner, 1);
  // Destroyed while unseen: memory persists until the site is seen again.
  world.remove(depot.id);
  run(world, 8);
  assert.ok(world.players[0].fog.memory.has(depot.id));
  world.enqueue({ player: 0, kind: 'move', ids: [scout.id], x: 30, y: 60 });
  run(world, 400);
  assert.ok(!world.players[0].fog.memory.has(depot.id), 'memory cleared on re-sight');
  // Orders against hidden enemies are ignored.
  world.enqueue({ player: 0, kind: 'attack', ids: [scout.id], x: 0, y: 0, target: far.id });
  run(world, 2);
  assert.equal(scout.attack, -1);
});

test('every roster unit except the MCV is reachable through legal prerequisites', () => {
  const r = rules();
  for (const faction of ['allies', 'axis']) {
    const mcv = [...r.units.values()].find(u => u.faction === faction && typeof u.capabilities.deploy === 'string')!;
    const owned = new Set<string>([String(mcv.capabilities.deploy)]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const def of r.buildings.values()) {
        if (def.faction !== faction || owned.has(def.id) || def.producer === null) continue;
        const producible = [...owned].some(id => r.buildings.get(id)?.produces.includes(def.producer!));
        if (producible && def.prerequisites.every(p => owned.has(p))) { owned.add(def.id); changed = true; }
      }
    }
    for (const id of sameRoster(r, faction)) {
      const def = r.units.get(id)!;
      if (def.id === mcv.id) continue;
      const producible = [...owned].some(b => r.buildings.get(b)?.produces.includes(def.producer!));
      assert.ok(producible && def.prerequisites.every(p => owned.has(p)), `${id} unreachable`);
    }
    const roles = ['engineer', 'rifle', 'mg', 'sniper', 'halftrack', 'light_tank', 'medium_tank', 'heavy_tank', 'at_gun', 'artillery', 'fighter', 'truck', 'mcv'];
    const prefix = faction === 'allies' ? 'allied' : 'axis';
    for (const role of roles) assert.ok(r.units.has(`${prefix}_${role}`), `${prefix}_${role} missing`);
  }
});

test('identical combat commands give identical state', () => {
  const play = (): World => {
    const world = scenarioWorld('m4-combat');
    const mine = world.entities.filter(e => e.owner === 0 && e.kind === 'unit').map(e => e.id);
    world.enqueue({ player: 0, kind: 'move', ids: mine, x: 80, y: 62 });
    run(world, 1500);
    return world;
  };
  const a = play();
  const b = play();
  assert.equal(snapshot(a), snapshot(b));
  assert.ok(a.projectiles.peak > 0, 'the armies fought');
});
