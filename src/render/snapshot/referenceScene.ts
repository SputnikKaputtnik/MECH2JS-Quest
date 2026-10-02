/**
 * Self-contained reference format for validating the worker/render boundary.
 * Deliberately full-state, not the eventual compact resource/delta protocol.
 * No engine objects cross this boundary. Only CPU-backed textures are supported;
 * render targets, DOM images and callbacks must stay on the presenting side.
 * The captured geometry is already view-dependent: NOT yet safe for arbitrary
 * headset rotation without a new producer pass. Do not enable in gameplay.
 */
import * as THREE from 'three';
import { decodeReferencePacket, encodeReferencePacket } from './referencePacket.ts';

export interface ReferenceScenePacket {
  version: 1;
  scene: ReturnType<THREE.Object3D['toJSON']>;
  ranges: Record<string, [number, number | null]>;
}

export interface SceneSource {
  backdrop: THREE.Scene;
  world: THREE.Scene;
  cockpit: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

/** Includes independent geometry, material uniforms, texture pixels and camera.
 * Returns encoded bytes, so no mutable source references can escape. */
export function encodeReferenceScene(source: SceneSource): Uint8Array {
  return encodeReferencePacket(captureReferenceScene(source));
}

/** Serialization data for embedding in a larger binary envelope. Treat the
 * result as a capture intermediate; encode it before crossing thread ownership. */
export function captureReferenceScene(source: SceneSource): ReferenceScenePacket {
  const roots = [source.backdrop, source.world, source.cockpit, source.camera];
  if (roots.some(root => root.parent !== null)) throw Error('Snapshot roots must be unparented');
  const ranges: ReferenceScenePacket['ranges'] = {};
  for (const root of roots) root.traverse(object => {
    if (object.matrixAutoUpdate) object.updateMatrix();
    if (Object.keys(object.userData).length) throw Error('Snapshot does not carry arbitrary userData');
    if (object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender ||
        object.onAfterRender !== THREE.Object3D.prototype.onAfterRender) throw Error('Snapshot cannot carry draw callbacks');
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      const geometry = object.geometry;
      ranges[geometry.uuid] = [geometry.drawRange.start, Number.isFinite(geometry.drawRange.count) ? geometry.drawRange.count : null];
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.ShaderMaterial)) throw Error('Snapshot requires indexed shader materials');
        for (const { value } of Object.values(material.uniforms)) {
          if (value instanceof THREE.Texture && (!(value instanceof THREE.DataTexture) || value.isRenderTargetTexture)) {
            throw Error('Snapshot requires CPU-backed texture pixels');
          }
        }
      }
    } else if (!(object instanceof THREE.Scene || object instanceof THREE.Group || object instanceof THREE.PerspectiveCamera)) {
      throw Error(`Unsupported snapshot object: ${object.type}`);
    }
  });
  // A serialization-only container: do not reparent or mutate source scenes.
  const container = new THREE.Group();
  container.children = roots;
  return { version: 1, scene: container.toJSON(), ranges };
}

export class ReferenceScene {
  readonly backdrop: THREE.Scene;
  readonly world: THREE.Scene;
  readonly cockpit: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly root: THREE.Object3D;
  private disposed = false;

  /** Object input must be owned decoded data, not mutable producer storage. */
  constructor(bytes: Uint8Array | ReferenceScenePacket) {
    const packet = bytes instanceof Uint8Array ? decodeReferencePacket(bytes) as ReferenceScenePacket : bytes;
    if (packet.version !== 1) throw Error('Unsupported scene snapshot version');
    this.root = new THREE.ObjectLoader().parse(packet.scene);
    const [backdrop, world, cockpit, camera] = this.root.children;
    if (!(backdrop instanceof THREE.Scene && world instanceof THREE.Scene && cockpit instanceof THREE.Scene && camera instanceof THREE.PerspectiveCamera)) {
      this.dispose();
      throw Error('Incomplete scene snapshot');
    }
    this.backdrop = backdrop; this.world = world; this.cockpit = cockpit; this.camera = camera;
    // Render each pass as an independent root, as in the reference renderer.
    this.root.clear();
    // Engine scenes disable matrixAutoUpdate; loading their local matrices does
    // not mark the derived world matrices dirty. Force the initial propagation.
    for (const root of [backdrop, world, cockpit, camera]) root.updateMatrixWorld(true);
    for (const scene of [backdrop, world, cockpit]) scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        const range = packet.ranges[object.geometry.uuid];
        if (range) object.geometry.setDrawRange(range[0], range[1] ?? Infinity);
      }
    });
  }

  /** Depth boundaries match the original scene pass order. Caller owns clear. */
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera = this.camera): void {
    if (this.disposed) throw Error('Disposed scene snapshot');
    renderer.render(this.backdrop, camera);
    renderer.clearDepth();
    renderer.render(this.world, camera);
    renderer.clearDepth();
    renderer.render(this.cockpit, camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    for (const root of [this.backdrop, this.world, this.cockpit, this.root]) root?.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        if (material instanceof THREE.ShaderMaterial) for (const { value } of Object.values(material.uniforms)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  }
}
