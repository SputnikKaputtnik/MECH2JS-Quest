/** @portOnly Private OPFS data installation, independent of the PC after import. */
import type { InstallSource } from '../data/source/FileSource.ts';
import { listInstallDir } from '../data/source/installFiles.ts';
import { validateQuestManifest, type QuestManifest } from '../data/source/questManifest.ts';
const ACTIVE = 'mw2.quest.active-install';
const ROOT = 'mw2-quest-installs';
const key = (name: string) => encodeURIComponent(name.replaceAll('\\', '/').toUpperCase());
class OpfsInstall implements InstallSource {
  constructor(private dir: FileSystemDirectoryHandle, readonly manifest: QuestManifest) {}
  private async file(name: string): Promise<File> { return (await this.dir.getFileHandle(key(name))).getFile(); }
  async read(name: string): Promise<Uint8Array> { return new Uint8Array(await (await this.file(name)).arrayBuffer()); }
  async readRange(name: string, start: number, end: number|null): Promise<Uint8Array> { return new Uint8Array(await (await this.file(name)).slice(start,end??undefined).arrayBuffer()); }
  async exists(name: string): Promise<boolean> { return this.manifest.files.some(f=>f.name===name.toUpperCase()); }
  async list(dir: string): Promise<string[]> { return listInstallDir(this.manifest.files.map(f=>f.name),dir); }
}
export async function offlineInstall(): Promise<InstallSource|null> {
  const id=localStorage.getItem(ACTIVE);
  if(!id)return null;
  if(!/^[a-f0-9]{64}(-[a-f0-9-]{36})?$/.test(id))throw Error('Ungültige lokale Installationskennung');
  try {
    const root=await navigator.storage.getDirectory();
    const dir=await (await root.getDirectoryHandle(ROOT)).getDirectoryHandle(id);
    const m=JSON.parse(await (await (await dir.getFileHandle('manifest.json')).getFile()).text()) as QuestManifest;
    validateQuestManifest(m);
    if(m.id!==id.slice(0,64))throw Error('Installationskennung stimmt nicht überein');
    for(const f of m.files)if((await (await dir.getFileHandle(key(f.name))).getFile()).size!==f.size)throw Error(`${f.name} fehlt oder ist unvollständig`);
    return new OpfsInstall(dir,m);
  } catch(error) { throw Error(`Lokale Spieldaten nicht verfügbar. Über ?setup erneut importieren. ${String(error)}`,{cause:error}); }
}
export async function installPrivateData(progress:(text:string)=>void): Promise<{bytes:number;persistent:boolean}> {
  const persistent=await navigator.storage.persist();
  const response=await fetch('/quest-install.json',{cache:'no-store'});
  if(!response.ok)throw Error('PC-Datenserver nicht erreichbar');
  const m=await response.json() as QuestManifest; validateQuestManifest(m);
  const space=await navigator.storage.estimate();
  if((space.quota??0)-(space.usage??0)<m.bytes+64*1024*1024)throw Error('Nicht genug Browserspeicher für die vollständige Installation');
  const root=await navigator.storage.getDirectory();
  // Never rewrite the active installation: it may be in use by another tab.
  if(localStorage.getItem(ACTIVE)?.startsWith(m.id)) {
    try { await offlineInstall(); return {bytes:m.bytes,persistent}; }
    catch { /* repair into a new directory; never overwrite an active install */ }
  }
  const directory=m.id+'-'+crypto.randomUUID();
  const dir=await (await root.getDirectoryHandle(ROOT,{create:true})).getDirectoryHandle(directory,{create:true});
  let done=0;
  for(const f of m.files) {
    const out=await (await dir.getFileHandle(key(f.name),{create:true})).createWritable();
    try {
      for(let i=0;i<f.chunks.length;i++) {
        const start=i*m.chunkBytes,end=Math.min(f.size,start+m.chunkBytes);
        const r=await fetch('/mw2/'+f.name,{headers:{Range:`bytes=${start}-${end-1}`},cache:'no-store'});
        if(r.status!==206)throw Error(`${f.name}: Byte-Bereich fehlt (${r.status})`);
        const bytes=await r.arrayBuffer();
        const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
        if(bytes.byteLength!==end-start || hash!==f.chunks[i])throw Error(`${f.name}: Prüfsumme stimmt nicht`);
        await out.write(bytes); done+=bytes.byteLength;
        progress(`${Math.round(done/m.bytes*100)} % · ${f.name} · ${(done/1048576).toFixed(0)} / ${(m.bytes/1048576).toFixed(0)} MiB`);
      }
      await out.close();
    } catch(error) { await out.abort().catch(()=>{}); throw error; }
  }
  const marker=await (await dir.getFileHandle('manifest.json',{create:true})).createWritable();
  await marker.write(JSON.stringify(m));await marker.close();
  // Pointer is committed last; interrupted imports cannot replace a valid install.
  localStorage.setItem(ACTIVE,directory);
  return {bytes:m.bytes,persistent};
}

export async function installOfflineShell(): Promise<void> {
  const registration=await navigator.serviceWorker.register('/quest-sw.js',{updateViaCache:'none'});
  await registration.update();
  const worker=registration.installing ?? registration.waiting ?? registration.active;
  if(!worker)throw Error('Offline-App hat keinen Service Worker');
  await waitForWorker(worker, ['installed','activating','activated']);
  if(worker.state==='installed')worker.postMessage('activate-installed-build');
  await waitForWorker(worker, ['activated']);
  await navigator.serviceWorker.ready;
  const metaResponse=await fetch('/quest-shell.json',{cache:'no-store'});
  const meta=await metaResponse.json() as {id:string};
  const cache=await caches.open('mw2-quest-shell-'+meta.id);
  if(!await cache.match('/index.html'))throw Error('Offline-App unvollständig. Installation wiederholen.');
}

/** @portOnly Wait on the selected worker itself; registration.waiting can lag its statechange. */
function waitForWorker(worker: ServiceWorker, states: ServiceWorkerState[]): Promise<void> {
  return new Promise((resolve,reject)=>{
    const finish=(error?: Error)=>{
      clearTimeout(timer);
      worker.removeEventListener('statechange',check);
      if(error)reject(error);else resolve();
    };
    const check=()=>{
      if(states.includes(worker.state))finish();
      else if(worker.state==='redundant')finish(Error('Offline-App konnte nicht vollständig gespeichert werden'));
    };
    const timer=setTimeout(()=>finish(Error('Offline-App-Aktivierung dauert zu lange. Installation wiederholen.')),60000);
    worker.addEventListener('statechange',check);
    check();
  });
}
