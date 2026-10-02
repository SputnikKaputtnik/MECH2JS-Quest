/** ScreenRoom reports fixed 640x480 coordinates regardless of source pixels. */
export const RESTART_RECT = { x: 100, y: 245, w: 440, h: 78 };
export class EndPanelInput {
  private armed = false;
  reset() { this.armed = false; }
  static contains(point: { x: number; y: number } | null): boolean {
    const r = RESTART_RECT;
    return !!point && point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h;
  }
  update(visible: boolean, point: { x: number; y: number } | null, trigger: number, confirm: boolean): boolean {
    if (!visible) { this.reset(); return false; }
    if (trigger < 0.2 && !confirm) { this.armed = true; return false; }
    if (!this.armed || (trigger <= 0.65 && !confirm)) return false;
    this.armed = false;
    return confirm || EndPanelInput.contains(point);
  }
}
