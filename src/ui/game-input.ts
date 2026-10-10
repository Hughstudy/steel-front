import type { Camera } from '../engine/camera.ts';
import { worldToTile } from '../engine/coordinates.ts';
import type { EntityLayer } from '../render/entity-layer.ts';
import type { Entity } from '../sim/entities.ts';
import type { World } from '../sim/world.ts';
import type { Selection } from './selection.ts';

export interface GameInputHost {
  /** The local player's index; selection only ever contains their entities. */
  player(): number;
  world(): World;
  /** Right-click on ground/entity with the given tile (floating centre coordinates). */
  /** Right-click order; `attackMove` when Ctrl/⌘ is held. */
  order(tileX: number, tileY: number, target: Entity | null, queue: boolean, attackMove: boolean): void;
  stop(): void;
  centerOn(ids: number[]): void;
  /** Returns true if the host consumed the click (e.g. building placement). */
  primaryAction?(tileX: number, tileY: number): boolean;
  cancelAction?(): boolean;
  selectable(entity: Entity): boolean;
  /** Left-click on something the player cannot select (neutral or enemy): show its details. */
  inspect?(entity: Entity | null): void;
}

const DRAG_THRESHOLD = 6;
const DOUBLE_CLICK_MS = 350;

/** Battlefield pointer/keyboard gameplay input; camera controls stay in CameraInput. */
export class GameInput {
  /** Screen-space drag rectangle while box-selecting, for the overlay. */
  readonly box = { active: false, x0: 0, y0: 0, x1: 0, y1: 0 };
  pointerX = -1;
  pointerY = -1;
  private pressed = false;
  private pointerId = -1;
  private lastClickTime = -1e9;
  private lastClickType = '';
  private lastGroupKey = '';
  private lastGroupTime = -1e9;
  private readonly controller = new AbortController();
  private readonly scratch = { x: 0, y: 0 };
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;
  private readonly layer: EntityLayer;
  private readonly selection: Selection;
  private readonly host: GameInputHost;

  constructor(canvas: HTMLCanvasElement, camera: Camera, layer: EntityLayer, selection: Selection, host: GameInputHost) {
    this.canvas = canvas;
    this.camera = camera;
    this.layer = layer;
    this.selection = selection;
    this.host = host;
    const options = { signal: this.controller.signal };
    canvas.addEventListener('pointerdown', this.down, options);
    canvas.addEventListener('pointermove', this.move, options);
    canvas.addEventListener('pointerup', this.up, options);
    canvas.addEventListener('pointercancel', this.cancel, options);
    canvas.addEventListener('lostpointercapture', this.cancel, options);
    canvas.addEventListener('pointerleave', () => { if (!this.pressed) this.pointerX = this.pointerY = -1; }, options);
    window.addEventListener('keydown', this.key, options);
    window.addEventListener('blur', this.cancel, options);
  }

  destroy(): void { this.controller.abort(); }

  /** Entity under the pointer, for hover rings and cursor feedback. */
  hovered(): Entity | null {
    if (this.pointerX < 0 || this.box.active) return null;
    this.camera.screenToWorld(this.pointerX, this.pointerY, this.scratch);
    return this.layer.pick(this.scratch.x, this.scratch.y, entity => this.host.selectable(entity) || entity.owner !== this.host.player());
  }

  pointerTile(out: { x: number; y: number }): boolean {
    if (this.pointerX < 0) return false;
    this.camera.screenToWorld(this.pointerX, this.pointerY, out);
    worldToTile(out.x, out.y, out);
    return true;
  }

  private local(event: PointerEvent): void {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointerX = event.clientX - bounds.left;
    this.pointerY = event.clientY - bounds.top;
  }

  private down = (event: PointerEvent): void => {
    this.local(event);
    if (event.button === 2) {
      event.preventDefault();
      if (this.host.cancelAction?.()) return;
      this.issueOrder(event.shiftKey, event.ctrlKey || event.metaKey);
      return;
    }
    if (event.button !== 0) return;
    this.pressed = true;
    this.pointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
    this.box.x0 = this.box.x1 = this.pointerX;
    this.box.y0 = this.box.y1 = this.pointerY;
    this.box.active = false;
  };

  private move = (event: PointerEvent): void => {
    this.local(event);
    if (!this.pressed) return;
    this.box.x1 = this.pointerX;
    this.box.y1 = this.pointerY;
    if (!this.box.active && Math.hypot(this.box.x1 - this.box.x0, this.box.y1 - this.box.y0) > DRAG_THRESHOLD) this.box.active = true;
  };

  private up = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.pressed) return;
    this.local(event);
    this.pressed = false;
    if (this.canvas.hasPointerCapture(this.pointerId)) this.canvas.releasePointerCapture(this.pointerId);
    if (this.box.active) {
      this.box.active = false;
      this.boxSelect(event.shiftKey);
    } else {
      this.click(event.shiftKey, event.timeStamp);
    }
  };

  private cancel = (): void => {
    this.pressed = false;
    this.box.active = false;
  };

  private tileAtPointer(): { x: number; y: number } {
    const point = { x: 0, y: 0 };
    this.pointerTile(point);
    return point;
  }

  private click(shift: boolean, time: number): void {
    const tile = this.tileAtPointer();
    if (this.host.primaryAction?.(tile.x, tile.y)) return;
    this.camera.screenToWorld(this.pointerX, this.pointerY, this.scratch);
    const entity = this.layer.pick(this.scratch.x, this.scratch.y, e => this.host.selectable(e));
    if (!entity) {
      const other = shift ? null : this.layer.pick(this.scratch.x, this.scratch.y, () => true);
      this.host.inspect?.(other);
      if (!shift) this.selection.clear();
      this.lastClickType = '';
      return;
    }
    if (time - this.lastClickTime < DOUBLE_CLICK_MS && this.lastClickType === entity.type) {
      // Double click: every visible owned unit of this type.
      const same = this.layer.visible(e => e.type === entity.type && this.host.selectable(e)).map(e => e.id);
      if (shift) this.selection.add(same); else this.selection.set(same);
      this.lastClickTime = -1e9;
      return;
    }
    this.host.inspect?.(null);
    this.lastClickTime = time;
    this.lastClickType = entity.type;
    if (shift) this.selection.toggle(entity.id);
    else this.selection.set([entity.id]);
  }

  private boxSelect(shift: boolean): void {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    this.camera.screenToWorld(Math.min(this.box.x0, this.box.x1), Math.min(this.box.y0, this.box.y1), a);
    this.camera.screenToWorld(Math.max(this.box.x0, this.box.x1), Math.max(this.box.y0, this.box.y1), b);
    const found = this.layer.inRect(a.x, a.y, b.x, b.y, e => this.host.selectable(e) && e.kind === 'unit').map(e => e.id);
    this.host.inspect?.(null);
    if (shift) this.selection.add(found);
    else if (found.length > 0) this.selection.set(found);
    else this.selection.clear();
  }

  private issueOrder(queue: boolean, attackMove = false): void {
    if (this.selection.ids.size === 0) return;
    const tile = this.tileAtPointer();
    this.camera.screenToWorld(this.pointerX, this.pointerY, this.scratch);
    const target = this.layer.pick(this.scratch.x, this.scratch.y, () => true);
    this.host.order(tile.x, tile.y, target, queue, attackMove);
  }

  private key = (event: KeyboardEvent): void => {
    if (event.altKey || document.querySelector('dialog[open]')) return;
    if (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (event.target instanceof HTMLElement && event.target.closest('[data-input-context="production"]')) return;
    const digit = /^Digit([0-9])$/.exec(event.code);
    if (digit) {
      const slot = Number(digit[1]);
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        this.selection.storeGroup(slot);
        return;
      }
      if (event.repeat) return;
      const restored = this.selection.recallGroup(slot, this.host.world(), this.host.player());
      // Pressing the same group key twice quickly centres the camera on it.
      if (restored && this.lastGroupKey === event.code && event.timeStamp - this.lastGroupTime < 400) this.host.centerOn(this.selection.list());
      this.lastGroupKey = event.code;
      this.lastGroupTime = event.timeStamp;
      return;
    }
    if (event.ctrlKey || event.metaKey) return;
    if (event.code === 'Escape') {
      if (!this.host.cancelAction?.()) this.selection.clear();
    }
    if (event.code === 'KeyX' && !event.repeat) this.host.stop();
  };
}
