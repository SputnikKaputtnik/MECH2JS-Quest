import { Worker } from 'node:worker_threads';
import { SnapshotConsumer, type Snapshot } from '../../src/engine/snapshotMailbox.ts';

export interface WorkerProbeReport {
  mission: boolean;
  consumerTicksWhileProducerBlocked: number;
  stallObservedMs: number;
  longestConsumerIntervalMs: number;
  resumedSequence: number;
  initialCamera: number[];
}

/** A host scheduling/ownership probe, NOT a renderer, XR or GPU benchmark. */
export async function snapshotWorkerProbe(mission: boolean): Promise<WorkerProbeReport> {
  const gate = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(new URL('./snapshotWorker.ts', import.meta.url), {
    execArgv: ['--import', 'tsx'], workerData: { gate: gate.buffer, mission }, stdout: true, stderr: true,
  });
  // Keep the diagnostic tool's stdout valid JSON, retaining engine warnings.
  worker.stdout.on('data', chunk => process.stderr.write(chunk));
  worker.stderr.on('data', chunk => process.stderr.write(chunk));
  const consumer = new SnapshotConsumer<{ tick: number; mission: boolean }>('worker-probe', (m, transfer) => worker.postMessage(m, transfer));
  let interval: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<WorkerProbeReport>((resolve, reject) => {
      let initial: number[] = [];
      let ticks = 0, started = 0, previous = 0, longest = 0, elapsed = 0;
      worker.on('error', reject);
      worker.on('exit', code => reject(Error(`Worker exited before completing probe (${code})`)));
      timeout = setTimeout(() => reject(Error('Worker probe timed out')), 120_000);
      worker.on('message', (m: Snapshot<{ tick: number; mission: boolean }> | { kind: 'stalled' | 'resumed' }) => {
        try {
          if (m.kind === 'snapshot') {
            consumer.receive(m);
            const snapshot = consumer.acquire()!;
            const values = [...new Float64Array(snapshot.buffer)];
            if (snapshot.sequence === 1) {
              if (values.some(v => !Number.isFinite(v)) || values[6] !== 1 || values[7] !== -1) throw Error('Invalid initial snapshot');
              initial = values;
              worker.postMessage({ kind: 'stall' });
            } else {
              if (ticks !== 10 || values[6] !== 2 || values[7] !== -2) throw Error('Invalid resumed snapshot');
              resolve({ mission, consumerTicksWhileProducerBlocked: ticks, stallObservedMs: elapsed,
                longestConsumerIntervalMs: longest, resumedSequence: snapshot.sequence, initialCamera: initial.slice(0, 6) });
            }
          } else if (m.kind === 'stalled') {
            started = previous = performance.now();
            interval = setInterval(() => {
              try {
                if (Atomics.load(gate, 0) !== 1) throw Error('Producer resumed before consumer finished');
                const now = performance.now();
                longest = Math.max(longest, now - previous); previous = now;
                const snapshot = consumer.acquire()!;
                const values = [...new Float64Array(snapshot.buffer)];
                if (snapshot.sequence !== 1 || values.some((v, i) => v !== initial[i])) throw Error('Held snapshot changed during stall');
                ticks++;
                if (ticks === 10) {
                  elapsed = now - started;
                  clearInterval(interval);
                  Atomics.store(gate, 0, 0);
                }
              } catch (e) { reject(e); }
            }, 5);
          } else worker.postMessage({ kind: 'step' });
        } catch (e) { reject(e); }
      });
    });
  } finally {
    clearInterval(interval); clearTimeout(timeout);
    Atomics.store(gate, 0, 0);
    consumer.close();
    await worker.terminate();
  }
}
