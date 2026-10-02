# Simulation worker / render boundary

This is an isolated development path, not the gameplay renderer. The installed
Quest app still runs simulation and presentation on its main JavaScript thread.

## Current contract

- `SnapshotProducer` / `SnapshotConsumer` use three transferable buffers and a
  latest-frame mailbox. A full pool skips publication; consumers never queue
  old frames. Ownership is scoped to an epoch.
- `captureWorldState` retains all world objects and LODs, cockpit/backdrop,
  object transforms, polygon ownership, viewer state, drawing configuration,
  lighting and CPU-backed indexed textures. It does not retain simulation
  pointers. Map hooks are rejected because radar/allegiance state is not captured.
- `WorldStateRenderer` prepares this owned scene against a fresh camera. It can
  change view direction while the simulation worker is blocked. Legacy drawing
  globals are installed synchronously and restored in `finally`.
- World packet version 3 assigns producer-local weak object identities.
  `WorldStateRenderer.apply` updates existing objects, LOD blocks and vertices.
  Transforms, normals and drawing state preserve GPU geometry. Vertex/UV or
  topology changes invalidate only that object's cached meshes. Removed objects
  are evicted from both world and cockpit caches, including objects leaving the
  cockpit but still referenced elsewhere. Recreate the consumer for a new epoch.
- Indexed texture objects and uniform holders persist. Equal pixels require no
  upload; changed pixels update the existing texture. Storage/format changes
  release the GPU allocation before uploading again with the same holder.
- The full binary packet is the correctness reference. The resource variant
  sends an immutable basis once, reliably, before any lossy mailbox messages.
  Every subsequent packet contains complete metadata and either baseline
  references or inline binary arrays. It never depends on the previous frame.

## Resource ownership and dropped frames

Create a `ResourcePacketEncoder` and matching `ResourcePacketDecoder` with a
unique mission/session epoch. Transfer `encoder.initial` once outside the frame
mailbox; initialize the decoder before accepting frames. Then encode each state
with `encoder.encode(state)` and decode only the newest acquired frame.

Array positions are lookup hints, not identity guarantees: type, length and
every byte must match before a baseline reference is emitted. Object insertion,
removal, reordering, geometry edits and texture changes therefore fall back to
inline data. Changes repeat in later frames until they return to the basis.
Missing any number of earlier frames cannot lose an update. The basis never
grows and never advances in response to ACKs. Starting a new mission requires
fresh endpoints, a new epoch and a new basis; this version does not rebase an
active session.

Decoded arrays own their storage. Neither a recycled transport buffer nor
render-time vertex/texture mutation can corrupt the cached basis. The world
packet embeds texture arrays directly so their binary contents can be reused
independently of changing camera state and Three.js serialization UUIDs.

## Validation on Quest 3, embedded Wolvic runtime

`tools/quest-test.mjs <private-report.json> --resource-snapshot` uses a separate
Vite fixture on port 5175. Set `QUEST_CDP_SOCKET=content_shell_devtools_remote`
to test the embedded runtime. It requires the app to be idle at Start in VR,
temporarily navigates that page, and restores it afterward. The fixture does
not load player saves. Private logs and game data stay outside this repository.

On 2026-10-02, the AMY_SCN1 fixture produced 189 exact image matches across three
simulation phases, seven yaw angles, three pitches and left/right/stereo views.
The resource test deliberately changes palette pixels after the basis and
discards an intermediate publication before comparing the next one.

| Phase | Full packet bytes | Resource frame bytes |
| --- | ---: | ---: |
| 0 | 5,690,480 | 673,464 |
| 1 | 5,690,824 | 921,408 |
| 2 | 5,690,928 | 921,512 |

The one-time basis was 5,690,536 bytes. These particular subsequent packets are
83.8–88.2% smaller; this is not a general bandwidth or CPU benchmark. An actual
worker probe also discarded two mailbox publications, adopted the third, then
made 58 offscreen submissions with changing views during a 600 ms producer
stall. Those submissions are **not XR frames or display FPS**.

The follow-up persistent-consumer test extends this to six simulation phases:
378 exact image comparisons, 60 repeated state adoptions with unchanged geometry
IDs and texture versions, and six complete scene retirement/restoration cycles
without GPU-resource growth. The fixture retains 200–204 scene geometries as
objects appear during the mission; renderer texture count stays at 11 (including
the separate reference renderer and render target). Retirement can reduce the
uploaded geometry count because previously viewed LODs are uploaded lazily again.
The worker probe now adopts the first snapshot, skips the second, updates the
same renderer with the third, and continues drawing during the producer stall.

## Remaining work

Capture still walks/copies the full scene, compares arrays and encodes metadata.
Decoding still copies arrays and parses temporary resource descriptions; applying
a state still compares and copies CPU fields. GPU geometry and texture reuse
is verified, but its effect on CPU frame time has not been benchmarked. Smaller
dynamic state, frame-budget measurements, and gameplay integration remain necessary. The worker
test does not yet provide gameplay input, audio/HUD delivery, shell transitions,
map rendering, or enhancement passes. No 90 Hz XR result is claimed.

## Continuous mission experiment

`src/app/missionWorker.ts` now runs AMY_SCN1 continuously with a 20 Hz target,
182 Hz timer accounting, bounded catch-up and the three-slot mailbox. Snapshot
capture happens inside `publish`, so a full pool skips extraction as well as
transfer. Buffers are capped at 16 MiB each; oversize packets fail explicitly.
The one-shot worker must be recreated for each mission epoch.

`WorkerControlSender` preserves up to 64 ordered key edges behind one outstanding
message, coalesces stick samples, and uses acknowledgements/heartbeats. Overflow
fails closed and requests release. The worker also releases controls after a
500 ms input timeout. Keys go through the existing host scancodes. The packet
includes owned HUD index/mask/layer/inset planes, but this is not yet a complete
HUD renderer: inset scene snapshots, audio, menus/shell lifecycle and comfort
policies must be connected before selecting it for actual gameplay.

Run `tools/quest-test.mjs <private-report.json> --continuous-worker`. It applies
the accepted PadMapper's throttle input and release, checks their effects on
the simulation controls, advances real mission state, injects a 600 ms worker
stall, and verifies independent offscreen drawing and an acknowledged stop.

The first six-second embedded-runtime run exposed why the full reference codec
must not ship as the per-step production path. Average costs on that run were
2.38 ms simulation, 222.36 ms capture, 113.67 ms encoding, 28.26 ms decoding and
28.67 ms adoption. Keeping texture pixels binary instead of allowing Three's
TextureSource serializer to expand them with Array.from, and comparing resource
bytes by words, yielded this follow-up:

| Stage | Mean ms | p95 ms |
| --- | ---: | ---: |
| Simulation | 1.97 | 3.30 |
| Capture | 8.48 | 12.60 |
| Encoding | 17.34 | 21.40 |
| Decoding on presenter | 25.42 | 28.80 |
| Adoption on presenter | 18.84 | 36.90 |

This is a short diagnostic run, not a controlled XR performance benchmark. The
faster worker delivered 90 adopted snapshots instead of 17, but more frequent
44 ms decode/adoption work reduced offscreen drawing opportunities. Offloading
simulation alone therefore does not solve frame pacing with this codec. The
next production boundary must send versioned assets only when changed and
compact binary dynamic state, avoiding full-scene capture/JSON/object traversal
on every simulation step. The full codec remains the image-correctness oracle.


## Compact binary presenter channel (2026-10-02)

`CompactWorldEncoder` / `CompactWorldRenderer` retain the one-time full world
basis, then carry numeric viewer/object state, stable draw-list IDs, versioned
mesh definitions, indexed textures and owned HUD planes in a binary frame.
There is no JSON parse or Three ObjectLoader on this frame path. Retained meshes
are not visited vertex-by-vertex by adoption. Changed transforms invalidate the
consumer's derived world coordinates; view-dependent preparation refreshes them.

Each publication is independent of earlier publications: changed definitions
repeat inline, while the consumer decodes each revision only once. The encoder
retains the latest asset for each live object and removes retired objects; the
consumer retains the fixed initial basis plus current live meshes. Texture
revisions similarly skip repeated decoding/uploads. A revision is never reused
after object retirement. The enclosing mailbox supplies epoch isolation and
three bounded 16 MiB transfer slots. Texture sampler changes require a new basis
and fail explicitly; maps, enhancement resources and shadow maps remain excluded.

This is still a prototype: producer capture walks the world to discover changes
and creates reference resource metadata. Revision comparison replaces full frame
serialization but does not yet use mutation hooks or an asset-acknowledgement
protocol. HUD planes are copied to consumer-owned storage; they are not yet
integrated with the production VR HUD. Normal gameplay does not select this worker.

Autonomous embedded-Quest tests:

- `--compact-worker`: same six-second throttle/release and 600 ms stall protocol
  as `--continuous-worker`, with the compact channel selected.
- `--compact-combat`: twenty seconds, waits for the mech to power up, presses and
  releases the mapped right trigger, requires actual player projectiles and
  independent draws during the stall. The test initially exposed that the cold
  mech suppresses fire before status 2; it now waits instead of altering the sim.
- `--compact-snapshot`: 378 exact pixel comparisons across six mission phases,
  yaw/pitch changes and mono/stereo views. Includes palette changes and discarded
  publications. No live world roots are available while the snapshot prepares.
- Unit regressions cover asset retention, reordered lists, dropped asset changes,
  deletion/reappearance, births, baked vertices, texture resizing, HUD/texture
  ownership after buffer reuse, sampler rejection and malformed frames.

The final paired short runs used the same runtime, mission and input schedule.
They are wall-clock-driven runs, not identical recorded simulation states:

| Stage (CPU milliseconds) | Reference mean / p95 | Compact mean / p95 |
| --- | ---: | ---: |
| Simulation | 2.02 / 3.30 | 2.24 / 3.30 |
| Producer capture | 7.16 / 10.50 | 9.46 / 11.10 |
| Producer encoding | 18.33 / 23.80 | 5.61 / 6.70 |
| Presenter decoding + adoption | 43.66 / 58.30 | 2.54 / 3.40 |
| Per-draw scene preparation | 1.26 / 2.00 | 1.27 / 2.10 |
| Per-draw WebGL submission | 1.03 / 1.30 | 1.00 / 1.40 |

The twenty-second firing run adopted 391 states, observed up to three concurrent
player projectiles, and submitted 54 offscreen views during the 600 ms worker
stall. Adoption mean/p95/max was 2.49/3.20/9.60 ms. Thus the 1�2 ms adoption target
is not yet met consistently. Initial drawing also includes large shader/cache
startup costs (submission maximum about 44 ms); sustained headroom must be
verified separately. The short compact run adopted 111 states versus 107 in the
reference run; no queue backlog or stop failure was observed.

All these draws use a 320x240 offscreen target (image comparisons use 640x480).
Submission time is CPU time, **not GPU time**. None of these figures establishes
90 Hz XR presentation, native-resolution headroom, production cockpit integration
or long-combat stability. Full immutable reference snapshots remain the correctness
oracle; private raw reports remain outside the repository.
