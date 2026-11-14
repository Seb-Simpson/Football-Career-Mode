import { useEffect, useState, type CSSProperties } from 'react';
import { ATTR_GROUPS, ATTR_LABELS, avgRating, overall, playerValue, potentialBand, ratingRange, wageDemand } from '../../domain/player';
import { NATIONS } from '../../data/names';
import { askingPrice, isWindowOpen, makeBid, money, releasePlayer, renewContract, renewalDemand, userClub } from '../../simulation/world/season';
import { useStore, useWorld } from '../store';
import { accent, contrastText } from '../theme';
import { Meter, PosTag, Rating, StatusFlags } from './Bits';
import { Crest } from './Graphics';
import { Icon } from './Icons';

export function PlayerProfile({ id, onClose }: { id: string; onClose: () => void }) {
  const store = useStore();
  const world = useWorld();
  const p = world.players[id];
  const [dialog, setDialog] = useState<'renew' | 'bid' | 'release' | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (dialog ? setDialog(null) : onClose());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, onClose]);

  if (!p) return null;
  const club = p.clubId ? world.clubs[p.clubId] : null;
  const mine = !!club && club.id === world.manager.clubId;
  const known = mine || p.scouted;
  const pending = (world.scoutQueue ?? []).includes(p.id);
  const headBg = club ? accent(club.kit) : '#4b5568';
  const nation = NATIONS.find((n) => n.code === p.nation)?.name ?? p.nation;
  const range = ratingRange(p, known);
  const avg = avgRating(p);
  const value = playerValue(p, world.season);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${p.first} ${p.last}`}>
        <div className="drawer-head" style={{ '--h-bg': headBg, '--h-fg': contrastText(headBg) } as CSSProperties}>
          <button className="drawer-close" onClick={onClose} aria-label="Close profile">
            <Icon.close />
          </button>
          <span className="big-no">{p.number || ''}</span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <PosTag pos={p.pos} />
            {p.alt.map((a) => (
              <span key={a} style={{ fontSize: 12.5, fontWeight: 700, opacity: 0.85 }}>
                {a}
              </span>
            ))}
          </div>
          <h2>
            {p.first} {p.last}
          </h2>
          <p style={{ marginTop: 10, fontSize: 14, opacity: 0.9 }}>
            {p.age} years old, {nation}, {p.foot === 'L' ? 'left' : 'right'}-footed
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            {club ? <Crest club={club} size={30} /> : null}
            <span style={{ fontWeight: 650 }}>{club ? club.name : 'Free agent'}</span>
          </div>
        </div>
        <div className="drawer-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 18 }}>
            <div className="stat-big">
              <span>{known ? 'Rating' : 'Scout estimate'}</span>
              <Rating value={overall(p)} range={range} />
            </div>
            <div className="stat-big">
              <span>Value</span>
              <span className="num" style={{ fontSize: 28 }}>
                {known ? money(value) : `~${money(Math.round(value / 100000) * 100000 || value)}`}
              </span>
            </div>
            <div className="stat-big">
              <span>Outlook</span>
              <span style={{ fontWeight: 650, fontSize: 14 }}>{known ? potentialBand(p) : 'Unknown'}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatusFlags p={p} season={mine ? world.season : undefined} />
          </div>

          {ATTR_GROUPS.filter((g) => g.label !== 'Goalkeeping' || p.pos === 'GK').map((g) => (
            <section key={g.label} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 19, marginBottom: 6 }}>{g.label}</h3>
              {g.keys.map((k) => {
                const v = p.attrs[k];
                const lo = Math.max(1, v - 3 + ((v * 7 + k.length) % 3));
                return (
                  <div key={k} className="attr-row">
                    <span>{ATTR_LABELS[k]}</span>
                    <span className="num">{known ? v : `${lo}+`}</span>
                    {known ? <Meter value={v} /> : <Meter value={lo} color="#9aa3b5" />}
                  </div>
                );
              })}
            </section>
          ))}
          {!known && (
            <div className="notice" style={{ marginBottom: 16 }}>
              {pending ? 'A scout is watching him this week. The report arrives after the next matchday.' : 'Attributes shown are rough minimums from public information. Scout him for a full report.'}
            </div>
          )}

          <section style={{ marginBottom: 18 }}>
            <h3 style={{ fontSize: 19, marginBottom: 8 }}>This season</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {[
                ['Apps', p.stats.apps],
                ['Goals', p.stats.goals],
                ['Assists', p.stats.assists],
                ['Avg rating', avg ? avg.toFixed(2) : '–'],
              ].map(([l, v]) => (
                <div key={l as string} className="stat-big">
                  <span className="num" style={{ fontSize: 28 }}>
                    {v}
                  </span>
                  <span>{l}</span>
                </div>
              ))}
            </div>
            {p.form.length > 0 && (
              <p style={{ marginTop: 10, fontSize: 13.5 }} className="muted">
                Last ratings: {p.form.map((r) => r.toFixed(1)).join(', ')}
              </p>
            )}
          </section>

          {p.history.length > 0 && (
            <section style={{ marginBottom: 18 }}>
              <h3 style={{ fontSize: 19, marginBottom: 8 }}>Career</h3>
              <table className="table">
                <tbody>
                  {p.history
                    .slice()
                    .reverse()
                    .map((h) => (
                      <tr key={h.season + h.club}>
                        <td>
                          {h.season}/{String(h.season + 1).slice(2)}
                        </td>
                        <td>{world.clubs[h.club]?.name}</td>
                        <td className="r">{h.apps} apps</td>
                        <td className="r">{h.goals} goals</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          )}

          <section style={{ marginBottom: 18 }}>
            <h3 style={{ fontSize: 19, marginBottom: 8 }}>Contract</h3>
            <dl className="kv">
              <dt>Wage</dt>
              <dd>{club ? `${money(p.contract.wage)} / week` : `Wants ~${money(wageDemand(p))} / week`}</dd>
              {club && (
                <>
                  <dt>Expires</dt>
                  <dd>Summer {p.contract.expires + 1}</dd>
                </>
              )}
              <dt>Morale</dt>
              <dd>{p.morale >= 70 ? 'Happy' : p.morale >= 45 ? 'Content' : 'Unsettled'}</dd>
              <dt>Condition</dt>
              <dd>{p.fitness}%</dd>
            </dl>
          </section>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {mine ? (
              <>
                <button className="btn" onClick={() => setDialog('renew')}>
                  Offer new contract
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    store.mutate((w) => (w.players[p.id].listed = !w.players[p.id].listed));
                    store.toast(p.listed ? `${p.last} is now on the transfer list.` : `${p.last} was taken off the transfer list.`);
                  }}
                >
                  {p.listed ? 'Remove from transfer list' : 'Add to transfer list'}
                </button>
                <button className="btn ghost" onClick={() => setDialog('release')}>
                  Release
                </button>
              </>
            ) : (
              userClub(world) && (
                <>
                  <button className="btn club" onClick={() => setDialog('bid')} disabled={!!p.clubId && !isWindowOpen(world)}>
                    {p.clubId ? 'Make an offer' : 'Offer a contract'}
                  </button>
                  {!known && !pending && (
                    <button
                      className="btn ghost"
                      onClick={() => {
                        store.mutate((w) => (w.scoutQueue = [...(w.scoutQueue ?? []), p.id]));
                        store.toast(`A scout will report on ${p.last} after the next matchday.`);
                      }}
                    >
                      Send a scout
                    </button>
                  )}
                </>
              )
            )}
          </div>
          {!mine && p.clubId && !isWindowOpen(world) && (
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              The transfer window is closed. It is open in pre-season and in matchweeks 9 and 10.
            </p>
          )}
        </div>
      </aside>
      {dialog === 'renew' && <RenewDialog id={p.id} onClose={() => setDialog(null)} />}
      {dialog === 'bid' && <BidDialog id={p.id} onClose={() => setDialog(null)} />}
      {dialog === 'release' && (
        <Confirm
          title={`Release ${p.last}?`}
          body={`His contract will be settled for about half of what remains. This can't be undone.`}
          confirm="Release player"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            let msg = '';
            let ok = false;
            store.mutate((w) => {
              const r = releasePlayer(w, p.id);
              msg = r.message;
              ok = r.ok;
            }, true);
            store.toast(msg, ok ? 'ok' : 'error');
            setDialog(null);
            if (ok) onClose();
          }}
        />
      )}
    </>
  );
}

function RenewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const store = useStore();
  const world = useWorld();
  const p = world.players[id];
  const demand = renewalDemand(p);
  const [wage, setWage] = useState(demand);
  const [years, setYears] = useState(3);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <div className="scrim" style={{ zIndex: 60 }} onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label="New contract">
        <div className="panel-head">
          <h2>New contract for {p.last}</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ fontSize: 14 }}>
            He's on {money(p.contract.wage)} a week until summer {p.contract.expires + 1}. His agent is asking for {money(demand)}.
          </p>
          <label className="field">
            Weekly wage
            <input type="number" min={0} step={50} value={wage} onChange={(e) => setWage(Number(e.target.value))} />
          </label>
          <label className="field">
            Length
            <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((y) => (
                <option key={y} value={y}>
                  {y} year{y > 1 ? 's' : ''} (until {world.season + y + 1})
                </option>
              ))}
            </select>
          </label>
          {error && <div className="notice error">{error}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn"
              onClick={() => {
                let r = { ok: false, message: '' };
                store.mutate((w) => (r = renewContract(w, id, wage, years)), true);
                if (r.ok) {
                  store.toast(r.message);
                  onClose();
                } else setError(r.message);
              }}
            >
              Offer contract
            </button>
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function BidDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const store = useStore();
  const world = useWorld();
  const p = world.players[id];
  const club = userClub(world)!;
  const ask = p.clubId ? askingPrice(world, p) : 0;
  const known = p.scouted;
  const guide = known ? ask : Math.round((ask * 1.1) / 50000) * 50000;
  const [fee, setFee] = useState(p.clubId ? guide : 0);
  const [wage, setWage] = useState(Math.round(wageDemand(p) / 50) * 50);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <div className="scrim" style={{ zIndex: 60 }} onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Transfer offer">
        <div className="panel-head">
          <h2>{p.clubId ? `Bid for ${p.last}` : `Sign ${p.last}`}</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ fontSize: 14 }}>
            Budget: {money(club.transferBudget)} for fees. {p.clubId ? `${world.clubs[p.clubId].name} value him around ${known ? money(ask) : 'an unknown amount (scout him for a better read)'}.` : 'Free agents cost no fee, only wages.'}
          </p>
          {p.clubId && (
            <label className="field">
              Transfer fee
              <input type="number" min={0} step={50000} value={fee} onChange={(e) => setFee(Number(e.target.value))} />
              <span className="hint">{money(fee)}</span>
            </label>
          )}
          <label className="field">
            Weekly wage offered
            <input type="number" min={0} step={50} value={wage} onChange={(e) => setWage(Number(e.target.value))} />
            <span className="hint">{money(wage)} per week, 3-year contract</span>
          </label>
          {error && <div className="notice error">{error}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn club"
              onClick={() => {
                let r = { ok: false, message: '' };
                store.mutate((w) => (r = makeBid(w, id, fee, wage)), true);
                if (r.ok) {
                  store.toast(r.message);
                  onClose();
                } else setError(r.message);
              }}
            >
              Submit offer
            </button>
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function Confirm({ title, body, confirm, onConfirm, onClose }: { title: string; body: string; confirm: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <>
      <div className="scrim" style={{ zIndex: 60 }} onClick={onClose} />
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="panel-head">
          <h2>{title}</h2>
        </div>
        <div className="panel-body">
          <p>{body}</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn danger" onClick={onConfirm}>
              {confirm}
            </button>
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

