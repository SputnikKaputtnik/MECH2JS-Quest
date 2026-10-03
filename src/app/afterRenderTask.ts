/** @portOnly One main-thread task after the XR callback; no idle/deadline guarantee. */
export class AfterRenderTask {
  private readonly channel: MessageChannel;
  private pending: (() => void) | null = null;
  private generation = 0;
  private closed = false;
  constructor(makeChannel = () => new MessageChannel()) {
    this.channel = makeChannel();
    this.channel.port1.onmessage = (event: MessageEvent<number>) => {
      if (this.closed || event.data !== this.generation) return;
      const task = this.pending;
      this.pending = null;
      task?.();
    };
  }
  /** Never queue multiple simulation jobs when rendering overtakes task dispatch. */
  post(task: () => void): boolean {
    if (this.closed || this.pending) return false;
    this.pending = task;
    this.channel.port2.postMessage(++this.generation);
    return true;
  }
  cancel(): void { this.pending = null; this.generation++; }
  dispose(): void {
    this.cancel(); this.closed = true;
    this.channel.port1.close(); this.channel.port2.close();
  }
}
