import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FORMATION_LIST } from '../../domain/formations';
import type { Formation, Tactics as T } from '../../domain/types';
import { MAX_SUBS } from '../../domain/types';
import { MatchAudio } from '../../presentation/audio';
import { commentary, isHighlight } from '../../presentation/commentary';
import { PitchRenderer } from '../../presentation/renderer';
import { DT, clockDigits, clockLabel, type MatchEngine, type MatchEvent } from '../../simulation/match/engine';
import { applyResult, createMatch, userClub } from '../../simulation/world/season';
import { Icon } from '../components/Icons';
import { useStore, useWorld } from '../store';
import { accent, contrastText } from '../theme';
import { INSTRUCTIONS, InstructionRow } from './Tactics';

interface FeedItem {
  ev: MatchEvent;
  text: string;
}

const SPEEDS = [
  { v: 6, label: '0.5×' },
  { v: 12, label: '1×' },
  { v: 24, label: '2×' },
  { v: 48, label: '4×' },
];

export function MatchScreen() {
  const store = useStore();
  const world = useWorld();
  const fixture = world.fixtures.find((f) => f.id === store.params.fixture)!;
  const club = userClub(world)!;
  const userTeam: 0 | 1 = fixture.home === club.id ? 0 : 1;

  const engineRef = useRef<MatchEngine | null>(null);
  if (!engineRef.current) engineRef.current = createMatch(world, fixture, true);
  const m = engineRef.current;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PitchRenderer | null>(null);
  const audioRef = useRef<MatchAudio>(new MatchAudio());
  const display = useRef(0);
  const processed = useRef(0);
  const searchIdx = useRef(0);
  const windowRef = useRef<{ start: number; end: number } | null>(null);
  const replayRef = useRef<{ from: number; to: number; ret: number } | null>(null);
  const appliedRef = useRef(false);

  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(world.settings.matchSpeed);
  const [mode, setMode] = useState<'full' | 'highlights'>(world.settings.playbackMode);
  const [view, setView] = useState<'broadcast' | 'tactical'>(world.settings.viewMode);
  const [tab, setTab] = useState<'feed' | 'stats' | 'subs' | 'tactics'>('feed');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [hud, setHud] = useState({ clock: 0, half: 1 as 1 | 2, score: [0, 0] as [number, number], skipping: false, replay: false });
  const [banner, setBanner] = useState<{ team: 0 | 1; text: string; sub: string } | null>(null);
  const [finished, setFinished] = useState(false);
  const [sound, setSound] = useState(world.settings.sound);
  const [, force] = useState(0);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const kits = useMemo(() => [m.teams[0].input.kit, m.teams[1].input.kit] as const, [m]);
  const teamName = (t: 0 | 1) => m.teams[t].input.name;
  const teamShort = (t: 0 | 1) => m.teams[t].input.short;

  // Renderer setup
  useEffect(() => {
    const canvas = canvasRef.current!;
    const r = new PitchRenderer(canvas, {
      kits: [kits[0], kits[1]],
      entities: [0, 1].map((t) => m.teams[t as 0 | 1].players.map((p) => ({ number: p.number, keeper: p.natPos === 'GK', name: p.name, id: p.id }))) as any,
    });
    r.reducedMotion = world.settings.reducedMotion;
    rendererRef.current = r;
    const ro = new ResizeObserver(() => r.resize());
    ro.observe(canvas);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.mode = view;
  }, [view]);

  // Audio
  useEffect(() => {
    const a = audioRef.current;
    a.enabled = sound;
    if (sound) a.start();
    a.setEnabled(sound);
  }, [sound]);
  useEffect(() => () => audioRef.current.stop(), []);

  // Pause when hidden
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) setPaused(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    audioRef.current.pause(paused);
  }, [paused]);

  const handleEvent = useCallback(
    (ev: MatchEvent) => {
      const text = commentary(ev, m);
      if (text) setFeed((f) => [{ ev, text }, ...f].slice(0, 120));
      const a = audioRef.current;
      if (ev.type === 'goal') {
        const scorer = ev.player ? m.playerById(ev.player) : undefined;
        setBanner({ team: ev.team as 0 | 1, text: 'GOAL', sub: `${scorer?.name ?? ''} ${clockLabel(ev.clock, ev.half)}` });
        setTimeout(() => setBanner(null), 3400);
        a.swell(ev.team === 0 ? 0.55 : 0.3, 4);
      } else if (ev.type === 'shot' && (ev.xg ?? 0) > 0.15) a.swell(0.18, 1.5);
      else if (ev.type === 'save' || ev.type === 'post') a.swell(0.22, 1.5);
      if (ev.type === 'foul' || ev.type === 'offside' || ev.type === 'kickoff') a.whistle(false);
      if (ev.type === 'halftime' || ev.type === 'fulltime') a.whistle(true);
    },
    [m],
  );

  // Main loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let hudT = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const r = rendererRef.current;
      let skipping = false;
      const rp = replayRef.current;
      if (rp) {
        display.current += (dt * 1.0) / DT;
        if (display.current >= rp.to) {
          display.current = rp.ret;
          replayRef.current = null;
        }
      } else if (!pausedRef.current) {
        if (modeRef.current === 'full') {
          const target = display.current + (dt * speedRef.current) / DT;
          let budget = 4000;
          while (m.frameCount - 1 < Math.ceil(target) + 1 && !m.finished && budget-- > 0) m.step();
          display.current = Math.min(target, m.frameCount - 1);
        } else {
          const w = windowRef.current;
          if (w) {
            let budget = 400;
            while (m.frameCount - 1 < Math.min(w.end, display.current + 4) && !m.finished && budget-- > 0) m.step();
            display.current = Math.min(display.current + (dt * 1.7) / DT, m.frameCount - 1);
            if (display.current >= w.end - 0.01 || (m.finished && display.current >= m.frameCount - 1.01)) windowRef.current = null;
          } else {
            skipping = true;
            let budget = 1800;
            let found: MatchEvent | null = null;
            while (!found && budget-- > 0) {
              while (searchIdx.current < m.events.length) {
                const ev = m.events[searchIdx.current++];
                if (isHighlight(ev) && ev.tick > display.current) {
                  found = ev;
                  break;
                }
              }
              if (found || m.finished) break;
              m.step();
            }
            if (found) {
              const start = Math.max(display.current, found.tick - 55);
              windowRef.current = { start, end: found.tick + (found.type === 'goal' ? 30 : 18) };
              display.current = start;
            } else if (m.finished) {
              display.current = m.frameCount - 1;
            } else {
              display.current = Math.max(display.current, m.frameCount - 2);
            }
          }
        }
      }

      // Events up to the displayed moment (never during a replay).
      if (!replayRef.current) {
        while (processed.current < m.events.length && m.events[processed.current].tick <= display.current) handleEvent(m.events[processed.current++]);
      }

      const i = Math.floor(display.current);
      const fa = m.frame(Math.min(i, m.frameCount - 1));
      const fb = m.frame(Math.min(i + 1, m.frameCount - 1));
      if (r && fa) r.render(fa, fb, display.current - i, dt);

      hudT += dt;
      if (hudT > 0.1 && fa) {
        hudT = 0;
        const lastEv = m.events[processed.current - 1];
        setHud({ clock: fa.clock, half: fa.half, score: lastEv?.score ?? [0, 0], skipping, replay: !!replayRef.current });
      }
      if (m.finished && display.current >= m.frameCount - 1.01 && !replayRef.current && processed.current >= m.events.length) {
        setFinished(true);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [m, handleEvent]);

  const finishNow = () => {
    m.runToEnd();
    display.current = m.frameCount - 1;
    windowRef.current = null;
  };

  const goReport = () => {
    if (!appliedRef.current) {
      appliedRef.current = true;
      store.mutate((w) => applyResult(w, w.fixtures.find((f) => f.id === fixture.id)!, m), true);
    }
    store.go('report', { fixture: fixture.id });
  };

  const homeKit = kits[0];
  const awayKit = kits[1];
  const stats = m.matchStats();

  return (
    <div className={`match ${world.settings.reducedMotion ? 'reduced' : ''}`}>
      <div className="stage">
        <canvas ref={canvasRef} aria-label={`Match view: ${teamName(0)} ${hud.score[0]}, ${teamName(1)} ${hud.score[1]}, ${clockLabel(hud.clock, hud.half)}`} role="img" />
        <div className="scorebug" aria-live="polite">
          <div className="clock">{clockDigits(Math.min(hud.clock, hud.half === 1 ? 2700 : 5400))}</div>
          <div className="team" style={{ '--k': homeKit.primary } as CSSProperties}>
            <i />
            {teamShort(0)}
          </div>
          <div className="score">
            {hud.score[0]}–{hud.score[1]}
          </div>
          <div className="team away" style={{ '--k': awayKit.primary } as CSSProperties}>
            <i />
            {teamShort(1)}
          </div>
          {hud.clock > (hud.half === 1 ? 2700 : 5400) && <div className="extra">+{Math.floor((hud.clock - (hud.half === 1 ? 2700 : 5400)) / 60) + 1}</div>}
        </div>
        {hud.replay && <div className="stage-tag">REPLAY</div>}
        {hud.skipping && !hud.replay && <div className="stage-tag skip">Skipping to the next highlight…</div>}
        {banner && (
          <div className="goal-banner" role="status">
            <div className="inner">
              <div className="word" style={{ '--k': accent(kits[banner.team]), '--kf': contrastText(accent(kits[banner.team])) } as CSSProperties}>
                {banner.text}
              </div>
              <div className="who">
                <b>{teamName(banner.team)}</b>
                <span>{banner.sub}</span>
              </div>
            </div>
          </div>
        )}
        {finished && (
          <div className="fulltime">
            <div className="card-ft">
              <p className="muted">Full-time</p>
              <div className="score-line">
                <b style={{ font: '800 26px/1 var(--display)', textAlign: 'right' }}>{teamName(0)}</b>
                <span className="num">
                  {hud.score[0]}–{hud.score[1]}
                </span>
                <b style={{ font: '800 26px/1 var(--display)', textAlign: 'left' }}>{teamName(1)}</b>
              </div>
              <button className="btn club" onClick={goReport}>
                See the match report
              </button>
            </div>
          </div>
        )}
        <div className="controls" role="toolbar" aria-label="Match controls">
          <button className="ctl primary" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play' : 'Pause'}>
            {paused ? <Icon.play /> : <Icon.pause />}
          </button>
          <div className="ctl-group" role="group" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button key={s.v} className="ctl" aria-pressed={speed === s.v && mode === 'full'} onClick={() => (setSpeed(s.v), setMode('full'))}>
                {s.label}
              </button>
            ))}
          </div>
          <button className="ctl" aria-pressed={mode === 'highlights'} onClick={() => setMode(mode === 'highlights' ? 'full' : 'highlights')}>
            <Icon.forward /> Highlights
          </button>
          <button className="ctl" onClick={() => setView(view === 'broadcast' ? 'tactical' : 'broadcast')} aria-label={`Switch to ${view === 'broadcast' ? 'tactical' : 'broadcast'} view`}>
            {view === 'broadcast' ? <Icon.board /> : <Icon.camera />}
            {view === 'broadcast' ? 'Tactical' : 'Broadcast'}
          </button>
          <button className="ctl" onClick={() => setSound((s) => !s)} aria-label={sound ? 'Mute' : 'Unmute'}>
            {sound ? <Icon.sound /> : <Icon.mute />}
          </button>
          <span style={{ flex: 1 }} />
          {!finished && (
            <button className="ctl" onClick={finishNow}>
              Skip to result
            </button>
          )}
        </div>
      </div>

      <aside className="match-side">
        <div className="side-tabs" role="tablist">
          {(
            [
              ['feed', 'Events'],
              ['stats', 'Stats'],
              ['subs', 'Changes'],
              ['tactics', 'Tactics'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="side-body">
          {tab === 'feed' && (
            <div className="feed" aria-live="polite">
              {feed.length === 0 && <p style={{ color: '#9fb3a8', padding: '10px 4px' }}>Commentary will appear here.</p>}
              {feed.map(({ ev, text }) => (
                <div key={ev.seq} className={`feed-item ${ev.type === 'goal' ? 'goal' : ''}`} style={{ '--k': ev.team >= 0 ? kits[ev.team as 0 | 1].primary : '#fff' } as CSSProperties}>
                  <span className="min">{ev.type === 'halftime' || ev.type === 'fulltime' ? (ev.type === 'halftime' ? 'HT' : 'FT') : clockLabel(ev.clock, ev.half)}</span>
                  <span>
                    {ev.type === 'goal' && <b>Goal, {teamName(ev.team as 0 | 1)}</b>}
                    {(ev.type === 'yellow' || ev.type === 'red') && <i className={`card ${ev.type}`} aria-hidden="true" />}
                    {text}
                    {ev.type === 'goal' && (
                      <div>
                        <button className="replay" onClick={() => (replayRef.current = { from: Math.max(0, ev.tick - 60), to: ev.tick + 12, ret: display.current }, (display.current = Math.max(0, ev.tick - 60)))}>
                          Watch replay
                        </button>
                      </div>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {tab === 'stats' && <Stats stats={stats} kits={[homeKit.primary, awayKit.primary]} names={[teamShort(0), teamShort(1)]} />}
          {tab === 'subs' && <Subs m={m} team={userTeam} onChange={() => force((x) => x + 1)} />}
          {tab === 'tactics' && <TouchlineTactics m={m} team={userTeam} onApplied={() => store.toast('Instructions passed to the touchline.')} />}
        </div>
      </aside>
    </div>
  );
}

function Stats({ stats, kits, names }: { stats: ReturnType<MatchEngine['matchStats']>; kits: [string, string]; names: [string, string] }) {
  const rows: [string, [number, number], string?][] = [
    ['Possession', stats.possession, '%'],
    ['Shots', stats.shots],
    ['On target', stats.onTarget],
    ['Passes', stats.passes],
    ['Pass accuracy', stats.passAcc, '%'],
    ['Corners', stats.corners],
    ['Fouls', stats.fouls],
    ['Yellow cards', stats.yellows],
    ['Red cards', stats.reds],
  ];
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', font: '800 18px var(--display)', margin: '8px 0' }}>
        <span>{names[0]}</span>
        <span>{names[1]}</span>
      </div>
      {rows.map(([label, [a, b], suf]) => {
        const tot = a + b || 1;
        return (
          <div key={label} className="statrow">
            <span className="num">
              {a}
              {suf}
            </span>
            <div>
              <div className="label">{label}</div>
              <div className="split">
                <i style={{ width: `${(a / tot) * 100}%`, background: kits[0] }} />
                <i style={{ width: `${(b / tot) * 100}%`, background: kits[1] }} />
              </div>
            </div>
            <span className="num r">
              {b}
              {suf}
            </span>
          </div>
        );
      })}
      <p style={{ color: '#9fb3a8', fontSize: 12.5, marginTop: 10 }}>Stats count every recorded event up to the current moment of the simulation.</p>
    </div>
  );
}

function Subs({ m, team, onChange }: { m: MatchEngine; team: 0 | 1; onChange: () => void }) {
  const store = useStore();
  const [out, setOut] = useState<string | null>(null);
  const t = m.teams[team];
  const onPitch = t.players.filter((p) => p.onPitch);
  const bench = t.players.filter((p) => !p.used);
  const pending = t.pendingSubs;
  const left = MAX_SUBS - t.subsUsed - pending.length;
  return (
    <div>
      <p style={{ color: '#9fb3a8', fontSize: 13, margin: '6px 0 10px' }}>
        {left} of {MAX_SUBS} changes left. Choose who comes off, then who goes on. Changes happen at the next stoppage.
      </p>
      {pending.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {pending.map((s) => (
            <div key={s.outId} style={{ fontSize: 13, padding: '6px 8px', background: 'rgba(242,178,51,0.15)', borderLeft: '3px solid var(--amber)', marginBottom: 4 }}>
              Waiting: {m.playerById(s.inId)?.name} for {m.playerById(s.outId)?.name}
            </div>
          ))}
        </div>
      )}
      <h3>On the pitch</h3>
      <div className="sub-list">
        {onPitch.map((p) => (
          <button key={p.id} className="sub-player" aria-pressed={out === p.id} onClick={() => setOut(out === p.id ? null : p.id)} disabled={left <= 0 || pending.some((s) => s.outId === p.id)}>
            <span className="num" style={{ fontSize: 20 }}>
              {p.number}
            </span>
            <span>
              {p.name}
              <small>
                {p.slot?.pos} {p.yellow ? '· booked' : ''} {p.injured ? '· injured' : ''}
              </small>
            </span>
            <span style={{ width: 54 }}>
              <div className="bar" style={{ height: 6, background: 'rgba(255,255,255,0.15)' }}>
                <i style={{ width: `${Math.round(p.stamina * 100)}%`, background: p.stamina > 0.7 ? '#3fbf6e' : p.stamina > 0.55 ? '#f2b233' : '#e0533f' }} />
              </div>
            </span>
          </button>
        ))}
      </div>
      <h3>Substitutes</h3>
      <div className="sub-list">
        {bench.length === 0 && <p style={{ color: '#9fb3a8', fontSize: 13 }}>Nobody left on the bench.</p>}
        {bench.map((p) => (
          <button
            key={p.id}
            className="sub-player"
            disabled={!out || pending.some((s) => s.inId === p.id)}
            onClick={() => {
              const r = m.command({ type: 'sub', team, outId: out!, inId: p.id });
              store.toast(r.message, r.ok ? 'ok' : 'error');
              setOut(null);
              onChange();
            }}
          >
            <span className="num" style={{ fontSize: 20 }}>
              {p.number}
            </span>
            <span>
              {p.name}
              <small>{p.natPos}</small>
            </span>
            <span />
          </button>
        ))}
      </div>
    </div>
  );
}

function TouchlineTactics({ m, team, onApplied }: { m: MatchEngine; team: 0 | 1; onApplied: () => void }) {
  const [t, setT] = useState<T>({ ...m.teams[team].tactics });
  const dirty = JSON.stringify(t) !== JSON.stringify(m.teams[team].tactics);
  return (
    <div>
      <h3>Formation</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        {FORMATION_LIST.map((f: Formation) => (
          <button key={f} className="ctl" aria-pressed={t.formation === f} onClick={() => setT({ ...t, formation: f })} style={{ justifyContent: 'center' }}>
            {f}
          </button>
        ))}
      </div>
      {INSTRUCTIONS.map((ins) => (
        <InstructionRow key={ins.key} ins={ins} value={t[ins.key]} onChange={(v) => setT({ ...t, [ins.key]: v })} compact />
      ))}
      <button
        className="btn club"
        style={{ width: '100%', marginTop: 12 }}
        disabled={!dirty}
        onClick={() => {
          m.command({ type: 'tactics', team, tactics: t });
          onApplied();
        }}
      >
        Shout instructions
      </button>
      <p style={{ color: '#9fb3a8', fontSize: 12.5, marginTop: 8 }}>Applies straight away. Players' positions shift over the next few seconds.</p>
    </div>
  );
}
