import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GloveContact } from '../../src/render/xr/gloveContact.ts';
import { PhysicalPress } from '../../src/render/xr/physicalPress.ts';
import { FacetedGlove } from '../../src/render/xr/facetedGlove.ts';
import { RadarTouchSurface } from '../../src/render/cockpit/touchSurface.ts';
import { OverrideButton } from '../../src/render/cockpit/overrideButton.ts';
import { CockpitHands } from '../../src/app/cockpitHands.ts';
import { buildDesign, DESIGNS } from '../../src/render/cockpit/designs/index.ts';

it('requires a front approach, fires once per push, and resets on lost tracking', () => {
  const b=new PhysicalPress();
  const p=(z:number,x=0)=>b.update({x,y:0,z},0.05,0.04);
  expect(p(0)).toBe(false); // grip pressed while already intersecting
  expect(p(0.05)).toBe(false);
  expect(p(0)).toBe(true);
  expect(p(-0.01)).toBe(false);
  expect(p(0.015)).toBe(false); // jitter does not re-arm
  expect(p(0)).toBe(false);
  b.update(null,0.05,0.04);
  expect(p(0)).toBe(false);
  p(0.05);expect(p(0,0.2)).toBe(false); // sweep misses the footprint
  p(0.05);expect(p(-0.01)).toBe(true);
  b.reset();p(0.5);expect(p(0)).toBe(false); // tracking jump
});

it('puts one readable, reachable button beside every cockpit heat slot, preserving room for the gauge', () => {
  for(const d of Object.values(DESIGNS)){
    const kit=buildDesign(d);
    const slot=kit.slots.find(s=>s.part.pane==='heat')!;
    expect(slot,d.key).toBeDefined();
    const width=new THREE.Vector3(...slot.corners[0]).distanceTo(new THREE.Vector3(...slot.corners[1]));
    const gaugeHeight=new THREE.Vector3(...slot.corners[1]).distanceTo(new THREE.Vector3(...slot.corners[2]));
    const b=new OverrideButton(slot);
    expect(b.width,d.key).toBeGreaterThan(0.018);
    expect(b.height,d.key).toBeCloseTo(gaugeHeight,8);
    expect(b.root.position.length(),d.key).toBeLessThan(1);
    expect(new THREE.Vector3(...slot.corners[0]).distanceTo(new THREE.Vector3(...slot.corners[1])),d.key).toBeGreaterThan(width*0.6);
    b.dispose();
  }
});

it('tracks either glove in the moving rig, activates the original callback, and suppresses menus and lost poses', () => {
  for(const side of ['left','right'] as const)for(const action of ['override','radarRange'] as const){
    const slot=buildDesign(DESIGNS.TW!).slots.find(s=>s.part.pane===(action==='override'?'heat':'radar'))!;
    const b=action==='override'?new OverrideButton(slot):new RadarTouchSurface(slot),hands=new CockpitHands(),glove=new FacetedGlove(side);
    const rig=new THREE.Object3D();rig.position.set(10,2,5);rig.rotation.y=0.5;rig.add(b.root);rig.updateMatrixWorld(true);
    const pulse=vi.fn(async()=>true),press=vi.fn();
    const source={handedness:side,gripSpace:{},gamepad:{buttons:[{value:0},{value:1}],hapticActuators:[{pulse}]}};
    const session={visibilityState:'visible',inputSources:[source]};
    const matrix=new THREE.Matrix4();let tracked=true;
    const xr={getSession:()=>session,getReferenceSpace:()=>({}),getFrame:()=>({getPose:()=>tracked?{emulatedPosition:false,transform:{matrix:matrix.elements}}:null})};
    const renderer={xr} as unknown as THREE.WebGLRenderer;
    let now=1000;
    const step=(z:number,enabled=true)=>{
      const tip=b.root.localToWorld(new THREE.Vector3(0,0,z+(action==='override'?0.018:0)));rig.worldToLocal(tip).sub(glove.tip);matrix.makeTranslation(tip.x,tip.y,tip.z);
      hands.update(renderer,rig,[b],enabled,false,now+=11,press);
    };
    step(0.06);step(0);step(-0.01);
    expect(press).toHaveBeenCalledTimes(1);expect(press).toHaveBeenCalledWith(action);expect(pulse).toHaveBeenCalledWith(0.45,35);
    if(b instanceof OverrideButton)expect(b.cap.position.z).toBeLessThan(0);
    tracked=false;step(0);tracked=true;step(0);
    expect(press).toHaveBeenCalledTimes(1);
    step(0.06);step(0,false);step(0);
    expect(press).toHaveBeenCalledTimes(1);
    step(0.06);step(0);
    expect(press).toHaveBeenCalledTimes(2);
    b.enabled=false;step(0.06);step(0);
    expect(press).toHaveBeenCalledTimes(2);
    hands.dispose();glove.dispose();b.dispose();
  }
});


it('counts solid contact from every glove part, including palm, back and cuff, in either hand', () => {
  const contact = new GloveContact();
  const matrix = new THREE.Matrix4();
  const target = {
    action: 'radarRange' as const, enabled: true, width: 0.004, height: 0.004,
    contactMatrix: (out: THREE.Matrix4) => out.copy(matrix),
    localTip: (world: THREE.Vector3, out: THREE.Vector3) => out.copy(world).applyMatrix4(matrix),
    setState: () => {},
  };
  for (const side of ['left', 'right'] as const) {
    const glove = new FacetedGlove(side);
    glove.root.position.set(2, 3, -4);
    glove.root.rotation.set(0.3, -0.7, 0.2);
    glove.root.updateMatrixWorld(true);
    for (const part of glove.root.children) {
      // Isolate each piece so another finger cannot mask a missing collider.
      for (const candidate of glove.root.children) candidate.visible = candidate === part;
      const centre = part.getWorldPosition(new THREE.Vector3());
      matrix.makeTranslation(-centre.x, -centre.y, -centre.z);
      expect(contact.intersects(glove.root, target)).toBe(true);
      matrix.makeTranslation(-centre.x + 0.5, -centre.y, -centre.z);
      expect(contact.intersects(glove.root, target)).toBe(false);
    }
    glove.dispose();
  }
});
