/** Order/navigation states exposed for inspection. */
export const MoveState = {
  Idle: 0,
  Pending: 1,
  Moving: 2,
  Waiting: 3,
  Arrived: 4,
  Unreachable: 5,
} as const;
export type MoveStateValue = typeof MoveState[keyof typeof MoveState];
export const MOVE_STATE_NAMES = ['Idle', 'Awaiting route', 'Moving', 'Waiting', 'Arrived', 'Unreachable'];

export type EntityKind = 'unit' | 'building';

/** A bounded docking reservation at a dump or depot. */
export interface DockLease { truck: number; tile: number; until: number }

/**
 * Authoritative entity record. Plain data only (no references to other
 * entities or rendering objects) so the whole world can be serialized.
 * Positions are fixed-point tile units (`subTile` per tile), centre-based.
 */
export interface Entity {
  id: number;
  kind: EntityKind;
  type: string;
  owner: number;
  hp: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  facing: number;
  prevFacing: number;
  turret: number;
  prevTurret: number;
  /** Ground navigation (tile indices, -1 when not applicable). */
  tile: number;
  next: number;
  progress: number;
  stepLength: number;
  stepHeading: number;
  path: number[] | null;
  pathIndex: number;
  goal: number;
  orderId: number;
  moveState: MoveStateValue;
  reason: string;
  blocked: number;
  waitTotal: number;
  lastProgress: number;
  yieldPath: number[] | null;
  yieldIndex: number;
  yieldAvoid: number[] | null;
  /** Whether an interrupted order resumes after yielding. */
  resume: boolean;
  /** 0 = none, 1 = static route requested, 2 = route around stationary units requested. */
  repath: number;
  /** Distance travelled in fixed-point units, used only for presentation (walk cycles). */
  odometer: number;
  /** Economy: cargo carried (trucks) or stock remaining (dumps), in credits. */
  cargo: number;
  stock: number;
  /** Autonomous task (truck hauling, engineer capture); '' when idle. */
  task: string;
  /** Entity id the task is aimed at (-1 none). */
  target: number;
  /** Player-preferred task target (-1 none). */
  preferred: number;
  /** Generic task counter: retry delay or capture progress, in ticks. */
  timer: number;
  /** Readable task status for the HUD. */
  status: string;
  /** True while a truck autonomously hauls. */
  auto: boolean;
  /** Dock leases held at this building. */
  docks: DockLease[] | null;
  /** Producer rally tile (-1 = drive straight out of the exit). */
  rally: number;
  /** Building is being repaired with credits. */
  repairing: boolean;
}

export function createEntity(id: number, kind: EntityKind, type: string, owner: number, hp: number): Entity {
  return {
    id, kind, type, owner, hp,
    x: 0, y: 0, prevX: 0, prevY: 0, facing: 32, prevFacing: 32, turret: 32, prevTurret: 32,
    tile: -1, next: -1, progress: 0, stepLength: 0, stepHeading: 0,
    path: null, pathIndex: 0, goal: -1, orderId: 0,
    moveState: MoveState.Idle, reason: '', blocked: 0, waitTotal: 0, lastProgress: 0,
    yieldPath: null, yieldIndex: 0, yieldAvoid: null, resume: false, repath: 0, odometer: 0,
    cargo: 0, stock: 0, task: '', target: -1, preferred: -1, timer: 0, status: '', auto: false, docks: null, rally: -1, repairing: false,
  };
}
