import { useMemo, useState } from 'react';
import { FORMATIONS } from '../../domain/formations';
import { clubPlayers } from '../../domain/generate';
import { autoLineup, validateLineup } from '../../domain/lineup';
import { familiarity, overall, rating, shortName } from '../../domain/player';
import { BENCH_SIZE, type Player, type Position } from '../../domain/types';
import { userClub } from '../../simulation/world/season';
import { Condition, PageHead, Panel, PosTag, Rating, Segmented, ShirtNo, StatusFlags } from '../components/Bits';
import { BoardLines, Shirt } from '../components/Graphics';
import { Icon } from '../components/Icons';
import { useStore, useWorld } from '../store';

type Sel = { kind: 'slot'; i: number } | { kind: 'bench'; i: number } | { kind: 'player'; id: string } | null;
type Group = 'all' | 'GK' | 'DEF' | 'MID' | 'ATT';

const GROUP: Record<Position, Group> = { GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', DM: 'MID', CM: 'MID', AM: 'MID', LW: 'ATT', RW: 'ATT', ST: 'ATT' };
const ORDER: Position[] = ['GK', 'RB', 'CB', 'LB', 'DM', 'CM', 'AM', 'RW', 'LW', 'ST'];

export function Squad() {
  const world = useWorld();
  if (!userClub(world)) return <div className="page">You are not managing a club.</div>;
  return <SquadInner />;
}

function SquadInner() {
  const store = useStore();
  const world = useWorld();
  const club = userClub(world)!;
  const [sel, setSel] = useState<Sel>(null);
  const [group, setGroup] = useState<Group>('all');
  const [notes, setNotes] = useState<string[] | null>(null);
  const [sort, setSort] = useState<'pos' | 'rating' | 'age' | 'fitness'>('pos');
  const slots = FORMATIONS[club.tactics.formation];
  const { starters, bench } = club.lineup;
  const squad = clubPlayers(world, club.id);
  const issues = validateLineup(world, club);
  const issueIds = new Set(issues.filter((i) => i.playerId).map((i) => i.playerId));

  const list = useMemo(() => {
    const l = squad.filter((p) => group === 'all' || GROUP[p.pos] === group);
    return l.sort((a, b) => {
      if (sort === 'rating') return overall(b) - overall(a);
      if (sort === 'age') return a.age - b.age;
      if (sort === 'fitness') return b.fitness - a.fitness;
      return ORDER.indexOf(a.pos) - ORDER.indexOf(b.pos) || overall(b) - overall(a);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squad.length, group, sort, store.version]);

  const idAt = (s: Exclude<Sel, null>): string | null => (s.kind === 'slot' ? starters[s.i] : s.kind === 'bench' ? bench[s.i] ?? null : s.id);

  const place = (target: Exclude<Sel, null>) => {
    if (!sel) return setSel(target);
    const same = JSON.stringify(sel) === JSON.stringify(target);
    if (same) return setSel(null);
    const a = idAt(sel);
    const b = idAt(target);
    if (sel.kind === 'player' && target.kind === 'player') return setSel(target);
    store.mutate((w) => {
      const lu = w.clubs[club.id].lineup;
      const st = [...lu.starters];
      const bn = [...lu.bench];
      const locate = (id: string | null) => {
        if (!id) return null;
        const si = st.indexOf(id);
        if (si >= 0) return { kind: 'slot' as const, i: si };
        const bi = bn.indexOf(id);
        if (bi >= 0) return { kind: 'bench' as const, i: bi };
        return null;
      };
      const posA = sel.kind === 'player' ? locate(a) : sel;
      const posB = target.kind === 'player' ? locate(b) : target;
      const write = (pos: { kind: 'slot' | 'bench'; i: number } | null, id: string | null) => {
        if (!pos) return;
        if (pos.kind === 'slot') st[pos.i] = id;
        else if (id) bn[pos.i] = id;
        else bn.splice(pos.i, 1);
      };
      // Bench may need to grow when placing into an empty bench slot.
      if (posB && posB.kind === 'bench' && posB.i >= bn.length) {
        if (a) {
          write(posA as any, null);
          if (!bn.includes(a)) bn.push(a);
        }
      } else {
        write(posB as any, a);
        write(posA as any, b);
      }
      lu.starters = st;
      lu.bench = bn.filter(Boolean).filter((id, i, arr) => arr.indexOf(id) === i && !st.includes(id)).slice(0, BENCH_SIZE);
    });
    setSel(null);
    setNotes(null);
  };

  const selectedId = sel ? idAt(sel) : null;

  return (
    <div className="page">
      <PageHead title="Squad" sub={sel ? 'Now choose where to put them: a pitch position, a bench spot, or another player to swap with.' : 'Tap a player, then tap a position or another player to swap. No dragging needed.'}>
        <button
          className="btn ghost"
          onClick={() => {
            const r = autoLineup(world, club);
            store.mutate((w) => (w.clubs[club.id].lineup = r.lineup));
            setNotes(r.notes);
            setSel(null);
          }}
        >
          <Icon.wand /> Assistant's pick
        </button>
        <button className="btn" onClick={() => store.go('tactics')}>
          Tactics: {club.tactics.formation}
        </button>
      </PageHead>

      {notes && (
        <div className="notice good" style={{ marginBottom: 16 }}>
          <div>
            <b>Assistant:</b> {notes.join(' ')}
          </div>
        </div>
      )}
      {issues.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
          {issues.slice(0, 4).map((i, k) => (
            <div key={k} className={`notice ${i.severity === 'error' ? 'error' : 'warn'}`}>
              {i.message}
            </div>
          ))}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(300px, 460px) minmax(0, 1fr)', alignItems: 'start' }} data-squad-grid>
        <div className="panel">
          <div className="pitch-board">
            <BoardLines />
            {slots.map((s, i) => {
              const id = starters[i];
              const p = id ? world.players[id] : null;
              const top = ((78.5 - s.u * 125) / 80) * 100;
              const left = ((1.5 + s.v * 65) / 68) * 100;
              const isSel = sel?.kind === 'slot' && sel.i === i;
              const fam = p ? familiarity(p, s.pos) : 1;
              return (
                <button
                  key={i}
                  className={`slot ${isSel ? 'selected' : ''} ${sel && !isSel ? 'target' : ''} ${p && issueIds.has(p.id) ? 'issue' : ''}`}
                  style={{ top: `${top}%`, left: `${left}%` }}
                  onClick={() => place({ kind: 'slot', i })}
                  aria-label={p ? `${s.pos}: ${shortName(p)}, rating ${rating(p, s.pos)}` : `${s.pos}: empty`}
                >
                  <span className="slot-pos">{s.pos}</span>
                  {p ? (
                    <span className="shirt">
                      <Shirt kit={club.kit} number={p.number} size={44} keeper={s.pos === 'GK'} />
                      <span className="mini-rating" style={{ background: fam < 0.9 ? 'var(--amber)' : undefined }}>
                        {rating(p, s.pos)}
                      </span>
                    </span>
                  ) : (
                    <span className="empty-shirt">+</span>
                  )}
                  <span className="label">{p ? p.last : 'Empty'}</span>
                </button>
              );
            })}
          </div>
          <div className="bench" aria-label="Substitutes">
            {Array.from({ length: BENCH_SIZE }, (_, i) => {
              const id = bench[i];
              const p = id ? world.players[id] : null;
              const isSel = sel?.kind === 'bench' && sel.i === i;
              return (
                <button key={i} className={`slot ${isSel ? 'selected' : ''} ${sel && !isSel ? 'target' : ''}`} onClick={() => place({ kind: 'bench', i: p ? i : bench.length })} aria-label={p ? `Substitute: ${shortName(p)}` : 'Empty bench spot'}>
                  <span className="slot-pos">{p ? p.pos : 'SUB'}</span>
                  {p ? (
                    <span className="shirt" style={{ width: 36, height: 36 }}>
                      <Shirt kit={club.kit} number={p.number} size={36} keeper={p.pos === 'GK'} />
                    </span>
                  ) : (
                    <span className="empty-shirt" style={{ width: 36, height: 36 }}>
                      +
                    </span>
                  )}
                  <span className="label">{p ? p.last : 'Empty'}</span>
                </button>
              );
            })}
          </div>
        </div>

        <Panel
          title={`Players (${squad.length})`}
          flush
          tools={
            <Segmented
              label="Filter by position"
              value={group}
              onChange={setGroup}
              options={[
                { value: 'all', label: 'All' },
                { value: 'GK', label: 'GK' },
                { value: 'DEF', label: 'Def' },
                { value: 'MID', label: 'Mid' },
                { value: 'ATT', label: 'Att' },
              ]}
            />
          }
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>
                    <button onClick={() => setSort('pos')} aria-sort={sort === 'pos' ? 'ascending' : undefined}>
                      Player
                    </button>
                  </th>
                  <th className="c">Pos</th>
                  <th className="c">
                    <button onClick={() => setSort('rating')} aria-sort={sort === 'rating' ? 'descending' : undefined}>
                      Rating
                    </button>
                  </th>
                  <th className="hide-sm">
                    <button onClick={() => setSort('fitness')} aria-sort={sort === 'fitness' ? 'descending' : undefined}>
                      Condition
                    </button>
                  </th>
                  <th className="r hide-sm">
                    <button onClick={() => setSort('age')} aria-sort={sort === 'age' ? 'ascending' : undefined}>
                      Age
                    </button>
                  </th>
                  <th className="hide-sm">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((p: Player) => {
                  const si = starters.indexOf(p.id);
                  const bi = bench.indexOf(p.id);
                  const role = si >= 0 ? slots[si].pos : bi >= 0 ? 'Sub' : '';
                  return (
                    <tr key={p.id} className={`clickable ${selectedId === p.id ? 'row-selected' : ''}`} onClick={() => place(si >= 0 ? { kind: 'slot', i: si } : bi >= 0 ? { kind: 'bench', i: bi } : { kind: 'player', id: p.id })}>
                      <td style={{ width: 54 }}>
                        <span style={{ fontWeight: 700, fontSize: 12.5, color: si >= 0 ? 'var(--ink)' : 'var(--ink-3)' }}>{role || '–'}</span>
                      </td>
                      <td>
                        <span className="player-cell">
                          <ShirtNo n={p.number} club={club} />
                          <span>
                            <span className="name">
                              {p.first} {p.last}
                            </span>
                            <small>{p.alt.length ? `Also ${p.alt.join(', ')}` : ' '}</small>
                          </span>
                        </span>
                      </td>
                      <td className="c">
                        <PosTag pos={p.pos} />
                      </td>
                      <td className="c">
                        <Rating value={si >= 0 ? rating(p, slots[si].pos) : overall(p)} />
                      </td>
                      <td className="hide-sm">
                        <Condition value={p.fitness} />
                      </td>
                      <td className="r hide-sm">{p.age}</td>
                      <td className="hide-sm">
                        <span style={{ display: 'inline-flex', gap: 4 }}>
                          <StatusFlags p={p} />
                        </span>
                      </td>
                      <td className="r">
                        <button
                          className="link"
                          onClick={(e) => {
                            e.stopPropagation();
                            store.openPlayer(p.id);
                          }}
                        >
                          Profile
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
