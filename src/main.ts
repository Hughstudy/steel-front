import mapData from '../data/map.json';
import type { MapConfig } from './types.ts';
import { Camera } from './engine/camera.ts';
import { CameraInput } from './engine/input.ts';
import { GameLoop } from './engine/loop.ts';
import { generateTerrain } from './sim/terrain.ts';
import { TerrainRenderer } from './render/terrain-renderer.ts';
import { Hud } from './ui/hud.ts';

const config: MapConfig = mapData;
const canvas = document.querySelector<HTMLCanvasElement>('#battlefield')!;
const viewport = document.querySelector<HTMLElement>('#viewport')!;
const map = generateTerrain(config);
const camera = new Camera(map.width, map.height);
const renderer = new TerrainRenderer(canvas, map, config);
let showGrid = false;
let simulationTick = 0;
const stats = { fps: 60, frameMs: 0, tick: 0, visibleChunks: 0, grid: false };
const reset = (): void => camera.reset(config.spawn.x, config.spawn.y);
const toggleGrid = (): void => { showGrid = !showGrid; };
const hud = new Hud(map, config, {
  zoomIn: () => camera.zoomAt(1.2),
  zoomOut: () => camera.zoomAt(1 / 1.2),
  reset,
  toggleGrid,
  jump: (x, y) => camera.jump(x, y),
});
const input = new CameraInput(canvas, camera, (x, y) => hud.inspect(x, y), reset, toggleGrid);

function resize(): void {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  camera.resize(width, height);
}
const observer = new ResizeObserver(resize);
observer.observe(viewport);
resize();
reset();
hud.inspect(config.spawn.x, config.spawn.y);

let lastReport = performance.now();
let frames = 0;
let renderDuration = 0;
const loop = new GameLoop(
  (_dt, tick) => { simulationTick = tick; },
  (alpha, dt) => {
    const started = performance.now();
    input.update(dt);
    camera.update(dt);
    // Previous/current sim interpolation is also the time source for ambient animation.
    const time = Math.max(0, simulationTick - 1 + alpha) * loop.clock.step;
    renderer.render(camera.view, time, showGrid);
    hud.renderMinimap(camera.view);
    renderDuration += performance.now() - started;
    frames++;
    if (started - lastReport >= 500) {
      stats.fps = Math.round(frames * 1000 / (started - lastReport));
      stats.frameMs = renderDuration / frames;
      stats.tick = simulationTick;
      stats.visibleChunks = renderer.visibleChunks;
      stats.grid = showGrid;
      hud.update(camera.view, stats);
      frames = 0;
      renderDuration = 0;
      lastReport = started;
    }
  },
);
loop.start();

// Vite HMR disposes active listeners/RAF instead of stacking loops during development.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loop.stop();
    input.destroy();
    observer.disconnect();
  });
}
