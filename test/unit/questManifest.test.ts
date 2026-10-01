import { expect, it } from 'vitest';
import { validateQuestManifest, type QuestManifest } from '../../src/data/source/questManifest.ts';
const manifest=():QuestManifest=>({version:1,id:'a'.repeat(64),chunkBytes:4194304,bytes:9,files:['MW2.PRJ','MW2.EXE','MW2SHELL.EXE'].map(name=>({name,size:3,chunks:['b'.repeat(64)]}))});
it('accepts whitelisted complete manifests',()=>expect(()=>validateQuestManifest(manifest())).not.toThrow());
it.each(['../MW2.EXE','MW2PRM.CFG','INPUT.MAP','GIDDI/KEYBOARD.CPC'])('rejects traversal and original save/control files: %s',name=>{
  const m=manifest();m.files.push({name,size:0,chunks:[]});expect(()=>validateQuestManifest(m)).toThrow();
});
it('rejects incomplete, duplicated and wrongly sized transfers',()=>{
  const missing=manifest();missing.files.pop();expect(()=>validateQuestManifest(missing)).toThrow();
  const duplicate=manifest();duplicate.files.push(duplicate.files[0]!);expect(()=>validateQuestManifest(duplicate)).toThrow();
  const size=manifest();size.files[0]!.size+=4194304;expect(()=>validateQuestManifest(size)).toThrow();
  const digest=manifest();digest.files[0]!.chunks[0]='not-a-digest';expect(()=>validateQuestManifest(digest)).toThrow();
});
