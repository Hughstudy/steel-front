import { Random } from '../engine/random.ts';
import type { TerrainMap } from '../types.ts';
import type { Command, CommandInput } from './commands.ts';
import { createEntity, MoveState } from './entities.ts';
import type { Entity } from './entities.ts';
import { assignFormation } from './formations.ts';
import { LocalSearch } from './local-search.ts';
import { updateGroundUnit } from './movement.ts';
import { NavigationGrid } from './navigation-grid.ts';
import { Pathfinder, UNREACHED } from './pathfinder.ts';
import type { Rules, ScenarioDef } from './rules.ts';

export interface Player {
  index: number;
  faction: string;
  credits: number;
}

export interface PathJob {
  entity: number;
  orderId: number;
  dynamic: boolean;
  /** Tile whose distance field may guide this search (-1 = plain octile). */
  fieldTarget: number;
}

export interface WorldStats { pathJobs: number; expanded: number; queuedJobs: number }

const FIELD_CACHE_SIZE = 6;

/**
 * Authoritative match state. Headless: no DOM, canvas, storage or wall-clock time.
 * Per-tick order: snapshot transforms → commands → path jobs → movement.
 */
export class World {
  readonly rules: Rules;
  readonly map: TerrainMap;
  readonly nav: NavigationGrid;
  readonly pathfinder: Pathfinder;
  readonly search: LocalSearch;
  readonly subTile: number;
  readonly random: Random;
  readonly players: Player[] = [];
  readonly entities: Entity[] = [];
  readonly byId = new Map<number, Entity>();
  tick = 0;
  nextId = 1;
  commandSeq = 0;
  readonly commands: Command[] = [];
  readonly pathJobs: PathJob[] = [];
  readonly stats: WorldStats = { pathJobs: 0, expanded: 0, queuedJobs: 0 };
  /** Memoised distance fields keyed by `target:revision`; a pure cache, never state. */
  private readonly fields = new Map<string, Int32Array>();

  constructor(rules: Rules, map: TerrainMap, seed: number) {
    this.rules = rules;
    this.map = map;
    this.subTile = rules.game.subTile;
    this.nav = new NavigationGrid(map, rules.terrain);
    this.pathfinder = new Pathfinder(this.nav);
    this.search = new LocalSearch(this.nav.size);
    this.random = new Random(seed);
  }

  get(id: number): Entity | undefined { return this.byId.get(id); }

  /** Largest connected ground region; spawns and scenario anchors resolve into it. */
  mainComponent(): number {
    const counts = new Map<number, number>();
    for (let i = 0; i < this.nav.size; i++) {
      const c = this.nav.componentOf(i);
      if (c >= 0) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let best = -1;
    let bestCount = -1;
    for (const [c, n] of counts) if (n > bestCount) { best = c; bestCount = n; }
    return best;
  }

  addPlayer(faction: string, credits: number): Player {
    const player = { index: this.players.length, faction, credits };
    this.players.push(player);
    return player;
  }

  spawnUnit(type: string, owner: number, tile: number): Entity {
    const def = this.rules.units.get(type);
    if (!def) throw new Error(`Unknown unit ${type}`);
    if (def.movement === 'ground' && this.nav.occupancy[tile] !== 0) throw new Error(`Tile ${tile} occupied`);
    const entity = createEntity(this.nextId++, 'unit', type, owner, def.hp);
    entity.tile = tile;
    const s = this.subTile;
    entity.x = entity.prevX = (tile % this.nav.width) * s + (s >> 1);
    entity.y = entity.prevY = ((tile / this.nav.width) | 0) * s + (s >> 1);
    if (def.movement === 'ground') this.nav.occupancy[tile] = entity.id;
    this.entities.push(entity);
    this.byId.set(entity.id, entity);
    return entity;
  }

  /** Place scenario forces on free tiles in breadth-first order around each anchor. */
  loadScenario(scenario: ScenarioDef): void {
    const main = this.mainComponent();
    for (const setup of scenario.players) {
      const player = this.addPlayer(setup.faction, setup.credits);
      const anchor = this.nav.nearestInComponent(this.nav.index(setup.anchor.x, setup.anchor.y), main);
      if (anchor < 0) throw new Error(`Scenario ${scenario.id}: anchor is not near reachable ground`);
      let total = 0;
      for (const group of setup.units) total += group.count;
      const tiles = this.search.collect(this, anchor, total, total * 20 + 200, tile => this.nav.occupancy[tile] === 0);
      if (tiles.length < total) throw new Error(`Scenario ${scenario.id}: not enough room for ${total} units`);
      let cursor = 0;
      for (const group of setup.units) {
        for (let i = 0; i < group.count; i++) this.spawnUnit(group.type, player.index, tiles[cursor++]);
      }
    }
  }

  enqueue(input: CommandInput, tick = this.tick + 1): Command {
    const command: Command = { ...input, ids: input.ids.slice(), tick: Math.max(tick, this.tick + 1), seq: this.commandSeq++ };
    this.commands.push(command);
    return command;
  }

  /** Destination tiles already promised to live units outside `except`. */
  claimedGoals(except: Set<number>): Set<number> {
    const claimed = new Set<number>();
    for (const entity of this.entities) {
      if (entity.goal >= 0 && !except.has(entity.id) && entity.moveState !== MoveState.Unreachable) claimed.add(entity.goal);
    }
    return claimed;
  }

  requestPath(unit: Entity, dynamic: boolean): void {
    if (unit.repath !== 0) {
      if (dynamic) unit.repath = 2;
      return;
    }
    unit.repath = dynamic ? 2 : 1;
    this.pathJobs.push({ entity: unit.id, orderId: unit.orderId, dynamic, fieldTarget: -1 });
  }

  step(): void {
    this.tick++;
    for (const entity of this.entities) {
      entity.prevX = entity.x;
      entity.prevY = entity.y;
      entity.prevFacing = entity.facing;
      entity.prevTurret = entity.turret;
    }
    this.executeCommands();
    this.processPathJobs();
    for (const entity of this.entities) {
      if (entity.kind !== 'unit') continue;
      const def = this.rules.units.get(entity.type)!;
      if (def.movement === 'ground') updateGroundUnit(this, entity, def);
    }
  }

  private executeCommands(): void {
    if (this.commands.length === 0) return;
    // Stable: commands are appended with increasing seq; execute everything due.
    let write = 0;
    for (let read = 0; read < this.commands.length; read++) {
      const command = this.commands[read];
      if (command.tick <= this.tick) this.execute(command);
      else this.commands[write++] = command;
    }
    this.commands.length = write;
  }

  private ownedUnits(command: Command): Entity[] {
    const units: Entity[] = [];
    const seen = new Set<number>();
    for (const id of command.ids) {
      const entity = this.byId.get(id);
      if (!entity || seen.has(id) || entity.kind !== 'unit' || entity.owner !== command.player) continue;
      seen.add(id);
      units.push(entity);
    }
    return units.sort((a, b) => a.id - b.id);
  }

  private execute(command: Command): void {
    const units = this.ownedUnits(command);
    if (command.kind === 'stop') {
      for (const unit of units) this.stopUnit(unit);
      return;
    }
    if (command.kind === 'move') {
      if (!this.nav.inBounds(command.x, command.y)) return;
      const ground = units.filter(unit => this.rules.units.get(unit.type)!.movement === 'ground');
      this.orderMove(ground, this.nav.index(command.x, command.y));
    }
  }

  stopUnit(unit: Entity): void {
    unit.orderId++;
    unit.path = null;
    unit.pathIndex = 0;
    unit.goal = -1;
    unit.repath = 0;
    unit.yieldPath = null;
    unit.yieldAvoid = null;
    unit.moveState = MoveState.Idle;
    unit.reason = '';
  }

  orderMove(units: Entity[], target: number): void {
    // Units on different islands are grouped separately so each gets reachable slots.
    const groups = new Map<number, Entity[]>();
    for (const unit of units) {
      const component = this.nav.componentOf(unit.next >= 0 ? unit.next : unit.tile);
      const list = groups.get(component) ?? [];
      list.push(unit);
      groups.set(component, list);
    }
    for (const [, group] of groups) {
      const formation = assignFormation(this, group, target);
      for (let i = 0; i < group.length; i++) {
        const unit = group[i];
        this.stopUnit(unit);
        if (formation.center < 0) {
          unit.moveState = MoveState.Unreachable;
          unit.reason = 'no-route';
          continue;
        }
        unit.goal = formation.slots[i] >= 0 ? formation.slots[i] : formation.center;
        unit.moveState = MoveState.Pending;
        unit.reason = formation.slots[i] >= 0 ? (formation.center !== target ? 'nearest-valid' : '') : 'no-room';
        unit.waitTotal = 0;
        unit.lastProgress = this.tick;
        unit.repath = 1;
        this.pathJobs.push({ entity: unit.id, orderId: unit.orderId, dynamic: false, fieldTarget: formation.center });
      }
    }
  }

  private field(target: number): Int32Array {
    const key = `${target}:${this.nav.revision}`;
    let field = this.fields.get(key);
    if (field) {
      this.fields.delete(key);
      this.fields.set(key, field);
      return field;
    }
    if (this.fields.size >= FIELD_CACHE_SIZE) {
      const oldest = this.fields.keys().next().value as string;
      field = this.fields.get(oldest)!;
      this.fields.delete(oldest);
    } else {
      field = new Int32Array(this.nav.size);
    }
    this.pathfinder.distanceField(target, field);
    this.fields.set(key, field);
    return field;
  }

  /**
   * Jobs run atomically in FIFO order until the per-tick expansion budget is spent,
   * so no search is ever half-finished at a tick boundary.
   */
  private processPathJobs(): void {
    let budget = this.rules.game.pathBudgetPerTick;
    let processed = 0;
    let expanded = 0;
    while (processed < this.pathJobs.length && budget > 0) {
      const job = this.pathJobs[processed++];
      const unit = this.byId.get(job.entity);
      if (!unit || unit.orderId !== job.orderId) continue;
      const dynamic = job.dynamic || unit.repath === 2;
      unit.repath = 0;
      if (unit.yieldPath || unit.goal < 0) continue; // resumes via a fresh request after yielding
      const start = unit.next >= 0 ? unit.next : unit.tile;
      let field: Int32Array | null = null;
      if (job.fieldTarget >= 0) {
        field = this.field(job.fieldTarget);
        if (field[start] >= UNREACHED) field = null;
      }
      let result = this.pathfinder.findPath(start, unit.goal, {
        field,
        blocked: dynamic ? this.stationaryBlocker(unit, start) : null,
      });
      budget -= result.expanded + 1;
      expanded += result.expanded;
      if (!result.path && dynamic) {
        result = this.pathfinder.findPath(start, unit.goal, { field });
        budget -= result.expanded;
        expanded += result.expanded;
      }
      if (!result.path) {
        unit.path = null;
        unit.moveState = MoveState.Unreachable;
        unit.reason = 'no-route';
        continue;
      }
      unit.path = result.path;
      unit.pathIndex = 0;
      if (unit.moveState === MoveState.Pending || unit.moveState === MoveState.Unreachable) unit.moveState = MoveState.Moving;
    }
    this.pathJobs.splice(0, processed);
    this.stats.pathJobs = processed;
    this.stats.expanded = expanded;
    this.stats.queuedJobs = this.pathJobs.length;
  }

  private stationaryBlocker(unit: Entity, start: number): (tile: number) => boolean {
    const nav = this.nav;
    const radius = this.rules.game.dynamicRepathRadius;
    const sx = start % nav.width;
    const sy = (start / nav.width) | 0;
    return (tile: number): boolean => {
      const occupant = nav.occupancy[tile];
      if (occupant === 0 || occupant === unit.id) return false;
      const dx = (tile % nav.width) - sx;
      const dy = ((tile / nav.width) | 0) - sy;
      if (dx > radius || dx < -radius || dy > radius || dy < -radius) return false;
      const other = this.byId.get(occupant);
      return !!other && other.next < 0;
    };
  }
}
