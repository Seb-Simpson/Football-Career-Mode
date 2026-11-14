/**
 * Deterministic spatial match engine.
 *
 * - Fixed 0.2s step, seeded RNG owned by the match: the same seed, inputs and
 *   command sequence (by tick) always reproduce the same match.
 * - No DOM, React, camera or frame-rate dependencies. Presentation reads
 *   recorded frames and the ordered event log.
 */
import { FORMATIONS, type Slot } from '../../domain/formations';
import type { Attributes, Kit, MatchStats, Position, Tactics } from '../../domain/types';
import { MAX_SUBS } from '../../domain/types';
import { Rng } from '../../shared/rng';
import { BOX_DEPTH, BOX_HALF, GOAL_H, GOAL_HALF, PITCH_L, PITCH_W, clamp, dist, locationXg, segDist } from './geometry';
import { ballStep, groundPassSpeed, loftedLaunch, predictPath, type BallState, type PathPoint } from './ballphys';

export const DT = 0.2;
export const HALF_SECONDS = 45 * 60;
export const MAX_PER_TEAM = 18;
export const FRAME_STRIDE = 6 + MAX_PER_TEAM * 2 * 2; // clock, half, bx, by, bz, owner + 36 players * (x,y)
const OFF = -32768;

export interface MatchPlayerInput {
  id: string;
  name: string;
  number: number;
  pos: Position; // natural position (used for bench matching)
  attrs: Attributes;
  fitness: number; // 0..100
  familiarity: number; // in starting slot; bench players default 1
}

export interface MatchTeamInput {
  clubId: string;
  name: string;
  short: string;
  kit: Kit;
  tactics: Tactics;
  starters: MatchPlayerInput[]; // 11 in formation slot order
  bench: MatchPlayerInput[];
  /** If true, the built-in assistant makes substitutions/tactical tweaks. */
  autoManage: boolean;
}

export type EventType =
  | 'kickoff'
  | 'goal'
  | 'shot'
  | 'save'
  | 'miss'
  | 'post'
  | 'block'
  | 'foul'
  | 'yellow'
  | 'red'
  | 'sub'
  | 'injury'
  | 'offside'
  | 'corner'
  | 'penalty'
  | 'halftime'
  | 'fulltime'
  | 'tactics'
  | 'chance';

export interface MatchEvent {
  seq: number;
  tick: number;
  clock: number; // match seconds
  half: 1 | 2;
  type: EventType;
  team: 0 | 1 | -1;
  player?: string;
  other?: string; // assist, fouled player, substitute coming on
  xg?: number;
  detail?: string;
  score?: [number, number];
}

export type MatchCommand =
  | { type: 'sub'; team: 0 | 1; outId: string; inId: string }
  | { type: 'tactics'; team: 0 | 1; tactics: Tactics };

interface MP {
  id: string;
  name: string;
  number: number;
  natPos: Position;
  team: 0 | 1;
  ent: number; // entity index within team (0..17)
  slot: Slot | null; // null when not on pitch
  slotIdx: number;
  attrs: Attributes;
  fam: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  stamina: number; // 0..1
  onPitch: boolean;
  used: boolean; // has appeared
  sentOff: boolean;
  injured: boolean;
  yellow: boolean;
  holdOffside: number; // personal offside-line error, metres
  tackleCd: number;
  tx: number; // smoothed movement target
  ty: number;
  supT: number; // support-run re-evaluation timer
  supX: number; // chosen support offset from the formation target
  supY: number;
  chase: boolean; // moving to meet the ball this tick
  aerial: number; // aerial duel ability, 0..1
  run: number; // seconds left on a run in behind
  runCd: number; // cooldown before another run
  // stats
  touches: number;
  passes: number;
  passesOk: number;
  shots: number;
  onTarget: number;
  goals: number;
  assists: number;
  tackles: number;
  interceptions: number;
  saves: number;
  fouls: number;
  keyPasses: number;
  conceded: number;
  minutes: number;
}

type RestartType = 'kickoff' | 'throw' | 'goalkick' | 'corner' | 'freekick' | 'penalty';

interface Restart {
  type: RestartType;
  team: 0 | 1;
  x: number;
  y: number;
  timer: number;
  taker: MP | null;
}

type BallKind = 'none' | 'pass' | 'through' | 'cross' | 'long' | 'shot' | 'loose' | 'clear';

type SetPieceRole = 'runner' | 'edge' | 'back' | 'marker' | 'zonal' | 'post' | 'outlet' | 'keeper';

interface SetPiecePlan {
  team: 0 | 1; // attacking team
  sideY: -1 | 1; // which side the ball comes from
  roles: Map<MP, { kind: SetPieceRole; x: number; y: number; mark?: MP }>;
  delivered: boolean;
  until: number; // tick after which the plan lapses
}

interface ShotPlan {
  outcome: 'goal' | 'save' | 'catch' | 'miss' | 'post';
  shooter: MP;
  xg: number;
  resolved: boolean;
}

interface TeamState {
  input: MatchTeamInput;
  tactics: Tactics;
  slots: Slot[];
  players: MP[]; // all entities (starters + bench)
  subsUsed: number;
  pendingSubs: { outId: string; inId: string }[];
  score: number;
  lastAiCheck: number;
}

export class MatchEngine {
  readonly rng: Rng;
  tick = 0;
  clock = 0;
  half: 1 | 2 = 1;
  stoppage: [number, number] = [0, 0];
  finished = false;
  readonly teams: [TeamState, TeamState];
  readonly events: MatchEvent[] = [];
  private seq = 0;

  // ball
  bx = PITCH_L / 2;
  by = PITCH_W / 2;
  bz = 0;
  bvx = 0;
  bvy = 0;
  bvz = 0;
  owner: MP | null = null;
  lastTouch: MP | null = null;
  assistCandidate: MP | null = null;
  intended: MP | null = null;
  ballKind: BallKind = 'none';
  passer: MP | null = null;
  shot: ShotPlan | null = null;
  decisionTimer = 0;
  carryDir: [number, number] = [1, 0];
  mustPass: RestartType | null = null;
  gkHold = 0;
  protect = 0;
  private noTouch: MP | null = null;
  private noTouchT = 0;
  restart: Restart | null = null;
  private setPiece: SetPiecePlan | null = null;
  private lastPasserTo: MP | null = null;
  private chaseCache = new Map<MP, [number, number]>();
  private chaseKey = '';
  private lastPasserFrom = '';
  private pathCache: { tick: number; path: PathPoint[] } | null = null;
  celebrate = 0;
  goalTeam: 0 | 1 = 0;

  // stats
  possTicks: [number, number] = [0, 0];
  stats = {
    shots: [0, 0],
    onTarget: [0, 0],
    passes: [0, 0],
    passesOk: [0, 0],
    corners: [0, 0],
    fouls: [0, 0],
    yellows: [0, 0],
    reds: [0, 0],
    offsides: [0, 0],
    xg: [0, 0],
  };

  // recording
  readonly record: boolean;
  private frameChunks: Int16Array[] = [];
  private chunkSize = 1500;
  frameCount = 0;
  private commandQueue: MatchCommand[] = [];

  constructor(home: MatchTeamInput, away: MatchTeamInput, seed: number, opts: { record?: boolean } = {}) {
    this.rng = new Rng(seed);
    this.record = !!opts.record;
    this.teams = [this.buildTeam(home, 0), this.buildTeam(away, 1)];
    // Stoppage time decided by the match's own RNG up front for the first half;
    // the second half adds time for goals, cards and substitutions as they occur.
    this.stoppage[0] = 60 + this.rng.int(0, 2) * 60;
    this.stoppage[1] = 120;
    this.setupKickoff(0);
    this.recordFrame();
  }

  private buildTeam(input: MatchTeamInput, team: 0 | 1): TeamState {
    const slots = FORMATIONS[input.tactics.formation];
    const players: MP[] = [];
    const mk = (p: MatchPlayerInput, ent: number, slotIdx: number): MP => ({
      id: p.id,
      name: p.name,
      number: p.number,
      natPos: p.pos,
      team,
      ent,
      slot: slotIdx >= 0 ? slots[slotIdx] : null,
      slotIdx,
      attrs: p.attrs,
      fam: p.familiarity,
      x: -100,
      y: -100,
      vx: 0,
      vy: 0,
      stamina: clamp(p.fitness / 100, 0.4, 1),
      onPitch: slotIdx >= 0,
      used: slotIdx >= 0,
      sentOff: false,
      injured: false,
      yellow: false,
      holdOffside: 0,
      tackleCd: 0,
      tx: -1000,
      ty: -1000,
      supT: (ent * 0.13) % 1,
      supX: 0,
      supY: 0,
      chase: false,
      run: 0,
      runCd: 3 + ent,
      aerial: (p.attrs.heading * 0.45 + p.attrs.strength * 0.25 + p.attrs.positioning * 0.15 + p.attrs.pace * 0.15) / 20,
      touches: 0,
      passes: 0,
      passesOk: 0,
      shots: 0,
      onTarget: 0,
      goals: 0,
      assists: 0,
      tackles: 0,
      interceptions: 0,
      saves: 0,
      fouls: 0,
      keyPasses: 0,
      conceded: 0,
      minutes: 0,
    });
    input.starters.slice(0, 11).forEach((p, i) => players.push(mk(p, i, i)));
    input.bench.slice(0, MAX_PER_TEAM - 11).forEach((p, i) => players.push(mk(p, 11 + i, -1)));
    return {
      input,
      tactics: { ...input.tactics },
      slots,
      players,
      subsUsed: 0,
      pendingSubs: [],
      score: 0,
      lastAiCheck: 0,
    };
  }

  // ---------------------------------------------------------------- helpers

  /** +1 if team attacks towards x = 105 in the current half. */
  dir(team: 0 | 1): 1 | -1 {
    const base = team === 0 ? 1 : -1;
    return (this.half === 1 ? base : -base) as 1 | -1;
  }

  private toU(team: 0 | 1, x: number) {
    return this.dir(team) > 0 ? x / PITCH_L : 1 - x / PITCH_L;
  }
  private toV(team: 0 | 1, y: number) {
    return this.dir(team) > 0 ? y / PITCH_W : 1 - y / PITCH_W;
  }
  private fromUV(team: 0 | 1, u: number, v: number): [number, number] {
    return this.dir(team) > 0 ? [u * PITCH_L, v * PITCH_W] : [(1 - u) * PITCH_L, (1 - v) * PITCH_W];
  }
  private goalX(team: 0 | 1) {
    return this.dir(team) > 0 ? PITCH_L : 0;
  }

  private pitchCache: [MP[], MP[]] | null = null;
  onPitch(team: 0 | 1): MP[] {
    if (!this.pitchCache) this.pitchCache = [this.teams[0].players.filter((p) => p.onPitch), this.teams[1].players.filter((p) => p.onPitch)];
    return this.pitchCache[team];
  }
  private dirtyPitch() {
    this.pitchCache = null;
  }

  get minute(): number {
    return Math.floor(this.clock / 60) + 1;
  }

  /** Team considered in possession for shape purposes. */
  private possTeam(): 0 | 1 {
    if (this.owner) return this.owner.team;
    if (this.restart) return this.restart.team;
    if (this.ballKind === 'pass' || this.ballKind === 'through' || this.ballKind === 'cross' || this.ballKind === 'long') {
      return this.passer ? this.passer.team : 0;
    }
    return this.lastTouch ? this.lastTouch.team : 0;
  }

  private gk(team: 0 | 1): MP | undefined {
    return this.teams[team].players.find((p) => p.onPitch && p.slot?.pos === 'GK');
  }

  private fatigue(p: MP) {
    return 0.72 + 0.28 * p.stamina;
  }

  private skill(p: MP, k: keyof Attributes) {
    // Small home advantage applied to execution, not to results.
    const home = p.team === 0 ? 1.035 : 1;
    return (p.attrs[k] / 20) * (0.85 + 0.15 * p.fam) * this.fatigue(p) * home;
  }

  private pushEvent(type: EventType, team: 0 | 1 | -1, extra: Partial<MatchEvent> = {}) {
    this.events.push({
      seq: this.seq++,
      tick: this.tick,
      clock: this.clock,
      half: this.half,
      type,
      team,
      score: [this.teams[0].score, this.teams[1].score],
      ...extra,
    });
  }

  // ------------------------------------------------------------- commands

  command(cmd: MatchCommand): { ok: boolean; message: string } {
    const t = this.teams[cmd.team];
    if (cmd.type === 'tactics') {
      this.commandQueue.push(cmd);
      return { ok: true, message: 'Instructions passed to the touchline.' };
    }
    const out = t.players.find((p) => p.id === cmd.outId);
    const inn = t.players.find((p) => p.id === cmd.inId);
    if (!out || !inn) return { ok: false, message: 'Player not found.' };
    if (!out.onPitch) return { ok: false, message: `${out.name} is not on the pitch.` };
    if (inn.used) return { ok: false, message: `${inn.name} has already played and cannot return.` };
    const queued = t.pendingSubs.length;
    if (t.subsUsed + queued >= MAX_SUBS) return { ok: false, message: `All ${MAX_SUBS} substitutions used.` };
    if (t.pendingSubs.some((s) => s.outId === out.id || s.inId === inn.id))
      return { ok: false, message: 'That change is already waiting.' };
    t.pendingSubs.push({ outId: out.id, inId: inn.id });
    return { ok: true, message: 'Substitution waits for the next stoppage.' };
  }

  pendingSubs(team: 0 | 1) {
    return this.teams[team].pendingSubs;
  }

  private applyCommands() {
    while (this.commandQueue.length) {
      const c = this.commandQueue.shift()!;
      if (c.type === 'tactics') {
        const t = this.teams[c.team];
        const formationChanged = c.tactics.formation !== t.tactics.formation;
        t.tactics = { ...c.tactics };
        if (formationChanged) this.reassignSlots(c.team);
        this.pushEvent('tactics', c.team, { detail: describeTactics(c.tactics) });
      }
    }
  }

  private reassignSlots(team: 0 | 1) {
    const t = this.teams[team];
    t.slots = FORMATIONS[t.tactics.formation];
    const active = t.players.filter((p) => p.onPitch);
    const free = new Set(t.slots.map((_, i) => i));
    // keep GK in GK slot; assign others greedily by natural position then proximity of old slot.
    const gkIdx = t.slots.findIndex((s) => s.pos === 'GK');
    const order = [...active].sort((a, b) => (a.slot?.pos === 'GK' ? -1 : b.slot?.pos === 'GK' ? 1 : 0));
    for (const p of order) {
      let best = -1;
      let bestScore = -1e9;
      for (const i of free) {
        const s = t.slots[i];
        if (p.slot?.pos === 'GK' && i !== gkIdx) continue;
        if (p.slot?.pos !== 'GK' && i === gkIdx) continue;
        const old = p.slot ?? s;
        const score = (s.pos === p.natPos ? 1 : 0) - Math.abs(s.u - old.u) * 2 - Math.abs(s.v - old.v) * 2;
        if (score > bestScore) (bestScore = score), (best = i);
      }
      if (best >= 0) {
        free.delete(best);
        p.slotIdx = best;
        p.slot = t.slots[best];
      }
    }
  }

  private applySubs() {
    for (const team of [0, 1] as const) {
      const t = this.teams[team];
      while (t.pendingSubs.length && t.subsUsed < MAX_SUBS) {
        const s = t.pendingSubs.shift()!;
        const out = t.players.find((p) => p.id === s.outId);
        const inn = t.players.find((p) => p.id === s.inId);
        if (!out || !inn || !out.onPitch || inn.used) continue;
        inn.onPitch = true;
        inn.used = true;
        inn.slot = out.slot;
        inn.slotIdx = out.slotIdx;
        inn.fam = inn.natPos === out.slot?.pos ? 1 : 0.85;
        // Enter from the touchline nearest the halfway line.
        inn.x = PITCH_L / 2;
        inn.y = -0.5;
        out.onPitch = false;
        out.slot = null;
        out.x = -100;
        out.y = -100;
        t.subsUsed++;
        this.dirtyPitch();
        this.stoppage[1] += 25;
        this.pushEvent('sub', team, { player: inn.id, other: out.id, detail: out.injured ? 'injury' : undefined });
        if (this.owner === out) this.owner = null;
      }
    }
  }

  // ------------------------------------------------------------- restarts

  private setupKickoff(team: 0 | 1) {
    this.bx = PITCH_L / 2;
    this.by = PITCH_W / 2;
    this.bz = 0;
    this.bvx = this.bvy = this.bvz = 0;
    this.owner = null;
    this.ballKind = 'none';
    this.shot = null;
    this.intended = null;
    for (const tm of [0, 1] as const) {
      for (const p of this.onPitch(tm)) {
        const u = Math.min(p.slot!.u * 0.9, 0.47);
        const [x, y] = this.fromUV(tm, u, p.slot!.v);
        // Players are set in their own half for every kickoff.
        p.x = x;
        p.y = y;
        p.vx = 0;
        p.vy = 0;
      }
    }
    this.restart = { type: 'kickoff', team, x: PITCH_L / 2, y: PITCH_W / 2, timer: 2.5, taker: null };
  }

  private startRestart(type: RestartType, team: 0 | 1, x: number, y: number) {
    this.owner = null;
    this.ballKind = 'none';
    this.shot = null;
    this.intended = null;
    this.bvx = this.bvy = this.bvz = 0;
    this.bz = 0;
    this.bx = clamp(x, 0, PITCH_L);
    this.by = clamp(y, 0, PITCH_W);
    const timers: Record<RestartType, number> = { kickoff: 2.5, throw: 1.8, goalkick: 3, corner: 5, freekick: 2.8, penalty: 4 };
    this.restart = { type, team, x: this.bx, y: this.by, timer: timers[type], taker: null };
    this.setPiece = null;
    this.applySubs();
    if (type === 'corner' || (type === 'freekick' && this.toU(team, this.bx) > 0.72 && !this.directFreeKick(this.restart))) {
      this.restart.timer = 6.5;
      this.planSetPiece(this.restart);
    }
  }

  /** Corner / wide free-kick routine: who attacks the ball, who marks, who stays back. */
  private planSetPiece(r: Restart) {
    const att = r.team;
    const def = (att === 0 ? 1 : 0) as 0 | 1;
    const gx = this.goalX(att);
    const d = this.dir(att);
    const sideY = (r.y < PITCH_W / 2 ? -1 : 1) as -1 | 1;
    const at = (dl: number, y: number): [number, number] => [gx - d * dl, clamp(y, 1, PITCH_W - 1)];
    const C = PITCH_W / 2;
    const roles: SetPiecePlan['roles'] = new Map();
    const taker = this.chooseTaker(r);
    r.taker = taker;

    const attackers = this.onPitch(att).filter((p) => p !== taker && p.slot!.pos !== 'GK').sort((a, b) => b.aerial - a.aerial || a.ent - b.ent);
    const runnerSpots: [number, number][] = [
      [12, C - 4.5],
      [12.5, C - 1],
      [11.5, C + 2.5],
      [13, C + 5.5],
      [8, C - sideY * 7.5],
    ];
    const runners = attackers.slice(0, 5);
    runners.forEach((p, i) => {
      const [x, y] = at(runnerSpots[i][0], runnerSpots[i][1]);
      roles.set(p, { kind: 'runner', x, y });
    });
    const edge = attackers.slice(5, 7);
    edge.forEach((p, i) => {
      const [x, y] = at(19 + i * 2, C + (i ? sideY * 9 : 0));
      roles.set(p, { kind: 'edge', x, y });
    });
    attackers.slice(7).forEach((p, i) => {
      const [x, y] = at(56 + i * 3, C + (i % 2 ? 12 : -12));
      roles.set(p, { kind: 'back', x, y });
    });
    const agk = this.gk(att);
    if (agk) {
      const [x, y] = at(70, C);
      roles.set(agk, { kind: 'back', x, y });
    }

    const defenders = this.onPitch(def).filter((p) => p.slot!.pos !== 'GK').sort((a, b) => b.aerial - a.aerial || a.ent - b.ent);
    let i = 0;
    // Man-markers on the four most dangerous runners.
    for (const runner of runners.slice(0, 4)) {
      const m = defenders[i++];
      if (!m) break;
      roles.set(m, { kind: 'marker', x: runner.x, y: runner.y, mark: runner });
    }
    // Zonal line across the six-yard box.
    for (const y of [C + sideY * 3, C, C - sideY * 3]) {
      const m = defenders[i++];
      if (!m) break;
      const [x, yy] = at(5.2, y);
      roles.set(m, { kind: 'zonal', x, y: yy });
    }
    const post = defenders[i++];
    if (post) {
      const [x, y] = at(0.8, C + sideY * 4.2);
      roles.set(post, { kind: 'post', x, y });
    }
    const edgeD = defenders[i++];
    if (edgeD) {
      const [x, y] = at(17, C);
      roles.set(edgeD, { kind: 'zonal', x, y });
    }
    defenders.slice(i).forEach((p, k) => {
      const [x, y] = at(38 + k * 4, C + (k % 2 ? 10 : -6));
      roles.set(p, { kind: 'outlet', x, y });
    });
    const dgk = this.gk(def);
    if (dgk) {
      const [x, y] = at(0.6, C + sideY * 1.2);
      roles.set(dgk, { kind: 'keeper', x, y });
    }
    this.setPiece = { team: att, sideY, roles, delivered: false, until: this.tick + 400 };
  }

  /** Taker delivers the set piece into a chosen zone; runners attack it. */
  private deliverSetPiece(p: MP) {
    const plan = this.setPiece!;
    const gx = this.goalX(p.team);
    const d = this.dir(p.team);
    const C = PITCH_W / 2;
    const sideY = plan.sideY;
    const zones: { name: string; dl: number; y: number }[] = [
      { name: 'near', dl: 5.5, y: C + sideY * 2.8 },
      { name: 'spot', dl: 10.5, y: C + this.rng.range(-2, 2) },
      { name: 'far', dl: 6.5, y: C - sideY * 4.5 },
    ];
    const zone = this.rng.weighted(zones, [0.36, 0.34, 0.3]);
    const skill = this.skill(p, 'passing');
    const err = 0.8 + (1 - skill) * 2.6;
    const lx = gx - d * (zone.dl + this.rng.gauss(0, err));
    const ly = zone.y + this.rng.gauss(0, err);
    const dd = dist(this.bx, this.by, lx, ly);
    const flight = clamp(0.95 + dd * 0.018, 1.05, 1.6);
    const l = loftedLaunch(dd, flight);
    this.bvx = ((lx - this.bx) / dd) * l.speed;
    this.bvy = ((ly - this.by) / dd) * l.speed;
    this.bvz = l.vz;
    this.bz = 0.1;
    // Runs: the best header attacks the chosen zone, the others fill the rest.
    const runners = [...plan.roles.entries()].filter(([, r]) => r.kind === 'runner').map(([q]) => q);
    const targets: [number, number][] = [
      [lx, ly],
      [gx - d * 5.5, C + sideY * 2.5],
      [gx - d * 6.5, C - sideY * 4],
      [gx - d * 10.5, C],
      [gx - d * 9, C - sideY * 8],
    ];
    runners.forEach((q, k) => {
      const t = targets[k] ?? targets[targets.length - 1];
      const role = plan.roles.get(q)!;
      role.x = clamp(t[0] + this.rng.gauss(0, 0.6), 1, PITCH_L - 1);
      role.y = clamp(t[1] + this.rng.gauss(0, 0.6), 1, PITCH_W - 1);
    });
    // The keeper comes for balls dropping into the six-yard box.
    const dgk = this.gk(p.team === 0 ? 1 : 0);
    if (dgk && zone.dl < 7 && this.rng.chance(0.35 + (dgk.attrs.handling / 20) * 0.35)) {
      const role = plan.roles.get(dgk);
      if (role) {
        role.x = lx;
        role.y = ly;
      }
    }
    plan.delivered = true;
    plan.until = this.tick + Math.round(flight / DT) + 12;
    p.passes++;
    this.stats.passes[p.team]++;
    this.passer = p;
    this.intended = runners[0] ?? null;
    this.release('cross', p);
    this.mustPass = null;
  }

  private chooseTaker(r: Restart): MP | null {
    const ps = this.onPitch(r.team);
    if (!ps.length) return null;
    if (r.type === 'goalkick') return this.gk(r.team) ?? ps[0];
    if (r.type === 'kickoff') {
      const fw = ps.filter((p) => p.slot!.pos === 'ST' || p.slot!.pos === 'AM');
      return (fw.length ? fw : ps).sort((a, b) => b.slot!.u - a.slot!.u)[0];
    }
    if (r.type === 'penalty' || r.type === 'corner' || (r.type === 'freekick' && this.directFreeKick(r))) {
      const key = r.type === 'corner' ? 'passing' : 'finishing';
      return ps
        .filter((p) => p.slot!.pos !== 'GK')
        .sort((a, b) => b.attrs[key] + b.attrs.composure * 0.5 - (a.attrs[key] + a.attrs.composure * 0.5))[0];
    }
    let best = ps[0];
    let bd = 1e9;
    for (const p of ps) {
      if (p.slot!.pos === 'GK' && r.type !== 'freekick') continue;
      const d = dist(p.x, p.y, r.x, r.y);
      if (d < bd) (bd = d), (best = p);
    }
    return best;
  }

  private directFreeKick(r: Restart) {
    const gx = this.goalX(r.team);
    return Math.abs(gx - r.x) < 30 && Math.abs(r.y - PITCH_W / 2) < 16;
  }

  private updateRestart() {
    const r = this.restart!;
    if (!r.taker || !r.taker.onPitch) r.taker = this.chooseTaker(r);
    if (r.type === 'corner' || this.setPiece) {
      // Corner taker stands just outside the arc.
      r.x = clamp(r.x, 0.3, PITCH_L - 0.3);
    }
    r.timer -= DT;
    const t = r.taker;
    if (!t) return;
    // Taker walks to the ball.
    const behind = r.type === 'kickoff' ? 0.6 : 0.8;
    const d = this.dir(r.team);
    const tx = r.x - d * behind;
    const ty = r.type === 'throw' ? r.y + (r.y < 1 ? -0.4 : 0.4) : r.y;
    if (r.timer > 0) {
      this.moveToward(t, tx, ty, r.timer < 1.2 ? 1 : 0.8);
      return;
    }
    if (dist(t.x, t.y, tx, ty) > 1.8 && r.timer > -4) {
      this.moveToward(t, tx, ty, 1);
      return;
    }
    t.x = tx;
    t.y = ty;
    t.vx = t.vy = 0;
    this.restart = null;
    this.giveBall(t);
    this.mustPass = r.type;
    this.decisionTimer = 0;
    if (r.type === 'kickoff') this.pushEvent('kickoff', r.team);
  }

  // ------------------------------------------------------------- main step

  step() {
    if (this.finished) return;
    this.applyCommands();
    this.tick++;
    this.clock += DT;

    if (this.celebrate > 0) {
      this.celebrate -= DT;
      this.celebrationMovement();
      if (this.celebrate <= 0) {
        this.applySubs();
        for (const tm of [0, 1] as const) for (const p of this.onPitch(tm)) p.x = Math.max(p.x, -50);
        this.setupKickoff(this.goalTeam === 0 ? 1 : 0);
      }
      this.recordFrame();
      this.checkTime();
      return;
    }

    if (this.restart) this.updateRestart();

    this.aiManagers();
    this.positionPlayers();
    if (!this.restart) {
      if (this.owner) this.updateCarrier();
      else this.updateFreeBall();
    }
    this.updateStats();
    this.recordFrame();
    this.checkTime();
  }

  private checkTime() {
    const end = this.half === 1 ? HALF_SECONDS + this.stoppage[0] : HALF_SECONDS * 2 + Math.min(this.stoppage[1], 420);
    if (this.clock < end) return;
    // Don't blow while a shot is in the air.
    if (this.ballKind === 'shot' && this.shot && !this.shot.resolved && this.clock < end + 8) return;
    for (const t of this.teams) for (const p of t.players) if (p.onPitch) p.minutes = p.minutes; // minutes accrue in updateStats
    if (this.half === 1) {
      this.pushEvent('halftime', -1);
      this.half = 2;
      this.clock = HALF_SECONDS;
      this.celebrate = 0;
      // Half-time recovery and AI tweaks.
      for (const t of this.teams) for (const p of t.players) if (p.onPitch) p.stamina = Math.min(1, p.stamina + 0.06);
      for (const tm of [0, 1] as const) for (const p of this.onPitch(tm)) p.x = -100;
      this.applySubs();
      for (const tm of [0, 1] as const)
        for (const p of this.onPitch(tm)) {
          const [x, y] = this.fromUV(tm, Math.min(p.slot!.u * 0.9, 0.47), p.slot!.v);
          p.x = x;
          p.y = y;
        }
      this.setupKickoff(1);
    } else {
      this.finished = true;
      this.pushEvent('fulltime', -1);
    }
  }

  private updateStats() {
    if (this.restart || this.celebrate > 0) return;
    this.possTicks[this.possTeam()]++;
    for (const t of this.teams) for (const p of t.players) if (p.onPitch) p.minutes += DT / 60;
  }

  // ---------------------------------------------------------- positioning

  private offCache: [number, number, number] = [-1, 0, 0];
  private offsideLineU(team: 0 | 1): number {
    // Second-last opponent depth expressed in `team`'s attacking space (cached per tick).
    if (this.offCache[0] !== this.tick) this.offCache = [this.tick, this.secondLast(0), this.secondLast(1)];
    const second = this.offCache[team + 1];
    const ballU = this.toU(team, this.bx);
    return Math.max(second, ballU, 0.5);
  }

  private secondLast(team: 0 | 1): number {
    let a = -1;
    let b = -1;
    for (const p of this.onPitch(team === 0 ? 1 : 0)) {
      const u = this.toU(team, p.x);
      if (u > a) (b = a), (a = u);
      else if (u > b) b = u;
    }
    return b < 0 ? 1 : b;
  }

  /** Predicted path of the ball as it is now (cached per tick). */
  private currentPath(): PathPoint[] {
    if (this.pathCache && this.pathCache.tick === this.tick) return this.pathCache.path;
    const path = predictPath({ x: this.bx, y: this.by, z: this.bz, vx: this.bvx, vy: this.bvy, vz: this.bvz }, DT, 4);
    if (!path.length) path.push({ x: this.bx, y: this.by, z: this.bz, t: DT, speed: 0 });
    this.pathCache = { tick: this.tick, path };
    return path;
  }

  /** Earliest point on the ball's path `p` can get to, and the time margin there. */
  private interceptFor(p: MP, path: PathPoint[], react: number): { x: number; y: number; margin: number; t: number } {
    const gk = p.slot!.pos === 'GK';
    let best: { x: number; y: number; margin: number; t: number } | null = null;
    for (const pt of path) {
      if (pt.z > (gk ? 2.6 : 2.2)) continue;
      const rt = this.reachTime(p, pt.x, pt.y, react);
      const margin = pt.t - rt;
      if (margin >= 0) return { x: pt.x, y: pt.y, margin, t: pt.t };
      if (!best || margin > best.margin) best = { x: pt.x, y: pt.y, margin, t: rt };
    }
    const last = path[path.length - 1];
    return best ?? { x: last.x, y: last.y, margin: -9, t: 9 };
  }

  private positionPlayers() {
    const poss = this.possTeam();
    const r = this.restart;
    const sp = this.setPiece && (r || this.tick <= this.setPiece.until) ? this.setPiece : null;
    if (this.setPiece && !sp) this.setPiece = null;

    // Who goes to meet a ball nobody has: real time-to-intercept for everyone.
    // Re-planned every 0.4s (or when the ball changes hands) to keep it cheap.
    const freeBall = !this.owner && !r && !(this.ballKind === 'shot' && this.shot && !this.shot.resolved);
    const key = freeBall ? `${this.ballKind}:${this.passer?.ent ?? -1}:${this.intended?.ent ?? -1}:${this.lastTouch ? this.lastTouch.team * 20 + this.lastTouch.ent : -1}` : '';
    const replan = freeBall && (this.tick % 2 === 0 || key !== this.chaseKey);
    let chasers = freeBall ? this.chaseCache : new Map<MP, [number, number]>();
    if (replan) {
      chasers = new Map();
      this.chaseKey = key;
      const path = this.currentPath();
      const passTeam = this.passer && (this.ballKind === 'pass' || this.ballKind === 'through' || this.ballKind === 'long' || this.ballKind === 'cross') ? this.passer.team : -1;
      for (const team of [0, 1] as const) {
        const cands: { p: MP; ic: { x: number; y: number; margin: number; t: number } }[] = [];
        for (const p of this.onPitch(team)) {
          if (p === this.noTouch && this.noTouchT > 0) continue;
          if (p.slot!.pos === 'GK' && !this.inOwnBox(p, path[Math.min(path.length - 1, 6)].x, path[Math.min(path.length - 1, 6)].y)) continue;
          if (dist(p.x, p.y, this.bx, this.by) > 34) continue;
          cands.push({ p, ic: this.interceptFor(p, path, team === passTeam ? 0.1 : this.reaction(p)) });
        }
        cands.sort((x, y) => x.ic.t - y.ic.t || x.p.ent - y.p.ent);
        if (team === passTeam) {
          // The receiver attacks the ball; nobody else crowds it.
          const m = this.intended && this.intended.onPitch ? this.intended : null;
          if (m) {
            const ic = cands.find((c) => c.p === m)?.ic ?? this.interceptFor(m, path, 0.1);
            chasers.set(m, [ic.x, ic.y]);
          }
        } else if (passTeam >= 0) {
          // Defenders who can genuinely get there first step into the lane; one
          // more closes down where the ball will be received.
          let n = 0;
          for (const c of cands) {
            if (c.ic.margin >= -0.1 && n < 2) {
              chasers.set(c.p, [c.ic.x, c.ic.y]);
              n++;
            }
          }
          if (n === 0 && cands[0]) {
            const m = this.intended;
            const tgt = m ? this.interceptFor(m, path, 0.1) : cands[0].ic;
            chasers.set(cands[0].p, [tgt.x, tgt.y]);
          }
        } else if (cands[0]) {
          chasers.set(cands[0].p, [cands[0].ic.x, cands[0].ic.y]);
          if (cands[1] && cands[1].ic.t < cands[0].ic.t + 0.8 && this.toU(team, this.bx) < 0.3) chasers.set(cands[1].p, [cands[1].ic.x, cands[1].ic.y]);
        }
      }
      this.chaseCache = chasers;
    }

    // Offside timing: each attacker's personal error drifts over time.
    if (this.tick % 15 === 0) {
      for (const team of [0, 1] as const)
        for (const p of this.onPitch(team)) p.holdOffside = clamp(this.rng.gauss(-0.1, 0.6 + (1 - p.attrs.positioning / 20) * 1.4), -2.5, 2.5);
    }

    for (const team of [0, 1] as const) {
      const t = this.teams[team];
      const tac = t.tactics;
      const mf = (tac.mentality - 2) / 2;
      const lineF = (tac.line - 2) / 2;
      const widthF = (tac.width - 2) / 2;
      const ballU = this.toU(team, this.bx);
      const ballV = this.toV(team, this.by);
      const loose = !this.owner && !r && (this.ballKind === 'loose' || this.ballKind === 'clear' || this.ballKind === 'shot');
      const attacking = poss === team && !loose;
      const offLine = attacking ? this.offsideLineU(team) : 1;
      const players = this.onPitch(team);
      const carrier = this.owner && this.owner.team === team ? this.owner : null;

      // Pressing the carrier.
      const pressers = new Set<MP>();
      const keeperHolding = this.owner && this.owner.slot?.pos === 'GK' && this.gkHold > 0;
      if (!attacking && !r && this.owner && !keeperHolding) {
        let n0: MP | null = null;
        let n1: MP | null = null;
        let d0 = 1e9;
        let d1 = 1e9;
        for (const q of players) {
          if (q.slot!.pos === 'GK') continue;
          const dq = dist(q.x, q.y, this.bx, this.by);
          if (dq < d0) (n1 = n0), (d1 = d0), (n0 = q), (d0 = dq);
          else if (dq < d1) (n1 = q), (d1 = dq);
        }
        const trigger = 9 + tac.pressing * 6 + (ballU < 0.33 ? 8 : 0);
        if (n0 && d0 < trigger) pressers.add(n0);
        if (n1 && ((tac.pressing >= 3 && ballU > 0.5) || tac.pressing === 4 || ballU < 0.3) && d1 < trigger + 4) pressers.add(n1);
      }

      for (const p of players) {
        p.chase = false;
        if (this.owner === p) continue;
        if (r && r.taker === p) continue;
        const ch = chasers.get(p);
        if (ch) {
          p.chase = true;
          p.tx = ch[0];
          p.ty = ch[1];
          this.moveToward(p, ch[0], ch[1], 1);
          continue;
        }
        if (pressers.has(p)) {
          // Close down goal-side, slightly showing the carrier outside.
          const o = this.owner!;
          const ownGx = this.goalX(team === 0 ? 1 : 0);
          const gd = Math.max(1, dist(o.x, o.y, ownGx, PITCH_W / 2));
          const stand = 1.1;
          const px = o.x + ((ownGx - o.x) / gd) * stand;
          const py = o.y + ((PITCH_W / 2 - o.y) / gd) * stand;
          this.moveToward(p, px, py, 0.9 + 0.1 * (p.attrs.workRate / 20));
          p.tx = px;
          p.ty = py;
          continue;
        }

        const s = p.slot!;
        let tx: number;
        let ty: number;
        const role = sp?.roles.get(p);
        if (role) {
          // Set-piece routine positions (markers follow their man, goal-side).
          tx = role.x;
          ty = role.y;
          if (role.kind === 'marker' && role.mark && role.mark.onPitch) {
            const ownGx = this.goalX(team === 0 ? 1 : 0);
            tx = role.mark.x + Math.sign(ownGx - role.mark.x) * 0.9;
            ty = role.mark.y + (PITCH_W / 2 - role.mark.y) * 0.08;
          }
          const urg = sp!.delivered ? 1 : dist(p.x, p.y, tx, ty) > 3 ? 0.95 : 0.4;
          this.moveToward(p, tx, ty, urg);
          p.tx = tx;
          p.ty = ty;
          continue;
        }

        let u: number;
        let v: number;
        if (s.pos === 'GK') {
          // Narrow the angle: stand on the line from goal centre to the ball.
          const ownGx = this.goalX(team === 0 ? 1 : 0);
          const dB = Math.max(1, dist(ownGx, PITCH_W / 2, this.bx, this.by));
          const off = attacking ? clamp(dB * 0.2, 1, 14) : clamp(dB * 0.16, 0.6, 5.5);
          const gx = ownGx + ((this.bx - ownGx) / dB) * off;
          const gy = PITCH_W / 2 + ((this.by - PITCH_W / 2) / dB) * Math.min(off, 3.2);
          u = this.toU(team, gx);
          v = this.toV(team, gy);
        } else if (attacking) {
          const defender = s.u < 0.25;
          const shift = (ballU - 0.35) * (defender ? 0.42 : 0.58) + 0.08 + 0.05 * mf;
          u = s.u * (1.05 + 0.12 * mf) + shift;
          if (defender) u = Math.min(u, 0.46 + 0.06 * mf + 0.04 * lineF, ballU - 0.16);
          v = 0.5 + (s.v - 0.5) * (1.12 + 0.28 * widthF) + (ballV - 0.5) * 0.14;
        } else {
          const defender = s.u < 0.25;
          const shift = (ballU - 0.5) * 0.5 + 0.05 * lineF - 0.02 - 0.03 * (mf < 0 ? -mf : 0);
          u = s.u * 0.86 + shift + 0.03;
          // Compact block: squeeze towards the ball side.
          v = 0.5 + (s.v - 0.5) * 0.68 + (ballV - 0.5) * 0.4;
          if (defender) {
            u = Math.max(u, 0.06 + 0.05 * lineF);
            u = Math.min(u, ballU - 0.03);
            // Ball near goal: the back line narrows to protect the box.
            if (ballU < 0.3) v = 0.5 + (v - 0.5) * 0.75;
          } else {
            u = Math.min(u, ballU + 0.03);
            if (ballU < 0.25) u = Math.min(u, 0.2);
          }
        }
        if (r) [u, v] = this.restartShape(team, p, s, u, v, r);
        u = clamp(u, 0.006, 0.985);
        v = clamp(v, 0.05, 0.95);
        [tx, ty] = this.fromUV(team, u, v);

        if (attacking && s.pos !== 'GK' && !r) {
          // Support play: near the ball, move into space that offers a pass.
          if (carrier && dist(tx, ty, carrier.x, carrier.y) < 32) {
            p.supT -= DT;
            if (p.supT <= 0) {
              p.supT = 1.2 + (p.ent % 4) * 0.12;
              const [ox, oy] = this.supportOffset(p, tx, ty, carrier, offLine);
              p.supX = ox;
              p.supY = oy;
            }
            tx += p.supX;
            ty += p.supY;
          } else {
            p.supX *= 0.95;
            p.supY *= 0.95;
          }
          const fwdRole = s.pos === 'ST' || s.pos === 'LW' || s.pos === 'RW' || s.pos === 'AM';
          // Runs in behind: set off from the line when the carrier has time to look up.
          p.runCd -= DT;
          if (fwdRole && carrier && p.run <= 0 && p.runCd <= 0 && this.toU(team, carrier.x) > 0.32 && offLine < 0.9) {
            let pressed = false;
            for (const o of this.onPitch(team === 0 ? 1 : 0)) if (dist(o.x, o.y, carrier.x, carrier.y) < 3) pressed = true;
            if (!pressed && this.rng.chance(0.025 + (p.attrs.workRate / 20) * 0.02)) {
              p.run = 2 + this.rng.range(0, 1);
              p.runCd = 6 + this.rng.range(0, 6);
              // A carrier with vision looks up for the run.
              if (this.decisionTimer > 0.6 && this.rng.chance(0.1 + (carrier.attrs.decisions / 20) * 0.3)) this.decisionTimer = 0.3 + this.rng.range(0, 0.5);
            }
          }
          if (p.run > 0) {
            // Curved run along the line, timed to stay onside until the pass.
            p.run -= DT;
            const [rx] = this.fromUV(team, Math.min(0.95, offLine - 0.004 + p.holdOffside / PITCH_L), 0);
            tx = rx;
            ty = clamp(p.y + (PITCH_W / 2 - p.y) * 0.3 + (p.y < PITCH_W / 2 ? 2 : -2), 3, PITCH_W - 3);
            p.tx = tx;
            p.ty = ty;
            this.moveToward(p, tx, ty, 1);
            continue;
          }
          // Otherwise forwards hold the line (with personal timing error).
          const lim = offLine - 0.005 + p.holdOffside / PITCH_L;
          const uu = this.toU(team, tx);
          if (uu > lim) [tx] = this.fromUV(team, lim, 0);
          if (fwdRole) {
            const floor = Math.min(lim, ballU + 0.04);
            if (this.toU(team, tx) < floor) [tx] = this.fromUV(team, floor, 0);
          }
        }

        // Marking: tighten onto nearby attackers, goal-side.
        if (!attacking && s.pos !== 'GK' && !r) {
          const oppTeam = team === 0 ? 1 : 0;
          let near: MP | null = null;
          let nd = 9;
          for (const o of this.onPitch(oppTeam)) {
            if (o === this.owner) continue;
            const d = dist(o.x, o.y, tx, ty);
            if (d < nd) (nd = d), (near = o);
          }
          if (near) {
            const ownGoalX = this.goalX(oppTeam);
            const deep = this.toU(team, near.x) < 0.3;
            const w = (deep ? 0.75 : 0.55) * (p.attrs.positioning / 20) * (1 - nd / 9) + 0.15;
            const gd = Math.max(1, dist(near.x, near.y, ownGoalX, PITCH_W / 2));
            const mx = near.x + ((ownGoalX - near.x) / gd) * 1.2;
            const my = near.y + ((PITCH_W / 2 - near.y) / gd) * 1.2;
            tx = tx + (mx - tx) * w;
            ty = ty + (my - ty) * w;
          }
        }
        tx = clamp(tx, 0.5, PITCH_L - 0.5);
        ty = clamp(ty, 0.5, PITCH_W - 0.5);
        // Smooth the target so players drift rather than twitch.
        if (p.tx < -500) {
          p.tx = tx;
          p.ty = ty;
        } else {
          const k = r ? 0.5 : 0.28;
          p.tx += (tx - p.tx) * k;
          p.ty += (ty - p.ty) * k;
        }
        const dd = dist(p.x, p.y, p.tx, p.ty);
        let urgency = dd > 12 ? 0.92 : dd > 4 ? 0.7 : 0.45;
        if (!attacking && dd > 4 && this.toU(team, p.x) > ballU) urgency = 1;
        this.moveToward(p, p.tx, p.ty, urgency);
      }
    }
  }

  /** Pick a nearby spot that is open and has a clear passing lane from the carrier. */
  private supportOffset(p: MP, fx: number, fy: number, carrier: MP, offLine: number): [number, number] {
    const opp = this.onPitch(p.team === 0 ? 1 : 0);
    const mates = this.onPitch(p.team);
    const fwd = this.dir(p.team);
    let best: [number, number] = [0, 0];
    let bestScore = -1e9;
    const dirs = 8;
    for (const rad of [0, 6]) {
      for (let k = 0; k < (rad === 0 ? 1 : dirs); k++) {
        const a = (k / dirs) * Math.PI * 2 + (p.ent % 2) * 0.39;
        const x = clamp(fx + Math.cos(a) * rad, 2, PITCH_L - 2);
        const y = clamp(fy + Math.sin(a) * rad, 2, PITCH_W - 2);
        if (this.toU(p.team, x) > offLine - 0.005) continue;
        let open = 8;
        let lane = 6;
        for (const o of opp) {
          open = Math.min(open, dist(o.x, o.y, x, y));
          const [dl, tt] = segDist(o.x, o.y, carrier.x, carrier.y, x, y);
          if (tt > 0.05 && tt < 0.95) lane = Math.min(lane, dl);
        }
        let crowd = 0;
        for (const m of mates) if (m !== p && dist(m.x, m.y, x, y) < 6) crowd++;
        const dc = dist(carrier.x, carrier.y, x, y);
        const score = open * 0.55 + lane * 0.75 + (x - carrier.x) * fwd * 0.05 - rad * 0.09 - crowd * 1.4 - (dc < 7 ? 2.5 : 0) - (dc > 30 ? 1.5 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = [x - fx, y - fy];
        }
      }
    }
    return best;
  }

  private restartShape(team: 0 | 1, p: MP, s: Slot, u: number, v: number, r: Restart): [number, number] {
    const attackingSide = r.team === team;
    if (r.type === 'kickoff') {
      return [Math.min(s.u * 0.9, 0.47), s.v];
    }
    if (r.type === 'corner' && !this.setPiece) {
      if (s.pos === 'GK') return [attackingSide ? 0.4 : 0.01, 0.5];
      const tall = p.attrs.heading + p.attrs.strength;
      if (attackingSide) {
        if (s.u > 0.15 || tall > 26) {
          // Into the box at staggered spots.
          const k = (p.ent * 7) % 5;
          return [0.9 + (k % 3) * 0.025, 0.36 + k * 0.07];
        }
        return [0.6, s.v];
      }
      // Defending: everyone back, zonal across the six-yard and penalty box.
      const k = (p.ent * 5) % 6;
      if (s.pos === 'ST' && p.ent % 2 === 0) return [0.3, s.v];
      return [0.03 + (k % 3) * 0.035, 0.33 + k * 0.065];
    }
    if (r.type === 'penalty') {
      if (s.pos === 'GK') return [attackingSide ? 0.3 : 0.003, 0.5];
      return attackingSide ? [0.8, 0.25 + (p.ent % 6) * 0.1] : [0.19, 0.25 + (p.ent % 6) * 0.1];
    }
    if (r.type === 'goalkick' && !attackingSide) {
      return [Math.min(u, 0.62), v];
    }
    return [u, v];
  }

  private moveToward(p: MP, tx: number, ty: number, urgency: number) {
    const dx = tx - p.x;
    const dy = ty - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const top = (5.6 + p.attrs.pace * 0.15) * this.fatigue(p);
    let speed = top * urgency;
    if (d < 3) speed = Math.min(speed, d * 1.4);
    const dvx = d > 0.01 ? (dx / d) * speed : 0;
    const dvy = d > 0.01 ? (dy / d) * speed : 0;
    // Acceleration limited as a vector so turns and starts look like running.
    const acc = (3.6 + p.attrs.pace * 0.13) * DT;
    let ax = dvx - p.vx;
    let ay = dvy - p.vy;
    const am = Math.hypot(ax, ay);
    if (am > acc) {
      ax = (ax / am) * acc;
      ay = (ay / am) * acc;
    }
    p.vx += ax;
    p.vy += ay;
    p.x += p.vx * DT;
    p.y += p.vy * DT;
    if (p.slot?.pos === 'GK') {
      p.x = clamp(p.x, 0.3, PITCH_L - 0.3);
      p.y = clamp(p.y, 0.5, PITCH_W - 0.5);
    } else {
      p.x = clamp(p.x, -3, PITCH_L + 3);
      p.y = clamp(p.y, -3, PITCH_W + 3);
    }
    const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    const drain = (0.0016 + 0.00062 * sp * sp * 0.25) * (1.55 - (p.attrs.stamina / 20) * 0.75) * DT * 0.02;
    p.stamina = Math.max(0.2, p.stamina - drain);
  }

  private celebrationMovement() {
    const scorer = this.events.filter((e) => e.type === 'goal').at(-1);
    const sp = scorer ? this.teams[this.goalTeam].players.find((p) => p.id === scorer.player) : undefined;
    for (const team of [0, 1] as const) {
      for (const p of this.onPitch(team)) {
        if (team === this.goalTeam && sp) {
          if (p === sp) {
            const cx = this.dir(team) > 0 ? PITCH_L - 6 : 6;
            const cy = sp.y < PITCH_W / 2 ? 2 : PITCH_W - 2;
            this.moveToward(p, cx, cy, 0.8);
          } else if (p.slot!.pos !== 'GK') {
            this.moveToward(p, sp.x - this.dir(team) * 2, sp.y + ((p.ent % 3) - 1) * 1.5, 0.75);
          } else this.moveToward(p, p.x, p.y, 0.2);
        } else {
          const [x, y] = this.fromUV(team, Math.min(p.slot!.u * 0.9, 0.47), p.slot!.v);
          this.moveToward(p, x, y, 0.4);
        }
      }
    }
  }

  // ----------------------------------------------------- ball ownership

  private giveBall(p: MP) {
    if (this.owner !== p) p.touches++;
    const prevTeam = this.lastTouch?.team;
    if (this.passer && this.passer.team === p.team && this.passer !== p) this.assistCandidate = this.passer;
    else if (prevTeam !== p.team) this.assistCandidate = null;
    this.owner = p;
    this.lastTouch = p;
    this.ballKind = 'none';
    this.intended = null;
    this.passer = null;
    this.shot = null;
    this.bvx = this.bvy = this.bvz = 0;
    this.bz = 0;
    this.mustPass = null;
    this.gkHold = 0;
    this.protect = 0.9;
    const tempo = this.teams[p.team].tactics.tempo;
    this.decisionTimer = (1.55 + (1 - p.attrs.decisions / 20) * 0.5) * (1.35 - tempo * 0.12) + this.rng.range(0, 0.9);
    const d = this.dir(p.team);
    this.carryDir = [d, 0];
    if (p.slot?.pos === 'GK') this.decisionTimer = Math.min(this.decisionTimer, 0.7);
  }

  private release(kind: BallKind, from: MP) {
    this.noTouch = from;
    this.noTouchT = 0.6;
    this.owner = null;
    this.ballKind = kind;
    this.lastTouch = from;
  }

  // -------------------------------------------------------- the carrier

  private updateCarrier() {
    const p = this.owner!;
    const team = p.team;
    const isGK = p.slot!.pos === 'GK';
    this.decisionTimer -= DT;

    // Goalkeeper holding the ball: wait then distribute.
    if (isGK && this.inOwnBox(p, p.x, p.y) && this.gkHold > 0) {
      this.gkHold -= DT;
      this.moveToward(p, p.x, p.y, 0.1);
      this.placeBallAt(p);
      if (this.gkHold > 0) return;
      this.mustPass = 'goalkick';
      this.decisionTimer = 0;
    }

    // Opponent challenges (not in the first moment after gaining control).
    this.protect -= DT;
    if (!this.mustPass && this.gkHold <= 0 && this.protect <= 0) {
      const opp = this.onPitch(team === 0 ? 1 : 0);
      const keeper = this.gk(team === 0 ? 1 : 0);
      if (keeper && this.inOwnBox(keeper, p.x, p.y) && dist(keeper.x, keeper.y, p.x, p.y) < 2.2 && this.rng.chance(0.25 + keeper.attrs.handling * 0.015)) {
        keeper.saves++;
        this.giveBall(keeper);
        this.gkHold = 1.5;
        return;
      }
      for (const o of opp) {
        if (o.tackleCd > 0) {
          o.tackleCd -= DT;
          continue;
        }
        const d = dist(o.x, o.y, p.x, p.y);
        if (d > 1.7) continue;
        const press = this.teams[o.team].tactics.pressing;
        // A defender squared up in front of the carrier gets a cleaner go at it.
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const inFront = ((o.x - p.x) * p.vx + (o.y - p.y) * p.vy) / sp > 0.3;
        const deep = this.toU(o.team, p.x) < 0.33;
        const keeperSafe = isGK && this.inOwnBox(p, p.x, p.y) ? 0.08 : 1;
        const attempt = ((inFront ? 0.24 : 0.08) * (deep ? 1.8 : 1) + press * 0.02 * (0.6 + 0.4 * (o.attrs.workRate / 20))) * keeperSafe;
        if (!this.rng.chance(attempt)) continue;
        o.tackleCd = 1.8;
        this.resolveTackle(o, p);
        return;
      }
      // Under pressure the carrier looks for an early release.
      if (this.decisionTimer > 0.25) {
        for (const o of opp) {
          if (dist(o.x, o.y, p.x, p.y) < 2.4) {
            this.decisionTimer = Math.min(this.decisionTimer, 0.2 + (1 - p.attrs.composure / 20) * 0.2);
            break;
          }
        }
      }
    }

    if (this.decisionTimer <= 0) {
      this.decide(p);
      if (this.owner !== p) return;
    }

    // Carry the ball.
    const [dx, dy] = this.carryDir;
    let tx = p.x + dx * 6;
    let ty = p.y + dy * 6;
    tx = clamp(tx, 1.5, PITCH_L - 1.5);
    ty = clamp(ty, 1.5, PITCH_W - 1.5);
    let urgency = 0.78 * (0.85 + 0.15 * (p.attrs.dribbling / 20));
    for (const o of this.onPitch(team === 0 ? 1 : 0)) {
      const ox = o.x - p.x;
      const oy = o.y - p.y;
      const along = ox * dx + oy * dy;
      if (along > 0 && along < 2.5 && Math.abs(ox * dy - oy * dx) < 1.3) {
        urgency *= 0.45;
        // Try to go round them next decision.
        this.decisionTimer = Math.min(this.decisionTimer, 0.4);
        break;
      }
    }
    this.moveToward(p, tx, ty, urgency);
    this.placeBallAt(p);
  }

  private placeBallAt(p: MP) {
    const sp = Math.hypot(p.vx, p.vy);
    const lead = sp > 0.5 ? 0.55 : 0.35;
    const nx = sp > 0.3 ? p.vx / sp : this.carryDir[0];
    const ny = sp > 0.3 ? p.vy / sp : this.carryDir[1];
    this.bx = clamp(p.x + nx * lead, 0.1, PITCH_L - 0.1);
    this.by = clamp(p.y + ny * lead, 0.1, PITCH_W - 0.1);
    this.bz = 0;
  }

  private inOwnBox(p: MP, x: number, y: number) {
    const own = this.goalX(p.team === 0 ? 1 : 0);
    return Math.abs(x - own) < BOX_DEPTH && Math.abs(y - PITCH_W / 2) < BOX_HALF;
  }

  private resolveTackle(def: MP, car: MP) {
    const tk = this.skill(def, 'tackling') * 0.7 + this.skill(def, 'strength') * 0.15 + this.skill(def, 'positioning') * 0.15;
    const dr = this.skill(car, 'dribbling') * 0.75 + this.skill(car, 'strength') * 0.1 + this.skill(car, 'composure') * 0.15;
    const deep = this.toU(def.team, car.x) < 0.33;
    const pWin = clamp(0.46 + (deep ? 0.08 : 0) + (tk - dr) * 0.9, 0.12, 0.85);
    const press = this.teams[def.team].tactics.pressing;
    const boxCare = this.inOwnBox(def, car.x, car.y) ? 0.3 : 1;
    const pFoul = clamp(0.018 + (1 - def.attrs.tackling / 20) * 0.018 + press * 0.004, 0.01, 0.06) * boxCare;
    const r = this.rng.next();
    if (r < pFoul) {
      this.foul(def, car);
      return;
    }
    if (r < pFoul + pWin) {
      def.tackles++;
      // Small chance the tackled player picks up a knock.
      if (this.rng.chance(0.004)) this.injure(car);
      if (this.rng.chance(0.8)) {
        this.giveBall(def);
        this.decisionTimer = Math.min(this.decisionTimer, 0.4);
      } else {
        // Ball squirts loose.
        this.release('loose', def);
        const a = this.rng.range(0, Math.PI * 2);
        const s = this.rng.range(3, 7);
        this.bvx = Math.cos(a) * s;
        this.bvy = Math.sin(a) * s;
        this.passer = null;
      }
    } else {
      // Beaten: carrier drives past; defender briefly off balance.
      def.vx *= 0.2;
      def.vy *= 0.2;
      def.tackleCd = 2.6;
      this.decisionTimer = Math.max(this.decisionTimer, 0.3);
    }
  }

  private foul(def: MP, victim: MP) {
    def.fouls++;
    this.stats.fouls[def.team]++;
    const inBox = this.inOwnBox(def, victim.x, victim.y);
    this.pushEvent('foul', def.team, { player: def.id, other: victim.id });
    // Cards
    const late = this.rng.next();
    const cardP = (0.13 + (1 - def.attrs.tackling / 20) * 0.08 + (inBox ? 0.1 : 0)) * (def.yellow ? 0.35 : 1);
    if (late < 0.004) this.sendOff(def, 'Straight red');
    else if (late < cardP) {
      if (def.yellow) this.sendOff(def, 'Second yellow');
      else {
        def.yellow = true;
        this.stats.yellows[def.team]++;
        this.pushEvent('yellow', def.team, { player: def.id });
        this.stoppage[1] += 15;
      }
    }
    if (this.rng.chance(0.005)) this.injure(victim);
    const victimTeam = victim.team;
    if (inBox) {
      const gx = this.goalX(victimTeam);
      this.pushEvent('penalty', victimTeam, { player: victim.id });
      this.startRestart('penalty', victimTeam, gx - this.dir(victimTeam) * 11, PITCH_W / 2);
    } else {
      this.startRestart('freekick', victimTeam, victim.x, victim.y);
    }
  }

  private sendOff(p: MP, detail: string) {
    p.sentOff = true;
    this.stats.reds[p.team]++;
    this.pushEvent('red', p.team, { player: p.id, detail });
    p.onPitch = false;
    p.slot = null;
    p.x = p.y = -100;
    this.dirtyPitch();
    if (this.owner === p) this.owner = null;
    this.stoppage[1] += 30;
    const t = this.teams[p.team];
    t.pendingSubs = t.pendingSubs.filter((s) => s.outId !== p.id);
    // Keep a goalkeeper: if the keeper is sent off, the assistant swaps one in when possible.
    if (detail && !this.gk(p.team)) {
      const spare = t.players.find((q) => !q.used && q.natPos === 'GK');
      const outfield = this.onPitch(p.team).filter((q) => q.slot!.pos !== 'GK').sort((a, b) => b.slot!.u - a.slot!.u)[0];
      if (spare && outfield && t.subsUsed + t.pendingSubs.length < MAX_SUBS) {
        // The outfield player moves into the keeper's slot for now; swap at the stoppage.
        const gkSlotIdx = t.slots.findIndex((s) => s.pos === 'GK');
        outfield.slot = t.slots[gkSlotIdx];
        outfield.slotIdx = gkSlotIdx;
        t.pendingSubs.push({ outId: outfield.id, inId: spare.id });
      } else if (outfield) {
        const gkSlotIdx = t.slots.findIndex((s) => s.pos === 'GK');
        outfield.slot = t.slots[gkSlotIdx];
        outfield.slotIdx = gkSlotIdx;
      }
    }
  }

  private injure(p: MP) {
    if (p.injured) return;
    p.injured = true;
    this.pushEvent('injury', p.team, { player: p.id });
    const t = this.teams[p.team];
    // Assistant policy: replace like-for-like at the next stoppage if a change is available.
    if (t.subsUsed + t.pendingSubs.length < MAX_SUBS) {
      const sub = this.bestBench(p.team, p.slot?.pos ?? p.natPos);
      if (sub) t.pendingSubs.push({ outId: p.id, inId: sub.id });
    }
    p.stamina = Math.min(p.stamina, 0.45);
  }

  private bestBench(team: 0 | 1, pos: Position): MP | undefined {
    const t = this.teams[team];
    const pending = new Set(t.pendingSubs.map((s) => s.inId));
    const avail = t.players.filter((q) => !q.used && !pending.has(q.id) && (pos === 'GK' ? q.natPos === 'GK' : q.natPos !== 'GK'));
    const group = (x: Position) => (x === 'GK' ? 0 : ['CB', 'LB', 'RB'].includes(x) ? 1 : ['DM', 'CM', 'AM'].includes(x) ? 2 : 3);
    return avail.sort((a, b) => {
      const ga = (a.natPos === pos ? 2 : group(a.natPos) === group(pos) ? 1 : 0) * 10 + avgAttr(a.attrs);
      const gb = (b.natPos === pos ? 2 : group(b.natPos) === group(pos) ? 1 : 0) * 10 + avgAttr(b.attrs);
      return gb - ga;
    })[0];
  }

  // ------------------------------------------------------------ decisions

  /** Rough "chance of scoring soon" from a location, for team attacking. */
  private threat(team: 0 | 1, x: number, y: number): number {
    const gx = this.goalX(team);
    const u = this.toU(team, x);
    return Math.max(locationXg(Math.abs(gx - x), y - PITCH_W / 2) * 0.75, 0.004 + 0.05 * u * u * u);
  }

  private decide(p: MP) {
    const team = p.team;
    const opp = this.onPitch(team === 0 ? 1 : 0);
    const mates = this.onPitch(team).filter((m) => m !== p);
    const tac = this.teams[team].tactics;
    const gx = this.goalX(team);
    const u = this.toU(team, p.x);
    const noise = 0.0015 + (1 - p.attrs.decisions / 20) * 0.006;
    const lossCost = (0.012 + 0.09 * Math.pow(1 - u, 3)) * (1.25 - tac.mentality * 0.1);
    const nearestOpp = Math.min(...opp.map((o) => dist(o.x, o.y, p.x, p.y)), 99);
    const restart = this.mustPass;

    if (this.setPiece && !this.setPiece.delivered && (restart === 'corner' || restart === 'freekick') && this.setPiece.team === team) {
      // Most corners are crossed; a few are worked short to the edge of the box.
      const edge = [...this.setPiece.roles.entries()].find(([, r]) => r.kind === 'edge')?.[0];
      if (restart === 'corner' && edge && this.rng.chance(0.12)) {
        this.setPiece = null;
        this.makePass(p, edge, edge.x, edge.y, false, false, false);
      } else this.deliverSetPiece(p);
      return;
    }

    type Option = { kind: 'shoot' | 'pass' | 'dribble' | 'clear' | 'cross'; util: number; target?: MP; tx?: number; ty?: number; p?: number; lofted?: boolean; through?: boolean };
    const options: Option[] = [];

    // Shoot
    const distGoal = dist(p.x, p.y, gx, PITCH_W / 2);
    const canShoot = restart === null || restart === 'penalty' || (restart === 'freekick' && distGoal < 30);
    if (canShoot && distGoal < 32 && p.slot!.pos !== 'GK') {
      const xg = this.shotXg(p);
      const bias = 1 + (tac.mentality - 2) * 0.12 + (p.attrs.finishing - 12) * 0.03;
      const longShot = distGoal > 25 ? 0.8 : 1.25;
      // Shooting usually surrenders the ball, so it must clear a cost.
      const cost = 0.062 - (tac.mentality - 2) * 0.006;
      options.push({ kind: 'shoot', util: xg * bias * longShot - cost + (restart === 'penalty' ? 10 : 0) });
    }

    // Passes
    if (restart !== 'penalty') {
      for (const m of mates) {
        const opt = this.evalPass(p, m, opp, lossCost, tac);
        if (opt) options.push(opt);
      }
    }

    // Dribble / carry
    if (!restart && p.slot!.pos !== 'GK') {
      const goalDir = Math.atan2(PITCH_W / 2 - p.y, gx - p.x);
      for (const off of [-0.7, 0, 0.7]) {
        const a = goalDir + off * (u < 0.7 ? 0.6 : 1);
        const tx = clamp(p.x + Math.cos(a) * 7, 1, PITCH_L - 1);
        const ty = clamp(p.y + Math.sin(a) * 7, 1, PITCH_W - 1);
        let block = 99;
        for (const o of opp) {
          const [d, t] = segDist(o.x, o.y, p.x, p.y, tx, ty);
          if (t > 0.05) block = Math.min(block, d + t * 2);
        }
        const dr = p.attrs.dribbling / 20;
        // Space shrinks near goal: count defenders who can close the end point in time.
        let closers = 0;
        for (const o of opp) if (dist(o.x, o.y, tx, ty) < 7.5) closers++;
        const inBox = Math.abs(gx - tx) < BOX_DEPTH && Math.abs(ty - PITCH_W / 2) < BOX_HALF;
        const pSafe = clamp(0.35 + (block - 1.5) * 0.14 + (dr - 0.5) * 0.4 - closers * (inBox ? 0.12 : 0.025), 0.05, 0.95);
        const util = pSafe * (this.threat(team, tx, ty) * (0.5 + dr * 0.15) + 0.004) - (1 - pSafe) * lossCost;
        options.push({ kind: 'dribble', util, tx, ty, p: pSafe });
      }
    }

    // Cross from wide areas into a zone, judged on who is in the box.
    if (!restart && p.slot!.pos !== 'GK' && u > 0.7 && Math.abs(p.y - PITCH_W / 2) > 13) {
      const opt = this.evalCross(p, mates, opp);
      if (opt) options.push(opt);
    }

    // Clearance under pressure deep in own half
    if (u < 0.25 && nearestOpp < 2.5 && !restart) {
      options.push({ kind: 'clear', util: (0.25 - u) * 0.03 - 0.002 });
    }
    if (p.slot!.pos === 'GK' && nearestOpp < 6) {
      options.push({ kind: 'clear', util: 0.012 - nearestOpp * 0.0015 });
    }

    if (!options.length) {
      this.decisionTimer = 0.4;
      return;
    }
    let best = options[0];
    let bestU = -1e9;
    for (const o of options) {
      const util = o.util + this.rng.gauss(0, noise);
      if (util > bestU) (bestU = util), (best = o);
    }
    if (best.kind === 'cross' && !best.target) {
      this.crossInto(p, best.tx!, best.ty!);
      return;
    }
    if (best.kind === 'shoot') this.takeShot(p, restart === 'penalty');
    else if (best.kind === 'pass' || best.kind === 'cross') this.makePass(p, best.target!, best.tx!, best.ty!, !!best.lofted, best.kind === 'cross', !!best.through);
    else if (best.kind === 'clear') this.clearBall(p);
    else {
      const d = Math.hypot(best.tx! - p.x, best.ty! - p.y) || 1;
      this.carryDir = [(best.tx! - p.x) / d, (best.ty! - p.y) / d];
      this.decisionTimer = (0.8 + this.rng.range(0, 0.6)) * (1.3 - tac.tempo * 0.1);
    }
  }

  /** A cross aimed at a zone (near post, penalty spot, far post) rather than a player. */
  private evalCross(p: MP, mates: MP[], opp: MP[]) {
    const team = p.team;
    const gx = this.goalX(team);
    const d = this.dir(team);
    const C = PITCH_W / 2;
    const side = p.y < C ? -1 : 1;
    const zones: [number, number][] = [
      [gx - d * 6, C + side * 2.5],
      [gx - d * 10.5, C],
      [gx - d * 7, C - side * 4.5],
    ];
    let best: { util: number; tx: number; ty: number } | null = null;
    const passSkill = this.skill(p, 'passing');
    for (const [zx, zy] of zones) {
      let att = 0;
      let bestAir = 0;
      for (const m of mates) {
        const dm = dist(m.x, m.y, zx, zy);
        if (dm < 9) {
          att++;
          bestAir = Math.max(bestAir, m.aerial - dm * 0.02);
        }
      }
      let defn = 0;
      let defAir = 0;
      for (const o of opp) {
        const dd = dist(o.x, o.y, zx, zy);
        if (dd < 6) {
          defn++;
          defAir = Math.max(defAir, o.slot!.pos === 'GK' ? 0.7 : o.aerial);
        }
      }
      if (!att) continue;
      const pWin = clamp(0.35 + (bestAir - defAir) * 1.2 + (att - defn) * 0.06, 0.08, 0.7) * (0.75 + passSkill * 0.3);
      const util = pWin * 0.075 - 0.012 + (this.teams[team].tactics.width - 2) * 0.003;
      if (!best || util > best.util) best = { util, tx: zx, ty: zy };
    }
    if (!best) return null;
    return { kind: 'cross' as const, util: best.util, tx: best.tx, ty: best.ty, p: 0.4, lofted: true };
  }

  private crossInto(p: MP, tx: number, ty: number) {
    // A defender squared up close to the crosser can block it, often behind.
    for (const o of this.onPitch(p.team === 0 ? 1 : 0)) {
      const od = dist(o.x, o.y, p.x, p.y);
      const ahead = ((o.x - p.x) * (tx - p.x) + (o.y - p.y) * (ty - p.y)) / (dist(p.x, p.y, tx, ty) || 1);
      if (od < 2.2 && ahead > 0.3 && this.rng.chance(0.38)) {
        p.passes++;
        this.stats.passes[p.team]++;
        o.interceptions++;
        const ownGx = this.goalX(o.team === 0 ? 1 : 0);
        const behind = this.rng.chance(0.6);
        const a = behind ? Math.atan2(this.rng.range(-2, 2), ownGx - this.bx) : Math.atan2(this.rng.range(-1, 1), -(ownGx - this.bx));
        this.looseFrom(o, a, this.rng.range(6, 11), this.rng.range(1, 3));
        return;
      }
    }
    const skill = this.skill(p, 'passing');
    const err = 0.9 + (1 - skill) * 2.8;
    const lx = tx + this.rng.gauss(0, err);
    const ly = ty + this.rng.gauss(0, err);
    const dd = Math.max(5, dist(this.bx, this.by, lx, ly));
    const flight = clamp(0.75 + dd * 0.02, 0.9, 1.5);
    const l = loftedLaunch(dd, flight);
    this.bvx = ((lx - this.bx) / dd) * l.speed;
    this.bvy = ((ly - this.by) / dd) * l.speed;
    this.bvz = l.vz;
    this.bz = 0.1;
    // The nearest attacker to the landing zone attacks it.
    let target: MP | null = null;
    let td = 1e9;
    for (const m of this.onPitch(p.team)) {
      if (m === p || m.slot!.pos === 'GK') continue;
      const dm = dist(m.x, m.y, lx, ly);
      if (dm < td) (td = dm), (target = m);
    }
    p.passes++;
    this.stats.passes[p.team]++;
    this.passer = p;
    this.intended = target;
    this.release('cross', p);
    this.mustPass = null;
  }

  /** Top running speed right now. */
  private vmax(p: MP) {
    return (5.6 + p.attrs.pace * 0.15) * this.fatigue(p);
  }

  /** Seconds for `p` to get a foot to (x, y): reaction, a start-up allowance, then running. */
  private reachTime(p: MP, x: number, y: number, react: number) {
    const d = Math.max(0, dist(p.x, p.y, x, y) - 0.6);
    // Players already moving towards the point lose less time accelerating.
    const toward = d > 0.01 ? ((x - p.x) * p.vx + (y - p.y) * p.vy) / (d + 0.6) : 0;
    const startup = clamp(0.35 - toward * 0.05, 0.05, 0.35);
    return react + startup + d / this.vmax(p);
  }

  private reaction(p: MP) {
    return 0.42 - (p.attrs.positioning / 20) * 0.14 - (p.attrs.decisions / 20) * 0.08;
  }

  /** The exact launch a pass to (tx, ty) uses, before any execution error. */
  private launch(fromX: number, fromY: number, tx: number, ty: number, lofted: boolean): BallState {
    const d = Math.max(0.5, dist(fromX, fromY, tx, ty));
    const nx = (tx - fromX) / d;
    const ny = (ty - fromY) / d;
    if (lofted) {
      const flight = clamp(0.8 + d * 0.045, 1.0, 2.8);
      const l = loftedLaunch(d, flight);
      return { x: fromX, y: fromY, z: 0.1, vx: nx * l.speed, vy: ny * l.speed, vz: l.vz };
    }
    const sp = Math.min(27, groundPassSpeed(d, clamp(3.5 + d * 0.08, 3.5, 6.5)));
    return { x: fromX, y: fromY, z: 0, vx: nx * sp, vy: ny * sp, vz: 0 };
  }

  /**
   * Evaluate a pass with the same physics the simulation will use:
   * predict the ball's path, find when the receiver can meet it and whether any
   * opponent can get there first.
   */
  private evalPass(p: MP, m: MP, opp: MP[], lossCost: number, tac: Tactics) {
    const team = p.team;
    const restart = this.mustPass;
    const fwd = this.dir(team);
    const offLine = this.offsideLineU(team);
    const mU = this.toU(team, m.x);
    const isForward = m.slot!.pos === 'ST' || m.slot!.pos === 'LW' || m.slot!.pos === 'RW' || m.slot!.pos === 'AM';

    const d0 = dist(p.x, p.y, m.x, m.y);
    if (d0 < 3.5 || d0 > 58) return null;
    if (restart === 'throw' && d0 > 26) return null;
    // Lead the receiver by roughly the ball's travel time.
    const lead = d0 > 34 ? 1.6 : clamp(d0 / 15, 0.15, 1.1);
    let tx = m.x + m.vx * lead;
    let ty = m.y + m.vy * lead;
    let through = false;
    if (isForward && !restart && (m.run > 0 || offLine - mU < 0.05) && offLine < 0.92 && this.toU(team, p.x) > 0.3) {
      // Ball into the space behind the line for a run.
      through = true;
      const [lx] = this.fromUV(team, Math.min(0.9, offLine + 0.07), 0);
      tx = lx;
      // Thread it through the widest gap in the line near the runner.
      let bestGap = -1;
      ty = m.y;
      for (const dy of [-7, -3.5, 0, 3.5, 7]) {
        const cy = clamp(m.y + dy + (PITCH_W / 2 - m.y) * 0.15, 4, PITCH_W - 4);
        let gap = 9;
        for (const o of opp) {
          const [dl, tt] = segDist(o.x, o.y, this.bx, this.by, lx, cy);
          if (tt > 0.1) gap = Math.min(gap, dl);
        }
        const score = gap - Math.abs(dy) * 0.12;
        if (score > bestGap) (bestGap = score), (ty = cy);
      }
    }
    tx = clamp(tx, 2, PITCH_L - 2);
    ty = clamp(ty, 2.5, PITCH_W - 2.5);
    const d = dist(p.x, p.y, tx, ty);

    const box = Math.abs(this.goalX(team) - tx) < BOX_DEPTH && Math.abs(ty - PITCH_W / 2) < BOX_HALF;
    const wide = Math.abs(p.y - PITCH_W / 2) > 17 && this.toU(team, p.x) > 0.7;
    const cross = wide && box && !restart;
    // Go in the air only when the ground lane is poor or the distance demands it.
    let lofted = cross || d > 38 || (restart === 'goalkick' && d > 32);
    const evalLane = (loft: boolean) => {
      const path = predictPath(this.launch(this.bx, this.by, tx, ty, loft), 0.3, 3.6);
      // When can the receiver meet it?
      let kRecv = -1;
      for (let k = 0; k < path.length; k++) {
        const pt = path[k];
        if (pt.z > 2.3) continue;
        if (this.reachTime(m, pt.x, pt.y, 0.1) <= pt.t + 0.05) {
          kRecv = k;
          break;
        }
      }
      if (kRecv < 0) return { pInt: 0.95, kRecv: path.length - 1, path };
      const tRecv = path[kRecv].t;
      let keep = 1;
      for (const o of opp) {
        // Quick reject: can't get near the line of the pass in time at all.
        const [dl] = segDist(o.x, o.y, this.bx, this.by, path[kRecv].x, path[kRecv].y);
        if ((dl - 0.6) / this.vmax(o) + 0.15 > tRecv + 0.4) continue;
        const isGK = o.slot!.pos === 'GK';
        const zMax = isGK && this.inOwnBox(o, path[kRecv].x, path[kRecv].y) ? 2.7 : 2.0;
        let margin = -9;
        const toOwnGoal = -this.dir(o.team);
        for (let k = 0; k <= kRecv; k++) {
          const pt = path[k];
          if (pt.z > zMax || pt.t < 0.15) continue;
          // Balls played in behind a defender cost him time turning.
          const turn = (pt.x - o.x) * toOwnGoal > 1.5 && !isGK ? 0.35 : 0;
          const mg = pt.t - this.reachTime(o, pt.x, pt.y, this.reaction(o) + turn);
          if (mg > margin) margin = mg;
        }
        if (margin < -1.5) continue;
        // Calibrated against simulated outcomes: defenders who are even close often get there.
        const pi = 1 / (1 + Math.exp(-(margin + (through ? 0.1 : 0.32)) * 5));
        keep *= 1 - pi * 0.92;
      }
      return { pInt: 1 - keep, kRecv, path };
    };
    let lane = evalLane(lofted);
    if (!lofted && lane.pInt > 0.45 && d > (through ? 12 : 18) && restart !== 'throw') {
      const air = evalLane(true);
      if (air.pInt + (through ? 0.08 : 0.18) < lane.pInt) {
        lane = air;
        lofted = true;
      }
    }
    const recvPt = lane.path[lane.kRecv];
    // Pressure when the ball arrives: how close can the nearest opponent get?
    let effD = 99;
    for (const o of opp) {
      const dd = dist(o.x, o.y, recvPt.x, recvPt.y) - recvPt.t * this.vmax(o) * 0.7;
      if (dd < effD) effD = dd;
    }
    // Lofted balls drop into contests: anyone near the landing spot makes it a 50/50.
    const pressureRisk = Math.exp(-Math.max(0, effD) / (lofted ? 2.6 : 1.6)) * (lofted ? 0.6 : 0.3);
    const passSkill = this.skill(p, 'passing') * 0.7 + this.skill(p, 'decisions') * 0.3;
    const errorRisk = (1 - passSkill) * 0.25 * (d / 30) + (lofted ? 0.12 : 0) + (d > 30 ? 0.05 : 0);
    const pOk = clamp((1 - lane.pInt) * (1 - pressureRisk) * (1 - errorRisk), 0.02, 0.985);

    let value = this.threat(team, recvPt.x, recvPt.y);
    if (through) {
      // Through on goal: nobody between the receiver and the keeper.
      let goalSide = 0;
      const ownGx = this.goalX(team);
      for (const o of opp) if (o.slot!.pos !== 'GK' && Math.abs(ownGx - o.x) < Math.abs(ownGx - recvPt.x)) goalSide++;
      if (goalSide === 0) value += 0.05;
    }
    if (cross) value = Math.max(value, 0.05 + (m.aerial - 0.5) * 0.06);
    const progress = (recvPt.x - p.x) * fwd;
    // Progress is worth a little on its own; possession sides value security more.
    value += Math.max(-0.004, progress * 0.0006) + ((tac.directness - 2) * 0.0012 * progress) / 10;
    const safety = 0.006 + (2 - tac.directness) * 0.003;
    const ownBoxTarget = this.toU(team, tx) < 0.16 && Math.abs(ty - PITCH_W / 2) < BOX_HALF;
    const lc = lossCost * (ownBoxTarget ? 2.5 : 1);
    let util = pOk * (value + safety) - (1 - pOk) * lc * (1 + (2 - tac.directness) * 0.15);
    // Don't just give it straight back to the player who passed it.
    if (this.lastPasserTo === m && this.lastPasserFrom === p.id) util -= 0.004;
    // Offside: the passer has to notice the receiver is beyond the line.
    if (!restart || restart === 'freekick') {
      const seen = offLine + this.rng.gauss(0, 0.008 + (1 - p.attrs.decisions / 20) * 0.02);
      if (mU > seen && mU > 0.5) util -= 0.05;
    }
    return {
      kind: (cross ? 'cross' : 'pass') as 'cross' | 'pass',
      util,
      target: m,
      tx,
      ty,
      p: pOk,
      lofted,
      through,
    };
  }

  private makePass(p: MP, m: MP, tx: number, ty: number, lofted: boolean, cross: boolean, through: boolean) {
    const team = p.team;
    // Offside check at the moment of the pass.
    if (this.mustPass !== 'throw' && this.mustPass !== 'goalkick' && this.mustPass !== 'corner') {
      const offLine = this.offsideLineU(team);
      const mU = this.toU(team, m.x);
      if (mU > offLine + 0.002 && mU > 0.5) {
        this.stats.offsides[team]++;
        this.pushEvent('offside', team, { player: m.id });
        this.startRestart('freekick', team === 0 ? 1 : 0, m.x, m.y);
        return;
      }
    }
    const d = dist(p.x, p.y, tx, ty);
    const passSkill = this.skill(p, 'passing');
    let press = 20;
    for (const o of this.onPitch(team === 0 ? 1 : 0)) press = Math.min(press, dist(o.x, o.y, p.x, p.y));
    // Error mostly along the line of the pass (weight), less sideways.
    const lat = (0.2 + d * 0.025) * (1.3 - passSkill) * (press < 2 ? 1.5 : 1) * (lofted ? 1.3 : 1);
    const along = lat * (lofted ? 1.1 : 1.25);
    const nx = (tx - p.x) / (d || 1);
    const ny = (ty - p.y) / (d || 1);
    const ea = this.rng.gauss(0, along);
    const el = this.rng.gauss(0, lat);
    const ex = clamp(tx + nx * ea - ny * el, 0.5, PITCH_L - 0.5);
    const ey = clamp(ty + ny * ea + nx * el, 0.5, PITCH_W - 0.5);
    const b = this.launch(this.bx, this.by, ex, ey, lofted);
    this.bvx = b.vx;
    this.bvy = b.vy;
    this.bvz = b.vz;
    this.bz = b.z;
    p.passes++;
    this.stats.passes[team]++;
    this.passer = p;
    this.intended = m;
    this.lastPasserTo = p;
    this.lastPasserFrom = m.id;
    this.release(cross ? 'cross' : lofted ? 'long' : through ? 'through' : 'pass', p);
    this.mustPass = null;
  }

  private clearBall(p: MP) {
    const fwd = this.dir(p.team);
    const tx = clamp(p.x + fwd * this.rng.range(30, 50), 2, PITCH_L - 2);
    const ty = clamp(p.y + this.rng.range(-15, 15), 2, PITCH_W - 2);
    const d = dist(p.x, p.y, tx, ty);
    const speed = clamp(d * 0.55 + 8, 14, 26);
    this.bvx = ((tx - p.x) / d) * speed;
    this.bvy = ((ty - p.y) / d) * speed;
    this.bvz = (9.81 * (d / speed)) / 2;
    this.bz = 0.2;
    this.passer = null;
    this.intended = null;
    this.release('clear', p);
  }

  private shotXg(p: MP): number {
    const gx = this.goalX(p.team);
    let xg = locationXg(Math.abs(gx - p.x), p.y - PITCH_W / 2);
    const opp = this.onPitch(p.team === 0 ? 1 : 0);
    let nearest = 99;
    let blockers = 0;
    for (const o of opp) {
      if (o.slot!.pos === 'GK') continue;
      const d = dist(o.x, o.y, p.x, p.y);
      if (d < nearest) nearest = d;
      const [dl, t] = segDist(o.x, o.y, p.x, p.y, gx, PITCH_W / 2);
      if (dl < 1.2 && t > 0.05 && t < 0.9) blockers++;
    }
    xg *= 0.4 + 0.6 * Math.min(1, nearest / 4);
    xg *= Math.pow(0.72, blockers);
    return xg;
  }

  private takeShot(p: MP, penalty: boolean) {
    const team = p.team;
    const gx = this.goalX(team);
    const keeper = this.gk(team === 0 ? 1 : 0);
    let xg = penalty ? 0.76 : this.shotXg(p);
    if (this.mustPass === 'freekick') xg = Math.min(0.09, xg * 0.8);
    this.stats.shots[team]++;
    this.stats.xg[team] += xg;
    p.shots++;

    // Blocked before it gets going?
    if (!penalty) {
      for (const o of this.onPitch(team === 0 ? 1 : 0)) {
        if (o.slot!.pos === 'GK') continue;
        const [dl, t] = segDist(o.x, o.y, p.x, p.y, gx, PITCH_W / 2);
        if (dl < 1.4 && t > 0.03 && t < 0.7 && this.rng.chance(0.3 + o.attrs.positioning * 0.012 - dl * 0.08)) {
          this.pushEvent('block', o.team, { player: o.id, other: p.id, xg });
          this.pushEvent('shot', team, { player: p.id, xg, detail: 'blocked' });
          this.lastTouch = o;
          this.owner = null;
          this.ballKind = 'loose';
          this.passer = null;
          this.intended = null;
          const behind = this.rng.chance(0.45);
          const a = behind ? Math.atan2((this.rng.chance(0.5) ? -1 : 1) * this.rng.range(3, 8), gx - o.x) : Math.atan2(p.y - o.y, p.x - o.x) + this.rng.range(-1.2, 1.2);
          const s = this.rng.range(5, 12);
          this.bx = o.x;
          this.by = o.y;
          this.bvx = Math.cos(a) * s;
          this.bvy = Math.sin(a) * s;
          this.bvz = this.rng.range(0, 4);
          this.mustPass = null;
          return;
        }
      }
    }

    const fin = this.skill(p, penalty ? 'composure' : 'finishing') * 0.75 + this.skill(p, 'composure') * 0.25;
    const finishMult = 0.5 + fin * 0.95;
    const gkMult = keeper ? 1.3 - (keeper.attrs.reflexes / 20) * 0.45 - (keeper.attrs.positioning / 20) * 0.15 : 2.2;
    // Location quality is discounted for in-game pressure on the shooter; tuned
    // against seeded batches so conversion lands near ~10% of shots.
    const pGoal = clamp(xg * finishMult * gkMult * (penalty ? 1 : 0.74), 0.004, 0.9);
    const pOn = clamp(0.16 + pGoal * 1.1 + fin * 0.16, pGoal + 0.02, 0.95);
    const r = this.rng.next();
    let outcome: ShotPlan['outcome'];
    if (r < pGoal) outcome = 'goal';
    else if (r < pOn) outcome = keeper && this.rng.chance(0.3 + (keeper.attrs.handling / 20) * 0.45) ? 'catch' : 'save';
    else outcome = this.rng.chance(0.07) ? 'post' : 'miss';

    // Aim point
    const side = this.rng.chance(0.5) ? -1 : 1;
    let ty: number;
    let tz: number;
    if (outcome === 'goal') {
      ty = PITCH_W / 2 + side * this.rng.range(1.2, GOAL_HALF - 0.4);
      tz = this.rng.range(0.15, 2.1);
    } else if (outcome === 'save' || outcome === 'catch') {
      ty = PITCH_W / 2 + side * this.rng.range(0, GOAL_HALF - 0.6);
      tz = this.rng.range(0.2, 1.9);
    } else if (outcome === 'post') {
      ty = PITCH_W / 2 + side * GOAL_HALF;
      tz = this.rng.range(0.3, 2.2);
    } else {
      const over = this.rng.chance(0.4);
      ty = PITCH_W / 2 + side * (over ? this.rng.range(0, GOAL_HALF + 1) : this.rng.range(GOAL_HALF + 0.4, GOAL_HALF + 6));
      tz = over ? this.rng.range(2.7, 5) : this.rng.range(0.2, 2);
    }
    const tx = gx + this.dir(team) * 0.6;
    const d = dist(p.x, p.y, tx, ty);
    const speed = penalty ? 24 : clamp(18 + fin * 10 + this.rng.range(-2, 2), 16, 30);
    const flight = d / speed;
    this.bvx = ((tx - p.x) / d) * speed;
    this.bvy = ((ty - p.y) / d) * speed;
    this.bvz = (tz + 0.5 * 9.81 * flight * flight - 0.1) / flight;
    this.bz = 0.1;
    this.shot = { outcome, shooter: p, xg, resolved: false };
    this.passer = null;
    this.intended = null;
    this.release('shot', p);
    this.mustPass = null;
    if (outcome !== 'goal') {
      const assistedBy = this.assistCandidate;
      if (assistedBy && assistedBy.team === team && assistedBy !== p && xg > 0.08) assistedBy.keyPasses++;
    }
    this.pushEvent('shot', team, { player: p.id, xg, detail: penalty ? 'penalty' : undefined });
    if (keeper) {
      // Keeper reacts toward the line between ball and target.
      keeper.vx += (gx + -this.dir(team) * 0.5 - keeper.x) * 0.2;
    }
  }

  // ------------------------------------------------------------ free ball

  private updateFreeBall() {
    const px = this.bx;
    const py = this.by;
    const st: BallState = { x: this.bx, y: this.by, z: this.bz, vx: this.bvx, vy: this.bvy, vz: this.bvz };
    ballStep(st, DT);
    this.bx = st.x;
    this.by = st.y;
    this.bz = st.z;
    this.bvx = st.vx;
    this.bvy = st.vy;
    this.bvz = st.vz;

    // Shot resolution near the goal line.
    if (this.shot && !this.shot.resolved) {
      const team = this.shot.shooter.team;
      const gx = this.goalX(team);
      const toLine = Math.abs(gx - this.bx);
      const keeper = this.gk(team === 0 ? 1 : 0);
      const depth = (gx - this.bx) * this.dir(team); // metres before the goal line (negative = crossed)
      if ((this.shot.outcome === 'save' || this.shot.outcome === 'catch') && depth < 1.6 && keeper) {
        if (depth < 0.3) this.bx = gx - this.dir(team) * 0.5;
        this.resolveSave(keeper);
        return;
      }
      if (this.shot.outcome === 'post' && depth < 0.9) {
        this.shot.resolved = true;
        this.bx = gx - this.dir(team) * 0.3;
        this.pushEvent('post', team, { player: this.shot.shooter.id, xg: this.shot.xg });
        this.bvx = -this.bvx * 0.45 + this.rng.range(-2, 2);
        this.bvy = this.rng.range(-8, 8);
        this.bvz = Math.max(0, this.bvz * 0.3);
        this.ballKind = 'loose';
        this.lastTouch = this.shot.shooter;
        return;
      }
      if (keeper && toLine < 4) {
        // Keeper dives across (presentation only follows from engine state).
        keeper.x += (gx - this.dir(team) * 0.6 - keeper.x) * 0.5;
        keeper.y += (clamp(this.by, PITCH_W / 2 - 3.5, PITCH_W / 2 + 3.5) - keeper.y) * (this.shot.outcome === 'goal' ? 0.25 : 0.6);
      }
    }

    // Out of play?
    if (this.checkOut()) return;

    if (this.ballKind === 'shot' && this.shot && !this.shot.resolved) return; // shots are not intercepted mid-flight (blocks rolled earlier)

    this.noTouchT -= DT;
    const speed = Math.hypot(this.bvx, this.bvy);
    const kind = this.ballKind;
    const attackTeam = this.passer ? this.passer.team : this.lastTouch ? this.lastTouch.team : -1;

    // Aerial contest: a dropping ball at head height goes to whoever wins the jump.
    if (this.bz > 0.9 && this.bz < 3.0 && this.bvz < 0) {
      const contenders: { p: MP; score: number; hd: number; gk: boolean }[] = [];
      for (const team of [0, 1] as const) {
        for (const p of this.onPitch(team)) {
          if (p === this.noTouch && this.noTouchT > 0) continue;
          const gk = p.slot!.pos === 'GK' && this.inOwnBox(p, this.bx, this.by) && team !== attackTeam;
          const hd = dist(p.x, p.y, this.bx, this.by);
          const reach = gk ? 2.1 : 1.35;
          if (hd > reach || (!gk && this.bz > 2.6)) continue;
          const score = gk
            ? 0.62 + (p.attrs.handling / 20) * 0.45 - hd * 0.12 + this.rng.gauss(0, 0.1)
            : p.aerial - hd * 0.3 + (p === this.intended ? 0.08 : 0) + this.rng.gauss(0, 0.13);
          contenders.push({ p, score, hd, gk });
        }
      }
      if (contenders.length) {
        contenders.sort((x, y) => y.score - x.score || x.p.team - y.p.team || x.p.ent - y.p.ent);
        this.resolveAerial(contenders[0], contenders[1] ?? null, kind, attackTeam);
        return;
      }
    }
    if (this.bz > 1.0) return;

    // Ground (or low) ball: candidates the ball passes within reach of this tick.
    const candidates: { p: MP; d: number; reach: number }[] = [];
    for (const team of [0, 1] as const) {
      for (const p of this.onPitch(team)) {
        if (p === this.noTouch && this.noTouchT > 0) continue;
        const [d] = segDist(p.x, p.y, px, py, this.bx, this.by);
        const gk = p.slot!.pos === 'GK' && this.inOwnBox(p, this.bx, this.by);
        const passing = !!this.passer && p.team !== this.passer.team && !p.chase;
        const reach = gk ? 1.5 : passing ? 0.45 : 0.5 + 0.45 * clamp(1 - speed / 20, 0, 1);
        if (d < reach) candidates.push({ p, d, reach });
      }
    }
    if (!candidates.length) return;
    candidates.sort((a, b) => a.d - b.d || a.p.team - b.p.team || a.p.ent - b.p.ent);

    for (const { p, d, reach } of candidates) {
      const gk = p.slot!.pos === 'GK' && this.inOwnBox(p, this.bx, this.by);
      const own = p.team === attackTeam;
      const passInFlight = !!this.passer && (kind === 'pass' || kind === 'through' || kind === 'long' || kind === 'cross');
      const closeness = 1 - d / reach;
      let pc: number;
      if (p === this.intended) {
        const touch = (p.attrs.dribbling + p.attrs.passing) / 40;
        pc = 0.965 + (touch - 0.5) * 0.06 - Math.max(0, speed - 16) * 0.02;
      } else if (gk && !own) {
        pc = 0.9;
      } else if (!passInFlight) {
        pc = speed < 5 ? 0.92 : 0.25 + closeness * 0.6;
      } else if (!own && p.chase) {
        // Read the pass and stepped into the lane.
        pc = 0.8 + (p.attrs.positioning / 20) * 0.12 - Math.max(0, speed - 14) * 0.03 - (1 - closeness) * 0.2;
      } else if (!own) {
        // Not expecting it: a stuck-out leg at best.
        pc = (0.22 + (p.attrs.positioning / 20) * 0.15) * closeness - Math.max(0, speed - 10) * 0.015;
      } else {
        // A teammate the pass wasn't for lets it run unless it's slow.
        pc = speed < 6 ? 0.6 * closeness : 0.05;
      }
      if (this.rng.chance(clamp(pc, 0.02, 0.99))) {
        // A defender right on the receiver's back can poke it away as it arrives.
        if (p === this.intended) {
          for (const o of this.onPitch(p.team === 0 ? 1 : 0)) {
            const od = dist(o.x, o.y, p.x, p.y);
            if (od > 0.95) continue;
            const mk = this.skill(o, 'tackling') * 0.5 + this.skill(o, 'positioning') * 0.3 + this.skill(o, 'strength') * 0.2;
            const hold = this.skill(p, 'dribbling') * 0.4 + this.skill(p, 'strength') * 0.3 + this.skill(p, 'composure') * 0.3;
            if (this.rng.chance(clamp(0.16 + (mk - hold) * 0.5 - od * 0.08, 0.04, 0.38))) {
              if (this.passer) {
                this.passer.passesOk++;
                this.stats.passesOk[p.team]++;
              }
              o.interceptions++;
              this.looseFrom(o, Math.atan2(p.y - o.y, p.x - o.x) + this.rng.range(-1, 1), this.rng.range(2.5, 5));
              return;
            }
            break;
          }
        }
        if (this.passer) {
          if (this.passer.team === p.team) {
            this.passer.passesOk++;
            this.stats.passesOk[p.team]++;
          } else {
            p.interceptions++;
          }
        }
        this.giveBall(p);
        if (gk && !own) this.gkHold = 1.2 + this.rng.range(0, 1.2);
        return;
      }
      if (p === this.intended) {
        // Heavy touch: it runs on, a little off line.
        const a = Math.atan2(this.bvy, this.bvx) + this.rng.range(-0.5, 0.5);
        this.looseFrom(p, a, speed * 0.45);
        return;
      }
      if (!own && closeness > 0.5 && speed > 4 && this.rng.chance(p.chase ? 0.5 : 0.3)) {
        // Got a touch on it without controlling: deflection.
        const a = Math.atan2(this.bvy, this.bvx) + this.rng.range(-1.1, 1.1);
        p.interceptions++;
        this.looseFrom(p, a, speed * this.rng.range(0.3, 0.6));
        return;
      }
    }
  }

  /** The ball comes off `p` in direction `angle` at `speed`. */
  private looseFrom(p: MP, angle: number, speed: number, vz = 0) {
    this.lastTouch = p;
    this.passer = null;
    this.intended = null;
    this.owner = null;
    this.ballKind = 'loose';
    this.bvx = Math.cos(angle) * speed;
    this.bvy = Math.sin(angle) * speed;
    this.bvz = vz;
    if (vz > 0) this.bz = Math.max(this.bz, 0.2);
    this.noTouch = p;
    this.noTouchT = 0.3;
  }

  private resolveAerial(win: { p: MP; score: number; hd: number; gk: boolean }, second: { p: MP; score: number } | null, kind: BallKind, attackTeam: number) {
    const p = win.p;
    const attacking = p.team === attackTeam;
    p.touches++;
    if (this.setPiece) this.setPiece.until = Math.min(this.setPiece.until, this.tick + 5);
    if (win.gk) {
      p.saves++;
      if (this.rng.chance(0.5 + (p.attrs.handling / 20) * 0.4 - win.hd * 0.08)) {
        if (this.passer) p.interceptions++;
        this.giveBall(p);
        this.gkHold = 1.4 + this.rng.range(0, 1);
      } else {
        // Punched clear.
        const away = this.dir(p.team);
        const a = Math.atan2(this.rng.range(-0.9, 0.9), away);
        this.looseFrom(p, a, this.rng.range(13, 19), this.rng.range(4, 7));
      }
      return;
    }
    const gx = this.goalX(p.team);
    const dl = Math.abs(gx - this.bx);
    const nearGoal = dl < 14 && Math.abs(this.by - PITCH_W / 2) < 12;
    // Unchallenged: chest it down and keep it.
    const challenged = !!second && second.p.team !== p.team && dist(second.p.x, second.p.y, p.x, p.y) < 2;
    if (!challenged && (p === this.intended || !this.passer) && this.rng.chance(p === this.intended ? 0.9 : 0.6)) {
      if (this.passer) {
        if (attacking) {
          this.passer.passesOk++;
          this.stats.passesOk[p.team]++;
        } else p.interceptions++;
      }
      this.giveBall(p);
      return;
    }
    if (attacking && nearGoal && (kind === 'cross' || kind === 'long')) {
      const pressure = second && second.p.team !== p.team ? clamp(1 - (win.score - second.score) * 3, 0, 1) : 0;
      this.header(p, pressure);
      return;
    }
    if (this.passer) {
      if (attacking) {
        this.passer.passesOk++;
        this.stats.passesOk[p.team]++;
      } else p.interceptions++;
    }
    if (attacking) {
      // Knock-down to feet or a flick on.
      const fwd = this.dir(p.team);
      const a = Math.atan2(this.rng.range(-0.8, 0.8), fwd * this.rng.range(0.2, 1));
      this.looseFrom(p, a, this.rng.range(3, 7), this.rng.range(0.5, 2));
      return;
    }
    // Defensive header: away from goal, sometimes glanced behind for a corner.
    const ownGx = this.goalX(p.team === 0 ? 1 : 0);
    const nearOwn = Math.abs(ownGx - this.bx) < 12;
    if (nearOwn && this.rng.chance(0.18)) {
      const side = this.by < PITCH_W / 2 ? -1 : 1;
      this.looseFrom(p, Math.atan2(side * 6, ownGx - this.bx), this.rng.range(8, 12), this.rng.range(2, 4));
      return;
    }
    const away = this.dir(p.team);
    const a = Math.atan2(this.rng.range(-1.1, 1.1), away);
    this.looseFrom(p, a, this.rng.range(10, 15), this.rng.range(1.5, 4));
  }

  private header(p: MP, pressure = 0) {
    const team = p.team;
    const gx = this.goalX(team);
    const keeper = this.gk(team === 0 ? 1 : 0);
    const xg = locationXg(Math.abs(gx - this.bx), this.by - PITCH_W / 2) * (0.35 + (p.attrs.heading / 20) * 0.45) * (1 - pressure * 0.55);
    this.stats.shots[team]++;
    this.stats.xg[team] += xg;
    p.shots++;
    const gkMult = keeper ? 1.25 - (keeper.attrs.reflexes / 20) * 0.4 : 2;
    const pGoal = clamp(xg * gkMult * (0.8 + p.attrs.heading / 50) * 0.7, 0.01, 0.6);
    const pOn = clamp(0.3 + pGoal, pGoal, 0.8);
    const r = this.rng.next();
    const outcome: ShotPlan['outcome'] = r < pGoal ? 'goal' : r < pOn ? 'save' : 'miss';
    const side = this.rng.chance(0.5) ? -1 : 1;
    const ty = outcome === 'miss' ? PITCH_W / 2 + side * this.rng.range(GOAL_HALF + 0.3, GOAL_HALF + 3) : PITCH_W / 2 + side * this.rng.range(0.4, GOAL_HALF - 0.3);
    const tz = outcome === 'miss' && this.rng.chance(0.5) ? 2.8 : this.rng.range(0.2, 1.8);
    const tx = gx + this.dir(team) * 0.6;
    const d = dist(this.bx, this.by, tx, ty);
    const speed = 14;
    const flight = d / speed;
    this.bvx = ((tx - this.bx) / d) * speed;
    this.bvy = ((ty - this.by) / d) * speed;
    this.bvz = (tz - this.bz + 0.5 * 9.81 * flight * flight) / flight;
    p.touches++;
    if (this.passer && this.passer.team === team && this.passer !== p) {
      this.assistCandidate = this.passer;
      this.passer.passesOk++;
      this.stats.passesOk[team]++;
    }
    this.shot = { outcome, shooter: p, xg, resolved: false };
    this.passer = null;
    this.intended = null;
    this.release('shot', p);
    this.pushEvent('shot', team, { player: p.id, xg, detail: 'header' });
  }

  private resolveSave(keeper: MP) {
    const shot = this.shot!;
    shot.resolved = true;
    const team = shot.shooter.team;
    this.stats.onTarget[team]++;
    shot.shooter.onTarget++;
    keeper.saves++;
    keeper.x = this.bx - this.dir(team) * 0.3;
    keeper.y = clamp(this.by, PITCH_W / 2 - GOAL_HALF, PITCH_W / 2 + GOAL_HALF);
    this.pushEvent('save', keeper.team, { player: keeper.id, other: shot.shooter.id, xg: shot.xg });
    if (shot.outcome === 'catch') {
      this.lastTouch = keeper;
      this.giveBall(keeper);
      this.gkHold = 1.5 + this.rng.range(0, 1.5);
      return;
    }
    // Parry: rebound or out for a corner.
    this.lastTouch = keeper;
    this.passer = null;
    this.intended = null;
    this.ballKind = 'loose';
    const outward = -this.dir(team);
    if (this.rng.chance(0.55)) {
      // Behind for a corner.
      this.bvx = -outward * 3;
      this.bvy = (this.by < PITCH_W / 2 ? -1 : 1) * this.rng.range(6, 10);
      this.bvz = this.rng.range(1, 4);
    } else {
      this.bvx = outward * this.rng.range(4, 9);
      this.bvy = (this.rng.chance(0.5) ? -1 : 1) * this.rng.range(7, 14);
      this.bvz = this.rng.range(0.5, 4);
    }
  }

  private checkOut(): boolean {
    const x = this.bx;
    const y = this.by;
    const lt = this.lastTouch;
    if (y < 0 || y > PITCH_W) {
      const team = (lt ? (lt.team === 0 ? 1 : 0) : 0) as 0 | 1;
      if (this.shot && !this.shot.resolved) this.finishMiss();
      this.startRestart('throw', team, clamp(x, 1, PITCH_L - 1), y < 0 ? 0 : PITCH_W);
      return true;
    }
    if (x < 0 || x > PITCH_L) {
      // Which team defends this end?
      const defending = (this.goalX(0) === (x < 0 ? 0 : PITCH_L) ? 1 : 0) as 0 | 1;
      const attacking = (defending === 0 ? 1 : 0) as 0 | 1;
      const inMouth = Math.abs(y - PITCH_W / 2) < GOAL_HALF && this.bz < GOAL_H && !(this.shot && !this.shot.resolved);
      if (Math.abs(y - PITCH_W / 2) < GOAL_HALF && this.shot && !this.shot.resolved && this.shot.outcome === 'goal' && this.ballKind === 'shot') {
        this.scoreGoal(attacking);
        return true;
      }
      if (inMouth) {
        const keeper = this.gk(defending);
        if (keeper) {
          keeper.x = clamp(x, 0.5, PITCH_L - 0.5);
          keeper.y = clamp(y, PITCH_W / 2 - GOAL_HALF, PITCH_W / 2 + GOAL_HALF);
          if (this.shot && !this.shot.resolved) this.finishMiss();
          this.bx = keeper.x;
          this.by = keeper.y;
          this.giveBall(keeper);
          this.gkHold = 1.5;
          return true;
        }
      }
      if (this.shot && !this.shot.resolved) this.finishMiss();
      if (lt && lt.team === defending) {
        this.stats.corners[attacking]++;
        this.pushEvent('corner', attacking);
        this.startRestart('corner', attacking, x < 0 ? 0.3 : PITCH_L - 0.3, y < PITCH_W / 2 ? 0.3 : PITCH_W - 0.3);
      } else {
        const gkx = x < 0 ? 5.5 : PITCH_L - 5.5;
        this.startRestart('goalkick', defending, gkx, PITCH_W / 2 + (y < PITCH_W / 2 ? -6 : 6));
      }
      return true;
    }
    return false;
  }

  private finishMiss() {
    const s = this.shot!;
    s.resolved = true;
    this.pushEvent('miss', s.shooter.team, { player: s.shooter.id, xg: s.xg });
  }

  private scoreGoal(team: 0 | 1) {
    const lt = this.lastTouch;
    const own = !!lt && lt.team !== team;
    const scorer = lt;
    if (this.shot && !this.shot.resolved) {
      this.shot.resolved = true;
      this.stats.onTarget[this.shot.shooter.team]++;
      this.shot.shooter.onTarget++;
    }
    this.teams[team].score++;
    const assist = !own && this.assistCandidate && this.assistCandidate !== scorer && this.assistCandidate.team === team ? this.assistCandidate : null;
    if (scorer) {
      if (!own) scorer.goals++;
    }
    if (assist) assist.assists++;
    const keeper = this.gk(team === 0 ? 1 : 0);
    if (keeper) keeper.conceded++;
    this.stoppage[1] += 40;
    const penalty = this.events.at(-1)?.type === 'shot' && this.events.at(-1)?.detail === 'penalty';
    const header = this.events.at(-1)?.type === 'shot' && this.events.at(-1)?.detail === 'header';
    this.pushEvent('goal', team, {
      player: scorer?.id,
      other: assist?.id,
      detail: own ? 'own goal' : penalty ? 'penalty' : header ? 'header' : undefined,
      xg: this.shot?.xg,
      score: [this.teams[0].score, this.teams[1].score],
    });
    // Ball rests in the net; celebration then kickoff.
    this.bvx = this.bvx * 0.1;
    this.bvy = this.bvy * 0.1;
    this.bvz = 0;
    this.bz = Math.min(this.bz, 1);
    this.bx = clamp(this.bx, -1.5, PITCH_L + 1.5);
    this.owner = null;
    this.ballKind = 'none';
    this.shot = null;
    this.assistCandidate = null;
    this.goalTeam = team;
    this.celebrate = 9;
  }

  // ------------------------------------------------------- AI managers

  private aiManagers() {
    if (this.tick % 25 !== 0) return;
    const minute = this.clock / 60;
    for (const team of [0, 1] as const) {
      const t = this.teams[team];
      if (!t.input.autoManage) continue;
      if (minute - t.lastAiCheck < 8 || minute < 55) continue;
      t.lastAiCheck = minute;
      const diff = t.score - this.teams[team === 0 ? 1 : 0].score;
      // Tactical tweak late on.
      if (minute > 70) {
        const want = diff < 0 ? Math.min(4, t.input.tactics.mentality + (diff < -1 ? 1 : 2)) : diff > 0 && minute > 80 ? Math.max(0, t.input.tactics.mentality - 1) : t.input.tactics.mentality;
        if (want !== t.tactics.mentality) {
          this.commandQueue.push({ type: 'tactics', team, tactics: { ...t.tactics, mentality: want, pressing: diff < 0 ? Math.min(4, t.tactics.pressing + 1) : t.tactics.pressing } });
        }
      }
      // Substitutions for tired players.
      const left = MAX_SUBS - t.subsUsed - t.pendingSubs.length;
      if (left <= 0) continue;
      const tired = this.onPitch(team)
        .filter((p) => p.slot!.pos !== 'GK' && !t.pendingSubs.some((s) => s.outId === p.id))
        .sort((a, b) => a.stamina - b.stamina);
      const cutoff = minute > 75 ? 0.66 : 0.6;
      for (const p of tired.slice(0, Math.min(2, left))) {
        if (p.stamina > cutoff && !(diff < 0 && minute > 68 && p.slot!.u < 0.25 && false)) continue;
        const sub = this.bestBench(team, p.slot!.pos);
        if (sub) t.pendingSubs.push({ outId: p.id, inId: sub.id });
      }
    }
  }

  // ------------------------------------------------------------ recording

  private recordFrame() {
    if (!this.record) {
      this.frameCount++;
      return;
    }
    const idx = this.frameCount % this.chunkSize;
    if (idx === 0) this.frameChunks.push(new Int16Array(this.chunkSize * FRAME_STRIDE));
    const buf = this.frameChunks[this.frameChunks.length - 1];
    const o = idx * FRAME_STRIDE;
    buf[o] = Math.round(this.clock);
    buf[o + 1] = this.half;
    buf[o + 2] = Math.round(this.bx * 100);
    buf[o + 3] = Math.round(this.by * 100);
    buf[o + 4] = Math.round(this.bz * 100);
    buf[o + 5] = this.owner ? this.owner.team * MAX_PER_TEAM + this.owner.ent : -1;
    for (const team of [0, 1] as const) {
      const ps = this.teams[team].players;
      for (let i = 0; i < MAX_PER_TEAM; i++) {
        const p = ps[i];
        const k = o + 6 + (team * MAX_PER_TEAM + i) * 2;
        if (p && p.onPitch) {
          buf[k] = Math.round(p.x * 100);
          buf[k + 1] = Math.round(p.y * 100);
        } else {
          buf[k] = OFF;
          buf[k + 1] = OFF;
        }
      }
    }
    this.frameCount++;
  }

  /** Read a recorded frame into a plain structure (presentation helper). */
  frame(i: number): Frame | null {
    if (!this.record || i < 0 || i >= this.frameCount) return null;
    const buf = this.frameChunks[Math.floor(i / this.chunkSize)];
    const o = (i % this.chunkSize) * FRAME_STRIDE;
    const players: (Float32Array | null)[] = [];
    const pos = new Float32Array(MAX_PER_TEAM * 2 * 2);
    const present = new Uint8Array(MAX_PER_TEAM * 2);
    for (let e = 0; e < MAX_PER_TEAM * 2; e++) {
      const x = buf[o + 6 + e * 2];
      if (x === OFF) continue;
      present[e] = 1;
      pos[e * 2] = x / 100;
      pos[e * 2 + 1] = buf[o + 7 + e * 2] / 100;
    }
    void players;
    return {
      clock: buf[o],
      half: buf[o + 1] as 1 | 2,
      ball: [buf[o + 2] / 100, buf[o + 3] / 100, buf[o + 4] / 100],
      owner: buf[o + 5],
      pos,
      present,
    };
  }

  // ------------------------------------------------------------- results

  playerById(id: string): MP | undefined {
    return this.teams[0].players.find((p) => p.id === id) ?? this.teams[1].players.find((p) => p.id === id);
  }

  entity(team: 0 | 1, ent: number): MP | undefined {
    return this.teams[team].players[ent];
  }

  matchStats(): MatchStats {
    const tot = this.possTicks[0] + this.possTicks[1] || 1;
    const p0 = Math.round((this.possTicks[0] / tot) * 100);
    const s = this.stats;
    const acc = (t: 0 | 1) => (s.passes[t] ? Math.round((s.passesOk[t] / s.passes[t]) * 100) : 0);
    return {
      possession: [p0, 100 - p0],
      shots: [s.shots[0], s.shots[1]],
      onTarget: [s.onTarget[0], s.onTarget[1]],
      passes: [s.passes[0], s.passes[1]],
      passAcc: [acc(0), acc(1)],
      corners: [s.corners[0], s.corners[1]],
      fouls: [s.fouls[0], s.fouls[1]],
      yellows: [s.yellows[0], s.yellows[1]],
      reds: [s.reds[0], s.reds[1]],
      offsides: [s.offsides[0], s.offsides[1]],
    };
  }

  ratings(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const team of [0, 1] as const) {
      const t = this.teams[team];
      const oppScore = this.teams[team === 0 ? 1 : 0].score;
      const won = t.score > oppScore ? 0.3 : t.score < oppScore ? -0.3 : 0;
      for (const p of t.players) {
        if (!p.used) continue;
        const def = p.slot ? p.slot.u < 0.25 : p.natPos === 'CB' || p.natPos === 'LB' || p.natPos === 'RB' || p.natPos === 'GK';
        let r = 6.2 + won;
        r += p.goals * 0.95 + p.assists * 0.6 + p.keyPasses * 0.15;
        r += Math.min(0.6, p.passesOk * 0.006) - (p.passes - p.passesOk) * 0.03;
        r += Math.min(0.7, p.tackles * 0.035 + p.interceptions * 0.035) + Math.min(1.2, p.saves * 0.16);
        r += p.shots ? (p.onTarget / p.shots - 0.4) * 0.25 : 0;
        r -= p.fouls * 0.05;
        if (def) r -= oppScore * 0.25;
        if (def && oppScore === 0) r += 0.35;
        if (p.yellow) r -= 0.2;
        if (p.sentOff) r -= 1.5;
        if (p.minutes < 20) r = 6 + (r - 6) * 0.5;
        // Keep the scale honest: 10 needs something extraordinary.
        if (r > 8.5) r = 8.5 + (r - 8.5) * 0.4;
        out[p.id] = Math.round(clamp(r, 3, 10) * 10) / 10;
      }
    }
    return out;
  }

  /** Run to completion (headless). */
  runToEnd(maxTicks = 40000) {
    let n = 0;
    while (!this.finished && n++ < maxTicks) this.step();
  }

  score(): [number, number] {
    return [this.teams[0].score, this.teams[1].score];
  }
}

export interface Frame {
  clock: number;
  half: 1 | 2;
  ball: [number, number, number];
  owner: number;
  pos: Float32Array;
  present: Uint8Array;
}

function avgAttr(a: Attributes) {
  return (a.pace + a.passing + a.decisions + a.dribbling + a.finishing + a.tackling + a.positioning + a.composure) / 8;
}

export function describeTactics(t: Tactics): string {
  const m = ['very defensive', 'defensive', 'balanced', 'attacking', 'very attacking'][t.mentality];
  return `${t.formation}, ${m}`;
}

export function clockLabel(clock: number, half: 1 | 2): string {
  const limit = half === 1 ? HALF_SECONDS : HALF_SECONDS * 2;
  if (clock >= limit) {
    const extra = Math.floor((clock - limit) / 60) + 1;
    return `${limit / 60}+${extra}'`;
  }
  return `${Math.floor(clock / 60) + 1}'`;
}

export function clockDigits(clock: number): string {
  const m = Math.floor(clock / 60);
  const s = Math.floor(clock % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
