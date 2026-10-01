/** @portOnly Private transfer manifest. Only the existing content whitelist is exported. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isInstallFile } from '../src/data/source/installFiles.ts';
export const CHUNK_BYTES = 4 * 1024 * 1024;
export async function questManifest(root: string) {
  const files: { name: string; size: number; chunks: string[] }[] = [];
  for (const item of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!item.isFile()) continue;
    const actual = path.join(item.parentPath, item.name);
    const name = path.relative(root, actual).replaceAll('\\', '/').toUpperCase();
    if (!isInstallFile(name)) continue;
    const chunks: string[] = [];
    for await (const chunk of fs.createReadStream(actual, { highWaterMark: CHUNK_BYTES }))
      chunks.push(createHash('sha256').update(chunk).digest('hex'));
    files.push({ name, size: fs.statSync(actual).size, chunks });
  }
  files.sort((a,b)=>a.name.localeCompare(b.name));
  const id = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  return { version: 1, id, chunkBytes: CHUNK_BYTES, files, bytes: files.reduce((n,f)=>n+f.size,0) };
}
