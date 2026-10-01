import { afterEach, expect, it, vi } from 'vitest';
import type { WebGLRenderer } from 'three';

afterEach(() => vi.unstubAllGlobals());

it('starts at 125% with FFR on, changes FFR live, and applies stored resolution at the next entry', async () => {
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  vi.resetModules();
  let g = await import('../../src/app/questGraphics.ts');
  const xr = { setFramebufferScaleFactor: vi.fn(), setFoveation: vi.fn(), getFoveation: () => 1 };
  const renderer = { xr } as unknown as WebGLRenderer;
  g.prepareQuestGraphics(renderer);
  expect(xr.setFramebufferScaleFactor).toHaveBeenLastCalledWith(1.25);
  expect(xr.setFoveation).toHaveBeenLastCalledWith(1);
  g.setFixedFoveation(false); g.applyQuestFoveation(renderer);
  expect(xr.setFoveation).toHaveBeenLastCalledWith(0);
  g.setRenderScale(1.5);
  expect(xr.setFramebufferScaleFactor).toHaveBeenCalledTimes(1);
  vi.resetModules(); g = await import('../../src/app/questGraphics.ts');
  g.prepareQuestGraphics(renderer);
  expect(xr.setFramebufferScaleFactor).toHaveBeenLastCalledWith(1.5);
  expect(xr.setFoveation).toHaveBeenLastCalledWith(0);
  g.setRenderScale(99);
  expect(g.renderScale()).toBe(1.5);
});

it('requests 90 Hz only when supported, with a 72 Hz fallback', async () => {
  const { configureQuestSession } = await import('../../src/app/questSession.ts');
  const request = vi.fn(async () => {});
  await configureQuestSession({ supportedFrameRates: [72, 80, 90, 120], updateTargetFrameRate: request } as unknown as XRSession);
  expect(request).toHaveBeenLastCalledWith(90);
  await configureQuestSession({ supportedFrameRates: [72], updateTargetFrameRate: request } as unknown as XRSession);
  expect(request).toHaveBeenLastCalledWith(72);
});
