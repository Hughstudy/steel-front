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

export type EntityKind = 'unit' | 'building' | 'resource';

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
}

export function createEntity(id: number, kind: EntityKind, type: string, owner: number, hp: number): Entity {
  return {
    id, kind, type, owner, hp,
    x: 0, y: 0, prevX: 0, prevY: 0, facing: 32, prevFacing: 32, turret: 32, prevTurret: 32,
    tile: -1, next: -1, progress: 0, stepLength: 0, stepHeading: 0,
    path: null, pathIndex: 0, goal: -1, orderId: 0,
    moveState: MoveState.Idle, reason: '', blocked: 0, waitTotal: 0, lastProgress: 0,
    yieldPath: null, yieldIndex: 0, yieldAvoid: null, resume: false, repath: 0, odometer: 0,
  };
}
