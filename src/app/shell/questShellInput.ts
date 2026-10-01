/** @portOnly Controller-only shell input, including pilot-name entry. */
import { hardware, hwMouseMove, hwMouseButtons, hwKey } from '../../shell/host/hardware.ts';
import { readPads } from '../xrInput.ts';
import { IDLE_PAD, type PadState } from '../xrPads.ts';
const KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'SPACE', 'DEL', 'OK', 'CLOSE'];

export class QuestShellInput {
  private previous: PadState = { ...IDLE_PAD };
  private keyboard = false;
  private selected = 0;
  private repeatAt = 0;
  private direction = 0;
  private active = false;
  private pointerX = 320;
  private pointerY = 240;
  private cursorStarted = false;
  private awaitClickRelease = true;
  private pointerMode: 'ray' | 'stick' = 'ray';
  private stickRayAnchor: { x: number; y: number } | null = null;
  private lastKeyboardRay: { x: number; y: number } | null = null;
  private textEntry: typeof hardware.textEntry = null;

  /** Follow the actual editor, including a new field entered during pump.frame. */
  syncTextEntry(): void {
    if (this.textEntry === hardware.textEntry) return;
    this.textEntry = hardware.textEntry;
    this.keyboard = this.textEntry !== null;
    this.selected = 0;
    this.lastKeyboardRay = null;
    this.awaitClickRelease = true;
    this.direction = 0;
    this.repeatAt = 0;
    hwMouseButtons(0);
  }

  poll(session: XRSession | null, ms: number, now: number, ray?: { x: number; y: number } | null): void {
    if (!session || session.visibilityState !== 'visible') {
      if (this.active) this.release();
      return;
    }
    this.active = true;
    this.syncTextEntry();
    const p = readPads(session), old = this.previous;
    this.previous = p;
    const stick = Math.abs(p.rx) > 0.18 || Math.abs(p.ry) > 0.18;
    if (stick || ray === undefined) {
      this.pointerMode = 'stick';
      this.stickRayAnchor = ray ?? null;
    } else if (ray && (this.pointerMode === 'ray' || !this.stickRayAnchor || Math.hypot(ray.x - this.stickRayAnchor.x, ray.y - this.stickRayAnchor.y) > 40)) {
      this.pointerMode = 'ray';
      this.pointerX = ray.x; this.pointerY = ray.y; this.cursorStarted = true;
    }
    const canClick = this.pointerMode === 'stick' || !!ray;
    if (p.x && !old.x) {
      this.keyboard = !this.keyboard;
      this.awaitClickRelease = true;
      this.direction = 0;
      this.repeatAt = 0;
    }
    if (!p.a && p.rTrigger < 0.2) this.awaitClickRelease = false;
    const dx = Math.abs(p.lx) > 0.55 ? Math.sign(p.lx) : 0;
    const dy = Math.abs(p.ly) > 0.55 ? Math.sign(p.ly) : 0;
    const direction = dx || dy * 10;
    const navigate = direction !== 0 && (direction !== this.direction || now >= this.repeatAt);
    if (navigate) this.repeatAt = now + (direction !== this.direction ? 350 : 150);
    if (!direction) this.repeatAt = 0;
    this.direction = direction;
    if (this.keyboard) {
      hwMouseButtons(0);
      const column = ray ? Math.floor(ray.x / 64) : -1;
      const row = ray ? Math.floor((ray.y - 335) / 35) : -1;
      const rayKey = row >= 0 && row < 4 && column >= 0 && column < 10 ? row * 10 + column : -1;
      if (ray && this.pointerMode === 'ray' && (!this.lastKeyboardRay || Math.hypot(ray.x - this.lastKeyboardRay.x, ray.y - this.lastKeyboardRay.y) > 8)) {
        this.lastKeyboardRay = ray;
        if (rayKey >= 0) this.selected = rayKey;
      }
      if (navigate) this.selected = (this.selected + direction + KEYS.length) % KEYS.length;
      const rayPress = this.pointerMode === 'ray' && p.rTrigger > 0.6 && old.rTrigger <= 0.6 && rayKey >= 0;
      const stickPress = this.pointerMode === 'stick' && p.rTrigger > 0.6 && old.rTrigger <= 0.6;
      if (!this.awaitClickRelease && ((p.a && !old.a) || rayPress || stickPress)) {
        if (rayPress) this.selected = rayKey;
        const key = KEYS[this.selected]!;
        if (key === 'CLOSE') { this.keyboard = false; this.awaitClickRelease = true; }
        else if (key === 'OK') { hwKey(13, 0x1c); this.keyboard = false; this.awaitClickRelease = true; }
        else if (key === 'DEL') hwKey(8, 0x0e);
        else hwKey(key === 'SPACE' ? 32 : key.charCodeAt(0), 0);
      }
      if ((p.b && !old.b) || (p.y && !old.y)) { this.keyboard = false; this.awaitClickRelease = true; }
      return;
    }
    if (navigate) hwKey(0, dx < 0 ? 0x4b : dx > 0 ? 0x4d : dy < 0 ? 0x48 : 0x50);
    if (!this.cursorStarted) {
      this.pointerX = hardware.mouseX; this.pointerY = hardware.mouseY; this.cursorStarted = true;
    }
    const axis = (v: number) => Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82;
    this.pointerX = Math.max(0, Math.min(639, this.pointerX + axis(p.rx) * ms * 0.55));
    this.pointerY = Math.max(0, Math.min(479, this.pointerY + axis(p.ry) * ms * 0.55));
    hwMouseMove(this.pointerX, this.pointerY);
    hwMouseButtons(canClick && !this.awaitClickRelease && (p.rTrigger > 0.6 || p.a) ? 1 : 0);
    if ((p.b && !old.b) || (p.y && !old.y)) hwKey(27, 0x01);
    if (p.lTrigger > 0.6 && old.lTrigger <= 0.6) hwKey(13, 0x1c);
  }

  paint(ctx: CanvasRenderingContext2D): void {
    if (!this.keyboard) return;
    ctx.fillStyle = '#101820'; ctx.fillRect(0, 280, 640, 200);
    ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = '#80e8b0'; ctx.fillText(this.textEntry ? `${this.textEntry.text}_  (${this.textEntry.text.length}/${this.textEntry.maxChars})` : 'Texteingabe', 320, 301);
    ctx.fillStyle = 'white'; ctx.fillText('Zeigen + Trigger | Stick + A | X/B: schließen', 320, 325);
    for (let i = 0; i < KEYS.length; i++) {
      const x = (i % 10) * 64, y = 335 + Math.floor(i / 10) * 35;
      ctx.fillStyle = i === this.selected ? '#48b3c7' : '#263744'; ctx.fillRect(x + 2, y, 60, 31);
      ctx.fillStyle = 'white'; ctx.fillText(KEYS[i]!, x + 32, y + 21);
    }
    ctx.textAlign = 'start';
  }

  release(): void {
    hwMouseButtons(0);
    this.previous = { ...IDLE_PAD };
    this.awaitClickRelease = true;
    this.cursorStarted = false;
    this.direction = 0;
    this.repeatAt = 0;
    this.active = false;
    this.pointerMode = 'ray';
    this.stickRayAnchor = null;
    this.lastKeyboardRay = null;
  }
}
