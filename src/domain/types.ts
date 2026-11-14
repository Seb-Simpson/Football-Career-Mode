import type { RngState } from '../shared/rng';

export const SAVE_VERSION = 1;
export const ENGINE_VERSION = '1.0.0';

export type Position = 'GK' | 'CB' | 'LB' | 'RB' | 'DM' | 'CM' | 'AM' | 'LW' | 'RW' | 'ST';

export const POSITIONS: Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];

export type AttrKey =
  | 'pace'
  | 'stamina'
  | 'strength'
  | 'passing'
  | 'decisions'
  | 'dribbling'
  | 'finishing'
  | 'tackling'
  | 'positioning'
  | 'composure'
  | 'heading'
  | 'workRate'
  | 'reflexes'
  | 'handling';

export type Attributes = Record<AttrKey, number>; // 1..20

export interface Contract {
  wage: number; // per week, whole currency units
  expires: number; // season year the contract ends after
}

export interface SeasonStats {
  apps: number;
  goals: number;
  assists: number;
  ratingSum: number;
  yellows: number;
  reds: number;
  cleanSheets: number;
}

export interface Player {
  id: string;
  first: string;
  last: string;
  age: number;
  nation: string;
  foot: 'L' | 'R';
  pos: Position;
  alt: Position[];
  attrs: Attributes;
  potential: number; // hidden target ability, 1..20 average scale
  clubId: string | null;
  contract: Contract;
  fitness: number; // 0..100 match condition
  morale: number; // 0..100
  injury: { weeks: number; label: string } | null;
  suspended: number; // matches
  yellowAccum: number;
  form: number[]; // last 5 match ratings
  stats: SeasonStats;
  number: number;
  history: { season: number; club: string; apps: number; goals: number }[];
  scouted: boolean;
  listed: boolean; // available for transfer
}

export type KitPattern = 'solid' | 'stripes' | 'hoops' | 'sash' | 'halves' | 'pinstripe';

export interface Kit {
  primary: string;
  secondary: string;
  pattern: KitPattern;
}

export type Formation = '4-4-2' | '4-3-3' | '4-2-3-1' | '3-5-2' | '5-3-2' | '4-1-4-1';

export interface Tactics {
  formation: Formation;
  mentality: number; // 0 very defensive .. 4 very attacking
  tempo: number; // 0..4
  width: number; // 0..4
  pressing: number; // 0..4
  line: number; // defensive line height 0..4
  directness: number; // 0 short .. 4 direct
}

export interface Lineup {
  starters: (string | null)[]; // 11, index matches formation slot
  bench: string[]; // up to 7
}

export interface Club {
  id: string;
  name: string;
  short: string;
  town: string;
  kit: Kit;
  away: Kit;
  badge: 'shield' | 'round' | 'diamond' | 'crest';
  reputation: number; // 1..100
  division: 0 | 1;
  balance: number;
  transferBudget: number;
  wageBudget: number; // per week
  stadium: string;
  capacity: number;
  ticketPrice: number;
  tactics: Tactics;
  lineup: Lineup;
  founded: number;
  nickname: string;
}

export interface MatchResultSummary {
  homeGoals: number;
  awayGoals: number;
  scorers: { playerId: string; club: string; minute: number; pen?: boolean; og?: boolean }[];
  attendance: number;
  stats?: MatchStats;
  ratings?: Record<string, number>;
  motm?: string;
}

export interface MatchStats {
  possession: [number, number];
  shots: [number, number];
  onTarget: [number, number];
  passes: [number, number];
  passAcc: [number, number];
  corners: [number, number];
  fouls: [number, number];
  yellows: [number, number];
  reds: [number, number];
  offsides: [number, number];
}

export interface Fixture {
  id: string;
  week: number;
  division: 0 | 1;
  home: string;
  away: string;
  result: MatchResultSummary | null;
}

export interface InboxMessage {
  id: string;
  week: number;
  season: number;
  from: string;
  subject: string;
  body: string;
  read: boolean;
  kind: 'info' | 'board' | 'transfer-offer' | 'contract' | 'medical' | 'scout' | 'result' | 'job';
  action?: {
    type: 'accept-bid' | 'job-offer';
    playerId?: string;
    clubId?: string;
    fee?: number;
    resolved?: 'accepted' | 'rejected';
  };
}

export interface LedgerEntry {
  week: number;
  season: number;
  label: string;
  amount: number;
  category: 'wages' | 'gate' | 'broadcast' | 'sponsor' | 'transfer' | 'prize' | 'staff';
}

export interface Manager {
  name: string;
  nation: string;
  clubId: string | null;
  confidence: number; // board confidence 0..100
  reputation: number;
  objective: Objective;
  history: { season: number; club: string; division: number; position: number; note?: string }[];
  sacked: boolean;
}

export type Objective = 'title' | 'promotion' | 'top-half' | 'mid-table' | 'survive';

export type Training = 'balanced' | 'attacking' | 'defending' | 'fitness' | 'recovery';

export interface Settings {
  matchSpeed: number;
  viewMode: 'broadcast' | 'tactical';
  playbackMode: 'full' | 'highlights';
  reducedMotion: boolean;
  sound: boolean;
}

export interface World {
  version: number;
  engineVersion: string;
  seed: number;
  rng: RngState;
  season: number;
  week: number; // 0 = pre-season, 1..N matchweeks, N+1 = season review
  clubs: Record<string, Club>;
  players: Record<string, Player>;
  fixtures: Fixture[];
  manager: Manager;
  inbox: InboxMessage[];
  ledger: LedgerEntry[];
  training: Training;
  settings: Settings;
  champions: { season: number; division: number; club: string }[];
  nextId: number;
  pendingBids: { playerId: string; fromClub: string; fee: number; week: number }[];
  scoutQueue?: string[];
}

export const LEAGUE_NAMES = ['Crown League', 'Crown League Two'] as const;
export const CLUBS_PER_DIVISION = 10;
export const MATCHWEEKS = (CLUBS_PER_DIVISION - 1) * 2;
export const PROMOTION_PLACES = 2;
export const WINDOW_WEEKS = new Set([0, 9, 10]);
export const MAX_SUBS = 5;
export const BENCH_SIZE = 7;
