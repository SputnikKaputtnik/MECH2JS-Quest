/** Prints diagnostic JSON to stdout; redirect to a private path outside the repo.
 * Host-only scheduling check; no GPU, WebXR, image or application FPS measurement.
 * Pass --mission to boot the real engine using MW2_ROOT, otherwise synthetic data.
 */
import { snapshotWorkerProbe } from '../test/support/snapshotWorkerProbe.ts';
console.log(JSON.stringify({ scope: 'host-worker-ownership-and-scheduling',
  ...await snapshotWorkerProbe(process.argv.includes('--mission')) }, null, 2));
