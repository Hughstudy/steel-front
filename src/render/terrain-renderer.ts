import type { CameraView, MapConfig, TerrainMap } from '../types';
import { createGroundAtlas, paintRoad } from './ground';
import { createPropAtlas } from './props';
import type { DepthLayer } from './entity-layer';

interface GroundChunk {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}

const CHUNK_TILES = 16;
const PADDING = 4;

/** Static surfaces are baked once. Camera motion only blits visible chunks/sprites. */
export class TerrainRenderer {
  visibleChunks = 0;
  drawCalls = 0;
  readonly totalChunks: number;
  private readonly context: CanvasRenderingContext2D;
  private readonly chunks: GroundChunk[] = [];
  private readonly sprites = createPropAtlas();
  private readonly backdrop: string;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly map: TerrainMap, config: MapConfig) {
    this.context = canvas.getContext('2d', { alpha: false })!;
    this.backdrop = config.palette.background;
    const atlas = createGroundAtlas(config);
    for (let chunkY = 0; chunkY < map.height; chunkY += CHUNK_TILES) {
      for (let chunkX = 0; chunkX < map.width; chunkX += CHUNK_TILES) {
        this.chunks.push(this.bakeChunk(chunkX, chunkY, atlas));
      }
    }
    this.totalChunks = this.chunks.length;
  }

  private bakeChunk(chunkX: number, chunkY: number, atlas: HTMLCanvasElement[]): GroundChunk {
    const canvas = document.createElement('canvas');
    canvas.width = CHUNK_TILES * 64 + PADDING * 2;
    canvas.height = CHUNK_TILES * 32 + PADDING * 2;
    const context = canvas.getContext('2d')!;
    const offsetX = CHUNK_TILES * 32 + PADDING;
    for (let diagonal = 0; diagonal < CHUNK_TILES * 2 - 1; diagonal++) {
      for (let localY = Math.max(0, diagonal - CHUNK_TILES + 1); localY <= Math.min(CHUNK_TILES - 1, diagonal); localY++) {
        const localX = diagonal - localY;
        const x = chunkX + localX;
        const y = chunkY + localY;
        if (x >= this.map.width || y >= this.map.height) continue;
        const index = y * this.map.width + x;
        const terrain = this.map.tiles[index];
        const variant = this.map.variants[index] & 7;
        const px = (localX - localY) * 32 + offsetX - 32;
        const py = (localX + localY) * 16 + PADDING;
        // Bridge surfaces are painted on water; roads sit on meadow shoulders.
        const base = terrain === 6 ? 2 : terrain === 4 ? 0 : terrain;
        context.drawImage(atlas[base * 8 + variant], px - 1, py - 1);
      }
    }
    // Paint connected lanes after ground so later ground tiles cannot clip road joints.
    for (let localY = 0; localY < CHUNK_TILES; localY++) {
      for (let localX = 0; localX < CHUNK_TILES; localX++) {
        const x = chunkX + localX;
        const y = chunkY + localY;
        if (x >= this.map.width || y >= this.map.height) continue;
        const terrain = this.map.tiles[y * this.map.width + x];
        if (terrain !== 4 && terrain !== 6) continue;
        context.save();
        context.translate((localX - localY) * 32 + offsetX - 32, (localX + localY) * 16 + PADDING);
        paintRoad(context, this.map, x, y);
        context.restore();
      }
    }
    return {
      canvas,
      x: (chunkX - chunkY) * 32 - CHUNK_TILES * 32 - PADDING,
      y: (chunkX + chunkY) * 16 - PADDING,
    };
  }

  render(view: CameraView, timeSeconds: number, showGrid: boolean, layer: DepthLayer | null = null): void {
    const context = this.context;
    const dpr = this.canvas.width / view.width;
    const scale = dpr * view.zoom;
    const halfWidth = view.width / (2 * view.zoom);
    const halfHeight = view.height / (2 * view.zoom);
    const left = view.x - halfWidth;
    const top = view.y - halfHeight;
    const right = view.x + halfWidth;
    const bottom = view.y + halfHeight;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = this.backdrop;
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    context.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
    context.imageSmoothingEnabled = true;
    this.visibleChunks = 0;
    this.drawCalls = 0;

    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      if (chunk.x + chunk.canvas.width < left || chunk.x > right || chunk.y + chunk.canvas.height < top || chunk.y > bottom) continue;
      context.drawImage(chunk.canvas, chunk.x, chunk.y);
      this.visibleChunks++;
      this.drawCalls++;
    }

    // Inverse-project viewport corners. The generous upper margin preserves tall props.
    const minX = Math.max(0, Math.floor(left / 64 + top / 32) - 2);
    const maxX = Math.min(this.map.width - 1, Math.ceil(right / 64 + (bottom + 80) / 32) + 2);
    const minY = Math.max(0, Math.floor(top / 32 - right / 64) - 2);
    const maxY = Math.min(this.map.height - 1, Math.ceil((bottom + 80) / 32 - left / 64) + 2);
    const shimmer = Math.sin(timeSeconds * .65) * .045 + .055;

    for (let diagonal = minX + minY; diagonal <= maxX + maxY; diagonal++) {
      // Entities whose ground point is behind this diagonal's tile centres draw first.
      if (layer) layer.drawUpTo(context, diagonal + 1);
      const startY = Math.max(minY, diagonal - maxX);
      const endY = Math.min(maxY, diagonal - minX);
      for (let y = startY; y <= endY; y++) {
        const x = diagonal - y;
        const px = (x - y) * 32;
        const py = diagonal * 16 + 16;
        if (px + 48 < left || px - 48 > right || py + 24 < top || py - 68 > bottom) continue;
        const index = y * this.map.width + x;
        const prop = this.map.props[index];
        if (prop) {
          context.drawImage(this.sprites[(prop - 1) * 4 + (this.map.variants[index] & 3)], px - 44, py - 68);
          this.drawCalls++;
        } else if (this.map.tiles[index] === 2 && (this.map.variants[index] & 7) === 0) {
          context.globalAlpha = shimmer;
          context.fillStyle = '#e1e3c6';
          context.fillRect(px - 8, py + (this.map.variants[index] & 3), 13, .75);
          context.globalAlpha = 1;
        }
      }
    }
    if (layer) layer.drawRest(context);
    if (showGrid) this.drawGrid(context, minX, maxX, minY, maxY, view.zoom);
  }

  private drawGrid(context: CanvasRenderingContext2D, minX: number, maxX: number, minY: number, maxY: number, zoom: number): void {
    context.beginPath();
    for (let x = minX; x <= maxX + 1; x++) {
      context.moveTo((x - minY) * 32, (x + minY) * 16);
      context.lineTo((x - maxY - 1) * 32, (x + maxY + 1) * 16);
    }
    for (let y = minY; y <= maxY + 1; y++) {
      context.moveTo((minX - y) * 32, (minX + y) * 16);
      context.lineTo((maxX + 1 - y) * 32, (maxX + 1 + y) * 16);
    }
    context.lineWidth = .65 / zoom;
    context.strokeStyle = 'rgba(235,229,185,.20)';
    context.stroke();
  }
}
