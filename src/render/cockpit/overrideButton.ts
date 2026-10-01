/** @portOnly Physical OVR button beside the heat gauge of each cockpit design. */
import * as THREE from 'three';
import type { Slot } from './kit.ts';
import { faceted } from '../xr/facetedGlove.ts';
export class OverrideButton {
  readonly action = 'override';
  enabled = true;
  readonly root = new THREE.Group();
  readonly cap = new THREE.Group();
  readonly width: number;
  readonly height: number;
  private readonly lamp: THREE.MeshBasicMaterial;
  private readonly texture: THREE.DataTexture;
  constructor(slot: Slot) {
    this.root.name = 'override-button';
    const [tl,tr,br,bl]=slot.corners.map(p=>new THREE.Vector3(...p)) as [THREE.Vector3,THREE.Vector3,THREE.Vector3,THREE.Vector3];
    const right=tr.clone().sub(tl).normalize(),up=tl.clone().sub(bl).normalize(),normal=right.clone().cross(up).normalize();
    const reserve=Math.min(0.065,tl.distanceTo(tr)*0.36);
    this.width=reserve-0.004;this.height=tr.distanceTo(br);
    const centre=tr.clone().add(br).multiplyScalar(0.5).addScaledVector(right,-reserve/2).addScaledVector(normal,0.008);
    this.root.position.copy(centre);this.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,normal));
    // Reserve a column alongside the gauge, without covering its pixels.
    slot.corners[1]=tr.addScaledVector(right,-reserve).toArray() as [number,number,number];
    slot.corners[2]=br.addScaledVector(right,-reserve).toArray() as [number,number,number];
    const housing=faceted(new THREE.BoxGeometry(this.width+0.006,this.height+0.006,0.018),0x42484b);
    this.root.add(housing,this.cap);
    const top=faceted(new THREE.BoxGeometry(this.width,this.height,0.012),0xd4332b);
    top.position.z=0.012;this.cap.add(top);
    const glyphs=['111101101101111','101101101101010','110101110101101'];
    const pixels=new Uint8Array(16*8*4);
    for(let g=0;g<3;g++)for(let y=0;y<5;y++)for(let x=0;x<3;x++)if(glyphs[g]![y*3+x]==='1'){
      const at=((6-y)*16+2+g*4+x)*4;pixels.set([255,240,194,255],at);
    }
    this.texture=new THREE.DataTexture(pixels,16,8);this.texture.needsUpdate=true;
    this.texture.magFilter=THREE.NearestFilter;this.texture.minFilter=THREE.NearestFilter;
    const label=new THREE.Mesh(new THREE.PlaneGeometry(this.width*0.94,this.height*0.85),new THREE.MeshBasicMaterial({map:this.texture,transparent:true,depthWrite:false}));
    label.position.z=0.019;this.cap.add(label);
    this.lamp=new THREE.MeshBasicMaterial({color:0x403016});
    const lamp=new THREE.Mesh(new THREE.BoxGeometry(this.width*0.65,0.003,0.002),this.lamp);
    lamp.position.set(0,-this.height/2+0.002,0.02);this.cap.add(lamp);
  }
  setState(pressed: boolean, active: boolean): void {
    this.cap.position.z=pressed?-0.008:0;
    this.lamp.color.setHex(active?0xffb43b:pressed?0xffde92:0x403016);
  }
  /** Face coordinates in metres, positive Z toward the pilot. */
  localTip(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true,false);
    out.copy(world);this.root.worldToLocal(out);out.z-=0.018;return out;
  }
  dispose(): void {
    this.root.removeFromParent();this.texture.dispose();
    this.root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose();}});
  }
}
