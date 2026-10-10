import { Camera } from './camera.ts';
import { worldToTile } from './coordinates.ts';

/** Presentation controls run at render frequency; gameplay orders belong to sim ticks. */
export class CameraInput {
  private readonly keys = new Set<string>();
  private pointerX = 0;
  private pointerY = 0;
  private inside = false;
  private dragging = false;
  private readonly scratch = { x: 0, y: 0 };
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private inspect: (x: number, y: number) => void;
  private reset: () => void;
  private toggleGrid: () => void;
  private controller = new AbortController();

  constructor(canvas: HTMLCanvasElement, camera: Camera, inspect: (x: number, y: number) => void,
    reset: () => void, toggleGrid: () => void) {
    this.canvas = canvas;
    this.camera = camera;
    this.inspect = inspect;
    this.reset = reset;
    this.toggleGrid = toggleGrid;
    const options = { signal: this.controller.signal };
    window.addEventListener('keydown', this.keyDown, options);
    window.addEventListener('keyup', this.keyUp, options);
    window.addEventListener('blur', this.clear, options);
    document.addEventListener('visibilitychange', this.clear, options);
    canvas.addEventListener('pointermove', this.pointerMove, options);
    canvas.addEventListener('pointerenter', () => { this.inside = true; }, options);
    canvas.addEventListener('pointerleave', () => { this.inside = false; }, options);
    canvas.addEventListener('pointerdown', this.pointerDown, options);
    canvas.addEventListener('pointerup', this.pointerUp, options);
    canvas.addEventListener('lostpointercapture', this.pointerUp, options);
    canvas.addEventListener('wheel', this.wheel, { ...options, passive: false });
    canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
  }

  update(dt: number): void {
    if (document.querySelector('dialog[open]')) { this.clear(); return; }
    let x = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight'))
      - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    let y = Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'))
      - Number(this.keys.has('KeyW') || this.keys.has('ArrowUp'));
    if (this.inside && !this.dragging) {
      const edge = 22;
      if (this.pointerX < edge) x -= (edge - this.pointerX) / edge;
      if (this.pointerX > this.camera.view.width - edge) x += (this.pointerX - this.camera.view.width + edge) / edge;
      if (this.pointerY < edge) y -= (edge - this.pointerY) / edge;
      if (this.pointerY > this.camera.view.height - edge) y += (this.pointerY - this.camera.view.height + edge) / edge;
    }
    const length = Math.hypot(x, y);
    if (length > 0) {
      const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1120 : 640;
      const scale = speed * dt / Math.max(length, 1);
      this.camera.pan(x * scale, y * scale);
    }
    if (this.inside) this.inspectPointer();
  }

  destroy(): void { this.controller.abort(); }

  private keyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]')) return;
    if (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    // A focused production panel owns its keys (Q/W/E/R, digits); never pan from them.
    if (event.target instanceof HTMLElement && event.target.closest('[data-input-context]')) return;
    if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','ShiftLeft','ShiftRight'].includes(event.code)) {
      event.preventDefault();
      this.keys.add(event.code);
    }
    if (event.repeat) return;
    const onButton = event.target instanceof HTMLElement && !!event.target.closest('button, a');
    if (event.code === 'Home' || (event.code === 'Space' && !onButton)) { event.preventDefault(); this.reset(); }
    if (event.code === 'KeyG') this.toggleGrid();
    if (event.code === 'Equal' || event.code === 'NumpadAdd') this.camera.zoomAt(1.2);
    if (event.code === 'Minus' || event.code === 'NumpadSubtract') this.camera.zoomAt(1 / 1.2);
  };

  private keyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };

  /** Forget held keys, e.g. when keyboard focus moves into another input context. */
  releaseKeys(): void { this.keys.clear(); }
  private clear = (): void => {
    this.keys.clear();
    this.pointerUp();
    this.inside = false;
  };

  private pointerMove = (event: PointerEvent): void => {
    const bounds = this.canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (this.dragging) this.camera.pan(this.pointerX - x, this.pointerY - y, true);
    this.pointerX = x;
    this.pointerY = y;
    this.inside = x >= 0 && y >= 0 && x < bounds.width && y < bounds.height;
  };

  private pointerDown = (event: PointerEvent): void => {
    this.canvas.focus({ preventScroll: true });
    this.pointerMove(event);
    if (event.button === 1) {
      event.preventDefault();
      this.dragging = true;
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.classList.add('is-dragging');
    }
  };

  private pointerUp = (): void => { this.dragging = false; this.canvas.classList.remove('is-dragging'); };
  private wheel = (event: WheelEvent): void => {
    event.preventDefault();
    const bounds = this.canvas.getBoundingClientRect();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
    this.camera.zoomAt(Math.exp(-Math.max(-240, Math.min(240, pixels)) * 0.0018),
      event.clientX - bounds.left, event.clientY - bounds.top);
  };

  private inspectPointer(): void {
    this.camera.screenToWorld(this.pointerX, this.pointerY, this.scratch);
    worldToTile(this.scratch.x, this.scratch.y, this.scratch);
    this.inspect(Math.floor(this.scratch.x), Math.floor(this.scratch.y));
  }
}
