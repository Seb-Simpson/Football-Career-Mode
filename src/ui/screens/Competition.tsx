import { useState } from 'react';
import { leagueTable } from '../../domain/fixtures';
import { shortName } from '../../domain/player';
import { LEAGUE_NAMES, MATCHWEEKS, PROMOTION_PLACES } from '../../domain/types';
import { userClub } from '../../simulation/world/season';
import { Form, PageHead, Panel, Segmented } from '../components/Bits';
import { Crest } from '../components/Graphics';
import { useStore, useWorld } from '../store';

export function Competition() {
  const store = useStore();
  const world = useWorld();
  const club = userClub(world);
  const [div, setDiv] = useState<0 | 1>(club?.division ?? 0);
  const [week, setWeek] = useState(Math.max(1, Math.min(world.week, MATCHWEEKS)));
  const table = leagueTable(world, div);
  const fixtures = world.fixtures.filter((f) => f.division === div && f.week === week);
  const scorers = Object.values(world.players)
    .filter((p) => p.clubId && world.clubs[p.clubId].division === div && p.stats.goals > 0)
    .sort((a, b) => b.stats.goals - a.stats.goals || a.stats.apps - b.stats.apps)
    .slice(0, 10);

  return (
    <div className="page">
      <PageHead title={LEAGUE_NAMES[div]} sub={div === 0 ? 'Ten clubs, home and away. The bottom two are relegated.' : 'Ten clubs, home and away. The top two win promotion.'}>
        <Segmented
          label="Division"
          value={div}
          onChange={(v) => setDiv(v)}
          options={[
            { value: 0, label: LEAGUE_NAMES[0] },
            { value: 1, label: LEAGUE_NAMES[1] },
          ]}
        />
      </PageHead>
      <div className="grid cols-3">
        <Panel title="Table" flush className="span-2">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Club</th>
                  <th className="r">P</th>
                  <th className="r">W</th>
                  <th className="r">D</th>
                  <th className="r">L</th>
                  <th className="r hide-sm">GF</th>
                  <th className="r hide-sm">GA</th>
                  <th className="r">GD</th>
                  <th className="r">Pts</th>
                  <th className="hide-sm">Form</th>
                </tr>
              </thead>
              <tbody>
                {table.map((r, i) => {
                  const c = world.clubs[r.clubId];
                  const zone = div === 0 ? (i >= table.length - PROMOTION_PLACES ? 'zone-down' : '') : i < PROMOTION_PLACES ? 'zone-up' : '';
                  return (
                    <tr key={r.clubId} className={`${r.clubId === club?.id ? 'mine' : ''} ${zone}`}>
                      <td className="pos-cell">{i + 1}</td>
                      <td>
                        <span className="player-cell">
                          <Crest club={c} size={26} />
                          <span className="name">{c.name}</span>
                        </span>
                      </td>
                      <td className="r">{r.p}</td>
                      <td className="r">{r.w}</td>
                      <td className="r">{r.d}</td>
                      <td className="r">{r.l}</td>
                      <td className="r hide-sm">{r.gf}</td>
                      <td className="r hide-sm">{r.ga}</td>
                      <td className="r">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                      <td className="r num" style={{ fontSize: 19 }}>
                        {r.pts}
                      </td>
                      <td className="hide-sm">
                        <Form results={r.form} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 12.5, padding: '10px 14px' }}>
            Ties are split by goal difference, goals scored, head-to-head points, then name. {div === 0 ? 'Red edge: relegation places.' : 'Green edge: promotion places.'}
          </p>
        </Panel>

        <Panel title="Top scorers" flush>
          {scorers.length === 0 ? (
            <p className="empty">No goals yet this season.</p>
          ) : (
            <table className="table">
              <tbody>
                {scorers.map((p, i) => (
                  <tr key={p.id} className="clickable" onClick={() => store.openPlayer(p.id)}>
                    <td className="pos-cell">{i + 1}</td>
                    <td>
                      <span className="player-cell">
                        <Crest club={world.clubs[p.clubId!]} size={22} />
                        <span className="name">{shortName(p)}</span>
                      </span>
                    </td>
                    <td className="r num" style={{ fontSize: 19 }}>
                      {p.stats.goals}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel
          title={`Matchweek ${week}`}
          className="span-2"
          tools={
            <>
              <button className="btn ghost small" disabled={week <= 1} onClick={() => setWeek(week - 1)} aria-label="Previous matchweek">
                Prev
              </button>
              <button className="btn ghost small" disabled={week >= MATCHWEEKS} onClick={() => setWeek(week + 1)} aria-label="Next matchweek">
                Next
              </button>
            </>
          }
          flush
        >
          {fixtures.map((f) => {
            const h = world.clubs[f.home];
            const a = world.clubs[f.away];
            const mine = f.home === club?.id || f.away === club?.id;
            return (
              <button
                key={f.id}
                className="club-row"
                style={{ gridTemplateColumns: '1fr 84px 1fr', background: mine ? 'color-mix(in srgb, var(--club) 8%, transparent)' : undefined }}
                onClick={() => f.result && store.go('report', { fixture: f.id })}
                disabled={!f.result}
                aria-label={`${h.name} v ${a.name}${f.result ? `, ${f.result.homeGoals}–${f.result.awayGoals}` : ''}`}
              >
                <span className="player-cell" style={{ justifyContent: 'flex-end' }}>
                  <span className="name" style={{ fontWeight: 650 }}>
                    {h.name}
                  </span>
                  <Crest club={h} size={28} />
                </span>
                <span className="num" style={{ textAlign: 'center', fontSize: 26, background: f.result ? 'var(--ink)' : 'var(--line-2)', color: f.result ? '#fff' : 'var(--ink-3)', padding: '2px 0' }}>
                  {f.result ? `${f.result.homeGoals}–${f.result.awayGoals}` : 'v'}
                </span>
                <span className="player-cell">
                  <Crest club={a} size={28} />
                  <span className="name" style={{ fontWeight: 650 }}>
                    {a.name}
                  </span>
                </span>
              </button>
            );
          })}
        </Panel>

        <Panel title="Roll of honour">
          {world.champions.length === 0 ? (
            <p className="muted">The first champions will be crowned at the end of this season.</p>
          ) : (
            <dl className="kv">
              {world.champions
                .filter((c) => c.division === div)
                .slice()
                .reverse()
                .map((c) => (
                  <div key={c.season} style={{ display: 'contents' }}>
                    <dt>
                      {c.season}/{String(c.season + 1).slice(2)}
                    </dt>
                    <dd>{world.clubs[c.club].name}</dd>
                  </div>
                ))}
            </dl>
          )}
        </Panel>
      </div>
    </div>
  );
}
