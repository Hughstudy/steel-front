import type { Entity } from './entities.ts';
import { MoveState } from './entities.ts';
import { UNREACHED } from './pathfinder.ts';
import { acquireDock, approachCost, leaseOf, releaseDock, renewDock, scaledIncome } from './economy.ts';
import { touches } from './structures.ts';
import type { World } from './world.ts';

/**
 * Supply truck state machine:
 * seek-dump → to-dump → load → seek-depot → to-depot → unload → seek-dump …
 * Waiting states keep a readable `status` and retry on a bounded timer.
 */
export function updateTruck(world: World, truck: Entity, capacity: number): void {
  switch (truck.task) {
    case 'seek-dump': seek(world, truck, false, capacity); return;
    case 'seek-depot': seek(world, truck, true, capacity); return;
    case 'to-dump':
    case 'to-depot': travel(world, truck); return;
    case 'load': load(world, truck, capacity); return;
    case 'unload': unload(world, truck); return;
    default: truck.task = truck.cargo >= capacity ? 'seek-depot' : 'seek-dump';
  }
}

function isDump(world: World, _truck: Entity, building: Entity): boolean {
  return building.kind === 'building' && building.stock > 0 && !world.removals.includes(building.id)
    && typeof world.rules.buildings.get(building.type)!.capabilities.supply === 'number';
}

function isDepot(world: World, truck: Entity, building: Entity): boolean {
  return building.kind === 'building' && building.owner === truck.owner && !world.removals.includes(building.id)
    && world.rules.buildings.get(building.type)!.capabilities.depot === true;
}

/** Cheapest reachable target by route cost; the player's preferred target wins if valid. */
function choose(world: World, truck: Entity, depot: boolean, field: Int32Array): Entity | null {
  const valid = depot ? isDepot : isDump;
  const preferred = truck.preferred >= 0 ? world.get(truck.preferred) : undefined;
  if (preferred && valid(world, truck, preferred) && approachCost(world, field, preferred) < UNREACHED) return preferred;
  let best: Entity | null = null;
  let bestCost = UNREACHED;
  for (const entity of world.entities) {
    if (!valid(world, truck, entity)) continue;
    const cost = approachCost(world, field, entity);
    if (cost < bestCost) { bestCost = cost; best = entity; }
  }
  return best;
}

function seek(world: World, truck: Entity, depot: boolean, capacity: number): void {
  if (truck.timer > 0) { truck.timer--; return; }
  if (truck.next >= 0) return; // decide on tile boundaries only
  const eco = world.rules.economy;
  if (!depot && truck.cargo >= capacity) { truck.task = 'seek-depot'; return; }
  // Skip the route-cost field entirely when no candidate exists anywhere.
  const valid = depot ? isDepot : isDump;
  const any = world.entities.some(entity => valid(world, truck, entity));
  const field = any ? world.fieldFrom(truck.tile) : null;
  const target = field ? choose(world, truck, depot, field) : null;
  if (!target) {
    if (!depot && truck.cargo > 0) { truck.task = 'seek-depot'; return; }
    truck.status = depot ? 'no-depot' : 'no-resource';
    // Exhausted resources are re-checked rarely rather than searched every tick.
    truck.timer = depot ? eco.retryTicks : eco.retryTicks * 5;
    return;
  }
  truck.target = target.id;
  const tile = acquireDock(world, truck, target, field!);
  if (tile < 0) {
    truck.target = -1;
    truck.status = 'queued';
    truck.timer = eco.retryTicks;
    park(world, truck, target);
    return;
  }
  truck.status = depot ? 'returning' : 'to-supplies';
  truck.task = depot ? 'to-depot' : 'to-dump';
  world.moveUnitTo(truck, tile);
}

/** Wait clear of the docking ring so queued trucks never seal the only approach. */
function park(world: World, truck: Entity, building: Entity): void {
  const def = world.rules.buildings.get(building.type)!;
  const w = world.nav.width;
  const ox = building.tile % w;
  const oy = (building.tile / w) | 0;
  const distance = (tile: number): number => {
    const x = tile % w;
    const y = (tile / w) | 0;
    const dx = x < ox ? ox - x : x >= ox + def.footprint.w ? x - ox - def.footprint.w + 1 : 0;
    const dy = y < oy ? oy - y : y >= oy + def.footprint.h ? y - oy - def.footprint.h + 1 : 0;
    return Math.max(dx, dy);
  };
  const here = distance(truck.tile);
  if (here >= 2 && here <= 5) return;
  const spot = world.search.nearestFree(world, truck.tile, truck.tile, 300, tile => distance(tile) >= 2 && distance(tile) <= 5);
  if (spot >= 0 && spot !== truck.tile) world.moveUnitTo(truck, spot);
}

function atDock(world: World, truck: Entity, building: Entity, leaseTile: number): boolean {
  if (truck.next >= 0 || !touches(world, building, truck.tile)) return false;
  return truck.tile === leaseTile || truck.moveState === MoveState.Arrived || truck.moveState === MoveState.Idle;
}

function travel(world: World, truck: Entity): void {
  const depot = truck.task === 'to-depot';
  const target = world.get(truck.target);
  const retry = (status: string, delay: number): void => {
    releaseDock(world, truck);
    truck.target = -1;
    truck.task = depot ? 'seek-depot' : 'seek-dump';
    truck.status = status;
    truck.timer = delay;
  };
  if (!target || !(depot ? isDepot(world, truck, target) : isDump(world, truck, target))) { retry('retargeting', 0); return; }
  const lease = leaseOf(world, truck);
  if (!lease) { retry('lease expired', 0); return; }
  if (atDock(world, truck, target, lease.tile)) {
    lease.tile = truck.tile;
    world.stopUnit(truck);
    truck.task = depot ? 'unload' : 'load';
    truck.status = depot ? 'unloading' : 'loading';
    renewDock(world, truck);
    return;
  }
  if (truck.moveState === MoveState.Unreachable) { retry('no-route', world.rules.economy.retryTicks); return; }
  if (truck.next < 0 && (truck.moveState === MoveState.Arrived || truck.moveState === MoveState.Idle)) world.moveUnitTo(truck, lease.tile);
}

function load(world: World, truck: Entity, capacity: number): void {
  const target = world.get(truck.target);
  if (!target || target.stock <= 0 || truck.cargo >= capacity) { finishLoad(world, truck); return; }
  const lease = leaseOf(world, truck);
  if (!lease || !touches(world, target, truck.tile) || truck.next >= 0) { truck.task = 'to-dump'; if (!lease) finishLoad(world, truck); return; }
  // Finite stock leaves only as it enters the truck. Endless sites keep bounded,
  // JSON-safe stock while still using the normal loading rate and cargo limit.
  const amount = Math.min(world.rules.economy.loadPerTick, target.stock, capacity - truck.cargo);
  if (!world.rules.buildings.get(target.type)!.capabilities.infiniteSupply) target.stock -= amount;
  truck.cargo += amount;
  renewDock(world, truck);
  if (target.stock <= 0) world.remove(target.id);
  if (truck.cargo >= capacity || target.stock <= 0) finishLoad(world, truck);
}

function finishLoad(world: World, truck: Entity): void {
  releaseDock(world, truck);
  truck.target = -1;
  truck.task = truck.cargo > 0 ? 'seek-depot' : 'seek-dump';
  truck.status = '';
}

function unload(world: World, truck: Entity): void {
  const target = world.get(truck.target);
  const lease = leaseOf(world, truck);
  if (!target || !isDepot(world, truck, target) || !lease) {
    releaseDock(world, truck);
    truck.target = -1;
    truck.task = 'seek-depot';
    return;
  }
  if (!touches(world, target, truck.tile) || truck.next >= 0) { truck.task = 'to-depot'; return; }
  // Credits are added only as cargo leaves the truck.
  const amount = Math.min(world.rules.economy.unloadPerTick, truck.cargo);
  truck.cargo -= amount;
  const player = world.players[truck.owner];
  const earned = scaledIncome(world, truck.owner, amount);
  player.credits += earned;
  player.ledger.delivered += earned;
  renewDock(world, truck);
  if (truck.cargo <= 0) {
    releaseDock(world, truck);
    truck.target = -1;
    truck.task = 'seek-dump';
    truck.status = '';
    if (truck.preferred >= 0 && world.get(truck.preferred)?.kind === 'building' && isDepot(world, truck, world.get(truck.preferred)!)) truck.preferred = -1;
  }
}
