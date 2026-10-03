# Full-game 72 Hz scheduling experiment

The worker prototype is preserved, but further worker integration is paused.
The current goal is stable 72 Hz with measurable headroom in the complete game.
Neither moving work outside a callback nor requesting 72 Hz proves a speedup.

## Implementation

Normal gameplay still calls `Game.playFrame` inline. Explicit URL parameters
select the experiment: `questFrameTest=inline` or `questFrameTest=after-render`.
Both enable a bounded raw trace. `questHz=72` changes the WebXR request and
telemetry target; it does not override an unsupported native refresh-rate API.

The alternative schedules the entire `Game.playFrame` bundle, including timer,
audio and inset rendering, as one `MessageChannel` task after the XR callback
returns. This is the same JavaScript thread, not a worker or a guaranteed idle
slot, and does not prove that the compositor has submitted that frame. Long
tasks can still delay the next XR callback.

The initial pass runs inline. `views.beginFrame()` remains immediately before
the simulation pass. A pending revision marks the next presentation's camera,
HUD and aim data dirty; the camera keeps the preceding XR timestamp as its time
anchor. There is at most one queued task, elapsed time coalesces with a 100 ms
cap, and disposal invalidates pending jobs. Hidden XR, paused gameplay and
network gameplay do not use deferred simulation. No snapshot transport is used.

## Reproduce

Use the no-HMR server described in [the handoff](quest-handoff.md#reproduce-safely).
In the existing native embedded runtime, navigate its existing content target to:

```text
http://127.0.0.1:5175/test/browser/fullGameVr.html?questFrameTest=after-render&questHz=72&questInvulnerable=1&questInstruments=1&questCenter=1
```

The fixture loads scratch `AMY_SCN1` through the normal `GameScreen`, including
cockpit, HUD, inset views, hands, controls and `AudioHost`. It does not load pilot
saves or exercise campaign handoff/front-end navigation. `questInvulnerable=1`
uses the original invulnerability cheat after each load, without saving options.
It must be identical in both comparison runs; damage/death processing is not
represented by these runs. Existing controller input remains enabled.

`questInstruments=1` selects the original rear view and shaded target view, then
presses/releases the nearest-enemy key every ten seconds during automatic fire.
Confirm two allocated inset targets and nonzero per-pass inset draw calls after
warm-up. The first exploratory pair had neither instrument view active, so it
does not establish headroom for the richer workload.

`questCenter=1` offsets the test session's reference space once to the resting
headset's initial pose, giving it a neutral forward view while keeping live
tracking as requested by the reference-space API. The flag records application
of that offset, not independent proof of compositor pose correctness. It does
not change saved controls or normal recenter behavior. Both
runs must use it consistently. Without it, an unattended headset may be looking
at the cockpit roof, which materially changes visible scene cost.

Choose Enter VR, or invoke `window.mw2FullGameTest.enter()` through an authorized
user-gesture CDP evaluation. Confirm advancing visible XR and audio state
`running` via `window.mw2FullGameTest.snapshot()`. Then, from the repo root:

```powershell
node tools/quest-frame-record.mjs <private-output-outside-repo.jsonl> 300 --gpu --auto-fire
node tools/summarize-frame-trace.mjs <private-output-outside-repo.jsonl> 30
```

With invulnerability enabled, the workload stays stationary, warms up for 30
mission seconds, then holds fire for two seconds and releases for three.
Enemy combat remains active. This is a repeatable input protocol, not a
deterministic replay or a substitute for a human visual/controls acceptance test.
Without invulnerability the legacy fixture protocol accelerates for 20 seconds.
Do not compare those two protocols. Inspect observed player and total projectile
counts to confirm that the run actually contains combat.

Repeat with `questFrameTest=inline`, the same settings, same headset pose, audio,
actual eye buffers, FFR, runtime, warm-up and workload. Explicitly restart the
server and page after module edits: HMR and file watching are disabled. Do not
replace the APK to iterate this development route; it temporarily requires USB
and the PC server. Normal bundled gameplay remains available at the native
content origin `http://127.0.0.1:19895/?native=1`.

## Refresh rate and measurement limits

The pinned native Wolvic build requests 90 Hz in `DeviceDelegateOpenXR.cpp`.
Its WebXR session exposes neither `frameRate` nor supported refresh rates.
For these tests, the temporary Android property `debug.oculus.refreshRate` was
set to `72`, followed by an app restart. SurfaceFlinger reported 13,888,888 ns
while XR was active. Record the previous property before changing it and restore
that value after testing or reboot; this is not a permanent APK setting.

Raw events distinguish consumed simulation passes from reused scenes, callback
wall CPU and deferred simulation wall CPU. Both use `performance.now()`; the XR
timestamp is stored separately. The summary adds deferred cost back to its
associated callback instead of treating that work as free. Inset draw calls are
included in simulation events; the rolling callback-only draw count is not the
complete submission count in deferred mode.

The recorder polls every two seconds and rejects lost trace entries, a changed
mission, stale/hidden XR or mission end. This instrumentation has overhead in
both modes. It never silently relaunches a dead mission. GPU frequency and
shader-busy samples from `ovrgpuprofiler -r=2,17` are device-wide, timestamped on
host receipt, and **not per-frame GPU times**. XR callback frequency and the
SurfaceFlinger display period do not establish compositor delivery FPS.

The summary excludes the first 30 capture seconds and reports intervals,
callback CPU, CPU including deferred work, pass costs, late intervals, audio,
eye-buffer stability and GPU counters. Raw private logs belong outside the
repository. Keep incomplete and earlier different-workload runs out of the A/B
comparison. Repeat in reversed order and record thermal conditions before
treating small differences as an optimization win.

## Validation and remaining acceptance

### Quest comparison, 2026-10-03

One complete five-minute run per mode, inline first, deferred second; discard
the first 30 capture seconds. Both use the same installed native runtime,
AMY_SCN1, Mad Dog custom cockpit (`MD`), stationary fire protocol, original
invulnerability cheat, running audio, requested 125% resolution, actual
1680 x 1760 per-eye buffers, fixed foveation 1, and two 103 x 80 instrument
targets. DRS is enabled in preferences but unsupported by this runtime; the
actual eye buffers stayed fixed. Each run starts a fresh native app process.
Thermal service reported status 0; no controlled thermal equilibration was used.

| Measurement after warm-up | Inline | After-render task |
| --- | ---: | ---: |
| Captured visible XR callbacks | 18,832 | 19,355 |
| XR callbacks/s | 69.74 | 71.68 |
| Interval p99 | 28.48 ms | 15.55 ms |
| Longest interval | 42.43 ms | 41.66 ms |
| Intervals >20.83 ms (1.5 display periods) | 860 (4.57%) | 87 (0.45%) |
| Callback CPU mean / p99 | 6.14 / 14.30 ms | 4.34 / 8.70 ms |
| Callback + associated deferred CPU mean / p99 | 6.14 / 14.30 ms | 6.09 / 11.40 ms |
| Simulation-pass CPU mean (including inset submission) | 5.42 ms | 5.82 ms |
| Draw calls per simulation pass | 20.25 | 20.15 |
| Device GPU frequency mean, full capture | 524 MHz | 500 MHz |
| Device shader-busy mean, full capture | 64.40% | 64.67% |

The long-interval count fell by about 90% in this pair. Total measured host CPU
work barely changed: this is evidence for better pacing in this stationary
workload, not a substantial compute saving. Neither mode was perfectly locked
to 72 callbacks/s. The device-wide GPU counters include warm-up and compositor
activity, are not synchronized per-frame GPU durations, and do not establish a
budget for improved lighting. No compositor-delivery FPS claim is made.

The screenshot check confirms stereo cockpit/world/HUD content, but does not
replace a human head-motion test. The resting-headset reference-space offset
and stationary input are not a broad viewpoint/combat replay. A reversed-order
repeat and user acceptance remain before enabling this by default.

Private evidence (outside the repository):
`quest-full-inline-72-instruments-20261003.jsonl` and
`quest-full-after-render-72-instruments-20261003.jsonl`, their generated summary
JSONs, thermal snapshots and screenshots. Earlier `*-invulnerable-*` logs lack
active inset views and are exploratory only; an exploratory screenshot also
perturbed that earlier inline run. They are excluded from the table above.

### Code checks

All 343 unit tests passed. The full 614-test run had 613 passes and one failure
in `test/golden/iso9660.test.ts`: the private CD image's volume size is 56,037
sectors while the cue-derived expectation is 56,187. The identical test fails
with the identical values in the unchanged pre-worker release source. It was
not changed as part of this experiment. The focused scheduler/trace and cheat
tests pass. Full ESLint, all three TypeScript projects, both Wasm consistency
checks, production Vite build and offline inventory generation passed.
Code generation cannot run because the private `MW2_DECOMPILED` checkout is
not configured; generated files were not edited.

One development-route reload stopped responding to CDP without a crash-buffer
entry or a recorded app exit; a force-stop/restart recovered the native runtime.
It occurred outside the measured instrument comparison and is an unresolved
reload/lifecycle issue, not a confirmed gameplay crash or a scheduling win.
The instrument comparison uses a fresh app process for each mode.

Human stereo/head-motion, glove contact, menus, pause/resume and death/abort
acceptance are still required before promoting the deferred mode. Invulnerable,
stationary headset tests intentionally do not cover those interactions. Keep
the ordinary inline path and the preserved release available.
