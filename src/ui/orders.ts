import type { Entity } from '../sim/entities.ts';
import type { World } from '../sim/world.ts';

export type ContextOrder = 'move' | 'harvest' | 'deposit' | 'capture';

/**
 * Resolve what a right-click on `target` means for the selected units, RA2 style:
 * trucks haul from dumps and unload at own depots, engineers capture neutral or
 * enemy capturable structures, everything else moves.
 */
export function contextOrder(world: World, player: number, ids: readonly number[], target: Entity | null): ContextOrder {
  if (!target || target.kind !== 'building') return 'move';
  const def = world.rules.buildings.get(target.type)!;
  let trucks = false;
  let engineers = false;
  for (const id of ids) {
    const unit = world.get(id);
    if (!unit || unit.kind !== 'unit') continue;
    const caps = world.rules.units.get(unit.type)!.capabilities;
    if (typeof caps.cargo === 'number') trucks = true;
    if (caps.capture) engineers = true;
  }
  if (trucks && typeof def.capabilities.supply === 'number') return 'harvest';
  if (trucks && def.capabilities.depot && target.owner === player) return 'deposit';
  if (engineers && def.capabilities.capturable && target.owner !== player) return 'capture';
  return 'move';
}
