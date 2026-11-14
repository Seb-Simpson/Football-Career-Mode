import { describe, expect, it } from 'vitest';
import { createWorld, clubPlayers } from '../src/domain/generate';
import { leagueTable } from '../src/domain/fixtures';
import { MATCHWEEKS, type World } from '../src/domain/types';
import { parseWorld } from '../src/persistence/save';
import { applyResult, createMatch, endSeason, finishWeek, makeBid, startCareer, weekFixtures } from '../src/simulation/world/season';

function playWeek(w: World) {
  for (const f of weekFixtures(w)) {
    if (f.result) continue;
    const m = createMatch(w, f, false);
    m.runToEnd();
    applyResult(w, f, m);
  }
  return finishWeek(w);
}


describe('career', () => {
  it('saves round-trip through JSON with validation', () => {
    const w = createWorld(77, 'T');
    startCareer(w, 'c3');
    const back = parseWorld(JSON.stringify(w));
    expect('error' in back).toBe(false);
    expect(JSON.stringify(back)).toBe(JSON.stringify(w));
    expect('error' in parseWorld('{"version": 999}')).toBe(true);
    expect('error' in parseWorld('not json')).toBe(true);
  });

  it('transfers move ownership and money exactly once', () => {
    const w = createWorld(78, 'T');
    startCareer(w, 'c5');
    const club = w.clubs.c5;
    const free = Object.values(w.players).find((p) => !p.clubId)!;
    club.wageBudget += 100_000;
    const before = club.balance;
    const r = makeBid(w, free.id, 0, 100_000);
    expect(r.ok).toBe(true);
    expect(w.players[free.id].clubId).toBe('c5');
    expect(club.balance).toBe(before);
    const again = makeBid(w, free.id, 0, 100_000);
    expect(again.ok).toBe(false);
  });

  it('completes a full season and rolls over coherently', async () => {
    const w = createWorld(2024, 'T');
    startCareer(w, 'c4');
    let ended = false;
    let guard = 0;
    while (!ended && guard++ < MATCHWEEKS + 3) {
      ended = playWeek(w).seasonEnded;
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(ended).toBe(true);
    expect(w.fixtures.every((f) => f.result)).toBe(true);
    const t0 = leagueTable(w, 0);
    expect(t0.every((r) => r.p === MATCHWEEKS)).toBe(true);
    const relegated = t0.slice(-2).map((r) => r.clubId);
    const promoted = leagueTable(w, 1).slice(0, 2).map((r) => r.clubId);
    const playerCount = Object.keys(w.players).length;
    const summary = endSeason(w);
    expect(summary.relegated).toEqual(relegated);
    expect(summary.promoted).toEqual(promoted);
    for (const id of relegated) expect(w.clubs[id].division).toBe(1);
    for (const id of promoted) expect(w.clubs[id].division).toBe(0);
    expect(w.season).toBe(2028);
    expect(w.week).toBe(0);
    expect(w.fixtures.every((f) => !f.result)).toBe(true);
    for (const c of Object.values(w.clubs)) expect(clubPlayers(w, c.id).length).toBeGreaterThanOrEqual(16);
    expect(Object.keys(w.players).length).toBeGreaterThan(playerCount * 0.85);
    expect(Object.values(w.clubs).filter((c) => c.division === 0).length).toBe(10);
  }, 600000);
});
