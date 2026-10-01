/** @portOnly Read-only compatibility report; no game bytes are written. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ExeImage } from '../src/data/exe/ExeImage.ts';
import { executableCompatibility } from '../src/data/exe/compatibility.ts';
import { mw2Root } from './paths.ts';
const root = process.argv[2] ?? mw2Root();
if (!root) throw Error('Pass the install directory or set MW2_ROOT');
const images = ['MW2.EXE', 'MW2SHELL.EXE'].map(name => {
  const bytes = fs.readFileSync(path.join(root, name));
  console.log(JSON.stringify({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
  return ExeImage.fromExe(bytes);
});
const errors = executableCompatibility(images[0]!, images[1]!);
console.log(errors.length ? errors.join('\n') : 'Executable layout checks passed; run the mission and shell tests next.');
process.exitCode = errors.length ? 2 : 0;
