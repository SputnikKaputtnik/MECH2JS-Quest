import { expect, it } from 'vitest';
import { encodeReferencePacket, decodeReferencePacket } from '../../src/render/snapshot/referencePacket.ts';

it('packs geometry and texture bytes losslessly and retains ordinary matrix arrays', () => {
  const input = { texture: { type: 'Uint8Array', data: Array(4096).fill(255) },
    geometry: { type: 'Float32Array', array: [0, -0, Math.fround(1 / 3), -2147483648] }, matrix: [1, 0, 0, 1] };
  const encoded = encodeReferencePacket(input);
  expect(encoded.byteLength).toBeLessThan(JSON.stringify(input).length / 2);
  const decoded = decodeReferencePacket(encoded) as typeof input;
  encoded.fill(0);
  expect(decoded.texture.data).toBeInstanceOf(Uint8Array);
  expect([...decoded.texture.data]).toEqual(input.texture.data);
  expect([...decoded.geometry.array]).toEqual(input.geometry.array);
  expect(decoded.matrix).toEqual(input.matrix);
});

it('rejects truncated envelopes, bad signatures and out-of-range binary references', () => {
  const bytes = encodeReferencePacket({ type: 'Uint16Array', data: [1, 2, 3] });
  expect(() => decodeReferencePacket(bytes.subarray(0, 8))).toThrow('Truncated');
  expect(() => decodeReferencePacket(bytes.subarray(0, bytes.length - 1))).toThrow('size');
  const bad = bytes.slice(); bad[0] = 0;
  expect(() => decodeReferencePacket(bad)).toThrow('header');
  const invalid = encodeReferencePacket({ mw2Binary: 1, type: 'Float64Array', offset: 0, length: 10 });
  expect(() => decodeReferencePacket(invalid)).toThrow('exceeds');
});
