/**
 * The port's own files - everything MW2SHELL.EXE and MW2.EXE write (the
 * pilot registry, mw2prm.cfg, the cfg files, the star BWDs, user MEKs) -
 * kept in the browser's IndexedDB so a career survives a reload. The engine
 * sees them as the 'own' layer of engine/dosFiles.ts; this module restores
 * that layer at start-up and writes every change back.
 *
 * @portOnly the host's persistence for the virtual DOS disk
 */
import { setDiskPersistence, setOwnFiles } from '../engine/dosFiles.ts';
import { warn } from '../core/log.ts';

const DB = 'mw2-port';
const STORE = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let db: Promise<IDBDatabase> | null = null;

async function all(): Promise<Map<string, Uint8Array>> {
  const d = await (db ??= open());
  return new Promise((resolve, reject) => {
    const out = new Map<string, Uint8Array>();
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      out.set(String(c.key), new Uint8Array(c.value as ArrayBuffer));
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** @portOnly Export only the port's saves/configuration; never the game assets. */
export async function exportSaveBackup(): Promise<string> {
  const files: Record<string,string>={};
  for(const [name,bytes] of await all()) {
    let text='';for(const byte of bytes)text+=String.fromCharCode(byte);
    files[name]=btoa(text);
  }
  return JSON.stringify({format:'mw2-quest-saves',version:1,created:new Date().toISOString(),files},null,2);
}

/** Replaces the own-file database atomically; the caller opens the game again afterwards. */
export async function importSaveBackup(text: string): Promise<void> {
  if(text.length>32*1024*1024)throw Error('Sicherung ist zu groß');
  const data=JSON.parse(text) as {format:string;version:number;files:Record<string,string>};
  if(data.format!=='mw2-quest-saves'||data.version!==1||!data.files||typeof data.files!=='object'||Array.isArray(data.files))throw Error('Keine MW2-Spielstandsicherung');
  const files=new Map<string,ArrayBuffer>();
  for(const [name,encoded] of Object.entries(data.files)) {
    if(!/^[A-Z0-9_./-]+$/i.test(name)||name.includes('..')||typeof encoded!=='string')throw Error('Ungültiger Dateieintrag');
    if(/\.(EXE|DLL|BIN|CUE|PRJ|MW2|SMK|SFL|SHP)$/i.test(name))throw Error('Spieldaten gehören nicht in eine Spielstandsicherung');
    const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));files.set(name,bytes.buffer);
  }
  const d=await(db??=open()),tx=d.transaction(STORE,'readwrite'),s=tx.objectStore(STORE);
  s.clear();for(const [name,bytes] of files)s.put(bytes,name);
  await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('Wiederherstellung abgebrochen'));});
}

async function put(key: string, bytes: Uint8Array | null): Promise<void> {
  const d = await (db ??= open());
  const tx = d.transaction(STORE, 'readwrite');
  const s = tx.objectStore(STORE);
  if (bytes) s.put(bytes.slice().buffer, key);
  else s.delete(key);
  // settles when the write is committed, so a failed save (quota, storage cleared) is reported
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

/**
 * Restores the port's files into the disk and starts saving changes. When
 * IndexedDB is unavailable (a private window, blocked storage) the disk still
 * works, for this session only.
 */
export async function attachDiskStore(): Promise<Map<string, Uint8Array>> {
  let files = new Map<string, Uint8Array>();
  try {
    files = await all();
  } catch (e) {
    warn('disk', `IndexedDB unavailable, the port's files will not be kept: ${String(e)}`);
    setOwnFiles(files);
    return files;
  }
  setOwnFiles(files);
  setDiskPersistence((key, bytes) => {
    put(key, bytes).catch((e: unknown) => warn('disk', `could not save ${key}: ${String(e)}`));
  });
  return files;
}
