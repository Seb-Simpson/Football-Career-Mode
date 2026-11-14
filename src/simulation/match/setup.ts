import { FORMATIONS } from '../../domain/formations';
import { autoLineup, lineupIsValid, sanitiseLineup } from '../../domain/lineup';
import { familiarity, shortName } from '../../domain/player';
import type { Club, Kit, World } from '../../domain/types';
import type { MatchPlayerInput, MatchTeamInput } from './engine';

export function teamInput(world: World, club: Club, autoManage: boolean): MatchTeamInput {
  sanitiseLineup(world, club);
  if (!lineupIsValid(world, club)) club.lineup = autoLineup(world, club).lineup;
  const slots = FORMATIONS[club.tactics.formation];
  const mk = (id: string, slotPos?: string): MatchPlayerInput => {
    const p = world.players[id];
    return {
      id,
      name: shortName(p),
      number: p.number,
      pos: p.pos,
      attrs: p.attrs,
      fitness: p.fitness,
      familiarity: slotPos ? familiarity(p, slotPos as any) : 1,
    };
  };
  return {
    clubId: club.id,
    name: club.name,
    short: club.short,
    kit: club.kit,
    tactics: { ...club.tactics },
    starters: club.lineup.starters.map((id, i) => mk(id!, slots[i].pos)),
    bench: club.lineup.bench.map((id) => mk(id)),
    autoManage,
  };
}

/** Pick an away kit when colours would be hard to tell apart. */
export function resolveKits(home: Kit, away: Club): Kit {
  return colorDistance(home.primary, away.kit.primary) < 120 ? away.away : away.kit;
}

export function colorDistance(a: string, b: string): number {
  const pa = hex(a);
  const pb = hex(b);
  return Math.sqrt((pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 + (pa[2] - pb[2]) ** 2);
}

export function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
