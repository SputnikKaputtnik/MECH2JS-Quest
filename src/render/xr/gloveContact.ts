/** @portOnly Solid contact against every convex piece of the visible low-poly glove. */
import * as THREE from 'three';
import type { CockpitTouchTarget } from '../cockpit/touchSurface.ts';

export class GloveContact {
  private readonly box = new THREE.Box3();
  private readonly local = new THREE.Matrix4();
  private readonly transform = new THREE.Matrix4();
  private readonly triangle = new THREE.Triangle();
  private readonly normal = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();
  private readonly nearest = new THREE.Vector3();

  intersects(root: THREE.Group, target: CockpitTouchTarget, held = false): boolean {
    const margin = held ? 0.006 : 0.002;
    this.box.min.set(-target.width/2-margin, -target.height/2-margin, -0.012-margin);
    this.box.max.set(target.width/2+margin, target.height/2+margin, margin);
    target.contactMatrix(this.local);
    for (const part of root.children) {
      if (!(part instanceof THREE.Mesh) || !part.visible) continue;
      const geometry = part.geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      this.transform.multiplyMatrices(this.local, part.matrixWorld);
      this.centre.copy(geometry.boundingSphere!.center).applyMatrix4(this.transform);
      const radius = geometry.boundingSphere!.radius * this.transform.getMaxScaleOnAxis();
      this.box.clampPoint(this.centre, this.nearest);
      if (this.nearest.distanceToSquared(this.centre) > radius*radius) continue;
      const positions = geometry.getAttribute('position'), index = geometry.index;
      const count = index?.count ?? positions.count;
      let containsCentre = true;
      for (let i = 0; i < count; i += 3) {
        this.triangle.a.fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(this.transform);
        this.triangle.b.fromBufferAttribute(positions, index ? index.getX(i+1) : i+1).applyMatrix4(this.transform);
        this.triangle.c.fromBufferAttribute(positions, index ? index.getX(i+2) : i+2).applyMatrix4(this.transform);
        if (this.box.intersectsTriangle(this.triangle)) return true;
        // Also count a control completely enclosed by a solid glove part.
        this.triangle.getNormal(this.normal);
        this.box.getCenter(this.centre).sub(this.triangle.a);
        if (this.normal.dot(this.centre) > 1e-7) containsCentre = false;
      }
      if (containsCentre && count > 0) return true;
    }
    return false;
  }
}
