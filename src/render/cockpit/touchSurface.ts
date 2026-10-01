/** @portOnly A cockpit control's physical contact surface, shared by both pointing hands. */
import * as THREE from 'three';
import type { Slot } from './kit.ts';
export type CockpitAction = 'override' | 'radarRange';
export interface CockpitTouchTarget {
  readonly action: CockpitAction;
  readonly width: number;
  readonly height: number;
  enabled: boolean;
  contactMatrix(out: THREE.Matrix4): THREE.Matrix4;
  localTip(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
  setState(pressed: boolean, active: boolean): void;
}
export class RadarTouchSurface implements CockpitTouchTarget {
  readonly action = 'radarRange';
  enabled = true;
  readonly root = new THREE.Group();
  readonly width: number;
  readonly height: number;
  private readonly outline: THREE.LineLoop;
  constructor(slot: Slot) {
    this.root.name = 'radar-range-touch';
    const [tl,tr,,bl]=slot.corners.map(p=>new THREE.Vector3(...p)) as [THREE.Vector3,THREE.Vector3,THREE.Vector3,THREE.Vector3];
    const right=tr.clone().sub(tl),up=tl.clone().sub(bl);
    this.width=right.length();this.height=up.length();right.normalize();up.normalize();
    this.root.position.copy(tr).add(bl).multiplyScalar(0.5);
    this.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,right.clone().cross(up).normalize()));
    const w=this.width/2,h=this.height/2;
    const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-w,-h,0.002),new THREE.Vector3(w,-h,0.002),new THREE.Vector3(w,h,0.002),new THREE.Vector3(-w,h,0.002)]);
    this.outline=new THREE.LineLoop(geometry,new THREE.LineBasicMaterial({color:0xffbd50}));this.outline.visible=false;this.root.add(this.outline);
  }
  localTip(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true,false);return this.root.worldToLocal(out.copy(world));
  }
  contactMatrix(out: THREE.Matrix4): THREE.Matrix4 {
    this.root.updateWorldMatrix(true,false);
    return out.copy(this.root.matrixWorld).invert();
  }
  setState(pressed: boolean): void {this.outline.visible=pressed;}
  dispose(): void {this.root.removeFromParent();this.outline.geometry.dispose();(this.outline.material as THREE.Material).dispose();}
}
