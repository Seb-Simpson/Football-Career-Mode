import { FORMATIONS } from './formations';
import { familiarity, isAvailable, roleAbility, shortName } from './player';
import { BENCH_SIZE, type Club, type Lineup, type Player, type World } from './types';

export interface LineupIssue {
  severity: 'error' | 'warning';
  message: string;
  playerId?: string;
}

function selectionScore(p: Player, pos: Player['pos']): number {
  const ability = roleAbility(p.attrs, pos) * familiarity(p, pos);
  const fit = 0.75 + 0.25 * (p.fitness / 100);
  return ability * fit;
}

/** Assistant's lineup: greedy best fit per slot, strongest-demand slots first. */
export function autoLineup(world: World, club: Club): { lineup: Lineup; notes: string[] } {
  const slots = FORMATIONS[club.tactics.formation];
  const pool = Object.values(world.players).filter((p) => p.clubId === club.id && isAvailable(p));
  const used = new Set<string>();
  const starters: (string | null)[] = Array(11).fill(null);
  const notes: string[] = [];

  // GK first, then slots in order of how scarce good options are.
  const order = slots.map((_, i) => i).sort((a, b) => (slots[a].pos === 'GK' ? -1 : slots[b].pos === 'GK' ? 1 : 0));
  for (const i of order) {
    const pos = slots[i].pos;
    let best: Player | null = null;
    let bestS = -1;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      const s = selectionScore(p, pos);
      if (s > bestS) (bestS = s), (best = p);
    }
    if (best) {
      starters[i] = best.id;
      used.add(best.id);
      if (familiarity(best, pos) < 0.9) notes.push(`${shortName(best)} is covering at ${pos}; no natural option was fit.`);
      if (best.fitness < 80) notes.push(`${shortName(best)} starts despite ${best.fitness}% condition.`);
    }
  }

  // Bench: backup keeper, then best remaining by overall ability across defence/midfield/attack.
  const rest = pool.filter((p) => !used.has(p.id));
  const bench: string[] = [];
  const gk = rest.filter((p) => p.pos === 'GK').sort((a, b) => roleAbility(b.attrs, 'GK') - roleAbility(a.attrs, 'GK'))[0];
  if (gk) bench.push(gk.id);
  rest
    .filter((p) => p.pos !== 'GK')
    .sort((a, b) => selectionScore(b, b.pos) - selectionScore(a, a.pos))
    .slice(0, BENCH_SIZE - bench.length)
    .forEach((p) => bench.push(p.id));

  const rested = pool.filter((p) => !used.has(p.id) && p.fitness < 75);
  if (rested.length) notes.push(`Rested for condition: ${rested.slice(0, 3).map(shortName).join(', ')}.`);
  if (!notes.length) notes.push('Strongest available XI in natural positions.');
  return { lineup: { starters, bench }, notes };
}

export function validateLineup(world: World, club: Club): LineupIssue[] {
  const issues: LineupIssue[] = [];
  const slots = FORMATIONS[club.tactics.formation];
  const seen = new Set<string>();
  const { starters, bench } = club.lineup;
  starters.forEach((id, i) => {
    if (!id) {
      issues.push({ severity: 'error', message: `No player selected at ${slots[i].pos}.` });
      return;
    }
    const p = world.players[id];
    if (!p || p.clubId !== club.id) {
      issues.push({ severity: 'error', message: 'A selected player is no longer at the club.' });
      return;
    }
    if (seen.has(id)) issues.push({ severity: 'error', message: `${shortName(p)} is selected twice.`, playerId: id });
    seen.add(id);
    if (p.injury) issues.push({ severity: 'error', message: `${shortName(p)} is injured (${p.injury.label}).`, playerId: id });
    if (p.suspended) issues.push({ severity: 'error', message: `${shortName(p)} is suspended.`, playerId: id });
    if (familiarity(p, slots[i].pos) < 0.7)
      issues.push({ severity: 'warning', message: `${shortName(p)} is out of position at ${slots[i].pos}.`, playerId: id });
    if (p.fitness < 70) issues.push({ severity: 'warning', message: `${shortName(p)} is tired (${p.fitness}%).`, playerId: id });
  });
  for (const id of bench) {
    const p = world.players[id];
    if (!p || p.clubId !== club.id) issues.push({ severity: 'error', message: 'A substitute is no longer at the club.' });
    else if (seen.has(id)) issues.push({ severity: 'error', message: `${shortName(p)} is in the XI and on the bench.` });
    else if (!isAvailable(p)) issues.push({ severity: 'error', message: `${shortName(p)} on the bench is unavailable.` });
    seen.add(id);
  }
  const gkSlot = slots.findIndex((s) => s.pos === 'GK');
  const gk = starters[gkSlot] ? world.players[starters[gkSlot]!] : null;
  if (gk && gk.pos !== 'GK') issues.push({ severity: 'warning', message: `${shortName(gk)} is not a goalkeeper.` });
  return issues;
}

export function lineupIsValid(world: World, club: Club): boolean {
  return !validateLineup(world, club).some((i) => i.severity === 'error');
}

/** Remove departed/unavailable players; keep the manager's choices otherwise. */
export function sanitiseLineup(world: World, club: Club) {
  const ok = (id: string | null) => !!id && world.players[id]?.clubId === club.id;
  club.lineup.starters = club.lineup.starters.map((id) => (ok(id) ? id : null));
  club.lineup.bench = club.lineup.bench.filter((id) => ok(id) && !club.lineup.starters.includes(id));
}
