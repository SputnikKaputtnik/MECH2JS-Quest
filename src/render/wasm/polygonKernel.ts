/** @portOnly Experimental mesh-wide C/Wasm pipeline. Bridge/copies are included in benchmarks. */
import type { BufferAttribute } from 'three';
import type { MeshEntry } from '../SceneRenderer.ts';
import { sqrtTable } from '../../engine/scene/worldObject.ts';
import { lighting } from '../../sim/world/environment.ts';
import { HOOK, renderOptions } from '../../sim/display/renderState.ts';
import { polygonResolveColour, type LightLatch } from '../shading/polygonColour.ts';
import type { ColourFn } from '../pipeline/hooks.ts';
import { renderView } from '../pipeline/viewLatch.ts';

interface KernelExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  address: (which: number) => number;
  process: (vertices: number, polygons: number, baked: number) => number;
}
let kernel: PolygonKernel | null = null;
let loading: Promise<PolygonKernel> | null = null;
export function currentPolygonKernel(): PolygonKernel | null { return kernel; }
export function loadPolygonKernel(): Promise<PolygonKernel> {
  return loading ??= (async () => {
    const response = await fetch(new URL('./polygons.wasm', import.meta.url));
    if (!response.ok) throw Error(`Polygon Wasm HTTP ${response.status}`);
    kernel = await PolygonKernel.create(await response.arrayBuffer());
    return kernel;
  })().catch(error => { loading = null; throw error; });
}

/** One bounded scratch arena, reused synchronously; no retained mission/mesh references. */
export class PolygonKernel {
  private readonly c: Int32Array;
  private readonly v: Int32Array;
  private readonly p: Int32Array;
  private readonly ix: Int32Array;
  private readonly draws: Float32Array;
  private readonly positions: Float32Array;
  private readonly uvs: Float32Array;
  private readonly clipped: Uint8Array;
  private readonly changes: Int32Array;
  private readonly result: Int32Array;
  private constructor(private readonly wasm: KernelExports) {
    const b = wasm.memory.buffer;
    const ints = (id: number, n: number) => new Int32Array(b, wasm.address(id), n);
    this.c = ints(0, 20); this.v = ints(1, 4096 * 8); this.p = ints(2, 8192 * 13);
    this.ix = ints(3, 65536); ints(4, 1024).set(sqrtTable);
    this.draws = new Float32Array(b, wasm.address(5), 131072);
    this.positions = new Float32Array(b, wasm.address(6), 131072 * 3);
    this.uvs = new Float32Array(b, wasm.address(7), 131072 * 2);
    this.clipped = new Uint8Array(b, wasm.address(8), 8192);
    this.changes = ints(9, 8192 * 3); this.result = ints(10, 4);
  }
  static async create(bytes: BufferSource): Promise<PolygonKernel> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new PolygonKernel(instance.exports as KernelExports);
  }
  /** null means unsupported: caller executes TS with no mesh/output mutation. */
  shade(m: MeshEntry, L: LightLatch, colour: ColourFn): number | null {
    const b = m.block, nv = b.vertexCount, np = b.polygonCount, opt = renderOptions;
    if (colour !== polygonResolveColour || opt.polygonFillHook !== HOOK.polyFillByMode || opt.wireframeMode !== 0 || m.lines ||
      nv > 4096 || np > 8192 || m.draw.length > 131072 || m.uvIndex.some(x => x !== 0)) return null;
    let offset = 0;
    for (let i = 0; i < np; i++) {
      const p = b.polygons[i]!, n = p.vertexCount, owner = p.owner;
      if (n < 1 || n > nv || offset + n > this.ix.length || (p.code & 0x7000) === 0x2000) return null;
      const at = i * 13;
      this.p[at] = n; this.p[at + 1] = p.normalX; this.p[at + 2] = p.normalY; this.p[at + 3] = p.normalZ;
      this.p[at + 4] = p.code; this.p[at + 5] = owner?.type ?? 0; this.p[at + 6] = owner?.flags ?? 0;
      this.p[at + 7] = owner ? 1 : 0; this.p[at + 8] = m.polyStart[i]!; this.p[at + 9] = m.polyTris[i]!;
      this.p[at + 10] = m.spriteStart[i]!; this.p[at + 11] = m.sprite[i]!; this.p[at + 12] = offset;
      for (let k = 0; k < n; k++) {
        const index = p.indices[k]!;
        if (!Number.isInteger(index) || index < 0 || index >= nv) return null;
        this.ix[offset++] = index;
      }
    }
    for (let i = 0; i < nv; i++) {
      const v = b.vertices[i]!, at = i * 8;
      this.v[at] = v.worldX; this.v[at + 1] = v.worldY; this.v[at + 2] = v.worldZ;
      this.v[at + 3] = v.modelX; this.v[at + 4] = v.modelY; this.v[at + 5] = v.modelZ;
      this.v[at + 6] = v.texU; this.v[at + 7] = v.texV;
    }
    const r = renderView, c = this.c;
    c[0] = r.viewTranslationX; c[1] = r.viewTranslationY; c[2] = r.viewTranslationZ;
    c[3] = r.viewDepthRowX; c[4] = r.viewDepthRowY; c[5] = r.viewDepthRowZ;
    c[6] = r.viewNearClipScaled; c[7] = r.viewFarClipScaled; c[8] = r.polySortFlags;
    c[9] = L.ambientLight; c[10] = L.lightDirectional; c[11] = L.lightX; c[12] = L.lightY; c[13] = L.lightZ;
    c[14] = lighting.lightDimDistance; c[15] = lighting.damageShadeRaises;
    c[16] = opt.polygonRampOverride; c[17] = opt.textureOffTypeMask;
    this.draws.set(m.draw); this.clipped.set(m.clipped);
    const queued = this.wasm.process(nv, np, +m.baked);
    if (queued < 0) return null;
    const geo = m.mesh.geometry;
    if (this.result[1]) {
      m.draw.set(this.draws.subarray(0, m.draw.length));
      (geo.getAttribute('aDraw') as BufferAttribute).needsUpdate = true;
    }
    const changes = this.result[2]!;
    for (let i = 0; i < changes; i++) {
      const poly = this.changes[i * 3]!, crossing = this.changes[i * 3 + 1] === 1;
      const start = m.polyStart[poly]!, end = start + this.changes[i * 3 + 2]!;
      m.pos.set((crossing ? this.positions : m.basePos).subarray(start * 3, end * 3), start * 3);
      m.uv.set((crossing ? this.uvs : m.baseUv).subarray(start * 2, end * 2), start * 2);
      m.clipped[poly] = +crossing;
    }
    if (changes) {
      (geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
      (geo.getAttribute('aUv') as BufferAttribute).needsUpdate = true;
    }
    return queued;
  }
}
