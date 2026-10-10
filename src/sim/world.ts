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
import type { BuildingDef, Rules, ScenarioDef } from './rules.ts';
import { findPlacement, footprintTiles } from './structures.ts';
import { updateEconomy, releaseDock, cancelTask } from './economy.ts';
import { cancelItem, deployUnit, enqueueItem, placeItem, sellBuilding, setRally, updatePower, updateProduction } from './production.ts';
import type { PendingPlacement, QueueItem } from './production.ts';
import { updateCombat } from './combat.ts';
import { updateAirUnit } from './air.ts';
import { createFog, updateFog, canSee } from './fog.ts';
import type { PlayerFog } from './fog.ts';
import { ProjectilePool } from './projectiles.ts';
import { createAiState, updateAi } from './ai.ts';
import type { AiState } from './ai.ts';
import { SpatialGrid } from './spatial.ts';
import type { WeaponDef } from './rules.ts';

export interface Player {
  index: number;
  faction: string;
  credits: number;
  /** Audit trail: credits = initial + delivered + oil + refunded + sold − spent. */
  ledger: { initial: number; delivered: number; oil: number; spent: number; refunded: number; sold: number };
  /** Production queues by category id; only the head item of each queue works. */
  queues: Record<string, QueueItem[]>;
  power: { supply: number; demand: number };
  /** Last rejected action, for HUD feedback. */
  notice: string;
  noticeTick: number;
  fog: PlayerFog;
  /** Start sector tile (scenario anchor), a declared strategic destination; -1 if none. */
  start: number;
  /** Computer player state, or null for a human/scripted player. */
  ai: AiState | null;
  /** Objective rule: false once the player's MCV (before deployment) or HQ is lost. */
  alive: boolean;
  /** Set once the player has owned an objective structure; from then on only it counts. */
  deployed: boolean;
  defeatTick: number;
  stats: PlayerStats;
}

export interface PlayerStats { unitsBuilt: number; buildingsBuilt: number; unitsLost: number; buildingsLost: number }

/** Terminal match state; the world stops advancing once it is set. */
export interface MatchOutcome {
  tick: number;
  /** Winning player index, or -1 for a draw. */
  winner: number;
  draw: boolean;
}

export interface LoadOptions {
  /** Override the scenario's AI difficulty for every computer player. */
  difficulty?: string;
}

/** Cosmetic event for presentation (muzzle flash, impact, death); cleared every tick, never read by the simulation. */
export interface WorldEvent { kind: 'fire' | 'impact' | 'death' | 'promote'; x: number; y: number; a: number; weapon: string; id: number }

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
  /** Static buildability from terrain and scenery (structures checked separately). */
  readonly buildable: Uint8Array;
  readonly players: Player[] = [];
  readonly entities: Entity[] = [];
  readonly byId = new Map<number, Entity>();
  tick = 0;
  nextId = 1;
  /** Entities to remove at the end of the current tick, resolved in id order. */
  readonly removals: number[] = [];
  /** Structures waiting for their footprint to clear (MCV deploys and queue placements). */
  readonly pending: PendingPlacement[] = [];
  nextItem = 1;
  readonly grid: SpatialGrid;
  readonly projectiles: ProjectilePool;
  /** Weapons in data order; projectiles store an index into this list. */
  readonly weaponList: WeaponDef[];
  readonly weaponIndex = new Map<string, number>();
  /** Entities reduced to 0 HP this tick, resolved in id order. */
  readonly deaths: number[] = [];
  readonly events: WorldEvent[] = [];
  /** Fog of war (scenario flag); when off every player sees everything. */
  fogEnabled = true;
  /** Objective rule (scenario flag); sandboxes leave it off. */
  victory = false;
  outcome: MatchOutcome | null = null;
  /** Increments whenever fog masks are recomputed (presentation cache key). */
  fogVersion = 0;
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
    this.buildable = new Uint8Array(this.nav.size);
    this.grid = new SpatialGrid(this.nav.width, this.nav.height);
    this.projectiles = new ProjectilePool(rules.combat.projectilePool);
    this.weaponList = Array.from(rules.weapons.values());
    this.weaponList.forEach((weapon, index) => this.weaponIndex.set(weapon.id, index));
    const propBuildable = new Uint8Array(256).fill(1);
    for (const prop of rules.terrain.props) propBuildable[prop.index] = prop.buildable ? 1 : 0;
    for (let i = 0; i < this.nav.size; i++) {
      const terrain = rules.terrain.terrain[map.tiles[i]];
      this.buildable[i] = terrain && terrain.buildable && propBuildable[map.props[i]] ? 1 : 0;
    }
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
    const player: Player = {
      index: this.players.length, faction, credits,
      ledger: { initial: credits, delivered: 0, oil: 0, spent: 0, refunded: 0, sold: 0 },
      queues: {}, power: { supply: 0, demand: 0 }, notice: '', noticeTick: 0, fog: createFog(this.nav.size),
      start: -1, ai: null, alive: true, deployed: false, defeatTick: -1,
      stats: { unitsBuilt: 0, buildingsBuilt: 0, unitsLost: 0, buildingsLost: 0 },
    };
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
    else entity.goal = tile;
    this.entities.push(entity);
    this.byId.set(entity.id, entity);
    return entity;
  }

  spawnBuilding(type: string, owner: number, origin: number): Entity {
    const def = this.rules.buildings.get(type);
    if (!def) throw new Error(`Unknown building ${type}`);
    const entity = createEntity(this.nextId++, 'building', type, owner, def.hp);
    entity.tile = origin;
    const s = this.subTile;
    const w = this.nav.width;
    entity.x = entity.prevX = (origin % w) * s + (def.footprint.w * s >> 1);
    entity.y = entity.prevY = ((origin / w) | 0) * s + (def.footprint.h * s >> 1);
    entity.facing = entity.prevFacing = 0;
    if (typeof def.capabilities.supply === 'number') entity.stock = def.capabilities.supply;
    if (def.dockSlots > 0) entity.docks = [];
    this.nav.setStructure(footprintTiles(this, def, origin), entity.id);
    this.entities.push(entity);
    this.byId.set(entity.id, entity);
    if (owner >= 0 && this.players[owner]) updatePower(this);
    return entity;
  }

  /** Place a building near a tile using the shared placement rules (scenario setup). */
  placeBuildingNear(def: BuildingDef, owner: number, x: number, y: number): Entity {
    const origin = findPlacement(this, def, x, y);
    if (origin < 0) throw new Error(`No valid placement for ${def.id} near ${x},${y}`);
    return this.spawnBuilding(def.id, owner, origin);
  }

  /** Queue an entity for removal at the end of this tick (idempotent). */
  remove(id: number): void {
    if (this.byId.has(id) && !this.removals.includes(id)) this.removals.push(id);
  }

  private flushRemovals(): void {
    if (this.removals.length === 0) return;
    this.removals.sort((a, b) => a - b);
    for (const id of this.removals) {
      const entity = this.byId.get(id);
      if (!entity) continue;
      if (entity.kind === 'unit') {
        if (entity.tile >= 0 && this.nav.occupancy[entity.tile] === id) this.nav.occupancy[entity.tile] = 0;
        if (entity.next >= 0 && this.nav.occupancy[entity.next] === id) this.nav.occupancy[entity.next] = 0;
        releaseDock(this, entity);
      } else {
        const def = this.rules.buildings.get(entity.type)!;
        this.nav.setStructure(footprintTiles(this, def, entity.tile), 0);
      }
      this.byId.delete(id);
    }
    let write = 0;
    for (const entity of this.entities) if (this.byId.has(entity.id)) this.entities[write++] = entity;
    this.entities.length = write;
    this.removals.length = 0;
    updatePower(this);
  }

  /** Place scenario forces on free tiles in breadth-first order around each anchor. */
  loadScenario(scenario: ScenarioDef, options: LoadOptions = {}): void {
    const preset = this.rules.maps.get(scenario.map)!;
    this.fogEnabled = scenario.fog;
    this.victory = scenario.victory;
    if (scenario.resources) {
      const dump = this.rules.buildings.get(preset.supplyType)!;
      const derrick = this.rules.buildings.get(preset.derrickType)!;
      for (const p of preset.supplies) this.placeBuildingNear(dump, -1, p.x, p.y);
      for (const p of preset.derricks) this.placeBuildingNear(derrick, -1, p.x, p.y);
    }
    for (const setup of scenario.players) {
      const player = this.addPlayer(setup.faction, setup.credits);
      for (const building of setup.buildings) {
        const spawn = preset.spawns[building.spawn];
        this.placeBuildingNear(this.rules.buildings.get(building.type)!, player.index, spawn.x, spawn.y);
      }
    }
    const main = this.mainComponent();
    for (let index = 0; index < scenario.players.length; index++) {
      const setup = scenario.players[index];
      const player = this.players[index];
      const anchor = this.nav.nearestInComponent(this.nav.index(setup.anchor.x, setup.anchor.y), main);
      if (anchor < 0) throw new Error(`Scenario ${scenario.id}: anchor is not near reachable ground`);
      player.start = anchor;
      if (setup.ai) {
        const level = options.difficulty && this.rules.ai.difficulties.has(options.difficulty) ? options.difficulty : setup.ai;
        player.ai = createAiState(level, this.rules.ai.difficulties.get(level)!.firstWaveTick);
      }
      let total = 0;
      for (const group of setup.units) total += group.count;
      const tiles = this.search.collect(this, anchor, total, total * 20 + 200, tile => this.nav.occupancy[tile] === 0);
      if (tiles.length < total) throw new Error(`Scenario ${scenario.id}: not enough room for ${total} units`);
      let cursor = 0;
      for (const group of setup.units) {
        for (let i = 0; i < group.count; i++) {
          const unit = this.spawnUnit(group.type, player.index, tiles[cursor++]);
          // Scenario trucks start hauling, as freshly produced trucks will.
          if (this.rules.units.get(group.type)!.capabilities.cargo) { unit.auto = true; unit.task = 'seek-dump'; }
        }
      }
    }
    updateFog(this, true);
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
    // Outcomes are final: nothing moves, fires or earns after the terminal tick.
    if (this.outcome) return;
    this.tick++;
    this.events.length = 0;
    for (const entity of this.entities) {
      entity.prevX = entity.x;
      entity.prevY = entity.y;
      entity.prevFacing = entity.facing;
      entity.prevTurret = entity.turret;
    }
    this.executeCommands();
    this.processPathJobs();
    for (const entity of this.entities) {
      if (entity.kind !== 'unit' || entity.hp <= 0) continue;
      const def = this.rules.units.get(entity.type)!;
      if (def.movement === 'ground') updateGroundUnit(this, entity, def);
      else updateAirUnit(this, entity, def);
    }
    updateFog(this);
    updateCombat(this);
    updateEconomy(this);
    updateProduction(this);
    this.flushRemovals();
    this.updateObjectives();
    updateAi(this);
  }

  /**
   * Strategic objective: before deployment a player's MCV keeps them in the match;
   * once they have owned an objective structure (HQ), only that counts. The match
   * ends when at most one player remains; simultaneous elimination is a draw.
   */
  private updateObjectives(): void {
    if (!this.victory) return;
    const holds = new Uint8Array(this.players.length);
    for (const entity of this.entities) {
      if (entity.owner < 0 || entity.hp <= 0) continue;
      if (entity.kind === 'building') {
        if (!this.rules.buildings.get(entity.type)!.capabilities.objective) continue;
        holds[entity.owner] = 1;
        this.players[entity.owner].deployed = true;
      } else if (typeof this.rules.units.get(entity.type)!.capabilities.deploy === 'string') {
        holds[entity.owner] |= this.players[entity.owner].deployed ? 0 : 1;
      }
    }
    let alive = 0;
    let winner = -1;
    for (const player of this.players) {
      if (player.alive && !holds[player.index]) { player.alive = false; player.defeatTick = this.tick; }
      if (player.alive) { alive++; winner = player.index; }
    }
    if (alive <= 1 && this.players.length > 1) this.outcome = { tick: this.tick, winner: alive === 1 ? winner : -1, draw: alive === 0 };
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
    const target = command.target !== undefined ? this.byId.get(command.target) : undefined;
    const ownedBuilding = target && target.kind === 'building' && target.owner === command.player ? target : undefined;
    switch (command.kind) {
      case 'build':
        if (command.type) enqueueItem(this, command.player, command.type);
        return;
      case 'cancel':
        if (command.type) cancelItem(this, command.player, command.type);
        return;
      case 'place':
        if (command.type) placeItem(this, command.player, command.type, command.x, command.y);
        return;
      case 'deploy':
        for (const unit of units) {
          if (typeof this.rules.units.get(unit.type)!.capabilities.deploy !== 'string') continue;
          cancelTask(this, unit);
          deployUnit(this, unit);
        }
        return;
      case 'sell':
        if (ownedBuilding) sellBuilding(this, command.player, ownedBuilding);
        return;
      case 'repair':
        if (ownedBuilding) ownedBuilding.repairing = !ownedBuilding.repairing && ownedBuilding.hp < this.rules.buildings.get(ownedBuilding.type)!.hp;
        return;
      case 'rally':
        if (ownedBuilding) setRally(this, command.player, ownedBuilding, command.x, command.y);
        return;
      case 'stop':
        for (const unit of units) {
          cancelTask(this, unit);
          unit.attack = unit.aim = unit.amove = -1;
          if (this.rules.units.get(unit.type)!.movement === 'air') unit.goal = unit.tile;
          else this.stopUnit(unit);
        }
        return;
      case 'move': {
        if (!this.nav.inBounds(command.x, command.y)) return;
        for (const unit of units) { unit.attack = -1; unit.aim = -1; unit.amove = -1; }
        const ground = units.filter(unit => this.rules.units.get(unit.type)!.movement === 'ground');
        // A manual move suspends autonomous hauling/capture until explicitly resumed.
        for (const unit of ground) cancelTask(this, unit);
        this.orderMove(ground, this.nav.index(command.x, command.y));
        for (const unit of units) if (this.rules.units.get(unit.type)!.movement === 'air') { unit.goal = this.nav.index(command.x, command.y); unit.target = -1; }
        return;
      }
      case 'attack': {
        // Only targets the commanding player can currently see may be ordered.
        if (!target || target.hp <= 0 || target.owner === command.player || target.owner < 0 || !canSee(this, command.player, target)) return;
        for (const unit of units) {
          if (this.rules.units.get(unit.type)!.weapons.length === 0) continue;
          cancelTask(this, unit);
          unit.attack = target.id;
          unit.aim = target.id;
          unit.amove = -1;
          unit.chaseTick = -1000000;
        }
        return;
      }
      case 'amove': {
        // Attack-move: armed units advance and engage whatever hostile they see on the way.
        if (!this.nav.inBounds(command.x, command.y)) return;
        const tile = this.nav.index(command.x, command.y);
        for (const unit of units) {
          cancelTask(this, unit);
          unit.attack = -1;
          unit.aim = -1;
          unit.amove = -1;
        }
        const ground = units.filter(unit => this.rules.units.get(unit.type)!.movement === 'ground');
        this.orderMove(ground, tile);
        for (const unit of units) {
          const def = this.rules.units.get(unit.type)!;
          if (def.movement === 'air') { unit.goal = tile; unit.target = -1; }
          if (def.weapons.length > 0) { unit.amove = unit.goal; unit.chaseTick = this.tick; }
        }
        return;
      }
      case 'harvest':
      case 'deposit': {
        const depot = command.kind === 'deposit';
        if (target && target.kind !== 'building') return;
        for (const unit of units) {
          const cargo = this.rules.units.get(unit.type)!.capabilities.cargo;
          if (typeof cargo !== 'number') continue;
          cancelTask(this, unit);
          unit.auto = true;
          unit.preferred = target ? target.id : -1;
          unit.task = depot || unit.cargo >= cargo ? 'seek-depot' : 'seek-dump';
          unit.timer = 0;
        }
        return;
      }
      case 'capture': {
        const def = target && target.kind === 'building' ? this.rules.buildings.get(target.type) : undefined;
        if (!target || !def?.capabilities.capturable) return;
        for (const unit of units) {
          if (!this.rules.units.get(unit.type)!.capabilities.capture || target.owner === unit.owner) continue;
          cancelTask(this, unit);
          unit.task = 'capture';
          unit.target = target.id;
          unit.timer = 0;
        }
        return;
      }
    }
  }

  /** Internal single-unit move to an exact tile (task systems); keeps task state. */
  moveUnitTo(unit: Entity, tile: number): void {
    this.stopUnit(unit);
    unit.goal = tile;
    unit.moveState = MoveState.Pending;
    unit.lastProgress = this.tick;
    unit.repath = 1;
    this.pathJobs.push({ entity: unit.id, orderId: unit.orderId, dynamic: false, fieldTarget: -1 });
  }

  /** Distance field from a tile at the current grid revision (memoised; pure). */
  fieldFrom(tile: number): Int32Array { return this.field(tile); }

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
