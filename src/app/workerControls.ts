import type { KeyChange } from './xrPads.ts';

export interface WorkerControls {
  kind: 'controls'; epoch: string; sequence: number;
  keys: KeyChange[]; torso: [number, number] | null; release: boolean;
}

/** One outstanding message plus at most 64 ordered key edges. Stick samples
 * coalesce; key edges do not. Call pulse periodically even when keys stay held
 * so the worker's watchdog can distinguish holding a key from a lost host. */
export class WorkerControlSender {
  private sequence = 0;
  private waiting = 0;
  private keys: KeyChange[] = [];
  private torso: [number, number] | null = null;
  private release = false;
  constructor(private readonly epoch: string, private readonly send: (message: WorkerControls) => void) {}
  push(keys: readonly KeyChange[], torso: [number, number] | null = null): void {
    if (this.keys.length + keys.length > 64) {
      this.reset(); throw Error('Worker input overflow: controls released');
    }
    this.keys.push(...keys.map(k => ({ ...k })));
    if (torso) this.torso = [...torso];
    this.pulse();
  }
  reset(): void { this.keys = []; this.torso = [0, 0]; this.release = true; this.pulse(); }
  acknowledge(epoch: string, sequence: number): void {
    if (epoch !== this.epoch || sequence !== this.waiting) return;
    this.waiting = 0;
    if (this.keys.length || this.torso || this.release) this.pulse();
  }
  pulse(): void {
    if (this.waiting) return;
    this.waiting = ++this.sequence;
    const message: WorkerControls = { kind: 'controls', epoch: this.epoch, sequence: this.waiting,
      keys: this.keys, torso: this.torso, release: this.release };
    this.keys = []; this.torso = null; this.release = false;
    this.send(message);
  }
}
