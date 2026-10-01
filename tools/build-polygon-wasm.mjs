/** @portOnly Reproducible freestanding C build; no Emscripten runtime or game assets. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const ndk = 'C:/Android/Sdk/ndk/27.2.12479018/toolchains/llvm/prebuilt/windows-x86_64/bin/clang.exe';
const clang = process.env.WASM_CC ?? (fs.existsSync(ndk) ? ndk : 'clang');
execFileSync(clang, ['--target=wasm32', '-O3', '-nostdlib', '-ffreestanding', '-fno-builtin',
  '-ffp-contract=off', '-Wall', '-Wextra', '-Werror', '-Wl,--no-entry', '-Wl,--export-memory',
  '-Wl,--initial-memory=8388608', '-Wl,--max-memory=8388608', '-Wl,--strip-all',
  'native/polygons.c', '-o', 'src/render/wasm/polygons.wasm'], { stdio: 'inherit', windowsHide: true });
console.log('Built freestanding polygon kernel:', fs.statSync('src/render/wasm/polygons.wasm').size, 'bytes');
const sha = (file, source = false) => createHash('sha256').update(source
  ? fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n') : fs.readFileSync(file)).digest('hex');
fs.writeFileSync('native/polygons-build.json', JSON.stringify({
  sourceSha256: sha('native/polygons.c', true), wasmSha256: sha('src/render/wasm/polygons.wasm'),
  compiler: execFileSync(clang, ['--version'], { encoding: 'utf8', windowsHide: true }).split('\n')[0].trim(),
}, null, 2) + '\n');
