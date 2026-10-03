import { afterEach, expect, it, vi } from 'vitest';
import type { WebGLRenderer } from 'three';

afterEach(() => vi.unstubAllGlobals());

it('applies temporary runtime comparison settings without overwriting preferences', async () => {
  const stored = new Map([['mw2.quest.render-scale', '1.5'], ['mw2.quest.ffr', 'false'], ['mw2.quest.dynamic-resolution', 'true']]);
  const setItem = vi.fn((key: string, value: string) => stored.set(key, value));
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem });
  vi.resetModules();
  let g = await import('../../src/app/questGraphics.ts');
  g.setRenderScale(1, false); g.setFixedFoveation(true, false); g.setDynamicResolution(false, false);
  expect(g.renderScale()).toBe(1); expect(g.fixedFoveationEnabled()).toBe(true); expect(g.dynamicResolutionEnabled()).toBe(false);
  expect(setItem).not.toHaveBeenCalled();
  vi.resetModules(); g = await import('../../src/app/questGraphics.ts');
  expect(g.renderScale()).toBe(1.5); expect(g.fixedFoveationEnabled()).toBe(false); expect(g.dynamicResolutionEnabled()).toBe(true);
});

it('keeps full eye rectangles on Wolvic Chromium 1.4 despite its exposed viewport API', async () => {
  vi.stubGlobal('navigator', { userAgent: 'Chrome/150.0.0.0 Mobile VR Wolvic/1.4' });
  vi.resetModules();
  const g = await import('../../src/app/questGraphics.ts');
  const views = [{ requestViewportScale: vi.fn() }, { requestViewportScale: vi.fn() }];
  const renderer = { xr: {
    getSession: () => ({ visibilityState: 'visible' }), getReferenceSpace: () => ({}),
    getFrame: () => ({ getViewerPose: () => ({ views }) }),
    getBaseLayer: () => ({ framebufferWidth: 3360, framebufferHeight: 1760 }),
  } } as unknown as WebGLRenderer;
  for (let t = 1; t < 5000; t += 25) g.updateQuestResolution(renderer, t, true);
  expect(g.dynamicResolutionStatus(renderer)).toEqual({ enabled: true, supported: false, requestedViewportScale: 1 });
  expect(views[0]!.requestViewportScale).not.toHaveBeenCalled();
  expect(views[1]!.requestViewportScale).not.toHaveBeenCalled();
});

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
