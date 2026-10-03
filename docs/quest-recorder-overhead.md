# Periodic log collection perturbs XR pacing — 2026-10-03

The periodic recorder itself accounts for much of the remaining long callback
intervals after the FPS canvas fix. This is a correction to how the earlier
instrumented results should be interpreted, **not another game optimization**.
The installed frontend is unchanged during the comparison.

## Evidence

The existing CPU-canvas/inline 72 Hz capture has 81 long callback-entry gaps.
Associating each gap with its **preceding** callback gives 30 after a simulation
pass and 51 after a reused-scene frame. Those reused-scene callbacks average
4.14 ms of host wall time, essentially the same as ordinary reused frames;
the mean subsequent wait until the next entry is 20.37 ms. None of the 81
preceding game callbacks individually exceeds the 13.889 ms period.
That does not prove spare GPU budget or that runtime deadlines were met.

A separate 30-second raw/system capture, without periodic CDP reads, has only
two long intervals among 2,159 recorded frames. It has no reported trace
import/data-loss errors. Its short length and tracing overhead make it a
diagnostic clue, not a performance baseline.

The recorder normally calls `mw2FullGameTest.snapshot()` every two seconds.
That calls `QuestPerf.snapshot()`, sorting up to 4,320 samples separately for
five statistics, then `trace.read()` scans/copies raw events. All this executes
on the headset's main JavaScript thread, outside the timed game callback.
The CDP result also needs serialization afterward.

For the controlled test, only collection mode changes. Same process/runtime,
fresh AMY_SCN1 scratch missions, inline 20 Hz simulation, verified 72 Hz display,
1,680 × 1,760 eyes, FFR 1, DRS off, page mirror, FPS counter, custom cockpit,
automatic stationary combat, audio and both instrument views remain enabled.
Each run lasts 180 seconds, with its first 30 seconds excluded. No detailed
profiling or device file transfers run during the comparisons.

| Collection | XR callbacks/s | Entry gaps >20.833 ms | Entry interval p99 | Game callback host wall time |
| --- | ---: | ---: | ---: | ---: |
| Buffered, read after capture | 71.95 | 10 | 17.00 ms | 5.84 ms |
| Periodic snapshots/raw reads every 2 s | 71.56 | 83 | 18.50 ms | 5.88 ms |
| Buffered repeat after periodic run | 71.94 | 16 | 17.30 ms | 5.91 ms |

In the periodic run, snapshot plus raw-read spans average **8.94 ms**, maximum
**15.10 ms**, excluding CDP return serialization. Of 83 long entry intervals,
**62 overlap an observed collection span**. Of 74 retained intervals containing
a collection, 62 are long (83.8%); only 21 of the other 10,660 intervals are
long (0.20%). This is temporal association supported by the controlled removal
of periodic reads; it does not assign every remaining gap a cause.

The game callback cost hardly changes. The better pacing therefore reflects
less measurement interference, not faster simulation or newly available
hardware GPU capacity. Earlier geometry/canvas comparisons remain comparisons
under the same collector load; their absolute callback rates and remaining-gap
counts must not be presented as unobserved gameplay limits. In particular,
the earlier 181 → 81 canvas comparison is conditional on periodic collection.

The buffered repeat retains 16 long intervals: nine follow simulation passes
and seven reused-scene frames. Only three of their preceding callbacks exceed
the 13.889 ms period; four ordinary intervals also follow callbacks exceeding
that duration. A simple callback-budget test is therefore insufficient to
explain runtime/compositor delivery. The remaining gaps still need separate
analysis. Stable compositor FPS or extra shader capacity is not established.

## Recorder usage and limits

For short callback-pacing comparisons, use:

```powershell
node tools/quest-frame-record.mjs ../PRIVATE-OUTPUT.jsonl 180 --auto-fire --buffered
node tools/summarize-frame-trace.mjs ../PRIVATE-OUTPUT.jsonl 30
```

`--buffered` uses the existing bounded 65,536-event ring and waits on the PC
without evaluating JavaScript on the headset during capture. It stops the
trace **before** computing endpoint statistics or serializing the raw data,
so the expensive final read is outside the recorded interval. The initial
metadata read is before capture. The installed APK needs no update for this
host-tool change. Raw trace recording still has overhead; this is not a claim
of zero instrumentation cost or compositor FPS.

- Maximum duration is 240 seconds, leaving capacity margin at 120 Hz and two
  events per callback. Actual ring overflow still fails the capture.
- Mission/trace identity is retained from the start; replacement fails the
  capture instead of silently accepting a new mission's buffer.
- Visibility/advancing-state checks run at the endpoints. Raw frame visibility
  and callback gaps are available, but there are no periodic pose/setting/audio
  snapshots. The summarizer labels this `endpoints-only`, returns `null` for
  throughout-state assertions, and reports explicit endpoint comparisons.
  Pose maxima and observed inset/projectile counts only cover sampled endpoints.
- Without `--buffered`, existing periodic behavior remains available for live
  diagnostics, with a warning about interference. Collection spans are now
  recorded. Do not pool results from the two collection modes.

The first buffered run used the same bounded mode before the additional
mission-ID guard was added. Its unchanged mission epoch, no overflow, stopped
trace and visible raw frames were verified separately.

Validation: both real-device fault tests (restarting the scratch mission and
shrinking the ring to force overflow) are rejected with a failure record and
no completion marker. An excessive buffered duration is rejected before
connecting or creating an output. Both tools pass syntax checks and scoped
ESLint; all pre-existing fields in a saved legacy summary remain identical.

## Private evidence

All raw files remain outside the repository:

- `quest-fps-cpu-inline-72-20261003-gap-analysis.json` and private helper
  `work/analyze-inline-gaps.mjs`.
- `quest-inline-72-post-fix-timeline-20261003.{json,pftrace}` and event CSV.
- `quest-inline-72-buffered-20261003.jsonl` and matching summary.
- `quest-inline-72-buffered-repeat-20261003.jsonl`, summary and gap analysis.
- `quest-inline-72-streamed-poll-cost-20261003.jsonl`, summary and poll analysis;
  reproduce the overlap calculation with `work/analyze-poll-overlap.mjs`.
- `quest-buffered-{restart,overflow}-guard-20261003.jsonl`, expected rejected
  captures from private `work/test-buffered-mission-guard.mjs`.

No game code, rendering feature, runtime setting or APK changes in this step.
