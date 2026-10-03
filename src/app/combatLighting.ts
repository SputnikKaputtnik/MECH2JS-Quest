/** @portOnly Opt-in visual enhancement; the original palette remains default. */
const KEY = 'mw2.quest.combat-lighting';
let enabled = false;
try { enabled = localStorage.getItem(KEY) === 'true'; } catch { /* original look */ }
export function combatLightingEnabled(): boolean { return enabled; }
export function setCombatLighting(value: boolean): void {
  enabled = value;
  try { localStorage.setItem(KEY, String(value)); } catch { /* session only */ }
}
