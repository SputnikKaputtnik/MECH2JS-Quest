/** @portOnly Whole scene sync and matrix propagation on a frozen mission; no GPU/XR timing. */
import * as THREE from 'three';
import type { SceneRenderer } from '../../src/render/SceneRenderer.ts';
import { viewer } from '../../src/sim/camera/viewer.ts';

export async function runMatrixBenchmark(sr: SceneRenderer) {
  const scenes = [sr.scene, sr.backdropScene, sr.cockpitScene];
  const saved = sr.reuseWorldMatrices;
  const sync = () => { sr.sync(viewer()); for (const scene of scenes) scene.updateMatrixWorld(); };
  const snapshot = () => {
    const out: number[] = [];
    for (const scene of scenes) scene.traverse(o => out.push(...o.matrixWorld.elements));
    return out;
  };
  try {
    for (const x of [0, 12, -37, 0]) {
      sr.scene.matrix.makeTranslation(x, 3, -7); sr.scene.matrixWorldNeedsUpdate = true;
      sr.reuseWorldMatrices = false; sync(); const reference = snapshot();
      sr.scene.matrixWorldNeedsUpdate = true;
      sr.reuseWorldMatrices = true; sync(); const current = snapshot();
      if (reference.length !== current.length || reference.some((v, i) => v !== current[i])) throw Error('World matrices changed');
    }
    sr.scene.matrix.identity(); sr.scene.matrixWorldNeedsUpdate = true; sync();
    const products = (reuse: boolean) => {
      let count = 0;
      const original = THREE.Matrix4.prototype.multiplyMatrices;
      THREE.Matrix4.prototype.multiplyMatrices = function (a, b) { count++; return original.call(this, a, b); };
      try { sr.reuseWorldMatrices = reuse; sync(); return count; }
      finally { THREE.Matrix4.prototype.multiplyMatrices = original; }
    };
    const referenceProducts = products(false), optimizedProducts = products(true);
    const rounds: { referenceMs: number; optimizedMs: number }[] = [];
    const repeats = 16;
    const measure = (reuse: boolean) => {
      sr.reuseWorldMatrices = reuse;
      const start = performance.now();
      for (let i = 0; i < repeats; i++) sync();
      return (performance.now() - start) / repeats;
    };
    for (let round = 0; round < 20; round++) {
      const order = round % 2 ? [true, false] : [false, true];
      const values = order.map(measure);
      if (round >= 6) rounds.push({ referenceMs: values[round % 2]!, optimizedMs: values[1 - round % 2]! });
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const mean = (key: keyof typeof rounds[number]) => rounds.reduce((sum, r) => sum + r[key], 0) / rounds.length;
    return { kind: 'frozen-scene-sync-cpu', repeats, rounds, referenceProducts, optimizedProducts,
      referenceMs: mean('referenceMs'), optimizedMs: mean('optimizedMs'), mismatches: 0,
      note: 'Full SceneRenderer.sync plus matrix propagation, with frozen simulation. Excludes GPU, XR and moving-object costs.' };
  } finally { sr.reuseWorldMatrices = saved; }
}
