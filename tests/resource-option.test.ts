import assert from 'node:assert/strict';
import test from 'node:test';
import { captureWorld, loadMatch, parseSave, serializeMatch } from '../src/sim/save.ts';
import { scenarioFor } from '../src/sim/skirmish.ts';
import type { MatchSetup } from '../src/sim/skirmish.ts';
import { World } from '../src/sim/world.ts';
import { presetMap, rules } from './helpers.ts';

const r = rules();
const modes = ['play', 'spectate'] as const;
type SkirmishSetup = Extract<MatchSetup, { kind: 'skirmish' }>;

function newWorld(setup: MatchSetup): World {
  const scenario = scenarioFor(r, setup);
  const world = new World(r, presetMap(r, scenario.map), r.maps.get(scenario.map)!.seed);
  world.loadScenario(scenario);
  return world;
}

function infiniteSites(world: World): number {
  return world.entities.filter(entity => r.buildings.get(entity.type)?.capabilities.infiniteSupply).length;
}

function advance(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) world.step();
}

function mapFor(setup: MatchSetup): ReturnType<typeof presetMap> {
  return presetMap(r, scenarioFor(r, setup).map);
}

test('the supply option adds or removes only the two infinite yards on both maps and modes', () => {
  for (const map of r.skirmish.maps) for (const mode of modes) {
    const setup: SkirmishSetup = { kind: 'skirmish', map, faction: 'allies', difficulty: 'normal', mode };
    const enabled = newWorld({ ...setup, infiniteSupplies: true });
    const disabled = newWorld({ ...setup, infiniteSupplies: false });
    assert.equal(infiniteSites(enabled), 2, `${map}/${mode}: one yard per base when enabled`);
    assert.equal(infiniteSites(disabled), 0, `${map}/${mode}: no infinite yards when disabled`);

    const preset = r.maps.get(map)!;
    for (const world of [enabled, disabled]) {
      const finite = world.entities.filter(entity => entity.type === preset.supplyType);
      assert.equal(finite.length, preset.supplies.length, 'all finite dumps remain available');
      for (const dump of finite) {
        assert.equal(dump.stock, r.buildings.get(dump.type)!.capabilities.supply);
        assert.ok(!r.buildings.get(dump.type)!.capabilities.infiniteSupply);
      }
      assert.equal(world.entities.filter(entity => entity.type === preset.derrickType).length, preset.derricks.length);
      assert.equal(world.players[0].ai?.difficulty ?? null, mode === 'spectate' ? 'normal' : null);
      assert.equal(world.players[1].ai?.difficulty, 'normal');
    }
    const finiteResources = (world: World) => world.entities
      .filter(entity => entity.owner < 0 && !r.buildings.get(entity.type)?.capabilities.infiniteSupply)
      .map(({ type, tile, stock }) => ({ type, tile, stock }));
    assert.deepEqual(finiteResources(disabled), finiteResources(enabled), 'finite resource locations and stock are unchanged');
  }
});

test('previous-release saves without a supply option still load and restart with infinite yards', () => {
  for (const mode of modes) {
    const setup: SkirmishSetup = { kind: 'skirmish', map: 'lowlands', faction: 'axis', difficulty: 'normal', mode };
    const original = newWorld(setup);
    advance(original, 200);
    const text = serializeMatch(original, setup, 'previous release', 'fixed');
    assert.equal(Object.hasOwn(JSON.parse(text).setup, 'infiniteSupplies'), false);
    const restored = loadMatch(text, r, mapFor);
    assert.deepEqual(restored.setup, setup);
    assert.equal(infiniteSites(restored.world), 2);
    assert.equal(infiniteSites(newWorld(restored.setup)), 2, 'Play Again / Watch Again preserve the old default');
    assert.equal(serializeMatch(restored.world, restored.setup, 'previous release', 'fixed'), text);
    advance(original, 100);
    advance(restored.world, 100);
    assert.deepEqual(captureWorld(restored.world), captureWorld(original));
  }
});

test('explicit on and off settings survive save/load, continuation and restart in both modes', () => {
  for (const mode of modes) for (const infiniteSupplies of [false, true]) {
    const setup: SkirmishSetup = { kind: 'skirmish', map: 'ardennes', faction: 'allies', difficulty: 'normal', mode, infiniteSupplies };
    const original = newWorld(setup);
    advance(original, 300);
    const text = serializeMatch(original, setup, 'resource option', 'fixed');
    const restored = loadMatch(text, r, mapFor);
    assert.deepEqual(restored.setup, setup);
    assert.equal(infiniteSites(restored.world), infiniteSupplies ? 2 : 0);
    assert.equal(serializeMatch(restored.world, restored.setup, 'resource option', 'fixed'), text);
    const restarted = newWorld(restored.setup);
    assert.equal(infiniteSites(restarted), infiniteSupplies ? 2 : 0, 'restart uses the saved resource choice');
    advance(original, 300);
    advance(restored.world, 300);
    assert.deepEqual(captureWorld(restored.world), captureWorld(original));
  }
});

test('saved supply options reject every nonboolean value', () => {
  const setup: SkirmishSetup = { kind: 'skirmish', map: 'lowlands', faction: 'allies', difficulty: 'normal', infiniteSupplies: false };
  const text = serializeMatch(newWorld(setup), setup, 'invalid options', 'fixed');
  for (const value of [null, 0, 1, 'false', 'true', '', {}, []]) {
    const file = JSON.parse(text);
    file.setup.infiniteSupplies = value;
    assert.throws(() => parseSave(JSON.stringify(file), r), /setup.infiniteSupplies: expected a boolean/);
  }
});
