import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/domain/generate';
import { autoLineup } from '../src/domain/lineup';
import { MatchEngine } from '../src/simulation/match/engine';
import { teamInput } from '../src/simulation/match/setup';

function setup(seed = 42) {
  const w = createWorld(seed, 'T');
  for (const c of Object.values(w.clubs)) c.lineup = autoLineup(w, c).lineup;
  return w;
}

describe('match engine', () => {
  it('is deterministic for the same seed and inputs, regardless of frame recording', () => {
    const w = setup();
    const a = new MatchEngine(teamInput(w, w.clubs.c1, true), teamInput(w, w.clubs.c2, true), 777, { record: true });
    const b = new MatchEngine(teamInput(w, w.clubs.c1, true), teamInput(w, w.clubs.c2, true), 777, { record: false });
    a.runToEnd();
    b.runToEnd();
    expect(a.score()).toEqual(b.score());
    expect(a.events.map((e) => `${e.tick}:${e.type}:${e.player ?? ''}`)).toEqual(b.events.map((e) => `${e.tick}:${e.type}:${e.player ?? ''}`));
  }, 60000);

  it('reproduces the same match when the same command arrives at the same tick', () => {
    const w = setup();
    const run = () => {
      const m = new MatchEngine(teamInput(w, w.clubs.c3, false), teamInput(w, w.clubs.c4, true), 31337);
      while (m.tick < 2000) m.step();
      const t = { ...m.teams[0].tactics, mentality: 4, pressing: 4 };
      m.command({ type: 'tactics', team: 0, tactics: t });
      const out = m.teams[0].players.find((p) => p.onPitch && p.slot?.pos === 'ST')!;
      const inn = m.teams[0].players.find((p) => !p.used)!;
      m.command({ type: 'sub', team: 0, outId: out.id, inId: inn.id });
      m.runToEnd();
      return m;
    };
    const a = run();
    const b = run();
    expect(a.score()).toEqual(b.score());
    expect(a.events.length).toBe(b.events.length);
    expect(a.events.some((e) => e.type === 'sub' && e.team === 0)).toBe(true);
  }, 60000);

  it('keeps score, goal events and stats consistent', () => {
    const w = setup(9);
    for (let k = 0; k < 6; k++) {
      const m = new MatchEngine(teamInput(w, w.clubs.c5, true), teamInput(w, w.clubs.c6, true), 100 + k);
      m.runToEnd();
      const [h, a] = m.score();
      const goals = m.events.filter((e) => e.type === 'goal');
      expect(goals.filter((g) => g.team === 0).length).toBe(h);
      expect(goals.filter((g) => g.team === 1).length).toBe(a);
      const s = m.matchStats();
      expect(s.possession[0] + s.possession[1]).toBe(100);
      expect(s.onTarget[0]).toBeLessThanOrEqual(s.shots[0]);
      expect(s.onTarget[0]).toBeGreaterThanOrEqual(h - goals.filter((g) => g.team === 0 && g.detail === 'own goal').length);
      expect(m.events.at(-1)!.type).toBe('fulltime');
      // never more than 11 on the pitch, never more than 5 subs
      for (const t of m.teams) {
        expect(t.players.filter((p) => p.onPitch).length).toBeLessThanOrEqual(11);
        expect(t.subsUsed).toBeLessThanOrEqual(5);
      }
    }
  }, 60000);

  it('produces plausible football over a batch (seeded regression)', () => {
    const w = setup(21);
    const ids = ['c1', 'c2', 'c3', 'c4', 'c7', 'c10'];
    let goals = 0;
    let shots = 0;
    let n = 0;
    for (let i = 0; i < ids.length; i++)
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        const m = new MatchEngine(teamInput(w, w.clubs[ids[i]], true), teamInput(w, w.clubs[ids[j]], true), 5000 + n);
        m.runToEnd();
        const [h, a] = m.score();
        goals += h + a;
        const s = m.matchStats();
        shots += s.shots[0] + s.shots[1];
        n++;
      }
    const gpm = goals / n;
    expect(gpm).toBeGreaterThan(1.6);
    expect(gpm).toBeLessThan(4.2);
    expect(shots / n / 2).toBeGreaterThan(7);
    expect(shots / n / 2).toBeLessThan(24);
  }, 300000);
});
