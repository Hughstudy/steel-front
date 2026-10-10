import assert from 'node:assert/strict';
import test from 'node:test';
import { World } from '../src/sim/world.ts';
import { updateFog } from '../src/sim/fog.ts';
import { constructionProblem } from '../src/sim/production.ts';
import { drawFootprint, Placement, previewProblem } from '../src/ui/placement.ts';
import { createAiState } from '../src/sim/ai.ts';
import { lowlands, rules, scenarioWorld, skirmishWorld } from './helpers.ts';

const run = (world: World, ticks: number): void => { for (let i = 0; i < ticks; i++) world.step(); };
const order = (world: World, kind: string, extra: Record<string, unknown> = {}): void => {
  world.enqueue({ player: 0, kind, ids: [], x: 0, y: 0, ...extra } as Parameters<World['enqueue']>[0]);
};

test('artillery with an enemy inside its minimum range still fights (idle, attack, attack-move)', () => {
  for (const command of ['idle', 'attack', 'amove']) {
    const world = new World(rules(), lowlands(), 11);
    world.addPlayer('allies', 0);
    world.addPlayer('axis', 0);
    world.fogEnabled = false;
    const gun = world.spawnUnit('allied_artillery', 0, world.nav.index(30, 60));
    const near = world.spawnUnit('axis_truck', 1, world.nav.index(32, 60));
    const far = world.spawnUnit('axis_medium_tank', 1, world.nav.index(42, 60));
    far.cooldowns = [1e9, 1e9];
    if (command !== 'idle') order(world, command, { ids: [gun.id], target: near.id, x: 46, y: 60 });
    let shots = 0;
    for (let i = 0; i < 1600; i++) {
      world.step();
      shots += world.events.filter(e => e.kind === 'fire' && e.id === gun.id).length;
    }
    assert.ok(shots > 0, `${command}: the gun fires`);
    if (command === 'attack') assert.ok(near.hp <= 0, 'explicit attack backs off and destroys the close target');
    else assert.ok(far.hp <= 0, `${command}: the target outside the dead zone is destroyed`);
  }
});

function emptyWorld(): World {
  const width = 128;
  const height = 128;
  const size = width * height;
  const map = { width, height, seed: 1, tiles: new Uint8Array(size), variants: new Uint8Array(size), props: new Uint8Array(size) };
  const world = new World(rules(), map, 1);
  world.addPlayer('allies', 0);
  world.fogEnabled = false;
  return world;
}

test('capture and harvest orders replace an earlier move promptly', () => {
  for (const type of ['allied_engineer', 'allied_truck']) {
    const world = emptyWorld();
    const unit = world.spawnUnit(type, 0, world.nav.index(20, 20));
    const engineer = type === 'allied_engineer';
    const target = world.spawnBuilding(engineer ? 'oil_derrick' : 'supply_dump', -1, world.nav.index(10, 20));
    const stock = target.stock;
    order(world, 'move', { ids: [unit.id], x: 110, y: 20 });
    run(world, 40);
    const far = world.nav.index(110, 20);
    assert.equal(unit.goal, far);
    order(world, engineer ? 'capture' : 'harvest', { ids: [unit.id], x: 10, y: 20, target: target.id });
    run(world, 400);
    assert.notEqual(unit.goal, far, `${type} dropped the old destination`);
    if (engineer) assert.equal(target.owner, 0, 'derrick captured');
    else assert.ok(target.stock < stock, 'truck loaded from the dump');
  }
});

test('placing a building moves friendly units off the site but never commands hostile ones', () => {
  for (const owner of [0, 1]) {
    const world = scenarioWorld('m3-outpost');
    world.addPlayer('axis', 5000);
    const mcv = world.entities.find(e => e.type === 'allied_mcv')!;
    const home = mcv.tile;
    order(world, 'deploy', { ids: [mcv.id] });
    world.step();
    order(world, 'build', { type: 'allied_power' });
    run(world, 301);
    const def = world.rules.buildings.get('allied_power')!;
    let site = -1;
    const w = world.nav.width;
    for (let dy = -10; dy <= 10 && site < 0; dy++) {
      for (let dx = -10; dx <= 10 && site < 0; dx++) {
        const tile = home + dy * w + dx;
        if (constructionProblem(world, 0, def, tile) === '') site = tile;
      }
    }
    assert.ok(site >= 0);
    const truck = world.spawnUnit(owner === 0 ? 'allied_truck' : 'axis_truck', owner, site);
    const orderId = truck.orderId;
    order(world, 'place', { x: site % world.nav.width, y: Math.floor(site / world.nav.width), type: 'allied_power' });
    run(world, 121);
    const built = world.entities.some(e => e.type === 'allied_power');
    if (owner === 0) {
      assert.ok(built, 'a friendly truck makes way and the generator is built');
      assert.notEqual(truck.tile, site);
    } else {
      assert.equal(truck.orderId, orderId, 'the hostile truck received no order');
      assert.equal(truck.tile, site);
      assert.ok(!built, 'placement waits on the hostile occupant');
    }
  }
});

test('the AI still expands to oil after relocating its MCV to deploy', () => {
  const r = rules();
  const base = r.scenarios.get('m5-skirmish')!;
  const world = new World(r, lowlands(), 7);
  world.loadScenario({ ...base, players: base.players.map((p, i) => i === 1 ? { ...p, anchor: { x: 96, y: 64 } } : p) });
  const player = world.players[1];
  run(world, 12000);
  assert.ok(world.nav.componentOf(player.start) >= 0, 'the original start tile stays walkable (relocated deployment)');
  assert.ok(world.entities.some(e => e.type === 'oil_derrick' && e.owner === 1), 'a derrick was captured');
  assert.ok(player.ledger.oil > 0, 'oil income');
});

test('placement previews never reveal hidden structures', () => {
  const world = new World(rules(), lowlands(), 11);
  world.addPlayer('allies', 5000);
  world.addPlayer('axis', 5000);
  const hq = world.placeBuildingNear(world.rules.buildings.get('allied_hq')!, 0, 25, 60)!;
  const enemy = world.placeBuildingNear(world.rules.buildings.get('axis_power')!, 1, 95, 60)!;
  updateFog(world, true);
  const def = world.rules.buildings.get('allied_power')!;
  const w = world.nav.width;
  const pointer: [number, number] = [enemy.tile % w + 1, Math.floor(enemy.tile / w) + 1];
  const fills: string[] = [];
  const context = { beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    fill() { fills.push(this.fillStyle); }, fillStyle: '', strokeStyle: '', lineWidth: 1 } as unknown as CanvasRenderingContext2D;
  const placement = new Placement();
  placement.start('place', 'allied_power');
  const sample = (): string => {
    placement.update(world, 0, ...pointer);
    fills.length = 0;
    drawFootprint(context, world, def, placement.origin, 'bad', 0);
    return JSON.stringify({ problem: placement.problem, fills });
  };
  const before = sample();
  world.remove(enemy.id);
  world.step();
  assert.equal(sample(), before, 'distant hidden structure: identical preview whether or not it exists');

  // In range but unexplored ground is refused without consulting live collisions.
  const ox = hq.tile % w + 4;
  const oy = Math.floor(hq.tile / w);
  const origin = oy * w + ox;
  const fog = world.players[0].fog;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { fog.visible[origin + dy * w + dx] = 0; fog.explored[origin + dy * w + dx] = 0; }
  assert.notEqual(constructionProblem(world, 0, def, origin), 'range', 'fixture site is within construction range');
  assert.equal(previewProblem(world, 0, def, origin), 'unexplored');
});

test('difficulty is ordered: a Veteran computer beats a Recruit from either spawn', () => {
  const r = rules();
  for (const side of [0, 1]) {
    const world = skirmishWorld(r, 'lowlands', 'allies', 'hard', 7);
    world.players[side].ai = createAiState('hard', r.ai.difficulties.get('hard')!.firstWaveTick);
    world.players[1 - side].ai = createAiState('easy', r.ai.difficulties.get('easy')!.firstWaveTick);
    for (let i = 0; i < 45 * 1200 && !world.outcome; i++) world.step();
    assert.equal(world.outcome?.winner, side, `Veteran on side ${side}`);
    const [vet, rec] = [world.players[side].ledger, world.players[1 - side].ledger];
    assert.ok(vet.delivered + vet.oil > rec.delivered + rec.oil, 'Veteran out-earns Recruit');
  }
});
