/** @portOnly Full GameScreen/AudioHost A/B fixture. Scratch mission; never loads pilot saves. */
import { loadGameData } from '../../src/app/gameData.ts';
import { FetchSource } from '../../src/app/fetchSource.ts';
import { Game } from '../../src/app/Game.ts';
import { GameScreen, recallScreenSettings, type ScreenSettings } from '../../src/app/gameScreen.ts';
import { XrHost } from '../../src/app/xrHost.ts';
import { questFrameExperiment } from '../../src/app/questFrameExperiment.ts';
import { seedControlFiles } from '../../src/shell/controls/seed.ts';
import { setDosFiles } from '../../src/engine/dosFiles.ts';
import { simOptionsFileEnsure } from '../../src/sim/mech/simOptions.ts';
import { soundConfigFileEnsure } from '../../src/sim/sound/soundConfigFile.ts';
import { releaseSentKeys, sendKey } from '../../src/app/hostInput.ts';
import { mechs } from '../../src/sim/mech/mechGlobals.ts';
import { simTables } from '../../src/sim/effects/simTables.ts';
import { readCheatCodes } from '../../src/data/exe/tables/cheats.ts';
import { cheatHandleCommand } from '../../src/sim/ui/cheats.ts';
import { commandExecute } from '../../src/sim/ui/commands.ts';
import { renderPort } from '../../src/sim/display/renderPort.ts';
import { IndexedViews } from '../../src/render/passes/indexedView.ts';
import { cockpitChassis } from '../../src/render/cockpit/chassis.ts';
import { DESIGNS } from '../../src/render/cockpit/designs/index.ts';
import { hud } from '../../src/sim/cockpit/hud.ts';
import type { QuestPerf } from '../../src/app/questPerf.ts';
import { setDynamicResolution, setFixedFoveation, setRenderScale } from '../../src/app/questGraphics.ts';
import { fpsCounterEnabled } from '../../src/app/questComfort.ts';

const enter = document.querySelector<HTMLButtonElement>('#enter')!;
const restart = document.querySelector<HTMLButtonElement>('#restart')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const el = document.querySelector<HTMLDivElement>('#game')!;
const query = new URLSearchParams(location.search);
const runtimeTest = query.get('questRuntimeTest') === '1';
if (runtimeTest) {
  setDynamicResolution(false, false); setFixedFoveation(true, false);
  setRenderScale(Number(query.get('questScale')), false);
}
const data = await loadGameData(new FetchSource());
setDosFiles(data.loose); simOptionsFileEnsure(); soundConfigFileEnsure(); seedControlFiles(data.shellExe);
const game = new Game(data), host = new XrHost();
if (runtimeTest) game.loopRate = 20;
let screen: GameScreen | null = null;
let automaticFire = false, fireHeld = false, activeMs = 0, last = 0, epoch = '';
let throttleHeld = false, targetHeld = false;
const settings: ScreenSettings = runtimeTest ? {
  faithful: false, view: { viewDistance: 3, detail: 3 },
  enhance: { mechPanels: true, mechsAllTop: true, ground: true, sky: true, shadows: true, cockpit: true, ownChassis: true },
  xr: { cockpitScale: 0.35, hudScale: 0.6, hudDistance: 1.2, dashDrop: 0 },
  spectator: { mode: 'mirror', fov: 90, smooth: 0.35 },
} : recallScreenSettings();
const invulnerable = new URLSearchParams(location.search).get('questInvulnerable') === '1';
const instruments = new URLSearchParams(location.search).get('questInstruments') === '1';
let centerPending = new URLSearchParams(location.search).get('questCenter') === '1';
let centered = false, instrumentsReady = false;
let nextPoseAt = 0;
let headPose: { position: number[]; orientation: number[] } | null = null;
const perf = () => (window as unknown as { mw2QuestPerf: QuestPerf }).mw2QuestPerf;
function fire(held: boolean) {
  if (held === fireHeld) return;
  fireHeld = held; sendKey('Space', held);
}
function throttle(held: boolean) {
  if (held === throttleHeld) return;
  throttleHeld = held; sendKey('Equal', held);
}
function target(held: boolean) {
  if (held === targetHeld) return;
  targetHeld = held; sendKey('KeyE', held);
}
function startMission() {
  fire(false); throttle(false); target(false); releaseSentKeys(); screen?.dispose(); screen = null;
  epoch = crypto.randomUUID(); activeMs = 0; last = 0;
  instrumentsReady = false;
  if (!game.loadMission('AMY_SCN1', null)) throw Error(game.loadError ?? 'Mission failed');
  // Use the existing original cheat in this scratch mission only; never save options.
  if (invulnerable && !mechs.simOptions.invulnerability) {
    for (const key of readCheatCodes(data.exe)[0]!.typed) cheatHandleCommand(0x700 | key.charCodeAt(0));
    if (!mechs.simOptions.invulnerability) throw Error('Invulnerability cheat did not activate');
  }
  game.setMode('edit');
  screen = new GameScreen(el, game, { host, settings: () => settings });
  if (host.renderer.xr.getSession()?.visibilityState === 'visible') game.setMode('play');
  status.textContent = `${questFrameExperiment.schedule}; requested ${questFrameExperiment.requestedHz} Hz (not verified).\nFull cockpit/HUD/insets/audio/hands; scratch AMY_SCN1, no career/save handoff.`;
}
game.onMissionEnd = () => { fire(false); throttle(false); target(false); status.textContent = 'Mission ended. Restart explicitly; no automatic relaunch.'; };
host.subscribe(s => { if (s.error) status.textContent = s.error; });
host.onTick(now => {
  const visible = host.renderer.xr.getSession()?.visibilityState === 'visible';
  if (visible && centerPending && activeMs >= 2000) {
    const xr = host.renderer.xr, reference = xr.getReferenceSpace(), frame = xr.getFrame();
    const pose = reference && frame?.getViewerPose(reference);
    if (reference && pose) {
      // Fixture-only neutral view for a headset resting on a table. Tracking stays live.
      xr.setReferenceSpace(reference.getOffsetReferenceSpace(pose.transform));
      centerPending = false; centered = true;
    }
  }
  if (visible && game.mode === 'play') {
    if (last) activeMs += Math.min(100, Math.max(0, now - last));
    last = now;
  } else last = 0;
  if (visible && now >= nextPoseAt) {
    nextPoseAt = now + 1000;
    const xr = host.renderer.xr, reference = xr.getReferenceSpace(), frame = xr.getFrame();
    const pose = reference && frame?.getViewerPose(reference);
    if (pose) {
      const { position: p, orientation: q } = pose.transform;
      headPose = { position: [p.x, p.y, p.z], orientation: [q.x, q.y, q.z, q.w] };
    }
  }
  if (!visible) { fire(false); if (game.mode === 'play') game.setMode('edit'); }
  if (instruments && automaticFire && visible && game.mode === 'play'
    && mechs.mechTable[mechs.playerMechIndex]?.loadout?.status === 2) {
    if (!instrumentsReady) {
      if (hud.damageDisplayMode !== 3) commandExecute(4); // Original rear-view toggle.
      while (hud.targetDisplayMode !== 2) commandExecute(8); // Original shaded target view.
      instrumentsReady = true;
    }
  }
  // Hold the same key as controller A across a simulation tick, then release it.
  target(instruments && automaticFire && !!visible && game.mode === 'play'
    && activeMs >= 10000 && activeMs % 10000 < 1000);
  // Explicit opt-in workload: warm up 30 s, then alternate 2 s fire / 3 s release.
  // Player/controller input remains available; do not enable during manual comparisons.
  fire(automaticFire && !!visible && game.mode === 'play' && activeMs >= 30000
    && mechs.mechTable[mechs.playerMechIndex]?.loadout?.status === 2 && activeMs % 5000 < 2000);
  throttle(!invulnerable && automaticFire && !!visible && game.mode === 'play' && activeMs < 20000
    && mechs.mechTable[mechs.playerMechIndex]?.loadout?.status === 2);
});
async function enterVr() {
  game.audio.enable();
  if (await host.enter()) game.setMode('play');
}
const api = {
  enter: enterVr, restart: startMission,
  autoFire(enabled: boolean) { automaticFire = enabled; if (!enabled) { fire(false); throttle(false); target(false); } },
  resume() { if (host.renderer.xr.getSession()?.visibilityState === 'visible') game.setMode('play'); },
  snapshot: () => ({ kind: 'full-game-frame-test', epoch, schedule: questFrameExperiment.schedule,
    mission: game.mission, mode: game.mode, error: game.loadError, activeMs, automaticFire,
    invulnerable: !!mechs.simOptions.invulnerability, combatProtocol: invulnerable ? 'stationary-fire-2s-rest-3s' : 'accelerate-20s-fire-2s-rest-3s',
    centered, instruments, instrumentsReady, cockpitChassis: cockpitChassis(data.prj),
    runtimeTest, headPose, userAgent: navigator.userAgent, loopRate: game.loopRate, fpsCounter: fpsCounterEnabled(),
    layerKind: host.renderer.xr.getBaseLayer()?.constructor.name,
    contextAttributes: host.renderer.getContext().getContextAttributes(),
    customCockpitAvailable: !!DESIGNS[cockpitChassis(data.prj)],
    insetTargets: renderPort.current instanceof IndexedViews ? renderPort.current.insetTargets : [],
    settings, audioEnabled: game.audio.enabled, audioState: game.audio.contextState,
    playerStatus: mechs.mechTable[mechs.playerMechIndex]?.loadout?.status,
    playerProjectiles: simTables.projectiles.filter(p => p.active && p.attackerMechIndex === mechs.playerMechIndex).length,
    projectiles: simTables.projectiles.filter(p => p.active).length,
    xrVisible: host.renderer.xr.getSession()?.visibilityState === 'visible', perf: perf().snapshot() }),
};
Object.assign(window, { mw2FullGameTest: api });
enter.onclick = () => { void enterVr(); }; restart.onclick = startMission;
startMission(); enter.disabled = false; restart.disabled = false;
addEventListener('pagehide', () => { fire(false); throttle(false); target(false); screen?.dispose(); game.audio.pause(); host.dispose(); }, { once: true });
