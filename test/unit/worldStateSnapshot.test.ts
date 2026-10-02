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
