import { expect, it } from 'vitest';
import { HudOverlay } from '../../src/render/passes/hudOverlay.ts';
import { makeUniforms } from '../../src/render/materials/indexedMaterial.ts';
import { VfxWindow, vfxWindowAllocate, HUD_LAYER } from '../../src/engine/vfx/vfx.ts';
import type { ShaderMaterial, Vector4 } from 'three';
import fc from 'fast-check';

it('reuses HUD pixels between simulation passes while preserving every changed image and layer', () => {
  const cached = new HudOverlay(makeUniforms());
  const reference = new HudOverlay(makeUniforms());
  let win = new VfxWindow(); vfxWindowAllocate(win, 8, 6);
  for (let frame = 0; frame < 20; frame++) {
    const changed = frame % 4 === 0;
    if (frame === 7) { win = new VfxWindow(); vfxWindowAllocate(win, 10, 4); }
    if (changed) {
      win.buffer.fill(frame);
      win.drawn.fill(1);
      win.layer.fill(HUD_LAYER.rest);
      win.layer[frame % win.layer.length] = HUD_LAYER.reticle;
      win.inset[0] = frame % 3;
    }
    const before = cached.windowUniforms.uWindow.value?.version;
    expect(cached.update(win, 1680 + frame, 1760, changed)).toBe(true);
    reference.update(win, 1680 + frame, 1760);
    expect(cached.windowUniforms.uWindow.value!.image.data).toEqual(reference.windowUniforms.uWindow.value!.image.data);
    expect(cached.reticleCentre).toEqual(reference.reticleCentre);
    if (!changed && frame !== 7) expect(cached.windowUniforms.uWindow.value!.version).toBe(before);
  }
  cached.dispose(); reference.dispose();
});

it('bounds isolated layers with a pixel guard, preserving their original UV-to-position mapping', () => {
  const hud = new HudOverlay(makeUniforms());
  const win = new VfxWindow(); vfxWindowAllocate(win, 640, 480);
  for (const [x, y, layer] of [[315, 233, HUD_LAYER.reticle], [325, 247, HUD_LAYER.reticle], [0, 0, HUD_LAYER.targetMarker], [18, 40, HUD_LAYER.targetMarker]]) {
    const i = y! * 640 + x!; win.drawn[i] = 1; win.layer[i] = layer!;
  }
  hud.update(win, 2100, 2200);
  const rect = (mesh: typeof hud.reticleMesh) => ((mesh.material as ShaderMaterial).uniforms.uBounds!.value as Vector4).toArray();
  expect(rect(hud.reticleMesh)).toEqual([314 / 640, 1 - 249 / 480, 327 / 640, 1 - 232 / 480]);
  expect(rect(hud.markerMesh)).toEqual([0, 1 - 42 / 480, 20 / 640, 1]);
  expect(hud.layerCoverage.reticle).toBeLessThan(0.001);
  expect(hud.reticleMesh.geometry.drawRange.count).toBe(6);
  const version = hud.windowUniforms.uWindow.value!.version;
  hud.cropWorldLayers = false;
  expect(rect(hud.reticleMesh)).toEqual([0, 0, 1, 1]);
  hud.cropWorldLayers = true;
  hud.update(win, 2200, 2300, false);
  expect(rect(hud.reticleMesh)).toEqual([314 / 640, 1 - 249 / 480, 327 / 640, 1 - 232 / 480]);
  expect(hud.windowUniforms.uWindow.value!.version).toBe(version);
  hud.dispose();
});

it('removes empty layers and restores them on target changes and window resize', () => {
  const hud = new HudOverlay(makeUniforms());
  const win = new VfxWindow(); vfxWindowAllocate(win, 8, 6);
  hud.update(win, 100, 100);
  expect(hud.markerMesh.geometry.drawRange.count).toBe(0);
  expect(hud.reticleMesh.geometry.drawRange.count).toBe(0);
  win.drawn[47] = 1; win.layer[47] = HUD_LAYER.targetMarker;
  hud.update(win, 100, 100);
  expect(hud.markerMesh.geometry.drawRange.count).toBe(6);
  expect(((hud.markerMesh.material as ShaderMaterial).uniforms.uBounds!.value as Vector4).toArray()).toEqual([6 / 8, 0, 1, expect.closeTo(2 / 6, 12)]);
  vfxWindowAllocate(win, 16, 12);
  hud.update(win, 100, 100, false);
  expect(hud.markerMesh.geometry.drawRange.count).toBe(0);
  expect(hud.layerCoverage.marker).toBe(0);
  hud.dispose();
});

it('packs exactly the original RGBA bytes, including hidden indices, inset IDs and zero alpha', () => {
  const hud = new HudOverlay(makeUniforms());
  try {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 33 }), fc.integer({ min: 1, max: 17 }),
      fc.uint8Array({ minLength: 4, maxLength: 128 }),
      (width, height, seed) => {
        const win = new VfxWindow(); vfxWindowAllocate(win, width, height);
        const want = new Uint8Array(width * height * 4);
        let sumX = 0, sumY = 0, reticles = 0;
        for (let i = 0; i < width * height; i++) {
          win.buffer[i] = seed[i % seed.length]!;
          win.drawn[i] = seed[(i + 1) % seed.length]! & 1;
          win.layer[i] = seed[(i + 2) % seed.length]! % 3;
          win.inset[i] = seed[(i + 3) % seed.length]! % 5;
          // Independent byte layout, the previous renderer's three byte writes.
          want[i * 4] = win.buffer[i]!;
          want[i * 4 + 1] = win.drawn[i] ? 255 - win.layer[i]! : 0;
          want[i * 4 + 2] = win.inset[i]!;
          if (win.drawn[i] && win.layer[i] === HUD_LAYER.reticle) {
            sumX += i % width; sumY += Math.floor(i / width); reticles++;
          }
        }
        hud.update(win, 2100, 2200);
        expect(hud.windowUniforms.uWindow.value!.image.data).toEqual(want);
        if (reticles) {
          expect(hud.reticleCentre!.x).toBe(sumX / reticles + 0.5);
          expect(hud.reticleCentre!.y).toBe(sumY / reticles + 0.5);
        } else expect(hud.reticleCentre).toBeNull();
      }), { seed: 20261001, numRuns: 100 });
  } finally { hud.dispose(); }
});
