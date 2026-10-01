/** @portOnly Reject incompatible executable layouts before reading fixed-address tables. */
import type { ExeImage } from './ExeImage.ts';
import { K_SIN, K_SCALE, K_STEP, K_DEG } from '../../core/angle/trig.ts';
import { SHELL_LABEL } from '../../generated/shell/labels.gen.ts';

export function executableCompatibility(exe: ExeImage, shell: ExeImage): string[] {
  const errors: string[] = [];
  const constants = [[0x90fac, K_SIN], [0x90fb4, K_SCALE], [0x90fbc, K_STEP], [0x90fc4, K_DEG], [0x9342c, 182]] as const;
  if (!constants.every(([addr, value]) => exe.contains(addr, 8) && exe.f64(addr) === value))
    errors.push('MW2.EXE: Die Tabellenadressen passen nicht zum MECH2JS-Port.');
  try {
    // All control names are pointers into the shell data image. A wrong build
    // otherwise crashes later in seedControlFiles with an unrelated RangeError.
    let names = 0;
    for (let i = 0; i < 37; i++) {
      const p = shell.u32(SHELL_LABEL.controlMapNames + i * 4);
      if (p === 0) continue;
      if (!shell.contains(p, 1) || !/^[a-z][a-z0-9_]+$/i.test(shell.cstrAt(p, 100))) throw Error('layout');
      names++;
    }
    if (names !== 31 || shell.strPtr(SHELL_LABEL.controlMapNames) !== 'throttle' || shell.strPtr(SHELL_LABEL.controlMapNames + 30 * 4) !== 'advance_nav') throw Error('layout');
  } catch {
    errors.push('MW2SHELL.EXE: Die Menü- und Steuerungstabellen passen nicht zum MECH2JS-Port.');
  }
  return errors;
}

export function assertExecutableCompatibility(exe: ExeImage, shell: ExeImage): void {
  const errors = executableCompatibility(exe, shell);
  if (errors.length) throw new Error(`${errors.join(' ')} Bitte eine kompatible DOS-Ausgabe verwenden. Die Referenztests verwenden MECH2_16B; Umbenennen der Dateien ändert die Version nicht.`);
}
