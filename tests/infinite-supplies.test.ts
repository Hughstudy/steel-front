import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiState } from '../src/sim/ai.ts';
import { approachCost } from '../src/sim/economy.ts';
import { loadRules } from '../src/sim/rules.ts';
import { captureWorld, loadMatch, serializeMatch } from '../src/sim/save.ts';
import type { MatchSetup } from '../src/sim/skirmish.ts';
import type { World } from '../src/sim/world.ts';
import { describe } from '../src/ui/selection-panel.ts';
import { presetMap, rawRules, rules, skirmishWorld, validateSkirmishMap } from './helpers.ts';

function advance(world: World, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) world.step();
}

/** Let the normal AI deploy on reachable ground, then isolate real truck orders. */
function haulingWorld(map: string): World {
  const r = rules();
  const world = skirmishWorld(r, map, 'allies', 'normal');
  world.victory = false;
  world.fogEnabled = false;
  for (const player of world.players) {
    player.ai = createAiState('normal', r.ai.difficulties.get('normal')!.firstWaveTick);
  }
  while (world.players.some(player => player.ai !== null) && world.tick < 1200) {
    world.step();
    for (const player of world.players) {
      if (world.entities.some(e => e.owner === player.index && r.buildings.get(e.type)?.capabilities.depot)) player.ai = null;
    }
  }
  for (const player of world.players) {
    assert.ok(world.entities.some(e => e.owner === player.index && r.buildings.get(e.type)?.capabilities.depot), `${map}: HQ deployed for side ${player.index}`);
    const anchor = world.nav.nearestInComponent(player.start, world.mainComponent());
    const field = world.fieldFrom(anchor);
    const source = world.entities.filter(e => r.buildings.get(e.type)?.capabilities.infiniteSupply)
      .sort((a, b) => approachCost(world, field, a) - approachCost(world, field, b))[0];
    for (let i = 0; i < 3; i++) {
      const tile = world.search.nearestFree(world, anchor, anchor, 300);
      const truck = world.spawnUnit(r.ai.factions.get(player.faction)!.truck, player.index, tile);
      world.enqueue({ player: player.index, kind: 'harvest', ids: [truck.id], target: source.id, x: 0, y: 0 });
    }
  }
  return world;
}

test('each skirmish base has its own nearby reachable infinite site on both maps', () => {
  const r = rules();
  for (const map of r.skirmish.maps) {
    assert.deepEqual(validateSkirmishMap(r, map), []);
    const world = skirmishWorld(r, map, 'allies', 'normal');
    const sources = world.entities.filter(e => r.buildings.get(e.type)?.capabilities.infiniteSupply);
    assert.equal(sources.length, 2);
    assert.equal(world.entities.filter(e => e.type === 'supply_dump').length, 10, 'finite expansion supplies remain');
    const closest = new Set<number>();
    for (const player of world.players) {
      const field = world.fieldFrom(player.start);
      const ranked = sources.map(source => ({ source, cost: approachCost(world, field, source) })).sort((a, b) => a.cost - b.cost);
      assert.ok(ranked[0].cost <= 120, `${map}: side ${player.index} supply route costs ${ranked[0].cost}, expected <= 12 tiles`);
      closest.add(ranked[0].source.id);
      assert.match(describe(world, ranked[0].source), /INFINITE SUPPLIES/);
    }
    assert.equal(closest.size, 2, 'each base is closest to a different site');
  }
});

test('both sides repeatedly haul beyond the stock limit without exhausting infinite sites', () => {
  for (const map of rules().skirmish.maps) {
    const world = haulingWorld(map);
    const supplies = world.entities.filter(e => typeof world.rules.buildings.get(e.type)?.capabilities.supply === 'number');
    const stock = new Map(supplies.map(e => [e.id, e.stock]));
    advance(world, 9000);
    for (const player of world.players) {
      assert.ok(player.ledger.delivered > 6000, `${map}: side ${player.index} delivered ${player.ledger.delivered}`);
      assert.equal(player.credits, player.ledger.initial + player.ledger.delivered, 'only unloaded cargo becomes income');
    }
    for (const supply of supplies) {
      assert.ok(world.get(supply.id), 'no site removed');
      assert.equal(supply.stock, stock.get(supply.id), 'infinite stock stays bounded; unchosen finite stock stays untouched');
    }
    for (const truck of world.entities.filter(e => e.auto)) {
      assert.ok(truck.cargo >= 0 && truck.cargo <= Number(world.rules.units.get(truck.type)!.capabilities.cargo));
    }
  }
});

test('an active infinite-supply haul round-trips through JSON and continues deterministically', () => {
  const original = haulingWorld('ardennes');
  advance(original, 1000);
  const setup: MatchSetup = { kind: 'skirmish', map: 'ardennes', faction: 'allies', difficulty: 'normal' };
  const text = serializeMatch(original, setup, 'endless hauling', 'fixed');
  const copy = loadMatch(text, original.rules, () => presetMap(original.rules, 'ardennes')).world;
  assert.equal(serializeMatch(copy, setup, 'endless hauling', 'fixed'), text);
  const before = original.players.map(p => p.ledger.delivered);
  advance(original, 1200);
  advance(copy, 1200);
  assert.deepEqual(captureWorld(copy), captureWorld(original));
  for (const player of copy.players) assert.ok(player.ledger.delivered > before[player.index]);
  for (const source of copy.entities.filter(e => copy.rules.buildings.get(e.type)?.capabilities.infiniteSupply)) {
    assert.equal(source.stock, copy.rules.buildings.get(source.type)!.capabilities.supply);
  }
});

test('infinite supply rules reject malformed capability and map contracts', () => {
  const cases: Array<[string, (raw: ReturnType<typeof rawRules>) => void, RegExp]> = [
    ['boolean flag', raw => { (raw.buildings as Array<{ id: string; capabilities: Record<string, unknown> }>).find(b => b.id === 'supply_source')!.capabilities.infiniteSupply = 'yes'; }, /infiniteSupply: expected a boolean/],
    ['positive supply', raw => { (raw.buildings as Array<{ id: string; capabilities: Record<string, unknown> }>).find(b => b.id === 'supply_source')!.capabilities.supply = 0; }, /requires positive supply stock/],
    ['one site per spawn', raw => { (raw.maps as Array<{ infiniteSupplies: unknown[] }>)[0].infiniteSupplies.pop(); }, /need one site per player spawn/],
    ['infinite building type', raw => { (raw.maps as Array<{ infiniteSupplyType: string }>)[0].infiniteSupplyType = 'supply_dump'; }, /expected a building with infiniteSupply/],
  ];
  for (const [name, mutate, expected] of cases) {
    const raw = rawRules();
    mutate(raw);
    assert.throws(() => loadRules(raw as never), expected, name);
  }
});
