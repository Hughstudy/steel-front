import type { Entity } from './entities.ts';
import { MoveState } from './entities.ts';
import { NEIGHBOR_DX, NEIGHBOR_DY, NEIGHBOR_HEADING, angleDelta, turnToward } from './angles.ts';
import type { UnitDef } from './rules.ts';
import type { World } from './world.ts';

const DIAGONAL_STEP = 1448; // round(1024 * sqrt(2)): diagonal time matches route geometry
const MAX_STEPS_PER_TICK = 3;
const YIELD_PRIORITY = 1 << 28;

/**
 * Tile-stepping ground movement with reservations. A moving unit occupies its
 * current tile and reserves the tile it is entering; it releases the old tile on
 * arrival. Blocked units wait, ask idle/lower-priority units to yield (shove),
 * and re-route around stationary traffic. Units never overlap or teleport.
 */
export function updateGroundUnit(world: World, unit: Entity, def: UnitDef): void {
  let budget = def.speedPerTick;
  for (let steps = 0; steps < MAX_STEPS_PER_TICK && budget > 0; steps++) {
    if (unit.next < 0 && !beginStep(world, unit)) break;
    unit.facing = turnToward(unit.facing, unit.stepHeading, def.turnRate);
    // Vehicles pivot before driving off at a sharp angle; infantry turn instantly.
    if (Math.abs(angleDelta(unit.facing, unit.stepHeading)) > 32) break;
    const remaining = unit.stepLength - unit.progress;
    if (budget < remaining) {
      unit.progress += budget;
      unit.odometer += budget;
      budget = 0;
    } else {
      budget -= remaining;
      unit.odometer += remaining;
      finishStep(world, unit);
    }
  }
  placeOnStep(world, unit);
  checkProgress(world, unit);
}

export function placeOnStep(world: World, unit: Entity): void {
  const s = world.subTile;
  const w = world.nav.width;
  const ax = (unit.tile % w) * s + (s >> 1);
  const ay = ((unit.tile / w) | 0) * s + (s >> 1);
  if (unit.next < 0) { unit.x = ax; unit.y = ay; return; }
  const bx = (unit.next % w) * s + (s >> 1);
  const by = ((unit.next / w) | 0) * s + (s >> 1);
  unit.x = ax + Math.trunc((bx - ax) * unit.progress / unit.stepLength);
  unit.y = ay + Math.trunc((by - ay) * unit.progress / unit.stepLength);
}

/** The tile this unit wants to enter next, or -1. */
export function desiredNext(unit: Entity): number {
  if (unit.yieldPath && unit.yieldIndex < unit.yieldPath.length) return unit.yieldPath[unit.yieldIndex];
  if (unit.path && unit.pathIndex < unit.path.length) return unit.path[unit.pathIndex];
  return -1;
}

export function hasMovementIntent(unit: Entity): boolean {
  return unit.next >= 0 || desiredNext(unit) >= 0 || unit.moveState === MoveState.Pending;
}

function priority(unit: Entity): number {
  // Aging makes long-waiting units win; id breaks ties deterministically.
  return (unit.yieldPath ? YIELD_PRIORITY : 0) + Math.min(unit.waitTotal, 100000) * 4096 - unit.id;
}

function beginStep(world: World, unit: Entity): boolean {
  const target = desiredNext(unit);
  if (target < 0) { settle(world, unit); return false; }
  const nav = world.nav;
  if (!nav.isAdjacent(unit.tile, target)) {
    // A route computed from an older position; ask for a fresh one.
    abandonYield(unit);
    world.requestPath(unit, false);
    return false;
  }
  if (!nav.canStep(unit.tile, target)) {
    abandonYield(unit);
    world.requestPath(unit, false);
    return false;
  }
  const occupant = nav.occupancy[target];
  if (occupant !== 0 && occupant !== unit.id) {
    handleBlocked(world, unit, target, occupant);
    return false;
  }
  nav.occupancy[target] = unit.id;
  unit.next = target;
  unit.progress = 0;
  const dx = (target % nav.width) - (unit.tile % nav.width);
  const dy = ((target / nav.width) | 0) - ((unit.tile / nav.width) | 0);
  unit.stepLength = dx !== 0 && dy !== 0 ? DIAGONAL_STEP : world.subTile;
  for (let n = 0; n < 8; n++) if (NEIGHBOR_DX[n] === dx && NEIGHBOR_DY[n] === dy) unit.stepHeading = NEIGHBOR_HEADING[n];
  unit.blocked = 0;
  unit.lastProgress = world.tick;
  unit.moveState = MoveState.Moving;
  // Transient traffic reasons clear on progress; order-level reasons (nearest-valid, no-room) persist.
  if (unit.yieldPath) unit.reason = 'yielding';
  else if (unit.reason === 'traffic' || unit.reason === 'congested' || unit.reason === 'yielding') unit.reason = '';
  return true;
}

function finishStep(world: World, unit: Entity): void {
  const nav = world.nav;
  if (nav.occupancy[unit.tile] === unit.id) nav.occupancy[unit.tile] = 0;
  unit.tile = unit.next;
  unit.next = -1;
  unit.progress = 0;
  if (unit.yieldPath && unit.yieldPath[unit.yieldIndex] === unit.tile) {
    unit.yieldIndex++;
    if (unit.yieldIndex >= unit.yieldPath.length) endYield(world, unit);
    return;
  }
  if (unit.path && unit.path[unit.pathIndex] === unit.tile) unit.pathIndex++;
}

/** Path exhausted: arrived at the goal or needs a new route. */
function settle(world: World, unit: Entity): void {
  if (unit.moveState === MoveState.Pending || unit.repath !== 0) return;
  if (unit.goal < 0 || unit.tile === unit.goal) {
    if (unit.goal >= 0 && unit.moveState !== MoveState.Arrived) {
      unit.moveState = MoveState.Arrived;
      unit.reason = '';
      unit.waitTotal = 0;
    }
    unit.path = null;
    return;
  }
  if (unit.moveState === MoveState.Unreachable) return;
  world.requestPath(unit, false);
}

function endYield(world: World, unit: Entity): void {
  unit.yieldPath = null;
  unit.yieldAvoid = null;
  unit.yieldIndex = 0;
  if (unit.resume && unit.goal >= 0 && unit.tile !== unit.goal) {
    // Still on an active order: re-route from the yield position.
    world.requestPath(unit, false);
  } else {
    // Shoved off a finished slot: stay put rather than oscillating back into traffic.
    unit.goal = unit.goal >= 0 ? unit.tile : -1;
    unit.path = null;
    unit.moveState = unit.goal >= 0 ? MoveState.Arrived : MoveState.Idle;
    unit.reason = '';
  }
}

function abandonYield(unit: Entity): void {
  unit.yieldPath = null;
  unit.yieldAvoid = null;
  unit.yieldIndex = 0;
}

function handleBlocked(world: World, unit: Entity, target: number, blockerId: number): void {
  const rules = world.rules.game;
  unit.blocked++;
  unit.waitTotal++;
  if (unit.moveState !== MoveState.Pending) {
    unit.moveState = MoveState.Waiting;
    if (unit.reason === '' || unit.reason === 'yielding') unit.reason = 'traffic';
  }
  const blocker = world.get(blockerId);
  if (!blocker || blocker.kind !== 'unit') {
    if (unit.blocked % rules.repathBlockedTicks === 0) world.requestPath(unit, true);
    return;
  }
  if (blocker.next >= 0) return; // it is moving and will clear the tile
  const avoid = avoidanceFor(unit);
  if (unit.yieldPath) {
    if (!blocker.yieldPath) shove(world, blocker, unit, avoid);
    return;
  }
  if (!hasMovementIntent(blocker)) {
    if (unit.blocked >= rules.shoveDelayTicks) shove(world, blocker, unit, avoid);
  } else if (!blocker.yieldPath) {
    const headOn = desiredNext(blocker) === unit.tile;
    const jammed = blocker.blocked >= rules.jamShoveTicks;
    if ((headOn && unit.blocked >= rules.headOnShoveTicks) || (jammed && unit.blocked >= rules.jamShoveTicks)) {
      if (priority(unit) > priority(blocker)) shove(world, blocker, unit, avoid);
    }
  }
  if (unit.blocked % rules.repathBlockedTicks === 0 && target !== unit.goal) world.requestPath(unit, true);
}

/** Tiles a yielding unit must not stop on: the requester's position and its next waypoints. */
function avoidanceFor(unit: Entity): number[] {
  const avoid: number[] = [unit.tile];
  if (unit.yieldPath) {
    for (let i = unit.yieldIndex; i < unit.yieldPath.length; i++) avoid.push(unit.yieldPath[i]);
    if (unit.yieldAvoid) for (const tile of unit.yieldAvoid) if (!avoid.includes(tile)) avoid.push(tile);
  }
  if (unit.path) {
    const end = Math.min(unit.path.length, unit.pathIndex + 24);
    for (let i = unit.pathIndex; i < end; i++) if (!avoid.includes(unit.path[i])) avoid.push(unit.path[i]);
  }
  if (avoid.length > 48) avoid.length = 48;
  return avoid;
}

/**
 * Ask a stationary unit to step aside. Breadth-first search for the nearest
 * free tile outside `avoid`, allowed to pass through other stationary units
 * (which will in turn be asked to yield). Returns false if no space exists.
 */
export function shove(world: World, target: Entity, requester: Entity, avoid: number[]): boolean {
  if (target.next >= 0 || target.yieldPath || target.kind !== 'unit') return false;
  const def = world.rules.units.get(target.type);
  if (!def || def.movement !== 'ground') return false;
  const route = world.search.yieldRoute(world, target.tile, requester, avoid, world.rules.game.yieldSearchNodes);
  if (!route) return false;
  target.yieldPath = route;
  target.yieldIndex = 0;
  target.yieldAvoid = avoid;
  target.resume = target.goal >= 0 && target.tile !== target.goal
    && target.moveState !== MoveState.Arrived && target.moveState !== MoveState.Unreachable;
  target.blocked = 0;
  return true;
}

function checkProgress(world: World, unit: Entity): void {
  if (unit.moveState !== MoveState.Waiting) return;
  if (world.tick - unit.lastProgress < world.rules.game.noProgressTicks) return;
  unit.lastProgress = world.tick;
  // A long stall: if the destination itself is held by someone who will not move, pick a nearby free slot.
  if (unit.goal >= 0 && world.nav.occupancy[unit.goal] !== 0 && world.nav.occupancy[unit.goal] !== unit.id) {
    const claimed = world.claimedGoals(new Set([unit.id]));
    const replacement = world.search.nearestFree(world, unit.goal, unit.tile, 400, tile => !claimed.has(tile));
    if (replacement >= 0) unit.goal = replacement;
  }
  unit.reason = 'congested';
  abandonYield(unit);
  world.requestPath(unit, true);
}
