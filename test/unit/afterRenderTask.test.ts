import { expect, it } from 'vitest';
import { AfterRenderTask } from '../../src/app/afterRenderTask.ts';
import { QuestFrameTrace } from '../../src/app/questFrameTrace.ts';
import { parseFrameExperiment } from '../../src/app/questFrameExperiment.ts';

function queue() {
  const messages: number[] = [];
  let closes = 0;
  const channel = { port1: { onmessage: null as null | ((e: { data: number }) => void), close: () => closes++ },
    port2: { postMessage: (data: number) => messages.push(data), close: () => closes++ } };
  return { scheduler: new AfterRenderTask(() => channel as unknown as MessageChannel),
    drain: () => { for (const data of messages.splice(0)) channel.port1.onmessage?.({ data }); },
    closes: () => closes };
}

it('runs only after dispatch, refuses a backlog, and invalidates canceled jobs across restart', () => {
  const q = queue(), order: string[] = [];
  expect(q.scheduler.post(() => order.push('sim'))).toBe(true);
  expect(q.scheduler.post(() => order.push('duplicate'))).toBe(false);
  order.push('render'); expect(order).toEqual(['render']);
  q.drain(); expect(order).toEqual(['render', 'sim']);
  q.scheduler.post(() => order.push('old mission'));
  q.scheduler.cancel();
  q.scheduler.post(() => order.push('new mission'));
  q.drain(); expect(order.at(-1)).toBe('new mission'); expect(order).not.toContain('old mission');
  q.scheduler.post(() => order.push('disposed'));
  q.scheduler.dispose(); q.drain();
  expect(order).not.toContain('disposed'); expect(q.closes()).toBe(2);
  expect(q.scheduler.post(() => {})).toBe(false);
});

it('keeps off-callback costs, reports overwritten raw events and never reuses export cursors', () => {
  const trace = new QuestFrameTrace();
  const event = { kind: 'simulation' as const, frame: 7, start: 100, end: 104,
    phase: 'after-render' as const, passed: true, revision: 2, elapsedMs: 14, calls: 3, triangles: 20 };
  trace.record(event); expect(trace.read().events).toHaveLength(0);
  trace.start(16);
  for (let i = 0; i < 20; i++) trace.record(event);
  const first = trace.read();
  expect(first.dropped).toBe(4); expect(first.events).toHaveLength(16);
  expect(first.events[0]).toMatchObject({ start: 100, end: 104, phase: 'after-render', sequence: 5 });
  first.events[0]!.start = -1; expect(trace.read().events[0]!.start).toBe(100);
  expect(trace.read(first.cursor).events).toHaveLength(0);
  trace.stop(); trace.record(event); expect(trace.read().cursor).toBe(20);
  trace.start(16); trace.record(event);
  expect(trace.read(20)).toMatchObject({ cursor: 21, dropped: 0 });
});

it('requires explicit URL opt-in and does not confuse a 72 Hz request with an observed rate', () => {
  expect(parseFrameExperiment('')).toEqual({ schedule: 'inline', trace: false, requestedHz: 90 });
  expect(parseFrameExperiment('?questFrameTest=after-render&questHz=72')).toEqual({ schedule: 'after-render', trace: true, requestedHz: 72 });
  expect(parseFrameExperiment('?questFrameTest=inline&questHz=72').schedule).toBe('inline');
  expect(parseFrameExperiment('?questFrameTest=typo&questHz=71').trace).toBe(false);
});
