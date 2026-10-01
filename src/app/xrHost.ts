/**
 * The headset for the whole game: one renderer and one WebXR session from
 * the start screen to the quit, through the front end, the launch screen
 * and every mission.
 *
 * A browser grants a session only from a click, and MECH2's loop goes from
 * the shell to a mission and back with none, so the session cannot belong
 * to any one view: GameShell makes the host when the player picks VR, and
 * the views borrow it.
 *
 *  - The mission's view (app/gameScreen.ts, with `host`) draws through the
 *    host's renderer and takes its frames (present).
 *  - The front end's views (app/shell/ShellView.tsx, LaunchView.tsx) paint
 *    their 640x480 canvas as always, the page showing it, and hand the host
 *    that canvas (showScreen): in the headset it is a panel in a dark room
 *    (render/xr/screenRoom.ts). The right controller's target ray is mapped
 *    through the curved panel's UVs to the original mouse coordinates.
 *    ShellView supplies clicks and a virtual keyboard for text fields.
 *  - Their frames come from the host's loop (onTick), which is the
 *    window's animation frames outside the headset and the headset's inside
 *    it: a browser may stop the window's frames while a session is on.
 *
 * When the session ends (the headset taken off, the system menu) the game
 * carries on on the page; enter() from a click puts it back.
 *
 * @portOnly the host of the game's headset
 */
import * as THREE from 'three';
import { configureQuestSession } from './questSession.ts';
import { applyQuestFoveation, prepareQuestGraphics } from './questGraphics.ts';
import { ScreenRoom, type ScreenSource } from '../render/xr/screenRoom.ts';

export interface XrHostState {
  /** a session is on */
  on: boolean;
  /** asked for, and the headset has not given it yet (the browser and the XR runtime can take a minute) */
  pending: boolean;
  /** A failed entry stays visible instead of silently continuing in 2D. */
  error?: string | null;
}

type Frame = (now: number) => void;

export class XrHost {
  readonly renderer = new THREE.WebGLRenderer({ antialias: false });
  private presenter: Frame | null = null;
  private readonly tickers = new Set<Frame>();
  private readonly room = new ScreenRoom();
  private screen: ScreenSource | null = null;
  screenPointer: { x: number; y: number } | null = null;
  private readonly pointerOrigin = new THREE.Vector3();
  private readonly pointerDirection = new THREE.Vector3();
  private readonly pointerRotation = new THREE.Quaternion();
  private state: XrHostState = { on: false, pending: false };
  private readonly listeners = new Set<(s: XrHostState) => void>();

  constructor() {
    const r = this.renderer;
    r.setPixelRatio(1);
    r.autoClear = false;
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local');
    r.setAnimationLoop(this.loop);
  }

  /** Whether this browser can give an immersive VR session. */
  static async supported(): Promise<boolean> {
    try {
      return (await navigator.xr?.isSessionSupported('immersive-vr')) ?? false;
    } catch {
      return false;
    }
  }

  get presenting(): boolean {
    return this.renderer.xr.isPresenting;
  }

  /** Calls `fn` with the state now and on every change; returns the unsubscribe. */
  subscribe(fn: (s: XrHostState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(s: Partial<XrHostState>): void {
    this.state = { ...this.state, ...s };
    for (const f of this.listeners) f(this.state);
  }

  /** Asks for the headset - from a click, or the browser refuses. True once it shows the game. */
  enter(): Promise<boolean> {
    if (this.renderer.xr.getSession()) return Promise.resolve(true);
    if (this.state.pending || !navigator.xr) return Promise.resolve(false);
    this.set({ pending: true, error: null });
    return navigator.xr
      .requestSession('immersive-vr', { optionalFeatures: ['local'] })
      .then(async (session) => {
        session.addEventListener('end', this.onEnd, { once: true });
        prepareQuestGraphics(this.renderer);
        await this.renderer.xr.setSession(session);
        await configureQuestSession(session);
        this.set({ on: true, pending: false });
        return true;
      })
      .catch((err: unknown) => {
        console.warn('VR session refused', err);
        const detail = err instanceof Error ? err.message : String(err);
        this.set({ pending: false, error: `VR-Start fehlgeschlagen: ${detail}. Bitte das Spielfenster im aufgesetzten Headset öffnen und erneut versuchen.` });
        return false;
      });
  }

  /** Ends the session; the game carries on on the page. */
  leave(): void {
    void this.renderer.xr.getSession()?.end();
  }

  private readonly onEnd = (): void => {
    this.set({ on: false });
  };

  /** The mission's view takes every frame (null: it has closed). */
  present(frame: Frame | null): void {
    this.presenter = frame;
  }

  /** `fn` every frame, before anything is drawn; returns the unsubscribe. */
  onTick(fn: Frame): () => void {
    this.tickers.add(fn);
    return () => this.tickers.delete(fn);
  }

  /** The canvas the headset's panel shows. */
  showScreen(canvas: ScreenSource): void {
    this.screen = canvas;
  }

  /** Takes the panel down, if it still shows `canvas`. */
  hideScreen(canvas: ScreenSource): void {
    if (this.screen === canvas) this.screen = null;
  }

  private readonly loop = (now: number, frame?: XRFrame): void => {
    this.screenPointer = null;
    this.room.pointAt(null);
    const session = this.renderer.xr.getSession();
    if (session) applyQuestFoveation(this.renderer);
    const reference = this.renderer.xr.getReferenceSpace();
    if (frame && reference && this.screen && !this.presenter && session?.visibilityState === 'visible') {
      const right = [...session.inputSources].find(s => s.handedness === 'right');
      const pose = right ? frame.getPose(right.targetRaySpace, reference) : null;
      this.room.show(this.screen);
      if (pose) {
        const p = pose.transform.position, q = pose.transform.orientation;
        this.pointerOrigin.set(p.x, p.y, p.z);
        this.pointerRotation.set(q.x, q.y, q.z, q.w);
        this.pointerDirection.set(0, 0, -1).applyQuaternion(this.pointerRotation);
        this.screenPointer = this.room.pointAt(this.pointerOrigin, this.pointerDirection);
      }
    }
    for (const t of [...this.tickers]) t(now);
    if (this.presenter) {
      this.presenter(now);
      return;
    }
    if (!this.presenting) return;
    const { room, renderer } = this;
    room.show(this.screen);
    renderer.clear();
    renderer.render(room.scene, room.camera);
  };

  dispose(): void {
    this.leave();
    this.renderer.setAnimationLoop(null);
    this.room.dispose();
    this.renderer.dispose();
  }
}

/**
 * `fn` every display frame until the returned stop: from the host's loop when
 * there is one (the headset's frames while it is on), from the window's
 * animation frames otherwise.
 */
export function everyFrame(host: XrHost | null | undefined, fn: Frame): () => void {
  if (host) return host.onTick(fn);
  let raf = requestAnimationFrame(function tick(now) {
    fn(now);
    raf = requestAnimationFrame(tick);
  });
  return () => cancelAnimationFrame(raf);
}
