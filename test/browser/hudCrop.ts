/** Browser WebGL A/B image check, independent of game data. Exercises both eyes,
 * off-centre markers, pixel borders, oblique planes, disappearance and resizing. */
import * as THREE from 'three';
import { HudOverlay } from '../../src/render/passes/hudOverlay.ts';
import { makeUniforms, setPalette } from '../../src/render/materials/indexedMaterial.ts';
import { VfxWindow, vfxWindowAllocate, HUD_LAYER } from '../../src/engine/vfx/vfx.ts';

export interface HudCapture { width: number; height: number; buffer: number[]; drawn: number[]; layer: number[]; inset: number[] }

export function runHudCropComparison(capture?: HudCapture) {
  const shared = makeUniforms();
  const rgb = new Uint8Array(768); rgb.fill(63);
  setPalette(shared, rgb);
  const hud = new HudOverlay(shared);
  const scene = new THREE.Scene(); scene.add(hud.reticleMesh, hud.markerMesh);
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  const target = new THREE.WebGLRenderTarget(960, 960);
  const cam = new THREE.PerspectiveCamera(80, 1, 0.1, 100);
  const win = new VfxWindow();
  const a = new Uint8Array(960 * 960 * 4), b = a.slice();
  const rows = [];
  try {
    for (const [width, height] of capture ? [[capture.width, capture.height]] : [[640, 480], [320, 200]]) {
      vfxWindowAllocate(win, width!, height!);
      const w = width!, h = height!;
      for (const marker of capture ? ['captured'] : ['centre', 'corner', 'empty']) {
        win.drawn.fill(0); win.layer.fill(0);
        const put = (x: number, y: number, layer: number) => {
          if (x < 0 || y < 0 || x >= w || y >= h) return;
          const p = y * w + x; win.buffer[p] = 63; win.drawn[p] = 1; win.layer[p] = layer;
        };
        for (let d = -12; d <= 12; d++) {
          put(w / 2 + d, h / 2, HUD_LAYER.reticle);
          put(w / 2, h / 2 + d, HUD_LAYER.reticle);
        }
        if (marker !== 'empty') {
          const mx = marker === 'corner' ? w - 1 : w / 2 + 50;
          const my = marker === 'corner' ? 0 : h / 2 - 20;
          for (let d = -20; d <= 20; d++) {
            for (const edge of [-20, 20]) { put(mx + d, my + edge, HUD_LAYER.targetMarker); put(mx + edge, my + d, HUD_LAYER.targetMarker); }
          }
        }
        if (capture) {
          win.buffer.set(capture.buffer); win.drawn.set(capture.drawn);
          win.layer.set(capture.layer); win.inset.set(capture.inset);
        }
        hud.update(win, 960, 960);
        for (const angle of [0, 0.27, -0.55]) {
          hud.reticleMesh.position.set(0, 0, -3);
          hud.markerMesh.position.set(0, 0, -5);
          for (const [mesh, distance] of [[hud.reticleMesh, 3], [hud.markerMesh, 5]] as const) {
            mesh.scale.set(distance * 1.5, distance * 1.5 * h / w, 1);
            mesh.rotation.set(0.1, angle, -0.13);
          }
          for (const eye of [-0.032, 0.032]) {
            cam.position.set(eye, 0.08, 0); cam.updateMatrixWorld(true);
            const draw = (crop: boolean, pixels: Uint8Array) => {
              hud.cropWorldLayers = crop;
              renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, cam);
              renderer.readRenderTargetPixels(target, 0, 0, 960, 960, pixels);
            };
            draw(false, a); draw(true, b);
            let different = 0, drawn = 0;
            for (let p = 0; p < a.length; p += 4) {
              if (a[p]) drawn++;
              if (a[p] !== b[p] || a[p + 3] !== b[p + 3]) different++;
            }
            rows.push({ width: w, height: h, marker, angle, eye, drawn, different, coverage: hud.layerCoverage });
          }
        }
      }
    }
    if (rows.some((r) => r.drawn === 0 || r.different > 2)) throw Error(`HUD crop mismatch: ${JSON.stringify(rows)}`);
    return rows;
  } finally { hud.dispose(); renderer.dispose(); target.dispose(); }
}
