/** @portOnly Bounded XR viewport scaling, driven by visible callback cadence, not GPU timing. */
export class DynamicResolution {
  scale = 1;
  private last = 0;
  private elapsed = 0;
  private frames = 0;
  private slowFrames = 0;
  private goodWindows = 0;

  sample(now: number, hz: number, active: boolean): number {
    if (!active) {
      this.scale = 1;
      this.resetTiming();
      return this.scale;
    }
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    // Entry, suspension and loading stalls must not count as sustained overload.
    if (dt <= 0 || dt > 250) {
      this.elapsed = this.frames = this.slowFrames = this.goodWindows = 0;
      return this.scale;
    }
    this.elapsed += dt;
    this.frames++;
    if (dt > 1000 / hz * 1.1) this.slowFrames++;
    if (this.elapsed < 1000) return this.scale;
    const ratio = this.frames * 1000 / this.elapsed / hz;
    if (ratio < 0.97 && this.slowFrames >= 3) {
      this.scale = Math.max(0.7, Math.round((this.scale - 0.05) * 100) / 100);
      this.goodWindows = 0;
    } else if (ratio >= 0.99) {
      if (++this.goodWindows >= 3) {
        this.scale = Math.min(1, Math.round((this.scale + 0.05) * 100) / 100);
        this.goodWindows = 0;
      }
    } else this.goodWindows = 0;
    this.elapsed = this.frames = this.slowFrames = 0;
    return this.scale;
  }

  resetTiming(): void {
    this.last = this.elapsed = this.frames = this.slowFrames = this.goodWindows = 0;
  }
}
