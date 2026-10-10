import type { Entity } from './entities.ts';
import { MoveState } from './entities.ts';
import { angleDelta, byteAngle, turnToward } from './angles.ts';
import { canSee } from './fog.ts';
import type { MovementLayer, UnitDef, WeaponDef } from './rules.ts';
import type { World } from './world.ts';

/**
 * Combat resolution, in this documented per-tick order (after movement):
 * 1. rebuild the spatial index;
 * 2. per entity in id order: cooldowns, setup, target validation/acquisition,
 *    chase, turret/body aim, firing (reserving a projectile slot first);
 * 3. projectiles advance in slot order; impacts apply damage immediately to
 *    live targets (an entity at 0 HP is never hit again);
 * 4. deaths resolve in id order: kill credit and promotion once, then removal.
 */
export function updateCombat(world: World): void {
  world.grid.rebuild(world);
  for (const entity of world.entities) {
    if (entity.kind !== 'unit' || entity.hp <= 0) continue;
    const def = world.rules.units.get(entity.type)!;
    if (def.weapons.length === 0) continue;
    updateShooter(world, entity, def);
  }
  updateProjectiles(world);
  resolveDeaths(world);
}

export function layerOf(world: World, entity: Entity): MovementLayer {
  return entity.kind === 'unit' ? world.rules.units.get(entity.type)!.movement : 'ground';
}

function armorClassOf(world: World, entity: Entity): string {
  return entity.kind === 'unit' ? world.rules.units.get(entity.type)!.armor : 'building';
}

function armorValueOf(world: World, entity: Entity): number {
  return entity.kind === 'unit' ? world.rules.units.get(entity.type)!.armorValue : 0;
}

function costOf(world: World, entity: Entity): number {
  return (entity.kind === 'unit' ? world.rules.units.get(entity.type) : world.rules.buildings.get(entity.type))?.cost ?? 0;
}

/**
 * Integer damage of one hit. The armour-class percentage expresses how a damage
 * type fares against a class; AP additionally scales by (penetration ÷ armour)²,
 * capped at 100% and floored at `minPenetrationPercent` — a readable stand-in for
 * Spring:1944's steep pen/armour curve. Small arms and HE ignore thickness, so
 * armour is never penalised twice.
 */
export function damageOf(world: World, weapon: WeaponDef, shooterRank: number, target: Entity): number {
  const combat = world.rules.combat;
  const percent = combat.armorClasses[armorClassOf(world, target)][weapon.damageType];
  if (percent <= 0) return 0;
  let penetration = 100;
  const armor = armorValueOf(world, target);
  if (weapon.damageType === 'ap' && armor > 0) {
    penetration = Math.max(combat.minPenetrationPercent, Math.min(100, Math.floor(weapon.penetration * weapon.penetration * 100 / (armor * armor))));
  }
  const bonus = 100 + combat.veterancy.damagePercent[shooterRank];
  const resist = 100 - combat.veterancy.armorPercent[target.rank];
  return Math.max(1, Math.floor(weapon.damage * percent * penetration * bonus * resist / 100000000));
}

function canHit(world: World, weapon: WeaponDef, target: Entity): boolean {
  return weapon.targets.includes(layerOf(world, target)) && world.rules.combat.armorClasses[armorClassOf(world, target)][weapon.damageType] > 0;
}

function hostile(shooter: Entity, target: Entity): boolean {
  return target.owner >= 0 && target.owner !== shooter.owner && target.hp > 0;
}

function maxRange(world: World, def: UnitDef): number {
  let range = 0;
  for (const id of def.weapons) range = Math.max(range, world.rules.weapons.get(id)!.range);
  return range;
}

/** Whether every weapon that can hurt the target is blocked by its minimum range at this distance. */
function inDeadZone(world: World, def: UnitDef, target: Entity, d2: number): boolean {
  let blocked = false;
  for (const id of def.weapons) {
    const weapon = world.rules.weapons.get(id)!;
    if (!canHit(world, weapon, target)) continue;
    if (d2 >= weapon.minRange * weapon.minRange) return false;
    blocked = true;
  }
  return blocked;
}

/** Whether any of the unit's weapons can engage the target at all. */
function engageable(world: World, def: UnitDef, target: Entity): boolean {
  for (const id of def.weapons) if (canHit(world, world.rules.weapons.get(id)!, target)) return true;
  return false;
}

/**
 * Best visible enemy within weapon range: highest damage per reload against it,
 * then nearest, then lowest id. Recent attackers in range get priority.
 */
function acquire(world: World, unit: Entity, def: UnitDef): number {
  const air = def.movement === 'air';
  // Aircraft hunt anything they can see; ground units engage what is in range.
  const range = air ? Math.max(maxRange(world, def), def.vision * world.subTile) : maxRange(world, def);
  let best = -1;
  let bestScore = -1;
  let bestDistance = Infinity;
  world.grid.query(world, unit.x, unit.y, range, (other, d2) => {
    // Structures are attacked on explicit orders only (RA2 behaviour).
    if (other.kind !== 'unit' || !hostile(unit, other) || !canSee(world, unit.owner, other)) return;
    let score = 0;
    for (const id of def.weapons) {
      const weapon = world.rules.weapons.get(id)!;
      if (!canHit(world, weapon, other)) continue;
      if (!air && (d2 > weapon.range * weapon.range || d2 < weapon.minRange * weapon.minRange)) continue;
      score = Math.max(score, Math.floor(damageOf(world, weapon, unit.rank, other) * 1000 / weapon.reloadTicks));
    }
    if (score <= 0) return;
    if (other.id === unit.attacker) score *= 2;
    if (score > bestScore || (score === bestScore && (d2 < bestDistance || (d2 === bestDistance && other.id < best)))) {
      best = other.id; bestScore = score; bestDistance = d2;
    }
  });
  return best;
}

function validTarget(world: World, unit: Entity, def: UnitDef, id: number): Entity | null {
  if (id < 0) return null;
  const target = world.get(id);
  if (!target || !hostile(unit, target) || !canSee(world, unit.owner, target) || !engageable(world, def, target)) return null;
  return target;
}

function moving(unit: Entity): boolean {
  return unit.next >= 0 || unit.moveState === MoveState.Pending;
}

function updateShooter(world: World, unit: Entity, def: UnitDef): void {
  const combat = world.rules.combat;
  if (unit.cooldowns.length !== def.weapons.length) unit.cooldowns = def.weapons.map(() => 0);
  for (let i = 0; i < unit.cooldowns.length; i++) if (unit.cooldowns[i] > 0) unit.cooldowns[i]--;
  const air = def.movement === 'air';
  unit.setup = !air && moving(unit) ? 0 : unit.setup + 1;

  if (unit.amove >= 0 && unit.attack < 0) attackMove(world, unit, def, air);
  // Explicit orders persist while the target is valid and visible.
  let target = validTarget(world, unit, def, unit.attack);
  // An attack-move engagement that slipped inside minimum range is abandoned so the order can continue;
  // explicit attacks instead reposition (see chase).
  if (target && unit.amove >= 0 && !air && inDeadZone(world, def, target, (target.x - unit.x) ** 2 + (target.y - unit.y) ** 2)) {
    target = null;
    unit.aim = -1;
  }
  if (!target && unit.attack >= 0) { unit.attack = -1; }
  if (target) unit.aim = target.id;
  else {
    const current = validTarget(world, unit, def, unit.aim);
    const firesOnTheMove = def.weapons.some(id => world.rules.weapons.get(id)!.fireWhileMoving);
    const mayAcquire = (!moving(unit) || firesOnTheMove) && unit.task === '' && !unit.airMove;
    const due = (world.tick + unit.id) % combat.acquireIntervalTicks === 0;
    if (!mayAcquire) unit.aim = -1;
    else if (!current || due) unit.aim = acquire(world, unit, def);
    target = validTarget(world, unit, def, unit.aim);
    // Auto targets that drift out of range are dropped, not chased.
    if (target && !air) {
      const dx = target.x - unit.x;
      const dy = target.y - unit.y;
      const range = maxRange(world, def);
      if (dx * dx + dy * dy > range * range) { unit.aim = -1; target = null; }
    }
  }

  if (!target) {
    if (def.capabilities.turret) unit.turret = turnToward(unit.turret, unit.facing, def.turretTurnRate);
    if (air) { unit.target = -1; unit.airPass = -1; }
    return;
  }
  if (air) {
    if (unit.target !== target.id) unit.airPass = -1;
    unit.target = target.id;
  }
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const d2 = dx * dx + dy * dy;
  const bearing = byteAngle(dx, dy);

  if (!air && unit.attack === target.id) chase(world, unit, def, target, d2);

  if (def.capabilities.turret) unit.turret = turnToward(unit.turret, bearing, def.turretTurnRate);
  else if (!air && !moving(unit)) {
    const needsFacing = def.weapons.some(id => !world.rules.weapons.get(id)!.freeAim);
    if (needsFacing) unit.facing = turnToward(unit.facing, bearing, def.turnRate);
  }

  for (let i = 0; i < def.weapons.length; i++) {
    const weapon = world.rules.weapons.get(def.weapons[i])!;
    if (unit.cooldowns[i] > 0 || !canHit(world, weapon, target)) continue;
    if (d2 > weapon.range * weapon.range || d2 < weapon.minRange * weapon.minRange) continue;
    if (!air && moving(unit) && !weapon.fireWhileMoving) continue;
    if (!air && unit.setup < weapon.setupTicks) continue;
    if (!weapon.freeAim) {
      const heading = def.capabilities.turret ? unit.turret : unit.facing;
      if (Math.abs(angleDelta(heading, bearing)) > weapon.aimTolerance) continue;
    }
    if (!world.projectiles.hasRoom()) break; // deferred, not dropped: the cooldown is untouched
    const ground = weapon.projectile === 'arc';
    world.projectiles.spawn(unit.x, unit.y, target.x, target.y, ground ? -1 : target.id, unit.id, unit.owner, world.weaponIndex.get(weapon.id)!, unit.rank);
    unit.cooldowns[i] = Math.max(1, Math.floor(weapon.reloadTicks * (100 - combat.veterancy.reloadPercent[unit.rank]) / 100));
    world.events.push({ kind: 'fire', x: unit.x, y: unit.y, a: bearing, weapon: weapon.id, id: unit.id });
  }
}

/**
 * Attack-move: look for the nearest visible hostile within sight (units before
 * structures) and engage it as an ordered target; otherwise resume toward the
 * destination. Re-routing is rate-limited, and the order ends on arrival.
 */
function attackMove(world: World, unit: Entity, def: UnitDef, air: boolean): void {
  const resuming = unit.goal !== unit.amove;
  if (resuming || (world.tick + unit.id) % world.rules.combat.acquireIntervalTicks === 0) {
    const found = sighted(world, unit, def);
    if (found >= 0) {
      unit.attack = found;
      unit.aim = found;
      unit.chaseTick = -1000000;
      return;
    }
  }
  const w = world.nav.width;
  if (air) {
    if (unit.goal !== unit.amove) unit.goal = unit.amove;
    else if (unit.moveState === MoveState.Arrived) unit.amove = -1;
    return;
  }
  if (moving(unit)) return;
  const near = Math.max(Math.abs(unit.tile % w - unit.amove % w), Math.abs(((unit.tile / w) | 0) - ((unit.amove / w) | 0))) <= 2;
  if (near || unit.moveState === MoveState.Unreachable) { unit.amove = -1; return; }
  if (world.tick - unit.chaseTick < world.rules.combat.chaseRepathTicks) return;
  unit.chaseTick = world.tick;
  const goal = unit.amove;
  world.moveUnitTo(unit, goal);
  unit.amove = goal;
}

/** Nearest visible hostile the unit can hurt within its sight: units first, then structures. */
function sighted(world: World, unit: Entity, def: UnitDef): number {
  const s = world.subTile;
  let best = -1;
  let bestRank = Infinity;
  world.grid.query(world, unit.x, unit.y, Math.max(maxRange(world, def), def.vision * s), (other, d2) => {
    if (!hostile(unit, other) || !canSee(world, unit.owner, other) || !engageable(world, def, other)) return;
    if (def.movement !== 'air' && inDeadZone(world, def, other, d2)) return;
    const rank = (other.kind === 'unit' ? 0 : 1e15) + d2 * 1e5 + other.id;
    if (rank < bestRank) { bestRank = rank; best = other.id; }
  });
  return best;
}

/**
 * Close to weapon range of an ordered target, re-routing as it moves; halt once in range.
 * A target inside every usable weapon's minimum range makes the unit back off instead.
 */
function chase(world: World, unit: Entity, def: UnitDef, target: Entity, d2: number): void {
  let range = Infinity;
  let inner = Infinity;
  for (const id of def.weapons) {
    const weapon = world.rules.weapons.get(id)!;
    if (!canHit(world, weapon, target)) continue;
    range = Math.min(range, weapon.range);
    inner = Math.min(inner, weapon.minRange);
  }
  const tooClose = d2 < inner * inner;
  if (!tooClose && d2 <= range * range * 0.85) {
    if (unit.goal >= 0 && unit.task === '') world.stopUnit(unit);
    return;
  }
  if (world.tick - unit.chaseTick < world.rules.combat.chaseRepathTicks && unit.goal >= 0) return;
  unit.chaseTick = world.tick;
  const s = world.subTile;
  let px = target.x;
  let py = target.y;
  if (tooClose) {
    // Aim for the middle of the firing band, directly away from the target.
    let dx = unit.x - target.x;
    let dy = unit.y - target.y;
    if (dx === 0 && dy === 0) dx = 1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const want = (inner + Math.min(range, inner * 2)) / 2;
    px = target.x + Math.round(dx * want / length);
    py = target.y + Math.round(dy * want / length);
  }
  const tx = Math.max(0, Math.min(world.nav.width - 1, Math.floor(px / s)));
  const ty = Math.max(0, Math.min(world.nav.height - 1, Math.floor(py / s)));
  const tile = world.nav.index(tx, ty);
  const goal = world.nav.nearestInComponent(tile, world.nav.componentOf(unit.next >= 0 ? unit.next : unit.tile));
  if (goal >= 0 && goal !== unit.goal) {
    world.moveUnitTo(unit, goal);
    unit.attack = target.id;
  }
}

function updateProjectiles(world: World): void {
  const pool = world.projectiles;
  for (let i = 0; i < pool.capacity; i++) {
    if (!pool.active[i]) continue;
    pool.prevX[i] = pool.x[i];
    pool.prevY[i] = pool.y[i];
    const weapon = world.weaponList[pool.weapon[i]];
    if (pool.target[i] >= 0) {
      const target = world.get(pool.target[i]);
      if (target && target.hp > 0) { pool.tx[i] = target.x; pool.ty[i] = target.y; }
    }
    const dx = pool.tx[i] - pool.x[i];
    const dy = pool.ty[i] - pool.y[i];
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= weapon.projectileSpeed) {
      pool.x[i] = pool.tx[i];
      pool.y[i] = pool.ty[i];
      impact(world, i, weapon);
      pool.release(i);
      continue;
    }
    pool.x[i] += Math.round(dx * weapon.projectileSpeed / distance);
    pool.y[i] += Math.round(dy * weapon.projectileSpeed / distance);
    pool.travelled[i] += weapon.projectileSpeed;
  }
}

function impact(world: World, slot: number, weapon: WeaponDef): void {
  const pool = world.projectiles;
  const shooter = pool.shooter[slot];
  const owner = pool.owner[slot];
  const rank = pool.rank[slot];
  const x = pool.x[slot];
  const y = pool.y[slot];
  world.events.push({ kind: 'impact', x, y, a: 0, weapon: weapon.id, id: pool.target[slot] });
  if (weapon.splashRadius > 0) {
    const hits: Array<{ entity: Entity; d2: number }> = [];
    world.grid.query(world, x, y, weapon.splashRadius, (entity, d2) => {
      if (entity.hp > 0 && entity.owner >= 0 && entity.owner !== owner && canHit(world, weapon, entity)) hits.push({ entity, d2 });
    });
    hits.sort((a, b) => a.entity.id - b.entity.id);
    for (const { entity, d2 } of hits) {
      const falloff = Math.floor(weapon.splashFalloff * Math.sqrt(d2) / weapon.splashRadius);
      const amount = Math.floor(damageOf(world, weapon, rank, entity) * (100 - falloff) / 100);
      if (amount > 0) applyDamage(world, entity, amount, shooter);
    }
    return;
  }
  const target = world.get(pool.target[slot]);
  if (target && target.hp > 0 && canHit(world, weapon, target)) applyDamage(world, target, damageOf(world, weapon, rank, target), shooter);
}

export function applyDamage(world: World, target: Entity, amount: number, shooter: number): void {
  if (target.hp <= 0) return;
  target.hp -= amount;
  target.attacker = shooter;
  if (target.hp <= 0) {
    target.hp = 0;
    target.killer = shooter;
    world.deaths.push(target.id);
  }
}

function resolveDeaths(world: World): void {
  if (world.deaths.length === 0) return;
  world.deaths.sort((a, b) => a - b);
  const vet = world.rules.combat.veterancy;
  for (const id of world.deaths) {
    const dead = world.get(id);
    if (!dead) continue;
    const killer = world.get(dead.killer);
    if (killer && killer.hp > 0 && killer.owner !== dead.owner && killer.kind === 'unit') {
      killer.xp += costOf(world, dead);
      const own = Math.max(1, costOf(world, killer));
      let rank = 0;
      for (const threshold of vet.thresholdsPercent) if (killer.xp * 100 >= own * threshold) rank++;
      if (rank > killer.rank) {
        killer.rank = rank;
        world.events.push({ kind: 'promote', x: killer.x, y: killer.y, a: rank, weapon: '', id: killer.id });
      }
    }
    const loser = world.players[dead.owner];
    if (loser) { if (dead.kind === 'unit') loser.stats.unitsLost++; else loser.stats.buildingsLost++; }
    world.events.push({ kind: 'death', x: dead.x, y: dead.y, a: dead.kind === 'building' ? 2 : layerOf(world, dead) === 'air' ? 1 : 0, weapon: dead.type, id });
    world.remove(id);
  }
  world.deaths.length = 0;
}
