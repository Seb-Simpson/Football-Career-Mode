"""Original music for the game, rendered with simple synthesis.

floodlights: anthemic theme for the title screen, cutscenes and season review.
dressing-room: mellow groove for the management screens.
"""
import os
import numpy as np
from dsp import (SR, rng, env_adsr, highpass, loop_crossfade, lowpass, normalize, pan, reverb, saw_from_freq,
                 sine_from_freq, square_from_freq, stadium_ir, write_mp3)

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets', 'audio')
ROOM = stadium_ir(dur=1.8, rt60=1.4)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


class Track:
    def __init__(self, bpm, bars, beats_per_bar=4):
        self.bpm = bpm
        self.beat = 60.0 / bpm
        self.bar = self.beat * beats_per_bar
        self.dur = bars * self.bar
        self.n = int((self.dur + 3.0) * SR)
        self.buses = {}

    def bus(self, name):
        if name not in self.buses:
            self.buses[name] = np.zeros((2, self.n))
        return self.buses[name]

    def add(self, name, start_s, stereo):
        b = self.bus(name)
        i0 = int(start_s * SR)
        m = min(stereo.shape[1], self.n - i0)
        if m > 0:
            b[:, i0:i0 + m] += stereo[:, :m]


# ---------------------------------------------------------------- instruments

def supersaw(notes, dur, cutoff=2400, attack=0.35, release=0.6, detune=14):
    m = int(dur * SR)
    out = np.zeros((2, m))
    for note in notes:
        for k in range(7):
            cents = (k - 3) * detune / 3 + rng.normal(0, 2)
            f = np.full(m, hz(note) * 2 ** (cents / 1200))
            s = saw_from_freq(f)
            s = np.roll(s, rng.integers(0, 2000))
            out += pan(s, (k - 3) / 3.5)
    out = np.stack([lowpass(out[0], cutoff), lowpass(out[1], cutoff)])
    e = env_adsr(m, attack, 0.2, 0.9, release)
    return out * e / (7 * len(notes))


def pluck(note, dur, bright=3200, decay=10):
    m = int(dur * SR)
    t = np.arange(m) / SR
    s = saw_from_freq(np.full(m, hz(note))) * 0.6 + square_from_freq(np.full(m, hz(note) * 2.0)) * 0.2
    s = lowpass(s, bright) * np.exp(-t * decay)
    s[: int(0.003 * SR)] *= np.linspace(0, 1, int(0.003 * SR))
    return s


def bass_note(note, dur, cutoff=420):
    m = int(dur * SR)
    t = np.arange(m) / SR
    f = np.full(m, hz(note))
    s = saw_from_freq(f) * 0.5 + sine_from_freq(f / 2) * 0.8
    s = lowpass(s, cutoff) * env_adsr(m, 0.005, 0.08, 0.75, 0.05)
    return s


def kick(level=1.0):
    m = int(0.42 * SR)
    t = np.arange(m) / SR
    f = 130 * np.exp(-t * 22) + 44
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6.5)
    s += highpass(rng.standard_normal(m), 3000) * np.exp(-t * 260) * 0.25
    return s * level


def snare(level=1.0):
    m = int(0.3 * SR)
    t = np.arange(m) / SR
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25) * 0.6
    noise = highpass(lowpass(rng.standard_normal(m), 7000), 900) * np.exp(-t * 16)
    return (tone + noise) * level


def hat(level=1.0, open_=False):
    m = int((0.25 if open_ else 0.06) * SR)
    t = np.arange(m) / SR
    return highpass(rng.standard_normal(m), 7500) * np.exp(-t * (12 if open_ else 70)) * level


def crash(level=1.0):
    m = int(2.2 * SR)
    t = np.arange(m) / SR
    return highpass(rng.standard_normal(m), 4500) * np.exp(-t * 1.6) * level


def lead(notes, beat, start_beat=0.0):
    """notes: (midi or None, beats). Returns stereo with glide and delayed vibrato."""
    total = sum(b for _, b in notes) * beat
    m = int((total + 0.6) * SR)
    f = np.zeros(m)
    amp = np.zeros(m)
    t = 0.0
    cur = hz(next(n for n, _ in notes if n is not None))
    for note, beats in notes:
        d = beats * beat
        i0, i1 = int(t * SR), min(m, int((t + d) * SR))
        if note is not None:
            target = hz(note)
            g = min(int(0.04 * SR), i1 - i0)
            seg = np.full(i1 - i0, target)
            seg[:g] = np.linspace(cur, target, g)
            tt = np.arange(i1 - i0) / SR
            vib = 1 + 0.009 * np.sin(2 * np.pi * 5.5 * tt) * np.clip((tt - 0.25) / 0.3, 0, 1)
            f[i0:i1] = seg * vib
            amp[i0:i1] = env_adsr(i1 - i0, 0.02, 0.1, 0.85, min(0.12, d * 0.4))
            cur = target
        else:
            f[i0:i1] = cur
        t += d
    f[f == 0] = cur
    s = saw_from_freq(f) * 0.55 + square_from_freq(f * 1.003) * 0.35
    s = lowpass(s, 3400) * amp
    return np.stack([s, np.roll(s, int(0.012 * SR)) * 0.92])


def ep_note(note, dur):
    """Electric-piano-like FM tine."""
    m = int(dur * SR)
    t = np.arange(m) / SR
    f = hz(note)
    idx = 2.2 * np.exp(-t * 5)
    s = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t)) * np.exp(-t * 1.4)
    s += np.sin(2 * np.pi * f * 2 * t) * 0.15 * np.exp(-t * 4)
    s *= 1 + 0.08 * np.sin(2 * np.pi * 4.5 * t)
    s[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
    rel = int(0.2 * SR)
    if m > rel:
        s[-rel:] *= np.linspace(1, 0, rel)
    return s


# ------------------------------------------------------------------- tracks

def floodlights():
    tr = Track(bpm=116, bars=32)
    b, bar = tr.beat, tr.bar
    # C minor: Cm  Ab  Eb  Bb  (two bars each)
    prog = [[48, 51, 55, 60], [44, 48, 51, 56], [51, 55, 58, 63], [46, 50, 53, 58]]
    roots = [36, 32, 39, 34]
    for bar_i in range(32):
        chord = prog[(bar_i // 2) % 4]
        root = roots[(bar_i // 2) % 4]
        t0 = bar_i * bar
        section = 'intro' if bar_i < 8 else 'main' if bar_i < 24 else 'outro'
        if bar_i % 2 == 0:
            tr.add('pad', t0, supersaw(chord, 2 * bar + 0.5, cutoff=1800 if section == 'intro' else 2600))
        # arpeggio, 16ths, chord tones over two octaves
        arp_notes = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[3] + 12, chord[2] + 24, chord[3] + 12, chord[1] + 24, chord[2] + 12]
        for k in range(16):
            note = arp_notes[k % len(arp_notes)]
            p = pluck(note, b / 4 * 1.8, bright=2200 if section == 'intro' else 3400) * (0.55 if k % 4 == 0 else 0.4)
            tr.add('arp', t0 + k * b / 4, pan(p, -0.45 if k % 2 == 0 else 0.45))
        if section != 'intro' or bar_i >= 4:
            for k in range(8):
                note = root if k % 8 != 6 else root + 7
                tr.add('bass', t0 + k * b / 2, pan(bass_note(note, b / 2 * 0.9), 0))
        # drums
        if section == 'main' or (section == 'intro' and bar_i >= 4) or (section == 'outro' and bar_i < 30):
            for k in range(4):
                tr.add('drums', t0 + k * b, pan(kick(1.0 if k in (0, 2) or section == 'main' else 0.0), 0))
                if k in (1, 3) and section != 'intro':
                    tr.add('drums', t0 + k * b, pan(snare(0.8), 0.05))
            for k in range(8):
                tr.add('drums', t0 + k * b / 2, pan(hat(0.35 if k % 2 else 0.22, open_=(k == 7)), 0.3))
        if bar_i in (8, 16, 24):
            tr.add('drums', t0, pan(crash(0.6), -0.3))
    # lead melody over the main section (bars 12-24), original tune
    C, D, Eb, F, G, Ab, Bb, C5 = 72, 74, 75, 77, 79, 80, 82, 84
    phrase1 = [(G, 1.5), (Eb, 0.5), (F, 1), (G, 1), (Ab, 2), (G, 1), (F, 1), (Eb, 1.5), (D, 0.5), (C, 2), (None, 2),
               (Eb, 1.5), (F, 0.5), (G, 1), (Bb, 1), (Ab, 2), (G, 1), (F, 1), (G, 4), (None, 4)]
    phrase2 = [(C5, 1.5), (Bb, 0.5), (Ab, 1), (G, 1), (F, 2), (Eb, 1), (F, 1), (G, 1.5), (F, 0.5), (Eb, 1), (D, 1),
               (C, 2), (D, 1), (Eb, 1), (F, 1.5), (G, 0.5), (Eb, 2), (D, 4), (C, 4)]
    tr.add('lead', 12 * bar, lead(phrase1, b))
    tr.add('lead', 20 * bar, lead(phrase2, b) * 0.9)
    mix = (normalize(tr.bus('pad')) * 0.42 + normalize(tr.bus('arp')) * 0.3 + normalize(tr.bus('bass')) * 0.42
           + normalize(tr.bus('drums')) * 0.55 + normalize(tr.bus('lead')) * 0.38)
    mix = reverb(mix, wet=0.22, ir=ROOM)
    mix = mix[:, : int((tr.dur + 2.0) * SR)]
    mix = loop_crossfade(mix, 2.0)
    return normalize(mix, 0.85)


def dressing_room():
    tr = Track(bpm=88, bars=24)
    b, bar = tr.beat, tr.bar
    # Fmaj7  Em7  Dm7  Cmaj7
    prog = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]]
    roots = [41, 40, 38, 36]
    swing = 0.06
    for bar_i in range(24):
        chord = prog[bar_i % 4]
        root = roots[bar_i % 4]
        t0 = bar_i * bar
        # comped electric piano: chord on 1 and the "and" of 2
        for hit, ln in ((0, 1.4), (1.5, 1.2), (3.0, 0.9)):
            if hit == 3.0 and bar_i % 2 == 0:
                continue
            voice = np.zeros(int(ln * b * SR))
            for k, note in enumerate(chord):
                v = ep_note(note + 12, ln * b)
                voice[: len(v)] += v * (0.8 if k else 1.0)
            tr.add('ep', t0 + hit * b + rng.uniform(0, 0.015), pan(voice, rng.uniform(-0.3, 0.3)))
        # bass: root, fifth, approach
        for beat_i, note in ((0, root), (1.5, root + 7), (2.5, root + 12), (3.5, roots[(bar_i + 1) % 4] + 1)):
            tr.add('bass', t0 + beat_i * b, pan(bass_note(note, b * 0.85, cutoff=320) * 0.9, 0))
        if bar_i >= 2:
            for k in range(4):
                if k in (0, 2):
                    tr.add('drums', t0 + k * b, pan(kick(0.7), 0))
                if k in (1, 3):
                    tr.add('drums', t0 + k * b, pan(lowpass(snare(0.55), 4000), 0.05))
            for k in range(8):
                off = swing if k % 2 else 0
                tr.add('drums', t0 + (k / 2 + off) * b, pan(hat(0.18 if k % 2 else 0.12), 0.35))
        # sparse vibraphone-like motif every other bar from bar 8
        if bar_i >= 8 and bar_i % 2 == 0:
            motif = [chord[3] + 12, chord[2] + 12, chord[3] + 24, chord[1] + 24]
            for k, note in enumerate(motif):
                m = int(1.2 * SR)
                tt = np.arange(m) / SR
                bell = np.sin(2 * np.pi * hz(note) * tt) * np.exp(-tt * 3) + 0.2 * np.sin(2 * np.pi * hz(note) * 4 * tt) * np.exp(-tt * 9)
                tr.add('bell', t0 + (k * 0.75 + 0.5) * b, pan(bell * 0.5, -0.4 + k * 0.25))
    mix = (normalize(tr.bus('ep')) * 0.5 + normalize(tr.bus('bass')) * 0.45 + normalize(tr.bus('drums')) * 0.4
           + normalize(tr.bus('bell')) * 0.22)
    # warmth: gentle top-end roll-off and a little room
    mix = np.stack([lowpass(mix[0], 9000), lowpass(mix[1], 9000)])
    mix = reverb(mix, wet=0.18, ir=ROOM)
    mix = mix[:, : int((tr.dur + 2.0) * SR)]
    mix = loop_crossfade(mix, 2.0)
    return normalize(mix, 0.8)


if __name__ == '__main__':
    print('floodlights'); write_mp3(f'{OUT}/music-floodlights.mp3', floodlights(), bitrate='128k')
    print('dressing room'); write_mp3(f'{OUT}/music-dressing-room.mp3', dressing_room(), bitrate='128k')
    print('done')
