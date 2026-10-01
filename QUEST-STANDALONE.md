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

A later optimization candidate is a coarse-grained C/C++ WebAssembly module for measured CPU bottlenecks, particularly fixed-point/64-bit geometry or collision work. This is an investigation direction, not a committed full-engine rewrite or a measured speedup. Keep the TypeScript implementation as the behavioral reference, batch data transfers across the JS/Wasm boundary, and establish a Quest benchmark before choosing a port. A native Android/OpenXR renderer would be a separate, larger project from a Wasm module within the current browser host.

`window.mw2QuestPerf.reset()` starts a new sample. `snapshot()` reports callback frequency, CPU and simulation time, draw calls, triangles, actual XR layer dimensions, per-eye viewport sizes, granted refresh rate and fixed foveation. Stable 90 FPS at increased resolution still requires on-device verification across missions.

## Validation

Engine, app and tool/test TypeScript checks, ESLint and the production/offline build are run locally. Targeted tests cover the real pilot registry, virtual keyboard, controller neutral/release behavior, shell return without stale-click relaunch, comfort options, HUD upload reuse, cockpit-relative FPS placement, graphics settings and offline worker activation.

Batch tests cover visibility, clipped geometry/colour updates, moving parts, shadow-layer preservation, draw failure recovery, unchanged-buffer reuse and repeated effect replacement. The WebGL comparison at `/test/browser/worldBatch.html` (dev server only, separate browser context) renders reference and batched images of the same frozen mission state. In 15 AMY_SCN1 views at 640×480 it found 0–4 differing pixels per image and no shader errors; moving matrix multiplication to GPU floats can shift edge/dither pixels. One forward view fell from 133 world draw calls/2,479 submitted triangles to 2 calls/734 triangles. This does not replace testing other missions, close clipping, effects and stereo in the headset.

Game-dependent tests require private compatible files. A previous full run passed 498 tests with one CD-image-specific golden failure: the image had a 300-sector gap where the reference expected 150. Neither image nor test was modified to conceal it. Tests requiring absent game files skip rather than establish compatibility.

The original project documentation follows in README.md; no game executables, CD images, saves or local credentials are distributed in this fork.
