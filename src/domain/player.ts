import type { AttrKey, Attributes, Player, Position } from './types';

/** Attribute weights describing what each position asks of a player. */
export const ROLE_WEIGHTS: Record<Position, Partial<Record<AttrKey, number>>> = {
  GK: { reflexes: 5, handling: 4, positioning: 3, composure: 2, decisions: 2, passing: 1, strength: 1 },
  CB: { tackling: 4, positioning: 4, heading: 3, strength: 3, decisions: 2, composure: 2, pace: 1.5, passing: 1 },
  LB: { tackling: 3, pace: 3, stamina: 2.5, positioning: 2.5, passing: 2, workRate: 2, dribbling: 1 },
  RB: { tackling: 3, pace: 3, stamina: 2.5, positioning: 2.5, passing: 2, workRate: 2, dribbling: 1 },
  DM: { tackling: 3.5, positioning: 3, passing: 3, decisions: 3, stamina: 2, workRate: 2, strength: 1.5 },
  CM: { passing: 4, decisions: 3.5, stamina: 2.5, workRate: 2, dribbling: 2, tackling: 1.5, composure: 2 },
  AM: { passing: 3.5, dribbling: 3.5, decisions: 3, composure: 2.5, finishing: 2, pace: 1.5 },
  LW: { pace: 4, dribbling: 4, passing: 2.5, finishing: 2, stamina: 1.5, decisions: 1.5 },
  RW: { pace: 4, dribbling: 4, passing: 2.5, finishing: 2, stamina: 1.5, decisions: 1.5 },
  ST: { finishing: 5, composure: 3, pace: 2.5, positioning: 2.5, heading: 2, strength: 2, dribbling: 1.5 },
};

export const ATTR_LABELS: Record<AttrKey, string> = {
  pace: 'Pace',
  stamina: 'Stamina',
  strength: 'Strength',
  passing: 'Passing',
  decisions: 'Decisions',
  dribbling: 'Dribbling',
  finishing: 'Finishing',
  tackling: 'Tackling',
  positioning: 'Positioning',
  composure: 'Composure',
  heading: 'Heading',
  workRate: 'Work rate',
  reflexes: 'Reflexes',
  handling: 'Handling',
};

export const ATTR_GROUPS: { label: string; keys: AttrKey[] }[] = [
  { label: 'Technical', keys: ['passing', 'dribbling', 'finishing', 'tackling', 'heading'] },
  { label: 'Mental', keys: ['decisions', 'positioning', 'composure', 'workRate'] },
  { label: 'Physical', keys: ['pace', 'stamina', 'strength'] },
  { label: 'Goalkeeping', keys: ['reflexes', 'handling'] },
];

/** Raw 1..20 weighted ability in a position. */
export function roleAbility(attrs: Attributes, pos: Position): number {
  const w = ROLE_WEIGHTS[pos];
  let s = 0;
  let t = 0;
  for (const k in w) {
    const weight = w[k as AttrKey]!;
    s += attrs[k as AttrKey] * weight;
    t += weight;
  }
  return s / t;
}

/** How comfortable a player is in a position: 1 natural, ~0.9 alternative, lower otherwise. */
export function familiarity(p: Player, pos: Position): number {
  if (p.pos === pos) return 1;
  if (p.alt.includes(pos)) return 0.93;
  if (pos === 'GK' || p.pos === 'GK') return 0.35;
  const groups: Position[][] = [
    ['CB', 'LB', 'RB'],
    ['DM', 'CM', 'AM'],
    ['LW', 'RW', 'AM'],
    ['ST', 'AM', 'LW', 'RW'],
    ['LB', 'LW'],
    ['RB', 'RW'],
    ['DM', 'CB'],
  ];
  for (const g of groups) if (g.includes(pos) && g.includes(p.pos)) return 0.82;
  return 0.65;
}

/** 1..99 rating for display, combining ability with familiarity. */
export function rating(p: Player, pos: Position = p.pos): number {
  const r = roleAbility(p.attrs, pos) * familiarity(p, pos);
  return Math.max(1, Math.min(99, Math.round(r * 4.6 + 6)));
}

export function overall(p: Player): number {
  return rating(p, p.pos);
}

export function playerValue(p: Player, season: number): number {
  const ovr = overall(p);
  const base = Math.pow(Math.max(ovr - 35, 1), 2.6) * 55;
  const ageF = p.age <= 21 ? 1.5 : p.age <= 24 ? 1.3 : p.age <= 28 ? 1.0 : p.age <= 31 ? 0.7 : 0.4;
  const potF = 1 + Math.max(0, p.potential * 4.6 + 6 - ovr) * 0.025 * (p.age < 24 ? 1 : 0.2);
  const contractYears = Math.max(0, p.contract.expires - season);
  const contractF = contractYears === 0 ? 0.55 : contractYears === 1 ? 0.8 : 1;
  return roundMoney(base * ageF * potF * contractF);
}

export function wageDemand(p: Player): number {
  const ovr = overall(p);
  return roundMoney(Math.pow(Math.max(ovr - 30, 1), 2.2) * 2.2 + 300);
}

export function roundMoney(n: number): number {
  if (n >= 1_000_000) return Math.round(n / 50_000) * 50_000;
  if (n >= 100_000) return Math.round(n / 5_000) * 5_000;
  if (n >= 10_000) return Math.round(n / 500) * 500;
  return Math.round(n / 50) * 50;
}

export function fullName(p: Player): string {
  return `${p.first} ${p.last}`;
}

export function shortName(p: Player): string {
  return `${p.first[0]}. ${p.last}`;
}

export function isAvailable(p: Player): boolean {
  return !p.injury && p.suspended === 0;
}

export function avgRating(p: Player): number | null {
  return p.stats.apps > 0 ? p.stats.ratingSum / p.stats.apps : null;
}

/** Scouting: estimate shown to the user for players outside their club. */
export function ratingRange(p: Player, known: boolean): [number, number] {
  const r = overall(p);
  if (known) return [r, r];
  const spread = 5;
  // Deterministic offset per player so the estimate stays stable between renders.
  let h = 0;
  for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) | 0;
  const off = (Math.abs(h) % 5) - 2;
  return [Math.max(1, r - spread + off), Math.min(99, r + spread + off)];
}

export function potentialBand(p: Player): string {
  const pot = p.potential * 4.6 + 6;
  const gap = pot - overall(p);
  if (p.age >= 29 || gap < 3) return 'Established';
  if (gap < 8) return 'Decent upside';
  if (gap < 14) return 'Promising';
  return 'Exceptional prospect';
}
