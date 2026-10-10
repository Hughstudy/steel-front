import type { World } from '../sim/world.ts';

const SHROUD = [13, 19, 15];

/**
 * Fog-of-war overlay: one pixel per tile in a small canvas, drawn through the
 * isometric affine transform with smoothing for soft edges. Rebuilt only when
 * the simulation recomputes fog masks.
 */
export class FogLayer {
  readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private image: ImageData;
  private version = -1;
  private player = -1;
  enabled = true;

  constructor(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.context = this.canvas.getContext('2d')!;
    this.image = this.context.createImageData(width, height);
  }

  update(world: World, player: number): void {
    this.enabled = world.fogEnabled && !!world.players[player];
    if (!this.enabled || (world.fogVersion === this.version && player === this.player)) return;
    this.version = world.fogVersion;
    this.player = player;
    const fog = world.players[player].fog;
    const data = this.image.data;
    for (let i = 0, p = 0; i < fog.visible.length; i++, p += 4) {
      data[p] = SHROUD[0];
      data[p + 1] = SHROUD[1];
      data[p + 2] = SHROUD[2];
      data[p + 3] = fog.visible[i] ? 0 : fog.explored[i] ? 120 : 255;
    }
    this.context.putImageData(this.image, 0, 0);
  }

  /** Draw in world-pixel space (the battlefield's camera transform must be active). */
  draw(context: CanvasRenderingContext2D): void {
    if (!this.enabled) return;
    context.save();
    context.transform(32, 16, -32, 16, 0, 0);
    context.imageSmoothingEnabled = true;
    context.drawImage(this.canvas, 0, 0);
    context.restore();
  }

  /** Force a rebuild (new match). */
  reset(): void { this.version = -1; }
}
