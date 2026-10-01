/** @portOnly Whole scene CPU comparison including JS packing, Wasm calls and output copies. */
import type { SceneRenderer } from '../../src/render/SceneRenderer.ts';
import { viewer } from '../../src/sim/camera/viewer.ts';

export async function runPolygonWasmBenchmark(sr: SceneRenderer) {
  const saved = sr.wasmPolygons;
  const rounds: { referenceMs: number; wasmMs: number }[] = [];
  const repeats = 16;
  try {
    await sr.prepareWasmPolygons();
    sr.wasmStats.meshes = sr.wasmStats.fallback = 0;
    sr.sync(viewer());
    const coverage = { ...sr.wasmStats };
    if (!coverage.meshes) throw Error('No meshes processed in Wasm');
    const measure = (wasm: boolean) => {
      sr.wasmPolygons = wasm;
      const start = performance.now();
      for (let i = 0; i < repeats; i++) sr.sync(viewer());
      return (performance.now() - start) / repeats;
    };
    for (let round = 0; round < 28; round++) {
      const values = (round % 2 ? [true, false] : [false, true]).map(measure);
      if (round >= 8) rounds.push({ referenceMs: values[round % 2]!, wasmMs: values[1 - round % 2]! });
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const mean = (key: keyof typeof rounds[number]) => rounds.reduce((sum, r) => sum + r[key], 0) / rounds.length;
    return { kind: 'whole-scene-sync-with-wasm-bridge', repeats, rounds, coverage,
      referenceMs: mean('referenceMs'), wasmMs: mean('wasmMs'),
      note: 'Frozen scene, all JS packing/calls/result copies included. No GPU, simulation or XR frame timing.' };
  } finally { sr.wasmPolygons = saved; }
}
