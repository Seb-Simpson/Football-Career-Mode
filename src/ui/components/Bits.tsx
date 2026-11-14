import type { CSSProperties, ReactNode } from 'react';
import type { Club, Player, Position } from '../../domain/types';
import { overall } from '../../domain/player';
import { accent, attrColor, contrastText, matchRatingColor, ratingColor } from '../theme';

export function ShirtNo({ n, club }: { n: number; club?: Club | null }) {
  const style = club ? ({ '--tile-bg': accent(club.kit), '--tile-fg': contrastText(accent(club.kit)) } as CSSProperties) : undefined;
  return (
    <span className="shirt-no" style={style}>
      {n}
    </span>
  );
}

export function PosTag({ pos }: { pos: Position }) {
  return <span className={`pos-tag pos-${pos}`}>{pos}</span>;
}

export function Rating({ value, range }: { value: number; range?: [number, number] }) {
  if (range && range[0] !== range[1]) {
    return (
      <span className="rating" style={{ '--r-bg': '#8d97ab', width: 58, fontSize: 15 } as CSSProperties} title="Scout estimate">
        {range[0]}–{range[1]}
      </span>
    );
  }
  return (
    <span className="rating" style={{ '--r-bg': ratingColor(value) } as CSSProperties}>
      {value}
    </span>
  );
}

export function PlayerRating({ p }: { p: Player }) {
  return <Rating value={overall(p)} />;
}

export function MatchRating({ value }: { value: number }) {
  return (
    <span className="rating" style={{ '--r-bg': matchRatingColor(value) } as CSSProperties}>
      {value.toFixed(1)}
    </span>
  );
}

export function Form({ results }: { results: ('W' | 'D' | 'L')[] }) {
  if (!results.length) return <span className="muted">–</span>;
  return (
    <span className="form" aria-label={`Form: ${results.join(' ')}`}>
      {results.map((r, i) => (
        <span key={i} className={r}>
          {r}
        </span>
      ))}
    </span>
  );
}

export function Meter({ value, color }: { value: number; color?: string }) {
  return (
    <div className="meter" style={{ '--m-color': color ?? attrColor(value) } as CSSProperties} aria-hidden="true">
      {Array.from({ length: 20 }, (_, i) => (
        <i key={i} className={i < value ? 'on' : ''} />
      ))}
    </div>
  );
}

export function Bar({ value, max = 100, color }: { value: number; max?: number; color?: string }) {
  return (
    <div className="bar" aria-hidden="true">
      <i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, '--b-color': color } as CSSProperties} />
    </div>
  );
}

export function Condition({ value }: { value: number }) {
  const color = value >= 85 ? '#1f8a4c' : value >= 70 ? '#a8781a' : '#d33a2f';
  return (
    <span className="condition" title={`Condition ${value}%`}>
      <Bar value={value} color={color} />
      <span>{value}%</span>
    </span>
  );
}

export function StatusFlags({ p, season }: { p: Player; season?: number }) {
  const out: ReactNode[] = [];
  if (p.injury) out.push(<span key="i" className="flag inj">Injured {p.injury.weeks}w</span>);
  if (p.suspended) out.push(<span key="s" className="flag sus">Banned {p.suspended}</span>);
  if (!p.injury && p.fitness < 70) out.push(<span key="f" className="flag warn">Tired</span>);
  if (season !== undefined && p.contract.expires <= season) out.push(<span key="c" className="flag info">Contract ends</span>);
  if (p.listed) out.push(<span key="l" className="flag info">Listed</span>);
  return <>{out}</>;
}

export function Difficulty({ level }: { level: number }) {
  return (
    <span className="difficulty" aria-label={`Difficulty ${level} of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={i < level ? 'on' : ''} />
      ))}
    </span>
  );
}

export function Panel({ title, tools, children, flush, className, style }: { title?: ReactNode; tools?: ReactNode; children: ReactNode; flush?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <section className={`panel ${className ?? ''}`} style={style}>
      {title && (
        <header className="panel-head">
          <h2>{title}</h2>
          {tools && <div className="tools">{tools}</div>}
        </header>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{children}</div>}
    </header>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
