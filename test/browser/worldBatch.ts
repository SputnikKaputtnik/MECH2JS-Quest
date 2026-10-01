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

export async function runWorldBatchComparison(variant: 'batch' | 'wasm' = 'batch') {
  const data = await loadGameData(new FetchSource());
  setDosFiles(data.loose);
  seedControlFiles(data.shellExe);
  const game = new Game(data);
  const setup = { pilot: { name: 'BATCH TEST', mech: { config: 'mdg00std', mekId: 62, stream: { id: 29, name: 'maddog' }, tons: 60 } }, starmates: [] };
  if (!game.loadMission('AMY_SCN1', setup)) throw Error(game.loadError ?? 'Mission failed');
  game.setMode('edit');
  game.audio.pause();
  const sr = new SceneRenderer();
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
    for (let phase = 0; phase < 3; phase++) {
      for (let f = 0; f < 40; f++) {
        for (let t = 0; t < 9; t++) ailTimerService();
        mainLoopFrame();
      }
      sr.setPalette(game.paletteRgb()!);
      const luma = game.lumaRows(); if (luma) sr.setLuma(luma);
      game.updateTextures(sr);
      cameraFromViewer(viewer(), camera, 4 / 3);
      origin.copy(camera.position); baseRotation.copy(camera.quaternion);
      for (const yaw of [0, -0.5, 0.5, 1.5, 3]) {
        camera.position.copy(origin);
        camera.position.z += phase * 25;
        camera.quaternion.copy(baseRotation).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
        camera.updateMatrixWorld(true);
        sr.sync(viewerFromCamera(camera, viewer(), passViewer));
        sr.setViewport(640, 480);
        const draw = (batched: boolean, bytes: Uint8Array) => {
          sr.batchWorld = variant === 'wasm' || batched;
          if (variant === 'wasm') { sr.wasmPolygons = batched; sr.sync(viewerFromCamera(camera, viewer(), passViewer)); }
          renderer.setRenderTarget(target);
          renderer.clear(); renderer.info.reset();
          sr.renderWorld(renderer, camera);
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
        rows.push({ phase, yaw, drawn, different, percent: different / (640 * 480) * 100, reference, batched });
      }
    }
    if (!rows.some((r) => r.drawn > 1000)) throw Error('Comparison rendered no visible world');
    // Matrix multiplication moves from CPU doubles to GPU floats. A few pixels
    // along edges/dither thresholds can differ; large differences are a failure.
    if (rows.some((r) => variant === 'wasm' ? r.different !== 0 : r.percent > 0.1)) throw Error(`${variant} image mismatch: ${JSON.stringify(rows)}`);
    if (variant === 'wasm' && sr.wasmStats.meshes === 0) throw Error('Wasm comparison only exercised fallback');
    return rows;
  } finally {
    sr.destroy(); target.dispose(); renderer.dispose(); game.audio.pause();
  }
}
