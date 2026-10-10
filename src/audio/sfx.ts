/**
 * WebAudio-synthesized sound effects (no audio files). Presentation only: the
 * simulation never waits on or reads audio. The context is created on the first
 * user gesture (browser autoplay policy), voices are capped, and repeated cues
 * are rate-limited so large selections and battles stay readable.
 */
export type Cue = 'select' | 'order' | 'attack' | 'build' | 'ready' | 'denied' | 'place'
  | 'fire-small' | 'fire-gun' | 'fire-heavy' | 'impact' | 'explosion' | 'explosion-big' | 'victory' | 'defeat' | 'click';

const MAX_VOICES = 14;
/** Minimum seconds between two plays of the same cue. */
const SPACING: Partial<Record<Cue, number>> = {
  'fire-small': 0.05, 'fire-gun': 0.08, 'fire-heavy': 0.12, impact: 0.07, explosion: 0.09, 'explosion-big': 0.2,
  select: 0.08, order: 0.1, attack: 0.1, denied: 0.25, build: 0.1, ready: 0.3, place: 0.1, click: 0.04,
};

export class Sfx {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = 0;
  private readonly last = new Map<Cue, number>();
  private volumeValue = 0.7;
  private mutedValue = false;
  /** Suspended while the game is paused or hidden; cues are dropped meanwhile. */
  private held = false;

  get volume(): number { return this.volumeValue; }
  get muted(): boolean { return this.mutedValue; }
  get unlocked(): boolean { return this.context !== null && this.context.state === 'running'; }
  get active(): number { return this.voices; }

  /** Call from a user gesture (pointerdown/keydown). Creates or resumes the context. */
  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      const length = Math.floor(this.context.sampleRate * 1.2);
      this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      // Fixed-seed noise: presentation only, but avoids Math.random in the codebase.
      let seed = 0x2f6e2b1;
      for (let i = 0; i < length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = seed / 2147483648 - 1;
      }
      this.applyGain();
    }
    if (this.context.state === 'suspended' && !this.held) void this.context.resume();
  }

  setVolume(volume: number): void { this.volumeValue = Math.max(0, Math.min(1, volume)); this.applyGain(); }
  setMuted(muted: boolean): void { this.mutedValue = muted; this.applyGain(); }

  /** Hold (pause menu, hidden page, match ended to menu): silence and stop scheduling. */
  hold(held: boolean): void {
    this.held = held;
    if (!this.context) return;
    if (held && this.context.state === 'running') void this.context.suspend();
    else if (!held && this.context.state === 'suspended') void this.context.resume();
  }

  private applyGain(): void {
    if (this.master && this.context) this.master.gain.setValueAtTime(this.mutedValue ? 0 : this.volumeValue * 0.5, this.context.currentTime);
  }

  /** Play a cue at a relative level (0..1), e.g. attenuated by distance from the view. */
  play(cue: Cue, level = 1): void {
    const ctx = this.context;
    if (!ctx || !this.master || this.held || this.mutedValue || ctx.state !== 'running' || level <= 0.02) return;
    if (this.voices >= MAX_VOICES) return;
    const now = ctx.currentTime;
    const spacing = SPACING[cue] ?? 0;
    if (now - (this.last.get(cue) ?? -1) < spacing) return;
    this.last.set(cue, now);
    switch (cue) {
      case 'click': this.tone(now, 'square', 1200, 1200, 0.025, 0.08 * level); break;
      case 'select': this.tone(now, 'square', 660, 990, 0.05, 0.08 * level); break;
      case 'order': this.tone(now, 'triangle', 520, 520, 0.05, 0.12 * level); this.tone(now + 0.06, 'triangle', 780, 780, 0.06, 0.12 * level); break;
      case 'attack': this.tone(now, 'sawtooth', 300, 220, 0.09, 0.09 * level); this.tone(now + 0.08, 'sawtooth', 300, 200, 0.09, 0.08 * level); break;
      case 'build': this.tone(now, 'triangle', 440, 660, 0.08, 0.1 * level); break;
      case 'place': this.burst(now, 0.12, 'lowpass', 500, 0.3 * level); this.tone(now, 'sine', 120, 60, 0.15, 0.25 * level); break;
      case 'ready': for (let i = 0; i < 3; i++) this.tone(now + i * 0.09, 'triangle', [523, 659, 784][i], [523, 659, 784][i], 0.12, 0.1 * level); break;
      case 'denied': this.tone(now, 'square', 180, 140, 0.18, 0.08 * level); break;
      case 'fire-small': this.burst(now, 0.05, 'bandpass', 2200, 0.25 * level); break;
      case 'fire-gun': this.burst(now, 0.16, 'lowpass', 900, 0.5 * level); this.tone(now, 'sine', 140, 55, 0.18, 0.35 * level); break;
      case 'fire-heavy': this.burst(now, 0.35, 'lowpass', 450, 0.6 * level); this.tone(now, 'sine', 90, 35, 0.4, 0.45 * level); break;
      case 'impact': this.burst(now, 0.2, 'lowpass', 700, 0.35 * level); break;
      case 'explosion': this.burst(now, 0.5, 'lowpass', 500, 0.7 * level); this.tone(now, 'sine', 80, 30, 0.5, 0.5 * level); break;
      case 'explosion-big': this.burst(now, 1.1, 'lowpass', 320, 0.9 * level); this.tone(now, 'sine', 60, 22, 1, 0.7 * level); break;
      case 'victory': [392, 523, 659, 784].forEach((f, i) => this.tone(now + i * 0.16, 'triangle', f, f, i === 3 ? 0.7 : 0.18, 0.16)); break;
      case 'defeat': [392, 330, 262, 196].forEach((f, i) => this.tone(now + i * 0.22, 'triangle', f, f * 0.98, i === 3 ? 0.9 : 0.24, 0.16)); break;
    }
  }

  private voice(node: AudioScheduledSourceNode): void {
    this.voices++;
    node.onended = () => { this.voices--; node.disconnect(); };
  }

  private tone(start: number, type: OscillatorType, from: number, to: number, duration: number, level: number): void {
    const ctx = this.context!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.master!);
    this.voice(osc);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private burst(start: number, duration: number, filterType: BiquadFilterType, frequency: number, level: number): void {
    const ctx = this.context!;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, start);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.0002, level), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(this.master!);
    this.voice(source);
    source.start(start, 0, Math.min(duration + 0.02, 1.2));
  }
}
