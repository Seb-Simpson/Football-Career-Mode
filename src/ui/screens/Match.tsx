import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FORMATION_LIST } from '../../domain/formations';
import type { Formation, Tactics as T } from '../../domain/types';
import { MAX_SUBS } from '../../domain/types';
import { sound as audio } from '../../presentation/sound';
import { commentary, isHighlight } from '../../presentation/commentary';
import { PitchRenderer } from '../../presentation/renderer';
import { TifoScene } from '../../presentation/tifo';
import { WALKOUT_SECONDS, walkoutFrame } from '../../presentation/walkout';
import type { Kit } from '../../domain/types';
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
  const lastBall = useRef<[number, number, number] | null>(null);
  const nextChant = useRef(performance.now() + 9000);
  const display = useRef(0);
  const processed = useRef(0);
  const searchIdx = useRef(0);
  const windowRef = useRef<{ start: number; end: number } | null>(null);
  const replayRef = useRef<{ from: number; to: number; ret: number; auto?: boolean } | null>(null);
  const appliedRef = useRef(false);
  const cutscenes = world.settings.cutscenes !== false && !world.settings.reducedMotion;
  const [intro, setIntro] = useState<'tifo' | 'walkout' | null>(cutscenes ? 'tifo' : null);
  const introRef = useRef(intro);
  introRef.current = intro;
  const introT = useRef(0);
  const goalRef = useRef<{ tick: number; team: 0 | 1 } | null>(null);
  const autoReplay = useRef<{ from: number; to: number; due: number } | null>(null);
  const [note, setNote] = useState<{ id: number; kind: 'yellow' | 'red' | 'sub' | 'pen' | 'injury'; team: 0 | 1; title: string; sub: string } | null>(null);

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

  // Stadium sound: crowd bed for the whole match, music off.
  useEffect(() => {
    audio.playMusic(null);
    audio.startCrowd(0.7);
    return () => audio.stopCrowd();
  }, []);
  useEffect(() => {
    audio.setPrefs(world.settings.music !== false, sound);
  }, [sound, world.settings.music]);
  useEffect(() => {
    audio.setIntensity(paused ? 0.1 : 0.6);
  }, [paused]);

  const handleEvent = useCallback(
    (ev: MatchEvent) => {
      const text = commentary(ev, m);
      if (text) setFeed((f) => [{ ev, text }, ...f].slice(0, 120));
      const r = rendererRef.current;
      const who = (id?: string) => (id ? m.playerById(id)?.name ?? '' : '');
      const showNote = (kind: 'yellow' | 'red' | 'sub' | 'pen' | 'injury', title: string, sub: string) => {
        const id = ev.seq;
        setNote({ id, kind, team: ev.team as 0 | 1, title, sub });
        setTimeout(() => setNote((n) => (n && n.id === id ? null : n)), 3600);
      };
      if (ev.type === 'yellow') showNote('yellow', who(ev.player), 'Yellow card');
      else if (ev.type === 'red') showNote('red', who(ev.player), ev.detail === 'Second yellow' ? 'Second yellow: sent off' : 'Red card');
      else if (ev.type === 'sub') showNote('sub', who(ev.player), `On for ${who(ev.other)}`);
      else if (ev.type === 'penalty') showNote('pen', 'Penalty', m.teams[ev.team as 0 | 1].input.name);
      else if (ev.type === 'injury') showNote('injury', who(ev.player), 'Down injured');
      if (r && (ev.type === 'save' || ev.type === 'post')) r.excite = Math.max(r.excite, 0.5);
      if (ev.type === 'goal') {
        goalRef.current = { tick: ev.tick, team: ev.team as 0 | 1 };
        if (r) r.excite = 1;
        if (cutscenes) autoReplay.current = { from: Math.max(0, ev.tick - 22), to: ev.tick + 6, due: performance.now() + 2500 };
        const scorer = ev.player ? m.playerById(ev.player) : undefined;
        setBanner({ team: ev.team as 0 | 1, text: 'GOAL', sub: `${scorer?.name ?? ''} ${clockLabel(ev.clock, ev.half)}` });
        setTimeout(() => setBanner(null), cutscenes ? 2400 : 3400);
        audio.goal(ev.team === 0);
      } else if (ev.type === 'save' || ev.type === 'post' || (ev.type === 'miss' && (ev.xg ?? 0) > 0.12)) {
        // The shooting team's fans groan; a save by the home keeper gets a cheer instead.
        const shooterTeam = ev.type === 'save' ? (ev.team === 0 ? 1 : 0) : ev.team;
        audio.ooh(shooterTeam === 0);
      }
      if (ev.type === 'shot') audio.kick(1.4);
      if (ev.type === 'foul' || ev.type === 'offside' || ev.type === 'kickoff' || ev.type === 'penalty') audio.whistle(false);
      if (ev.type === 'halftime' || ev.type === 'fulltime') audio.whistle(true);
      if (ev.type === 'fulltime') setTimeout(() => audio.applause(), 1500);
    },
    [m, cutscenes],
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
      // Pre-match presentation: the tifo has its own canvas; the walkout uses this one.
      if (introRef.current) {
        if (introRef.current === 'walkout' && r) {
          introT.current += dt;
          r.zoom = 1.32;
          r.excite = Math.max(r.excite, 0.35);
          r.render(walkoutFrame(introT.current), walkoutFrame(introT.current + 0.2), 0, dt);
          if (introT.current > WALKOUT_SECONDS) {
            r.zoom = 1;
            setIntro(null);
          }
        }
        raf = requestAnimationFrame(loop);
        return;
      }
      let skipping = false;
      const rp = replayRef.current;
      if (rp) {
        display.current += (dt * (rp.auto ? 0.75 : 1.0)) / DT;
        if (display.current >= rp.to) {
          display.current = rp.ret;
          replayRef.current = null;
        }
      } else if (!pausedRef.current) {
        if (modeRef.current === 'full') {
          const g0 = goalRef.current;
          const inCelebration = cutscenes && !!g0 && display.current >= g0.tick && display.current < g0.tick + 42;
          const target = display.current + (dt * (inCelebration ? Math.min(speedRef.current, 3.4) : speedRef.current)) / DT;
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

      // Automatic goal replay once the celebration is under way.
      const ar = autoReplay.current;
      if (ar && !replayRef.current && now >= ar.due) {
        autoReplay.current = null;
        if (!pausedRef.current) {
          replayRef.current = { from: ar.from, to: ar.to, ret: display.current, auto: true };
          display.current = ar.from;
        }
      }

      const i = Math.floor(display.current);
      const fa = m.frame(Math.min(i, m.frameCount - 1));
      const fb = m.frame(Math.min(i + 1, m.frameCount - 1));
      if (r && fa) {
        const g = goalRef.current;
        const celebrating = !!g && display.current >= g.tick && display.current < g.tick + 42;
        r.celebrateTeam = celebrating ? g!.team : -1;
        r.zoom = replayRef.current ? 1.3 : celebrating ? 1.28 : fa.ball[0] < 22 || fa.ball[0] > 83 ? 1.12 : 1;
        r.render(fa, fb, display.current - i, dt);
        // Ball strikes: a sudden change in ball velocity between frames.
        const lb = lastBall.current;
        if (lb && !replayRef.current && !pausedRef.current) {
          const vx = fb ? fb.ball[0] - fa.ball[0] : 0;
          const vy = fb ? fb.ball[1] - fa.ball[1] : 0;
          const dv = Math.hypot(vx - lb[0], vy - lb[1]);
          if (dv > 1.3 && i !== lb[2] && speedRef.current <= 24) audio.kick(Math.min(1.2, dv / 3));
          lastBall.current = [vx, vy, i];
        } else if (fb) lastBall.current = [fb.ball[0] - fa.ball[0], fb.ball[1] - fa.ball[1], i];
      }
      if (fa && !replayRef.current) {
        // Crowd reacts to danger: louder as the ball nears either goal, more for home attacks.
        const toHomeGoal = fa.half === 1 ? fa.ball[0] : 105 - fa.ball[0];
        const toAwayGoal = 105 - toHomeGoal;
        const danger = Math.max(0, 1 - Math.min(toHomeGoal, toAwayGoal) / 32);
        const homeAttack = toAwayGoal < toHomeGoal;
        if (!pausedRef.current) audio.setIntensity(0.5 + danger * (homeAttack ? 0.75 : 0.45));
        if (now > nextChant.current && !pausedRef.current) {
          nextChant.current = now + 16000 + Math.random() * 18000;
          audio.chantFor(Math.random() < 0.68);
        }
      }

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
    autoReplay.current = null;
    replayRef.current = null;
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
        {hud.replay && !intro && (
          <>
            <div className="stage-tag">REPLAY</div>
            <button
              className="stage-skip"
              onClick={() => {
                const rp = replayRef.current;
                if (rp) display.current = rp.ret;
                replayRef.current = null;
              }}
            >
              Skip replay
            </button>
          </>
        )}
        {intro === 'tifo' && (
          <TifoIntro
            kit={world.clubs[fixture.home].kit}
            short={world.clubs[fixture.home].short}
            title={world.clubs[fixture.home].stadium}
            sub={`${teamName(0)} v ${teamName(1)}`}
            onStart={() => {
              audio.setIntensity(1);
              audio.chantFor(true);
            }}
            onDone={() => setIntro('walkout')}
          />
        )}
        {intro === 'walkout' && (
          <div className="lineup-third">
            {([0, 1] as const).map((t) => (
              <div key={t} className="lt-team" style={{ '--k': accent(kits[t]), '--kf': contrastText(accent(kits[t])) } as CSSProperties}>
                <header>
                  <b>{teamName(t)}</b>
                  <span>{m.teams[t].tactics.formation}</span>
                </header>
                <ol>
                  {m.teams[t].players.slice(0, 11).map((p) => (
                    <li key={p.id}>
                      <i>{p.number}</i>
                      {p.name}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
        {intro && (
          <button className="stage-skip" onClick={() => (rendererRef.current && (rendererRef.current.zoom = 1), setIntro(null))}>
            Skip intro
          </button>
        )}
        {note && !intro && (
          <div key={note.id} className={`stage-note ${note.kind}`} style={{ '--k': accent(kits[note.team]) } as CSSProperties} role="status">
            <i className="mark" aria-hidden="true" />
            <span>
              <b>{note.title}</b>
              <small>{note.sub}</small>
            </span>
          </div>
        )}
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

function TifoIntro({ kit, short, title, sub, onStart, onDone }: { kit: Kit; short: string; title: string; sub: string; onStart: () => void; onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const scene = new TifoScene(ref.current!, kit, short);
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(ref.current!);
    onStart();
    let raf = 0;
    let t = 0;
    let last = performance.now();
    let finished = false;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt;
      scene.render(t, dt);
      if (t > 6.2 && !finished) {
        finished = true;
        done.current();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="tifo">
      <canvas ref={ref} aria-label={`The home end unveils a display for ${title}`} role="img" />
      <div className="lower-third" style={{ '--k': accent(kit), '--kf': contrastText(accent(kit)) } as CSSProperties}>
        <i className="lt-band" />
        <div>
          <b>{title}</b>
          <span>{sub}</span>
        </div>
      </div>
    </div>
  );
}
