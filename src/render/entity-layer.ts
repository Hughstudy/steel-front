import type { Entity } from '../sim/entities.ts';
import { angleDelta } from '../sim/angles.ts';
import type { World } from '../sim/world.ts';
import type { CameraView } from '../types.ts';
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
}

/**
 * Visible-entity list for one frame: interpolated positions, depth-sorted with a
 * reusable insertion sort (frame-to-frame order barely changes).
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
  private cursor = 0;
  private world: World | null = null;
  private options: LayerOptions = { selected: new Set(), hovered: 0 };
  private alpha = 0;

  spritesFor(world: World, entity: Entity): UnitSprites {
    const owner = world.players[entity.owner];
    const key = `${entity.type}|${owner ? owner.faction : 'neutral'}`;
    let sprites = this.sprites.get(key);
    if (!sprites) {
      const def = world.rules.units.get(entity.type)!;
      const faction = world.rules.factions.get(owner ? owner.faction : def.faction) ?? world.rules.factions.get(def.faction)!;
      sprites = bakeUnit(def.visual, faction);
      this.sprites.set(key, sprites);
    }
    return sprites;
  }

  /** Bake all sprite sheets a world may need up front, so no frame pays for it. */
  warm(world: World): void {
    for (const entity of world.entities) if (entity.kind === 'unit') this.spritesFor(world, entity);
  }

  prepare(world: World, view: CameraView, alpha: number, options: LayerOptions): void {
    this.world = world;
    this.options = options;
    this.alpha = alpha;
    const s = world.subTile;
    const halfW = view.width / (2 * view.zoom) + 80;
    const halfH = view.height / (2 * view.zoom) + 90;
    let count = 0;
    for (const entity of world.entities) {
      if (count >= CAPACITY) break;
      const tx = (entity.prevX + (entity.x - entity.prevX) * alpha) / s;
      const ty = (entity.prevY + (entity.y - entity.prevY) * alpha) / s;
      const sx = (tx - ty) * 32;
      const sy = (tx + ty) * 16;
      if (Math.abs(sx - view.x) > halfW || Math.abs(sy - view.y) > halfH) continue;
      this.ids[count] = entity.id;
      this.refs[count] = entity;
      this.screenX[count] = sx;
      this.screenY[count] = sy;
      this.depth[count] = tx + ty;
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

  private drawOne(context: CanvasRenderingContext2D, index: number): void {
    const world = this.world!;
    const entity = this.refs[index]!;
    const sprites = this.spritesFor(world, entity);
    const x = this.screenX[index];
    const y = this.screenY[index];
    if (this.options.selected.has(entity.id) || this.options.hovered === entity.id) {
      context.strokeStyle = this.options.selected.has(entity.id) ? 'rgba(236,240,190,.95)' : 'rgba(236,240,190,.45)';
      context.lineWidth = 1.2;
      context.beginPath();
      context.ellipse(x, y + 1, sprites.radius, sprites.radius * 0.5, 0, 0, Math.PI * 2);
      context.stroke();
    }
    const facing = interpolateAngle(entity.prevFacing, entity.facing, this.alpha);
    const direction = Math.round(facing / (256 / DIRECTIONS)) % DIRECTIONS;
    const moving = entity.next >= 0;
    let frame = 0;
    if (sprites.body.frames >= 5) frame = moving ? 1 + ((entity.odometer >> 8) & 3) : 0;
    else if (sprites.body.frames === 2) frame = this.frameFor(entity, moving);
    drawSheet(context, sprites.body, direction, frame, x, y);
    if (sprites.turret) {
      const turret = interpolateAngle(entity.prevTurret, entity.turret, this.alpha);
      const hull = facing / 256 * Math.PI * 2;
      const offU = Math.cos(hull) * sprites.turretOffset;
      const offV = Math.sin(hull) * sprites.turretOffset;
      drawSheet(context, sprites.turret, Math.round(turret / (256 / DIRECTIONS)) % DIRECTIONS, 0, x + (offU - offV) * 32, y + (offU + offV) * 16);
    }
  }

  /** Two-frame sheets: tracked vehicles animate treads; trucks show cargo. */
  protected frameFor(entity: Entity, moving: boolean): number {
    return moving ? (entity.odometer >> 7) & 1 : 0;
  }

  /** Health bars and markers above every sprite for readability. */
  drawOverlays(context: CanvasRenderingContext2D): void {
    const world = this.world;
    if (!world) return;
    for (let i = 0; i < this.count; i++) {
      const entity = this.refs[i]!;
      const selected = this.options.selected.has(entity.id);
      const def = world.rules.units.get(entity.type);
      if (!def) continue;
      if (!selected && entity.hp >= def.hp) continue;
      const sprites = this.spritesFor(world, entity);
      const width = Math.max(18, sprites.radius * 1.3);
      const x = this.screenX[i] - width / 2;
      const y = this.screenY[i] - sprites.top - 8;
      const ratio = Math.max(0, entity.hp / def.hp);
      context.fillStyle = 'rgba(16,22,16,.85)';
      context.fillRect(x - 1, y - 1, width + 2, 4.5);
      context.fillStyle = ratio > 0.6 ? '#9fd36b' : ratio > 0.3 ? '#e1c34e' : '#df5b43';
      context.fillRect(x, y, width * ratio, 2.5);
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
      const sprites = this.spritesFor(world, entity);
      const dx = worldX - this.screenX[i];
      const dy = worldY - this.screenY[i];
      const r = Math.max(sprites.radius, 12);
      if (Math.abs(dx) > r || dy > r * 0.6 || dy < -sprites.top) continue;
      if (this.depth[i] > bestDepth) { bestDepth = this.depth[i]; best = entity; }
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
