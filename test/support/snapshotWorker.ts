/** Real worker fixture. SharedArrayBuffer gates the deliberate stall in tests
 * only; the snapshot protocol itself uses transferable ArrayBuffers. */
import { parentPort, workerData } from 'node:worker_threads';
import { SnapshotProducer, type SnapshotRelease } from '../../src/engine/snapshotMailbox.ts';

const port = parentPort!;
const gate = new Int32Array(workerData.gate as SharedArrayBuffer);
const mission = workerData.mission as boolean;
let tick = 0;
let step = () => {};
let camera = () => [0, 0, 0, 0, 0, 0];

if (mission) {
  const [{ gameSource, installFiles, hasGameData }, { ExeImage }, { ProjectFile }, { bootMission },
    { ailTimerService }, { mainLoopFrame }, { cameraGlobals }] = await Promise.all([
    import('./env.ts'), import('../../src/data/exe/ExeImage.ts'), import('../../src/data/prj/ProjectFile.ts'),
    import('../../src/mission/load.ts'), import('../../src/engine/miles/ail.ts'),
    import('../../src/mission/mainLoop.ts'), import('../../src/sim/camera/viewer.ts'),
  ]);
  if (!hasGameData) throw Error('MW2_ROOT game data missing');
  const exe = ExeImage.fromExe(await gameSource().read('MW2.EXE'));
  const prj = new ProjectFile(await gameSource().read('MW2.PRJ'));
  bootMission({ exe, prj, looseFiles: installFiles(), mission: 'AMY_SCN1' });
  step = () => { for (let i = 0; i < 10; i++) ailTimerService(); mainLoopFrame(); };
  camera = () => {
    const v = cameraGlobals.mainViewer;
    return [v.posX, v.posY, v.posZ, v.yaw, v.pitch, v.roll];
  };
}

const producer = new SnapshotProducer<{ tick: number; mission: boolean }>('worker-probe', 64, (m, transfer) => port.postMessage(m, transfer));
function publish() {
  step();
  tick++;
  producer.publish({ tick, mission }, b => {
    const values = new Float64Array(b);
    values.set(camera());
    values[6] = tick;
    values[7] = -tick;
  });
}
port.on('message', (message: SnapshotRelease | { kind: 'stall' | 'step' }) => {
  if (message.kind === 'snapshot-release') producer.release(message);
  else if (message.kind === 'step') publish();
  else {
    Atomics.store(gate, 0, 1);
    port.postMessage({ kind: 'stalled' });
    const deadline = performance.now() + 5000;
    // Synchronous CPU work: no messages/timers can run on this thread meanwhile.
    while (Atomics.load(gate, 0) === 1) {
      if (performance.now() > deadline) throw Error('Stall gate was not released');
    }
    port.postMessage({ kind: 'resumed' });
  }
});
publish();
