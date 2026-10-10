import type { Entity } from '../sim/entities.ts';
import { angleDelta } from '../sim/angles.ts';
import type { BuildingDef } from '../sim/rules.ts';
import type { World } from '../sim/world.ts';
import type { CameraView } from '../types.ts';
import { bakeBuilding } from './building-atlas.ts';
import type { BuildingSprite } from './building-atlas.ts';
import { bakeUnit, DIRECTIONS, drawSheet } from './unit-atlas.ts';
import type { UnitSprites } from './unit-atlas.ts';

const CAPACITY = 4096;

/** Interface the terrain renderer uses to interleave entities with scenery depth. */
export interface DepthLayer {
  drawUpTo(context: CanvasRenderingContext2D, depth: number): void;
  drawRest(context: CanvasRenderingContext2D): void;
}

export interface LayerOptions {
  selected: ReadonlySet<number>;
  hovered: number;
  /** Entity ids the local player may see this frame (null = everything). */
  visible?: ((entity: Entity) => boolean) | null;
  /** Remembered structures drawn in place of unseen live ones (fog memory). */
  ghosts?: Iterable<Entity>;
}

/**
 * Visible-entity list for one frame: interpolated positions, depth-sorted with a
 * reusable insertion sort (frame-to-frame order barely changes). Buildings sort
 * by their front-most footprint tile so units behind them are drawn first.
 */
export class EntityLayer implements DepthLayer {
  count = 0;
  readonly ids = new Int32Array(CAPACITY);
  readonly screenX = new Float64Array(CAPACITY);
  readonly screenY = new Float64Array(CAPACITY);
  readonly depth = new Float64Array(CAPACITY);
  private readonly order = new Int32Array(CAPACITY);
  private readonly refs: Array<Entity | null> = new Array(CAPACITY).fill(null);
  private readonly sprites = new Map<string, UnitSprites>();
  private readonly buildings = new Map<string, BuildingSprite>();
  private cursor = 0;
  private world: World | null = null;
  private options: LayerOptions = { selected: new Set(), hovered: 0 };
  private alpha = 0;

  private factionOf(world: World, entity: Entity, fallback: string): string {
    const owner = world.players[entity.owner];
    return owner ? owner.faction : fallback;
  }

  spritesFor(world: World, entity: Entity): UnitSprites {
    const def = world.rules.units.get(entity.type)!;
    const faction = this.factionOf(world, entity, def.faction);
    const key = `${entity.type}|${faction}`;
    let sprites = this.sprites.get(key);
    if (!sprites) {
      sprites = bakeUnit(def.visual, world.rules.factions.get(faction) ?? world.rules.factions.get(def.faction)!);
      this.sprites.set(key, sprites);
    }
    return sprites;
  }

  buildingFor(world: World, entity: Entity): BuildingSprite {
    const def = world.rules.buildings.get(entity.type)!;
    return this.buildingSprite(world, def, this.factionOf(world, entity, def.faction));
  }

  buildingSprite(world: World, def: BuildingDef, faction: string): BuildingSprite {
    const key = `${def.id}|${faction}`;
    let sprite = this.buildings.get(key);
    if (!sprite) {
      sprite = bakeBuilding(def, world.rules.factions.get(faction) ?? null);
      this.buildings.set(key, sprite);
    }
    return sprite;
  }

  /** Bake sprite sheets for everything present up front, so no frame pays for it. */
  warm(world: World): void {
    for (const entity of world.entities) {
      if (entity.kind === 'unit') this.spritesFor(world, entity);
      else this.buildingFor(world, entity);
    }
    // Everything the players could produce, so construction never bakes mid-frame.
    for (const player of world.players) {
      for (const def of world.rules.buildings.values()) if (def.faction === player.faction) this.buildingSprite(world, def, player.faction);
      for (const def of world.rules.units.values()) {
        if (def.faction !== player.faction || this.sprites.has(`${def.id}|${player.faction}`)) continue;
        this.sprites.set(`${def.id}|${player.faction}`, bakeUnit(def.visual, world.rules.factions.get(player.faction)!));
      }
    }
  }

  prepare(world: World, view: CameraView, alpha: number, options: LayerOptions): void {
    this.world = world;
    this.options = options;
    this.alpha = alpha;
    const s = world.subTile;
    const halfW = view.width / (2 * view.zoom) + 120;
    const halfH = view.height / (2 * view.zoom) + 120;
    let count = 0;
    const sources: Iterable<Entity>[] = options.ghosts ? [world.entities, options.ghosts] : [world.entities];
    for (const source of sources) for (const entity of source) {
      if (count >= CAPACITY) break;
      if (source === world.entities && options.visible && !options.visible(entity)) continue;
      const tx = (entity.prevX + (entity.x - entity.prevX) * alpha) / s;
      const ty = (entity.prevY + (entity.y - entity.prevY) * alpha) / s;
      const sx = (tx - ty) * 32;
      const sy = (tx + ty) * 16;
      if (Math.abs(sx - view.x) > halfW || Math.abs(sy - view.y) > halfH) continue;
      let depth = tx + ty;
      // Aircraft fly above everything on the ground.
      if (entity.kind === 'unit' && world.rules.units.get(entity.type)!.movement === 'air') depth += 1000;
      if (entity.kind === 'building') {
        const def = world.rules.buildings.get(entity.type)!;
        depth += (def.footprint.w + def.footprint.h) / 2 - 1;
      }
      this.ids[count] = entity.id;
      this.refs[count] = entity;
      this.screenX[count] = sx;
      this.screenY[count] = sy;
      this.depth[count] = depth;
      count++;
    }
    for (let i = count; i < this.count; i++) this.refs[i] = null;
    this.count = count;
    for (let i = 0; i < count; i++) this.order[i] = i;
    for (let i = 1; i < count; i++) {
      const item = this.order[i];
      const d = this.depth[item];
      let j = i - 1;
      while (j >= 0 && this.depth[this.order[j]] > d) { this.order[j + 1] = this.order[j]; j--; }
      this.order[j + 1] = item;
    }
    this.cursor = 0;
  }

  drawUpTo(context: CanvasRenderingContext2D, depth: number): void {
    while (this.cursor < this.count && this.depth[this.order[this.cursor]] <= depth) this.drawOne(context, this.order[this.cursor++]);
  }

  drawRest(context: CanvasRenderingContext2D): void {
    while (this.cursor < this.count) this.drawOne(context, this.order[this.cursor++]);
  }

  private ring(context: CanvasRenderingContext2D, entity: Entity, x: number, y: number): void {
    const selected = this.options.selected.has(entity.id);
    if (!selected && this.options.hovered !== entity.id) return;
    context.strokeStyle = selected ? 'rgba(236,240,190,.95)' : 'rgba(236,240,190,.45)';
    context.lineWidth = 1.2;
    context.beginPath();
    if (entity.kind === 'building') {
      const def = this.world!.rules.buildings.get(entity.type)!;
      const hw = def.footprint.w / 2;
      const hh = def.footprint.h / 2;
      context.moveTo(x + (-hw + hh) * 32, y + (-hw - hh) * 16);
      context.lineTo(x + (hw + hh) * 32, y + (hw - hh) * 16);
      context.lineTo(x + (hw - hh) * 32, y + (hw + hh) * 16);
      context.lineTo(x + (-hw - hh) * 32, y + (-hw + hh) * 16);
      context.closePath();
    } else {
      const radius = this.spritesFor(this.world!, entity).radius;
      context.ellipse(x, y + 1, radius, radius * 0.5, 0, 0, Math.PI * 2);
    }
    context.stroke();
  }

  private drawOne(context: CanvasRenderingContext2D, index: number): void {
    const world = this.world!;
    const entity = this.refs[index]!;
    const x = this.screenX[index];
    const y = this.screenY[index];
    this.ring(context, entity, x, y);
    if (entity.kind === 'building') {
      const sprite = this.buildingFor(world, entity);
      context.drawImage(sprite.canvas, x - sprite.anchorX, y - sprite.anchorY);
      return;
    }
    const sprites = this.spritesFor(world, entity);
    const facing = interpolateAngle(entity.prevFacing, entity.facing, this.alpha);
    if (sprites.air) {
      const lift = world.rules.combat.air.altitude;
      context.fillStyle = 'rgba(14,20,14,.28)';
      context.beginPath(); context.ellipse(x, y, sprites.radius * 0.9, sprites.radius * 0.4, 0, 0, Math.PI * 2); context.fill();
      const direction = Math.round(facing / (256 / DIRECTIONS)) % DIRECTIONS;
      drawSheet(context, sprites.body, direction, (world.tick >> 1) & 1, x, y - lift);
      return;
    }
    const direction = Math.round(facing / (256 / DIRECTIONS)) % DIRECTIONS;
    const moving = entity.next >= 0;
    let frame = 0;
    if (sprites.body.frames >= 5) frame = moving ? 1 + ((entity.odometer >> 8) & 3) : 0;
    else if (sprites.body.frames === 2) {
      const cargo = world.rules.units.get(entity.type)!.capabilities.cargo;
      frame = typeof cargo === 'number' ? (entity.cargo > 0 ? 1 : 0) : moving ? (entity.odometer >> 7) & 1 : 0;
    }
    drawSheet(context, sprites.body, direction, frame, x, y);
    if (sprites.turret) {
      const turret = interpolateAngle(entity.prevTurret, entity.turret, this.alpha);
      const hull = facing / 256 * Math.PI * 2;
      const offU = Math.cos(hull) * sprites.turretOffset;
      const offV = Math.sin(hull) * sprites.turretOffset;
      drawSheet(context, sprites.turret, Math.round(turret / (256 / DIRECTIONS)) % DIRECTIONS, 0, x + (offU - offV) * 32, y + (offU + offV) * 16);
    }
  }

  private maxHp(world: World, entity: Entity): number {
    return entity.kind === 'unit' ? world.rules.units.get(entity.type)!.hp : world.rules.buildings.get(entity.type)!.hp;
  }

  private topOf(world: World, entity: Entity): number {
    if (entity.kind !== 'unit') return this.buildingFor(world, entity).top * 0.75;
    const sprites = this.spritesFor(world, entity);
    return sprites.top + (sprites.air ? world.rules.combat.air.altitude : 0);
  }

  /** Health bars, cargo and progress above every sprite for readability. */
  drawOverlays(context: CanvasRenderingContext2D): void {
    const world = this.world;
    if (!world) return;
    for (let i = 0; i < this.count; i++) {
      const entity = this.refs[i]!;
      const selected = this.options.selected.has(entity.id);
      const maxHp = this.maxHp(world, entity);
      const capturing = entity.task === 'capture' && entity.timer > 0;
      if (entity.rank > 0) this.chevrons(context, entity.rank, this.screenX[i] + 12, this.screenY[i] - this.topOf(world, entity) + 2);
      if (!selected && entity.hp >= maxHp && !capturing) continue;
      const width = entity.kind === 'building' ? 46 : Math.max(18, this.spritesFor(world, entity).radius * 1.3);
      const x = this.screenX[i] - width / 2;
      const y = this.screenY[i] - this.topOf(world, entity) - 8;
      const ratio = Math.max(0, entity.hp / maxHp);
      context.fillStyle = 'rgba(16,22,16,.85)';
      context.fillRect(x - 1, y - 1, width + 2, 4.5);
      context.fillStyle = ratio > 0.6 ? '#9fd36b' : ratio > 0.3 ? '#e1c34e' : '#df5b43';
      context.fillRect(x, y, width * ratio, 2.5);
      const cargo = entity.kind === 'unit' ? world.rules.units.get(entity.type)!.capabilities.cargo : undefined;
      if (typeof cargo === 'number' && selected) {
        context.fillStyle = 'rgba(16,22,16,.85)';
        context.fillRect(x - 1, y + 4, width + 2, 3.5);
        context.fillStyle = '#e7c66b';
        context.fillRect(x, y + 5, width * entity.cargo / cargo, 1.5);
      }
      if (capturing) {
        const progress = Math.min(1, entity.timer / world.rules.economy.captureTicks);
        context.fillStyle = 'rgba(16,22,16,.85)';
        context.fillRect(x - 1, y - 7, width + 2, 4);
        context.fillStyle = '#7fc6e0';
        context.fillRect(x, y - 6, width * progress, 2);
      }
    }
  }

  /** Veterancy insignia: one chevron for veteran, two for elite. */
  private chevrons(context: CanvasRenderingContext2D, rank: number, x: number, y: number): void {
    context.strokeStyle = 'rgba(16,22,16,.9)';
    context.lineWidth = 3;
    for (let pass = 0; pass < 2; pass++) {
      for (let r = 0; r < rank; r++) {
        const cy = y - r * 4;
        context.beginPath();
        context.moveTo(x - 4, cy - 2); context.lineTo(x, cy + 1); context.lineTo(x + 4, cy - 2);
        context.stroke();
      }
      context.strokeStyle = rank > 1 ? '#f2d36b' : '#e6e0bf';
      context.lineWidth = 1.4;
    }
  }

  /** Front-most visible entity under a world-pixel point. */
  pick(worldX: number, worldY: number, filter: (entity: Entity) => boolean): Entity | null {
    const world = this.world;
    if (!world) return null;
    let best: Entity | null = null;
    let bestDepth = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const entity = this.refs[i]!;
      if (!filter(entity)) continue;
      const dx = worldX - this.screenX[i];
      const dy = worldY - this.screenY[i];
      if (entity.kind === 'building') {
        const sprite = this.buildingFor(world, entity);
        const inside = Math.abs(dx) / sprite.halfWidth + Math.abs(dy) / sprite.halfHeight <= 1;
        const above = Math.abs(dx) < sprite.halfWidth * 0.6 && dy < 0 && dy > -sprite.halfHeight - sprite.top * 0.6;
        if (!inside && !above) continue;
      } else {
        const sprites = this.spritesFor(world, entity);
        const r = Math.max(sprites.radius, 12);
        const ly = sprites.air ? dy + world.rules.combat.air.altitude : dy;
        if (Math.abs(dx) > r || ly > r * 0.6 || ly < -sprites.top) continue;
      }
      // Units in front of buildings win; otherwise the front-most entity.
      const depth = this.depth[i] + (entity.kind === 'unit' ? 1000 : 0);
      if (depth > bestDepth) { bestDepth = depth; best = entity; }
    }
    return best;
  }

  /** Visible entities whose ground point lies in a world-pixel rectangle. */
  inRect(left: number, top: number, right: number, bottom: number, filter: (entity: Entity) => boolean): Entity[] {
    const result: Entity[] = [];
    for (let i = 0; i < this.count; i++) {
      const entity = this.refs[i]!;
      const x = this.screenX[i];
      const y = this.screenY[i] - 6;
      if (x >= left && x <= right && y >= top && y <= bottom && filter(entity)) result.push(entity);
    }
    return result;
  }

  visible(filter: (entity: Entity) => boolean): Entity[] {
    const result: Entity[] = [];
    for (let i = 0; i < this.count; i++) if (filter(this.refs[i]!)) result.push(this.refs[i]!);
    return result;
  }
}

export function interpolateAngle(previous: number, current: number, alpha: number): number {
  const value = previous + angleDelta(previous, current) * alpha;
  return ((value % 256) + 256) % 256;
}
