import { expect, it } from 'vitest';
import fc from 'fast-check';
import { MeshPolygon, MeshVertex } from '../../src/generated/classes.gen.ts';
import { polyLightIntensity } from '../../src/render/shading/polygonColour.ts';
import { referencePolyLight } from '../reference/polyLight.ts';

const integer = fc.oneof(fc.integer(), fc.constantFrom(0, 1, -1, 127, 128, 255, 256, 65535, 65536, -65536, 0x7fffffff, -0x80000000));
it('preserves fixed-point light intensities across signed extremes, shifts and positional lights', () => {
  const poly = new MeshPolygon(); poly.indices = [0];
  const vertex = new MeshVertex();
  fc.assert(fc.property(fc.array(integer, { minLength: 9, maxLength: 9 }), fc.boolean(), (n, directional) => {
    [poly.normalX, poly.normalY, poly.normalZ] = [n[0]!, n[1]!, n[2]!];
    [vertex.worldX, vertex.worldY, vertex.worldZ] = [n[3]!, n[4]!, n[5]!];
    const light = { ambientLight: 32, lightDirectional: +directional, lightX: n[6]!, lightY: n[7]!, lightZ: n[8]! };
    expect(polyLightIntensity(poly, [vertex], light)).toBe(referencePolyLight(poly, [vertex], light));
  }), { numRuns: 30000, seed: 20261001 });
});

it('preserves ordinary 16.16 lighting and negative rounding near shade boundaries', () => {
  const poly = new MeshPolygon(); poly.indices = [0];
  const vertex = new MeshVertex();
  fc.assert(fc.property(fc.array(fc.integer({ min: -65536, max: 65536 }), { minLength: 6, maxLength: 6 }), n => {
    [poly.normalX, poly.normalY, poly.normalZ] = [n[0]!, n[1]!, n[2]!];
    const light = { ambientLight: 0, lightDirectional: 1, lightX: n[3]!, lightY: n[4]!, lightZ: n[5]! };
    expect(polyLightIntensity(poly, [vertex], light)).toBe(referencePolyLight(poly, [vertex], light));
  }), { numRuns: 20000, seed: 20261002 });
});
