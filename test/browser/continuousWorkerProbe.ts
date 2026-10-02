import * as THREE from 'three';
import { SnapshotConsumer } from '../../src/engine/snapshotMailbox.ts';
import { decodeReferencePacket, ResourcePacketDecoder } from '../../src/render/snapshot/referencePacket.ts';
import { CompactWorldRenderer } from '../../src/render/snapshot/compactWorld.ts';
import { WorldStateRenderer, type WorldPacket } from '../../src/render/snapshot/worldState.ts';
import { WorkerControlSender } from '../../src/app/workerControls.ts';
import { IDLE_PAD, PadMapper } from '../../src/app/xrPads.ts';
import type { MissionMeta, MissionPacket } from '../../src/app/missionWorker.ts';

/** Sustained offscreen integration probe. Input uses the accepted PadMapper;
 * worker timings, snapshot adoption and draw cadence are separate observations. */
export async function runContinuousWorkerProbe(compact = false, combat = false) {
  const epoch = crypto.randomUUID();
  const worker = new Worker(new URL('../../src/app/missionWorker.ts', import.meta.url), { type: 'module' });
  const mailbox = new SnapshotConsumer<MissionMeta>(epoch, (m, transfer) => worker.postMessage(m, transfer));
  const controls = new WorkerControlSender(epoch, m => worker.postMessage(m));
  const mapper = new PadMapper();
  const renderer = new THREE.WebGLRenderer({ antialias: false }); renderer.setSize(320, 240);
  const target = new THREE.WebGLRenderTarget(320, 240); renderer.setRenderTarget(target);
  let compactRenderer: CompactWorldRenderer | undefined;
  let decoder: ResourcePacketDecoder | undefined, scene: WorldStateRenderer | undefined;
  let loop: ReturnType<typeof setInterval> | undefined, pulse: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const rows: Array<MissionMeta & { decodeMs: number; applyMs: number; at: number }> = [];
  const drawCosts: { syncMs: number; submitMs: number }[] = [];
  let fireSeen = false, fireReleaseSeen = false, combatStarted = false;
  const draws: number[] = [], base = new THREE.Quaternion(), yaw = new THREE.Quaternion();
  let sequence = 0, began = 0, hudPixels = 0, pressSeen = false, releaseSeen = false;
  let stall: { start: number; end: number } | undefined;
  let stopping = false, receivedAfterStop = 0;
  const pad = (held: boolean, fire = false) => {
    const input = mapper.update({ ...IDLE_PAD, ly: held ? -1 : 0, rTrigger: fire ? 1 : 0 });
    controls.push(input.keys, input.torso);
  };
  try {
    return await new Promise((resolve, reject) => {
      deadline = setTimeout(() => reject(Error('Continuous worker timed out')), 120000);
      worker.onerror = e => reject(Error(e.message));
      worker.onmessage = ({ data: m }) => {
        try {
          if (m.epoch !== epoch) return;
          if (m.kind === 'error') throw Error(m.message);
          if (m.kind === 'compact-basis') {
            compactRenderer = new CompactWorldRenderer(decodeReferencePacket(m.bytes) as WorldPacket);
            scene = compactRenderer.scene;
            pulse = setInterval(() => controls.pulse(), 100);
          } else if (m.kind === 'resource-basis') {
            decoder = new ResourcePacketDecoder(epoch, m.bytes);
            pulse = setInterval(() => controls.pulse(), 100);
          } else if (m.kind === 'controls-ack') controls.acknowledge(m.epoch, m.sequence);
          else if (m.kind === 'snapshot') {
            if (stopping) receivedAfterStop++;
            mailbox.receive(m);
          } else if (m.kind === 'resumed') stall = { start: m.start, end: m.end };
          else if (m.kind === 'ended') throw Error('Mission ended before the continuous probe completed');
          else if (m.kind === 'stopped') {
            if (rows.length < 8 || rows.at(-1)!.simTick <= rows[0]!.simTick) throw Error('Simulation did not advance continuously');
            if (!pressSeen || !releaseSeen) throw Error(`Controller throttle did not press/release: ${pressSeen}/${releaseSeen}`);
            if (combat && (!fireSeen || !fireReleaseSeen)) throw Error(`Weapon input did not press/release: ${fireSeen}/${fireReleaseSeen}; status ${[...new Set(rows.map(r => r.playerStatus))]}; projectiles ${Math.max(...rows.map(r => r.playerProjectiles))}`);
            if (combat && !rows.some(r => r.playerProjectiles > 0)) throw Error('No player projectiles observed');
            if (hudPixels < 100) throw Error('Worker HUD is empty');
            const independent = stall ? draws.filter(t => t >= stall!.start && t < stall!.end).length : 0;
            if (independent < 3) throw Error('No independent rendering during worker stall');
            resolve({ kind: 'continuous-mission-worker', compact, combat, fireSeen, fireReleaseSeen, drawCosts, assetStats: compactRenderer?.stats, xr: false, elapsedMs: Date.now() - began,
              snapshots: rows.length, draws: draws.length, hudPixels, pressSeen, releaseSeen,
              stall, drawsDuringStall: independent, stoppedCleanly: true, receivedWhileStopPending: receivedAfterStop,
              rows, note: 'Offscreen continuous AMY_SCN1 with original throttle/fire mapping and copied HUD planes; no audio, 3D HUD insets, shell integration or XR FPS claim.' });
          }
        } catch (error) { reject(error); }
      };
      loop = setInterval(() => {
        try {
          const packet = mailbox.acquire();
          if (packet && packet.sequence !== sequence) {
            sequence = packet.sequence;
            if (packet.meta.weaponFire) fireSeen = true;
            if (fireSeen && !packet.meta.weaponFire) fireReleaseSeen = true;
            const t = performance.now(); let decoded = t, throttlePlus: number, drawn: ArrayLike<number>;
            if (compactRenderer) {
              compactRenderer.apply(new Uint8Array(packet.buffer, 0, packet.meta.bytes));
              throttlePlus = compactRenderer.aux.throttlePlus; drawn = compactRenderer.aux.planes[1]!;
            } else {
              const state = decoder!.decode(new Uint8Array(packet.buffer, 0, packet.meta.bytes)) as MissionPacket;
              decoded = performance.now();
              if (scene) scene.apply(state.world); else scene = new WorldStateRenderer(state.world);
              throttlePlus = state.throttlePlus; drawn = state.hud.drawn.data;
            }
            base.copy(scene!.camera.quaternion);
            rows.push({ ...packet.meta, decodeMs: decoded - t, applyMs: performance.now() - decoded, at: Date.now() });
            let pixels = 0; for (let i = 0; i < drawn.length; i++) if (drawn[i]) pixels++;
            hudPixels = Math.max(hudPixels, pixels);
            if (throttlePlus !== 0) pressSeen = true;
            if (pressSeen && throttlePlus === 0) releaseSeen = true;
            // Cold-starting mechs suppress weapon controls until status 2.
            if (combat && began && !combatStarted && packet.meta.playerStatus === 2 && Date.now() - began > 1500) {
              combatStarted = true; pad(false, true);
              timers.push(setTimeout(() => pad(false), 4500));
            }
            if (!began) {
              began = Date.now(); pad(true);
              timers.push(setTimeout(() => pad(false), 1500));
              timers.push(setTimeout(() => worker.postMessage({ kind: 'stall', epoch, ms: 600 }), 2500));
              timers.push(setTimeout(() => {
                stopping = true; controls.reset(); worker.postMessage({ kind: 'stop', epoch });
              }, combat ? 20000 : 6000));
            }
          }
          if (scene) {
            scene.camera.quaternion.copy(base).multiply(yaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(Date.now() / 1000) * 0.4));
            const begin = performance.now(); scene.sync(scene.camera, 320, 240); const synced = performance.now();
            renderer.clear(); scene.render(renderer);
            drawCosts.push({ syncMs: synced - begin, submitMs: performance.now() - synced }); draws.push(Date.now());
          }
        } catch (error) { reject(error); }
      }, 11);
      worker.postMessage({ kind: 'start', epoch, origin: location.origin, compact });
    });
  } finally {
    clearInterval(loop); clearInterval(pulse); clearTimeout(deadline); timers.forEach(clearTimeout);
    mailbox.close(); worker.terminate(); if (compactRenderer) compactRenderer.dispose(); else scene?.dispose(); target.dispose(); renderer.dispose();
  }
}
