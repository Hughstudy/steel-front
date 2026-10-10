import { readFileSync } from 'node:fs';
import { generateTerrain } from '../src/sim/terrain.ts';
import { loadRules } from '../src/sim/rules.ts';
import type { Rules } from '../src/sim/rules.ts';
import { World } from '../src/sim/world.ts';
import type { MapConfig, TerrainMap } from '../src/types.ts';

export function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
}

export const mapConfig = readJson('map') as MapConfig;
let cachedMap: TerrainMap | null = null;
export function lowlands(): TerrainMap {
  cachedMap ??= generateTerrain(mapConfig);
  return cachedMap;
}

export function rawRules(): Record<string, unknown> {
  return {
    game: readJson('game'), terrain: readJson('terrain'), factions: readJson('factions'),
    units: readJson('units'), scenarios: readJson('scenarios'),
    buildings: readJson('buildings'), economy: readJson('economy'), maps: readJson('maps'), production: readJson('production'),
    weapons: readJson('weapons'), combat: readJson('combat'), ai: readJson('ai'),
  };
}

export function rules(): Rules { return loadRules(rawRules() as never); }

export function scenarioWorld(id: string, seed = 7): World {
  const r = rules();
  const world = new World(r, lowlands(), seed);
  world.loadScenario(r.scenarios.get(id)!);
  return world;
}

export function ids(world: World, owner = 0): number[] {
  return world.entities.filter(e => e.owner === owner && e.kind === 'unit').map(e => e.id);
}

/** Authoritative snapshot excluding memo caches. */
export function snapshot(world: World): string {
  const pool = world.projectiles;
  return JSON.stringify({
    tick: world.tick, entities: world.entities, jobs: world.pathJobs, occupancy: Array.from(world.nav.occupancy),
    projectiles: [Array.from(pool.active), Array.from(pool.x), Array.from(pool.y), Array.from(pool.target)],
    players: world.players.map(p => ({ credits: p.credits, ledger: p.ledger, queues: p.queues, visible: Array.from(p.fog.visible).join('') })),
  });
}
