import type { Entity } from './entities.ts';
import { MoveState } from './entities.ts';
import { UNREACHED } from './pathfinder.ts';
import { ringTiles, touches } from './structures.ts';
import type { World } from './world.ts';

/**
 * Engineer capture: walk to a free tile touching the target, then hold still for
 * `captureTicks`. Movement resets progress. Completion transfers ownership and
 * consumes the engineer exactly once; a structure cannot change hands twice in one tick.
 */
export function updateCapture(world: World, engineer: Entity): void {
  const target = world.get(engineer.target);
  const def = target && target.kind === 'building' ? world.rules.buildings.get(target.type) : undefined;
  if (!target || !def?.capabilities.capturable || target.owner === engineer.owner || world.removals.includes(target.id)) {
    engineer.task = '';
    engineer.target = -1;
    engineer.timer = 0;
    engineer.status = target && target.owner === engineer.owner ? 'already captured' : '';
    return;
  }
  if (engineer.next < 0 && touches(world, target, engineer.tile) && engineer.moveState !== MoveState.Pending) {
    if (engineer.path) world.stopUnit(engineer);
    if (target.timer === world.tick) { engineer.timer = 0; return; }
    engineer.timer++;
    engineer.status = 'capturing';
    if (engineer.timer >= world.rules.economy.captureTicks) {
      target.owner = engineer.owner;
      target.timer = world.tick;
      engineer.task = '';
      engineer.status = 'captured';
      world.remove(engineer.id);
    }
    return;
  }
  engineer.timer = 0;
  if (engineer.next >= 0 || engineer.moveState === MoveState.Pending || engineer.moveState === MoveState.Moving || engineer.moveState === MoveState.Waiting) {
    engineer.status = 'approaching';
    return;
  }
  if (engineer.moveState === MoveState.Unreachable && engineer.status === 'approaching') {
    engineer.task = '';
    engineer.status = 'no-route';
    return;
  }
  const field = world.fieldFrom(engineer.tile);
  let best = -1;
  let bestCost = UNREACHED;
  for (const tile of ringTiles(world, def, target.tile)) {
    const occupant = world.nav.occupancy[tile];
    const cost = field[tile] + (occupant !== 0 && occupant !== engineer.id ? 60 : 0);
    if (cost < bestCost) { bestCost = cost; best = tile; }
  }
  if (best < 0 || field[best] >= UNREACHED) {
    engineer.task = '';
    engineer.status = 'no-route';
    return;
  }
  engineer.status = 'approaching';
  world.moveUnitTo(engineer, best);
}
