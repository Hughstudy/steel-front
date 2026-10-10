import type { CameraView, Point } from '../types.ts';
import { tileToWorld, worldToTile } from './coordinates.ts';

export class Camera {
  readonly view: CameraView = { x: 0, y: 0, zoom: 1, width: 1, height: 1 };
  readonly minZoom = 0.35;
  readonly maxZoom = 1.8;
  private targetX = 0;
  private targetY = 0;
  private targetZoom = 1;
  private readonly scratch: Point = { x: 0, y: 0 };
  private anchorX = 0;
  private anchorY = 0;
  private anchorScreenX = 0;
  private anchorScreenY = 0;
  private anchoring = false;
  private mapWidth: number;
  private mapHeight: number;

  constructor(mapWidth: number, mapHeight: number) {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
  }

  resize(width: number, height: number): void {
    this.view.width = width;
    this.view.height = height;
    this.anchoring = false;
  }

  jump(tileX: number, tileY: number): void {
    tileToWorld(tileX + 0.5, tileY + 0.5, this.scratch);
    this.targetX = this.scratch.x;
    this.targetY = this.scratch.y;
    this.clampTarget();
    this.view.x = this.targetX;
    this.view.y = this.targetY;
    this.anchoring = false;
  }

  reset(tileX: number, tileY: number): void {
    this.view.zoom = this.targetZoom = 1;
    this.jump(tileX, tileY);
  }

  /** Pan is specified in CSS screen pixels, independent of zoom. */
  pan(dx: number, dy: number, immediate = false): void {
    this.anchoring = false;
    this.targetX += dx / this.view.zoom;
    this.targetY += dy / this.view.zoom;
    this.clampTarget();
    if (immediate) {
      this.view.x = this.targetX;
      this.view.y = this.targetY;
    }
  }

  zoomAt(factor: number, screenX = this.view.width / 2, screenY = this.view.height / 2): void {
    this.screenToWorld(screenX, screenY, this.scratch);
    this.anchorX = this.scratch.x;
    this.anchorY = this.scratch.y;
    this.anchorScreenX = screenX - this.view.width / 2;
    this.anchorScreenY = screenY - this.view.height / 2;
    this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom * factor));
    this.anchoring = true;
  }

  update(dt: number): void {
    const blend = 1 - Math.exp(-14 * dt);
    this.view.zoom += (this.targetZoom - this.view.zoom) * blend;
    if (Math.abs(this.targetZoom - this.view.zoom) < 0.0001) this.view.zoom = this.targetZoom;
    if (this.anchoring) {
      this.targetX = this.anchorX - this.anchorScreenX / this.view.zoom;
      this.targetY = this.anchorY - this.anchorScreenY / this.view.zoom;
      this.clampTarget();
      this.view.x = this.targetX;
      this.view.y = this.targetY;
    } else {
      this.view.x += (this.targetX - this.view.x) * blend;
      this.view.y += (this.targetY - this.view.y) * blend;
    }
  }

  screenToWorld(x: number, y: number, out: Point): Point {
    out.x = this.view.x + (x - this.view.width / 2) / this.view.zoom;
    out.y = this.view.y + (y - this.view.height / 2) / this.view.zoom;
    return out;
  }

  private clampTarget(): void {
    worldToTile(this.targetX, this.targetY, this.scratch);
    this.scratch.x = Math.max(0.5, Math.min(this.mapWidth - 0.5, this.scratch.x));
    this.scratch.y = Math.max(0.5, Math.min(this.mapHeight - 0.5, this.scratch.y));
    tileToWorld(this.scratch.x, this.scratch.y, this.scratch);
    this.targetX = this.scratch.x;
    this.targetY = this.scratch.y;
  }
}
