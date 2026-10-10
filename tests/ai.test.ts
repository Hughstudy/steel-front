import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entity } from '../src/sim/entities.ts';
import { loadRules } from '../src/sim/rules.ts';
import type { Rules, ScenarioDef, ScenarioPlayer } from '../src/sim/rules.ts';
import { World } from '../src/sim/world.ts';
import { lowlands, rawRules, rules, snapshot } from './helpers.ts';

const MINUTE = 20 * 60;

/** The skirmish map with the AI on the chosen side (the other side passive). */
function skirmish(r: Rules, aiSide: 0 | 1, difficulty: string, edit?: (players: ScenarioPlayer[]) => void): World {
  const base = r.scenarios.get('m5-skirmish')!;
  const players = base.players.map((p, i) => ({ ...p, ai: i === aiSide ? difficulty : '' }));
  edit?.(players);
  const scenario: ScenarioDef = { ...base, players };
  const world = new World(r, lowlands(), 7);
  world.loadScenario(scenario);
  return world;
}

function owned(world: World, player: number, predicate: (e: Entity) => boolean = () => true): Entity[] {
  return world.entities.filter(e => e.owner === player && predicate(e));
}

function count(world: World, player: number, type: string): number {
  return owned(world, player, e => e.type === type).length;
}

/** Steps the world, asserting credits never go negative and every new AI entity was paid for. */
function audit(world: World, player: number, ticks: number, state = { seen: new Set<number>(), cost: 0 }): typeof state {
  for (const e of world.entities) state.seen.add(e.id);
  for (let i = 0; i < ticks; i++) {
    world.step();
    const p = world.players[player];
    assert.ok(p.credits >= 0, `negative credits at ${world.tick}`);
    for (const e of world.entities) {
      if (state.seen.has(e.id)) continue;
      state.seen.add(e.id);
      if (e.owner !== player) continue;
      // The headquarters is the deployed starting MCV, not a purchase.
      const def = world.rules.buildings.get(e.type);
      if (def && def.produces.includes('structure')) continue;
      state.cost += (world.rules.units.get(e.type) ?? def)!.cost;
    }
    assert.ok(state.cost <= p.ledger.spent - p.ledger.refunded, `unpaid entities at ${world.tick}: ${state.cost} > ${p.ledger.spent - p.ledger.refunded}`);
  }
  const L = world.players[player].ledger;
  assert.equal(world.players[player].credits, L.initial + L.delivered + L.oil + L.refunded + L.sold - L.spent);
  return state;
}

test('each faction and difficulty opens legally, reaches income and sustains production', () => {
  const r = rules();
  for (const side of [0, 1] as const) {
    for (const difficulty of r.ai.difficulties.keys()) {
      const world = skirmish(r, side, difficulty);
      const plan = r.ai.factions.get(world.players[side].faction)!;
      audit(world, side, 9 * MINUTE);
      const label = `${world.players[side].faction}/${difficulty}`;
      for (const step of plan.base.slice(0, 3)) assert.ok(count(world, side, step.type) >= 1, `${label}: ${step.type}`);
      assert.ok(count(world, side, plan.truck) >= 1, `${label}: trucks`);
      assert.ok(world.players[side].ledger.delivered > 0, `${label}: income`);
      const army = owned(world, side, e => e.kind === 'unit' && r.units.get(e.type)!.weapons.length > 0);
      assert.ok(army.length >= 3, `${label}: army ${army.length}`);
      assert.ok(world.players[side].power.supply >= world.players[side].power.demand, `${label}: power`);
    }
  }
});

test('escalating mixed waves launch from real units and reach the enemy', () => {
  const world = skirmish(rules(), 1, 'normal');
  const mcv = owned(world, 0)[0];
  world.enqueue({ player: 0, kind: 'deploy', ids: [mcv.id], x: 0, y: 0 });
  audit(world, 1, 17 * MINUTE);
  const waves = world.players[1].ai!.waves;
  assert.ok(waves.length >= 3, `waves ${waves.length}`);
  for (let i = 0; i < 3; i++) {
    const wave = waves[i];
    assert.ok(Object.keys(wave.composition).length >= 3, `wave ${i} mixed: ${JSON.stringify(wave.composition)}`);
    assert.equal(Object.values(wave.composition).reduce((a, b) => a + b, 0), wave.size);
    assert.ok(wave.arrivedTick > wave.launchTick, `wave ${i} arrived`);
    if (i > 0) assert.ok(wave.size > waves[i - 1].size && wave.launchTick > waves[i - 1].launchTick, `wave ${i} escalates`);
  }
});

test('recovers lost power, a truck and a prerequisite building, then resumes production', () => {
  const r = rules();
  const world = skirmish(r, 1, 'normal');
  const plan = r.ai.factions.get('axis')!;
  const state = audit(world, 1, 8 * MINUTE);
  const powerBefore = count(world, 1, plan.power);
  const trucksBefore = count(world, 1, plan.truck);
  world.remove(owned(world, 1, e => e.type === plan.power)[0].id);
  world.remove(owned(world, 1, e => e.type === plan.truck)[0].id);
  for (const barracks of owned(world, 1, e => e.type === 'axis_barracks')) world.remove(barracks.id);
  const seenBefore = new Set(world.entities.map(e => e.id));
  audit(world, 1, 6 * MINUTE, state);
  assert.ok(count(world, 1, 'axis_barracks') >= 1, 'barracks rebuilt');
  assert.ok(count(world, 1, plan.power) >= powerBefore, 'power rebuilt');
  assert.ok(count(world, 1, plan.truck) >= Math.min(trucksBefore, r.ai.difficulties.get('normal')!.truckTarget), 'trucks replaced');
  const newInfantry = owned(world, 1, e => !seenBefore.has(e.id) && r.units.get(e.type)?.producer === 'infantry');
  assert.ok(newInfantry.length > 0, 'infantry production resumed');
});

test('irrecoverable bankruptcy stalls stably without retry spin', () => {
  const r = rules();
  const world = skirmish(r, 1, 'normal', players => {
    players[1] = { ...players[1], credits: 0, units: [{ type: 'axis_rifle', count: 1 }], buildings: [{ type: 'axis_hq', spawn: 1 }, { type: 'axis_power', spawn: 1 }] };
  });
  audit(world, 1, 10 * MINUTE);
  const ai = world.players[1].ai!;
  assert.ok(ai.log.some(line => line.includes('stalled')), ai.log.join('\n'));
  // Long retry timer: a handful of reassessments, no commands that cannot succeed.
  assert.ok(ai.commands <= 2, `commands ${ai.commands}`);
  assert.equal(world.players[1].credits, 0);
  assert.equal(count(world, 1, 'axis_hq'), 1);
});

test('exhausted nearby supplies send trucks to further dumps', () => {
  const r = rules();
  const world = skirmish(r, 1, 'normal');
  audit(world, 1, 6 * MINUTE);
  const hq = owned(world, 1, e => e.type === 'axis_hq')[0];
  const dumps = world.entities.filter(e => e.kind === 'building' && typeof r.buildings.get(e.type)!.capabilities.supply === 'number' && e.stock > 0)
    .sort((a, b) => ((a.x - hq.x) ** 2 + (a.y - hq.y) ** 2) - ((b.x - hq.x) ** 2 + (b.y - hq.y) ** 2));
  const [near1, near2, ...far] = dumps;
  near1.stock = 0;
  near2.stock = 0;
  const farStock = far.reduce((sum, d) => sum + d.stock, 0);
  const delivered = world.players[1].ledger.delivered;
  audit(world, 1, 5 * MINUTE);
  assert.ok(world.players[1].ledger.delivered > delivered, 'deliveries continue');
  assert.ok(far.reduce((sum, d) => sum + d.stock, 0) < farStock, 'further dumps are being hauled');
});

test('defends its base against a visible attack without abandoning its economy', () => {
  const r = rules();
  const world = skirmish(r, 1, 'normal');
  audit(world, 1, 8 * MINUTE);
  const hq = owned(world, 1, e => e.type === 'axis_hq')[0];
  const tiles = world.search.collect(world, world.nav.nearestInComponent(world.nav.index((hq.x >> 10) - 10, hq.y >> 10), world.mainComponent()), 2, 4000, t => world.nav.occupancy[t] === 0);
  const raiders = tiles.map(tile => world.spawnUnit('allied_rifle', 0, tile));
  world.enqueue({ player: 0, kind: 'amove', ids: raiders.map(u => u.id), x: hq.x >> 10, y: hq.y >> 10 });
  const delivered = world.players[1].ledger.delivered;
  let defending = 0;
  for (let i = 0; i < 600; i++) {
    world.step();
    defending = Math.max(defending, owned(world, 1, e => e.kind === 'unit' && (e.attack >= 0 && raiders.some(u => u.id === e.attack))).length);
  }
  const ai = world.players[1].ai!;
  assert.ok(ai.log.some(line => line.includes('defend')), 'defence ordered');
  assert.ok(defending >= 2, `defenders engaged: ${defending}`);
  const trucks = owned(world, 1, e => e.type === 'axis_truck');
  assert.ok(trucks.length > 0 && trucks.every(t => t.amove < 0 && t.task !== ''), 'trucks keep hauling');
  assert.ok(raiders.every(u => !world.get(u.id)), 'raid repelled');
  assert.ok(owned(world, 1, e => e.kind === 'building').length >= 6, 'base intact');
  assert.ok(world.players[1].ledger.delivered > delivered, 'income continues during defence');
});

test('same seed and difficulty replay to identical AI commands and state', () => {
  const run = (): string => {
    const world = skirmish(rules(), 1, 'hard');
    world.players[0].ai = null;
    for (let i = 0; i < 7 * MINUTE; i++) world.step();
    return snapshot(world) + JSON.stringify(world.players.map(p => p.ai)) + JSON.stringify(world.commands);
  };
  assert.equal(run(), run());
});

test('difficulty behaviour changes by editing JSON values alone', () => {
  const firstWave = (r: Rules): { tick: number; size: number } => {
    const world = skirmish(r, 1, 'normal');
    for (let i = 0; i < 12 * MINUTE && world.players[1].ai!.waves.length === 0; i++) world.step();
    const wave = world.players[1].ai!.waves[0];
    return { tick: wave.launchTick, size: wave.size };
  };
  const raw = rawRules() as { ai: { difficulties: Array<Record<string, unknown>> } };
  const normal = raw.ai.difficulties.find(d => d.id === 'normal')!;
  const base = firstWave(loadRules(rawRules() as never));
  normal.firstWaveTick = 3 * MINUTE;
  normal.waveStartSize = 3;
  normal.defenseReserve = 0;
  const edited = firstWave(loadRules(raw as never));
  assert.ok(edited.tick < base.tick, `earlier: ${edited.tick} vs ${base.tick}`);
  assert.equal(edited.size, 3);
  assert.notEqual(base.size, edited.size);
});

test('attack-move engages enemies seen on the way, then completes the move', () => {
  const r = rules();
  const setup = (kind: 'move' | 'amove'): { world: World; target: Entity; squad: Entity[] } => {
    const world = new World(r, lowlands(), 3);
    world.addPlayer('allies', 0);
    world.addPlayer('axis', 0);
    world.fogEnabled = false;
    const near = (x: number, y: number, n: number): number[] => world.search.collect(world, world.nav.nearestInComponent(world.nav.index(x, y), world.mainComponent()), n, 4000, t => world.nav.occupancy[t] === 0);
    const squad = near(30, 60, 3).map(t => world.spawnUnit('allied_mg', 0, t));
    const target = world.spawnUnit('axis_rifle', 1, near(38, 66, 1)[0]);
    target.cooldowns = [1e9];
    world.enqueue({ player: 0, kind, ids: squad.map(u => u.id), x: 46, y: 60 });
    for (let i = 0; i < 1600; i++) world.step();
    return { world, target, squad };
  };
  const moved = setup('move');
  assert.ok(moved.world.get(moved.target.id), 'a plain move does not hunt targets out of range');
  const attacked = setup('amove');
  assert.equal(attacked.world.get(attacked.target.id), undefined, 'attack-move killed the bystander');
  for (const unit of attacked.squad) {
    assert.equal(unit.amove, -1, 'order complete');
    assert.ok(Math.abs((unit.x >> 10) - 46) <= 3 && Math.abs((unit.y >> 10) - 60) <= 3, `arrived near the destination: ${unit.x >> 10},${unit.y >> 10}`);
  }
});
