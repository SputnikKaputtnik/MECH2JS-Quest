/** @portOnly The launch view owns its boot fade; it must not replay inside the mission. */
import type { DacFrame } from '../../sim/world/palettes.ts';

export class LaunchPlayback {
  private readonly frames: DacFrame[];
  readonly durationMs: number;

  constructor(queue: DacFrame[]) {
    this.frames = queue.splice(0);
    this.durationMs = this.frames.reduce((sum, frame) => sum + frame.waits, 0) * 1000 / 60;
  }

  /** Original display waits at 60 Hz, independent of the headset refresh rate. */
  at(elapsedMs: number): DacFrame | null {
    let wait = Math.max(0, elapsedMs) * 60 / 1000;
    for (const frame of this.frames) {
      if (wait < frame.waits) return frame;
      wait -= frame.waits;
    }
    return null;
  }
}
