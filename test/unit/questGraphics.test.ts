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
  expect(g.dynamicResolutionEnabled()).toBe(true);
  g.prepareQuestGraphics(renderer);
  expect(xr.setFramebufferScaleFactor).toHaveBeenLastCalledWith(1.25);
  expect(xr.setFoveation).toHaveBeenLastCalledWith(1);
  g.setFixedFoveation(false); g.applyQuestFoveation(renderer);
  expect(xr.setFoveation).toHaveBeenLastCalledWith(0);
  g.setRenderScale(1.5);
  expect(xr.setFramebufferScaleFactor).toHaveBeenCalledTimes(1);
  g.setDynamicResolution(false);
  vi.resetModules(); g = await import('../../src/app/questGraphics.ts');
  g.prepareQuestGraphics(renderer);
  expect(xr.setFramebufferScaleFactor).toHaveBeenLastCalledWith(1.5);
  expect(xr.setFoveation).toHaveBeenLastCalledWith(0);
  expect(g.dynamicResolutionEnabled()).toBe(false);
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

it('requests both eye viewports and restores full scale live; hidden frames do not affect cadence', async () => {
  vi.resetModules();
  const g = await import('../../src/app/questGraphics.ts');
  const views = [{ requestViewportScale: vi.fn() }, { requestViewportScale: vi.fn() }];
  const session = { visibilityState: 'visible', frameRate: 90 };
  const renderer = { xr: {
    getSession: () => session, getReferenceSpace: () => ({}),
    getFrame: () => ({ getViewerPose: () => ({ views }) }),
    getBaseLayer: () => ({ textureWidth: 4200, textureHeight: 2200 }),
  } } as unknown as WebGLRenderer;
  for (let t = 1; t < 5000; t += 20) g.updateQuestResolution(renderer, t, true);
  expect(g.dynamicResolutionStatus(renderer).requestedViewportScale).toBeLessThan(1);
  expect(views[0]!.requestViewportScale.mock.lastCall).toEqual(views[1]!.requestViewportScale.mock.lastCall);
  session.visibilityState = 'hidden';
  const before = views[0]!.requestViewportScale.mock.calls.length;
  g.updateQuestResolution(renderer, 20000, true);
  expect(views[0]!.requestViewportScale).toHaveBeenCalledTimes(before);
  session.visibilityState = 'visible';
  g.setDynamicResolution(false);
  g.updateQuestResolution(renderer, 20011, true);
  expect(views[0]!.requestViewportScale).toHaveBeenLastCalledWith(1);
  g.setDynamicResolution(true);
  g.updateQuestResolution(renderer, 20022, false);
  expect(views[0]!.requestViewportScale).toHaveBeenLastCalledWith(1);
  views[0]!.requestViewportScale = undefined!;
  g.updateQuestResolution(renderer, 20033, true);
  expect(g.dynamicResolutionStatus(renderer).supported).toBe(false);
});
