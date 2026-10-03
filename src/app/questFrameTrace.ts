/** @portOnly Opt-in bounded raw events, preserving off-callback simulation cost. */
export type FrameSchedule = 'inline' | 'after-render';
export type FrameTraceEvent = {
  kind: 'frame'; frame: number; start: number; end: number; xrTime: number;
  interval: number; consumedPass: boolean; revision: number; inlineSimMs: number;
  calls: number; triangles: number; schedule: FrameSchedule; visible: boolean;
} | {
  kind: 'simulation'; frame: number; start: number; end: number; phase: FrameSchedule;
  passed: boolean; revision: number; elapsedMs: number; calls: number; triangles: number;
};
type Entry = FrameTraceEvent & { sequence: number };
// Float64 preserves JS numbers (including timestamps) without quantization.
// Allocate/touch the entire 7 MiB maximum ring before capture, not as it fills.
// Variant-only columns share storage; read() restores the original event schema.
const STRIDE = 14;
const C = { sequence: 0, kind: 1, frame: 2, start: 3, end: 4, revision: 5,
  calls: 6, triangles: 7, schedule: 8, time: 9, interval: 10, passed: 11,
  sim: 12, visible: 13 } as const;
export class QuestFrameTrace {
  private entries = new Float64Array(0);
  private capacity = 0;
  private next = 0;
  private count = 0;
  private sequence = 0;
  private active = false;
  readonly id = globalThis.crypto.randomUUID();
  readonly timeOrigin = performance.timeOrigin;
  start(capacity = 65536): void {
    if (!Number.isInteger(capacity) || capacity < 16 || capacity > 65536) throw Error('Trace capacity must be 16..65536');
    if (this.entries.length !== capacity * STRIDE) this.entries = new Float64Array(capacity * STRIDE);
    this.entries.fill(0);
    this.capacity = capacity; this.next = 0; this.count = 0;
    // Never recycle cursors when an external recorder restarts capture.
    this.active = true;
  }
  stop(): void { this.active = false; }
  get enabled(): boolean { return this.active; }
  record(event: FrameTraceEvent): void {
    if (!this.active) return;
    const data = this.entries, offset = this.next * STRIDE;
    data[offset + C.sequence] = ++this.sequence;
    data[offset + C.kind] = event.kind === 'frame' ? 0 : 1;
    data[offset + C.frame] = event.frame;
    data[offset + C.start] = event.start;
    data[offset + C.end] = event.end;
    data[offset + C.revision] = event.revision;
    data[offset + C.calls] = event.calls;
    data[offset + C.triangles] = event.triangles;
    if (event.kind === 'frame') {
      data[offset + C.schedule] = event.schedule === 'inline' ? 0 : 1;
      data[offset + C.time] = event.xrTime;
      data[offset + C.interval] = event.interval;
      data[offset + C.passed] = Number(event.consumedPass);
      data[offset + C.sim] = event.inlineSimMs;
      data[offset + C.visible] = Number(event.visible);
    } else {
      data[offset + C.schedule] = event.phase === 'inline' ? 0 : 1;
      data[offset + C.time] = event.elapsedMs;
      data[offset + C.passed] = Number(event.passed);
    }
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }
  read(after = 0) {
    const oldest = this.sequence - this.count + 1;
    const events: Entry[] = [];
    for (let i = 0; i < this.count; i++) {
      const offset = ((this.next - this.count + this.capacity + i) % this.capacity) * STRIDE;
      const data = this.entries, sequence = data[offset + C.sequence]!;
      if (!(sequence > after)) continue;
      const common = { sequence, frame: data[offset + C.frame]!, start: data[offset + C.start]!,
        end: data[offset + C.end]!, revision: data[offset + C.revision]!,
        calls: data[offset + C.calls]!, triangles: data[offset + C.triangles]! };
      const schedule = data[offset + C.schedule] === 0 ? 'inline' : 'after-render';
      events.push(data[offset + C.kind] === 0
        ? { ...common, kind: 'frame', schedule, xrTime: data[offset + C.time]!,
          interval: data[offset + C.interval]!, consumedPass: !!data[offset + C.passed],
          inlineSimMs: data[offset + C.sim]!, visible: !!data[offset + C.visible] }
        : { ...common, kind: 'simulation', phase: schedule, elapsedMs: data[offset + C.time]!,
          passed: !!data[offset + C.passed] });
    }
    return { id: this.id, timeOrigin: this.timeOrigin, active: this.active, cursor: this.sequence,
      dropped: Math.max(0, oldest - after - 1), events,
      note: 'start/end are performance.now; xrTime is XR callback time. Simulation events include inset WebGL submission. No GPU durations.' };
  }
}
