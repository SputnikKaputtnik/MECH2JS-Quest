/**
 * Bounded, transferable snapshots between a simulation worker and its presenter.
 * No shared mutable memory: postMessage transfers ownership of each buffer.
 * One buffer may be displayed, one pending and one being produced. The producer
 * skips a publication when all three are in flight; it never waits for drawing.
 *
 * This transport is not yet connected to Game/SceneRenderer. Metadata must be
 * structured-cloneable; all mutable bulk data belongs in the supplied buffer.
 * Use a fresh epoch and fresh endpoints for each worker/mission lifecycle.
 */
export interface Snapshot<T> {
  readonly kind: 'snapshot';
  readonly epoch: string;
  readonly slot: number;
  readonly sequence: number;
  readonly meta: T;
  readonly buffer: ArrayBuffer;
}

export interface SnapshotRelease {
  readonly kind: 'snapshot-release';
  readonly epoch: string;
  readonly slot: number;
  readonly sequence: number;
  readonly buffer: ArrayBuffer;
}

type Send<T> = (message: T, transfer: ArrayBuffer[]) => void;
interface Slot { buffer: ArrayBuffer | null; sequence: number }

export class SnapshotProducer<T> {
  private readonly slots: Slot[];
  private sequence = 0;
  private closed = false;
  readonly stats = { published: 0, skipped: 0 };

  constructor(readonly epoch: string, private readonly byteLength: number, private readonly send: Send<Snapshot<T>>) {
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0) throw Error('Invalid snapshot size');
    this.slots = Array.from({ length: 3 }, () => ({ buffer: new ArrayBuffer(byteLength), sequence: 0 }));
  }

  /** write is synchronous. It must copy source data, not retain the owned view. */
  publish(meta: T, write: (buffer: ArrayBuffer) => void): boolean {
    if (this.closed) return false;
    const index = this.slots.findIndex(s => s.buffer !== null);
    if (index < 0) { this.stats.skipped++; return false; }
    const slot = this.slots[index]!;
    const buffer = slot.buffer!;
    write(buffer);
    const sequence = ++this.sequence;
    this.send({ kind: 'snapshot', epoch: this.epoch, slot: index, sequence, meta, buffer }, [buffer]);
    slot.sequence = sequence;
    slot.buffer = null;
    this.stats.published++;
    return true;
  }

  /** Ignore releases from a disposed mission; reject duplicate/invalid releases. */
  release(message: SnapshotRelease): void {
    if (this.closed || message.epoch !== this.epoch) return;
    const slot = this.slots[message.slot];
    if (!slot || slot.buffer !== null || slot.sequence !== message.sequence || message.buffer.byteLength !== this.byteLength) {
      throw Error('Invalid snapshot release');
    }
    slot.buffer = message.buffer;
  }

  close(): void {
    this.closed = true;
    for (const slot of this.slots) slot.buffer = null;
  }
}

export class SnapshotConsumer<T> {
  private pending: Snapshot<T> | null = null;
  private current: Snapshot<T> | null = null;
  private newest = 0;
  private closed = false;
  readonly stats = { received: 0, superseded: 0, adopted: 0 };

  constructor(readonly epoch: string, private readonly send: Send<SnapshotRelease>) {}

  receive(snapshot: Snapshot<T>): void {
    // Old epochs belong to a terminated worker; never recycle into the new pool.
    if (snapshot.epoch !== this.epoch) return;
    if (this.closed) { this.recycle(snapshot); return; }
    if (!Number.isInteger(snapshot.slot) || snapshot.slot < 0 || snapshot.slot >= 3 ||
        snapshot.slot === this.current?.slot || snapshot.slot === this.pending?.slot ||
        !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence <= this.newest) {
      throw Error('Invalid snapshot publication');
    }
    if (this.pending) {
      this.recycle(this.pending);
      this.stats.superseded++;
    }
    this.pending = snapshot;
    this.newest = snapshot.sequence;
    this.stats.received++;
  }

  /**
   * Adopt only at a frame boundary. The returned buffer stays valid until the
   * next acquire that adopts a newer snapshot, or close. Do not retain its views
   * in deferred GPU uploads: copy/upload first, before returning ownership.
   */
  acquire(): Snapshot<T> | null {
    if (this.pending) {
      if (this.current) this.recycle(this.current);
      this.current = this.pending;
      this.pending = null;
      this.stats.adopted++;
    }
    return this.current;
  }

  close(): void {
    this.closed = true;
    if (this.pending) this.recycle(this.pending);
    if (this.current) this.recycle(this.current);
    this.pending = this.current = null;
  }

  private recycle(snapshot: Snapshot<T>): void {
    const { epoch, slot, sequence, buffer } = snapshot;
    this.send({ kind: 'snapshot-release', epoch, slot, sequence, buffer }, [buffer]);
  }
}
