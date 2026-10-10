/**
 * Tick-stamped, serializable player commands. UI and AI only enqueue these;
 * the world validates ownership/targets when the command executes.
 */
export type CommandKind = 'move' | 'stop';

export interface CommandInput {
  player: number;
  kind: CommandKind;
  ids: number[];
  /** Target tile coordinates (integers), when applicable. */
  x: number;
  y: number;
}

export interface Command extends CommandInput {
  tick: number;
  seq: number;
}
