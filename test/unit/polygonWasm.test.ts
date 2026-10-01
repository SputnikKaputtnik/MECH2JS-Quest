import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import { MeshBlock, MeshPolygon, MeshVertex, SceneNode, WorldObject } from '../../src/generated/classes.gen.ts';
import { SceneRenderer, type MeshEntry, type ObjEntry } from '../../src/render/SceneRenderer.ts';
import { PolygonKernel } from '../../src/render/wasm/polygonKernel.ts';
import { renderView } from '../../src/render/pipeline/viewLatch.ts';
import { polygonResolveColour, type LightLatch } from '../../src/render/shading/polygonColour.ts';
import type { ColourFn } from '../../src/render/pipeline/hooks.ts';
import { HOOK, renderOptions } from '../../src/sim/display/renderState.ts';
import { lighting } from '../../src/sim/world/environment.ts';

let kernel: PolygonKernel;
beforeAll(async () => { kernel = await PolygonKernel.create(new Uint8Array(readFileSync('src/render/wasm/polygons.wasm'))); });
type Internals = { entry(o: WorldObject, scene: THREE.Scene): ObjEntry; shade(m: MeshEntry, l: LightLatch, c: ColourFn): number };
function fixture(baked: boolean) {
  const object = new WorldObject(); object.type = 0x100;
  if (!baked) object.node = new SceneNode();
  const b = object.meshList = new MeshBlock();
  b.vertices = Array.from({ length: 24 }, (_, i) => {
    const v = new MeshVertex(); v.modelX = v.worldX = (i % 3 - 1) * 700;
    v.modelY = v.worldY = i * 90; v.modelZ = v.worldZ = 1000 + i * 200;
    v.texU = i % 3 ? 0 : 12; v.texV = i % 2 ? 12 : 0; return v;
  }); b.vertexCount = b.vertices.length;
  b.polygons = Array.from({ length: 6 }, (_, i) => {
    const p = new MeshPolygon(); p.owner = object; p.code = 0x3001;
    p.vertexCount = 3 + i % 4; p.indices = Array.from({ length: p.vertexCount }, (_, k) => (i * 3 + k) % 24);
    p.normalZ = -65536; return p;
  }); b.polygonCount = b.polygons.length;
  const a = new SceneRenderer(), z = new SceneRenderer();
  const am = (a as unknown as Internals).entry(object, a.scene).meshes[0]!;
  const zm = (z as unknown as Internals).entry(object, z.scene).meshes[0]!;
  return { object, b, a, z, am, zm };
}

it('matches the complete TS mesh output over motion, near/far clipping, lighting, damage and draw modes', () => {
  let state = 193726;
  const rand = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state | 0; };
  const saved = { ...renderOptions }, lightSaved = { ...lighting }, viewSaved = { ...renderView };
  Object.assign(renderOptions, { wireframeMode: 0, polygonFillHook: HOOK.polyFillByMode });
  Object.assign(renderView, { viewDepthRowX: 0, viewDepthRowY: 0, viewDepthRowZ: 0x20000000, viewNearClipScaled: 400, viewFarClipScaled: 200000 });
  let accepted = 0;
  try {
    for (const baked of [true, false]) {
      const f = fixture(baked);
      try {
        for (let frame = 0; frame < 1200; frame++) {
          renderView.polySortFlags = frame % 8;
          renderView.viewTranslationX = rand() % 10000; renderView.viewTranslationY = rand() % 10000;
          renderView.viewTranslationZ = rand() % 10000;
          if (frame % 11 === 0) { renderView.viewDepthRowX = rand(); renderView.viewDepthRowY = rand(); renderView.viewDepthRowZ = rand(); }
          else { renderView.viewDepthRowX = 0; renderView.viewDepthRowY = 0; renderView.viewDepthRowZ = 0x20000000; }
          for (const v of f.b.vertices) {
            v.worldX = rand() % 10000; v.worldY = rand() % 10000; v.worldZ = rand() % 100000;
            if (frame % 13 === 0) { v.worldX = rand(); v.worldY = rand(); v.worldZ = rand(); }
          }
          for (const p of f.b.polygons) {
            p.code = [0, 0x1000, 0x3000, 0x4000, 0x5000, 0x6000, 0x7000][(rand() >>> 0) % 7]! | (rand() & 0xfff);
            p.normalX = rand(); p.normalY = rand(); p.normalZ = rand();
          }
          f.object.type = [0x100, 0x50, 0x800, 0x20][frame % 4]!;
          f.object.flags = rand(); renderOptions.polygonRampOverride = frame % 2;
          renderOptions.textureOffTypeMask = [0, 0x100, 0x50, 0xffff][frame % 4]!;
          lighting.lightDimDistance = [0, 1000, -1500, -2147483648][frame % 4]!;
          lighting.damageShadeRaises = frame % 2;
          const L = { ambientLight: frame % 128, lightDirectional: frame % 2, lightX: rand(), lightY: rand(), lightZ: rand() };
          const expected = (f.a as unknown as Internals).shade(f.am, L, polygonResolveColour);
          const actual = kernel.shade(f.zm, L, polygonResolveColour);
          expect(actual, `queued ${frame}/${baked}`).toBe(expected); accepted++;
          expect(f.zm.draw, `draw ${frame}/${baked}`).toEqual(f.am.draw);
          expect(f.zm.pos, `position ${frame}/${baked}`).toEqual(f.am.pos);
          expect(f.zm.uv, `UV ${frame}/${baked}`).toEqual(f.am.uv);
          expect(f.zm.clipped, `clipped ${frame}/${baked}`).toEqual(f.am.clipped);
          // Alternate back to TS on the same buffers, then resume Wasm next frame.
          if (frame % 7 === 0) (f.z as unknown as Internals).shade(f.zm, L, polygonResolveColour);
        }
      } finally { f.a.destroy(); f.z.destroy(); }
    }
    expect(accepted).toBe(2400);
  } finally { Object.assign(renderOptions, saved); Object.assign(lighting, lightSaved); Object.assign(renderView, viewSaved); }
});

it('falls back without modifying output for unsupported hooks, outlines, wireframe and oversized meshes', () => {
  const f = fixture(true), saved = { ...renderOptions };
  const L = { ambientLight: 30, lightDirectional: 1, lightX: 65536, lightY: 65536, lightZ: 65536 };
  const before = f.zm.draw.slice();
  try {
    Object.assign(renderOptions, { wireframeMode: 1, polygonFillHook: HOOK.polyFillByMode });
    expect(kernel.shade(f.zm, L, polygonResolveColour)).toBeNull();
    renderOptions.wireframeMode = 0; f.b.polygons[0]!.code = 0x2000;
    expect(kernel.shade(f.zm, L, polygonResolveColour)).toBeNull();
    f.b.polygons[0]!.code = 0; f.b.vertexCount = 4097;
    expect(kernel.shade(f.zm, L, polygonResolveColour)).toBeNull();
    f.b.vertexCount = 24; renderOptions.polygonFillHook = HOOK.mapFillPolygon as typeof renderOptions.polygonFillHook;
    expect(kernel.shade(f.zm, L, polygonResolveColour)).toBeNull();
    expect(f.zm.draw).toEqual(before);
  } finally { Object.assign(renderOptions, saved); f.a.destroy(); f.z.destroy(); }
});
