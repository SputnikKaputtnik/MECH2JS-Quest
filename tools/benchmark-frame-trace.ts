/** Host-only recorder benchmark. Never accesses a device or a server.
 * node --expose-gc --import tsx tools/benchmark-frame-trace.ts [baseline=37a8df5]
 * Redirect output to a private path outside the repository.
 */
import { execFileSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import ts from 'typescript';
import { QuestFrameTrace, type FrameTraceEvent } from '../src/app/questFrameTrace.ts';

if (!globalThis.gc) throw Error('Run node with --expose-gc');
const baseline = process.argv[2] ?? '37a8df5';
const source = execFileSync('git', ['show', `${baseline}:src/app/questFrameTrace.ts`], { encoding: 'utf8' });
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const Reference = (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)).QuestFrameTrace as typeof QuestFrameTrace;
const frame: FrameTraceEvent = { kind: 'frame', frame: 13, start: 150.123456789, end: 155.987654321,
  xrTime: 145.111111111, interval: 11.111111111, consumedPass: true, revision: 4,
  inlineSimMs: 3.75, calls: 40, triangles: 40000, schedule: 'inline', visible: true };
const sim: FrameTraceEvent = { kind: 'simulation', frame: 13, start: 151.123456789, end: 154.123456789,
  phase: 'inline', passed: true, revision: 4, elapsedMs: 50.123456789, calls: 6, triangles: 4000 };
const entries = 65536, samples: Record<string, number | string>[] = [];
// Input literals are allocated equally in both paths, as in the live call sites.
function fill(trace: QuestFrameTrace) {
  for (let i = 0; i < entries; i++) trace.record(i % 3 ? { ...frame, frame: i } : { ...sim, frame: i });
}
function measure(name: string, round: number) {
  // Separate scope prevents the preceding capture/export remaining a live root
  // during the next baseline GC. Only scalar measurements escape this function.
  globalThis.gc!();
  const before = process.memoryUsage(), trace = new (name === 'packed' ? QuestFrameTrace : Reference)();
  const start = performance.now(); trace.start(); const startMs = performance.now() - start;
  const recordStart = performance.now(); fill(trace); const recordMs = performance.now() - recordStart;
  globalThis.gc!(); const after = process.memoryUsage();
  const result = { round, name, startMs, recordMs,
    retainedHeapBytes: after.heapUsed - before.heapUsed, retainedBufferBytes: after.arrayBuffers - before.arrayBuffers };
  const read = trace.read(); assert.equal(read.events.length, entries); assert.equal(read.dropped, 0);
  assert.deepEqual(read.events.at(-1), { ...sim, frame: entries - 1, sequence: entries });
  return result;
}
for (let round = -2; round < 8; round++) {
  for (const name of round % 2 ? ['packed', 'reference'] : ['reference', 'packed']) {
    const result = measure(name, round);
    if (round >= 0) samples.push(result);
  }
}
const results = ['reference', 'packed'].map(name => {
  const rows = samples.filter(s => s.name === name);
  const median = (key: string) => { const a = rows.map(r => Number(r[key])).sort((a,b) => a-b); return (a[3]! + a[4]!) / 2; };
  return { name, startMs: median('startMs'), recordMs: median('recordMs'),
    retainedHeapBytes: median('retainedHeapBytes'), retainedBufferBytes: median('retainedBufferBytes') };
});
console.log(JSON.stringify({ baseline, entries, rounds: 8, results, samples,
  note: 'Host Node CPU/retained memory; includes input literal creation; alternating order and two warmup rounds. Start and read outside record timing; forced GC only outside record timing. No XR/GPU/FPS measurement or proof of a stall cause.' }, null, 2));
