import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MeshBlock, MeshPolygon, MeshVertex, SceneNode, Viewer, WorldObject } from '../../src/generated/classes.gen.ts';
import { worldRootNode } from '../../src/engine/scene/objectLists.ts';
import { viewScene } from '../../src/sim/world/viewScene.ts';
import { renderOptions, HOOK } from '../../src/sim/display/renderState.ts';
import { cameraGlobals } from '../../src/sim/camera/viewer.ts';
import { lighting } from '../../src/sim/world/environment.ts';
import { renderView } from '../../src/render/pipeline/viewLatch.ts';
import { makeUniforms } from '../../src/render/materials/indexedMaterial.ts';
import { encodeWorldState, WorldStateRenderer } from '../../src/render/snapshot/worldState.ts';
import type { SceneInput } from '../../src/render/SceneRenderer.ts';
import * as THREE from 'three';

let restore: () => void;
beforeEach(() => {
  const options = { ...renderOptions }, roots = [worldRootNode.listNext, viewScene.backdropNode, viewScene.cockpitHeadNode] as const;
  const state = { cockpit: cameraGlobals.cockpitViewActive, dim: lighting.lightDimDistance, damage: lighting.damageShadeRaises, view: { ...renderView } };
  restore = () => {
    Object.assign(renderOptions, options);
    [worldRootNode.listNext, viewScene.backdropNode, viewScene.cockpitHeadNode] = roots;
    cameraGlobals.cockpitViewActive = state.cockpit; lighting.lightDimDistance = state.dim; lighting.damageShadeRaises = state.damage;
    Object.assign(renderView, state.view);
  };
  Object.assign(renderOptions, { objectCullHook: HOOK.objectCullMainView, polygonDrawHook: HOOK.polygonResolveColour,
    polygonFillHook: HOOK.polyFillByMode, clipProjectHook: HOOK.clipProjectPerspective });
  viewScene.backdropNode = viewScene.cockpitHeadNode = null;
});
afterEach(() => { vi.restoreAllMocks(); restore(); });

function fixture() {
  const viewer = new Viewer(); viewer.rotation.set([1 << 29, 0, 0, 0, 1 << 29, 0, 0, 0, 1 << 29]);
  viewer.zoom = 65536; viewer.nearClip = 8; viewer.farClip = viewer.field_0xb4 = 100000;
  const object = new WorldObject(); object.posZ = -10000; object.flags = 17; object.node = new SceneNode();
  object.node.worldBlock.set([65536, 0, 0, 0, 65536, 0, 0, 0, 65536, 3, 4, 5]);
  const near = new MeshBlock(), far = new MeshBlock(); near.next = far; near.lodKey = 1; far.lodKey = 100;
  for (const mesh of [near, far]) {
    mesh.vertexCount = 3; mesh.polygonCount = 1;
    mesh.vertices = [new MeshVertex(), new MeshVertex(), new MeshVertex()]; mesh.vertices[0]!.modelX = 123;
    const polygon = new MeshPolygon(); polygon.owner = object; polygon.indices = [0, 1, 2]; polygon.vertexCount = 3;
    mesh.polygons = [polygon];
  }
  object.meshList = near; worldRootNode.listNext = object;
  return { object, viewer, uniforms: makeUniforms() };
}

it('retains all LODs and polygon ownership independently of live object lists', () => {
  const { object, viewer, uniforms } = fixture();
  const bytes = encodeWorldState(viewer, uniforms);
  const consumer = new WorldStateRenderer(structuredClone(bytes, { transfer: [bytes.buffer] }));
  object.meshList!.vertices[0]!.modelX = 999;
  object.node!.worldBlock.fill(0); worldRootNode.listNext = null;
  let copied: SceneInput | undefined;
  vi.spyOn(consumer.renderer, 'sync').mockImplementation((_view, scene) => { copied = scene; });
  consumer.sync();
  const result = [...copied!.world][0]!;
  expect(result).not.toBe(object);
  expect(result.posZ).toBe(-10000); // retained even behind the original camera
  expect(result.meshList!.next!.lodKey).toBe(100);
  expect(result.meshList!.vertices[0]!.modelX).toBe(123);
  expect(result.meshList!.polygons[0]!.owner).toBe(result);
  expect([...result.node!.worldBlock.slice(9)]).toEqual([3, 4, 5]);
  consumer.dispose(); consumer.dispose();
  expect(() => consumer.sync()).toThrow('Disposed');
});

it('restores drawing globals even if consumer preparation throws', () => {
  const { viewer, uniforms } = fixture();
  cameraGlobals.cockpitViewActive = 1; lighting.lightDimDistance = 1000;
  const consumer = new WorldStateRenderer(encodeWorldState(viewer, uniforms));
  cameraGlobals.cockpitViewActive = 0; lighting.lightDimDistance = 3000;
  renderOptions.wireframeMode = 2; renderView.polySortFlags = 77;
  vi.spyOn(consumer.renderer, 'sync').mockImplementation(() => {
    expect(cameraGlobals.cockpitViewActive).toBe(1);
    expect(lighting.lightDimDistance).toBe(1000);
    throw Error('prepare failed');
  });
  expect(() => consumer.sync()).toThrow('prepare failed');
  expect(cameraGlobals.cockpitViewActive).toBe(0); expect(lighting.lightDimDistance).toBe(3000);
  expect(renderOptions.wireframeMode).toBe(2); expect(renderView.polySortFlags).toBe(77);
  consumer.dispose();
});

it('rejects a map snapshot instead of reading uncaptured radar and allegiance state', () => {
  const { viewer, uniforms } = fixture();
  renderOptions.polygonDrawHook = HOOK.mapPolygonColour;
  expect(() => encodeWorldState(viewer, uniforms)).toThrow('main perspective');
});

it('reuses object/LOD/texture identities across reordered lists and state changes', () => {
  const { object, viewer, uniforms } = fixture();
  const other = new WorldObject(); other.posX = 321; object.listNext = other;
  const consumer = new WorldStateRenderer(encodeWorldState(viewer, uniforms));
  let copied: SceneInput | undefined;
  vi.spyOn(consumer.renderer, 'sync').mockImplementation((_view, scene) => { copied = scene; });
  consumer.sync();
  const [original, second] = [...copied!.world];
  const mesh = original!.meshList, vertex = mesh!.vertices[0], polygon = mesh!.polygons[0];
  const palette = consumer.renderer.uniforms.uPalette.value;
  const atlas = consumer.renderer.uniforms.uAtlas.value;
  const atlasVersion = atlas.version;
  const evict = vi.spyOn(consumer.renderer, 'forgetObject');
  object.posX = 500; object.node!.worldBlock[9] = 400;
  object.meshList!.polygons[0]!.normalX = 456;
  other.listNext = object; object.listNext = null; worldRootNode.listNext = other;
  (uniforms.uPalette.value.image.data as Uint8Array)[0] = 123;
  consumer.apply(encodeWorldState(viewer, uniforms)); consumer.sync();
  expect([...copied!.world]).toEqual([second, original]);
  expect(original!.posX).toBe(500); expect(original!.node!.worldBlock[9]).toBe(400);
  expect(original!.meshList).toBe(mesh); expect(mesh!.vertices[0]).toBe(vertex);
  expect(mesh!.polygons[0]).toBe(polygon); expect(polygon!.normalX).toBe(456);
  expect(polygon!.owner).toBe(original);
  expect(consumer.renderer.uniforms.uPalette.value).toBe(palette);
  expect(palette.image.data![0]).toBe(123);
  expect(atlas.version).toBe(atlasVersion);
  expect(evict).not.toHaveBeenCalled();
  consumer.dispose();
});

it('invalidates geometry edits, retires deleted objects and handles reappearance', () => {
  const { object, viewer, uniforms } = fixture();
  const consumer = new WorldStateRenderer(encodeWorldState(viewer, uniforms));
  let copied: SceneInput | undefined;
  vi.spyOn(consumer.renderer, 'sync').mockImplementation((_view, scene) => { copied = scene; });
  consumer.sync(); const original = [...copied!.world][0]!;
  const mesh = original.meshList;
  const evict = vi.spyOn(consumer.renderer, 'forgetObject');
  object.meshList!.vertices[0]!.modelX = 999;
  object.meshList!.polygons[0]!.indices.reverse();
  consumer.apply(encodeWorldState(viewer, uniforms));
  expect(evict).toHaveBeenCalledWith(original);
  expect(original.meshList).not.toBe(mesh);
  expect(original.meshList!.vertices[0]!.modelX).toBe(999);
  const edited = original.meshList;
  object.meshList!.polygonCount = 0; // inactive records may still occupy storage
  consumer.apply(encodeWorldState(viewer, uniforms));
  expect(original.meshList).not.toBe(edited);
  worldRootNode.listNext = null;
  evict.mockClear(); consumer.apply(encodeWorldState(viewer, uniforms)); consumer.sync();
  expect([...copied!.world]).toHaveLength(0);
  expect(evict).toHaveBeenCalledExactlyOnceWith(original);
  worldRootNode.listNext = object;
  consumer.apply(encodeWorldState(viewer, uniforms)); consumer.sync();
  expect([...copied!.world][0]).not.toBe(original);
  consumer.dispose();
  expect(() => consumer.apply(encodeWorldState(viewer, uniforms))).toThrow('Disposed');
});

it('reallocates changed texture storage while preserving the shared uniform holder', () => {
  const { viewer, uniforms } = fixture();
  const consumer = new WorldStateRenderer(encodeWorldState(viewer, uniforms));
  const holder = consumer.renderer.uniforms.uAtlas, texture = holder.value;
  const disposed = vi.fn(); texture.addEventListener('dispose', disposed);
  const next = new THREE.DataTexture(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 8, 1, THREE.RedFormat);
  uniforms.uAtlas.value = next;
  consumer.apply(encodeWorldState(viewer, uniforms));
  expect(holder.value).toBe(texture); expect(texture.image.width).toBe(8);
  expect([...texture.image.data as Uint8Array]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(disposed).toHaveBeenCalledTimes(1);
  consumer.dispose(); expect(disposed).toHaveBeenCalledTimes(2);
});

it('retires cockpit cache entries even when the object remains in the world', () => {
  const { object, viewer, uniforms } = fixture();
  viewScene.cockpitHeadNode = new SceneNode(); viewScene.cockpitHeadNode.userData = object;
  const consumer = new WorldStateRenderer(encodeWorldState(viewer, uniforms));
  const evict = vi.spyOn(consumer.renderer, 'forgetObject');
  viewScene.cockpitHeadNode = null;
  consumer.apply(encodeWorldState(viewer, uniforms));
  expect(evict).toHaveBeenCalledTimes(1);
  consumer.dispose();
});
