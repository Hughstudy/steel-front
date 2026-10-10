/** The simulation receives exactly 1/20 second per tick, never wall-clock dt. */
export class FixedClock {
  readonly step = 1 / 20;
  tick = 0;
  private accumulator = 0;

  advance(elapsed: number, update: (dt: number, tick: number) => void): number {
    // Paused/background tabs never trigger an unbounded catch-up spiral.
    this.accumulator += Math.min(Math.max(elapsed, 0), 0.25);
    while (this.accumulator + 1e-10 >= this.step) {
      this.accumulator -= this.step;
      update(this.step, ++this.tick);
    }
    return Math.max(0, this.accumulator / this.step);
  }

  clearAccumulator(): void { this.accumulator = 0; }
}

/**
 * One display frame. While the page is hidden (or gameplay is paused) no tick
 * runs and partial time is discarded, so returning never replays hidden time.
 */
export function advanceFrame(clock: FixedClock, elapsed: number, paused: boolean,
  update: (dt: number, tick: number) => void): number {
  if (paused) {
    clock.clearAccumulator();
    return 0;
  }
  return clock.advance(elapsed, update);
}

export class GameLoop {
  /** Extra pause predicate (menus, modal pause). Hidden pages always pause. */
  paused: () => boolean = () => false;
  readonly clock = new FixedClock();
  private lastTime = 0;
  private requestId = 0;
  private running = false;
  private update: (dt: number, tick: number) => void;
  private render: (alpha: number, dt: number) => void;

  constructor(update: (dt: number, tick: number) => void, render: (alpha: number, dt: number) => void) {
    this.update = update;
    this.render = render;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', this.visibility);
    this.lastTime = performance.now();
    this.requestId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.requestId);
    document.removeEventListener('visibilitychange', this.visibility);
  }

  private visibility = (): void => {
    this.lastTime = performance.now();
    this.clock.clearAccumulator();
  };

  private frame = (now: number): void => {
    if (!this.running) return;
    const elapsed = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const alpha = advanceFrame(this.clock, elapsed, document.hidden || this.paused(), this.update);
    this.render(alpha, Math.min(elapsed, 0.05));
    this.requestId = requestAnimationFrame(this.frame);
  };
}
