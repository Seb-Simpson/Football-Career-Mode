import { clubPlayers, clubStrength, createPlayer, assignNumber, emptyStats, squadWages, clampAttr } from '../../domain/generate';
import { generateFixtures, leagueTable, nextFixture } from '../../domain/fixtures';
import { autoLineup, sanitiseLineup } from '../../domain/lineup';
import { overall, playerValue, roundMoney, shortName, wageDemand } from '../../domain/player';
import {
  CLUBS_PER_DIVISION,
  LEAGUE_NAMES,
  MATCHWEEKS,
  PROMOTION_PLACES,
  WINDOW_WEEKS,
  type AttrKey,
  type Club,
  type Fixture,
  type InboxMessage,
  type LedgerEntry,
  type MatchResultSummary,
  type Objective,
  type Player,
  type Position,
  type World,
} from '../../domain/types';
import { Rng, hashString } from '../../shared/rng';
import { MatchEngine } from '../match/engine';
import { resolveKits, teamInput } from '../match/setup';

// ------------------------------------------------------------------ helpers

export function userClub(world: World): Club | null {
  return world.manager.clubId ? world.clubs[world.manager.clubId] : null;
}

export function matchSeed(world: World, f: Fixture): number {
  return hashString(`${world.seed}:${f.id}`);
}

export function pushInbox(world: World, msg: Omit<InboxMessage, 'id' | 'week' | 'season' | 'read'>) {
  world.inbox.unshift({ ...msg, id: `m${world.nextId++}`, week: world.week, season: world.season, read: false });
  if (world.inbox.length > 80) world.inbox.length = 80;
}

function ledger(world: World, clubId: string, e: Omit<LedgerEntry, 'week' | 'season'>) {
  const c = world.clubs[clubId];
  c.balance += e.amount;
  if (clubId === world.manager.clubId) {
    world.ledger.unshift({ ...e, week: world.week, season: world.season });
    if (world.ledger.length > 200) world.ledger.length = 200;
  }
}

export function isWindowOpen(world: World) {
  return WINDOW_WEEKS.has(world.week);
}

export function objectiveLabel(o: Objective): string {
  return {
    title: 'Win the league',
    promotion: 'Win promotion',
    'top-half': 'Finish in the top half',
    'mid-table': 'A safe mid-table finish',
    survive: 'Avoid relegation',
  }[o];
}

export function objectiveTarget(o: Objective): number {
  // Highest acceptable finishing position.
  return { title: 1, promotion: PROMOTION_PLACES, 'top-half': 5, 'mid-table': 7, survive: CLUBS_PER_DIVISION - PROMOTION_PLACES }[o];
}

export function setObjective(world: World) {
  const c = userClub(world);
  if (!c) return;
  const rivals = Object.values(world.clubs)
    .filter((x) => x.division === c.division)
    .sort((a, b) => clubStrength(world, b.id) - clubStrength(world, a.id));
  const rank = rivals.findIndex((x) => x.id === c.id) + 1;
  let o: Objective;
  if (c.division === 0) o = rank <= 2 ? 'title' : rank <= 4 ? 'top-half' : rank <= 7 ? 'mid-table' : 'survive';
  else o = rank <= 3 ? 'promotion' : rank <= 6 ? 'top-half' : 'mid-table';
  world.manager.objective = o;
}

// ------------------------------------------------------------- matchday

export interface PlayedMatch {
  fixture: Fixture;
  engine: MatchEngine;
}

/** Build an engine for a fixture. The user's side is never auto-managed except for injuries. */
export function createMatch(world: World, f: Fixture, record: boolean): MatchEngine {
  const home = world.clubs[f.home];
  const away = world.clubs[f.away];
  for (const c of [home, away]) {
    if (c.id !== world.manager.clubId) {
      c.lineup = autoLineup(world, c).lineup;
    } else sanitiseLineup(world, c);
  }
  const hi = teamInput(world, home, home.id !== world.manager.clubId);
  const ai = teamInput(world, away, away.id !== world.manager.clubId);
  ai.kit = resolveKits(home.kit, away);
  return new MatchEngine(hi, ai, matchSeed(world, f), { record });
}

export function applyResult(world: World, f: Fixture, m: MatchEngine) {
  const [hg, ag] = m.score();
  const ratings = m.ratings();
  const home = world.clubs[f.home];
  const away = world.clubs[f.away];
  const rng = new Rng(matchSeed(world, f) ^ 0xabc);

  // Attendance from capacity, reputation and form
  const fill = Math.min(1, 0.45 + home.reputation / 180 + rng.range(-0.05, 0.08) + (away.reputation > 70 ? 0.08 : 0));
  const attendance = Math.round(home.capacity * fill);

  const scorers: MatchResultSummary['scorers'] = [];
  for (const e of m.events) {
    if (e.type === 'goal' && e.player) {
      const p = world.players[e.player];
      const clubOfScorer = p?.clubId ?? '';
      scorers.push({
        playerId: e.player,
        club: e.detail === 'own goal' ? (e.team === 0 ? f.home : f.away) : clubOfScorer,
        minute: Math.floor(e.clock / 60) + 1,
        pen: e.detail === 'penalty' || undefined,
        og: e.detail === 'own goal' || undefined,
      });
    }
  }
  let motm: string | undefined;
  let best = -1;
  for (const [id, r] of Object.entries(ratings)) if (r > best) (best = r), (motm = id);

  f.result = { homeGoals: hg, awayGoals: ag, scorers, attendance, stats: m.matchStats(), ratings, motm };

  // Player consequences
  for (const team of [0, 1] as const) {
    const clubId = team === 0 ? f.home : f.away;
    const conceded = team === 0 ? ag : hg;
    for (const mp of m.teams[team].players) {
      const p = world.players[mp.id];
      if (!p) continue;
      if (mp.used) {
        p.stats.apps++;
        p.stats.goals += mp.goals;
        p.stats.assists += mp.assists;
        p.stats.ratingSum += ratings[mp.id] ?? 6;
        p.form = [...p.form, ratings[mp.id] ?? 6].slice(-5);
        if (mp.yellow) {
          p.stats.yellows++;
          p.yellowAccum++;
          if (p.yellowAccum >= 5) {
            p.suspended += 1;
            p.yellowAccum = 0;
          }
        }
        if (mp.sentOff) {
          p.stats.reds++;
          p.suspended += rng.int(1, 3);
        }
        if (p.pos === 'GK' && conceded === 0 && mp.minutes > 60) p.stats.cleanSheets++;
        // Condition loss scales with minutes and stamina.
        const loss = (mp.minutes / 90) * (26 - p.attrs.stamina * 0.6);
        p.fitness = Math.max(30, Math.round(p.fitness - loss));
        if (mp.injured) {
          const weeks = rng.int(1, 6);
          p.injury = { weeks, label: rng.pick(['Hamstring strain', 'Ankle sprain', 'Calf strain', 'Knee knock', 'Groin strain', 'Thigh bruise']) };
          if (clubId === world.manager.clubId) {
            pushInbox(world, {
              from: 'Medical department',
              subject: `${shortName(p)}: ${p.injury.label.toLowerCase()}`,
              body: `${p.first} ${p.last} picked up a ${p.injury.label.toLowerCase()} against ${world.clubs[team === 0 ? f.away : f.home].name}. Expected recovery is ${weeks}–${weeks + 1} weeks; return dates are estimates, not guarantees.`,
              kind: 'medical',
            });
          }
        }
      }
    }
    // Suspensions served this match by those who didn't play.
    for (const p of clubPlayers(world, clubId)) {
      if (!m.teams[team].players.some((q) => q.id === p.id) && p.suspended > 0 && !justSuspended(m, p.id)) p.suspended--;
    }
    // Morale
    const won = team === 0 ? hg > ag : ag > hg;
    const lost = team === 0 ? hg < ag : ag < hg;
    for (const p of clubPlayers(world, clubId)) {
      const played = m.teams[team].players.some((q) => q.id === p.id && q.used);
      const delta = (won ? 4 : lost ? -4 : 0) + (played ? 1 : -1);
      p.morale = Math.max(5, Math.min(100, p.morale + delta));
    }
  }
  // Gate receipts for the home side.
  ledger(world, home.id, { label: `Gate receipts v ${away.short}`, amount: Math.round(attendance * home.ticketPrice), category: 'gate' });
  void away;
}

function justSuspended(m: MatchEngine, id: string) {
  return m.events.some((e) => e.type === 'red' && e.player === id);
}

export function weekFixtures(world: World, week = world.week): Fixture[] {
  return world.fixtures.filter((f) => f.week === week);
}

export function userFixtureThisWeek(world: World): Fixture | undefined {
  const id = world.manager.clubId;
  if (!id) return undefined;
  return weekFixtures(world).find((f) => !f.result && (f.home === id || f.away === id));
}

/** Simulate every unplayed fixture of the current week except the excluded one. */
export async function simulateOtherMatches(world: World, exceptId: string | null, onProgress?: (done: number, total: number) => void) {
  const list = weekFixtures(world).filter((f) => !f.result && f.id !== exceptId);
  let done = 0;
  for (const f of list) {
    const m = createMatch(world, f, false);
    m.runToEnd();
    applyResult(world, f, m);
    done++;
    onProgress?.(done, list.length);
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ----------------------------------------------------------- week advance

export interface AdvanceResult {
  seasonEnded: boolean;
}

/** After the week's fixtures are complete: recover, develop, pay, trade, move the calendar. */
export function finishWeek(world: World): AdvanceResult {
  const rng = new Rng(world.rng);
  const userId = world.manager.clubId;

  // Board reaction to the user's result this week.
  if (userId) boardReaction(world);

  // Recovery and development
  const t = world.training;
  for (const p of Object.values(world.players)) {
    const isUser = p.clubId === userId;
    const recover = isUser ? { balanced: 14, attacking: 12, defending: 12, fitness: 10, recovery: 22 }[t] : 15;
    p.fitness = Math.min(100, p.fitness + recover + Math.round(p.attrs.stamina * 0.2));
    if (p.injury) {
      p.injury.weeks--;
      if (p.injury.weeks <= 0) {
        if (isUser) pushInbox(world, { from: 'Medical department', subject: `${shortName(p)} is back in training`, body: `${p.first} ${p.last} has recovered and is available for selection. Expect condition to take a week or two to return to full sharpness.`, kind: 'medical' });
        p.injury = null;
        p.fitness = Math.min(p.fitness, 75);
      }
    }
    if (p.clubId) developWeekly(p, rng, isUser ? t : 'balanced');
  }

  // Finances: wages, sponsorship, broadcast share.
  for (const c of Object.values(world.clubs)) {
    const wages = squadWages(world, c.id);
    ledger(world, c.id, { label: 'Player wages', amount: -wages, category: 'wages' });
    ledger(world, c.id, { label: 'Staff and running costs', amount: -Math.round(c.reputation * c.reputation * 6), category: 'staff' });
    ledger(world, c.id, { label: 'Broadcast distribution', amount: c.division === 0 ? 140_000 + c.reputation * 900 : 38_000 + c.reputation * 400, category: 'broadcast' });
    ledger(world, c.id, { label: 'Sponsorship', amount: Math.round(c.reputation * c.reputation * 9), category: 'sponsor' });
  }

  // Scouting reports complete after a week.
  if (world.scoutQueue?.length) {
    const done = world.scoutQueue.filter((id) => world.players[id]);
    for (const id of done) world.players[id].scouted = true;
    if (done.length && userId) {
      const names = done.map((id) => `${world.players[id].first} ${world.players[id].last} (${overall(world.players[id])})`);
      pushInbox(world, { from: 'Chief scout', subject: `Scouting report${done.length > 1 ? 's' : ''} ready`, body: `Full reports are in for: ${names.join(', ')}. Their profiles now show exact attributes and valuations.`, kind: 'scout' });
    }
    world.scoutQueue = [];
  }

  // Transfer activity
  if (isWindowOpen(world)) aiTransfers(world, rng);
  incomingBids(world, rng);

  world.rng = rng.state();
  world.week++;

  if (world.week > MATCHWEEKS) return { seasonEnded: true };

  // Pre-match reminder
  if (userId) {
    const nf = nextFixture(world, userId);
    if (nf && nf.week === world.week) {
      const opp = world.clubs[nf.home === userId ? nf.away : nf.home];
      const pos = leagueTable(world, opp.division).findIndex((r) => r.clubId === opp.id) + 1;
      if (world.week > 1 && rng.chance(0.35)) {
        pushInbox(world, {
          from: 'Assistant manager',
          subject: `Scouting ${opp.name}`,
          body: `${opp.name} sit ${ordinal(pos)} and usually line up ${opp.tactics.formation}. ${opp.tactics.pressing >= 3 ? 'They press high, so quick passing through midfield should find space behind.' : opp.tactics.mentality <= 1 ? 'They tend to sit deep; patience and width will matter more than pace in behind.' : 'They are well balanced; set pieces and midfield control could decide it.'}`,
          kind: 'scout',
        });
      }
    }
    if (world.week === 9) {
      pushInbox(world, { from: 'Director of football', subject: 'The mid-season window is open', body: 'The transfer window is open for matchweeks 9 and 10. Use it to cover injuries or strengthen for the run-in.', kind: 'info' });
    }
  }
  return { seasonEnded: false };
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
export { ordinal };

function developWeekly(p: Player, rng: Rng, focus: World['training']) {
  const current = overall(p) / 4.6;
  const room = p.potential - current;
  const ageF = p.age <= 20 ? 1 : p.age <= 23 ? 0.7 : p.age <= 27 ? 0.35 : p.age <= 30 ? 0 : -0.6;
  const playF = p.stats.apps > 0 ? 1.15 : 0.8;
  const chance = ageF > 0 ? Math.min(0.5, (room / 8) * ageF * playF * 0.5) : -ageF * 0.06;
  if (!rng.chance(Math.abs(chance))) return;
  const keys = focusKeys(p.pos, focus);
  const k = rng.pick(keys);
  if (ageF > 0 && room > 0) p.attrs[k] = clampAttr(p.attrs[k] + 1);
  else if (ageF < 0) {
    const phys: AttrKey[] = ['pace', 'stamina', 'strength'];
    const pk = rng.pick(phys);
    p.attrs[pk] = clampAttr(p.attrs[pk] - 1);
  }
}

function focusKeys(pos: Position, focus: World['training']): AttrKey[] {
  if (focus === 'attacking') return ['finishing', 'dribbling', 'passing', 'composure'];
  if (focus === 'defending') return ['tackling', 'positioning', 'heading', 'strength'];
  if (focus === 'fitness') return ['pace', 'stamina', 'strength'];
  if (pos === 'GK') return ['reflexes', 'handling', 'positioning'];
  return ['passing', 'decisions', 'dribbling', 'tackling', 'positioning', 'finishing', 'composure', 'workRate'];
}

// ---------------------------------------------------------------- board

function expectedPoints(world: World, us: string, them: string, home: boolean) {
  const d = clubStrength(world, us) - clubStrength(world, them) + (home ? 1.5 : -1.5);
  const pWin = 1 / (1 + Math.exp(-d / 4)) * 0.75;
  const pDraw = 0.27;
  return pWin * 3 + pDraw;
}

function boardReaction(world: World) {
  const id = world.manager.clubId!;
  const f = weekFixtures(world).find((x) => x.result && (x.home === id || x.away === id));
  if (!f || !f.result) return;
  const home = f.home === id;
  const gf = home ? f.result.homeGoals : f.result.awayGoals;
  const ga = home ? f.result.awayGoals : f.result.homeGoals;
  const pts = gf > ga ? 3 : gf === ga ? 1 : 0;
  const exp = expectedPoints(world, id, home ? f.away : f.home, home);
  const club = world.clubs[id];
  const pos = leagueTable(world, club.division).findIndex((r) => r.clubId === id) + 1;
  const target = objectiveTarget(world.manager.objective);
  const tableDrift = world.week >= 6 ? (pos <= target ? 0.6 : -Math.min(2.5, (pos - target) * 0.6)) : 0;
  const delta = (pts - exp) * 2.4 + tableDrift;
  world.manager.confidence = Math.max(0, Math.min(100, Math.round(world.manager.confidence + delta)));

  if (world.manager.confidence < 12 && world.week >= 8) sackManager(world, `Board confidence fell to ${world.manager.confidence}%.`);
  else if (world.manager.confidence < 25 && world.week >= 4 && !world.inbox.slice(0, 6).some((m) => m.kind === 'board')) {
    pushInbox(world, {
      from: 'The board',
      subject: 'Concern over recent results',
      body: `The board expects you to ${objectiveLabel(world.manager.objective).toLowerCase()}. Results have fallen short, and confidence now stands at ${world.manager.confidence}%. An improvement is needed soon.`,
      kind: 'board',
    });
  }
}

export function sackManager(world: World, reason: string) {
  const club = userClub(world);
  if (!club) return;
  const pos = leagueTable(world, club.division).findIndex((r) => r.clubId === club.id) + 1;
  world.manager.history.push({ season: world.season, club: club.id, division: club.division, position: pos, note: 'Dismissed' });
  world.manager.clubId = null;
  world.manager.sacked = true;
  world.manager.reputation = Math.max(10, world.manager.reputation - 8);
  pushInbox(world, { from: club.name, subject: 'You have been relieved of your duties', body: `${reason} The board thanks you for your work and wishes you well.`, kind: 'board' });
  offerJobs(world, 3);
}

export function offerJobs(world: World, n: number) {
  const rng = new Rng(world.rng);
  const rep = world.manager.reputation;
  const options = Object.values(world.clubs)
    .filter((c) => c.reputation <= rep + 25 && c.id !== world.manager.history.at(-1)?.club)
    .sort((a, b) => a.reputation - b.reputation);
  const picks = rng.shuffle([...options]).slice(0, n);
  if (!picks.length) picks.push(Object.values(world.clubs).sort((a, b) => a.reputation - b.reputation)[0]);
  for (const c of picks) {
    pushInbox(world, {
      from: c.name,
      subject: `Job offer: manager of ${c.name}`,
      body: `${c.name} (${LEAGUE_NAMES[c.division]}) would like you to take charge. Squad strength ${Math.round(clubStrength(world, c.id))}, transfer budget ${money(c.transferBudget)}.`,
      kind: 'job',
      action: { type: 'job-offer', clubId: c.id },
    });
  }
  world.rng = rng.state();
}

export function acceptJob(world: World, clubId: string) {
  world.manager.clubId = clubId;
  world.manager.sacked = false;
  world.manager.confidence = 60;
  setObjective(world);
  const c = world.clubs[clubId];
  c.lineup = autoLineup(world, c).lineup;
  for (const m of world.inbox) if (m.action?.type === 'job-offer' && !m.action.resolved) m.action.resolved = m.action.clubId === clubId ? 'accepted' : 'rejected';
  pushInbox(world, {
    from: 'The board',
    subject: `Welcome to ${c.name}`,
    body: `Our expectation this season: ${objectiveLabel(world.manager.objective).toLowerCase()}. The transfer budget is ${money(c.transferBudget)} and the weekly wage budget ${money(c.wageBudget)}.`,
    kind: 'board',
  });
}

export function money(n: number): string {
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}£${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}m`;
  if (a >= 1_000) return `${sign}£${Math.round(a / 1000)}k`;
  return `${sign}£${a}`;
}

// ------------------------------------------------------------ transfers

export interface DealResult {
  ok: boolean;
  message: string;
}

export function askingPrice(world: World, p: Player): number {
  const base = playerValue(p, world.season);
  if (!p.clubId) return 0;
  const club = world.clubs[p.clubId];
  const squad = clubPlayers(world, club.id).filter((q) => q.pos === p.pos).sort((a, b) => overall(b) - overall(a));
  const key = squad.indexOf(p) === 0 ? 1.35 : 1.1;
  return roundMoney(base * (p.listed ? 0.9 : key));
}

export function makeBid(world: World, playerId: string, fee: number, wage: number): DealResult {
  const club = userClub(world);
  const p = world.players[playerId];
  if (!club || !p) return { ok: false, message: 'Player not found.' };
  if (p.clubId === club.id) return { ok: false, message: 'He already plays for you.' };
  if (p.clubId && !isWindowOpen(world)) return { ok: false, message: 'The transfer window is closed. Free agents can still be signed.' };
  if (fee > club.transferBudget) return { ok: false, message: `That exceeds your transfer budget of ${money(club.transferBudget)}.` };
  const currentWages = squadWages(world, club.id);
  if (currentWages + wage > club.wageBudget * 1.02) return { ok: false, message: `Wage budget exceeded: ${money(currentWages + wage)} per week against a ${money(club.wageBudget)} limit.` };
  if (clubPlayers(world, club.id).length >= 30) return { ok: false, message: 'Your squad is at the 30-player limit.' };
  if (p.clubId) {
    const ask = askingPrice(world, p);
    if (fee < ask) {
      const pct = Math.round((fee / ask) * 100);
      return { ok: false, message: `${world.clubs[p.clubId].name} rejected the bid. ${pct < 80 ? 'They consider it well below his value.' : 'They want a little more.'}` };
    }
  }
  const demand = wageDemand(p) * (club.reputation < 50 ? 1.1 : 1);
  if (wage < demand * 0.95) return { ok: false, message: `${p.first} ${p.last} wants around ${money(Math.round(demand / 50) * 50)} a week.` };
  if (world.clubs[p.clubId ?? '']?.reputation > club.reputation + 22 && overall(p) > 70)
    return { ok: false, message: `${p.first} ${p.last} isn't interested in a move down to ${club.name}.` };

  // Atomic completion.
  const from = p.clubId;
  if (from) {
    ledger(world, from, { label: `Sale of ${shortName(p)}`, amount: fee, category: 'transfer' });
    world.clubs[from].transferBudget += Math.round(fee * 0.6);
    sanitiseLineup(world, world.clubs[from]);
  }
  ledger(world, club.id, { label: `Signed ${shortName(p)}`, amount: -fee, category: 'transfer' });
  club.transferBudget -= fee;
  p.clubId = club.id;
  p.contract = { wage: Math.round(wage / 50) * 50, expires: world.season + 3 };
  p.listed = false;
  p.scouted = true;
  p.morale = Math.max(p.morale, 70);
  const used = new Set(clubPlayers(world, club.id).filter((q) => q.id !== p.id).map((q) => q.number));
  p.number = assignNumber(p.pos, used);
  if (from) sanitiseLineup(world, world.clubs[from]);
  pushInbox(world, { from: 'Director of football', subject: `${shortName(p)} signs`, body: `${p.first} ${p.last} has joined from ${from ? world.clubs[from].name : 'free agency'} for ${fee ? money(fee) : 'no fee'} on ${money(p.contract.wage)} a week until ${p.contract.expires + 1}.`, kind: 'info' });
  return { ok: true, message: `${p.first} ${p.last} has signed.` };
}

export function releasePlayer(world: World, playerId: string): DealResult {
  const club = userClub(world);
  const p = world.players[playerId];
  if (!club || !p || p.clubId !== club.id) return { ok: false, message: 'Player not found.' };
  if (clubPlayers(world, club.id).length <= 16) return { ok: false, message: 'You need at least 16 players in the squad.' };
  const years = Math.max(0, p.contract.expires - world.season) + 0.5;
  const payoff = Math.round(p.contract.wage * 52 * years * 0.5);
  ledger(world, club.id, { label: `Contract settlement: ${shortName(p)}`, amount: -payoff, category: 'wages' });
  p.clubId = null;
  p.contract = { wage: 0, expires: world.season };
  p.listed = false;
  sanitiseLineup(world, club);
  return { ok: true, message: `${p.first} ${p.last} was released. Settlement paid: ${money(payoff)}.` };
}

export function renewContract(world: World, playerId: string, wage: number, years: number): DealResult {
  const club = userClub(world);
  const p = world.players[playerId];
  if (!club || !p || p.clubId !== club.id) return { ok: false, message: 'Player not found.' };
  const demand = renewalDemand(p);
  if (wage < demand) return { ok: false, message: `${p.first} wants at least ${money(demand)} a week.` };
  const delta = wage - p.contract.wage;
  if (squadWages(world, club.id) + delta > club.wageBudget * 1.02) return { ok: false, message: 'That would break the wage budget.' };
  p.contract = { wage, expires: world.season + years };
  p.morale = Math.min(100, p.morale + 8);
  return { ok: true, message: `${p.first} ${p.last} signed until ${world.season + years + 1}.` };
}

export function renewalDemand(p: Player): number {
  const base = wageDemand(p);
  const moraleF = p.morale > 70 ? 0.95 : p.morale < 40 ? 1.2 : 1.05;
  return Math.max(p.contract.wage, Math.round((base * moraleF) / 50) * 50);
}

export function respondToBid(world: World, msgId: string, accept: boolean): DealResult {
  const msg = world.inbox.find((m) => m.id === msgId);
  if (!msg || !msg.action || msg.action.resolved) return { ok: false, message: 'Offer no longer stands.' };
  const p = world.players[msg.action.playerId!];
  const buyer = world.clubs[msg.action.clubId!];
  const club = userClub(world);
  if (!p || !buyer || !club || p.clubId !== club.id) {
    msg.action.resolved = 'rejected';
    return { ok: false, message: 'Offer no longer stands.' };
  }
  if (!accept) {
    msg.action.resolved = 'rejected';
    p.morale = Math.max(0, p.morale - (p.listed ? 10 : 2));
    return { ok: true, message: `Bid from ${buyer.name} rejected.` };
  }
  if (!isWindowOpen(world)) {
    msg.action.resolved = 'rejected';
    return { ok: false, message: 'The window has closed; the deal lapsed.' };
  }
  if (clubPlayers(world, club.id).length <= 16) return { ok: false, message: 'You need at least 16 players in the squad.' };
  const fee = msg.action.fee!;
  ledger(world, club.id, { label: `Sale of ${shortName(p)}`, amount: fee, category: 'transfer' });
  club.transferBudget += Math.round(fee * 0.75);
  ledger(world, buyer.id, { label: `Signed ${shortName(p)}`, amount: -fee, category: 'transfer' });
  buyer.transferBudget = Math.max(0, buyer.transferBudget - fee);
  p.clubId = buyer.id;
  p.listed = false;
  p.contract = { wage: Math.round(wageDemand(p) / 50) * 50, expires: world.season + 3 };
  const used = new Set(clubPlayers(world, buyer.id).filter((q) => q.id !== p.id).map((q) => q.number));
  p.number = assignNumber(p.pos, used);
  sanitiseLineup(world, club);
  msg.action.resolved = 'accepted';
  return { ok: true, message: `${p.first} ${p.last} joins ${buyer.name} for ${money(fee)}.` };
}

function incomingBids(world: World, rng: Rng) {
  const club = userClub(world);
  if (!club || !WINDOW_WEEKS.has(world.week + 1) && !WINDOW_WEEKS.has(world.week)) return;
  const squad = clubPlayers(world, club.id);
  for (const p of squad) {
    const interest = (p.listed ? 0.4 : 0.03) * (overall(p) > 60 ? 1.2 : 0.8);
    if (!rng.chance(interest)) continue;
    const buyers = Object.values(world.clubs).filter((c) => c.id !== club.id && c.transferBudget > playerValue(p, world.season) * 0.8);
    if (!buyers.length) continue;
    const buyer = rng.pick(buyers);
    const fee = roundMoney(playerValue(p, world.season) * rng.range(0.85, 1.25));
    pushInbox(world, {
      from: buyer.name,
      subject: `Bid for ${shortName(p)}: ${money(fee)}`,
      body: `${buyer.name} have offered ${money(fee)} for ${p.first} ${p.last}. Our valuation is around ${money(playerValue(p, world.season))}.${!isWindowOpen(world) ? ' The deal can only complete while the window is open.' : ''}`,
      kind: 'transfer-offer',
      action: { type: 'accept-bid', playerId: p.id, clubId: buyer.id, fee },
    });
  }
}

function aiTransfers(world: World, rng: Rng) {
  const userId = world.manager.clubId;
  for (const c of Object.values(world.clubs)) {
    if (c.id === userId) continue;
    const squad = clubPlayers(world, c.id);
    if (!rng.chance(squad.length < 22 ? 0.7 : 0.25)) continue;
    // Find the weakest position group and look for an upgrade.
    const need = weakestPosition(squad);
    const avg = squad.length ? squad.reduce((s, p) => s + overall(p), 0) / squad.length : 50;
    const targets = Object.values(world.players).filter(
      (p) =>
        p.pos === need &&
        p.clubId !== c.id &&
        p.clubId !== userId &&
        overall(p) >= avg - 2 &&
        (p.clubId === null || world.clubs[p.clubId].reputation < c.reputation + 5) &&
        p.age < 32,
    );
    if (!targets.length) continue;
    const t = rng.pick(targets);
    const fee = t.clubId ? askingPrice(world, t) : 0;
    if (fee > c.transferBudget) continue;
    const from = t.clubId;
    if (from && clubPlayers(world, from).length <= 18) continue;
    if (squad.length >= 28) {
      // Make room: release the weakest player.
      const weakest = [...squad].sort((a, b) => overall(a) - overall(b))[0];
      weakest.clubId = null;
      weakest.contract = { wage: 0, expires: world.season };
    }
    if (from) {
      ledger(world, from, { label: `Sale of ${shortName(t)}`, amount: fee, category: 'transfer' });
      world.clubs[from].transferBudget += Math.round(fee * 0.5);
    }
    c.balance -= fee;
    c.transferBudget -= fee;
    t.clubId = c.id;
    t.contract = { wage: Math.round(wageDemand(t) / 50) * 50, expires: world.season + rng.int(1, 4) };
    const used = new Set(clubPlayers(world, c.id).filter((q) => q.id !== t.id).map((q) => q.number));
    t.number = assignNumber(t.pos, used);
    if (from) sanitiseLineup(world, world.clubs[from]);
  }
}

function weakestPosition(squad: Player[]): Position {
  const groups: Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];
  const need: Record<Position, number> = { GK: 2, CB: 4, LB: 2, RB: 2, DM: 2, CM: 3, AM: 1, LW: 2, RW: 2, ST: 3 };
  let worst: Position = 'CM';
  let worstScore = 1e9;
  for (const g of groups) {
    const ps = squad.filter((p) => p.pos === g);
    const score = ps.length - need[g] + (ps.length ? Math.max(...ps.map(overall)) / 100 : 0);
    if (score < worstScore) (worstScore = score), (worst = g);
  }
  return worst;
}

// ------------------------------------------------------------ season end

export interface SeasonSummary {
  season: number;
  tables: { division: 0 | 1; rows: { clubId: string; pts: number; gd: number }[] }[];
  promoted: string[];
  relegated: string[];
  champions: [string, string];
  userPosition: number | null;
  userDivision: number | null;
  objectiveMet: boolean | null;
  topScorers: { playerId: string; goals: number }[];
  retirements: string[];
  youth: string[];
  expired: string[];
}

export function endSeason(world: World): SeasonSummary {
  const rng = new Rng(world.rng);
  const t0 = leagueTable(world, 0);
  const t1 = leagueTable(world, 1);
  const relegated = t0.slice(-PROMOTION_PLACES).map((r) => r.clubId);
  const promoted = t1.slice(0, PROMOTION_PLACES).map((r) => r.clubId);
  const userId = world.manager.clubId;
  const userDiv = userId ? world.clubs[userId].division : null;
  const userPos = userId ? (userDiv === 0 ? t0 : t1).findIndex((r) => r.clubId === userId) + 1 : null;
  const target = objectiveTarget(world.manager.objective);
  const objectiveMet = userPos ? userPos <= target || (userDiv === 1 && promoted.includes(userId!)) : null;

  world.champions.push({ season: world.season, division: 0, club: t0[0].clubId }, { season: world.season, division: 1, club: t1[0].clubId });

  // Prize money
  [t0, t1].forEach((table, div) =>
    table.forEach((r, i) => {
      const amount = div === 0 ? 4_000_000 - i * 320_000 : 900_000 - i * 70_000;
      ledger(world, r.clubId, { label: `Prize money (${ordinal(i + 1)})`, amount, category: 'prize' });
    }),
  );

  const topScorers = Object.values(world.players)
    .filter((p) => p.stats.goals > 0)
    .sort((a, b) => b.stats.goals - a.stats.goals)
    .slice(0, 5)
    .map((p) => ({ playerId: p.id, goals: p.stats.goals }));

  // Manager record and board review
  if (userId && userPos) {
    world.manager.history.push({ season: world.season, club: userId, division: userDiv!, position: userPos });
    world.manager.reputation = Math.max(5, Math.min(100, world.manager.reputation + (objectiveMet ? 8 : -6) + (userPos === 1 ? 10 : 0)));
    world.manager.confidence = Math.max(0, Math.min(100, world.manager.confidence + (objectiveMet ? 15 : -20)));
  }

  const summary: SeasonSummary = {
    season: world.season,
    tables: [
      { division: 0, rows: t0.map((r) => ({ clubId: r.clubId, pts: r.pts, gd: r.gd })) },
      { division: 1, rows: t1.map((r) => ({ clubId: r.clubId, pts: r.pts, gd: r.gd })) },
    ],
    promoted,
    relegated,
    champions: [t0[0].clubId, t1[0].clubId],
    userPosition: userPos,
    userDivision: userDiv,
    objectiveMet,
    topScorers,
    retirements: [],
    youth: [],
    expired: [],
  };

  // Promotion & relegation, reputation drift.
  for (const id of relegated) world.clubs[id].division = 1;
  for (const id of promoted) world.clubs[id].division = 0;
  [t0, t1].forEach((table) =>
    table.forEach((r, i) => {
      const c = world.clubs[r.clubId];
      c.reputation = Math.max(20, Math.min(95, c.reputation + (i < 3 ? 2 : i > 6 ? -2 : 0) + (promoted.includes(c.id) ? 4 : relegated.includes(c.id) ? -4 : 0)));
    }),
  );

  // Players: history, ageing, retirements, contracts.
  for (const p of Object.values(world.players)) {
    if (p.clubId && p.stats.apps) p.history.push({ season: world.season, club: p.clubId, apps: p.stats.apps, goals: p.stats.goals });
    p.stats = emptyStats();
    p.yellowAccum = 0;
    p.form = [];
    p.age++;
    // Off-season development / decline jump
    const room = p.potential - overall(p) / 4.6;
    if (p.age <= 23 && room > 0) bump(p, rng, Math.min(3, Math.ceil(room / 2)));
    if (p.age >= 31) drop(p, rng, p.age >= 33 ? 2 : 1);

    if (p.age >= 34 && rng.chance(0.25 + (p.age - 34) * 0.22)) {
      if (p.clubId === userId) summary.retirements.push(p.id);
      delete world.players[p.id];
      continue;
    }
    if (p.clubId && p.contract.expires <= world.season) {
      if (p.clubId === userId) {
        summary.expired.push(p.id);
        p.clubId = null;
        p.contract = { wage: 0, expires: world.season + 1 };
      } else if (rng.chance(0.72) && p.age < 33) {
        p.contract = { wage: Math.round(wageDemand(p) / 50) * 50, expires: world.season + 1 + rng.int(1, 3) };
      } else {
        p.clubId = null;
        p.contract = { wage: 0, expires: world.season + 1 };
      }
    }
  }

  // Youth intake & squad top-up
  for (const c of Object.values(world.clubs)) {
    const used = new Set(clubPlayers(world, c.id).map((q) => q.number));
    const intake = rng.int(2, 3);
    for (let i = 0; i < intake; i++) {
      const pos = rng.pick<Position>(['GK', 'CB', 'CB', 'LB', 'RB', 'DM', 'CM', 'CM', 'AM', 'LW', 'RW', 'ST', 'ST']);
      const id = `p${world.nextId++}`;
      const quality = 4.5 + c.reputation * 0.055 + rng.gauss(0, 1);
      const yp = createPlayer(rng, id, pos, quality, rng.int(16, 18), world.season + 1, c.id);
      yp.potential = Math.min(19.5, quality + rng.range(2, 7.5));
      yp.contract = { wage: 400 + rng.int(0, 6) * 100, expires: world.season + 3 };
      yp.number = assignNumber(pos, used);
      world.players[id] = yp;
      if (c.id === userId) summary.youth.push(id);
    }
    // AI top-up from free agents to at least 20.
    if (c.id !== userId) {
      let squad = clubPlayers(world, c.id);
      while (squad.length < 20) {
        const need = weakestPosition(squad);
        const fa = Object.values(world.players).filter((p) => !p.clubId && p.pos === need).sort((a, b) => overall(b) - overall(a))[0];
        const pid = fa ? fa.id : `p${world.nextId++}`;
        const p = fa ?? createPlayer(rng, pid, need, 6 + c.reputation * 0.06, rng.int(20, 30), world.season + 1, c.id);
        p.clubId = c.id;
        p.contract = { wage: Math.round(wageDemand(p) / 50) * 50, expires: world.season + 2 };
        p.number = assignNumber(p.pos, used);
        world.players[pid] = p;
        squad = clubPlayers(world, c.id);
      }
    }
  }
  // Keep a healthy free-agent pool.
  const freeCount = Object.values(world.players).filter((p) => !p.clubId).length;
  for (let i = freeCount; i < 40; i++) {
    const pos = rng.pick<Position>(['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST']);
    const id = `p${world.nextId++}`;
    const p = createPlayer(rng, id, pos, rng.range(6.5, 10.5), rng.int(19, 33), world.season + 1, null);
    p.contract.wage = 0;
    world.players[id] = p;
  }
  // Prune old free agents to keep saves small.
  for (const p of Object.values(world.players)) if (!p.clubId && p.age > 34) delete world.players[p.id];

  // Budgets for the new season
  for (const c of Object.values(world.clubs)) {
    c.wageBudget = roundMoney(Math.max(squadWages(world, c.id) * 1.1, c.reputation * c.reputation * 22));
    c.transferBudget = roundMoney(Math.max(0, c.balance * 0.25) + Math.pow(c.reputation, 2.4) * 80);
    c.lineup = autoLineup(world, c).lineup;
  }

  world.season++;
  world.week = 0;
  world.fixtures = generateFixtures(world, rng);
  world.rng = rng.state();
  for (const p of Object.values(world.players)) {
    p.fitness = Math.max(p.fitness, 85);
    p.suspended = 0;
  }

  if (userId) {
    if (world.manager.confidence < 15) sackManager(world, 'The board has decided a change is needed after an unsuccessful season.');
    else {
      setObjective(world);
      pushInbox(world, {
        from: 'The board',
        subject: `Season ${world.season}/${String(world.season + 1).slice(2)} objectives`,
        body: `The board's expectation: ${objectiveLabel(world.manager.objective).toLowerCase()}. Transfer budget ${money(world.clubs[userId].transferBudget)}; wage budget ${money(world.clubs[userId].wageBudget)} per week.`,
        kind: 'board',
      });
    }
  }
  return summary;
}

function bump(p: Player, rng: Rng, n: number) {
  for (let i = 0; i < n; i++) {
    const k = rng.pick<AttrKey>(['passing', 'decisions', 'dribbling', 'finishing', 'tackling', 'positioning', 'composure', 'pace', 'strength', 'stamina', ...(p.pos === 'GK' ? (['reflexes', 'handling'] as AttrKey[]) : [])]);
    p.attrs[k] = clampAttr(p.attrs[k] + 1);
  }
}

function drop(p: Player, rng: Rng, n: number) {
  for (let i = 0; i < n; i++) {
    const k = rng.pick<AttrKey>(['pace', 'stamina', 'strength', 'pace']);
    p.attrs[k] = clampAttr(p.attrs[k] - 1);
  }
}

export function startCareer(world: World, clubId: string) {
  world.manager.clubId = clubId;
  setObjective(world);
  const c = world.clubs[clubId];
  for (const p of clubPlayers(world, clubId)) p.scouted = true;
  c.lineup = autoLineup(world, c).lineup;
  pushInbox(world, {
    from: 'The board',
    subject: `Welcome to ${c.name}`,
    body: `Welcome to ${c.stadium}. The board's expectation this season is clear: ${objectiveLabel(world.manager.objective).toLowerCase()}.\n\nYour transfer budget is ${money(c.transferBudget)} and the weekly wage budget is ${money(c.wageBudget)}. The pre-season window is open now; it closes when the first matchweek begins, and reopens for matchweeks 9 and 10.`,
    kind: 'board',
  });
  pushInbox(world, {
    from: 'Assistant manager',
    subject: 'Your squad, at a glance',
    body: `I've picked a starting XI in our ${c.tactics.formation} — you can change it on the Squad screen. Use Tactics to set how we play. When you're ready, press Continue to move to matchweek 1.`,
    kind: 'info',
  });
}
