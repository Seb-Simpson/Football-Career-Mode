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
    const timers: Record<RestartType, number> = { kickoff: 2.5, throw: 1.8, goalkick: 3, corner: 3.4, freekick: 2.8, penalty: 4 };
    this.restart = { type, team, x: this.bx, y: this.by, timer: timers[type], taker: null };
    this.applySubs();
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

  private positionPlayers() {
    const poss = this.possTeam();
    const r = this.restart;
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

      // Pressing: who closes the ball down.
      const pressers = new Set<MP>();
      const keeperHolding = this.owner && this.owner.slot?.pos === 'GK' && this.gkHold > 0;
      if (!attacking && !r && !keeperHolding) {
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
        const sorted = [n0, n1];
        const trigger = 10 + tac.pressing * 7;
        const ballInTheirHalf = ballU > 0.5;
        if (sorted[0] && (dist(sorted[0].x, sorted[0].y, this.bx, this.by) < trigger || !this.owner)) pressers.add(sorted[0]);
        if (sorted[1] && tac.pressing >= 3 && (ballInTheirHalf || tac.pressing === 4) && this.owner) pressers.add(sorted[1]);
        if (sorted[1] && ballU < 0.36 && this.owner) pressers.add(sorted[1]);
      }
      if (!r && !this.owner && this.ballKind !== 'shot') {
        const keeper = players.find((p) => p.slot!.pos === 'GK');
        if (keeper && this.inOwnBox(keeper, this.bx, this.by) && Math.hypot(this.bvx, this.bvy) < 14) {
          const kd = dist(keeper.x, keeper.y, this.bx, this.by);
          let oppNearest = 1e9;
          for (const o of this.onPitch(team === 0 ? 1 : 0)) oppNearest = Math.min(oppNearest, dist(o.x, o.y, this.bx, this.by));
          if (kd < oppNearest + 2) pressers.add(keeper);
        }
      }

      for (const p of players) {
        if (this.owner === p) continue;
        if (r && r.taker === p) continue;
        if (!this.owner && !r && this.intended === p) {
          // Run onto the pass.
          const [ix, iy] = this.ballArrivalPoint(p);
          this.moveToward(p, ix, iy, 1);
          continue;
        }
        if (pressers.has(p)) {
          if (!this.owner) {
            const [ix, iy] = this.ballArrivalPoint(p);
            this.moveToward(p, ix, iy, 1);
          } else {
            // Approach goal-side of the carrier.
            const gx = this.goalX(team === 0 ? 1 : 0);
            const ox = this.owner.x + (this.dir(team) > 0 ? -1 : 1) * 0.0;
            const ang = Math.atan2(PITCH_W / 2 - this.owner.y, (gx === 0 ? PITCH_L : 0) - ox);
            void ang;
            const sideX = this.owner.x - this.dir(team) * 0.8;
            this.moveToward(p, sideX, this.owner.y, 0.95 + 0.05 * (p.attrs.workRate / 20));
          }
          continue;
        }

        const s = p.slot!;
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
          // Rest defence: the back line stays behind the ball and below halfway-ish.
          if (defender) u = Math.min(u, 0.46 + 0.06 * mf + 0.04 * lineF, ballU - 0.18);
          v = 0.5 + (s.v - 0.5) * (1.12 + 0.28 * widthF) + (ballV - 0.5) * 0.14;
          // Forwards hold the offside line; some players occasionally mistime it.
          const lim = offLine - 0.012 + p.holdOffside / PITCH_L;
          if (u > lim) u = lim;
          if (s.pos === 'ST' || s.pos === 'LW' || s.pos === 'RW' || s.pos === 'AM') u = Math.max(u, Math.min(lim, ballU + 0.04));
        } else {
          const defender = s.u < 0.25;
          const shift = (ballU - 0.5) * 0.48 + 0.05 * lineF - 0.02 - 0.03 * (mf < 0 ? -mf : 0);
          u = s.u * 0.88 + shift + 0.03;
          v = 0.5 + (s.v - 0.5) * 0.72 + (ballV - 0.5) * 0.32;
          if (defender) {
            u = Math.max(u, 0.07 + 0.05 * lineF);
            u = Math.min(u, ballU - 0.03);
          } else {
            u = Math.min(u, ballU + 0.03);
          }
        }
        // Rest restarts: set up for corners/penalties/kickoffs.
        if (r) [u, v] = this.restartShape(team, p, s, u, v, r);
        u = clamp(u, 0.006, 0.985);
        v = clamp(v, 0.02, 0.98);
        let [tx, ty] = this.fromUV(team, u, v);

        // Marking: defenders tighten onto nearby attackers.
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
            const w = 0.55 * (p.attrs.positioning / 20) * (1 - nd / 9) + 0.15;
            const mx = near.x + (ownGoalX - near.x) * 0.08;
            const my = near.y + (PITCH_W / 2 - near.y) * 0.08;
            tx = tx + (mx - tx) * w;
            ty = ty + (my - ty) * w;
          }
        }
        const dd = dist(p.x, p.y, tx, ty);
        let urgency = dd > 12 ? 0.92 : dd > 4 ? 0.7 : 0.45;
        // Recovery runs: goal-side sprint when caught upfield.
        if (!attacking && dd > 4 && this.toU(team, p.x) > ballU) urgency = 1;
        this.moveToward(p, tx, ty, urgency);
      }
    }
  }

  private restartShape(team: 0 | 1, p: MP, s: Slot, u: number, v: number, r: Restart): [number, number] {
    const attackingSide = r.team === team;
    if (r.type === 'kickoff') {
      return [Math.min(s.u * 0.9, 0.47), s.v];
    }
    if (r.type === 'corner' || (r.type === 'freekick' && this.toU(r.team, r.x) > 0.7)) {
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

  /** Where `p` can meet the ball: a short look-ahead along the ball's path. */
  private ballArrivalPoint(p: MP): [number, number] {
    let x = this.bx;
    let y = this.by;
    let vx = this.bvx;
    let vy = this.bvy;
    const speed = 6 + p.attrs.pace * 0.13;
    for (let i = 0; i < 20; i++) {
      const t = i * 0.2;
      if (dist(p.x, p.y, x, y) <= speed * t + 0.8) break;
      x += vx * 0.2;
      y += vy * 0.2;
      const s = Math.hypot(vx, vy);
      const decel = s > 0 ? Math.max(0, s - 3.2 * 0.2) / s : 0;
      vx *= decel;
      vy *= decel;
    }
    return [clamp(x, 0, PITCH_L), clamp(y, 0, PITCH_W)];
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
    const acc = (3.6 + p.attrs.pace * 0.13) * DT;
    const ax = clamp(dvx - p.vx, -acc, acc);
    const ay = clamp(dvy - p.vy, -acc, acc);
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
    this.decisionTimer = (0.9 + (1 - p.attrs.decisions / 20) * 0.5) * (1.35 - tempo * 0.12) + this.rng.range(0, 0.5);
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
        const attempt = ((inFront ? 0.24 : 0.08) * (deep ? 1.5 : 1) + press * 0.02 * (0.6 + 0.4 * (o.attrs.workRate / 20))) * keeperSafe;
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
        this.decisionTimer = Math.min(this.decisionTimer, 0.2);
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
    const pFoul = clamp(0.025 + (1 - def.attrs.tackling / 20) * 0.025 + press * 0.006, 0.015, 0.08) * boxCare;
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

    type Option = { kind: 'shoot' | 'pass' | 'dribble' | 'clear' | 'cross'; util: number; target?: MP; tx?: number; ty?: number; p?: number; lofted?: boolean; through?: boolean };
    const options: Option[] = [];

    // Shoot
    const distGoal = dist(p.x, p.y, gx, PITCH_W / 2);
    const canShoot = restart === null || restart === 'penalty' || (restart === 'freekick' && distGoal < 30);
    if (canShoot && distGoal < 32 && p.slot!.pos !== 'GK') {
      const xg = this.shotXg(p);
      const bias = 1 + (tac.mentality - 2) * 0.12 + (p.attrs.finishing - 12) * 0.03;
      const longShot = distGoal > 24 ? 0.7 : distGoal < 18 ? 1.7 : 1.2;
      // Shooting usually surrenders the ball, so it must clear a cost.
      const cost = 0.07 - (tac.mentality - 2) * 0.008;
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
        const pSafe = clamp(0.35 + (block - 1.5) * 0.14 + (dr - 0.5) * 0.4, 0.05, 0.95);
        const util = pSafe * this.threat(team, tx, ty) * (0.62 + dr * 0.2) - (1 - pSafe) * lossCost;
        options.push({ kind: 'dribble', util, tx, ty, p: pSafe });
      }
    }

    // Clearance under pressure deep in own half
    if (u < 0.3 && nearestOpp < 4 && !restart) {
      options.push({ kind: 'clear', util: 0.004 + (0.3 - u) * 0.02 });
    }
    if (p.slot!.pos === 'GK' && nearestOpp < 10) {
      options.push({ kind: 'clear', util: 0.02 - nearestOpp * 0.0015 });
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
    if (best.kind === 'shoot') this.takeShot(p, restart === 'penalty');
    else if (best.kind === 'pass' || best.kind === 'cross') this.makePass(p, best.target!, best.tx!, best.ty!, !!best.lofted, best.kind === 'cross', !!best.through);
    else if (best.kind === 'clear') this.clearBall(p);
    else {
      const d = Math.hypot(best.tx! - p.x, best.ty! - p.y) || 1;
      this.carryDir = [(best.tx! - p.x) / d, (best.ty! - p.y) / d];
      this.decisionTimer = (0.8 + this.rng.range(0, 0.6)) * (1.3 - tac.tempo * 0.1);
    }
  }

  private evalPass(p: MP, m: MP, opp: MP[], lossCost: number, tac: Tactics) {
    const team = p.team;
    const restart = this.mustPass;
    const fwd = this.dir(team);
    const offLine = this.offsideLineU(team);
    const mU = this.toU(team, m.x);
    const isForward = m.slot!.pos === 'ST' || m.slot!.pos === 'LW' || m.slot!.pos === 'RW' || m.slot!.pos === 'AM';

    // Through ball: forwards near the line, aim into space behind it.
    let tx = m.x + m.vx * 0.6;
    let ty = m.y + m.vy * 0.6;
    let through = false;
    if (isForward && !restart && offLine - mU < 0.06 && offLine < 0.95 && this.toU(team, p.x) > 0.35) {
      through = true;
      const [lx] = this.fromUV(team, Math.min(0.88, offLine + 0.08), 0);
      tx = lx;
      ty = clamp(m.y + (PITCH_W / 2 - m.y) * 0.25, 4, PITCH_W - 4);
    }
    tx = clamp(tx, 1, PITCH_L - 1);
    ty = clamp(ty, 1, PITCH_W - 1);
    const d = dist(p.x, p.y, tx, ty);
    if (d < 4 || d > 55) return null;
    if (restart === 'throw' && d > 28) return null;

    const box = Math.abs(this.goalX(team) - tx) < BOX_DEPTH && Math.abs(ty - PITCH_W / 2) < BOX_HALF;
    const wide = Math.abs(p.y - PITCH_W / 2) > 18 && this.toU(team, p.x) > 0.68;
    const cross = wide && box && !restart;
    const lofted = cross || d > 28 || restart === 'corner' || (restart === 'goalkick' && d > 30);

    const speed = lofted ? 18 : clamp(d * 0.9 + 8, 10, 24);
    let laneRisk = 0;
    let recvPressure = 99;
    for (const o of opp) {
      const dr = dist(o.x, o.y, tx, ty);
      if (dr < recvPressure) recvPressure = dr;
      if (lofted) continue;
      const [dl, t] = segDist(o.x, o.y, p.x, p.y, tx, ty);
      if (t < 0.02) continue;
      const ballT = (t * d) / speed;
      const reach = dl / (6 + o.attrs.pace * 0.1) + 0.15;
      const r = 1 / (1 + Math.exp((reach - ballT - 0.15) * 5));
      if (r > laneRisk) laneRisk = r;
    }
    const pressureRisk = lofted ? Math.exp(-recvPressure / 2.2) * 0.75 : Math.exp(-recvPressure / 2.5) * 0.45;
    const passSkill = this.skill(p, 'passing') * 0.7 + this.skill(p, 'decisions') * 0.3;
    const errorRisk = (1 - passSkill) * 0.35 * (d / 30) + (lofted ? 0.12 : 0);
    const pOk = clamp((1 - laneRisk * 0.85) * (1 - pressureRisk) * (1 - errorRisk), 0.02, 0.98);

    let value = this.threat(team, tx, ty);
    if (cross) value = Math.max(value, 0.06 + (m.attrs.heading / 20) * 0.05);
    const progress = (tx - p.x) * fwd;
    value += ((tac.directness - 2) * 0.0012 * progress) / 10;
    // Possession sides prefer the safe pass; mentality nudges risk appetite.
    const safety = (2 - tac.directness) * 0.004;
    const ownBoxTarget = this.toU(team, tx) < 0.16 && Math.abs(ty - PITCH_W / 2) < BOX_HALF;
    const lc = lossCost * (ownBoxTarget ? 2.5 : 1);
    const util = pOk * (value + safety) - (1 - pOk) * lc * (1 + (2 - tac.directness) * 0.15) - (ownBoxTarget && recvPressure < 8 ? 0.01 : 0);
    // Rough offside avoidance: passing to someone already beyond the line is poor.
    const offside = !restart || restart === 'freekick' ? mU > offLine + 0.004 && mU > 0.5 : false;
    return {
      kind: (cross ? 'cross' : 'pass') as 'cross' | 'pass',
      util: offside ? util - 0.03 : util,
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
    const press = Math.min(...this.onPitch(team === 0 ? 1 : 0).map((o) => dist(o.x, o.y, p.x, p.y)), 20);
    const err = (0.4 + d * 0.06) * (1.25 - passSkill) * (press < 2 ? 1.5 : 1) * (lofted ? 1.4 : 1);
    const ex = tx + this.rng.gauss(0, err);
    const ey = ty + this.rng.gauss(0, err);
    const dd = dist(p.x, p.y, ex, ey) || 1;
    let speed: number;
    if (lofted) {
      speed = clamp(dd * 0.55 + 7, 12, 26);
      const flight = dd / speed;
      this.bvz = (9.81 * flight) / 2;
    } else {
      // Ground passes decelerate; give enough pace to arrive briskly.
      speed = clamp(Math.sqrt(2 * 3.2 * dd) + 4, 9, 26);
      this.bvz = 0;
    }
    this.bvx = ((ex - p.x) / dd) * speed;
    this.bvy = ((ey - p.y) / dd) * speed;
    this.bz = 0.1;
    p.passes++;
    this.stats.passes[team]++;
    this.passer = p;
    this.intended = m;
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
        if (dl < 1.1 && t > 0.03 && t < 0.6 && this.rng.chance(0.28 + o.attrs.positioning * 0.012)) {
          this.pushEvent('block', o.team, { player: o.id, other: p.id, xg });
          this.pushEvent('shot', team, { player: p.id, xg, detail: 'blocked' });
          this.lastTouch = o;
          this.owner = null;
          this.ballKind = 'loose';
          this.passer = null;
          this.intended = null;
          const a = Math.atan2(p.y - o.y, p.x - o.x) + this.rng.range(-1.2, 1.2);
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
    const pGoal = clamp(xg * finishMult * gkMult * (penalty ? 1 : 0.3), 0.004, 0.9);
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
    // Integrate flight.
    this.bx += this.bvx * DT;
    this.by += this.bvy * DT;
    if (this.bz > 0 || this.bvz > 0) {
      this.bz += this.bvz * DT;
      this.bvz -= 9.81 * DT;
      if (this.bz <= 0) {
        this.bz = 0;
        if (this.bvz < -2.5) {
          this.bvz = -this.bvz * 0.42;
          this.bvx *= 0.75;
          this.bvy *= 0.75;
        } else this.bvz = 0;
      }
    }
    if (this.bz <= 0.05) {
      const s = Math.hypot(this.bvx, this.bvy);
      if (s > 0) {
        const ns = Math.max(0, s - 3.2 * DT);
        this.bvx *= ns / s;
        this.bvy *= ns / s;
      }
    } else {
      this.bvx *= 0.995;
      this.bvy *= 0.995;
    }

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

    // Contest for the ball along this tick's path.
    const candidates: { p: MP; d: number }[] = [];
    this.noTouchT -= DT;
    for (const team of [0, 1] as const) {
      for (const p of this.onPitch(team)) {
        if (p === this.noTouch && this.noTouchT > 0) continue;
        const [d] = segDist(p.x, p.y, px, py, this.bx, this.by);
        const isGK = p.slot!.pos === 'GK' && this.inOwnBox(p, this.bx, this.by);
        const reach = isGK ? 1.9 : 1.15;
        const zMax = isGK ? 2.8 : 2.2;
        if (d < reach && this.bz < zMax) candidates.push({ p, d });
      }
    }
    if (!candidates.length) return;
    candidates.sort((a, b) => a.d - b.d || a.p.team - b.p.team || a.p.ent - b.p.ent);
    const speed = Math.hypot(this.bvx, this.bvy);
    const kind = this.ballKind;

    for (const { p } of candidates) {
      const isGK = p.slot!.pos === 'GK' && this.inOwnBox(p, this.bx, this.by);
      const sameTeam = this.passer ? this.passer.team === p.team : this.lastTouch?.team === p.team;
      // Aerial: crosses into the box become headers.
      if (this.bz > 1.0 && (kind === 'cross' || kind === 'long' || kind === 'clear')) {
        if (isGK && !sameTeam) {
          if (this.rng.chance(0.45 + p.attrs.handling * 0.02)) {
            p.saves++;
            this.giveBall(p);
            this.gkHold = 1.6;
            return;
          }
          continue;
        }
        const winP = 0.35 + (p.attrs.heading + p.attrs.strength * 0.5) * 0.012;
        if (!this.rng.chance(winP)) continue;
        const attacking = sameTeam;
        const nearGoal = Math.abs(this.goalX(p.team) - this.bx) < 14 && Math.abs(this.by - PITCH_W / 2) < 12;
        if (attacking && nearGoal && kind === 'cross') {
          this.header(p);
          return;
        }
        // Defensive or knock-down header.
        p.touches++;
        if (!attacking) p.interceptions++;
        this.lastTouch = p;
        this.passer = null;
        this.intended = null;
        const fwd = this.dir(p.team);
        const a = Math.atan2(this.rng.range(-0.6, 0.6), fwd);
        const s = attacking ? 6 : this.rng.range(10, 18);
        this.bvx = Math.cos(a) * s * (fwd > 0 ? 1 : 1);
        this.bvy = Math.sin(a) * s;
        if (fwd < 0) this.bvx = -Math.abs(this.bvx);
        else this.bvx = Math.abs(this.bvx);
        this.bvz = attacking ? 2 : this.rng.range(3, 7);
        this.bz = Math.max(this.bz, 1.5);
        this.ballKind = 'loose';
        return;
      }
      let pCtrl: number;
      if (p === this.intended) {
        pCtrl = 0.9 + (p.attrs.dribbling + p.attrs.passing) / 40 * 0.1 - Math.max(0, speed - 18) * 0.015;
      } else if (!sameTeam && (kind === 'pass' || kind === 'through' || kind === 'long' || kind === 'cross')) {
        pCtrl = isGK ? 0.75 : 0.22 + (p.attrs.positioning / 20) * 0.3 - Math.max(0, speed - 12) * 0.02;
      } else {
        pCtrl = speed < 6 ? 0.85 : 0.6;
      }
      // Marked receivers have to win the ball against a tight defender.
      if ((p === this.intended || (sameTeam && kind !== 'loose')) && p.slot!.pos !== 'GK') {
        let marker: MP | null = null;
        let md = 1.7;
        for (const o of this.onPitch(p.team === 0 ? 1 : 0)) {
          const d = dist(o.x, o.y, p.x, p.y);
          if (d < md) (md = d), (marker = o);
        }
        if (marker) {
          const deep = this.toU(marker.team, p.x) < 0.33;
          const mk = this.skill(marker, 'positioning') * 0.5 + this.skill(marker, 'tackling') * 0.3 + this.skill(marker, 'strength') * 0.2;
          const hold = this.skill(p, 'dribbling') * 0.4 + this.skill(p, 'strength') * 0.3 + this.skill(p, 'composure') * 0.3;
          const pSteal = clamp(0.16 + (deep ? 0.06 : 0) + (mk - hold) * 0.6 - md * 0.08, 0.03, 0.5);
          if (this.rng.chance(pSteal)) {
            if (this.passer) marker.interceptions++;
            this.giveBall(marker);
            return;
          }
        }
      }
      if (this.rng.chance(clamp(pCtrl, 0.05, 0.98))) {
        if (this.passer) {
          if (this.passer.team === p.team) {
            this.passer.passesOk++;
            this.stats.passesOk[p.team]++;
          } else p.interceptions++;
        }
        this.giveBall(p);
        if (isGK && !sameTeam) this.gkHold = 1.2 + this.rng.range(0, 1.2);
        return;
      }
      // Failed touch: sometimes the ball just runs past, sometimes it deflects.
      if (speed > 4 && this.rng.chance(0.45)) {
        this.bvx *= 0.6;
        this.bvy *= 0.6;
        this.bvx += this.rng.range(-2, 2);
        this.bvy += this.rng.range(-2, 2);
        this.lastTouch = p;
        if (this.passer && this.passer.team !== p.team) {
          this.passer = null;
          this.intended = null;
          this.ballKind = 'loose';
        }
        return;
      }
    }
  }

  private header(p: MP) {
    const team = p.team;
    const gx = this.goalX(team);
    const keeper = this.gk(team === 0 ? 1 : 0);
    const xg = locationXg(Math.abs(gx - this.bx), this.by - PITCH_W / 2) * (0.35 + (p.attrs.heading / 20) * 0.45);
    this.stats.shots[team]++;
    this.stats.xg[team] += xg;
    p.shots++;
    const gkMult = keeper ? 1.25 - (keeper.attrs.reflexes / 20) * 0.4 : 2;
    const pGoal = clamp(xg * gkMult * (0.8 + p.attrs.heading / 50) * 0.45, 0.01, 0.6);
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
