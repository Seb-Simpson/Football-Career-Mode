import { useEffect, useState, type CSSProperties } from 'react';
import { uiSound } from '../presentation/uiSound';
import { sound } from '../presentation/sound';
import { CutsceneLayer } from './cutscenes/Cutscenes';
import { LEAGUE_NAMES, MATCHWEEKS } from '../domain/types';
import { nextFixture } from '../domain/fixtures';
import { isWindowOpen, userClub, userFixtureThisWeek } from '../simulation/world/season';
import { Crest } from './components/Graphics';
import { Icon } from './components/Icons';
import { PlayerProfile } from './components/PlayerProfile';
import { useStore, type Screen } from './store';
import { clubTheme } from './theme';
import { Title } from './screens/Title';
import { Home } from './screens/Home';
import { Squad } from './screens/Squad';
import { Tactics } from './screens/Tactics';
import { Competition } from './screens/Competition';
import { Transfers } from './screens/Transfers';
import { ClubScreen } from './screens/Club';
import { Inbox } from './screens/Inbox';
import { Settings } from './screens/Settings';
import { PreMatch } from './screens/PreMatch';
import { MatchScreen } from './screens/Match';
import { Report } from './screens/Report';
import { SeasonReview } from './screens/SeasonReview';

const NAV: { id: Screen; label: string; icon: keyof typeof Icon }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'squad', label: 'Squad', icon: 'squad' },
  { id: 'tactics', label: 'Tactics', icon: 'tactics' },
  { id: 'competition', label: 'League', icon: 'table' },
  { id: 'transfers', label: 'Transfers', icon: 'transfers' },
  { id: 'club', label: 'Club', icon: 'club' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'settings', label: 'Saves & settings', icon: 'settings' },
];

const MOBILE_NAV: Screen[] = ['home', 'squad', 'tactics', 'competition'];

export function App() {
  const store = useStore();
  const { world } = store;

  useEffect(() => {
    sound.setPrefs(world ? world.settings.music !== false : true, world ? world.settings.sound : true);
  }, [world, store.version]);

  // Music: the anthem for the title, big moments and matchday; a groove for managing.
  useEffect(() => {
    if (store.screen === 'match' && world) return; // the match screen runs the crowd instead
    const anthem = !world || !!store.cutscene || store.screen === 'prematch' || store.screen === 'season';
    sound.playMusic(anthem ? 'musicFloodlights' : 'musicDressing');
  }, [world, store.screen, store.cutscene]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('button, [role="tab"], select')) uiSound.click();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  if (!world) return <Title />;

  const club = userClub(world);
  const theme = clubTheme(club) as CSSProperties;
  const fullBleed = store.screen === 'match';

  return (
    <div style={theme} className={world.settings.reducedMotion ? 'reduced' : ''}>
      {fullBleed ? (
        <MatchScreen />
      ) : (
        <div className="shell">
          <Rail />
          <MobileTop />
          <main className="main" id="main">
            <div key={`${store.screen}:${store.params.fixture ?? ''}`} className="page-anim">
              <ScreenView />
            </div>
          </main>
          <MobileTabs />
        </div>
      )}
      {store.playerId && <PlayerProfile id={store.playerId} onClose={() => store.openPlayer(null)} />}
      <Busy />
      <Toasts />
      {store.wipe > 0 && (
        <div key={store.wipe} className="wipe" aria-hidden="true">
          <i />
          <i />
          <span>{club && <Crest club={club} size={120} />}</span>
        </div>
      )}
      <CutsceneLayer />
    </div>
  );
}

function ScreenView() {
  const { screen } = useStore();
  switch (screen) {
    case 'home':
      return <Home />;
    case 'squad':
      return <Squad />;
    case 'tactics':
      return <Tactics />;
    case 'competition':
      return <Competition />;
    case 'transfers':
      return <Transfers />;
    case 'club':
      return <ClubScreen />;
    case 'inbox':
      return <Inbox />;
    case 'settings':
      return <Settings />;
    case 'prematch':
      return <PreMatch />;
    case 'report':
      return <Report />;
    case 'season':
      return <SeasonReview />;
    default:
      return <Home />;
  }
}

function useContinueLabel(): { label: string; sub: string; hidden: boolean } {
  const { world, screen } = useStore();
  if (!world) return { label: '', sub: '', hidden: true };
  if (screen === 'prematch' || screen === 'season') return { label: '', sub: '', hidden: true };
  const club = userClub(world);
  const uf = userFixtureThisWeek(world);
  if (uf && club) {
    const home = uf.home === club.id;
    const opp = world.clubs[home ? uf.away : uf.home];
    return { label: 'Matchday', sub: `${opp.name} (${home ? 'H' : 'A'})`, hidden: false };
  }
  if (world.week === 0) return { label: 'Continue', sub: 'Start the season', hidden: false };
  if (!club) return { label: 'Continue', sub: 'Advance a week', hidden: false };
  const nf = nextFixture(world, club.id);
  return { label: 'Continue', sub: nf ? `Next: matchweek ${nf.week}` : 'To the season review', hidden: false };
}

function Rail() {
  const store = useStore();
  const world = store.world!;
  const club = userClub(world);
  const unread = world.inbox.filter((m) => !m.read).length;
  const cont = useContinueLabel();
  return (
    <aside className="rail" aria-label="Main navigation">
      <div className="rail-club">
        {club ? <Crest club={club} size={52} /> : <span />}
        <div>
          <h2>{club ? club.name : 'Between jobs'}</h2>
          <p>{club ? LEAGUE_NAMES[club.division] : world.manager.name}</p>
        </div>
      </div>
      <nav>
        {NAV.map((n) => {
          const Ico = Icon[n.icon];
          return (
            <button key={n.id} className="nav-item" aria-current={store.screen === n.id ? 'page' : undefined} onClick={() => store.go(n.id)}>
              <Ico />
              {n.label}
              {n.id === 'inbox' && unread > 0 && <span className="nav-badge">{unread}</span>}
              {n.id === 'transfers' && isWindowOpen(world) && <span className="nav-badge" style={{ background: '#1f8a4c', color: '#fff' }}>Open</span>}
            </button>
          );
        })}
      </nav>
      <div className="rail-foot">
        <div className="rail-date">
          <div>
            <span>{world.week === 0 ? 'Pre-season' : world.week > MATCHWEEKS ? 'Season over' : 'Matchweek'}</span>
            <div className="num">{world.week === 0 ? `${world.season}` : `${world.week} of ${MATCHWEEKS}`}</div>
          </div>
          <span>
            {world.season}/{String(world.season + 1).slice(2)}
          </span>
        </div>
        {!cont.hidden && (
          <button className="continue" onClick={() => store.advance()} disabled={!!store.busy}>
            <span>
              <b>{cont.label}</b>
              <small>{cont.sub}</small>
            </span>
            <Icon.arrow />
          </button>
        )}
      </div>
    </aside>
  );
}

function MobileTop() {
  const { world } = useStore();
  const club = userClub(world!);
  return (
    <header className="topbar">
      {club && <Crest club={club} size={34} />}
      <b>{club ? club.short : 'Touchline'}</b>
      <span>
        {world!.week === 0 ? 'Pre-season' : `Matchweek ${Math.min(world!.week, MATCHWEEKS)}`}
        <br />
        {world!.season}/{String(world!.season + 1).slice(2)}
      </span>
    </header>
  );
}

function MobileTabs() {
  const store = useStore();
  const cont = useContinueLabel();
  const [more, setMore] = useState(false);
  const unread = store.world!.inbox.filter((m) => !m.read).length;
  const inMore = !MOBILE_NAV.slice(0, 4).includes(store.screen) && NAV.some((n) => n.id === store.screen);
  return (
    <>
      {!cont.hidden && (
        <button className="continue mobile-continue" onClick={() => store.advance()} disabled={!!store.busy}>
          <span>
            <b>{cont.label}</b>
            <small>{cont.sub}</small>
          </span>
          <Icon.arrow />
        </button>
      )}
      <nav className="tabbar" aria-label="Main navigation">
        {MOBILE_NAV.slice(0, 4).map((id) => {
          const n = NAV.find((x) => x.id === id)!;
          const Ico = Icon[n.icon];
          return (
            <button key={id} aria-current={store.screen === id ? 'page' : undefined} onClick={() => store.go(id)}>
              <Ico />
              {n.label}
            </button>
          );
        })}
        <button aria-current={inMore ? 'page' : undefined} aria-expanded={more} onClick={() => setMore(true)}>
          <Icon.more />
          {unread ? `More (${unread})` : 'More'}
        </button>
      </nav>
      {more && (
        <>
          <div className="scrim" onClick={() => setMore(false)} />
          <div className="drawer more-sheet" role="dialog" aria-label="More">
            <div className="drawer-body" style={{ padding: '8px 0 24px' }}>
              {NAV.filter((n) => !MOBILE_NAV.slice(0, 4).includes(n.id)).map((n) => {
                const Ico = Icon[n.icon];
                return (
                  <button
                    key={n.id}
                    className="nav-item"
                    style={{ color: 'var(--ink)' }}
                    aria-current={store.screen === n.id ? 'page' : undefined}
                    onClick={() => {
                      setMore(false);
                      store.go(n.id);
                    }}
                  >
                    <Ico />
                    {n.label}
                    {n.id === 'inbox' && unread > 0 && <span className="nav-badge">{unread}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Busy() {
  const { busy, world } = useStore();
  if (!busy || !world) return null;
  const rows = busy.results
    .map((id) => world.fixtures.find((f) => f.id === id))
    .filter((f) => f && f.result)
    .slice(-10);
  return (
    <div className="busy" role="status" aria-live="polite">
      <div className="box">
        <h2>{busy.label}</h2>
        <div className="bar">
          <i style={{ width: `${Math.round(busy.progress * 100)}%` }} />
        </div>
        <div className="vidi">
          {rows.map((f) => {
            const h = world.clubs[f!.home];
            const a = world.clubs[f!.away];
            const r = f!.result!;
            return (
              <div key={f!.id} className="vidi-row">
                <span className="h">{h.name}</span>
                <Crest club={h} size={22} />
                <b>
                  {r.homeGoals}–{r.awayGoals}
                </b>
                <Crest club={a} size={22} />
                <span>{a.name}</span>
              </div>
            );
          })}
        </div>
        {rows.length === 0 && <p>Moving the calendar on.</p>}
      </div>
    </div>
  );
}

function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
