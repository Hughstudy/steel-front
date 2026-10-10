import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { generateTerrain, TERRAIN_NAMES } from '../src/sim/terrain.ts';

const config = JSON.parse(readFileSync(new URL('../data/map.json', import.meta.url), 'utf8'));

test('the configured battlefield is a complete 128 by 128 map with valid terrain and scenery', () => {
  const map = generateTerrain(config);
  assert.equal(map.width, 128);
  assert.equal(map.height, 128);
  assert.equal(map.tiles.length, 128 * 128);
  assert.equal(map.variants.length, map.tiles.length);
  assert.equal(map.props.length, map.tiles.length);
  for (const tile of map.tiles) assert.ok(tile >= 0 && tile < TERRAIN_NAMES.length);
  for (const prop of map.props) assert.ok(prop >= 0 && prop <= 7);
  // A complete battlefield needs varied ground, a river, and usable crossings.
  assert.equal(new Set(map.tiles).size, TERRAIN_NAMES.length);
  assert.ok(map.tiles.includes(TERRAIN_NAMES.indexOf('River')));
  assert.ok(map.tiles.includes(TERRAIN_NAMES.indexOf('Bridge')));
});

test('a seed exactly reproduces the map, while changing it varies terrain and scenery', () => {
  const first = generateTerrain(config);
  const repeat = generateTerrain(config);
  assert.deepEqual(first, repeat);
  const changed = generateTerrain({ ...config, seed: config.seed + 1 });
  assert.notDeepEqual(first.tiles, changed.tiles);
  assert.notDeepEqual(first.variants, changed.variants);
  assert.notDeepEqual(first.props, changed.props);
  assert.notEqual(first.tiles, repeat.tiles);
});

test('roads and bridges form one continuous network through every bend and crossing', () => {
  const map = generateTerrain(config);
  const isRoad = (index: number): boolean => map.tiles[index] === 4 || map.tiles[index] === 6;
  const firstRoad = map.tiles.findIndex((_, index) => isRoad(index));
  assert.ok(firstRoad >= 0, 'the battlefield needs a road network');
  const visited = new Set<number>([firstRoad]);
  const queue = [firstRoad];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor];
    const x = index % map.width;
    const y = Math.floor(index / map.width);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const neighbor = ny * map.width + nx;
      if (isRoad(neighbor) && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  for (let index = 0; index < map.tiles.length; index++) {
    if (isRoad(index)) assert.ok(visited.has(index), `isolated road at ${index % map.width},${Math.floor(index / map.width)}`);
  }
});
