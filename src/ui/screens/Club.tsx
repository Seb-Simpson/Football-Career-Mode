import { clubPlayers } from '../../domain/generate';
import { LEAGUE_NAMES, type LedgerEntry, type Training } from '../../domain/types';
import { money, objectiveLabel, ordinal, userClub } from '../../simulation/world/season';
import { Bar, PageHead, Panel } from '../components/Bits';
import { Crest } from '../components/Graphics';
import { useStore, useWorld } from '../store';

const CATS: { key: LedgerEntry['category']; label: string }[] = [
  { key: 'gate', label: 'Matchday' },
  { key: 'broadcast', label: 'Broadcast' },
  { key: 'sponsor', label: 'Sponsorship' },
  { key: 'prize', label: 'Prize money' },
  { key: 'transfer', label: 'Transfers' },
  { key: 'wages', label: 'Wages' },
  { key: 'staff', label: 'Staff and running costs' },
];

const TRAINING: { value: Training; label: string; note: string }[] = [
  { value: 'balanced', label: 'Balanced', note: 'All-round development with normal recovery.' },
  { value: 'attacking', label: 'Attacking', note: 'Finishing, dribbling and passing improve faster. Slightly slower recovery.' },
  { value: 'defending', label: 'Defending', note: 'Tackling, positioning and heading improve faster. Slightly slower recovery.' },
  { value: 'fitness', label: 'Fitness', note: 'Pace, stamina and strength. Hard on the legs before matches.' },
  { value: 'recovery', label: 'Recovery', note: 'Light sessions. Condition returns fastest; little development.' },
];

export function ClubScreen() {
  const store = useStore();
  const world = useWorld();
  const club = userClub(world);
  if (!club) return <div className="page">You are not managing a club.</div>;
  const season = world.ledger.filter((l) => l.season === world.season);
  const sums = CATS.map((c) => ({ ...c, total: season.filter((l) => l.category === c.key).reduce((s, l) => s + l.amount, 0) }));
  const maxAbs = Math.max(1, ...sums.map((s) => Math.abs(s.total)));
  const net = sums.reduce((s, x) => s + x.total, 0);
  const wages = clubPlayers(world, club.id).reduce((s, p) => s + p.contract.wage, 0);

  return (
    <div className="page">
      <PageHead title={club.name} sub={`${club.nickname}, founded ${club.founded}. ${club.stadium}, capacity ${club.capacity.toLocaleString()}.`}>
        <Crest club={club} size={72} />
      </PageHead>
      <div className="grid cols-3">
        <Panel title="Finances this season" className="span-2">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 20 }}>
            <div className="stat-big">
              <span className="num">{money(club.balance)}</span>
              <span>Bank balance</span>
            </div>
            <div className="stat-big">
              <span className="num" style={{ color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {net >= 0 ? '+' : ''}
                {money(net)}
              </span>
              <span>Net this season</span>
            </div>
            <div className="stat-big">
              <span className="num">{money(club.transferBudget)}</span>
              <span>Transfer budget</span>
            </div>
            <div className="stat-big">
              <span className="num">{money(wages)}</span>
              <span>Weekly wages of {money(club.wageBudget)}</span>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {sums.map((s) => (
              <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 90px', gap: 12, alignItems: 'center', fontSize: 14 }}>
                <span>{s.label}</span>
                <Bar value={Math.abs(s.total)} max={maxAbs} color={s.total >= 0 ? 'var(--green)' : 'var(--red)'} />
                <span style={{ textAlign: 'right', fontWeight: 650 }}>{money(s.total)}</span>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
            Cash is separate from budgets: the board sets the transfer and wage budgets from the balance each summer. Projected income is never counted until it arrives.
          </p>
        </Panel>

        <Panel title="The board">
          <dl className="kv">
            <dt>Objective</dt>
            <dd>{objectiveLabel(world.manager.objective)}</dd>
            <dt>Confidence</dt>
            <dd>{world.manager.confidence}%</dd>
            <dt>Your reputation</dt>
            <dd>{world.manager.reputation} / 100</dd>
            <dt>Club reputation</dt>
            <dd>{club.reputation} / 100</dd>
          </dl>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 12 }}>
            Confidence moves with results measured against what the board expected from each fixture, and with your league position after the first few weeks. Fall too low and you will be dismissed.
          </p>
        </Panel>

        <Panel title="Training focus">
          <div style={{ display: 'grid', gap: 6 }} role="radiogroup" aria-label="Training focus">
            {TRAINING.map((t) => (
              <button key={t.value} role="radio" aria-checked={world.training === t.value} className="formation-btn" aria-pressed={world.training === t.value} onClick={() => store.mutate((w) => (w.training = t.value))} style={{ padding: '10px 12px' }}>
                <b style={{ fontSize: 18 }}>{t.label}</b>
                <span className="muted" style={{ fontSize: 13 }}>
                  {t.note}
                </span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Ledger" flush>
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="table">
              <tbody>
                {world.ledger.slice(0, 60).map((l, i) => (
                  <tr key={i}>
                    <td className="muted" style={{ fontSize: 12.5 }}>
                      {l.week === 0 ? 'Pre' : `MW${l.week}`}
                    </td>
                    <td style={{ whiteSpace: 'normal' }}>{l.label}</td>
                    <td className="r" style={{ fontWeight: 650, color: l.amount >= 0 ? 'var(--green)' : 'var(--ink)' }}>
                      {money(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Your career">
          {world.manager.history.length === 0 ? (
            <p className="muted">Your first season is under way.</p>
          ) : (
            <table className="table">
              <tbody>
                {world.manager.history
                  .slice()
                  .reverse()
                  .map((h, i) => (
                    <tr key={i}>
                      <td>
                        {h.season}/{String(h.season + 1).slice(2)}
                      </td>
                      <td>{world.clubs[h.club].short}</td>
                      <td>{LEAGUE_NAMES[h.division]}</td>
                      <td className="r">{h.note ?? ordinal(h.position)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
