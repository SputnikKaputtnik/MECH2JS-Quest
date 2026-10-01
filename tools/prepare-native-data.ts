/** @portOnly Stage a private install for the standalone Android content host. */
import fs from 'node:fs';
import path from 'node:path';
import { mw2Root, PORT_DIR } from './paths.ts';
import { questManifest } from './questManifest.ts';
import { INSTALL_REQUIRED } from '../src/data/source/installFiles.ts';

const root = mw2Root();
if (!root || !process.argv[2]) throw Error('Usage: tsx tools/prepare-native-data.ts <private-output-outside-repo>; requires MW2_ROOT');
const output = path.resolve(process.argv[2]);
function within(child: string, parent: string) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
if (within(output, PORT_DIR) || within(output, root) || within(root, output)) throw Error('Use a separate private output directory outside the repo and source install');
if (fs.existsSync(output)) throw Error('Output already exists; choose a new directory to avoid mixing installations');
const manifest = await questManifest(root);
for (const name of INSTALL_REQUIRED) if (!manifest.files.some(file => file.name === name)) throw Error(`Missing required content: ${name}`);
const actualFiles = new Map(fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(item => item.isFile())
  .map(item => {
    const actual = path.join(item.parentPath, item.name);
    return [path.relative(root, actual).replaceAll('\\', '/').toUpperCase(), actual];
  }));
for (const file of manifest.files) {
  const target = path.join(output, file.name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(actualFiles.get(file.name)!, target);
}
// Last file is the commit marker. Incomplete copies never acquire a manifest.
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest));
console.log(JSON.stringify({ output, files: manifest.files.length, bytes: manifest.bytes, id: manifest.id }));
