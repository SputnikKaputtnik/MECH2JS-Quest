# Cockpit screen batching — 2026-10-03

Cockpit glass pieces with the same parent now share a draw call. Their original
vertices, UVs, pane rectangles, fitting, palette and HUD/inset textures are
preserved. Moving-parent groups remain separate. Batches hold up to 16 pieces;
larger groups split at that capacity. The original path remains available with
`CockpitRenderer.batchScreens = false` for comparison.

Per-pane rectangle/fit vectors and shared texture uniforms remain live references,
so changing instrument modes or pane layouts does not leave stale displays.
Batch resources are disposed on design/mission replacement. Radar/override touch
targets, glove controls and the main/inset world renderers are unchanged.

## Why this target

The page-mirror negative control was already completed and was not repeated.
A short pass inventory on the current AMY_SCN1 fixture found no active shadow
map rendering: its light disables shadows, so freezing map updates would not
test a relevant workload here. No frozen-shadow performance run was used.
The full cockpit pass instead accounted for 36 draw calls across both eyes.
Its eleven glass pieces now form one batch, reducing the cockpit to 16 calls
across both eyes while preserving all screens and other cockpit objects.

## Visual and code checks

On the Quest, six offscreen reference/batched comparisons at 1,680 × 1,760
pixels each match **every RGBA byte**. They cover both actual eye poses for
normal displays, a moved throttle/blanked pane, and changed pane rectangle/fit.
The nonblank references contain over five million nonzero RGB bytes each.
Cockpit draws are 18 versus 8 per eye. These are isolated cockpit images,
not compositor captures or a substitute for human controller acceptance.

An initial image harness forgot to dirty the copied camera matrix and produced
blank images; those results are rejected. The corrected harness checks that
reference images are nonblank before accepting comparisons.

106 unique focused unit tests pass across cockpit kit/hands/screen batching.
New cases verify live pane data, geometry preservation, shared textures,
parent motion, capacity splitting, cleanup, and rebuilding every available
cockpit without changing touch targets or the panes excluded from the HUD.
Scoped lint, all three TypeScript configurations, WASM consistency checks and
the complete production frontend build pass.

## Full-game 90 Hz evidence

Same embedded runtime/process, fresh AMY_SCN1 scratch missions, inline 20 Hz
simulation, stationary automatic combat with invulnerability, centered resting
headset, actual 1,680 × 1,760 eye buffers, FFR 1, DRS off. Cockpit/HUD, both
instrument views, audio, FPS counter and page mirror remain enabled. The
display period is verified as 11,111,111 ns during XR. Both variants use the
same private control wrapper and allocated batch resources; only selection of
the draw path changes. No detailed profiling runs during these captures.

Each capture lasts 180 seconds, excluding its first 30 seconds. Use the
[buffered collector](quest-recorder-overhead.md), with endpoint-only state
checks. Run order is reference → batched → reference. No APK changes between
runs. Raw data completes without overflow/hidden recorded frames, endpoint
mission/settings/eyes match, audio runs, both insets exist and player projectiles
are present. This is not deterministic combat: capture begins around mission
ages 21.93, 0.95 and 0.97 seconds; the retained intervals are all after combat
starts. Endpoint head drift is a few millimetres. No controlled thermal
equilibration or hardware GPU-time measurement is claimed.

| Retained 150 seconds | Reference | Batched | Reference repeat |
| --- | ---: | ---: | ---: |
| XR callbacks/s | 88.450 | 88.970 | 88.355 |
| Entry intervals >16.667 ms | 244 | 230 | 290 |
| Entry interval p99 | 18.00 ms | 17.70 ms | 19.20 ms |
| Callback host wall time, mean | 5.550 ms | 5.493 ms | 5.478 ms |
| Callback draw calls, mean | 60.30 | 40.47 | 60.48 |

This supports a **small pacing improvement**, not a large compute saving or
stable 90 displayed frames/s. Total callback wall time does not improve
reliably. Fewer submissions and exact pixel equivalence justify retaining the
batching change, but do not establish a budget for new lighting. Rare stalls,
native delivery costs and hardware GPU budget remain separate open issues.

Private evidence outside the repository: `quest-cockpit-batch-{off,on,off-repeat}-90-20261003.jsonl`
and matching summaries; `quest-cockpit-batch-comparison-20261003.jsonl`;
`quest-cockpit-batch-image-verified-20261003.json`. Helpers are
`work/cockpit-batch-variant-control.js`, `work/compare-cockpit-batch-images.js`
and `work/compare-buffered-scheduling.mjs`. The unverified initial image file
is retained only as rejected diagnostic evidence.

## Standalone deployment

Source `6e5f9e6` is installed in the existing standalone app. The pinned runtime,
signature and alignment checks pass; all 16 native-library/DEX entries are
SHA-256-identical to the previously installed frontend build. App inventory ID
is `b750f5212246c864393a9bfadcdffda387389ca168074e7bcc6008bc5bf8c7f6`;
the native origin loads `index-BWrPSktO.js` without a service-worker controller.
All 19 saved files and 10 preferences match before/after installation.

Normal bundled VR entry reports a visible session with two views and advancing
callbacks (1,141 → 3,117), at a verified 13,888,888 ns display period. This
startup smoke is not a mission FPS run or human stereo/controller acceptance.
The app is restored to its normal start screen at 72 Hz after testing.
No detailed profiling or automation is enabled. The public release is unchanged.

Private deployment evidence: `quest-cockpit-installed-{startup,xr-start,xr-end}-20261003.json`,
private save snapshots, and `work/android-runtime/cockpit-apk-audit-20261003.json`.
The prior APK is retained as `MECH2-Quest-before-cockpit-20261003.apk` outside Git.
