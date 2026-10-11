import assert from 'node:assert/strict';
import test from 'node:test';
import { canSee } from '../src/sim/fog.ts';
import { captureWorld, loadMatch, parseSave, serializeMatch } from '../src/sim/save.ts';
import { isSpectator, scenarioFor } from '../src/sim/skirmish.ts';
import type { MatchSetup } from '../src/sim/skirmish.ts';
import { World } from '../src/sim/world.ts';
import { presetMap, rules } from './helpers.ts';

const MINUTE = 20 * 60;
const setup: MatchSetup = { kind: 'skirmish', map: 'lowlands', faction: 'allies', difficulty: 'hard', mode: 'spectate' };

function spectatorWorld(match = setup): World {
  const r = rules();
  const scenario = scenarioFor(r, match);
  const world = new World(r, presetMap(r, scenario.map), 7);
  world.loadScenario(scenario);
  return world;
}

test('spectator setup starts two equal-difficulty AI players and preserves their own fog', () => {
  const r = rules();
  for (const map of r.skirmish.maps) for (const faction of r.factions.keys()) for (const difficulty of r.ai.difficulties.keys()) {
    const match: MatchSetup = { kind: 'skirmish', mode: 'spectate', map, faction, difficulty };
    const world = spectatorWorld(match);
    assert.ok(isSpectator(match));
    assert.equal(world.players[0].faction, faction);
    assert.notEqual(world.players[1].faction, faction);
    assert.ok(world.fogEnabled);
    assert.ok(world.victory);
    for (const player of world.players) {
      assert.equal(player.ai?.difficulty, difficulty);
      const enemy = world.entities.find(e => e.owner === 1 - player.index)!;
      assert.equal(canSee(world, player.index, enemy), false, 'the spectator view must not give the AI enemy vision');
      assert.ok(player.fog.visible.some(value => value === 1));
      assert.ok(player.fog.visible.some(value => value === 0));
    }
  }
});

test('normal and legacy setups preserve the human-controlled first side', () => {
  assert.equal(isSpectator(null), false);
  assert.equal(isSpectator({ kind: 'scenario', id: 'm5-skirmish', difficulty: 'normal' }), false);
  for (const mode of [undefined, 'play'] as const) {
    const match: MatchSetup = { kind: 'skirmish', map: 'lowlands', faction: 'axis', difficulty: 'normal', ...(mode ? { mode } : {}) };
    const world = spectatorWorld(match);
    assert.equal(isSpectator(match), false);
    assert.equal(world.players[0].ai, null);
    assert.equal(world.players[1].ai?.difficulty, 'normal');
    const saved = parseSave(serializeMatch(world, match, 'normal', 'fixed'), world.rules);
    assert.deepEqual(saved.setup, match);
  }
});

test('spectator saves reject invalid modes and preserve the selected mode exactly', () => {
  const world = spectatorWorld();
  const text = serializeMatch(world, setup, 'AI vs AI', 'fixed');
  assert.deepEqual(parseSave(text, world.rules).setup, setup);
  for (const mode of ['watch', '', null, true, 1, {}, []]) {
    const file = JSON.parse(text);
    file.setup.mode = mode;
    assert.throws(() => parseSave(JSON.stringify(file), world.rules), /setup.mode: unknown skirmish mode/);
  }
  const file = JSON.parse(text);
  file.setup.extra = true;
  assert.throws(() => parseSave(JSON.stringify(file), world.rules), /setup.extra: unknown field/);
});

test('both spectator AIs build, haul, fight, resume identically after saving and reach a result', () => {
  const world = spectatorWorld();
  for (let i = 0; i < 9 * MINUTE && !world.outcome; i++) world.step();
  for (const player of world.players) {
    assert.ok(player.deployed, `side ${player.index} deployed its MCV`);
    assert.ok(player.stats.buildingsBuilt >= 4, `side ${player.index} built its base`);
    assert.ok(player.stats.unitsBuilt >= 3, `side ${player.index} produced an army`);
    assert.ok(player.ledger.delivered > 0, `side ${player.index} hauled supplies`);
    assert.ok(player.ai!.waves.length > 0, `side ${player.index} launched an attack`);
    assert.equal(player.credits, player.ledger.initial + player.ledger.delivered + player.ledger.oil + player.ledger.refunded + player.ledger.sold - player.ledger.spent);
  }
  const text = serializeMatch(world, setup, 'AI vs AI', 'fixed');
  const restored = loadMatch(text, world.rules, saved => {
    assert.ok(isSpectator(saved));
    return presetMap(world.rules, scenarioFor(world.rules, saved).map);
  });
  assert.deepEqual(restored.setup, setup);
  assert.equal(serializeMatch(restored.world, restored.setup, 'AI vs AI', 'fixed'), text);
  for (let i = 0; i < 2 * MINUTE; i++) {
    world.step();
    restored.world.step();
  }
  assert.deepEqual(captureWorld(restored.world), captureWorld(world));
  assert.ok(world.players.some(player => player.stats.unitsLost > 0), 'the two armies fought');
  for (let i = world.tick; i < 45 * MINUTE && !world.outcome; i++) world.step();
  assert.ok(world.outcome, 'the autonomous battle reaches a terminal result');
  assert.ok(world.outcome.draw || world.outcome.winner === 0 || world.outcome.winner === 1);
  const frozen = captureWorld(world);
  world.step();
  assert.deepEqual(captureWorld(world), frozen, 'the decided battle remains frozen');
});
