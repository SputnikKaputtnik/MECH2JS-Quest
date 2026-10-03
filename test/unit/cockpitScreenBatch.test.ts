import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CockpitScreenBatch, SCREEN_BATCH_SIZE } from '../../src/render/cockpit/screenBatch.ts';
import { CockpitRenderer, slotPanes } from '../../src/render/cockpit/cockpit.ts';
import { buildDesign, DESIGNS } from '../../src/render/cockpit/designs/index.ts';

function screen(parent: THREE.Object3D, x: number) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([x,0,0, x+1,0,0, x,1,0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0,0, 1,0, 0,1], 2));
  const material = new THREE.ShaderMaterial({ uniforms: {
    uRect: { value: new THREE.Vector4(x, 2, 10, 20) }, uFit: { value: new THREE.Vector4(0, 0, 1, 1) },
    uBlank: { value: 4 }, uWindow: { value: new THREE.Texture() },
  } });
  const mesh = new THREE.Mesh(geometry, material);
  parent.add(mesh);
  return mesh;
}

it('preserves geometry and live pane/inset uniforms when replacing separate draws', () => {
  const parent = new THREE.Group(), a = screen(parent, 0), b = screen(parent, 2);
  const batch = new CockpitScreenBatch([a, b]);
  const mesh = parent.children.find(c => c.name === 'MW2 cockpit screen batch') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  expect([...mesh.geometry.getAttribute('position').array]).toEqual([...a.geometry.getAttribute('position').array, ...b.geometry.getAttribute('position').array]);
  expect([...mesh.geometry.getAttribute('aScreen').array]).toEqual([0,0,0,1,1,1]);
  expect(mesh.material.uniforms.uWindow).toBe(a.material.uniforms.uWindow);
  b.material.uniforms.uRect!.value.set(10, 20, 30, 40);
  b.material.uniforms.uFit!.value.set(0, 0, 0, 0); // widget disappears / unlit glass
  expect(mesh.material.uniforms.uRects!.value[1].toArray()).toEqual([10,20,30,40]);
  expect(mesh.material.uniforms.uFits!.value[1].toArray()).toEqual([0,0,0,0]);
  a.material.uniforms.uBlank!.value = 7;
  expect(mesh.material.uniforms.uBlank!.value).toBe(7);
  batch.setEnabled(true);
  expect([a.visible,b.visible,mesh.visible]).toEqual([false,false,true]);
  batch.setEnabled(false);
  expect([a.visible,b.visible,mesh.visible]).toEqual([true,true,false]);
  const disposeGeometry=vi.fn(), disposeMaterial=vi.fn(), disposeSource=vi.fn();
  mesh.geometry.addEventListener('dispose',disposeGeometry);mesh.material.addEventListener('dispose',disposeMaterial);
  a.geometry.addEventListener('dispose',disposeSource);
  batch.dispose();batch.dispose();
  expect(disposeGeometry).toHaveBeenCalledTimes(1);expect(disposeMaterial).toHaveBeenCalledTimes(1);
  expect(disposeSource).not.toHaveBeenCalled();expect(parent.children).toEqual([a,b]);
});

it('keeps moving-parent transforms separate and splits large designs at the shader capacity', () => {
  const anchor=new THREE.Group(), lever=new THREE.Group();anchor.add(lever);
  const sources=Array.from({length:SCREEN_BATCH_SIZE+1},(_,i)=>screen(anchor,i));
  sources.push(screen(lever,0));
  const batch=new CockpitScreenBatch(sources);batch.setEnabled(true);
  const meshes: THREE.Mesh[]=[];
  anchor.traverse(o=>{if(o.name==='MW2 cockpit screen batch')meshes.push(o as THREE.Mesh);});
  expect(meshes).toHaveLength(3);
  lever.rotation.x=0.45;anchor.position.set(3,2,1);anchor.updateMatrixWorld(true);
  const moving=meshes.find(m=>m.parent===lever)!;
  expect(moving.matrixWorld.elements).toEqual(sources.at(-1)!.matrixWorld.elements);
  for(const mesh of meshes){
    const ids=[...mesh.geometry.getAttribute('aScreen').array];
    expect(Math.max(...ids)).toBeLessThan(SCREEN_BATCH_SIZE);
  }
  batch.dispose();
});

it('rebuilds every real cockpit without leaving old batches or changing touch targets', () => {
  const cockpit=new CockpitRenderer({uPalette:{value:null},uWindow:{value:null},uWindowSize:{value:new THREE.Vector2(640,480)},
    uInset0:{value:null},uInset1:{value:null},uInset2:{value:null},uInset3:{value:null},uInsetRect:{value:[]}});
  const panes=slotPanes(()=>({x:1,y:2,w:100,h:40}));
  const batches=()=>{const found:THREE.Object3D[]=[];cockpit.scene.traverse(o=>{if(o.name==='MW2 cockpit screen batch')found.push(o);});return found;};
  for(const design of Object.values(DESIGNS)){
    const previous=batches();cockpit.setDesign(design,buildDesign);
    expect(previous.every(m=>m.parent===null)).toBe(true);
    cockpit.batchScreens=true;cockpit.update(new THREE.Matrix4(),panes,{throttle:0.5,turn:0.25,tilt:-0.25});
    expect(batches().length,design.key).toBeGreaterThan(0);
    expect(batches().every(m=>m.visible),design.key).toBe(true);
    expect(cockpit.touchTargets.map(t=>t.action).sort()).toEqual(['override','radarRange']);
    const shown=cockpit.shown.map(p=>({...p})),targets=[...cockpit.touchTargets];
    cockpit.batchScreens=false;cockpit.update(new THREE.Matrix4(),panes,{throttle:0.5,turn:0.25,tilt:-0.25});
    expect(cockpit.shown).toEqual(shown);expect(cockpit.touchTargets).toEqual(targets);
    expect(batches().every(m=>!m.visible)).toBe(true);
  }
  cockpit.setDesign(null,buildDesign);expect(batches()).toHaveLength(0);expect(cockpit.touchTargets).toHaveLength(0);
  cockpit.dispose();
});
