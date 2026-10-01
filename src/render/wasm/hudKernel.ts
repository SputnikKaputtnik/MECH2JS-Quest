/** @portOnly One whole-window Wasm call, including input/output copies. */
import { HUD_LAYER, type VfxWindow } from '../../engine/vfx/vfx.ts';
interface HudExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  address: (which: number) => number;
  pack: (width: number, height: number, reticle: number, marker: number) => void;
}
const MAX_PIXELS = 1048576;
let kernel: HudKernel | null = null;
let loading: Promise<HudKernel> | null = null;
export function currentHudKernel(): HudKernel | null { return kernel; }
export function loadHudKernel(): Promise<HudKernel> {
  return loading ??= (async () => {
    const response = await fetch(new URL('./hud.wasm', import.meta.url));
    if (!response.ok) throw Error(`HUD Wasm HTTP ${response.status}`);
    kernel = await HudKernel.create(await response.arrayBuffer());
    return kernel;
  })().catch(error => { loading = null; throw error; });
}
export class HudKernel {
  private readonly inputs: Uint8Array[];
  private readonly output: Uint8Array;
  private readonly result: Float64Array;
  private constructor(private readonly wasm: HudExports) {
    const b = wasm.memory.buffer;
    this.inputs = [0, 1, 2, 3].map(i => new Uint8Array(b, wasm.address(i), MAX_PIXELS));
    this.output = new Uint8Array(b, wasm.address(4), MAX_PIXELS * 4);
    this.result = new Float64Array(b, wasm.address(5), 11);
  }
  static async create(bytes: BufferSource): Promise<HudKernel> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new HudKernel(instance.exports as HudExports);
  }
  /** Returned scratch reductions must be consumed before the next call. */
  pack(win: VfxWindow, w: number, h: number, output: Uint8Array): Float64Array | null {
    const n = w * h;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || n > MAX_PIXELS || output.length < n * 4 ||
      win.buffer.length < n || win.drawn.length < n || win.layer.length < n || win.inset.length < n) return null;
    this.inputs[0]!.set(win.buffer.subarray(0, n)); this.inputs[1]!.set(win.drawn.subarray(0, n));
    this.inputs[2]!.set(win.layer.subarray(0, n)); this.inputs[3]!.set(win.inset.subarray(0, n));
    this.wasm.pack(w, h, HUD_LAYER.reticle, HUD_LAYER.targetMarker);
    output.set(this.output.subarray(0, n * 4));
    return this.result;
  }
}
