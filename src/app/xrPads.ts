/**
 * The VR controllers' mapping onto the game's keys (app/xrInput.ts reads the
 * controllers and sends what this returns). Pure, and free of the DOM, so
 * the unit tests reach it.
 *
 * @portOnly
 */
/** One frame of both controllers, in the xr-standard gamepad mapping's terms. */
export interface PadState {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  lTrigger: number;
  lGrip: number;
  lClick: boolean;
  rTrigger: number;
  rGrip: number;
  rClick: boolean;
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
}

export const IDLE_PAD: PadState = { lx: 0, ly: 0, rx: 0, ry: 0, lTrigger: 0, lGrip: 0, lClick: false, rTrigger: 0, rGrip: 0, rClick: false, a: false, b: false, x: false, y: false };

/** an analogue input presses at PRESS and lets go below RELEASE */
const PRESS = 0.6;
const RELEASE = 0.4;
/** the right stick's dead zone */
const DEAD = 0.12;

export interface KeyChange {
  code: string;
  down: boolean;
}

/**
 * Turns controller states into key presses and releases and a torso stick.
 * Pure: the caller sends what it returns.
 */
export class PadMapper {
  private readonly held = new Set<string>();
  private torsoActive = false;
  private menuMode = false;
  private awaitNeutral = false;

  update(p: PadState, menu = false): { keys: KeyChange[]; torso: [number, number] | null } {
    if (menu !== this.menuMode) {
      this.menuMode = menu;
      this.awaitNeutral = true;
      return { keys: this.reset(), torso: [0, 0] };
    }
    if (this.awaitNeutral) {
      const neutral = Object.values(p).every(v => typeof v === 'boolean' ? !v : Math.abs(v) < 0.2);
      if (!neutral) return { keys: [], torso: null };
      this.awaitNeutral = false;
    }
    const keys: KeyChange[] = [];
    const set = (code: string, down: boolean) => {
      if (down === this.held.has(code)) return;
      if (down) this.held.add(code);
      else this.held.delete(code);
      keys.push({ code, down });
    };
    const analog = (code: string, v: number) => set(code, this.held.has(code) ? v > RELEASE : v > PRESS);
    // stick y is negative pushed forward
    analog('Equal', menu ? 0 : -p.ly);
    analog('Minus', menu ? 0 : p.ly);
    analog('ArrowLeft', -p.lx);
    analog('ArrowRight', p.lx);
    analog('ArrowUp', menu ? -p.ly : 0);
    analog('ArrowDown', menu ? p.ly : 0);
    set('Backquote', !menu && p.lClick);
    analog('Enter', menu ? Math.max(p.rTrigger, p.a ? 1 : 0) : p.lTrigger);
    analog('Digit1', menu ? 0 : p.lGrip);
    set('KeyJ', !menu && p.x);
    set('Escape', p.y || (menu && p.b));
    set('KeyM', !menu && p.rClick);
    analog('Space', menu ? 0 : p.rTrigger);
    analog('Semicolon', menu ? 0 : p.rGrip);
    set('KeyE', !menu && p.a);
    set('KeyT', !menu && p.b);
    // the torso: while deflected, and once more at rest to centre it
    const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));
    const tx = menu ? 0 : dz(p.rx);
    const ty = menu ? 0 : dz(p.ry);
    let torso: [number, number] | null = null;
    if (tx !== 0 || ty !== 0) {
      torso = [tx, ty];
      this.torsoActive = true;
    } else if (this.torsoActive) {
      torso = [0, 0];
      this.torsoActive = false;
    }
    return { keys, torso };
  }

  /** Releases everything held. */
  reset(): KeyChange[] {
    const keys = [...this.held].map((code) => ({ code, down: false }));
    this.held.clear();
    this.torsoActive = false;
    return keys;
  }
}
