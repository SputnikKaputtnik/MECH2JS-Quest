/**
 * MW2.EXE's launch screen while its start-up runs: the launch picture in the
 * game's 640x480 window through its DAC, the launch animation stepped on the
 * original's timer (launch_anim_tick every 0x50910 us). The port's start-up
 * takes a fraction of the original's, so the screen is held up for
 * LAUNCH_MIN_MS before the rest of it runs.
 *
 * @portOnly the display during MW2.EXE's start-up
 */
import { useEffect, useRef } from 'react';
import { defaultCanvas } from '../../sim/display/video.ts';
import { palettes } from '../../sim/world/palettes.ts';
import { LAUNCH_TICK_MS, launchAnimTick } from '../../sim/display/launchScreen.ts';
import { divergence } from '../../core/provenance.ts';
import { everyFrame, type XrHost } from '../xrHost.ts';
import { LaunchPlayback } from './launchPlayback.ts';

/** How long the launch screen stays up (the original's load took several seconds). */
export const LAUNCH_MIN_MS = 2500;

const dac8 = (v: number) => ((v & 0x3f) << 2) | ((v & 0x3f) >> 4);

export function LaunchView({ onDone, host }: { onDone: () => void; host?: XrHost | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const playback = useRef<LaunchPlayback | null>(null);
  useEffect(() => {
    divergence(`the launch screen is held up for ${LAUNCH_MIN_MS} ms: the port's start-up is near instant`, 'boot_load_launch_anims');
    const cv = canvas.current!;
    const w = defaultCanvas.xMax + 1;
    const h = defaultCanvas.yMax + 1;
    cv.width = Math.max(1, w);
    cv.height = Math.max(1, h);
    const ctx = cv.getContext('2d')!;
    const fade = playback.current ??= new LaunchPlayback(palettes.dacPlayback);
    const started = performance.now();
    let animationAt = fade.durationMs;
    let ended = false;
    const paint = (elapsed: number) => {
      if (w <= 0 || h <= 0) return;
      const img = ctx.createImageData(w, h);
      const px = new Uint32Array(img.data.buffer);
      const frame = fade.at(elapsed);
      const d = frame?.dac ?? palettes.dac;
      const buffer = frame?.window.buffer ?? defaultCanvas.buffer;
      for (let i = 0; i < w * h; i++) {
        const c = buffer[i]! * 3;
        px[i] = 0xff000000 | (dac8(d[c + 2]!) << 16) | (dac8(d[c + 1]!) << 8) | dac8(d[c]!);
      }
      ctx.putImageData(img, 0, 0);
    };
    paint(0);
    const stop = everyFrame(host, now => {
      if (ended) return;
      const elapsed = Math.max(0, now - started);
      if (elapsed >= Math.max(LAUNCH_MIN_MS, fade.durationMs)) {
        ended = true;
        onDone();
        return;
      }
      if (elapsed >= animationAt + LAUNCH_TICK_MS) {
        launchAnimTick();
        animationAt = elapsed;
      }
      paint(elapsed);
    });
    // in a headset, on its panel (app/xrHost.ts)
    host?.showScreen(cv);
    return () => {
      host?.hideScreen(cv);
      stop();
    };
  }, [onDone, host]);
  return <canvas ref={canvas} className="shell-screen" />;
}
