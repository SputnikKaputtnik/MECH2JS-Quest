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
const dispatchIntervals = frames.flatMap((f,i)=>i && f.start>=cutoff ? [f.start-frames[i-1].start] : []);
const warmSamples = samples.filter(s=>s.raw.events.some(e=>e.start>=cutoff));
const sims = events.filter(e => e.kind === 'simulation');
const after = new Map();
for (const e of sims.filter(e => e.phase === 'after-render')) after.set(e.frame, (after.get(e.frame) ?? 0) + e.end - e.start);
const stats = a => { a.sort((a,b) => a-b); return { n:a.length, mean:a.reduce((s,x)=>s+x,0)/(a.length||1), p95:a[Math.floor(a.length*.95)]??null, p99:a[Math.floor(a.length*.99)]??null, max:a.at(-1)??null }; };
const metadata = rows.find(r => r.kind === 'metadata');
const periodic = metadata.collectionMode !== 'buffered';
const budget = metadata.displayPeriodNs / 1e6;
const gpuText = rows.filter(r=>r.kind==='device-gpu-counters').map(r=>r.text).join('');
const gpuValues = label => [...gpuText.matchAll(new RegExp(label + '\\s*:\\s*([0-9.]+)', 'g'))].map(m=>Number(m[1]));
const poses = warmSamples.map(s=>s.state.headPose).filter(Boolean);
console.log(JSON.stringify({ complete:rows.some(r=>r.kind==='complete' && !r.interrupted), failure:rows.find(r=>r.kind==='failure'),
  collectionMode:metadata.collectionMode ?? 'streaming',
  stateVerification:metadata.stateVerification ?? 'periodic-snapshots',
  collectionMainThreadMs:stats(samples.filter(s=>s.collection).map(s=>s.collection.end-s.collection.start)),
  mission:metadata.before.mission, schedule:metadata.before.schedule, actualEyes:metadata.before.perf.eyeBuffers,
  requestedHz:metadata.before.perf.requestedHz, observedDisplayPeriodMs:budget, warmupMs,
  runtime:{userAgent:metadata.before.userAgent,layerKind:metadata.before.layerKind,contextAttributes:metadata.before.contextAttributes,
    settings:metadata.before.settings,loopRate:metadata.before.loopRate,ffr:metadata.before.perf.foveation,
    drsEnabled:metadata.before.perf.dynamicResolution?.enabled,requestedRenderScale:metadata.before.perf.requestedRenderScale,
    fpsCounter:metadata.before.fpsCounter},
  stableRenderConditions:periodic ? warmSamples.every(s=>s.state.perf.foveation===metadata.before.perf.foveation
    && s.state.perf.dynamicResolution?.enabled===metadata.before.perf.dynamicResolution?.enabled
    && s.state.perf.dynamicResolution?.requestedViewportScale===1
    && JSON.stringify(s.state.settings)===JSON.stringify(metadata.before.settings)) : null,
  endpointSettingsMatch:JSON.stringify(samples.at(-1).state.settings)===JSON.stringify(metadata.before.settings),
  endpointEyeBuffersMatch:JSON.stringify(samples.at(-1).state.perf.eyeBuffers)===JSON.stringify(metadata.before.perf.eyeBuffers),
  observedHiddenFrames:events.filter(e=>e.kind==='frame'&&!e.visible).length,
  headPoseSamples:poses.length,
  maxHeadPositionFromCenterM:poses.length?Math.max(...poses.map(p=>Math.hypot(...p.position))):null,
  maxHeadRotationFromCenterDegrees:poses.length?Math.max(...poses.map(p=>2*Math.acos(Math.min(1,Math.abs(p.orientation[3])))*180/Math.PI)):null,
  frames:selected.length, intervalMs:stats(selected.map(f=>f.interval)),
  callbackStartIntervalMs:stats(dispatchIntervals),
  lateCallbackStarts:dispatchIntervals.filter(dt=>dt>budget*1.5).length,
  xrCallbacksPerSecond:1000/(selected.reduce((sum,f)=>sum+f.interval,0)/(selected.length||1)),
  consumedPassFrames:{ intervalMs:stats(selected.filter(f=>f.consumedPass).map(f=>f.interval)), cpuMs:stats(selected.filter(f=>f.consumedPass).map(f=>f.end-f.start)) },
  reusedSceneFrames:{ intervalMs:stats(selected.filter(f=>!f.consumedPass).map(f=>f.interval)), cpuMs:stats(selected.filter(f=>!f.consumedPass).map(f=>f.end-f.start)) },
  callbackCpuMs:stats(selected.map(f=>f.end-f.start)),
  callbackDrawCalls:stats(selected.map(f=>f.calls)),
  callbackTriangles:stats(selected.map(f=>f.triangles)),
  callbackPlusAssociatedDeferredCpuMs:stats(selected.map(f=>f.end-f.start+(after.get(f.frame)??0))),
  passCpuMs:stats(sims.filter(s=>s.passed && s.start>=cutoff).map(s=>s.end-s.start)),
  passDrawCalls:stats(sims.filter(s=>s.passed && s.start>=cutoff).map(s=>s.calls)),
  lateIntervals:selected.filter(f=>f.interval>budget*1.5).length,
  maxObservedProjectiles:Math.max(...samples.map(s=>s.state.projectiles)),
  maxObservedPlayerProjectiles:Math.max(...samples.map(s=>s.state.playerProjectiles ?? 0)),
  invulnerableThroughout:periodic ? samples.every(s=>s.state.invulnerable===true) : null,
  audioRunningThroughout:periodic ? samples.every(s=>s.state.audioState==='running') : null,
  stableEyeBuffers:periodic ? samples.every(s=>JSON.stringify(s.state.perf.eyeBuffers)===JSON.stringify(metadata.before.perf.eyeBuffers)) : null,
  combatProtocol:metadata.before.combatProtocol,
  instrumentsRequested:metadata.before.instruments ?? false,
  centeredThroughout:periodic ? warmSamples.every(s=>s.state.centered===true) : null,
  minimumAllocatedInsets:Math.min(...warmSamples.map(s=>s.state.insetTargets?.length??0)),
  customCockpitAvailableThroughout:periodic ? warmSamples.every(s=>s.state.customCockpitAvailable===true) : null,
  cockpitChassis:metadata.before.cockpitChassis,
  gpuFrequencyHz:stats(gpuValues('GPU Frequency')),
  shaderBusyPercent:stats(gpuValues('% Shaders Busy')),
  gpuCounterChunks:rows.filter(r=>r.kind==='device-gpu-counters').length,
  note:'intervalMs uses XR-provided timestamps; callbackStartIntervalMs uses performance.now at callback entry. Combined CPU groups deferred work by preceding callback, not GPU/frame latency. Warmup is relative to recorder start. No compositor FPS claim.' }, null, 2));
