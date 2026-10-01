import { readFileSync } from 'node:fs';
import { beforeAll, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { HudOverlay } from '../../src/render/passes/hudOverlay.ts';
import { makeUniforms } from '../../src/render/materials/indexedMaterial.ts';
import { loadHudKernel } from '../../src/render/wasm/hudKernel.ts';
import { VfxWindow, vfxWindowAllocate } from '../../src/engine/vfx/vfx.ts';
beforeAll(async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array(readFileSync('src/render/wasm/hud.wasm'))));
  try { await loadHudKernel(); } finally { fetch.mockRestore(); }
});
it('preserves all HUD bytes, crop bounds, empty layers, centroid and cached upload behavior', () => {
  const js = new HudOverlay(makeUniforms()), wasm = new HudOverlay(makeUniforms());
  wasm.wasmPacking = true;
  try {
    fc.assert(fc.property(fc.integer({ min: 1, max: 130 }), fc.integer({ min: 1, max: 65 }),
      fc.uint8Array({ minLength: 4, maxLength: 97 }), (w, h, seed) => {
        const win = new VfxWindow(); vfxWindowAllocate(win, w, h);
        const want = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          win.buffer[i] = seed[i % seed.length]!; win.drawn[i] = seed[(i + 1) % seed.length]!;
          win.layer[i] = seed[(i + 2) % seed.length]! % 3; win.inset[i] = seed[(i + 3) % seed.length]!;
          want[i * 4] = win.buffer[i]!; want[i * 4 + 1] = win.drawn[i] ? 255 - win.layer[i]! : 0;
          want[i * 4 + 2] = win.inset[i]!;
        }
        js.update(win, 2100, 2200); wasm.update(win, 2100, 2200);
        expect(wasm.windowUniforms.uWindow.value!.image.data).toEqual(want);
        expect(wasm.reticleCentre).toEqual(js.reticleCentre);
        expect(wasm.layerCoverage).toEqual(js.layerCoverage);
        expect(wasm.reticleMesh.material.uniforms.uBounds!.value).toEqual(js.reticleMesh.material.uniforms.uBounds!.value);
        expect(wasm.markerMesh.material.uniforms.uBounds!.value).toEqual(js.markerMesh.material.uniforms.uBounds!.value);
        const version = wasm.windowUniforms.uWindow.value!.version;
        wasm.update(win, 1000, 1000, false);
        expect(wasm.windowUniforms.uWindow.value!.version).toBe(version);
      }), { seed: 640480, numRuns: 150 });
  } finally { js.dispose(); wasm.dispose(); }
});
it('handles the capacity boundary and falls back for larger or incomplete planes without stale pixels', async () => {
  const kernel = await loadHudKernel();
  const win = new VfxWindow(); vfxWindowAllocate(win, 1024, 1024);
  win.buffer.fill(123); win.drawn.fill(1); win.layer.fill(1); win.inset.fill(4);
  const out = new Uint8Array(1024 * 1024 * 4);
  const r = kernel.pack(win, 1024, 1024, out)!;
  expect(r[2]).toBe(1048576); expect(r[0]! / r[2]!).toBe(511.5); expect(r[1]! / r[2]!).toBe(511.5);
  expect([...out.slice(-4)]).toEqual([123, 254, 4, 0]);
  expect(kernel.pack(win, 1025, 1024, out)).toBeNull();
  const js = new HudOverlay(makeUniforms()), wasm = new HudOverlay(makeUniforms()); wasm.wasmPacking = true;
  try {
    vfxWindowAllocate(win, 9, 3); win.inset = new Uint8Array(0);
    win.buffer.fill(255); win.drawn.fill(1); win.layer.fill(2);
    js.update(win, 100, 100); wasm.update(win, 100, 100);
    expect(wasm.windowUniforms.uWindow.value!.image.data).toEqual(js.windowUniforms.uWindow.value!.image.data);
    expect(wasm.layerCoverage).toEqual(js.layerCoverage);
  } finally { js.dispose(); wasm.dispose(); }
});
