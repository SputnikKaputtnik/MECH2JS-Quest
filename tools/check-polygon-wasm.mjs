/** @portOnly Prevent shipping a stale checked-in kernel without requiring a C toolchain to run the app. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(fs.readFileSync('native/polygons-build.json', 'utf8'));
const sha = (file, source = false) => createHash('sha256').update(source
  ? fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n') : fs.readFileSync(file)).digest('hex');
if (sha('native/polygons.c', true) !== manifest.sourceSha256 || sha('src/render/wasm/polygons.wasm') !== manifest.wasmSha256) {
  throw Error('Polygon Wasm source/binary changed: run npm run build:polygons and check in the source, Wasm and manifest together.');
}
