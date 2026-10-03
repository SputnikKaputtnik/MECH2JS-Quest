import type { MeshBlock } from '../generated/classes.gen.ts';

/** @portOnly Exact input comparison for reusing non-baked render geometry.
 * World coordinates, normals and colours are evaluated again by shade; model
 * positions, UVs and fan/sprite topology determine the immutable base buffers.
 * No hash collisions or retained archive of obsolete meshes. */
export function sameModelGeometry(a: MeshBlock, b: MeshBlock): boolean {
  if (a.vertexCount !== b.vertexCount || a.polygonCount !== b.polygonCount) return false;
  for (let i = 0; i < a.vertexCount; i++) {
    const x = a.vertices[i]!, y = b.vertices[i]!;
    if (x.modelX !== y.modelX || x.modelY !== y.modelY || x.modelZ !== y.modelZ
      || x.texU !== y.texU || x.texV !== y.texV) return false;
  }
  for (let i = 0; i < a.polygonCount; i++) {
    const x = a.polygons[i]!, y = b.polygons[i]!;
    if (x.vertexCount !== y.vertexCount || x.code !== y.code) return false;
    for (let j = 0; j < x.vertexCount; j++) if (x.indices[j] !== y.indices[j]) return false;
  }
  return true;
}
