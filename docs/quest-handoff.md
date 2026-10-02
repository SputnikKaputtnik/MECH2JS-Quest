# Quest development handoff — 2026-10-02

## Start here

Code baseline: **`78e71fa` on `vr-mode`**, fork
[SputnikKaputtnik/MECH2JS-Quest](https://github.com/SputnikKaputtnik/MECH2JS-Quest).
Upstream is [Adam4lexander/MECH2JS](https://github.com/Adam4lexander/MECH2JS).
This handoff adds documentation; it does not install a new APK or replace gameplay.

**The worker experiment has not demonstrated a performance improvement over the
complete playable build.** Its visible test omits audio, custom cockpits, physical
cockpit interactions and 3D HUD inset views. Matching its render resolution to the
old build does not make the workloads equivalent. Even this reduced test does not
hold a perfectly stable 90 XR callbacks/s. No additional budget for improved
lighting or other graphics has been established.

What is verified: an independent mission worker, bounded/drop-safe snapshot
transport, substantially cheaper adoption than the earlier *worker reference
codec*, sampled image equivalence and visible headset operation with in-session
mission restart. The 43.66 → 2.54 ms adoption comparison is between two worker
prototypes; it is **not a 41 ms saving against normal gameplay**.

Read alongside [setup and controls](../QUEST-STANDALONE.md),
[Android packaging](../native/android/README.md),
[snapshot contract and experimental history](worker-render-boundary.md), and
[porting notes](porting-notes.md). Preserve original aesthetics and accepted
controls. Sensitivity tuning and a stylistically compatible “Special Edition”
are later work. No SteamVR/Link dependency or full C rewrite is part of this step.

## What runs where

The full standalone pre-worker baseline is preserved as
[v0.1.0-quest-preworker](https://github.com/SputnikKaputtnik/MECH2JS-Quest/releases/tag/v0.1.0-quest-preworker)
at `462267494ca82839caacc1735ad5464612e72fd0`. Assets: unchanged signed APK,
English maintainer kit with licenses/install instructions, and SHA-256 sums.
APK SHA-256: `7fa1284700fb303ba2b71830129ac2e588fed3c7b48b333ee57f7bdf3501da37`.
Source rebuild reproduced compiled frontend assets and native bootstrap DEX;
the service worker differs only in line endings. Packaging validation passed
29 focused unit tests, 21 local HTTP cases, TypeScript/Wasm checks, signature and
alignment checks. No fresh headset run or performance claim accompanied packaging.
The release contains no original game data, saves or signing keys.

| Path | Runtime / entry | Status |
| --- | --- | --- |
| Full browser game | Quest Browser, normally `http://localhost:5173/` | Offline installation and separate browser save profile; fallback |
| Full standalone game | APK `io.github.sputnikkaputtnik.mech2quest`, embedded Wolvic Chromium 1.4 / OpenXR, `http://127.0.0.1:19895/?native=1` | Local content; does not require PC/browser connection during ordinary play; simulation and presentation still share main JS thread |
| Visible worker experiment | Existing embedded runtime navigated to `http://127.0.0.1:5175/test/browser/workerVr.html` | Development route requiring PC server and USB reverse; isolated AMY_SCN1 mission; not the APK's bundled frontend |
| Autonomous worker fixtures | `/test/browser/questHarness.html` via `tools/quest-test.mjs` | Offscreen correctness/CPU experiments; not XR display benchmarks |

The worker is not enabled in normal gameplay. No APK installation is necessary
to iterate the development route. Keep the normal route as a fallback.
Native launch activity: `quest.mech2.BootstrapActivity`; embedded activity:
`com.igalia.wolvic.VRBrowserActivity`. Do not uninstall or clear application data
to refresh frontend code; that risks losing the app profile. Preserve the private
signing key for compatible APK updates.

Local handoff inspection found an authorized USB device, reverse port 5175,
native CDP forwarded to port 9223, and an HTTP 200 from the worker test page.
Both native and Quest Browser debug sockets existed. These observations are
transient; they do not prove current XR visibility or advancing display frames.
Recheck before every measurement. The saved five-minute run below is historical,
not evidence that logging is still running.

## Feature parity checklist

| Feature | Full game | Visible worker route |
| --- | --- | --- |
| Current XR head pose / stereo | Present | Present; original shell and sky |
| Simulation and accepted stick/weapon mapping | Present | 20 Hz worker; existing PadMapper and scancodes |
| Mech camera interpolation | Present | XrRig interpolation; world objects are not all interpolated |
| 2D HUD planes and cockpit FPS display | Present | Present; reticle/marker use fixed 300 m depth |
| Custom cockpit instruments, 3D HUD inset views | Present | Missing |
| Brown faceted grip gloves, whole-hand contact, OVR and radar touch | Present | Missing |
| Sound effects, music and menu click | Present | Missing |
| Mission menu and end/restart | Present | Simplified menu; restart button preserves XR session |
| Right-pointer front end, virtual keyboard, career/save handoff | Present | Missing; scratch mission only |
| Comfort behavior | Eject/death animation default OFF | Forced end spin skipped; no persisted campaign result |
| Maps / enhancement resources / shadow maps in snapshot contract | Existing gameplay paths | Unsupported; do not silently accept them |

Prototype menu: Y opens, left stick navigates, A/right trigger confirms, B/Y
backs out. At mission end, use the restart panel's right-ray trigger or A after
releasing held controls. The neutral gate prevents held fire from auto-restarting.
Restart creates fresh worker/epoch/mailbox/scene resources without XR exit/re-entry.

## Architecture and invariants

| Code | Responsibility |
| --- | --- |
| `src/app/missionWorker.ts` | Scratch mission, 40 warm-up passes, 20 Hz simulation and 182 Hz timer accounting; no WebGL, WebAudio or player saves |
| `src/engine/simulationPacer.ts` | Bounded catch-up; avoid runaway catch-up loops |
| `src/engine/snapshotMailbox.ts` | Three transferable 16 MiB slots, latest-state delivery, epoch/sequence checks; skip capture/publication if no slot is free |
| `src/app/workerControls.ts` | One outstanding control message, coalesced sticks, up to 64 ordered key edges; worker releases input after 500 ms without heartbeat |
| `src/render/snapshot/referencePacket.ts` / `referenceScene.ts` | Full/resource snapshot correctness reference and initial owned resources |
| `src/render/snapshot/worldState.ts` | Persistent consumer scene, object identity and resource lifetime; prepare from current camera |
| `src/render/snapshot/compactWorld.ts` | One-time basis, binary numeric state, versioned mesh/texture updates and four owned HUD planes; no per-frame JSON/ObjectLoader |
| `src/render/SceneRenderer.ts` | Existing rendering and explicit cache eviction for removed world/cockpit objects |
| `test/browser/workerVr.ts` / `workerVrEndPanel.ts` | Visible experiment and restart input gate |
| `src/app/gameScreen.ts` | Complete main-thread gameplay/presentation path; parity reference |
| `src/app/questPerf.ts` / `questGraphics.ts` | Timing/resolution telemetry and runtime-specific graphics guards |

Worker memory is not read live by the presenter. Consumer arrays must remain
valid after transport buffers are recycled. Every publication must tolerate
earlier publications being dropped: changed definitions repeat inline; a
consumer decodes a revision only once. Never recycle an object's retired
revision. Recreate endpoints and basis on mission epoch changes. Texture sampler
changes require a new basis and currently fail explicitly. Do not mix full
`WorldStateRenderer.apply` and compact adoption on one consumer.

Capture still traverses the world and compares vertex/texture data to discover
changes; this is not a mutation-hook-based incremental export. The presenter
still prepares and submits the scene every XR callback. Worker scheduling uses
a separate JS execution thread, but does not reserve or pin a physical CPU core.
Published scene state is decoupled from headset pose; a new simulation state is
not required to draw a new view.

## Measurements and their limits

Private artifacts are outside Git. On the original workstation the repository
is `outputs/MECH2JS-Quest` inside the workspace; private reports are in the
workspace's `outputs` directory (`../../outputs` from this repository), and
helpers/data are in `../../work`. These files are not supplied by cloning Git.

### Visible native-runtime repeat at nominal 125%

Source: `quest-worker-vr-125-restart-20261002.jsonl`, 60 samples at five-second
intervals, **07:14:56–07:19:52 UTC** (09:14–09:19 Europe/Berlin). Three mission
epochs, two restarts, XR session-entry counter remained one. The third epoch
contains only about 16 seconds of startup and is not a sustained result.

Both longer epochs used **1680 × 1760 per eye**, requested scale 1.25, FFR 1,
DRS unavailable/full viewport. They included user play and observed projectiles.

| Metric | First longer epoch | Second longer epoch |
| --- | ---: | ---: |
| Visible mission average callbacks/s at last sample | 88.13 | 88.93 |
| Last retained 4,320-interval window callbacks/s | 88.89 | 89.87 |
| Presenter CPU mean / p95 / p99, ms | 3.75 / 8.70 / 10.10 | 3.04 / 7.00 / 8.10 |
| XR callback interval p99 / max in last window, ms | 22.18 / 23.61 | 12.29 / 22.34 |
| Late intervals in last window (>1.5 frame budgets) | 56/4,320 (1.30%) | 6/4,320 (0.14%) |

Earlier saved windows included maxima of 156.42 ms and 58.14 ms respectively;
startup must be separated from steady state. No logger errors were recorded in
this file. That is not proof that the native ANR is fixed or that every frame was
displayed. Five-second projectile samples cannot establish a causal relationship
between combat and individual missed frames.

`QuestPerf` retains 4,320 rolling intervals; mission average is a separate
time-weighted value. Successive log rows overlap. **Do not sum their late counts
or average their percentiles.** Host `simCpuMs: 0` on this route means simulation
is off-thread, not free. Presenter CPU excludes asynchronous GPU execution and
does not account for all runtime/compositor work. Neither short “90” readings nor
mean CPU time demonstrate an available graphics budget within 11.11 ms.

### Isolated transport and correctness evidence

`quest-native-reference-worker-current-20261002.json` versus
`quest-native-compact-worker-final-20261002.json`: same six-second test protocol,
not identical recorded simulation states. Reference → compact mean CPU costs:
capture 7.16 → 9.46 ms, encode 18.33 → 5.61 ms, presenter decode/adopt
43.66 → 2.54 ms. This demonstrates codec progress only.

`quest-native-compact-combat-20261002.json`: 20 seconds, 391 states adopted,
actual player projectiles, 54 offscreen draws during an injected 600 ms worker
stall. Adoption mean/p95/max 2.49/3.20/9.60 ms. Offscreen target: 320 × 240.

`quest-native-compact-images-final-20261002.json`: 378 comparisons at 640 × 480
with zero pixel differences across the tested states/views. This validates the
captured subset, not missing full-game features or all missions.

Prior code validation covered focused unit suites for snapshot ownership,
mailbox, control delivery, resources and restart gating, TypeScript app/node
checks and scoped ESLint. It was not a claim that every repository test passed.
This handoff itself changes documentation only.

### Resolution and GPU caveats

The native full game also recorded 1680 × 1760 eyes at 125%
(`quest-native-final-smoke.json`), but its short startup sample is not a fair
performance baseline. Quest Browser previously recorded 2100 × 2200 at 125%
and 2520 × 2640 at 150%. Same percentage across runtimes does not imply same
pixels; record actual eye viewports and framebuffer dimensions.

Pinned Wolvic Chromium 1.4 exposes viewport APIs but renders reduced eye
rectangles incorrectly. Keep the `questGraphics.ts` DRS exclusion. A stored
ON preference does not mean DRS is active. Its frame-rate APIs are unavailable;
90 Hz is a target, and callback rate is distinct from verified compositor refresh.
No GPU frame times were captured for this visible worker repeat. Historical
GPU surface traces are not total GPU/compositor frame timings.

## Known failures and unfinished diagnosis

- **Native ANR:** Android recorded a 5,000 ms input-dispatch timeout involving
  `TouchModeEvent` in the earlier end/reload test. Root cause remains unproven.
  Disabling Vite HMR and using in-session restart are mitigations, not a fix claim.
  See private `quest-visible-worker-anr-logcat-20261002.txt` and
  `quest-visible-worker-lastanr-20261002.txt`. CDP responsiveness alone does not
  prove the native UI is responsive.
- **Instrumentation:** `stateAgeMs` can be negative because predicted XR time
  and `performance.now()` are mixed. Correct the clock definition before using
  it as transport latency. Current summaries do not retain enough per-frame
  stage correlation to explain every missed deadline.
- **Historical geometry growth:** counts of 11,297–15,605 versus 73–74 after a
  restart motivated a leak hypothesis. Specific cache-retirement behavior has
  tests; the old count difference itself is not proof of a leak or a fully
  explained incident. Reproduce matched lifecycle/workload counts before
  attributing it to leaked resources.
- **Long combat freezes:** earlier full-game freezes and FPS collapses require
  distinguishing simulation, renderer, native runtime and lifecycle failures.
  The limited worker run does not close those reports.
- **Snow terrain:** the user's suspected missing ground was not established
  against a matching original-game scene; retain as a visual comparison item.

## Next work and acceptance criteria

1. **Make missed frames diagnosable.** Record bounded per-frame timings for
   adoption, HUD update, world preparation, submission and interval gaps, plus
   worker sequence/age, GC evidence where available and native/GPU information.
   Use a consistent clock. Label CPU, GPU surface and compositor evidence
   separately. Preserve raw non-overlapping samples and identify warm-up.
2. **Restore feature parity before claiming a win.** Integrate owned audio events,
   HUD inset scene data, custom cockpit/screens, gloves/touch and gameplay
   lifecycle under an experimental selection path; preserve normal fallback.
   Test controls, death/abort/restart, visibility changes and resource retirement.
   No automatic mission relaunch, missing restart control or native ANR is an
   acceptable steady-state result.
3. **Run a fair comparison.** Same runtime, mission, mech, actual eye buffers,
   FFR/DRS state, cockpit/HUD/audio/features, input/workload and warm-up; log
   thermal state and repeat runs. Compare missed-frame distribution and worst
   intervals as well as averages. Use sustained combat and lifecycle repeats.
   Do not combine synthetic offscreen throughput with XR FPS. Keep the worker
   design only if the complete workload demonstrates a worthwhile benefit.
4. **Then evaluate added graphics budget.** No new lighting/style work until
   the complete pipeline and its bottleneck are measured. Avoid microbenchmark
   wins that do not change user-visible pacing.

### Candidate: cockpit occlusion, not yet implemented or measured

The user's larger custom cockpits conceal more landscape. Current draw order
does not deliberately exploit that: `src/app/gameScreen.ts` draws backdrop/world,
then clears depth and draws the original shell, then custom cockpit/screens.
`WorldStateRenderer.render` likewise draws world before clearing depth for the
shell. Covered landscape has already been submitted; simply adding a larger
cockpit is not evidence of reduced world rendering cost.

An opaque cockpit depth/stencil mask **before** the world pass could allow hidden
landscape fragments to be rejected. Any experiment must preserve that mask
through the relevant clears, use the current pose separately for each eye, and
exclude glass/openings/transparent surfaces. Check HUD, hands, near clipping and
leaning around cockpit edges against the reference view. Geometry preparation,
simulation and draw submission are not automatically eliminated by a pixel mask.
An extra mask pass also costs CPU/GPU work; compare net GPU time and missed
frames on the same full scene. Weak DRS response in valid scaling tests makes
pure pixel cost a less compelling sole explanation; native disabled DRS is not
a scaling experiment at all. No percentage gain is predicted.

## Reproduce safely

From the repository root, with dependencies installed and private `.env.local`
setting `MW2_ROOT`, run this server in its own terminal:

```powershell
node node_modules/vite/bin/vite.js --config tools/vite-worker-vr.config.ts --host 127.0.0.1 --port 5175 --strictPort
```

This config disables HMR and filesystem watching. Changes need an explicit safe
server/page restart; do not let code edits reload an active XR session.

Read-only device inspection and forwarding (replace the serial):

```powershell
$adb = 'C:/Android/Sdk/platform-tools/adb.exe'
$questSerial = 'YOUR_QUEST_SERIAL'
& $adb devices -l
& $adb -s $questSerial shell cat /proc/net/unix
& $adb -s $questSerial reverse --list
& $adb -s $questSerial forward --list
& $adb -s $questSerial reverse tcp:5175 tcp:5175
& $adb -s $questSerial forward tcp:9223 localabstract:content_shell_devtools_remote
Invoke-RestMethod http://127.0.0.1:9223/json/list
```

If the app is stopped, launch it explicitly using
`adb -s YOUR_QUEST_SERIAL shell am start -n io.github.sputnikkaputtnik.mech2quest/quest.mech2.BootstrapActivity`.
An absent socket is not by itself evidence of a crash. Inspect the current page
before navigation; save evidence and do not replace an active user mission.
For the embedded runtime, navigate the existing page via CDP `Page.navigate`.
**Never use `Target.createTarget`: it has crashed this pinned runtime.**

For the visible route choose Start in VR after preparation, then confirm that
`window.mw2WorkerVr.snapshot()` reports visible XR and that both sequence and
frame counters advance in successive readings. A proximity override can make
the headset report worn; it cannot confirm what a human sees or grant VR consent.
Initial VR permission may still need the user.

Autonomous correctness tests require the native page to be idle at Start in VR:

```powershell
$env:QUEST_CDP_SOCKET = 'content_shell_devtools_remote'
$env:ANDROID_SERIAL = $questSerial
node tools/quest-test.mjs ../../outputs/handoff-compact-images.json --compact-snapshot
# Wait for the restored idle page to finish loading before the next fixture.
node tools/quest-test.mjs ../../outputs/handoff-compact-combat.json --compact-combat
```

Use fresh output names to preserve evidence. Fixtures restore the prior idle
page in cleanup and refuse to replace an active mission. `--continuous-worker`
is the reference transport; `--compact-worker` is its short compact equivalent.
Other modes: `--snapshot`, `--head-snapshot`, `--resource-snapshot`.

Local, untracked helpers available on the original workstation, from repo root:

```powershell
node ../../work/native-cdp.mjs 'window.mw2WorkerVr.snapshot()'
node ../../work/log-worker-vr-repeat.mjs ../../outputs/fresh-worker-run.jsonl
```

The logger records 60 samples five seconds apart, stops on page replacement or
three consecutive connection errors, and requires a new output file. It does
not record every frame. `native-cdp.mjs` selects the native origin preferentially;
inspect `/json/list` and set its `MW2_TAB_ID` if multiple pages exist. Its `new`
mode must not be used with Wolvic. Screenshot requests during XR have hung the
helper; a stalled capture request alone does not establish an app crash.

Visible API: `snapshot()` reads; `enter()`/`leave()` change XR state;
`restart()` replaces the mission; `endTest()` ends it; `stall(600)` deliberately
blocks the worker. Use destructive/lifecycle/fault-injection calls only in a
controlled test, never silently while the user is playing. Returning to normal
gameplay means navigating the existing page to `http://127.0.0.1:19895/?native=1`
after ending the test; no reinstall is necessary.

Stay-on/proximity settings and prior values are saved privately in
`work/quest-awake-state.json` at workspace level. The previous stay-on value was
0; temporary value was 15. When unattended testing is finished, restoration is:

```powershell
& $adb -s $questSerial shell svc power stayon false
& $adb -s $questSerial shell am broadcast -a com.oculus.vrpowermanager.automation_disable
```

Do not change these settings merely to prepare documentation. Capture private
logcat/ANR evidence before a necessary recovery force-stop. Do not clear saves,
game data or the runtime profile. Disable any detailed GPU tracing when its
measurement ends; do not leave it affecting ordinary play.

## Private evidence index

All names below refer to workspace `outputs`, not files committed to this repo.
Keep game files, saves, device logs, signing keys and reports private.

| Artifact | Use / limitation |
| --- | --- |
| `quest-worker-vr-125-restart-20261002.jsonl` | Latest five-minute visible repeat described above |
| `quest-visible-worker-vr-first-20261002.json`, `quest-visible-worker-vr-session-20261002.json` | Earlier visible run; no observed player projectiles, incomplete feature set |
| `quest-native-reference-worker-current-20261002.json`, `quest-native-compact-worker-final-20261002.json` | Codec comparison, not full-game before/after |
| `quest-native-compact-combat-20261002.json`, `quest-native-compact-images-final-20261002.json` | Controlled offscreen combat/stall and sampled pixel correctness |
| `quest-visible-worker-anr-logcat-20261002.txt`, `quest-visible-worker-lastanr-20261002.txt` | Native ANR evidence; root cause open |
| `quest-native-final-smoke.json` | Old native full-eye resolution observation; short startup sample |
| `quest-native-first-mission.json` | Earlier incorrect reduced-eye stereo; unsuitable performance baseline |
| `quest-render-lighting-awake.cpuprofile`, `quest-render-baseline.cpuprofile`, `quest-render-combined-optimizations.cpuprofile` | Historical CPU profiles; check build/runtime/workload before comparison |
| `quest-gpu-lighting-awake.txt`, `quest-gpu-lighting-awake-summary.json`, `quest-gpu-trace-90hz.txt`, `quest-gpu-summary-90hz.json` | Historical GPU traces/summaries; surface timing is not complete frame timing |

Private workstation `work` also contains `candidate-dos`, native staged data,
runtime packaging/signing artifacts, save-migration helpers and profiling tools.
Follow the Android README and the actual build report for packaging paths; do
not assume this workstation's tools or secrets exist in a fresh checkout.
