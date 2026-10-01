import { expect, it } from 'vitest';
import { FrameRate } from '../../src/app/frameRate.ts';

it('measures display callbacks independently of the 20 Hz simulation and updates every half second', () => {
  const rate = new FrameRate();
  rate.sample(0, true);
  for (let i = 1; i <= 35; i++) rate.sample(i * 1000 / 72, true);
  expect(rate.value).toBeNull();
  rate.sample(500, true);
  expect(rate.value).toBeCloseTo(72);
  for (let i = 1; i <= 45; i++) rate.sample(500 + i * 1000 / 90, true);
  expect(rate.value).toBeCloseTo(90);
});

it('weights uneven intervals by elapsed time and discards hidden or suspended periods', () => {
  const rate = new FrameRate();
  for (const time of [0, 10, 20, 30, 500]) rate.sample(time, true);
  expect(rate.value).toBe(8);
  rate.sample(520, false);
  expect(rate.value).toBeNull();
  for (let i = 0; i <= 36; i++) rate.sample(2000 + i * 1000 / 72, true);
  expect(rate.value).toBeCloseTo(72);
  rate.sample(5000, true);
  expect(rate.value).toBeNull();
});
