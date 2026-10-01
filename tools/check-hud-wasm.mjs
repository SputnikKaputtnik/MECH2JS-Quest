/** @portOnly Verify checked-in SIMD source/binary consistency, normalizing Git line endings. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(fs.readFileSync('native/hud-build.json', 'utf8'));
const sha = (file, source = false) => createHash('sha256').update(source
  ? fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n') : fs.readFileSync(file)).digest('hex');
if (sha('native/hud.c', true) !== manifest.sourceSha256 || sha('src/render/wasm/hud.wasm') !== manifest.wasmSha256) {
  throw Error('HUD Wasm source/binary changed: run npm run build:hud and check in source, Wasm and manifest together.');
}
