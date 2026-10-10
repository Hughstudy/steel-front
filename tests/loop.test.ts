import assert from 'node:assert/strict';
import test from 'node:test';
import { FixedClock } from '../src/engine/loop.ts';

test('simulation receives the same ordered 20 Hz ticks at 30, 60, and 144 FPS', () => {
  for (const fps of [30, 60, 144]) {
    const clock = new FixedClock();
    const ticks: number[] = [];
    for (let frame = 0; frame < fps * 10; frame++) {
      const alpha = clock.advance(1 / fps, (dt, tick) => {
        assert.equal(dt, 0.05);
        ticks.push(tick);
      });
      assert.ok(alpha >= 0 && alpha < 1);
    }
    assert.equal(clock.tick, 200);
    assert.deepEqual(ticks, Array.from({ length: 200 }, (_, i) => i + 1));
  }
});

test('irregular render intervals retain fractional time without changing simulation steps', () => {
  const clock = new FixedClock();
  let simulatedTime = 0;
  const update = (dt: number): void => { simulatedTime += dt; };
  // Each group is 200 ms, despite uneven display scheduling.
  for (let group = 0; group < 50; group++) {
    for (const elapsed of [0.003, 0.021, 0.011, 0.049, 0.016, 0.1]) clock.advance(elapsed, update);
  }
  assert.equal(clock.tick, 200);
  assert.ok(Math.abs(simulatedTime - 10) < 1e-10);
});

test('background-tab delay is bounded to five ticks instead of causing a catch-up spiral', () => {
  const clock = new FixedClock();
  let updates = 0;
  const alpha = clock.advance(3600, () => { updates++; });
  assert.equal(updates, 5);
  assert.equal(clock.tick, 5);
  assert.ok(alpha < 1e-8);
  clock.advance(0, () => { updates++; });
  assert.equal(updates, 5);
});

test('visibility reset discards partial elapsed time without resetting completed ticks', () => {
  const clock = new FixedClock();
  const update = (): void => {};
  clock.advance(0.074, update);
  assert.equal(clock.tick, 1);
  clock.clearAccumulator();
  clock.advance(0.026, update);
  assert.equal(clock.tick, 1);
  clock.advance(0.024, update);
  assert.equal(clock.tick, 2);
  clock.advance(-1, update);
  assert.equal(clock.tick, 2);
});
