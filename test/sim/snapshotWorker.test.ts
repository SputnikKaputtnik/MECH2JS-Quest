import { expect, it } from 'vitest';
import { hasGameData } from '../support/env.ts';
import { snapshotWorkerProbe } from '../support/snapshotWorkerProbe.ts';

it.runIf(hasGameData)('boots the real mission engine in a worker and preserves camera snapshots through a stall', async () => {
  const report = await snapshotWorkerProbe(true);
  expect(report.mission).toBe(true);
  expect(report.initialCamera).toHaveLength(6);
  expect(report.consumerTicksWhileProducerBlocked).toBe(10);
  expect(report.resumedSequence).toBe(2);
});
