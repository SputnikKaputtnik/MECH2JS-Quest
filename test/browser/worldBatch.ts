/** Manual WebGL regression: run runWorldBatchComparison() through the Vite dev
 * server in a separate browser context with MW2_ROOT configured. No player saves.
 * Reads back reference and batched draws of exactly the same frozen mission. */
import * as THREE from 'three';
import { loadGameData } from '../../src/app/gameData.ts';
import { FetchSource } from '../../src/app/fetchSource.ts';
import { Game } from '../../src/app/Game.ts';
import { SceneRenderer } from '../../src/render/SceneRenderer.ts';
import { cameraFromViewer } from '../../src/render/bridge/cameraViewer.ts';
import { viewer } from '../../src/sim/camera/viewer.ts';
import { viewerFromCamera } from '../../src/render/bridge/cameraViewer.ts';
import { Viewer } from '../../src/generated/classes.gen.ts';
import { ailTimerService } from '../../src/engine/miles/ail.ts';
import { mainLoopFrame } from '../../src/mission/mainLoop.ts';
import { seedControlFiles } from '../../src/shell/controls/seed.ts';
import { setDosFiles } from '../../src/engine/dosFiles.ts';
import { GroundField } from '../../src/render/enhance/groundField.ts';
import { renderOptions } from '../../src/sim/display/renderState.ts';
import { scrounge } from '../../src/sim/world/scrounge.ts';
import { runScroungeSubmissionBenchmark } from './scroungeBenchmark.ts';

export async function runWorldBatchComparison(variant: 'batch' | 'wasm' | 'scrounge' = 'batch') {
  const data = await loadGameData(new FetchSource());
  setDosFiles(data.loose);
  seedControlFiles(data.shellExe);
  const game = new Game(data);
  const setup = { pilot: { name: 'BATCH TEST', mech: { config: 'mdg00std', mekId: 62, stream: { id: 29, name: 'maddog' }, tons: 60 } }, starmates: [] };
  if (!game.loadMission(variant === 'scrounge' ? 'GOATSCN1' : 'AMY_SCN1', setup)) throw Error(game.loadError ?? 'Mission failed');
  game.setMode('edit');
  game.audio.pause();
  const sr = new SceneRenderer();
  const ground = new GroundField(sr.uniforms);
  if (variant === 'scrounge') sr.scene.add(ground.field);
  const previousWireframe = renderOptions.wireframeMode;
  if (variant === 'wasm') { await sr.prepareWasmPolygons(); sr.wasmPolygons = false; }
  game.bindTextures(sr);
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(640, 480);
  const target = new THREE.WebGLRenderTarget(640, 480);
  const camera = new THREE.PerspectiveCamera();
  const origin = new THREE.Vector3();
  const baseRotation = new THREE.Quaternion();
  const passViewer = new Viewer();
  const rows = [];
  const a = new Uint8Array(640 * 480 * 4), b = a.slice();
  try {
    for (let phase = 0; phase < (variant === 'scrounge' ? 6 : 3); phase++) {
      if (variant === 'scrounge') renderOptions.wireframeMode = [0, 0, 1, 0, 2, 0][phase]!;
      for (let f = 0; f < 40; f++) {
        for (let t = 0; t < 9; t++) ailTimerService();
        mainLoopFrame();
      }
      sr.setPalette(game.paletteRgb()!);
      const luma = game.lumaRows(); if (luma) sr.setLuma(luma);
      game.updateTextures(sr);
      cameraFromViewer(viewer(), camera, 4 / 3);
      origin.copy(camera.position); baseRotation.copy(camera.quaternion);
      for (const yaw of [0, -0.5, 0.5, 1.5, 3]) for (const eye of variant === 'scrounge' ? [-0.032, 0.032, 'stereo'] : [0]) {
        camera.position.copy(origin);
        camera.position.z += phase * 25;
        camera.quaternion.copy(baseRotation).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
        if (typeof eye === 'number') camera.position.add(new THREE.Vector3(eye, 0, 0).applyQuaternion(camera.quaternion));
        camera.updateMatrixWorld(true);
        let drawCamera: THREE.Camera = camera;
        if (eye === 'stereo') {
          const eyes = [-0.032, 0.032].map((shift, i) => {
            const c = camera.clone(); c.aspect = 320 / 480; c.updateProjectionMatrix();
            c.position.add(new THREE.Vector3(shift, 0, 0).applyQuaternion(c.quaternion)); c.updateMatrixWorld(true);
            return Object.assign(c, { viewport: new THREE.Vector4(i * 320, 0, 320, 480) });
          });
          const stereo = new THREE.ArrayCamera(eyes);
          stereo.position.copy(camera.position); stereo.quaternion.copy(camera.quaternion); stereo.updateMatrixWorld(true);
          stereo.projectionMatrix.copy(camera.projectionMatrix); drawCamera = stereo;
        }
        sr.sync(viewerFromCamera(camera, viewer(), passViewer));
        sr.setViewport(640, 480);
        const draw = (batched: boolean, bytes: Uint8Array) => {
          sr.batchWorld = variant !== 'batch' || batched;
          if (variant === 'wasm') { sr.wasmPolygons = batched; sr.sync(viewerFromCamera(camera, viewer(), passViewer)); }
          if (variant === 'scrounge') { ground.batchCopies = batched; ground.updateField(sr, true); }
          renderer.setRenderTarget(target);
          renderer.clear(); renderer.info.reset();
          sr.renderWorld(renderer, drawCamera);
          const calls = renderer.info.render.calls, triangles = renderer.info.render.triangles;
          renderer.readRenderTargetPixels(target, 0, 0, 640, 480, bytes);
          return { calls, triangles };
        };
        const reference = draw(false, a), batched = draw(true, b);
        let different = 0, drawn = 0;
        for (let p = 0; p < a.length; p += 4) {
          if (a[p]! + a[p + 1]! + a[p + 2]! > 0) drawn++;
          if (a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2] || a[p + 3] !== b[p + 3]) different++;
        }
        const submission = variant === 'scrounge' && phase === 0 && yaw === 0 && eye === 'stereo'
          ? runScroungeSubmissionBenchmark(sr, ground, renderer, drawCamera as THREE.ArrayCamera) : undefined;
        rows.push({ phase, yaw, eye, drawn, different, percent: different / (640 * 480) * 100, reference, batched, submission });
      }
    }
    if (!rows.some((r) => r.drawn > 1000)) throw Error('Comparison rendered no visible world');
    // Matrix multiplication moves from CPU doubles to GPU floats. A few pixels
    // along edges/dither thresholds can differ; large differences are a failure.
    const failures = rows.filter(r => variant === 'wasm' ? r.different !== 0 : r.percent > 0.1);
    if (failures.length) throw Error(`${variant} image mismatch: ${JSON.stringify(failures)}`);
    if (variant === 'wasm' && sr.wasmStats.meshes === 0) throw Error('Wasm comparison only exercised fallback');
    if (variant === 'scrounge' && !rows.some(r => r.batched.calls < r.reference.calls)) throw Error(`Scrounge batching did not reduce submissions: ${JSON.stringify({active: scrounge.scroungeActive, children: ground.field.children.length, rows: rows.slice(0, 4)})}`);
    return rows;
  } finally {
    renderOptions.wireframeMode = previousWireframe;
    ground.dispose(); sr.destroy(); target.dispose(); renderer.dispose(); game.audio.pause();
  }
}
