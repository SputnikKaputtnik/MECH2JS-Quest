/** @portOnly Display-frame frequency, averaged over half a second; never the simulation tick rate. */
export class FrameRate {
  value: number | null = null;
  private last: number | null = null;
  private elapsed = 0;
  private frames = 0;
  private missionElapsed = 0;
  private missionFrames = 0;

  /** Time-weighted rate over this mission's active display intervals. */
  get missionAverage(): number | null { return this.missionElapsed > 0 ? this.missionFrames * 1000 / this.missionElapsed : null; }

  reset(): void { this.pause(); this.missionElapsed = 0; this.missionFrames = 0; }

  private pause(): void { this.value = null; this.last = null; this.elapsed = 0; this.frames = 0; }

  sample(now: number, visible: boolean): void {
    if (!visible) { this.pause(); return; }
    const dt = this.last === null ? 0 : now - this.last;
    this.last = now;
    if (dt <= 0 || dt > 1000) {
      this.value = null; this.elapsed = 0; this.frames = 0;
      return;
    }
    this.elapsed += dt;
    this.frames++;
    this.missionElapsed += dt;
    this.missionFrames++;
    if (this.elapsed >= 500) {
      this.value = this.frames * 1000 / this.elapsed;
      this.elapsed = 0; this.frames = 0;
    }
  }
}
