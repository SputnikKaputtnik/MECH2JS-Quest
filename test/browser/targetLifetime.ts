/** @portOnly Exercise the real target widget across repeated mech LOD rebuilds.
 * No player saves or XR session; the old 600-pass cache grows on every update. */
import * as THREE from 'three';
import { GameScreen, ORIGINAL_SETTINGS } from '../../src/app/gameScreen.ts';
import type { XrHost } from '../../src/app/xrHost.ts';
import { loadGameData } from '../../src/app/gameData.ts';
import { FetchSource } from '../../src/app/fetchSource.ts';
import { Game } from '../../src/app/Game.ts';
import { seedControlFiles } from '../../src/shell/controls/seed.ts';
import { setDosFiles } from '../../src/engine/dosFiles.ts';
import { mechs } from '../../src/sim/mech/mechGlobals.ts';
import { hud } from '../../src/sim/cockpit/hud.ts';
import { hudWidget13Tick } from '../../src/sim/cockpit/targetDisplay.ts';
import { mechApplyDetailLevel } from '../../src/sim/world/detailRecords.ts';
import { renderPort } from '../../src/sim/display/renderPort.ts';
import type { SceneRenderer } from '../../src/render/SceneRenderer.ts';

export async function runTargetLifetimeCheck() {
  const data = await loadGameData(new FetchSource());
  setDosFiles(data.loose); seedControlFiles(data.shellExe);
  const game = new Game(data);
  if (!game.loadMission('GOATSCN1', { pilot: { name: 'TARGET TEST', mech: { config: 'mdg00std', mekId: 62, stream: { id: 29, name: 'maddog' }, tons: 60 } }, starmates: [] })) throw Error(game.loadError ?? 'Mission failed');
  const renderer = new THREE.WebGLRenderer({ antialias: false }); renderer.setSize(640, 480);
  let present: ((now: number) => void) | null = null;
  const host = { renderer, present: (frame: typeof present) => { present = frame; } } as unknown as XrHost;
  const element = document.createElement('div'); element.style.cssText = 'width:640px;height:480px'; document.body.appendChild(element);
  const screen = new GameScreen(element, game, { host, settings: () => ORIGINAL_SETTINGS });
  const rows = [];
  try {
    game.setMode('play'); game.audio.pause();
    const start = performance.now();
    for (let i = 0; i < 12; i++) present!(start + i * 50);
    const player = mechs.mechTable[mechs.playerMechIndex]!.loadout!.entity!;
    const target = mechs.mechTable.find((m, i) => i !== mechs.playerMechIndex && m?.loadout?.entity);
    if (!target?.loadout?.entity) throw Error('No target mech');
    const entity = target.loadout.entity;
    player.targetHandle = 0x200 | target.index;
    player.targetX = entity.posX; player.targetY = entity.posY; player.targetZ = entity.posZ;
    hud.playerStatusCopy = 2; hud.targetDisplayMode = 1;
    const widget = hud.hudWidgets[13]!; widget.visible = 1; widget.field_0x6 = 0;
    const beforeTarget = renderer.info.memory.geometries;
    for (let update = 0; update < 800; update++) {
      // The world may select a coarser LOD; the target widget forces level zero.
      mechApplyDetailLevel(target.index, 1);
      hudWidget13Tick(widget);
      rows.push({ update, ...renderer.info.memory });
      if (renderer.getContext().isContextLost()) throw Error('Target test lost WebGL context');
    }
    const first = rows[0]!.geometries, peak = Math.max(...rows.map(r => r.geometries));
    if (first <= beforeTarget) throw Error('Target fixture did not allocate geometry');
    if (peak > first + 4) throw Error(`Target geometry accumulates: ${JSON.stringify({ first, peak, last: rows.at(-1) })}`);
    // Compare the exact target-view pixels after replacement against freshly
    // built geometry. The simulation is frozen and both calls rebuild LOD 0.
    const view = (renderPort.current as unknown as { views: Map<number, { sr: SceneRenderer; target: THREE.WebGLRenderTarget }> }).views.get(7);
    if (!view) throw Error('No target render surface');
    const imageComparisons = [];
    const ids = () => {
      const out = new Set<number>();
      view.sr.scene.traverse(o => { if (o instanceof THREE.Mesh) out.add(o.geometry.id); });
      return out;
    };
    for (const mode of [1, 2]) {
      hud.targetDisplayMode = mode;
      view.sr.reuseReplacementGeometry = false;
      mechApplyDetailLevel(target.index, 1); hudWidget13Tick(widget);
      const { width, height } = view.target;
      const reference = new Uint8Array(width * height * 4), reused = reference.slice();
      renderer.readRenderTargetPixels(view.target, 0, 0, width, height, reference);
      const beforeIds = ids();
      view.sr.reuseReplacementGeometry = true;
      mechApplyDetailLevel(target.index, 1); hudWidget13Tick(widget);
      renderer.readRenderTargetPixels(view.target, 0, 0, width, height, reused);
      let differentBytes = 0, drawnPixels = 0;
      for (let i = 0; i < reference.length; i++) {
        if (reference[i] !== reused[i]) differentBytes++;
        if (i % 4 === 3 && reference[i]) drawnPixels++;
      }
      const reusedMeshes = [...ids()].filter(id => beforeIds.has(id)).length;
      if (differentBytes || !drawnPixels || !reusedMeshes) throw Error(`Replacement image check failed: ${JSON.stringify({ mode, differentBytes, drawnPixels, reusedMeshes })}`);
      imageComparisons.push({ mode, width, height, differentBytes, drawnPixels, reusedMeshes });
    }
    screen.dispose();
    const after = { ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 };
    if (after.geometries || after.textures || after.programs) throw Error(`Target cleanup leaked: ${JSON.stringify(after)}`);
    return { updates: rows.length, first, peak, rows, imageComparisons, after };
  } finally {
    if (present) screen.dispose(); renderer.dispose(); element.remove(); game.setMode('edit'); game.audio.pause();
  }
}
