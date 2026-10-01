/** @portOnly Frozen mission dot products, alternating reference/optimized CPU timings. */
import { dot3Negative } from '../../src/core/int/i64.ts';
import { Acc64 } from '../reference/i64.ts';
import { runI64Benchmark } from './i64Benchmark.ts';

export type CullInput = [number, number, number, number, number, number];

export async function runCullBenchmark(inputs: CullInput[]) {
  const acc = new Acc64();
  const reference: typeof dot3Negative = (a, b, c, d, e, f) => acc.clear().mulAdd(a, b).mulAdd(c, d).mulAdd(e, f).h < 0;
  for (const args of inputs) if (reference(...args) !== dot3Negative(...args)) throw Error('Back-face decision changed');
  const repeats = 64;
  const rounds: { referenceMs: number; optimizedMs: number }[] = [];
  const measure = (fn: typeof dot3Negative) => {
    let checksum = 0;
    const start = performance.now();
    for (let n = 0; n < repeats; n++) for (const args of inputs) checksum += +fn(...args);
    return { ms: (performance.now() - start) / repeats, checksum };
  };
  for (let round = 0; round < 28; round++) {
    const order = round % 2 ? [dot3Negative, reference] : [reference, dot3Negative];
    const values = order.map(measure);
    if (values[0]!.checksum !== values[1]!.checksum) throw Error('Culling checksum changed');
    if (round >= 8) rounds.push({ referenceMs: values[round % 2]!.ms, optimizedMs: values[1 - round % 2]!.ms });
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const mean = (key: keyof typeof rounds[number]) => rounds.reduce((sum, r) => sum + r[key], 0) / rounds.length;
  const fastCases = inputs.filter(([a, b, c, d, e, f]) => Math.abs(a * b) + Math.abs(c * d) + Math.abs(e * f) <= Number.MAX_SAFE_INTEGER).length;
  return { kind: 'isolated-backface-sign-cpu', polygons: inputs.length, fastCases, repeats, rounds,
    fixedPoint: await runI64Benchmark(inputs),
    referenceMs: mean('referenceMs'), optimizedMs: mean('optimizedMs'), mismatches: 0,
    note: 'Milliseconds per frozen polygon set; excludes clipping, GPU work and XR frame timing.' };
}
