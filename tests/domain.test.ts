import { describe, expect, it } from 'vitest';
import { createWorld, clubPlayers } from '../src/domain/generate';
import { leagueTable, roundRobin } from '../src/domain/fixtures';
import { autoLineup, validateLineup } from '../src/domain/lineup';
import { MATCHWEEKS } from '../src/domain/types';
import { Rng } from '../src/shared/rng';

describe('rng', () => {
  it('is reproducible and serialisable', () => {
    const a = new Rng(99);
    const seq = [a.next(), a.next(), a.next()];
    const b = new Rng(99);
    expect([b.next(), b.next(), b.next()]).toEqual(seq);
    const c = new Rng(a.state());
    const d = new Rng(a.state());
    expect(c.next()).toBe(d.next());
  });
});

describe('fixtures', () => {
  it('double round robin: everyone plays everyone home and away, once per week', () => {
    const teams = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const rounds = roundRobin(teams, new Rng(1));
    expect(rounds.length).toBe(MATCHWEEKS);
    const pairs = new Set<string>();
    for (const round of rounds) {
      const seen = new Set<string>();
      for (const [h, a] of round) {
        expect(seen.has(h) || seen.has(a)).toBe(false);
        seen.add(h);
        seen.add(a);
        pairs.add(`${h}-${a}`);
      }
      expect(seen.size).toBe(teams.length);
    }
    expect(pairs.size).toBe(teams.length * (teams.length - 1));
  });

  it('world fixtures cover both divisions without double-booking', () => {
    const w = createWorld(5, 'T');
    for (let wk = 1; wk <= MATCHWEEKS; wk++) {
      const ids = w.fixtures.filter((f) => f.week === wk).flatMap((f) => [f.home, f.away]);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBe(20);
    }
  });
});

describe('league table', () => {
  it('orders by points, then goal difference, then goals scored', () => {
    const w = createWorld(3, 'T');
    const div0 = w.fixtures.filter((f) => f.division === 0 && f.week === 1);
    // first fixture: home wins 3-0; second: home wins 1-0
    div0[0].result = { homeGoals: 3, awayGoals: 0, scorers: [], attendance: 0 };
    div0[1].result = { homeGoals: 1, awayGoals: 0, scorers: [], attendance: 0 };
    div0[2].result = { homeGoals: 2, awayGoals: 2, scorers: [], attendance: 0 };
    const t = leagueTable(w, 0);
    expect(t[0].clubId).toBe(div0[0].home);
    expect(t[1].clubId).toBe(div0[1].home);
    expect(t[0].pts).toBe(3);
    const totalGf = t.reduce((s, r) => s + r.gf, 0);
    const totalGa = t.reduce((s, r) => s + r.ga, 0);
    expect(totalGf).toBe(totalGa);
  });
});

describe('lineups', () => {
  it('assistant lineup is valid with 11 unique available players and a keeper', () => {
    const w = createWorld(11, 'T');
    for (const c of Object.values(w.clubs)) {
      c.lineup = autoLineup(w, c).lineup;
      expect(c.lineup.starters.filter(Boolean).length).toBe(11);
      expect(new Set([...c.lineup.starters, ...c.lineup.bench]).size).toBe(11 + c.lineup.bench.length);
      expect(validateLineup(w, c).filter((i) => i.severity === 'error')).toEqual([]);
    }
  });

  it('flags injured and duplicate selections', () => {
    const w = createWorld(12, 'T');
    const c = Object.values(w.clubs)[0];
    c.lineup = autoLineup(w, c).lineup;
    const p = w.players[c.lineup.starters[3]!];
    p.injury = { weeks: 2, label: 'Hamstring strain' };
    c.lineup.starters[4] = c.lineup.starters[5];
    const errs = validateLineup(w, c).filter((i) => i.severity === 'error');
    expect(errs.some((e) => e.message.includes('injured'))).toBe(true);
    expect(errs.some((e) => e.message.includes('twice'))).toBe(true);
  });

  it('every club starts with a full squad', () => {
    const w = createWorld(13, 'T');
    for (const c of Object.values(w.clubs)) expect(clubPlayers(w, c.id).length).toBeGreaterThanOrEqual(22);
  });
});
