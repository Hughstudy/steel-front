import type { Entity } from './entities.ts';
import { MoveState } from './entities.ts';
import { byteAngle, turnToward } from './angles.ts';
import type { UnitDef } from './rules.ts';
import type { World } from './world.ts';

/** Fixed-point unit vectors (×4096) for the 256 byte angles, built once. */
const COS = new Int32Array(256);
const SIN = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  COS[i] = Math.round(Math.cos(i / 256 * Math.PI * 2) * 4096);
  SIN[i] = Math.round(Math.sin(i / 256 * Math.PI * 2) * 4096);
}

/**
 * Fighter flight: constant speed with a limited turn rate, ignoring ground
 * navigation. With a target the aircraft steers at it, so it makes strafing
 * passes, overshoots and comes around; otherwise it flies to its goal and circles
 * there in a holding pattern. Aircraft never occupy ground tiles.
 */
export function updateAirUnit(world: World, unit: Entity, def: UnitDef): void {
  const s = world.subTile;
  const w = world.nav.width;
  const target = unit.target >= 0 ? world.get(unit.target) : undefined;
  let tx: number;
  let ty: number;
  let holding = false;
  if (target && target.hp > 0) {
    tx = target.x;
    ty = target.y;
  } else {
    if (unit.goal < 0) unit.goal = unit.tile;
    tx = (unit.goal % w) * s + (s >> 1);
    ty = ((unit.goal / w) | 0) * s + (s >> 1);
    const hold = world.rules.combat.air.holdRadius * s;
    const dx = tx - unit.x;
    const dy = ty - unit.y;
    holding = dx * dx + dy * dy <= hold * hold;
  }
  if (holding) {
    unit.facing = (unit.facing + def.turnRate) & 255;
    unit.moveState = MoveState.Arrived;
  } else {
    unit.facing = turnToward(unit.facing, byteAngle(tx - unit.x, ty - unit.y), def.turnRate);
    unit.moveState = MoveState.Moving;
  }
  const speed = def.speedPerTick;
  unit.x = Math.max(0, Math.min(world.nav.width * s - 1, unit.x + Math.trunc(COS[unit.facing] * speed / 4096)));
  unit.y = Math.max(0, Math.min(world.nav.height * s - 1, unit.y + Math.trunc(SIN[unit.facing] * speed / 4096)));
  unit.tile = Math.floor(unit.y / s) * w + Math.floor(unit.x / s);
  unit.turret = unit.facing;
  unit.odometer += speed;
}
