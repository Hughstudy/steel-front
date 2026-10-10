export interface Point { x: number; y: number }

/** Camera center in projected world pixels; viewport dimensions in CSS pixels. */
export interface CameraView extends Point {
  zoom: number;
  width: number;
  height: number;
}

export interface TerrainMap {
  width: number;
  height: number;
  seed: number;
  tiles: Uint8Array;
  variants: Uint8Array;
  props: Uint8Array;
}

export interface MapConfig {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  seed: number;
  name: string;
  subtitle: string;
  spawn: Point;
  palette: Record<string, string>;
  [key: string]: unknown;
}
