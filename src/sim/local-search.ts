import { NEIGHBOR_DX, NEIGHBOR_DY } from './angles.ts';
import type { Entity } from './entities.ts';
import type { NavigationGrid } from './navigation-grid.ts';
import type { World } from './world.ts';

/** Bounded breadth-first searches with reusable scratch buffers. */
export class LocalSearch {
  private readonly queue: Int32Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(size: number) {
    this.queue = new Int32Array(size);
    this.parent = new Int32Array(size);
    this.seen = new Uint32Array(size);
  }

  private begin(): number {
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) { this.seen.fill(0); this.stamp = 1; }
    return this.stamp;
  }

  /** Route from `start` to the nearest free tile outside `avoid`, passing only free or stationary-unit tiles. */
  yieldRoute(world: World, start: number, requester: Entity, avoid: readonly number[], maxNodes: number): number[] | null {
    const nav = world.nav;
    const stamp = this.begin();
    let head = 0;
    let tail = 0;
    this.queue[tail++] = start;
    this.seen[start] = stamp;
    this.parent[start] = -1;
    while (head < tail && head < maxNodes) {
      const tile = this.queue[head++];
      if (tile !== start && nav.occupancy[tile] === 0 && !avoid.includes(tile)) return this.trace(tile);
      const x = tile % nav.width;
      const y = (tile / nav.width) | 0;
      for (let n = 0; n < 8; n++) {
        const nx = x + NEIGHBOR_DX[n];
        const ny = y + NEIGHBOR_DY[n];
        if (!nav.inBounds(nx, ny)) continue;
        const next = ny * nav.width + nx;
        if (this.seen[next] === stamp || next === requester.tile || !nav.canStep(tile, next)) continue;
        const occupant = nav.occupancy[next];
        if (occupant !== 0) {
          const other = world.get(occupant);
          if (!other || other.next >= 0 || other.id === requester.id || other.kind !== 'unit') continue;
        }
        this.seen[next] = stamp;
        this.parent[next] = tile;
        this.queue[tail++] = next;
      }
    }
    return null;
  }

  /** Nearest unoccupied passable tile to `origin` within the component of `reference`. */
  nearestFree(world: World, origin: number, reference: number, maxNodes: number, accept?: (tile: number) => boolean): number {
    const nav: NavigationGrid = world.nav;
    const component = nav.componentOf(reference);
    const startTile = nav.nearestInComponent(origin, component);
    if (startTile < 0) return -1;
    const stamp = this.begin();
    let head = 0;
    let tail = 0;
    this.queue[tail++] = startTile;
    this.seen[startTile] = stamp;
    while (head < tail && head < maxNodes) {
      const tile = this.queue[head++];
      if (nav.occupancy[tile] === 0 && (!accept || accept(tile))) return tile;
      const x = tile % nav.width;
      const y = (tile / nav.width) | 0;
      for (let n = 0; n < 8; n++) {
        const nx = x + NEIGHBOR_DX[n];
        const ny = y + NEIGHBOR_DY[n];
        if (!nav.inBounds(nx, ny)) continue;
        const next = ny * nav.width + nx;
        if (this.seen[next] === stamp || !nav.canStep(tile, next)) continue;
        this.seen[next] = stamp;
        this.queue[tail++] = next;
      }
    }
    return -1;
  }

  /** Collect up to `count` distinct passable tiles in BFS order from `origin` (same component). */
  collect(world: World, origin: number, count: number, maxNodes: number, accept: (tile: number) => boolean): number[] {
    const nav = world.nav;
    const result: number[] = [];
    const stamp = this.begin();
    let head = 0;
    let tail = 0;
    this.queue[tail++] = origin;
    this.seen[origin] = stamp;
    while (head < tail && head < maxNodes && result.length < count) {
      const tile = this.queue[head++];
      if (accept(tile)) result.push(tile);
      const x = tile % nav.width;
      const y = (tile / nav.width) | 0;
      for (let n = 0; n < 8; n++) {
        const nx = x + NEIGHBOR_DX[n];
        const ny = y + NEIGHBOR_DY[n];
        if (!nav.inBounds(nx, ny)) continue;
        const next = ny * nav.width + nx;
        if (this.seen[next] === stamp || !nav.canStep(tile, next)) continue;
        this.seen[next] = stamp;
        this.queue[tail++] = next;
      }
    }
    return result;
  }

  private trace(tile: number): number[] {
    const path: number[] = [];
    for (let t = tile; this.parent[t] !== -1; t = this.parent[t]) path.push(t);
    path.reverse();
    return path;
  }
}
