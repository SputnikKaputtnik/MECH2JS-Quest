/** @portOnly Compare the full rounded transform dot product on frozen mission operands. */
import { dot3r29 } from '../../src/core/int/i64.ts';
import { dot3r29 as reference } from '../reference/i64.ts';
import type { CullInput } from './cullBenchmark.ts';

export async function runI64Benchmark(inputs: CullInput[]) {
  for (const args of inputs) if (reference(...args) !== dot3r29(...args)) throw Error('Fixed-point dot product differs');
  const repeats = 64;
  const rounds: { referenceMs: number; optimizedMs: number }[] = [];
  const measure = (fn: typeof dot3r29) => {
    let checksum = 0;
    const start = performance.now();
    for (let n = 0; n < repeats; n++) for (const args of inputs) checksum += fn(...args);
    return { ms: (performance.now() - start) / repeats, checksum };
  };
  for (let round = 0; round < 28; round++) {
    const order = round % 2 ? [dot3r29, reference] : [reference, dot3r29];
    const values = order.map(measure);
    if (values[0]!.checksum !== values[1]!.checksum) throw Error('Fixed-point benchmark checksum differs');
    if (round >= 8) rounds.push({ referenceMs: values[round % 2]!.ms, optimizedMs: values[1 - round % 2]!.ms });
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const mean = (key: keyof typeof rounds[number]) => rounds.reduce((sum, r) => sum + r[key], 0) / rounds.length;
  return { kind: 'isolated-rounded-dot-product-cpu', inputs: inputs.length, repeats, rounds,
    referenceMs: mean('referenceMs'), optimizedMs: mean('optimizedMs'), mismatches: 0,
    note: 'Milliseconds per frozen mission operand set; not a whole-frame or XR measurement.' };
}
