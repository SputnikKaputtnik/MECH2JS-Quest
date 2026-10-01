// The VR controllers' mapping onto the game's keys: every press is paired with
// a release, analogue inputs have hysteresis, and the torso stick centres once
// when let go.
import { describe, expect, it } from 'vitest';
import { IDLE_PAD, PadMapper, type PadState } from '../../src/app/xrPads.ts';

const pad = (p: Partial<PadState>): PadState => ({ ...IDLE_PAD, ...p });

describe('PadMapper', () => {
  it('releases combat input and waits for neutral before accepting a menu choice', () => {
    const m = new PadMapper();
    m.update(pad({ rTrigger: 1, ly: -1, rx: 1 }));
    const opened = m.update(pad({ rTrigger: 1, ly: -1, rx: 1 }), true);
    expect(opened.keys.every(k => !k.down)).toBe(true);
    expect(opened.torso).toEqual([0, 0]);
    expect(m.update(pad({ rTrigger: 1 }), true).keys).toEqual([]);
    m.update(pad({}), true);
    expect(m.update(pad({ a: true, ly: -1 }), true).keys).toEqual([
      { code: 'ArrowUp', down: true }, { code: 'Enter', down: true },
    ]);
    expect(m.update(pad({ a: true }), false).keys.every(k => !k.down)).toBe(true);
    expect(m.update(pad({ a: true }), false).keys).toEqual([]);
  });

  it('uses X for jump jets in combat and ignores combat actions in menus', () => {
    const m = new PadMapper();
    expect(m.update(pad({ x: true })).keys).toEqual([{ code: 'KeyJ', down: true }]);
    m.update(pad({}), true); m.update(pad({}), true);
    expect(m.update(pad({ x: true, rGrip: 1, lGrip: 1, rx: 1 })).keys).toEqual([]);
  });
  it('presses and releases a button once each', () => {
    const m = new PadMapper();
    expect(m.update(pad({ a: true })).keys).toEqual([{ code: 'KeyE', down: true }]);
    expect(m.update(pad({ a: true })).keys).toEqual([]);
    expect(m.update(pad({})).keys).toEqual([{ code: 'KeyE', down: false }]);
  });

  it('holds an analogue input between the press and release thresholds', () => {
    const m = new PadMapper();
    expect(m.update(pad({ rTrigger: 0.5 })).keys).toEqual([]);
    expect(m.update(pad({ rTrigger: 0.7 })).keys).toEqual([{ code: 'Space', down: true }]);
    expect(m.update(pad({ rTrigger: 0.5 })).keys).toEqual([]);
    expect(m.update(pad({ rTrigger: 0.3 })).keys).toEqual([{ code: 'Space', down: false }]);
  });

  it('maps the left stick to throttle and turning (forward is negative y)', () => {
    const m = new PadMapper();
    expect(m.update(pad({ ly: -1 })).keys).toEqual([{ code: 'Equal', down: true }]);
    expect(m.update(pad({ ly: 1, lx: 1 })).keys).toEqual([
      { code: 'Equal', down: false },
      { code: 'Minus', down: true },
      { code: 'ArrowRight', down: true },
    ]);
  });

  it('centres the torso once when the right stick is let go', () => {
    const m = new PadMapper();
    expect(m.update(pad({ rx: 0.05 })).torso).toBeNull();
    const t = m.update(pad({ rx: 1, ry: -0.5 })).torso!;
    expect(t[0]).toBeCloseTo(1);
    expect(t[1]).toBeLessThan(0);
    expect(m.update(pad({})).torso).toEqual([0, 0]);
    expect(m.update(pad({})).torso).toBeNull();
  });

  it('releases everything it holds on reset', () => {
    const m = new PadMapper();
    m.update(pad({ a: true, rTrigger: 1, lx: -1 }));
    expect(
      m
        .reset()
        .map((k) => k.code)
        .sort(),
    ).toEqual(['ArrowLeft', 'KeyE', 'Space']);
    expect(m.update(pad({})).keys).toEqual([]);
  });
});

it('reserves both grips for physical hands without firing a group or stopping throttle', () => {
  const mapper = new PadMapper();
  expect(mapper.update(pad({lGrip:1,rGrip:1})).keys).toEqual([]);
  expect(mapper.update(pad({})).keys).toEqual([]);
});
