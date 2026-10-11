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
import aiData from '../data/ai.json';
import skirmishData from '../data/skirmish.json';
import type { MapConfig, TerrainMap } from './types.ts';
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
import { clock, loadPreferences, Menus, readSlot, savePreferences, writeSlot } from './ui/menus.ts';
import { Sfx } from './audio/sfx.ts';
import type { Cue } from './audio/sfx.ts';
import { isSpectator, mapConfigFor, scenarioFor } from './sim/skirmish.ts';
import type { MatchSetup } from './sim/skirmish.ts';
import { loadMatch, MAX_SAVE_CHARS, SaveError, serializeMatch } from './sim/save.ts';
import { ProductionPanel } from './ui/production-panel.ts';
import { deployPreview, drawFootprint, Placement, problemText } from './ui/placement.ts';
import type { HudMode } from './ui/placement.ts';

const baseConfig: MapConfig = mapData;
const rules = loadRules({
  game: gameData, terrain: terrainData, factions: factionData, units: unitData, scenarios: scenarioData,
  buildings: buildingData, economy: economyData, maps: mapPresetData, production: productionData,
  weapons: weaponData, combat: combatData, ai: aiData, skirmish: skirmishData,
});
const canvas = document.querySelector<HTMLCanvasElement>('#battlefield')!;
const viewport = document.querySelector<HTMLElement>('#viewport')!;

/** Generated terrain per map preset (small typed arrays; the renderer caches are per match). */
const terrains = new Map<string, { map: TerrainMap; config: MapConfig }>();
function terrainFor(id: string): { map: TerrainMap; config: MapConfig } {
  let entry = terrains.get(id);
  if (!entry) {
    const preset = rules.maps.get(id);
    if (!preset) throw new Error(`unknown map ${id}`);
    const config = mapConfigFor(baseConfig, preset);
    entry = { map: generateTerrain(config), config };
    terrains.set(id, entry);
  }
  return entry;
}

let mapId = rules.skirmish.defaultMap;
let { map, config } = terrainFor(mapId);
const camera = new Camera(map.width, map.height);
let renderer = new TerrainRenderer(canvas, map, config);
const layer = new EntityLayer();
const markers = new OrderMarkers();
const fogLayer = new FogLayer(map.width, map.height);
const effects = new Effects();
const placement = new Placement();
const selection = new Selection();
const sfx = new Sfx();
const prefs = loadPreferences();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const PLAYER = 0;
/** The running match's setup; null while no match exists (menu backdrop). */
let setup: MatchSetup | null = null;
const spectating = (): boolean => isSpectator(setup);
const viewer = (): number => spectating() ? -1 : PLAYER;
/** All human command entry points share the observer guard. AI commands stay in the simulation. */
function issueCommand(command: Parameters<World['enqueue']>[0]): void {
  if (setup && !spectating() && !world.outcome) world.enqueue(command);
}
let world = backdropWorld();
let home = { x: config.spawn.x, y: config.spawn.y };
/** Entity shown in the panel when nothing is selected (live entity id or a memory ghost). */
let inspected: Entity | null = null;
let showGrid = false;
let presentationTime = 0;
/** Wall-clock ms at which the terminal outcome was first seen (-1 none), and whether results were shown. */
let outcomeSeen = -1;
let resultsShown = false;
/** Screenshake energy (0..1), decays over time; presentation only. */
let trauma = 0;
const stats = { fps: 60, frameMs: 0, tick: 0, visibleChunks: 0, grid: false };

/** An empty, fog-free world on the current map: the backdrop behind the main menu. */
function backdropWorld(): World {
  const empty = new World(rules, map, rules.maps.get(mapId)!.seed);
  empty.fogEnabled = false;
  return empty;
}

/** Switch terrain, renderer and minimap to another map, releasing the previous renderer's caches. */
function useMap(id: string): void {
  if (id === mapId) return;
  const next = terrainFor(id);
  if (next.map.width !== map.width || next.map.height !== map.height) throw new Error('all maps must share the base dimensions');
  renderer.dispose();
  mapId = id;
  map = next.map;
  config = next.config;
  renderer = new TerrainRenderer(canvas, map, config);
  hud.setMap(map, config);
}

/** Make `next` the active match and reset all per-match presentation state. */
function install(next: World, nextSetup: MatchSetup | null, focus: { x: number; y: number }, title: string, text: string): void {
  world = next;
  setup = nextSetup;
  layer.warm(world);
  fogLayer.reset();
  ghosts.clear();
  selection.reset();
  inspected = null;
  setMode('');
  markers.clear();
  effects.clear();
  trauma = 0;
  outcomeSeen = -1;
  resultsShown = false;
  menus.clearResults();
  watch.reset();
  home = focus;
  camera.reset(focus.x, focus.y);
  document.getElementById('mission-title')!.firstChild!.textContent = title.toUpperCase();
  document.getElementById('mission-text')!.textContent = text;
  document.getElementById('mode-label')!.textContent = !nextSetup ? 'MAIN MENU' : spectating() ? 'AI VS AI' : nextSetup.kind === 'skirmish' ? 'SKIRMISH' : 'DEVELOPMENT SCENARIO';
  document.getElementById('bottom-mode')!.textContent = !nextSetup ? 'MAIN MENU' : nextSetup.kind === 'skirmish'
    ? `${spectating() ? 'OBSERVER · TWO' : 'SKIRMISH ·'} ${rules.ai.difficulties.get(nextSetup.difficulty)!.name.toUpperCase()} ${spectating() ? 'AIs' : 'COMPUTER OPPONENT'}` : 'DEVELOPMENT SCENARIO · NO VICTORY CONDITION';
  document.getElementById('production-panel')!.hidden = spectating();
  document.getElementById('spectator-panel')!.hidden = !spectating();
  document.getElementById('selection-actions')!.hidden = spectating();
  document.getElementById('app')!.classList.toggle('spectating', spectating());
  updateHud();
  lastPanel = 0;
}

function startMatch(next: MatchSetup): void {
  const scenario = scenarioFor(rules, next);
  useMap(scenario.map);
  const fresh = new World(rules, map, rules.maps.get(scenario.map)!.seed);
  fresh.loadScenario(scenario, { difficulty: next.difficulty });
  install(fresh, next, scenario.camera, scenario.name, scenario.description);
  menus.stack.reset();
  canvas.focus();
}

function quitToMenu(): void {
  install(backdropWorld(), null, { x: map.width / 2, y: map.height / 2 }, 'Steel Front', 'Choose NEW SKIRMISH to begin.');
  menus.showMain();
}

function matchLabel(): string {
  if (!setup) return '';
  const scenario = scenarioFor(rules, setup);
  const faction = rules.factions.get(world.players[PLAYER]?.faction ?? '')?.name ?? '';
  return setup.kind === 'skirmish' ? `${spectating() ? 'AI vs AI · ' : ''}${faction} · ${rules.maps.get(setup.map)!.name} · ${rules.ai.difficulties.get(setup.difficulty)!.name} · Infinite yards ${setup.infiniteSupplies === false ? 'off' : 'on'}` : `${scenario.name} (development)`;
}

function saveMatch(slot: number): string | null {
  if (!setup) return 'no battle in progress';
  if (world.outcome) return 'the battle is over';
  const text = serializeMatch(world, setup, matchLabel());
  if (text.length > MAX_SAVE_CHARS) return 'the battle is too large to save';
  return writeSlot(slot, text, { label: matchLabel(), savedAt: new Date().toISOString(), tick: world.tick });
}

function loadSaved(slot: number): string | null {
  const text = readSlot(slot);
  if (text === null) return 'the slot is empty';
  let loaded: ReturnType<typeof loadMatch>;
  try {
    loaded = loadMatch(text, rules, s => terrainFor(scenarioFor(rules, s).map).map);
  } catch (error) {
    return error instanceof SaveError ? error.message : 'the save data is invalid';
  }
  // Validated completely: only now replace the active match.
  const scenario = scenarioFor(rules, loaded.setup);
  useMap(scenario.map);
  const next = loaded.world;
  const own = next.entities.find(e => e.owner === PLAYER && (rules.buildings.get(e.type)?.capabilities.objective || typeof rules.units.get(e.type)?.capabilities.deploy === 'string'));
  const start = next.players[PLAYER]?.start ?? -1;
  const focus = own ? { x: own.x / next.subTile, y: own.y / next.subTile } : start >= 0 ? { x: start % map.width, y: (start / map.width) | 0 } : scenario.camera;
  install(next, loaded.setup, focus, scenario.name, scenario.description);
  menus.showPause();
  document.getElementById('pause-status')!.textContent = `Loaded slot ${slot} at ${clock(next.tick, rules.game.ticksPerSecond)}. Resume when ready.`;
  return null;
}

const reset = (): void => { camera.reset(home.x, home.y); };
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
  if (spectating() || !world.fogEnabled) return true;
  const x = Math.floor(tx);
  const y = Math.floor(ty);
  if (!world.nav.inBounds(x, y)) return false;
  return world.players[PLAYER].fog.visible[world.nav.index(x, y)] === 1;
}
const seen = (entity: Entity): boolean => spectating() || canSee(world, PLAYER, entity);

/**
 * Remembered enemy/neutral structures under fog, drawn as last seen. Ghosts use
 * negative ids so nothing can look up the live entity's health or activity.
 */
const ghosts = new Map<number, Entity>();
const ghostList: Entity[] = [];
function refreshGhosts(): void {
  ghostList.length = 0;
  if (spectating() || !world.fogEnabled) return;
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
  if (ids.length) issueCommand({ player: PLAYER, kind: 'stop', ids, x: 0, y: 0 });
}

function setMode(mode: HudMode, type = ''): void {
  if (spectating() && mode !== '') return;
  placement.start(mode, type);
  document.getElementById('mode-sell')!.setAttribute('aria-pressed', String(mode === 'sell'));
  document.getElementById('mode-repair')!.setAttribute('aria-pressed', String(mode === 'repair'));
  document.getElementById('action-amove')!.setAttribute('aria-pressed', String(mode === 'amove'));
}

/** Units in the selection (buildings are selectable too, but take different orders). */
function selectedUnits(): number[] { return selection.list().filter(id => world.get(id)?.kind === 'unit'); }

function deploySelected(): void {
  const ids = selectedUnits().filter(id => typeof rules.units.get(world.get(id)!.type)?.capabilities.deploy === 'string');
  if (ids.length) issueCommand({ player: PLAYER, kind: 'deploy', ids, x: 0, y: 0 });
}

const gameInput = new GameInput(canvas, camera, layer, selection, {
  player: viewer,
  world: () => world,
  selectable: (entity: Entity) => !spectating() && entity.owner === PLAYER,
  inspect: entity => { inspected = entity && (entity.id < 0 || seen(entity)) ? entity : null; },
  primaryAction: (tileX, tileY) => {
    if (spectating()) return false;
    if (placement.mode === 'place') {
      const def = rules.buildings.get(placement.type)!;
      const origin = placement.originAt(world, def, tileX, tileY);
      if (origin < 0) return true;
      placement.update(world, PLAYER, tileX, tileY);
      if (placement.problem !== '' && placement.problem !== 'occupied') {
        markers.add(tileX, tileY, 'invalid', presentationTime);
        sfx.play('denied');
        notice(`Cannot place: ${problemText(placement.problem)}`);
        return true;
      }
      issueCommand({ player: PLAYER, kind: 'place', ids: [], x: origin % world.nav.width, y: (origin / world.nav.width) | 0, type: placement.type });
      sfx.play('place');
      setMode('');
      return true;
    }
    if (placement.mode === 'amove') {
      const ids = selectedUnits();
      if (ids.length) {
        issueCommand({ player: PLAYER, kind: 'amove', ids, x: Math.floor(tileX), y: Math.floor(tileY) });
        markers.add(tileX, tileY, 'attack', presentationTime);
        sfx.play('attack');
      }
      setMode('');
      return true;
    }
    if (placement.mode === 'sell' || placement.mode === 'repair') {
      const target = gameInput.hovered();
      if (target && target.kind === 'building' && target.owner === PLAYER) {
        issueCommand({ player: PLAYER, kind: placement.mode, ids: [], x: 0, y: 0, target: target.id });
        markers.add(target.x / world.subTile, target.y / world.subTile, placement.mode === 'sell' ? 'invalid' : 'rally', presentationTime);
      }
      return true;
    }
    return false;
  },
  cancelAction: () => { const active = placement.mode !== ''; setMode(''); return active; },
  order: (tileX, tileY, target, _queue, attackMove) => {
    if (spectating()) return;
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
      for (const id of producers) issueCommand({ player: PLAYER, kind: 'rally', ids: [], x, y, target: id });
      if (producers.length) markers.add(tileX, tileY, 'rally', presentationTime);
      return;
    }
    if (target && target.owner === PLAYER && target.kind === 'unit' && selection.ids.has(target.id)
      && typeof rules.units.get(target.type)?.capabilities.deploy === 'string') {
      deploySelected();
      return;
    }
    if (attackMove && world.nav.inBounds(x, y)) {
      issueCommand({ player: PLAYER, kind: 'amove', ids, x, y });
      markers.add(tileX, tileY, 'attack', presentationTime);
      sfx.play('attack');
      return;
    }
    // Unseen or remembered targets take a plain move order (no hidden information).
    const context = contextOrder(world, PLAYER, ids, target && target.id > 0 && seen(target) ? target : null);
    if (context !== 'move' && target) {
      issueCommand({ player: PLAYER, kind: context, ids, x, y, target: target.id });
      markers.add(target.x / world.subTile, target.y / world.subTile, context === 'capture' || context === 'attack' ? 'attack' : 'rally', presentationTime);
      sfx.play(context === 'attack' ? 'attack' : 'order');
      return;
    }
    let kind: 'move' | 'nearest' | 'invalid' = 'invalid';
    if (nav.inBounds(x, y)) {
      // Read-only preview of how the simulation will resolve this target, for feedback.
      // Aircraft ignore ground navigation, so only a ground unit can make the order unreachable.
      const tile = nav.index(x, y);
      const groundLead = ids.map(id => world.get(id)).find(e => e && rules.units.get(e.type)?.movement === 'ground');
      const component = groundLead ? nav.componentOf(groundLead.next >= 0 ? groundLead.next : groundLead.tile) : -1;
      let resolved = !groundLead ? tile : component >= 0 ? nav.nearestInComponent(tile, component) : -1;
      // Under fog the marker must not reveal hidden structures: unseen ground shows the clicked tile.
      if (resolved >= 0 && world.fogEnabled && !world.players[PLAYER].fog.visible[tile]) resolved = tile;
      kind = resolved < 0 ? 'invalid' : resolved === tile ? 'move' : 'nearest';
      const flying = ids.some(id => { const e = world.get(id); return e !== undefined && rules.units.get(e.type)?.movement === 'air'; });
      if (resolved >= 0 || flying) {
        issueCommand({ player: PLAYER, kind: 'move', ids, x, y });
        const at = resolved >= 0 ? resolved : tile;
        markers.add((at % nav.width) + 0.5, ((at / nav.width) | 0) + 0.5, resolved >= 0 ? kind : 'move', presentationTime);
        sfx.play('order');
        return;
      }
    }
    markers.add(tileX, tileY, kind, presentationTime);
    sfx.play('denied');
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

document.getElementById('action-haul')!.addEventListener('click', () => {
  const ids = selectedUnits();
  if (ids.length) issueCommand({ player: PLAYER, kind: 'harvest', ids, x: 0, y: 0 });
});
document.getElementById('action-stop')!.addEventListener('click', stopSelected);
document.getElementById('action-amove')!.addEventListener('click', () => setMode(placement.mode === 'amove' ? '' : 'amove'));
document.getElementById('action-deploy')!.addEventListener('click', deploySelected);
document.getElementById('mode-sell')!.addEventListener('click', () => setMode(placement.mode === 'sell' ? '' : 'sell'));
document.getElementById('mode-repair')!.addEventListener('click', () => setMode(placement.mode === 'repair' ? '' : 'repair'));

const production = new ProductionPanel({
  world: () => world,
  player: () => PLAYER,
  activate: type => {
    if (spectating()) return;
    const def = rules.buildings.get(type);
    const head = def?.producer ? world.players[PLAYER].queues[def.producer]?.[0] : undefined;
    if (def && head && head.type === type && head.reason === 'ready') {
      setMode('place', type);
      return;
    }
    issueCommand({ player: PLAYER, kind: 'build', ids: [], x: 0, y: 0, type });
    sfx.play('build');
  },
  cancel: type => {
    if (placement.mode === 'place' && placement.type === type) setMode('');
    issueCommand({ player: PLAYER, kind: 'cancel', ids: [], x: 0, y: 0, type });
  },
  battlefield: () => canvas.focus(),
});
const productionRoot = document.getElementById('production-panel')!;
productionRoot.addEventListener('focusin', () => cameraInput.releaseKeys());
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-follow-player]')) {
  button.addEventListener('click', () => {
    if (!spectating()) return;
    const index = Number(button.dataset.followPlayer);
    const objective = world.entities.find(e => e.owner === index && (rules.buildings.get(e.type)?.capabilities.objective
      || typeof rules.units.get(e.type)?.capabilities.deploy === 'string'));
    const start = world.players[index].start;
    camera.jump(objective ? objective.x / world.subTile : start % map.width, objective ? objective.y / world.subTile : Math.floor(start / map.width));
    canvas.focus();
  });
}

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
  if (spectating()) {
    for (const name of CURSORS) canvas.classList.toggle(name, name === 'cursor-select' && hovered !== null);
    return;
  }
  let cursor = '';
  const units = selectedUnits();
  const target = hovered && hovered.id > 0 && seen(hovered) ? hovered : null;
  const context = units.length > 0 ? contextOrder(world, PLAYER, units, target) : 'move';
  const ownBuilding = hovered && hovered.kind === 'building' && hovered.owner === PLAYER ? rules.buildings.get(hovered.type)! : null;
  if (placement.mode === 'place') cursor = 'cursor-place';
  else if (placement.mode === 'amove') cursor = 'cursor-attack';
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
    // Only known ground is judged: live structures where visible, terrain where fogged, nothing where unexplored.
    let open = false;
    if (world.nav.inBounds(x, y)) {
      const tile = world.nav.index(x, y);
      const fog = world.fogEnabled ? world.players[PLAYER].fog : null;
      const airOnly = units.every(id => rules.units.get(world.get(id)?.type ?? '')?.movement === 'air');
      open = airOnly || (!fog || fog.visible[tile] ? world.nav.passable(tile) : !fog.explored[tile] || world.nav.terrainPassable[tile] === 1);
    }
    cursor = open ? 'cursor-move' : 'cursor-invalid';
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
      if (preview.origin >= 0) drawFootprint(context, world, def, preview.origin, preview.problem === '' ? 'ok' : preview.problem === 'occupied' ? 'warn' : 'bad', PLAYER);
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
const amoveButton = document.getElementById('action-amove')!;
const clockLabel = document.getElementById('clock')!;
function updateHud(): void {
  const player = world.players[PLAYER];
  clockLabel.textContent = clock(world.tick, rules.game.ticksPerSecond);
  funds.textContent = spectating() ? world.players.map(p => p.credits).join(' / ') : String(player?.credits ?? 0);
  funds.title = spectating() ? 'AI 1 / AI 2 credits' : 'Available credits';
  if (spectating()) {
    powerLabel.textContent = '—';
    powerLabel.classList.remove('is-low');
    powerLabel.title = 'Both armies’ power is shown in the observer panel';
    document.getElementById('spectator-summary')!.textContent = world.players.map(p =>
      `AI ${p.index + 1} · ${rules.factions.get(p.faction)!.name} · $${p.credits} · Power ${p.power.demand}/${p.power.supply}${p.alive ? '' : ' · DEFEATED'}`
    ).join('\n');
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-follow-player]')) {
      const p = world.players[Number(button.dataset.followPlayer)];
      button.textContent = `AI ${p.index + 1} · ${rules.factions.get(p.faction)!.name.toUpperCase()} BASE`;
    }
  } else if (player) {
    powerLabel.textContent = `${player.power.demand}/${player.power.supply}`;
    powerLabel.classList.toggle('is-low', player.power.demand > player.power.supply);
    powerLabel.title = player.power.demand > player.power.supply ? 'Low power: production runs at a quarter speed' : 'Power demand / supply';
  }
  const units = selectedUnits().map(id => world.get(id)!);
  deployButton.hidden = !units.some(u => typeof rules.units.get(u.type)?.capabilities.deploy === 'string');
  haulButton.hidden = !units.some(u => typeof rules.units.get(u.type)?.capabilities.cargo === 'number');
  stopButton.hidden = units.length === 0;
  amoveButton.hidden = !units.some(u => rules.units.get(u.type)!.weapons.length > 0);
  if (!spectating()) production.update();
}

let lastReport = performance.now();
let lastPanel = 0;
let frames = 0;
let renderDuration = 0;
let simDuration = 0;
/** One authoritative tick, then hand its events to the cosmetic effects and sound. */
function tick(): void {
  world.step();
  effects.consume(world, world.events, tileVisible);
  hear();
}

/** Battle sounds and shake for visible events near the view; louder near the screen centre. */
function hear(): void {
  const view = camera.view;
  const s = world.subTile;
  const reach = Math.max(view.width, view.height) / view.zoom;
  for (const event of world.events) {
    const tx = event.x / s;
    const ty = event.y / s;
    if (!tileVisible(tx, ty)) continue;
    const distance = Math.hypot((tx - ty) * 32 - view.x, (tx + ty) * 16 - view.y);
    const level = 1 - distance / reach;
    if (level <= 0) continue;
    let cue: Cue | null = null;
    if (event.kind === 'fire' || event.kind === 'impact') {
      const weapon = rules.weapons.get(event.weapon);
      if (!weapon) continue;
      if (event.kind === 'fire') cue = weapon.damageType === 'small' ? 'fire-small' : weapon.splashRadius > 0 ? 'fire-heavy' : 'fire-gun';
      else if (weapon.splashRadius > 0) { cue = 'impact'; trauma = Math.min(1, trauma + 0.04 * level); }
    } else if (event.kind === 'death') {
      if (event.a === 2) { cue = 'explosion-big'; trauma = Math.min(1, trauma + 0.55 * level); }
      else if (event.a === 1 || rules.units.get(event.weapon)?.armor !== 'infantry') { cue = 'explosion'; trauma = Math.min(1, trauma + 0.2 * level); }
    }
    if (cue) sfx.play(cue, level);
  }
}

/** Per-frame feedback derived from the local player's state (no simulation reads besides what the HUD shows). */
const watch = {
  selection: new Set<number>(),
  notice: 0,
  units: 0,
  buildings: 0,
  ready: new Set<string>(),
  reset(): void { this.selection.clear(); this.notice = world.players[PLAYER]?.noticeTick ?? 0; this.units = this.buildings = 0; this.ready.clear(); this.sync(); },
  sync(): void {
    const player = world.players[PLAYER];
    if (player) { this.units = player.stats.unitsBuilt; this.buildings = player.stats.buildingsBuilt; }
  },
  update(): void {
    let added = false;
    for (const id of selection.ids) if (!this.selection.has(id)) { added = true; break; }
    if (added || selection.ids.size !== this.selection.size) {
      if (added) sfx.play('select');
      this.selection = new Set(selection.ids);
    }
    const player = world.players[PLAYER];
    if (!player) return;
    if (player.noticeTick > this.notice) { this.notice = player.noticeTick; sfx.play('denied'); }
    if (player.stats.unitsBuilt > this.units) sfx.play('build', 0.7);
    if (player.stats.buildingsBuilt > this.buildings) sfx.play('place');
    this.sync();
    for (const [category, queue] of Object.entries(player.queues)) {
      const ready = queue[0]?.reason === 'ready';
      if (ready && !this.ready.has(category)) sfx.play('ready');
      if (ready) this.ready.add(category); else this.ready.delete(category);
    }
  },
};

function simulate(): void {
  const started = performance.now();
  tick();
  simDuration += performance.now() - started;
}

function renderFrame(alpha: number, dt: number): void {
  const started = performance.now();
  presentationTime += dt;
  sfx.hold(document.hidden);
  if (!setup && !menus.paused) menus.showMain();
  if (!setup) camera.pan(Math.cos(presentationTime / 9) * 22 * dt, Math.sin(presentationTime / 7) * 12 * dt, true);
  cameraInput.update(dt);
  camera.update(dt);
  checkOutcome();
  watch.update();
  // Bounded, decaying screenshake: offsets only the drawn view, never input or simulation.
  trauma = Math.max(0, trauma - dt * 1.8);
  const shake = prefs.shake && !reducedMotion.matches ? trauma * trauma * 7 : 0;
  const shakeX = shake * Math.sin(presentationTime * 71);
  const shakeY = shake * Math.cos(presentationTime * 53) * 0.6;
  camera.view.x += shakeX;
  camera.view.y += shakeY;
  selection.prune(world, PLAYER);
  effects.now = presentationTime;
  fogLayer.update(world, viewer());
  refreshGhosts();
  const hovered = gameInput.hovered();
  layer.prepare(world, camera.view, alpha, { selected: selection.ids, hovered: hovered ? hovered.id : 0, visible: world.fogEnabled ? seen : null, ghosts: ghostList });
  renderer.render(camera.view, Math.max(0, world.tick - 1 + alpha) * loop.clock.step, showGrid, layer);
  const context = canvas.getContext('2d')!;
  effects.drawProjectiles(context, world, world.projectiles, alpha, tileVisible);
  effects.draw(context);
  dayTint(context);
  fogLayer.draw(context);
  camera.view.x -= shakeX;
  camera.view.y -= shakeY;
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
/** Subtle light of the map's season, slowly varying over a 20-minute day; soft-light keeps contrast. */
function dayTint(context: CanvasRenderingContext2D): void {
  const tint = config.palette.tint;
  if (!tint) return;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'soft-light';
  context.globalAlpha = 0.16 + 0.06 * Math.sin(world.tick / (20 * 60 * 20) * Math.PI * 2);
  context.fillStyle = tint;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
}

/** Results appear shortly after the terminal tick so the final explosion can be seen. */
function checkOutcome(): void {
  if (!setup || !world.outcome || resultsShown) return;
  if (outcomeSeen < 0) {
    outcomeSeen = performance.now();
    setMode('');
    const won = spectating() ? !world.outcome.draw : world.outcome.winner === PLAYER;
    sfx.hold(false);
    sfx.play(won ? 'victory' : 'defeat');
  }
  if (performance.now() - outcomeSeen < 2500 || menus.paused) return;
  resultsShown = true;
  menus.showResults(world, viewer(), true);
}

const menus = new Menus({
  rules,
  prefs,
  get reducedMotion() { return reducedMotion.matches; },
  start: next => {
    try { startMatch(next); } catch (error) { console.error(error); }
  },
  resume: () => { canvas.focus(); },
  quitToMenu,
  save: saveMatch,
  load: loadSaved,
  playAgain: () => { if (setup) startMatch(setup); },
  applyPreferences: () => {
    sfx.setVolume(prefs.volume);
    sfx.setMuted(prefs.muted);
    savePreferences(prefs);
    syncAudioButton();
  },
  click: () => sfx.play('click'),
  matchActive: () => setup !== null,
  canSave: () => setup !== null && world.outcome === null,
  summary: () => setup ? `${matchLabel()} · ${clock(world.tick, rules.game.ticksPerSecond)}${world.outcome ? ' · battle over' : ''}` : 'No battle in progress.',
});
const audioButton = document.getElementById('audio-toggle')!;
function syncAudioButton(): void {
  audioButton.setAttribute('aria-pressed', String(prefs.muted));
  document.getElementById('audio-state')!.textContent = prefs.muted ? 'OFF' : 'ON';
  menus.syncSettings();
}
function toggleMute(): void {
  prefs.muted = !prefs.muted;
  sfx.setMuted(prefs.muted);
  savePreferences(prefs);
  syncAudioButton();
}
sfx.setVolume(prefs.volume);
sfx.setMuted(prefs.muted);
syncAudioButton();
audioButton.addEventListener('click', toggleMute);
// Audio may only start from a user gesture (browser autoplay policy).
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => sfx.unlock(), { capture: true });
const openPause = (): void => { if (setup && !menus.paused) { setMode(''); menus.showPause(); } };
document.getElementById('pause-button')!.addEventListener('click', openPause);
document.getElementById('help-toggle')!.addEventListener('click', () => menus.stack.open(document.getElementById('field-guide') as HTMLDialogElement));
window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]')) return;
  if (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (event.code === 'KeyP' || event.code === 'F10') { event.preventDefault(); openPause(); }
  else if (event.code === 'KeyM' && !event.repeat) toggleMute();
});
// Hiding the page opens the pause menu, so returning never drops the player straight into action.
document.addEventListener('visibilitychange', () => { if (document.hidden) openPause(); });

const loop = new GameLoop(simulate, renderFrame);
loop.paused = () => !setup || menus.paused || world.outcome !== null;
menus.showMain();
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
(window as unknown as { steelFront: unknown }).steelFront = { get world() { return world; },
  /** Development diagnostics: computer players' recent decisions and waves (not shown in the player HUD). */
  ai: () => world.players.filter(p => p.ai).map(p => ({ player: p.index, difficulty: p.ai!.difficulty, waves: p.ai!.waves, log: p.ai!.log.slice(-20) })), camera, selection, layer, benchmark, advance, placement, effects, fogLayer, sfx, menus,
  startMatch, get setup() { return setup; }, get trauma() { return trauma; }, get mapId() { return mapId; }, get renderer() { return renderer; },
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
    renderer.dispose();
    cameraInput.destroy();
    gameInput.destroy();
    observer.disconnect();
  });
}
