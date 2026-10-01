import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExeImage } from '../../src/data/exe/ExeImage.ts';
import { ProjectFile } from '../../src/data/prj/ProjectFile.ts';
import { ailTimerService } from '../../src/engine/miles/ail.ts';
import { dosFileLoad } from '../../src/engine/dosFiles.ts';
import { bootMission } from '../../src/mission/load.ts';
import { mainLoopFrame, mainLoopRunning } from '../../src/mission/mainLoop.ts';
import { missionEnd } from '../../src/mission/end.ts';
import { input } from '../../src/sim/controls/input.ts';
import type { KeyboardDriver } from '../../src/sim/controls/giddi.ts';
import { mechs } from '../../src/sim/mech/mechGlobals.ts';
import { lighting } from '../../src/sim/world/environment.ts';
import { mainLoop } from '../../src/mission/mainLoop.ts';
import { missionEndCode, mechOnDestroyed, mechEject } from '../../src/sim/mech/damage.ts';
import { ui } from '../../src/sim/ui/uiContext.ts';
import { menuPresentation } from '../../src/sim/ui/menuPresentation.ts';
import { uiContextFindNode } from '../../src/sim/ui/menus.ts';
import { cameraGlobals } from '../../src/sim/camera/viewer.ts';
import { QuestComfortMenu, setEjectionAnimation, ejectionAnimationEnabled, fpsCounterEnabled, setFpsCounter } from '../../src/app/questComfort.ts';
import { gameSource, hasGameData, installFiles } from '../support/env.ts';
import { dynamicResolutionEnabled, setDynamicResolution, fixedFoveationEnabled, setFixedFoveation, renderScale, setRenderScale } from '../../src/app/questGraphics.ts';

describe.runIf(hasGameData)('Quest comfort menu and mission abort', () => {
  afterEach(() => vi.unstubAllGlobals());
  let exe: ExeImage, prj: ProjectFile, kb: KeyboardDriver, menu: QuestComfortMenu;
  let vr: boolean;
  const click = vi.fn();
  const stored = new Map<string, string>();
  beforeAll(async () => {
    exe = ExeImage.fromExe(await gameSource().read('MW2.EXE'));
    prj = new ProjectFile(await gameSource().read('MW2.PRJ'));
  });
  beforeEach(() => {
    stored.clear();
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
    setEjectionAnimation(false);
    setFpsCounter(true);
    setFixedFoveation(true);
    setDynamicResolution(true);
    setRenderScale(1.25);
    bootMission({ exe, prj, looseFiles: installFiles(), mission: 'AMY_SCN1' });
    kb = input.devices[input.keyboardDevice]!.driver as KeyboardDriver;
    click.mockClear();
    menu = new QuestComfortMenu(click);
    vr = true;
    frame(20);
  });
  function frame(n = 1) {
    for (let k = 0; k < n && mainLoopRunning(); k++) {
      menu.update(vr);
      for (let t = 0; t < 10; t++) ailTimerService();
      mainLoopFrame();
    }
  }
  function press(scan: number) { kb.isr(scan); kb.isr(scan | 0x80); frame(2); }
  function top() { const c = uiContextFindNode(4)!.record!; return c.stack![c.depth - 1]!; }
  function abort() { press(0x01); press(0x02); press(0x02); }

  it('offers a persistent OFF/ON toggle and nausea warning inside the original VR menu', () => {
    expect(ejectionAnimationEnabled()).toBe(false);
    press(0x01);
    expect(top().items.map(i => i.label)).toContain('VR Options');
    press(0x07); // sixth entry: VR Options
    expect(top().title).toBe('VR OPTIONS');
    expect(top().items[0]!.label).toBe('Eject/death animation');
    expect(top().items[1]!.label).toMatch(/WARNING.*nausea/);
    press(0x1c); // A / Enter toggles
    expect(ejectionAnimationEnabled()).toBe(true);
    expect(stored.get('mw2.quest.ejection-animation')).toBe('true');
    press(0x1c);
    expect(ejectionAnimationEnabled()).toBe(false);
  });

  it('toggles the default-on FPS display from the real options menu and persists the choice', () => {
    expect(fpsCounterEnabled()).toBe(true);
    press(0x01); press(0x07);
    expect(top().items[2]!.label).toBe('FPS counter');
    press(0x50); // selectable next row skips the warning
    press(0x1c);
    expect(fpsCounterEnabled()).toBe(false);
    expect(stored.get('mw2.quest.fps-counter')).toBe('false');
    expect(ejectionAnimationEnabled()).toBe(false);
    press(0x1c);
    expect(fpsCounterEnabled()).toBe(true);
  });

  it('exposes persistent FFR and resolution controls with a VR restart notice', () => {
    press(0x01); press(0x07);
    expect(top().items[3]!.label).toBe('Fixed foveated rendering');
    expect(top().items[5]!.label).toMatch(/restart VR/);
    press(0x50); press(0x50); press(0x1c);
    expect(fixedFoveationEnabled()).toBe(false);
    expect(stored.get('mw2.quest.ffr')).toBe('false');
    press(0x50); press(0x4d);
    expect(renderScale()).toBe(1.5);
    expect(stored.get('mw2.quest.render-scale')).toBe('1.5');
  });

  it('toggles default-on dynamic resolution using the controller menu path', () => {
    press(0x01); press(0x07);
    expect(dynamicResolutionEnabled()).toBe(true);
    expect(top().items[6]!.label).toBe('Dynamic resolution');
    for (let i = 0; i < 4; i++) press(0x50);
    press(0x1c);
    expect(dynamicResolutionEnabled()).toBe(false);
    expect(stored.get('mw2.quest.dynamic-resolution')).toBe('false');
    press(0x1c);
    expect(dynamicResolutionEnabled()).toBe(true);
  });

  it('scrolls to DRS and Back, wraps upward, and clicks only on activation', () => {
    press(0x01); press(0x07);
    const ctx = uiContextFindNode(4)!.record!;
    const range = () => menuPresentation(ctx, top(), null)!;
    expect(range().first).toBe(0);
    click.mockClear();
    for (let i = 0; i < 4; i++) press(0x50);
    expect(top().items[top().selected]!.label).toBe('Dynamic resolution');
    expect(range().first).toBeGreaterThan(0);
    expect(top().selected).toBeLessThan(range().end);
    expect(click).not.toHaveBeenCalled();
    press(0x1c);
    expect(click).toHaveBeenCalledTimes(1);
    expect(dynamicResolutionEnabled()).toBe(false);
    press(0x4d);
    expect(click).toHaveBeenCalledTimes(2);
    press(0x50);
    expect(top().items[top().selected]!.label).toBe('Back (Esc)');
    expect(top().selected).toBeLessThan(range().end);
    press(0x50);
    expect(range().first).toBe(0);
    vr = false; frame();
    expect(menuPresentation(ctx, top(), null)).toBeNull();
  });

  it('ends a confirmed VR abort without camera spin and writes the ordinary failed mission result', () => {
    abort();
    expect(mainLoopRunning()).toBe(false);
    expect(missionEndCode() & 2).toBe(2);
    expect(cameraGlobals.cameraMode).not.toBe(4);
    const result = missionEnd();
    expect(result.result).toBe(3);
    expect(result.exitStatus).toBe(0);
    expect(dosFileLoad('MW2MSN.CFG')).not.toBeNull();
    expect(dosFileLoad('MW2CAR.CFG')).not.toBeNull();
  });

  it.each(['death', 'auto-eject', 'eject-disabled'] as const)('skips %s camera motion and preserves the ordinary loss result', kind => {
    const player = mechs.mechTable[mechs.playerMechIndex]!.loadout!;
    const previousMode = cameraGlobals.cameraMode;
    const pose = () => { const v = cameraGlobals.mainViewer; return [v.posX, v.posY, v.posZ, v.yaw, v.pitch, v.roll]; };
    const previousPose = pose();
    if (kind === 'death') mechOnDestroyed(player);
    else if (kind === 'auto-eject') mechEject(player, 1);
    else { lighting.ejectDisabled = 1; player.status = 5; mechOnDestroyed(player); }
    const outcome = missionEndCode();
    frame();
    expect(mainLoopRunning()).toBe(false);
    expect(cameraGlobals.cameraMode).toBe(previousMode);
    expect(pose()).toEqual(previousPose);
    expect(missionEndCode()).toBe(outcome);
    expect(missionEnd().result).toBe(3);
    expect(dosFileLoad('MW2MSN.CFG')).not.toBeNull();
  });

  it.each([true, false])('retains normal death animation when enabled or outside VR (%s)', enabled => {
    setEjectionAnimation(enabled);
    vr = enabled;
    mechOnDestroyed(mechs.mechTable[mechs.playerMechIndex]!.loadout!);
    frame();
    expect(mainLoopRunning()).toBe(true);
    expect(cameraGlobals.cameraMode).toBe(1);
  });

  it('releases the camera policy on teardown', () => {
    expect(mainLoop.cameraOverride).not.toBeNull();
    menu.dispose();
    expect(mainLoop.cameraOverride).toBeNull();
  });

  it('preserves the original ejection animation when enabled', () => {
    setEjectionAnimation(true);
    abort(); frame(5);
    expect(mainLoopRunning()).toBe(true);
    expect(cameraGlobals.cameraMode).toBe(4);
  });

  it('does not change desktop abort behavior', () => {
    vr = false;
    abort(); frame(5);
    expect(mainLoopRunning()).toBe(true);
    expect(cameraGlobals.cameraMode).toBe(4);
  });

  it('does not abort when the confirmation is cancelled', () => {
    press(0x01); press(0x02); press(0x01);
    expect(mainLoopRunning()).toBe(true);
    expect(missionEndCode() & 2).toBe(0);
    expect(ui.menuOpenCount).toBeGreaterThan(0);
  });
});
