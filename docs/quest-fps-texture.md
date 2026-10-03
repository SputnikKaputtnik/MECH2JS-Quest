# FPS counter canvas upload — 2026-10-03

The cockpit FPS counter now requests a CPU-backed 2D canvas with
`willReadFrequently: true`. Its text, colour thresholds, mission average,
position, update policy, texture resolution and material are unchanged.
The page mirror remains enabled. This is a small upload-path change, not a
simulation or worker rewrite.

## Why this path

The [frame-delivery investigation](quest-frame-delivery-diagnostic.md) found
extra sleeping time inside the game renderer's WebGL command-buffer task
before a delayed SyncToken release. A command-level capture then exposed
88 `kCopySubTextureCHROMIUM` service spans averaging 4.45 ms. These are
CPU-side command-processing spans, **not hardware GPU execution time**.

Changing just the FPS canvas backing removed these copy calls in a second
18-second diagnostic. The same page-mirror blits remained (1,468 calls,
0.056 ms mean service span), the FPS texture continued updating, and
`kTexSubImage2D` uploads remained. The latter trace has no reported import
errors or data-loss counters; the original command trace has one conflicting
track descriptor and is not used for exact thread attribution. Neither
instrumented capture supplies an FPS baseline.

This supports avoiding an accelerated-canvas upload/synchronization path.
The hint is not a guarantee of a particular implementation in every browser;
the tested runtime reports `willReadFrequently: true` in context attributes.
It does not remove the runtime's synchronization primitives.

## Full-game comparison

Each capture lasts 180 seconds, excluding its first 30 seconds. All use native
Wolvic Chromium 1.4, visible advancing XR, AMY_SCN1, stationary invulnerable
automatic combat, both cockpit inset views, audio, 20 Hz simulation and the
opt-in **after-render** scheduler. Display period is 11.111111 ms (90 Hz),
actual eyes are 1,680 × 1,760, FFR is 1, DRS is off, and the mirror is on.
Geometry reuse remains on. No detailed profiling runs during these captures.

| Canvas condition | XR callbacks/s | Entry gaps >16.667 ms | Entry interval p99 | Callback + deferred host wall time |
| --- | ---: | ---: | ---: | ---: |
| Original default canvas, first reference | 86.96 | 464 | 22.10 ms | 5.50 ms |
| CPU canvas, private A/B override | 88.97 | 160 | 19.60 ms | 5.48 ms |
| Default canvas restored, reverse check | 86.67 | 502 | 22.30 ms | 5.43 ms |
| Fresh source after app/server restart, no canvas override | 88.95 | 160 | 19.50 ms | 5.11 ms |

The mirror-off negative control ran between the first reference and CPU
canvas test; it did not establish a useful gain and was restored before
both canvas tests. The CPU/default variants use the same wrapper and fresh
scratch missions; their actual context flags are recorded throughout.
The reduced gaps return on restoring the original path. Host wall work is
essentially unchanged, consistent with reducing a downstream synchronization
cost rather than speeding up the simulation.

These observations do **not** establish stable 90 FPS, compositor delivery,
additional shader budget, or the size of a benefit at 72 Hz. The production
scheduler remains inline by default; the measured protocol is explicitly
after-render. The last row confirms the committed implementation after an
app/server restart with no FPS-canvas override. The lower host time in this
fresh process is not attributed to the canvas change: the same-process
comparison above did not show that reduction. Across these four captures,
head displacement stays below 1.2 mm and rotation below 0.042 degrees from
the fixture's neutral pose. Render settings, eye buffers and both insets are
stable; audio and visible XR continue, with no raw-event drops.

## Correctness and evidence

An offscreen Quest comparison renders both canvas paths for placeholder,
red/yellow/green threshold, and mission-average labels. The four comparisons
have 760–1,273 differing bytes out of 131,072, at most 5/255 per channel;
small canvas rasterization differences, not bit-identical output. Both images
are nonempty and WebGL reports no error. The bounded acceptance threshold is
at most 8/255 and 2% differing bytes. The existing cockpit anchoring, unchanged
label caching, text formatting and colour-boundary unit tests pass. App
typecheck, scoped ESLint and Vite production build pass.

Private workspace evidence (outside Git):

- `quest-mirror-on-90-20261003.jsonl`, original reference.
- `quest-fps-cpu-canvas-90-20261003.jsonl`, CPU canvas variant.
- `quest-fps-default-canvas-repeat-90-20261003.jsonl`, reverse check.
- `quest-fps-cpu-production-90-20261003.jsonl`, fresh-source confirmation.
- Matching `*-summary.json` files, produced with `tools/summarize-frame-trace.mjs FILE 30`.
- `quest-decoder-timeline-20261003.{pftrace,json}`, original command diagnostic.
- `quest-fps-cpu-decoder-20261003.{pftrace,json}` and
  `quest-fps-cpu-decoder-uploads-20261003.json`, CPU canvas diagnostic.
- Private helpers `work/fps-canvas-variant-control.js`,
  `work/fps-canvas-image-check.js`, `work/check-canvas-variant-logs.mjs`.
- `quest-fps-canvas-image-check-20261003.json`, repeated Quest pixel comparison
  using the fresh module, with no live canvas override.

After testing, normal native startup is restored with refresh property 72,
zero Perfetto sessions and detailed GPU profiling disabled. The installed
APK and public release are unchanged; the source change is built and tested
through the native runtime's development route.
