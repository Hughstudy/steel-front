/** Serializable gameplay PRNG (mulberry32). Never use Math.random() for gameplay. */
export class Random {
  state: number;

  constructor(seed: number) { this.state = seed >>> 0; }

  /** Uniform integer in [0, 2^32). */
  nextUint(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number { return n <= 0 ? 0 : this.nextUint() % n; }
}
