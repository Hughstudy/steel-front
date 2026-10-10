import type { CameraView, MapConfig, TerrainMap } from '../types.ts';

/** Minimap markers supplied by the game each frame (tile-space centres). */
export interface MinimapDots {
  count: number;
  x: Float32Array;
  y: Float32Array;
  color: string[];
}

const terrainKeys = ['grass', 'forest', 'water', 'sand', 'road', 'rock', 'bridge', 'field'];
const fallbackColors = ['#7e8761', '#5f704e', '#588082', '#afa184', '#b7a987', '#929486', '#998f74', '#a49c65'];

/** A cached isometric overview in the same projected coordinates as the battlefield. */
export class Minimap {
  private readonly context: CanvasRenderingContext2D;
  private readonly background = document.createElement('canvas');
  private readonly map: TerrainMap;
  private readonly config: MapConfig;
  private readonly jump: (tileX: number, tileY: number) => void;
  private readonly canvas: HTMLCanvasElement;
  private cssWidth = 200;
  private cssHeight = 100;
  private scale = 1;
  private originX = 0;
  private originY = 0;
  private dragging = false;
  private lastTileX = 64;
  private lastTileY = 64;
  private readonly observer: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, map: TerrainMap, config: MapConfig,
    jump: (tileX: number, tileY: number) => void) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d')!;
    this.map = map;
    this.config = config;
    this.jump = jump;
    this.lastTileX = config.spawn.x;
    this.lastTileY = config.spawn.y;
    this.createBackground();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      this.dragging = true;
      canvas.setPointerCapture(event.pointerId);
      this.moveTo(event);
    });
    canvas.addEventListener('pointermove', event => { if (this.dragging) this.moveTo(event); });
    canvas.addEventListener('pointerup', () => { this.dragging = false; });
    canvas.addEventListener('lostpointercapture', () => { this.dragging = false; });
    canvas.addEventListener('keydown', event => {
      if (event.code !== 'Enter') return;
      event.preventDefault();
      this.jump(this.map.width / 2, this.map.height / 2);
    });
  }

  render(view: CameraView, dots: MinimapDots | null = null): void {
    const ctx = this.context;
    const scale = this.scale;
    const ox = this.originX;
    const oy = this.originY;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.drawImage(this.background, ox - this.map.height * this.config.tileWidth / 2 * scale, oy,
      this.background.width / 2 * this.config.tileWidth / 2 * scale,
      this.background.height / 2 * this.config.tileHeight / 2 * scale);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + this.map.width * this.config.tileWidth / 2 * scale,
      oy + this.map.width * this.config.tileHeight / 2 * scale);
    ctx.lineTo(ox + (this.map.width - this.map.height) * this.config.tileWidth / 2 * scale,
      oy + (this.map.width + this.map.height) * this.config.tileHeight / 2 * scale);
    ctx.lineTo(ox - this.map.height * this.config.tileWidth / 2 * scale,
      oy + this.map.height * this.config.tileHeight / 2 * scale);
    ctx.closePath();
    ctx.strokeStyle = '#b9c29688';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.clip();
    if (dots) {
      const hw = this.config.tileWidth / 2 * scale;
      const hh = this.config.tileHeight / 2 * scale;
      for (let i = 0; i < dots.count; i++) {
        ctx.fillStyle = dots.color[i];
        ctx.fillRect(ox + (dots.x[i] - dots.y[i]) * hw - 1.2, oy + (dots.x[i] + dots.y[i]) * hh - 1.2, 2.4, 2.4);
      }
    }
    const width = view.width / view.zoom * scale;
    const height = view.height / view.zoom * scale;
    const x = ox + view.x * scale - width / 2;
    const y = oy + view.y * scale - height / 2;
    ctx.fillStyle = '#fff4bd18';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#121e19';
    ctx.lineWidth = 2.8;
    ctx.strokeRect(x, y, width, height);
    ctx.strokeStyle = '#fff1ae';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = '#fff6c4';
    ctx.fillRect(ox + view.x * scale - 1.2, oy + view.y * scale - 1.2, 2.4, 2.4);
    ctx.restore();
  }

  private createBackground(): void {
    // Two source pixels per tile axis preserve narrow roads and river crossings.
    this.background.width = (this.map.width + this.map.height) * 2;
    this.background.height = (this.map.width + this.map.height) * 2;
    const ctx = this.background.getContext('2d')!;
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const tile = this.map.tiles[y * this.map.width + x];
        ctx.fillStyle = this.config.palette[terrainKeys[tile]] ?? fallbackColors[tile];
        const px = (x - y + this.map.height) * 2;
        const py = (x + y) * 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + 2, py + 2);
        ctx.lineTo(px, py + 4);
        ctx.lineTo(px - 2, py + 2);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  private resize(): void {
    this.cssWidth = this.canvas.clientWidth;
    this.cssHeight = this.canvas.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.cssWidth * ratio);
    this.canvas.height = Math.round(this.cssHeight * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const worldWidth = (this.map.width + this.map.height) * this.config.tileWidth / 2;
    const worldHeight = (this.map.width + this.map.height) * this.config.tileHeight / 2;
    this.scale = Math.min((this.cssWidth - 12) / worldWidth, (this.cssHeight - 8) / worldHeight);
    this.originX = (this.cssWidth - worldWidth * this.scale) / 2 + this.map.height * this.config.tileWidth / 2 * this.scale;
    this.originY = (this.cssHeight - worldHeight * this.scale) / 2;
  }

  private moveTo(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const worldX = (event.clientX - rect.left - this.originX) / this.scale;
    const worldY = (event.clientY - rect.top - this.originY) / this.scale;
    const halfWidth = this.config.tileWidth / 2;
    const halfHeight = this.config.tileHeight / 2;
    this.lastTileX = Math.max(0, Math.min(this.map.width - 1, (worldX / halfWidth + worldY / halfHeight) / 2));
    this.lastTileY = Math.max(0, Math.min(this.map.height - 1, (worldY / halfHeight - worldX / halfWidth) / 2));
    this.jump(this.lastTileX, this.lastTileY);
  }
}
