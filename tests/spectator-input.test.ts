import assert from 'node:assert/strict';
import test from 'node:test';
import { Camera } from '../src/engine/camera.ts';
import type { EntityLayer } from '../src/render/entity-layer.ts';
import { createEntity } from '../src/sim/entities.ts';
import type { Entity } from '../src/sim/entities.ts';
import type { World } from '../src/sim/world.ts';
import { GameInput } from '../src/ui/game-input.ts';
import { Selection } from '../src/ui/selection.ts';

class FakeCanvas extends EventTarget {
  private captured = -1;
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 480 }; }
  setPointerCapture(id: number): void { this.captured = id; }
  hasPointerCapture(id: number): boolean { return this.captured === id; }
  releasePointerCapture(): void { this.captured = -1; }
}

function withInput(player: number, check: (input: GameInput, selection: Selection, target: (entity: Entity) => void, click: () => Entity | null) => void): void {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
  const canvas = new FakeCanvas();
  const camera = new Camera(128, 128);
  camera.resize(640, 480);
  const selection = new Selection();
  let pointed: Entity | null = null;
  let inspected: Entity | null = null;
  const layer = { pick: (_x: number, _y: number, allowed: (entity: Entity) => boolean) => pointed && allowed(pointed) ? pointed : null };
  const input = new GameInput(canvas as unknown as HTMLCanvasElement, camera, layer as unknown as EntityLayer, selection, {
    player: () => player,
    world: () => ({} as World),
    selectable: entity => player >= 0 && entity.owner === player,
    order: () => {}, stop: () => {}, centerOn: () => {},
    inspect: entity => { inspected = entity; },
  });
  input.pointerX = 320;
  input.pointerY = 240;
  const click = (): Entity | null => {
    for (const type of ['pointerdown', 'pointerup']) canvas.dispatchEvent(Object.assign(new Event(type), {
      button: 0, pointerId: 1, clientX: 320, clientY: 240, shiftKey: false,
    }));
    return inspected;
  };
  try { check(input, selection, entity => { pointed = entity; }, click); }
  finally {
    input.destroy();
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('observers can hover and inspect neutral supply sites and both AI sides without selecting them', () => {
  withInput(-1, (input, selection, target, click) => {
    for (const owner of [-1, 0, 1]) {
      const entity = createEntity(owner + 10, 'building', owner < 0 ? 'supply_source' : 'hq', owner, 0);
      target(entity);
      assert.equal(input.hovered(), entity, `observer hover for owner ${owner}`);
      assert.equal(click(), entity, `observer inspection for owner ${owner}`);
      assert.deepEqual(selection.list(), [], 'inspection never becomes an owned selection');
    }
  });
});

test('human input still selects its own units and inspects neutral or enemy entities', () => {
  withInput(0, (input, selection, target, click) => {
    for (const owner of [-1, 0, 1]) {
      const entity = createEntity(owner + 10, owner < 0 ? 'building' : 'unit', owner < 0 ? 'supply_source' : 'rifle', owner, 0);
      target(entity);
      assert.equal(input.hovered(), entity, `human hover for owner ${owner}`);
      assert.equal(click(), owner === 0 ? null : entity);
      assert.deepEqual(selection.list(), owner === 0 ? [entity.id] : []);
    }
  });
});
