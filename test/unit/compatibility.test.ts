import { describe, expect, it } from 'vitest';
import { ExeImage } from '../../src/data/exe/ExeImage.ts';
import { executableCompatibility } from '../../src/data/exe/compatibility.ts';
import { K_SIN, K_SCALE, K_STEP, K_DEG } from '../../src/core/angle/trig.ts';
import { SHELL_LABEL } from '../../src/generated/shell/labels.gen.ts';

function fixture(): [ExeImage, ExeImage] {
  const image = () => new ExeImage({low:0x10000,high:0x100000,bytes:new Uint8Array(0xf0000),objects:[],entryPoint:0,initialEsp:0,fixups:{off32:0,rel32:0,off16:0,byte:0,selector:0,unknownSrc:0,outOfRange:0,badObject:0,skippedNonintern:0},pagesLoaded:0,pagesZeroFilled:0});
  const exe=image(),shell=image(), d=new DataView(exe.bytes.buffer),s=new DataView(shell.bytes.buffer);
  for(const [addr,value] of [[0x90fac,K_SIN],[0x90fb4,K_SCALE],[0x90fbc,K_STEP],[0x90fc4,K_DEG],[0x9342c,182]]) d.setFloat64(addr!-exe.low,value!,true);
  for(let i=0;i<31;i++) {
    const p=0x80000+i*64;
    s.setUint32(SHELL_LABEL.controlMapNames+i*4-shell.low,p,true);
    shell.bytes.set(new TextEncoder().encode(i===0?'throttle':i===30?'advance_nav':`control_${i}`),p-shell.low);
  }
  return [exe,shell];
}
describe('executable compatibility preflight',()=>{
  it('accepts the known table layout',()=>expect(executableCompatibility(...fixture())).toEqual([]));
  it('identifies a mismatched sim without writing to the supplied image',()=>{
    const [exe,shell]=fixture();exe.bytes[0x90fac-exe.low]=255;const copy=exe.bytes.slice();
    expect(executableCompatibility(exe,shell)).toEqual([expect.stringContaining('MW2.EXE:')]);
    expect(exe.bytes).toEqual(copy);
  });
  it('rejects invalid shell pointers before seeding controls',()=>{
    const [exe,shell]=fixture();new DataView(shell.bytes.buffer).setUint32(SHELL_LABEL.controlMapNames-shell.low,0x4a504d42,true);
    expect(executableCompatibility(exe,shell)).toEqual([expect.stringContaining('MW2SHELL.EXE:')]);
  });
});
