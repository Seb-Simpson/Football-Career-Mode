import { useId } from 'react';
import type { Club, Kit } from '../../domain/types';
import { contrastText } from '../theme';

/** Generated crest: shape from the club's badge style, kit colours, short name. */
export function Crest({ club, size = 44 }: { club: Club; size?: number }) {
  const uid = useId().replace(/:/g, '');
  const { primary: a, secondary: b } = club.kit;
  const shape =
    club.badge === 'round'
      ? 'M50 4 A46 46 0 1 1 49.9 4 Z'
      : club.badge === 'diamond'
        ? 'M50 3 L95 50 L50 97 L5 50 Z'
        : club.badge === 'crest'
          ? 'M10 8 H90 V48 C90 74 70 88 50 97 C30 88 10 74 10 48 Z'
          : 'M12 6 H88 V52 C88 76 68 90 50 97 C32 90 12 76 12 52 Z';
  const fg = contrastText(a);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ flex: 'none' }}>
      <defs>
        <clipPath id={`c${uid}`}>
          <path d={shape} />
        </clipPath>
      </defs>
      <g clipPath={`url(#c${uid})`}>
        <rect width="100" height="100" fill={a} />
        {club.kit.pattern === 'stripes' && [20, 50, 80].map((x) => <rect key={x} x={x - 7} y="0" width="14" height="100" fill={b} />)}
        {club.kit.pattern === 'pinstripe' && [25, 42, 59, 76].map((x) => <rect key={x} x={x} y="0" width="3" height="100" fill={b} />)}
        {club.kit.pattern === 'hoops' && [28, 62].map((y) => <rect key={y} x="0" y={y} width="100" height="14" fill={b} />)}
        {club.kit.pattern === 'halves' && <rect x="50" y="0" width="50" height="100" fill={b} />}
        {club.kit.pattern === 'sash' && <path d="M-10 20 L20 -10 L110 80 L80 110 Z" fill={b} />}
        {club.kit.pattern === 'solid' && <rect x="0" y="0" width="100" height="22" fill={b} />}
      </g>
      <path d={shape} fill="none" stroke={b} strokeWidth="5" />
      <path d={shape} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />
      <text
        x="50"
        y={club.badge === 'diamond' ? 60 : 62}
        textAnchor="middle"
        fontFamily="Big Shoulders Display, Arial Narrow, sans-serif"
        fontWeight="900"
        fontSize={club.badge === 'diamond' ? 24 : 28}
        fill={club.kit.pattern === 'halves' || club.kit.pattern === 'stripes' ? '#fff' : fg}
        stroke={club.kit.pattern === 'halves' || club.kit.pattern === 'stripes' ? 'rgba(0,0,0,0.55)' : 'none'}
        strokeWidth="3"
        paintOrder="stroke"
        letterSpacing="1"
      >
        {club.short}
      </text>
    </svg>
  );
}

/** A shirt with the kit pattern and a number. */
export function Shirt({ kit, number, size = 44, keeper = false }: { kit: Kit; number?: number; size?: number; keeper?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const a = keeper ? '#2d2f36' : kit.primary;
  const b = keeper ? '#c8f04a' : kit.secondary;
  const body = 'M30 8 L42 4 Q50 10 58 4 L70 8 L92 22 L84 40 L74 35 L74 94 L26 94 L26 35 L16 40 L8 22 Z';
  const fg = keeper ? '#c8f04a' : kit.pattern === 'stripes' || kit.pattern === 'halves' || kit.pattern === 'pinstripe' ? '#fff' : contrastText(a);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <clipPath id={`s${uid}`}>
          <path d={body} />
        </clipPath>
      </defs>
      <g clipPath={`url(#s${uid})`}>
        <rect width="100" height="100" fill={a} />
        {!keeper && kit.pattern === 'stripes' && [34, 50, 66].map((x) => <rect key={x} x={x - 5} y="0" width="10" height="100" fill={b} />)}
        {!keeper && kit.pattern === 'pinstripe' && [30, 42, 54, 66].map((x) => <rect key={x} x={x} y="0" width="2.5" height="100" fill={b} />)}
        {!keeper && kit.pattern === 'hoops' && [24, 48, 72].map((y) => <rect key={y} x="0" y={y} width="100" height="11" fill={b} />)}
        {!keeper && kit.pattern === 'halves' && <rect x="50" y="0" width="50" height="100" fill={b} />}
        {!keeper && kit.pattern === 'sash' && <path d="M20 0 L36 0 L90 100 L74 100 Z" fill={b} />}
        <rect x="0" y="0" width="100" height="6" fill={b} opacity="0.9" />
        <path d="M8 22 L16 40 L26 35" fill="none" stroke={b} strokeWidth="5" />
        <path d="M92 22 L84 40 L74 35" fill="none" stroke={b} strokeWidth="5" />
      </g>
      <path d={body} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="2.5" strokeLinejoin="round" />
      {number !== undefined && (
        <text
          x="50"
          y="72"
          textAnchor="middle"
          fontFamily="Big Shoulders Display, Arial Narrow, sans-serif"
          fontWeight="900"
          fontSize="38"
          fill={fg}
          stroke="rgba(0,0,0,0.55)"
          strokeWidth="3"
          paintOrder="stroke"
        >
          {number}
        </text>
      )}
    </svg>
  );
}

/** Chalk pitch markings in a 68 x 80 (half+ pitch, vertical) viewBox for the lineup board. */
export function BoardLines() {
  const c = 'rgba(255,255,255,0.55)';
  return (
    <svg className="lines" viewBox="0 0 68 80" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke={c} strokeWidth="0.35">
        <rect x="1.5" y="1.5" width="65" height="77" />
        <line x1="1.5" y1="6" x2="66.5" y2="6" />
        <circle cx="34" cy="6" r="9.15" />
        <rect x="13.84" y="62.5" width="40.32" height="16" />
        <rect x="24.84" y="73" width="18.32" height="5.5" />
        <path d="M26.7 62.5 A9.15 9.15 0 0 1 41.3 62.5" />
        <rect x="30.34" y="78.5" width="7.32" height="1.4" />
      </g>
      <circle cx="34" cy="68" r="0.45" fill={c} />
    </svg>
  );
}

/** Chalkboard drawing for the title screen: an attacking move in X and O. */
export function TitleBoard() {
  return (
    <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth="2">
        <rect x="40" y="40" width="720" height="520" />
        <line x1="400" y1="40" x2="400" y2="560" />
        <circle cx="400" cy="300" r="70" />
        <rect x="620" y="170" width="140" height="260" />
        <rect x="710" y="240" width="50" height="120" />
        <rect x="40" y="170" width="140" height="260" />
        <rect x="40" y="240" width="50" height="120" />
      </g>
      <g fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 10">
        <path d="M300 420 C 380 400, 450 360, 520 330" />
        <path d="M520 330 C 580 300, 620 250, 660 230" />
      </g>
      <g fill="none" stroke="rgba(242,178,51,0.9)" strokeWidth="3.5" strokeLinecap="round">
        <path d="M470 180 C 540 170, 610 190, 668 228" />
        <path d="M660 214 L670 230 L652 236" />
        <path d="M300 420 C 350 470, 450 480, 560 440" />
        <path d="M548 432 L562 440 L550 452" />
      </g>
      <g stroke="rgba(255,255,255,0.85)" strokeWidth="3.5" strokeLinecap="round">
        {[
          [300, 420],
          [470, 180],
          [520, 330],
          [380, 250],
          [250, 300],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="13" fill="none" />
        ))}
        {[
          [600, 300],
          [640, 360],
          [610, 230],
          [560, 400],
          [700, 300],
        ].map(([x, y], i) => (
          <g key={i}>
            <line x1={x - 10} y1={y - 10} x2={x + 10} y2={y + 10} />
            <line x1={x + 10} y1={y - 10} x2={x - 10} y2={y + 10} />
          </g>
        ))}
      </g>
    </svg>
  );
}

/** Floodlit ground at night, used behind the home screen header. */
export function StadiumArt() {
  return (
    <svg className="stadium-art" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="sa-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a1322" />
          <stop offset="1" stopColor="#1b2c49" />
        </linearGradient>
        <linearGradient id="sa-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,250,225,0.5)" />
          <stop offset="1" stopColor="rgba(255,250,225,0)" />
        </linearGradient>
        <radialGradient id="sa-glow">
          <stop offset="0" stopColor="rgba(255,250,225,0.95)" />
          <stop offset="0.25" stopColor="rgba(255,250,225,0.35)" />
          <stop offset="1" stopColor="rgba(255,250,225,0)" />
        </radialGradient>
        <pattern id="sa-crowd" width="9" height="7" patternUnits="userSpaceOnUse">
          <rect width="9" height="7" fill="#101a2b" />
          <circle cx="2" cy="3" r="1.3" fill="var(--club)" opacity="0.75" />
          <circle cx="6.5" cy="5" r="1.2" fill="#8d97ab" opacity="0.55" />
          <circle cx="6" cy="1.5" r="1.1" fill="var(--club-2)" opacity="0.5" />
        </pattern>
      </defs>
      <rect width="1200" height="300" fill="url(#sa-sky)" />
      {[170, 1030].map((x, i) => (
        <g key={x}>
          <polygon className={`beam b${i}`} points={`${x - 16},62 ${x + 16},62 ${x + (i ? -330 : 330)},300 ${x + (i ? -80 : 80)},300`} fill="url(#sa-beam)" />
          <rect x={x - 3} y="60" width="6" height="170" fill="#0a111d" />
          <rect x={x - 26} y="40" width="52" height="26" fill="#0a111d" />
          {[-18, -6, 6, 18].map((dx) => (
            <rect key={dx} x={x + dx - 4} y="46" width="8" height="14" fill="#fffbe6" />
          ))}
          <circle className="glow" cx={x} cy="53" r="90" fill="url(#sa-glow)" />
        </g>
      ))}
      <path d="M0 300 V190 Q300 120 600 118 Q900 120 1200 190 V300 Z" fill="url(#sa-crowd)" />
      <path d="M0 190 Q300 120 600 118 Q900 120 1200 190 L1200 176 Q900 104 600 102 Q300 104 0 176 Z" fill="#070d18" />
      <rect x="0" y="262" width="1200" height="10" fill="var(--kit-band)" />
      <rect x="0" y="272" width="1200" height="28" fill="#1d5a3a" />
      <rect x="0" y="278" width="1200" height="2" fill="rgba(255,255,255,0.7)" />
    </svg>
  );
}
