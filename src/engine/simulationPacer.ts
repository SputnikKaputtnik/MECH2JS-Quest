/** Wall-clock pacing for the worker. Matches Game.playFrame's 182 Hz timer,
 * 20 Hz loop and bounded catch-up; a late wake never runs a burst of sim steps. */
export class SimulationPacer {
  private ticks = 0;
  private due = 0;
  advance(ms: number): { ticks: number; step: boolean } {
    if (!Number.isFinite(ms) || ms < 0) throw Error('Invalid simulation interval');
    this.ticks = Math.min(this.ticks + ms * 182 / 1000, 45);
    const ticks = Math.floor(this.ticks); this.ticks -= ticks;
    this.due += ms;
    const step = this.due >= 50;
    if (step) this.due = Math.min(this.due - 50, 50);
    return { ticks, step };
  }
}
