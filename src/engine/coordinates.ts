import type { Point } from '../types.ts';

export const HALF_TILE_WIDTH = 32;
export const HALF_TILE_HEIGHT = 16;

/** Tile coordinates refer to the north vertex; add 0.5 on both axes for center. */
export function tileToWorld(x: number, y: number, out: Point): Point {
  out.x = (x - y) * HALF_TILE_WIDTH;
  out.y = (x + y) * HALF_TILE_HEIGHT;
  return out;
}

export function worldToTile(x: number, y: number, out: Point): Point {
  out.x = (x / HALF_TILE_WIDTH + y / HALF_TILE_HEIGHT) * 0.5;
  out.y = (y / HALF_TILE_HEIGHT - x / HALF_TILE_WIDTH) * 0.5;
  return out;
}
