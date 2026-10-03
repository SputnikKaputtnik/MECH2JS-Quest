# Raw trace storage: offline follow-up, 2026-10-03

The Quest is reserved for another project. This step uses no ADB, CDP, device
measurements, app launch, installation or server restart. The installed APK
remains the cockpit-batching build from source `6e5f9e6`. Device validation of
this source change is pending an agreed exclusive test window.

## Change and reason

`QuestFrameTrace` previously grew an array of copied JavaScript event objects
during capture. The maximum ring retained 65,536 such objects; overwritten
objects then became garbage. This is an avoidable source of allocation and
retained object traversal in a diagnostic intended to investigate rare stalls.
It is **not evidence that this caused the previously observed 70 ms pauses**.

The recorder now allocates and touches a fixed Float64 buffer in `start()`.
Fourteen numbers per event use exactly 7 MiB at maximum capacity. Recording
writes numbers into existing storage, without retaining event objects or
growing the ring. Input event literals at the callers still exist; this does
not make the entire measurement pipeline allocation-free. Ordinary gameplay
with tracing disabled does not allocate the large buffer.
An enabled short capture now reserves its full requested capacity upfront,
so its initial footprint is larger than the old partially filled array.

`read()` reconstructs the existing event schema on demand. Double precision,
booleans, event variants, cursor continuity, overwrite/drop reporting, stop and
restart semantics are preserved. Export still allocates and must remain outside
the measured interval: use the existing `--buffered` recorder, which stops the
trace before reading it. Do not use periodic reads for pacing comparisons.

## Local verification and limits

Seven focused tests cover the recorder, scheduling and performance status.
They include exact mixed-event comparison through repeated wraps, in-place
input mutation, detached exports, both scheduling modes, same-size restarts,
capacity changes, invalid starts, a complete 65,536-event capture and overflow.
Scoped lint, engine/app/tool TypeScript, WASM consistency and the production
frontend/offline build pass.

Reproduce the host benchmark from the repository root, directing its output
outside the repository:

```powershell
node --expose-gc --import tsx tools/benchmark-frame-trace.ts 37a8df5 > ..\frame-trace-host.json
```

It compares the actual previous recorder source from Git with the new one,
using two warmup rounds and eight measured rounds with alternating order.
Each run writes 65,536 mixed events, including caller-side event literals.
Forced GC, initialization and export are outside the timed recording loop.
Each capture has its own function scope so previous exports cannot remain
live during the next memory baseline.

| Median on this Windows host | Previous object ring | Fixed numeric ring |
| --- | ---: | ---: |
| Initialize capture | 0.01 ms | 1.20 ms |
| Record 65,536 events | 5.98 ms | 4.05 ms |
| Retained JS heap | 15,644,248 bytes | 408 bytes |
| Retained array-buffer storage | 0 bytes | 7,340,032 bytes |

The storage is moved out of the managed object graph, not eliminated. These
are Node CPU and retained-memory results, **not Quest FPS, GPU time, a game
speedup or proof of a GC stall cause**. Initialization has an explicit upfront
cost. Compare future device captures using the same recorder version and
collection mode; retain the previous source for measurement controls.

Private evidence: workspace `outputs/frame-trace-packed-host-scope-fixed-20261003.json`.
The earlier file without `scope-fixed` has invalid memory deltas because
previous captures stayed live across the next baseline; do not use it.

## Rejected renderer experiment

Caching both input matrices in `WorldBatch` passed nine local correctness
tests but made the isolated host benchmark slower. For 128 objects, median
CPU preparation per call changed 0.01922 → 0.02247 ms for static transforms,
0.02114 → 0.02210 ms for updates every fourth frame, and
0.02041 → 0.02457 ms for updates every frame. These tiny host costs do not
support adopting the cache. The renderer change was removed; its patch,
benchmark and raw results are private. No device-performance conclusion was
drawn and no visual/steering changes are included in this step.
