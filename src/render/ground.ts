import type { MapConfig, TerrainMap } from '../types';
import { tileHash } from '../sim/terrain';

const COLORS = ['grass', 'forest', 'water', 'sand', 'road', 'rock', 'bridge', 'field'];
const NW = [16, 8];
const NE = [48, 8];
const SE = [48, 24];
const SW = [16, 24];
const ROAD_EDGES = [NW, NE, SE, SW];

function diamond(context: CanvasRenderingContext2D): void {
  context.beginPath();
  context.moveTo(32, 0);
  context.lineTo(64, 16);
  context.lineTo(32, 32);
  context.lineTo(0, 16);
  context.closePath();
}

/** Procedural atlas generation runs once, never in the animation loop. */
export function createGroundAtlas(config: MapConfig): HTMLCanvasElement[] {
  const atlas: HTMLCanvasElement[] = [];
  for (let terrain = 0; terrain < COLORS.length; terrain++) {
    for (let variant = 0; variant < 8; variant++) {
      const canvas = document.createElement('canvas');
      canvas.width = 66;
      canvas.height = 34;
      const context = canvas.getContext('2d')!;
      context.translate(1, 1);
      diamond(context);
      context.fillStyle = config.palette[COLORS[terrain]];
      context.fill();
      context.save();
      context.clip();
      context.fillStyle = variant % 2 ? 'rgba(234,225,158,.025)' : 'rgba(31,50,37,.035)';
      context.fillRect(0, 0, 64, 32);
      for (let speck = 0; speck < 45; speck++) {
        const u = tileHash(speck, variant, config.seed + terrain * 300) * 64;
        const v = tileHash(speck, variant, config.seed + terrain * 700 + 19) * 32;
        context.fillStyle = speck % 2 ? 'rgba(226,224,172,.14)' : 'rgba(33,50,35,.10)';
        context.fillRect(u, v, terrain === 2 ? 6 : 1.6, .7);
      }
      if (terrain === 7) {
        context.lineWidth = 1;
        for (let line = -24; line < 64; line += 5) {
          context.beginPath();
          context.moveTo(line, 0);
          context.lineTo(line + 64, 32);
          context.strokeStyle = 'rgba(83,78,40,.27)';
          context.stroke();
          context.beginPath();
          context.moveTo(line, 1);
          context.lineTo(line + 64, 33);
          context.strokeStyle = 'rgba(227,217,145,.31)';
          context.stroke();
        }
      }
      if (terrain === 2) {
        context.strokeStyle = 'rgba(175,203,181,.26)';
        context.lineWidth = .8;
        for (let wave = 0; wave < 4; wave++) {
          const wx = tileHash(wave, variant, 97) * 50;
          const wy = tileHash(wave, variant, 53) * 25;
          context.beginPath();
          context.moveTo(wx, wy);
          context.bezierCurveTo(wx + 3, wy - 1, wx + 7, wy + 1, wx + 11, wy);
          context.stroke();
        }
      }
      context.restore();
      atlas.push(canvas);
    }
  }
  return atlas;
}

function isRoad(map: TerrainMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const terrain = map.tiles[y * map.width + x];
  return terrain === 4 || terrain === 6;
}

export function paintRoad(context: CanvasRenderingContext2D, map: TerrainMap, x: number, y: number): void {
  const bridge = map.tiles[y * map.width + x] === 6;
  const links = [isRoad(map, x - 1, y), isRoad(map, x, y - 1), isRoad(map, x + 1, y), isRoad(map, x, y + 1)];
  context.lineCap = 'butt';
  context.lineJoin = 'round';
  if (!bridge) {
    // Long straight strokes join exactly at tile edges; no outlined end caps.
    for (let pass = 0; pass < 2; pass++) {
      context.strokeStyle = pass === 0 ? '#a59e80' : '#b9ad8d';
      context.lineWidth = pass === 0 ? 19 : 16;
      context.beginPath();
      for (let edge = 0; edge < 4; edge++) {
        if (!links[edge]) continue;
        context.moveTo(32, 16);
        context.lineTo(32 + (ROAD_EDGES[edge][0] - 32) * 1.04, 16 + (ROAD_EDGES[edge][1] - 16) * 1.04);
      }
      context.stroke();
    }
    context.strokeStyle = 'rgba(107,103,79,.25)';
    context.lineWidth = .9;
    for (let track = -1; track <= 1; track += 2) {
      context.beginPath();
      for (let edge = 0; edge < 4; edge++) {
        if (!links[edge]) continue;
        const direction = edge === 0 || edge === 2 ? 1 : -1;
        const offsetX = -1.6 * track;
        const offsetY = 3.2 * track * direction;
        context.moveTo(32 + offsetX, 16 + offsetY);
        context.lineTo(ROAD_EDGES[edge][0] + offsetX, ROAD_EDGES[edge][1] + offsetY);
      }
      context.stroke();
    }
    return;
  }
  // All river crossings run along the x tile axis. Piles cast a small shadow.
  context.fillStyle = 'rgba(21,36,32,.29)';
  context.beginPath();
  context.moveTo(21, 4); context.lineTo(53, 20); context.lineTo(43, 38); context.lineTo(11, 22);
  context.fill();
  context.fillStyle = '#aaa28a';
  context.beginPath();
  context.moveTo(21, -2); context.lineTo(53, 14); context.lineTo(43, 34); context.lineTo(11, 18);
  context.closePath(); context.fill();
  context.strokeStyle = '#85816d';
  context.lineWidth = 1;
  for (let plank = 0; plank < 8; plank++) {
    context.beginPath();
    context.moveTo(21 + plank * 4, -2 + plank * 2);
    context.lineTo(11 + plank * 4, 18 + plank * 2);
    context.stroke();
  }
  context.strokeStyle = '#ded3b0';
  context.lineWidth = 2;
  context.beginPath(); context.moveTo(21, -4); context.lineTo(53, 12); context.stroke();
  context.strokeStyle = '#686858';
  context.beginPath(); context.moveTo(11, 16); context.lineTo(43, 32); context.stroke();
}
