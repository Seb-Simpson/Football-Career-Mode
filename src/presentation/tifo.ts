/**
 * Pre-match tifo: the home end turns card by card into a giant display in the
 * club's colours. Purely presentational; uses its own randomness.
 */
import type { Kit } from '../domain/types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  color: string;
}

function lum(c: string): number {
  const n = parseInt(c.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export class TifoScene {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cols = 0;
  private rows = 0;
  private target: string[] = [];
  private crowd: string[] = [];
  private delay: Float32Array = new Float32Array(0);
  private particles: Particle[] = [];
  private seed = 987654321;

  constructor(
    private canvas: HTMLCanvasElement,
    private kit: Kit,
    private short: string,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  private rnd() {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    return this.seed / 4294967296;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.build();
  }

  private build() {
    const cell = Math.max(6, Math.min(12, this.w / 96));
    this.cols = Math.ceil(this.w / cell);
    this.rows = Math.max(12, Math.floor((this.h * 0.62) / cell));
    const { cols, rows, kit } = this;
    // Paint the display at one pixel per card, then read it back.
    const off = document.createElement('canvas');
    off.width = cols;
    off.height = rows;
    const c = off.getContext('2d')!;
    const a = kit.primary;
    const b = kit.secondary;
    c.fillStyle = a;
    c.fillRect(0, 0, cols, rows);
    c.fillStyle = b;
    const band = Math.max(3, Math.round(cols / 14));
    if (kit.pattern === 'stripes') for (let x = 0; x < cols; x += band * 2) c.fillRect(x, 0, band, rows);
    else if (kit.pattern === 'pinstripe') for (let x = band; x < cols; x += band) c.fillRect(x, 0, 1, rows);
    else if (kit.pattern === 'hoops') {
      const hb = Math.max(2, Math.round(rows / 7));
      for (let y = hb; y < rows; y += hb * 2) c.fillRect(0, y, cols, hb);
    } else if (kit.pattern === 'halves') c.fillRect(cols / 2, 0, cols / 2, rows);
    else if (kit.pattern === 'sash') {
      c.beginPath();
      c.moveTo(0, rows * 0.1);
      c.lineTo(cols * 0.16, 0);
      c.lineTo(cols, rows * 0.9);
      c.lineTo(cols * 0.84, rows);
      c.closePath();
      c.fill();
    } else {
      // solid: chevrons at each end
      for (const side of [0, 1]) {
        c.beginPath();
        const x0 = side ? cols : 0;
        const d = side ? -1 : 1;
        c.moveTo(x0, 0);
        c.lineTo(x0 + d * cols * 0.1, 0);
        c.lineTo(x0 + d * cols * 0.2, rows / 2);
        c.lineTo(x0 + d * cols * 0.1, rows);
        c.lineTo(x0, rows);
        c.closePath();
        c.fill();
      }
    }
    c.fillRect(0, 0, cols, 2);
    c.fillRect(0, rows - 2, cols, 2);
    // Club letters across the middle.
    const letters = this.short.split('').join(' ');
    let size = Math.round(rows * 0.74);
    const face = '"Big Shoulders Display", "Arial Narrow", Impact, sans-serif';
    c.font = `900 ${size}px ${face}`;
    const measured = c.measureText(letters).width;
    if (measured > cols * 0.8) size = Math.floor((size * cols * 0.8) / measured);
    c.font = `900 ${size}px ${face}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const dark = '#0f1a2e';
    const text = lum(a) > 0.6 ? dark : '#ffffff';
    c.lineWidth = Math.max(2, size * 0.16);
    c.lineJoin = 'round';
    c.strokeStyle = text === '#ffffff' ? dark : '#ffffff';
    c.strokeText(letters, cols / 2, rows / 2 + 1);
    c.fillStyle = text;
    c.fillText(letters, cols / 2, rows / 2 + 1);
    const data = c.getImageData(0, 0, cols, rows).data;
    this.target = [];
    this.crowd = [];
    this.delay = new Float32Array(cols * rows);
    const palette = ['#2a3445', '#39465c', '#55473d', '#6d5a4c', '#8b8f96', '#1e2633', a, a, b];
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const i = (r * cols + col) * 4;
        this.target.push(`rgb(${data[i]},${data[i + 1]},${data[i + 2]})`);
        this.crowd.push(palette[Math.floor(this.rnd() * palette.length)]);
        const d = Math.abs(col - cols / 2) / (cols / 2);
        this.delay[r * cols + col] = 0.9 + d * 1.5 + (r / rows) * 0.35 + this.rnd() * 0.22;
      }
    }
    this.particles = [];
    for (let i = 0; i < 90; i++) {
      this.particles.push({
        x: this.rnd() * this.w,
        y: -this.rnd() * this.h,
        vx: (this.rnd() - 0.5) * 30,
        vy: 60 + this.rnd() * 90,
        rot: this.rnd() * 6,
        color: this.rnd() < 0.5 ? a : this.rnd() < 0.6 ? b : '#ffffff',
      });
    }
  }

  render(t: number, dt: number) {
    const { ctx, w, h, cols, rows } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Night sky and roof
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.2);
    sky.addColorStop(0, '#05080e');
    sky.addColorStop(1, '#0d1522');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    const standTop = h * 0.16;
    const cell = w / cols;
    const standBottom = standTop + rows * cell;

    // Stand body
    ctx.fillStyle = '#0c121c';
    ctx.fillRect(0, standTop - 6, w, standBottom - standTop + 12);

    // Cards
    const gap = Math.max(0.6, cell * 0.12);
    for (let r = 0; r < rows; r++) {
      const depth = 0.62 + 0.38 * (r / rows);
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const p = (t - this.delay[i]) / 0.38;
        const x = c * cell;
        const y = standTop + r * cell;
        if (p <= 0) {
          // Crowd before the reveal: a little idle sway
          const sway = Math.sin(t * 2 + c * 0.7 + r) * 0.4;
          ctx.globalAlpha = 0.55 * depth;
          ctx.fillStyle = this.crowd[i];
          ctx.fillRect(x + gap, y + gap + sway + cell * 0.2, cell - gap * 2, cell * 0.62);
        } else if (p < 1) {
          const sc = Math.abs(Math.cos(p * Math.PI));
          ctx.globalAlpha = depth;
          ctx.fillStyle = p < 0.5 ? this.crowd[i] : this.target[i];
          const ch = (cell - gap * 2) * sc;
          ctx.fillRect(x + gap, y + cell / 2 - ch / 2, cell - gap * 2, ch);
        } else {
          const shimmer = 0.86 + 0.14 * Math.sin(t * 3.2 - c * 0.22 + r * 0.35);
          ctx.globalAlpha = depth * shimmer;
          ctx.fillStyle = this.target[i];
          ctx.fillRect(x + gap * 0.5, y + gap * 0.5, cell - gap, cell - gap);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Roof and floodlights
    ctx.fillStyle = '#070b12';
    ctx.fillRect(0, standTop - 26, w, 22);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 46) {
      ctx.beginPath();
      ctx.moveTo(x, standTop - 26);
      ctx.lineTo(x + 23, standTop - 4);
      ctx.lineTo(x + 46, standTop - 26);
      ctx.stroke();
    }
    for (const fx of [w * 0.14, w * 0.86]) {
      const fy = standTop - 40;
      const pulse = 0.85 + 0.15 * Math.sin(t * 2 + fx);
      const g = ctx.createRadialGradient(fx, fy, 2, fx, fy, h * 0.55);
      g.addColorStop(0, `rgba(255,250,230,${0.55 * pulse})`);
      g.addColorStop(0.12, `rgba(255,250,230,${0.16 * pulse})`);
      g.addColorStop(1, 'rgba(255,250,230,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fffbe8';
      for (let k = -2; k <= 2; k++) ctx.fillRect(fx + k * 9 - 3, fy - 4, 6, 8);
    }

    // Flares at the foot of the stand
    for (const [sx, phase] of [
      [w * 0.08, 0],
      [w * 0.92, 2],
      [w * 0.5, 4],
    ] as [number, number][]) {
      const a = Math.max(0, Math.min(1, (t - 2.2) / 1.5)) * (0.35 + 0.1 * Math.sin(t * 3 + phase));
      const rise = (t * 22 + phase * 40) % (h * 0.5);
      const g = ctx.createRadialGradient(sx, standBottom - rise * 0.5, 4, sx, standBottom - rise * 0.5, h * 0.3);
      g.addColorStop(0, this.rgba(lum(this.kit.primary) > 0.75 ? this.kit.secondary : this.kit.primary, a));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // Big flags either side
    this.flag(w * 0.03, standBottom + 4, h * 0.2, t, 0);
    this.flag(w * 0.12, standBottom + 4, h * 0.15, t, 1.4);
    this.flag(w * 0.97, standBottom + 4, h * 0.2, t, 2.3, -1);
    this.flag(w * 0.88, standBottom + 4, h * 0.15, t, 3.1, -1);

    // Boards and pitch edge
    const by = standBottom + 6;
    ctx.fillStyle = '#0f1b2d';
    ctx.fillRect(0, by, w, h * 0.05);
    ctx.fillStyle = this.kit.primary;
    for (let x = 0; x < w; x += w / 5) ctx.fillRect(x + 6, by + 3, w / 5 - 12, h * 0.05 - 6);
    const grass = ctx.createLinearGradient(0, by + h * 0.05, 0, h);
    grass.addColorStop(0, '#2a7444');
    grass.addColorStop(1, '#1b4f30');
    ctx.fillStyle = grass;
    ctx.fillRect(0, by + h * 0.05, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(0, by + h * 0.05 + 10, w, 3);

    // Ticker tape once the display is up
    if (t > 2.4) {
      for (const p of this.particles) {
        p.x += (p.vx + Math.sin(t * 2 + p.rot) * 20) * dt;
        p.y += p.vy * dt;
        p.rot += dt * 4;
        if (p.y > h) {
          p.y = -10;
          p.x = Math.random() * w;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(-4, -1.5, 8, 3);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    // Vignette
    const v = ctx.createRadialGradient(w / 2, h * 0.45, h * 0.3, w / 2, h * 0.45, Math.max(w, h) * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }

  private rgba(hex: string, a: number) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  private flag(x: number, baseY: number, size: number, t: number, phase: number, dir = 1) {
    const ctx = this.ctx;
    const sway = Math.sin(t * 1.6 + phase) * 0.22;
    ctx.save();
    ctx.translate(x, baseY);
    ctx.rotate(sway * dir);
    ctx.strokeStyle = '#d8dde4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -size);
    ctx.stroke();
    const fw = size * 0.85 * dir;
    const fh = size * 0.5;
    const segs = 10;
    const wave = (k: number) => Math.sin(t * 5 + k * 0.8 + phase) * size * 0.035 * (k / segs + 0.2);
    for (const [color, y0, y1] of [
      [this.kit.primary, 0, 1],
      [this.kit.secondary, 0.36, 0.64],
    ] as [string, number, number][]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let k = 0; k <= segs; k++) ctx.lineTo((fw * k) / segs, -size + fh * y0 + wave(k));
      for (let k = segs; k >= 0; k--) ctx.lineTo((fw * k) / segs, -size + fh * y1 + wave(k));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}
