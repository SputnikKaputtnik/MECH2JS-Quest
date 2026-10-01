/** @portOnly Display-frame frequency, averaged over half a second; never the simulation tick rate. */
export class FrameRate {
  value: number | null = null;
  private last: number | null = null;
  private elapsed = 0;
  private frames = 0;

  reset(): void { this.value = null; this.last = null; this.elapsed = 0; this.frames = 0; }

  sample(now: number, visible: boolean): void {
    if (!visible) { this.reset(); return; }
    const dt = this.last === null ? 0 : now - this.last;
    this.last = now;
    if (dt <= 0 || dt > 1000) {
      this.value = null; this.elapsed = 0; this.frames = 0;
      return;
    }
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed >= 500) {
      this.value = this.frames * 1000 / this.elapsed;
      this.elapsed = 0; this.frames = 0;
    }
  }
}
