import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_PAD, type PadState } from '../../src/app/xrPads.ts';
import { hardware, hwMouseButtonsRead } from '../../src/shell/host/hardware.ts';

const input = vi.hoisted(() => ({ pad: {} as PadState }));
vi.mock('../../src/app/xrInput.ts', () => ({ readPads: () => input.pad }));
import { QuestShellInput } from '../../src/app/shell/questShellInput.ts';

const session = { visibilityState: 'visible' } as XRSession;
const pad = (p: Partial<PadState> = {}) => { input.pad = { ...IDLE_PAD, ...p }; };

beforeEach(() => {
  pad();
  hardware.keys.length = 0;
  hardware.mouseButtonQueue.length = 0;
  hardware.mouseButtons = 0;
  hardware.mouseX = 320;
  hardware.mouseY = 240;
  hardware.textEntry = null;
});

describe('Quest shell menu controls', () => {
  it('moves and clicks at the tracked ray hit, and cannot click a stale target after a miss', () => {
    const m = new QuestShellInput();
    m.poll(session, 14, 0, { x: 123, y: 234 });
    expect([hardware.mouseX, hardware.mouseY]).toEqual([123, 234]);
    pad({ rTrigger: 1 }); m.poll(session, 14, 14, { x: 150, y: 250 });
    expect(hwMouseButtonsRead()).toBe(1);
    pad(); m.poll(session, 14, 28, null);
    expect(hwMouseButtonsRead()).toBe(0);
    pad({ rTrigger: 1 }); m.poll(session, 14, 42, null);
    expect(hwMouseButtonsRead()).toBe(0);
  });

  it('automatically opens for a name field, requires trigger release, and types only a pointed key', () => {
    const m = new QuestShellInput();
    hardware.textEntry = { text: '', maxChars: 14 };
    pad({ rTrigger: 1 }); m.poll(session, 14, 0, { x: 96, y: 350 });
    expect(hardware.keys).toEqual([]);
    pad(); m.poll(session, 14, 14, { x: 96, y: 350 });
    pad({ rTrigger: 1 }); m.poll(session, 14, 28, { x: 96, y: 350 }); // B
    expect(hardware.keys.splice(0)).toEqual([66]);
    pad(); m.poll(session, 14, 42, { x: 32, y: 100 });
    pad({ rTrigger: 1 }); m.poll(session, 14, 56, { x: 32, y: 100 });
    expect(hardware.keys).toEqual([]);
    pad(); m.poll(session, 14, 70, { x: 544, y: 455 });
    pad({ rTrigger: 1 }); m.poll(session, 14, 84, { x: 544, y: 455 }); // OK
    expect(hardware.keys.splice(0)).toEqual([13]);
    hardware.textEntry = null;
    m.poll(session, 14, 98, { x: 344, y: 462 });
    expect(hwMouseButtonsRead()).toBe(0); // held OK must not click ACCEPT beneath
  });

  it('keeps stick movement usable until the controller deliberately points elsewhere', () => {
    const m = new QuestShellInput();
    m.poll(session, 14, 0, { x: 320, y: 240 });
    pad({ rx: 1 }); m.poll(session, 20, 20, { x: 320, y: 240 });
    expect(hardware.mouseX).toBe(331);
    pad(); m.poll(session, 20, 40, { x: 322, y: 240 });
    expect(hardware.mouseX).toBe(331);
    m.poll(session, 20, 60, { x: 400, y: 240 });
    expect(hardware.mouseX).toBe(400);
  });
  it('navigates keyboard-only lists with controlled repeat and immediate direction changes', () => {
    const m = new QuestShellInput();
    pad({ ly: 1 }); m.poll(session, 14, 0);
    m.poll(session, 14, 100);
    expect(hardware.keys.splice(0)).toEqual([0, 0x50]);
    m.poll(session, 14, 350);
    expect(hardware.keys.splice(0)).toEqual([0, 0x50]);
    pad({ ly: -1 }); m.poll(session, 14, 360);
    expect(hardware.keys).toEqual([0, 0x48]);
  });

  it('types a pilot name without sending keyboard navigation into the game', () => {
    const m = new QuestShellInput();
    pad({ x: true }); m.poll(session, 14, 0);
    pad({ a: true }); m.poll(session, 14, 20); // A
    pad({ lx: 1 }); m.poll(session, 14, 40); // select B
    pad({ a: true }); m.poll(session, 14, 60);
    expect(hardware.keys).toEqual([65, 66]);
    expect(hwMouseButtonsRead()).toBe(0);
  });

  it('does not leak a held trigger when B closes the keyboard', () => {
    const m = new QuestShellInput();
    pad({ x: true }); m.poll(session, 14, 0);
    pad({ rTrigger: 1 }); m.poll(session, 14, 20);
    pad({ rTrigger: 1, b: true }); m.poll(session, 14, 40);
    pad({ rTrigger: 1 }); m.poll(session, 14, 60);
    expect(hwMouseButtonsRead()).toBe(0);
    pad(); m.poll(session, 14, 80);
    pad({ rTrigger: 1 }); m.poll(session, 14, 100);
    expect(hwMouseButtonsRead()).toBe(1);
  });

  it('releases a click on visibility loss and waits for release before clicking again', () => {
    const m = new QuestShellInput();
    m.poll(session, 14, 0);
    pad({ a: true }); m.poll(session, 14, 20);
    expect(hwMouseButtonsRead()).toBe(1);
    m.poll({ visibilityState: 'hidden' } as XRSession, 14, 40);
    expect(hwMouseButtonsRead()).toBe(0);
    m.poll(session, 14, 60);
    expect(hwMouseButtonsRead()).toBe(0);
    pad(); m.poll(session, 14, 80);
    pad({ a: true }); m.poll(session, 14, 100);
    expect(hwMouseButtonsRead()).toBe(1);
  });

  it('does not cancel desktop mouse input when no VR session is running', () => {
    const m = new QuestShellInput();
    hardware.mouseButtons = 1;
    m.poll(null, 14, 0);
    expect(hwMouseButtonsRead()).toBe(1);
  });
});
