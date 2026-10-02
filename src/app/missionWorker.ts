/** Experimental continuous mission worker. No WebGL, WebAudio, saves or shell
 * integration. Never select this as the normal game path until those ports exist. */
import { loadGameData } from './gameData.ts';
import { FetchSource } from './fetchSource.ts';
import { setDosFiles } from '../engine/dosFiles.ts';
import { seedControlFiles } from '../shell/controls/seed.ts';
import { prepareDevMission } from '../shell/devLaunch.ts';
import { bootMission } from '../mission/load.ts';
import { mainLoopFrame, mainLoopStep, mainLoopRunning, mainLoop } from '../mission/mainLoop.ts';
import { ailTimerService } from '../engine/miles/ail.ts';
import { clock } from '../engine/clock.ts';
import { SimulationPacer } from '../engine/simulationPacer.ts';
import { SnapshotProducer, type SnapshotRelease } from '../engine/snapshotMailbox.ts';
import { BitmapAtlas } from '../render/textures/bitmapAtlas.ts';
import { makeUniforms, setPalette, setLuma, type IndexedUniforms } from '../render/materials/indexedMaterial.ts';
import { captureWorldState, type WorldPacket } from '../render/snapshot/worldState.ts';
import { CompactWorldEncoder } from '../render/snapshot/compactWorld.ts';
import { encodeReferencePacket, ResourcePacketEncoder } from '../render/snapshot/referencePacket.ts';
import { viewer } from '../sim/camera/viewer.ts';
import { palettes } from '../sim/world/palettes.ts';
import { lighting } from '../sim/world/environment.ts';
import { cacheLoadResource } from '../engine/resources/cache.ts';
import { parseLuma } from '../data/formats/image.ts';
import { defaultCanvas } from '../sim/display/video.ts';
import { ui } from '../sim/ui/uiContext.ts';
import { sendKey, releaseSentKeys, setMouseStick } from './hostInput.ts';
import type { WorkerControls } from './workerControls.ts';
import { simTables } from '../sim/effects/simTables.ts';
import { mechs } from '../sim/mech/mechGlobals.ts';

type Pixels = { type: 'Uint8Array'; data: ArrayLike<number> };
export interface MissionPacket {
  world: WorldPacket;
  hud: { width: number; height: number; buffer: Pixels; drawn: Pixels; layer: Pixels; inset: Pixels };
  menuOpen: boolean;
  throttlePlus: number;
}
export interface MissionMeta {
  bytes: number; frame: number; simTick: number; simMs: number; captureMs: number; encodeMs: number;
  playerStatus: number; playerProjectiles: number; weaponFire: number; controls: number; published: number; skipped: number;
}
type Request = SnapshotRelease | WorkerControls | { kind: 'start'; epoch: string; origin: string; compact?: boolean }
  | { kind: 'stop'; epoch: string } | { kind: 'stall'; epoch: string; ms: number };
const port = globalThis as unknown as { postMessage(message: unknown, transfers?: ArrayBuffer[]): void; onmessage: ((event: MessageEvent<Request>) => void) | null };
let epoch = '', closed = false, started = false;
let producer: SnapshotProducer<MissionMeta> | undefined, uniforms: IndexedUniforms | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let controls = 0, inputTime = 0;

function release() { releaseSentKeys(); setMouseStick(0, 0); }
function stop() {
  closed = true; clearTimeout(timer); producer?.close(); release();
  if (uniforms) for (const u of [uniforms.uPalette, uniforms.uLuma, uniforms.uAtlas, uniforms.uSlots, uniforms.uShadowTable]) u.value.dispose();
  uniforms = undefined;
}
function fail(error: unknown) { stop(); port.postMessage({ kind: 'error', epoch, message: String(error instanceof Error ? error.stack : error) }); }
function capture(): MissionPacket {
  const pixels = (data: Uint8Array): Pixels => ({ type: 'Uint8Array', data });
  return { world: captureWorldState(viewer(), uniforms!), menuOpen: ui.menuOpenCount > 0, throttlePlus: mechs.playerControls.throttle_plus,
    hud: { width: defaultCanvas.xMax + 1, height: defaultCanvas.yMax + 1,
      buffer: pixels(defaultCanvas.buffer), drawn: pixels(defaultCanvas.drawn), layer: pixels(defaultCanvas.layer), inset: pixels(defaultCanvas.inset) } };
}

async function start(origin: string, compact = false) {
  const data = await loadGameData(new FetchSource(`${origin}/mw2/`));
  if (closed) return;
  setDosFiles(data.loose); seedControlFiles(data.shellExe);
  const argv = prepareDevMission({ shellExe: data.shellExe, prj: data.prj, stream: 'AMY_SCN1', insignia: false, userStar: null });
  if (!bootMission({ exe: data.exe, prj: data.prj, ini: data.ini, argv })) throw Error('Mission worker boot failed');
  for (let f = 0; f < 40; f++) { for (let t = 0; t < 9; t++) ailTimerService(); mainLoopFrame(); }
  uniforms = makeUniforms(); const atlas = new BitmapAtlas(); atlas.build(uniforms);
  setPalette(uniforms, palettes.dac);
  const luma = cacheLoadResource(lighting.lumaTableId, 'LUMA');
  if (luma) setLuma(uniforms, parseLuma(luma).rows);
  atlas.updateSlots(uniforms);
  const initial = capture();
  const encoder = compact ? new CompactWorldEncoder(initial.world, uniforms) : new ResourcePacketEncoder(epoch, initial);
  const basis = encoder instanceof CompactWorldEncoder ? encodeReferencePacket(initial.world) : encoder.initial;
  port.postMessage({ kind: compact ? 'compact-basis' : 'resource-basis', epoch, bytes: basis }, [basis.buffer as ArrayBuffer]);
  // Fixed maximum, three slots. Oversize scenes fail explicitly, never truncate.
  const capacity = 16 * 1024 * 1024;
  producer = new SnapshotProducer(epoch, capacity, (m, transfer) => port.postMessage(m, transfer));
  const pacer = new SimulationPacer(); let previous = performance.now(); inputTime = previous;
  const pump = () => {
    if (closed) return;
    try {
      const now = performance.now(), elapsed = now - previous; previous = now;
      if (now - inputTime > 500) release();
      const due = pacer.advance(elapsed);
      const start = performance.now();
      for (let i = 0; i < due.ticks; i++) ailTimerService();
      if (due.step) {
        mainLoopStep();
        const simMs = performance.now() - start;
        if (!mainLoopRunning()) { stop(); port.postMessage({ kind: 'ended', epoch }); return; }
        atlas.updateSlots(uniforms!); setPalette(uniforms!, palettes.dac);
        const meta: MissionMeta = { bytes: 0, frame: mainLoop.frameCount, simTick: clock.simTick,
          simMs, captureMs: 0, encodeMs: 0, playerStatus: mechs.mechTable[mechs.playerMechIndex]?.loadout?.status ?? -1,
          playerProjectiles: simTables.projectiles.filter(p => p.active && p.attackerMechIndex === mechs.playerMechIndex).length,
          weaponFire: mechs.playerControls.weapon_fire | mechs.playerControls.weapon_fire_group, controls, published: producer!.stats.published, skipped: producer!.stats.skipped };
        producer!.publish(meta, buffer => {
          const begin = performance.now(), state = capture(), encodedAt = performance.now();
          if (encoder instanceof CompactWorldEncoder) {
            meta.bytes = encoder.write(state.world, uniforms!, buffer, { width: state.hud.width, height: state.hud.height,
              planes: [defaultCanvas.buffer, defaultCanvas.drawn, defaultCanvas.layer, defaultCanvas.inset],
              menuOpen: state.menuOpen, throttlePlus: state.throttlePlus });
          } else {
            const bytes = encoder.encode(state); meta.bytes = bytes.length;
            if (bytes.length > buffer.byteLength) throw Error('Mission snapshot exceeds transport capacity');
            new Uint8Array(buffer, 0, bytes.length).set(bytes);
          }
          meta.captureMs = encodedAt - begin; meta.encodeMs = performance.now() - encodedAt;
        });
      }
      timer = setTimeout(pump, 5);
    } catch (error) { fail(error); }
  };
  pump();
}

port.onmessage = ({ data: m }) => {
  try {
    if (m.kind === 'start') {
      if (started) throw Error('Mission worker must be recreated for each epoch');
      started = true; epoch = m.epoch; void start(m.origin, m.compact).catch(fail); return;
    }
    if (m.epoch !== epoch || closed) return;
    if (m.kind === 'snapshot-release') producer?.release(m);
    else if (m.kind === 'stop') { stop(); port.postMessage({ kind: 'stopped', epoch }); }
    else if (m.kind === 'controls') {
      if (!Number.isSafeInteger(m.sequence) || m.sequence <= controls || m.keys.length > 64) throw Error('Invalid worker controls');
      if (m.release) release();
      for (const key of m.keys) sendKey(key.code, key.down);
      if (m.torso) setMouseStick(m.torso[0], m.torso[1]);
      controls = m.sequence; inputTime = performance.now();
      port.postMessage({ kind: 'controls-ack', epoch, sequence: controls });
    } else if (m.kind === 'stall') {
      if (!Number.isFinite(m.ms) || m.ms < 0 || m.ms > 1000) throw Error('Invalid development stall');
      const start = Date.now(); port.postMessage({ kind: 'stalled', epoch, start });
      while (Date.now() - start < m.ms) { /* deliberate development fault injection */ }
      port.postMessage({ kind: 'resumed', epoch, start, end: Date.now() });
    }
  } catch (error) { fail(error); }
};
