import type { Entity } from './entities.ts';
import type { BuildingDef } from './rules.ts';
import type { World } from './world.ts';

/** Footprint tiles of a building whose origin (north corner) is `origin`. */
export function footprintTiles(world: World, def: BuildingDef, origin: number): number[] {
  const w = world.nav.width;
  const ox = origin % w;
  const oy = (origin / w) | 0;
  const tiles: number[] = [];
  for (let dy = 0; dy < def.footprint.h; dy++) for (let dx = 0; dx < def.footprint.w; dx++) tiles.push((oy + dy) * w + ox + dx);
  return tiles;
}

/** Passable tiles touching a footprint (8-neighbour ring), in stable row-major order. */
export function ringTiles(world: World, def: BuildingDef, origin: number): number[] {
  const nav = world.nav;
  const ox = origin % nav.width;
  const oy = (origin / nav.width) | 0;
  const result: number[] = [];
  for (let y = oy - 1; y <= oy + def.footprint.h; y++) {
    for (let x = ox - 1; x <= ox + def.footprint.w; x++) {
      const inside = x >= ox && x < ox + def.footprint.w && y >= oy && y < oy + def.footprint.h;
      if (inside || !nav.inBounds(x, y)) continue;
      const tile = y * nav.width + x;
      if (nav.passable(tile)) result.push(tile);
    }
  }
  return result;
}

/** True when `tile` touches the building footprint (including diagonals). */
export function touches(world: World, building: Entity, tile: number): boolean {
  const def = world.rules.buildings.get(building.type);
  if (!def) return false;
  const w = world.nav.width;
  const x = tile % w;
  const y = (tile / w) | 0;
  const ox = building.tile % w;
  const oy = (building.tile / w) | 0;
  return x >= ox - 1 && x <= ox + def.footprint.w && y >= oy - 1 && y <= oy + def.footprint.h
    && !(x >= ox && x < ox + def.footprint.w && y >= oy && y < oy + def.footprint.h);
}

export type PlacementProblem = '' | 'bounds' | 'terrain' | 'structure' | 'occupied' | 'access';

/**
 * Static placement rules shared by scenario setup, the placement ghost and the
 * final construction command: in bounds, buildable terrain without props or
 * structures, no units on the footprint, and at least one reachable approach.
 */
export function placementProblem(world: World, def: BuildingDef, origin: number, ignoreUnits = false): PlacementProblem {
  const nav = world.nav;
  const ox = origin % nav.width;
  const oy = (origin / nav.width) | 0;
  if (ox < 1 || oy < 1 || ox + def.footprint.w > nav.width - 1 || oy + def.footprint.h > nav.height - 1) return 'bounds';
  for (const tile of footprintTiles(world, def, origin)) {
    if (!world.buildable[tile]) return 'terrain';
    if (nav.structure[tile] !== 0) return 'structure';
    if (!ignoreUnits && nav.occupancy[tile] !== 0) return 'occupied';
  }
  const main = world.mainComponent();
  if (!ringTiles(world, def, origin).some(tile => nav.componentOf(tile) === main)) return 'access';
  if (wouldSplit(world, def, origin)) return 'access';
  return '';
}

/**
 * True when placing the footprint would cut a meaningful part of the main
 * ground region off (e.g. sealing a forest road). Tolerates tiny pockets.
 */
export function wouldSplit(world: World, def: BuildingDef, origin: number): boolean {
  const nav = world.nav;
  const main = world.mainComponent();
  let before = 0;
  for (let i = 0; i < nav.size; i++) if (nav.componentOf(i) === main) before++;
  const tiles = footprintTiles(world, def, origin);
  const saved = tiles.map(tile => nav.structure[tile]);
  for (const tile of tiles) nav.structure[tile] = -1;
  nav.revision++;
  let largest = 0;
  const sizes = new Map<number, number>();
  for (let i = 0; i < nav.size; i++) {
    const c = nav.componentOf(i);
    if (c < 0) continue;
    const n = (sizes.get(c) ?? 0) + 1;
    sizes.set(c, n);
    if (n > largest) largest = n;
  }
  tiles.forEach((tile, index) => { nav.structure[tile] = saved[index]; });
  nav.revision--;
  nav.refreshComponents();
  return before - largest > tiles.length + 6;
}

/** Deterministic spiral search for the nearest valid origin to (x, y). */
export function findPlacement(world: World, def: BuildingDef, x: number, y: number, maxRadius = 24): number {
  const nav = world.nav;
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const ox = x + dx;
        const oy = y + dy;
        if (!nav.inBounds(ox, oy)) continue;
        if (placementProblem(world, def, oy * nav.width + ox) === '') return oy * nav.width + ox;
      }
    }
  }
  return -1;
}
