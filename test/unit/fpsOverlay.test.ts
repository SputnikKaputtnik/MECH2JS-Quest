import { afterEach, expect, it, vi } from 'vitest';
import { Object3D, Vector3 } from 'three';
import { FpsOverlay, fpsColour } from '../../src/render/xr/fpsOverlay.ts';

afterEach(() => vi.unstubAllGlobals());

it('stays in the lower-right cockpit as the mech moves, without following the head', () => {
  const fillText = vi.fn();
  const context = { clearRect() {}, beginPath() {}, roundRect() {}, fill() {}, fillText };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
  const overlay = new FpsOverlay();
  const head = new Object3D();
  const mesh = overlay.scene.children[0]!.children[0]!;
  let expected: Vector3 | null = null;
  for (const angle of [0, 0.5, -1.2]) {
    head.position.set(angle * 10, 20, -30);
    head.rotation.set(angle / 3, angle, angle / 5);
    head.updateMatrixWorld(true);
    overlay.update(71.6, 87.46, head);
    overlay.scene.updateMatrixWorld(true);
    const relative = head.worldToLocal(mesh.getWorldPosition(new Vector3()));
    if (expected) expect(relative.distanceTo(expected)).toBeLessThan(1e-8);
    else expected = relative;
    expect(relative.x).toBeGreaterThan(0);
    expect(relative.y).toBeLessThan(0);
    expect(relative.z).toBeLessThan(0);
  }
  expect(fillText).toHaveBeenCalledTimes(2); // unchanged labels do not redraw/upload
  expect(fillText.mock.calls[0]![0]).toBe('72 FPS');
  expect(fillText.mock.calls[1]![0]).toBe('Ø 87.5');
  overlay.dispose();
});

it('colours actual values at the 60 and 89 FPS boundaries, before display rounding', () => {
  expect(fpsColour(59.99)).toBe('#ff7070');
  expect(fpsColour(60)).toBe('#f2cd61');
  expect(fpsColour(88.99)).toBe('#f2cd61');
  expect(fpsColour(89)).toBe('#80d99a');
  expect(fpsColour(90)).toBe('#80d99a');
});
