/** @portOnly Optional host menu scrolling and activation feedback; absent for the DOS presentation. */
import type { Menu, MenuContext } from '../../generated/classes.gen.ts';
const hosts = new WeakMap<MenuContext, { click: () => void }>();
const offsets = new WeakMap<Menu, number>();
export function setMenuPresentation(ctx: MenuContext, active: boolean, click: () => void): void {
  if (active) hosts.set(ctx, { click }); else hosts.delete(ctx);
}
export function menuPresentation(ctx: MenuContext, menu: Menu, key: number | null) {
  const host = hosts.get(ctx);
  if (!host) return null;
  // Keep the original art's six-row content area, including Back when selected.
  const rows = Math.max(1, Math.min(6, ctx.rows));
  let first = offsets.get(menu) ?? 0;
  first = Math.max(0, Math.min(first, menu.selected, menu.count - rows));
  if (menu.selected >= first + rows) first = menu.selected - rows + 1;
  offsets.set(menu, first);
  const type = menu.items[menu.selected]?.type;
  if (key === 13 || key === 27 || key === 32 || ((key === 0x99 || key === 0x98) && (type === 4 || type === 5 || type === 7))) host.click();
  return { first, end: Math.min(menu.count, first + rows), rows };
}
