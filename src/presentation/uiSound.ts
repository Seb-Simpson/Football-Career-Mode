/**
 * Tiny synthesised interface sounds. Created lazily on the first user gesture
 * and silent unless sound is enabled in settings.
 */
let ctx: AudioContext | null = null;
let enabled = true;

function ac(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slideTo?: number) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, gain: number, freq: number, when = 0, sweepTo?: number) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + when;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = 0.9;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

export const uiSound = {
  setEnabled(on: boolean) {
    enabled = on;
  },
  click() {
    tone(1900, 0.035, 'triangle', 0.03);
  },
  whoosh() {
    noise(0.32, 0.12, 500, 0, 2600);
  },
  stamp() {
    tone(140, 0.2, 'sine', 0.35, 0, 50);
    noise(0.08, 0.2, 900);
  },
  fanfare() {
    const notes = [392, 523, 659, 784];
    notes.forEach((f, i) => {
      tone(f, 0.5, 'sawtooth', 0.045, i * 0.14);
      tone(f * 2, 0.5, 'triangle', 0.03, i * 0.14);
    });
    tone(1046, 0.9, 'triangle', 0.05, 0.56);
  },
  cheer() {
    noise(1.8, 0.14, 800, 0, 1400);
  },
};
