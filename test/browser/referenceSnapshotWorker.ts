/** Development-only producer. Real engine and CPU scene extraction, no WebGL,
 * audio, player saves or main-thread Game instance. Full/resource reference codecs. */
import * as THREE from 'three';
import { loadGameData } from '../../src/app/gameData.ts';
import { FetchSource } from '../../src/app/fetchSource.ts';
import { seedControlFiles } from '../../src/shell/controls/seed.ts';
import { setDosFiles } from '../../src/engine/dosFiles.ts';
import { prepareDevMission } from '../../src/shell/devLaunch.ts';
import { bootMission } from '../../src/mission/load.ts';
import { ailTimerService } from '../../src/engine/miles/ail.ts';
import { mainLoopFrame } from '../../src/mission/mainLoop.ts';
import { SceneRenderer } from '../../src/render/SceneRenderer.ts';
import { BitmapAtlas } from '../../src/render/textures/bitmapAtlas.ts';
import { cameraFromViewer } from '../../src/render/bridge/cameraViewer.ts';
import { viewer } from '../../src/sim/camera/viewer.ts';
import { palettes } from '../../src/sim/world/palettes.ts';
import { lighting } from '../../src/sim/world/environment.ts';
import { cacheLoadResource } from '../../src/engine/resources/cache.ts';
import { parseLuma } from '../../src/data/formats/image.ts';
import { encodeReferenceScene } from '../../src/render/snapshot/referenceScene.ts';
import { captureWorldState, encodeWorldState } from '../../src/render/snapshot/worldState.ts';
import { encodeReferencePacket, ResourcePacketEncoder } from '../../src/render/snapshot/referencePacket.ts';
import { SnapshotProducer, type SnapshotRelease } from '../../src/engine/snapshotMailbox.ts';

// Structural worker port avoids mixing lib.dom/lib.webworker declarations.
const port = globalThis as unknown as { postMessage(m: unknown, transfers?: ArrayBuffer[]): void; onmessage: ((event: MessageEvent) => void) | null };
let producer: SnapshotProducer<{ bytes: number; unculled: boolean; resources: boolean; final: boolean; fullBytes: number }> | null = null;
async function init(origin: string, unculled: boolean, resources: boolean) {
  const data = await loadGameData(new FetchSource(`${origin}/mw2/`));
  setDosFiles(data.loose); seedControlFiles(data.shellExe);
  const argv = prepareDevMission({ shellExe: data.shellExe, prj: data.prj, stream: 'AMY_SCN1', insignia: false, userStar: null });
  if (!bootMission({ exe: data.exe, prj: data.prj, ini: data.ini, argv })) throw Error('Worker mission boot failed');
  for (let frame = 0; frame < 40; frame++) {
    for (let tick = 0; tick < 9; tick++) ailTimerService();
    mainLoopFrame();
  }
  const sr = new SceneRenderer();
  try {
    // Keep the atlas and its slot table together for animated CEL selection.
    const atlas = new BitmapAtlas(); atlas.build(sr.uniforms); atlas.updateSlots(sr.uniforms);
    sr.setPalette(palettes.dac);
    const luma = cacheLoadResource(lighting.lumaTableId, 'LUMA');
    if (luma) sr.setLuma(parseLuma(luma).rows);
    const camera = new THREE.PerspectiveCamera(); cameraFromViewer(viewer(), camera, 4 / 3);
    sr.sync(viewer()); sr.setViewport(320, 240);
    const bytes = unculled ? encodeWorldState(viewer(), sr.uniforms)
      : encodeReferenceScene({ backdrop: sr.backdropScene, world: sr.scene, cockpit: sr.cockpitScene, camera });
    const frames = [{ bytes, fullBytes: bytes.length }];
    if (resources) {
      const encoder = new ResourcePacketEncoder('scene-probe', captureWorldState(viewer(), sr.uniforms));
      port.postMessage({ kind: 'resource-basis', bytes: encoder.initial }, [encoder.initial.buffer as ArrayBuffer]);
      frames.length = 0;
      for (let frame = 0; frame < 3; frame++) {
        for (let tick = 0; tick < 9; tick++) ailTimerService();
        mainLoopFrame(); atlas.updateSlots(sr.uniforms); sr.setPalette(palettes.dac);
        const state = captureWorldState(viewer(), sr.uniforms);
        frames.push({ bytes: encoder.encode(state), fullBytes: encodeReferencePacket(state).length });
      }
    }
    producer = new SnapshotProducer('scene-probe', Math.max(...frames.map(f => f.bytes.length)), (message, transfer) => port.postMessage(message, transfer));
    frames.forEach((frame, i) => {
      if (!producer!.publish({ bytes: frame.bytes.length, unculled, resources, final: i === frames.length - 1, fullBytes: frame.fullBytes }, buffer => new Uint8Array(buffer).set(frame.bytes))) {
        throw Error('Fixture exhausted the three transport slots');
      }
    });
  } finally { sr.destroy(); }
  // Source resources no longer exist before the consumer draws its first frame.
  port.postMessage({ kind: 'source-disposed' });
}
port.onmessage = event => {
  const message = event.data as SnapshotRelease | { kind: 'init'; origin: string; unculled: boolean; resources: boolean } | { kind: 'stall' };
  if (message.kind === 'snapshot-release') producer?.release(message);
  else if (message.kind === 'init') void init(message.origin, message.unculled, message.resources).catch(error => port.postMessage({ kind: 'error', message: String(error.stack ?? error) }));
  else {
    const start = Date.now();
    port.postMessage({ kind: 'stalled', start });
    while (Date.now() - start < 600) { /* deliberately block the producer */ }
    port.postMessage({ kind: 'resumed', start, end: Date.now() });
  }
};
