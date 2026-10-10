import type { Entity } from './entities.ts';
import type { World } from './world.ts';

const SHIFT = 3; // 8×8-tile cells

/**
 * Uniform-grid spatial index of live entities, rebuilt once per tick with
 * reusable typed arrays. Cell lists keep insertion (id) order reversed; callers
 * that pick a "best" entity break ties by id, so results are deterministic.
 */
export class SpatialGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly head: Int32Array;
  private next = new Int32Array(1024);
  private items: Entity[] = [];
  private count = 0;

  constructor(width: number, height: number) {
    this.cols = (width >> SHIFT) + 1;
    this.rows = (height >> SHIFT) + 1;
    this.head = new Int32Array(this.cols * this.rows);
  }

  rebuild(world: World): void {
    this.head.fill(-1);
    const s = world.subTile;
    if (this.next.length < world.entities.length) this.next = new Int32Array(world.entities.length * 2);
    this.count = 0;
    for (const entity of world.entities) {
      if (entity.hp <= 0) continue;
      const cell = this.cellOf(Math.floor(entity.x / s), Math.floor(entity.y / s));
      const index = this.count++;
      this.items[index] = entity;
      this.next[index] = this.head[cell];
      this.head[cell] = index;
    }
    for (let i = this.count; i < this.items.length; i++) this.items[i] = undefined as unknown as Entity;
  }

  private cellOf(tx: number, ty: number): number {
    const cx = Math.max(0, Math.min(this.cols - 1, tx >> SHIFT));
    const cy = Math.max(0, Math.min(this.rows - 1, ty >> SHIFT));
    return cy * this.cols + cx;
  }

  /** Visit entities whose centre lies within `radius` (fixed-point) of (x, y). */
  query(world: World, x: number, y: number, radius: number, visit: (entity: Entity, distanceSquared: number) => void): void {
    const s = world.subTile;
    const x0 = Math.floor((x - radius) / s) >> SHIFT;
    const x1 = Math.floor((x + radius) / s) >> SHIFT;
    const y0 = Math.floor((y - radius) / s) >> SHIFT;
    const y1 = Math.floor((y + radius) / s) >> SHIFT;
    const r2 = radius * radius;
    for (let cy = Math.max(0, y0); cy <= Math.min(this.rows - 1, y1); cy++) {
      for (let cx = Math.max(0, x0); cx <= Math.min(this.cols - 1, x1); cx++) {
        for (let i = this.head[cy * this.cols + cx]; i >= 0; i = this.next[i]) {
          const entity = this.items[i];
          const dx = entity.x - x;
          const dy = entity.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) visit(entity, d2);
        }
      }
    }
  }
}
