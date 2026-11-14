import type { Rng } from '../shared/rng';
import type { Fixture, World } from './types';

/** Double round-robin by the circle method with alternating venues. */
export function roundRobin(teams: string[], rng: Rng): [string, string][][] {
  const t = rng.shuffle([...teams]);
  if (t.length % 2) t.push('BYE');
  const n = t.length;
  const rounds: [string, string][][] = [];
  const arr = [...t];
  for (let r = 0; r < n - 1; r++) {
    const round: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === 'BYE' || b === 'BYE') continue;
      // Alternate so each club gets a fair home/away rhythm.
      round.push((r + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    arr.splice(1, 0, arr.pop()!);
  }
  const second = rounds.map((round) => round.map(([h, a]) => [a, h] as [string, string]));
  return [...rounds, ...second];
}

export function generateFixtures(world: World, rng: Rng): Fixture[] {
  const out: Fixture[] = [];
  for (const div of [0, 1] as const) {
    const teams = Object.values(world.clubs)
      .filter((c) => c.division === div)
      .map((c) => c.id)
      .sort();
    const rounds = roundRobin(teams, rng);
    rounds.forEach((round, r) => {
      round.forEach(([home, away], i) => {
        out.push({ id: `s${world.season}d${div}w${r + 1}m${i}`, week: r + 1, division: div, home, away, result: null });
      });
    });
  }
  return out;
}

export interface TableRow {
  clubId: string;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  form: ('W' | 'D' | 'L')[];
}

/** Ordered tiebreakers: points, goal difference, goals for, head-to-head points, then name. */
export function leagueTable(world: World, division: 0 | 1): TableRow[] {
  const rows: Record<string, TableRow> = {};
  for (const c of Object.values(world.clubs)) {
    if (c.division !== division) continue;
    rows[c.id] = { clubId: c.id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, form: [] };
  }
  const played = world.fixtures
    .filter((f) => f.division === division && f.result)
    .sort((a, b) => a.week - b.week);
  for (const f of played) {
    const r = f.result!;
    const h = rows[f.home];
    const a = rows[f.away];
    if (!h || !a) continue;
    h.p++;
    a.p++;
    h.gf += r.homeGoals;
    h.ga += r.awayGoals;
    a.gf += r.awayGoals;
    a.ga += r.homeGoals;
    if (r.homeGoals > r.awayGoals) {
      h.w++, a.l++, (h.pts += 3);
      h.form.push('W'), a.form.push('L');
    } else if (r.homeGoals < r.awayGoals) {
      a.w++, h.l++, (a.pts += 3);
      h.form.push('L'), a.form.push('W');
    } else {
      h.d++, a.d++, h.pts++, a.pts++;
      h.form.push('D'), a.form.push('D');
    }
  }
  const list = Object.values(rows);
  for (const r of list) {
    r.gd = r.gf - r.ga;
    r.form = r.form.slice(-5);
  }
  const h2h = (x: string, y: string) => {
    let px = 0;
    let py = 0;
    for (const f of played) {
      const r = f.result!;
      if (f.home === x && f.away === y) {
        if (r.homeGoals > r.awayGoals) px += 3;
        else if (r.homeGoals < r.awayGoals) py += 3;
        else px++, py++;
      } else if (f.home === y && f.away === x) {
        if (r.homeGoals > r.awayGoals) py += 3;
        else if (r.homeGoals < r.awayGoals) px += 3;
        else px++, py++;
      }
    }
    return py - px;
  };
  list.sort(
    (a, b) =>
      b.pts - a.pts ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      h2h(a.clubId, b.clubId) ||
      world.clubs[a.clubId].name.localeCompare(world.clubs[b.clubId].name),
  );
  return list;
}

export function clubFixtures(world: World, clubId: string): Fixture[] {
  return world.fixtures.filter((f) => f.home === clubId || f.away === clubId).sort((a, b) => a.week - b.week);
}

export function nextFixture(world: World, clubId: string): Fixture | undefined {
  return clubFixtures(world, clubId).find((f) => !f.result && f.week >= world.week);
}
