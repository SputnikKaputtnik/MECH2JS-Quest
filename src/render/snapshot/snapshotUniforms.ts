import * as THREE from 'three';
import type { IndexedUniforms } from '../materials/indexedMaterial.ts';

/** Copy owned decoded uniforms into the persistent holders used by all scene
 * materials. Incoming resources have never been uploaded and may be disposed
 * immediately afterward. The initial ReferenceScene still owns the textures. */
export function updateSnapshotUniforms(current: IndexedUniforms, incoming: IndexedUniforms): void {
  for (const [key, holder] of Object.entries(incoming)) {
    const target = current[key];
    if (!target) throw Error(`Unsupported snapshot uniform: ${key}`);
    const from = holder.value, to = target.value;
    if (from instanceof THREE.DataTexture && to instanceof THREE.DataTexture) {
      const a = to.image.data, b = from.image.data;
      if (!a || !b) throw Error(`Snapshot texture has no CPU pixels: ${key}`);
      const compatible = a.constructor === b.constructor && a.byteLength === b.byteLength &&
        to.image.width === from.image.width && to.image.height === from.image.height &&
        to.format === from.format && to.type === from.type && to.internalFormat === from.internalFormat &&
        to.minFilter === from.minFilter && to.magFilter === from.magFilter &&
        to.wrapS === from.wrapS && to.wrapT === from.wrapT && to.colorSpace === from.colorSpace &&
        to.flipY === from.flipY && to.premultiplyAlpha === from.premultiplyAlpha &&
        to.unpackAlignment === from.unpackAlignment && to.generateMipmaps === from.generateMipmaps;
      if (!compatible) {
        // WebGL cannot resize existing texture storage; free it before the next
        // upload. Keep the Texture identity and uniform holders unchanged.
        to.dispose(); to.copy(from);
      } else {
        const dest = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
        const source = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
        let changed = false;
        for (let i = 0; i < dest.length; i++) if (dest[i] !== source[i]) { changed = true; break; }
        if (changed) { dest.set(source); to.needsUpdate = true; }
      }
    } else if (from instanceof THREE.Texture || to instanceof THREE.Texture) {
      throw Error(`Snapshot texture kind changed: ${key}`);
    } else if (to instanceof THREE.Vector2 && from instanceof THREE.Vector2) to.copy(from);
    else if (to instanceof THREE.Vector3 && from instanceof THREE.Vector3) to.copy(from);
    else if (to instanceof THREE.Matrix4 && from instanceof THREE.Matrix4) to.copy(from);
    else target.value = Array.isArray(from) ? [...from] : from;
  }
}
