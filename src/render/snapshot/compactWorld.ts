/** Binary per-frame state with immutable baseline assets. Asset changes are
 * repeated inline until a new basis, so dropping frames cannot lose resources.
 * Revisions let the consumer skip decoding repeated assets. Epoch validation is
 * the enclosing SnapshotMailbox's responsibility. No JSON on the frame path. */
import * as THREE from 'three';
import { MeshBlock, MeshPolygon, Viewer, WorldObject } from '../../generated/classes.gen.ts';
import { renderOptions } from '../../sim/display/renderState.ts';
import { type IndexedUniforms } from '../materials/indexedMaterial.ts';
import { WorldStateRenderer, vertexKeys, type WorldPacket, type ObjectData } from './worldState.ts';

type Numbers = Record<string, number>;
const keys = (o: object) => Object.keys(o).filter(k => typeof (o as Numbers)[k] === 'number');
const objectKeys = keys(new WorldObject()), blockKeys = keys(new MeshBlock()), polygonKeys = keys(new MeshPolygon());
const viewerKeys = keys(new Viewer()), optionKeys = keys(renderOptions);
const textureKeys = ['uPalette', 'uLuma', 'uAtlas', 'uSlots', 'uShadowTable'] as const;
const uniformKeys = ['uTextureAffine', 'uTexturesOn', 'uShadedFill', 'uSprites', 'uMapFill', 'uIndexOut', 'uPanels', 'uPanel', 'uShadeMap', 'uShadowOn', 'uShadowTexel'];
const MAGIC = 0x3243574d;
const align = (n: number) => Math.ceil(n / 8) * 8;

class Writer {
  at = 0;
  readonly view: DataView;
  constructor(readonly buffer: ArrayBuffer) { this.view = new DataView(buffer); }
  n(value: number) { if (this.at + 8 > this.buffer.byteLength) throw Error('Compact frame exceeds capacity'); this.view.setFloat64(this.at, value, true); this.at += 8; }
  record(o: Numbers, fields: string[]) { for (const k of fields) this.n(o[k]!); }
  list(values: ArrayLike<number>) { this.n(values.length); for (let i = 0; i < values.length; i++) this.n(values[i]!); }
  bytes(bytes: Uint8Array) { this.n(bytes.length); if (this.at + align(bytes.length) > this.buffer.byteLength) throw Error('Compact frame exceeds capacity'); new Uint8Array(this.buffer, this.at, bytes.length).set(bytes); this.at += align(bytes.length); }
}
class Reader {
  at = 0;
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length); }
  n(): number { if (this.at + 8 > this.bytes.length) throw Error('Truncated compact frame'); const n = this.view.getFloat64(this.at, true); this.at += 8; if (!Number.isFinite(n)) throw Error('Nonfinite compact value'); return n; }
  count(): number { const n = this.n(); if (!Number.isSafeInteger(n) || n < 0) throw Error('Invalid compact count'); return n; }
  record(fields: string[]): Numbers { const o: Numbers = {}; for (const k of fields) o[k] = this.n(); return o; }
  list(): number[] { const n = this.count(); if (n * 8 > this.bytes.length - this.at) throw Error('Truncated compact list'); return Array.from({ length: n }, () => this.n()); }
  blob(): Uint8Array { const n = this.count(); if (align(n) > this.bytes.length - this.at) throw Error('Truncated compact blob'); const value = this.bytes.subarray(this.at, this.at + n); this.at += align(n); return value; }
  end() { if (this.at !== this.bytes.length) throw Error('Trailing compact bytes'); }
}
function equal(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function equalTextureBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  if ((a.byteOffset & 3) || (b.byteOffset & 3)) return equal(a, b);
  const count = Math.floor(a.length / 4);
  const x = new Uint32Array(a.buffer, a.byteOffset, count), y = new Uint32Array(b.buffer, b.byteOffset, count);
  for (let i = 0; i < count; i++) if (x[i] !== y[i]) return false;
  for (let i = count * 4; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function stableAsset(data: ObjectData, objects: ObjectData[]): ObjectData {
  return { ...data, blocks: data.blocks.map(b => ({ ...b, polygons: b.polygons.map(p => ({ ...p, owner: p.owner === null ? null : objects[p.owner]!.id })) })) };
}
function sameAsset(a: ObjectData, b: ObjectData): boolean {
  if (!!a.matrix !== !!b.matrix || ((a.values.flags! ^ b.values.flags!) & 1) || ((a.values.type! ^ b.values.type!) & 0x100) || a.blocks.length !== b.blocks.length) return false;
  const vertexFields = (a.matrix ? ['modelX', 'modelY', 'modelZ', 'texU', 'texV'] : ['modelX', 'modelY', 'modelZ', 'worldX', 'worldY', 'worldZ', 'texU', 'texV']).map(k => vertexKeys.indexOf(k));
  for (let i = 0; i < a.blocks.length; i++) {
    const x = a.blocks[i]!, y = b.blocks[i]!;
    if (x.vertices.data.length !== y.vertices.data.length || x.polygons.length !== y.polygons.length) return false;
    for (const k of blockKeys) if (k !== 'transformVersion' && x.values[k] !== y.values[k]) return false;
    for (let v = 0; v < x.vertices.data.length; v += vertexKeys.length) for (const k of vertexFields) if (x.vertices.data[v + k] !== y.vertices.data[v + k]) return false;
    for (let j = 0; j < x.polygons.length; j++) {
      const p = x.polygons[j]!, q = y.polygons[j]!;
      if (p.owner !== q.owner || !equal(p.indices, q.indices)) return false;
      for (const k of polygonKeys) if ((!a.matrix || !['normalX', 'normalY', 'normalZ'].includes(k)) && p.values[k] !== q.values[k]) return false;
    }
  }
  return true;
}
function encodeAsset(asset: ObjectData): Uint8Array {
  const values: number[] = [asset.blocks.length];
  for (const b of asset.blocks) {
    for (const k of blockKeys) values.push(b.values[k]!);
    values.push(b.vertices.data.length);
    for (let i = 0; i < b.vertices.data.length; i++) values.push(b.vertices.data[i]!);
    values.push(b.polygons.length);
    for (const p of b.polygons) {
      for (const k of polygonKeys) values.push(p.values[k]!);
      values.push(p.owner ?? 0, p.indices.length, ...p.indices);
    }
  }
  const buffer = new ArrayBuffer(values.length * 8), writer = new Writer(buffer);
  for (const value of values) writer.n(value);
  return new Uint8Array(buffer);
}
function decodeAsset(bytes: Uint8Array, state: Omit<ObjectData, 'blocks'>): ObjectData {
  const r = new Reader(bytes), blocks: ObjectData['blocks'] = [];
  const n = r.count();
  for (let i = 0; i < n; i++) {
    const values = r.record(blockKeys), vertices = { type: 'Float64Array' as const, data: Float64Array.from(r.list()) };
    const polygons: ObjectData['blocks'][number]['polygons'] = [];
    const count = r.count();
    for (let j = 0; j < count; j++) { const values = r.record(polygonKeys), owner = r.count(); polygons.push({ values, owner: owner || null, indices: r.list() }); }
    if (vertices.data.length !== values.vertexCount! * vertexKeys.length || values.polygonCount! > polygons.length) throw Error('Invalid compact asset dimensions');
    blocks.push({ values, vertices, polygons });
  }
  r.end(); return { ...state, blocks };
}
function raw(texture: THREE.DataTexture): Uint8Array {
  const data = texture.image.data;
  if (!data) throw Error('Compact texture has no CPU data');
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
function textureShape(t: THREE.DataTexture): number[] {
  if (!(t.image.data instanceof Uint8Array || t.image.data instanceof Float32Array)) throw Error('Unsupported compact texture storage');
  return [t.image.width, t.image.height, t.format, t.type, t.image.data instanceof Float32Array ? 1 : 0];
}
export interface CompactAux { width: number; height: number; planes: Uint8Array[]; menuOpen: boolean; throttlePlus: number }
const emptyAux: CompactAux = { width: 0, height: 0, planes: [], menuOpen: false, throttlePlus: 0 };

const samplerKeys = ['wrapS', 'wrapT', 'magFilter', 'minFilter', 'anisotropy', 'flipY', 'generateMipmaps', 'premultiplyAlpha', 'unpackAlignment', 'colorSpace', 'internalFormat'] as const;
export class CompactWorldEncoder {
  private readonly samplers: unknown[][];
  private nextRevision = 2;
  private readonly assets = new Map<number, { data: ObjectData; revision: number; bytes: Uint8Array }>();
  private readonly textures: { shape: number[]; bytes: Uint8Array; revision: number }[];
  constructor(initial: WorldPacket, uniforms: IndexedUniforms) {
    this.samplers = textureKeys.map(k => samplerKeys.map(field => uniforms[k].value[field]));
    for (const data of initial.objects) this.assets.set(data.id, { data: stableAsset(data, initial.objects), revision: 1, bytes: new Uint8Array() });
    this.textures = textureKeys.map(k => ({ shape: textureShape(uniforms[k].value), bytes: raw(uniforms[k].value).slice(), revision: 1 }));
  }
  write(p: WorldPacket, uniforms: IndexedUniforms, buffer: ArrayBuffer, aux = emptyAux): number {
    if (uniforms.uShadowOn.value || uniforms.uShadowMap.value) throw Error('Compact channel does not support shadow resources');
    const w = new Writer(buffer); w.n(MAGIC); w.n(1);
    w.n(p.cockpitActive); w.n(p.sortFlags); w.n(p.lighting.lightDimDistance); w.n(p.lighting.damageShadeRaises);
    w.record(p.options, optionKeys); w.record(p.viewer.values, viewerKeys); w.list(p.viewer.rotation); w.list(p.viewer.lightPos);
    for (const name of ['world', 'backdrop', 'cockpit'] as const) w.list(p[name].map(index => p.objects[index]!.id));
    w.n(p.objects.length);
    const alive = new Set<number>();
    for (const data of p.objects) {
      alive.add(data.id);
      const asset = stableAsset(data, p.objects); let cached = this.assets.get(data.id);
      if (!cached || !sameAsset(cached.data, asset)) {
        cached = { data: asset, revision: this.nextRevision++, bytes: encodeAsset(asset) }; this.assets.set(data.id, cached);
      }
      w.n(data.id); w.n(cached.revision); w.record(data.values, objectKeys); w.list(data.matrix ?? []); w.bytes(cached.bytes);
    }
    for (const id of this.assets.keys()) if (!alive.has(id)) this.assets.delete(id);
    for (const key of uniformKeys) w.n(uniforms[key]!.value as number);
    w.list(uniforms.uAtlasSize.value.toArray()); w.list(uniforms.uViewport.value.toArray()); w.list(uniforms.uShades!.value as number[]);
    for (let i = 0; i < textureKeys.length; i++) {
      const texture = uniforms[textureKeys[i]!].value, bytes = raw(texture), shape = textureShape(texture);
      if (samplerKeys.some((key, j) => texture[key] !== this.samplers[i]![j])) throw Error('Compact texture sampler changed; new basis required');
      let cache = this.textures[i]!;
      if (!equal(shape, cache.shape) || !equalTextureBytes(bytes, cache.bytes)) {
        cache = { shape, bytes: bytes.slice(), revision: this.nextRevision++ }; this.textures[i] = cache;
      }
      w.n(cache.revision); w.list(cache.shape); w.bytes(cache.revision === 1 ? new Uint8Array() : cache.bytes);
    }
    w.n(+aux.menuOpen); w.n(aux.throttlePlus); w.n(aux.width); w.n(aux.height); w.n(aux.planes.length);
    for (const plane of aux.planes) w.bytes(plane);
    return w.at;
  }
}

export class CompactWorldRenderer {
  readonly scene: WorldStateRenderer;
  readonly aux: CompactAux = { ...emptyAux, planes: [] };
  private readonly basis = new Map<number, ObjectData>();
  private readonly revisions = new Map<number, number>();
  private readonly textureRevisions = textureKeys.map(() => 1);
  readonly stats = { decodedAssets: 0, adoptedObjects: 0 };
  constructor(initial: WorldPacket) {
    this.scene = new WorldStateRenderer(initial);
    for (const data of initial.objects) { this.basis.set(data.id, stableAsset(data, initial.objects)); this.revisions.set(data.id, 1); }
  }
  apply(bytes: Uint8Array): void {
    const r = new Reader(bytes);
    if (r.n() !== MAGIC || r.n() !== 1) throw Error('Invalid compact frame header');
    const cockpitActive = r.n(), sortFlags = r.n(), lighting = { lightDimDistance: r.n(), damageShadeRaises: r.n() };
    const options = r.record(optionKeys) as WorldPacket['options'];
    const viewer = { values: r.record(viewerKeys), rotation: r.list(), lightPos: r.list() };
    if (viewer.rotation.length !== 9 || viewer.lightPos.length !== 3) throw Error('Invalid compact viewer');
    const lists = { world: r.list(), backdrop: r.list(), cockpit: r.list() };
    const count = r.count(), objects: { id: number; values: Numbers; matrix: number[] | null; asset?: ObjectData }[] = [];
    const alive = new Set<number>();
    for (let i = 0; i < count; i++) {
      const id = r.count(), revision = r.count(), values = r.record(objectKeys), matrix = r.list(), blob = r.blob();
      if (id === 0 || revision === 0 || alive.has(id) || (matrix.length !== 0 && matrix.length !== 12)) throw Error('Invalid compact object');
      alive.add(id);
      const object = { id, values, matrix: matrix.length ? matrix : null, asset: undefined as ObjectData | undefined };
      if (this.revisions.get(id) !== revision) {
        object.asset = revision === 1 ? this.basis.get(id) : decodeAsset(blob, object);
        if (!object.asset) throw Error('Missing compact asset');
        this.stats.decodedAssets++; this.revisions.set(id, revision);
      }
      objects.push(object);
    }
    for (const ids of Object.values(lists)) if (ids.some(id => !alive.has(id))) throw Error('Invalid compact draw list');
    for (const id of this.revisions.keys()) if (!alive.has(id)) this.revisions.delete(id);
    const uniforms = this.scene.renderer.uniforms;
    for (const key of uniformKeys) uniforms[key]!.value = r.n();
    uniforms.uAtlasSize.value.fromArray(r.list()); uniforms.uViewport.value.fromArray(r.list()); uniforms.uShades!.value = r.list();
    for (let i = 0; i < textureKeys.length; i++) {
      const revision = r.count(), shape = r.list(), data = r.blob();
      if (shape.length !== 5) throw Error('Invalid compact texture');
      if (revision !== this.textureRevisions[i]) {
        const texture = uniforms[textureKeys[i]!].value;
        if (!equal(shape, textureShape(texture))) {
          texture.dispose();
          texture.image = { data: shape[4] === 1 ? new Float32Array(data.slice().buffer) : data.slice(), width: shape[0]!, height: shape[1]! };
          texture.format = shape[2] as THREE.PixelFormat; texture.type = shape[3] as THREE.TextureDataType;
        } else { if (raw(texture).length !== data.length) throw Error('Invalid compact texture bytes'); raw(texture).set(data); }
        texture.needsUpdate = true; this.textureRevisions[i] = revision;
      }
    }
    this.aux.menuOpen = r.n() !== 0; this.aux.throttlePlus = r.n(); this.aux.width = r.count(); this.aux.height = r.count();
    const planes = r.count();
    if (planes !== 0 && planes !== 4) throw Error('Invalid compact HUD planes');
    for (let i = 0; i < planes; i++) {
      const plane = r.blob(); if (plane.length !== this.aux.width * this.aux.height) throw Error('Invalid compact HUD size');
      if (this.aux.planes[i]?.length !== plane.length) this.aux.planes[i] = new Uint8Array(plane.length);
      this.aux.planes[i]!.set(plane);
    }
    this.aux.planes.length = planes; r.end();
    this.scene.adoptCompact(objects, lists, { viewer, options, lighting, cockpitActive, sortFlags });
    this.stats.adoptedObjects += objects.length;
  }
  dispose() { this.scene.dispose(); this.revisions.clear(); this.basis.clear(); this.aux.planes = []; }
}
