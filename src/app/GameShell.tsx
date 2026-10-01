/**
 * The game as MECH2.EXE runs it: the front end (MW2SHELL.EXE, on its
 * 640x480 screen) and the missions (MW2.EXE, in the game's view) in turn,
 * through the files they leave each other (launcher/mech2.ts). A click
 * first, so the browser lets the sound start.
 *
 * Or all of it in a headset: "Start in VR" makes the game's headset
 * (app/xrHost.ts), whose session the front end's screens and the missions
 * share, and the game starts once the headset shows it. If the session ends
 * the game goes on on the page, and a button puts it back.
 *
 * @portOnly the host of MECH2's loop
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Game } from './Game.ts';
import type { GameData } from './gameData.ts';
import { ShellView } from './shell/ShellView.tsx';
import { LaunchView } from './shell/LaunchView.tsx';
import { mountCd } from './shell/cdDrive.ts';
import { attachShellAudio } from './shell/shellAudio.ts';
import { GameView } from './GameView.tsx';
import { mech2Main } from '../launcher/mech2.ts';
import { splitCommandTail } from '../mission/commandLine.ts';
import { startShellProcess } from '../shell/boot.ts';
import { shellMain } from '../shell/main.ts';
import { ShellPump } from '../shell/host/pump.ts';
import { setOverlayFiles } from '../engine/dosFiles.ts';
import { hardware } from '../shell/host/hardware.ts';
import { XrHost, type XrHostState } from './xrHost.ts';

// Debug handle for the browser console: the front end's PC.
(window as unknown as { mw2shell: unknown }).mw2shell = { hardware };

type Showing = { kind: 'start' } | { kind: 'launch'; done: () => void } | { kind: 'shell'; pump: ShellPump; done: (status: number) => void } | { kind: 'sim' } | { kind: 'quit' };

export function GameShell({ data, game }: { data: GameData; game: Game }) {
  const [showing, setShowing] = useState<Showing>({ kind: 'start' });
  const started = useRef(false);
  const [vrSupported, setVrSupported] = useState(false);
  const [host, setHost] = useState<XrHost | null>(null);
  const [vr, setVr] = useState<XrHostState>({ on: false, pending: false });
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    void XrHost.supported().then(setVrSupported);
  }, []);
  useEffect(() => (host ? host.subscribe(setVr) : undefined), [host]);
  useEffect(() => () => host?.dispose(), [host]);

  const start = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setOverlayFiles(null);
    console.info('[shell] mounting the CD');
    await mountCd(data.install, data.cd);
    console.info('[shell] sound');
    await attachShellAudio(game);
    console.info('[shell] starting');
    await mech2Main(
      {
        shell: (arg) =>
          new Promise<number>((done) => {
            startShellProcess(data.shellExe, data.prj);
            const pump = new ShellPump(shellMain(['mw2shell.exe', arg]));
            (window as unknown as { mw2shell: { pump?: ShellPump } }).mw2shell.pump = pump;
            setShowing({ kind: 'shell', pump, done });
          }),
        sim: (argv) =>
          new Promise<number>((done) => {
            game.onMissionEnd = (r) => {
              game.onMissionEnd = null;
              done(r.exitStatus);
            };
            void game.launchStart(argv).then((finish) => {
              if (!finish) {
                game.onMissionEnd = null;
                done(0);
                return;
              }
              setShowing({
                kind: 'launch',
                done: () => {
                  setShowing({ kind: 'sim' });
                  if (!game.launchFinish(finish) && game.loadError) {
                    game.onMissionEnd = null;
                    done(0);
                  }
                },
              });
            });
          }),
      },
      splitCommandTail,
    );
    setShowing({ kind: 'quit' });
  }, [data, game]);

  /**
   * Start in VR: the sound turned on inside the click (the headset can take a minute to answer, long
   * after the click stops counting), then the game only once the headset shows it.
   */
  const startVr = useCallback(() => {
    if (started.current || host) return;
    setStartError(null);
    game.audio.enable();
    const h = new XrHost();
    setHost(h);
    void h.enter().then((entered) => {
      if (!entered) {
        game.audio.disable();
        setStartError('VR konnte nicht gestartet werden. Bitte Headset aufsetzen, die Browserfreigabe bestätigen und erneut „Start in VR“ wählen.');
        setHost(null);
        return;
      }
      return start().catch((e: unknown) => {
        console.error('[shell] start-up failed', e);
        setShowing({ kind: 'quit' });
      });
    });
  }, [game, host, start]);

  useEffect(() => {
    if (showing.kind === 'quit') host?.leave();
  }, [showing, host]);

  const onShellExit = useCallback(
    (status: number) => {
      if (showing.kind === 'shell') showing.done(status);
    },
    [showing],
  );

  useEffect(() => {
    // leaving the page mid-game is a power cut: the files already on the disk are what survives
  }, []);

  const flatStart = () =>
    start().catch((e: unknown) => {
      console.error('[shell] start-up failed', e);
      setShowing({ kind: 'quit' });
    });
  if (showing.kind === 'start' && host)
    return (
      <div className="shell-start">
        <div>{vr.pending ? 'VR-Freigabe im Headset bestätigen' : 'Starting'}</div>
        {vr.pending && <div className="hint">Bitte Headset aufsetzen. Die Browserfreigabe kann außerhalb dieses Fensters erscheinen.</div>}
      </div>
    );
  if (showing.kind === 'start')
    return (
      <div className="shell-start" onClick={flatStart}>
        <div>MechWarrior 2</div>
        {startError && <div className="hint" role="alert" onClick={e => e.stopPropagation()}>{startError}</div>}
        <div className="hint">Click to start</div>
        <a href="?setup" className="hint" onClick={e=>e.stopPropagation()}>Offline installieren / Spielstände sichern</a>
        {vrSupported && (
          <button
            className="shell-vr"
            onClick={(e) => {
              e.stopPropagation();
              startVr();
            }}
          >
            Start in VR
          </button>
        )}
      </div>
    );
  // with the game's headset: a button to leave it, or to put the game back in it once its session ended
  const vrButton = host && (
    <>
    <button className="shell-vr corner" disabled={vr.pending} onClick={() => (vr.on ? host.leave() : void host.enter())}>
      {vr.pending ? 'Waiting for the headset' : vr.on ? 'Leave VR' : 'Enter VR'}
    </button>
    {vr.error && <div role="alert" style={{ position: 'absolute', top: 60, left: 20, right: 20, background: '#101820', color: 'white', padding: 16, zIndex: 10 }}>{vr.error}</div>}
    </>
  );
  if (showing.kind === 'shell')
    return (
      <div className="shell-frame">
        <ShellView pump={showing.pump} onExit={onShellExit} host={host} />
        {vrButton}
      </div>
    );
  if (showing.kind === 'launch')
    return (
      <div className="shell-frame">
        <LaunchView onDone={showing.done} host={host} />
        {vrButton}
      </div>
    );
  if (showing.kind === 'sim')
    return (
      <div className="play-frame">
        <GameView game={game} host={host} />
        {vrButton}
      </div>
    );
  return (
    <div className="shell-start">
      <div>MechWarrior 2: 31st Century Combat</div>
      <div className="hint">Copyright (C) 1995, Activision Studios, Inc., All Rights Reserved.</div>
      <div className="hint">
        <a href="./">Play again</a>
      </div>
    </div>
  );
}
