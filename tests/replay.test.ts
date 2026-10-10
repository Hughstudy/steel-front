import assert from 'node:assert/strict';
import test from 'node:test';
import { FixedClock, advanceFrame } from '../src/engine/loop.ts';
import type { CommandInput } from '../src/sim/commands.ts';
import { ids, scenarioWorld, snapshot } from './helpers.ts';

const plan: Array<[number, (all: number[]) => CommandInput]> = [
  [1, all => ({ player: 0, kind: 'move', ids: all, x: 95, y: 60 })],
  [90, all => ({ player: 0, kind: 'move', ids: all.slice(0, 10), x: 60, y: 92 })],
  [200, all => ({ player: 0, kind: 'move', ids: all.slice(5), x: 30, y: 40 })],
  [420, all => ({ player: 0, kind: 'stop', ids: all.slice(0, 3), x: 0, y: 0 })],
];

/** Drive the world from a fixed render rate, issuing logged commands at their ticks. */
function runAt(fps: number, ticks: number): string {
  const world = scenarioWorld('m1-maneuvers');
  const all = ids(world);
  const clock = new FixedClock();
  let cursor = 0;
  const update = (): void => {
    while (cursor < plan.length && plan[cursor][0] === world.tick + 1) world.enqueue(plan[cursor++][1](all), world.tick + 1);
    world.step();
  };
  while (clock.tick < ticks) {
    advanceFrame(clock, 1 / fps, false, (dt, tick) => { if (tick <= ticks) update(); });
  }
  assert.equal(world.tick, ticks);
  return snapshot(world);
}

test('identical command logs give identical state at 30, 60 and 144 FPS render rates', () => {
  const reference = runAt(60, 900);
  assert.equal(runAt(30, 900), reference);
  assert.equal(runAt(144, 900), reference);
});

test('hidden-page frames never advance the authoritative tick or bank hidden time', () => {
  const clock = new FixedClock();
  let updates = 0;
  const update = (): void => { updates++; };
  advanceFrame(clock, 0.04, false, update);
  for (let i = 0; i < 100; i++) advanceFrame(clock, 1, true, update);
  assert.equal(updates, 0);
  assert.equal(clock.tick, 0);
  // On return, previously accumulated partial time was discarded too.
  advanceFrame(clock, 0.016, false, update);
  assert.equal(clock.tick, 0);
  advanceFrame(clock, 0.034, false, update);
  assert.equal(clock.tick, 1);
});
