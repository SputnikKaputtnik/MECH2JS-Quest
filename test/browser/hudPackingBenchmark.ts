/** @portOnly Whole HUD update with all Wasm transfers; no GPU upload/render timing. */
import { HudOverlay } from '../../src/render/passes/hudOverlay.ts';
import { HudOverlay as ReferenceHudOverlay } from '../reference/hudOverlay.ts';
import { makeUniforms } from '../../src/render/materials/indexedMaterial.ts';
import { VfxWindow, vfxWindowAllocate } from '../../src/engine/vfx/vfx.ts';
export async function runHudPackingBenchmark(source: VfxWindow) {
  const rows = [];
  for (const mode of ['captured', 'markers', 'inset']) {
    const win = new VfxWindow(), w = source.xMax + 1, h = source.yMax + 1;
    vfxWindowAllocate(win, w, h);
    win.buffer.set(source.buffer); win.drawn.set(source.drawn); win.layer.set(source.layer); win.inset.set(source.inset);
    if (mode === 'markers') for (let i = 0; i < w * h; i++) {
      if (i % 97 === 0) { win.drawn[i] = 1; win.layer[i] = i % 2 + 1; }
    }
    if (mode === 'inset') { win.drawn.fill(1); win.layer.fill(0); win.inset.fill(1); }
    const a = new ReferenceHudOverlay(makeUniforms()), b = new HudOverlay(makeUniforms()), c = new HudOverlay(makeUniforms());
    try {
      await b.prepareWasmPacking();
      c.wasmPacking = false;
      const rounds: { jsMs: number; wasmMs: number; fallbackMs: number }[] = [];
      const measure = (hud: HudOverlay | ReferenceHudOverlay) => {
        const start = performance.now();
        for (let i = 0; i < 8; i++) hud.update(win, 2100, 2200);
        return (performance.now() - start) / 8;
      };
      for (let round = 0; round < 28; round++) {
        const values = (round % 2 ? [c, b, a] : [a, b, c]).map(measure);
        if (round >= 8) rounds.push({ jsMs: values[round % 2 ? 2 : 0]!, wasmMs: values[1]!, fallbackMs: values[round % 2 ? 0 : 2]! });
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const ab = a.windowUniforms.uWindow.value!.image.data!, bb = b.windowUniforms.uWindow.value!.image.data!;
      if (ab.length !== bb.length || ab.some((v, i) => v !== bb[i]) || !a.reticleMesh.material.uniforms.uBounds!.value.equals(b.reticleMesh.material.uniforms.uBounds!.value) ||
        !a.markerMesh.material.uniforms.uBounds!.value.equals(b.markerMesh.material.uniforms.uBounds!.value)) throw Error('HUD bytes/bounds changed');
      const mean = (key: keyof typeof rounds[number]) => rounds.reduce((s, r) => s + r[key], 0) / rounds.length;
      rows.push({ mode, width: w, height: h, rounds, jsMs: mean('jsMs'), wasmMs: mean('wasmMs'), fallbackMs: mean('fallbackMs'), mismatches: 0 });
    } finally { a.dispose(); b.dispose(); c.dispose(); }
  }
  return { kind: 'whole-hud-update-with-copies', rows, note: 'Frozen input, no GPU texture upload or XR FPS included.' };
}
