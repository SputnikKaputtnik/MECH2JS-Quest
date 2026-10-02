import { expect, it } from 'vitest';
import { snapshotWorkerProbe } from '../support/snapshotWorkerProbe.ts';

it('keeps consuming the last snapshot while a separate producer thread is CPU-blocked', async () => {
  const report = await snapshotWorkerProbe(false);
  expect(report.consumerTicksWhileProducerBlocked).toBe(10);
  expect(report.resumedSequence).toBe(2);
}, 15_000);
