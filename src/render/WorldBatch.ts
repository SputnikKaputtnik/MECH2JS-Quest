/**
 * @portOnly Submit opaque world parts together, keeping original model-space
 * attributes and palette words. A vertex's object ID selects its world matrix
 * on the GPU. Only visible triangles enter the index buffer; clipped reserve
 * slots and CPU-rejected faces never reach the rasterizer.
 *
 * Source meshes remain intact for picking, shadows, and the reference renderer.
 * Only their display layer is suppressed, and only during the batched draw.
 * Order-dependent always-behind objects and outlines keep their original path.
 */
import * as THREE from 'three';

const ATTRIBUTES = ['position', 'aUv', 'aDraw', 'aSprite', 'aSpriteR'] as const;
type Source = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
interface Slot {
  source: Source;
  start: number;
  count: number;
  capacity: number;
  active: boolean;
  versions: number[];
  visible: boolean;
}

class MaterialBatch {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private slots: Slot[] = [];
  private bySource = new Map<Source, Slot>();
  private vertexCapacity = 0;
  private matrixCapacity = 0;
  private usedVertices = 0;
  private matrices = new Float32Array(0);
  private texture: THREE.DataTexture | null = null;
  private readonly matrix = new THREE.Matrix4();

  constructor(material: THREE.ShaderMaterial) {
    const batched = material.clone();
    // Texture/palette/frame uniforms must remain shared with the source material.
    batched.uniforms = { ...material.uniforms, uObjectMatrices: { value: null } };
    batched.defines = { ...material.defines, MW2_BATCHED: 1 };
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), batched);
    this.mesh.name = 'MW2 opaque world batch';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false; // original object cull ran before submission
    this.mesh.visible = false;
  }

  private rebuild(sources: Source[]): void {
    const vertices = sources.reduce((sum, m) => sum + m.geometry.getAttribute('position').count, 0);
    this.vertexCapacity = THREE.MathUtils.ceilPowerOfTwo(Math.max(vertices * 1.5, 256));
    this.matrixCapacity = THREE.MathUtils.ceilPowerOfTwo(Math.max(sources.length * 1.5, 4));
    this.mesh.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    const first = sources[0]!;
    for (const name of ATTRIBUTES) {
      const size = first.geometry.getAttribute(name).itemSize;
      geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(this.vertexCapacity * size), size).setUsage(THREE.DynamicDrawUsage));
    }
    const ids = new Float32Array(this.vertexCapacity);
    geometry.setAttribute('aObject', new THREE.BufferAttribute(ids, 1));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(this.vertexCapacity), 1).setUsage(THREE.DynamicDrawUsage));
    this.mesh.geometry = geometry;
    this.texture?.dispose();
    this.matrices = new Float32Array(this.matrixCapacity * 16);
    this.texture = new THREE.DataTexture(this.matrices, 4, this.matrixCapacity, THREE.RGBAFormat, THREE.FloatType);
    this.texture.needsUpdate = true;
    this.mesh.material.uniforms.uObjectMatrices!.value = this.texture;
    this.slots = [];
    this.bySource.clear();
    let start = 0;
    for (const source of sources) {
      const count = source.geometry.getAttribute('position').count;
      const slot: Slot = { source, start, count, capacity: count, active: true, versions: ATTRIBUTES.map(() => -1), visible: false };
      ids.fill(this.slots.length, start, start + count);
      this.slots.push(slot);
      this.bySource.set(source, slot);
      start += count;
    }
    this.usedVertices = start;
  }

  /** Reuse expired effect/LOD slots. Repack only when reserved capacity runs out,
   * not every time a projectile or explosion joins/leaves the object list. */
  private reconcile(sources: Source[]): boolean {
    const wanted = new Set(sources);
    let changed = false;
    for (const [source, slot] of this.bySource) {
      if (wanted.has(source) && slot.count === source.geometry.getAttribute('position').count) continue;
      slot.active = slot.visible = false;
      this.bySource.delete(source);
      changed = true;
    }
    for (const source of sources) {
      if (this.bySource.has(source)) continue;
      changed = true;
      const count = source.geometry.getAttribute('position').count;
      let slot = this.slots.find((s) => !s.active && s.capacity >= count);
      if (slot) {
        slot.source = source; slot.count = count; slot.active = true;
        slot.versions.fill(-1);
      } else {
        if (this.usedVertices + count > this.vertexCapacity || this.slots.length >= this.matrixCapacity) {
          this.rebuild(sources);
          return true;
        }
        slot = { source, count, capacity: count, start: this.usedVertices, active: true, visible: false, versions: ATTRIBUTES.map(() => -1) };
        const ids = this.mesh.geometry.getAttribute('aObject') as THREE.BufferAttribute;
        (ids.array as Float32Array).fill(this.slots.length, slot.start, slot.start + count);
        ids.addUpdateRange(slot.start, count); ids.needsUpdate = true;
        this.slots.push(slot);
        this.usedVertices += count;
      }
      this.bySource.set(source, slot);
    }
    return changed;
  }

  update(sources: Source[], layerMask: number): void {
    // The roster includes hidden LODs so turning one's head doesn't rebuild buffers.
    const changed = this.reconcile(sources);
    if (!sources.length) { this.mesh.visible = false; return; }
    const geometry = this.mesh.geometry;
    let indicesChanged = changed;
    let matricesChanged = false;
    for (let id = 0; id < this.slots.length; id++) {
      const slot = this.slots[id]!;
      if (!slot.active) continue;
      const source = slot.source;
      const visible = source.visible && !!source.parent?.visible && (source.layers.mask & layerMask) !== 0;
      if (slot.visible !== visible) { slot.visible = visible; indicesChanged = true; }
      if (!visible) continue;
      for (let a = 0; a < ATTRIBUTES.length; a++) {
        const name = ATTRIBUTES[a]!;
        const src = source.geometry.getAttribute(name) as THREE.BufferAttribute;
        if (slot.versions[a] === src.version) continue;
        const dst = geometry.getAttribute(name) as THREE.BufferAttribute;
        const offset = slot.start * src.itemSize;
        (dst.array as Float32Array).set(src.array, offset);
        dst.addUpdateRange(offset, src.array.length);
        dst.needsUpdate = true;
        slot.versions[a] = src.version;
        if (name === 'aDraw') indicesChanged = true;
      }
      // The batch and its sources share the scene parent, so store scene-local
      // transforms. carryOwned's interpolated arms are included automatically.
      this.matrix.multiplyMatrices(source.parent!.matrix, source.matrix);
      const e = this.matrix.elements;
      const offset = id * 16;
      for (let k = 0; k < 16; k++) {
        const value = Math.fround(e[k]!);
        if (this.matrices[offset + k] !== value) {
          this.matrices[offset + k] = value;
          matricesChanged = true;
        }
      }
    }
    if (matricesChanged) this.texture!.needsUpdate = true;
    if (indicesChanged) {
      const index = geometry.index!;
      const out = index.array as Uint32Array;
      let count = 0;
      for (const slot of this.slots) {
        if (!slot.active || !slot.visible) continue;
        const draw = slot.source.geometry.getAttribute('aDraw').array;
        for (let v = 0; v < slot.count; v += 3) {
          if (draw[v]! < 0) continue;
          out[count++] = slot.start + v;
          out[count++] = slot.start + v + 1;
          out[count++] = slot.start + v + 2;
        }
      }
      index.clearUpdateRanges();
      index.addUpdateRange(0, count);
      index.needsUpdate = true;
      geometry.setDrawRange(0, count);
    }
    this.mesh.visible = geometry.drawRange.count > 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture?.dispose();
  }
}

export class WorldBatch {
  private readonly batches = new Map<THREE.ShaderMaterial, MaterialBatch>();

  /** Source list includes all LODs, including hidden ones, in stable object order. */
  render(scene: THREE.Scene, sources: Source[], draw: () => void, layerMask = 1): void {
    const groups = new Map<THREE.ShaderMaterial, Source[]>();
    for (const source of sources) {
      // Preserve ordering for depthWrite=false decals and leave unusual geometry
      // on the reference path. Only SceneRenderer's direct child groups qualify.
      if (source.parent?.parent !== scene || !source.material.depthWrite || source.material.transparent
        || source.geometry.index || source.renderOrder !== 0) continue;
      let group = groups.get(source.material);
      if (!group) { group = []; groups.set(source.material, group); }
      group.push(source);
    }
    for (const [material, group] of groups) {
      let batch = this.batches.get(material);
      if (!batch) { batch = new MaterialBatch(material); this.batches.set(material, batch); scene.add(batch.mesh); }
      batch.update(group, layerMask);
    }
    for (const [material, batch] of this.batches) if (!groups.has(material)) batch.mesh.visible = false;
    const suppressed: Array<[Source, number]> = [];
    try {
      for (const group of groups.values()) for (const source of group) {
        suppressed.push([source, source.layers.mask]); source.layers.mask = 0;
      }
      draw();
    } finally {
      for (const [source, mask] of suppressed) source.layers.mask = mask;
      for (const batch of this.batches.values()) batch.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const batch of this.batches.values()) batch.dispose();
    this.batches.clear();
  }
}
