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
export interface ScenarioPlayer {
  faction: string; credits: number; anchor: { x: number; y: number }; units: ScenarioUnitGroup[];
}
export interface ScenarioDef {
  id: string; name: string; description: string; map: string;
  camera: { x: number; y: number }; players: ScenarioPlayer[];
}

export interface Rules {
  game: GameRules;
  terrain: TerrainRules;
  factions: Map<string, FactionDef>;
  units: Map<string, UnitDef>;
  scenarios: Map<string, ScenarioDef>;
}

export interface RawRules {
  game: unknown; terrain: unknown; factions: unknown; units: unknown; scenarios: unknown;
}

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

  const scenarios = new Map<string, ScenarioDef>();
  check.array(raw.scenarios, 'scenarios').forEach((item, index) => {
    const r = check.object(item, `scenarios[${index}]`);
    const where = `scenarios[${typeof r.id === 'string' ? r.id : index}]`;
    const camera = check.object(r.camera, `${where}.camera`);
    const def: ScenarioDef = {
      id: check.string(r, 'id', where), name: check.string(r, 'name', where), description: check.string(r, 'description', where),
      map: check.string(r, 'map', where),
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
    if (scenarios.has(def.id)) check.errors.push(`${where}: duplicate scenario id ${def.id}`);
    scenarios.set(def.id, def);
  });

  if (check.errors.length) throw new RulesError(check.errors);
  return { game, terrain, factions, units, scenarios };
}
