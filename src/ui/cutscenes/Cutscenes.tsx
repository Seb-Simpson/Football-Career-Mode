import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LEAGUE_NAMES, type Club } from '../../domain/types';
import { uiSound } from '../../presentation/uiSound';
import { money, objectiveLabel } from '../../simulation/world/season';
import { Crest } from '../components/Graphics';
import { useStore, useWorld } from '../store';
import { accent, contrastText, kitBand } from '../theme';

export type Cutscene =
  | { kind: 'appointed'; clubId: string }
  | { kind: 'signed'; playerId: string; fee: number; from: string | null }
  | { kind: 'trophy'; clubId: string; headline: string; sub: string };

const SPONSORS = ['Northwind', 'Halden Ales', 'Brightline', 'Kestrel Bank', 'Oakmere', 'Volta'];

export function CutsceneLayer() {
  const store = useStore();
  const world = useWorld();
  const c = store.cutscene;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!c) return;
    setReady(false);
    const t = setTimeout(() => setReady(true), 900);
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === 'Enter') && store.playCutscene(null);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c]);

  if (!c) return null;
  const club = c.kind === 'signed' ? world.clubs[world.manager.clubId ?? ''] : world.clubs[c.clubId];
  if (!club) return null;
  const acc = accent(club.kit);
  const vars = { '--k': acc, '--kf': contrastText(acc), '--k2': club.kit.secondary, '--band': kitBand(club.kit) } as CSSProperties;

  return (
    <div className={`cutscene cs-${c.kind}`} style={vars} role="dialog" aria-modal="true" aria-label="Cutscene" onClick={() => ready && store.playCutscene(null)}>
      <MediaWall club={club} />
      <div className="cs-spot" />
      {c.kind === 'appointed' && <Appointed club={club} />}
      {c.kind === 'signed' && <Signed club={club} playerId={c.playerId} fee={c.fee} from={c.from} />}
      {c.kind === 'trophy' && <Trophy club={club} headline={c.headline} sub={c.sub} />}
      <Flashbulbs />
      <div className="cs-flash" />
      <button
        className="cs-continue"
        onClick={(e) => {
          e.stopPropagation();
          store.playCutscene(null);
        }}
      >
        Continue
      </button>
    </div>
  );
}

function MediaWall({ club }: { club: Club }) {
  const tiles = useMemo(() => Array.from({ length: 48 }, (_, i) => i), []);
  return (
    <div className="cs-wall" aria-hidden="true">
      {tiles.map((i) =>
        i % 2 === 0 ? (
          <span key={i} className="tile">
            <Crest club={club} size={54} />
          </span>
        ) : (
          <span key={i} className="tile word">
            {SPONSORS[(i >> 1) % SPONSORS.length]}
          </span>
        ),
      )}
    </div>
  );
}

function Flashbulbs() {
  const bulbs = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        left: `${(i * 37 + 11) % 100}%`,
        top: `${55 + ((i * 53) % 42)}%`,
        delay: `${((i * 0.37) % 2.6).toFixed(2)}s`,
        dur: `${(1.6 + ((i * 0.71) % 1.8)).toFixed(2)}s`,
      })),
    [],
  );
  return (
    <div className="cs-bulbs" aria-hidden="true">
      {bulbs.map((b, i) => (
        <i key={i} style={{ left: b.left, top: b.top, animationDelay: b.delay, animationDuration: b.dur }} />
      ))}
    </div>
  );
}

function LowerThird({ club, kicker, title, lines }: { club: Club; kicker: string; title: ReactNode; lines: ReactNode[] }) {
  return (
    <div className="cs-third">
      <div className="cs-third-crest">
        <Crest club={club} size={76} />
      </div>
      <div className="cs-third-body">
        <span className="kicker">{kicker}</span>
        <b>{title}</b>
        {lines.map((l, i) => (
          <span key={i} className="line">
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function Scarf({ club }: { club: Club }) {
  const { primary: a, secondary: b } = club.kit;
  const text = contrastText(a);
  return (
    <svg className="cs-scarf" viewBox="0 0 640 110" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={`l${i}`} x={i * 6} y={8 + (i % 2) * 6} width="4" height="26" fill={i % 2 ? a : b} transform="translate(0 30)" />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={`r${i}`} x={604 + i * 6} y={8 + (i % 2) * 6} width="4" height="26" fill={i % 2 ? a : b} transform="translate(0 30)" />
      ))}
      <rect x="34" y="18" width="572" height="74" fill={a} />
      <rect x="34" y="18" width="572" height="9" fill={b} />
      <rect x="34" y="83" width="572" height="9" fill={b} />
      <rect x="34" y="18" width="60" height="74" fill={b} opacity="0.9" />
      <rect x="546" y="18" width="60" height="74" fill={b} opacity="0.9" />
      <text x="320" y="71" textAnchor="middle" fontFamily="Big Shoulders Display, Arial Narrow, sans-serif" fontWeight="900" fontSize="44" fill={text} letterSpacing="2" textLength={club.name.length > 16 ? 420 : undefined} lengthAdjust="spacingAndGlyphs">
        {club.name.toUpperCase()}
      </text>
    </svg>
  );
}

function Appointed({ club }: { club: Club }) {
  const world = useWorld();
  useEffect(() => {
    uiSound.fanfare();
    const t = setTimeout(() => uiSound.cheer(), 500);
    return () => clearTimeout(t);
  }, []);
  return (
    <>
      <div className="cs-figure">
        <Scarf club={club} />
        <svg className="cs-manager" viewBox="0 0 400 420" aria-hidden="true">
          {/* arms raised to hold the scarf */}
          <path d="M92 6 L128 6 L170 150 L126 170 Z" fill="#0a111f" />
          <path d="M308 6 L272 6 L230 150 L274 170 Z" fill="#0a111f" />
          <circle cx="110" cy="10" r="20" fill="#c9a183" />
          <circle cx="290" cy="10" r="20" fill="#c9a183" />
          {/* head and shoulders */}
          <circle cx="200" cy="104" r="46" fill="#c9a183" />
          <path d="M154 96 Q160 50 200 50 Q242 50 246 98 Q226 74 200 74 Q172 74 154 96 Z" fill="#2b2118" />
          <path d="M96 420 L104 220 Q112 164 170 150 L230 150 Q288 164 296 220 L304 420 Z" fill="#0a111f" />
          <path d="M170 150 L200 196 L230 150 L214 144 L200 160 L186 144 Z" fill="#f4f6f8" />
          <path d="M200 164 L210 186 L200 300 L190 186 Z" fill="var(--k)" />
          <path d="M170 150 L150 210 L200 196 Z" fill="#101a2e" />
          <path d="M230 150 L250 210 L200 196 Z" fill="#101a2e" />
        </svg>
      </div>
      <LowerThird
        club={club}
        kicker="New manager"
        title={world.manager.name}
        lines={[`Appointed manager of ${club.name}`, `${LEAGUE_NAMES[club.division]}. The board's aim: ${objectiveLabel(world.manager.objective).toLowerCase()}.`]}
      />
    </>
  );
}

function Signed({ club, playerId, fee, from }: { club: Club; playerId: string; fee: number; from: string | null }) {
  const world = useWorld();
  const p = world.players[playerId];
  useEffect(() => {
    const t = setTimeout(() => uiSound.stamp(), 1150);
    const t2 = setTimeout(() => uiSound.cheer(), 1300);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, []);
  if (!p) return null;
  const { primary: a, secondary: b, pattern } = club.kit;
  const striped = pattern === 'stripes' || pattern === 'halves' || pattern === 'pinstripe' || pattern === 'hoops';
  const fg = striped ? '#ffffff' : contrastText(a);
  const body = 'M90 20 L130 6 Q160 26 190 6 L230 20 L306 66 L280 128 L246 112 L246 330 L74 330 L74 112 L40 128 L14 66 Z';
  const name = p.last.toUpperCase();
  return (
    <>
      <Confetti colors={[a, b, '#ffffff']} delay={1200} />
      <div className="cs-figure cs-shirt-wrap">
        <svg className="cs-shirt" viewBox="0 0 320 340" aria-hidden="true">
          <defs>
            <clipPath id="cs-shirt-clip">
              <path d={body} />
            </clipPath>
          </defs>
          <g clipPath="url(#cs-shirt-clip)">
            <rect width="320" height="340" fill={a} />
            {pattern === 'stripes' && [100, 160, 220].map((x) => <rect key={x} x={x - 15} y="0" width="30" height="340" fill={b} />)}
            {pattern === 'pinstripe' && [96, 128, 160, 192, 224].map((x) => <rect key={x} x={x} y="0" width="5" height="340" fill={b} />)}
            {pattern === 'hoops' && [70, 150, 230].map((y) => <rect key={y} x="0" y={y} width="320" height="36" fill={b} />)}
            {pattern === 'halves' && <rect x="160" y="0" width="160" height="340" fill={b} />}
            {pattern === 'sash' && <path d="M60 0 L120 0 L290 340 L230 340 Z" fill={b} />}
            <path d="M14 66 L40 128 L74 112" fill="none" stroke={b} strokeWidth="14" />
            <path d="M306 66 L280 128 L246 112" fill="none" stroke={b} strokeWidth="14" />
            <path d="M130 6 Q160 26 190 6" fill="none" stroke={b} strokeWidth="12" />
          </g>
          <path d={body} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="4" strokeLinejoin="round" />
          <text x="160" y="104" textAnchor="middle" fontFamily="Big Shoulders Display, Arial Narrow, sans-serif" fontWeight="800" fontSize="34" fill={fg} stroke="rgba(0,0,0,0.6)" strokeWidth="4" paintOrder="stroke" letterSpacing="3" textLength={name.length > 8 ? 150 : undefined} lengthAdjust="spacingAndGlyphs">
            {name}
          </text>
          <text x="160" y="262" textAnchor="middle" fontFamily="Big Shoulders Display, Arial Narrow, sans-serif" fontWeight="900" fontSize="170" fill={fg} stroke="rgba(0,0,0,0.6)" strokeWidth="7" paintOrder="stroke">
            {p.number}
          </text>
        </svg>
        <div className="cs-stamp">Signed</div>
      </div>
      <LowerThird
        club={club}
        kicker="New signing"
        title={`${p.first} ${p.last}`}
        lines={[`${p.pos}, aged ${p.age}. Joins ${from ? `from ${from}` : 'as a free agent'}${fee ? ` for ${money(fee)}` : ''}.`, `Contract to summer ${p.contract.expires + 1} on ${money(p.contract.wage)} a week.`]}
      />
    </>
  );
}

function Trophy({ club, headline, sub }: { club: Club; headline: string; sub: string }) {
  useEffect(() => {
    uiSound.fanfare();
    const t = setTimeout(() => uiSound.cheer(), 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <>
      <Confetti colors={[club.kit.primary, club.kit.secondary, '#f2b233', '#ffffff']} delay={300} />
      <div className="cs-figure cs-trophy-wrap">
        <div className="cs-rays" />
        <svg className="cs-trophy" viewBox="0 0 240 300" aria-hidden="true">
          <defs>
            <linearGradient id="gold" x1="0" x2="1">
              <stop offset="0" stopColor="#b9801a" />
              <stop offset="0.35" stopColor="#ffe08a" />
              <stop offset="0.6" stopColor="#f2b233" />
              <stop offset="1" stopColor="#a66f12" />
            </linearGradient>
          </defs>
          <path d="M52 30 C10 30 10 110 66 118" fill="none" stroke="url(#gold)" strokeWidth="12" />
          <path d="M188 30 C230 30 230 110 174 118" fill="none" stroke="url(#gold)" strokeWidth="12" />
          <path d="M48 14 H192 V70 C192 128 160 158 120 164 C80 158 48 128 48 70 Z" fill="url(#gold)" />
          <rect x="106" y="162" width="28" height="56" fill="url(#gold)" />
          <path d="M70 218 H170 L182 250 H58 Z" fill="url(#gold)" />
          <rect x="46" y="250" width="148" height="34" fill="#13203a" />
          <rect x="46" y="250" width="148" height="6" fill="var(--k)" />
          <path d="M66 26 H84 V96 C84 116 78 128 72 134 C66 120 62 100 62 76 Z" fill="rgba(255,255,255,0.45)" />
        </svg>
      </div>
      <LowerThird club={club} kicker={sub} title={headline} lines={[club.name]} />
    </>
  );
}

export function Confetti({ colors, delay = 0 }: { colors: string[]; delay?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    const size = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    };
    size();
    const parts = Array.from({ length: 150 }, () => ({
      x: Math.random() * w,
      y: -Math.random() * h * 0.8 - 20,
      vx: (Math.random() - 0.5) * 80,
      vy: 80 + Math.random() * 160,
      rot: Math.random() * 6,
      spin: (Math.random() - 0.5) * 10,
      w: 6 + Math.random() * 7,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    let raf = 0;
    let last = performance.now();
    const start = last + delay;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (now >= start) {
        for (const p of parts) {
          p.x += (p.vx + Math.sin(now / 400 + p.rot) * 30) * dt;
          p.y += p.vy * dt;
          p.rot += p.spin * dt;
          if (p.y > h + 20) {
            p.y = -20;
            p.x = Math.random() * w;
          }
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -2, p.w, 4 * Math.abs(Math.cos(p.rot * 1.3)) + 1);
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener('resize', size);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <canvas ref={ref} className="cs-confetti" aria-hidden="true" />;
}
