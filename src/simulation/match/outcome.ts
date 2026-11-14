import type { MatchStats } from '../../domain/types';
import type { MatchEngine, MatchEvent } from './engine';

/** Everything the career needs from a finished match, in a form that can cross threads. */
export interface MatchOutcome {
  score: [number, number];
  events: MatchEvent[];
  stats: MatchStats;
  ratings: Record<string, number>;
  players: [PlayerLine[], PlayerLine[]];
}

export interface PlayerLine {
  id: string;
  used: boolean;
  goals: number;
  assists: number;
  yellow: boolean;
  sentOff: boolean;
  injured: boolean;
  minutes: number;
}

export function outcomeOf(m: MatchEngine): MatchOutcome {
  const line = (t: 0 | 1): PlayerLine[] =>
    m.teams[t].players.map((p) => ({ id: p.id, used: p.used, goals: p.goals, assists: p.assists, yellow: p.yellow, sentOff: p.sentOff, injured: p.injured, minutes: p.minutes }));
  return { score: m.score(), events: m.events, stats: m.matchStats(), ratings: m.ratings(), players: [line(0), line(1)] };
}
