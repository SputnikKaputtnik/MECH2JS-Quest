# Scheduling after removing periodic collection overhead — 2026-10-03

The [collector correction](quest-recorder-overhead.md) changes the baseline
for deciding whether deferred simulation is worthwhile. The historical large
scheduling win predates geometry reuse, the FPS canvas fix and buffered
collection. It must not be carried forward as the expected gain today.

## Residual diagnostic

The existing post-fix 30-second system capture contains 2,159 visible game
callbacks and two long entry intervals. No new system tracing was required.
Both follow inline simulation passes:

| CPU-side timing from preceding callback entry | Gap 1 | Gap 2 |
| --- | ---: | ---: |
| Next callback entry | 28.00 ms | 28.50 ms |
| Game callback duration | 12.60 ms | 13.50 ms |
| Simulation portion | 6.60 ms | 5.80 ms |
| Chromium submit starts | 12.66 ms | 13.55 ms |
| Native buffer swap starts | 18.44 ms | 17.42 ms |
| Native buffer acquisition starts | 27.02 ms | 27.30 ms |
| WebXR frame receipt handler starts | 27.24 ms | 27.50 ms |

Scheduler accounting uses the exact renderer thread identified by the clock
anchor, not every thread named `CrRendererMain`. State coverage matches each
interval: running 13.60/13.72 ms, runnable 0.58/1.41 ms, sleeping 13.82/13.37 ms.
Thus a game callback shorter than the 13.889 ms display period is insufficient
to guarantee the next callback arrives on time. Submission and runtime work
remain after the game callback. The recorded GPU-completion waits overlap
other stages and are not hardware GPU execution durations.

Only two traced examples support this account; it is not an attribution of
all residual gaps. Event chains are temporally associated, without a shared
frame identifier. Tracing adds overhead, so this is not a pacing baseline.

## Buffered full-game comparison

The follow-up uses fresh AMY_SCN1 scratch missions in the same embedded runtime,
72 Hz verified while XR is visible, actual 1,680 × 1,760 eyes, FFR 1, DRS off,
inline or after-render simulation at 20 Hz, full custom cockpit, HUD, FPS
counter, mirror, audio and two instrument views. Automatic stationary combat
and invulnerability are enabled. No pilot saves are loaded or changed.

Each capture is 180 seconds; exclude its first 30 seconds. Raw events are
buffered and read once after capture, with no periodic CDP snapshots, GPU
profiling or file transfers during the run. Endpoint checks do not establish
continuous settings, pose or audio state; raw visibility and callback timing
are retained. This is a repeated input protocol, not deterministic combat.

Pass delivery is additionally associated by simulation revision: measure from
simulation-pass completion to the end of the first callback consuming that
revision. This is **CPU-side state handoff**, not photons, compositor delivery
or end-to-end controller latency. Deferred work is included in total host wall
time instead of counted as free.

The trace starts after entering and centering each fresh mission, not at an
identical simulation tick. Exclusion of the first 30 capture seconds retains
combat in every case, but mission ages/projectile states are not identical.
Do not interpret small host-time differences as an isolated code speedup.

The new inline capture includes a 70.20 ms entry interval; its preceding
game callback lasts 13.10 ms, leaving 57.10 ms after callback completion.
Its cause is not identified by the raw trace. It remains included in the
results; the two older system-trace examples do not explain it.

### Results and decision

Run order was after-render, inline, after-render. Same installed runtime and
unchanged game source (`4973a69`); each variant starts a fresh page/XR session.
The Android thermal service reported status 0 between the first two runs and
after the repeat; this is not controlled temperature equilibration.

| Measurement over retained 150 seconds | After-render | Inline | After-render repeat |
| --- | ---: | ---: | ---: |
| XR callbacks/s, XR timestamp intervals | 71.986 | 71.892 | 71.965 |
| Callback-entry intervals >20.833 ms | 5 | 22 | 3 |
| Callback-entry interval p99 | 14.60 ms | 17.40 ms | 14.70 ms |
| Longest callback-entry interval | 25.00 ms | 70.20 ms | 67.80 ms |
| Callback host wall time, mean | 4.258 ms | 5.874 ms | 4.555 ms |
| Callback + associated deferred work, mean | 5.598 ms | 5.874 ms | 5.929 ms |
| Simulation pass duration, mean | 4.335 ms | 4.135 ms | 4.455 ms |
| Simulation-start interval p99 | 57.40 ms | 59.50 ms | 57.40 ms |
| Pass completion to consumer callback end, mean | 11.120 ms | 5.799 ms | 11.146 ms |

All three contain 3,000 simulation passes in the retained window (20 Hz),
each matched to a consuming render revision. Mean simulation-start cadence
is 50.00 ms. Intervals over 75 ms between simulation starts: 0, 1 and 1.
Each raw capture completes without dropped entries or hidden recorded frames;
endpoint mission identity/settings/eye buffers match. Audio is running at
both endpoints, both instrument targets are allocated at the end, and player
projectiles are present (5, 20 and 11). This is not identical per-tick combat.

Deferred scheduling consistently reduces p99 callback-entry variation and the
count of long gaps in these runs. **It does not establish compute savings**:
the repeat's total host wall cost is slightly higher than inline. New state
reaches the CPU-side consumer callback end about 5.3 ms later on average.
This is not a measurement of controller latency and needs human acceptance
before changing the default. Normal gameplay remains inline; the URL-only
experiment remains available. No game code, APK or saved settings change.

The deferred repeat's 67.80 ms entry gap follows a 4.60 ms reused-scene
callback and a 0.20 ms deferred no-pass task, leaving 62.30 ms after that task
until the next callback entry. The next callback's supplied XR timestamp
advances only 12.277 ms in this particular pair; host entry time and supplied
XR time are distinct. Neither explains the cause of this stall by itself.
Deferred scheduling therefore does **not** eliminate the rare large stalls.
Further diagnosis should target these outside-callback pauses, not assume
the simulation is responsible or repeat the resolved canvas/collector tests.
The two approximately 70 ms stalls occur 82.40 and 81.19 seconds after raw
capture begins (110.50 and 107.84 seconds into their page lifetimes). That
similar timing is a lead for a bounded runtime/GC trace, not proof of a
periodic task or garbage collection. Raw-buffer allocation remains a possible
measurement effect even without periodic reads; do not label these as
confirmed normal-game stalls before checking that distinction.
GPU/compositor budget and actual displayed FPS remain unmeasured.

The Quest was restored to the ordinary native start screen at 72 Hz. No
Perfetto sessions or detailed GPU profiling remain active. The automation
stays paused.

## Private evidence

Raw data and analysis helpers stay outside the repository:

- `quest-inline-72-post-fix-timeline-20261003.{json,pftrace}`, event CSV and
  `*-residual-chain.json`; `work/analyze-postfix-chain.py`.
- `quest-scheduling-buffered-*-72-20261003.jsonl`, generated summary and
  delivery JSON; `work/compare-buffered-scheduling.mjs` and
  `work/analyze-pass-delivery.mjs`.
