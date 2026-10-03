# Optional weapon and explosion lighting — 2026-10-03

The user has moved the focus from further FPS tuning to visual refinement.
The Quest is still reserved for another project. This feature was developed
and checked locally, with no ADB/CDP/device access and no APK installation.

## Player-facing behaviour

**VR Options → Weapon & explosion lights** is a persistent, initially **OFF**
toggle (`mw2.quest.combat-lighting`). It applies on the next rendered frame;
no mission/VR restart is needed. OFF preserves the existing renderer output.
Modern desktop rendering also respects the saved option; Faithful desktop
mode does not apply it. The setting is included in `QuestPerf.snapshot()`
as `combatLighting` for interpreting future captures.

When enabled, large/medium/small lasers and their pulse variants cast coloured
light along the actual original laser model. Its local endpoints, current
world transform and palette colour determine the source. Explosions use a
short warm flash, or cool light for the original electrical-effect family,
with quadratic decay over at most 0.75 seconds. Laser impacts get a smaller
warm flash. Effect lifetime follows simulation time: pausing also pauses the
flash. Expired/inactive effects and disabled lighting leave no active lights.

The first version illuminates indexed world surfaces, including terrain,
mechs and the enhanced ground grid. It does not add lighting to the separate
hand-built cockpit material, gloves, HUD or cockpit screens. Original sprites,
indexed target/map readbacks, the sky fill and outlines retain their existing
output. No new explosion textures, transparency treatment or bloom is included.

## Implementation and boundaries

`render/enhance/combatLights.ts` reads the existing projectile/effect pools;
it does not modify simulation state, damage, projectile timing or controls.
The DOS weapon table identifies laser projectile kinds 0/1/2. Their model's
local Z bounds provide the beam segment, converted from left-handed centimetres
to Three's metres. Colours come from that model's original palette indices.
Missiles, bullets and debris are not treated as glowing laser beams.

Up to four sources are selected by intensity and distance relative to their
radius. Fixed uniform arrays are shared by the existing indexed materials and
world batches. Lighting runs in their existing fragment pass, with surface
normal response, smooth bounded distance falloff and bounded brightening of
the original RGB. It adds no draws, per-light render targets or shadow passes.
The limit bounds work even during a large salvo, but a fifth source can replace
one already selected; selection transitions are not smoothed yet.

These local lights are **unshadowed**. Face orientation prevents illumination
of the opposite face, but intervening objects do not occlude light. This can
produce light through nearby walls and needs evaluation in urban missions.
The original global explosion-light/palette behaviour remains active beneath
the optional local effect. This is a restrained RGB enhancement, not strictly
256-colour output when enabled.

## Verification

- 140 focused tests pass, including actual DOS mission/menu navigation,
  persistent toggle activation and scrolling, light collection/expiry/capacity,
  centimetre/handedness/rotation conversion, world batching, snapshot compatibility,
  cockpit geometry and cockpit screen batching.
- Scoped lint, engine/app/tool TypeScript, WASM consistency and production
  frontend/offline build pass.
- Desktop Chrome/SwiftShader WebGL fixture at 512×384: disabled output is
  byte-identical to the previous shader from `32de7d1`. Enabled batching is
  byte-identical to unbatched lighting, including two simulated eye positions.
  310,132 bytes change when the light is enabled. Rear-facing light and expired
  flash return to the original pixels; indexed inset output is unchanged.
- A frozen full AMY_SCN1 mission with a placed original laser and explosion,
  at 800×600, supplies two actual light sources. Enabling changes 359,088 bytes;
  disabling restores the previous image exactly. The two images were visually
  inspected: blue light along the beam and warm light around the explosion,
  with original landscape facets and sprites preserved. This uses a separate
  elevated camera outside the player's opaque chassis, not the cockpit or XR.

Browser fixtures are in `test/browser/combatLights.ts`. For the shader fixture,
pass the previous `fragmentShader` string to `runCombatLightImages()`. The
mission fixture is `runCombatMissionImages()`; require `valid === true`, do
not count blank comparisons as passes. A first camera inside the player's
opaque chassis produced zero changed bytes and was rejected before moving
the test camera. All final comparisons use the corrected camera.

Private evidence outside the repository: workspace
`outputs/combat-lights-webgl-20261003.json`,
`outputs/combat-mission-local-20261003.json`,
`outputs/combat-{lights,mission}-image{On,Off}-20261003.png`.
Helpers in `work/test-combat-{lights,mission}.mjs` use only a dedicated
localhost server on port 5186. The existing device-facing server is untouched.

**Pending:** headset visual/comfort review in a normal combat run, including
rapid salvos, dark/snow/urban missions and actual GPU/frame pacing cost at the
accepted resolution. No new Quest FPS or GPU-budget claim follows from these
offline checks. The installed APK remains source `6e5f9e6`; this feature and
the preceding trace-storage change are source/build only for now. Do not
access the Quest until a new exclusive test window is agreed.
