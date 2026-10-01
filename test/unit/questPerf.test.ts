import { afterEach, expect, it, vi } from 'vitest';
import type { WebGLRenderer } from 'three';
import { QuestPerf } from '../../src/app/questPerf.ts';

afterEach(() => vi.unstubAllGlobals());

it('distinguishes ended missions and stalled callbacks from live XR data, preserving historical samples', () => {
  vi.stubGlobal('window', {});
  let clock = 0;
  const session = { visibilityState: 'visible', frameRate: 90, supportedFrameRates: [90] };
  const renderer = {
    xr: { getSession: () => session, getBaseLayer: () => ({ textureWidth: 4200, textureHeight: 2200, fixedFoveation: 1 }), getCamera: () => ({ cameras: [] }) },
    info: { memory: {}, render: { calls: 10, triangles: 100 } },
  } as unknown as WebGLRenderer;
  const perf = new QuestPerf(() => clock);
  expect(perf.snapshot().status).toBe('waiting');
  for (let i = 0; i <= 60; i++) { clock = i * 1000 / 90; perf.record(clock, 5, renderer); }
  expect(perf.snapshot().status).toBe('recording');
  expect(perf.displayFps).toBeCloseTo(90);
  const historical = perf.snapshot();
  clock += 2000;
  expect(perf.snapshot().status).toBe('stale');
  expect(perf.snapshot().lastFrameAgeMs).toBe(2000);
  expect(perf.displayFps).toBeNull();
  expect(perf.snapshot().totalSamples).toBe(historical.totalSamples);
  session.visibilityState = 'hidden'; perf.record(clock, 0, renderer);
  expect(perf.snapshot().status).toBe('paused');
  session.visibilityState = 'visible'; perf.record(++clock, 5, renderer);
  expect(perf.snapshot().status).toBe('recording');
  const beforeFinish = perf.snapshot();
  perf.finish();
  expect(perf.snapshot().status).toBe('ended');
  expect(perf.displayFps).toBeNull();
  perf.record(clock + 100, 5, renderer);
  expect(perf.snapshot().totalSamples).toBe(beforeFinish.totalSamples);
  expect(perf.missionFps).toBe(beforeFinish.missionFps);
  // Diagnostic reset must not resurrect a finished mission.
  perf.reset();
  expect(perf.snapshot().status).toBe('ended');
});
