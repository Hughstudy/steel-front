/** Byte angles: 256 units per turn, 0 = +x tile axis, 64 = +y tile axis. */

const FULL = 256;

export function normalizeAngle(angle: number): number { return ((angle % FULL) + FULL) % FULL; }

/** Signed shortest difference from `from` to `to`, in (-128, 128]. */
export function angleDelta(from: number, to: number): number {
  let delta = normalizeAngle(to - from);
  if (delta > 128) delta -= FULL;
  return delta;
}

export function turnToward(current: number, target: number, rate: number): number {
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= rate) return normalizeAngle(target);
  return normalizeAngle(current + (delta > 0 ? rate : -rate));
}

/**
 * Deterministic atan2 replacement using only IEEE basic arithmetic, so results
 * do not depend on a browser's transcendental-function implementation.
 */
export function byteAngle(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const swap = ay > ax;
  const z = swap ? ax / ay : ay / ax;
  // atan(z) for z in [0,1], max error ~0.0015 rad; expressed in byte units.
  let a = (z * (0.7853981633974483 + 0.273 * (1 - z)) + 0.0) * (128 / Math.PI);
  if (swap) a = 64 - a;
  if (dx < 0) a = 128 - a;
  if (dy < 0) a = FULL - a;
  return normalizeAngle(Math.round(a));
}

/** Step headings for the eight grid neighbours, indexed by neighbour order. */
export const NEIGHBOR_DX = [1, 0, -1, 0, 1, -1, -1, 1];
export const NEIGHBOR_DY = [0, 1, 0, -1, 1, 1, -1, -1];
export const NEIGHBOR_HEADING = [0, 64, 128, 192, 32, 96, 160, 224];
