/** @portOnly On-device XR callback and CPU timing. Does not claim compositor/GPU FPS. */
import type { WebGLRenderer } from 'three';
import { FrameRate } from './frameRate.ts';
import { QUEST_TARGET_HZ, renderScale } from './questGraphics.ts';
export class QuestPerf {
  private samples: { dt: number; cpu: number; sim: number; calls: number; triangles: number }[] = [];
  private last = 0;
  private hz: number | undefined;
  private framebuffer = [0, 0];
  private eyeBuffers: number[][] = [];
  private foveation: number | null = null;
  private supportedHz: number[] = [];
  private memory = {};
  private total = 0;
  simMs = 0;
  private readonly displayRate = new FrameRate();
  get displayFps(): number | null { return this.displayRate.value; }
  get missionFps(): number | null { return this.displayRate.missionAverage; }
  constructor() {
    (window as unknown as { mw2QuestPerf: QuestPerf }).mw2QuestPerf = this;
  }
  // Diagnostic sampling can restart without erasing the player's mission average.
  reset(): void { this.samples = []; this.last = 0; this.total = 0; }
  record(now: number, cpu: number, renderer: WebGLRenderer): void {
    const session = renderer.xr.getSession();
    this.displayRate.sample(now, session?.visibilityState === 'visible');
    if (!session || session.visibilityState !== 'visible') { this.last = 0; return; }
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    this.hz = session.frameRate;
    const layer = renderer.xr.getBaseLayer();
    this.framebuffer = layer && 'textureWidth' in layer ? [layer.textureWidth, layer.textureHeight]
      : layer && 'framebufferWidth' in layer ? [layer.framebufferWidth, layer.framebufferHeight] : [0, 0];
    this.eyeBuffers = renderer.xr.getCamera().cameras.map(eye => [eye.viewport.width, eye.viewport.height]);
    this.foveation = layer?.fixedFoveation ?? null;
    this.supportedHz = session.supportedFrameRates ? [...session.supportedFrameRates] : [];
    this.memory = { ...renderer.info.memory };
    if (dt <= 0 || dt > 1000) return;
    const r = renderer.info.render;
    this.samples.push({ dt, cpu, sim: this.simMs, calls: r.calls, triangles: r.triangles });
    this.total++;
    if (this.samples.length > 4320) this.samples.shift();
  }
  snapshot() {
    const n = this.samples.length;
    const stat = (key: keyof typeof this.samples[number]) => {
      const a = this.samples.map(s => s[key]).sort((a,b)=>a-b);
      return { mean: a.reduce((s,v)=>s+v,0)/(n||1), p50:a[Math.floor(n*.5)]??0, p95:a[Math.floor(n*.95)]??0, p99:a[Math.floor(n*.99)]??0, max:a[n-1]??0 };
    };
    const interval=stat('dt'), budget=1000/(this.hz||QUEST_TARGET_HZ);
    return { samples:n,totalSamples:this.total, displayFps:this.displayFps, missionFps:this.missionFps, seconds:this.samples.reduce((s,v)=>s+v.dt,0)/1000, requestedHz:QUEST_TARGET_HZ, sessionHz:this.hz,
      supportedHz:this.supportedHz, eyeBuffers:this.eyeBuffers, foveation:this.foveation, requestedRenderScale:renderScale(),
      xrCallbackHz:interval.mean?1000/interval.mean:0,intervalMs:interval,cpuMs:stat('cpu'),simCpuMs:stat('sim'),
      lateIntervals:this.samples.filter(s=>s.dt>budget*1.5).length,drawCalls:stat('calls'),triangles:stat('triangles'),framebuffer:this.framebuffer,memory:this.memory,
      gpuMs:null,note:'XR callback timing; CPU excludes asynchronous GPU work. No compositor measurement.' };
  }
}
