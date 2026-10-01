/** Frozen pre-optimization BigInt implementation, used as an independent oracle. */
import type { MeshPolygon, MeshVertex } from '../../src/generated/classes.gen.ts';
import type { LightLatch } from '../../src/render/shading/polygonColour.ts';
import { sqrtTable } from '../../src/engine/scene/worldObject.ts';

export function referencePolyLight(poly: MeshPolygon, vertices: MeshVertex[], L: LightLatch): number {
  const v = vertices[poly.indices[0]!]!;
  let px = v.worldX, py = v.worldY, pz = v.worldZ;
  if (L.lightDirectional !== 0) px = py = pz = 0;
  const dx = (L.lightX - px) | 0;
  const dy = (L.lightY - py) | 0;
  const dz = (L.lightZ - pz) | 0;
  let ax = (dx < 0 ? -dx : dx) >>> 0;
  let ay = (dy < 0 ? -dy : dy) >>> 0;
  let az = (dz < 0 ? -dz : dz) >>> 0;
  const or = (ax | ay | az) >>> 0;
  if (or === 0) return 0x7f;
  let dot = (BigInt(dx) * BigInt(poly.normalX) + BigInt(dy) * BigInt(poly.normalY) + BigInt(dz) * BigInt(poly.normalZ)) >> 16n;
  const shift = 31 - Math.clz32(or) - 7;
  if (shift > 0) {
    ax >>>= shift; ay >>>= shift; az >>>= shift;
    dot >>= BigInt(shift);
  } else if (shift < 0) {
    ax = (ax << -shift) >>> 0; ay = (ay << -shift) >>> 0; az = (az << -shift) >>> 0;
    dot = BigInt.asIntN(64, dot << BigInt(-shift));
  }
  const sum = (ax & 0xff) * (ax & 0xff) + (ay & 0xff) * (ay & 0xff) + (az & 0xff) * (az & 0xff);
  const len = (sqrtTable[(sum >>> 7) >>> 1]! << 16) >> 16;
  const q = dot / BigInt(len);
  return (Number(BigInt.asIntN(16, q)) << 16) >> 16;
}
