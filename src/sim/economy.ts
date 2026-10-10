import type { Entity } from './entities.ts';
import { MoveState } from './entities.ts';
import { UNREACHED } from './pathfinder.ts';
import { ringTiles, touches } from './structures.ts';
import { updateCapture } from './capture.ts';
import { updateTruck } from './truck-ai.ts';
import type { World } from './world.ts';

/**
 * Economy systems, run once per tick after movement in entity-id order:
 * truck hauling, engineer capture, then oil payouts on the interval boundary.
 */
export function updateEconomy(world: World): void {
  for (const entity of world.entities) {
    if (entity.kind !== 'unit' || world.removals.includes(entity.id)) continue;
    const def = world.rules.units.get(entity.type)!;
    const cargo = def.capabilities.cargo;
    if (typeof cargo === 'number' && entity.auto) updateTruck(world, entity, cargo);
    else if (entity.task === 'capture') updateCapture(world, entity);
  }
  const eco = world.rules.economy;
  if (world.tick % eco.oilIntervalTicks === 0) {
    for (const entity of world.entities) {
      if (entity.kind !== 'building' || entity.owner < 0) continue;
      if (!world.rules.buildings.get(entity.type)!.capabilities.oil) continue;
      const player = world.players[entity.owner];
      const amount = scaledIncome(world, entity.owner, eco.oilPayout);
      player.credits += amount;
      player.ledger.oil += amount;
    }
  }
}

/** Income after the computer player's difficulty modifier (humans always earn the base amount). */
export function scaledIncome(world: World, player: number, amount: number): number {
  const level = world.players[player]?.ai?.difficulty;
  const percent = level ? world.rules.ai.difficulties.get(level)?.incomePercent ?? 100 : 100;
  return Math.floor(amount * percent / 100);
}

/** Abort a unit's autonomous task, releasing any dock lease (keeps carried cargo). */
export function cancelTask(world: World, unit: Entity): void {
  releaseDock(world, unit);
  unit.auto = false;
  unit.task = '';
  unit.target = -1;
  unit.preferred = -1;
  unit.timer = 0;
  unit.status = '';
}

/** Drop every lease this truck holds at its target. */
export function releaseDock(world: World, truck: Entity): void {
  if (truck.target < 0) return;
  const target = world.get(truck.target);
  if (target?.docks) {
    const index = target.docks.findIndex(lease => lease.truck === truck.id);
    if (index >= 0) target.docks.splice(index, 1);
  }
}

export function leaseOf(world: World, truck: Entity): { tile: number; until: number } | null {
  const target = world.get(truck.target);
  return target?.docks?.find(lease => lease.truck === truck.id) ?? null;
}

/** Remove expired leases and leases whose truck no longer targets this building. */
function purge(world: World, building: Entity): void {
  if (!building.docks) return;
  for (let i = building.docks.length - 1; i >= 0; i--) {
    const lease = building.docks[i];
    const truck = world.get(lease.truck);
    if (!truck || truck.target !== building.id || lease.until < world.tick) building.docks.splice(i, 1);
  }
}

/**
 * Reserve a docking slot at a building and pick its approach tile, nearest to the
 * truck by route cost. Returns the approach tile or -1 if every slot is taken.
 */
export function acquireDock(world: World, truck: Entity, building: Entity, field: Int32Array | null): number {
  const def = world.rules.buildings.get(building.type)!;
  if (!building.docks) return -1;
  purge(world, building);
  const existing = building.docks.find(lease => lease.truck === truck.id);
  if (existing) return existing.tile;
  if (building.docks.length >= def.dockSlots) return -1;
  const taken = new Set(building.docks.map(lease => lease.tile));
  const component = world.nav.componentOf(truck.tile);
  let best = -1;
  let bestCost = UNREACHED;
  for (const tile of ringTiles(world, def, building.tile)) {
    if (taken.has(tile) || world.nav.componentOf(tile) !== component) continue;
    const occupant = world.nav.occupancy[tile];
    const blocked = occupant !== 0 && occupant !== truck.id && world.get(occupant)?.next === -1 && world.get(occupant)?.auto;
    const cost = (field ? field[tile] : 0) + (blocked ? 200 : 0);
    if (cost < bestCost) { bestCost = cost; best = tile; }
  }
  if (best < 0) return -1;
  const eco = world.rules.economy;
  const travel = field && field[best] < UNREACHED ? Math.ceil(field[best] / 10) * eco.leaseTravelTicksPerTile : 0;
  building.docks.push({ truck: truck.id, tile: best, until: world.tick + eco.dockLeaseTicks + travel });
  return best;
}

/** Keep a lease alive while the truck is actively loading or unloading. */
export function renewDock(world: World, truck: Entity): void {
  const target = world.get(truck.target);
  const lease = target?.docks?.find(entry => entry.truck === truck.id);
  if (lease) lease.until = Math.max(lease.until, world.tick + world.rules.economy.dockLeaseTicks);
}

/** Stationary next to the building footprint, ready to work. */
export function docked(world: World, unit: Entity, building: Entity): boolean {
  return unit.next < 0 && touches(world, building, unit.tile) && unit.moveState !== MoveState.Pending;
}

/** Route cost from the unit to the cheapest approach tile of a building. */
export function approachCost(world: World, field: Int32Array, building: Entity): number {
  const def = world.rules.buildings.get(building.type)!;
  let best = UNREACHED;
  for (const tile of ringTiles(world, def, building.tile)) if (field[tile] < best) best = field[tile];
  return best;
}
