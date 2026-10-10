import type { Entity } from './entities.ts';
import { byteAngle } from './angles.ts';
import type { BuildingDef, UnitDef } from './rules.ts';
import { NEUTRAL } from './rules.ts';
import { footprintTiles, placementProblem, ringTiles } from './structures.ts';
import type { PlacementProblem } from './structures.ts';
import type { Player, World } from './world.ts';

/** One entry of a player's production queue. Integer work and credits only. */
export interface QueueItem {
  id: number;
  type: string;
  category: string;
  /** Credits charged so far (progressive payment). */
  paid: number;
  /** Accumulated work; complete at `total`. Full power adds `denominator` per tick. */
  work: number;
  total: number;
  /** '' while working or waiting its turn; otherwise a readable pause reason. */
  reason: string;
}

/** A structure waiting for its footprint to clear before it appears. */
export interface PendingPlacement {
  player: number;
  type: string;
  origin: number;
  /** Queue item being placed (-1 for an MCV deployment). */
  item: number;
  /** Deploying MCV (-1 for a queue placement). */
  unit: number;
  until: number;
}

export type ConstructionProblem = PlacementProblem | 'range';

export function costOf(world: World, type: string): number {
  return (world.rules.units.get(type) ?? world.rules.buildings.get(type))?.cost ?? 0;
}

export function definitionOf(world: World, type: string): UnitDef | BuildingDef | undefined {
  return world.rules.units.get(type) ?? world.rules.buildings.get(type);
}

/** Building types the player currently owns (completed, placed). */
export function ownedTypes(world: World, player: number): Set<string> {
  const types = new Set<string>();
  for (const entity of world.entities) if (entity.kind === 'building' && entity.owner === player) types.add(entity.type);
  return types;
}

export function missingPrerequisites(world: World, player: number, type: string, owned = ownedTypes(world, player)): string[] {
  const def = definitionOf(world, type);
  return def ? def.prerequisites.filter(id => !owned.has(id)) : [];
}

export function hasProducer(world: World, player: number, category: string): boolean {
  for (const entity of world.entities) {
    if (entity.kind === 'building' && entity.owner === player && world.rules.buildings.get(entity.type)!.produces.includes(category)) return true;
  }
  return false;
}

/** Items the player's faction can ever build in a category, in data order. */
export function catalog(world: World, player: number, category: string): Array<UnitDef | BuildingDef> {
  const faction = world.players[player].faction;
  const result: Array<UnitDef | BuildingDef> = [];
  for (const def of world.rules.buildings.values()) if (def.producer === category && def.faction === faction) result.push(def);
  for (const def of world.rules.units.values()) if (def.producer === category && def.faction === faction) result.push(def);
  return result;
}

/** Recompute power supply and demand from completed buildings. */
export function updatePower(world: World): void {
  for (const player of world.players) { player.power.supply = 0; player.power.demand = 0; }
  for (const entity of world.entities) {
    if (entity.kind !== 'building' || entity.owner < 0) continue;
    const power = world.rules.buildings.get(entity.type)!.power;
    const player = world.players[entity.owner];
    if (power >= 0) player.power.supply += power; else player.power.demand -= power;
  }
}

export function lowPower(player: Player): boolean {
  return player.power.demand > player.power.supply;
}

function footprintGap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): number {
  const dx = Math.max(0, bx - (ax + aw - 1), ax - (bx + bw - 1));
  const dy = Math.max(0, by - (ay + ah - 1), ay - (by + bh - 1));
  return Math.max(dx, dy);
}

/** True when the footprint lies within construction radius of an owned (non-neutral) building. */
export function inConstructionRange(world: World, player: number, def: BuildingDef, origin: number): boolean {
  const w = world.nav.width;
  const ox = origin % w;
  const oy = (origin / w) | 0;
  const radius = world.rules.production.constructionRadius;
  for (const entity of world.entities) {
    if (entity.kind !== 'building' || entity.owner !== player) continue;
    const other = world.rules.buildings.get(entity.type)!;
    if (other.faction === NEUTRAL) continue;
    const gap = footprintGap(ox, oy, def.footprint.w, def.footprint.h, entity.tile % w, (entity.tile / w) | 0, other.footprint.w, other.footprint.h);
    if (gap <= radius) return true;
  }
  return false;
}

/**
 * Authoritative placement check shared by the ghost and the place command.
 * 'occupied' is a soft problem: units are moved away before the building appears.
 */
export function constructionProblem(world: World, player: number, def: BuildingDef, origin: number, needRange = true): ConstructionProblem {
  const hard = placementProblem(world, def, origin, true);
  if (hard !== '') return hard;
  if (needRange && !inConstructionRange(world, player, def, origin)) return 'range';
  for (const tile of footprintTiles(world, def, origin)) if (world.nav.occupancy[tile] !== 0) return 'occupied';
  return '';
}

/** Footprint origin for an MCV deploying on `tile` (footprint centred on it). */
export function deployOrigin(world: World, def: BuildingDef, tile: number): number {
  const w = world.nav.width;
  const x = (tile % w) - (def.footprint.w >> 1);
  const y = ((tile / w) | 0) - (def.footprint.h >> 1);
  return world.nav.inBounds(x, y) ? y * w + x : -1;
}

function notice(world: World, player: Player, text: string): void {
  player.notice = text;
  player.noticeTick = world.tick;
}

// ---------------------------------------------------------------- commands

export function enqueueItem(world: World, playerIndex: number, type: string): void {
  const player = world.players[playerIndex];
  const def = definitionOf(world, type);
  if (!player || !def || def.producer === null || def.faction !== player.faction) return;
  const queue = player.queues[def.producer] ?? (player.queues[def.producer] = []);
  if (queue.length >= world.rules.production.queueLimit) { notice(world, player, 'queue full'); return; }
  const missing = missingPrerequisites(world, playerIndex, type);
  if (missing.length) { notice(world, player, 'requires ' + missing.map(id => definitionOf(world, id)?.name ?? id).join(', ')); return; }
  if (!hasProducer(world, playerIndex, def.producer)) { notice(world, player, 'no producer'); return; }
  const rate = world.rules.production.lowPowerRate;
  queue.push({ id: world.nextItem++, type, category: def.producer, paid: 0, work: 0, total: def.buildTicks * rate.denominator, reason: '' });
}

/** Cancel the most recently queued item of a type, refunding only what was paid. */
export function cancelItem(world: World, playerIndex: number, type: string): void {
  const player = world.players[playerIndex];
  const def = definitionOf(world, type);
  if (!player || !def || def.producer === null) return;
  const queue = player.queues[def.producer];
  if (!queue) return;
  for (let i = queue.length - 1; i >= 0; i--) {
    const item = queue[i];
    if (item.type !== type) continue;
    queue.splice(i, 1);
    const refund = Math.floor(item.paid * world.rules.production.cancelRefundPercent / 100);
    player.credits += refund;
    player.ledger.refunded += refund;
    for (let p = world.pending.length - 1; p >= 0; p--) if (world.pending[p].item === item.id) world.pending.splice(p, 1);
    return;
  }
}

export function placeItem(world: World, playerIndex: number, type: string, x: number, y: number): void {
  const player = world.players[playerIndex];
  const def = world.rules.buildings.get(type);
  if (!player || !def || def.producer === null || !world.nav.inBounds(x, y)) return;
  const item = player.queues[def.producer]?.[0];
  if (!item || item.type !== type || item.work < item.total) return;
  if (world.pending.some(p => p.item === item.id)) return;
  const origin = world.nav.index(x, y);
  const problem = constructionProblem(world, playerIndex, def, origin);
  if (problem !== '' && problem !== 'occupied') { notice(world, player, `cannot place: ${problem}`); return; }
  world.pending.push({ player: playerIndex, type, origin, item: item.id, unit: -1, until: world.tick + world.rules.production.placementTimeoutTicks });
}

export function deployUnit(world: World, unit: Entity): void {
  const type = world.rules.units.get(unit.type)!.capabilities.deploy;
  if (typeof type !== 'string') return;
  const def = world.rules.buildings.get(type)!;
  const base = unit.next >= 0 ? unit.next : unit.tile;
  const origin = deployOrigin(world, def, base);
  const player = world.players[unit.owner];
  const problem = origin < 0 ? 'bounds' : constructionProblem(world, unit.owner, def, origin, false);
  if (problem !== '' && problem !== 'occupied') {
    unit.status = 'deploy-blocked';
    notice(world, player, `cannot deploy here: ${problem}`);
    return;
  }
  for (let p = world.pending.length - 1; p >= 0; p--) if (world.pending[p].unit === unit.id) world.pending.splice(p, 1);
  world.stopUnit(unit);
  unit.task = 'deploy';
  unit.status = 'deploying';
  world.pending.push({ player: unit.owner, type, origin, item: -1, unit: unit.id, until: world.tick + world.rules.production.placementTimeoutTicks });
}

export function sellBuilding(world: World, playerIndex: number, building: Entity): void {
  const def = world.rules.buildings.get(building.type);
  if (!def || building.owner !== playerIndex || !def.sellable || world.removals.includes(building.id)) return;
  const player = world.players[playerIndex];
  const value = Math.floor(def.cost * world.rules.production.sellRefundPercent / 100 * building.hp / def.hp);
  player.credits += value;
  player.ledger.sold += value;
  world.remove(building.id);
}

export function setRally(world: World, playerIndex: number, building: Entity, x: number, y: number): void {
  const def = world.rules.buildings.get(building.type);
  if (!def || building.owner !== playerIndex || def.produces.length === 0 || !world.nav.inBounds(x, y)) return;
  if (def.produces.every(category => world.rules.production.categories.find(c => c.id === category)?.placement)) return;
  building.rally = world.nav.nearestInComponent(world.nav.index(x, y), world.mainComponent());
}

// ---------------------------------------------------------------- per tick

/** Production, placement, repair. Runs after movement and economy, in player then category order. */
export function updateProduction(world: World): void {
  updatePower(world);
  updatePending(world);
  for (const player of world.players) {
    const owned = ownedTypes(world, player.index);
    const rate = world.rules.production.lowPowerRate;
    const step = lowPower(player) ? rate.numerator : rate.denominator;
    for (const category of world.rules.production.categories) {
      const queue = player.queues[category.id];
      if (!queue || queue.length === 0) continue;
      const item = queue[0];
      if (item.work < item.total) {
        if (missingPrerequisites(world, player.index, item.type, owned).length) { item.reason = 'prerequisite'; continue; }
        if (!hasProducer(world, player.index, category.id)) { item.reason = 'no-producer'; continue; }
        const cost = costOf(world, item.type);
        const next = Math.min(item.total, item.work + step);
        const due = Math.floor(cost * next / item.total) - item.paid;
        if (due > player.credits) { item.reason = 'funds'; continue; }
        player.credits -= due;
        player.ledger.spent += due;
        item.paid += due;
        item.work = next;
        item.reason = lowPower(player) ? 'low-power' : '';
        if (item.work < item.total) continue;
      }
      if (category.placement) { item.reason = 'ready'; continue; }
      if (spawnProduced(world, player.index, item)) queue.shift();
      else item.reason = hasProducer(world, player.index, category.id) ? 'exit-blocked' : 'no-producer';
    }
  }
  updateRepairs(world);
}

function producersFor(world: World, player: number, category: string): Entity[] {
  const list: Entity[] = [];
  for (const entity of world.entities) {
    if (entity.kind === 'building' && entity.owner === player && !world.removals.includes(entity.id)
      && world.rules.buildings.get(entity.type)!.produces.includes(category)) list.push(entity);
  }
  return list.sort((a, b) => a.id - b.id);
}

/** Free exit tile of a producer: its designated exit first, then other approach tiles nearest to it. */
export function exitTile(world: World, building: Entity): number {
  const def = world.rules.buildings.get(building.type)!;
  const w = world.nav.width;
  const ox = building.tile % w;
  const oy = (building.tile / w) | 0;
  const ex = ox + (def.exit ? def.exit.x : def.footprint.w);
  const ey = oy + (def.exit ? def.exit.y : def.footprint.h >> 1);
  const main = world.mainComponent();
  let best = -1;
  let bestDistance = Infinity;
  for (const tile of ringTiles(world, def, building.tile)) {
    if (world.nav.occupancy[tile] !== 0 || world.nav.componentOf(tile) !== main) continue;
    const dx = (tile % w) - ex;
    const dy = ((tile / w) | 0) - ey;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) { bestDistance = distance; best = tile; }
  }
  return best;
}

function spawnProduced(world: World, player: number, item: QueueItem): boolean {
  for (const producer of producersFor(world, player, item.category)) {
    const tile = exitTile(world, producer);
    if (tile < 0) continue;
    const def = world.rules.units.get(item.type)!;
    const unit = world.spawnUnit(item.type, player, tile);
    const w = world.nav.width;
    const dx = unit.x - producer.x;
    const dy = unit.y - producer.y;
    unit.facing = unit.prevFacing = unit.turret = unit.prevTurret = byteAngle(dx, dy);
    if (typeof def.capabilities.cargo === 'number') {
      unit.auto = true;
      unit.task = 'seek-dump';
      return true;
    }
    let destination = producer.rally;
    if (destination < 0) {
      // Drive a few tiles straight out of the exit so the doorway stays clear.
      const length = Math.max(1, Math.hypot(dx, dy));
      const offset = world.rules.production.rallyOffset;
      const x = Math.max(0, Math.min(w - 1, (tile % w) + Math.round(dx / length * offset)));
      const y = Math.max(0, Math.min(world.nav.height - 1, ((tile / w) | 0) + Math.round(dy / length * offset)));
      destination = world.nav.nearestInComponent(world.nav.index(x, y), world.nav.componentOf(tile));
    }
    if (destination >= 0) world.orderMove([unit], destination);
    return true;
  }
  return false;
}

function updatePending(world: World): void {
  for (let i = 0; i < world.pending.length; i++) {
    const pending = world.pending[i];
    const player = world.players[pending.player];
    const def = world.rules.buildings.get(pending.type)!;
    const unit = pending.unit >= 0 ? world.get(pending.unit) : undefined;
    let valid: boolean;
    if (pending.unit >= 0) valid = unit !== undefined && unit.owner === pending.player && unit.task === 'deploy' && !world.removals.includes(unit.id);
    else {
      const item = player.queues[def.producer!]?.[0];
      valid = item !== undefined && item.id === pending.item && item.work >= item.total;
    }
    const problem = valid ? constructionProblem(world, pending.player, def, pending.origin, pending.unit < 0) : '';
    if (!valid || (problem !== '' && problem !== 'occupied') || world.tick > pending.until) {
      if (valid) notice(world, player, problem !== '' && problem !== 'occupied' ? `cannot place: ${problem}` : 'placement blocked by units');
      if (unit && unit.task === 'deploy') { unit.task = ''; unit.status = 'deploy-blocked'; }
      world.pending.splice(i--, 1);
      continue;
    }
    if (unit && unit.next >= 0) continue;
    const tiles = footprintTiles(world, def, pending.origin);
    let clear = true;
    for (const tile of tiles) {
      const occupant = world.nav.occupancy[tile];
      if (occupant === 0 || occupant === pending.unit) continue;
      clear = false;
      const other = world.get(occupant);
      if (other && other.next < 0 && (other.goal < 0 || tiles.includes(other.goal))) evacuate(world, other, tiles);
    }
    if (!clear) continue;
    if (unit) {
      world.nav.occupancy[unit.tile] = 0;
      world.remove(unit.id);
    } else {
      player.queues[def.producer!].shift();
    }
    world.pending.splice(i--, 1);
    world.spawnBuilding(pending.type, pending.player, pending.origin);
  }
}

/** Move a unit standing on a footprint to the nearest free tile outside it. Never teleports. */
function evacuate(world: World, unit: Entity, tiles: number[]): void {
  const claimed = world.claimedGoals(new Set([unit.id]));
  const target = world.search.nearestFree(world, unit.tile, unit.tile, 400, tile => !tiles.includes(tile) && !claimed.has(tile));
  if (target < 0) return;
  if (unit.auto || unit.task) unit.status = 'making way';
  world.moveUnitTo(unit, target);
}

function updateRepairs(world: World): void {
  const production = world.rules.production;
  if (world.tick % production.repairIntervalTicks !== 0) return;
  for (const entity of world.entities) {
    if (entity.kind !== 'building' || !entity.repairing || entity.owner < 0) continue;
    const def = world.rules.buildings.get(entity.type)!;
    if (entity.hp >= def.hp) { entity.repairing = false; continue; }
    const player = world.players[entity.owner];
    const cost = Math.ceil(def.cost * production.repairStepPermille * production.repairCostPercent / 100000);
    if (cost > player.credits) continue;
    player.credits -= cost;
    player.ledger.spent += cost;
    entity.hp = Math.min(def.hp, entity.hp + Math.ceil(def.hp * production.repairStepPermille / 1000));
  }
}
