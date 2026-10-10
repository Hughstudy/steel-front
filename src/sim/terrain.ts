import type { MapConfig, TerrainMap } from '../types';

export const TERRAIN_NAMES = ['Meadow', 'Woodland', 'River', 'Riverbank', 'Road', 'Rocky ground', 'Bridge', 'Farmland'];

/** Stateless integer noise; map content does not depend on generation order. */
export function tileHash(x: number, y: number, seed: number): number {
  let value = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number, scale: number, seed: number): number {
  const sx = x / scale;
  const sy = y / scale;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const fx = sx - ix;
  const fy = sy - iy;
  const tx = fx * fx * (3 - 2 * fx);
  const ty = fy * fy * (3 - 2 * fy);
  const top = tileHash(ix, iy, seed) * (1 - tx) + tileHash(ix + 1, iy, seed) * tx;
  const bottom = tileHash(ix, iy + 1, seed) * (1 - tx) + tileHash(ix + 1, iy + 1, seed) * tx;
  return top * (1 - ty) + bottom * ty;
}

export function generateTerrain(config: MapConfig): TerrainMap {
  const { width, height, seed } = config;
  const tiles = new Uint8Array(width * height);
  const variants = new Uint8Array(width * height);
  const props = new Uint8Array(width * height);
  const options = config.generation as { riverWidth: number; forestThreshold: number; forestDensity: number; rockThreshold: number };

  for (let y = 0; y < height; y++) {
    const riverX = width * 0.5 + Math.sin(y / 15) * 8 + Math.sin(y / 6.7) * 2.3;
    const approachX = 48 + Math.round(Math.sin(y / 19) * 3);
    const previousApproachX = 48 + Math.round(Math.sin(Math.max(0, y - 1) / 19) * 3);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const random = tileHash(x, y, seed);
      const forest = noise(x, y, 8, seed + 17) * 0.7 + noise(x, y, 19, seed + 29) * 0.3;
      const mountain = noise(x, y, 12, seed + 97);
      const riverDistance = Math.abs(x - riverX);
      variants[i] = (random * 256) | 0;
      if (riverDistance < options.riverWidth) tiles[i] = 2;
      else if (riverDistance < options.riverWidth + 1.1) tiles[i] = 3;
      else if (forest > options.forestThreshold) {
        tiles[i] = 1;
        if (random < options.forestDensity) props[i] = random < 0.38 ? 1 : 2;
      } else if (mountain > options.rockThreshold && y > 76) {
        tiles[i] = 5;
        if (random < 0.35) props[i] = 3;
      } else {
        tiles[i] = 0;
        if (random > 0.982) props[i] = 1;
      }

      // Patchwork farms around the two villages, bounded by hedgerows.
      const farm = (x > 29 && x < 52 && y > 44 && y < 70) || (x > 72 && x < 91 && y > 65 && y < 90);
      if (farm && tiles[i] !== 2 && tiles[i] !== 3) {
        const boundary = x % 9 === 0 || y % 9 === 0;
        tiles[i] = boundary ? 0 : 7;
        props[i] = boundary && random < 0.75 ? 7 : 0;
      }

      // A west-east supply road and a gently bending north-south approach.
      const mainRoad = y === 59 || y === 92;
      // Fill the elbow whenever this winding road shifts columns; diagonal
      // contact alone leaves visible gaps and is not a four-neighbor route.
      const approach = x >= Math.min(approachX, previousApproachX) && x <= Math.max(approachX, previousApproachX);
      const eastRoad = x === 82 && y > 25 && y < 106;
      if (mainRoad || approach || eastRoad) {
        tiles[i] = riverDistance < options.riverWidth + 1 ? 6 : 4;
        props[i] = 0;
      }
    }
  }

  // Environmental scenery only: these cottages have no owner or simulation rules.
  const cottages = [[52, 56, 4], [55, 55, 5], [57, 57, 4], [52, 63, 5], [55, 65, 4], [58, 64, 5], [54, 52, 6], [79, 56, 4], [85, 61, 5], [85, 57, 4], [79, 64, 5], [78, 91, 5], [83, 94, 4]];
  for (const [x, y, prop] of cottages) {
    const i = y * width + x;
    if (x >= width || y >= height || tiles[i] === 2 || tiles[i] === 6) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height) continue;
        const index = (y + dy) * width + x + dx;
        if (tiles[index] !== 2 && tiles[index] !== 6 && tiles[index] !== 4) {
          tiles[index] = 3;
          props[index] = 0;
        }
      }
    }
    props[i] = prop;
  }
  return { width, height, seed, tiles, variants, props };
}
