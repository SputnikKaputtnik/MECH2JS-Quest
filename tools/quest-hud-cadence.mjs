/** @portOnly Compare HUD packing in an already-visible Quest mission.
 * Requires an existing ADB CDP forward (QUEST_CDP_URL, default port 9222).
 * No navigation, XR entry, persistent settings or profiling is performed.
 * Keep the required JSON output outside the repository; it contains raw timings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const output = process.argv[2], count = Number(process.argv[3] ?? 32);
if (!output || !Number.isInteger(count) || count < 4 || count > 128 || count % 4) {
  throw Error('Usage: node tools/quest-hud-cadence.mjs <private-report.json> [windows: multiple of 4, 4..128]');
}
const relativeOutput = path.relative(fileURLToPath(new URL('../', import.meta.url)), path.resolve(output));
if (!relativeOutput.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeOutput)) throw Error('Keep private reports outside the repository');
const base = process.env.QUEST_CDP_URL ?? 'http://127.0.0.1:9222';
const tabs = await (await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
const tab = tabs.find(t => t.type === 'page' && t.url === 'http://localhost:5173/');
if (!tab) throw Error('Production game tab missing');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
const pending = new Map(); let id = 0;
ws.onmessage = event => {
  const m = JSON.parse(event.data), p = pending.get(m.id);
  if (!p) return;
  clearTimeout(p.timer); pending.delete(m.id);
  if (m.error) p.reject(Error(JSON.stringify(m.error))); else p.resolve(m.result);
};
ws.onclose = () => {
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('CDP disconnected')); }
  pending.clear();
};
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { ws.close(); reject(Error('CDP connection timed out')); }, 10000);
  ws.onopen = () => { clearTimeout(timer); resolve(); };
  ws.onerror = () => { clearTimeout(timer); reject(Error('CDP connection failed')); };
});
const evaluate = async expression => {
  const n = ++id;
  const r = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(n); reject(Error('CDP evaluation timed out')); }, 20000);
    pending.set(n, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const report = { startedAt: new Date().toISOString(), windows: [], complete: false,
  note: 'ABBA 2.5 s windows after 8 s warmup. Instrumented HUD CPU time and record wall timestamps. Moving scene; XR timestamps do not measure compositor presentation.' };
fs.writeFileSync(output, JSON.stringify(report));
let installed = false;
try {
  await evaluate(`(async()=>{
    if(window.__questHudCadence)throw Error('A HUD cadence sampler already owns the hooks');
    const hud=window.mw2?.view?.hudOverlay,p=window.mw2QuestPerf;
    if(!hud||!document.querySelector('.game-view')||p?.snapshot().status!=='recording')throw Error('No advancing mission');
    await hud.prepareWasmPacking();
    const update=hud.update,record=p.record,rows=[];
    let hudMs=0,uploaded=false,lastVersion=hud.windowUniforms.uWindow.value?.version;
    hud.update=function(...args){const t=performance.now();const value=update.apply(this,args);
      hudMs=performance.now()-t;const v=this.windowUniforms.uWindow.value?.version;uploaded=v!==lastVersion;lastVersion=v;return value;};
    p.record=function(now,cpu,renderer){const wall=performance.now();record.call(this,now,cpu,renderer);
      window.__questHudCadence.renderer=renderer;
      if(rows.length<2048&&renderer.xr.getSession()?.visibilityState==='visible')rows.push({now,wall,cpu,sim:this.simMs,hudMs,uploaded,enabled:hud.wasmPacking,
        calls:renderer.info.render.calls,triangles:renderer.info.render.triangles});hudMs=0;uploaded=false;};
    const watchdog=setTimeout(()=>window.__questHudCadence?.cleanup(),${count * 2500 + 60000});
    window.__questHudCadence={hud,p,rows,cleanup:()=>{clearTimeout(watchdog);hud.update=update;p.record=record;hud.wasmPacking=false;delete window.__questHudCadence;}};
    return true;
  })()`);
  installed = true;
  await evaluate(`(async()=>{await new Promise(r=>setTimeout(r,4000));window.__questHudCadence.hud.wasmPacking=false;await new Promise(r=>setTimeout(r,4000));})()`);
  for (let i = 0; i < count; i++) {
    const enabled = [false, true, true, false][i % 4];
    const value = await evaluate(`(async()=>{
      const d=window.__questHudCadence;d.hud.wasmPacking=${enabled};d.rows.length=0;
      await new Promise(r=>setTimeout(r,2500));const perf=d.p.snapshot();
      if(!document.querySelector('.game-view')||window.mw2QuestPerf!==d.p||d.renderer?.xr.getSession()?.visibilityState!=='visible'||perf.status!=='recording'||d.rows.length<100)throw Error('Mission/XR stopped advancing');
      return {enabled:${enabled},rows:d.rows.slice(),memory:perf.memory,sessionHz:perf.sessionHz,eyeBuffers:perf.eyeBuffers,foveation:perf.foveation};
    })()`);
    report.windows.push(value); fs.writeFileSync(output, JSON.stringify(report));
    if (i % 8 === 7) console.log(`Saved ${i + 1}/${count} windows`);
  }
  report.complete = true;
} finally {
  try { if (installed) await evaluate('window.__questHudCadence?.cleanup()'); }
  finally { ws.close(); fs.writeFileSync(output, JSON.stringify(report)); }
}
console.log(`Saved ${count} windows; SIMD disabled and temporary hooks removed.`);
