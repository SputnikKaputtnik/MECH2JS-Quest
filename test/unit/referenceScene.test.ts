import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { encodeReferenceScene, ReferenceScene } from '../../src/render/snapshot/referenceScene.ts';
import { makeIndexedMaterial, makeUniforms } from '../../src/render/materials/indexedMaterial.ts';

it('owns geometry, palette, camera and draw ranges after transfer and source mutation', () => {
  const source = { backdrop: new THREE.Scene(), world: new THREE.Scene(), cockpit: new THREE.Scene(), camera: new THREE.PerspectiveCamera() };
  const uniforms = makeUniforms();
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([1, 2, 3, 4, 5, 6], 3));
  geometry.setDrawRange(1, 1);
  const mesh = new THREE.Mesh(geometry, makeIndexedMaterial(uniforms));
  mesh.position.set(3, 4, 5); mesh.visible = false; mesh.renderOrder = 7; mesh.layers.mask = 33;
  source.camera.position.set(9, 8, 7);
  source.world.matrixAutoUpdate = false;
  const group = new THREE.Group(); group.matrixAutoUpdate = false; group.matrix.makeTranslation(10, 0, 0);
  group.add(mesh); source.world.add(group);
  const bytes = encodeReferenceScene(source);
  const transferred = structuredClone(bytes, { transfer: [bytes.buffer] });
  expect(bytes.byteLength).toBe(0);
  const copy = new ReferenceScene(transferred);
  transferred.fill(0); // receiving GPU resources do not borrow the recyclable packet
  geometry.getAttribute('position').setX(0, 100);
  (uniforms.uPalette.value.image.data as Uint8Array).fill(99);
  source.camera.position.set(0, 0, 0); source.world.clear();
  const result = copy.world.children[0]!.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  expect(result.geometry.getAttribute('position').getX(0)).toBe(1);
  expect(result.geometry.drawRange).toEqual({ start: 1, count: 1 });
  expect(result.position.toArray()).toEqual([3, 4, 5]);
  expect(new THREE.Vector3().setFromMatrixPosition(result.matrixWorld).toArray()).toEqual([13, 4, 5]);
  expect([result.visible, result.renderOrder, result.layers.mask]).toEqual([false, 7, 33]);
  expect(copy.camera.position.toArray()).toEqual([9, 8, 7]);
  expect((result.material.uniforms.uPalette!.value as THREE.DataTexture).image.data![0]).toBe(0);
  const freeGeometry = vi.spyOn(result.geometry, 'dispose');
  const freeTexture = vi.spyOn(result.material.uniforms.uPalette!.value, 'dispose');
  copy.dispose(); copy.dispose();
  expect(freeGeometry).toHaveBeenCalledTimes(1); expect(freeTexture).toHaveBeenCalledTimes(1);
});

it('rejects a GPU-only texture instead of silently publishing missing pixels', () => {
  const source = { backdrop: new THREE.Scene(), world: new THREE.Scene(), cockpit: new THREE.Scene(), camera: new THREE.PerspectiveCamera() };
  const uniforms = makeUniforms();
  uniforms.uShadowMap.value = new THREE.Texture();
  source.world.add(new THREE.Mesh(new THREE.BufferGeometry(), makeIndexedMaterial(uniforms)));
  expect(() => encodeReferenceScene(source)).toThrow('CPU-backed');
});
