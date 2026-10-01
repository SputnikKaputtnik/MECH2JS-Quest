/** @portOnly Alternating CPU comparison on real mission polygons. Not XR FPS. */
import { loadGameData } from '../../src/app/gameData.ts';
import { FetchSource } from '../../src/app/fetchSource.ts';
import { Game } from '../../src/app/Game.ts';
import { SceneRenderer } from '../../src/render/SceneRenderer.ts';
import { viewer } from '../../src/sim/camera/viewer.ts';
import { ailTimerService } from '../../src/engine/miles/ail.ts';
import { mainLoopFrame } from '../../src/mission/mainLoop.ts';
import { seedControlFiles } from '../../src/shell/controls/seed.ts';
import { setDosFiles } from '../../src/engine/dosFiles.ts';
import { objectsOnList, worldRootNode } from '../../src/engine/scene/objectLists.ts';
import { latchLight, polyLightIntensity } from '../../src/render/shading/polygonColour.ts';
import { referencePolyLight } from '../reference/polyLight.ts';
import { renderView } from '../../src/render/pipeline/viewLatch.ts';
import { runCullBenchmark, type CullInput } from './cullBenchmark.ts';
import { runMatrixBenchmark } from './matrixBenchmark.ts';
import { runBatchCpuBenchmark } from './batchCpuBenchmark.ts';
import { runDepthBenchmark } from './depthBenchmark.ts';

export async function runLightingBenchmark() {
  const data = await loadGameData(new FetchSource());
  setDosFiles(data.loose); seedControlFiles(data.shellExe);
  const game = new Game(data);
  const sr = new SceneRenderer();
  try {
    if (!game.loadMission('AMY_SCN1', { pilot: { name: 'LIGHT TEST', mech: { config: 'mdg00std', mekId: 62, stream: { id: 29, name: 'maddog' }, tons: 60 } }, starmates: [] })) throw Error(game.loadError ?? 'Mission failed');
    game.setMode('edit'); game.audio.pause();
    for (let f = 0; f < 40; f++) {
      for (let t = 0; t < 9; t++) ailTimerService();
      mainLoopFrame();
    }
    sr.sync(viewer());
    const light = latchLight(viewer());
    const meshes = [...objectsOnList(worldRootNode)].filter(o => sr.entryOf(o)?.group.visible).flatMap(o => o.currentMesh ? [o.currentMesh] : []);
    const polygons = meshes.flatMap(mesh => mesh.polygons.slice(0, mesh.polygonCount).map(poly => ({ poly, vertices: mesh.vertices })));
    if (polygons.length < 100) throw Error('Not enough mission polygons for a meaningful sample');
    for (const { poly, vertices } of polygons) {
      if (polyLightIntensity(poly, vertices, light) !== referencePolyLight(poly, vertices, light)) throw Error('Light intensity differs from reference');
    }
    const rounds: { referenceMs: number; optimizedMs: number }[] = [];
    const repeats = 16;
    const measure = (fn: typeof polyLightIntensity) => {
      let checksum = 0;
      const start = performance.now();
      for (let n = 0; n < repeats; n++) for (const { poly, vertices } of polygons) checksum += fn(poly, vertices, light);
      return { ms: (performance.now() - start) / repeats, checksum };
    };
    for (let n = 0; n < 28; n++) {
      const pair = n % 2 ? [polyLightIntensity, referencePolyLight] : [referencePolyLight, polyLightIntensity];
      const values = pair.map(measure);
      if (values[0]!.checksum !== values[1]!.checksum) throw Error('Benchmark checksum differs');
      if (n >= 8) rounds.push({ referenceMs: values[n % 2]!.ms, optimizedMs: values[1 - n % 2]!.ms });
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const mean = (key: keyof typeof rounds[number]) => rounds.reduce((sum, r) => sum + r[key], 0) / rounds.length;
    const culling = await runCullBenchmark(polygons.filter(({ poly }) => poly.vertexCount >= 3).map(({ poly, vertices }): CullInput => {
      const v = vertices[poly.indices[0]!]!;
      return [(v.worldX - renderView.viewTranslationX) | 0, poly.normalX,
        (v.worldY - renderView.viewTranslationY) | 0, poly.normalY,
        (v.worldZ - renderView.viewTranslationZ) | 0, poly.normalZ];
    }));
    const depth = await runDepthBenchmark(meshes.flatMap(mesh => mesh.vertices.slice(0, mesh.vertexCount).map((v): CullInput => [
      renderView.viewDepthRowY, (v.worldY - renderView.viewTranslationY) | 0,
      renderView.viewDepthRowX, (v.worldX - renderView.viewTranslationX) | 0,
      renderView.viewDepthRowZ, (v.worldZ - renderView.viewTranslationZ) | 0,
    ])));
    const matrices = await runMatrixBenchmark(sr);
    const batching = await runBatchCpuBenchmark(sr);
    return { kind: 'isolated-lighting-cpu', polygons: polygons.length, repeats, light, rounds, culling, depth, matrices, batching, referenceMs: mean('referenceMs'), optimizedMs: mean('optimizedMs'), mismatches: 0, note: 'Milliseconds per complete polygon set, not per XR frame. Off-head power state can affect absolute timings.' };
  } finally { sr.destroy(); game.audio.pause(); }
}
