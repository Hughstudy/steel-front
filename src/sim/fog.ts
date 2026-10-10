import type { Entity } from './entities.ts';
import type { World } from './world.ts';

/** Last-seen knowledge of a structure: never its live health or activity. */
export interface MemoryRecord { id: number; type: string; owner: number; tile: number; x: number; y: number }

export interface PlayerFog {
  /** 1 where an owned vision source currently sees the tile. */
  visible: Uint8Array;
  /** 1 where the tile has ever been seen. */
  explored: Uint8Array;
  /** Structures as last observed, keyed by entity id. */
  memory: Map<number, MemoryRecord>;
}

const circles = new Map<number, Int32Array>();

/** Tile offsets (dx, dy pairs) within a vision radius, cached per radius. */
function circle(radius: number): Int32Array {
  let offsets = circles.get(radius);
  if (offsets) return offsets;
  const list: number[] = [];
  const r2 = radius * radius + radius;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= r2) list.push(dx, dy);
  offsets = Int32Array.from(list);
  circles.set(radius, offsets);
  return offsets;
}

export function createFog(size: number): PlayerFog {
  return { visible: new Uint8Array(size), explored: new Uint8Array(size), memory: new Map() };
}

export function tileOf(world: World, entity: Entity): number {
  const s = world.subTile;
  const x = Math.max(0, Math.min(world.nav.width - 1, Math.floor(entity.x / s)));
  const y = Math.max(0, Math.min(world.nav.height - 1, Math.floor(entity.y / s)));
  return y * world.nav.width + x;
}

function visionOf(world: World, entity: Entity): number {
  return entity.kind === 'unit' ? world.rules.units.get(entity.type)!.vision : world.rules.buildings.get(entity.type)!.vision;
}

/**
 * Recompute every player's visible mask from owned vision sources, extend the
 * explored mask, and refresh structure memory for what is in sight. Runs on a
 * fixed tick interval so AI and targeting see identical, deterministic masks.
 */
export function updateFog(world: World, force = false): void {
  if (!force && world.tick % world.rules.combat.fogIntervalTicks !== 0) return;
  world.fogVersion++;
  const nav = world.nav;
  const w = nav.width;
  for (const player of world.players) {
    const fog = player.fog;
    fog.visible.fill(0);
    for (const entity of world.entities) {
      if (entity.owner !== player.index || entity.hp <= 0) continue;
      const tile = tileOf(world, entity);
      const cx = tile % w;
      const cy = (tile / w) | 0;
      const offsets = circle(visionOf(world, entity));
      for (let i = 0; i < offsets.length; i += 2) {
        const x = cx + offsets[i];
        const y = cy + offsets[i + 1];
        if (x < 0 || y < 0 || x >= w || y >= nav.height) continue;
        fog.visible[y * w + x] = 1;
      }
    }
    for (let i = 0; i < fog.visible.length; i++) fog.explored[i] |= fog.visible[i];
    // Forget structures seen to be gone; record everything currently in sight.
    for (const [id, record] of fog.memory) {
      const live = world.get(id);
      if (fog.visible[record.tile] && (!live || live.hp <= 0)) fog.memory.delete(id);
    }
    for (const entity of world.entities) {
      if (entity.kind !== 'building' || entity.owner === player.index || entity.hp <= 0) continue;
      const tile = tileOf(world, entity);
      if (fog.visible[tile]) fog.memory.set(entity.id, { id: entity.id, type: entity.type, owner: entity.owner, tile, x: entity.x, y: entity.y });
    }
  }
}

/** Whether `player` currently has sight of the entity (own entities always). */
export function canSee(world: World, player: number, entity: Entity): boolean {
  if (entity.owner === player || !world.fogEnabled) return true;
  const state = world.players[player];
  return !!state && state.fog.visible[tileOf(world, entity)] === 1;
}
