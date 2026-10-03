/** Record existing full-game XR only; never navigate or enter VR. Private output. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const output = process.argv[2], seconds = Number(process.argv[3] ?? 300);
const buffered = process.argv.includes('--buffered');
if (!output || !Number.isFinite(seconds) || seconds < 5 || seconds > 900) throw Error('Usage: node tools/quest-frame-record.mjs <private.jsonl> [seconds=300] [--gpu] [--auto-fire] [--buffered]');
// At up to 120 Hz, two events/frame for 240 s fit the existing 65,536-event ring.
// Still reject any actual overflow below; do not silently truncate a capture.
if (buffered && seconds > 240) throw Error('Buffered captures must be at most 240 seconds');
if (!buffered) console.warn('Streaming snapshots add headset main-thread work; use --buffered (<=240 s) for callback-pacing comparisons.');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relative = path.relative(repo, path.resolve(output));
if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) throw Error('Output must be outside repository');
const adb = process.env.ADB ?? 'C:/Android/Sdk/platform-tools/adb.exe';
const device = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : [];
const cdpOrigin = process.env.QUEST_CDP_ORIGIN ?? 'http://127.0.0.1:9223';
const targets = await (await fetch(new URL('/json/list', cdpOrigin), { signal: AbortSignal.timeout(5000) })).json();
const fixtures = targets.filter(t => t.type === 'page' && t.url.includes('/test/browser/fullGameVr.html'));
if (fixtures.length > 1) throw Error('Multiple full-game test pages: close inactive test pages before recording');
const target = fixtures[0];
if (!target) throw Error('Open the full-game test route on the selected CDP endpoint first');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let next = 0;
const pending = new Map();
ws.onmessage = ({ data }) => { const message = JSON.parse(data), p = pending.get(message.id); if (p) { pending.delete(message.id); clearTimeout(p.timer); if (message.error) p.reject(Error(JSON.stringify(message.error))); else p.resolve(message.result); } };
ws.onclose = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('CDP closed')); } pending.clear(); };
const evaluate = expression => new Promise((resolve, reject) => {
  const id = ++next;
  const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout')); }, 10000);
  pending.set(id, { timer, resolve: result => result.exceptionDetails ? reject(Error(JSON.stringify(result.exceptionDetails))) : resolve(result.result.value), reject });
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
});
let fd, gpu, traceId, cursor, stop = false;
const write = row => fs.writeSync(fd, JSON.stringify({ receivedAt: new Date().toISOString(), ...row }) + '\n');
process.on('SIGINT', () => { stop = true; });
try {
  const before = await evaluate('window.mw2FullGameTest.snapshot()');
  if (!before.xrVisible || before.mode !== 'play' || before.perf.status !== 'recording'
    || !Number.isFinite(before.perf.lastFrameAgeMs) || before.perf.lastFrameAgeMs > 1000) throw Error('Need a visible, advancing full-game XR mission');
  const autoFire = process.argv.includes('--auto-fire');
  fd = fs.openSync(output, 'wx');
  const displayPeriod = execFileSync(adb, [...device, 'shell', 'dumpsys', 'SurfaceFlinger', '--latency'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0];
  const started = await evaluate(`(()=>{window.mw2QuestPerf.trace.start();window.mw2FullGameTest.autoFire(${autoFire});const raw=window.mw2QuestPerf.trace.read();return {id:raw.id,cursor:raw.cursor}})()`);
  cursor = started.cursor; traceId = started.id;
  write({ kind: 'metadata', url: target.url, cdpOrigin, seconds, autoFire, before, displayPeriodNs: Number(displayPeriod),
    collectionMode: buffered ? 'buffered' : 'streaming',
    stateVerification: buffered ? 'endpoints-only; no periodic CDP reads during capture' : 'periodic-snapshots',
    note: 'GPU samples are device-wide with host receipt timestamps, not per-frame GPU durations. Display period must also be checked while XR is active.' });
  if (process.argv.includes('--gpu')) {
    gpu = spawn(adb, [...device, 'shell', 'timeout', String(Math.ceil(seconds) + 5), 'ovrgpuprofiler', '-r=2,17'], { windowsHide: true });
    gpu.stdout.on('data', b => write({ kind: 'device-gpu-counters', text: b.toString() }));
    gpu.stderr.on('data', b => write({ kind: 'device-gpu-stderr', text: b.toString() }));
    gpu.on('error', error => write({ kind: 'device-gpu-error', error: String(error) }));
  }
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    if (buffered) {
      // Wait on the host, leaving the headset's main thread alone. End the raw
      // trace before computing percentiles or serializing its buffered events.
      while (!stop && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, Math.min(2000, deadline - Date.now())));
    }
    const row = await evaluate(`(()=>{${buffered ? 'window.mw2QuestPerf.trace.stop();' : ''}const start=performance.now();const state=window.mw2FullGameTest.snapshot(),raw=window.mw2QuestPerf.trace.read(${cursor});return {state,raw,collection:{start,end:performance.now()}}})()`);
    if (traceId !== row.raw.id || row.state.epoch !== before.epoch) throw Error('Mission/trace changed during recording');
    traceId = row.raw.id; cursor = row.raw.cursor;
    write({ kind: 'sample', ...row });
    if (row.raw.dropped) throw Error('Raw trace overflow: capture is incomplete');
    if (!row.state.xrVisible || row.state.mode !== 'play' || row.state.perf.status !== 'recording') throw Error('Mission stopped or XR not visible');
    if (!Number.isFinite(row.state.perf.lastFrameAgeMs) || row.state.perf.lastFrameAgeMs > 1000) throw Error('XR callbacks stalled');
    if (buffered || stop || Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(2000, deadline - Date.now())));
  }
  write({ kind: 'complete', cursor, interrupted: stop });
  console.log(JSON.stringify({ output, cursor, interrupted: stop }));
} catch (error) {
  if (fd !== undefined) write({ kind: 'failure', error: String(error) });
  throw error;
} finally {
  try { await evaluate('window.mw2FullGameTest.autoFire(false); window.mw2QuestPerf.trace.stop(); true'); } catch { /* lost app */ }
  gpu?.kill();
  if (gpu) await new Promise(resolve => { if (gpu.exitCode !== null || gpu.signalCode !== null) resolve(); else gpu.once('close', resolve); });
  ws.close(); if (fd !== undefined) fs.closeSync(fd);
}
