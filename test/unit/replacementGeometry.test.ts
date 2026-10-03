import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MeshBlock, MeshPolygon, MeshVertex, SceneNode, WorldObject } from '../../src/generated/classes.gen.ts';
import { SceneRenderer, type MeshEntry, type ObjEntry } from '../../src/render/SceneRenderer.ts';
import { renderView } from '../../src/render/pipeline/viewLatch.ts';
import { HOOK, renderOptions } from '../../src/sim/display/renderState.ts';
import type { LightLatch } from '../../src/render/shading/polygonColour.ts';
import type { ColourFn } from '../../src/render/pipeline/hooks.ts';

type Internals = {
  entry(o: WorldObject, scene: THREE.Scene): ObjEntry;
  shade(m: MeshEntry, light: LightLatch, colour: ColourFn): number;
  entries: Map<WorldObject, ObjEntry>;
  replacementEntries: WeakMap<SceneNode, ObjEntry>;
};
function object(node: SceneNode | null) {
  const o = new WorldObject(); o.type = 0x100; o.index = 4; o.node = node;
  if (node) node.userData = o;
  const b = o.meshList = new MeshBlock();
  b.vertices = [[-100, 0, 1000], [100, 0, 1000], [0, 100, 1000]].map(([x, y, z]) => {
    const v = new MeshVertex(); v.modelX = v.worldX = x!; v.modelY = v.worldY = y!; v.modelZ = v.worldZ = z!; return v;
  }); b.vertexCount = 3;
  const p = new MeshPolygon(); p.owner = o; p.vertexCount = 3; p.indices = [0, 1, 2]; p.code = 0x1001;
  p.normalZ = -65536;
  b.polygons = [p]; b.polygonCount = 1;
  return o;
}
function harness() {
  const sr = new SceneRenderer(), internal = sr as unknown as Internals;
  return { sr, internal, enter: (o: WorldObject, scene = sr.scene) => internal.entry(o, scene) };
}

it('transfers identical freed mech geometry, updates picking and pose, and releases it on clear', () => {
  const { sr, enter, internal } = harness();
  const node = new SceneNode(); node.worldBlock.set([0x20000000,0,0,0,0x20000000,0,0,0,0x20000000,0,0,0]);
  let o = object(node), entry = enter(o);
  const mesh = entry.meshes[0]!.mesh, dispose = vi.spyOn(mesh.geometry, 'dispose');
  try {
    for (let i = 0; i < 500; i++) {
      o.meshList = null; o.currentMesh = null; // objectFree's relevant contract
      o = object(node); node.worldBlock[9] = i * 100;
      entry = enter(o);
      expect(entry.meshes[0]!.mesh).toBe(mesh);
      expect(entry.meshes[0]!.block).toBe(o.meshList);
      expect(sr.objectOf(mesh)).toBe(o);
      expect(internal.entries.size).toBe(1);
      expect(entry.group.matrix.elements[12]).toBe(i);
    }
    expect(dispose).not.toHaveBeenCalled();
    o.node = null; // destruction may detach the object before renderer cleanup
    sr.clear(); expect(dispose).toHaveBeenCalledTimes(1); expect(sr.objectOf(mesh)).toBeNull();
    expect(internal.replacementEntries.get(node)).toBeUndefined();
    expect(enter(object(node)).meshes[0]!.mesh).not.toBe(mesh);
  } finally { sr.destroy(); }
});

it.each(['position','uv','indices','code','vertices','polygons','extraLod','type','owner','behind','live','baked','otherPass','disabled'])(
  'does not transfer incompatible %s geometry', change => {
    const { sr, enter } = harness(); const node = new SceneNode();
    const old = object(change === 'baked' ? null : node), first = enter(old);
    if (change !== 'live') old.meshList = null;
    const next = object(change === 'baked' ? null : node), b = next.meshList!;
    if (change === 'position') b.vertices[0]!.modelX++;
    if (change === 'uv') b.vertices[0]!.texU++;
    if (change === 'indices') b.polygons[0]!.indices = [0, 2, 1];
    if (change === 'code') b.polygons[0]!.code = 0x3001;
    if (change === 'vertices') { b.vertices.push(new MeshVertex()); b.vertexCount++; }
    if (change === 'polygons') { b.polygons = []; b.polygonCount = 0; }
    if (change === 'extraLod') b.next = new MeshBlock();
    if (change === 'type') next.type = 0x150;
    if (change === 'owner') next.index++;
    if (change === 'behind') next.flags |= 1;
    if (change === 'disabled') sr.reuseReplacementGeometry = false;
    try { expect(enter(next, change === 'otherPass' ? sr.backdropScene : sr.scene).meshes[0]!.mesh).not.toBe(first.meshes[0]!.mesh); }
    finally { sr.destroy(); }
  },
);

it('matches a fresh render entry after repeated near clipping and new shading state', () => {
  const reused = harness(), reference = harness(), node = new SceneNode();
  reference.sr.reuseReplacementGeometry = false;
  const savedView = { ...renderView }, savedOptions = { ...renderOptions };
  Object.assign(renderView, { viewTranslationX:0, viewTranslationY:0, viewTranslationZ:0,
    viewDepthRowX:0, viewDepthRowY:0, viewDepthRowZ:0x20000000, viewNearClipScaled:400, viewFarClipScaled:100000, polySortFlags:0 });
  Object.assign(renderOptions, { wireframeMode:0, polygonFillHook:HOOK.polyFillByMode });
  let old: WorldObject | null = null, drawn = 0;
  let first: THREE.Mesh | null = null;
  try {
    for (let frame = 0; frame < 24; frame++) {
      if (old) old.meshList = null;
      const next = object(node), b = next.meshList!;
      if (frame % 2) b.vertices[0]!.worldZ = 50;
      const a = reused.enter(next).meshes[0]!, z = reference.enter(next).meshes[0]!;
      first ??= a.mesh; expect(a.mesh).toBe(first);
      const colour: ColourFn = (p) => { expect(p.owner).toBe(next); return 0x1000 | (frame + 1); };
      const qa = reused.internal.shade(a, renderView.light, colour);
      expect(qa).toBe(reference.internal.shade(z, renderView.light, colour)); drawn += qa;
      expect(a.draw).toEqual(z.draw);
      for (let v = 0; v < a.draw.length; v++) if (a.draw[v]! >= 0) {
        expect(a.pos.slice(v*3,v*3+3)).toEqual(z.pos.slice(v*3,v*3+3));
        expect(a.uv.slice(v*2,v*2+2)).toEqual(z.uv.slice(v*2,v*2+2));
      }
      reference.sr.clear(); old = next;
    }
    expect(drawn).toBeGreaterThan(0);
  } finally { reused.sr.destroy(); reference.sr.destroy(); Object.assign(renderView,savedView); Object.assign(renderOptions,savedOptions); }
});
