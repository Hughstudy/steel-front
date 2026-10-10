/**
 * Tick-stamped, serializable player commands. UI and AI only enqueue these;
 * the world validates ownership/targets when the command executes.
 */
export type CommandKind = 'move' | 'stop' | 'harvest' | 'deposit' | 'capture'
  | 'build' | 'cancel' | 'place' | 'deploy' | 'sell' | 'repair' | 'rally';

export interface CommandInput {
  player: number;
  kind: CommandKind;
  ids: number[];
  /** Target tile coordinates (integers), when applicable. */
  x: number;
  y: number;
  /** Target entity id for harvest/deposit/capture (-1 or omitted when not applicable). */
  target?: number;
  /** Unit/building type for build, cancel and place. */
  type?: string;
}

export interface Command extends CommandInput {
  tick: number;
  seq: number;
}
