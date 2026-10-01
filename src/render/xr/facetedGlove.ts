/** @portOnly Low-poly pointing glove in XR grip space: index points along -Z. */
import * as THREE from 'three';

/** Baked facet lighting keeps the original unlit/palette-like visual style. */
export function faceted(geometry: THREE.BufferGeometry, colour: number): THREE.Mesh {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  g.computeVertexNormals();
  const n = g.getAttribute('normal'), rgb = new THREE.Color(colour), colours: number[] = [];
  for (let i=0;i<n.count;i++) {
    const shade = 0.55 + 0.45 * Math.max(0, n.getX(i)*-0.3+n.getY(i)*0.7+n.getZ(i)*0.6);
    colours.push(rgb.r*shade, rgb.g*shade, rgb.b*shade);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours,3));
  return new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true}));
}
export class FacetedGlove {
  readonly root = new THREE.Group();
  readonly tip: THREE.Vector3;
  constructor(hand: 'left'|'right') {
    this.root.name = `pointing-glove-${hand}`;
    const mirror = hand === 'right' ? 1 : -1;
    this.tip = new THREE.Vector3(-0.026*mirror,0.015,-0.174);
    const lump = (p: number[], size: number[], colour: number) => {
      const mesh=faceted(new THREE.IcosahedronGeometry(1,0),colour);
      mesh.position.set(p[0]!*mirror,p[1]!,p[2]!); mesh.scale.set(size[0]!,size[1]!,size[2]!);
      this.root.add(mesh);
    };
    const finger = (a: number[], b: number[], radius: number, colour: number) => {
      const start=new THREE.Vector3(a[0]!*mirror,a[1]!,a[2]!),end=new THREE.Vector3(b[0]!*mirror,b[1]!,b[2]!);
      const mesh=faceted(new THREE.CylinderGeometry(radius*0.85,radius,start.distanceTo(end),6,1),colour);
      mesh.position.copy(start).add(end).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),end.sub(start).normalize());this.root.add(mesh);
    };
    lump([0,0,0.038],[0.041,0.030,0.030],0x3b4148); // cuff
    lump([0,0,-0.026],[0.047,0.031,0.065],0x747d84); // palm
    lump([0,0.024,-0.028],[0.039,0.012,0.041],0x929b9c); // back plate
    finger([-0.026,0.014,-0.063],[-0.026,0.015,-0.12],0.012,0x889192);
    finger([-0.026,0.015,-0.12],[-0.026,0.015,-0.17],0.0095,0x9aa1a0);
    lump([-0.026,0.015,-0.17],[0.009,0.009,0.009],0x9aa1a0);
    for(let i=0;i<3;i++) {
      const x=-0.003+i*0.022;
      finger([x,0.006,-0.055],[x,-0.024,-0.083],0.011,0x747d84);
      finger([x,-0.024,-0.083],[x,-0.037,-0.045],0.01,0x59636b);
    }
    finger([-0.037,-0.005,0],[-0.054,-0.021,-0.027],0.014,0x747d84);
    finger([-0.054,-0.021,-0.027],[-0.036,-0.034,-0.049],0.012,0x899292);
    this.root.visible=false;
  }
  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose();}});
  }
}
