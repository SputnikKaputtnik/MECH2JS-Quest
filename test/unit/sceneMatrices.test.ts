import { expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneNode, WorldObject } from '../../src/generated/classes.gen.ts';
import { SceneRenderer, type ObjEntry } from '../../src/render/SceneRenderer.ts';

it('reuses clean world matrices but follows motion, carried parts, parent motion and reparenting', () => {
  const sr = new SceneRenderer();
  const object = new WorldObject();
  object.type = 0x100; object.index = 3;
  object.node = new SceneNode();
  object.node.worldBlock.set([0x20000000, 0, 0, 0, 0x20000000, 0, 0, 0, 0x20000000, 0, 0, 0]);
  const enter = (scene = sr.scene) => (sr as unknown as { entry(o: WorldObject, scene: THREE.Scene): ObjEntry }).entry(object, scene);
  const at = (e: ObjEntry) => e.group.matrixWorld.elements.slice(12, 15);
  try {
    sr.scene.matrix.makeTranslation(10, 0, 0); sr.scene.matrixWorldNeedsUpdate = true; sr.scene.updateMatrixWorld();
    let entry = enter(); sr.scene.updateMatrixWorld();
    expect(at(entry)).toEqual([10, 0, 0]); // new identity child under an already clean parent
    expect(enter().group.matrixWorldNeedsUpdate).toBe(false);
    object.node.worldBlock[9] = 250;
    enter(); sr.scene.updateMatrixWorld(); expect(at(entry)).toEqual([12.5, 0, 0]);
    sr.carryOwned(3, new THREE.Matrix4().makeTranslation(1, 2, 3));
    sr.scene.updateMatrixWorld(); expect(at(entry)).toEqual([13.5, 2, 3]);
    enter(); sr.scene.updateMatrixWorld(); expect(at(entry)).toEqual([12.5, 0, 0]);
    sr.scene.matrix.makeTranslation(20, 0, 0); sr.scene.matrixWorldNeedsUpdate = true;
    enter(); sr.scene.updateMatrixWorld(); expect(at(entry)).toEqual([22.5, 0, 0]);
    object.node = null; enter(); sr.scene.updateMatrixWorld(); expect(at(entry)).toEqual([20, 0, 0]);
    sr.backdropScene.matrix.makeTranslation(-5, 0, 0); sr.backdropScene.matrixWorldNeedsUpdate = true; sr.backdropScene.updateMatrixWorld();
    entry = enter(sr.backdropScene); sr.backdropScene.updateMatrixWorld(); expect(at(entry)).toEqual([-5, 0, 0]);
  } finally { sr.destroy(); }
});
