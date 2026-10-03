/** @portOnly Quest graphics preferences; framebuffer size is selected before entering XR. */
import type { WebGLRenderer } from 'three';
import { DynamicResolution } from './dynamicResolution.ts';
import { questFrameExperiment } from './questFrameExperiment.ts';
export const QUEST_TARGET_HZ = questFrameExperiment.requestedHz;
export const QUEST_RENDER_SCALES = [1, 1.25, 1.5, 1.75, 2] as const;
let foveated = true;
let dynamic = true;
const controllers = new WeakMap<WebGLRenderer, { control: DynamicResolution; supported: boolean | null }>();
let scale = 1.25;
// Wolvic Chromium 1.4 exposes requestViewportScale, but its compositor still
// samples the full eye rectangle. On Quest this produced a distorted stereo
// image; restoring scale 1 live fixed it in the headset. Do not infer support
// from API presence on this pinned runtime. Quest Browser is unaffected.
const viewportScalingBroken = typeof navigator !== 'undefined'
  && /Chrome\//.test(navigator.userAgent) && /\bWolvic\/1\.4(?:\s|$)/.test(navigator.userAgent);
export function dynamicResolutionRuntimeAvailable(): boolean { return !viewportScalingBroken; }
try {
  dynamic = localStorage.getItem('mw2.quest.dynamic-resolution') !== 'false';
  foveated = localStorage.getItem('mw2.quest.ffr') !== 'false';
  const stored = Number(localStorage.getItem('mw2.quest.render-scale'));
  if (QUEST_RENDER_SCALES.some(value => value === stored)) scale = stored;
} catch { /* defaults */ }
export function fixedFoveationEnabled(): boolean { return foveated; }
export function dynamicResolutionEnabled(): boolean { return dynamic; }
export function setDynamicResolution(enabled: boolean, persist = true): void {
  dynamic = enabled;
  if (!persist) return;
  try { localStorage.setItem('mw2.quest.dynamic-resolution', String(enabled)); } catch { /* session only */ }
}
export function dynamicResolutionStatus(renderer: WebGLRenderer) {
  const state = controllers.get(renderer);
  return { enabled: dynamic, supported: state?.supported ?? null, requestedViewportScale: state?.control.scale ?? 1 };
}
/** Requests apply on the next frame: three has already obtained this frame's viewports. */
export function updateQuestResolution(renderer: WebGLRenderer, now: number, mission: boolean): void {
  let state = controllers.get(renderer);
  if (!state) {
    state = { control: new DynamicResolution(), supported: null };
    controllers.set(renderer, state);
  }
  const session = renderer.xr.getSession();
  if (session?.visibilityState !== 'visible') { state.control.resetTiming(); return; }
  const frame = renderer.xr.getFrame();
  const reference = renderer.xr.getReferenceSpace();
  const views = frame && reference ? frame.getViewerPose(reference)?.views : null;
  if (!views?.length) { state.control.resetTiming(); return; }
  // Both XRWebGLLayer and Quest projection subimages consume the next viewport request.
  const layer = renderer.xr.getBaseLayer();
  state.supported = !viewportScalingBroken && !!layer && views.every(view => typeof view.requestViewportScale === 'function');
  const value = state.control.sample(now, session.frameRate || QUEST_TARGET_HZ, dynamic && mission && state.supported);
  if (state.supported) for (const view of views) view.requestViewportScale(value);
}
export function renderScale(): number { return scale; }
export function setFixedFoveation(enabled: boolean, persist = true): void {
  foveated = enabled;
  if (!persist) return;
  try { localStorage.setItem('mw2.quest.ffr', String(enabled)); } catch { /* session only */ }
}
export function setRenderScale(value: number, persist = true): void {
  if (!QUEST_RENDER_SCALES.some(scale => scale === value)) return;
  scale = value;
  if (!persist) return;
  try { localStorage.setItem('mw2.quest.render-scale', String(value)); } catch { /* session only */ }
}
export function applyQuestFoveation(renderer: WebGLRenderer): void {
  const value = foveated ? 1 : 0;
  if (renderer.xr.getFoveation() !== value) renderer.xr.setFoveation(value);
}
export function prepareQuestGraphics(renderer: WebGLRenderer): void {
  controllers.delete(renderer);
  renderer.xr.setFramebufferScaleFactor(scale);
  renderer.xr.setFoveation(foveated ? 1 : 0);
}
