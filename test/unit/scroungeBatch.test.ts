import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { ScroungeBatch } from '../../src/render/enhance/scroungeBatch.ts';
import { makeIndexedMaterial, makeUniforms } from '../../src/render/materials/indexedMaterial.ts';

function fixture() {
  const field = new THREE.Group(), material = makeIndexedMaterial(makeUniforms());
  const geometry = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['aUv', 2], ['aDraw', 1], ['aSprite', 4], ['aSpriteR', 3]] as const) {
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(3 * size), size));
  }
  geometry.getAttribute('position').setXYZ(1, 1, 0, 0); geometry.getAttribute('position').setXYZ(2, 0, 1, 0);
  const sources = [0, 1, 2].map(i => {
    const group = new THREE.Group(); group.matrix.makeTranslation(i * 10, 0, 0); group.matrixAutoUpdate = false;
    const mesh = new THREE.Mesh(geometry, material); group.add(mesh); field.add(group); return mesh;
  });
  const batch = new ScroungeBatch();
  const restore = () => { for (const source of sources) source.parent!.visible = true; };
  const prepare = (camera: THREE.Camera = new THREE.OrthographicCamera(-100, 100, 100, -100, -100, 100)) => {
    field.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const mesh = batch.mesh!;
    mesh.onBeforeRender({} as THREE.WebGLRenderer, new THREE.Scene(), camera, mesh.geometry, mesh.material, field);
    return Array.from(mesh.geometry.index!.array.slice(0, mesh.geometry.drawRange.count)).map(i => mesh.geometry.getAttribute('aObject').getX(i));
  };
  return { field, sources, geometry, material, batch, restore, prepare };
}

it('packs copies while preserving transforms, hidden LODs and changed draw words', () => {
  const f = fixture();
  try {
    f.sources[1]!.visible = false;
    expect(f.batch.update(f.field, f.sources)).toBe(true);
    expect(f.batch.mesh!.count).toBe(1);
    expect(f.batch.mesh!.geometry.getAttribute('position').count).toBe(9);
    expect(f.prepare()).toEqual([0, 0, 0, 2, 2, 2]);
    const matrices = () => (f.material.uniforms.uObjectMatrices!.value as THREE.DataTexture).image.data as Float32Array;
    expect(matrices()[2 * 16 + 12]).toBe(20);
    f.restore(); f.sources[1]!.visible = true; f.sources[2]!.parent!.matrix.makeTranslation(30, 2, 1);
    const draw = f.geometry.getAttribute('aDraw') as THREE.BufferAttribute;
    draw.setX(0, 0x1234); draw.needsUpdate = true;
    f.batch.update(f.field, f.sources);
    expect(new Set(f.prepare())).toEqual(new Set([0, 1, 2]));
    expect(matrices()[2 * 16 + 12]).toBe(30);
    expect(f.batch.mesh!.geometry.getAttribute('aDraw').getX(0)).toBe(0x1234);
    expect(f.sources.every(s => !s.parent!.visible)).toBe(true);
    const version = f.batch.mesh!.geometry.index!.version;
    f.prepare(); expect(f.batch.mesh!.geometry.index!.version).toBe(version);
    f.restore(); draw.setX(0, -1); draw.needsUpdate = true; f.batch.update(f.field, f.sources);
    expect(f.prepare()).toEqual([]);
  } finally { f.batch.dispose(); f.geometry.dispose(); f.material.dispose(); }
});

it('releases replaced batches, retains borrowed materials, and falls back for mixed materials', () => {
  const f = fixture();
  const other = f.material.clone();
  try {
    f.batch.update(f.field, f.sources); const old = f.batch.mesh!;
    const disposed = vi.fn(), materialDisposed = vi.fn();
    old.addEventListener('dispose', disposed); f.material.addEventListener('dispose', materialDisposed);
    f.restore(); f.batch.update(f.field, f.sources.slice(0, 2));
    expect(disposed).toHaveBeenCalledOnce(); expect(old.parent).toBeNull();
    expect(materialDisposed).not.toHaveBeenCalled();
    f.restore(); f.sources[0]!.material = other;
    expect(f.batch.update(f.field, f.sources)).toBe(false);
    expect(f.batch.mesh!.visible).toBe(false);
    expect(f.sources.every(s => s.parent!.visible)).toBe(true);
    f.batch.dispose(); expect(materialDisposed).not.toHaveBeenCalled();
  } finally { f.batch.dispose(); f.geometry.dispose(); f.material.dispose(); other.dispose(); }
});

it('sorts with original double-precision source transforms and object-ID ties', () => {
  const f = fixture();
  try {
    f.geometry.computeBoundingSphere();
    // Distances round to the same float32 value at this scale. GPU instance
    // matrices must not decide the ordering of non-depth-writing source parts.
    f.sources[0]!.parent!.matrix.makeTranslation(0, 0, -1000.00002);
    f.sources[1]!.parent!.matrix.makeTranslation(0, 0, -1000.00001);
    f.sources[2]!.parent!.matrix.makeTranslation(0, 0, -1000.00001);
    f.batch.update(f.field, f.sources); f.field.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 20000); camera.updateMatrixWorld(true);
    expect(f.prepare(camera)).toEqual([1, 1, 1, 2, 2, 2, 0, 0, 0]);
  } finally { f.batch.dispose(); f.geometry.dispose(); f.material.dispose(); }
});
