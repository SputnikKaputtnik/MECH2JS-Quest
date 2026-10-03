/** @portOnly A small binocular counter fixed to the lower cockpit, independent of head movement. */
import * as THREE from 'three';

/** @portOnly Colour the measured value, before rounding it for display. */
export function fpsColour(fps: number | null): string {
  return fps === null ? '#bcc5c1' : fps < 60 ? '#ff7070' : fps < 89 ? '#f2cd61' : '#80d99a';
}

export class FpsOverlay {
  readonly scene = new THREE.Scene();
  private readonly anchor = new THREE.Object3D();
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private label = '';

  constructor() {
    this.canvas.width = 512;
    this.canvas.height = 64;
    // Keep this tiny, frequently uploaded texture CPU-backed. An accelerated
    // canvas can force a synchronizing GPU copy during native XR submission.
    this.context = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.055), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    // Lower-right cockpit instrument; turning the head leaves it behind with the mech.
    this.mesh.position.set(0.44, -0.42, -1.15);
    this.mesh.frustumCulled = false;
    this.anchor.matrixAutoUpdate = false;
    this.anchor.add(this.mesh);
    this.scene.add(this.anchor);
  }

  update(fps: number | null, missionFps: number | null, cockpit: THREE.Object3D): void {
    this.anchor.matrix.copy(cockpit.matrixWorld);
    this.anchor.matrixWorldNeedsUpdate = true;
    const current = fps === null ? '-- FPS' : `${Math.round(fps)} FPS`;
    const average = missionFps === null ? 'Ø --.-' : `Ø ${missionFps.toFixed(1)}`;
    const colour = fpsColour(fps), averageColour = fpsColour(missionFps);
    const label = `${current}|${average}|${colour}|${averageColour}`;
    if (label === this.label) return;
    this.label = label;
    const ctx = this.context;
    ctx.clearRect(0, 0, 512, 64);
    ctx.fillStyle = 'rgba(5, 12, 9, 0.45)';
    ctx.beginPath(); ctx.roundRect(0, 0, 512, 64, 10); ctx.fill();
    ctx.font = '36px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = colour;
    ctx.fillText(current, 128, 33);
    ctx.fillStyle = averageColour;
    ctx.fillText(average, 384, 33);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.texture.dispose();
  }
}
