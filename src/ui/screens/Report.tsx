import { shortName } from '../../domain/player';
import { LEAGUE_NAMES } from '../../domain/types';
import { userClub, userFixtureThisWeek } from '../../simulation/world/season';
import { MatchRating, PageHead, Panel } from '../components/Bits';
import { Crest } from '../components/Graphics';
import { useStore, useWorld } from '../store';

export function Report() {
  const store = useStore();
  const world = useWorld();
  const f = world.fixtures.find((x) => x.id === store.params.fixture);
  if (!f || !f.result) return <div className="page">No report available.</div>;
  const r = f.result;
  const home = world.clubs[f.home];
  const away = world.clubs[f.away];
  const club = userClub(world);
  const mine = club && (f.home === club.id || f.away === club.id);
  const pendingWeek = mine && !userFixtureThisWeek(world) && f.week === world.week;
  const s = r.stats;

  const ratings = (clubId: string) =>
    Object.entries(r.ratings ?? {})
      .filter(([id]) => world.players[id]?.clubId === clubId || r.scorers.some((x) => x.playerId === id && x.club === clubId))
      .map(([id, v]) => ({ p: world.players[id], v }))
      .filter((x) => x.p)
      .sort((a, b) => b.v - a.v);

  const scorerLine = (clubId: string) =>
    r.scorers
      .filter((x) => x.club === clubId)
      .map((x) => `${world.players[x.playerId] ? shortName(world.players[x.playerId]) : 'Unknown'} ${x.minute}'${x.pen ? ' (pen)' : ''}${x.og ? ' (og)' : ''}`)
      .join(', ');

  const userWon = mine && ((f.home === club!.id && r.homeGoals > r.awayGoals) || (f.away === club!.id && r.awayGoals > r.homeGoals));
  const draw = r.homeGoals === r.awayGoals;

  return (
    <div className="page">
      <PageHead title={mine ? (userWon ? 'Victory' : draw ? 'A draw' : 'Defeat') : 'Match report'} sub={`${LEAGUE_NAMES[f.division]}, matchweek ${f.week}. Attendance ${r.attendance.toLocaleString()} at ${home.stadium}.`}>
        {pendingWeek ? (
          <button className="btn club" onClick={() => store.advance()}>
            Continue to the other results
          </button>
        ) : (
          <button className="btn ghost" onClick={() => store.go('competition')}>
            Back to the league
          </button>
        )}
      </PageHead>

      <div className="report-hero" style={{ marginBottom: 20 }}>
        <div className="team">
          <Crest club={home} size={86} />
          <div>
            <b>{home.name}</b>
            <div className="scorers">{scorerLine(home.id)}</div>
          </div>
        </div>
        <div className="score">
          {r.homeGoals}–{r.awayGoals}
        </div>
        <div className="team away">
          <Crest club={away} size={86} />
          <div>
            <b>{away.name}</b>
            <div className="scorers">{scorerLine(away.id)}</div>
          </div>
        </div>
      </div>

      <div className="grid cols-3">
        <Panel title="Match stats">
          {s ? (
            (
              [
                ['Possession', s.possession, '%'],
                ['Shots', s.shots],
                ['On target', s.onTarget],
                ['Passes', s.passes],
                ['Pass accuracy', s.passAcc, '%'],
                ['Corners', s.corners],
                ['Fouls', s.fouls],
                ['Cards', [s.yellows[0] + s.reds[0], s.yellows[1] + s.reds[1]]],
              ] as [string, [number, number], string?][]
            ).map(([label, [a, b], suf]) => {
              const tot = a + b || 1;
              return (
                <div key={label} className="compare">
                  <span className="num">
                    {a}
                    {suf}
                  </span>
                  <div>
                    <div className="label">{label}</div>
                    <div className="split">
                      <i style={{ width: `${(a / tot) * 100}%`, background: home.kit.primary === '#FFFFFF' ? '#13203a' : home.kit.primary }} />
                      <i style={{ width: `${(b / tot) * 100}%`, background: away.kit.primary === '#FFFFFF' ? '#8d97ab' : away.kit.primary }} />
                    </div>
                  </div>
                  <span className="num" style={{ textAlign: 'right' }}>
                    {b}
                    {suf}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="muted">No stats recorded.</p>
          )}
        </Panel>
        {[home, away].map((c) => (
          <Panel key={c.id} title={`${c.short} ratings`} flush>
            <table className="table">
              <tbody>
                {ratings(c.id).map(({ p, v }) => (
                  <tr key={p.id} className="clickable" onClick={() => store.openPlayer(p.id)}>
                    <td>
                      <span className="player-cell">
                        <span className="num" style={{ width: 26, fontSize: 18 }}>
                          {p.number}
                        </span>
                        <span className="name">{shortName(p)}</span>
                        {r.motm === p.id && <span className="flag good">Player of the match</span>}
                      </span>
                    </td>
                    <td className="r">
                      <MatchRating value={v} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        ))}
      </div>
    </div>
  );
}
