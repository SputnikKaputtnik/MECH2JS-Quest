import { expect, it } from 'vitest';
import { decodeReferencePacket, encodeReferencePacket, ResourcePacketDecoder, ResourcePacketEncoder } from '../../src/render/snapshot/referencePacket.ts';

const texture = (v: number) => ({ type: 'Uint8Array', data: new Uint8Array(8192).fill(v) });
const geometry = (v: number) => ({ type: 'Float64Array', array: new Float64Array([v, -0, 1 / 3]) });
const state = (v: number) => ({ geometry: geometry(v), atlas: texture(17), palette: texture(v), tick: v });

it('sends unchanged binary resources once and roundtrips decoded typed arrays', () => {
  const source = state(0), encoder = new ResourcePacketEncoder('mission-a', source);
  const initial = structuredClone(encoder.initial, { transfer: [encoder.initial.buffer] });
  const decoder = new ResourcePacketDecoder('mission-a', initial);
  initial.fill(0);
  const packet = encoder.encode(source);
  expect(packet.length).toBeLessThan(1000);
  expect(decoder.decode(packet)).toEqual(source);
  const reencoded = encodeReferencePacket(decoder.decode(packet));
  expect(decodeReferencePacket(reencoded)).toEqual(source);
});

it('retains geometry AND texture updates when intervening frames are dropped', () => {
  const encoder = new ResourcePacketEncoder('mission', state(0));
  const decoder = new ResourcePacketDecoder('mission', encoder.initial);
  // All of these states are discarded before the consumer sees them.
  for (let tick = 1; tick < 50; tick++) encoder.encode(state(tick));
  const bytes = encoder.encode(state(49));
  const owned = decoder.decode(bytes) as ReturnType<typeof state>;
  bytes.fill(0);
  expect(owned).toEqual(state(49));
  // Rendering may mutate the consumer's vertex scratch and texture pixels.
  owned.geometry.array.fill(999); owned.atlas.data.fill(123);
  expect(decoder.decode(encoder.encode(state(0)))).toEqual(state(0));
});

it('handles insertions, removals, reordering, resource resizing and type changes', () => {
  const encoder = new ResourcePacketEncoder('mission', [geometry(1), texture(2)]);
  const decoder = new ResourcePacketDecoder('mission', encoder.initial);
  const cases = [[], [texture(2), geometry(1)], [geometry(1)], [texture(7), geometry(2), texture(3)],
    [{ type: 'Float32Array', data: new Float32Array([1, -0]) }],
    [{ type: 'Uint8Array', data: new Uint8Array(10000).fill(4) }]];
  for (const value of cases) expect(decoder.decode(encoder.encode(value))).toEqual(value);
});

it('rejects missing/wrong mission bases and never grows frames with history', () => {
  const encoder = new ResourcePacketEncoder('a', state(0));
  const decoder = new ResourcePacketDecoder('a', encoder.initial);
  expect(() => new ResourcePacketDecoder('b', encoder.initial)).toThrow('epoch');
  const other = new ResourcePacketEncoder('b', state(0));
  expect(() => decoder.decode(other.encode(state(0)))).toThrow('epoch');
  expect(() => decodeReferencePacket(encoder.encode(state(0)))).toThrow('baseline');
  const size = encoder.encode(state(1)).length;
  for (let i = 0; i < 100; i++) encoder.encode(state(i));
  expect(encoder.encode(state(1)).length).toBe(size);
  expect(() => decoder.decode(encodeReferencePacket({ kind: 'resource-frame', epoch: 'a', value:
    { mw2Base: 1, type: 'Uint8Array', index: 100000, length: 1 } }))).toThrow('baseline');
});
