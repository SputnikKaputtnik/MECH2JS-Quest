import { expect, it } from 'vitest';
import { EndPanelInput } from '../browser/workerVrEndPanel.ts';
it('requires a fresh press after death and after losing visibility', () => {
  const input = new EndPanelInput(), hit = { x: 320, y: 280 };
  expect(input.update(true, hit, 1, false)).toBe(false);
  expect(input.update(true, hit, 0, false)).toBe(false);
  expect(input.update(true, hit, 1, false)).toBe(true);
  expect(input.update(true, hit, 1, false)).toBe(false);
  input.update(false, hit, 0, false);
  expect(input.update(true, hit, 1, false)).toBe(false);
});
it('requires pointing for trigger, permits A, and consumes a miss until release', () => {
  const input = new EndPanelInput(); input.update(true, null, 0, false);
  expect(input.update(true, null, 1, false)).toBe(false);
  expect(input.update(true, { x: 320, y: 280 }, 1, false)).toBe(false);
  input.update(true, null, 0, false);
  expect(input.update(true, null, 0, true)).toBe(true);
  input.reset(); expect(input.update(true, null, 0, true)).toBe(false);
});
