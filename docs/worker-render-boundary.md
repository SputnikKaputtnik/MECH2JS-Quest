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
