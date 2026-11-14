/// <reference lib="webworker" />
import { MatchEngine, type MatchTeamInput } from './engine';
import { outcomeOf } from './outcome';

interface Job {
  id: string;
  home: MatchTeamInput;
  away: MatchTeamInput;
  seed: number;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, home, away, seed } = e.data;
  const m = new MatchEngine(home, away, seed);
  m.runToEnd();
  (self as unknown as Worker).postMessage({ id, outcome: outcomeOf(m) });
};
