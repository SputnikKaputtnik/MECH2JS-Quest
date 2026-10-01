import { expect, it } from 'vitest';
import { HudOverlay } from '../../src/render/passes/hudOverlay.ts';
import { makeUniforms } from '../../src/render/materials/indexedMaterial.ts';
import { VfxWindow, vfxWindowAllocate, HUD_LAYER } from '../../src/engine/vfx/vfx.ts';

it('reuses HUD pixels between simulation passes while preserving every changed image and layer', () => {
  const cached = new HudOverlay(makeUniforms());
  const reference = new HudOverlay(makeUniforms());
  let win = new VfxWindow(); vfxWindowAllocate(win, 8, 6);
  for (let frame = 0; frame < 20; frame++) {
    const changed = frame % 4 === 0;
    if (frame === 7) { win = new VfxWindow(); vfxWindowAllocate(win, 10, 4); }
    if (changed) {
      win.buffer.fill(frame);
      win.drawn.fill(1);
      win.layer.fill(HUD_LAYER.rest);
      win.layer[frame % win.layer.length] = HUD_LAYER.reticle;
      win.inset[0] = frame % 3;
    }
    const before = cached.windowUniforms.uWindow.value?.version;
    expect(cached.update(win, 1680 + frame, 1760, changed)).toBe(true);
    reference.update(win, 1680 + frame, 1760);
    expect(cached.windowUniforms.uWindow.value!.image.data).toEqual(reference.windowUniforms.uWindow.value!.image.data);
    expect(cached.reticleCentre).toEqual(reference.reticleCentre);
    if (!changed && frame !== 7) expect(cached.windowUniforms.uWindow.value!.version).toBe(before);
  }
  cached.dispose(); reference.dispose();
});
