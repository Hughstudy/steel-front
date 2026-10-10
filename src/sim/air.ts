import type { Entity } from './entities.ts';
import { MoveState } from './entities.ts';
import { angleDelta, byteAngle, turnToward } from './angles.ts';
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
 * navigation. An aircraft that cannot line up a close target first flies an
 * egress leg, opening enough space for its next strafing pass. Otherwise it flies
 * to its goal and circles there. Aircraft never occupy ground tiles.
 */
export function updateAirUnit(world: World, unit: Entity, def: UnitDef): void {
  const s = world.subTile;
  const w = world.nav.width;
  const target = !unit.airMove && unit.target >= 0 ? world.get(unit.target) : undefined;
  let tx: number;
  let ty: number;
  let holding = false;
  if (target && target.hp > 0) {
    tx = target.x;
    ty = target.y;
    // A target inside the turning circle can otherwise remain off the nose
    // forever. Clearance comes from flight physics and the data-defined overshoot.
    const radius = Math.ceil(def.speedPerTick * 128 / (Math.PI * def.turnRate)) + def.speedPerTick;
    const dx = tx - unit.x;
    const dy = ty - unit.y;
    if (unit.airPass < 0 && dx * dx + dy * dy < 4 * radius * radius && Math.abs(angleDelta(unit.facing, byteAngle(dx, dy))) > def.turnRate) {
      unit.airPass = egressTile(world, unit, target, radius * 2 + world.rules.combat.air.overshootTiles * s);
    }
    if (unit.airPass >= 0) {
      tx = (unit.airPass % w) * s + (s >> 1);
      ty = ((unit.airPass / w) | 0) * s + (s >> 1);
      // Reach a disc wider than our turn circle, so the waypoint itself cannot
      // produce the same orbit. Keep this tick's heading before turning back.
      if ((tx - unit.x) ** 2 + (ty - unit.y) ** 2 <= radius * radius) unit.airPass = -1;
    }
  } else {
    unit.airPass = -1;
    if (unit.goal < 0) unit.goal = unit.tile;
    tx = (unit.goal % w) * s + (s >> 1);
    ty = ((unit.goal / w) | 0) * s + (s >> 1);
    const hold = world.rules.combat.air.holdRadius * s;
    const dx = tx - unit.x;
    const dy = ty - unit.y;
    holding = dx * dx + dy * dy <= hold * hold;
  }
  if (holding) {
    unit.airMove = false;
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

/** Choose a fly-through point ahead, using an inward alternative near map edges. */
function egressTile(world: World, unit: Entity, target: Entity, clearance: number): number {
  const s = world.subTile;
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < 256; i += 16) {
    const heading = (unit.facing + i) & 255;
    const x = Math.floor((target.x + COS[heading] * clearance / 4096) / s);
    const y = Math.floor((target.y + SIN[heading] * clearance / 4096) / s);
    if (!world.nav.inBounds(x, y)) continue;
    const dx = x * s + (s >> 1) - unit.x;
    const dy = y * s + (s >> 1) - unit.y;
    const score = dx * COS[unit.facing] + dy * SIN[unit.facing];
    if (score > bestScore) { best = world.nav.index(x, y); bestScore = score; }
  }
  return best;
}
