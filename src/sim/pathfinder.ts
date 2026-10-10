import { NEIGHBOR_DX, NEIGHBOR_DY } from './angles.ts';
import { DIAGONAL_COST, NavigationGrid, STRAIGHT_COST } from './navigation-grid.ts';

const UNREACHED = 0x3fffffff;

/** Binary min-heap keyed by (f, h, tile) for fully deterministic ordering. */
class NodeHeap {
  readonly tiles: Int32Array;
  readonly f: Int32Array;
  readonly h: Int32Array;
  length = 0;

  constructor(capacity: number) {
    this.tiles = new Int32Array(capacity);
    this.f = new Int32Array(capacity);
    this.h = new Int32Array(capacity);
  }

  private less(a: number, b: number): boolean {
    if (this.f[a] !== this.f[b]) return this.f[a] < this.f[b];
    if (this.h[a] !== this.h[b]) return this.h[a] < this.h[b];
    return this.tiles[a] < this.tiles[b];
  }

  private swap(a: number, b: number): void {
    const t = this.tiles[a]; this.tiles[a] = this.tiles[b]; this.tiles[b] = t;
    const f = this.f[a]; this.f[a] = this.f[b]; this.f[b] = f;
    const h = this.h[a]; this.h[a] = this.h[b]; this.h[b] = h;
  }

  push(tile: number, f: number, h: number): void {
    if (this.length >= this.tiles.length) return; // capacity equals map size × 8; unreachable in practice
    let i = this.length++;
    this.tiles[i] = tile; this.f[i] = f; this.h[i] = h;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.tiles[0];
    this.length--;
    if (this.length > 0) {
      this.tiles[0] = this.tiles[this.length]; this.f[0] = this.f[this.length]; this.h[0] = this.h[this.length];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.length && this.less(l, m)) m = l;
        if (r < this.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

export interface PathOptions {
  /** Optional distance field toward a nearby target; used as an admissible heuristic bound. */
  field?: Int32Array | null;
  /** Extra transient blockers (e.g. stationary units) — never the start or goal. */
  blocked?: ((tile: number) => boolean) | null;
}

export interface PathResult { path: number[] | null; expanded: number }

/** Reusable A-star and Dijkstra over the navigation grid; no allocation per expansion. */
export class Pathfinder {
  private readonly grid: NavigationGrid;
  private readonly g: Int32Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly heap: NodeHeap;
  private stamp = 0;

  constructor(grid: NavigationGrid) {
    this.grid = grid;
    this.g = new Int32Array(grid.size);
    this.parent = new Int32Array(grid.size);
    this.seen = new Uint32Array(grid.size);
    this.closed = new Uint32Array(grid.size);
    this.heap = new NodeHeap(grid.size * 8);
  }

  static octile(grid: NavigationGrid, a: number, b: number): number {
    const dx = Math.abs((a % grid.width) - (b % grid.width));
    const dy = Math.abs(((a / grid.width) | 0) - ((b / grid.width) | 0));
    return STRAIGHT_COST * Math.max(dx, dy) + (DIAGONAL_COST - STRAIGHT_COST) * Math.min(dx, dy);
  }

  private nextStamp(): number {
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) { this.seen.fill(0); this.closed.fill(0); this.stamp = 1; }
    return this.stamp;
  }

  /** Returns tiles after `start` up to and including `goal`, or null if unreachable. */
  findPath(start: number, goal: number, options: PathOptions = {}): PathResult {
    const grid = this.grid;
    if (start === goal) return { path: [], expanded: 0 };
    if (!grid.passable(goal) || grid.componentOf(start) !== grid.componentOf(goal) || grid.componentOf(start) < 0) {
      return { path: null, expanded: 0 };
    }
    const field = options.field ?? null;
    const blocked = options.blocked ?? null;
    const stamp = this.nextStamp();
    const heap = this.heap;
    heap.length = 0;
    const goalField = field ? field[goal] : 0;
    const heuristic = (tile: number): number => {
      const octile = Pathfinder.octile(grid, tile, goal);
      if (!field || field[tile] >= UNREACHED) return octile;
      const bound = field[tile] - goalField;
      return bound > octile ? bound : octile;
    };
    this.g[start] = 0;
    this.parent[start] = -1;
    this.seen[start] = stamp;
    const h0 = heuristic(start);
    heap.push(start, h0, h0);
    let expanded = 0;
    while (heap.length > 0) {
      const tile = heap.pop();
      if (this.closed[tile] === stamp) continue;
      this.closed[tile] = stamp;
      expanded++;
      if (tile === goal) return { path: this.reconstruct(goal), expanded };
      const x = tile % grid.width;
      const y = (tile / grid.width) | 0;
      const base = this.g[tile];
      for (let n = 0; n < 8; n++) {
        const nx = x + NEIGHBOR_DX[n];
        const ny = y + NEIGHBOR_DY[n];
        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
        const next = ny * grid.width + nx;
        if (this.closed[next] === stamp || !grid.canStep(tile, next)) continue;
        if (blocked && next !== goal && blocked(next)) continue;
        const cost = base + (n < 4 ? STRAIGHT_COST : DIAGONAL_COST);
        if (this.seen[next] === stamp && this.g[next] <= cost) continue;
        this.seen[next] = stamp;
        this.g[next] = cost;
        this.parent[next] = tile;
        const h = heuristic(next);
        heap.push(next, cost + h, h);
      }
    }
    return { path: null, expanded };
  }

  private reconstruct(goal: number): number[] {
    const path: number[] = [];
    for (let tile = goal; this.parent[tile] !== -1; tile = this.parent[tile]) path.push(tile);
    path.reverse();
    return path;
  }

  /** Full Dijkstra distance field from `target` (symmetric costs, so usable as distance-to-target). */
  distanceField(target: number, out: Int32Array): number {
    const grid = this.grid;
    out.fill(UNREACHED);
    if (!grid.passable(target)) return 0;
    const stamp = this.nextStamp();
    const heap = this.heap;
    heap.length = 0;
    out[target] = 0;
    heap.push(target, 0, 0);
    let expanded = 0;
    while (heap.length > 0) {
      const tile = heap.pop();
      if (this.closed[tile] === stamp) continue;
      this.closed[tile] = stamp;
      expanded++;
      const x = tile % grid.width;
      const y = (tile / grid.width) | 0;
      const base = out[tile];
      for (let n = 0; n < 8; n++) {
        const nx = x + NEIGHBOR_DX[n];
        const ny = y + NEIGHBOR_DY[n];
        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
        const next = ny * grid.width + nx;
        if (this.closed[next] === stamp || !grid.canStep(tile, next)) continue;
        const cost = base + (n < 4 ? STRAIGHT_COST : DIAGONAL_COST);
        if (cost >= out[next]) continue;
        out[next] = cost;
        heap.push(next, cost, 0);
      }
    }
    return expanded;
  }
}

export { UNREACHED };
