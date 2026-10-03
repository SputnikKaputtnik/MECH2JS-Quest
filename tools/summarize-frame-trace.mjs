/** Raw non-overlapping events only; never average rolling-window percentiles. */
import fs from 'node:fs';
const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split(/\r?\n/).map(l => JSON.parse(l));
const warmupMs = Number(process.argv[3] ?? 30) * 1000;
if (!Number.isFinite(warmupMs) || warmupMs < 0) throw Error('Invalid warmup seconds');
const samples = rows.filter(r => r.kind === 'sample');
if (!samples.length || samples.some(r => r.raw.dropped)) throw Error('Missing or incomplete raw capture');
const events = samples.flatMap(r => r.raw.events);
const frames = events.filter(e => e.kind === 'frame' && e.visible);
const cutoff = (frames[0]?.start ?? 0) + warmupMs;
const selected = frames.filter(f => f.start >= cutoff);
const warmSamples = samples.filter(s=>s.raw.events.some(e=>e.start>=cutoff));
const sims = events.filter(e => e.kind === 'simulation');
const after = new Map();
for (const e of sims.filter(e => e.phase === 'after-render')) after.set(e.frame, (after.get(e.frame) ?? 0) + e.end - e.start);
const stats = a => { a.sort((a,b) => a-b); return { n:a.length, mean:a.reduce((s,x)=>s+x,0)/(a.length||1), p95:a[Math.floor(a.length*.95)]??null, p99:a[Math.floor(a.length*.99)]??null, max:a.at(-1)??null }; };
const metadata = rows.find(r => r.kind === 'metadata');
const budget = metadata.displayPeriodNs / 1e6;
const gpuText = rows.filter(r=>r.kind==='device-gpu-counters').map(r=>r.text).join('');
const gpuValues = label => [...gpuText.matchAll(new RegExp(label + '\\s*:\\s*([0-9.]+)', 'g'))].map(m=>Number(m[1]));
console.log(JSON.stringify({ complete:rows.some(r=>r.kind==='complete' && !r.interrupted), failure:rows.find(r=>r.kind==='failure'),
  mission:metadata.before.mission, schedule:metadata.before.schedule, actualEyes:metadata.before.perf.eyeBuffers,
  requestedHz:metadata.before.perf.requestedHz, observedDisplayPeriodMs:budget, warmupMs,
  frames:selected.length, intervalMs:stats(selected.map(f=>f.interval)),
  xrCallbacksPerSecond:1000/(selected.reduce((sum,f)=>sum+f.interval,0)/(selected.length||1)),
  consumedPassFrames:{ intervalMs:stats(selected.filter(f=>f.consumedPass).map(f=>f.interval)), cpuMs:stats(selected.filter(f=>f.consumedPass).map(f=>f.end-f.start)) },
  reusedSceneFrames:{ intervalMs:stats(selected.filter(f=>!f.consumedPass).map(f=>f.interval)), cpuMs:stats(selected.filter(f=>!f.consumedPass).map(f=>f.end-f.start)) },
  callbackCpuMs:stats(selected.map(f=>f.end-f.start)),
  callbackPlusAssociatedDeferredCpuMs:stats(selected.map(f=>f.end-f.start+(after.get(f.frame)??0))),
  passCpuMs:stats(sims.filter(s=>s.passed && s.start>=cutoff).map(s=>s.end-s.start)),
  passDrawCalls:stats(sims.filter(s=>s.passed && s.start>=cutoff).map(s=>s.calls)),
  lateIntervals:selected.filter(f=>f.interval>budget*1.5).length,
  maxObservedProjectiles:Math.max(...samples.map(s=>s.state.projectiles)),
  maxObservedPlayerProjectiles:Math.max(...samples.map(s=>s.state.playerProjectiles ?? 0)),
  invulnerableThroughout:samples.every(s=>s.state.invulnerable===true),
  audioRunningThroughout:samples.every(s=>s.state.audioState==='running'),
  stableEyeBuffers:samples.every(s=>JSON.stringify(s.state.perf.eyeBuffers)===JSON.stringify(metadata.before.perf.eyeBuffers)),
  combatProtocol:metadata.before.combatProtocol,
  instrumentsRequested:metadata.before.instruments ?? false,
  centeredThroughout:warmSamples.every(s=>s.state.centered===true),
  minimumAllocatedInsets:Math.min(...warmSamples.map(s=>s.state.insetTargets?.length??0)),
  customCockpitAvailableThroughout:warmSamples.every(s=>s.state.customCockpitAvailable===true),
  cockpitChassis:metadata.before.cockpitChassis,
  gpuFrequencyHz:stats(gpuValues('GPU Frequency')),
  shaderBusyPercent:stats(gpuValues('% Shaders Busy')),
  gpuCounterChunks:rows.filter(r=>r.kind==='device-gpu-counters').length,
  note:'Combined CPU groups deferred work by preceding callback; it is not GPU/frame latency. Warmup is relative to recorder start. No compositor FPS claim.' }, null, 2));
