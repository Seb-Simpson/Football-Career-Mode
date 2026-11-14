"""Render stadium crowd ambience, chants and match sound effects.

Everything here is synthesised from scratch (no samples), so the output is
original and free to ship with the game.
"""
import os
import numpy as np
from dsp import (SR, rng, bandpass, env_adsr, formant, highpass, loop_crossfade, lowpass, normalize, pan,
                 reverb, saw_from_freq, stadium_ir, write_mp3)

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets', 'audio')
os.makedirs(OUT, exist_ok=True)
IR = stadium_ir(dur=2.8, rt60=2.3)


def pink(n):
    w = rng.standard_normal(n)
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    from scipy import signal
    return signal.lfilter(b, a, w)


def slow_mod(n, rate, depth, base=1.0):
    """Smooth random modulation (crowd swells)."""
    k = max(4, int(n / SR * rate))
    pts = rng.uniform(1 - depth, 1 + depth, k) * base
    return np.interp(np.arange(n), np.linspace(0, n, k), pts)


def babble(dur, groups=28, level=1.0):
    """Many overlapping talkers/shouters: glottal source x syllable envelopes x vowel formants."""
    n = int(dur * SR)
    out = np.zeros((2, n))
    for g in range(groups):
        f0 = rng.uniform(95, 230) * slow_mod(n, 2.5, 0.12)
        src = saw_from_freq(f0)
        # syllables
        env = np.zeros(n)
        t = rng.uniform(0, 0.5)
        while t < dur:
            d = rng.uniform(0.09, 0.32)
            i0, i1 = int(t * SR), min(n, int((t + d) * SR))
            if i1 > i0:
                env[i0:i1] = np.hanning(i1 - i0) * rng.uniform(0.3, 1.0)
            t += d + rng.exponential(0.25)
        vowel = rng.choice(['a', 'o', 'e', 'ae', 'u'])
        v = formant(src * env, vowel)
        out += pan(v, rng.uniform(-0.9, 0.9)) * rng.uniform(0.4, 1.0)
    return out * level / groups


def crowd_bed(dur=48):
    n = int(dur * SR)
    # the mass: thousands of voices blur into band-limited noise with slow swells
    mass = np.stack([bandpass(pink(n), 220, 3200), bandpass(pink(n), 220, 3200)])
    mass *= slow_mod(n, 0.35, 0.25)
    vowelish = np.stack([formant(pink(n) * 0.5, 'o'), formant(pink(n) * 0.5, 'a')]) * slow_mod(n, 0.6, 0.3)
    rumble = np.stack([lowpass(pink(n), 140)] * 2) * 2.2
    talk = babble(dur, groups=30)
    mix = normalize(mass) * 0.55 + normalize(vowelish) * 0.35 + normalize(rumble) * 0.25 + normalize(talk) * 0.35
    # sporadic shouts, fan whistles and claps
    for _ in range(int(dur * 0.7)):
        i0 = int(rng.uniform(0, dur - 1.5) * SR)
        kind = rng.random()
        if kind < 0.55:
            d = rng.uniform(0.35, 0.9)
            m = int(d * SR)
            f0 = rng.uniform(140, 260) * np.linspace(1, rng.uniform(0.85, 1.15), m)
            s = formant(saw_from_freq(f0) * np.hanning(m), rng.choice(['a', 'e', 'o']))
            mix[:, i0:i0 + m] += pan(normalize(s) * rng.uniform(0.08, 0.18), rng.uniform(-1, 1))
        elif kind < 0.75:
            m = int(rng.uniform(0.2, 0.6) * SR)
            f = rng.uniform(1800, 3200)
            s = np.sin(2 * np.pi * np.cumsum(f * (1 + 0.04 * np.sin(np.arange(m) / SR * 30))) / SR) * np.hanning(m)
            mix[:, i0:i0 + m] += pan(s * rng.uniform(0.02, 0.05), rng.uniform(-1, 1))
        else:
            for k in range(rng.integers(3, 9)):
                j = i0 + int(k * rng.uniform(0.25, 0.4) * SR)
                c = clap() * rng.uniform(0.05, 0.12)
                if j + len(c) < n:
                    mix[:, j:j + len(c)] += pan(c, rng.uniform(-1, 1))
    mix = reverb(mix, wet=0.45, ir=IR)
    mix = loop_crossfade(mix, 3.0)
    return normalize(mix, 0.7)


def clap():
    m = int(0.06 * SR)
    s = rng.standard_normal(m) * np.exp(-np.arange(m) / (0.008 * SR))
    return bandpass(s, rng.uniform(900, 1300), rng.uniform(2200, 3200))


def drum_hit(level=1.0):
    m = int(0.45 * SR)
    t = np.arange(m) / SR
    f = 95 * np.exp(-t * 6) + 48
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)
    s += lowpass(rng.standard_normal(m), 900) * np.exp(-t * 30) * 0.3
    return s * level


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def choir(notes, bpm, voices=56, start=0.4, tail=2.5, octave_share=0.22):
    """notes: list of (midi or None for rest, beats, vowel, consonant)."""
    beat = 60.0 / bpm
    total = sum(b for _, b, _, _ in notes) * beat
    dur = start + total + tail
    n = int(dur * SR)
    acc = {}  # (vowel, ch) -> source accumulator
    breath = np.zeros((2, n))
    for v in range(voices):
        det = 2 ** (rng.normal(0, 22) / 1200)
        oct_up = rng.random() < octave_share
        lag = rng.normal(0, 0.035)
        ch = 0 if v % 2 == 0 else 1
        gain = rng.uniform(0.55, 1.0) * (0.55 if oct_up else 1.0)
        vib_rate = rng.uniform(4.5, 6.2)
        t = start + lag
        f0 = np.full(n, midi(notes[0][0] or 50) * det)
        env_by_vowel = {}
        for note, beats, vowel, cons in notes:
            d = beats * beat
            i0, i1 = int(max(0, t) * SR), min(n, int((t + d) * SR))
            if note is not None and i1 > i0:
                m = i1 - i0
                f = midi(note) * det * (2 if oct_up else 1)
                # portamento from previous pitch
                g = int(0.05 * SR)
                prev = f0[i0 - 1] if i0 > 0 else f
                seg = np.full(m, f)
                seg[:min(g, m)] = np.linspace(prev, f, min(g, m))
                tt = np.arange(m) / SR
                seg *= 1 + 0.006 * np.sin(2 * np.pi * vib_rate * tt + rng.uniform(0, 6))
                f0[i0:i1] = seg
                e = env_adsr(m, 0.04, 0.08, 0.85, min(0.09, d * 0.35))
                env_by_vowel.setdefault(vowel, np.zeros(n))[i0:i1] += e * gain
                if cons and v % 3 == 0:
                    k = int(0.04 * SR)
                    burst = highpass(rng.standard_normal(k), 2000) * np.hanning(k) * 0.15 * gain
                    breath[ch, i0:i0 + k] += burst[: max(0, min(k, n - i0))]
            if i1 > i0:
                f0[i1:] = f0[i1 - 1]
            t += d
        src = saw_from_freq(f0) + 0.15 * rng.standard_normal(n)
        for vowel, e in env_by_vowel.items():
            key = (vowel, ch)
            acc[key] = acc.get(key, 0) + src * e
    out = np.zeros((2, n))
    for (vowel, ch), s in acc.items():
        out[ch] += formant(s, vowel)
    out = lowpass(out, 4200)
    out += breath
    # widen: a little cross-feed
    out = np.stack([out[0] * 0.8 + out[1] * 0.2, out[1] * 0.8 + out[0] * 0.2])
    return normalize(out), beat, start


def chant(notes, bpm, drum_beats=None, clap_pattern=None, reps=2, name='chant'):
    seq = notes * reps
    sing, beat, start = choir(seq, bpm)
    n = sing.shape[1]
    perc = np.zeros((2, n))
    total_beats = sum(b for _, b, _, _ in seq)
    if drum_beats:
        bar = sum(b for _, b, _, _ in notes)
        for r in range(reps):
            for b in drum_beats:
                i = int((start + (r * bar + b) * beat) * SR)
                h = drum_hit()
                if i + len(h) < n:
                    perc[:, i:i + len(h)] += pan(h, -0.2) * 0.9
    if clap_pattern:
        bar = sum(b for _, b, _, _ in notes)
        for r in range(reps):
            for b in clap_pattern:
                base = int((start + (r * bar + b) * beat) * SR)
                for k in range(40):
                    j = base + int(rng.normal(0, 0.012) * SR)
                    c = clap() * rng.uniform(0.3, 1.0)
                    if 0 <= j and j + len(c) < n:
                        perc[:, j:j + len(c)] += pan(c, rng.uniform(-1, 1)) * 0.06
    mix = normalize(sing) * 0.85 + normalize(perc) * 0.45 if np.max(np.abs(perc)) > 0 else sing
    # sit it inside the crowd
    bed = crowd_bed_short(n)
    mix = reverb(mix, wet=0.5, ir=IR) + bed * 0.35
    fade = int(1.2 * SR)
    mix[:, -fade:] *= np.linspace(1, 0, fade)
    mix[:, : int(0.2 * SR)] *= np.linspace(0, 1, int(0.2 * SR))
    return normalize(mix, 0.8)


def crowd_bed_short(n):
    m = np.stack([bandpass(pink(n), 250, 3000), bandpass(pink(n), 250, 3000)]) * slow_mod(n, 0.5, 0.2)
    return normalize(m) * 0.6


def goal_roar(dur=8.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    envl = np.minimum(1, t / 0.35) * np.exp(-np.maximum(0, t - 1.4) / 3.2)
    mass = np.stack([formant(pink(n), 'a') + formant(pink(n), 'e') * 0.6, formant(pink(n), 'a') + formant(pink(n), 'ae') * 0.6])
    mass = normalize(mass) * envl
    # a choir of individual "yeah!" voices gliding up
    voices = np.zeros((2, n))
    for v in range(70):
        d = rng.uniform(1.2, 3.2)
        m = int(d * SR)
        i0 = int(rng.uniform(0.05, 0.5) * SR)
        f = rng.uniform(150, 330) * np.linspace(1.0, rng.uniform(1.05, 1.3), m)
        s = formant(saw_from_freq(f) * env_adsr(m, 0.08, 0.3, 0.7, 0.6), rng.choice(['a', 'e', 'ae']))
        voices[:, i0:i0 + m] += pan(s, rng.uniform(-1, 1))
    voices = normalize(voices) * envl
    claps = np.zeros((2, n))
    for _ in range(500):
        j = int(rng.uniform(1.0, dur - 0.2) * SR)
        c = clap() * rng.uniform(0.2, 1.0) * (1 - j / n)
        claps[:, j:j + len(c)] += pan(c, rng.uniform(-1, 1))
    mix = mass * 0.7 + voices * 0.6 + normalize(claps) * 0.25
    mix = reverb(mix, wet=0.4, ir=IR)
    return normalize(mix, 0.9)


def ooh(dur=3.2):
    n = int(dur * SR)
    out = np.zeros((2, n))
    for v in range(60):
        m = int(rng.uniform(1.6, 2.6) * SR)
        i0 = int(rng.uniform(0, 0.15) * SR)
        f = rng.uniform(160, 280) * np.linspace(1.0, rng.uniform(0.7, 0.8), m)
        s = formant(saw_from_freq(f) * env_adsr(m, 0.15, 0.4, 0.8, 0.9), 'u')
        out[:, i0:i0 + m] += pan(s, rng.uniform(-1, 1))
    out = normalize(out) + normalize(crowd_bed_short(n)) * 0.25 * np.linspace(1, 0.3, n)
    return normalize(reverb(out, wet=0.45, ir=IR), 0.85)


def applause(dur=5.0):
    n = int(dur * SR)
    out = np.zeros((2, n))
    t = np.arange(n) / SR
    density = np.minimum(1, t / 0.4) * np.exp(-np.maximum(0, t - 1.5) / 1.6)
    for _ in range(1600):
        j = int(rng.uniform(0, dur - 0.1) * SR)
        if rng.random() > density[j]:
            continue
        c = clap() * rng.uniform(0.2, 1.0)
        out[:, j:j + len(c)] += pan(c, rng.uniform(-1, 1))
    return normalize(reverb(out, wet=0.35, ir=IR), 0.8)


def whistle(blasts):
    parts = []
    for d, gap in blasts:
        m = int(d * SR)
        t = np.arange(m) / SR
        pea = 1 + 0.6 * np.sign(np.sin(2 * np.pi * (32 + 6 * np.sin(t * 9)) * t)) * rng.uniform(0.7, 1, m)
        f = 3050 * (1 + 0.012 * np.sin(2 * np.pi * 32 * t))
        tone = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.18 * np.sin(2 * np.pi * np.cumsum(2 * f) / SR)
        breath = bandpass(rng.standard_normal(m), 2400, 4200) * 0.25
        e = env_adsr(m, 0.012, 0.03, 0.85, 0.05)
        parts.append((tone * pea * 0.5 + breath) * e)
        parts.append(np.zeros(int(gap * SR)))
    mono = np.concatenate(parts)
    st = np.stack([mono, mono])
    return normalize(reverb(st, wet=0.25, ir=IR), 0.6)


def kick_sound():
    m = int(0.18 * SR)
    t = np.arange(m) / SR
    f = 170 * np.exp(-t * 30) + 70
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 28)
    click = highpass(rng.standard_normal(m), 1500) * np.exp(-t * 180) * 0.5
    mono = body + click
    return normalize(np.stack([mono, mono]), 0.7)


if __name__ == '__main__':
    D3, E3, Fs3, G3, A3, B3, C4, D4 = 50, 52, 54, 55, 57, 59, 60, 62
    print('crowd bed'); write_mp3(f'{OUT}/crowd-bed.mp3', crowd_bed(), bitrate='112k')
    print('chant A')
    a = [(D3, 1, 'o', 0), (Fs3, 1, 'o', 0), (A3, 2, 'o', 0), (A3, 0.5, 'o', 1), (B3, 0.5, 'o', 1), (A3, 1, 'o', 0),
         (Fs3, 2, 'o', 0), (E3, 1, 'o', 1), (Fs3, 1, 'o', 0), (G3, 1, 'o', 0), (Fs3, 1, 'o', 0), (E3, 2, 'a', 0), (D3, 2, 'o', 0)]
    write_mp3(f'{OUT}/chant-a.mp3', chant(a, 100, drum_beats=[0, 2, 4, 6, 8, 10, 12, 14], reps=2), bitrate='112k')
    print('chant B')
    b = [(A3, 0.5, 'o', 1), (Fs3, 0.5, 'a', 1), (A3, 0.5, 'o', 1), (Fs3, 0.5, 'a', 1), (None, 1, 'o', 0),
         (A3, 0.5, 'o', 1), (B3, 0.5, 'a', 1), (A3, 0.5, 'o', 1), (Fs3, 0.5, 'a', 1), (None, 1, 'o', 0),
         (D4, 0.5, 'e', 1), (C4, 0.5, 'o', 1), (B3, 0.5, 'o', 1), (A3, 0.5, 'a', 1), (G3, 1, 'o', 1), (Fs3, 1, 'o', 1)]
    write_mp3(f'{OUT}/chant-b.mp3', chant(b, 124, drum_beats=[0, 1, 2, 3, 4, 5, 6, 7], clap_pattern=[2, 2.33, 2.66, 5, 5.33, 5.66], reps=3), bitrate='112k')
    print('chant C')
    E2m = 52
    c = [(E3, 2, 'o', 0), (G3, 1, 'o', 0), (B3, 1, 'a', 0), (A3, 2, 'a', 0), (G3, 1, 'o', 0), (Fs3, 1, 'o', 0),
         (E3, 2, 'o', 0), (D3, 1, 'o', 0), (E3, 1, 'o', 0), (G3, 2, 'a', 0), (Fs3, 2, 'o', 0)]
    write_mp3(f'{OUT}/chant-c.mp3', chant(c, 84, drum_beats=[0, 4, 8, 12], reps=2), bitrate='112k')
    print('goal'); write_mp3(f'{OUT}/goal-roar.mp3', goal_roar(), bitrate='112k')
    print('ooh'); write_mp3(f'{OUT}/ooh.mp3', ooh(), bitrate='96k')
    print('applause'); write_mp3(f'{OUT}/applause.mp3', applause(), bitrate='96k')
    print('whistles')
    write_mp3(f'{OUT}/whistle-short.mp3', whistle([(0.32, 0.25)]), bitrate='96k')
    write_mp3(f'{OUT}/whistle-long.mp3', whistle([(0.28, 0.16), (0.28, 0.16), (1.0, 0.4)]), bitrate='96k')
    print('kick'); write_mp3(f'{OUT}/kick.mp3', kick_sound(), bitrate='96k')
    print('done')
