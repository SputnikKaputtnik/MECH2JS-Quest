/** @portOnly A small binocular counter fixed to the lower cockpit, independent of head movement. */
import * as THREE from 'three';

export class FpsOverlay {
  readonly scene = new THREE.Scene();
  private readonly anchor = new THREE.Object3D();
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private label = '';

  constructor() {
    this.canvas.width = 256;
    this.canvas.height = 64;
    this.context = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.055), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    // Lower-right cockpit instrument; turning the head leaves it behind with the mech.
    this.mesh.position.set(0.44, -0.42, -1.15);
    this.mesh.frustumCulled = false;
    this.anchor.matrixAutoUpdate = false;
    this.anchor.add(this.mesh);
    this.scene.add(this.anchor);
  }

  update(fps: number | null, cockpit: THREE.Object3D): void {
    this.anchor.matrix.copy(cockpit.matrixWorld);
    this.anchor.matrixWorldNeedsUpdate = true;
    const label = fps === null ? '-- FPS' : `${Math.round(fps)} FPS`;
    if (label === this.label) return;
    this.label = label;
    const ctx = this.context;
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(5, 12, 9, 0.45)';
    ctx.beginPath(); ctx.roundRect(0, 0, 256, 64, 10); ctx.fill();
    ctx.font = '36px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(188, 213, 196, 0.9)';
    ctx.fillText(label, 128, 33);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.texture.dispose();
  }
}
