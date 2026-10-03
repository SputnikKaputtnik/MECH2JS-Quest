/** @portOnly Combine cockpit glass with the same moving parent, retaining per-pane uniforms. */
import * as THREE from 'three';

export const SCREEN_BATCH_SIZE = 16;
type Screen = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

export class CockpitScreenBatch {
  private readonly batches: Array<{ mesh: Screen; sources: Screen[] }> = [];

  constructor(screens: Screen[]) {
    const parents = new Map<THREE.Object3D, Screen[]>();
    for (const screen of screens) {
      const parent = screen.parent;
      if (!parent) continue;
      let group = parents.get(parent);
      if (!group) { group = []; parents.set(parent, group); }
      group.push(screen);
    }
    for (const [parent, group] of parents) for (let offset = 0; offset < group.length; offset += SCREEN_BATCH_SIZE) {
      const sources = group.slice(offset, offset + SCREEN_BATCH_SIZE);
      const positions: number[] = [], uvs: number[] = [], ids: number[] = [];
      for (const [id, source] of sources.entries()) {
        positions.push(...source.geometry.getAttribute('position').array);
        uvs.push(...source.geometry.getAttribute('uv').array);
        for (let v = 0; v < source.geometry.getAttribute('position').count; v++) ids.push(id);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setAttribute('aScreen', new THREE.Float32BufferAttribute(ids, 1));
      const material = sources[0]!.material.clone();
      // Share live HUD/inset textures and the original per-pane vectors. A cloned
      // uniform set would freeze rectangles when widgets change layout or mode.
      const array = (name: string) => Array.from({ length: SCREEN_BATCH_SIZE }, (_, i) =>
        sources[i]?.material.uniforms[name]!.value as THREE.Vector4 | undefined ?? new THREE.Vector4());
      material.uniforms = { ...sources[0]!.material.uniforms, uRects: { value: array('uRect') }, uFits: { value: array('uFit') } };
      material.defines = { ...material.defines, MW2_SCREEN_BATCH: SCREEN_BATCH_SIZE };
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'MW2 cockpit screen batch';
      mesh.frustumCulled = false;
      parent.add(mesh);
      this.batches.push({ mesh, sources });
    }
  }

  setEnabled(enabled: boolean): void {
    for (const { mesh, sources } of this.batches) {
      mesh.visible = enabled;
      for (const source of sources) source.visible = !enabled;
    }
  }

  dispose(): void {
    for (const { mesh, sources } of this.batches) {
      mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose();
      for (const source of sources) source.visible = true;
    }
    this.batches.length = 0;
  }
}
