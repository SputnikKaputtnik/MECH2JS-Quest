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
import { renderView } from '../pipeline/viewLatch.ts';
import { captureReferenceScene, ReferenceScene, type ReferenceScenePacket } from './referenceScene.ts';
import { encodeReferencePacket, decodeReferencePacket } from './referencePacket.ts';

type Numbers = Record<string, number>;
const numbers = (object: object): Numbers => Object.fromEntries(Object.entries(object).filter(([, v]) => typeof v === 'number'));
const vertexKeys = Object.keys(numbers(new MeshVertex()));
interface BlockData {
  values: Numbers;
  vertices: { type: 'Float64Array'; data: ArrayLike<number> };
  polygons: { values: Numbers; owner: number | null; indices: number[] }[];
}
interface ObjectData { values: Numbers; matrix: number[] | null; blocks: BlockData[] }
export interface WorldPacket {
  version: 2;
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
    records.push({ values: numbers(obj), matrix: obj.node ? [...obj.node.worldBlock] : null, blocks });
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
    version: 2, objects: records, world, backdrop, cockpit, cockpitActive: cameraGlobals.cockpitViewActive,
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
  private readonly source: SceneInput;
  private readonly packet: WorldPacket;
  private readonly cullViewer = new Viewer();
  private disposed = false;

  /** Object input transfers ownership of already decoded snapshot data. */
  constructor(bytes: Uint8Array | WorldPacket) {
    const p = this.packet = bytes instanceof Uint8Array ? decodeReferencePacket(bytes) as WorldPacket : bytes;
    if (p.version !== 2) throw Error('Unsupported world snapshot');
    const objects = p.objects.map(data => Object.assign(new WorldObject(), data.values));
    p.objects.forEach((data, i) => {
      const obj = objects[i]!;
      if (data.matrix) { obj.node = new SceneNode(); obj.node.worldBlock.set(data.matrix); }
      let previous: MeshBlock | null = null;
      for (const source of data.blocks) {
        const block = Object.assign(new MeshBlock(), source.values);
        for (let v = 0; v < block.vertexCount; v++) {
          const values = Object.fromEntries(vertexKeys.map((key, k) => [key, source.vertices.data[v * vertexKeys.length + k]!]));
          block.vertices.push(Object.assign(new MeshVertex(), values));
        }
        block.polygons = source.polygons.map(poly => Object.assign(new MeshPolygon(), poly.values,
          { indices: [...poly.indices], owner: poly.owner === null ? null : objects[poly.owner]! }));
        if (previous) previous.next = block; else obj.meshList = block;
        previous = block;
      }
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
    this.viewer = Object.assign(new Viewer(), p.viewer.values);
    this.viewer.rotation.set(p.viewer.rotation); this.viewer.lightPos.set(p.viewer.lightPos);
    this.resources = new ReferenceScene(p.resources);
    this.camera = this.resources.camera;
    const carrier = this.resources.world.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    this.renderer = new SceneRenderer(carrier.material.uniforms as IndexedUniforms);
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
    this.renderer.destroy(); this.resources.dispose();
  }
}
