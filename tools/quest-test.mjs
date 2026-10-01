/** @portOnly Unattended image checks on an authorized USB Quest. Requires a
 * separate Vite dev server on localhost:5175. Never touches the game's tab,
 * saves, sleep settings or XR permissions. Output is private, outside the repo. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const adb = process.env.ADB ?? (process.platform === 'win32' && fs.existsSync('C:/Android/Sdk/platform-tools/adb.exe')
  ? 'C:/Android/Sdk/platform-tools/adb.exe' : 'adb');
const output = process.argv[2];
if (!output) throw Error('Usage: node tools/quest-test.mjs <private-report.json>');
const runAdb = (...args) => execFileSync(adb, args, { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim();
const devices = runAdb('devices').split('\n').map(s => s.trim().split(/\s+/)).filter(s => s[1] === 'device');
const serial = process.env.ANDROID_SERIAL ?? (devices.length === 1 ? devices[0][0] : null);
if (!serial || !devices.some(s => s[0] === serial)) throw Error('Connect one authorized Quest, or set ANDROID_SERIAL.');
const device = (...args) => runAdb('-s', serial, ...args);
const response = await fetch('http://127.0.0.1:5175/test/browser/questHarness.html', { signal: AbortSignal.timeout(5000) });
if (!response.ok || !(await response.text()).includes('MW2 isolated Quest tests')) throw Error('Start the Vite dev server on port 5175 first.');

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let next = 0;
    const timeout = setTimeout(() => { socket.close(); reject(Error('CDP connection timed out')); }, 10000);
    socket.onerror = () => { clearTimeout(timeout); reject(Error('CDP connection failed')); };
    socket.onclose = () => {
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('CDP disconnected')); }
      pending.clear();
    };
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      const p = pending.get(message.id);
      if (!p) return;
      clearTimeout(p.timer); pending.delete(message.id);
      if (message.error) p.reject(Error(JSON.stringify(message.error))); else p.resolve(message.result);
    };
    socket.onopen = () => {
      clearTimeout(timeout);
      resolve({
        close: () => socket.close(),
        call: (method, params = {}) => new Promise((resolve, reject) => {
          const id = ++next;
          const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 180000);
          pending.set(id, { resolve, reject, timer });
          socket.send(JSON.stringify({ id, method, params }));
        }),
      });
    };
  });
}

let browser, page, targetId, port;
let addedReverse = false;
try {
  const reverse = device('reverse', '--list').split('\n').map(s => s.trim().split(/\s+/)).find(s => s[1] === 'tcp:5175');
  if (reverse && reverse[2] !== 'tcp:5175') throw Error('Quest port 5175 is already mapped elsewhere.');
  if (!reverse) { device('reverse', 'tcp:5175', 'tcp:5175'); addedReverse = true; }
  port = device('forward', 'tcp:0', 'localabstract:chrome_devtools_remote');
  if (!/^\d+$/.test(port)) throw Error(`Unexpected ADB forward response: ${port}`);
  const base = `http://127.0.0.1:${port}`;
  const version = await (await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(5000) })).json();
  browser = await connect(version.webSocketDebuggerUrl);
  ({ targetId } = await browser.call('Target.createTarget', { url: 'http://localhost:5175/test/browser/questHarness.html', background: true }));
  const targets = await (await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const target = targets.find(t => t.id === targetId);
  if (!target) throw Error('Test tab missing');
  page = await connect(target.webSocketDebuggerUrl);
  console.log(`Running isolated renderer checks on ${device('shell', 'getprop', 'ro.product.model')}…`);
  const deadline = Date.now() + 60000;
  for (;;) {
    const ready = await page.call('Runtime.evaluate', { expression: 'typeof window.runQuestTests === "function"', returnByValue: true })
      .catch(error => { if (!/navigated|context/.test(error.message)) throw error; return null; });
    if (ready?.result?.value) break;
    if (Date.now() > deadline) throw Error('Fixture did not initialize');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const result = await page.call('Runtime.evaluate', {
    expression: 'window.runQuestTests()', awaitPromise: true, returnByValue: true,
  });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  const report = { recordedAt: new Date().toISOString(), model: device('shell', 'getprop', 'ro.product.model'), ...result.result.value };
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: path.resolve(output), worldViews: report.world.length, maxWorldPixelDifference: Math.max(...report.world.map(r => r.different)), hudViews: report.hud.length, maxHudPixelDifference: Math.max(...report.hud.map(r => r.different)), lighting: { polygons: report.lighting.polygons, referenceMs: report.lighting.referenceMs, optimizedMs: report.lighting.optimizedMs, mismatches: report.lighting.mismatches }, xr: false }));
} finally {
  page?.close();
  if (targetId && browser) await browser.call('Target.closeTarget', { targetId }).catch(console.error);
  browser?.close();
  if (port && /^\d+$/.test(port)) { try { device('forward', '--remove', `tcp:${port}`); } catch (e) { console.error(e.message); } }
  if (addedReverse) { try { device('reverse', '--remove', 'tcp:5175'); } catch (e) { console.error(e.message); } }
}
