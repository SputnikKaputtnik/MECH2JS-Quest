# Remaining XR callback gaps — 2026-10-03

The geometry-reuse change reduces measured host work, but the complete 90 Hz
fixture still delivers about 87.5 XR callbacks/s. This diagnostic investigates
where the remaining gaps occur. The diagnostic captures do not establish a
new FPS baseline. The subsequent [FPS canvas upload fix](quest-fps-texture.md)
has separate uninstrumented comparisons; the APK is unchanged.

## Existing traces

The completed 180-second reference/reuse traces were analyzed without running
the headset again. Warm-up exclusion and the >16.667 ms callback-entry gap
threshold are unchanged. Associate each gap with the preceding recorded frame
and its deferred simulation events, rather than with the work of the callback
that eventually arrived.

| Preceding work | Reference | Reuse |
| --- | ---: | ---: |
| Gaps after a deferred simulation pass | 56 / 3,000 (1.87%) | 47 / 3,000 (1.57%) |
| Gaps without a preceding deferred pass | 335 / 10,107 (3.31%) | 326 / 10,137 (3.22%) |
| Gaps after a render consuming a new state | 169 / 3,000 (5.63%) | 136 / 3,000 (4.53%) |
| Gaps after a render reusing state | 222 / 10,107 (2.20%) | 237 / 10,137 (2.34%) |

The simulation-pass and render-state categories are different partitions;
their rows must not all be added together. A newly consumed state carries more
render work, and gaps are more frequent after it. However, gaps also occur
without a new state, and most do not immediately follow a simulation pass.
This is association, not causal attribution or proof of spare GPU capacity.

## Correlated Chromium timeline

A separate 30-second diagnostic used the same full native-runtime fixture,
requested 90 Hz, 1680 x 1760 eye buffers, automatic combat and enabled geometry
reuse. Both inset views, running audio, FFR 1 and disabled DRS were verified
before and after. All 2,620 recorded game frames were XR-visible, with no raw
trace overflow. The headset was centered and stationary; only endpoint pose
samples were taken in this diagnostic, not continuous pose verification.

CDP tracing recorded `devtools.timeline`, `v8`, `blink.user_timing`, `gpu`,
`cc`, `benchmark` and `disabled-by-default-devtools.timeline`. A named
`performance.mark` aligned Chromium microsecond timestamps with the raw game's
`performance.now` clock using the mark's recorded `startTime`. Chromium reported
no trace data loss. No recurring raw-log reads or image readbacks ran during
the capture; all game events were read once at its end.

Tracing has overhead. The final evaluation/readback took roughly 110 ms and
is **excluded**: analysis ends at the last recorded game-frame entry. This is
not a comparable FPS measurement or a claim that the normal app has a 110 ms
stall. Renderer-main `RunTask` spans were unioned to avoid double-counting
nested tracing events.

Results inside the game-frame window:

- 78 of 2,619 consecutive callback-entry intervals exceeded 16.667 ms.
- 74 of those 78 intervals contained more than 8 ms outside recorded
  renderer-main `RunTask` spans. Mean uncovered time was 13.13 ms.
- Only six late intervals overlapped a main-thread minor/major GC event;
  three overlapped more than 1 ms of GC. One major GC lasted 12.71 ms and
  overlapped the longest, 28.5 ms callback interval. It explains part of that
  outlier, not the bulk of this capture's gaps.
- 2,618 game-frame entries matched a preceding main-thread
  `OnImmersiveFrameData` handler within 5 ms. Of 77 late intervals with
  consecutive matched entries, all 77 were already late between those
  receipt handlers. Receipt-to-game-entry delay averaged 0.63 ms for these
  late entries, with a maximum of 1.01 ms.
- CPU-side `XRFrameProvider::SubmitFrame` spans averaged 0.44 ms (p99
  0.80 ms, maximum 1.03 ms). These do not measure asynchronous GPU execution
  or presentation completion.

## Interpretation and next boundary to instrument

The late callback's own game-rendering work starts after most of the observed
delay has already happened. The recorded application work and GC do not fill
most of these gaps. That makes frame delivery and scheduling a more useful
next boundary than assuming another reduction of average simulation cost will
automatically stabilize 90 Hz.

`OnImmersiveFrameData` itself runs on the renderer main thread: this capture
cannot distinguish late upstream frame delivery from a queued receipt handler,
nor prove that uncovered time means CPU idle. GPU-process events are CPU-side
driver/scheduling work, not device GPU durations. GPU fences, runtime pacing,
OS scheduling and compositor deadlines remain unresolved. Do not call this
proof of a Wolvic-specific fault; the earlier matched runtime-host comparison
still applies.

A next focused diagnostic should connect the runtime's frame request/delivery
and submission/fence completion to actual compositor deadlines, with system
scheduler coverage if available. Avoid speculative game-loop changes based
only on average CPU cost. The worker remains frozen.

Private evidence outside Git:

- `quest-geometry-gap-analysis-20261003.json` and its existing 90 Hz raw inputs.
- `quest-runtime-timeline-20261003.trace.json` (Chromium timeline, about 93 MB).
- `quest-runtime-timeline-20261003.json` (clock anchor, raw game events, endpoints).
- `quest-runtime-timeline-20261003-analysis.json` (correlation and coverage).
- `work/analyze-frame-gaps.mjs`, `work/trace-runtime-timeline.mjs` and
  `work/analyze-runtime-timeline.mjs` reproduce this diagnostic's private work.

The normal bundled app was restored at 72 Hz after capture. Chromium tracing
ended, no `ovrgpuprofiler` process remained, and no APK was installed.

## System scheduler follow-up

Following the user's instruction to continue, a combined Android Perfetto
capture added `sched_switch`, `sched_waking`, CPU frequency/idle events and
Chromium track events to one clock domain. No APK change was needed. Analysis
uses the scheduler's `thread_state` intervals, following the
[Perfetto scheduling-table documentation](https://perfetto.dev/docs/analysis/perfetto-sql-getting-started).
This distinguishes actually running, runnable but waiting for a CPU, and
interruptible sleep; it still does not identify what an interruptible sleeper
is waiting for.

The first 40-second system trace overwrote 38.1 MB in its 64 MiB ring buffer
and lost incremental metadata. It is retained privately as a failed diagnostic,
not used for per-frame claims. The corrected capture used a 128 MiB buffer,
streaming writes every second and renewed incremental state every five seconds.
It retained the Chromium events and reported no data loss. Trace Processor
v58.2 does report `config_write_into_file_no_flush`: lack of a periodic flush
setting increases the memory required to load this trace, not lost events.
Future configs should add `flush_period_ms`; this does not justify another run
of an otherwise complete diagnostic.

The corrected run used the same AMY_SCN1 fixture, active 11.111111 ms display
period, 1680 x 1760 eye buffers, geometry reuse on, both insets, audio, FFR 1,
DRS off and automatic combat. Its 30-second raw game window contains 2,582
visible frames with no overflow. Before/after snapshots verify the settings;
there are no continuous pose samples. This is a tracing diagnostic with
overhead, not a replacement for the earlier performance comparison.

The `mw2-system-start` mark aligns raw frame entries to Perfetto timestamps.
The independent end mark differs by 0.042 ms from that mapping. Analysis uses
the first through last game-frame entry, excluding final evaluation/readback.
For each gap longer than 16.667 ms, intersect scheduler states with the entire
interval from the preceding game callback entry to the delayed one. All 114
such gaps have complete state coverage (sum agrees with interval length to
the CSV output precision).

| Renderer-main state during each long interval | Mean |
| --- | ---: |
| Running on a CPU | 7.27 ms |
| Runnable, waiting for CPU (`R` plus `R+`) | 0.45 ms |
| Interruptible sleep (`S`) | 13.12 ms |

Only four of the 114 gaps accumulated over 1 ms runnable time; 112 accumulated
over 8 ms interruptible sleep. Thus scheduler starvation of the JavaScript
renderer is not the dominant explanation in this capture. Across the full
29.993-second analyzed window, that thread ran for 17.018 seconds, waited
runnable for 0.905 seconds and slept for 12.070 seconds. This is one thread's
scheduling, not whole-SoC utilization or GPU headroom.

All 114 delayed entries also match a completed `RequestImmersiveFrame` async
span within 3 ms. Its lifetime averaged 20.55 ms for these entries versus
10.94 ms for 2,466 matched ordinary entries. From the span's end to our game
callback averaged 0.63 ms versus 0.61 ms. These request lifetimes include
asynchronous waiting and normal frame pacing; they are not CPU execution time.
The result narrows the issue to the pending-frame path but does not prove
whether earlier application work missed a submission deadline, the GPU/fence
path held up the next frame, or the runtime paced delivery differently.

The native `GPU completion` thread also exposes 3,433 `waitForever` spans
across the full system trace, averaging 4.15 ms with maximum 6.34 ms. They are
CPU-side fence waits. Do not relabel them GPU render times, GPU utilization or
compositor FPS, and do not assume they caused the 114 callback gaps. Explicit
frame/fence/deadline correlation is still missing. The native `VRB Render`
thread is distinct from Chromium's `WvrThread`; do not treat their names as
interchangeable in further analysis.

Private evidence and reproducibility:

- `quest-system-timeline-clean-20261003.pftrace` (122.5 MB) and corresponding
  `.json`, `-scheduler.sql`, `-scheduler.csv`, `-scheduler-analysis.json`, and
  `-thread-totals.csv`.
- `quest-system-request-spans-20261003.csv` and
  `quest-system-request-analysis-20261003.json`.
- `work/quest-scheduler.pbtxt`, `work/record-system-timeline.mjs`,
  `work/analyze-system-scheduler.mjs`, and `work/analyze-request-spans.mjs`.
- `quest-system-timeline-20261003.pftrace` is the rejected ring-buffer run.

The official Windows Trace Processor binary is kept privately in `work`;
its SHA-256 was verified against the official v58.2 wrapper manifest before
execution. No traces were uploaded. The bundled app was restored at 72 Hz;
`perfetto --query` confirmed zero active tracing sessions. The absence-window
automation remains paused; this follow-up was explicitly requested in chat.

## Submit-to-buffer chain, analyzed offline

A further user-requested investigation reused the complete system capture; no
new headset run was needed. Between every pair of consecutive game callback
entries there is exactly one of each selected event: renderer
`XRFrameProvider::SubmitFrame`, Chromium `WvrThread`'s
`NativeViewGLSurfaceEGL:RealSwapBuffers`, the numbered native GPU-completion
wait, `VRB Render`'s `acquireBuffer`, and `OnImmersiveFrameData`.
All 2,581 intervals match this temporal association, comprising 114 long
intervals and 2,467 ordinary intervals. This is not a shared frame/fence ID;
the events must not be presented as a proven causal chain.

| Mean wall-clock interval | Ordinary | Long (>16.667 ms) |
| --- | ---: | ---: |
| Game callback entry to next entry | 11.19 ms | 20.84 ms |
| Entry to `SubmitFrame` start | 4.41 ms | 5.47 ms |
| `SubmitFrame` CPU-side span | 0.47 ms | 0.51 ms |
| Submit end to `RealSwapBuffers` start | 2.14 ms | 6.46 ms |
| Swap start to native `acquireBuffer` start | 3.30 ms | 7.54 ms |
| Acquire start to WebXR receipt handler | 0.28 ms | 0.24 ms |
| Receipt handler to next game entry | 0.60 ms | 0.63 ms |

The extra time is concentrated before the buffer swap and before native buffer
acquisition. These are host/runtime event boundaries, not actual display
presentation timestamps. Applying the same scheduler-state intersection to
these smaller windows gives complete coverage for all four relevant threads:

| State inside submit-end → swap-start window | Ordinary | Long |
| --- | ---: | ---: |
| `CrGpuMain` running on CPU | 1.48 ms | 3.01 ms |
| `CrGpuMain` interruptible sleep | 0.58 ms | 3.29 ms |
| `WvrThread` interruptible sleep | 1.63 ms | 5.88 ms |
| `VRB Render` interruptible sleep | 2.14 ms | 6.46 ms |

During the subsequent swap-start → acquire-start window, `VRB Render` sleeps
2.81 ms ordinarily and 7.10 ms in long intervals; its CPU execution is 0.46
and 0.42 ms respectively. `CrGpuMain` executes less than 0.004 ms on average
in either group during this later window. That does not mean the GPU hardware
is idle: CPU-side command execution and GPU execution are different stages.

The observed GPU-completion wait itself averages **4.28 ms ordinarily but
1.38 ms for long intervals**. This cannot be interpreted as less GPU work in
the long frames: the waiter starts later in the pipeline and measures only
the remaining wait. Moreover, native acquisition starts before that wait
ends in 2,012 ordinary intervals and three long intervals. The wait is
therefore not a universal gate on native acquisition, and its duration must
not simply be added to the non-overlapping wall-clock intervals above.

The evidence prioritizes command/synchronization dependencies between
WebXR submission and Chromium's buffer swap, followed by native frame pacing.
It does not establish which dependency is responsible, nor prove a fix in
the renderer, Wolvic or OpenXR. The SyncToken links available in this capture
are analyzed below; exact preceding commands and OpenXR wait/submit deadlines
remain unresolved. More
changes to average simulation cost alone are not justified by these gaps.

The local Wolvic source has a one-frame-ahead path in `BrowserWorld::TickImmersive`:
it waits for the browser frame result, calls the device's `StartFrame`, pushes
the next poses and later draws/submits. Its OpenXR implementation calls
`xrWaitFrame` and `xrBeginFrame` in `StartFrame`. This is context for selecting
instrumentation points, not proof of the exact call duration or installed
binary behavior; these OpenXR calls were not directly traced here.

Additional private files are `quest-native-frame-chain-20261003.csv`,
`quest-native-frame-chain-{rows,analysis}-20261003.json`,
`quest-native-chain-thread-states-20261003.csv`, and
`quest-native-chain-state-analysis-20261003.json`. Reproduce with
`work/analyze-native-frame-chain.mjs` and `work/analyze-chain-states.mjs`.
Normal app state remains 72 Hz, zero Perfetto sessions, detailed GPU profiling
disabled. No code, game setting, or APK changed during this offline follow-up.

### Explicit SyncToken flow links

The same Perfetto trace also contains explicit `flow` links from
`SyncToken::Wait` on `Chrome_ChildIOThread` to `SyncToken::Release` on
`CrGpuMain`. Unlike the temporal event-chain association above, these links
identify related synchronization events. Their assignment to a game frame
still uses the surrounding submit-end → swap-start window.

Exactly one linked pair fits inside 113 of the 114 long windows and 2,455 of
the 2,467 ordinary windows. Thirteen unmatched windows are excluded rather
than guessed to have zero waiting time. Each matched window decomposes into:

| Mean duration in matched windows | Ordinary | Long |
| --- | ---: | ---: |
| Submit end → token wait registration | 0.31 ms | 0.30 ms |
| Token wait registration → linked release | 1.11 ms | 5.35 ms |
| Linked release → buffer swap start | 0.72 ms | 0.81 ms |
| Total submit-end → swap-start | 2.14 ms | 6.46 ms |

The extra 4.24 ms in the token lifetime accounts for nearly all of the 4.32 ms
extra submit-to-swap latency in these matched groups. This locates a concrete
synchronization boundary, not merely an unexplained JavaScript sleep. The
wait/release events themselves are short CPU events; subtracting their start
timestamps measures the dependency's pending lifetime, not time spent running
a blocking function or hardware GPU execution.

It does **not** yet identify the producer commands delaying release, nor make
the SyncToken unnecessary. Do not bypass synchronization as an optimization.
The next useful investigation is the command-buffer work/dependencies that
precede this release, alongside native OpenXR pacing after buffer swap. The
native `GPU completion` fence-wait spans are a separate measurement and must
not be confused with these Chromium SyncToken flow links.

Private evidence: `quest-synctoken-pairs-20261003.csv`,
`quest-synctoken-analysis-20261003.json`, and the reproducing helper
`work/analyze-synctoken-pairs.mjs`.

### Producer task behind the linked release

Following each matched release's ancestors in the same clean trace locates
the game renderer's `GPUTask`, through `WebGL` → `CommandBuffer::Flush` →
`CommandBufferStub::OnAsyncFlush` → `CommandBufferService:PutChanged`.
All 2,568 matched tasks belong to the same game renderer process. This is
command-buffer processing in Chromium's GPU **process**, not GPU hardware time.

| Mean wall-clock duration/state | Ordinary (2,455) | Long (113) |
| --- | ---: | ---: |
| Entire producer task | 1.49 ms | 5.00 ms |
| Pending token time before task begins | 0.02 ms | 0.46 ms |
| Pending token time inside task | 1.09 ms | 4.90 ms |
| Producer thread running during entire task | 1.24 ms | 2.00 ms |
| Producer thread runnable during entire task | 0.057 ms | 0.106 ms |
| Producer thread sleeping during entire task | 0.19 ms | 2.89 ms |

Scheduler coverage spans every matched task. Most of the added producer
wall-clock time is sleep while processing WebGL commands. It is not simply
a long wait for Chromium to schedule the task, nor a pure JavaScript cost.
Driver/command dependencies remain candidates; the exact call is not proven
by this capture. Private evidence: `quest-token-producer-20261003.csv`,
`quest-token-producer-{rows,analysis}-20261003.json`,
`quest-producer-state-analysis-20261003.json`; helpers
`work/analyze-token-producer.mjs` and `work/analyze-producer-states.mjs`.

### Command-level diagnostic and page-mirror hypothesis

A separate 18-second system capture enables `disabled-by-default-gpu.decoder`
and `disabled-by-default-gpu.service`; eight seconds include raw game events.
It contains 659 recorded game callbacks and no raw-event overflow. Its
command instrumentation adds overhead, so its callback rate is not compared
with the uninstrumented baseline. Perfetto reports one conflicting track
descriptor and no buffer-overrun/data-loss counter. Thread attribution for
merged command tracks is therefore not used as proof of a causal chain.

The service-side command spans include 88 `kCopySubTextureCHROMIUM` calls
averaging 4.45 ms, whereas 1,476 `kBlitFramebufferCHROMIUM` calls average
0.055 ms. The expensive copy is **not established as the game's mirror blit**.
These are CPU-side service spans, not device timer results: Chromium's
[GPU tracer source](https://raw.githubusercontent.com/chromium/chromium/main/gpu/command_buffer/service/gpu_tracer.cc)
records service begin/end separately from the `gpu.device` timer category.
That category was not enabled. Source inspection explains category semantics;
it does not assert exact source/binary equivalence for this installed runtime.

`GameScreen.mirrorEye()` copies the left eye onto the page's full drawing
buffer after every immersive frame. This is a concrete optional workload to
test, even though the trace does not prove it causes the delayed release.
The A/B test below uses the existing `mirror.on` switch, identical private
instrumentation in both conditions, and freshly restarted scratch missions.
No synchronization primitive is removed. Command trace:
`quest-decoder-timeline-20261003.{pftrace,json}`; private control helper:
`work/mirror-variant-control.js`.

Two 180-second full-game captures (first 30 seconds excluded) compared mirror
on → off at verified 90 Hz, 1,680 × 1,760 per eye, FFR 1, DRS off and the same
stationary automatic combat/instrument protocol. Actual mirror state was
recorded in every snapshot. Both retained audio and both cockpit inset views.
XR callbacks/s were **86.96 → 87.31**, combined callback/deferred host wall
time **5.50 → 5.45 ms**, and long entry intervals **464 → 413** in the retained
150 seconds. This small single-order difference does not establish a useful
pacing gain; the mirror remains enabled and there is no production change.
Private captures: `quest-mirror-{on,off}-90-20261003.jsonl` and matching
`*-summary.json` files. Restore the mirror before subsequent experiments.

The following [FPS counter canvas experiment](quest-fps-texture.md) removes
the expensive copy commands while retaining the mirror and counter. It
improves callback pacing in full-game comparisons, including a reversal to
the default canvas path. It does not eliminate all long intervals or prove
new hardware GPU budget.
