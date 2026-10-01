import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WorldBatch } from '../../src/render/WorldBatch.ts';
import { makeIndexedMaterial, makeUniforms } from '../../src/render/materials/indexedMaterial.ts';

function fixture() {
  const scene = new THREE.Scene();
  const material = makeIndexedMaterial(makeUniforms());
  const sources = Array.from({ length: 3 }, (_, i) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1], 3));
    geo.setAttribute('aUv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));
    geo.setAttribute('aDraw', new THREE.Float32BufferAttribute([20 + i, 20 + i, 20 + i, -1, -1, -1], 1));
    geo.setAttribute('aSprite', new THREE.Float32BufferAttribute(new Float32Array(24).fill(-1), 4));
    geo.setAttribute('aSpriteR', new THREE.Float32BufferAttribute(new Float32Array(18), 3));
    const mesh = new THREE.Mesh(geo, material);
    const group = new THREE.Group();
    group.position.set(i * 2, 3, 4); group.updateMatrix();
    group.add(mesh); scene.add(group);
    return mesh;
  });
  const batch = new WorldBatch();
  const output = () => scene.children.find((c) => c.name === 'MW2 opaque world batch') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  return { scene, sources, batch, output };
}

describe('opaque world batching', () => {
  it('submits visible triangles once and keeps source data/picking layers unchanged after rendering', () => {
    const { scene, sources, batch, output } = fixture();
    sources[1]!.visible = false;
    sources[2]!.layers.enable(5);
    batch.render(scene, sources, () => {
      expect(sources.every((s) => s.layers.mask === 0)).toBe(true);
      const out = output();
      expect(out.visible).toBe(true);
      expect(out.geometry.drawRange.count).toBe(6);
      expect(Array.from(out.geometry.index!.array.slice(0, 6))).toEqual([0, 1, 2, 12, 13, 14]);
      expect(out.material.uniforms.uPalette).toBe(sources[0]!.material.uniforms.uPalette);
      const transforms = out.material.uniforms.uObjectMatrices!.value.image.data;
      expect(Array.from(transforms.slice(44, 47))).toEqual([4, 3, 4]);
    });
    expect(sources.map((s) => s.layers.mask)).toEqual([1, 1, 33]);
    expect(output().visible).toBe(false);
    expect(Array.from(sources[0]!.geometry.getAttribute('aDraw').array)).toEqual([20, 20, 20, -1, -1, -1]);
    batch.dispose();
  });

  it('tracks LOD visibility, changed clipping geometry, draw words and moving parts', () => {
    const { scene, sources, batch, output } = fixture();
    batch.render(scene, sources, () => {});
    sources[0]!.parent!.visible = false;
    const source = sources[1]!;
    const words = source.geometry.getAttribute('aDraw') as THREE.BufferAttribute;
    (words.array as Float32Array).fill(42); words.needsUpdate = true;
    const pos = source.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(3, 9, 8, 7); pos.needsUpdate = true;
    source.parent!.matrix.makeTranslation(6, 5, 4);
    batch.render(scene, sources, () => {
      const g = output().geometry;
      expect(g.drawRange.count).toBe(9);
      expect(Array.from(g.index!.array.slice(0, 9))).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
      expect(g.getAttribute('aDraw').getX(9)).toBe(42);
      expect(g.getAttribute('position').getX(9)).toBe(9);
      expect(Array.from(output().material.uniforms.uObjectMatrices!.value.image.data.slice(28, 31))).toEqual([6, 5, 4]);
    });
    batch.dispose();
  });

  it('does not re-upload unchanged buffers and restores the source path after a failed draw', () => {
    const { scene, sources, batch, output } = fixture();
    batch.render(scene, sources, () => {});
    const g = output().geometry;
    const versions = () => [g.index!.version, (g.getAttribute('aDraw') as THREE.BufferAttribute).version,
      output().material.uniforms.uObjectMatrices!.value.version];
    const before = versions();
    expect(() => batch.render(scene, sources, () => { throw Error('test draw failure'); })).toThrow('test draw failure');
    expect(versions()).toEqual(before);
    expect(sources.every((s) => s.layers.mask === 1)).toBe(true);
    expect(output().visible).toBe(false);
    batch.dispose();
  });

  it('removes expired objects, accepts replacements and preserves the unbatched decal path', () => {
    const { scene, sources, batch, output } = fixture();
    batch.render(scene, sources, () => {});
    const decal = sources[0]!;
    decal.material = decal.material.clone(); decal.material.depthWrite = false;
    sources[2]!.parent!.removeFromParent();
    batch.render(scene, sources, () => {
      expect(decal.layers.mask).toBe(1);
      expect(output().geometry.drawRange.count).toBe(3);
    });
    batch.render(scene, [], () => expect(output().visible).toBe(false));
    batch.dispose();
    expect(scene.children.some((c) => c.name === 'MW2 opaque world batch')).toBe(false);
  });

  it('reuses expired effect slots without reallocating the world buffer', () => {
    const { scene, sources, batch, output } = fixture();
    batch.render(scene, sources, () => {});
    const geometry = output().geometry;
    let effect = sources[2]!;
    for (let frame = 0; frame < 100; frame++) {
      effect.removeFromParent();
      effect = effect.clone();
      effect.geometry = effect.geometry.clone();
      const group = new THREE.Group(); group.add(effect); scene.add(group);
      batch.render(scene, [sources[0]!, sources[1]!, effect], () => {
        expect(output().geometry).toBe(geometry);
        expect(output().geometry.drawRange.count).toBe(9);
      });
    }
    batch.dispose();
  });
});
