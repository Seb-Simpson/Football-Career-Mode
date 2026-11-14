import type { MatchEngine, MatchEvent } from '../simulation/match/engine';

/** Text commentary generated only from authoritative engine events. */
export function commentary(ev: MatchEvent, m: MatchEngine): string | null {
  const name = (id?: string) => (id ? m.playerById(id)?.name ?? 'A player' : 'A player');
  const team = (t: number) => (t === 0 || t === 1 ? m.teams[t].input.name : '');
  const pick = <T,>(arr: T[]) => arr[ev.seq % arr.length];
  const p = name(ev.player);
  const o = name(ev.other);
  const [h, a] = ev.score ?? [0, 0];
  switch (ev.type) {
    case 'kickoff':
      return ev.clock < 5 ? `We're under way. ${team(ev.team)} get the match started.` : ev.clock > 2600 && ev.clock < 2720 ? `${team(ev.team)} begin the second half.` : null;
    case 'goal':
      if (ev.detail === 'own goal') return `Own goal! ${p} turns it into his own net. ${h}–${a}.`;
      if (ev.detail === 'penalty') return `${p} sends the keeper the wrong way from the spot. ${h}–${a}.`;
      if (ev.detail === 'header') return `${p} rises highest and heads it in${ev.other ? ` from ${o}'s delivery` : ''}! ${h}–${a}.`;
      return pick([
        `${p} scores${ev.other ? `, set up by ${o}` : ''}! ${h}–${a}.`,
        `It's in! ${p} finishes${ev.other ? ` after ${o}'s pass` : ''}. ${h}–${a}.`,
        `${p} makes no mistake${ev.other ? ` from ${o}'s ball` : ''}. ${h}–${a}.`,
      ]);
    case 'shot':
      if (ev.detail === 'blocked') return null;
      if (ev.detail === 'penalty') return `${p} steps up to take the penalty…`;
      if ((ev.xg ?? 0) > 0.25) return pick([`Big chance for ${p}…`, `${p} is through on goal…`, `${p} has a sight of goal…`]);
      return null;
    case 'save':
      return pick([`Good save by ${p} to deny ${o}.`, `${p} gets down well to keep out ${o}'s effort.`, `${o} forces a save from ${p}.`]);
    case 'miss':
      return (ev.xg ?? 0) > 0.2 ? pick([`${p} should have scored! Wide.`, `${p} blazes it over from a great position.`]) : pick([`${p} tries his luck from distance. Off target.`, `${p}'s effort drifts wide.`, `Over the bar from ${p}.`]);
    case 'post':
      return `Off the woodwork! ${p} is so close.`;
    case 'block':
      return pick([`${p} throws himself in front of it. Blocked.`, `Brave block from ${p} to stop ${o}.`]);
    case 'foul':
      return null;
    case 'yellow':
      return `Yellow card for ${p}.`;
    case 'red':
      return ev.detail === 'Second yellow' ? `${p} is shown a second yellow and sent off!` : `Straight red for ${p}! ${team(ev.team)} are down to ten.`;
    case 'penalty':
      return `Penalty to ${team(ev.team)}! ${p} is brought down in the box.`;
    case 'sub':
      return `Substitution for ${team(ev.team)}: ${p} replaces ${o}${ev.detail === 'injury' ? ', who is injured' : ''}.`;
    case 'injury':
      return `${p} is down and receiving treatment.`;
    case 'offside':
      return pick([`The flag is up. ${p} was offside.`, `${p} strays offside.`]);
    case 'corner':
      return null;
    case 'halftime':
      return `Half-time: ${team(0)} ${h}–${a} ${team(1)}.`;
    case 'fulltime':
      return `Full-time: ${team(0)} ${h}–${a} ${team(1)}.`;
    case 'tactics':
      return `${team(ev.team)} change approach: ${ev.detail}.`;
    default:
      return null;
  }
}

/** Events worth showing in key-highlights mode. */
export function isHighlight(ev: MatchEvent): boolean {
  return ev.type === 'goal' || ev.type === 'red' || ev.type === 'post' || ev.type === 'penalty' || (ev.type === 'save' && (ev.xg ?? 0) > 0.12) || (ev.type === 'miss' && (ev.xg ?? 0) > 0.2);
}
