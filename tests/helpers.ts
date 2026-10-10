import { readFileSync } from 'node:fs';
import { generateTerrain } from '../src/sim/terrain.ts';
import { loadRules } from '../src/sim/rules.ts';
import type { Rules } from '../src/sim/rules.ts';
import { World } from '../src/sim/world.ts';
import type { MapConfig, TerrainMap } from '../src/types.ts';
import { mapConfigFor, skirmishScenario } from '../src/sim/skirmish.ts';
import { constructionProblem, deployOrigin } from '../src/sim/production.ts';
import { ringTiles } from '../src/sim/structures.ts';
import { UNREACHED } from '../src/sim/pathfinder.ts';

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
    weapons: readJson('weapons'), combat: readJson('combat'), ai: readJson('ai'), skirmish: readJson('skirmish'),
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

const presetMaps = new Map<string, TerrainMap>();
/** Generated terrain for a map preset (cached). */
export function presetMap(r: Rules, id: string): TerrainMap {
  let map = presetMaps.get(id);
  if (!map) {
    map = generateTerrain(mapConfigFor(mapConfig, r.maps.get(id)!));
    presetMaps.set(id, map);
  }
  return map;
}

/** A normal skirmish world: human (player 0) vs AI, as the menu starts it. */
export function skirmishWorld(r: Rules, map: string, faction: string, difficulty: string, seed?: number): World {
  const world = new World(r, presetMap(r, map), seed ?? r.maps.get(map)!.seed);
  world.loadScenario(skirmishScenario(r, map, faction, difficulty));
  return world;
}

/**
 * Static checks for a skirmish map: each spawn can deploy its HQ and has room for a
 * base, resources sit on reachable ground near both sides, and the bases connect.
 */
export function validateSkirmishMap(r: Rules, id: string): string[] {
  const problems: string[] = [];
  const preset = r.maps.get(id)!;
  let world: World;
  try { world = skirmishWorld(r, id, r.skirmish.defaultFaction, r.ai.defaultDifficulty); } catch (error) { return [`${id}: ${(error as Error).message}`]; }
  const nav = world.nav;
  const main = world.mainComponent();
  const field = (tile: number): Int32Array => world.fieldFrom(tile);
  const hqs: number[] = [];
  for (const player of world.players) {
    const mcv = world.entities.find(e => e.owner === player.index && typeof r.units.get(e.type)?.capabilities.deploy === 'string')!;
    const hq = r.buildings.get(r.units.get(mcv.type)!.capabilities.deploy as string)!;
    // The MCV must find a deploy site a few steps from where it starts.
    let deployable = false;
    for (let dy = -4; dy <= 4 && !deployable; dy++) for (let dx = -4; dx <= 4 && !deployable; dx++) {
      const x = (mcv.tile % nav.width) + dx;
      const y = ((mcv.tile / nav.width) | 0) + dy;
      if (!nav.inBounds(x, y) || nav.componentOf(nav.index(x, y)) !== main) continue;
      const origin = deployOrigin(world, hq, nav.index(x, y));
      const problem = origin < 0 ? 'bounds' : constructionProblem(world, player.index, hq, origin, false);
      deployable = problem === '' || problem === 'occupied';
    }
    if (!deployable) problems.push(`${id}: player ${player.index} MCV has no deploy site within 4 tiles of its start`);
    hqs.push(mcv.tile);
    let room = 0;
    const sx = mcv.tile % nav.width;
    const sy = (mcv.tile / nav.width) | 0;
    for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
      if (!nav.inBounds(sx + dx, sy + dy)) continue;
      const tile = nav.index(sx + dx, sy + dy);
      if (world.buildable[tile] && nav.passable(tile) && nav.componentOf(tile) === main) room++;
    }
    if (room < 220) problems.push(`${id}: player ${player.index} has only ${room} buildable tiles within 10 of the start`);
    const distances = field(mcv.tile);
    const near = world.entities.filter(e => e.owner < 0 && e.type === preset.supplyType && ringTiles(world, r.buildings.get(e.type)!, e.tile).some(t => distances[t] < 30 * 10)).length;
    if (near < 2) problems.push(`${id}: player ${player.index} has ${near} supply dumps within 30 tiles`);
  }
  for (const e of world.entities) {
    if (e.owner >= 0) continue;
    if (!ringTiles(world, r.buildings.get(e.type)!, e.tile).some(t => nav.passable(t) && nav.componentOf(t) === main)) problems.push(`${id}: ${e.type} at ${e.tile} is not reachable`);
  }
  if (field(hqs[0])[hqs[1]] >= UNREACHED) problems.push(`${id}: the bases are not connected by ground`);
  return problems;
}
