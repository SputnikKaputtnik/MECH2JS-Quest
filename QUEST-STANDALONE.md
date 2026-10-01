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
- **Y → VR Options:** FPS counter defaults ON. It is fixed to the lower-right cockpit and shows display callback frequency averaged over half a second. Ejection animation defaults OFF, with a nausea warning for enabling it. FFR defaults ON and can be toggled immediately. Render resolution offers 100–200%; changes apply on the next VR entry.

## Rendering status

The current target is **90 Hz**, requested when the runtime supports it, with a 72 Hz fallback. The initial render scale is **125% of the runtime-recommended eye buffer**, not 125% of the physical panel resolution. FFR ON preserves the renderer's existing maximum fixed-foveation setting. Higher scale presets are available for testing, not guarantees of stable performance. The simulation remains at its original configured 20 passes per second.

The first measured optimization reuses unchanged HUD pixel uploads between simulation passes. Camera tracking, world rendering, HUD placement and targeting continue every display frame. Changing window dimensions or the source window forces a fresh upload; palette changes remain independent.

Before this optimization, a 25-second Quest 3 sample at 72 Hz measured 70.9 XR callbacks/s, CPU mean 7.9 ms and p95 10.1 ms, with a combined 3360×1760 XR texture. Profiling identified repeated HUD packing as a significant CPU cost. This is one scene sample, not a general performance guarantee. GPU timing queries were unavailable on the tested browser; compositor FPS and GPU utilization have not been measured.

`window.mw2QuestPerf.reset()` starts a new sample. `snapshot()` reports callback frequency, CPU and simulation time, draw calls, triangles, actual XR layer dimensions, per-eye viewport sizes, granted refresh rate and fixed foveation. Stable 90 FPS at increased resolution still requires on-device verification across missions.

## Validation

Engine, app and tool/test TypeScript checks, ESLint and the production/offline build are run locally. Targeted tests cover the real pilot registry, virtual keyboard, controller neutral/release behavior, shell return without stale-click relaunch, comfort options, HUD upload reuse, cockpit-relative FPS placement, graphics settings and offline worker activation.

Game-dependent tests require private compatible files. A previous full run passed 498 tests with one CD-image-specific golden failure: the image had a 300-sector gap where the reference expected 150. Neither image nor test was modified to conceal it. Tests requiring absent game files skip rather than establish compatibility.

The original project documentation follows in README.md; no game executables, CD images, saves or local credentials are distributed in this fork.
