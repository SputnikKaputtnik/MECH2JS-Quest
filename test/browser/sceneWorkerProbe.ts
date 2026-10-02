import * as THREE from 'three';
import { SnapshotConsumer } from '../../src/engine/snapshotMailbox.ts';
import { ReferenceScene } from '../../src/render/snapshot/referenceScene.ts';
import { WorldStateRenderer } from '../../src/render/snapshot/worldState.ts';

/** Offscreen drawing on the actual device GPU while the worker is CPU-blocked.
 * This is not XR frame pacing or a measurement of production transport cost. */
export async function runSceneWorkerProbe(unculled = false) {
  const worker = new Worker(new URL('./referenceSnapshotWorker.ts', import.meta.url), { type: 'module' });
  const mailbox = new SnapshotConsumer<{ bytes: number; unculled: boolean }>('scene-probe', (m, transfer) => worker.postMessage(m, transfer));
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(320, 240);
  const target = new THREE.WebGLRenderTarget(320, 240);
  let scene: ReferenceScene | WorldStateRenderer | null = null;
  const baseRotation = new THREE.Quaternion();
  const yaw = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let timer: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const draws: number[] = [];
  let bytes = 0, visiblePixels = 0;
  try {
    return await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(Error('Scene worker timed out')), 120000);
      worker.onerror = event => reject(Error(event.message));
      worker.onmessage = event => {
        const m = event.data;
        try {
          if (m.kind === 'error') throw Error(m.message);
          if (m.kind === 'snapshot') {
            mailbox.receive(m);
            const packet = mailbox.acquire()!;
            bytes = packet.meta.bytes;
            scene = packet.meta.unculled ? new WorldStateRenderer(new Uint8Array(packet.buffer, 0, bytes))
              : new ReferenceScene(new Uint8Array(packet.buffer, 0, bytes));
            baseRotation.copy(scene.camera.quaternion);
            mailbox.close(); // recycle immediately: renderer must own all pixels/vertices
            if (scene instanceof WorldStateRenderer) scene.sync(scene.camera, 320, 240);
            renderer.setRenderTarget(target); renderer.clear(); scene.render(renderer);
            const pixels = new Uint8Array(320 * 240 * 4);
            renderer.readRenderTargetPixels(target, 0, 0, 320, 240, pixels);
            for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 0) visiblePixels++;
            if (visiblePixels < 1000) throw Error('Worker snapshot rendered no visible scene');
          } else if (m.kind === 'source-disposed') worker.postMessage({ kind: 'stall' });
          else if (m.kind === 'stalled') {
            timer = setInterval(() => {
              try {
                if (scene instanceof WorldStateRenderer) {
                  scene.camera.quaternion.copy(baseRotation).multiply(yaw.setFromAxisAngle(up, (Date.now() - m.start) / 600 * Math.PI * 2));
                  scene.sync(scene.camera, 320, 240);
                }
                renderer.clear(); scene!.render(renderer);
                draws.push(Date.now());
              } catch (error) { reject(error); }
            }, 10);
          } else if (m.kind === 'resumed') {
            clearInterval(timer);
            const during = draws.filter(t => t >= m.start && t < m.end);
            if (during.length < 3) throw Error(`No independent drawing during stall: ${during.length}`);
            resolve({ kind: 'offscreen-worker-scene', xr: false, unculled, snapshotBytes: bytes, visiblePixels,
              producerStallMs: m.end - m.start, consumerDrawsDuringStall: during.length,
              sourceDisposedBeforeStall: true, note: unculled ? 'Consumer rotates through a full turn during the worker stall; offscreen submissions, not XR/display FPS.'
                : 'Fixed-view reference scene; no head-turn completeness, gameplay, XR or FPS claim.' });
          }
        } catch (error) { reject(error); }
      };
      worker.postMessage({ kind: 'init', origin: location.origin, unculled });
    });
  } finally {
    clearTimeout(timeout); clearInterval(timer);
    mailbox.close(); worker.terminate(); (scene as ReferenceScene | WorldStateRenderer | null)?.dispose(); target.dispose(); renderer.dispose();
  }
}
