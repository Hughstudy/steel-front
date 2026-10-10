import mapData from '../data/map.json';
import gameData from '../data/game.json';
import terrainData from '../data/terrain.json';
import factionData from '../data/factions.json';
import unitData from '../data/units.json';
import scenarioData from '../data/scenarios.json';
import buildingData from '../data/buildings.json';
import economyData from '../data/economy.json';
import mapPresetData from '../data/maps.json';
import type { MapConfig } from './types.ts';
import { Camera } from './engine/camera.ts';
import { CameraInput } from './engine/input.ts';
import { GameLoop } from './engine/loop.ts';
import { generateTerrain } from './sim/terrain.ts';
import { loadRules } from './sim/rules.ts';
import { World } from './sim/world.ts';
import type { Entity } from './sim/entities.ts';
import { TerrainRenderer } from './render/terrain-renderer.ts';
import { EntityLayer } from './render/entity-layer.ts';
import { OrderMarkers } from './render/markers.ts';
import { Hud } from './ui/hud.ts';
import type { MinimapDots } from './ui/minimap.ts';
import { Selection } from './ui/selection.ts';
import { SelectionPanel } from './ui/selection-panel.ts';
import { GameInput } from './ui/game-input.ts';
import { contextOrder } from './ui/orders.ts';

const config: MapConfig = mapData;
const rules = loadRules({
  game: gameData, terrain: terrainData, factions: factionData, units: unitData, scenarios: scenarioData,
  buildings: buildingData, economy: economyData, maps: mapPresetData,
});
const canvas = document.querySelector<HTMLCanvasElement>('#battlefield')!;
const viewport = document.querySelector<HTMLElement>('#viewport')!;
const map = generateTerrain(config);
const camera = new Camera(map.width, map.height);
const renderer = new TerrainRenderer(canvas, map, config);
const layer = new EntityLayer();
const markers = new OrderMarkers();
const selection = new Selection();
const PLAYER = 0;
let world = new World(rules, map, config.seed);
let scenarioId = 'm2-logistics';
let inspected = 0;
let showGrid = false;
let presentationTime = 0;
const stats = { fps: 60, frameMs: 0, tick: 0, visibleChunks: 0, grid: false };

function startScenario(id: string): void {
  const scenario = rules.scenarios.get(id)!;
  scenarioId = id;
  world = new World(rules, map, config.seed);
  world.loadScenario(scenario);
  layer.warm(world);
  selection.clear();
  inspected = 0;
  camera.reset(scenario.camera.x, scenario.camera.y);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-scenario]')) button.setAttribute('aria-pressed', String(button.dataset.scenario === id));
  document.getElementById('command-title')!.textContent = scenario.name;
  document.getElementById('mission-title')!.firstChild!.textContent = scenario.name.toUpperCase();
  document.getElementById('mission-text')!.textContent = scenario.description;
}

const reset = (): void => {
  const scenario = rules.scenarios.get(scenarioId)!;
  camera.reset(scenario.camera.x, scenario.camera.y);
};
const toggleGrid = (): void => { showGrid = !showGrid; };
const hud = new Hud(map, config, {
  zoomIn: () => camera.zoomAt(1.2),
  zoomOut: () => camera.zoomAt(1 / 1.2),
  reset,
  toggleGrid,
  jump: (x, y) => camera.jump(x, y),
});
const panel = new SelectionPanel(type => selection.set(selection.list().filter(id => world.get(id)?.type === type)));
const cameraInput = new CameraInput(canvas, camera, (x, y) => hud.inspect(x, y), reset, toggleGrid);

function stopSelected(): void {
  const ids = selection.list();
  if (ids.length) world.enqueue({ player: PLAYER, kind: 'stop', ids, x: 0, y: 0 });
}

const gameInput = new GameInput(canvas, camera, layer, selection, {
  player: () => PLAYER,
  world: () => world,
  selectable: (entity: Entity) => entity.owner === PLAYER && entity.kind === 'unit',
  inspect: entity => { inspected = entity ? entity.id : 0; },
  order: (tileX, tileY, target) => {
    const ids = selection.list();
    const x = Math.floor(tileX);
    const y = Math.floor(tileY);
    const nav = world.nav;
    const context = contextOrder(world, PLAYER, ids, target);
    if (context !== 'move' && target) {
      world.enqueue({ player: PLAYER, kind: context, ids, x, y, target: target.id });
      markers.add(target.x / world.subTile, target.y / world.subTile, context === 'capture' ? 'attack' : 'rally', presentationTime);
      return;
    }
    let kind: 'move' | 'nearest' | 'invalid' = 'invalid';
    if (nav.inBounds(x, y)) {
      // Read-only preview of how the simulation will resolve this target, for feedback.
      const lead = world.get(ids[0]);
      const component = lead ? nav.componentOf(lead.next >= 0 ? lead.next : lead.tile) : -1;
      const resolved = component >= 0 ? nav.nearestInComponent(nav.index(x, y), component) : -1;
      kind = resolved < 0 ? 'invalid' : resolved === nav.index(x, y) ? 'move' : 'nearest';
      if (resolved >= 0) {
        world.enqueue({ player: PLAYER, kind: 'move', ids, x, y });
        markers.add((resolved % nav.width) + 0.5, ((resolved / nav.width) | 0) + 0.5, kind, presentationTime);
        return;
      }
    }
    markers.add(tileX, tileY, kind, presentationTime);
  },
  stop: stopSelected,
  centerOn: ids => {
    let sx = 0; let sy = 0; let n = 0;
    for (const id of ids) {
      const e = world.get(id);
      if (!e) continue;
      sx += e.x / world.subTile; sy += e.y / world.subTile; n++;
    }
    if (n) camera.jump(sx / n - 0.5, sy / n - 0.5);
  },
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-scenario]')) {
  button.addEventListener('click', () => startScenario(button.dataset.scenario!));
}
document.getElementById('order-harvest')!.addEventListener('click', () => {
  const ids = selection.list();
  if (ids.length) world.enqueue({ player: PLAYER, kind: 'harvest', ids, x: 0, y: 0 });
});
document.getElementById('order-stop')!.addEventListener('click', stopSelected);

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
startScenario(scenarioId);
hud.inspect(config.spawn.x, config.spawn.y);

const dots: MinimapDots = { count: 0, x: new Float32Array(4096), y: new Float32Array(4096), color: [] };
function fillDots(): void {
  let n = 0;
  for (const entity of world.entities) {
    if (n >= dots.x.length) break;
    dots.x[n] = entity.x / world.subTile;
    dots.y[n] = entity.y / world.subTile;
    dots.color[n] = selection.ids.has(entity.id) ? '#ffffff' : entity.owner === PLAYER ? '#d8f08a' : entity.owner < 0 ? '#c9b98a' : '#ef6b52';
    n++;
  }
  dots.count = n;
}

const funds = document.getElementById('funds')!;
const hoverTile = { x: 0, y: 0 };
const CURSORS = ['cursor-select', 'cursor-move', 'cursor-invalid', 'cursor-harvest', 'cursor-capture'];
function updateCursor(hovered: Entity | null): void {
  let cursor = '';
  const context = selection.ids.size > 0 ? contextOrder(world, PLAYER, selection.list(), hovered) : 'move';
  if (context === 'harvest' || context === 'deposit') cursor = 'cursor-harvest';
  else if (context === 'capture') cursor = 'cursor-capture';
  else if (hovered && hovered.owner === PLAYER && hovered.kind === 'unit') cursor = 'cursor-select';
  else if (selection.ids.size > 0 && gameInput.pointerTile(hoverTile)) {
    const x = Math.floor(hoverTile.x);
    const y = Math.floor(hoverTile.y);
    cursor = world.nav.inBounds(x, y) && world.nav.passable(world.nav.index(x, y)) ? 'cursor-move' : 'cursor-invalid';
  }
  for (const name of CURSORS) canvas.classList.toggle(name, cursor === name);
}

let lastReport = performance.now();
let lastPanel = 0;
let frames = 0;
let renderDuration = 0;
let simDuration = 0;
function simulate(): void {
  const started = performance.now();
  world.step();
  simDuration += performance.now() - started;
}

function renderFrame(alpha: number, dt: number): void {
  const started = performance.now();
  presentationTime += dt;
  cameraInput.update(dt);
  camera.update(dt);
  selection.prune(world, PLAYER);
  const hovered = gameInput.hovered();
  layer.prepare(world, camera.view, alpha, { selected: selection.ids, hovered: hovered ? hovered.id : 0 });
  renderer.render(camera.view, Math.max(0, world.tick - 1 + alpha) * loop.clock.step, showGrid, layer);
  const context = canvas.getContext('2d')!;
  markers.draw(context, presentationTime);
  layer.drawOverlays(context);
  if (gameInput.box.active) {
    const dpr = canvas.width / camera.view.width;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { x0, y0, x1, y1 } = gameInput.box;
    context.fillStyle = 'rgba(226,236,170,.08)';
    context.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    context.strokeStyle = 'rgba(236,240,190,.9)';
    context.lineWidth = 1;
    context.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
  }
  fillDots();
  hud.renderMinimap(camera.view, dots);
  updateCursor(hovered);
  if (started - lastPanel > 120) {
    panel.update(world, selection, layer, inspected ? world.get(inspected) ?? null : null);
    funds.textContent = String(world.players[PLAYER]?.credits ?? 0);
    lastPanel = started;
  }
  renderDuration += performance.now() - started;
  frames++;
  if (started - lastReport >= 500) {
    stats.fps = Math.round(frames * 1000 / (started - lastReport));
    stats.frameMs = (renderDuration + simDuration) / frames;
    stats.tick = world.tick;
    stats.visibleChunks = renderer.visibleChunks;
    stats.grid = showGrid;
    hud.update(camera.view, stats);
    frames = 0;
    renderDuration = 0;
    simDuration = 0;
    lastReport = started;
  }
}
const loop = new GameLoop(simulate, renderFrame);
loop.start();

/**
 * QA benchmark: renders `frames` frames synchronously while panning, advancing one
 * simulation tick every third frame (≈60 FPS cadence). Reports CPU time per frame.
 */
function benchmark(frames = 600): Record<string, number> {
  const samples: number[] = [];
  const simSamples: number[] = [];
  for (let i = 0; i < frames; i++) {
    const start = performance.now();
    if (i % 3 === 0) { const s = performance.now(); world.step(); simSamples.push(performance.now() - s); }
    camera.pan(Math.sin(i / 60) * 6, Math.cos(i / 80) * 3, true);
    renderFrame((i % 3) / 3, 1 / 60);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  simSamples.sort((a, b) => a - b);
  const pick = (list: number[], q: number): number => Math.round(list[Math.min(list.length - 1, Math.floor(list.length * q))] * 100) / 100;
  return { frames, units: world.entities.length, visible: layer.count, median: pick(samples, 0.5), p95: pick(samples, 0.95), max: pick(samples, 1), simMedian: pick(simSamples, 0.5), simMax: pick(simSamples, 1) };
}

/** QA: advance the simulation synchronously (works while the tab is hidden) and redraw. */
function advance(ticks: number): number {
  for (let i = 0; i < ticks; i++) world.step();
  lastPanel = 0;
  renderFrame(1, 0);
  return world.tick;
}

// Debug/QA hook for measuring in the browser without affecting the simulation.
(window as unknown as { steelFront: unknown }).steelFront = { get world() { return world; }, camera, selection, layer, benchmark, startScenario, advance,
  render: () => { lastPanel = 0; renderFrame(1, 0); },
  /** Page coordinates of an entity's ground point, for driving real pointer input in QA. */
  screenOf: (id: number) => {
    const entity = world.get(id);
    if (!entity) return null;
    const tx = entity.x / world.subTile;
    const ty = entity.y / world.subTile;
    const bounds = canvas.getBoundingClientRect();
    const view = camera.view;
    return { x: Math.round(bounds.left + ((tx - ty) * 32 - view.x) * view.zoom + view.width / 2), y: Math.round(bounds.top + ((tx + ty) * 16 - view.y) * view.zoom + view.height / 2) };
  } };

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loop.stop();
    cameraInput.destroy();
    gameInput.destroy();
    observer.disconnect();
  });
}
