import { expect, it } from 'vitest';
import { QuestFrameTrace, type FrameTraceEvent } from '../../src/app/questFrameTrace.ts';

function event(i: number): FrameTraceEvent {
  const common = { frame: i, start: i * 11.111111111, end: i * 11.111111111 + 4.123456789,
    revision: Math.floor(i / 4), calls: i % 191, triangles: 40000 + i };
  const schedule = i % 2 ? 'inline' : 'after-render';
  return i % 3 ? { ...common, kind: 'frame', xrTime: common.start - 3.123456789,
    interval: i % 7 ? 11.111111111 : 70.25, consumedPass: i % 4 === 0,
    inlineSimMs: i % 4 === 0 ? 4.234567891 : 0, schedule, visible: i % 5 !== 0 }
    : { ...common, kind: 'simulation', phase: schedule, passed: i % 4 === 0, elapsedMs: 50.123456789 };
}

it('exports exact mixed events, preserving doubles, variants and ownership across repeated wraps', () => {
  const trace = new QuestFrameTrace(); trace.start(16);
  const expected: Array<FrameTraceEvent & { sequence: number }> = [];
  for (let i = 1; i <= 1000; i++) {
    const input = event(i); expected.push({ ...input, sequence: i });
    if (expected.length > 16) expected.shift();
    trace.record(input); input.start = -999;
    if (i % 13 === 0 || i === 1000) {
      const read = trace.read();
      expect(read.events).toEqual(expected);
      expect(read.dropped).toBe(Math.max(0, i - 16));
      expect(trace.read(i - 5).events).toEqual(expected.filter(e => e.sequence > i - 5));
      read.events[0]!.end = -999;
      expect(trace.read().events).toEqual(expected);
    }
  }
});

it('keeps cursors monotonic across same-size restart, capacity changes, stop and invalid starts', () => {
  const trace = new QuestFrameTrace(); trace.start(16);
  trace.record(event(1)); trace.stop(); trace.record(event(2));
  expect(trace.read()).toMatchObject({ active: false, cursor: 1 });
  for (const capacity of [16, 32, 16]) {
    const cursor = trace.read().cursor;
    trace.start(capacity);
    expect(trace.read(cursor)).toMatchObject({ active: true, cursor, dropped: 0, events: [] });
    trace.record(event(capacity));
    expect(trace.read(cursor).events).toEqual([{ ...event(capacity), sequence: cursor + 1 }]);
  }
  const before = trace.read();
  for (const capacity of [0, 15, 65537, 16.5, NaN, Infinity]) expect(() => trace.start(capacity)).toThrow();
  expect(trace.read()).toEqual(before);
});

it('retains a full maximum capture and reports exactly one lost event on overflow', () => {
  const trace = new QuestFrameTrace(); trace.start();
  for (let i = 1; i <= 65536; i++) trace.record(event(i));
  const full = trace.read();
  expect(full.events).toHaveLength(65536); expect(full.dropped).toBe(0);
  expect(full.events[0]).toEqual({ ...event(1), sequence: 1 });
  expect(full.events.at(-1)).toEqual({ ...event(65536), sequence: 65536 });
  trace.record(event(65537));
  expect(trace.read(65535)).toMatchObject({ cursor: 65537, dropped: 0,
    events: [{ ...event(65536), sequence: 65536 }, { ...event(65537), sequence: 65537 }] });
  expect(trace.read().dropped).toBe(1);
  expect(full.events[0]).toEqual({ ...event(1), sequence: 1 });
});
