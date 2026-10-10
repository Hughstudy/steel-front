import mapData from '../data/map.json';
import gameData from '../data/game.json';
import terrainData from '../data/terrain.json';
import factionData from '../data/factions.json';
import unitData from '../data/units.json';
import scenarioData from '../data/scenarios.json';
import buildingData from '../data/buildings.json';
import economyData from '../data/economy.json';
import mapPresetData from '../data/maps.json';
import productionData from '../data/production.json';
import weaponData from '../data/weapons.json';
import combatData from '../data/combat.json';
import type { MapConfig } from './types.ts';
import { Camera } from './engine/camera.ts';
import { CameraInput } from './engine/input.ts';
import { GameLoop } from './engine/loop.ts';
import { generateTerrain } from './sim/terrain.ts';
import { loadRules } from './sim/rules.ts';
import { World } from './sim/world.ts';
import { createEntity } from './sim/entities.ts';
import type { Entity } from './sim/entities.ts';
import { canSee } from './sim/fog.ts';
import { TerrainRenderer } from './render/terrain-renderer.ts';
import { EntityLayer } from './render/entity-layer.ts';
import { OrderMarkers } from './render/markers.ts';
import { FogLayer } from './render/fog-layer.ts';
import { Effects } from './render/effects.ts';
import { Hud } from './ui/hud.ts';
import type { MinimapDots } from './ui/minimap.ts';
import { Selection } from './ui/selection.ts';
import { SelectionPanel } from './ui/selection-panel.ts';
import { GameInput } from './ui/game-input.ts';
import { contextOrder } from './ui/orders.ts';
import { ProductionPanel } from './ui/production-panel.ts';
import { deployPreview, drawFootprint, Placement, problemText } from './ui/placement.ts';
import type { HudMode } from './ui/placement.ts';

const config: MapConfig = mapData;
const rules = loadRules({
  game: gameData, terrain: terrainData, factions: factionData, units: unitData, scenarios: scenarioData,
  buildings: buildingData, economy: economyData, maps: mapPresetData, production: productionData,
  weapons: weaponData, combat: combatData,
});
const canvas = document.querySelector<HTMLCanvasElement>('#battlefield')!;
const viewport = document.querySelector<HTMLElement>('#viewport')!;
const map = generateTerrain(config);
const camera = new Camera(map.width, map.height);
const renderer = new TerrainRenderer(canvas, map, config);
const layer = new EntityLayer();
const markers = new OrderMarkers();
const fogLayer = new FogLayer(map.width, map.height);
const effects = new Effects();
const placement = new Placement();
const scenarioSelect = document.querySelector<HTMLSelectElement>('#scenario-select')!;
const selection = new Selection();
const PLAYER = 0;
let world = new World(rules, map, config.seed);
let scenarioId = 'm4-combat';
/** Entity shown in the panel when nothing is selected (live entity id or a memory ghost). */
let inspected: Entity | null = null;
let showGrid = false;
let presentationTime = 0;
const stats = { fps: 60, frameMs: 0, tick: 0, visibleChunks: 0, grid: false };

function startScenario(id: string): void {
  const scenario = rules.scenarios.get(id)!;
  scenarioId = id;
  world = new World(rules, map, config.seed);
  world.loadScenario(scenario);
  layer.warm(world);
  fogLayer.reset();
  ghosts.clear();
  selection.clear();
  inspected = null;
  placement.cancel();
  camera.reset(scenario.camera.x, scenario.camera.y);
  scenarioSelect.value = id;
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

/** Whether the local player sees a tile now (effects and projectiles are filtered by it). */
function tileVisible(tx: number, ty: number): boolean {
  if (!world.fogEnabled) return true;
  const x = Math.floor(tx);
  const y = Math.floor(ty);
  if (!world.nav.inBounds(x, y)) return false;
  return world.players[PLAYER].fog.visible[world.nav.index(x, y)] === 1;
}
const seen = (entity: Entity): boolean => canSee(world, PLAYER, entity);

/**
 * Remembered enemy/neutral structures under fog, drawn as last seen. Ghosts use
 * negative ids so nothing can look up the live entity's health or activity.
 */
const ghosts = new Map<number, Entity>();
const ghostList: Entity[] = [];
function refreshGhosts(): void {
  ghostList.length = 0;
  if (!world.fogEnabled) return;
  const memory = world.players[PLAYER].fog.memory;
  for (const [id, ghost] of ghosts) if (!memory.has(-ghost.id - 1) || ghost.type !== memory.get(-ghost.id - 1)!.type) ghosts.delete(id);
  for (const record of memory.values()) {
    const live = world.get(record.id);
    if (live && seen(live)) continue;
    let ghost = ghosts.get(record.id);
    if (!ghost || ghost.owner !== record.owner) {
      ghost = createEntity(-record.id - 1, 'building', record.type, record.owner, rules.buildings.get(record.type)!.hp);
      ghost.x = ghost.prevX = record.x;
      ghost.y = ghost.prevY = record.y;
      ghosts.set(record.id, ghost);
    }
    ghostList.push(ghost);
  }
}

function stopSelected(): void {
  const ids = selection.list();
  if (ids.length) world.enqueue({ player: PLAYER, kind: 'stop', ids, x: 0, y: 0 });
}

function setMode(mode: HudMode, type = ''): void {
  placement.start(mode, type);
  document.getElementById('mode-sell')!.setAttribute('aria-pressed', String(mode === 'sell'));
  document.getElementById('mode-repair')!.setAttribute('aria-pressed', String(mode === 'repair'));
}

/** Units in the selection (buildings are selectable too, but take different orders). */
function selectedUnits(): number[] { return selection.list().filter(id => world.get(id)?.kind === 'unit'); }

function deploySelected(): void {
  const ids = selectedUnits().filter(id => typeof rules.units.get(world.get(id)!.type)?.capabilities.deploy === 'string');
  if (ids.length) world.enqueue({ player: PLAYER, kind: 'deploy', ids, x: 0, y: 0 });
}

const gameInput = new GameInput(canvas, camera, layer, selection, {
  player: () => PLAYER,
  world: () => world,
  selectable: (entity: Entity) => entity.owner === PLAYER,
  inspect: entity => { inspected = entity && (entity.id < 0 || seen(entity)) ? entity : null; },
  primaryAction: (tileX, tileY) => {
    if (placement.mode === 'place') {
      const def = rules.buildings.get(placement.type)!;
      const origin = placement.originAt(world, def, tileX, tileY);
      if (origin < 0) return true;
      placement.update(world, PLAYER, tileX, tileY);
      if (placement.problem !== '' && placement.problem !== 'occupied') {
        markers.add(tileX, tileY, 'invalid', presentationTime);
        notice(`Cannot place: ${problemText(placement.problem)}`);
        return true;
      }
      world.enqueue({ player: PLAYER, kind: 'place', ids: [], x: origin % world.nav.width, y: (origin / world.nav.width) | 0, type: placement.type });
      setMode('');
      return true;
    }
    if (placement.mode === 'sell' || placement.mode === 'repair') {
      const target = gameInput.hovered();
      if (target && target.kind === 'building' && target.owner === PLAYER) {
        world.enqueue({ player: PLAYER, kind: placement.mode, ids: [], x: 0, y: 0, target: target.id });
        markers.add(target.x / world.subTile, target.y / world.subTile, placement.mode === 'sell' ? 'invalid' : 'rally', presentationTime);
      }
      return true;
    }
    return false;
  },
  cancelAction: () => { const active = placement.mode !== ''; setMode(''); return active; },
  order: (tileX, tileY, target) => {
    const all = selection.list();
    const ids = selectedUnits();
    const x = Math.floor(tileX);
    const y = Math.floor(tileY);
    const nav = world.nav;
    if (ids.length === 0) {
      // Producers selected: right-click sets their rally point.
      const producers = all.filter(id => {
        const def = rules.buildings.get(world.get(id)?.type ?? '');
        return def && def.produces.some(category => !rules.production.categories.find(c => c.id === category)?.placement);
      });
      for (const id of producers) world.enqueue({ player: PLAYER, kind: 'rally', ids: [], x, y, target: id });
      if (producers.length) markers.add(tileX, tileY, 'rally', presentationTime);
      return;
    }
    if (target && target.owner === PLAYER && target.kind === 'unit' && selection.ids.has(target.id)
      && typeof rules.units.get(target.type)?.capabilities.deploy === 'string') {
      deploySelected();
      return;
    }
    // Unseen or remembered targets take a plain move order (no hidden information).
    const context = contextOrder(world, PLAYER, ids, target && target.id > 0 && seen(target) ? target : null);
    if (context !== 'move' && target) {
      world.enqueue({ player: PLAYER, kind: context, ids, x, y, target: target.id });
      markers.add(target.x / world.subTile, target.y / world.subTile, context === 'capture' || context === 'attack' ? 'attack' : 'rally', presentationTime);
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

for (const scenario of rules.scenarios.values()) scenarioSelect.add(new Option(scenario.name, scenario.id));
scenarioSelect.addEventListener('change', () => { startScenario(scenarioSelect.value); canvas.focus(); });
document.getElementById('action-haul')!.addEventListener('click', () => {
  const ids = selectedUnits();
  if (ids.length) world.enqueue({ player: PLAYER, kind: 'harvest', ids, x: 0, y: 0 });
});
document.getElementById('action-stop')!.addEventListener('click', stopSelected);
document.getElementById('action-deploy')!.addEventListener('click', deploySelected);
document.getElementById('mode-sell')!.addEventListener('click', () => setMode(placement.mode === 'sell' ? '' : 'sell'));
document.getElementById('mode-repair')!.addEventListener('click', () => setMode(placement.mode === 'repair' ? '' : 'repair'));

const production = new ProductionPanel({
  world: () => world,
  player: () => PLAYER,
  activate: type => {
    const def = rules.buildings.get(type);
    const head = def?.producer ? world.players[PLAYER].queues[def.producer]?.[0] : undefined;
    if (def && head && head.type === type && head.reason === 'ready') {
      setMode('place', type);
      return;
    }
    world.enqueue({ player: PLAYER, kind: 'build', ids: [], x: 0, y: 0, type });
  },
  cancel: type => {
    if (placement.mode === 'place' && placement.type === type) setMode('');
    world.enqueue({ player: PLAYER, kind: 'cancel', ids: [], x: 0, y: 0, type });
  },
  battlefield: () => canvas.focus(),
});
const productionRoot = document.getElementById('production-panel')!;
productionRoot.addEventListener('focusin', () => cameraInput.releaseKeys());

const noticeLine = document.getElementById('production-notice')!;
function notice(text: string): void { noticeLine.textContent = text.toUpperCase(); }

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
  for (const source of [world.entities, ghostList]) for (const entity of source) {
    if (n >= dots.x.length) break;
    if (source === world.entities && !seen(entity)) continue;
    dots.x[n] = entity.x / world.subTile;
    dots.y[n] = entity.y / world.subTile;
    dots.color[n] = selection.ids.has(entity.id) ? '#ffffff' : entity.owner === PLAYER ? '#d8f08a' : entity.owner < 0 ? '#c9b98a' : '#ef6b52';
    n++;
  }
  dots.count = n;
}

const funds = document.getElementById('funds')!;
const hoverTile = { x: 0, y: 0 };
const CURSORS = ['cursor-select', 'cursor-move', 'cursor-invalid', 'cursor-harvest', 'cursor-capture', 'cursor-place', 'cursor-sell', 'cursor-repair', 'cursor-deploy', 'cursor-attack'];
function updateCursor(hovered: Entity | null): void {
  let cursor = '';
  const units = selectedUnits();
  const target = hovered && hovered.id > 0 && seen(hovered) ? hovered : null;
  const context = units.length > 0 ? contextOrder(world, PLAYER, units, target) : 'move';
  const ownBuilding = hovered && hovered.kind === 'building' && hovered.owner === PLAYER ? rules.buildings.get(hovered.type)! : null;
  if (placement.mode === 'place') cursor = 'cursor-place';
  else if (placement.mode === 'sell') cursor = ownBuilding?.sellable ? 'cursor-sell' : 'cursor-invalid';
  else if (placement.mode === 'repair') cursor = ownBuilding && hovered!.hp < ownBuilding.hp ? 'cursor-repair' : 'cursor-invalid';
  else if (hovered && selection.ids.has(hovered.id) && typeof rules.units.get(hovered.type)?.capabilities.deploy === 'string') cursor = 'cursor-deploy';
  else if (context === 'harvest' || context === 'deposit') cursor = 'cursor-harvest';
  else if (context === 'capture') cursor = 'cursor-capture';
  else if (context === 'attack') cursor = 'cursor-attack';
  else if (hovered && hovered.owner === PLAYER) cursor = 'cursor-select';
  else if (units.length > 0 && gameInput.pointerTile(hoverTile)) {
    const x = Math.floor(hoverTile.x);
    const y = Math.floor(hoverTile.y);
    cursor = world.nav.inBounds(x, y) && world.nav.passable(world.nav.index(x, y)) ? 'cursor-move' : 'cursor-invalid';
  }
  for (const name of CURSORS) canvas.classList.toggle(name, cursor === name);
}

/** Deploy footprint preview for a hovered selected MCV, and rally lines for selected producers. */
function drawSelectionGuides(context: CanvasRenderingContext2D, hovered: Entity | null): void {
  if (hovered && selection.ids.has(hovered.id) && hovered.kind === 'unit') {
    const type = rules.units.get(hovered.type)?.capabilities.deploy;
    if (typeof type === 'string') {
      const def = rules.buildings.get(type)!;
      const preview = deployPreview(world, hovered.id, hovered.next >= 0 ? hovered.next : hovered.tile, def);
      if (preview.origin >= 0) drawFootprint(context, world, def, preview.origin, preview.problem === '' ? 'ok' : preview.problem === 'occupied' ? 'warn' : 'bad');
    }
  }
  const w = world.nav.width;
  for (const id of selection.ids) {
    const building = world.get(id);
    if (!building || building.kind !== 'building' || building.rally < 0) continue;
    const sx = building.x / world.subTile;
    const sy = building.y / world.subTile;
    const rx = (building.rally % w) + 0.5;
    const ry = ((building.rally / w) | 0) + 0.5;
    context.strokeStyle = 'rgba(233,215,154,.8)';
    context.setLineDash([6, 5]);
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo((sx - sy) * 32, (sx + sy) * 16);
    context.lineTo((rx - ry) * 32, (rx + ry) * 16);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.ellipse((rx - ry) * 32, (rx + ry) * 16, 14, 7, 0, 0, Math.PI * 2);
    context.stroke();
  }
}

const powerLabel = document.getElementById('power')!;
const deployButton = document.getElementById('action-deploy')!;
const haulButton = document.getElementById('action-haul')!;
const stopButton = document.getElementById('action-stop')!;
function updateHud(): void {
  const player = world.players[PLAYER];
  funds.textContent = String(player?.credits ?? 0);
  if (player) {
    powerLabel.textContent = `${player.power.demand}/${player.power.supply}`;
    powerLabel.classList.toggle('is-low', player.power.demand > player.power.supply);
    powerLabel.title = player.power.demand > player.power.supply ? 'Low power: production runs at a quarter speed' : 'Power demand / supply';
  }
  const units = selectedUnits().map(id => world.get(id)!);
  deployButton.hidden = !units.some(u => typeof rules.units.get(u.type)?.capabilities.deploy === 'string');
  haulButton.hidden = !units.some(u => typeof rules.units.get(u.type)?.capabilities.cargo === 'number');
  stopButton.hidden = units.length === 0;
  production.update();
}

let lastReport = performance.now();
let lastPanel = 0;
let frames = 0;
let renderDuration = 0;
let simDuration = 0;
/** One authoritative tick, then hand its events to the cosmetic effects. */
function tick(): void {
  world.step();
  effects.consume(world, world.events, tileVisible);
}

function simulate(): void {
  const started = performance.now();
  tick();
  simDuration += performance.now() - started;
}

function renderFrame(alpha: number, dt: number): void {
  const started = performance.now();
  presentationTime += dt;
  cameraInput.update(dt);
  camera.update(dt);
  selection.prune(world, PLAYER);
  effects.now = presentationTime;
  fogLayer.update(world, PLAYER);
  refreshGhosts();
  const hovered = gameInput.hovered();
  layer.prepare(world, camera.view, alpha, { selected: selection.ids, hovered: hovered ? hovered.id : 0, visible: world.fogEnabled ? seen : null, ghosts: ghostList });
  renderer.render(camera.view, Math.max(0, world.tick - 1 + alpha) * loop.clock.step, showGrid, layer);
  const context = canvas.getContext('2d')!;
  effects.drawProjectiles(context, world, world.projectiles, alpha, tileVisible);
  effects.draw(context);
  fogLayer.draw(context);
  if (placement.mode === 'place' && gameInput.pointerTile(hoverTile)) {
    placement.update(world, PLAYER, hoverTile.x, hoverTile.y);
    placement.draw(context, world, layer);
  }
  drawSelectionGuides(context, hovered);
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
  hud.renderMinimap(camera.view, dots, fogLayer.enabled ? fogLayer.canvas : null);
  updateCursor(hovered);
  if (inspected && inspected.id > 0 && (!world.get(inspected.id) || !seen(inspected))) inspected = null;
  if (inspected && inspected.id < 0 && !ghostList.includes(inspected)) inspected = null;
  if (started - lastPanel > 120) {
    panel.update(world, selection, layer, inspected);
    updateHud();
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
function benchmark(frames = 600, pan = true): Record<string, number> {
  const samples: number[] = [];
  const simSamples: number[] = [];
  for (let i = 0; i < frames; i++) {
    const start = performance.now();
    if (i % 3 === 0) { const s = performance.now(); tick(); simSamples.push(performance.now() - s); }
    if (pan) camera.pan(Math.sin(i / 60) * 6, Math.cos(i / 80) * 3, true);
    renderFrame((i % 3) / 3, 1 / 60);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  simSamples.sort((a, b) => a - b);
  const pick = (list: number[], q: number): number => Math.round(list[Math.min(list.length - 1, Math.floor(list.length * q))] * 100) / 100;
  return { frames, units: world.entities.length, visible: layer.count, projectiles: world.projectiles.count, peakProjectiles: world.projectiles.peak, median: pick(samples, 0.5), p95: pick(samples, 0.95), max: pick(samples, 1), simMedian: pick(simSamples, 0.5), simMax: pick(simSamples, 1) };
}

/** QA: advance the simulation synchronously (works while the tab is hidden) and redraw. */
function advance(ticks: number): number {
  for (let i = 0; i < ticks; i++) tick();
  lastPanel = 0;
  renderFrame(1, 0);
  return world.tick;
}

// Debug/QA hook for measuring in the browser without affecting the simulation.
(window as unknown as { steelFront: unknown }).steelFront = { get world() { return world; }, camera, selection, layer, benchmark, startScenario, advance, placement, effects, fogLayer,
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
