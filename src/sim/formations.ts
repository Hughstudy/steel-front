import type { Entity } from './entities.ts';
import type { World } from './world.ts';

export interface FormationResult {
  /** Resolved centre tile actually used (nearest reachable to the click), or -1. */
  center: number;
  /** Destination per unit, parallel to the input array (-1 = none available). */
  slots: number[];
  /** True when fewer legal slots existed than units. */
  shortage: boolean;
}

/**
 * Allocate distinct reachable destination tiles near `target`, preserving the
 * group's rough relative arrangement. Deterministic: inputs sorted by id,
 * slots taken in breadth-first order, greedy nearest assignment.
 */
export function assignFormation(world: World, units: Entity[], target: number): FormationResult {
  const nav = world.nav;
  const slots = new Array<number>(units.length).fill(-1);
  if (units.length === 0) return { center: -1, slots, shortage: false };
  const component = nav.componentOf(units[0].next >= 0 ? units[0].next : units[0].tile);
  const center = nav.nearestInComponent(target, component);
  if (center < 0) return { center: -1, slots, shortage: true };

  const moving = new Set<number>();
  for (const unit of units) moving.add(unit.id);
  // Free tiles, or tiles held by members of this group (they will vacate). Prefer
  // open ground over dead-end pockets so arrivals do not seal off each other.
  const claimed = world.claimedGoals(moving);
  const usable = (tile: number): boolean => {
    const occupant = nav.occupancy[tile];
    return (occupant === 0 || moving.has(occupant)) && !claimed.has(tile);
  };
  const searchNodes = units.length * 12 + 64;
  let candidates = world.search.collect(world, center, units.length, searchNodes, tile => usable(tile) && openness(world, tile) >= 6);
  if (candidates.length < units.length) {
    const extra = world.search.collect(world, center, units.length * 2, searchNodes, usable);
    for (const tile of extra) if (candidates.length < units.length && !candidates.includes(tile)) candidates.push(tile);
  }

  const w = nav.width;
  let cx = 0;
  let cy = 0;
  for (const unit of units) { cx += unit.tile % w; cy += (unit.tile / w) | 0; }
  cx /= units.length;
  cy /= units.length;
  // Compress the current spread so the group arrives in a compact formation.
  let spread = 0;
  for (const unit of units) spread = Math.max(spread, Math.abs((unit.tile % w) - cx), Math.abs(((unit.tile / w) | 0) - cy));
  const limit = Math.max(1, Math.ceil(Math.sqrt(units.length)) * 0.75);
  const scale = spread > limit ? limit / spread : 1;
  const tx = center % w;
  const ty = (center / w) | 0;

  candidates = candidates.slice(0, Math.max(units.length, 0));
  const taken = new Uint8Array(candidates.length);
  const order = units.map((_, index) => index).sort((a, b) => units[a].id - units[b].id);
  for (const index of order) {
    const unit = units[index];
    const desiredX = tx + ((unit.tile % w) - cx) * scale;
    const desiredY = ty + (((unit.tile / w) | 0) - cy) * scale;
    let best = -1;
    let bestScore = Infinity;
    for (let c = 0; c < candidates.length; c++) {
      if (taken[c]) continue;
      const dx = (candidates[c] % w) - desiredX;
      const dy = ((candidates[c] / w) | 0) - desiredY;
      const score = dx * dx + dy * dy;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (best >= 0) { taken[best] = 1; slots[index] = candidates[best]; }
  }
  return { center, slots, shortage: candidates.length < units.length };
}

/** Number of the eight neighbours a unit could step to. */
export function openness(world: World, tile: number): number {
  const nav = world.nav;
  const x = tile % nav.width;
  const y = (tile / nav.width) | 0;
  let open = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && nav.inBounds(x + dx, y + dy) && nav.canStep(tile, tile + dy * nav.width + dx)) open++;
    }
  }
  return open;
}
