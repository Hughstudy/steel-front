import assert from 'node:assert/strict';
import test from 'node:test';
import { Camera } from '../src/engine/camera.ts';
import { CameraInput } from '../src/engine/input.ts';

class FakeCanvas extends EventTarget {
  getBoundingClientRect() { return { left: 60, top: 60, width: 640, height: 480 }; }
}

function withInput(check: (canvas: FakeCanvas, camera: Camera, input: CameraInput) => void): void {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
  Object.defineProperty(globalThis, 'document', { value: Object.assign(new EventTarget(), { querySelector: () => null }), configurable: true });
  const canvas = new FakeCanvas();
  const camera = new Camera(128, 128);
  camera.resize(640, 480);
  camera.jump(50, 50);
  const input = new CameraInput(canvas as unknown as HTMLCanvasElement, camera, () => {}, () => {}, () => {});
  try { check(canvas, camera, input); }
  finally {
    input.destroy();
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
}

function enter(canvas: FakeCanvas, x: number, y: number): void {
  canvas.dispatchEvent(Object.assign(new Event('pointerenter'), { clientX: x + 60, clientY: y + 60 }));
}

test('entering the battlefield after a menu closes never scrolls using stale pointer coordinates', () => {
  withInput((canvas, camera, input) => {
    const x = camera.view.x;
    const y = camera.view.y;
    enter(canvas, 320, 240); // A closing dialog reveals a stationary pointer: no pointermove fires.
    input.update(0.05);
    camera.update(1);
    assert.equal(camera.view.x, x);
    assert.equal(camera.view.y, y);
    enter(canvas, 2, 240);
    canvas.dispatchEvent(new Event('pointerleave'));
    enter(canvas, 320, 240); // Re-enter away from the old edge position.
    input.update(0.05);
    camera.update(1);
    assert.equal(camera.view.x, x);
    assert.equal(camera.view.y, y);
  });
});

test('entering an actual map edge starts scrolling on the correct axis', () => {
  withInput((canvas, camera, input) => {
    const x = camera.view.x;
    const y = camera.view.y;
    enter(canvas, 2, 240);
    input.update(0.05);
    camera.update(1);
    assert.ok(camera.view.x < x);
    assert.equal(camera.view.y, y);
  });
});
