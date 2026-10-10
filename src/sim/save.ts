import type { TerrainMap } from '../types.ts';
import type { Command } from './commands.ts';
import { createEntity } from './entities.ts';
import type { Entity } from './entities.ts';
import type { MemoryRecord } from './fog.ts';
import { createAiState } from './ai.ts';
import type { PendingPlacement } from './production.ts';
import { hashText } from './rules.ts';
import type { Rules } from './rules.ts';
import type { MatchSetup } from './skirmish.ts';
import { World } from './world.ts';
import type { MatchOutcome, PathJob, Player } from './world.ts';

/**
 * Versioned match saves. A save is the complete authoritative world at a tick
 * boundary (no caches, canvases or object references), so a restored world
 * continues exactly as the uninterrupted one would. Loading validates everything
 * into a fresh World before anything is replaced.
 */
export const SAVE_FORMAT = 'steel-front-save';
export const SAVE_VERSION = 1;
/** Upper bound on a save's JSON length (characters); larger input is rejected unparsed. */
export const MAX_SAVE_CHARS = 3_000_000;

export interface SaveFile {
  format: string;
  version: number;
  /** Rules content hash; a save only loads against identical data. */
  rules: string;
  setup: MatchSetup;
  map: { seed: number; width: number; height: number; checksum: string };
  /** Display label (scenario name) and wall-clock time of saving, for the load menu only. */
  label: string;
  savedAt: string;
  world: WorldState;
}

interface PlayerState extends Omit<Player, 'fog'> {
  fog: { visible: number[]; explored: number[]; memory: MemoryRecord[] };
}

interface ProjectileState {
  slot: number; x: number; y: number; prevX: number; prevY: number; tx: number; ty: number;
  target: number; shooter: number; owner: number; weapon: number; rank: number; total: number; travelled: number;
}

export interface WorldState {
  tick: number; nextId: number; nextItem: number; commandSeq: number; random: number;
  fogEnabled: boolean; victory: boolean; outcome: MatchOutcome | null;
  entities: Entity[];
  players: PlayerState[];
  pending: PendingPlacement[];
  pathJobs: PathJob[];
  commands: Command[];
  projectiles: { active: ProjectileState[]; free: number[]; peak: number };
  nav: { revision: number; occupancy: number[]; structure: number[] };
}

export class SaveError extends Error {}

// ------------------------------------------------------------------ encoding

/** Run-length encoding of a byte mask as [value, length, value, length, ...]. */
function encodeRuns(bytes: Uint8Array): number[] {
  const runs: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const value = bytes[i];
    let j = i + 1;
    while (j < bytes.length && bytes[j] === value) j++;
    runs.push(value, j - i);
    i = j;
  }
  return runs;
}

function decodeRuns(runs: unknown, size: number, where: string): Uint8Array {
  if (!Array.isArray(runs) || runs.length % 2 !== 0) throw new SaveError(`${where}: malformed mask`);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (let i = 0; i < runs.length; i += 2) {
    const value = runs[i];
    const length = runs[i + 1];
    if ((value !== 0 && value !== 1) || !Number.isInteger(length) || length < 1 || at + length > size) throw new SaveError(`${where}: malformed mask`);
    bytes.fill(value, at, at + length);
    at += length;
  }
  if (at !== size) throw new SaveError(`${where}: mask has the wrong size`);
  return bytes;
}

/** Non-zero entries of an id grid as [index, id, index, id, ...]. */
function encodeSparse(values: Int32Array): number[] {
  const pairs: number[] = [];
  for (let i = 0; i < values.length; i++) if (values[i] !== 0) pairs.push(i, values[i]);
  return pairs;
}

export function mapChecksum(map: TerrainMap): string {
  let text = '';
  for (let i = 0; i < map.tiles.length; i++) text += String.fromCharCode(map.tiles[i] * 16 + map.props[i]);
  return hashText(text);
}

/** Authoritative world state as plain JSON data (deep-copied). */
export function captureWorld(world: World): WorldState {
  const pool = world.projectiles;
  const active: ProjectileState[] = [];
  for (let i = 0; i < pool.capacity; i++) {
    if (!pool.active[i]) continue;
    active.push({
      slot: i, x: pool.x[i], y: pool.y[i], prevX: pool.prevX[i], prevY: pool.prevY[i], tx: pool.tx[i], ty: pool.ty[i],
      target: pool.target[i], shooter: pool.shooter[i], owner: pool.owner[i], weapon: pool.weapon[i], rank: pool.rank[i],
      total: pool.total[i], travelled: pool.travelled[i],
    });
  }
  const state: WorldState = {
    tick: world.tick, nextId: world.nextId, nextItem: world.nextItem, commandSeq: world.commandSeq, random: world.random.state,
    fogEnabled: world.fogEnabled, victory: world.victory, outcome: world.outcome,
    entities: world.entities,
    players: world.players.map(player => ({
      ...player,
      fog: { visible: encodeRuns(player.fog.visible), explored: encodeRuns(player.fog.explored), memory: Array.from(player.fog.memory.values()) },
    })),
    pending: world.pending, pathJobs: world.pathJobs, commands: world.commands,
    projectiles: { active, free: pool.freeSlots(), peak: pool.peak },
    nav: { revision: world.nav.revision, occupancy: encodeSparse(world.nav.occupancy), structure: encodeSparse(world.nav.structure) },
  };
  return JSON.parse(JSON.stringify(state)) as WorldState;
}

export function serializeMatch(world: World, setup: MatchSetup, label: string, savedAt = new Date().toISOString()): string {
  const file: SaveFile = {
    format: SAVE_FORMAT, version: SAVE_VERSION, rules: world.rules.hash, setup,
    map: { seed: world.map.seed, width: world.map.width, height: world.map.height, checksum: mapChecksum(world.map) },
    label, savedAt, world: captureWorld(world),
  };
  return JSON.stringify(file);
}

// ------------------------------------------------------------------ validation

type Shape = number | string | boolean | Shape[] | { [key: string]: Shape } | Nullable | RecordOf | Opaque;
class Nullable { readonly shape: Shape; constructor(shape: Shape) { this.shape = shape; } }
class RecordOf { readonly shape: Shape; constructor(shape: Shape) { this.shape = shape; } }
/** Checked by dedicated code instead (optional fields). */
class Opaque {}

/** Strict structural check: same keys, primitive types and nested shapes as the template. */
function check(value: unknown, shape: Shape, where: string): void {
  if (shape instanceof Opaque) return;
  if (shape instanceof Nullable) {
    if (value !== null) check(value, shape.shape, where);
    return;
  }
  if (shape instanceof RecordOf) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SaveError(`${where}: expected an object`);
    for (const [key, item] of Object.entries(value)) check(item, shape.shape, `${where}.${key}`);
    return;
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) throw new SaveError(`${where}: expected a list`);
    value.forEach((item, i) => check(item, shape[0], `${where}[${i}]`));
    return;
  }
  if (typeof shape === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SaveError(`${where}: expected an object`);
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) if (!(key in shape)) throw new SaveError(`${where}.${key}: unknown field`);
    for (const [key, item] of Object.entries(shape)) {
      if (!(key in record)) throw new SaveError(`${where}.${key}: missing`);
      check(record[key], item, `${where}.${key}`);
    }
    return;
  }
  if (typeof shape === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new SaveError(`${where}: expected a number`);
  } else if (typeof value !== typeof shape) {
    throw new SaveError(`${where}: expected a ${typeof shape}`);
  }
}

const N = 0;
const S = '';
const B = false;
const numbers: Shape = [N];
const ENTITY: Shape = (() => {
  const shape: Record<string, Shape> = {};
  for (const [key, value] of Object.entries(createEntity(0, 'unit', '', 0, 0))) shape[key] = value as Shape;
  shape.path = new Nullable(numbers);
  shape.yieldPath = new Nullable(numbers);
  shape.yieldAvoid = new Nullable(numbers);
  shape.docks = new Nullable([{ truck: N, tile: N, until: N }]);
  shape.cooldowns = numbers;
  return shape;
})();
const AI: Shape = (() => {
  const shape: Record<string, Shape> = {};
  for (const [key, value] of Object.entries(createAiState('', 0))) shape[key] = Array.isArray(value) ? numbers : value as Shape;
  shape.waves = [{ index: N, launchTick: N, size: N, composition: new RecordOf(N), target: N, arrivedTick: N }];
  shape.log = [S];
  return shape;
})();
const QUEUE_ITEM: Shape = { id: N, type: S, category: S, paid: N, work: N, total: N, reason: S };
const PLAYER: Shape = {
  index: N, faction: S, credits: N,
  ledger: { initial: N, delivered: N, oil: N, spent: N, refunded: N, sold: N },
  queues: new RecordOf([QUEUE_ITEM]), power: { supply: N, demand: N }, notice: S, noticeTick: N,
  fog: { visible: numbers, explored: numbers, memory: [{ id: N, type: S, owner: N, tile: N, x: N, y: N }] },
  start: N, ai: new Nullable(AI), alive: B, deployed: B, defeatTick: N,
  stats: { unitsBuilt: N, buildingsBuilt: N, unitsLost: N, buildingsLost: N },
};
const COMMAND: Shape = { tick: N, seq: N, player: N, kind: S, ids: numbers, x: N, y: N };
const PROJECTILE: Shape = { slot: N, x: N, y: N, prevX: N, prevY: N, tx: N, ty: N, target: N, shooter: N, owner: N, weapon: N, rank: N, total: N, travelled: N };
const WORLD: Shape = {
  tick: N, nextId: N, nextItem: N, commandSeq: N, random: N, fogEnabled: B, victory: B,
  outcome: new Nullable({ tick: N, winner: N, draw: B }),
  entities: [ENTITY], players: [PLAYER],
  pending: [{ player: N, type: S, origin: N, item: N, unit: N, until: N }],
  pathJobs: [{ entity: N, orderId: N, dynamic: B, fieldTarget: N }],
  // Commands carry optional fields, checked separately.
  commands: [new Opaque()],
  projectiles: { active: [PROJECTILE], free: numbers, peak: N },
  nav: { revision: N, occupancy: numbers, structure: numbers },
};
const COMMAND_KINDS = new Set(['move', 'stop', 'harvest', 'deposit', 'capture', 'build', 'cancel', 'place', 'deploy', 'sell', 'repair', 'rally', 'attack', 'amove']);

function checkCommand(value: unknown, where: string): void {
  const record = value as Record<string, unknown>;
  const { target, type, ...rest } = record;
  check(rest, COMMAND, where);
  if (target !== undefined) check(target, N, `${where}.target`);
  if (type !== undefined) check(type, S, `${where}.type`);
  if (!COMMAND_KINDS.has(record.kind as string)) throw new SaveError(`${where}.kind: unknown command`);
}

function checkSetup(value: unknown, rules: Rules): MatchSetup {
  const setup = value as Record<string, unknown>;
  if (!setup || typeof setup !== 'object') throw new SaveError('setup: expected an object');
  if (setup.kind === 'skirmish') check(setup, { kind: S, map: S, faction: S, difficulty: S }, 'setup');
  else if (setup.kind === 'scenario') check(setup, { kind: S, id: S, difficulty: S }, 'setup');
  else throw new SaveError('setup.kind: unknown match type');
  if (!rules.ai.difficulties.has(setup.difficulty as string)) throw new SaveError('setup.difficulty: unknown difficulty');
  return setup as unknown as MatchSetup;
}

/**
 * Parse and validate a save's envelope. Throws SaveError with a readable reason for
 * oversized, malformed or incompatible input.
 */
export function parseSave(text: string, rules: Rules): SaveFile {
  if (text.length > MAX_SAVE_CHARS) throw new SaveError(`save is too large (${Math.round(text.length / 1024)} KB, limit ${Math.round(MAX_SAVE_CHARS / 1024)} KB)`);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SaveError('save data is not valid JSON (corrupted?)'); }
  if (!raw || typeof raw !== 'object') throw new SaveError('save data is not a Steel Front save');
  const file = raw as Record<string, unknown>;
  if (file.format !== SAVE_FORMAT) throw new SaveError('save data is not a Steel Front save');
  if (file.version !== SAVE_VERSION) throw new SaveError(`save version ${String(file.version)} is not supported (this build reads version ${SAVE_VERSION})`);
  if (file.rules !== rules.hash) throw new SaveError('save was made with different game data (rules changed since it was saved)');
  check(file.map, { seed: N, width: N, height: N, checksum: S }, 'map');
  check(file.label, S, 'label');
  check(file.savedAt, S, 'savedAt');
  checkSetup(file.setup, rules);
  check(file.world, WORLD, 'world');
  return file as unknown as SaveFile;
}

function fail(condition: boolean, message: string): void {
  if (condition) throw new SaveError(message);
}

/**
 * Build a fresh World from validated save state. The map must be the regenerated
 * terrain for the save's setup (checked by checksum). Never touches any other world.
 */
export function restoreWorld(rules: Rules, map: TerrainMap, file: SaveFile): World {
  fail(file.map.width !== map.width || file.map.height !== map.height || file.map.checksum !== mapChecksum(map), 'save map does not match the regenerated terrain');
  const state = file.world;
  const world = new World(rules, map, file.map.seed);
  const size = world.nav.size;
  const int = (value: number, min: number, max: number): boolean => Number.isInteger(value) && value >= min && value <= max;
  fail(!int(state.tick, 0, 1e9) || !int(state.nextId, 1, 1e9) || !int(state.nextItem, 1, 1e9) || !int(state.commandSeq, 0, 1e9) || !int(state.random, 0, 0xffffffff), 'world counters are out of range');
  fail(state.players.length < 1 || state.players.length > 8, 'save has an invalid number of players');
  world.tick = state.tick;
  world.nextId = state.nextId;
  world.nextItem = state.nextItem;
  world.commandSeq = state.commandSeq;
  world.random.state = state.random;
  world.fogEnabled = state.fogEnabled;
  world.victory = state.victory;
  world.outcome = state.outcome;

  state.players.forEach((saved, index) => {
    fail(saved.index !== index || !rules.factions.has(saved.faction), `player ${index}: invalid faction or index`);
    fail(saved.ai !== null && !rules.ai.difficulties.has(saved.ai.difficulty), `player ${index}: unknown AI difficulty`);
    for (const [category, items] of Object.entries(saved.queues)) {
      fail(!rules.production.categories.some(c => c.id === category), `player ${index}: unknown queue ${category}`);
      for (const item of items) fail(item.category !== category || !(rules.units.has(item.type) || rules.buildings.has(item.type)), `player ${index}: invalid queue item ${item.type}`);
    }
    const player = world.addPlayer(saved.faction, saved.credits);
    const { fog, ...rest } = saved;
    Object.assign(player, rest);
    player.fog.visible.set(decodeRuns(fog.visible, size, `player ${index} visibility`));
    player.fog.explored.set(decodeRuns(fog.explored, size, `player ${index} exploration`));
    for (const record of fog.memory) {
      fail(!rules.buildings.has(record.type) || !int(record.tile, 0, size - 1), `player ${index}: invalid remembered structure`);
      player.fog.memory.set(record.id, record);
    }
  });

  const players = state.players.length;
  for (const entity of state.entities) {
    const def = entity.kind === 'unit' ? rules.units.get(entity.type) : entity.kind === 'building' ? rules.buildings.get(entity.type) : undefined;
    fail(!def, `entity ${entity.id}: unknown type ${entity.type}`);
    fail(!int(entity.id, 1, state.nextId - 1) || world.byId.has(entity.id), `entity ${entity.id}: invalid or duplicate id`);
    fail(!int(entity.owner, -1, players - 1) || !int(entity.tile, -1, size - 1) || !int(entity.next, -1, size - 1) || !int(entity.goal, -1, size - 1), `entity ${entity.id}: owner or position out of range`);
    fail(entity.path !== null && entity.path.some(tile => !int(tile, 0, size - 1)), `entity ${entity.id}: invalid path`);
    world.entities.push(entity);
    world.byId.set(entity.id, entity);
  }
  for (const pending of state.pending) fail(!rules.buildings.has(pending.type) || !int(pending.player, 0, players - 1) || !int(pending.origin, 0, size - 1), 'invalid pending placement');
  world.pending.push(...state.pending);
  world.pathJobs.push(...state.pathJobs);
  state.commands.forEach((command, i) => checkCommand(command, `commands[${i}]`));
  for (const command of state.commands) fail(!int(command.player, 0, players - 1), 'command for an unknown player');
  world.commands.push(...state.commands);

  const nav = world.nav;
  const grid = (pairs: number[], target: Int32Array, kind: 'unit' | 'building', where: string): void => {
    fail(pairs.length % 2 !== 0, `${where}: malformed`);
    for (let i = 0; i < pairs.length; i += 2) {
      const entity = world.byId.get(pairs[i + 1]);
      fail(!int(pairs[i], 0, size - 1) || !entity || entity.kind !== kind, `${where}: refers to a missing ${kind}`);
      target[pairs[i]] = pairs[i + 1];
    }
  };
  grid(state.nav.occupancy, nav.occupancy, 'unit', 'occupancy');
  grid(state.nav.structure, nav.structure, 'building', 'structures');
  fail(!int(state.nav.revision, 0, 1e9), 'navigation revision out of range');
  nav.revision = state.nav.revision;
  nav.refreshComponents();

  const pool = world.projectiles;
  const free = state.projectiles.free;
  const used = new Uint8Array(pool.capacity);
  for (const shot of state.projectiles.active) {
    fail(!int(shot.slot, 0, pool.capacity - 1) || used[shot.slot] === 1 || !int(shot.weapon, 0, world.weaponList.length - 1), 'invalid projectile');
    used[shot.slot] = 1;
    const i = shot.slot;
    pool.active[i] = 1;
    pool.x[i] = shot.x; pool.y[i] = shot.y; pool.prevX[i] = shot.prevX; pool.prevY[i] = shot.prevY;
    pool.tx[i] = shot.tx; pool.ty[i] = shot.ty; pool.target[i] = shot.target; pool.shooter[i] = shot.shooter;
    pool.owner[i] = shot.owner; pool.weapon[i] = shot.weapon; pool.rank[i] = shot.rank; pool.total[i] = shot.total; pool.travelled[i] = shot.travelled;
  }
  for (const slot of free) {
    fail(!int(slot, 0, pool.capacity - 1) || used[slot] === 1, 'projectile free list is inconsistent');
    used[slot] = 1;
  }
  fail(used.some(v => v === 0), 'projectile free list is inconsistent');
  pool.restoreFree(free, state.projectiles.peak);
  return world;
}

/** Validate and restore in one step; the caller swaps worlds only on success. */
export function loadMatch(text: string, rules: Rules, mapFor: (setup: MatchSetup) => TerrainMap): { world: World; setup: MatchSetup; file: SaveFile } {
  const file = parseSave(text, rules);
  let map: TerrainMap;
  try { map = mapFor(file.setup); } catch (error) { throw new SaveError(`save refers to an unknown match setup: ${(error as Error).message}`); }
  return { world: restoreWorld(rules, map, file), setup: file.setup, file };
}
