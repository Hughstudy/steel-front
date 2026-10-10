/**
 * Typed rule definitions plus a small handwritten validator.
 * All durations are integer simulation ticks (20 per second), distances are tiles,
 * speeds are tiles per second (converted once to fixed-point units per tick).
 */

export type MovementLayer = 'ground' | 'air';
export const MOVEMENT_LAYERS: readonly MovementLayer[] = ['ground', 'air'];

export interface GameRules {
  ticksPerSecond: number;
  subTile: number;
  pathBudgetPerTick: number;
  shoveDelayTicks: number;
  headOnShoveTicks: number;
  jamShoveTicks: number;
  repathBlockedTicks: number;
  noProgressTicks: number;
  yieldSearchNodes: number;
  dynamicRepathRadius: number;
}

export interface TerrainDef { id: string; name: string; passable: Record<MovementLayer, boolean>; buildable: boolean }
export interface PropDef { index: number; id: string; blocks: Record<MovementLayer, boolean>; buildable: boolean }
export interface TerrainRules { terrain: TerrainDef[]; props: PropDef[] }

export interface FactionDef {
  id: string; name: string; insignia: 'star' | 'cross';
  hull: string; hullDark: string; hullLight: string; trim: string; team: string; cloth: string; skin: string;
}

/** Render parameters: an archetype plus optional numeric shape parameters (tiles/pixels). */
export interface UnitVisual { archetype: string; scale?: number; params: Record<string, number> }
export interface UnitCapabilities { turret?: boolean; [key: string]: unknown }

export interface UnitDef {
  id: string; faction: string; name: string; cost: number; hp: number;
  /** Tiles per second as authored. */
  speed: number;
  movement: MovementLayer; armor: string; vision: number; buildTicks: number;
  prerequisites: string[]; producer: string | null;
  /** Byte-angle units (256 per turn) per tick. */
  turnRate: number;
  weapons: string[]; visual: UnitVisual; capabilities: UnitCapabilities;
  /** Derived: fixed-point sub-tile units per tick. */
  speedPerTick: number;
}

export interface ScenarioUnitGroup { type: string; count: number }
export interface ScenarioBuilding { type: string; spawn: number }
export interface ScenarioPlayer {
  faction: string; credits: number; anchor: { x: number; y: number }; units: ScenarioUnitGroup[];
  buildings: ScenarioBuilding[];
}
export interface ScenarioDef {
  id: string; name: string; description: string; map: string;
  camera: { x: number; y: number }; players: ScenarioPlayer[];
  /** Place the map preset's supply dumps and oil derricks. */
  resources: boolean;
}

export interface BuildingCapabilities {
  /** Accepts truck deliveries. */
  depot?: boolean;
  /** Strategic objective (HQ). */
  objective?: boolean;
  /** Supply stock held by a dump (credits). */
  supply?: number;
  /** Pays oil income to its owner. */
  oil?: boolean;
  /** Engineers may capture it. */
  capturable?: boolean;
  [key: string]: unknown;
}

export interface BuildingDef {
  id: string; faction: string; name: string; cost: number; hp: number;
  footprint: { w: number; h: number }; buildTicks: number; prerequisites: string[];
  producer: string | null; power: number; vision: number; dockSlots: number; sellable: boolean;
  /** Production categories this building serves as a producer for. */
  produces: string[];
  /** Exit tile offset from the footprint origin for produced units (must touch the footprint). */
  exit: { x: number; y: number } | null;
  capabilities: BuildingCapabilities; visual: UnitVisual;
}

export interface ProductionCategory { id: string; name: string; hotkey: string; placement: boolean }
export interface ProductionRules {
  categories: ProductionCategory[];
  queueLimit: number;
  /** Work rate while power demand exceeds supply, as a fraction of full rate. */
  lowPowerRate: { numerator: number; denominator: number };
  cancelRefundPercent: number; sellRefundPercent: number;
  repairIntervalTicks: number; repairStepPermille: number; repairCostPercent: number;
  /** Tiles (Chebyshev) from any owned faction building in which new structures may be placed. */
  constructionRadius: number;
  placementTimeoutTicks: number;
  /** Default distance produced units drive out from the exit when no rally point is set. */
  rallyOffset: number;
}

export interface EconomyRules {
  loadPerTick: number; unloadPerTick: number; dockLeaseTicks: number; leaseTravelTicksPerTile: number;
  retryTicks: number; oilIntervalTicks: number; oilPayout: number; captureTicks: number;
}

export interface MapPoint { x: number; y: number }
export interface MapPreset {
  id: string; name: string; seed: number; spawns: MapPoint[]; supplies: MapPoint[]; derricks: MapPoint[];
  /** Building types placed at the supply and derrick points. */
  supplyType: string; derrickType: string;
}

export interface Rules {
  game: GameRules;
  terrain: TerrainRules;
  factions: Map<string, FactionDef>;
  units: Map<string, UnitDef>;
  buildings: Map<string, BuildingDef>;
  economy: EconomyRules;
  production: ProductionRules;
  maps: Map<string, MapPreset>;
  scenarios: Map<string, ScenarioDef>;
}

export interface RawRules {
  game: unknown; terrain: unknown; factions: unknown; units: unknown; scenarios: unknown;
  buildings: unknown; economy: unknown; maps: unknown; production: unknown;
}

/** Owner faction id used for neutral map objects. */
export const NEUTRAL = 'neutral';

export const ARMOR_CLASSES = ['infantry', 'light', 'heavy', 'building'];

class Checker {
  errors: string[] = [];
  object(value: unknown, where: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      this.errors.push(`${where}: expected an object`);
      return {};
    }
    return value as Record<string, unknown>;
  }
  array(value: unknown, where: string): unknown[] {
    if (!Array.isArray(value)) { this.errors.push(`${where}: expected an array`); return []; }
    return value;
  }
  string(record: Record<string, unknown>, key: string, where: string): string {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0) { this.errors.push(`${where}.${key}: expected a non-empty string`); return ''; }
    return value;
  }
  number(record: Record<string, unknown>, key: string, where: string, min: number, max: number, integer = false): number {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      this.errors.push(`${where}.${key}: expected ${integer ? 'an integer' : 'a number'} in [${min}, ${max}], got ${JSON.stringify(value)}`);
      return min;
    }
    return value;
  }
  bool(record: Record<string, unknown>, key: string, where: string): boolean {
    const value = record[key];
    if (typeof value !== 'boolean') { this.errors.push(`${where}.${key}: expected a boolean`); return false; }
    return value;
  }
  oneOf<T extends string>(record: Record<string, unknown>, key: string, where: string, allowed: readonly T[]): T {
    const value = record[key];
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.errors.push(`${where}.${key}: expected one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`);
      return allowed[0];
    }
    return value as T;
  }
  strings(record: Record<string, unknown>, key: string, where: string): string[] {
    const value = this.array(record[key], `${where}.${key}`);
    return value.filter((item, index) => {
      if (typeof item === 'string') return true;
      this.errors.push(`${where}.${key}[${index}]: expected a string`);
      return false;
    }) as string[];
  }
}

export class RulesError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid game rules:\n${problems.join('\n')}`);
    this.problems = problems;
  }
}

function layers(check: Checker, value: unknown, where: string): Record<MovementLayer, boolean> {
  const record = check.object(value, where);
  return { ground: check.bool(record, 'ground', where), air: check.bool(record, 'air', where) };
}

function exitOf(check: Checker, value: unknown, where: string, w: number, h: number): { x: number; y: number } | null {
  if (value === null || value === undefined) return null;
  const list = check.array(value, where);
  const x = list[0];
  const y = list[1];
  if (list.length !== 2 || typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y)) {
    check.errors.push(`${where}: expected [dx, dy] integers`);
    return null;
  }
  const inside = x >= 0 && x < w && y >= 0 && y < h;
  if (inside || x < -1 || x > w || y < -1 || y > h) check.errors.push(`${where}: exit must be a tile touching the footprint`);
  return { x, y };
}

function visualOf(check: Checker, record: Record<string, unknown>, where: string): UnitVisual {
  const params: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'archetype') continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) check.errors.push(`${where}.${key}: expected a number`);
    else params[key] = value;
  }
  return { archetype: check.string(record, 'archetype', where), scale: params.scale, params };
}

export function loadRules(raw: RawRules): Rules {
  const check = new Checker();
  const g = check.object(raw.game, 'game');
  const game: GameRules = {
    ticksPerSecond: check.number(g, 'ticksPerSecond', 'game', 20, 20, true),
    subTile: check.number(g, 'subTile', 'game', 1024, 1024, true),
    pathBudgetPerTick: check.number(g, 'pathBudgetPerTick', 'game', 1000, 1_000_000, true),
    shoveDelayTicks: check.number(g, 'shoveDelayTicks', 'game', 0, 200, true),
    headOnShoveTicks: check.number(g, 'headOnShoveTicks', 'game', 0, 200, true),
    jamShoveTicks: check.number(g, 'jamShoveTicks', 'game', 1, 2000, true),
    repathBlockedTicks: check.number(g, 'repathBlockedTicks', 'game', 1, 2000, true),
    noProgressTicks: check.number(g, 'noProgressTicks', 'game', 20, 20000, true),
    yieldSearchNodes: check.number(g, 'yieldSearchNodes', 'game', 16, 10000, true),
    dynamicRepathRadius: check.number(g, 'dynamicRepathRadius', 'game', 1, 64, true),
  };

  const t = check.object(raw.terrain, 'terrain');
  const terrain: TerrainRules = {
    terrain: check.array(t.terrain, 'terrain.terrain').map((item, index) => {
      const where = `terrain.terrain[${index}]`;
      const r = check.object(item, where);
      return { id: check.string(r, 'id', where), name: check.string(r, 'name', where), passable: layers(check, r.passable, `${where}.passable`), buildable: check.bool(r, 'buildable', where) };
    }),
    props: check.array(t.props, 'terrain.props').map((item, index) => {
      const where = `terrain.props[${index}]`;
      const r = check.object(item, where);
      return { index: check.number(r, 'index', where, 1, 255, true), id: check.string(r, 'id', where), blocks: layers(check, r.blocks, `${where}.blocks`), buildable: check.bool(r, 'buildable', where) };
    }),
  };
  if (terrain.terrain.length !== 8) check.errors.push('terrain.terrain: expected 8 terrain entries in generator index order');

  const factions = new Map<string, FactionDef>();
  check.array(raw.factions, 'factions').forEach((item, index) => {
    const where = `factions[${index}]`;
    const r = check.object(item, where);
    const def: FactionDef = {
      id: check.string(r, 'id', where), name: check.string(r, 'name', where),
      insignia: check.oneOf(r, 'insignia', where, ['star', 'cross'] as const),
      hull: check.string(r, 'hull', where), hullDark: check.string(r, 'hullDark', where), hullLight: check.string(r, 'hullLight', where),
      trim: check.string(r, 'trim', where), team: check.string(r, 'team', where), cloth: check.string(r, 'cloth', where), skin: check.string(r, 'skin', where),
    };
    if (factions.has(def.id)) check.errors.push(`${where}: duplicate faction id ${def.id}`);
    factions.set(def.id, def);
  });

  const units = new Map<string, UnitDef>();
  check.array(raw.units, 'units').forEach((item, index) => {
    const r = check.object(item, `units[${index}]`);
    const where = `units[${typeof r.id === 'string' ? r.id : index}]`;
    const speed = check.number(r, 'speed', where, 0.05, 20);
    const visual = check.object(r.visual, `${where}.visual`);
    const def: UnitDef = {
      id: check.string(r, 'id', where), faction: check.string(r, 'faction', where), name: check.string(r, 'name', where),
      cost: check.number(r, 'cost', where, 0, 100000, true), hp: check.number(r, 'hp', where, 1, 100000, true), speed,
      movement: check.oneOf(r, 'movement', where, MOVEMENT_LAYERS), armor: check.oneOf(r, 'armor', where, ARMOR_CLASSES),
      vision: check.number(r, 'vision', where, 1, 20, true), buildTicks: check.number(r, 'buildTicks', where, 1, 100000, true),
      prerequisites: check.strings(r, 'prerequisites', where),
      producer: r.producer === null ? null : check.string(r, 'producer', where),
      turnRate: check.number(r, 'turnRate', where, 1, 128, true), weapons: check.strings(r, 'weapons', where),
      visual: visualOf(check, visual, `${where}.visual`),
      capabilities: check.object(r.capabilities, `${where}.capabilities`) as UnitCapabilities,
      speedPerTick: Math.max(1, Math.round(speed * game.subTile / game.ticksPerSecond)),
    };
    if (units.has(def.id)) check.errors.push(`${where}: duplicate unit id ${def.id}`);
    if (!factions.has(def.faction)) check.errors.push(`${where}.faction: unknown faction ${def.faction}`);
    units.set(def.id, def);
  });

  const buildings = new Map<string, BuildingDef>();
  check.array(raw.buildings, 'buildings').forEach((item, index) => {
    const r = check.object(item, `buildings[${index}]`);
    const where = `buildings[${typeof r.id === 'string' ? r.id : index}]`;
    const footprint = check.array(r.footprint, `${where}.footprint`);
    const w = typeof footprint[0] === 'number' ? footprint[0] : 0;
    const h = typeof footprint[1] === 'number' ? footprint[1] : 0;
    if (footprint.length !== 2 || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 6 || h > 6) {
      check.errors.push(`${where}.footprint: expected [w, h] integers in 1..6`);
    }
    const def: BuildingDef = {
      id: check.string(r, 'id', where), faction: check.string(r, 'faction', where), name: check.string(r, 'name', where),
      cost: check.number(r, 'cost', where, 0, 100000, true), hp: check.number(r, 'hp', where, 1, 100000, true),
      footprint: { w: Math.max(1, w), h: Math.max(1, h) }, buildTicks: check.number(r, 'buildTicks', where, 1, 100000, true),
      prerequisites: check.strings(r, 'prerequisites', where),
      producer: r.producer === null ? null : check.string(r, 'producer', where),
      power: check.number(r, 'power', where, -1000, 1000, true), vision: check.number(r, 'vision', where, 0, 20, true),
      dockSlots: check.number(r, 'dockSlots', where, 0, 8, true), sellable: check.bool(r, 'sellable', where),
      produces: check.strings(r, 'produces', where),
      exit: exitOf(check, r.exit, `${where}.exit`, Math.max(1, w), Math.max(1, h)),
      capabilities: check.object(r.capabilities, `${where}.capabilities`) as BuildingCapabilities,
      visual: visualOf(check, check.object(r.visual, `${where}.visual`), `${where}.visual`),
    };
    if (buildings.has(def.id) || units.has(def.id)) check.errors.push(`${where}: duplicate id ${def.id}`);
    if (def.faction !== NEUTRAL && !factions.has(def.faction)) check.errors.push(`${where}.faction: unknown faction ${def.faction}`);
    const supply = def.capabilities.supply;
    if (supply !== undefined && (typeof supply !== 'number' || !Number.isInteger(supply) || supply < 0)) check.errors.push(`${where}.capabilities.supply: expected a non-negative integer`);
    buildings.set(def.id, def);
  });
  for (const unit of units.values()) {
    const cargo = unit.capabilities.cargo;
    if (cargo !== undefined && (typeof cargo !== 'number' || !Number.isInteger(cargo) || cargo <= 0)) check.errors.push(`units[${unit.id}].capabilities.cargo: expected a positive integer`);
  }

  const pr = check.object(raw.production, 'production');
  const rate = check.object(pr.lowPowerRate, 'production.lowPowerRate');
  const production: ProductionRules = {
    categories: check.array(pr.categories, 'production.categories').map((item, index) => {
      const where = `production.categories[${index}]`;
      const r = check.object(item, where);
      return { id: check.string(r, 'id', where), name: check.string(r, 'name', where), hotkey: check.string(r, 'hotkey', where), placement: check.bool(r, 'placement', where) };
    }),
    queueLimit: check.number(pr, 'queueLimit', 'production', 1, 20, true),
    lowPowerRate: {
      numerator: check.number(rate, 'numerator', 'production.lowPowerRate', 1, 100, true),
      denominator: check.number(rate, 'denominator', 'production.lowPowerRate', 1, 100, true),
    },
    cancelRefundPercent: check.number(pr, 'cancelRefundPercent', 'production', 0, 100, true),
    sellRefundPercent: check.number(pr, 'sellRefundPercent', 'production', 0, 100, true),
    repairIntervalTicks: check.number(pr, 'repairIntervalTicks', 'production', 1, 1000, true),
    repairStepPermille: check.number(pr, 'repairStepPermille', 'production', 1, 1000, true),
    repairCostPercent: check.number(pr, 'repairCostPercent', 'production', 0, 1000, true),
    constructionRadius: check.number(pr, 'constructionRadius', 'production', 1, 64, true),
    placementTimeoutTicks: check.number(pr, 'placementTimeoutTicks', 'production', 1, 10000, true),
    rallyOffset: check.number(pr, 'rallyOffset', 'production', 1, 16, true),
  };
  if (production.lowPowerRate.numerator > production.lowPowerRate.denominator) check.errors.push('production.lowPowerRate: numerator must not exceed denominator');
  const categoryIds = new Set(production.categories.map(c => c.id));
  if (categoryIds.size !== production.categories.length) check.errors.push('production.categories: duplicate id');
  const known = (id: string): boolean => units.has(id) || buildings.has(id);
  for (const def of [...units.values(), ...buildings.values()]) {
    const where = `${units.has(def.id) ? 'units' : 'buildings'}[${def.id}]`;
    if (def.producer !== null && !categoryIds.has(def.producer)) check.errors.push(`${where}.producer: unknown production category ${def.producer}`);
    for (const id of def.prerequisites) if (!known(id)) check.errors.push(`${where}.prerequisites: unknown id ${id}`);
  }
  for (const def of buildings.values()) {
    for (const category of def.produces) if (!categoryIds.has(category)) check.errors.push(`buildings[${def.id}].produces: unknown category ${category}`);
    const placement = production.categories.find(c => c.id === def.producer)?.placement;
    if (def.producer !== null && !placement) check.errors.push(`buildings[${def.id}].producer: buildings must come from a placement category`);
  }
  for (const def of units.values()) {
    const placement = production.categories.find(c => c.id === def.producer)?.placement;
    if (def.producer !== null && placement) check.errors.push(`units[${def.id}].producer: units cannot come from a placement category`);
    const deploy = def.capabilities.deploy;
    if (deploy !== undefined && (typeof deploy !== 'string' || !buildings.has(deploy))) check.errors.push(`units[${def.id}].capabilities.deploy: unknown building ${String(deploy)}`);
  }

  const e = check.object(raw.economy, 'economy');
  const economy: EconomyRules = {
    loadPerTick: check.number(e, 'loadPerTick', 'economy', 1, 10000, true),
    unloadPerTick: check.number(e, 'unloadPerTick', 'economy', 1, 10000, true),
    dockLeaseTicks: check.number(e, 'dockLeaseTicks', 'economy', 1, 100000, true),
    leaseTravelTicksPerTile: check.number(e, 'leaseTravelTicksPerTile', 'economy', 1, 1000, true),
    retryTicks: check.number(e, 'retryTicks', 'economy', 1, 10000, true),
    oilIntervalTicks: check.number(e, 'oilIntervalTicks', 'economy', 1, 100000, true),
    oilPayout: check.number(e, 'oilPayout', 'economy', 0, 100000, true),
    captureTicks: check.number(e, 'captureTicks', 'economy', 1, 100000, true),
  };

  const maps = new Map<string, MapPreset>();
  const points = (value: unknown, where: string): MapPoint[] => check.array(value, where).map((p, i) => {
    const pr = check.object(p, `${where}[${i}]`);
    return { x: check.number(pr, 'x', `${where}[${i}]`, 0, 1023, true), y: check.number(pr, 'y', `${where}[${i}]`, 0, 1023, true) };
  });
  check.array(raw.maps, 'maps').forEach((item, index) => {
    const r = check.object(item, `maps[${index}]`);
    const where = `maps[${typeof r.id === 'string' ? r.id : index}]`;
    const preset: MapPreset = {
      id: check.string(r, 'id', where), name: check.string(r, 'name', where), seed: check.number(r, 'seed', where, 0, 2 ** 31, true),
      spawns: points(r.spawns, `${where}.spawns`), supplies: points(r.supplies, `${where}.supplies`), derricks: points(r.derricks, `${where}.derricks`),
      supplyType: check.string(r, 'supplyType', where), derrickType: check.string(r, 'derrickType', where),
    };
    if (!buildings.has(preset.supplyType)) check.errors.push(`${where}.supplyType: unknown building ${preset.supplyType}`);
    if (!buildings.has(preset.derrickType)) check.errors.push(`${where}.derrickType: unknown building ${preset.derrickType}`);
    if (preset.spawns.length < 2) check.errors.push(`${where}.spawns: need at least two player spawns`);
    if (maps.has(preset.id)) check.errors.push(`${where}: duplicate map id ${preset.id}`);
    maps.set(preset.id, preset);
  });

  const scenarios = new Map<string, ScenarioDef>();
  check.array(raw.scenarios, 'scenarios').forEach((item, index) => {
    const r = check.object(item, `scenarios[${index}]`);
    const where = `scenarios[${typeof r.id === 'string' ? r.id : index}]`;
    const camera = check.object(r.camera, `${where}.camera`);
    const def: ScenarioDef = {
      id: check.string(r, 'id', where), name: check.string(r, 'name', where), description: check.string(r, 'description', where),
      map: check.string(r, 'map', where), resources: r.resources === true,
      camera: { x: check.number(camera, 'x', `${where}.camera`, 0, 1023), y: check.number(camera, 'y', `${where}.camera`, 0, 1023) },
      players: check.array(r.players, `${where}.players`).map((p, pi) => {
        const pw = `${where}.players[${pi}]`;
        const pr = check.object(p, pw);
        const anchor = check.object(pr.anchor, `${pw}.anchor`);
        const faction = check.string(pr, 'faction', pw);
        if (!factions.has(faction)) check.errors.push(`${pw}.faction: unknown faction ${faction}`);
        return {
          faction, credits: check.number(pr, 'credits', pw, 0, 1_000_000, true),
          anchor: { x: check.number(anchor, 'x', `${pw}.anchor`, 0, 1023, true), y: check.number(anchor, 'y', `${pw}.anchor`, 0, 1023, true) },
          buildings: check.array(pr.buildings ?? [], `${pw}.buildings`).map((b, bi) => {
            const bw = `${pw}.buildings[${bi}]`;
            const br = check.object(b, bw);
            const type = check.string(br, 'type', bw);
            if (!buildings.has(type)) check.errors.push(`${bw}.type: unknown building ${type}`);
            return { type, spawn: check.number(br, 'spawn', bw, 0, 7, true) };
          }),
          units: check.array(pr.units, `${pw}.units`).map((u, ui) => {
            const uw = `${pw}.units[${ui}]`;
            const ur = check.object(u, uw);
            const type = check.string(ur, 'type', uw);
            if (!units.has(type)) check.errors.push(`${uw}.type: unknown unit ${type}`);
            return { type, count: check.number(ur, 'count', uw, 1, 500, true) };
          }),
        };
      }),
    };
    if (!maps.has(def.map)) check.errors.push(`${where}.map: unknown map ${def.map}`);
    if (scenarios.has(def.id)) check.errors.push(`${where}: duplicate scenario id ${def.id}`);
    scenarios.set(def.id, def);
  });

  if (check.errors.length) throw new RulesError(check.errors);
  return { game, terrain, factions, units, buildings, economy, production, maps, scenarios };
}
