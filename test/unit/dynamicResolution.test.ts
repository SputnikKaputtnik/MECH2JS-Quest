import { expect, it } from 'vitest';
import { DynamicResolution } from '../../src/app/dynamicResolution.ts';

it('ignores isolated stalls, bounds sustained overload, and recovers more slowly', () => {
  const control = new DynamicResolution();
  let now = 1;
  const run = (seconds: number, fps: number, target = 90) => {
    for (let i = 0; i < seconds * fps; i++) control.sample(now += 1000 / fps, target, true);
  };
  run(2, 90);
  control.sample(now += 150, 90, true);
  run(0.3, 90);
  expect(control.scale).toBe(1);
  run(12, 60);
  expect(control.scale).toBe(0.7);
  run(2, 90);
  expect(control.scale).toBe(0.7);
  run(25, 90);
  expect(control.scale).toBe(1);
  run(5, 72, 72);
  expect(control.scale).toBe(1);
});

it('resets timing across hidden/loading intervals and restores maximum when disabled', () => {
  const control = new DynamicResolution();
  let now = 1;
  for (let i = 0; i < 200; i++) control.sample(now += 20, 90, true);
  const reduced = control.scale;
  expect(reduced).toBeLessThan(1);
  control.resetTiming();
  control.sample(now += 10000, 90, true);
  expect(control.scale).toBe(reduced);
  control.sample(now += 1000, 90, true);
  expect(control.scale).toBe(reduced);
  expect(control.sample(now + 1, 90, false)).toBe(1);
});
