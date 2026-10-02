/** Unculled reference snapshot. All LODs and objects are retained; the consumer
 * runs the original view-dependent pipeline against its own reconstructed data.
 * Main perspective world/cockpit only: map hooks and enhancement passes require
 * further snapshot fields and are deliberately rejected/not included here. */
import * as THREE from 'three';
import { MeshBlock, MeshPolygon, MeshVertex, SceneNode, Viewer, WorldObject } from '../../generated/classes.gen.ts';
import { objectsOnList, worldRootNode } from '../../engine/scene/objectLists.ts';
import { viewScene } from '../../sim/world/viewScene.ts';
import { cameraGlobals } from '../../sim/camera/viewer.ts';
import { lighting } from '../../sim/world/environment.ts';
import { HOOK, renderOptions } from '../../sim/display/renderState.ts';
import { SceneRenderer, type SceneInput } from '../SceneRenderer.ts';
import { makeIndexedMaterial, type IndexedUniforms } from '../materials/indexedMaterial.ts';
import { cameraFromViewer, viewerFromCamera } from '../bridge/cameraViewer.ts';
import { updateSnapshotUniforms } from './snapshotUniforms.ts';
import { renderView } from '../pipeline/viewLatch.ts';
import { captureReferenceScene, ReferenceScene, type ReferenceScenePacket } from './referenceScene.ts';
import { encodeReferencePacket, decodeReferencePacket } from './referencePacket.ts';

type Numbers = Record<string, number>;
const numbers = (object: object): Numbers => Object.fromEntries(Object.entries(object).filter(([, v]) => typeof v === 'number'));
export const vertexKeys = Object.keys(numbers(new MeshVertex()));
interface BlockData {
  values: Numbers;
  vertices: { type: 'Float64Array'; data: ArrayLike<number> };
  polygons: { values: Numbers; owner: number | null; indices: number[] }[];
}
export interface ObjectData { id: number; values: Numbers; matrix: number[] | null; blocks: BlockData[] }
export interface WorldPacket {
  version: 3;
  objects: ObjectData[];
  world: number[];
  backdrop: number[];
  cockpit: number[];
  cockpitActive: number;
  options: typeof renderOptions;
  lighting: { lightDimDistance: number; damageShadeRaises: number };
  viewer: { values: Numbers; rotation: number[]; lightPos: number[] };
  resources: ReferenceScenePacket;
  sortFlags: number;
}

// Producer-local weak identities survive list reorder without retaining dead
// simulation objects. A new worker/mission consumer starts a fresh identity scope.
const objectIds = new WeakMap<WorldObject, number>();
let nextObjectId = 0;
function objectId(object: WorldObject): number {
  let id = objectIds.get(object);
  if (id === undefined) { id = ++nextObjectId; objectIds.set(object, id); }
  return id;
}

function sameGeometry(a: ObjectData, b: ObjectData): boolean {
  if (!!a.matrix !== !!b.matrix || ((a.values.flags! ^ b.values.flags!) & 1) ||
      ((a.values.type! ^ b.values.type!) & 0x100) || a.blocks.length !== b.blocks.length) return false;
  const positions = a.matrix ? ['modelX', 'modelY', 'modelZ'] : ['worldX', 'worldY', 'worldZ'];
  const keys = [...positions, 'texU', 'texV'].map(k => vertexKeys.indexOf(k));
  return a.blocks.every((block, i) => {
    const other = b.blocks[i]!;
    if (block.values.vertexCount !== other.values.vertexCount || block.values.polygonCount !== other.values.polygonCount ||
        block.polygons.length !== other.polygons.length ||
        block.vertices.data.length !== other.vertices.data.length) return false;
    for (let v = 0; v < block.vertices.data.length; v += vertexKeys.length) {
      for (const k of keys) if (block.vertices.data[v + k] !== other.vertices.data[v + k]) return false;
    }
    return block.polygons.every((poly, j) => {
      const next = other.polygons[j]!;
      return poly.values.code === next.values.code && poly.values.vertexCount === next.values.vertexCount &&
        poly.indices.length === next.indices.length && poly.indices.every((index, k) => index === next.indices[k]);
    });
  });
}

function treeObjects(root: SceneNode | null): WorldObject[] {
  const out: WorldObject[] = [];
  const walk = (node: SceneNode) => {
    if (node.userData) out.push(node.userData);
    for (let child = node.firstChild; child; child = child.nextSibling) walk(child);
  };
  if (root) walk(root);
  return out;
}

export function encodeWorldState(viewer: Viewer, uniforms: IndexedUniforms): Uint8Array {
  return encodeReferencePacket(captureWorldState(viewer, uniforms));
}

/** Capture intermediate for full or resource-based encoding. No live engine
 * pointers are kept. Encode before handing ownership to another thread. */
export function captureWorldState(viewer: Viewer, uniforms: IndexedUniforms): WorldPacket {
  if (renderOptions.objectCullHook !== HOOK.objectCullMainView || renderOptions.polygonDrawHook !== HOOK.polygonResolveColour ||
      renderOptions.polygonFillHook !== HOOK.polyFillByMode || renderOptions.clipProjectHook !== HOOK.clipProjectPerspective) {
    throw Error('Unculled snapshot supports only the main perspective render hooks');
  }
  const objects: WorldObject[] = [], ids = new Map<WorldObject, number>();
  const id = (obj: WorldObject): number => {
    let index = ids.get(obj);
    if (index === undefined) { index = objects.length; ids.set(obj, index); objects.push(obj); }
    return index;
  };
  const world = [...objectsOnList(worldRootNode)].map(id);
  const backdrop = treeObjects(viewScene.backdropNode).map(id);
  const cockpit = treeObjects(viewScene.cockpitHeadNode).map(id);
  const records: ObjectData[] = [];
  // Owners may point to an object outside the draw lists. Include that object's
  // state too, without copying collision trees, list links or live sim pointers.
  for (let index = 0; index < objects.length; index++) {
    const obj = objects[index]!;
    const blocks: BlockData[] = [];
    for (let block = obj.meshList; block; block = block.next) blocks.push({
      values: numbers(block),
      vertices: { type: 'Float64Array', data: block.vertices.flatMap(v => vertexKeys.map(k => (v as unknown as Numbers)[k]!)) },
      polygons: block.polygons.map(p => ({ values: numbers(p), owner: p.owner ? id(p.owner) : null, indices: [...p.indices] })),
    });
    records.push({ id: objectId(obj), values: numbers(obj), matrix: obj.node ? [...obj.node.worldBlock] : null, blocks });
  }
  // Serialize the shared indexed resources once, using a zero-vertex carrier.
  const carrier = new THREE.Mesh(new THREE.BufferGeometry(), makeIndexedMaterial(uniforms));
  const resourceWorld = new THREE.Scene(); resourceWorld.add(carrier);
  const camera = new THREE.PerspectiveCamera(); cameraFromViewer(viewer, camera, 4 / 3);
  let resources: ReferenceScenePacket;
  try {
    resources = captureReferenceScene({ world: resourceWorld, backdrop: new THREE.Scene(), cockpit: new THREE.Scene(), camera });
  } finally { carrier.geometry.dispose(); carrier.material.dispose(); }
  const packet: WorldPacket = {
    version: 3, objects: records, world, backdrop, cockpit, cockpitActive: cameraGlobals.cockpitViewActive,
    options: { ...renderOptions }, lighting: { lightDimDistance: lighting.lightDimDistance, damageShadeRaises: lighting.damageShadeRaises },
    viewer: { values: numbers(viewer), rotation: [...viewer.rotation], lightPos: [...viewer.lightPos] },
    resources, sortFlags: renderView.polySortFlags,
  };
  return packet;
}

export class WorldStateRenderer {
  readonly viewer: Viewer;
  readonly renderer: SceneRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private readonly resources: ReferenceScene;
  private source: SceneInput = { world: [], backdrop: null, cockpit: null };
  private readonly objects = new Map<number, WorldObject>();
  private packet: WorldPacket;
  private readonly cullViewer = new Viewer();
  private disposed = false;
  private compact = false;
  private compactCockpit = new Set<number>();

  /** Object input transfers ownership of already decoded snapshot data. */
  constructor(bytes: Uint8Array | WorldPacket) {
    const p = this.packet = bytes instanceof Uint8Array ? decodeReferencePacket(bytes) as WorldPacket : bytes;
    if (p.version !== 3) throw Error('Unsupported world snapshot');
    this.viewer = new Viewer();
    this.resources = new ReferenceScene(p.resources);
    this.camera = this.resources.camera;
    const carrier = this.resources.world.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    this.renderer = new SceneRenderer(carrier.material.uniforms as IndexedUniforms);
    this.applyObjects(p);
  }

  /** Adopt a complete state from the same mission/worker epoch. Stable engine
   * identities keep SceneRenderer caches alive; structural changes invalidate
   * only the affected object. Do not apply a different mission to this instance. */
  apply(bytes: Uint8Array | WorldPacket): void {
    if (this.disposed) throw Error('Disposed world snapshot');
    if (this.compact) throw Error('Cannot mix full and compact adoption');
    const p = bytes instanceof Uint8Array ? decodeReferencePacket(bytes) as WorldPacket : bytes;
    if (p.version !== 3) throw Error('Unsupported world snapshot');
    const incoming = new ReferenceScene(p.resources);
    try {
      const carrier = incoming.world.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      updateSnapshotUniforms(this.renderer.uniforms, carrier.material.uniforms as IndexedUniforms);
      this.camera.copy(incoming.camera);
    } finally { incoming.dispose(); }
    this.applyObjects(p);
  }

  /** Compact channel: numeric object state every frame, mesh data only on asset
   * revision changes. Asset polygon owners use stable IDs, not list positions. */
  adoptCompact(objects: { id: number; values: Numbers; matrix: number[] | null; asset?: ObjectData }[],
    lists: { world: number[]; backdrop: number[]; cockpit: number[] },
    state: Pick<WorldPacket, 'viewer' | 'options' | 'lighting' | 'cockpitActive' | 'sortFlags'>): void {
    if (this.disposed) throw Error('Disposed world snapshot');
    if (!this.compact) this.compactCockpit = new Set(this.packet.cockpit.map(i => this.packet.objects[i]!.id));
    this.compact = true;
    const ids = new Set(objects.map(o => o.id));
    if (ids.size !== objects.length) throw Error('Duplicate compact object');
    for (const [id, obj] of this.objects) if (!ids.has(id)) { this.renderer.forgetObject(obj); this.objects.delete(id); }
    const cockpit = new Set(lists.cockpit);
    for (const id of this.compactCockpit) if (!cockpit.has(id)) {
      const obj = this.objects.get(id); if (obj) this.renderer.forgetObject(obj);
    }
    this.compactCockpit = cockpit;
    const moved = new Set<number>();
    for (const data of objects) {
      let obj = this.objects.get(data.id);
      if (!obj) { obj = new WorldObject(); this.objects.set(data.id, obj); }
      if (data.asset || (data.matrix && (!obj.node || data.matrix.some((v, i) => v !== obj!.node!.worldBlock[i])))) moved.add(data.id);
      Object.assign(obj, data.values); obj.currentMesh = null;
      if (data.matrix) { obj.node ??= new SceneNode(); obj.node.worldBlock.set(data.matrix); }
      else obj.node = null;
    }
    for (const data of objects) if (data.asset) {
      const obj = this.objects.get(data.id)!;
      this.renderer.forgetObject(obj); obj.meshList = null;
      let previous: MeshBlock | null = null;
      for (const source of data.asset.blocks) {
        const block = Object.assign(new MeshBlock(), source.values);
        for (let v = 0; v < block.vertexCount; v++) {
          const vertex = new MeshVertex();
          for (let k = 0; k < vertexKeys.length; k++) (vertex as unknown as Numbers)[vertexKeys[k]!] = source.vertices.data[v * vertexKeys.length + k]!;
          block.vertices.push(vertex);
        }
        block.polygons = source.polygons.map(p => Object.assign(new MeshPolygon(), p.values,
          { indices: [...p.indices], owner: p.owner === null ? null : this.objects.get(p.owner)! }));
        if (previous) previous.next = block; else obj.meshList = block;
        previous = block;
      }
    }
    // The producer may have transformed a mesh before publishing. Its version
    // alone cannot certify that our retained world coordinates are current.
    for (const id of moved) {
      const obj = this.objects.get(id)!;
      if (obj.node) for (let block = obj.meshList; block; block = block.next) block.transformVersion = obj.transformVersion ^ 0x80000000;
    }
    const tree = (ids: number[]): SceneNode | null => {
      const root = new SceneNode(); let last: SceneNode | null = null;
      for (const id of ids) {
        const node = new SceneNode(); node.userData = this.objects.get(id)!;
        if (last) last.nextSibling = node; else root.firstChild = node;
        last = node;
      }
      return root.firstChild ? root : null;
    };
    this.source = { world: lists.world.map(id => this.objects.get(id)!), backdrop: tree(lists.backdrop), cockpit: tree(lists.cockpit) };
    Object.assign(this.packet, state);
    Object.assign(this.viewer, state.viewer.values);
    this.viewer.rotation.set(state.viewer.rotation); this.viewer.lightPos.set(state.viewer.lightPos);
    cameraFromViewer(this.viewer, this.camera, 4 / 3);
  }

  private applyObjects(p: WorldPacket): void {
    const previous = new Map(this.packet.objects.map(record => [record.id, record]));
    const ids = new Set(p.objects.map(record => record.id));
    if (ids.size !== p.objects.length) throw Error('Duplicate snapshot object identity');
    const cockpitIds = new Set(p.cockpit.map(index => p.objects[index]!.id));
    // Cockpit entries otherwise remain cached while hidden. An object can leave
    // that pass yet remain in the packet as a polygon owner or world object.
    for (const index of this.packet.cockpit) {
      const id = this.packet.objects[index]!.id;
      const object = this.objects.get(id);
      if (object && !cockpitIds.has(id)) this.renderer.forgetObject(object);
    }
    for (const [id, object] of this.objects) if (!ids.has(id)) {
      this.renderer.forgetObject(object); this.objects.delete(id);
    }
    const objects = p.objects.map(data => {
      let object = this.objects.get(data.id);
      if (!object) { object = new WorldObject(); this.objects.set(data.id, object); }
      return object;
    });
    p.objects.forEach((data, i) => {
      const obj = objects[i]!;
      const old = previous.get(data.id);
      if (!old || !sameGeometry(old, data)) {
        this.renderer.forgetObject(obj); obj.meshList = null;
      }
      Object.assign(obj, data.values); obj.currentMesh = null;
      if (data.matrix) { obj.node ??= new SceneNode(); obj.node.worldBlock.set(data.matrix); }
      else obj.node = null;
      let previousBlock: MeshBlock | null = null, existing = obj.meshList;
      for (const source of data.blocks) {
        const block = existing ?? new MeshBlock(); existing = block.next;
        Object.assign(block, source.values);
        for (let v = 0; v < block.vertexCount; v++) {
          const vertex = block.vertices[v] ?? new MeshVertex();
          for (let k = 0; k < vertexKeys.length; k++) {
            (vertex as unknown as Numbers)[vertexKeys[k]!] = source.vertices.data[v * vertexKeys.length + k]!;
          }
          vertex.clipRecord = null; block.vertices[v] = vertex;
        }
        block.vertices.length = block.vertexCount;
        source.polygons.forEach((poly, j) => {
          const target = block.polygons[j] ?? new MeshPolygon();
          Object.assign(target, poly.values);
          target.indices.length = poly.indices.length;
          for (let k = 0; k < poly.indices.length; k++) target.indices[k] = poly.indices[k]!;
          target.owner = poly.owner === null ? null : objects[poly.owner]!;
          block.polygons[j] = target;
        });
        block.polygons.length = source.polygons.length;
        if (previousBlock) previousBlock.next = block; else obj.meshList = block;
        previousBlock = block;
      }
      if (previousBlock) previousBlock.next = null;
    });
    const tree = (ids: number[]): SceneNode | null => {
      let first: SceneNode | null = null, last: SceneNode | null = null;
      for (const id of ids) {
        const node = new SceneNode(); node.userData = objects[id]!;
        if (last) last.nextSibling = node; else first = node;
        last = node;
      }
      const root = new SceneNode(); root.firstChild = first;
      return first ? root : null;
    };
    this.source = { world: p.world.map(id => objects[id]!), backdrop: tree(p.backdrop), cockpit: tree(p.cockpit) };
    Object.assign(this.viewer, p.viewer.values);
    this.viewer.rotation.set(p.viewer.rotation); this.viewer.lightPos.set(p.viewer.lightPos);
    this.packet = p;
  }

  /** Legacy pure drawing helpers still use module-local scratch/config globals.
   * Install only captured values for the synchronous pass and restore in finally;
   * never point them at the producer's scene or update the live simulation. */
  sync(camera: THREE.PerspectiveCamera = this.camera, width = 640, height = 480): void {
    if (this.disposed) throw Error('Disposed world snapshot');
    const saved = { options: { ...renderOptions }, cockpit: cameraGlobals.cockpitViewActive,
      dim: lighting.lightDimDistance, damage: lighting.damageShadeRaises, view: { ...renderView } };
    try {
      Object.assign(renderOptions, this.packet.options);
      cameraGlobals.cockpitViewActive = this.packet.cockpitActive;
      Object.assign(lighting, this.packet.lighting);
      renderView.polySortFlags = this.packet.sortFlags;
      this.renderer.setViewport(width, height);
      this.renderer.sync(viewerFromCamera(camera, this.viewer, this.cullViewer), this.source);
    } finally {
      Object.assign(renderOptions, saved.options); cameraGlobals.cockpitViewActive = saved.cockpit;
      lighting.lightDimDistance = saved.dim; lighting.damageShadeRaises = saved.damage;
      Object.assign(renderView, saved.view);
    }
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera = this.camera): void {
    renderer.render(this.renderer.backdropScene, camera); renderer.clearDepth();
    this.renderer.renderWorld(renderer, camera); renderer.clearDepth();
    renderer.render(this.renderer.cockpitScene, camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.destroy(); this.resources.dispose(); this.objects.clear();
  }
}
