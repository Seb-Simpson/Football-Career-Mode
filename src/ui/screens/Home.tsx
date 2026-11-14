import type { CSSProperties } from 'react';
import { clubPlayers, clubStrength } from '../../domain/generate';
import { leagueTable, nextFixture } from '../../domain/fixtures';
import { validateLineup } from '../../domain/lineup';
import { overall, shortName } from '../../domain/player';
import { LEAGUE_NAMES, MATCHWEEKS, PROMOTION_PLACES } from '../../domain/types';
import { acceptJob, isWindowOpen, money, objectiveLabel, objectiveTarget, ordinal, userClub } from '../../simulation/world/season';
import { Form, Panel, ShirtNo, StatusFlags } from '../components/Bits';
import { Crest } from '../components/Graphics';
import { useStore, useWorld } from '../store';

export function Home() {
  const world = useWorld();
  const club = userClub(world);
  if (!club) return <Unemployed />;
  return <Dashboard />;
}

function Dashboard() {
  const store = useStore();
  const world = useWorld();
  const club = userClub(world)!;
  const table = leagueTable(world, club.division);
  const pos = table.findIndex((r) => r.clubId === club.id) + 1;
  const nf = nextFixture(world, club.id);
  const squad = clubPlayers(world, club.id);
  const issues = validateLineup(world, club);
  const alerts = squad.filter((p) => p.injury || p.suspended || p.fitness < 70 || (p.contract.expires <= world.season && world.week > MATCHWEEKS - 6));
  const topScorer = [...squad].sort((a, b) => b.stats.goals - a.stats.goals)[0];
  const conf = world.manager.confidence;
  const target = objectiveTarget(world.manager.objective);
  const latest = world.inbox.slice(0, 4);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{world.week === 0 ? 'Pre-season' : `Matchweek ${Math.min(world.week, MATCHWEEKS)}`}</h1>
          <p className="sub">
            {world.manager.name}, manager of {club.name}. {(table[pos - 1]?.p ?? 0) === 0 ? 'The window is open and the first fixture is a week away.' : `${ordinal(pos)} in the ${LEAGUE_NAMES[club.division]}.`}
          </p>
        </div>
      </header>

      <div className="grid cols-3">
        <div className="span-2">{nf ? <FixtureTicket fixtureId={nf.id} /> : <Panel title="Season complete">The fixture list is done.</Panel>}</div>

        <Panel title="The board">
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <div className="stat-big">
                <span className="num">{conf}%</span>
                <span>Board confidence</span>
              </div>
              <span className={`flag ${conf >= 60 ? 'good' : conf >= 30 ? 'warn' : 'inj'}`}>{conf >= 60 ? 'Secure' : conf >= 30 ? 'Under watch' : 'At risk'}</span>
            </div>
            <ConfidenceGauge value={conf} />
            <dl className="kv">
              <dt>Objective</dt>
              <dd>{objectiveLabel(world.manager.objective)}</dd>
              <dt>Currently</dt>
              <dd>
                {(table[pos - 1]?.p ?? 0) === 0 ? (
                  'Season not started'
                ) : (
                  <>
                    {ordinal(pos)} {pos <= target ? <span style={{ color: 'var(--green)' }}>(on track)</span> : <span style={{ color: 'var(--red)' }}>(target {ordinal(target)})</span>}
                  </>
                )}
              </dd>
            </dl>
          </div>
        </Panel>

        <Panel title="League" tools={<button className="link" onClick={() => store.go('competition')}>Full table</button>} flush>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Club</th>
                <th className="r">P</th>
                <th className="r">GD</th>
                <th className="r">Pts</th>
              </tr>
            </thead>
            <tbody>
              {table
                .map((r, i) => ({ r, i }))
                .filter(({ i }) => Math.abs(i + 1 - pos) <= 2 || (pos <= 3 && i < 5) || (pos >= table.length - 2 && i >= table.length - 5))
                .map(({ r, i }) => {
                  const c = world.clubs[r.clubId];
                  const zone = club.division === 0 ? (i >= table.length - PROMOTION_PLACES ? 'zone-down' : '') : i < PROMOTION_PLACES ? 'zone-up' : '';
                  return (
                    <tr key={r.clubId} className={`${r.clubId === club.id ? 'mine' : ''} ${zone}`}>
                      <td className="pos-cell">{i + 1}</td>
                      <td>
                        <span className="player-cell">
                          <Crest club={c} size={24} />
                          <span className="name">{c.name}</span>
                        </span>
                      </td>
                      <td className="r">{r.p}</td>
                      <td className="r">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                      <td className="r num" style={{ fontSize: 18 }}>
                        {r.pts}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </Panel>

        <Panel title="Squad watch" tools={<button className="link" onClick={() => store.go('squad')}>Team selection</button>}>
          {issues.some((i) => i.severity === 'error') && (
            <div className="notice error" style={{ marginBottom: 12 }}>
              {issues.find((i) => i.severity === 'error')!.message} Update the team before matchday.
            </div>
          )}
          {alerts.length === 0 ? (
            <p className="muted">Everyone is fit and available.</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {alerts.slice(0, 6).map((p) => (
                <button key={p.id} className="player-cell" onClick={() => store.openPlayer(p.id)} style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', width: '100%' }}>
                  <ShirtNo n={p.number} club={club} />
                  <span className="name" style={{ flex: 1 }}>
                    {shortName(p)}
                  </span>
                  <StatusFlags p={p} season={world.week > MATCHWEEKS - 6 ? world.season : undefined} />
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Season so far">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="stat-big">
              <span className="num">{table[pos - 1]?.pts ?? 0}</span>
              <span>Points from {table[pos - 1]?.p ?? 0}</span>
            </div>
            <div className="stat-big">
              <span className="num">
                {table[pos - 1]?.gf ?? 0}–{table[pos - 1]?.ga ?? 0}
              </span>
              <span>Goals for and against</span>
            </div>
            <div className="stat-big" style={{ gridColumn: 'span 2' }}>
              <span style={{ marginBottom: 4 }}>Form</span>
              <Form results={table[pos - 1]?.form ?? []} />
            </div>
            {topScorer && topScorer.stats.goals > 0 && (
              <div className="stat-big" style={{ gridColumn: 'span 2' }}>
                <span>Top scorer</span>
                <button className="link" style={{ fontSize: 15, textAlign: 'left' }} onClick={() => store.openPlayer(topScorer.id)}>
                  {topScorer.first} {topScorer.last}, {topScorer.stats.goals} goal{topScorer.stats.goals === 1 ? '' : 's'}
                </button>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Inbox" tools={<button className="link" onClick={() => store.go('inbox')}>Open inbox</button>} flush className="span-2">
          {latest.map((m) => (
            <button
              key={m.id}
              className={`inbox-item ${m.read ? 'read' : ''}`}
              onClick={() => store.go('inbox', { id: m.id })}
            >
              <i className="dot" />
              <span>
                <b>{m.subject}</b>
                <span>{m.from}</span>
              </span>
            </button>
          ))}
        </Panel>

        <Panel title="Finances" tools={<button className="link" onClick={() => store.go('club')}>Ledger</button>}>
          <dl className="kv">
            <dt>Balance</dt>
            <dd>{money(club.balance)}</dd>
            <dt>Transfer budget</dt>
            <dd>{money(club.transferBudget)}</dd>
            <dt>Wage bill</dt>
            <dd>
              {money(squad.reduce((s, p) => s + p.contract.wage, 0))} of {money(club.wageBudget)}
            </dd>
            <dt>Window</dt>
            <dd>{isWindowOpen(world) ? 'Open' : 'Closed'}</dd>
          </dl>
        </Panel>
      </div>
    </div>
  );
}

function ConfidenceGauge({ value }: { value: number }) {
  return (
    <div style={{ position: 'relative', height: 14, display: 'grid', gridTemplateColumns: '30fr 30fr 40fr', gap: 2 }} aria-hidden="true">
      <i style={{ background: 'color-mix(in srgb, var(--red) 30%, transparent)' }} />
      <i style={{ background: 'color-mix(in srgb, var(--amber) 35%, transparent)' }} />
      <i style={{ background: 'color-mix(in srgb, var(--green) 30%, transparent)' }} />
      <span style={{ position: 'absolute', top: -4, bottom: -4, left: `calc(${value}% - 2px)`, width: 4, background: 'var(--ink)' }} />
    </div>
  );
}

export function FixtureTicket({ fixtureId }: { fixtureId: string }) {
  const store = useStore();
  const world = useWorld();
  const f = world.fixtures.find((x) => x.id === fixtureId)!;
  const club = userClub(world)!;
  const home = world.clubs[f.home];
  const away = world.clubs[f.away];
  const table = leagueTable(world, f.division);
  const posOf = (id: string) => table.findIndex((r) => r.clubId === id) + 1;
  const formOf = (id: string) => table.find((r) => r.clubId === id)?.form ?? [];
  const opp = f.home === club.id ? away : home;
  const isThisWeek = f.week === world.week;
  return (
    <article className="ticket" style={{ '--kit-band': `linear-gradient(90deg, ${home.kit.primary} 0 50%, ${away.kit.primary} 50% 100%)` } as CSSProperties}>
      <div className="ticket-band" />
      <div className="ticket-main">
        <p className="muted" style={{ fontSize: 13.5 }}>
          {LEAGUE_NAMES[f.division]}, matchweek {f.week}, at {home.stadium}
        </p>
        <div className="versus">
          <div className="side">
            <Crest club={home} size={64} />
            <div>
              <div className="team-name">{home.name}</div>
              <div className="meta">
                {table.some((r) => r.p) ? ordinal(posOf(home.id)) : 'New season'} <Form results={formOf(home.id)} />
              </div>
            </div>
          </div>
          <div className="vs">v</div>
          <div className="side away">
            <Crest club={away} size={64} />
            <div>
              <div className="team-name">{away.name}</div>
              <div className="meta">
                <Form results={formOf(away.id)} /> {table.some((r) => r.p) ? ordinal(posOf(away.id)) : 'New season'}
              </div>
            </div>
          </div>
        </div>
        <p style={{ fontSize: 14 }}>
          {opp.name} play {opp.tactics.formation} and have a squad strength of {Math.round(clubStrength(world, opp.id))}, against your {Math.round(clubStrength(world, club.id))}.
        </p>
      </div>
      <div className="ticket-stub">
        <div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            Kick-off
          </div>
          <div className="num" style={{ fontSize: 34, lineHeight: 1 }}>
            {isThisWeek ? 'Today' : `MW ${f.week}`}
          </div>
        </div>
        <button className="btn club" onClick={() => store.advance()}>
          {isThisWeek ? 'Go to match' : 'Continue'}
        </button>
      </div>
    </article>
  );
}

function Unemployed() {
  const store = useStore();
  const world = useWorld();
  const offers = world.inbox.filter((m) => m.action?.type === 'job-offer' && !m.action.resolved);
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Between jobs</h1>
          <p className="sub">The football world carries on without you. Accept an offer to get back in the dugout, or press Continue to wait for more.</p>
        </div>
      </header>
      <div className="grid cols-2">
        {offers.length === 0 && <Panel title="No offers yet">Clubs will be in touch as the season unfolds. Press Continue to move on a week.</Panel>}
        {offers.map((m) => {
          const c = world.clubs[m.action!.clubId!];
          const squad = clubPlayers(world, c.id).sort((a, b) => overall(b) - overall(a));
          return (
            <Panel key={m.id} title={c.name} tools={<Crest club={c} size={36} />}>
              <dl className="kv" style={{ marginBottom: 16 }}>
                <dt>League</dt>
                <dd>{LEAGUE_NAMES[c.division]}</dd>
                <dt>Squad strength</dt>
                <dd>{Math.round(clubStrength(world, c.id))}</dd>
                <dt>Transfer budget</dt>
                <dd>{money(c.transferBudget)}</dd>
                <dt>Best player</dt>
                <dd>{squad[0] ? `${shortName(squad[0])} (${overall(squad[0])})` : '–'}</dd>
              </dl>
              <button className="btn" onClick={() => store.mutate((w) => acceptJob(w, c.id), true)}>
                Accept the job
              </button>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
