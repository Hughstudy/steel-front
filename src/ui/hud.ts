import type { CameraView, MapConfig, TerrainMap } from '../types.ts';
import { Minimap } from './minimap.ts';
import './styles.css';

interface HudActions {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  toggleGrid: () => void;
  jump: (tileX: number, tileY: number) => void;
}

interface FrameStats {
  fps: number;
  frameMs: number;
  tick: number;
  visibleChunks: number;
  grid: boolean;
}

const terrain = [
  { name: 'Open ground', description: 'Clear terrain. Room to maneuver.', tag: 'PASSABLE', color: '#81915b' },
  { name: 'Woodland', description: 'Dense trees break up the open ground.', tag: 'TREE COVER', color: '#4f6847' },
  { name: 'River', description: 'Deep water. Locate a bridge to cross.', tag: 'IMPASSABLE', color: '#689c9f' },
  { name: 'Riverbank', description: 'Sandy ground beside the water.', tag: 'PASSABLE', color: '#b9aa82' },
  { name: 'Country road', description: 'A clear route through the countryside.', tag: 'PASSABLE', color: '#b8ab84' },
  { name: 'Rocky ground', description: 'Rough stone interrupts the landscape.', tag: 'ROUGH TERRAIN', color: '#999d90' },
  { name: 'River crossing', description: 'A bridge links the two riverbanks.', tag: 'PASSABLE', color: '#a79b7e' },
  { name: 'Farmland', description: 'Open fields with long sightlines.', tag: 'PASSABLE', color: '#b0a367' },
];

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing HUD element: ${id}`);
  return result as T;
}

export class Hud {
  private readonly minimap: Minimap;
  private readonly map: TerrainMap;
  private readonly config: MapConfig;
  private readonly zoom = element<HTMLOutputElement>('zoom-level');
  private readonly fps = element<HTMLSpanElement>('fps');
  private readonly coordinates = element<HTMLSpanElement>('coordinates');
  private readonly grid = element<HTMLButtonElement>('grid-toggle');
  private readonly terrainName = element<HTMLHeadingElement>('terrain-name');
  private readonly description = element<HTMLParagraphElement>('terrain-description');
  private readonly terrainTag = element<HTMLSpanElement>('terrain-tag');
  private readonly tileCoordinate = element<HTMLSpanElement>('tile-coordinate');
  private readonly portrait = element<HTMLDivElement>('terrain-portrait');
  private lastInspected = -1;
  private lastTerrain = -1;

  constructor(map: TerrainMap, config: MapConfig, actions: HudActions) {
    this.map = map;
    this.config = config;
    this.minimap = new Minimap(element<HTMLCanvasElement>('minimap'), map, config, actions.jump);
    element('map-name').textContent = config.name.toUpperCase();
    element('map-subtitle').textContent = config.subtitle;
    element('map-seed').textContent = `SEED ${map.seed}`;
    document.title = `Steel Front — ${config.name}`;
    const mapSize = document.querySelector('.map-size');
    if (mapSize) mapSize.textContent = `${map.width} × ${map.height}`;
    element('zoom-in').addEventListener('click', actions.zoomIn);
    element('zoom-out').addEventListener('click', actions.zoomOut);
    element('camera-reset').addEventListener('click', actions.reset);
    element('grid-toggle').addEventListener('click', actions.toggleGrid);
    const dialog = element<HTMLDialogElement>('field-guide');
    element('help-toggle').addEventListener('click', () => dialog.showModal());
    element('help-close').addEventListener('click', () => dialog.close());
    element('help-return').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    this.inspect(config.spawn.x, config.spawn.y);
  }

  update(view: CameraView, stats: FrameStats): void {
    this.zoom.textContent = `${Math.round(view.zoom * 100)}%`;
    this.fps.innerHTML = `<i></i> ${Math.round(stats.fps)} FPS`;
    this.fps.title = `${stats.frameMs.toFixed(1)} ms frame · ${stats.visibleChunks} visible chunks · simulation tick ${stats.tick}`;
    this.grid.setAttribute('aria-pressed', String(stats.grid));
    const x = Math.floor((view.x / (this.config.tileWidth / 2) + view.y / (this.config.tileHeight / 2)) / 2);
    const y = Math.floor((view.y / (this.config.tileHeight / 2) - view.x / (this.config.tileWidth / 2)) / 2);
    this.coordinates.textContent = `SECTOR ${String(x).padStart(3, '0')} : ${String(y).padStart(3, '0')}`;
  }

  inspect(tileX: number, tileY: number): void {
    tileX = Math.floor(tileX);
    tileY = Math.floor(tileY);
    if (tileX < 0 || tileY < 0 || tileX >= this.map.width || tileY >= this.map.height) return;
    const index = tileY * this.map.width + tileX;
    if (this.lastInspected === index) return;
    this.lastInspected = index;
    this.tileCoordinate.textContent = `${String(tileX).padStart(3, '0')}:${String(tileY).padStart(3, '0')}`;
    const id = this.map.tiles[index];
    if (this.lastTerrain === id) return;
    this.lastTerrain = id;
    const info = terrain[id] ?? terrain[0];
    this.terrainName.textContent = info.name;
    this.description.textContent = info.description;
    this.terrainTag.textContent = info.tag;
    this.terrainTag.style.color = id === 2 ? '#a9d3d8' : '#d7d0a2';
    const ground = this.portrait.querySelector<SVGPathElement>('.portrait-ground');
    if (ground) ground.style.fill = info.color;
    const tree = this.portrait.querySelector<SVGPathElement>('.portrait-tree');
    const trunk = this.portrait.querySelector<SVGPathElement>('.portrait-tree-trunk');
    if (tree) tree.style.opacity = id === 1 ? '1' : '0';
    if (trunk) trunk.style.opacity = id === 1 ? '1' : '0';
  }

  renderMinimap(view: CameraView): void { this.minimap.render(view); }
}
