/** @portOnly Input belongs to the displayed shell, never to the next process/view. */
import { hardware } from '../../shell/host/hardware.ts';

export function resetShellInput(): void {
  // A queued press/release pair is still a click even when mouseButtons is zero.
  // Leaving those pairs behind can launch the mission again on return to its setup screen.
  hardware.mouseButtonQueue.length = 0;
  hardware.mouseButtons = 0;
  hardware.keys.length = 0;
  hardware.textEntry = null;
}
