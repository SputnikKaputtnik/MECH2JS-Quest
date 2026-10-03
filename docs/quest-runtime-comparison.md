# Quest Browser versus embedded runtime

**Collector update:** the historical periodic recorder below adds main-thread
work. Use the [buffered protocol](quest-recorder-overhead.md) for new short
pacing comparisons, with matching collection modes and explicit endpoint
verification limits. The old commands remain documentation of those captures;
do not compare their absolute rates directly with buffered results.

The old Browser/native FPS reports used different missions, phases and actual
eye buffers. They do not isolate a runtime regression. This experiment uses the
same full-game development fixture and scheduling mode in both runtimes.

## Protocol

Keep the worker prototype paused. Use the no-HMR Vite server on port 5175 and
USB reverse. The normal APK and saved settings are not replaced. Select:

```text
/test/browser/fullGameVr.html?questFrameTest=after-render&questHz=90&questInvulnerable=1&questInstruments=1&questCenter=1&questRuntimeTest=1&questScale=1
```

Use `questScale=1` in Quest Browser and `questScale=1.25` in the embedded
runtime, then **verify 1680 x 1760 actual eye buffers in both**. Percentages are
not directly comparable between hosts. `questRuntimeTest=1` uses identical
explicit screen settings, the 20 Hz simulation, FFR on and DRS off. Its graphics
overrides are temporary and do not overwrite stored preferences. The snapshot
records the user agent, layer kind, context attributes, settings, FPS overlay
flag, eye buffers and sampled reference-space head pose.

The user chose 90 Hz for this performance comparison: a 72 Hz ceiling could
hide differences in available headroom. The temporary device property
`debug.oculus.refreshRate` is set to 90, and the active display period must be
11,111,111 ns. Quest Browser also reports `session.frameRate=90`; the pinned
embedded runtime may not expose that API. Return the device to the previously
accepted 72 Hz setting after tests. Do not interpret this as a permanent
refresh-rate change in the released APK.

The resting headset stays still. The fixture applies its reference-space
offset after two active seconds, avoiding the initial session pose. If the
headset moves after entering VR (for example, while granting permission),
recenter once after it is resting, then restart the scratch mission. For both
runtimes, the same existing renderer can be accessed in an authorized CDP
evaluation for this one-shot test adjustment:

```javascript
const { renderPort } = await import('/src/sim/display/renderPort.ts');
const renderer = renderPort.current.renderer;
await new Promise(resolve => renderer.xr.getSession().requestAnimationFrame((time, frame) => {
  const reference = renderer.xr.getReferenceSpace();
  const pose = frame.getViewerPose(reference);
  renderer.xr.setReferenceSpace(reference.getOffsetReferenceSpace(pose.transform));
  resolve();
}));
window.mw2FullGameTest.restart();
```

This uses the renderer's TypeScript-private field solely in the dev fixture;
it is not a shipped app API. The sampled pose in the measurement window must
remain close to the centered origin, rather than assuming the offset succeeded.
Do not override ongoing human head motion or use this in normal gameplay.

Close only the test tabs from earlier attempts; stop the other game runtime
during each capture. Wait for visible, advancing XR and running audio. Both
tests use invulnerable AMY_SCN1, the Mad Dog cockpit, rear and shaded target
insets, repeated nearest-enemy selection and the same stationary fire protocol.
There are no worker omissions, but this is not a deterministic combat replay.

Select the CDP endpoint for the recorder, with files outside the repository:

```powershell
# Quest Browser forward: chrome_devtools_remote
$env:QUEST_CDP_ORIGIN='http://127.0.0.1:9222'
node tools/quest-frame-record.mjs <private-browser.jsonl> 300 --gpu --auto-fire
# Embedded runtime forward: content_shell_devtools_remote
$env:QUEST_CDP_ORIGIN='http://127.0.0.1:9223'
node tools/quest-frame-record.mjs <private-native.jsonl> 300 --gpu --auto-fire
node tools/summarize-frame-trace.mjs <private-browser.jsonl> 30
node tools/summarize-frame-trace.mjs <private-native.jsonl> 30
```

Exclude 30 capture seconds as warm-up. Verify settings, stable eye buffers,
FFR, disabled DRS, audio, instrument targets, and sampled head-position/rotation
in both summaries. Compare raw intervals and CPU including deferred simulation,
not just callback CPU. GPU frequency and shader-busy are device-wide counters,
not application GPU frame times. No compositor-delivery FPS claim follows.
Record thermal state and run order; a small difference needs reversed repeats.

The summary also reports `callbackStartIntervalMs`, measured between
`performance.now()` readings at actual callback entry. Keep it distinct from
`intervalMs`, which uses the timestamps supplied by WebXR. Different prediction
or callback scheduling policies can produce different interval distributions;
neither is a direct count of compositor-presented or dropped frames.

An initial Browser-only 72 Hz capture was stopped when the user selected 90 Hz
for this comparison. That partial capture is retained privately as exploratory
evidence and is not part of the matched pair.

## Results, 2026-10-03

The initial 300-second Browser capture was stationary throughout. The initial
embedded capture changed pose around mission second 174 (up to 12.1 cm and
35.3 degrees), so it is retained as diagnostic evidence rather than a clean
five-minute matched viewpoint. The common stationary capture window from
30 to 160 seconds gave 89.41 versus 87.12 callbacks/s and 5.73 versus 5.64 ms
combined CPU for Browser versus embedded runtime. This subset was selected
after inspecting the pose log, not predeclared.

A complete recentered embedded repeat stayed within 0.58 mm and 0.017 degrees
of its center. A subsequent Browser repeat stayed within 1.79 mm and 0.017
degrees. Both repeats completed 300 seconds, retained two active instrument
targets, running audio, invulnerability, FFR 1, disabled DRS and stable eye
buffers/settings. Thermal status remained 0. The full-capture results below
exclude the first 30 seconds:

| Measurement | Browser, first | Embedded, stationary repeat | Browser, repeat after embedded |
| --- | ---: | ---: | ---: |
| Actual pixels per eye | 1680 x 1760 | 1680 x 1760 | 1680 x 1760 |
| Display period | 11.111111 ms | 11.111111 ms | 11.111111 ms |
| Visible callbacks | 24,129 | 23,699 | 24,157 |
| XR callbacks/s | 89.36 | 87.76 | 89.46 |
| Callback CPU mean | 4.04 ms | 4.26 ms | 4.23 ms |
| Callback + associated deferred CPU mean | 5.57 ms | 5.59 ms | 5.75 ms |
| Actual callback-entry interval p99 | 25.90 ms | 21.90 ms | 25.50 ms |
| Actual callback-entry interval maximum | 47.70 ms | 31.20 ms | 42.20 ms |
| Callback-entry intervals >16.667 ms | 670 | 586 | 616 |
| Device GPU frequency mean, including warm-up | 457 MHz | 538 MHz | 456 MHz |
| Device shader busy mean, including warm-up | 73.16% | 64.94% | 73.35% |

This does not reproduce the large historical Browser/native gap. The host CPU
cost is effectively the same in this workload, and the faster average callback
rate does not imply better worst-case pacing. The two runtimes use different
Chromium versions (152 versus 150). Both use an XRProjectionLayer; the initial
pair's eye projection matrices match exactly. Neither exposes a GPU timer-query
extension in the captured context. Device GPU clock/utilization differences
do not isolate runtime overhead or establish spare GPU milliseconds.

The embedded repeat reused its session and restarted the scratch mission;
it is not an independent cold app start. Combat is not a deterministic replay,
and the runtimes were not thermally equilibrated. These are development-server
runs of the same frontend, not a comparison of different bundled releases.
They cannot identify the cause of the earlier unmatched 89-versus-74 report.

Private evidence: `quest-runtime-browser-90-matched-20261003.jsonl`,
`quest-runtime-native-90-matched-20261003.jsonl` (pose change), and
`quest-runtime-native-90-repeat-20261003.jsonl`, and
`quest-runtime-browser-90-repeat-20261003.jsonl`, with generated summaries,
runtime diagnostics and thermal snapshots. Raw files remain outside Git.

Separate 30-second post-capture CPU profiles have profiler overhead and no
automatic firing, so they are diagnostic only. In the embedded profile, self
samples include about 1.09 s in `SceneRenderer.shade`, 0.96 s in `polyDepthKey`,
0.74 s in HUD `update`, 0.44 s in geometry `build` and 0.53 s in GC. The 2.66 s
attributed to `(program)` are not automatically driver or Wolvic time. A next
bounded investigation should count geometry rebuilds by main/inset pass and
reason before changing caching; never reintroduce unbounded retention to avoid
rebuilding. The profiles do not establish a leak or a promised optimization gain.
The Browser diagnostic assigns 7.52 s to `(program)` versus 2.66 s in the
embedded diagnostic despite the Browser's higher callback rate; this is another
reason not to treat that profiler bucket as measured runtime overhead.

After capture, Quest Browser was stopped, the temporary refresh property was
returned to 72 and the existing APK reopened at its bundled local origin.
No `ovrgpuprofiler` process remained. The no-HMR server remains available for
the user-authorized follow-up investigation; normal bundled gameplay does not
depend on it.

## Relation to a native C++/OpenXR prototype

This comparison evaluates two hosts of the existing JavaScript renderer. A
genuinely native C++/OpenXR prototype would be a different renderer/runtime,
not a WebAssembly build inside Wolvic. It should reproduce a representative
scene, cockpit, HUD and instrument views at matching eye buffers and 90 Hz,
measure native CPU/GPU and OpenXR timing, and account for all scene-update or
simulation transport work. A faster incomplete demo is not evidence of a full
port's budget. No native C++ prototype is implemented by these fixture changes.

## Code verification

The temporary graphics overrides are covered by a preference-preservation test.
All 344 unit tests passed. The complete suite had 614 passes and the previously
reproduced private CD-image volume-size failure in `test/golden/iso9660.test.ts`
(56,037 versus 56,187 sectors). All three TypeScript projects, ESLint, both Wasm
consistency checks, production build and offline inventory generation passed.
Generation remains unavailable without the private `MW2_DECOMPILED` checkout;
generated files were not changed. No APK or published release was replaced.
