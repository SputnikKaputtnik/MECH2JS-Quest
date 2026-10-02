/** Binary envelope for the reference scene schema: keep typed geometry/texture
 * arrays binary instead of decimal JSON. Full packets and fixed-basis resource
 * frames share this envelope; frame metadata always describes complete state.
 * Decoded arrays own their bytes and survive recycling the transport buffer. */
const TYPES = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array };
type TypeName = keyof typeof TYPES;
const MAGIC = 0x3253574d;
const align = (n: number) => Math.ceil(n / 8) * 8;
const validType = (name: unknown): name is TypeName => typeof name === 'string' && Object.hasOwn(TYPES, name);

interface Resource { type: TypeName; bytes: Uint8Array }
interface Resources { baseline?: readonly Resource[]; capture?: Resource[] }
const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export function encodeReferencePacket(value: unknown): Uint8Array { return encode(value); }

function encode(value: unknown, resources: Resources = {}): Uint8Array {
  const chunks: { offset: number; bytes: Uint8Array }[] = [];
  let payloadBytes = 0;
  let resourceIndex = 0;
  const json = JSON.stringify(value, function(this: { type?: unknown }, key: string, data: unknown) {
    if ((key === 'array' || key === 'data') && (Array.isArray(data) || (ArrayBuffer.isView(data) && !(data instanceof DataView))) && validType(this.type)) {
      const array = new TYPES[this.type](data as ArrayLike<number>);
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      const index = resourceIndex++;
      resources.capture?.push({ type: this.type, bytes: bytes.slice() });
      const base = resources.baseline?.[index];
      // Positional IDs are only a lookup hint. Exact bytes AND type must match;
      // inserting/removing/reordering objects can never silently alias resources.
      if (base?.type === this.type && equalBytes(base.bytes, bytes)) {
        return { mw2Base: 1, index, type: this.type, length: array.length };
      }
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

export function decodeReferencePacket(bytes: Uint8Array): unknown { return decode(bytes); }

function decode(bytes: Uint8Array, resources: Resources = {}): unknown {
  if (bytes.byteLength < 16) throw Error('Truncated scene packet');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(12, true) !== 0) throw Error('Invalid scene packet header');
  const length = view.getUint32(4, true), payload = view.getUint32(8, true);
  const start = align(16 + length);
  if (start + payload !== bytes.byteLength) throw Error('Invalid scene packet size');
  return JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + length)), (_key, value: unknown) => {
    if (!value || typeof value !== 'object') return value;
    if ('mw2Base' in value) {
      const ref = value as { mw2Base: number; index: number; type: unknown; length: number };
      const base = resources.baseline?.[ref.index];
      if (ref.mw2Base !== 1 || !Number.isSafeInteger(ref.index) || ref.index < 0 || !validType(ref.type) ||
          !Number.isSafeInteger(ref.length) || ref.length < 0 || base?.type !== ref.type ||
          base.bytes.length !== ref.length * TYPES[ref.type].BYTES_PER_ELEMENT) throw Error('Invalid baseline resource');
      // Consumers may mutate transformed vertices and texture pixels. Never lend
      // baseline storage to a renderer, or later frames would inherit corruption.
      return new TYPES[ref.type](base.bytes.slice().buffer);
    }
    if (!('mw2Binary' in value)) return value;
    const ref = value as { mw2Binary: number; type: unknown; offset: number; length: number };
    if (ref.mw2Binary !== 1 || !validType(ref.type) || !Number.isSafeInteger(ref.offset) ||
        !Number.isSafeInteger(ref.length) || ref.offset < 0 || ref.offset % 8 !== 0 || ref.length < 0) throw Error('Invalid scene array descriptor');
    const ctor = TYPES[ref.type], size = ref.length * ctor.BYTES_PER_ELEMENT;
    if (size > payload - ref.offset) throw Error('Scene array exceeds packet');
    const owned = bytes.slice(start + ref.offset, start + ref.offset + size);
    resources.capture?.push({ type: ref.type, bytes: owned.slice() });
    return new ctor(owned.buffer);
  });
}

/** One immutable resource basis per mission epoch, delivered reliably BEFORE
 * the lossy latest-frame mailbox. Frames reference only this basis, never an
 * earlier frame. Changed resources are sent inline until a new epoch is opened.
 * Cache size stays fixed; no ACK race or history of discarded snapshots exists.
 * This reduces transport bytes, not capture/parse cost or GPU allocations yet. */
export class ResourcePacketEncoder {
  private readonly baseline: Resource[] = [];
  readonly initial: Uint8Array;
  constructor(readonly epoch: string, value: unknown) {
    if (!epoch) throw Error('Resource epoch required');
    this.initial = encode({ kind: 'resource-basis', epoch, value }, { capture: this.baseline });
  }
  encode(value: unknown): Uint8Array {
    return encode({ kind: 'resource-frame', epoch: this.epoch, value }, { baseline: this.baseline });
  }
}

export class ResourcePacketDecoder {
  private readonly baseline: Resource[] = [];
  constructor(readonly epoch: string, initial: Uint8Array) {
    const packet = decode(initial, { capture: this.baseline }) as { kind: string; epoch: string };
    if (!epoch || packet.kind !== 'resource-basis' || packet.epoch !== epoch) throw Error('Invalid resource basis epoch');
  }
  decode(bytes: Uint8Array): unknown {
    const packet = decode(bytes, { baseline: this.baseline }) as { kind: string; epoch: string; value: unknown };
    if (packet.kind !== 'resource-frame' || packet.epoch !== this.epoch) throw Error('Invalid resource frame epoch');
    return packet.value;
  }
}
