# Standalone Android prototype

This builds **MECH2 Quest**, a separate Quest APK containing the game frontend
and a pinned Wolvic Chromium/OpenXR runtime. Quest Browser, a PC web server,
ADB reverse and an Internet connection are not needed during play. This is an
embedded web engine, not a C/C++ rewrite of the simulation.

The current package is a development prototype. Wolvic's window UI and its
first-run notices are still present before **Start in VR**. This is not yet a
polished direct-to-cockpit launcher. Embedding this runtime is not itself
claimed to improve performance over Quest Browser.

For current performance experiments, open runtime failures and measurement limits,
read the [Quest development handoff](../../docs/quest-handoff.md). The USB-served
worker test route is separate from this APK's bundled full-game frontend.

## Build

Requirements: JDK 21 on PATH, Python 3.11+, Android SDK platform 35 and build-tools
36.0.0, plus the project's normal Node build dependencies. Download the official
runtime from `runtime.json` and Apktool 3.0.3 from
<https://github.com/iBotPeaches/Apktool/releases/tag/v3.0.3>. Both SHA-256 hashes
are checked by the builder. Keep these tools, output and the development signing
key outside the repository.

From the repository root (paths are examples):

```powershell
npm run build
python native/android/build.py --runtime ../../work/android-runtime/wolvic-chromium-1.4.apk --apktool ../../work/android-runtime/apktool.jar --sdk C:/Android/Sdk --work ../../work/android-runtime
```

The builder compiles the Java host, adds the current `dist`, preserves the
upstream engine/native libraries and notices, aligns and signs the APK, verifies
the signature/alignment and writes `build-report.json`. The bundled runtime is
an explicitly pinned binary dependency; this does not compile Chromium/OpenXR
from source. `deviceVerified: false` in a build report is intentional: a
successful package build alone cannot verify headset behavior.

The development key uses Android's conventional development password. Keep it
private and retain it for updates. The development package enables remote
debugging and `run-as`; a distribution build needs a separate signing/debugging
policy. Do not publish APKs, keys, original game files or pilot backups in Git.

## Private data and installation

`MW2_ROOT` must point to a compatible private DOS install, as for the browser
build. Stage a **new** directory outside this repository:

```powershell
npx tsx tools/prepare-native-data.ts ../../work/native-game-data
python native/android/install.py --adb C:/Android/Sdk/platform-tools/adb.exe --serial YOUR_QUEST_SERIAL --apk ../../work/android-runtime/MECH2-Quest-dev.apk --data ../../work/native-game-data --work ../../work/android-runtime --launch
```

Only existing install-whitelist entries are staged. The installer validates the
chunk manifest, installs the APK, stops this app, transfers into its private
`files/game-data` directory and verifies every file's full SHA-256 on device.
It does not remove or modify Quest Browser. Reinstalling with the same signing
key preserves the app profile; uninstalling the app deletes its data.

Launch **MECH2 Quest** from the Quest library's unknown sources. On first use,
review the embedded runtime's notices, then choose **Start in VR**. Original
content is hosted read-only on `127.0.0.1:19895` inside the app process. The
listener cannot be reached from Wi-Fi; file access requires a validated manifest,
GET/HEAD, the expected Host, and non-cross-site requests. CD byte-range reads
avoid loading the entire image. Browser profiles are separate: export the old
pilot saves through the setup page before migrating them.

## Verified and remaining work

- Subsequent [collector-overhead checks](../../docs/quest-recorder-overhead.md)
  show the installed optimized frontend at 71.94–71.95 XR callbacks/s with
  10–16 long intervals per 150 seconds when logging is buffered. Periodic
  snapshots caused most of the remaining measured delays below. No APK change
  was needed for the recorder correction; compositor FPS remains unverified.
- The 2026-10-03 frontend update includes geometry reuse and a CPU-backed FPS
  canvas. A complete 72 Hz inline fixture pair improves 71.01 → 71.61 XR
  callbacks/s and 181 → 81 long entry intervals per 150 seconds. See the
  [FPS texture evidence](../../docs/quest-fps-texture.md) for protocol/limits.
  The installed update preserves all runtime/DEX hashes, 19 saved files and
  10 preferences; bundled VR startup reports visible advancing XR with two
  views. This is not compositor FPS or a new hardware GPU-budget measurement.
- Quest 3 installation, embedded OpenXR entry and both controller input sources
  have been observed. The user confirmed correct stereo after the DRS workaround.
- Migration was verified across a full app force-stop/restart: all 19 exported
  save/configuration files and the preferences survived unchanged. Import
  must finish before stopping the app; the verified migration used a strict
  IndexedDB transaction and allowed browser storage to flush before termination.
  Of the 11 browser storage entries, 10 are portable preferences. Never copy
  `mw2.quest.active-install`: it points to the old browser's OPFS directory,
  which does not exist in this app. Native content comes from the app sandbox.
  The `?native=1` startup route explicitly selects this local host, so even a
  stale copied browser-install marker cannot prevent native startup.
- Chromium 1.4 exposes viewport scaling but its compositor mishandles reduced
  eye rectangles. This version is explicitly excluded from DRS; the VR option
  reads **Dynamic resolution: unavailable**. Quest Browser remains unaffected.
- The runtime does not expose `XRSession.frameRate`/`supportedFrameRates` to this
  app. Callback FPS is measurable, but is not compositor FPS or GPU time.
- A 30-second live Goat Path sample with full 1680x1760 eye viewports measured
  73.9 XR callbacks/s and 7.45 ms mean host CPU time. This was not a controlled
  comparison with Quest Browser, and is not a sustained 90 FPS result.
- Startup UI removal, resolution parity and
  runtime performance remain integration work; keep the browser version as the
  working fallback until those checks are complete.

Run the real-socket content server tests without Android:

```powershell
mkdir ../../work/android-http-test
javac -encoding UTF-8 -d ../../work/android-http-test native/android/src/quest/mech2/LocalGameServer.java native/android/test/ContentServerTest.java
java -cp ../../work/android-http-test quest.mech2.ContentServerTest ../../work/android-http-test/data
```

## Upstream runtime

Wolvic is MPL-2.0; its original notices/assets remain in the package. Sources:

- <https://github.com/Igalia/wolvic/tree/v1.4-chromium>
- <https://github.com/Igalia/wolvic-chromium>

This integration is not affiliated with Igalia, Mozilla or the MechWarrior
rights holders. Original game data are supplied privately and never bundled.
