/** @portOnly Quest comfort options layered over the original in-game menu. */
import { Menu, MenuControl, MenuItem } from '../generated/classes.gen.ts';
import { menuItemToggle, uiContextFindNode } from '../sim/ui/menus.ts';
import { menuItemAbortMission } from '../sim/ui/menuCallbacks.ts';
import { ui } from '../sim/ui/uiContext.ts';
import { missionEndCode } from '../sim/mech/damage.ts';
import { mechRuntime } from '../sim/mech/mechRuntime.ts';
import { dynamicResolutionEnabled, setDynamicResolution, fixedFoveationEnabled, setFixedFoveation, renderScale, setRenderScale, QUEST_RENDER_SCALES } from './questGraphics.ts';

const KEY = 'mw2.quest.ejection-animation';
const FPS_KEY = 'mw2.quest.fps-counter';
let ejectionAnimation = false;
let fpsCounter = true;
try { ejectionAnimation = localStorage.getItem(KEY) === 'true'; } catch { /* default off */ }
try { fpsCounter = localStorage.getItem(FPS_KEY) !== 'false'; } catch { /* default on */ }

export function setFpsCounter(enabled: boolean): void {
  fpsCounter = enabled;
  try { localStorage.setItem(FPS_KEY, String(enabled)); } catch { /* session only */ }
}
export function fpsCounterEnabled(): boolean { return fpsCounter; }

export function setEjectionAnimation(enabled: boolean): void {
  ejectionAnimation = enabled;
  try { localStorage.setItem(KEY, String(enabled)); } catch { /* session only */ }
}

export function ejectionAnimationEnabled(): boolean { return ejectionAnimation; }

/** Each view owns its active flag, so ending XR restores the original abort behavior. */
export class QuestComfortMenu {
  private active = false;
  private readonly patched = new WeakSet<Menu>();

  update(active: boolean): void {
    this.active = active;
    if (!active) return;
    const ctx = uiContextFindNode(4)?.record;
    const root = ctx?.topMenu;
    if (!ctx || !root || this.patched.has(root)) return;
    this.patched.add(root);

    const seen = new Set<Menu>();
    const wrapAbort = (menu: Menu) => {
      if (seen.has(menu)) return;
      seen.add(menu);
      for (const item of menu.items) {
        if (item.draw === menuItemAbortMission) {
          item.draw = (...args: Parameters<typeof menuItemAbortMission>) => {
            const before = missionEndCode();
            menuItemAbortMission(...args);
            if (this.active && !ejectionAnimation && !(before & 2) && (missionEndCode() & 2)) {
              // The original callback has already ejected the pilot and recorded the loss.
              // Skip its five-second camera ride and exit delay. mainLoopFrame still runs
              // missionResultsUpdate, then Game runs normal result/config persistence.
              mechRuntime.playerOut = 1;
              ui.quitRequested = 1;
              ui.quitCountdown = 3;
            }
          };
        }
        if (item.submenu) wrapAbort(item.submenu);
      }
    };
    wrapAbort(root);

    const options = new Menu();
    options.title = 'VR OPTIONS';
    const toggle = new MenuItem();
    toggle.type = 4;
    toggle.label = 'Ejection animation';
    const control = new MenuControl();
    control.flags = 1;
    control.get = () => Number(ejectionAnimation);
    control.commit = (_selector: number, value: number) => setEjectionAnimation(value !== 0);
    control.data = { kind: 'list', suffix: null, count: 2, strings: ['OFF', 'ON'] };
    toggle.control = control;
    toggle.draw = (...args: Parameters<typeof menuItemToggle>) => {
      const previous = ui.menuKeyPending;
      // A / Enter also toggles; left/right retain the game's normal widget behavior.
      if (previous === 13) ui.menuKeyPending = 32;
      try { menuItemToggle(...args); } finally { ui.menuKeyPending = previous; }
    };
    const warning = new MenuItem();
    warning.type = 3;
    warning.label = 'WARNING: may cause nausea';
    const back = new MenuItem();
    back.type = 6;
    back.label = 'Back (Esc)';
    const fps = new MenuItem();
    fps.type = 4;
    fps.label = 'FPS counter';
    const fpsControl = new MenuControl();
    fpsControl.flags = 1;
    fpsControl.get = () => Number(fpsCounter);
    fpsControl.commit = (_selector: number, value: number) => setFpsCounter(value !== 0);
    fpsControl.data = { kind: 'list', suffix: null, count: 2, strings: ['OFF', 'ON'] };
    fps.control = fpsControl;
    fps.draw = toggle.draw;
    const ffr = new MenuItem();
    ffr.type = 4;
    ffr.label = 'Fixed foveated rendering';
    const ffrControl = new MenuControl();
    ffrControl.flags = 1;
    ffrControl.get = () => Number(fixedFoveationEnabled());
    ffrControl.commit = (_selector: number, value: number) => setFixedFoveation(value !== 0);
    ffrControl.data = { kind: 'list', suffix: null, count: 2, strings: ['OFF', 'ON'] };
    ffr.control = ffrControl;
    ffr.draw = toggle.draw;
    const resolution = new MenuItem();
    resolution.type = 4;
    resolution.label = 'Render resolution';
    const scaleControl = new MenuControl();
    scaleControl.flags = 1;
    scaleControl.get = () => QUEST_RENDER_SCALES.findIndex(value => value === renderScale());
    scaleControl.commit = (_selector: number, value: number) => setRenderScale(QUEST_RENDER_SCALES[value] ?? 1.25);
    scaleControl.data = { kind: 'list', suffix: null, count: QUEST_RENDER_SCALES.length, strings: QUEST_RENDER_SCALES.map(value => `${value * 100}%`) };
    resolution.control = scaleControl;
    resolution.draw = toggle.draw;
    const dynamic = new MenuItem();
    dynamic.type = 4;
    dynamic.label = 'Dynamic resolution';
    const dynamicControl = new MenuControl();
    dynamicControl.flags = 1;
    dynamicControl.get = () => Number(dynamicResolutionEnabled());
    dynamicControl.commit = (_selector: number, value: number) => setDynamicResolution(value !== 0);
    dynamicControl.data = { kind: 'list', suffix: null, count: 2, strings: ['OFF', 'ON'] };
    dynamic.control = dynamicControl;
    dynamic.draw = toggle.draw;
    const restart = new MenuItem();
    restart.type = 3;
    restart.label = 'Resolution: restart VR to apply';
    options.items = [toggle, warning, fps, ffr, resolution, restart, dynamic, back];
    options.count = options.items.length;
    const entry = new MenuItem();
    entry.type = 0;
    entry.label = 'VR Options';
    entry.submenu = options;
    const exit = root.items.findIndex(item => item.type === 2 || item.type === 6);
    root.items.splice(exit < 0 ? root.count : exit, 0, entry);
    root.count++;
    ctx.rows = Math.max(ctx.rows, root.count, options.count);
  }
}
