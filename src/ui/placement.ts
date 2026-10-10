import type { EntityLayer } from '../render/entity-layer.ts';
import { constructionProblem, deployOrigin } from '../sim/production.ts';
import type { ConstructionProblem } from '../sim/production.ts';
import type { BuildingDef } from '../sim/rules.ts';
import type { World } from '../sim/world.ts';

export type HudMode = '' | 'place' | 'sell' | 'repair';

const PROBLEM_TEXT: Record<string, string> = {
  bounds: 'too close to the map edge',
  terrain: 'unbuildable ground',
  structure: 'blocked by a structure',
  access: 'would block access',
  range: 'outside construction range',
  occupied: 'units will make way',
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
  problem: ConstructionProblem = '';
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
    const key = `${origin}|${world.nav.revision}|${occupants}`;
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    this.origin = origin;
    this.problem = origin < 0 ? 'bounds' : constructionProblem(world, player, def, origin);
  }

  draw(context: CanvasRenderingContext2D, world: World, layer: EntityLayer): void {
    if (this.mode !== 'place' || this.origin < 0) return;
    const def = world.rules.buildings.get(this.type)!;
    drawFootprint(context, world, def, this.origin, this.problem === '' ? 'ok' : this.problem === 'occupied' ? 'warn' : 'bad');
    const w = world.nav.width;
    const cx = (this.origin % w) + def.footprint.w / 2;
    const cy = ((this.origin / w) | 0) + def.footprint.h / 2;
    const sprite = layer.buildingSprite(world, def, world.players[0]?.faction ?? def.faction);
    context.globalAlpha = 0.55;
    context.drawImage(sprite.canvas, (cx - cy) * 32 - sprite.anchorX, (cx + cy) * 16 - sprite.anchorY);
    context.globalAlpha = 1;
  }
}

/** Tile diamonds over a footprint: green valid, amber units in the way, red invalid. */
export function drawFootprint(context: CanvasRenderingContext2D, world: World, def: BuildingDef, origin: number, state: 'ok' | 'warn' | 'bad'): void {
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
      const blocked = !world.buildable[tile] || world.nav.structure[tile] !== 0;
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
