import { CLUB_DEFS, NATIONS } from '../data/names';
import { Rng } from '../shared/rng';
import { overall, roleAbility, roundMoney, wageDemand } from './player';
import {
  ENGINE_VERSION,
  SAVE_VERSION,
  type AttrKey,
  type Attributes,
  type Club,
  type Player,
  type Position,
  type Tactics,
  type World,
} from './types';
import { generateFixtures } from './fixtures';

const ATTRS: AttrKey[] = [
  'pace',
  'stamina',
  'strength',
  'passing',
  'decisions',
  'dribbling',
  'finishing',
  'tackling',
  'positioning',
  'composure',
  'heading',
  'workRate',
  'reflexes',
  'handling',
];

/** Attribute emphasis per position: offsets around a quality baseline. */
const PROFILE: Record<Position, Partial<Record<AttrKey, number>>> = {
  GK: { reflexes: 3, handling: 3, positioning: 2, finishing: -8, dribbling: -6, tackling: -6, pace: -3, heading: -3 },
  CB: { tackling: 3, heading: 3, strength: 2.5, positioning: 2.5, finishing: -5, dribbling: -3, pace: -1, reflexes: -10, handling: -10 },
  LB: { pace: 2, stamina: 2, tackling: 1.5, finishing: -4, heading: -1, reflexes: -10, handling: -10 },
  RB: { pace: 2, stamina: 2, tackling: 1.5, finishing: -4, heading: -1, reflexes: -10, handling: -10 },
  DM: { tackling: 2.5, positioning: 2, passing: 1.5, workRate: 2, finishing: -3, reflexes: -10, handling: -10 },
  CM: { passing: 2.5, decisions: 2, stamina: 1.5, workRate: 1, reflexes: -10, handling: -10 },
  AM: { passing: 2, dribbling: 2.5, decisions: 1.5, composure: 1.5, tackling: -4, heading: -2, reflexes: -10, handling: -10 },
  LW: { pace: 3, dribbling: 3, finishing: 0.5, tackling: -4, heading: -3, strength: -1, reflexes: -10, handling: -10 },
  RW: { pace: 3, dribbling: 3, finishing: 0.5, tackling: -4, heading: -3, strength: -1, reflexes: -10, handling: -10 },
  ST: { finishing: 3.5, composure: 2, heading: 1.5, pace: 1, tackling: -5, passing: -1, reflexes: -10, handling: -10 },
};

const ALT_POS: Record<Position, Position[]> = {
  GK: [],
  CB: ['DM', 'RB', 'LB'],
  LB: ['LW', 'CB'],
  RB: ['RW', 'CB'],
  DM: ['CM', 'CB'],
  CM: ['DM', 'AM'],
  AM: ['CM', 'ST', 'LW', 'RW'],
  LW: ['RW', 'AM', 'LB'],
  RW: ['LW', 'AM', 'RB'],
  ST: ['AM', 'LW', 'RW'],
};

const SQUAD_TEMPLATE: Position[] = [
  'GK', 'GK', 'GK',
  'CB', 'CB', 'CB', 'CB',
  'LB', 'LB', 'RB', 'RB',
  'DM', 'DM', 'CM', 'CM', 'CM',
  'AM', 'LW', 'RW', 'LW', 'RW',
  'ST', 'ST', 'ST',
];

export function makeAttributes(rng: Rng, pos: Position, quality: number): Attributes {
  const a = {} as Attributes;
  const prof = PROFILE[pos];
  for (const k of ATTRS) {
    const v = quality + (prof[k] ?? 0) + rng.gauss(0, 1.8);
    a[k] = clampAttr(v);
  }
  return a;
}

export function clampAttr(v: number): number {
  return Math.max(1, Math.min(20, Math.round(v)));
}

export function createPlayer(
  rng: Rng,
  id: string,
  pos: Position,
  quality: number,
  age: number,
  season: number,
  clubId: string | null,
): Player {
  const nation = rng.weighted(NATIONS, NATIONS.map((n) => n.weight));
  const attrs = makeAttributes(rng, pos, quality);
  const ageGap = Math.max(0, 27 - age);
  const potential = Math.min(19.5, quality + ageGap * rng.range(0.15, 0.55) + rng.range(-0.5, 1));
  const alt = rng.shuffle([...ALT_POS[pos]]).slice(0, rng.int(0, Math.min(2, ALT_POS[pos].length)));
  const p: Player = {
    id,
    first: rng.pick(nation.first),
    last: rng.pick(nation.last),
    age,
    nation: nation.code,
    foot: pos === 'LB' || pos === 'LW' ? (rng.chance(0.8) ? 'L' : 'R') : rng.chance(0.24) ? 'L' : 'R',
    pos,
    alt,
    attrs,
    potential,
    clubId,
    contract: { wage: 0, expires: season + rng.int(0, 4) },
    fitness: rng.int(88, 100),
    morale: rng.int(55, 80),
    injury: null,
    suspended: 0,
    yellowAccum: 0,
    form: [],
    stats: emptyStats(),
    number: 0,
    history: [],
    scouted: false,
    listed: false,
  };
  p.contract.wage = Math.round(wageDemand(p) * rng.range(0.85, 1.15) / 50) * 50;
  return p;
}

export function emptyStats() {
  return { apps: 0, goals: 0, assists: 0, ratingSum: 0, yellows: 0, reds: 0, cleanSheets: 0 };
}

export const DEFAULT_TACTICS: Tactics = {
  formation: '4-2-3-1',
  mentality: 2,
  tempo: 2,
  width: 2,
  pressing: 2,
  line: 2,
  directness: 2,
};

function contrastKitAway(primary: string, secondary: string): { primary: string; secondary: string } {
  return { primary: secondary, secondary: primary };
}

export function createWorld(seed: number, managerName: string): World {
  const rng = new Rng(seed);
  const season = 2027;
  const clubs: Record<string, Club> = {};
  const players: Record<string, Player> = {};
  let nextId = 1;

  CLUB_DEFS.forEach((def, i) => {
    const id = `c${i + 1}`;
    const division = (i < 10 ? 0 : 1) as 0 | 1;
    const formations = ['4-2-3-1', '4-3-3', '4-4-2', '3-5-2', '4-1-4-1', '5-3-2'] as const;
    const club: Club = {
      id,
      name: `${def.town} ${def.suffix}`,
      short: def.short,
      town: def.town,
      kit: { primary: def.primary, secondary: def.secondary, pattern: def.pattern },
      away: { ...contrastKitAway(def.primary, def.secondary), pattern: 'solid' },
      badge: def.badge,
      reputation: def.rep,
      division,
      balance: roundMoney(def.rep * def.rep * 2600),
      transferBudget: roundMoney(Math.pow(def.rep, 2.4) * 140),
      wageBudget: 0,
      stadium: def.stadium,
      capacity: def.capacity,
      ticketPrice: Math.round(14 + def.rep * 0.32),
      tactics: {
        ...DEFAULT_TACTICS,
        formation: formations[i % formations.length],
        mentality: rng.int(1, 3),
        pressing: rng.int(1, 3),
        tempo: rng.int(1, 3),
        directness: rng.int(1, 3),
      },
      lineup: { starters: Array(11).fill(null), bench: [] },
      founded: def.founded,
      nickname: def.nickname,
    };
    clubs[id] = club;

    // Club quality on the 1..20 attribute scale.
    const q = 6.2 + def.rep * 0.075;
    const numbersUsed = new Set<number>();
    SQUAD_TEMPLATE.forEach((pos, j) => {
      const tier = j % 3 === 0 ? 0.6 : j % 3 === 1 ? 0 : -0.9;
      const age = rng.int(18, 33);
      const pid = `p${nextId++}`;
      const quality = q + tier + rng.gauss(0, 0.9) - (age < 21 ? 1.4 : 0) - (age > 31 ? 0.6 : 0);
      const p = createPlayer(rng, pid, pos, quality, age, season, id);
      p.number = assignNumber(pos, numbersUsed);
      players[pid] = p;
    });
  });

  // A pool of free agents.
  for (let i = 0; i < 40; i++) {
    const pos = rng.pick(SQUAD_TEMPLATE);
    const pid = `p${nextId++}`;
    const p = createPlayer(rng, pid, pos, rng.range(6.5, 10.5), rng.int(19, 34), season, null);
    p.contract.wage = 0;
    players[pid] = p;
  }

  const world: World = {
    version: SAVE_VERSION,
    engineVersion: ENGINE_VERSION,
    seed,
    rng: rng.state(),
    season,
    week: 0,
    clubs,
    players,
    fixtures: [],
    manager: {
      name: managerName,
      nation: 'ALB',
      clubId: null,
      confidence: 60,
      reputation: 40,
      objective: 'mid-table',
      history: [],
      sacked: false,
    },
    inbox: [],
    ledger: [],
    training: 'balanced',
    settings: { matchSpeed: 12, viewMode: 'broadcast', playbackMode: 'full', reducedMotion: false, sound: true },
    champions: [],
    nextId,
    pendingBids: [],
  };

  for (const c of Object.values(clubs)) {
    c.wageBudget = roundMoney(squadWages(world, c.id) * 1.12);
  }
  world.fixtures = generateFixtures(world, rng);
  world.rng = rng.state();
  return world;
}

export function assignNumber(pos: Position, used: Set<number>): number {
  const pref: Record<Position, number[]> = {
    GK: [1, 13, 31, 40],
    CB: [5, 6, 4, 15, 23, 26],
    LB: [3, 12, 21],
    RB: [2, 22, 24],
    DM: [4, 6, 16, 28],
    CM: [8, 14, 18, 20],
    AM: [10, 17, 19],
    LW: [11, 7, 27],
    RW: [7, 11, 17, 25],
    ST: [9, 19, 29, 39],
  };
  for (const n of pref[pos]) if (!used.has(n)) return used.add(n), n;
  for (let n = 2; n < 99; n++) if (!used.has(n)) return used.add(n), n;
  return 99;
}

export function clubPlayers(world: World, clubId: string): Player[] {
  return Object.values(world.players).filter((p) => p.clubId === clubId);
}

export function squadWages(world: World, clubId: string): number {
  return clubPlayers(world, clubId).reduce((s, p) => s + p.contract.wage, 0);
}

export function clubStrength(world: World, clubId: string): number {
  const ps = clubPlayers(world, clubId)
    .map((p) => overall(p))
    .sort((a, b) => b - a)
    .slice(0, 16);
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
}

/** Quick quality check used by the auto-picker. */
export function slotScore(p: Player, pos: Position): number {
  return roleAbility(p.attrs, pos);
}
