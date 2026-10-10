import assert from 'node:assert/strict';
import test from 'node:test';
import { NEIGHBOR_DX, NEIGHBOR_DY } from '../src/sim/angles.ts';
import { NavigationGrid } from '../src/sim/navigation-grid.ts';
import { Pathfinder } from '../src/sim/pathfinder.ts';
import { loadRules, RulesError } from '../src/sim/rules.ts';
import { lowlands, rawRules, rules } from './helpers.ts';

const r = rules();
const map = lowlands();
const grid = new NavigationGrid(map, r.terrain);
const finder = new Pathfinder(grid);
const main = grid.componentOf(59 * map.width + 40);
/** Nearest tile in the main ground region, so fixtures do not depend on exact tree placement. */
const tile = (x: number, y: number): number => grid.nearestInComponent(y * map.width + x, main);
const riverTile = (y: number): number => {
  for (let x = 0; x < map.width; x++) if (map.tiles[y * map.width + x] === 2) return y * map.width + x;
  throw new Error('no river on row');
};

test('water blocks ground units, bridges and roads permit them, trees and cottages block', () => {
  for (let i = 0; i < grid.size; i++) {
    if (map.tiles[i] === 2) assert.equal(grid.passable(i), false, 'river tile passable');
    if (map.tiles[i] === 6) assert.equal(grid.passable(i), true, 'bridge tile blocked');
    if (map.props[i] >= 1 && map.props[i] <= 6) assert.equal(grid.passable(i), false, 'blocking prop passable');
  }
});

test('both bridges join the west and east banks in one connected ground region', () => {
  const west = grid.componentOf(tile(40, 59));
  assert.ok(west >= 0);
  assert.equal(grid.componentOf(tile(90, 59)), west);
  assert.equal(grid.componentOf(tile(57, 59)), west, 'north bridge');
  assert.equal(grid.componentOf(tile(65, 92)), west, 'south bridge');
});

test('routes never enter blocked tiles or cut blocked diagonal corners', () => {
  const pairs = [[tile(38, 60), tile(95, 60)], [tile(38, 92), tile(95, 92)], [tile(20, 20), tile(110, 110)], [tile(90, 30), tile(30, 100)]];
  for (const [start, goal] of pairs) {
    const { path } = finder.findPath(start, goal);
    assert.ok(path && path.length > 0, 'expected a route');
    let previous = start;
    for (const step of path) {
      assert.ok(grid.passable(step));
      assert.ok(grid.canStep(previous, step), 'illegal step or corner cut');
      const dx = (step % map.width) - (previous % map.width);
      const dy = ((step / map.width) | 0) - ((previous / map.width) | 0);
      if (dx && dy) {
        assert.ok(grid.passable(previous + dx) && grid.passable(previous + dy * map.width), 'diagonal corner cut');
      }
      previous = step;
    }
    assert.equal(previous, goal);
  }
});

test('A* with the distance-field heuristic returns optimal cost equal to Dijkstra', () => {
  const field = new Int32Array(grid.size);
  const target = tile(95, 60);
  finder.distanceField(target, field);
  for (const [sx, sy] of [[38, 60], [20, 100], [70, 10]]) {
    const start = tile(sx, sy);
    for (const options of [{}, { field }]) {
      const { path } = finder.findPath(start, target, options);
      assert.ok(path);
      let cost = 0;
      let previous = start;
      for (const step of path) {
        cost += Math.abs(step - previous) === 1 || Math.abs(step - previous) === map.width ? 10 : 14;
        previous = step;
      }
      assert.equal(cost, field[start]);
    }
  }
});

test('water, isolated pockets and out-of-component goals are unreachable without endless search', () => {
  const start = tile(38, 60);
  assert.equal(finder.findPath(start, riverTile(70)).path, null, 'river tile');
  let pocket = -1;
  for (let i = 0; i < grid.size && pocket < 0; i++) {
    if (grid.passable(i) && grid.componentOf(i) !== grid.componentOf(start)) pocket = i;
  }
  assert.ok(pocket >= 0, 'map has at least one isolated pocket to test');
  const result = finder.findPath(start, pocket);
  assert.equal(result.path, null);
  assert.equal(result.expanded, 0, 'component check rejects before searching');
});

test('neighbour ordering lists cardinals before diagonals for deterministic tie breaks', () => {
  for (let n = 0; n < 4; n++) assert.equal(Math.abs(NEIGHBOR_DX[n]) + Math.abs(NEIGHBOR_DY[n]), 1);
  for (let n = 4; n < 8; n++) assert.equal(Math.abs(NEIGHBOR_DX[n]) + Math.abs(NEIGHBOR_DY[n]), 2);
});

test('rule validation reports readable errors for bad references and values', () => {
  const raw = rawRules() as Record<string, unknown>;
  const units = structuredClone(raw.units) as Array<Record<string, unknown>>;
  units[0].speed = -1;
  units[1].faction = 'martians';
  units.push({ ...units[2] });
  assert.throws(() => loadRules({ ...raw, units } as never), (error: unknown) => {
    assert.ok(error instanceof RulesError);
    const text = error.problems.join('\n');
    assert.match(text, /speed/);
    assert.match(text, /unknown faction martians/);
    assert.match(text, /duplicate unit id/);
    return true;
  });
});
