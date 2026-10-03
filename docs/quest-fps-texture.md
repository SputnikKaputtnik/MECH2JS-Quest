# FPS counter canvas upload — 2026-10-03

**Measurement follow-up:** the comparisons below used periodic log collection,
which was subsequently found to introduce frame delays itself. See
[recorder overhead](quest-recorder-overhead.md): the same optimized frontend
reaches 71.94–71.95 XR callbacks/s with 10–16 long intervals per 150 seconds
when raw data are read after capture. Preserve the original A/B evidence here,
but do not treat its absolute rates/gap counts as an unobserved gameplay limit.

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

These 90 Hz observations do **not** establish stable 90 FPS, compositor delivery,
additional shader budget, or the size of a benefit at 72 Hz. The production
scheduler remains inline by default; the measured protocol is explicitly
after-render. The last row confirms the committed implementation after an
app/server restart with no FPS-canvas override. The lower host time in this
fresh process is not attributed to the canvas change: the same-process
comparison above did not show that reduction. Across these four captures,
head displacement stays below 1.2 mm and rotation below 0.042 degrees from
the fixture's neutral pose. Render settings, eye buffers and both insets are
stable; audio and visible XR continue, with no raw-event drops.

## Follow-up at 72 Hz with the production scheduler

A separate same-process pair uses **inline** simulation, matching the normal
game's scheduling mode. All other full-game fixture settings stay as above;
the verified display period is 13.888888 ms. Each variant again runs for
180 seconds with its first 30 excluded. Run order is CPU canvas → default
canvas, with a fresh scratch mission for each. The page mirror and both
instrument views remain enabled, audio and visible XR continue, and actual
eye buffers/settings stay constant. Context attributes verify the intended
canvas variant in every sample. No detailed GPU profiling or file transfers
run during these two captures.

| Canvas condition | XR callbacks/s | Entry gaps >20.833 ms | Entry interval p99 | Callback host wall time |
| --- | ---: | ---: | ---: | ---: |
| Default canvas, clean reference | 71.01 | 181 | 26.80 ms | 5.84 ms |
| CPU canvas | 71.61 | 81 | 18.80 ms | 5.75 ms |

This single 72 Hz pair supports fewer long intervals in the normal scheduling
mode: 55% fewer above the stated threshold. It is not a claim of universally
stable 72 FPS or a measured shader budget. The 0.09 ms host-wall difference
is small and is not the main result. The larger 90 Hz comparison and reversal
remain separate evidence; do not pool counts across the two refresh rates.
The headset stays within 1.6 mm / 0.05 degrees of the fixture's neutral pose.

Private logs are `quest-fps-cpu-inline-72-20261003.jsonl` and
`quest-fps-default-inline-72-clean-20261003.jsonl`, with matching summaries.
An earlier `quest-fps-default-inline-72-20261003.jsonl` was recorded while
backing up the installed APK over ADB. It is excluded from the comparison
because device file I/O could contaminate timing; do not substitute it for
the clean reference.

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

## Standalone APK update

After the clean 72 Hz comparison, a development APK containing source commit
`4973a69` was built, signature/alignment checked and installed as an update.
This includes the earlier geometry-reuse change; deferred simulation remains
opt-in and the worker prototype remains frozen. SHA-256 comparison of all
16 native-library/DEX entries against the actual previously installed APK
finds no runtime/host-bytecode change. Only the frontend bundle/inventory and
package signing metadata differ. The original installed APK is backed up
privately; original game files are not included in the new APK or retransferred.

- APK SHA-256: `a14d5d2cc7bf0061309a4e6fd8bf33f0407dcfe82e9c4a9d6cfcf94eb244afea`.
- Bundled app ID: `91aaaebd0b915b0c02e62eafd74003dd50bb7df4f9239612459830d5e0bb7df0`.
- Normal native startup loads `index-CJL5HI_S.js` from local origin 19895,
  with the expected inventory and no service-worker controller.
- All 19 saved files and 10 stored preferences match byte-for-byte before
  and after the update/startup check, and again after the VR smoke/restart.
- Normal bundled **Start in VR** enters visible XR with two tracked views;
  a separate smoke callback counter advances between readbacks while the
  shell is running. The observed display period is 13.888888 ms. This checks
  entry and advancing tracking, not mission FPS or human-perceived stereo.

After the smoke check, the app is restarted at its ordinary start screen,
with refresh property 72, zero Perfetto sessions and detailed GPU profiling
disabled. Private evidence: `work/android-runtime/fps-apk-audit-20261003.json`,
`quest-fps-installed-startup-20261003.json`,
`quest-fps-installed-xr-{start,end}-20261003.json` and the before/after save
snapshots. `quest-fps-apk-deployment-20261003.json` summarizes the verified
deployment separately from the build report. These contain private
profile/device data and stay outside Git.

The private build report still says `deviceVerified: false`: packaging alone
does not certify gameplay. On-device startup checks are separate from the
controlled mission comparisons above and from human headset acceptance.
The public GitHub release is unchanged.
