import type { CSSProperties } from 'react';
import { FORMATIONS } from '../../domain/formations';
import { leagueTable } from '../../domain/fixtures';
import { autoLineup, validateLineup } from '../../domain/lineup';
import { rating, shortName } from '../../domain/player';
import { LEAGUE_NAMES } from '../../domain/types';
import { applyResult, createMatch, ordinal, userClub } from '../../simulation/world/season';
import { Form, PageHead, Panel, PosTag, Rating } from '../components/Bits';
import { Crest } from '../components/Graphics';
import { useStore, useWorld } from '../store';

export function PreMatch() {
  const store = useStore();
  const world = useWorld();
  const f = world.fixtures.find((x) => x.id === store.params.fixture);
  const club = userClub(world);
  if (!f || !club) return <div className="page">No match to play.</div>;
  const opp = world.clubs[f.home === club.id ? f.away : f.home];
  const oppLineup = autoLineup(world, opp).lineup;
  const issues = validateLineup(world, club);
  const errors = issues.filter((i) => i.severity === 'error');
  const table = leagueTable(world, f.division);

  const instant = () => {
    const m = createMatch(world, f, false);
    m.runToEnd();
    store.mutate((w) => applyResult(w, w.fixtures.find((x) => x.id === f.id)!, m), true);
    store.go('report', { fixture: f.id });
  };

  const XI = ({ c, starters }: { c: typeof club; starters: (string | null)[] }) => {
    const slots = FORMATIONS[c.tactics.formation];
    return (
      <table className="table">
        <tbody>
          {starters.map((id, i) => {
            const p = id ? world.players[id] : null;
            return (
              <tr key={i}>
                <td style={{ width: 50 }}>
                  <PosTag pos={slots[i].pos} />
                </td>
                <td>
                  {p ? (
                    <span className="player-cell">
                      <span className="num" style={{ width: 26, fontSize: 18 }}>
                        {p.number}
                      </span>
                      <span className="name">{shortName(p)}</span>
                    </span>
                  ) : (
                    <span className="muted">Empty</span>
                  )}
                </td>
                <td className="r">{p && <Rating value={rating(p, slots[i].pos)} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const home = world.clubs[f.home];
  const away = world.clubs[f.away];
  return (
    <div className="page">
      <PageHead title="Matchday" sub={`${LEAGUE_NAMES[f.division]}, matchweek ${f.week}, at ${home.stadium}.`}>
        <button className="btn ghost" onClick={() => store.go('squad')}>
          Change team
        </button>
        <button className="btn ghost" onClick={() => store.go('tactics')}>
          Change tactics
        </button>
      </PageHead>

      <div className="report-hero" style={{ marginBottom: 20 }}>
        {[home, away].map((c, i) => (
          <div key={c.id} className={`team ${i ? 'away' : ''}`} style={i === 1 ? { gridColumn: 3 } : undefined}>
            <Crest club={c} size={78} />
            <div>
              <b>{c.name}</b>
              <div className="scorers">
                {ordinal(table.findIndex((r) => r.clubId === c.id) + 1)} in the table, {c.tactics.formation}
              </div>
              <div style={{ marginTop: 6 }}>
                <Form results={table.find((r) => r.clubId === c.id)?.form ?? []} />
              </div>
            </div>
          </div>
        ))}
        <div className="score" style={{ gridColumn: 2, gridRow: 1, fontSize: 'clamp(40px, 6vw, 70px)' }}>
          v
        </div>
      </div>

      {errors.length > 0 && (
        <div className="notice error" style={{ marginBottom: 16 }}>
          {errors[0].message} Fix the team before kick-off.
        </div>
      )}

      <div className="grid cols-3">
        <Panel title={`${club.short} starting XI`} flush>
          <XI c={club} starters={club.lineup.starters} />
        </Panel>
        <Panel title={`${opp.short} expected XI`} flush>
          <XI c={opp} starters={oppLineup.starters} />
        </Panel>
        <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
          <Panel title="Kick-off" style={clubThemeVars(club)}>
            <div style={{ display: 'grid', gap: 10 }}>
              <button
                className="continue"
                disabled={errors.length > 0}
                onClick={() => {
                  store.mutate((w) => (w.settings.playbackMode = 'full'));
                  store.go('match', { fixture: f.id });
                }}
              >
                <span>
                  <b>Watch the match</b>
                  <small>Full 90 minutes, with speed controls</small>
                </span>
              </button>
              <button
                className="btn"
                disabled={errors.length > 0}
                onClick={() => {
                  store.mutate((w) => (w.settings.playbackMode = 'highlights'));
                  store.go('match', { fixture: f.id });
                }}
              >
                Watch key highlights
              </button>
              <button className="btn ghost" disabled={errors.length > 0} onClick={instant}>
                Instant result
              </button>
              <p className="muted" style={{ fontSize: 13 }}>
                Every option runs the same simulation. Instant result uses the assistant for substitutions only when a player is injured.
              </p>
            </div>
          </Panel>
          <Panel title="Your instructions">
            <dl className="kv">
              <dt>Formation</dt>
              <dd>{club.tactics.formation}</dd>
              <dt>Mentality</dt>
              <dd>{['Very defensive', 'Defensive', 'Balanced', 'Attacking', 'Very attacking'][club.tactics.mentality]}</dd>
              <dt>Pressing</dt>
              <dd>{['Stand off', 'Low', 'Medium', 'High', 'Relentless'][club.tactics.pressing]}</dd>
              <dt>Passing</dt>
              <dd>{['Very short', 'Short', 'Mixed', 'Direct', 'Very direct'][club.tactics.directness]}</dd>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function clubThemeVars(_c: unknown): CSSProperties {
  return {};
}
