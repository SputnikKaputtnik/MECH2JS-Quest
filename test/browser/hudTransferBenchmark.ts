/** @portOnly Isolate the HUD bridge's copies from its SIMD arithmetic.
 * Uses a private instance: never overwrites a live HUD kernel's scratch data.
 * These isolated CPU timings exclude texture uploads, GPU execution and XR.
 */
import { HUD_LAYER, type VfxWindow } from '../../src/engine/vfx/vfx.ts';

interface Exports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  address: (which: number) => number;
  pack: (width: number, height: number, reticle: number, marker: number) => void;
}

export async function runHudTransferBenchmark(win: VfxWindow) {
  const width = win.xMax + 1, height = win.yMax + 1, pixels = width * height;
  const planes = [win.buffer, win.drawn, win.layer, win.inset];
  if (pixels < 1 || pixels > 1048576 || planes.some(p => p.length < pixels)) throw Error('Invalid HUD transfer fixture');
  const response = await fetch(new URL('../../src/render/wasm/hud.wasm', import.meta.url));
  if (!response.ok) throw Error(`HUD Wasm HTTP ${response.status}`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  const wasm = instance.exports as Exports, memory = wasm.memory.buffer;
  const inputs = planes.map((_, i) => new Uint8Array(memory, wasm.address(i), pixels));
  const packed = new Uint8Array(memory, wasm.address(4), pixels * 4);
  const output = new Uint8Array(pixels * 4);
  const copyInputs = () => {
    for (let i = 0; i < 4; i++) inputs[i]!.set(planes[i]!.subarray(0, pixels));
  };
  const pack = () => wasm.pack(width, height, HUD_LAYER.reticle, HUD_LAYER.targetMarker);
  const copyOutput = () => output.set(packed.subarray(0, pixels * 4));
  const stages = { inputMs: copyInputs, kernelMs: pack, outputMs: copyOutput };
  const rounds: { inputMs: number; kernelMs: number; outputMs: number }[] = [];
  const repeats = 32;
  for (let round = 0; round < 28; round++) {
    const timing = { inputMs: 0, kernelMs: 0, outputMs: 0 };
    // Establish valid inputs before timing; repeated stages are deliberately
    // isolated and cache-warm, so their sum is NOT a whole-update prediction.
    copyInputs(); pack();
    for (const key of Object.keys(stages) as (keyof typeof stages)[]) {
      const start = performance.now();
      for (let i = 0; i < repeats; i++) stages[key]();
      timing[key] = (performance.now() - start) / repeats;
    }
    if (round >= 8) rounds.push(timing);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  for (let i = 0; i < pixels; i++) {
    if (output[i * 4] !== win.buffer[i] || output[i * 4 + 1] !== (win.drawn[i] ? 255 - win.layer[i]! : 0) ||
      output[i * 4 + 2] !== win.inset[i] || output[i * 4 + 3] !== 0) throw Error(`HUD transfer mismatch at ${i}`);
  }
  const mean = (key: keyof typeof stages) => rounds.reduce((s, r) => s + r[key], 0) / rounds.length;
  return { kind: 'isolated-hud-transfer-cpu', width, height, repeats, rounds, inputBytes: pixels * 4, outputBytes: pixels * 4,
    inputMs: mean('inputMs'), kernelMs: mean('kernelMs'), outputMs: mean('outputMs'), mismatches: 0,
    note: 'Each stage measured separately with warm caches; do not sum into a frame-time estimate. No GPU upload or XR timing.' };
}
