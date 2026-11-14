import type { Formation, Position } from './types';

export interface Slot {
  pos: Position;
  /** depth from own goal (0) to opposition goal (1), defensive shape */
  u: number;
  /** across the pitch, 0 = left touchline when facing the attack */
  v: number;
}

const GK: Slot = { pos: 'GK', u: 0.03, v: 0.5 };

export const FORMATIONS: Record<Formation, Slot[]> = {
  '4-4-2': [
    GK,
    { pos: 'LB', u: 0.2, v: 0.12 },
    { pos: 'CB', u: 0.17, v: 0.38 },
    { pos: 'CB', u: 0.17, v: 0.62 },
    { pos: 'RB', u: 0.2, v: 0.88 },
    { pos: 'LW', u: 0.38, v: 0.14 },
    { pos: 'CM', u: 0.35, v: 0.4 },
    { pos: 'CM', u: 0.35, v: 0.6 },
    { pos: 'RW', u: 0.38, v: 0.86 },
    { pos: 'ST', u: 0.52, v: 0.4 },
    { pos: 'ST', u: 0.52, v: 0.6 },
  ],
  '4-3-3': [
    GK,
    { pos: 'LB', u: 0.2, v: 0.12 },
    { pos: 'CB', u: 0.17, v: 0.38 },
    { pos: 'CB', u: 0.17, v: 0.62 },
    { pos: 'RB', u: 0.2, v: 0.88 },
    { pos: 'DM', u: 0.3, v: 0.5 },
    { pos: 'CM', u: 0.38, v: 0.32 },
    { pos: 'CM', u: 0.38, v: 0.68 },
    { pos: 'LW', u: 0.52, v: 0.14 },
    { pos: 'ST', u: 0.55, v: 0.5 },
    { pos: 'RW', u: 0.52, v: 0.86 },
  ],
  '4-2-3-1': [
    GK,
    { pos: 'LB', u: 0.2, v: 0.12 },
    { pos: 'CB', u: 0.17, v: 0.38 },
    { pos: 'CB', u: 0.17, v: 0.62 },
    { pos: 'RB', u: 0.2, v: 0.88 },
    { pos: 'DM', u: 0.3, v: 0.4 },
    { pos: 'DM', u: 0.3, v: 0.6 },
    { pos: 'LW', u: 0.45, v: 0.15 },
    { pos: 'AM', u: 0.45, v: 0.5 },
    { pos: 'RW', u: 0.45, v: 0.85 },
    { pos: 'ST', u: 0.56, v: 0.5 },
  ],
  '3-5-2': [
    GK,
    { pos: 'CB', u: 0.17, v: 0.28 },
    { pos: 'CB', u: 0.16, v: 0.5 },
    { pos: 'CB', u: 0.17, v: 0.72 },
    { pos: 'LW', u: 0.35, v: 0.08 },
    { pos: 'DM', u: 0.3, v: 0.5 },
    { pos: 'CM', u: 0.38, v: 0.33 },
    { pos: 'CM', u: 0.38, v: 0.67 },
    { pos: 'RW', u: 0.35, v: 0.92 },
    { pos: 'ST', u: 0.53, v: 0.4 },
    { pos: 'ST', u: 0.53, v: 0.6 },
  ],
  '5-3-2': [
    GK,
    { pos: 'LB', u: 0.22, v: 0.08 },
    { pos: 'CB', u: 0.16, v: 0.3 },
    { pos: 'CB', u: 0.15, v: 0.5 },
    { pos: 'CB', u: 0.16, v: 0.7 },
    { pos: 'RB', u: 0.22, v: 0.92 },
    { pos: 'CM', u: 0.35, v: 0.3 },
    { pos: 'DM', u: 0.32, v: 0.5 },
    { pos: 'CM', u: 0.35, v: 0.7 },
    { pos: 'ST', u: 0.52, v: 0.4 },
    { pos: 'ST', u: 0.52, v: 0.6 },
  ],
  '4-1-4-1': [
    GK,
    { pos: 'LB', u: 0.2, v: 0.12 },
    { pos: 'CB', u: 0.17, v: 0.38 },
    { pos: 'CB', u: 0.17, v: 0.62 },
    { pos: 'RB', u: 0.2, v: 0.88 },
    { pos: 'DM', u: 0.28, v: 0.5 },
    { pos: 'LW', u: 0.4, v: 0.14 },
    { pos: 'CM', u: 0.38, v: 0.38 },
    { pos: 'CM', u: 0.38, v: 0.62 },
    { pos: 'RW', u: 0.4, v: 0.86 },
    { pos: 'ST', u: 0.54, v: 0.5 },
  ],
};

export const FORMATION_LIST = Object.keys(FORMATIONS) as Formation[];

export const FORMATION_NOTES: Record<Formation, string> = {
  '4-4-2': 'Two banks of four and a strike partnership. Solid and simple, but can be outnumbered in midfield.',
  '4-3-3': 'A holding midfielder behind two runners, wingers stretching the back line. Strong for pressing.',
  '4-2-3-1': 'Double pivot protects the defence; a creator behind the striker links play. Balanced.',
  '3-5-2': 'Wing-backs give width and numbers in midfield. Leaves space behind the wide players.',
  '5-3-2': 'Five at the back and a compact middle three. Hard to break down, light on width going forward.',
  '4-1-4-1': 'A screen in front of the back four with a crowded midfield line. Patient and compact.',
};
