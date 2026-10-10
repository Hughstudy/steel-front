/**
 * Authoritative projectile pool (struct of arrays, fixed capacity from data).
 * Slots are taken lowest-index-first from a deterministic free stack; a shot is
 * only fired after a slot is reserved, so a full pool delays fire rather than
 * dropping damage, independent of frame rate.
 */
export class ProjectilePool {
  readonly capacity: number;
  readonly active: Uint8Array;
  readonly x: Int32Array;
  readonly y: Int32Array;
  readonly prevX: Int32Array;
  readonly prevY: Int32Array;
  /** Aim point (fixed-point); homing shots refresh it from the live target. */
  readonly tx: Int32Array;
  readonly ty: Int32Array;
  /** Target entity id, or -1 for a ground-point (artillery) shot. */
  readonly target: Int32Array;
  readonly shooter: Int32Array;
  readonly owner: Int32Array;
  /** Index into `World.weaponList`. */
  readonly weapon: Int32Array;
  /** Shooter rank when fired (veterancy damage bonus is fixed at launch). */
  readonly rank: Uint8Array;
  /** Launch distance and travel progress, for the presentation arc of artillery. */
  readonly total: Int32Array;
  readonly travelled: Int32Array;
  private readonly free: Int32Array;
  private freeCount: number;
  count = 0;
  peak = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.active = new Uint8Array(capacity);
    this.x = new Int32Array(capacity);
    this.y = new Int32Array(capacity);
    this.prevX = new Int32Array(capacity);
    this.prevY = new Int32Array(capacity);
    this.tx = new Int32Array(capacity);
    this.ty = new Int32Array(capacity);
    this.target = new Int32Array(capacity);
    this.shooter = new Int32Array(capacity);
    this.owner = new Int32Array(capacity);
    this.weapon = new Int32Array(capacity);
    this.rank = new Uint8Array(capacity);
    this.total = new Int32Array(capacity);
    this.travelled = new Int32Array(capacity);
    this.free = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) this.free[i] = capacity - 1 - i;
    this.freeCount = capacity;
  }

  hasRoom(): boolean { return this.freeCount > 0; }

  /** Free-slot stack, bottom to top (the next spawn takes the last entry). */
  freeSlots(): number[] { return Array.from(this.free.subarray(0, this.freeCount)); }

  /** Restore the free stack and counters after slot data was written (save loading). */
  restoreFree(free: readonly number[], peak: number): void {
    this.free.set(free);
    this.freeCount = free.length;
    this.count = this.capacity - free.length;
    this.peak = peak;
  }

  spawn(x: number, y: number, tx: number, ty: number, target: number, shooter: number, owner: number, weapon: number, rank: number): number {
    if (this.freeCount === 0) return -1;
    const i = this.free[--this.freeCount];
    this.active[i] = 1;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.tx[i] = tx;
    this.ty[i] = ty;
    this.target[i] = target;
    this.shooter[i] = shooter;
    this.owner[i] = owner;
    this.weapon[i] = weapon;
    this.rank[i] = rank;
    this.total[i] = Math.max(1, Math.round(Math.hypot(tx - x, ty - y)));
    this.travelled[i] = 0;
    this.count++;
    if (this.count > this.peak) this.peak = this.count;
    return i;
  }

  release(i: number): void {
    if (!this.active[i]) return;
    this.active[i] = 0;
    this.count--;
    // Keep the free stack ordered so the lowest index is always reused first.
    let j = this.freeCount++;
    while (j > 0 && this.free[j - 1] < i) { this.free[j] = this.free[j - 1]; j--; }
    this.free[j] = i;
  }
}
