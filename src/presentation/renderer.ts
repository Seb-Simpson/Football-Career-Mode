/**
 * Match presentation. Reads recorded engine frames only; it never alters the
 * football. Two views:
 *  - broadcast: side-on perspective camera from the main stand that tracks the ball
 *  - tactical: top-down full pitch with numbered discs
 * Visual randomness (crowd, skin tones) uses its own hash, never the match RNG.
 */
import type { Frame } from '../simulation/match/engine';
import { MAX_PER_TEAM } from '../simulation/match/engine';
import type { Kit } from '../domain/types';

export interface EntityInfo {
  number: number;
  keeper: boolean;
  name: string;
  id: string;
}

export interface RenderTeams {
  kits: [Kit, Kit];
  entities: [EntityInfo[], EntityInfo[]];
}

const L = 105;
const W = 68;
const SKIN = ['#f1c7a5', '#d9a07a', '#b07850', '#8a5a3b', '#5e3b26'];
const HAIR = ['#2b1d14', '#4a3020', '#1a1a1a', '#7a5230', '#c49a5a'];
const KEEPER_KITS: [Kit, Kit] = [
  { primary: '#c8f04a', secondary: '#1d2a10', pattern: 'solid' },
  { primary: '#ff8a2a', secondary: '#2a1606', pattern: 'solid' },
];
const SPONSORS = ['NORTHWIND', 'HALDEN ALES', 'BRIGHTLINE', 'KESTREL BANK', 'OAKMERE', 'VOLTA', 'PEREGRINE AIR', 'SALT & SONS'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class PitchRenderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  mode: 'broadcast' | 'tactical' = 'broadcast';
  private camX = L / 2;
  private camReady = false;
  private phase = new Float32Array(MAX_PER_TEAM * 2);
  private lastPos = new Float32Array(MAX_PER_TEAM * 4);
  private crowd: HTMLCanvasElement | null = null;
  private trail: [number, number, number][] = [];
  reducedMotion = false;
  // projection constants (recomputed on resize)
  private f = 800;
  private cy0 = 0;
  private readonly camYPos = -32;
  private readonly camZ = 21;
  private readonly lookY = 30;

  constructor(
    private canvas: HTMLCanvasElement,
    private teams: RenderTeams,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.fitCamera();
    this.crowd = null;
  }

  // ------------------------------------------------------------ projection

  private basis() {
    const fy = this.lookY - this.camYPos;
    const fz = -this.camZ;
    const n = Math.hypot(fy, fz);
    return { fy: fy / n, fz: fz / n, uy: -fz / n, uz: fy / n };
  }

  /** Returns [sx, sy, pixelsPerMetre] for a world point. */
  project(x: number, y: number, z: number): [number, number, number] {
    const { fy, fz, uy, uz } = this.basis();
    const dx = x - this.camX;
    const dy = y - this.camYPos;
    const dz = z - this.camZ;
    const depth = dy * fy + dz * fz;
    const up = dy * uy + dz * uz;
    const s = this.f / Math.max(1, depth);
    return [this.w / 2 + dx * s, this.cy0 - up * s, s];
  }

  private fitCamera() {
    // Fit the pitch's depth into the canvas height and width.
    const { fy, fz, uy, uz } = this.basis();
    const v = (y: number) => {
      const dy = y - this.camYPos;
      const dz = -this.camZ;
      return (dy * uy + dz * uz) / (dy * fy + dz * fz);
    };
    const span = v(W + 3) - v(-1.5);
    // Fill most of the height with the pitch depth; on very wide screens zoom in a
    // little more so players stay readable. Width is covered by panning.
    const fByHeight = (this.h * 0.84) / span;
    this.f = Math.max(fByHeight, this.w * 1.15);
    // Far touchline (plus boards) near the top.
    this.cy0 = this.h * 0.13 + v(W + 3) * this.f;
  }

  // ---------------------------------------------------------------- render

  render(a: Frame, b: Frame | null, t: number, dt: number, focusTeam: number | null = null) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const lerp = (p: number, q: number) => p + (q - p) * t;
    const bb = b ?? a;
    const ball: [number, number, number] = [lerp(a.ball[0], bb.ball[0]), lerp(a.ball[1], bb.ball[1]), lerp(a.ball[2], bb.ball[2])];
    const ents: { team: 0 | 1; e: number; x: number; y: number; vx: number; vy: number }[] = [];
    for (let k = 0; k < MAX_PER_TEAM * 2; k++) {
      if (!a.present[k]) continue;
      const hasB = bb.present[k];
      const x = hasB ? lerp(a.pos[k * 2], bb.pos[k * 2]) : a.pos[k * 2];
      const y = hasB ? lerp(a.pos[k * 2 + 1], bb.pos[k * 2 + 1]) : a.pos[k * 2 + 1];
      const vx = hasB ? bb.pos[k * 2] - a.pos[k * 2] : 0;
      const vy = hasB ? bb.pos[k * 2 + 1] - a.pos[k * 2 + 1] : 0;
      ents.push({ team: (k < MAX_PER_TEAM ? 0 : 1) as 0 | 1, e: k % MAX_PER_TEAM, x, y, vx, vy });
      // running phase from distance moved
      const lx = this.lastPos[k * 2];
      const ly = this.lastPos[k * 2 + 1];
      const moved = Math.hypot(x - lx, y - ly);
      if (moved < 3) this.phase[k] += moved * 2.6;
      this.lastPos[k * 2] = x;
      this.lastPos[k * 2 + 1] = y;
    }
    const ownerIdx = a.owner;

    this.trail.push(ball);
    if (this.trail.length > 6) this.trail.shift();

    if (this.mode === 'broadcast') this.drawBroadcast(ents, ball, ownerIdx, dt, focusTeam);
    else this.drawTactical(ents, ball, ownerIdx);
  }

  // ------------------------------------------------------------- broadcast

  private drawBroadcast(ents: { team: 0 | 1; e: number; x: number; y: number; vx: number; vy: number }[], ball: [number, number, number], owner: number, dt: number, _focus: number | null) {
    const ctx = this.ctx;
    // Camera: lead the ball, clamp to keep the pitch in frame.
    const halfView = (this.w / 2) / (this.f / Math.hypot(this.lookY - this.camYPos, this.camZ));
    const target = Math.max(halfView - 8, Math.min(L - halfView + 8, ball[0]));
    if (!this.camReady) {
      this.camX = target;
      this.camReady = true;
    }
    const k = Math.min(1, dt * (this.reducedMotion ? 1.2 : 2.4));
    this.camX += (target - this.camX) * k;

    // Base fill (the near-side apron is grass to the bottom edge)
    ctx.fillStyle = '#1f5a35';
    ctx.fillRect(0, 0, this.w, this.h);
    // Sky / stand backdrop
    const [, boardTop] = this.project(this.camX, W + 3, 1.1);
    const g = ctx.createLinearGradient(0, 0, 0, boardTop);
    g.addColorStop(0, '#0b1420');
    g.addColorStop(1, '#16202e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, boardTop + 2);
    this.drawCrowd(boardTop);

    // Grass surround
    this.quad(-12, -14, L + 12, W + 3, '#1f5a35');
    // Stripes
    const bands = 18;
    for (let i = 0; i < bands; i++) {
      const x0 = (L / bands) * i;
      const x1 = (L / bands) * (i + 1);
      this.quad(x0, 0, x1, W, i % 2 ? '#2a7444' : '#2f7d4a');
    }
    // Floodlight pools
    const [lx, ly] = this.project(L / 2, W / 2, 0);
    const pool = ctx.createRadialGradient(lx, ly, 10, lx, ly, this.w * 0.9);
    pool.addColorStop(0, 'rgba(255,255,240,0.08)');
    pool.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = pool;
    ctx.fillRect(0, boardTop, this.w, this.h - boardTop);

    this.drawLines();
    this.drawBoards();
    this.drawGoal(0, true);
    this.drawGoal(L, true);

    // Players, far to near
    const sorted = [...ents].sort((p, q) => q.y - p.y);
    // Shadows first
    for (const p of sorted) {
      const [sx, sy, s] = this.project(p.x, p.y, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(sx + s * 0.25, sy + s * 0.04, s * 0.5, s * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Ball shadow
    {
      const [sx, sy, s] = this.project(ball[0], ball[1], 0);
      ctx.fillStyle = `rgba(0,0,0,${Math.max(0.12, 0.35 - ball[2] * 0.04)})`;
      ctx.beginPath();
      ctx.ellipse(sx + ball[2] * s * 0.15, sy, s * 0.22, s * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    let ballDrawn = false;
    for (const p of sorted) {
      if (!ballDrawn && p.y < ball[1]) {
        this.drawBall(ball);
        ballDrawn = true;
      }
      this.drawFigure(p, p.team * MAX_PER_TEAM + p.e === owner);
    }
    if (!ballDrawn) this.drawBall(ball);

    // Front posts over players near the goal mouth
    this.drawGoal(0, false);
    this.drawGoal(L, false);

    // Name chip for the ball carrier
    if (owner >= 0) {
      const p = ents.find((q) => q.team * MAX_PER_TEAM + q.e === owner);
      if (p) {
        const info = this.teams.entities[p.team][p.e];
        const [sx, sy, s] = this.project(p.x, p.y, 2.3);
        const label = `${info.number}  ${info.name.split(' ').slice(-1)[0]}`;
        ctx.font = `700 ${Math.max(11, Math.min(14, s * 0.9))}px Archivo, system-ui, sans-serif`;
        const tw = ctx.measureText(label).width + 12;
        const kit = this.teams.kits[p.team];
        ctx.fillStyle = 'rgba(10,18,30,0.86)';
        ctx.fillRect(sx - tw / 2, sy - 20, tw, 18);
        ctx.fillStyle = kit.primary;
        ctx.fillRect(sx - tw / 2, sy - 20, 3, 18);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, sx + 1, sy - 11);
      }
    }
  }

  private quad(x0: number, y0: number, x1: number, y1: number, color: string) {
    const ctx = this.ctx;
    const a = this.project(x0, y0, 0);
    const b = this.project(x1, y0, 0);
    const c = this.project(x1, y1, 0);
    const d = this.project(x0, y1, 0);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.lineTo(d[0], d[1]);
    ctx.closePath();
    ctx.fill();
  }

  private poly(points: [number, number][], close = false) {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach(([x, y], i) => {
      const [sx, sy] = this.project(x, y, 0);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    if (close) ctx.closePath();
    ctx.stroke();
  }

  private arc(cx: number, cy: number, r: number, a0: number, a1: number) {
    const pts: [number, number][] = [];
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    this.poly(pts);
  }

  private drawLines() {
    const ctx = this.ctx;
    const [, , sMid] = this.project(L / 2, W / 2, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.86)';
    ctx.lineWidth = Math.max(1, sMid * 0.13);
    ctx.lineJoin = 'round';
    this.poly(
      [
        [0, 0],
        [L, 0],
        [L, W],
        [0, W],
      ],
      true,
    );
    this.poly([
      [L / 2, 0],
      [L / 2, W],
    ]);
    this.arc(L / 2, W / 2, 9.15, 0, Math.PI * 2);
    for (const side of [0, 1]) {
      const x0 = side ? L : 0;
      const d = side ? -1 : 1;
      this.poly([
        [x0, W / 2 - 20.16],
        [x0 + d * 16.5, W / 2 - 20.16],
        [x0 + d * 16.5, W / 2 + 20.16],
        [x0, W / 2 + 20.16],
      ]);
      this.poly([
        [x0, W / 2 - 9.16],
        [x0 + d * 5.5, W / 2 - 9.16],
        [x0 + d * 5.5, W / 2 + 9.16],
        [x0, W / 2 + 9.16],
      ]);
      const px = x0 + d * 11;
      const a = Math.acos(5.5 / 9.15);
      if (side) this.arc(px, W / 2, 9.15, Math.PI - a, Math.PI + a);
      else this.arc(px, W / 2, 9.15, -a, a);
      // spot
      const [sx, sy, s] = this.project(px, W / 2, 0);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, Math.max(1.2, s * 0.15), Math.max(0.8, s * 0.07), 0, 0, Math.PI * 2);
      ctx.fill();
      // corner arcs
      this.arc(x0, 0, 1, side ? Math.PI / 2 : 0, side ? Math.PI : Math.PI / 2);
      this.arc(x0, W, 1, side ? Math.PI : -Math.PI / 2, side ? Math.PI * 1.5 : 0);
    }
    const [sx, sy, s] = this.project(L / 2, W / 2, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, Math.max(1.2, s * 0.15), Math.max(0.8, s * 0.07), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawBoards() {
    const ctx = this.ctx;
    const y = W + 2.6;
    const span = 12;
    for (let x = -12, i = 0; x < L + 12; x += span, i++) {
      const [x0, top] = this.project(x, y, 0.95);
      const [x1, bottom] = this.project(x + span, y, 0);
      if (x1 < 0 || x0 > this.w) continue;
      const kit = this.teams.kits[i % 2];
      ctx.fillStyle = i % 3 === 0 ? '#0f1b2d' : kit.primary;
      ctx.fillRect(x0, top, x1 - x0 + 0.5, bottom - top);
      const h = bottom - top;
      if (h > 6) {
        ctx.fillStyle = i % 3 === 0 ? '#f2b233' : kit.secondary;
        ctx.font = `800 ${Math.round(h * 0.62)}px "Big Shoulders Display", "Arial Narrow", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(SPONSORS[i % SPONSORS.length], (x0 + x1) / 2, top + h * 0.54);
      }
    }
  }

  private drawCrowd(bottom: number) {
    const ctx = this.ctx;
    if (!this.crowd) {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 160;
      const cx = c.getContext('2d')!;
      let seed = 1234567;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
      cx.fillStyle = '#121b28';
      cx.fillRect(0, 0, c.width, c.height);
      // tiers
      for (let row = 0; row < 26; row++) {
        const y = row * 6 + 4;
        cx.fillStyle = row % 2 ? '#162131' : '#131d2b';
        cx.fillRect(0, y - 3, c.width, 6);
        for (let x = 0; x < c.width; x += 4 + rnd() * 2) {
          const r = rnd();
          const kit = this.teams.kits[r < 0.62 ? 0 : 1];
          cx.fillStyle = r < 0.3 ? kit.primary : r < 0.42 ? kit.secondary : ['#d9c6b0', '#6b5444', '#2c3440', '#b9b9b9', '#8a3a2a'][Math.floor(rnd() * 5)];
          cx.globalAlpha = 0.55 + rnd() * 0.35;
          cx.fillRect(x, y - 2 + rnd() * 1.5, 2.6, 2.6);
        }
      }
      cx.globalAlpha = 1;
      this.crowd = c;
    }
    const c = this.crowd;
    const scale = Math.max(0.6, bottom / c.height);
    const tw = c.width * scale;
    const offset = -((this.camX * 6) % tw);
    ctx.save();
    ctx.globalAlpha = 0.95;
    for (let x = offset - tw; x < this.w; x += tw) ctx.drawImage(c, x, bottom - c.height * scale, tw, c.height * scale);
    ctx.restore();
    // roof shadow
    const g = ctx.createLinearGradient(0, 0, 0, bottom * 0.5);
    g.addColorStop(0, 'rgba(5,9,15,0.85)');
    g.addColorStop(1, 'rgba(5,9,15,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, bottom * 0.5);
  }

  private drawGoal(x0: number, back: boolean) {
    const ctx = this.ctx;
    const d = x0 === 0 ? -1 : 1;
    const y0 = W / 2 - 3.66;
    const y1 = W / 2 + 3.66;
    const depth = 2;
    const h = 2.44;
    const P = (x: number, y: number, z: number) => this.project(x, y, z);
    if (back) {
      // net
      ctx.fillStyle = 'rgba(235,240,245,0.16)';
      const pts = [P(x0, y0, h), P(x0 + d * depth, y0, h * 0.85), P(x0 + d * depth, y1, h * 0.85), P(x0, y1, h)];
      ctx.beginPath();
      pts.forEach(([sx, sy], i) => (i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)));
      ctx.closePath();
      ctx.fill();
      const back4 = [P(x0 + d * depth, y0, 0), P(x0 + d * depth, y1, 0), P(x0 + d * depth, y1, h * 0.85), P(x0 + d * depth, y0, h * 0.85)];
      ctx.beginPath();
      back4.forEach(([sx, sy], i) => (i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 0.8;
      for (let i = 0; i <= 10; i++) {
        const y = y0 + ((y1 - y0) * i) / 10;
        const a = P(x0 + d * depth, y, 0);
        const b = P(x0 + d * depth, y, h * 0.85);
        const c = P(x0, y, h);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.stroke();
      }
      for (let i = 1; i <= 4; i++) {
        const z = (h * 0.85 * i) / 5;
        const a = P(x0 + d * depth, y0, z);
        const b = P(x0 + d * depth, y1, z);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      // far post
      this.post(x0, y1, h);
      return;
    }
    // near post and crossbar
    this.post(x0, y0, h);
    const a = P(x0, y0, h);
    const b = P(x0, y1, h);
    ctx.strokeStyle = '#f4f6f8';
    ctx.lineWidth = Math.max(2, a[2] * 0.12);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  private post(x: number, y: number, h: number) {
    const ctx = this.ctx;
    const a = this.project(x, y, 0);
    const b = this.project(x, y, h);
    ctx.strokeStyle = '#f4f6f8';
    ctx.lineWidth = Math.max(2, a[2] * 0.12);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  private drawBall(ball: [number, number, number]) {
    const ctx = this.ctx;
    // short trail when travelling fast
    if (!this.reducedMotion && this.trail.length > 2) {
      const first = this.trail[0];
      const speed = Math.hypot(ball[0] - first[0], ball[1] - first[1]);
      if (speed > 2.5) {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        const [, , s] = this.project(ball[0], ball[1], ball[2]);
        ctx.lineWidth = Math.max(1.5, s * 0.18);
        ctx.lineCap = 'round';
        ctx.beginPath();
        this.trail.forEach(([x, y, z], i) => {
          const [sx, sy] = this.project(x, y, z);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
      }
    }
    const [sx, sy, s] = this.project(ball[0], ball[1], ball[2] + 0.11);
    const r = Math.max(2.6, s * 0.2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(30,30,30,0.55)';
    ctx.beginPath();
    ctx.arc(sx - r * 0.2, sy - r * 0.1, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawFigure(p: { team: 0 | 1; e: number; x: number; y: number; vx: number; vy: number }, hasBall: boolean) {
    const ctx = this.ctx;
    const info = this.teams.entities[p.team][p.e];
    if (!info) return;
    const kit = info.keeper ? KEEPER_KITS[p.team] : this.teams.kits[p.team];
    const hsh = hash(info.id);
    const skin = SKIN[hsh % SKIN.length];
    const hair = HAIR[(hsh >> 3) % HAIR.length];
    const [fx, fy, s] = this.project(p.x, p.y, 0);
    if (fx < -40 || fx > this.w + 40) return;
    const k = p.team * MAX_PER_TEAM + p.e;
    const speed = Math.hypot(p.vx, p.vy) / 0.2;
    const running = speed > 0.6;
    const ph = this.phase[k];
    const swing = running ? Math.sin(ph) * Math.min(1, speed / 6) : 0;
    const facing = Math.abs(p.vx) > 0.02 ? Math.sign(p.vx) : p.team === 0 ? 1 : -1;
    const hip = fy - s * 0.92;
    const shoulder = fy - s * 1.48;
    const legW = Math.max(1.6, s * 0.15);
    const shorts = kit.pattern === 'solid' && kit.secondary.toLowerCase() !== kit.primary.toLowerCase() ? kit.secondary : '#f4f4f4';
    const socks = kit.primary;

    ctx.lineCap = 'round';
    // legs
    for (const side of [-1, 1]) {
      const sw = swing * side;
      const footX = fx + sw * s * 0.32 * facing + side * s * 0.06;
      const kneeX = fx + sw * s * 0.2 * facing + side * s * 0.07;
      const kneeY = fy - s * 0.45 + Math.max(0, -sw) * s * 0.06;
      // thigh
      ctx.strokeStyle = shorts;
      ctx.lineWidth = legW * 1.25;
      ctx.beginPath();
      ctx.moveTo(fx + side * s * 0.08, hip);
      ctx.lineTo(kneeX, (hip + kneeY) / 2 + s * 0.02);
      ctx.stroke();
      ctx.strokeStyle = skin;
      ctx.lineWidth = legW;
      ctx.beginPath();
      ctx.moveTo(kneeX, (hip + kneeY) / 2 + s * 0.04);
      ctx.lineTo(kneeX, kneeY);
      ctx.stroke();
      ctx.strokeStyle = socks;
      ctx.beginPath();
      ctx.moveTo(kneeX, kneeY);
      ctx.lineTo(footX, fy - s * 0.04);
      ctx.stroke();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = legW * 0.9;
      ctx.beginPath();
      ctx.moveTo(footX, fy - s * 0.03);
      ctx.lineTo(footX + facing * s * 0.12, fy - s * 0.02);
      ctx.stroke();
    }
    // arms (behind torso edge)
    for (const side of [-1, 1]) {
      const sw = -swing * side;
      ctx.strokeStyle = skin;
      ctx.lineWidth = legW * 0.8;
      ctx.beginPath();
      ctx.moveTo(fx + side * s * 0.22, shoulder + s * 0.06);
      ctx.lineTo(fx + side * s * 0.27 + sw * s * 0.2 * facing, shoulder + s * 0.5);
      ctx.stroke();
    }
    // torso
    const tw = s * 0.5;
    const th = hip - shoulder + s * 0.08;
    const tx = fx - tw / 2;
    const ty = shoulder;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(tx + tw * 0.1, ty);
    ctx.lineTo(tx + tw * 0.9, ty);
    ctx.lineTo(tx + tw, ty + th * 0.25);
    ctx.lineTo(tx + tw * 0.92, ty + th);
    ctx.lineTo(tx + tw * 0.08, ty + th);
    ctx.lineTo(tx, ty + th * 0.25);
    ctx.closePath();
    ctx.fillStyle = kit.primary;
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = kit.secondary;
    if (kit.pattern === 'stripes') for (let i = 0; i < 3; i++) ctx.fillRect(tx + tw * (0.18 + i * 0.3), ty, tw * 0.13, th);
    else if (kit.pattern === 'pinstripe') for (let i = 0; i < 4; i++) ctx.fillRect(tx + tw * (0.15 + i * 0.23), ty, Math.max(0.6, tw * 0.04), th);
    else if (kit.pattern === 'hoops') for (let i = 0; i < 2; i++) ctx.fillRect(tx, ty + th * (0.25 + i * 0.4), tw, th * 0.18);
    else if (kit.pattern === 'halves') ctx.fillRect(fx, ty, tw / 2, th);
    else if (kit.pattern === 'sash') {
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + tw * 0.3, ty);
      ctx.lineTo(tx + tw, ty + th * 0.75);
      ctx.lineTo(tx + tw, ty + th);
      ctx.lineTo(tx + tw * 0.7, ty + th);
      ctx.closePath();
      ctx.fill();
    } else ctx.fillRect(tx, ty, tw, th * 0.12);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // head
    const headR = Math.max(1.8, s * 0.13);
    const hy = shoulder - headR * 1.05;
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(fx, hy, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(fx, hy - headR * 0.15, headR * 1.02, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    if (hasBall) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(fx, fy, s * 0.6, s * 0.2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // -------------------------------------------------------------- tactical

  private drawTactical(ents: { team: 0 | 1; e: number; x: number; y: number }[], ball: [number, number, number], owner: number) {
    const ctx = this.ctx;
    const pad = 18;
    const sc = Math.min((this.w - pad * 2) / (L + 6), (this.h - pad * 2) / (W + 6));
    const ox = (this.w - L * sc) / 2;
    const oy = (this.h - W * sc) / 2;
    const X = (x: number) => ox + x * sc;
    const Y = (y: number) => oy + (W - y) * sc;
    ctx.fillStyle = '#163d27';
    ctx.fillRect(0, 0, this.w, this.h);
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = i % 2 ? '#1d5032' : '#205737';
      ctx.fillRect(X((L / 18) * i), Y(W), (L / 18) * sc + 0.5, W * sc);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(X(0), Y(W), L * sc, W * sc);
    ctx.beginPath();
    ctx.moveTo(X(L / 2), Y(0));
    ctx.lineTo(X(L / 2), Y(W));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(X(L / 2), Y(W / 2), 9.15 * sc, 0, Math.PI * 2);
    ctx.stroke();
    for (const side of [0, 1]) {
      const x0 = side ? L - 16.5 : 0;
      ctx.strokeRect(X(x0), Y(W / 2 + 20.16), 16.5 * sc, 40.32 * sc);
      const x1 = side ? L - 5.5 : 0;
      ctx.strokeRect(X(x1), Y(W / 2 + 9.16), 5.5 * sc, 18.32 * sc);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(side ? X(L) : X(0) - 2.2 * sc, Y(W / 2 + 3.66), 2.2 * sc, 7.32 * sc);
    }
    // players
    const r = Math.max(7, sc * 1.25);
    for (const p of ents) {
      const info = this.teams.entities[p.team][p.e];
      if (!info) continue;
      const kit = info.keeper ? KEEPER_KITS[p.team] : this.teams.kits[p.team];
      const x = X(p.x);
      const y = Y(p.y);
      if (p.team * MAX_PER_TEAM + p.e === owner) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = kit.primary;
      ctx.strokeStyle = kit.secondary;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = luminanceHex(kit.primary) > 0.5 ? '#13203a' : '#fff';
      ctx.font = `800 ${Math.round(r * 1.15)}px "Big Shoulders Display", "Arial Narrow", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(info.number), x, y + 0.5);
    }
    // ball
    const bx = X(ball[0]);
    const by = Y(ball[1]) - ball[2] * sc * 0.4;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(X(ball[0]), Y(ball[1]), Math.max(3, sc * 0.4), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(bx, by, Math.max(4, sc * 0.45), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function luminanceHex(c: string): number {
  const n = parseInt(c.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
