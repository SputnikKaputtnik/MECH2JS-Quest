/** @portOnly Controller grips become tracked pointing gloves for physical cockpit controls. */
import * as THREE from 'three';
import { FacetedGlove } from '../render/xr/facetedGlove.ts';
import { GloveContact } from '../render/xr/gloveContact.ts';
import type { CockpitTouchTarget, CockpitAction } from '../render/cockpit/touchSurface.ts';
export class CockpitHands {
  readonly scene = new THREE.Scene();
  private readonly hands = (['left','right'] as const).map(side=>({side,glove:new FacetedGlove(side),ready:new Set<CockpitTouchTarget>(),source:null as XRInputSource|null}));
  private readonly poseMatrix = new THREE.Matrix4();
  private readonly contact = new GloveContact();
  private last = 0;
  private held = new Set<CockpitTouchTarget>();
  constructor() { for(const h of this.hands){h.glove.root.matrixAutoUpdate=false;this.scene.add(h.glove.root);} }
  update(renderer: THREE.WebGLRenderer, rig: THREE.Object3D, targets: readonly CockpitTouchTarget[], enabled: boolean, active: boolean, now: number, press: (action: CockpitAction)=>void): void {
    const session=renderer.xr.getSession(),frame=renderer.xr.getFrame(),reference=renderer.xr.getReferenceSpace();
    if(now-this.last>250) this.reset();
    this.last=now;
    if(!enabled || session?.visibilityState!=='visible' || !frame || !reference) {
      this.reset();for(const t of targets)t.setState(false,t.action==='override'&&active);return;
    }
    const pressed=new Set<CockpitTouchTarget>();
    const triggered=new Map<CockpitTouchTarget,XRInputSource>();
    for(const h of this.hands){
      const source=Array.from(session.inputSources).find(s=>s.handedness===h.side)??null;
      if(source!==h.source){h.ready.clear();h.glove.root.visible=false;h.source=source;}
      const grip=source?.gamepad?.buttons[1]?.value??0;
      const held=grip>(h.glove.root.visible?0.4:0.6);
      const pose=held&&source?.gripSpace?frame.getPose(source.gripSpace,reference):null;
      h.glove.root.visible=!!pose&&!pose.emulatedPosition;
      if(!h.glove.root.visible || !pose){h.ready.clear();continue;}
      this.poseMatrix.fromArray(pose.transform.matrix);
      h.glove.root.matrix.multiplyMatrices(rig.matrixWorld,this.poseMatrix);
      h.glove.root.matrixWorldNeedsUpdate=true;h.glove.root.updateMatrixWorld(true);
      for(const target of h.ready)if(!targets.includes(target)||!target.enabled)h.ready.delete(target);
      for(const target of targets){
        if(!target.enabled)continue;
        if(this.contact.intersects(h.glove.root,target,this.held.has(target))){
          pressed.add(target);
          if(h.ready.delete(target)&&source)triggered.set(target,source);
        } else h.ready.add(target);
      }
    }
    for(const [target,source] of triggered)if(!this.held.has(target)){
      press(target.action);
      const actuator=source.gamepad?.hapticActuators?.[0];
      if(actuator)void actuator.pulse(0.45,35).catch(()=>{});
    }
    this.held=pressed;
    for(const t of targets)t.setState(pressed.has(t),t.action==='override'&&active);
  }
  reset(): void {
    this.held.clear();
    for(const h of this.hands){h.ready.clear();h.glove.root.visible=false;h.source=null;}
  }
  dispose(): void { for(const h of this.hands)h.glove.dispose(); }
}
