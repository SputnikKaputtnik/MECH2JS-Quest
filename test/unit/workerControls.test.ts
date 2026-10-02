import { expect, it } from 'vitest';
import { WorkerControlSender, type WorkerControls } from '../../src/app/workerControls.ts';
import { SimulationPacer } from '../../src/engine/simulationPacer.ts';

it('paces 182 timer ticks and 20 steps per second with fractional timer carry', () => {
  const pacer = new SimulationPacer(); let ticks = 0, steps = 0;
  for (let i = 0; i < 200; i++) { const p = pacer.advance(5); ticks += p.ticks; steps += +p.step; }
  expect(ticks).toBe(182); expect(steps).toBe(20);
  expect(pacer.advance(3000)).toEqual({ ticks: 45, step: true });
  expect(pacer.advance(0).step).toBe(true);
  expect(pacer.advance(0).step).toBe(false);
  expect(() => pacer.advance(-1)).toThrow();
});

it('bounds messages while retaining key edges and only the newest stick sample', () => {
  const sent: WorkerControls[] = [], sender = new WorkerControlSender('a', m => sent.push(m));
  sender.pulse();
  sender.push([{ code: 'Space', down: true }], [0.4, 0]);
  sender.push([{ code: 'Space', down: false }], [0.9, 0]);
  for (let i = 0; i < 100; i++) sender.pulse();
  expect(sent).toHaveLength(1);
  sender.acknowledge('old', 1); expect(sent).toHaveLength(1);
  sender.acknowledge('a', 1);
  expect(sent[1]!.keys).toEqual([{ code: 'Space', down: true }, { code: 'Space', down: false }]);
  expect(sent[1]!.torso).toEqual([0.9, 0]);
  sender.acknowledge('a', 1); expect(sent).toHaveLength(2);
});

it('fails closed on input overflow and releases held controls after acknowledgement', () => {
  const sent: WorkerControls[] = [], sender = new WorkerControlSender('a', m => sent.push(m));
  sender.pulse();
  expect(() => sender.push(Array.from({ length: 65 }, () => ({ code: 'Space', down: true })))).toThrow('overflow');
  sender.acknowledge('a', 1);
  expect(sent[1]!.release).toBe(true); expect(sent[1]!.keys).toEqual([]);
  expect(sent[1]!.torso).toEqual([0, 0]);
});
