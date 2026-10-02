/** Binary envelope for the reference scene schema: keep typed geometry/texture
 * arrays binary instead of decimal JSON. Still a full snapshot, not deltas.
 * Decoded arrays own their bytes and survive recycling the transport buffer. */
const TYPES = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array };
type TypeName = keyof typeof TYPES;
const MAGIC = 0x3253574d;
const align = (n: number) => Math.ceil(n / 8) * 8;
const validType = (name: unknown): name is TypeName => typeof name === 'string' && Object.hasOwn(TYPES, name);

export function encodeReferencePacket(value: unknown): Uint8Array {
  const chunks: { offset: number; bytes: Uint8Array }[] = [];
  let payloadBytes = 0;
  const json = JSON.stringify(value, function(this: { type?: unknown }, key: string, data: unknown) {
    if ((key === 'array' || key === 'data') && Array.isArray(data) && validType(this.type)) {
      const array = new TYPES[this.type](data);
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      const offset = payloadBytes;
      chunks.push({ offset, bytes });
      payloadBytes += align(bytes.byteLength);
      return { mw2Binary: 1, type: this.type, offset, length: array.length };
    }
    return data;
  });
  const header = new TextEncoder().encode(json);
  const start = align(16 + header.byteLength);
  const bytes = new Uint8Array(start + payloadBytes);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, header.byteLength, true);
  view.setUint32(8, payloadBytes, true);
  bytes.set(header, 16);
  for (const chunk of chunks) bytes.set(chunk.bytes, start + chunk.offset);
  return bytes;
}

export function decodeReferencePacket(bytes: Uint8Array): unknown {
  if (bytes.byteLength < 16) throw Error('Truncated scene packet');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(12, true) !== 0) throw Error('Invalid scene packet header');
  const length = view.getUint32(4, true), payload = view.getUint32(8, true);
  const start = align(16 + length);
  if (start + payload !== bytes.byteLength) throw Error('Invalid scene packet size');
  return JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + length)), (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || !('mw2Binary' in value)) return value;
    const ref = value as { mw2Binary: number; type: unknown; offset: number; length: number };
    if (ref.mw2Binary !== 1 || !validType(ref.type) || !Number.isSafeInteger(ref.offset) ||
        !Number.isSafeInteger(ref.length) || ref.offset < 0 || ref.offset % 8 !== 0 || ref.length < 0) throw Error('Invalid scene array descriptor');
    const ctor = TYPES[ref.type], size = ref.length * ctor.BYTES_PER_ELEMENT;
    if (size > payload - ref.offset) throw Error('Scene array exceeds packet');
    return new ctor(bytes.slice(start + ref.offset, start + ref.offset + size).buffer);
  });
}
