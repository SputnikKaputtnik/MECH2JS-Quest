/** @portOnly Quest graphics preferences; framebuffer size is selected before entering XR. */
import type { WebGLRenderer } from 'three';
export const QUEST_TARGET_HZ = 90;
export const QUEST_RENDER_SCALES = [1, 1.25, 1.5, 1.75, 2] as const;
let foveated = true;
let scale = 1.25;
try {
  foveated = localStorage.getItem('mw2.quest.ffr') !== 'false';
  const stored = Number(localStorage.getItem('mw2.quest.render-scale'));
  if (QUEST_RENDER_SCALES.some(value => value === stored)) scale = stored;
} catch { /* defaults */ }
export function fixedFoveationEnabled(): boolean { return foveated; }
export function renderScale(): number { return scale; }
export function setFixedFoveation(enabled: boolean): void {
  foveated = enabled;
  try { localStorage.setItem('mw2.quest.ffr', String(enabled)); } catch { /* session only */ }
}
export function setRenderScale(value: number): void {
  if (!QUEST_RENDER_SCALES.some(scale => scale === value)) return;
  scale = value;
  try { localStorage.setItem('mw2.quest.render-scale', String(value)); } catch { /* session only */ }
}
export function applyQuestFoveation(renderer: WebGLRenderer): void {
  const value = foveated ? 1 : 0;
  if (renderer.xr.getFoveation() !== value) renderer.xr.setFoveation(value);
}
export function prepareQuestGraphics(renderer: WebGLRenderer): void {
  renderer.xr.setFramebufferScaleFactor(scale);
  renderer.xr.setFoveation(foveated ? 1 : 0);
}
