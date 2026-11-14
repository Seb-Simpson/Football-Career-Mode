import { useState } from 'react';
import { FORMATIONS, FORMATION_LIST, FORMATION_NOTES } from '../../domain/formations';
import type { Formation, Tactics as T } from '../../domain/types';
import { userClub } from '../../simulation/world/season';
import { PageHead, Panel, Segmented } from '../components/Bits';
import { BoardLines, Shirt } from '../components/Graphics';
import { useStore, useWorld } from '../store';

type Key = Exclude<keyof T, 'formation'>;

export const INSTRUCTIONS: { key: Key; label: string; steps: string[]; note: (v: number) => string }[] = [
  {
    key: 'mentality',
    label: 'Mentality',
    steps: ['Very defensive', 'Defensive', 'Balanced', 'Attacking', 'Very attacking'],
    note: (v) => (v >= 3 ? 'Pushes the team higher and shoots more readily, but leaves space to counter into.' : v <= 1 ? 'Keeps men behind the ball and avoids risk. Chances will be scarce at both ends.' : 'No strong bias either way.'),
  },
  {
    key: 'tempo',
    label: 'Tempo',
    steps: ['Very slow', 'Slow', 'Normal', 'Quick', 'Very quick'],
    note: (v) => (v >= 3 ? 'Players release the ball sooner. Catches teams unset, but decisions get rushed.' : v <= 1 ? 'More time on the ball to pick the right option, at the cost of letting opponents reorganise.' : 'Players take the time they need.'),
  },
  {
    key: 'width',
    label: 'Width in possession',
    steps: ['Very narrow', 'Narrow', 'Normal', 'Wide', 'Very wide'],
    note: (v) => (v >= 3 ? 'Stretches the defence and opens crossing lanes; the middle gets thinner.' : v <= 1 ? 'Overloads the centre for combinations; easier to defend against out wide.' : 'Natural positions across the pitch.'),
  },
  {
    key: 'pressing',
    label: 'Pressing',
    steps: ['Stand off', 'Low', 'Medium', 'High', 'Relentless'],
    note: (v) => (v >= 3 ? 'More players close the ball down and win it higher. Costs stamina and fouls, and can be played around.' : v <= 1 ? 'Holds shape and lets the opponent have the ball. Conserves energy.' : 'One player closes the ball while the rest hold shape.'),
  },
  {
    key: 'line',
    label: 'Defensive line',
    steps: ['Very deep', 'Deep', 'Normal', 'High', 'Very high'],
    note: (v) => (v >= 3 ? 'Compresses the pitch and supports the press; vulnerable to balls over the top.' : v <= 1 ? 'Protects the space behind and the penalty area; invites pressure.' : 'A standard line height.'),
  },
  {
    key: 'directness',
    label: 'Passing',
    steps: ['Very short', 'Short', 'Mixed', 'Direct', 'Very direct'],
    note: (v) => (v >= 3 ? 'Looks for forward passes early. Gets the ball upfield fast, loses it more often.' : v <= 1 ? 'Patient possession that values keeping the ball over making progress.' : 'Picks the pass on merit.'),
  },
];

const PRESETS: { name: string; desc: string; t: Partial<T> }[] = [
  { name: 'Possession', desc: 'Short, patient passing with a high line', t: { mentality: 2, tempo: 1, width: 3, pressing: 3, line: 3, directness: 0 } },
  { name: 'Counter-attack', desc: 'Sit off, win it back, go direct', t: { mentality: 1, tempo: 4, width: 2, pressing: 1, line: 1, directness: 4 } },
  { name: 'High press', desc: 'Win it high and attack fast', t: { mentality: 3, tempo: 3, width: 2, pressing: 4, line: 4, directness: 2 } },
  { name: 'Low block', desc: 'Compact, deep and hard to break down', t: { mentality: 0, tempo: 2, width: 1, pressing: 1, line: 0, directness: 3 } },
];

export function Tactics() {
  const store = useStore();
  const world = useWorld();
  const club = userClub(world);
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  if (!club) return <div className="page">You are not managing a club.</div>;
  const t = club.tactics;

  const set = (patch: Partial<T>) =>
    store.mutate((w) => {
      const c = w.clubs[club.id];
      const formationChanged = patch.formation && patch.formation !== c.tactics.formation;
      c.tactics = { ...c.tactics, ...patch };
      if (formationChanged) remapLineup(w, club.id, patch.formation!);
    });

  return (
    <div className="page">
      <PageHead title="Tactics" sub="Every instruction is a trade-off. Changes take effect from the next match, or immediately from the touchline during one." />
      <div className="grid" style={{ gridTemplateColumns: 'minmax(280px, 400px) minmax(0, 1fr)', alignItems: 'start' }} data-squad-grid>
        <div style={{ display: 'grid', gap: 20 }}>
          <div className="panel">
            <div className="panel-head">
              <h2>Shape</h2>
              <Segmented
                label="Phase"
                value={phase}
                onChange={setPhase}
                options={[
                  { value: 'in', label: 'With the ball' },
                  { value: 'out', label: 'Without' },
                ]}
              />
            </div>
            <ShapePreview tactics={t} phase={phase} kit={club.kit} />
          </div>
          <Panel title="Presets">
            <div style={{ display: 'grid', gap: 8 }}>
              {PRESETS.map((p) => {
                const active = Object.entries(p.t).every(([k, v]) => (t as any)[k] === v);
                return (
                  <button key={p.name} className="formation-btn" aria-pressed={active} onClick={() => set(p.t)} style={{ gridTemplateColumns: '1fr', padding: '10px 12px' }}>
                    <b>{p.name}</b>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {p.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </Panel>
        </div>

        <div style={{ display: 'grid', gap: 20 }}>
          <Panel title="Formation">
            <div className="formation-grid">
              {FORMATION_LIST.map((f) => (
                <button key={f} className="formation-btn" aria-pressed={t.formation === f} onClick={() => set({ formation: f })}>
                  <MiniFormation f={f} />
                  <b>{f}</b>
                </button>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 12, fontSize: 14 }}>
              {FORMATION_NOTES[t.formation]}
            </p>
          </Panel>
          <Panel title="Team instructions">
            {INSTRUCTIONS.map((ins) => (
              <InstructionRow key={ins.key} ins={ins} value={t[ins.key]} onChange={(v) => set({ [ins.key]: v } as Partial<T>)} />
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}

export function InstructionRow({ ins, value, onChange, compact }: { ins: (typeof INSTRUCTIONS)[number]; value: number; onChange: (v: number) => void; compact?: boolean }) {
  return (
    <div className="instruction">
      <header>
        <b>{ins.label}</b>
        <span>{ins.steps[value]}</span>
      </header>
      <div className="scale" role="radiogroup" aria-label={ins.label}>
        {ins.steps.map((s, i) => (
          <button key={s} role="radio" aria-checked={i === value} aria-pressed={i === value} className={i < value ? 'fill' : ''} onClick={() => onChange(i)} title={s}>
            <span className="sr-only">{s}</span>
          </button>
        ))}
      </div>
      {!compact && <p>{ins.note(value)}</p>}
    </div>
  );
}

function remapLineup(w: ReturnType<typeof useWorld>, clubId: string, f: Formation) {
  const c = w.clubs[clubId];
  const slots = FORMATIONS[f];
  const ids = c.lineup.starters.filter(Boolean) as string[];
  const used = new Set<string>();
  const out: (string | null)[] = slots.map(() => null);
  // First pass: natural positions; second: anyone left.
  slots.forEach((s, i) => {
    const id = ids.find((x) => !used.has(x) && w.players[x].pos === s.pos);
    if (id) (out[i] = id), used.add(id);
  });
  slots.forEach((s, i) => {
    if (out[i]) return;
    const id = ids.find((x) => !used.has(x) && w.players[x].alt.includes(s.pos)) ?? ids.find((x) => !used.has(x) && (s.pos === 'GK') === (w.players[x].pos === 'GK'));
    if (id) (out[i] = id), used.add(id);
  });
  c.lineup.starters = out;
}

function MiniFormation({ f }: { f: Formation }) {
  return (
    <svg viewBox="0 0 68 60" style={{ width: '100%', height: 'auto', background: 'var(--pitch)', display: 'block' }} aria-hidden="true">
      <rect x="2" y="2" width="64" height="56" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.6" />
      {FORMATIONS[f].map((s, i) => (
        <circle key={i} cx={2 + s.v * 64} cy={57 - s.u * 92} r="3" fill={s.pos === 'GK' ? '#c8f04a' : '#fff'} />
      ))}
    </svg>
  );
}

function ShapePreview({ tactics, phase, kit }: { tactics: T; phase: 'in' | 'out'; kit: ReturnType<typeof useWorld>['clubs'][string]['kit'] }) {
  const slots = FORMATIONS[tactics.formation];
  const mf = (tactics.mentality - 2) / 2;
  const wf = (tactics.width - 2) / 2;
  const lf = (tactics.line - 2) / 2;
  // Mirrors the engine's shape rules with the ball in midfield (u = 0.5).
  const pts = slots.map((s) => {
    let u: number;
    let v: number;
    if (s.pos === 'GK') {
      u = phase === 'in' ? 0.06 : 0.03;
      v = 0.5;
    } else if (phase === 'in') {
      const def = s.u < 0.25;
      u = s.u * (1.05 + 0.12 * mf) + 0.15 * (def ? 0.42 : 0.58) + 0.08 + 0.05 * mf;
      if (def) u = Math.min(u, 0.46 + 0.06 * mf + 0.04 * lf);
      v = 0.5 + (s.v - 0.5) * (1.12 + 0.28 * wf);
    } else {
      u = s.u * 0.88 + 0.05 * lf - 0.02 - 0.03 * (mf < 0 ? -mf : 0) + 0.03;
      if (s.u < 0.25) u = Math.max(u, 0.07 + 0.05 * lf);
      v = 0.5 + (s.v - 0.5) * 0.72;
    }
    return { u: Math.min(0.62, Math.max(0.01, u)), v: Math.min(0.97, Math.max(0.03, v)), pos: s.pos };
  });
  return (
    <div className="pitch-board" style={{ border: 0 }}>
      <BoardLines />
      {pts.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${((1.5 + p.v * 65) / 68) * 100}%`,
            top: `${((78.5 - p.u * 112) / 80) * 100}%`,
            transform: 'translate(-50%, -50%)',
            transition: 'left 0.4s ease, top 0.4s ease',
            display: 'grid',
            justifyItems: 'center',
            gap: 2,
          }}
        >
          <Shirt kit={kit} size={34} keeper={p.pos === 'GK'} />
          <span style={{ font: '700 10.5px/1 var(--text)', color: '#fff', background: 'rgba(8,20,14,0.7)', padding: '2px 4px' }}>{p.pos}</span>
        </div>
      ))}
    </div>
  );
}
