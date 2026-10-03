# Identical mech replacement geometry — 2026-10-03

The full-game CPU profile led to a concrete source of repeated work.
`hudWidget13Tick` requests `mechApplyDetailLevel(target.index, 0)` on each
active target-display update. `detailRecordBuild` destroys and recreates the
parts, even when the resulting model is identical. The renderer previously
treated each new object identity as new GPU geometry in both the main view
and the target inset. This is bounded allocation churn, not evidence of an
unbounded resource leak in the current code.

## Change and ownership

The simulation and original target-display behavior remain intact.
`SceneRenderer` can transfer its current render entry to a replacement mech
part only when the old object has been freed, the scene node and pass match,
the owning map still holds that entry, and model geometry and material
classification match. It compares model positions, UVs, polygon counts,
indices and codes exactly; changed LODs, sprites/topology, owners, materials,
baked scenery and still-live objects fall back to rebuilding.

The entry adopts the new mesh blocks and picking owner. Normal per-pass
shading, clipping and transforms continue against the new simulation state.
The lookup holds only the current entry per node, uses weak keys, and is
removed on disposal using the node captured at build time. It is not an
archive of previous LODs or dead objects. Main/inset renderers still own and
release their own resources. `reuseReplacementGeometry=false` retains the
reference path for comparison.

## Diagnostic counts

Two consecutive approximately 20.12-second captures in the visible native
72 Hz AMY_SCN1 fixture used both instrument views and automatic combat.
Temporary wrappers counted builds and disposal, so these are work counts,
not an FPS benchmark. They sampled different combat phases.

| Render pass | Reference builds | Reuse builds |
| --- | ---: | ---: |
| Main view | 6,175 | 138 |
| Target inset | 6,045 | 15 |
| Rear inset | 29 | 25 |
| Target-view updates | 403 | 402 |

Total geometry builds fell from 12,249 to 178 in those diagnostic windows.
The target still receives essentially the same number of updates; this does
not achieve the reduction by removing its content or lowering its cadence.
Live GPU geometry snapshots were 62 and 64, respectively. Variation in actor
and effect counts means those two snapshots alone are not a leak test.

## Full-game timing comparison

The final implementation was measured without the build-count wrappers in
two 180-second native-runtime captures, reference first, reuse second. Each
started the same scratch AMY_SCN1 mission; 30 capture seconds were discarded
as warm-up. Both used deferred simulation, 72 Hz display period, 1680 x 1760
per eye, two active inset views, FFR 1, DRS off, invulnerability, audio and the
stationary automatic combat protocol. A common test-only entry wrapper set
the reference/reuse flag in all scene renderers. No detailed GPU profiling
or image readback ran during these timing captures.

| After warm-up | Reference | Reuse |
| --- | ---: | ---: |
| Visible XR callbacks | 10,750 | 10,769 |
| XR callbacks/s | 71.66 | 71.79 |
| Callback CPU mean | 4.58 ms | 4.53 ms |
| Callback plus associated deferred work, mean | 6.38 ms | 5.84 ms |
| Callback plus associated deferred work, p99 | 11.80 ms | 9.90 ms |
| Simulation pass including inset views, mean | 6.02 ms | 4.21 ms |
| Actual callback-entry interval p99 | 17.90 ms | 15.80 ms |
| Actual callback-entry intervals >20.833 ms | 82 | 67 |
| Mean callback draw calls | 55.90 | 55.97 |
| Mean callback triangles | 38,780 | 38,657 |

The measured host work per callback decreased by 0.55 ms (8.6%) in this pair,
mostly in the simulation/inset pass. This is not a 98% FPS improvement despite
the large reduction in allocations. The 72 Hz ceiling limits the callback-rate
comparison; no new GPU-time or compositor-FPS claim follows. CPU here means
wall time inside the instrumented host work, including synchronous API calls.

The sampled head pose stayed within 0.81 mm / 0.023 degrees for reference and
2.45 mm / 0.063 degrees for reuse. Settings and eye buffers stayed constant.
Combat is not a deterministic replay, and the single-order timing pair has
not been thermally equilibrated or repeated in reverse order. The small
triangle-count variation and these limits should accompany any performance
claim. The raw traces are `quest-geometry-reuse-{off,on}-72-20261003.jsonl`.

## Evidence and limits

The autonomous native-runtime image/resource suite completed. For this change,
the target monitor's 103 x 80 images were byte-identical to fresh rebuilding
in both wireframe and shaded modes (2,445 and 2,250 drawn pixels; 15 meshes
actually reused in each comparison). Across 800 target LOD replacements,
live geometry stayed at 40, and final geometry/texture/program counts were
all zero. Six ordinary and six enhanced mission lifecycle cycles also returned
all resources to zero. The wider world/HUD checks passed their existing
tolerances; those comparisons are not all pixel-exact (maximum 36 differing
world pixels and 2 HUD pixels). Report: `quest-geometry-reuse-image-tests-20261003.json`.

Unit coverage includes 500 consecutive replacements, picking/pose updates,
freed-node cleanup, changed model/UV/topology/owner/material rejection,
pass isolation, live-object rejection, and fresh-versus-reused output across
near clipping and changing shading. The full suite had 630 passes and the
unchanged private ISO-size failure (56,037 versus 56,187 sectors). TypeScript
for all three projects, full ESLint, both Wasm consistency checks, production
build and offline inventory passed. Code generation remains unavailable without
the private decompilation checkout; generated files were not changed.

An XR-end request during a development-server restart remained pending and
was recovered by restarting the test app. It happened outside captures; the
existing embedded-runtime reload/exit issue is not resolved by geometry reuse.
After verification, the normal bundled app origin was restored at 72 Hz.
No detailed GPU profiler was started in this investigation.

Private logs outside Git include `quest-geometry-reuse-off-counts-20261003.json`
and `quest-geometry-reuse-on-counts-20261003.json`. The original longer
diagnostic `quest-geometry-churn-before-counts-20261003.json` covers about
105.67 seconds, including time outside its separately recorded 60-second
combat trace; do not mislabel that counter window as 60 seconds.

The preserved APK/release is unchanged. Development fixtures use the full
game on the USB-connected Quest; the worker prototype stays frozen.
