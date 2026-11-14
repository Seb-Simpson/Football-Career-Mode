import { shortName } from '../../domain/player';
import { LEAGUE_NAMES } from '../../domain/types';
import { ordinal } from '../../simulation/world/season';
import { PageHead, Panel } from '../components/Bits';
import { Crest } from '../components/Graphics';
import { useStore, useWorld } from '../store';

export function SeasonReview() {
  const store = useStore();
  const world = useWorld();
  const s = store.seasonSummary;
  if (!s) {
    return (
      <div className="page">
        <PageHead title="Season review" />
        <button className="btn" onClick={() => store.go('home')}>
          Go to the dashboard
        </button>
      </div>
    );
  }
  const name = (id: string) => world.clubs[id]?.name ?? id;
  const playerName = (id: string) => (world.players[id] ? shortName(world.players[id]) : 'Retired player');

  return (
    <div className="page">
      <PageHead
        title={`${s.season}/${String(s.season + 1).slice(2)} in review`}
        sub={
          s.userPosition
            ? `You finished ${ordinal(s.userPosition)} in the ${LEAGUE_NAMES[s.userDivision!]}. ${s.objectiveMet ? 'The board is satisfied: objective met.' : 'The board expected more.'}`
            : 'A season spent away from the dugout.'
        }
      >
        <button className="btn club" onClick={() => store.go('home')}>
          Begin {world.season}/{String(world.season + 1).slice(2)}
        </button>
      </PageHead>
      <div className="grid cols-3">
        {s.tables.map((t) => (
          <Panel key={t.division} title={`${LEAGUE_NAMES[t.division]} final table`} flush>
            <table className="table">
              <tbody>
                {t.rows.map((r, i) => {
                  const up = t.division === 1 && s.promoted.includes(r.clubId);
                  const down = t.division === 0 && s.relegated.includes(r.clubId);
                  return (
                    <tr key={r.clubId} className={`${up ? 'zone-up' : ''} ${down ? 'zone-down' : ''} ${r.clubId === world.manager.clubId || world.manager.history.at(-1)?.club === r.clubId ? 'mine' : ''}`}>
                      <td className="pos-cell">{i + 1}</td>
                      <td>
                        <span className="player-cell">
                          <Crest club={world.clubs[r.clubId]} size={22} />
                          <span className="name">{name(r.clubId)}</span>
                          {up && <span className="flag good">Promoted</span>}
                          {down && <span className="flag inj">Relegated</span>}
                        </span>
                      </td>
                      <td className="r num" style={{ fontSize: 18 }}>
                        {r.pts}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        ))}
        <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
          <Panel title="Champions">
            <div style={{ display: 'grid', gap: 14 }}>
              {s.champions.map((id, div) => (
                <div key={id} className="player-cell">
                  <Crest club={world.clubs[id]} size={44} />
                  <div>
                    <b style={{ font: '800 22px/1 var(--display)' }}>{name(id)}</b>
                    <small>{LEAGUE_NAMES[div]}</small>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Golden boot">
            <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
              {s.topScorers.map((t) => (
                <li key={t.playerId}>
                  {playerName(t.playerId)}: {t.goals}
                </li>
              ))}
            </ol>
          </Panel>
          {(s.retirements.length > 0 || s.expired.length > 0 || s.youth.length > 0) && (
            <Panel title="Squad changes">
              <div style={{ display: 'grid', gap: 10, fontSize: 14 }}>
                {s.youth.length > 0 && (
                  <p>
                    <b>Academy graduates:</b> {s.youth.map(playerName).join(', ')}.
                  </p>
                )}
                {s.expired.length > 0 && (
                  <p>
                    <b>Contracts expired:</b> {s.expired.map(playerName).join(', ')}.
                  </p>
                )}
                {s.retirements.length > 0 && (
                  <p>
                    <b>Retired:</b> {s.retirements.length} player{s.retirements.length > 1 ? 's' : ''}.
                  </p>
                )}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
