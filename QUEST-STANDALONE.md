# MECH2JS Quest standalone

Experimental Quest 3 fork of [Adam4lexander/MECH2JS](https://github.com/Adam4lexander/MECH2JS), based on upstream `vr-mode` at `d689e322de1c862351b3c97d5ecbcf388c116ed4`.

The first goal is a faithful VR interpretation of the original visuals. Optional stylistically compatible enhancements can follow later. Rendering and simulation run on the headset. The current delivery is an offline-capable WebXR app in Quest Browser, not an Android APK.

## Install your own game data

Original game files are not included. A compatible DOS installation is required; Windows editions and differing executable layouts are not interchangeable. Run `npm run check:install -- "path/to/install"` before importing a candidate installation.

1. Install dependencies with `npm install` (or use the included pnpm lockfile).
2. Copy `.env.example` to `.env.local` and set `MW2_ROOT` to your private installation. Do not commit this file.
3. Run `npm run fetch-soundfont` for local MIDI playback, then `npm run build`.
4. Connect the Quest with USB debugging authorized. `Start-Quest.ps1` starts the local preview and forwards port 5173; Node.js and Android platform-tools must be available.
5. In Quest Browser open `http://localhost:5173/?setup` and choose the install button. The importer verifies every data block and keeps saves separate from game data.
6. Open `http://localhost:5173/`, choose **Start in VR** while wearing the headset, and approve the browser's immersive permission if requested.

After importing, the app and game data are stored locally. Keep the same origin and port. Browser data deletion removes the installation and saves. Storage persistence is requested but may be denied by the browser; use the setup page's save export/restore controls. For updates, reconnect the local server, rerun setup, and reload the game. A running mission keeps its loaded code until reload.

## Controls

- Front end: point the right controller at the screen; right trigger clicks. Right stick can also move the cursor. Left stick sends arrow keys, left trigger Enter, B/Y Escape.
- Profile entry: click an editable slot to show the virtual keyboard. Point + trigger types; left stick + A also works. DEL deletes, SPACE inserts a space, OK accepts. X opens/closes the keyboard manually; B/Y closes it.
- Cockpit: left stick controls throttle/turn; right stick controls torso; right trigger fires; X jumps; Y opens the mission menu. The existing combat mapping is retained; sensitivity tuning is deferred.
- **Y → VR Options:** FPS counter defaults ON. It is fixed to the lower-right cockpit and shows display callback frequency averaged over half a second, beside the time-weighted mission average (`Ø`, one decimal). Each value is red below 60 FPS, yellow from 60 to below 89, green at 89 or above; colours use the unrounded value. Hidden/suspended headset intervals are excluded. A new mission resets the average; hiding the counter or resetting diagnostic logs does not. Ejection animation defaults OFF, with a nausea warning for enabling it. FFR defaults ON and can be toggled immediately. Render resolution offers 100–200%; changes apply on the next VR entry.

## Rendering status

The current target is **90 Hz**, requested when the runtime supports it, with a 72 Hz fallback. The initial render scale is **125% of the runtime-recommended eye buffer**, not 125% of the physical panel resolution. FFR ON preserves the renderer's existing maximum fixed-foveation setting. Higher scale presets are available for testing, not guarantees of stable performance. The simulation remains at its original configured 20 passes per second.

The first measured optimization reuses unchanged HUD pixel uploads between simulation passes. Camera tracking, world rendering, HUD placement and targeting continue every display frame. Changing window dimensions or the source window forces a fresh upload; palette changes remain independent.

HUD updates now pack each RGBA pixel with one aligned 32-bit store instead of three separate byte stores, and read its layer once. The Uint32 view shares the existing texture bytes, with shifts selected for native byte order; palette indices (including hidden ones), layer/inset bytes and zero alpha are unchanged. No extra buffer copy or per-update allocation is introduced.

An isolated on-Quest comparison of the complete CPU `HudOverlay.update` function used identical frozen 640×480 windows, alternating reference/current-source methods after warmup (24 measured batches of 8 updates per variant). The current source method ran on separate benchmark instances, without changing the live game's renderer. Mean CPU update time was:

| Frozen HUD input | Byte-store reference | Packed stores |
| --- | ---: | ---: |
| Captured window | 1.805 ms | 1.327 ms |
| Same window with reticle and target marker | 1.787 ms | 1.346 ms |
| Full inset view | 2.090 ms | 1.365 ms |

All texture bytes matched. This is approximately 25–35% less CPU time for these HUD updates, excluding actual GPU texture upload/rendering. It saves time on HUD-update frames, not on every 90-Hz display frame. Whole-mission FPS and frame-time benefits have not yet been measured for this change; absolute microbenchmark times depend on device clocks and runtime warmup.

Before this optimization, a 25-second Quest 3 sample at 72 Hz measured 70.9 XR callbacks/s, CPU mean 7.9 ms and p95 10.1 ms, with a combined 3360×1760 XR texture. Profiling identified repeated HUD packing as a significant CPU cost. This is one scene sample, not a general performance guarantee. WebGL GPU timer queries are unavailable on the tested browser, but native `ovrgpuprofiler` surface traces work.

The opaque world now uses one indexed submission per material. Original model-space vertices and palette words are retained; a GPU matrix texture places each part, including moving mech parts. Indices omit CPU-rejected faces and unused clipping slots. Buffer updates copy only changed attributes, and expired object slots are reused for transient effects. Shadows, raycasts, outlines and order-dependent decals retain their original paths. The original CPU clipper, lighting rules and 20-Hz simulation are unchanged. The reticle also reuses an identical depth query until its world revision, camera, projection, reticle or visible mesh set changes.

On Quest 3, four alternating 20-second reference/batch windows in one live mission measured the following (2026-10-01). Both paths used HUD reuse and reticle memoization, the same 90-Hz session, 2100×2200 per eye, 125% render scale and FFR 1. The simulation and head pose were not frozen, so this is a live comparison rather than a deterministic benchmark.

| Metric | Reference world path | Batched world path |
| --- | ---: | ---: |
| XR callbacks/s | 84.6 | 88.7 |
| CPU frame mean | 6.62 ms | 6.32 ms |
| Whole-frame draw calls, mean | 314 | 137 |
| Intervals over 1.5× frame budget, per 40 seconds | 357 | 231 |
| Main GPU surface time, separate 1-second trace | 5.57 ms | 5.64 ms |

The two GPU traces do **not** show a GPU-time improvement; they measure render-surface execution, not the whole frame or compositor. CPU p95 in the two batched windows was 12.0/11.6 ms, still above the 11.1-ms budget. Stable 90 FPS across missions is not established. Dynamic resolution is not yet implemented.

For a live comparison, `window.mw2.view.renderer.batchWorld = false` selects the reference path; set it back to `true` after sampling. This changes submission only, without reloading or lowering resolution.

The separate VR reticle and target-marker planes are now cropped to their drawn pixels, with a one-source-pixel guard. Geometry and UV bounds change together, retaining the original placement, depth and texture mapping. Empty layers submit no triangles; unchanged HUD uploads retain their bounds. The remaining HUD and cockpit screens keep their existing path. `window.mw2.view.hudOverlay.cropWorldLayers` switches the crop on/off for comparison; `layerCoverage` reports each padded rectangle's fraction of the original plane.

The first live Quest crop comparison (four alternating windows of about 20 seconds at the same resolution/FFR) measured **88.38 FPS full planes versus 88.50 cropped**, CPU means 6.40/6.27 ms. This does not establish an FPS gain. The native 1-second traces also do not establish a GPU-time improvement: pooled 4200×2200 hardware-binning surface means were 5.00/5.89 ms, with differing numbers of short surface executions, moving scene/head pose and uncontrolled GPU clocks. These are not whole-frame GPU times. The visible mission reticle's padded plane occupied 0.40% of its former area; no target marker was visible during these samples. Further controlled GPU comparisons are needed before attributing a performance benefit.

A later optimization candidate is a coarse-grained C/C++ WebAssembly module for measured CPU bottlenecks, particularly fixed-point/64-bit geometry or collision work. This is an investigation direction, not a committed full-engine rewrite or a measured speedup. Keep the TypeScript implementation as the behavioral reference, batch data transfers across the JS/Wasm boundary, and establish a Quest benchmark before choosing a port. A native Android/OpenXR renderer would be a separate, larger project from a Wasm module within the current browser host.

`window.mw2QuestPerf.reset()` starts a new sample. `snapshot()` reports callback frequency, CPU and simulation time, draw calls, triangles, actual XR layer dimensions, per-eye viewport sizes, granted refresh rate and fixed foveation. Stable 90 FPS at increased resolution still requires on-device verification across missions.

Diagnostics also report `status` (`waiting`, `recording`, `paused`, `stale`, `ended`) and `lastFrameAgeMs`. Once a mission ends, its samples and mission average remain available as historical data, but live FPS becomes null; the disposed mission's `window.mw2.view` handle is removed. More than 1.5 seconds without a visible callback marks live data stale. The XR host can keep rendering the launch/menu screen after a mission ends, so a visible XR session alone is not proof that a mission or its logger is still running.

Polygon lighting now uses Number arithmetic only when the sum of absolute dot-product terms fits exactly within the safe integer range. Signed shifts still round down, the final division still truncates, and extreme inputs retain the BigInt reference path. This changes arithmetic cost, not the lighting model. Two seeded property tests compare 50,000 cases against the frozen BigInt implementation, covering ordinary 16.16 inputs, negative rounding, positional lights and signed extremes.

An unattended Quest 3 comparison on 1,067 frozen AMY_SCN1 world polygons measured 0.127 ms for the reference versus 0.092 ms for the optimized lighting function per complete polygon set (20 alternating measured rounds, 16 repetitions each, after warmup). Every intensity matched. This is about 28% less time in this isolated function, only 0.035 ms per tested set; it is not a measured whole-frame or FPS improvement. Off-head power state, development code and CPU clocks affect absolute timings.

## Unattended Quest checks

Vertex view-depth calculation now takes an exact Number path when all three products and their partial sums fit the safe integer range, falling back to the wrapped 64-bit accumulator otherwise. Power-of-two division followed by rounding preserves the original bit-26 rule, including negative half ties; clipping thresholds and visual behavior are unchanged. A seeded BigInt oracle checks 50,000 cases plus safe-range, cancellation, rounding and overflow boundaries.

Two unattended Quest runs over 1,363 frozen mission vertices measured 0.1097→0.0425 ms and 0.1063→0.0431 ms per set against the current accumulator, which already includes the earlier signed-multiplication optimization. All vertices used the bounded path, with no mismatches. This is 59–61% less CPU time for this isolated operation, about 0.063–0.067 ms per tested set, not a measured whole-frame speedup. The fixture reports it as `lighting.depth`; each run also passed the existing 15 world-image, 36 HUD-image and six resource-lifetime checks.

The depth build (`index-BpQTcbML.js`) was activated from offline storage and entered VR autonomously. A clean 30-second Goat Path mission sample with visible, advancing XR measured 87.96 callbacks/s, CPU mean 6.04 ms, p95 11.4 ms and max 15.4 ms; 173 intervals exceeded 1.5 times the frame budget. It retained 2100×2200 per eye and ended with 52 geometries/13 textures. No CPU/GPU profiler ran during the sample. Different live mission phases prevent attributing the FPS difference from the previous sample to this change; stable 90 FPS is still unproven.

After a real immersive mission ended on the combined build, the persistent renderer returned to two geometries and two textures for the VR front end. This corroborates mission resource cleanup outside the synthetic fixture; it does not explain the historical five-digit in-mission geometry counts.

The combined optimization build (`399106d`, bundle `index-9JP4Xcw3.js`) was loaded from the Quest's offline cache on 2026-10-01. With the existing site authorization, stay-on and proximity override, a browser-automated click on the actual **Start in VR** button successfully opened a visible 90-Hz session without another headset confirmation. The front end was navigated normally through Trial of Grievance into the persisted Goat Path setup. This is verified for this device/session configuration, not a guarantee that authorization survives every browser/device restart.

A clean 30-second stationary mission sample of this build measured 86.33 XR callbacks/s, CPU mean 6.15 ms and p95 11.2 ms, with 196 intervals over 1.5× the 90-Hz budget. Eye buffers remained 2100×2200, FFR 1 and render scale 125%; the sample ended with 95 geometries and 13 textures. A separate earlier 25-second CPU profile identifies HUD packing, polygon clipping/shading, fixed-point transforms and Three.js rendering as remaining work. Its timings are kept separate from the unprofiled sample. The older GPU trace remains only a surface-execution measurement, not a GPU measurement for this new build.

The old loaded build had measured 88.97 callbacks/s, CPU mean 6.51 ms and p95 11.3 ms in a different 30-second mission window. The mission starts/phases, live scene and runtime warmup differ; these observations do **not** establish a combined speedup or slowdown. Stable 90-Hz delivery still needs work. The historical five-digit geometry growth was not reproduced in these runs.

World-batch preparation now reuses layer-restoration buffers and tags existing slots when reconciling the source list, avoiding per-source tuple arrays and a temporary membership Set. Mesh references in the restoration buffers are cleared after each draw, including failed/nested draws, and all scratch storage is released on disposal. Expired/reappearing effects and changes in a mesh's vertex count retain the previous behavior.

With 197 frozen mission sources, two Quest CPU-only batch-preparation comparisons measured 0.0763→0.0652 ms and 0.0768→0.0661 ms per call, approximately 14% less time. Each variant ran 20 measured rounds after warmup, 64 calls per round, with an empty GPU draw callback. Separately, heap sampling at a 4-KiB interval (including collected objects) attributed approximately 43.7 MB to the reference batch functions versus 17.6 MB to the current ones over 1,792 equal benchmark calls per variant, about 60% fewer sampled allocated bytes. This measures allocation traffic in those functions, not retained heap size, GC pauses, GPU time or XR FPS. The timing runs did not use heap sampling. Reports include `lighting.batching`; image and six-cycle resource checks also pass.

Scene entries now mark their world transform dirty only when their local matrix changes. The comparison uses the actual matrix, so cockpit interpolation is reset correctly on the next sync even if the simulation transform is unchanged. New/reparented entries start dirty; moving scene parents still propagate normally. `window.mw2.view.renderer.reuseWorldMatrices = false` retains the prior unconditional path for A/B checks.

On the frozen AMY_SCN1 scene, this eliminated 342 redundant matrix multiplications per sync/propagation pass. Two Quest runs measured 0.448→0.416 ms and 0.476→0.432 ms for the complete `SceneRenderer.sync` plus world-matrix propagation, about 7–9% less CPU time in that frozen workload. Each used 14 alternating measured rounds after warmup, 16 passes per round. All compared transforms matched, including shifted scene parents. Unit checks additionally cover moving objects, carried mech parts, removal of a scene node and reparenting under an already clean transformed parent. These timings exclude simulation, GPU work and moving-scene costs; no whole-frame FPS improvement is established. Reports are under `lighting.matrices`.

Signed 32×32→64 multiplication now gets the exact low word from `Math.imul` and recovers the high word by rounding `(a*b - low)/2^32`. For int32 inputs the combined floating-point error is far below half a high-word unit, so both words remain exact even at carry boundaries. Unsigned multiplication is unchanged. This reduces work inside transformation, clipping and simulation helpers, preserving the original wrapped arithmetic and rounding rules.

The complete rounded three-term dot product was compared with a frozen copy of the prior split-product implementation on 1,067 frozen mission operand tuples. Two unattended Quest runs averaged 0.109/0.079 ms and 0.114/0.078 ms per set (reference/current), approximately 28–32% less CPU time. Each used 20 alternating measured rounds after warmup and 64 sets per round; every result matched. These isolated timings do not establish a whole-frame FPS gain. The fixture reports this as `lighting.culling.fixedPoint`.

Validation includes 100,000 seeded signed-multiplication cases against BigInt, 87,616 operand pairs around powers of two and signed extrema, and existing accumulation, shift, matrix and trigonometry tests. The full suite passed 546 tests with the same single CD-image gap failure described below; Quest image and resource-lifetime checks also passed.

Back-face rejection now uses a bounded Number dot-product sign check, retaining the original wrapped int64 accumulator whenever the sum of absolute products exceeds the safe integer range. Zero, cancellation and signed overflow keep their original decisions. A seeded BigInt oracle checks 50,000 cases plus explicit boundaries. This targets `polyDepthKey`, identified in the saved on-device CPU profile; the clipping/depth rules remain unchanged.

On Quest 3, 1,067 frozen mission polygons all used the exact Number path and matched the accumulator reference. Twenty alternating measured rounds after warmup (64 complete sets per round) averaged 0.122 ms per set for the reference and 0.039 ms for the new sign check: approximately 68% less time in this isolated operation, saving 0.083 ms per tested set. This excludes the rest of clipping/rendering and does not establish a whole-frame FPS improvement. The unattended fixture includes this comparison in `lighting.culling`.

A fresh stationary live mission was also sampled while investigating historical geometry growth: snapshots at 8,947 and 22,392 XR callbacks reported 72 and 96 geometries, respectively, with 23 textures in both. The earlier 11,297–15,605 geometry counts were not reproduced in this run; their cause remains open. These samples ran the previously loaded build and overlapped development checks, so they are not a before/after performance comparison for the culling change.

Mission teardown now releases the flat/XR sky and HUD geometry/materials, inset skies, and the main scene renderer's current palette, LUMA, atlas, slot and shadow-table textures. Inset renderers borrow those textures and never dispose them; the shadow-map render target retains its own ownership. Previously the shared XR host outlived mission views whose GPU resources were not fully released.

The new `/test/browser/resourceLifetime.html` fixture recreates and renders six mission views on one persistent WebGL renderer. Before the fix, desktop GPU counters accumulated 18 geometries and 30 textures after six cycles, with four shader programs left alive. After the fix, both desktop and Quest 3 return to zero geometries, textures and programs after every cycle (each cycle allocates 9 geometries, 8 textures and 5 programs). This is a resource-lifetime regression check, not a whole-frame speedup measurement or an explanation of every large in-mission geometry count.

With USB debugging authorized and Quest Browser available, image regressions can run without wearing the headset:

1. Start a separate development server: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5175 --strictPort`.
2. Run `node tools/quest-test.mjs ../quest-test-report.json`. Set `ADB` if platform-tools is outside PATH/the usual Windows SDK location, and `ANDROID_SERIAL` if multiple devices are connected.

The runner opens and closes its own browser tab on port 5175, loads a test mission without player saves, compares 15 world images and 36 synthetic HUD images, runs the alternating lighting benchmark and checks six mission-view cleanup cycles. It keeps the installed game's origin/tab separate, uses bounded waits and removes only its own temporary ADB mappings. JSON reports belong outside the repository. No XR permission or device sleep setting is changed.

The first on-device image run passed with at most 36 differing world pixels per 640×480 view (within the existing 0.1% edge/dither tolerance) and 2 HUD pixels per 960×960 view. These Quest GPU results differ from the desktop pixel counts below. Offscreen rendering does not verify immersive entry, physical controllers, head tracking, compositor timing or sustained 90-Hz behavior. An earlier off-head attempt rejected automatic immersive entry; the later successful restart with the proximity override is documented above. Physical controller, tracking and comfort checks still need a wearer.

## Validation

Engine, app and tool/test TypeScript checks, ESLint and the production/offline build are run locally. Targeted tests cover the real pilot registry, virtual keyboard, controller neutral/release behavior, shell return without stale-click relaunch, comfort options, HUD upload reuse, cockpit-relative FPS placement, graphics settings and offline worker activation.

Batch tests cover visibility, clipped geometry/colour updates, moving parts, shadow-layer preservation, draw failure recovery, unchanged-buffer reuse and repeated effect replacement. The WebGL comparison at `/test/browser/worldBatch.html` (dev server only, separate browser context) renders reference and batched images of the same frozen mission state. In 15 AMY_SCN1 views at 640×480 it found 0–4 differing pixels per image and no shader errors; moving matrix multiplication to GPU floats can shift edge/dither pixels. One forward view fell from 133 world draw calls/2,479 submitted triangles to 2 calls/734 triangles. This does not replace testing other missions, close clipping, effects and stereo in the headset.

HUD crop checks cover window resizing, pixel-edge guards, target disappearance and cached uploads. `/test/browser/hudCrop.html` compares 36 synthetic stereo/oblique views at two source sizes (0–2 differing output pixels per 960×960 image, no shader errors). Six additional views of an AMY_SCN1 reticle drawn by the original simulation matched exactly. Both browser comparisons were rerun after changing HUD packing. The browser helper also accepts a captured `HudCapture`; an empty capture is rejected rather than counted as a successful visible-image test. The current complete unit suite passes 290 tests. The packing property test checks 100 deterministic combinations of window dimensions, palette bytes, drawn masks, layer tags and inset IDs against the previous independent byte layout, also checking the reticle centre.

Game-dependent tests require private compatible files. A previous full run passed 498 tests with one CD-image-specific golden failure: the image had a 300-sector gap where the reference expected 150. Neither image nor test was modified to conceal it. Tests requiring absent game files skip rather than establish compatibility.

The original project documentation follows in README.md; no game executables, CD images, saves or local credentials are distributed in this fork.
