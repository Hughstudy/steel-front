import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiState } from '../src/sim/ai.ts';
import { applyDamage } from '../src/sim/combat.ts';
import type { Entity } from '../src/sim/entities.ts';
import { captureWorld, loadMatch, MAX_SAVE_CHARS, parseSave, SaveError, serializeMatch } from '../src/sim/save.ts';
import type { MatchSetup } from '../src/sim/skirmish.ts';
import { skirmishScenario } from '../src/sim/skirmish.ts';
import { World } from '../src/sim/world.ts';
import { presetMap, rules, scenarioWorld, skirmishWorld, validateSkirmishMap } from './helpers.ts';

const MINUTE = 20 * 60;

function objectiveOf(world: World, player: number): Entity {
  return world.entities.find(e => e.owner === player && (world.rules.buildings.get(e.type)?.capabilities.objective
    || typeof world.rules.units.get(e.type)?.capabilities.deploy === 'string'))!;
}

function destroy(world: World, entity: Entity): void { applyDamage(world, entity, entity.hp, -1); }

/** Deploy both starting MCVs (the AI bootstrap finds a valid site), then leave both sides idle. */
function deployBoth(world: World): void {
  for (const player of world.players) player.ai = createAiState('normal', 1e9);
  for (let i = 0; i < 2 * MINUTE && !world.players.every(p => p.deployed); i++) world.step();
  for (const player of world.players) player.ai = null;
}

test('both skirmish maps have deployable spawns, room to build, reachable resources and a ground route', () => {
  const r = rules();
  assert.ok(r.skirmish.maps.length >= 2);
  for (const id of r.skirmish.maps) assert.deepEqual(validateSkirmishMap(r, id), [], id);
  const lowlands = presetMap(r, 'lowlands');
  const ardennes = presetMap(r, 'ardennes');
  assert.notDeepEqual(lowlands.tiles, ardennes.tiles, 'presets generate different terrain');
});

test('the setup chooses faction, map and AI difficulty', () => {
  const r = rules();
  for (const faction of r.factions.keys()) {
    for (const map of r.skirmish.maps) {
      const world = skirmishWorld(r, map, faction, 'hard');
      assert.equal(world.players[0].faction, faction);
      assert.notEqual(world.players[1].faction, faction);
      assert.equal(world.players[0].ai, null);
      assert.equal(world.players[1].ai!.difficulty, 'hard');
      assert.equal(world.map, presetMap(r, map));
      assert.ok(world.victory);
      const objective = objectiveOf(world, 0);
      assert.equal(objective.kind, 'unit', 'each side starts with only its MCV as the objective');
      assert.equal(world.entities.filter(e => e.owner === 0).length, 1);
    }
  }
  assert.throws(() => skirmishScenario(r, 'nowhere', 'allies', 'normal'));
});

test('losing the MCV before deployment is a defeat and freezes the match', () => {
  const r = rules();
  const world = skirmishWorld(r, 'lowlands', 'allies', 'normal');
  world.step();
  destroy(world, objectiveOf(world, 0));
  world.step();
  assert.deepEqual(world.outcome, { tick: world.tick, winner: 1, draw: false });
  assert.equal(world.players[0].alive, false);
  const frozen = JSON.stringify(captureWorld(world));
  for (let i = 0; i < 100; i++) world.step();
  assert.equal(JSON.stringify(captureWorld(world)), frozen, 'nothing changes after the terminal tick');
});

test('deployment transfers the objective to the HQ; its destruction decides the match', () => {
  const r = rules();
  const world = skirmishWorld(r, 'lowlands', 'axis', 'normal');
  deployBoth(world);
  assert.ok(world.players.every(p => p.deployed), 'both MCVs deployed');
  assert.equal(world.outcome, null);
  const hq = objectiveOf(world, 1);
  assert.equal(hq.kind, 'building');
  destroy(world, hq);
  world.step();
  assert.equal(world.outcome?.winner, 0);
  assert.equal(world.players[1].defeatTick, world.tick);
  assert.equal(world.players[1].stats.buildingsLost, 1);
});

test('simultaneous HQ destruction is a draw; sandboxes never end', () => {
  const r = rules();
  const world = skirmishWorld(r, 'ardennes', 'allies', 'easy');
  deployBoth(world);
  destroy(world, objectiveOf(world, 0));
  destroy(world, objectiveOf(world, 1));
  world.step();
  assert.deepEqual(world.outcome, { tick: world.tick, winner: -1, draw: true });

  const sandbox = scenarioWorld('m4-combat');
  for (const e of sandbox.entities.filter(e => e.owner === 0)) destroy(sandbox, e);
  sandbox.step();
  assert.equal(sandbox.outcome, null);
});

const setup: MatchSetup = { kind: 'skirmish', map: 'lowlands', faction: 'allies', difficulty: 'hard' };
const mapFor = (s: MatchSetup): ReturnType<typeof presetMap> => presetMap(rules(), s.kind === 'skirmish' ? s.map : 'lowlands');

/** An active AI-vs-AI match: hauling, production, pathing and combat all in flight. */
function busyWorld(): World {
  const r = rules();
  const world = skirmishWorld(r, 'lowlands', 'allies', 'hard', 7);
  world.players[0].ai = structuredClone(world.players[1].ai);
  return world;
}

test('a save continues exactly like the uninterrupted match (hauling, production, combat, pending paths)', () => {
  const r = rules();
  const original = busyWorld();
  // Advance into the first battles, then stop at a tick with shots in flight and queued path jobs.
  while (original.tick < 9 * MINUTE || original.projectiles.count === 0 || original.pathJobs.length === 0) {
    original.step();
    assert.ok(original.tick < 16 * MINUTE, 'expected combat with queued path jobs');
  }
  const free = original.projectiles.freeSlots();
  assert.ok(free.length < original.projectiles.capacity);
  assert.ok(original.players.some(p => Object.values(p.queues).some(q => q.length && q[0].work > 0 && q[0].work < q[0].total)), 'partial production');
  assert.ok(original.entities.some(e => e.cargo > 0 && e.task !== ''), 'trucks hauling');
  assert.ok(original.entities.some(e => e.attack >= 0 || e.aim >= 0), 'units engaged');
  const someone = original.entities.find(e => e.owner === 0 && e.kind === 'unit' && r.units.get(e.type)!.weapons.length)!;
  original.enqueue({ player: 0, kind: 'move', ids: [someone.id], x: 40, y: 60 }, original.tick + 30);

  const text = serializeMatch(original, setup, 'test', 'fixed');
  assert.ok(text.length < MAX_SAVE_CHARS / 4, `save size ${text.length}`);
  const { world: copy } = loadMatch(text, r, mapFor);
  assert.equal(serializeMatch(copy, setup, 'test', 'fixed'), text, 'round trip is exact');
  assert.deepEqual(copy.projectiles.freeSlots(), free);

  for (let i = 0; i < 2 * MINUTE; i++) {
    original.step();
    copy.step();
  }
  assert.equal(JSON.stringify(captureWorld(copy)), JSON.stringify(captureWorld(original)));
});

test('malformed, incompatible and oversized saves are rejected with a reason', () => {
  const r = rules();
  const world = skirmishWorld(r, 'lowlands', 'allies', 'normal');
  for (let i = 0; i < 300; i++) world.step();
  const good = serializeMatch(world, setup, 'test', 'fixed');
  const before = JSON.stringify(captureWorld(world));
  const edit = (change: (file: Record<string, any>) => void): string => {
    const file = JSON.parse(good);
    change(file);
    return JSON.stringify(file);
  };
  const cases: Array<[string, string, RegExp]> = [
    ['truncated', good.slice(0, good.length / 2), /not valid JSON/],
    ['not a save', '{"hello":1}', /not a Steel Front save/],
    ['newer version', edit(f => { f.version = 99; }), /version 99/],
    ['other rules', edit(f => { f.rules = '00000000'; }), /different game data/],
    ['oversized', 'x'.repeat(MAX_SAVE_CHARS + 1), /too large/],
    ['unknown unit type', edit(f => { f.world.entities[0].type = 'zeppelin'; }), /unknown type zeppelin/],
    ['missing field', edit(f => { delete f.world.entities[0].hp; }), /entities\[0\]\.hp: missing/],
    ['wrong field type', edit(f => { f.world.players[0].credits = 'lots'; }), /credits: expected a number/],
    ['occupancy to nothing', edit(f => { f.world.nav.occupancy.push(5, 99999); }), /missing unit/],
    ['bad mask', edit(f => { f.world.players[0].fog.visible = [1, 3]; }), /wrong size/],
    ['unknown map', edit(f => { f.setup.map = 'atlantis'; }), /unknown match setup/],
    ['map mismatch', edit(f => { f.map.checksum = 'deadbeef'; }), /map does not match/],
    ['projectile pool', edit(f => { f.world.projectiles.free.pop(); }), /free list/],
  ];
  const mapForChecked = (s: MatchSetup): ReturnType<typeof presetMap> => {
    if (s.kind !== 'skirmish' || !r.maps.has(s.map)) throw new Error(`no map ${s.kind === 'skirmish' ? s.map : s.id}`);
    return presetMap(r, s.map);
  };
  for (const [name, text, reason] of cases) {
    assert.throws(() => loadMatch(text, r, mapForChecked), (error: unknown) => error instanceof SaveError && reason.test(error.message), name);
  }
  assert.equal(JSON.stringify(captureWorld(world)), before, 'the active match is untouched');
  assert.doesNotThrow(() => parseSave(good, r));
});

test('the 200-unit stress scenario saves well within the size budget', () => {
  const world = scenarioWorld('m4-stress');
  for (let i = 0; i < 200; i++) world.step();
  const text = serializeMatch(world, { kind: 'scenario', id: 'm4-stress', difficulty: 'normal' }, 'stress');
  assert.ok(text.length < MAX_SAVE_CHARS / 3, `stress save is ${text.length} characters`);
  const copy = new World(world.rules, world.map, 1);
  assert.ok(copy);
});
