/** @portOnly Recreate mission views on one persistent renderer, like the XR host. */
import * as THREE from 'three';
import { GameScreen } from '../../src/app/gameScreen.ts';
import type { XrHost } from '../../src/app/xrHost.ts';
import { loadGameData } from '../../src/app/gameData.ts';
import { FetchSource } from '../../src/app/fetchSource.ts';
import { Game } from '../../src/app/Game.ts';
import { seedControlFiles } from '../../src/shell/controls/seed.ts';
import { setDosFiles } from '../../src/engine/dosFiles.ts';

export async function runResourceLifetimeCheck(assertStable = true) {
  const data = await loadGameData(new FetchSource());
  setDosFiles(data.loose); seedControlFiles(data.shellExe);
  const game = new Game(data);
  if (!game.loadMission('AMY_SCN1', { pilot: { name: 'RESOURCE TEST', mech: { config: 'mdg00std', mekId: 62, stream: { id: 29, name: 'maddog' }, tons: 60 } }, starmates: [] })) throw Error(game.loadError ?? 'Mission failed');
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(640, 480);
  let present: ((now: number) => void) | null = null;
  const host = { renderer, present: (frame: typeof present) => { present = frame; } } as unknown as XrHost;
  const element = document.createElement('div');
  element.style.cssText = 'width:640px;height:480px'; document.body.appendChild(element);
  const memory = () => ({ ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 });
  const baseline = memory();
  const rows = [];
  try {
    for (let cycle = 0; cycle < 6; cycle++) {
      const screen = new GameScreen(element, game, { host });
      try {
        game.setMode('play'); game.audio.pause();
        const start = performance.now();
        for (let frame = 0; frame < 12; frame++) present!(start + frame * 50);
        // Allocate both sky geometries even without an immersive test session.
        screen.sr.backdropScene.traverse(o => { if (o instanceof THREE.Mesh) o.visible = true; });
        renderer.render(screen.sr.backdropScene, screen.gameCamera);
        const during = memory();
        if (during.geometries < 3) throw Error('Mission view did not allocate visible render resources');
        screen.dispose();
        rows.push({ cycle, during, after: memory() });
      } finally {
        if (present) screen.dispose();
        game.setMode('edit'); game.audio.pause();
      }
    }
    // The shared host survives, but all mission-owned GPU resources must return to baseline.
    const stable = rows.every(row => row.after.geometries === baseline.geometries
      && row.after.textures === baseline.textures && row.after.programs === baseline.programs);
    if (assertStable && !stable) throw Error(`Mission resources accumulate: ${JSON.stringify(rows)}`);
    return { baseline, rows, stable };
  } finally { renderer.dispose(); element.remove(); game.audio.pause(); }
}
