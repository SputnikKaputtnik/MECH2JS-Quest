/** @portOnly Build inventory contains app code/assets, never original game files. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root=path.resolve('dist');
const files=fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>path.relative(root,path.join(e.parentPath,e.name)).replaceAll('\\','/')).filter(n=>n!=='quest-shell.json'&&n!=='quest-sw.js').sort();
const hash=createHash('sha256');
for(const f of files){hash.update(f);hash.update(fs.readFileSync(path.join(root,f)));}
const id=hash.digest('hex');
fs.writeFileSync(path.join(root,'quest-shell.json'),JSON.stringify({id,files:files.map(f=>'/'+f)}));
// Changing the worker bytes triggers an update for each compiled app version.
const worker=path.join(root,'quest-sw.js');
fs.writeFileSync(worker,`const BUILD_ID = '${id}';\n`+fs.readFileSync(worker,'utf8'));
console.log('Offline app inventory:',files.length,'files,',id);
