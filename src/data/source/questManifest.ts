/** @portOnly Manifest format shared by the private importer and tests. */
import { INSTALL_REQUIRED, isInstallFile } from './installFiles.ts';
export interface QuestManifest {
  version: number; id: string; chunkBytes: number; bytes: number;
  files: { name: string; size: number; chunks: string[] }[];
}
export function validateQuestManifest(m: QuestManifest): void {
  if (m.version !== 1 || !/^[a-f0-9]{64}$/.test(m.id) || m.chunkBytes !== 4*1024*1024 || !Array.isArray(m.files)) throw Error('Ungültiges Importmanifest');
  const names=new Set<string>(); let total=0;
  for(const f of m.files) {
    if (f.name!==f.name.toUpperCase() || !isInstallFile(f.name) || names.has(f.name) || !Number.isSafeInteger(f.size) || f.size<0 || !Array.isArray(f.chunks) || f.chunks.length!==Math.ceil(f.size/m.chunkBytes) || !f.chunks.every(s=>/^[a-f0-9]{64}$/.test(s))) throw Error('Ungültige Datei im Importmanifest');
    names.add(f.name); total+=f.size;
  }
  if(total!==m.bytes || !INSTALL_REQUIRED.every(n=>names.has(n)))throw Error('Importmanifest unvollständig');
}
