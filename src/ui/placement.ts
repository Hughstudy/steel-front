import type { EntityLayer } from '../render/entity-layer.ts';
import { constructionProblem, deployOrigin, inConstructionRange } from '../sim/production.ts';
import type { ConstructionProblem } from '../sim/production.ts';
import type { BuildingDef } from '../sim/rules.ts';
import { footprintTiles } from '../sim/structures.ts';
import type { World } from '../sim/world.ts';

/** Placement problems as the player may know them; 'unexplored' never comes from live state. */
export type PreviewProblem = ConstructionProblem | 'unexplored';

export type HudMode = '' | 'place' | 'sell' | 'repair' | 'amove';

const PROBLEM_TEXT: Record<string, string> = {
  bounds: 'too close to the map edge',
  terrain: 'unbuildable ground',
  structure: 'blocked by a structure',
  access: 'would block access',
  range: 'outside construction range',
  occupied: 'units will make way',
  unexplored: 'unexplored ground',
};

export function problemText(problem: string): string { return PROBLEM_TEXT[problem] ?? problem; }

/**
 * Presentation state for HUD interaction modes: the placement ghost and the sell
 * and repair cursors. Validity comes from the same `constructionProblem` the
 * simulation runs again when the place command executes.
 */
export class Placement {
  mode: HudMode = '';
  type = '';
  origin = -1;
  problem: PreviewProblem = '';
  private cacheKey = '';

  start(mode: HudMode, type = ''): void {
    this.mode = mode;
    this.type = type;
    this.origin = -1;
    this.cacheKey = '';
  }

  cancel(): boolean {
    if (this.mode === '') return false;
    this.start('');
    return true;
  }

  /** Footprint origin with the pointer tile at the footprint centre. */
  originAt(world: World, def: BuildingDef, tileX: number, tileY: number): number {
    const x = Math.floor(tileX) - (def.footprint.w >> 1);
    const y = Math.floor(tileY) - (def.footprint.h >> 1);
    return world.nav.inBounds(x, y) ? world.nav.index(x, y) : -1;
  }

  /** Re-evaluate the ghost under the pointer (cached per tile and grid revision). */
  update(world: World, player: number, tileX: number, tileY: number): void {
    if (this.mode !== 'place') return;
    const def = world.rules.buildings.get(this.type);
    if (!def) { this.cancel(); return; }
    const origin = this.originAt(world, def, tileX, tileY);
    let occupants = 0;
    if (origin >= 0) {
      const w = world.nav.width;
      for (let dy = 0; dy < def.footprint.h; dy++) for (let dx = 0; dx < def.footprint.w; dx++) occupants += world.nav.occupancy[origin + dy * w + dx];
    }
    // Fog knowledge changes on its own interval, so the cache also expires with time when fog is on.
    const key = `${origin}|${world.nav.revision}|${occupants}|${world.fogEnabled ? world.tick >> 2 : 0}`;
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    this.origin = origin;
    this.problem = origin < 0 ? 'bounds' : previewProblem(world, player, def, origin);
  }

  draw(context: CanvasRenderingContext2D, world: World, layer: EntityLayer): void {
    if (this.mode !== 'place' || this.origin < 0) return;
    const def = world.rules.buildings.get(this.type)!;
    drawFootprint(context, world, def, this.origin, this.problem === '' ? 'ok' : this.problem === 'occupied' ? 'warn' : 'bad', 0);
    const w = world.nav.width;
    const cx = (this.origin % w) + def.footprint.w / 2;
    const cy = ((this.origin / w) | 0) + def.footprint.h / 2;
    const sprite = layer.buildingSprite(world, def, world.players[0]?.faction ?? def.faction);
    context.globalAlpha = 0.55;
    context.drawImage(sprite.canvas, (cx - cy) * 32 - sprite.anchorX, (cx + cy) * 16 - sprite.anchorY);
    context.globalAlpha = 1;
  }
}

/** Tiles covered by structures the player remembers (last-seen knowledge, not live state). */
function rememberedTiles(world: World, player: number): Set<number> {
  const tiles = new Set<number>();
  const fog = world.players[player]?.fog;
  if (!fog) return tiles;
  const s = world.subTile;
  const w = world.nav.width;
  for (const record of fog.memory.values()) {
    const def = world.rules.buildings.get(record.type);
    if (!def) continue;
    const ox = Math.round((record.x - (def.footprint.w * s >> 1)) / s);
    const oy = Math.round((record.y - (def.footprint.h * s >> 1)) / s);
    if (world.nav.inBounds(ox, oy)) for (const tile of footprintTiles(world, def, oy * w + ox)) tiles.add(tile);
  }
  return tiles;
}

/**
 * The placement verdict using only what `player` knows. Fully visible sites get the
 * authoritative live check; otherwise unexplored ground is refused and fogged tiles are
 * judged by terrain and remembered structures. The place command re-validates in the
 * simulation either way, so the preview never needs hidden live state.
 */
export function previewProblem(world: World, player: number, def: BuildingDef, origin: number): PreviewProblem {
  const fog = world.fogEnabled ? world.players[player]?.fog : undefined;
  const w = world.nav.width;
  const ox = origin % w;
  const oy = (origin / w) | 0;
  if (ox < 1 || oy < 1 || ox + def.footprint.w > w - 1 || oy + def.footprint.h > world.nav.height - 1) return 'bounds';
  const tiles = footprintTiles(world, def, origin);
  if (!fog || tiles.every(tile => fog.visible[tile])) return constructionProblem(world, player, def, origin);
  if (!inConstructionRange(world, player, def, origin)) return 'range';
  if (tiles.some(tile => !fog.explored[tile])) return 'unexplored';
  const remembered = rememberedTiles(world, player);
  for (const tile of tiles) {
    if (!world.buildable[tile]) return 'terrain';
    if (fog.visible[tile] ? world.nav.structure[tile] !== 0 : remembered.has(tile)) return 'structure';
  }
  for (const tile of tiles) if (fog.visible[tile] && world.nav.occupancy[tile] !== 0) return 'occupied';
  return '';
}

/**
 * Tile diamonds over a footprint: green valid, amber units in the way, red invalid.
 * With a `player`, per-tile blocking uses only that player's knowledge under fog.
 */
export function drawFootprint(context: CanvasRenderingContext2D, world: World, def: BuildingDef, origin: number, state: 'ok' | 'warn' | 'bad', player = -1): void {
  const fog = player >= 0 && world.fogEnabled ? world.players[player]?.fog : undefined;
  const remembered = fog ? rememberedTiles(world, player) : null;
  const w = world.nav.width;
  const ox = origin % w;
  const oy = (origin / w) | 0;
  const fill = state === 'ok' ? 'rgba(150,220,110,.35)' : state === 'warn' ? 'rgba(230,190,80,.4)' : 'rgba(225,80,60,.42)';
  const stroke = state === 'ok' ? 'rgba(190,240,150,.9)' : state === 'warn' ? 'rgba(240,210,120,.9)' : 'rgba(250,120,100,.9)';
  for (let dy = 0; dy < def.footprint.h; dy++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      const x = ox + dx;
      const y = oy + dy;
      if (!world.nav.inBounds(x, y)) continue;
      const tile = y * w + x;
      let blocked: boolean;
      if (!fog || fog.visible[tile]) blocked = !world.buildable[tile] || world.nav.structure[tile] !== 0;
      else blocked = fog.explored[tile] === 1 && (!world.buildable[tile] || remembered!.has(tile));
      const px = (x - y) * 32;
      const py = (x + y) * 16;
      context.beginPath();
      context.moveTo(px, py + 1);
      context.lineTo(px + 31, py + 16);
      context.lineTo(px, py + 31);
      context.lineTo(px - 31, py + 16);
      context.closePath();
      context.fillStyle = blocked ? 'rgba(225,80,60,.5)' : fill;
      context.fill();
      context.strokeStyle = stroke;
      context.lineWidth = 1;
      context.stroke();
    }
  }
}

/** Footprint preview for a selected MCV under the pointer. */
export function deployPreview(world: World, unitId: number, unitTile: number, def: BuildingDef): { origin: number; problem: ConstructionProblem } {
  const origin = deployOrigin(world, def, unitTile);
  if (origin < 0) return { origin, problem: 'bounds' };
  let problem = constructionProblem(world, -1, def, origin, false);
  if (problem === 'occupied') {
    // The deploying vehicle itself does not count as an obstruction.
    const w = world.nav.width;
    let others = false;
    for (let dy = 0; dy < def.footprint.h; dy++) {
      for (let dx = 0; dx < def.footprint.w; dx++) {
        const occupant = world.nav.occupancy[origin + dy * w + dx];
        if (occupant !== 0 && occupant !== unitId) others = true;
      }
    }
    if (!others) problem = '';
  }
  return { origin, problem };
}
