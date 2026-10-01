/** @portOnly Request the display target without changing the simulation tick rate. */
import { QUEST_TARGET_HZ } from './questGraphics.ts';
export async function configureQuestSession(session: XRSession): Promise<void> {
  const rates = session.supportedFrameRates;
  const target = rates && [...rates].includes(QUEST_TARGET_HZ) ? QUEST_TARGET_HZ : 72;
  if (rates && [...rates].includes(target)) {
    try { await session.updateTargetFrameRate(target); }
    catch (error) { console.warn('[quest] frame rate request failed', error); }
  }
  console.info('[quest] session', { requestedHz: QUEST_TARGET_HZ, actualHz: session.frameRate, supportedHz: rates ? [...rates] : [] });
}
