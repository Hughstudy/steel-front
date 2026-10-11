import { LAYOUT_DEFAULTS } from './terrain.ts';
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
  movement: MovementLayer; armor: string;
  /** Effective armour thickness (mm-like) that AP penetration is compared against; 0 = unarmoured. */
  armorValue: number;
  /** Byte-angle units per tick for the turret (turreted units). */
  turretTurnRate: number;
  vision: number; buildTicks: number;
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
  /** Computer-controlled with this difficulty id ('' = human/scripted). */
  ai: string;
}
export interface ScenarioDef {
  id: string; name: string; description: string; map: string;
  camera: { x: number; y: number }; players: ScenarioPlayer[];
  /** Place the map preset's supply dumps and oil derricks. */
  resources: boolean;
  /** Also place each base's endless truck supply site (normal skirmishes). */
  infiniteSupplies?: boolean;
  /** Fog of war and shroud (default on). */
  fog: boolean;
  /** Objective rule active: losing the MCV (before deployment) or HQ ends a player's match. */
  victory: boolean;
}

/** Normal-match setup: starting forces per faction and the selectable maps. */
export interface SkirmishRules {
  credits: number;
  maps: string[];
  defaultMap: string;
  defaultFaction: string;
  start: Map<string, ScenarioUnitGroup[]>;
}

export interface BuildingCapabilities {
  /** Accepts truck deliveries. */
  depot?: boolean;
  /** Strategic objective (HQ). */
  objective?: boolean;
  /** Supply stock held by a dump (credits). */
  supply?: number;
  /** Trucks may load repeatedly without reducing this building's supply stock. */
  infiniteSupply?: boolean;
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
  id: string; name: string; subtitle: string; seed: number; spawns: MapPoint[]; supplies: MapPoint[]; derricks: MapPoint[];
  /** Overrides merged over the base map config's generator settings and palette. */
  generation: Record<string, unknown>;
  palette: Record<string, string>;
  /** Building types placed at the supply and derrick points. */
  supplyType: string; derrickType: string;
  /** Additional non-depleting sites, in player-spawn order. */
  infiniteSupplies: MapPoint[];
  infiniteSupplyType: string;
}

/** Computer opponent plan for one faction (types are data ids). */
export interface AiFactionPlan {
  power: string; truck: string; engineer: string;
  /** Ordered base plan: cumulative target counts, optionally not before a (tempo-scaled) tick. */
  base: Array<{ type: string; count: number; afterTick: number; minCredits: number }>;
  /** Relative army composition weights. */
  army: Array<{ type: string; weight: number }>;
}

/** Difficulty knobs: economy, tempo and composition, never combat cheats. */
export interface AiDifficulty {
  id: string; name: string;
  thinkIntervalTicks: number; actionsPerThink: number; tempoPercent: number;
  truckTarget: number; engineerTarget: number; queueDepth: number; armyCap: number;
  firstWaveTick: number; waveIntervalTicks: number; waveStartSize: number; waveGrowth: number; waveMaxSize: number;
  /** Share (0–100) of the army beyond the reserve committed to a wave when that exceeds the scheduled size. */
  waveCommitPercent: number;
  /** Income modifier (percent) applied to this computer player's deliveries and oil. */
  incomePercent: number;
  defenseReserve: number; defenseRadius: number; defenseCalmTicks: number;
  powerMargin: number; placementTries: number; retryTicks: number; bankruptcyRetryTicks: number;
}

export interface AiRules {
  factions: Map<string, AiFactionPlan>;
  difficulties: Map<string, AiDifficulty>;
  defaultDifficulty: string;
}

export interface Rules {
  game: GameRules;
  terrain: TerrainRules;
  factions: Map<string, FactionDef>;
  units: Map<string, UnitDef>;
  buildings: Map<string, BuildingDef>;
  economy: EconomyRules;
  production: ProductionRules;
  weapons: Map<string, WeaponDef>;
  combat: CombatRules;
  maps: Map<string, MapPreset>;
  scenarios: Map<string, ScenarioDef>;
  ai: AiRules;
  skirmish: SkirmishRules;
  /** Content hash of the raw data; saves only load against identical rules. */
  hash: string;
}

export interface RawRules {
  game: unknown; terrain: unknown; factions: unknown; units: unknown; scenarios: unknown;
  buildings: unknown; economy: unknown; maps: unknown; production: unknown;
  weapons: unknown; combat: unknown; ai: unknown; skirmish: unknown;
}

/** FNV-1a (32-bit) over a string, as 8 hex digits. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Owner faction id used for neutral map objects. */
export const NEUTRAL = 'neutral';

/** Armor classes the engine itself relies on; data may add more (e.g. towed guns). */
export const ARMOR_CLASSES = ['building'];
export const DAMAGE_TYPES = ['small', 'he', 'ap'] as const;
export type DamageType = typeof DAMAGE_TYPES[number];
export const PROJECTILE_KINDS = ['bullet', 'shell', 'arc'] as const;

export interface WeaponDef {
  id: string; name: string; damageType: DamageType; damage: number;
  /** AP only: compared with target armorValue; ≥ armour gives full damage. */
  penetration: number;
  /** Fixed-point (subTile units). */
  range: number; minRange: number;
  reloadTicks: number;
  projectile: typeof PROJECTILE_KINDS[number];
  /** Fixed-point units per tick. */
  projectileSpeed: number;
  /** Fixed-point radius; 0 = single target. */
  splashRadius: number;
  /** Percent damage lost at the splash edge (linear falloff from the centre). */
  splashFalloff: number;
  targets: MovementLayer[];
  /** Byte-angle tolerance between barrel/body heading and target bearing. */
  aimTolerance: number;
  /** Fires in any direction (squads, pintle mounts) without turning. */
  freeAim: boolean;
  /** Ticks stationary before the weapon may fire (towed guns). */
  setupTicks: number;
  fireWhileMoving: boolean;
}

export interface CombatRules {
  /** Percent damage by armour class and damage type. */
  armorClasses: Record<string, Record<DamageType, number>>;
  minPenetrationPercent: number;
  veterancy: { thresholdsPercent: number[]; damagePercent: number[]; reloadPercent: number[]; armorPercent: number[] };
  projectilePool: number;
  acquireIntervalTicks: number;
  fogIntervalTicks: number;
  chaseRepathTicks: number;
  air: { holdRadius: number; overshootTiles: number; altitude: number };
}

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
      movement: check.oneOf(r, 'movement', where, MOVEMENT_LAYERS), armor: check.string(r, 'armor', where),
      armorValue: check.number(r, 'armorValue', where, 0, 1000, true),
      turretTurnRate: r.turretTurnRate === undefined ? 0 : check.number(r, 'turretTurnRate', where, 1, 128, true),
      vision: check.number(r, 'vision', where, 1, 20, true), buildTicks: check.number(r, 'buildTicks', where, 1, 100000, true),
      prerequisites: check.strings(r, 'prerequisites', where),
      producer: r.producer === null ? null : check.string(r, 'producer', where),
      turnRate: check.number(r, 'turnRate', where, 1, 128, true), weapons: check.strings(r, 'weapons', where),
      visual: visualOf(check, visual, `${where}.visual`),
      capabilities: check.object(r.capabilities, `${where}.capabilities`) as UnitCapabilities,
      speedPerTick: Math.max(1, Math.round(speed * game.subTile / game.ticksPerSecond)),
    };
    if (def.turretTurnRate === 0) def.turretTurnRate = Math.min(128, def.turnRate * 2);
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
    const infinite = def.capabilities.infiniteSupply;
    if (infinite !== undefined && typeof infinite !== 'boolean') check.errors.push(`${where}.capabilities.infiniteSupply: expected a boolean`);
    if (infinite === true && (!(typeof supply === 'number' && supply > 0) || def.dockSlots < 1)) check.errors.push(`${where}.capabilities.infiniteSupply: requires positive supply stock and at least one dock`);
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

  const sub = game.subTile;
  const tps = game.ticksPerSecond;
  const weapons = new Map<string, WeaponDef>();
  check.array(raw.weapons, 'weapons').forEach((item, index) => {
    const r = check.object(item, `weapons[${index}]`);
    const where = `weapons[${typeof r.id === 'string' ? r.id : index}]`;
    const targets = check.strings(r, 'targets', where);
    for (const layer of targets) if (!MOVEMENT_LAYERS.includes(layer as MovementLayer)) check.errors.push(`${where}.targets: unknown layer ${layer}`);
    const def: WeaponDef = {
      id: check.string(r, 'id', where), name: check.string(r, 'name', where),
      damageType: check.oneOf(r, 'damageType', where, DAMAGE_TYPES),
      damage: check.number(r, 'damage', where, 1, 100000, true),
      penetration: check.number(r, 'penetration', where, 0, 1000, true),
      range: Math.round(check.number(r, 'range', where, 0.5, 40) * sub),
      minRange: Math.round(check.number(r, 'minRange', where, 0, 40) * sub),
      reloadTicks: check.number(r, 'reloadTicks', where, 1, 10000, true),
      projectile: check.oneOf(r, 'projectile', where, PROJECTILE_KINDS),
      projectileSpeed: Math.max(1, Math.round(check.number(r, 'projectileSpeed', where, 1, 200) * sub / tps)),
      splashRadius: Math.round(check.number(r, 'splashRadius', where, 0, 10) * sub),
      splashFalloff: check.number(r, 'splashFalloff', where, 0, 100, true),
      targets: targets as MovementLayer[],
      aimTolerance: check.number(r, 'aimTolerance', where, 0, 128, true),
      freeAim: check.bool(r, 'freeAim', where), setupTicks: check.number(r, 'setupTicks', where, 0, 10000, true),
      fireWhileMoving: check.bool(r, 'fireWhileMoving', where),
    };
    if (def.minRange >= def.range) check.errors.push(`${where}: minRange must be below range`);
    if (weapons.has(def.id)) check.errors.push(`${where}: duplicate weapon id ${def.id}`);
    weapons.set(def.id, def);
  });
  for (const unit of units.values()) for (const id of unit.weapons) if (!weapons.has(id)) check.errors.push(`units[${unit.id}].weapons: unknown weapon ${id}`);

  const c = check.object(raw.combat, 'combat');
  const classes = check.object(c.armorClasses, 'combat.armorClasses');
  const armorClasses: Record<string, Record<DamageType, number>> = {};
  for (const name of new Set([...ARMOR_CLASSES, ...Object.keys(classes)])) {
    const row = check.object(classes[name], `combat.armorClasses.${name}`);
    armorClasses[name] = { small: 0, he: 0, ap: 0 };
    for (const type of DAMAGE_TYPES) armorClasses[name][type] = check.number(row, type, `combat.armorClasses.${name}`, 0, 1000, true);
  }
  for (const unit of units.values()) if (!armorClasses[unit.armor]) check.errors.push(`units[${unit.id}].armor: unknown armor class ${unit.armor}`);
  const vet = check.object(c.veterancy, 'combat.veterancy');
  const percents = (key: string): number[] => {
    const list = check.array(vet[key], `combat.veterancy.${key}`);
    return list.map((value, i) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1000) check.errors.push(`combat.veterancy.${key}[${i}]: expected an integer percent`);
      return typeof value === 'number' ? value : 0;
    });
  };
  const air = check.object(c.air, 'combat.air');
  const combat: CombatRules = {
    armorClasses,
    minPenetrationPercent: check.number(c, 'minPenetrationPercent', 'combat', 0, 100, true),
    veterancy: { thresholdsPercent: percents('thresholdsPercent'), damagePercent: percents('damagePercent'), reloadPercent: percents('reloadPercent'), armorPercent: percents('armorPercent') },
    projectilePool: check.number(c, 'projectilePool', 'combat', 1, 65536, true),
    acquireIntervalTicks: check.number(c, 'acquireIntervalTicks', 'combat', 1, 100, true),
    fogIntervalTicks: check.number(c, 'fogIntervalTicks', 'combat', 1, 100, true),
    chaseRepathTicks: check.number(c, 'chaseRepathTicks', 'combat', 1, 1000, true),
    air: {
      holdRadius: check.number(air, 'holdRadius', 'combat.air', 1, 20, true),
      overshootTiles: check.number(air, 'overshootTiles', 'combat.air', 1, 20, true),
      altitude: check.number(air, 'altitude', 'combat.air', 0, 200, true),
    },
  };
  const levels = combat.veterancy.thresholdsPercent.length + 1;
  for (const key of ['damagePercent', 'reloadPercent', 'armorPercent'] as const) {
    if (combat.veterancy[key].length !== levels) check.errors.push(`combat.veterancy.${key}: expected ${levels} entries (one per rank)`);
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
    const generation = check.object(r.generation ?? {}, `${where}.generation`);
    for (const key of Object.keys(generation)) if (!(key in LAYOUT_DEFAULTS)) check.errors.push(`${where}.generation.${key}: unknown generator setting`);
    const palette = check.object(r.palette ?? {}, `${where}.palette`);
    for (const [key, value] of Object.entries(palette)) if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) check.errors.push(`${where}.palette.${key}: expected a #rrggbb colour`);
    const preset: MapPreset = {
      id: check.string(r, 'id', where), name: check.string(r, 'name', where), subtitle: check.string(r, 'subtitle', where),
      seed: check.number(r, 'seed', where, 0, 2 ** 31, true),
      generation, palette: palette as Record<string, string>,
      spawns: points(r.spawns, `${where}.spawns`), supplies: points(r.supplies, `${where}.supplies`), derricks: points(r.derricks, `${where}.derricks`),
      supplyType: check.string(r, 'supplyType', where), derrickType: check.string(r, 'derrickType', where),
      infiniteSupplies: points(r.infiniteSupplies ?? [], `${where}.infiniteSupplies`),
      infiniteSupplyType: r.infiniteSupplyType === undefined ? '' : check.string(r, 'infiniteSupplyType', where),
    };
    if (!buildings.has(preset.supplyType)) check.errors.push(`${where}.supplyType: unknown building ${preset.supplyType}`);
    if (!buildings.has(preset.derrickType)) check.errors.push(`${where}.derrickType: unknown building ${preset.derrickType}`);
    if (preset.infiniteSupplies.length > 0) {
      if (buildings.get(preset.infiniteSupplyType)?.capabilities.infiniteSupply !== true) check.errors.push(`${where}.infiniteSupplyType: expected a building with infiniteSupply`);
      if (preset.infiniteSupplies.length !== preset.spawns.length) check.errors.push(`${where}.infiniteSupplies: need one site per player spawn`);
    }
    if (preset.spawns.length < 2) check.errors.push(`${where}.spawns: need at least two player spawns`);
    if (maps.has(preset.id)) check.errors.push(`${where}: duplicate map id ${preset.id}`);
    maps.set(preset.id, preset);
  });

  const a = check.object(raw.ai, 'ai');
  const difficulties = new Map<string, AiDifficulty>();
  check.array(a.difficulties, 'ai.difficulties').forEach((item, index) => {
    const r = check.object(item, `ai.difficulties[${index}]`);
    const where = `ai.difficulties[${typeof r.id === 'string' ? r.id : index}]`;
    const int = (key: string, min: number, max: number): number => check.number(r, key, where, min, max, true);
    const def: AiDifficulty = {
      id: check.string(r, 'id', where), name: check.string(r, 'name', where),
      thinkIntervalTicks: int('thinkIntervalTicks', 1, 1000), actionsPerThink: int('actionsPerThink', 1, 100), tempoPercent: int('tempoPercent', 1, 1000),
      truckTarget: int('truckTarget', 0, 50), engineerTarget: int('engineerTarget', 0, 50), queueDepth: int('queueDepth', 1, 20), armyCap: int('armyCap', 0, 1000),
      firstWaveTick: int('firstWaveTick', 0, 1e7), waveIntervalTicks: int('waveIntervalTicks', 1, 1e7), waveStartSize: int('waveStartSize', 1, 500),
      waveGrowth: int('waveGrowth', 0, 500), waveMaxSize: int('waveMaxSize', 1, 500), waveCommitPercent: int('waveCommitPercent', 0, 100), incomePercent: int('incomePercent', 10, 1000),
      defenseReserve: int('defenseReserve', 0, 500), defenseRadius: int('defenseRadius', 1, 128), defenseCalmTicks: int('defenseCalmTicks', 1, 1e6),
      powerMargin: int('powerMargin', 0, 10000), placementTries: int('placementTries', 1, 10000), retryTicks: int('retryTicks', 1, 1e6),
      bankruptcyRetryTicks: int('bankruptcyRetryTicks', 1, 1e7),
    };
    if (def.waveMaxSize < def.waveStartSize) check.errors.push(`${where}: waveMaxSize below waveStartSize`);
    if (difficulties.has(def.id)) check.errors.push(`${where}: duplicate difficulty ${def.id}`);
    difficulties.set(def.id, def);
  });
  const defaultDifficulty = check.string(a, 'defaultDifficulty', 'ai');
  if (!difficulties.has(defaultDifficulty)) check.errors.push(`ai.defaultDifficulty: unknown difficulty ${defaultDifficulty}`);
  const aiFactions = new Map<string, AiFactionPlan>();
  const planned = check.object(a.factions, 'ai.factions');
  for (const [faction, value] of Object.entries(planned)) {
    const where = `ai.factions.${faction}`;
    if (!factions.has(faction)) check.errors.push(`${where}: unknown faction`);
    const r = check.object(value, where);
    const unitOf = (key: string, capability: string): string => {
      const type = check.string(r, key, where);
      const def = units.get(type);
      if (!def || def.faction !== faction || (capability && def.capabilities[capability] === undefined)) check.errors.push(`${where}.${key}: ${type} is not a ${faction} unit with ${capability}`);
      return type;
    };
    const power = check.string(r, 'power', where);
    if ((buildings.get(power)?.power ?? 0) <= 0) check.errors.push(`${where}.power: ${power} does not supply power`);
    const plan: AiFactionPlan = {
      power, truck: unitOf('truck', 'cargo'), engineer: unitOf('engineer', 'capture'),
      base: check.array(r.base, `${where}.base`).map((b, i) => {
        const bw = `${where}.base[${i}]`;
        const br = check.object(b, bw);
        const type = check.string(br, 'type', bw);
        const def = buildings.get(type);
        if (!def || def.faction !== faction || def.producer === null) check.errors.push(`${bw}.type: ${type} is not a buildable ${faction} structure`);
        return { type, count: check.number(br, 'count', bw, 1, 50, true), afterTick: br.afterTick === undefined ? 0 : check.number(br, 'afterTick', bw, 0, 1e7, true),
          minCredits: br.minCredits === undefined ? 0 : check.number(br, 'minCredits', bw, 0, 1e6, true) };
      }),
      army: Object.entries(check.object(r.army, `${where}.army`)).map(([type, weight]) => {
        const def = units.get(type);
        if (!def || def.faction !== faction || def.producer === null || def.weapons.length === 0) check.errors.push(`${where}.army.${type}: not a producible armed ${faction} unit`);
        if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 1 || weight > 1000) check.errors.push(`${where}.army.${type}: expected an integer weight in [1, 1000]`);
        return { type, weight: typeof weight === 'number' ? weight : 1 };
      }),
    };
    aiFactions.set(faction, plan);
  }
  const ai: AiRules = { factions: aiFactions, difficulties, defaultDifficulty };

  const scenarios = new Map<string, ScenarioDef>();
  check.array(raw.scenarios, 'scenarios').forEach((item, index) => {
    const r = check.object(item, `scenarios[${index}]`);
    const where = `scenarios[${typeof r.id === 'string' ? r.id : index}]`;
    const camera = check.object(r.camera, `${where}.camera`);
    const def: ScenarioDef = {
      id: check.string(r, 'id', where), name: check.string(r, 'name', where), description: check.string(r, 'description', where),
      map: check.string(r, 'map', where), resources: r.resources === true, fog: r.fog !== false, victory: r.victory === true,
      infiniteSupplies: r.infiniteSupplies === true,
      camera: { x: check.number(camera, 'x', `${where}.camera`, 0, 1023), y: check.number(camera, 'y', `${where}.camera`, 0, 1023) },
      players: check.array(r.players, `${where}.players`).map((p, pi) => {
        const pw = `${where}.players[${pi}]`;
        const pr = check.object(p, pw);
        const anchor = check.object(pr.anchor, `${pw}.anchor`);
        const faction = check.string(pr, 'faction', pw);
        if (!factions.has(faction)) check.errors.push(`${pw}.faction: unknown faction ${faction}`);
        const aiLevel = pr.ai === undefined ? '' : check.string(pr, 'ai', pw);
        if (aiLevel && !difficulties.has(aiLevel)) check.errors.push(`${pw}.ai: unknown difficulty ${aiLevel}`);
        if (aiLevel && !aiFactions.has(faction)) check.errors.push(`${pw}.ai: no AI plan for faction ${faction}`);
        return {
          ai: aiLevel,
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

  const sk = check.object(raw.skirmish, 'skirmish');
  const start = new Map<string, ScenarioUnitGroup[]>();
  for (const [faction, value] of Object.entries(check.object(sk.start, 'skirmish.start'))) {
    const where = `skirmish.start.${faction}`;
    if (!factions.has(faction)) check.errors.push(`${where}: unknown faction`);
    if (!aiFactions.has(faction)) check.errors.push(`${where}: no AI plan for this faction`);
    start.set(faction, check.array(value, where).map((u, ui) => {
      const ur = check.object(u, `${where}[${ui}]`);
      const type = check.string(ur, 'type', `${where}[${ui}]`);
      if (units.get(type)?.faction !== faction) check.errors.push(`${where}[${ui}].type: ${type} is not a ${faction} unit`);
      return { type, count: check.number(ur, 'count', `${where}[${ui}]`, 1, 50, true) };
    }));
    if (!start.get(faction)!.some(g => typeof units.get(g.type)?.capabilities.deploy === 'string')) check.errors.push(`${where}: needs a deployable unit (MCV) as the starting objective`);
  }
  for (const faction of factions.keys()) if (!start.has(faction)) check.errors.push(`skirmish.start: missing faction ${faction}`);
  const skirmish: SkirmishRules = {
    credits: check.number(sk, 'credits', 'skirmish', 0, 1_000_000, true),
    maps: check.strings(sk, 'maps', 'skirmish'),
    defaultMap: check.string(sk, 'defaultMap', 'skirmish'),
    defaultFaction: check.string(sk, 'defaultFaction', 'skirmish'),
    start,
  };
  for (const id of skirmish.maps) if (!maps.has(id)) check.errors.push(`skirmish.maps: unknown map ${id}`);
  if (!skirmish.maps.includes(skirmish.defaultMap)) check.errors.push(`skirmish.defaultMap: ${skirmish.defaultMap} is not a listed map`);
  if (!start.has(skirmish.defaultFaction)) check.errors.push(`skirmish.defaultFaction: unknown faction ${skirmish.defaultFaction}`);

  if (check.errors.length) throw new RulesError(check.errors);
  const record = raw as unknown as Record<string, unknown>;
  const hash = hashText(JSON.stringify(Object.keys(record).sort().map(key => [key, record[key]])));
  return { game, terrain, factions, units, buildings, economy, production, weapons, combat, maps, scenarios, ai, skirmish, hash };
}
