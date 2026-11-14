import { useMemo, useState } from 'react';
import { clubPlayers } from '../../domain/generate';
import { overall, playerValue, ratingRange, wageDemand } from '../../domain/player';
import { POSITIONS, type Position } from '../../domain/types';
import { askingPrice, isWindowOpen, money, userClub } from '../../simulation/world/season';
import { PageHead, Panel, PosTag, Rating, Segmented, ShirtNo } from '../components/Bits';
import { Crest } from '../components/Graphics';
import { useStore, useWorld } from '../store';

export function Transfers() {
  const store = useStore();
  const world = useWorld();
  const club = userClub(world);
  const [pos, setPos] = useState<Position | 'any'>('any');
  const [who, setWho] = useState<'all' | 'free' | 'listed' | 'scouted'>('all');
  const [maxAge, setMaxAge] = useState(40);
  const [maxFee, setMaxFee] = useState(0);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'rating' | 'fee' | 'age'>('rating');

  const results = useMemo(() => {
    const all = Object.values(world.players).filter((p) => p.clubId !== club?.id);
    return all
      .filter((p) => (pos === 'any' ? true : p.pos === pos || p.alt.includes(pos)))
      .filter((p) => (who === 'free' ? !p.clubId : who === 'listed' ? p.listed : who === 'scouted' ? p.scouted : true))
      .filter((p) => p.age <= maxAge)
      .filter((p) => !maxFee || (p.clubId ? askingPrice(world, p) : 0) <= maxFee)
      .filter((p) => !q || `${p.first} ${p.last}`.toLowerCase().includes(q.toLowerCase()))
      .map((p) => ({ p, est: ratingRange(p, p.scouted), fee: p.clubId ? askingPrice(world, p) : 0 }))
      .sort((a, b) => (sort === 'rating' ? b.est[0] + b.est[1] - (a.est[0] + a.est[1]) : sort === 'fee' ? a.fee - b.fee : a.p.age - b.p.age))
      .slice(0, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, who, maxAge, maxFee, q, sort, store.version]);

  const mineListed = club ? clubPlayers(world, club.id).filter((p) => p.listed) : [];
  const open = isWindowOpen(world);

  return (
    <div className="page">
      <PageHead title="Transfers" sub={open ? 'The window is open. Deals complete immediately once both clubs and the player agree.' : 'The window is closed until the next one opens (pre-season, and matchweeks 9–10). Free agents can be signed at any time.'}>
        {club && (
          <div style={{ display: 'flex', gap: 22, alignItems: 'flex-end' }}>
            <div className="stat-big">
              <span>Transfer budget</span>
              <span className="num" style={{ fontSize: 30 }}>
                {money(club.transferBudget)}
              </span>
            </div>
            <div className="stat-big">
              <span>Wage room</span>
              <span className="num" style={{ fontSize: 30 }}>
                {money(club.wageBudget - clubPlayers(world, club.id).reduce((s, p) => s + p.contract.wage, 0))}
              </span>
            </div>
          </div>
        )}
      </PageHead>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
          <label className="field" style={{ minWidth: 200, flex: '1 1 200px' }}>
            Search by name
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Player name" />
          </label>
          <label className="field">
            Position
            <select value={pos} onChange={(e) => setPos(e.target.value as Position | 'any')}>
              <option value="any">Any</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Max age
            <select value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))}>
              {[21, 23, 25, 28, 31, 40].map((a) => (
                <option key={a} value={a}>
                  {a === 40 ? 'Any' : `${a} or under`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Max fee
            <select value={maxFee} onChange={(e) => setMaxFee(Number(e.target.value))}>
              <option value={0}>Any</option>
              {[250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000].map((f) => (
                <option key={f} value={f}>
                  {money(f)}
                </option>
              ))}
            </select>
          </label>
          <Segmented
            label="Availability"
            value={who}
            onChange={setWho}
            options={[
              { value: 'all', label: 'All' },
              { value: 'listed', label: 'Listed' },
              { value: 'free', label: 'Free' },
              { value: 'scouted', label: 'Scouted' },
            ]}
          />
        </div>
      </div>

      <div className="grid cols-3">
        <Panel
          title={`Players (${results.length}${results.length === 80 ? '+' : ''})`}
          flush
          className="span-2"
          tools={
            <Segmented
              label="Sort"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'rating', label: 'Best' },
                { value: 'fee', label: 'Cheapest' },
                { value: 'age', label: 'Youngest' },
              ]}
            />
          }
        >
          {results.length === 0 ? (
            <p className="empty">No players match these filters. Try widening the position or fee.</p>
          ) : (
            <div className="table-wrap" style={{ maxHeight: '70vh' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th className="c">Pos</th>
                    <th className="c">Rating</th>
                    <th className="r">Age</th>
                    <th className="hide-sm">Club</th>
                    <th className="r">Asking</th>
                    <th className="r hide-sm">Wage ask</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(({ p, est, fee }) => (
                    <tr key={p.id} className="clickable" onClick={() => store.openPlayer(p.id)}>
                      <td>
                        <span className="player-cell">
                          <span className="name">
                            {p.first} {p.last}
                          </span>
                          {p.listed && <span className="flag info">Listed</span>}
                        </span>
                      </td>
                      <td className="c">
                        <PosTag pos={p.pos} />
                      </td>
                      <td className="c">
                        <Rating value={overall(p)} range={est} />
                      </td>
                      <td className="r">{p.age}</td>
                      <td className="hide-sm">
                        {p.clubId ? (
                          <span className="player-cell">
                            <Crest club={world.clubs[p.clubId]} size={22} />
                            <span>{world.clubs[p.clubId].short}</span>
                          </span>
                        ) : (
                          <span className="muted">Free agent</span>
                        )}
                      </td>
                      <td className="r" style={{ fontWeight: 650 }}>
                        {p.clubId ? (p.scouted ? money(fee) : `~${money(Math.round(fee / 100000) * 100000 || fee)}`) : 'Free'}
                      </td>
                      <td className="r hide-sm">{money(wageDemand(p))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
          <Panel title="Your transfer list" flush>
            {mineListed.length === 0 ? (
              <p className="empty">Nobody is listed. Open a player's profile to make him available; bids arrive in your inbox.</p>
            ) : (
              <table className="table">
                <tbody>
                  {mineListed.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => store.openPlayer(p.id)}>
                      <td>
                        <span className="player-cell">
                          <ShirtNo n={p.number} club={club} />
                          <span className="name">{p.last}</span>
                        </span>
                      </td>
                      <td className="r">{money(playerValue(p, world.season))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="How deals work">
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8, fontSize: 14 }}>
              <li>Scout a player to see exact attributes and his club's valuation. Reports take a week.</li>
              <li>Clubs accept bids at or above their valuation; key players cost more.</li>
              <li>The player must accept the wage, and it must fit your wage budget.</li>
              <li>Fees and registration happen in one step, so a deal can never half-complete.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
