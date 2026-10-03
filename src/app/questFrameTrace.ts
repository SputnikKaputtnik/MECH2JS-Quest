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
export class QuestFrameTrace {
  private entries: Entry[] = [];
  private capacity = 0;
  private next = 0;
  private count = 0;
  private sequence = 0;
  private active = false;
  readonly id = globalThis.crypto.randomUUID();
  readonly timeOrigin = performance.timeOrigin;
  start(capacity = 65536): void {
    if (!Number.isInteger(capacity) || capacity < 16 || capacity > 65536) throw Error('Trace capacity must be 16..65536');
    this.entries = []; this.capacity = capacity; this.next = 0; this.count = 0;
    // Never recycle cursors when an external recorder restarts capture.
    this.active = true;
  }
  stop(): void { this.active = false; }
  get enabled(): boolean { return this.active; }
  record(event: FrameTraceEvent): void {
    if (!this.active) return;
    this.entries[this.next] = { ...event, sequence: ++this.sequence };
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }
  read(after = 0) {
    const oldest = this.sequence - this.count + 1;
    const events: Entry[] = [];
    for (let i = 0; i < this.count; i++) {
      const entry = this.entries[(this.next - this.count + this.capacity + i) % this.capacity]!;
      if (entry.sequence > after) events.push({ ...entry });
    }
    return { id: this.id, timeOrigin: this.timeOrigin, active: this.active, cursor: this.sequence,
      dropped: Math.max(0, oldest - after - 1), events,
      note: 'start/end are performance.now; xrTime is XR callback time. Simulation events include inset WebGL submission. No GPU durations.' };
  }
}
