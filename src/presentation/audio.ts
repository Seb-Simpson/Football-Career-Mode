/**
 * Procedural stadium audio (no assets): filtered noise for the crowd, a synth
 * whistle. Created only after a user gesture.
 */
export class MatchAudio {
  private ctx: AudioContext | null = null;
  private crowdGain: GainNode | null = null;
  private master: GainNode | null = null;
  private base = 0.12;
  enabled = true;

  start() {
    if (this.ctx || !this.enabled) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(ctx.destination);
      const len = ctx.sampleRate * 3;
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        let b0 = 0;
        let b1 = 0;
        let b2 = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99765 * b0 + w * 0.099046;
          b1 = 0.963 * b1 + w * 0.2965164;
          b2 = 0.57 * b2 + w * 1.0526913;
          d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
        }
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'bandpass';
      lp.frequency.value = 700;
      lp.Q.value = 0.5;
      this.crowdGain = ctx.createGain();
      this.crowdGain.gain.value = this.base;
      src.connect(lp).connect(this.crowdGain).connect(this.master);
      src.start();
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!this.master || !this.ctx) {
      if (on) this.start();
      return;
    }
    this.master.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.1);
  }

  pause(p: boolean) {
    if (!this.ctx) return;
    if (p) this.ctx.suspend();
    else this.ctx.resume();
  }

  swell(level: number, seconds: number) {
    if (!this.ctx || !this.crowdGain) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.cancelScheduledValues(t);
    this.crowdGain.gain.setTargetAtTime(this.base + level, t, 0.15);
    this.crowdGain.gain.setTargetAtTime(this.base, t + seconds, 0.8);
  }

  whistle(long = false) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const blasts = long ? [0, 0.45, 0.9] : [0];
    for (const off of blasts) {
      const o = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 2600;
      lfo.frequency.value = 28;
      lfoGain.gain.value = 120;
      lfo.connect(lfoGain).connect(o.frequency);
      g.gain.setValueAtTime(0, t + off);
      g.gain.linearRampToValueAtTime(0.12, t + off + 0.02);
      g.gain.setValueAtTime(0.12, t + off + (long && off === 0.9 ? 0.6 : 0.3));
      g.gain.linearRampToValueAtTime(0, t + off + (long && off === 0.9 ? 0.7 : 0.38));
      o.connect(g).connect(this.master);
      o.start(t + off);
      lfo.start(t + off);
      o.stop(t + off + 1);
      lfo.stop(t + off + 1);
    }
  }

  /** Rhythmic terrace clapping: short filtered noise bursts. */
  claps(bars = 2) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const pattern = [0, 0.5, 1, 1.25, 1.5, 2.25, 2.5, 3];
    for (let b = 0; b < bars; b++) {
      for (const beat of pattern) {
        const t = ctx.currentTime + 0.1 + b * 2.2 + beat * 0.55;
        const len = Math.floor(ctx.sampleRate * 0.09);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1500;
        bp.Q.value = 0.8;
        const g = ctx.createGain();
        g.gain.value = 0.5;
        src.connect(bp).connect(g).connect(this.master);
        src.start(t);
      }
    }
  }

  stop() {
    this.ctx?.close();
    this.ctx = null;
  }
}
