/**
 * Game audio: music, stadium crowd and effects, mixed through Web Audio.
 *
 * Mobile notes:
 * - Browsers only allow audio after a user gesture, so the context is created
 *   and resumed inside the first tap/click/keypress and on every later one.
 * - iPhones silence Web Audio when the ring/silent switch is on. Declaring a
 *   "playback" audio session (Safari 16.4+) and briefly playing a silent media
 *   element moves the page into the media category so the sound is heard.
 */
import applauseUrl from '../assets/audio/applause.mp3';
import chantAUrl from '../assets/audio/chant-a.mp3';
import chantBUrl from '../assets/audio/chant-b.mp3';
import chantCUrl from '../assets/audio/chant-c.mp3';
import crowdBedUrl from '../assets/audio/crowd-bed.mp3';
import goalRoarUrl from '../assets/audio/goal-roar.mp3';
import kickUrl from '../assets/audio/kick.mp3';
import musicDressingUrl from '../assets/audio/music-dressing-room.mp3';
import musicFloodlightsUrl from '../assets/audio/music-floodlights.mp3';
import oohUrl from '../assets/audio/ooh.mp3';
import whistleLongUrl from '../assets/audio/whistle-long.mp3';
import whistleShortUrl from '../assets/audio/whistle-short.mp3';

const URLS = {
  applause: applauseUrl,
  chantA: chantAUrl,
  chantB: chantBUrl,
  chantC: chantCUrl,
  crowdBed: crowdBedUrl,
  goalRoar: goalRoarUrl,
  kick: kickUrl,
  musicDressing: musicDressingUrl,
  musicFloodlights: musicFloodlightsUrl,
  ooh: oohUrl,
  whistleLong: whistleLongUrl,
  whistleShort: whistleShortUrl,
} as const;

export type SoundName = keyof typeof URLS;
export type MusicTrack = 'musicDressing' | 'musicFloodlights';

// A tiny silent WAV used to switch iOS into the media playback category.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

interface Loop {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

class SoundEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private crowdBus!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  private buffers = new Map<SoundName, Promise<AudioBuffer | null>>();
  private music: { track: MusicTrack; loop: Loop } | null = null;
  private wantedMusic: MusicTrack | null = null;
  private crowd: Loop | null = null;
  private chant: { gain: GainNode; src: AudioBufferSourceNode } | null = null;
  private crowdLevel = 0;
  musicOn = true;
  soundOn = true;
  private unlocked = false;

  /** Install gesture listeners once; audio starts on the first interaction. */
  install() {
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) window.addEventListener(ev, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => undefined);
      else if (this.unlocked) this.ctx.resume().catch(() => undefined);
    });
  }

  private unlock() {
    try {
      const nav = navigator as unknown as { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      /* not supported */
    }
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
      } catch {
        return;
      }
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(c.destination);
      this.musicBus = c.createGain();
      this.musicBus.gain.value = this.musicOn ? 0.55 : 0;
      this.musicBus.connect(this.master);
      this.sfxBus = c.createGain();
      this.sfxBus.gain.value = this.soundOn ? 1 : 0;
      this.sfxBus.connect(this.master);
      this.crowdFilter = c.createBiquadFilter();
      this.crowdFilter.type = 'lowpass';
      this.crowdFilter.frequency.value = 6000;
      this.crowdBus = c.createGain();
      this.crowdBus.gain.value = this.soundOn ? 1 : 0;
      this.crowdFilter.connect(this.crowdBus).connect(this.master);
      // Media-element nudge for older iOS silent-switch behaviour.
      try {
        const el = new Audio(SILENT_WAV);
        el.setAttribute('playsinline', '');
        el.play().catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => undefined);
    if (!this.unlocked) {
      this.unlocked = true;
      if (this.wantedMusic) this.playMusic(this.wantedMusic);
      if (this.crowdLevel > 0) this.startCrowd(this.crowdLevel);
    }
  }

  private load(name: SoundName): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name);
    if (!p) {
      p = fetch(URLS[name])
        .then((r) => r.arrayBuffer())
        .then(
          (data) =>
            new Promise<AudioBuffer | null>((resolve) => {
              if (!this.ctx) return resolve(null);
              // Callback form for older Safari.
              this.ctx.decodeAudioData(data, resolve, () => resolve(null));
            }),
        )
        .catch(() => null);
      this.buffers.set(name, p);
    }
    return p;
  }

  /** Warm the cache so the first goal roar isn't late. */
  preload(names: SoundName[]) {
    if (!this.ctx) return;
    for (const n of names) this.load(n);
  }

  setPrefs(musicOn: boolean, soundOn: boolean) {
    this.musicOn = musicOn;
    this.soundOn = soundOn;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(musicOn ? 0.55 : 0, t, 0.2);
    this.sfxBus.gain.setTargetAtTime(soundOn ? 1 : 0, t, 0.1);
    this.crowdBus.gain.setTargetAtTime(soundOn ? 1 : 0, t, 0.2);
  }

  // ------------------------------------------------------------- music

  async playMusic(track: MusicTrack | null) {
    this.wantedMusic = track;
    if (!this.ctx || !this.unlocked) return;
    if (this.music && this.music.track === track) return;
    const c = this.ctx;
    const old = this.music;
    this.music = null;
    if (old) {
      old.loop.gain.gain.setTargetAtTime(0, c.currentTime, 0.5);
      old.loop.src.stop(c.currentTime + 3);
    }
    if (!track) return;
    const buf = await this.load(track);
    if (!buf || this.wantedMusic !== track || (this.music as { track: MusicTrack } | null)?.track === track) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = c.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, c.currentTime, 0.6);
    src.connect(gain).connect(this.musicBus);
    src.start();
    this.music = { track, loop: { src, gain } };
  }

  // ------------------------------------------------------------- crowd

  /** Start (or adjust) the stadium bed. `level` 0..1. */
  async startCrowd(level = 0.6) {
    this.crowdLevel = level;
    if (!this.ctx || !this.unlocked) return;
    const c = this.ctx;
    if (this.crowd) {
      this.setIntensity(level);
      return;
    }
    const buf = await this.load('crowdBed');
    if (!buf || this.crowd || this.crowdLevel === 0) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.crowdFilter);
    src.start(0, Math.random() * buf.duration);
    this.crowd = { src, gain };
    this.setIntensity(level);
    this.preload(['goalRoar', 'ooh', 'whistleShort', 'whistleLong', 'applause', 'chantA', 'chantB', 'chantC', 'kick']);
  }

  /** Crowd excitement: louder and brighter as the ball gets near goal. */
  setIntensity(level: number) {
    this.crowdLevel = level;
    if (!this.ctx || !this.crowd) return;
    const t = this.ctx.currentTime;
    const l = Math.max(0, Math.min(1.4, level));
    this.crowd.gain.gain.setTargetAtTime(0.25 + l * 0.55, t, 0.6);
    this.crowdFilter.frequency.setTargetAtTime(2600 + l * 4500, t, 0.6);
  }

  stopCrowd() {
    this.crowdLevel = 0;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const l of [this.crowd, this.chant]) {
      if (!l) continue;
      l.gain.gain.setTargetAtTime(0, t, 0.4);
      l.src.stop(t + 2);
    }
    this.crowd = null;
    this.chant = null;
  }

  /** A terrace chant. Home fans are louder and closer; away fans distant. */
  async chantFor(home: boolean) {
    if (!this.ctx || !this.unlocked || this.chant) return;
    const name = (['chantA', 'chantB', 'chantC'] as const)[Math.floor(Math.random() * 3)];
    const buf = await this.load(name);
    if (!buf || !this.ctx || this.chant || this.crowdLevel === 0) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    gain.gain.value = home ? 0.7 : 0.32;
    const panner = c.createStereoPanner();
    panner.pan.value = home ? -0.25 : 0.55;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = home ? 7000 : 2600;
    src.connect(f).connect(panner).connect(gain).connect(this.crowdFilter);
    src.start();
    const entry = { gain, src };
    this.chant = entry;
    src.onended = () => {
      if (this.chant === entry) this.chant = null;
    };
  }

  // -------------------------------------------------------------- effects

  async play(name: SoundName, opts: { gain?: number; pan?: number; rate?: number; bus?: 'sfx' | 'crowd' } = {}) {
    if (!this.ctx || !this.unlocked) return;
    const buf = await this.load(name);
    if (!buf || !this.ctx) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const g = c.createGain();
    g.gain.value = opts.gain ?? 1;
    const p = c.createStereoPanner();
    p.pan.value = opts.pan ?? 0;
    src.connect(p).connect(g).connect(opts.bus === 'crowd' ? this.crowdFilter : this.sfxBus);
    src.start();
  }

  goal(home: boolean) {
    // Duck the chant, then the roar from the scoring end.
    if (this.chant && this.ctx) this.chant.gain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.2);
    this.play('goalRoar', { gain: home ? 1.0 : 0.45, pan: home ? -0.15 : 0.5, bus: 'crowd' });
    if (home) window.setTimeout(() => this.chantFor(true), 6500);
  }

  ooh(home: boolean) {
    this.play('ooh', { gain: home ? 0.85 : 0.4, pan: home ? -0.1 : 0.4, rate: 0.95 + Math.random() * 0.1, bus: 'crowd' });
  }

  whistle(long = false) {
    this.play(long ? 'whistleLong' : 'whistleShort', { gain: 0.55, rate: 0.97 + Math.random() * 0.06 });
  }

  kick(strength = 1) {
    this.play('kick', { gain: 0.25 * strength, rate: 0.9 + Math.random() * 0.25 });
  }

  applause() {
    this.play('applause', { gain: 0.8, bus: 'crowd' });
  }

  // --------------------------------------------------- interface blips

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slideTo?: number) {
    if (!this.ctx || !this.unlocked || !this.soundOn) return;
    const c = this.ctx;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, freq: number, sweepTo?: number) {
    if (!this.ctx || !this.unlocked || !this.soundOn) return;
    const c = this.ctx;
    const t = c.currentTime;
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
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t);
  }

  click() {
    this.tone(1900, 0.035, 'triangle', 0.035);
  }
  whoosh() {
    this.noise(0.32, 0.14, 500, 2600);
  }
  stamp() {
    this.tone(140, 0.2, 'sine', 0.4, 0, 50);
    this.noise(0.08, 0.25, 900);
  }
  cheer() {
    this.play('applause', { gain: 0.6 });
  }
}

export const sound = new SoundEngine();
