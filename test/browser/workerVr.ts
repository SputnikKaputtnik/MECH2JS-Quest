/** Visible, opt-in native-runtime experiment. Normal gameplay remains unchanged.
 * Worker owns the mission; XR renders the latest owned scene with fresh head pose.
 * No audio, physical cockpit controls, 3D inset capture, saves or shell handoff. */
import * as THREE from 'three';
import { XrHost } from '../../src/app/xrHost.ts';
import { XrRig } from '../../src/render/xr/xrRig.ts';
import { XrSky } from '../../src/render/xr/xrSky.ts';
import { HudOverlay } from '../../src/render/passes/hudOverlay.ts';
import { FpsOverlay } from '../../src/render/xr/fpsOverlay.ts';
import { QuestPerf } from '../../src/app/questPerf.ts';
import { readPads } from '../../src/app/xrInput.ts';
import { PadMapper } from '../../src/app/xrPads.ts';
import { WorkerControlSender } from '../../src/app/workerControls.ts';
import { SnapshotConsumer } from '../../src/engine/snapshotMailbox.ts';
import { CompactWorldRenderer } from '../../src/render/snapshot/compactWorld.ts';
import { decodeReferencePacket } from '../../src/render/snapshot/referencePacket.ts';
import type { WorldPacket } from '../../src/render/snapshot/worldState.ts';
import type { MissionMeta } from '../../src/app/missionWorker.ts';
import { EndPanelInput, RESTART_RECT } from './workerVrEndPanel.ts';
import { VfxWindow } from '../../src/engine/vfx/vfx.ts';

const status = document.querySelector<HTMLElement>('#status')!;
const enter = document.querySelector<HTMLButtonElement>('#enter')!;
const host = new XrHost(), renderer = host.renderer;
renderer.info.autoReset = false;
renderer.setSize(innerWidth, innerHeight); document.body.append(renderer.domElement);
const rig = new XrRig(), fps = new FpsOverlay();
let perf = new QuestPerf();
const headCamera = new THREE.PerspectiveCamera(), scale = new THREE.Vector3(), carry = new THREE.Matrix4();
let epoch = '';
let worker: Worker, mailbox: SnapshotConsumer<MissionMeta>, controls: WorkerControlSender;
const endInput = new EndPanelInput();
let endMessage = '', hovered = false, sessionWasOn = false, sessionEntries = 0;
const mapper = new PadMapper(), hudWindow = new VfxWindow();
let consumer: CompactWorldRenderer | undefined, hud: HudOverlay | undefined, sky: XrSky | undefined;
let sequence = 0, meta: MissionMeta | undefined, running = true, ready = false, visible = false, lastPulse = 0;
let lastAdoption = 0, firstFrame = 0, lastStatus = 0;
const adoptions: { at: number; ms: number; hudMs: number; worker: MissionMeta }[] = [];
const events: object[] = [];
const screen = document.createElement('canvas'); screen.width = 640; screen.height = 480;
const context = screen.getContext('2d')!;
function message(text: string) {
  status.textContent = text;
  context.fillStyle = '#101c1a'; context.fillRect(0, 0, 640, 480);
  context.fillStyle = '#bfe3cf'; context.font = '24px sans-serif';
  text.split('\n').forEach((line, i) => context.fillText(line, 24, 100 + i * 42));
}
host.showScreen(screen);
function pause(value: boolean) {
  if (!consumer || !controls) return;
  mapper.reset(); controls.reset();
  if (running) worker.postMessage({ kind: 'pause', epoch, paused: value });
}
function finish(text: string) {
  if (!running) return;
  running = false; pause(true); worker.postMessage({ kind: 'stop', epoch });
  mailbox.close(); perf.finish(); host.present(null); host.showScreen(screen);
  worker.terminate(); enter.disabled = false; endMessage = text; endInput.reset(); drawEndPanel(false);
}
function fail(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  events.push({ kind: 'error', at: Date.now(), message: text });
  console.error('[worker-vr]', error); finish('Test angehalten: ' + text);
}
const onWorkerMessage = ({ data: m }: MessageEvent) => {
  try {
    if (m.epoch !== epoch) return;
    if (m.kind === 'snapshot') mailbox.receive(m);
    else if (m.kind === 'compact-basis') {
      consumer = new CompactWorldRenderer(decodeReferencePacket(m.bytes) as WorldPacket);
      hud = new HudOverlay(consumer.scene.renderer.uniforms);
      sky = new XrSky(consumer.scene.renderer.uniforms);
      sky.mesh.visible = true; consumer.scene.renderer.backdropScene.add(sky.mesh);
    } else if (m.kind === 'controls-ack') controls.acknowledge(m.epoch, m.sequence);
    else if (m.kind === 'ended') { events.push({ kind: 'ended', at: Date.now() }); finish('Mission beendet.'); }
    else if (m.kind === 'error') fail(m.message);
    else if (['stalled', 'resumed', 'stopped'].includes(m.kind)) {
      events.push(m); if (events.length > 64) events.shift();
      if (m.kind === 'stopped') worker.terminate();
    }
  } catch (error) { fail(error); }
};

function adopt(now: number): void {
  const packet = mailbox.acquire();
  if (!consumer || !packet || packet.sequence === sequence) return;
  const start = performance.now();
  consumer.apply(new Uint8Array(packet.buffer, 0, packet.meta.bytes));
  const adopted = performance.now();
  sequence = packet.sequence; meta = packet.meta; lastAdoption = now;
  const aux = consumer.aux;
  [hudWindow.buffer, hudWindow.drawn, hudWindow.layer, hudWindow.inset] = aux.planes as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  hudWindow.xMax = aux.width - 1; hudWindow.yMax = aux.height - 1;
  hud!.update(hudWindow, aux.width, aux.height);
  if (!ready) rig.hold(consumer.scene.camera, now); else rig.recordPass(consumer.scene.camera, now);
  adoptions.push({ at: now, ms: adopted - start, hudMs: performance.now() - adopted, worker: packet.meta });
  if (adoptions.length > 1200) adoptions.shift();
  if (!ready) {
    ready = true; enter.disabled = false;
    message('Bereit: AMY_SCN1 · Worker-Test\n„Start in VR“ wählen.');
  }
}

function draw(now: number) {
  const started = performance.now();
  const session = renderer.xr.getSession();
  const active = session?.visibilityState === 'visible';
  if (active !== visible) { visible = active; pause(!active); }
  try {
    adopt(now);
    if (!consumer || !hud || !sky || !meta?.presentation) return;
    if (!active || !session) { perf.record(now, 0, renderer); return; }
    const input = mapper.update(readPads(session), consumer.aux.menuOpen);
    // Only changed input or a 100 ms watchdog pulse crosses the worker boundary.
    if (input.keys.length || input.torso) controls.push(input.keys, input.torso);
    if (now - lastPulse >= 100) { controls.pulse(); lastPulse = now; }
    renderer.info.reset();
    rig.update(now);
    renderer.xr.updateCamera(rig.camera);
    const head = renderer.xr.getCamera();
    head.matrixWorld.decompose(headCamera.position, headCamera.quaternion, scale);
    headCamera.updateMatrixWorld(true);
    const viewport = head.cameras[0]?.viewport;
    const width = viewport?.z ?? 640, height = viewport?.w ?? 480;
    consumer.scene.sync(headCamera, width, height);
    const sr = consumer.scene.renderer, originalEye = consumer.scene.camera;
    if (meta.presentation.cockpitActive) sr.carryOwned(meta.presentation.playerIndex, rig.cockpitMatrix(originalEye, carry, 1));
    rig.cockpitMatrix(originalEye, sr.cockpitScene.matrix);
    sr.cockpitScene.matrixWorldNeedsUpdate = true;
    const tanH = 65536 / Math.min(0x100000, Math.max(0x8000, consumer.scene.viewer.zoom | 0));
    sky.update(headCamera.position, tanH, meta.presentation.sky);
    renderer.clear(); consumer.scene.render(renderer, rig.camera);
    const menu = consumer.aux.menuOpen;
    rig.placeHud(hud.worldMesh, tanH, hud.aspect, menu ? 0.8 : undefined, menu ? 2.4 : undefined);
    hud.setWorldLayers(menu ? 7 : 1);
    hud.reticleMesh.visible = hud.markerMesh.visible = !menu;
    if (!menu) {
      rig.placeCarried(hud.reticleMesh, 300, tanH, hud.aspect);
      rig.placeLifted(hud.markerMesh, originalEye, 300, tanH, hud.aspect);
    }
    renderer.render(rig.hudScene, rig.camera);
    fps.update(perf.displayFps, perf.missionFps, rig.rig);
    renderer.render(fps.scene, rig.camera);
    perf.simMs = 0; // Simulation runs in worker; recorded separately in adoptions.
    perf.record(now, performance.now() - started, renderer);
    firstFrame ||= now;
    if (now - lastStatus > 1000) {
      lastStatus = now;
      status.textContent = `Worker-Test aktiv · ${perf.displayFps?.toFixed(1) ?? '--'} XR-Callbacks/s · Zustand ${sequence}`;
    }
  } catch (error) { fail(error); }
}
function drawEndPanel(highlight: boolean) {
  message(endMessage);
  const r = RESTART_RECT;
  context.fillStyle = highlight ? '#4c9c79' : '#285f4c'; context.fillRect(r.x, r.y, r.w, r.h);
  context.strokeStyle = '#bfe3cf'; context.lineWidth = 2; context.strokeRect(r.x, r.y, r.w, r.h);
  context.fillStyle = '#ffffff'; context.textAlign = 'center'; context.font = '27px sans-serif';
  context.fillText('Mission neu starten', 320, r.y + 46);
  context.font = '19px sans-serif'; context.fillText('Rechter Zeiger + Trigger oder A', 320, r.y + 110);
  context.textAlign = 'left'; hovered = highlight;
}
function startMission() {
  host.present(null);
  if (worker) { controls.reset(); mailbox.close(); worker.terminate(); }
  sky?.dispose(); hud?.dispose(); consumer?.dispose();
  consumer = undefined; hud = undefined; sky = undefined;
  epoch = crypto.randomUUID(); sequence = 0; meta = undefined;
  running = true; ready = false; visible = false; lastPulse = 0; lastAdoption = 0; firstFrame = 0;
  mapper.reset(); endInput.reset(); adoptions.length = 0; events.length = 0; perf = new QuestPerf();
  enter.disabled = true;
  const currentWorker = new Worker(new URL('../../src/app/missionWorker.ts', import.meta.url), { type: 'module' });
  worker = currentWorker;
  mailbox = new SnapshotConsumer(epoch, (m, transfer) => currentWorker.postMessage(m, transfer));
  controls = new WorkerControlSender(epoch, m => currentWorker.postMessage(m));
  currentWorker.onmessage = onWorkerMessage;
  currentWorker.onerror = event => { if (worker === currentWorker) fail(event.message); };
  host.showScreen(screen); message('Worker-Mission wird vorbereitet …');
  currentWorker.postMessage({ kind: 'start', epoch, origin: location.origin, compact: true, visibleVr: true });
}
// Keep the existing XR session and renderer through mission end/restart.
// Require a neutral controller before accepting the end-screen button.
host.onTick(now => {
  if (!running) {
    const session = renderer.xr.getSession();
    if (!session) return;
    const pads = readPads(session), point = host.screenPointer;
    const inside = EndPanelInput.contains(point);
    if (inside !== hovered) drawEndPanel(inside);
    if (endInput.update(session.visibilityState === 'visible', point, pads.rTrigger, pads.a)) startMission();
    return;
  }
  if (!ready) { try { adopt(now); } catch (error) { fail(error); } }
  if (ready && host.presenting) host.present(draw);
});
host.subscribe(state => {
  if (state.on && !sessionWasOn) sessionEntries++;
  sessionWasOn = state.on;
  if (state.error) message(state.error);
  if (!state.on) { visible = false; pause(true); perf.record(performance.now(), 0, renderer); host.present(null); if (ready && running) message('Test bereit / pausiert.\n„Start in VR“ zum Fortsetzen.'); }
});
enter.onclick = () => { void host.enter(); };
document.querySelector<HTMLButtonElement>('#leave')!.onclick = () => host.leave();
document.querySelector<HTMLButtonElement>('#restart')!.onclick = startMission;

const api = {
  enter: () => host.enter(), leave: () => host.leave(), restart: startMission,
  endTest: () => finish('Test beendet.'),
  snapshot: () => ({ kind: 'visible-worker-vr', epoch, sessionEntries, ready, running, sequence, visible, firstFrame,
    stateAgeMs: lastAdoption ? performance.now() - lastAdoption : null,
    sessionVisibility: renderer.xr.getSession()?.visibilityState ?? null, inputSources: renderer.xr.getSession()?.inputSources.length ?? 0,
    perf: perf.snapshot(), lastWorker: meta, adoptions: [...adoptions], events: [...events],
    limitations: 'Prototype: no audio, glove buttons, 3D insets, shell/saves; fixed 300 m reticle/marker depth. XR callback rate is not compositor FPS.' }),
  stall: (ms = 600) => { if (running && visible) worker.postMessage({ kind: 'stall', epoch, ms }); },
};
Object.assign(window, { mw2WorkerVr: api });
addEventListener('pagehide', () => {
  controls.reset(); mailbox.close(); worker.terminate();
  sky?.dispose(); hud?.dispose(); consumer?.dispose(); fps.dispose(); host.dispose();
}, { once: true });
startMission();
