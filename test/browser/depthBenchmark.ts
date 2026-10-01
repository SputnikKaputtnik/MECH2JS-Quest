/** @portOnly Incremental vertex-depth CPU comparison against the current exact accumulator. */
import { Acc64, dot3r27 } from '../../src/core/int/i64.ts';
import type { CullInput } from './cullBenchmark.ts';

export async function runDepthBenchmark(inputs: CullInput[]) {
  const acc = new Acc64();
  const reference: typeof dot3r27 = (a, b, c, d, e, f) => acc.clear().mulAdd(a, b).mulAdd(c, d).mulAdd(e, f).shr27r();
  for (const args of inputs) if (reference(...args) !== dot3r27(...args)) throw Error('Vertex depth differs');
  const repeats = 64;
  const rounds: { referenceMs: number; optimizedMs: number }[] = [];
  const measure = (fn: typeof dot3r27) => {
    let checksum = 0;
    const start = performance.now();
    for (let n = 0; n < repeats; n++) for (const args of inputs) checksum += fn(...args);
    return { ms: (performance.now() - start) / repeats, checksum };
  };
  for (let round = 0; round < 28; round++) {
    const order = round % 2 ? [dot3r27, reference] : [reference, dot3r27];
    const values = order.map(measure);
    if (values[0]!.checksum !== values[1]!.checksum) throw Error('Depth benchmark checksum differs');
    if (round >= 8) rounds.push({ referenceMs: values[round % 2]!.ms, optimizedMs: values[1 - round % 2]!.ms });
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const mean = (key: keyof typeof rounds[number]) => rounds.reduce((sum, r) => sum + r[key], 0) / rounds.length;
  const fastCases = inputs.filter(([a, b, c, d, e, f]) => Math.abs(a * b) + Math.abs(c * d) + Math.abs(e * f) <= Number.MAX_SAFE_INTEGER).length;
  return { kind: 'isolated-vertex-depth-cpu', vertices: inputs.length, fastCases, repeats, rounds,
    referenceMs: mean('referenceMs'), optimizedMs: mean('optimizedMs'), mismatches: 0,
    note: 'Current Acc64 reference includes the earlier imul64 optimization. Frozen vertex set; not XR FPS.' };
}
