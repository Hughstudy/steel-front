import assert from 'node:assert/strict';
import test from 'node:test';
import { Camera } from '../src/engine/camera.ts';
import { tileToWorld, worldToTile } from '../src/engine/coordinates.ts';

function near(actual: number, expected: number, tolerance = 1e-7): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

function centeredCamera(): Camera {
  const camera = new Camera(128, 128);
  camera.resize(1280, 720);
  camera.reset(63, 63);
  return camera;
}

function settle(camera: Camera): void {
  for (let frame = 0; frame < 120; frame++) camera.update(1 / 60);
}

test('isometric projection round-trips corners, tile centers, and fractional positions in place', () => {
  for (const [x, y] of [[0, 0], [128, 0], [0, 128], [128, 128], [63.5, 63.5], [12.125, 117.75], [-7.25, 3.5]]) {
    const point = { x, y };
    assert.equal(tileToWorld(point.x, point.y, point), point);
    assert.equal(worldToTile(point.x, point.y, point), point);
    near(point.x, x);
    near(point.y, y);
  }
});

test('panning covers the same screen distance at every supported zoom', () => {
  for (const zoom of [0.35, 0.7, 1, 1.8]) {
    const camera = centeredCamera();
    camera.zoomAt(zoom);
    settle(camera);
    const startX = camera.view.x;
    const startY = camera.view.y;
    camera.pan(96, -48);
    settle(camera);
    near((camera.view.x - startX) * camera.view.zoom, 96);
    near((camera.view.y - startY) * camera.view.zoom, -48);
  }
});

test('smooth pan converges consistently at different display refresh rates', () => {
  const positions: number[] = [];
  for (const fps of [30, 60, 144]) {
    const camera = centeredCamera();
    camera.pan(120, 80);
    for (let frame = 0; frame < fps; frame++) camera.update(1 / fps);
    positions.push(camera.view.x, camera.view.y);
  }
  near(positions[0], positions[2]);
  near(positions[1], positions[3]);
  near(positions[0], positions[4]);
  near(positions[1], positions[5]);
});

test('camera center stays inside the map diamond during extreme pans and minimap jumps', () => {
  const camera = centeredCamera();
  const tile = { x: 0, y: 0 };
  for (const [x, y] of [[1e6, 0], [-1e6, 0], [0, 1e6], [0, -1e6], [1e6, 1e6]]) {
    camera.pan(x, y);
    for (let frame = 0; frame < 120; frame++) {
      camera.update(1 / 60);
      worldToTile(camera.view.x, camera.view.y, tile);
      assert.ok(tile.x >= 0.5 - 1e-9 && tile.x <= 127.5 + 1e-9);
      assert.ok(tile.y >= 0.5 - 1e-9 && tile.y <= 127.5 + 1e-9);
    }
  }
  for (const [x, y] of [[-100, -100], [1000, 1000], [-100, 1000], [1000, -100]]) {
    camera.jump(x, y);
    worldToTile(camera.view.x, camera.view.y, tile);
    assert.ok(tile.x >= 0.5 && tile.x <= 127.5);
    assert.ok(tile.y >= 0.5 && tile.y <= 127.5);
  }
});

test('the world point under the cursor remains fixed throughout animated zoom', () => {
  const camera = centeredCamera();
  const anchor = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  camera.screenToWorld(890, 455, anchor);
  for (const factor of [1.6, 0.45, 1.3]) {
    camera.zoomAt(factor, 890, 455);
    for (let frame = 0; frame < 40; frame++) {
      camera.update(1 / 60);
      camera.screenToWorld(890, 455, current);
      near(current.x, anchor.x);
      near(current.y, anchor.y);
    }
  }
});

test('repeated wheel zooms respect both limits, then zoom back out normally', () => {
  const camera = centeredCamera();
  for (let wheel = 0; wheel < 50; wheel++) camera.zoomAt(2);
  settle(camera);
  assert.equal(camera.view.zoom, camera.maxZoom);
  camera.zoomAt(0.9);
  settle(camera);
  near(camera.view.zoom, camera.maxZoom * 0.9);
  for (let wheel = 0; wheel < 50; wheel++) camera.zoomAt(0.5);
  settle(camera);
  assert.equal(camera.view.zoom, camera.minZoom);
});
