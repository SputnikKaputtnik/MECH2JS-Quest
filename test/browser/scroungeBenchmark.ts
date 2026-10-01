/** @portOnly Frozen stereo submission comparison. No simulation, compositor or
 * hardware GPU timer is measured. gl.finish bounds the queued work per round. */
import * as THREE from 'three';
import type { SceneRenderer } from '../../src/render/SceneRenderer.ts';
import type { GroundField } from '../../src/render/enhance/groundField.ts';

export function runScroungeSubmissionBenchmark(sr: SceneRenderer, ground: GroundField,
  renderer: THREE.WebGLRenderer, sourceCamera: THREE.ArrayCamera) {
  const target = new THREE.WebGLRenderTarget(4200, 2200);
  const camera = new THREE.ArrayCamera();
  camera.copy(sourceCamera, false); camera.cameras = sourceCamera.cameras.map((source, i) => {
    const eye = source.clone(); eye.viewport = new THREE.Vector4(i * 2100, 0, 2100, 2200); return eye;
  });
  const oldTarget = renderer.getRenderTarget(), oldBatch = ground.batchCopies;
  const gl = renderer.getContext(), repetitions = 8;
  const rounds: { enabled: boolean; submissionMs: number; synchronizedWallMs: number; calls: number; triangles: number }[] = [];
  try {
    renderer.setRenderTarget(target); sr.setViewport(4200, 2200);
    for (let round = -8; round < 20; round++) {
      for (const enabled of round % 2 === 0 ? [false, true] : [true, false]) {
        ground.batchCopies = enabled; ground.updateField(sr, true);
        renderer.clear(); sr.renderWorld(renderer, camera); gl.finish();
        let submissionMs = 0;
        const begin = performance.now();
        for (let repeat = 0; repeat < repetitions; repeat++) {
          const start = performance.now();
          ground.updateField(sr, true); renderer.clear(); sr.renderWorld(renderer, camera);
          submissionMs += performance.now() - start;
        }
        gl.finish();
        if (round >= 0) rounds.push({ enabled, submissionMs: submissionMs / repetitions,
          synchronizedWallMs: (performance.now() - begin) / repetitions,
          calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
      }
    }
    const average = (enabled: boolean, key: 'submissionMs' | 'synchronizedWallMs') => {
      const rows = rounds.filter(r => r.enabled === enabled);
      return rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
    };
    return { kind: 'frozen-offscreen-stereo-submission', width: 4200, height: 2200, repetitions,
      referenceMs: { submission: average(false, 'submissionMs'), synchronizedWall: average(false, 'synchronizedWallMs') },
      batchedMs: { submission: average(true, 'submissionMs'), synchronizedWall: average(true, 'synchronizedWallMs') }, rounds,
      note: 'CPU submission includes GroundField update and browser back-pressure. Synchronized wall time is not a hardware GPU duration or XR frame time.' };
  } finally {
    ground.batchCopies = oldBatch; ground.updateField(sr, true);
    renderer.setRenderTarget(oldTarget); sr.setViewport(640, 480); target.dispose();
  }
}
