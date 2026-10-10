import type { World } from '../sim/world.ts';

/** Player selection and control groups. Presentation state; never read by the simulation. */
export class Selection {
  readonly ids = new Set<number>();
  private readonly groups = new Map<number, number[]>();
  private version = 0;

  get revision(): number { return this.version; }

  set(ids: Iterable<number>): void {
    this.ids.clear();
    for (const id of ids) this.ids.add(id);
    this.version++;
  }

  add(ids: Iterable<number>): void {
    for (const id of ids) this.ids.add(id);
    this.version++;
  }

  /** Shift-click semantics: toggle a single entity. */
  toggle(id: number): void {
    if (this.ids.has(id)) this.ids.delete(id);
    else this.ids.add(id);
    this.version++;
  }

  clear(): void {
    if (this.ids.size === 0) return;
    this.ids.clear();
    this.version++;
  }

  /** Drop removed or no-longer-owned entities (safe for future deaths/captures). */
  prune(world: World, player: number): void {
    let changed = false;
    for (const id of this.ids) {
      const entity = world.get(id);
      if (!entity || entity.owner !== player) { this.ids.delete(id); changed = true; }
    }
    if (changed) this.version++;
  }

  list(): number[] { return Array.from(this.ids).sort((a, b) => a - b); }

  storeGroup(slot: number): void { this.groups.set(slot, this.list()); }

  /** Recall live owned members of a group; returns how many were restored. */
  recallGroup(slot: number, world: World, player: number): number {
    const members = (this.groups.get(slot) ?? []).filter(id => world.get(id)?.owner === player);
    this.groups.set(slot, members);
    if (members.length === 0) return 0;
    this.set(members);
    return members.length;
  }
}
