# Remaining XR callback gaps — 2026-10-03

The geometry-reuse change reduces measured host work, but the complete 90 Hz
fixture still delivers about 87.5 XR callbacks/s. This diagnostic investigates
where the remaining gaps occur. It does not change production code or the APK,
and it does not establish a new FPS baseline.

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
