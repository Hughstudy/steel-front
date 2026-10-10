import type { TerrainMap } from '../types.ts';
import type { TerrainRules } from './rules.ts';
import { NEIGHBOR_DX, NEIGHBOR_DY } from './angles.ts';

export const STRAIGHT_COST = 10;
export const DIAGONAL_COST = 14;

/**
 * Authoritative ground walkability. Static terrain/prop blockers and building
 * footprints change the revision; moving units only touch `occupancy`.
 */
export class NavigationGrid {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  /** 1 when terrain and props permit ground movement. */
  readonly terrainPassable: Uint8Array;
  /** Building footprints currently blocking each tile (entity id, 0 = none). */
  readonly structure: Int32Array;
  /** Unit occupying or reserving each tile (entity id, 0 = none). */
  readonly occupancy: Int32Array;
  /** Connected-component label per passable tile, -1 for blocked tiles. */
  readonly component: Int32Array;
  revision = 0;
  private componentRevision = -1;
  private readonly queue: Int32Array;

  constructor(map: TerrainMap, rules: TerrainRules) {
    this.width = map.width;
    this.height = map.height;
    this.size = map.width * map.height;
    this.terrainPassable = new Uint8Array(this.size);
    this.structure = new Int32Array(this.size);
    this.occupancy = new Int32Array(this.size);
    this.component = new Int32Array(this.size);
    this.queue = new Int32Array(this.size);
    const propBlocks = new Uint8Array(256);
    for (const prop of rules.props) propBlocks[prop.index] = prop.blocks.ground ? 1 : 0;
    for (let i = 0; i < this.size; i++) {
      const terrain = rules.terrain[map.tiles[i]];
      this.terrainPassable[i] = terrain && terrain.passable.ground && !propBlocks[map.props[i]] ? 1 : 0;
    }
    this.refreshComponents();
  }

  index(x: number, y: number): number { return y * this.width + x; }
  inBounds(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.width && y < this.height; }
  passable(tile: number): boolean { return this.terrainPassable[tile] === 1 && this.structure[tile] === 0; }

  /** Static step legality: destination open and no diagonal corner cutting. */
  canStep(from: number, to: number): boolean {
    if (!this.passable(to)) return false;
    const fx = from % this.width;
    const fy = (from / this.width) | 0;
    const tx = to % this.width;
    const ty = (to / this.width) | 0;
    const dx = tx - fx;
    const dy = ty - fy;
    if (dx < -1 || dx > 1 || dy < -1 || dy > 1 || (dx === 0 && dy === 0)) return false;
    if (dx !== 0 && dy !== 0) return this.passable(from + dx) && this.passable(from + dy * this.width);
    return true;
  }

  isAdjacent(a: number, b: number): boolean {
    const dx = (b % this.width) - (a % this.width);
    const dy = ((b / this.width) | 0) - ((a / this.width) | 0);
    return dx >= -1 && dx <= 1 && dy >= -1 && dy <= 1 && (dx !== 0 || dy !== 0);
  }

  setStructure(tiles: readonly number[], id: number): void {
    for (const tile of tiles) this.structure[tile] = id;
    this.revision++;
  }

  componentOf(tile: number): number {
    if (this.componentRevision !== this.revision) this.refreshComponents();
    return this.component[tile];
  }

  /** Eight-neighbour flood fill honouring the corner rule (which is symmetric). */
  refreshComponents(): void {
    this.component.fill(-1);
    let label = 0;
    for (let start = 0; start < this.size; start++) {
      if (this.component[start] !== -1 || !this.passable(start)) continue;
      let head = 0;
      let tail = 0;
      this.queue[tail++] = start;
      this.component[start] = label;
      while (head < tail) {
        const tile = this.queue[head++];
        const x = tile % this.width;
        const y = (tile / this.width) | 0;
        for (let n = 0; n < 8; n++) {
          const nx = x + NEIGHBOR_DX[n];
          const ny = y + NEIGHBOR_DY[n];
          if (!this.inBounds(nx, ny)) continue;
          const next = ny * this.width + nx;
          if (this.component[next] !== -1 || !this.canStep(tile, next)) continue;
          this.component[next] = label;
          this.queue[tail++] = next;
        }
      }
      label++;
    }
    this.componentRevision = this.revision;
  }

  /** Nearest passable tile (by BFS ring order) in a component, for clicks on water/blocked tiles. */
  nearestInComponent(tile: number, component: number, maxRadius = 24): number {
    if (this.componentOf(tile) === component) return tile;
    const cx = tile % this.width;
    const cy = (tile / this.width) | 0;
    for (let radius = 1; radius <= maxRadius; radius++) {
      let best = -1;
      let bestDistance = Infinity;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (!this.inBounds(x, y)) continue;
          const candidate = y * this.width + x;
          if (this.component[candidate] !== component) continue;
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance) { bestDistance = distance; best = candidate; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
}
