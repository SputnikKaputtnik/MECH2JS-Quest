/** @portOnly Fingertip contact with a cockpit button; coordinates in metres relative to its face. */
export class PhysicalPress {
  pressed = false;
  private armed = false;
  private previous: { x: number; y: number; z: number } | null = null;
  reset(): void { this.pressed = this.armed = false; this.previous = null; }
  update(point: { x: number; y: number; z: number } | null, width: number, height: number): boolean {
    if (!point) { this.reset(); return false; }
    const { x, y, z } = point, old = this.previous;
    this.previous = { x, y, z };
    if (old && Math.hypot(x-old.x, y-old.y, z-old.z) > 0.35) {
      this.pressed = this.armed = false;
      return false;
    }
    const inside = Math.abs(x) <= width/2 + 0.008 && Math.abs(y) <= height/2 + 0.008;
    if (z >= 0.035) { this.armed = true; this.pressed = false; }
    if (!inside || z < -0.06) this.pressed = false;
    if (!this.armed || !old || old.z <= 0.006 || z > 0.006) return false;
    const t = (old.z - 0.006) / (old.z - z);
    const hitX = old.x + (x-old.x)*t, hitY = old.y + (y-old.y)*t;
    this.armed = false;
    if (Math.abs(hitX) > width/2 + 0.008 || Math.abs(hitY) > height/2 + 0.008) return false;
    this.pressed = inside && z >= -0.06;
    return true;
  }
}
