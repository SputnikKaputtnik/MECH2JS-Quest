/** @portOnly CPU-only world submission comparison; the draw callback does no GPU work. */
import * as THREE from 'three';
import { WorldBatch } from '../../src/render/WorldBatch.ts';
import { WorldBatch as ReferenceBatch } from '../reference/worldBatch.ts';
import type { SceneRenderer } from '../../src/render/SceneRenderer.ts';

export async function runBatchCpuBenchmark(sr: SceneRenderer) {
  const sources: Array<THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>> = [];
  sr.scene.traverse(o => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial && o.parent?.parent === sr.scene) sources.push(o);
  });
  const eligible = sources.filter(s => s.material.depthWrite && !s.material.transparent && !s.geometry.index && s.renderOrder === 0).length;
  if (eligible < 10) throw Error('Insufficient world batch sources');
  const reference = new ReferenceBatch(), current = new WorldBatch();
  const draw = () => {};
  const masks = sources.map(s => s.layers.mask);
  const rounds: { referenceMs: number; optimizedMs: number }[] = [];
  const repeats = 64;
  const measure = (batch: WorldBatch | ReferenceBatch) => {
    const start = performance.now();
    for (let i = 0; i < repeats; i++) batch.render(sr.scene, sources, draw);
    return (performance.now() - start) / repeats;
  };
  try {
    for (let round = 0; round < 28; round++) {
      const order = round % 2 ? [current, reference] : [reference, current];
      const values = order.map(measure);
      if (sources.some((s, i) => s.layers.mask !== masks[i])) throw Error('Source layers were not restored');
      if (round >= 8) rounds.push({ referenceMs: values[round % 2]!, optimizedMs: values[1 - round % 2]! });
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const mean = (key: keyof typeof rounds[number]) => rounds.reduce((sum, r) => sum + r[key], 0) / rounds.length;
    return { kind: 'isolated-world-batch-cpu', sources: sources.length, eligible, repeats, rounds,
      referenceMs: mean('referenceMs'), optimizedMs: mean('optimizedMs'),
      avoidedSuppressionArraysPerCall: eligible + 1,
      note: 'CPU batch preparation/restoration only. Array count follows the removed tuple allocations, not heap profiling; no GC-pause or XR-FPS claim.' };
  } finally { reference.dispose(); current.dispose(); }
}
