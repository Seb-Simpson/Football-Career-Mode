import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { clubStrength, createWorld } from '../../domain/generate';
import { LEAGUE_NAMES, type World } from '../../domain/types';
import { deleteSave, listSaves, loadWorld, parseWorld, saveWorld } from '../../persistence/save';
import { money, startCareer } from '../../simulation/world/season';
import { Crest, TitleBoard } from '../components/Graphics';
import { Difficulty } from '../components/Bits';
import { Icon } from '../components/Icons';
import { useStore } from '../store';
import { accent, clubTheme, contrastText, kitBand } from '../theme';

export function Title() {
  const [stage, setStage] = useState<'menu' | 'new'>('menu');
  return stage === 'menu' ? <Menu onNew={() => setStage('new')} /> : <NewCareer onBack={() => setStage('menu')} />;
}

function Menu({ onNew }: { onNew: () => void }) {
  const store = useStore();
  const [saves, setSaves] = useState(listSaves());
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (slot: string) => {
    const w = loadWorld(slot);
    if ('error' in w) return setError(w.error);
    store.setWorld(w, slot);
  };

  const importFile = async (f: File) => {
    if (f.size > 20_000_000) return setError('That file is too large to be a career save.');
    const text = await f.text();
    const w = parseWorld(text);
    if ('error' in w) return setError(w.error);
    const slot = `career-${w.seed}-${Date.now().toString(36)}`;
    saveWorld(w, slot, w.manager.clubId ? w.clubs[w.manager.clubId].name : 'Unemployed');
    store.setWorld(w, slot);
  };

  return (
    <div className="title-screen">
      <div className="title-board">
        <TitleBoard />
        <div className="title-word">
          Touchline
          <small>Build a club, shape how it plays, and watch every decision play out on the pitch.</small>
        </div>
      </div>
      <div className="title-menu">
        <h2>{saves.length ? 'Continue a career' : 'Your career starts here'}</h2>
        {saves.map((s) => (
          <div key={s.slot} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <button className="save-card" onClick={() => load(s.slot)}>
              <span style={{ display: 'grid', placeItems: 'center', width: 48, height: 48, background: 'rgba(255,255,255,0.08)' }}>
                <Icon.play />
              </span>
              <span>
                <b>{s.club}</b>
                <span>
                  {s.name}, season {s.season}/{String(s.season + 1).slice(2)}, {s.week === 0 ? 'pre-season' : `matchweek ${s.week}`}
                </span>
              </span>
              <span style={{ fontSize: 12 }}>{new Date(s.savedAt).toLocaleDateString()}</span>
            </button>
            <button
              className="btn ghost small"
              style={{ height: '100%' }}
              onClick={() => {
                if (confirm(`Delete the career with ${s.club}? This cannot be undone.`)) {
                  deleteSave(s.slot);
                  setSaves(listSaves());
                }
              }}
              aria-label={`Delete save ${s.club}`}
            >
              Delete
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
          <button className="btn club" style={{ '--club': '#f2b233', '--club-ink': '#13203a' } as CSSProperties} onClick={onNew}>
            Start a new career
          </button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            Import a save file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = '';
            }}
          />
        </div>
        {error && (
          <div className="notice error" style={{ color: 'var(--ink)' }}>
            {error}
          </div>
        )}
        <p style={{ fontSize: 13, color: '#8d9bb5', maxWidth: '46ch' }}>
          Careers are saved in this browser. Browser storage can be cleared, so export a copy from Saves &amp; settings now and then.
        </p>
      </div>
    </div>
  );
}

function difficultyOf(rank: number, division: number): number {
  if (division === 1) return rank <= 3 ? 2 : rank <= 6 ? 3 : 4;
  return rank <= 2 ? 1 : rank <= 5 ? 2 : rank <= 8 ? 3 : 5;
}

function NewCareer({ onBack }: { onBack: () => void }) {
  const store = useStore();
  const [name, setName] = useState('');
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const world: World = useMemo(() => createWorld(seed, 'Manager'), [seed]);
  const clubs = useMemo(
    () =>
      Object.values(world.clubs)
        .map((c) => ({ c, s: clubStrength(world, c.id) }))
        .sort((a, b) => a.c.division - b.c.division || b.s - a.s),
    [world],
  );
  const recommended = clubs.filter((x) => x.c.division === 0)[4]?.c.id;
  const [selected, setSelected] = useState<string>(recommended ?? clubs[0].c.id);
  const sel = world.clubs[selected];
  const divRank = clubs.filter((x) => x.c.division === sel.division).findIndex((x) => x.c.id === sel.id) + 1;
  const diff = difficultyOf(divRank, sel.division);
  const expectation = sel.division === 0 ? (divRank <= 2 ? 'Win the league' : divRank <= 4 ? 'Finish in the top half' : divRank <= 7 ? 'A safe mid-table finish' : 'Avoid relegation') : divRank <= 3 ? 'Win promotion' : divRank <= 6 ? 'Finish in the top half' : 'A safe mid-table finish';
  const heroBg = accent(sel.kit);

  const begin = () => {
    const managerName = name.trim() || 'Alex Morgan';
    world.manager.name = managerName;
    startCareer(world, selected);
    const slot = `career-${seed}`;
    saveWorld(world, slot, sel.name);
    store.setWorld(world, slot);
    store.playCutscene({ kind: 'appointed', clubId: selected });
  };

  return (
    <div style={{ minHeight: '100%', background: 'var(--concrete)' }}>
      <div className="page" style={{ margin: '0 auto', paddingBottom: 60 }}>
        <header className="page-head">
          <div>
            <h1>Choose your club</h1>
            <p className="sub">Twenty fictional clubs across two divisions. The top two in the Crown League Two go up; the bottom two of the Crown League go down.</p>
          </div>
          <button className="btn ghost" onClick={onBack}>
            Back
          </button>
        </header>
        <div className="picker">
          <div className="panel">
            <div className="panel-body" style={{ borderBottom: '1px solid var(--line-2)' }}>
              <label className="field" style={{ maxWidth: 360 }}>
                Manager name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Morgan" maxLength={40} autoComplete="off" />
              </label>
            </div>
            {[0, 1].map((div) => (
              <div key={div}>
                <div style={{ padding: '16px 14px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <h2 style={{ fontSize: 24 }}>{LEAGUE_NAMES[div]}</h2>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    Strength / budget / challenge
                  </span>
                </div>
                {clubs
                  .filter((x) => x.c.division === div)
                  .map(({ c, s }, i) => (
                    <button key={c.id} className="club-row" aria-pressed={selected === c.id} onClick={() => setSelected(c.id)}>
                      <Crest club={c} size={40} />
                      <span>
                        <b>{c.name}</b>
                        <small>
                          {c.nickname}
                          {c.id === recommended ? ', recommended for a first career' : ''}
                        </small>
                      </span>
                      <span className="num" style={{ fontSize: 22 }}>
                        {Math.round(s)}
                      </span>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{money(c.transferBudget)}</span>
                      <span className="hide-sm">
                        <Difficulty level={difficultyOf(i + 1, div)} />
                      </span>
                    </button>
                  ))}
              </div>
            ))}
          </div>

          <aside className="club-preview panel cut" aria-live="polite" style={clubTheme(sel)}>
            <div className="hero" style={{ '--h-bg': heroBg, '--h-fg': contrastText(heroBg) } as CSSProperties}>
              <div className="crest-big">
                <Crest club={sel} size={150} />
              </div>
              <p style={{ fontSize: 13, opacity: 0.85, marginBottom: 8 }}>
                {LEAGUE_NAMES[sel.division]}, founded {sel.founded}
              </p>
              <h2>{sel.name}</h2>
              <p style={{ marginTop: 10, fontWeight: 600 }}>{sel.nickname}</p>
            </div>
            <div style={{ height: 12, background: kitBand(sel.kit) }} />
            <div className="panel-body" style={{ display: 'grid', gap: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                <div className="stat-big">
                  <span className="num">{Math.round(clubStrength(world, sel.id))}</span>
                  <span>Squad strength</span>
                </div>
                <div className="stat-big">
                  <span className="num">{money(sel.transferBudget)}</span>
                  <span>Transfer budget</span>
                </div>
                <div className="stat-big">
                  <span className="num">{Math.round(sel.capacity / 1000)}k</span>
                  <span>{sel.stadium}</span>
                </div>
              </div>
              <dl className="kv">
                <dt>Board expectation</dt>
                <dd>{expectation}</dd>
                <dt>Challenge</dt>
                <dd>
                  <Difficulty level={diff} />
                </dd>
                <dt>Wage budget</dt>
                <dd>{money(sel.wageBudget)} / week</dd>
                <dt>Balance</dt>
                <dd>{money(sel.balance)}</dd>
              </dl>
              <p className="muted" style={{ fontSize: 14 }}>
                {diff <= 2
                  ? 'A strong squad and a demanding board. Results are expected from day one.'
                  : diff === 3
                    ? 'A balanced job: room to build, with enough quality to compete.'
                    : diff === 4
                      ? 'A tough rebuild. Smart recruitment and patience will be needed.'
                      : 'A survival scrap with limited resources. For experienced managers.'}
              </p>
              <button className="continue" onClick={begin}>
                <span>
                  <b>Take the job</b>
                  <small>Manage {sel.name}</small>
                </span>
                <Icon.arrow />
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
