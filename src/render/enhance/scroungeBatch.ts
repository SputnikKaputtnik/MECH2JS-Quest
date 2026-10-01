/** @portOnly Draw repeated ground patches with one ordered index buffer.
 * Source sphere culling, projected-depth sorting and object-ID ties remain the
 * renderer's; this matters because the patches do not write depth.
 */
import * as THREE from 'three';

type Source = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
const ATTRIBUTES = ['position', 'aUv', 'aDraw', 'aSprite', 'aSpriteR'];
interface Slot {
  source: Source;
  geometry: THREE.BufferGeometry;
  start: number;
  count: number;
  visible: boolean;
  versions: number[];
  z: number;
}

export class ScroungeBatch {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private slots: Slot[] = [];
  private ordered: Slot[] = [];
  private lastOrder: Slot[] = [];
  private indicesDirty = true;
  private matrixTexture: THREE.DataTexture | null = null;
  private matrixData = new Float32Array(0);
  private readonly matrix = new THREE.Matrix4();
  private readonly projection = new THREE.Matrix4();
  private readonly centre = new THREE.Vector4();
  private readonly frustum = new THREE.Frustum();
  private readonly frustums = new THREE.FrustumArray();

  /** Call after GroundField restores source visibility for the current frame. */
  update(field: THREE.Group, sources: Source[]): boolean {
    if (!sources.length || sources.some(s => s.material !== sources[0]!.material || s.material.transparent || s.geometry.index ||
      s.renderOrder !== 0 || s.layers.mask !== 1 || s.parent?.parent !== field || ATTRIBUTES.some(a => !s.geometry.getAttribute(a)))) {
      this.hide(); return false;
    }
    sources.sort((a, b) => a.id - b.id);
    if (sources.length !== this.slots.length || this.mesh?.material !== sources[0]!.material ||
      sources.some((s, i) => s !== this.slots[i]!.source || s.geometry !== this.slots[i]!.geometry)) {
      this.rebuild(field, sources);
    }
    const geometry = this.mesh!.geometry;
    let matricesChanged = false;
    for (let id = 0; id < this.slots.length; id++) {
      const slot = this.slots[id]!, source = slot.source;
      slot.visible = source.visible && source.parent!.visible;
      for (let a = 0; a < ATTRIBUTES.length; a++) {
        const name = ATTRIBUTES[a]!, src = source.geometry.getAttribute(name) as THREE.BufferAttribute;
        if (slot.versions[a] === src.version) continue;
        const dst = geometry.getAttribute(name) as THREE.BufferAttribute, offset = slot.start * src.itemSize;
        (dst.array as Float32Array).set(src.array, offset); dst.addUpdateRange(offset, src.array.length); dst.needsUpdate = true;
        slot.versions[a] = src.version;
        if (name === 'aDraw') this.indicesDirty = true;
      }
      this.matrix.multiplyMatrices(source.parent!.matrix, source.matrix);
      for (let k = 0; k < 16; k++) {
        const at = id * 16 + k, value = Math.fround(this.matrix.elements[k]!);
        if (this.matrixData[at] !== value) { this.matrixData[at] = value; matricesChanged = true; }
      }
    }
    if (matricesChanged) this.matrixTexture!.needsUpdate = true;
    for (const source of sources) source.parent!.visible = false;
    this.mesh!.visible = true;
    return true;
  }

  private rebuild(field: THREE.Group, sources: Source[]): void {
    this.dispose();
    const vertices = sources.reduce((n, s) => n + s.geometry.getAttribute('position').count, 0);
    const geometry = new THREE.BufferGeometry();
    for (const name of ATTRIBUTES) {
      const size = sources[0]!.geometry.getAttribute(name).itemSize;
      geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(vertices * size), size).setUsage(THREE.DynamicDrawUsage));
    }
    const ids = new Float32Array(vertices);
    geometry.setAttribute('aObject', new THREE.BufferAttribute(ids, 1));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(vertices), 1).setUsage(THREE.DynamicDrawUsage));
    let start = 0;
    for (const source of sources) {
      const count = source.geometry.getAttribute('position').count;
      ids.fill(this.slots.length, start, start + count);
      this.slots.push({ source, geometry: source.geometry, start, count, visible: false, versions: ATTRIBUTES.map(() => -1), z: 0 });
      start += count;
    }
    this.matrixData = new Float32Array(sources.length * 16);
    this.matrixTexture = new THREE.DataTexture(this.matrixData, 4, sources.length, THREE.RGBAFormat, THREE.FloatType);
    this.matrixTexture.needsUpdate = true;
    // A single instance selects the indexed material's batch shader variant
    // while keeping the SAME material ID/order as the original ground copies.
    // Per-vertex aObject selects each source matrix, not instanceMatrix.
    const mesh = new THREE.InstancedMesh(geometry, sources[0]!.material, 1);
    mesh.name = 'MW2 ordered scrounge batch'; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
    mesh.onBeforeRender = (_r, _scene, camera) => this.prepare(camera);
    field.add(mesh); this.mesh = mesh; this.indicesDirty = true;
  }

  /** Exact source ordering, rebuilt only when culling/order/draw words change. */
  private prepare(camera: THREE.Camera): void {
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = (camera as THREE.ArrayCamera).isArrayCamera
      ? this.frustums.setFromArrayCamera(camera as THREE.ArrayCamera)
      : this.frustum.setFromProjectionMatrix(this.projection, camera.coordinateSystem, camera.reversedDepth);
    this.ordered.length = 0;
    for (const slot of this.slots) {
      const source = slot.source;
      if (!slot.visible || (source.frustumCulled && !frustum.intersectsObject(source))) continue;
      if (!source.geometry.boundingSphere) source.geometry.computeBoundingSphere();
      const c = source.geometry.boundingSphere!.center;
      this.centre.set(c.x, c.y, c.z, 1).applyMatrix4(source.matrixWorld).applyMatrix4(this.projection);
      slot.z = this.centre.z; this.ordered.push(slot);
    }
    this.ordered.sort((a, b) => a.z - b.z || a.source.id - b.source.id);
    if (this.indicesDirty || this.ordered.length !== this.lastOrder.length || this.ordered.some((s, i) => s !== this.lastOrder[i])) {
      const geometry = this.mesh!.geometry, index = geometry.index!, out = index.array as Uint32Array;
      let count = 0;
      for (const slot of this.ordered) {
        const words = slot.source.geometry.getAttribute('aDraw').array;
        for (let v = 0; v < slot.count; v += 3) {
          if (words[v]! < 0) continue;
          out[count++] = slot.start + v; out[count++] = slot.start + v + 1; out[count++] = slot.start + v + 2;
        }
      }
      index.clearUpdateRanges(); index.addUpdateRange(0, count); index.needsUpdate = true; geometry.setDrawRange(0, count);
      this.lastOrder.length = this.ordered.length;
      for (let i = 0; i < this.ordered.length; i++) this.lastOrder[i] = this.ordered[i]!;
      this.indicesDirty = false;
    }
    const material = this.mesh!.material;
    (material.uniforms.uObjectMatrices ??= { value: null }).value = this.matrixTexture;
    material.uniformsNeedUpdate = true;
  }

  hide(): void { if (this.mesh) this.mesh.visible = false; }

  dispose(): void {
    const uniform = this.mesh?.material.uniforms.uObjectMatrices;
    if (uniform?.value === this.matrixTexture) uniform.value = null;
    this.mesh?.removeFromParent(); this.mesh?.geometry.dispose(); this.mesh?.dispose(); this.mesh = null;
    this.matrixTexture?.dispose(); this.matrixTexture = null; this.matrixData = new Float32Array(0);
    this.slots = []; this.ordered = []; this.lastOrder = [];
  }
}
