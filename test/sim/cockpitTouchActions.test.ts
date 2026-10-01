import { beforeAll, expect, it } from 'vitest';
import { ExeImage } from '../../src/data/exe/ExeImage.ts';
import { ProjectFile } from '../../src/data/prj/ProjectFile.ts';
import { bootMission } from '../../src/mission/load.ts';
import { gameSource, hasGameData, installFiles } from '../support/env.ts';
import { commandExecute, commandGlobals } from '../../src/sim/ui/commands.ts';
import { mechs } from '../../src/sim/mech/mechGlobals.ts';
import { hud, playerCockpitFrame } from '../../src/sim/cockpit/hud.ts';
import { radar } from '../../src/sim/cockpit/radar.ts';
let exe: ExeImage,prj: ProjectFile;
beforeAll(async()=>{if(hasGameData){exe=ExeImage.fromExe(await gameSource().read('MW2.EXE'));prj=new ProjectFile(await gameSource().read('MW2.PRJ'));}});
it.runIf(hasGameData)('cockpit actions use the original override conditions and wrapping radar range command',()=>{
  bootMission({exe,prj,looseFiles:installFiles(),mission:'AMY_SCN1'});
  const l=mechs.mechTable[mechs.playerMechIndex]!.loadout!;
  l.status=2;hud.hudEnabled=1;l.flags&=~12;
  commandExecute(0x40);expect(commandGlobals.shutdownOverrideRequest).toBe(1);
  playerCockpitFrame(l);expect(l.flags&8).toBe(0); // no pending shutdown
  l.flags|=4;commandExecute(0x40);playerCockpitFrame(l);
  expect(l.flags&8).toBe(8);expect(commandGlobals.shutdownOverrideRequest).toBe(0);
  radar.mode=1;const r=radar.module!.modes[1]!;
  r.range=r.leastRange;
  commandExecute(0x30);expect(r.range).toBe(Math.min(r.leastRange*2,r.mostRange));
  r.range=r.mostRange;commandExecute(0x30);expect(r.range).toBe(r.leastRange);
});
