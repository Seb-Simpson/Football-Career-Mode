"""Small DSP toolkit for rendering the game's audio offline (numpy + scipy)."""
import numpy as np
from scipy import signal

SR = 44100
rng = np.random.default_rng(20271)


def t_axis(dur, sr=SR):
    return np.arange(int(dur * sr)) / sr


def env_adsr(n, a, d, s, r, sr=SR):
    a, d, r = int(a * sr), int(d * sr), int(r * sr)
    a = max(a, 1)
    e = np.ones(n) * s
    e[:a] = np.linspace(0, 1, a)
    dn = min(d, max(0, n - a))
    if dn > 0:
        e[a:a + dn] = np.linspace(1, s, dn)
    rn = min(r, n)
    if rn > 0:
        e[n - rn:] *= np.linspace(1, 0, rn)
    return e


def saw_from_freq(freq, sr=SR):
    phase = np.cumsum(freq) / sr
    return 2.0 * (phase - np.floor(phase)) - 1.0


def square_from_freq(freq, sr=SR, duty=0.5):
    phase = np.cumsum(freq) / sr
    return np.where((phase - np.floor(phase)) < duty, 1.0, -1.0)


def sine_from_freq(freq, sr=SR):
    return np.sin(2 * np.pi * np.cumsum(freq) / sr)


def lowpass(x, fc, sr=SR, order=2):
    b, a = signal.butter(order, min(fc / (sr / 2), 0.99), 'low')
    return signal.lfilter(b, a, x)


def highpass(x, fc, sr=SR, order=2):
    b, a = signal.butter(order, max(fc / (sr / 2), 1e-4), 'high')
    return signal.lfilter(b, a, x)


def bandpass(x, lo, hi, sr=SR, order=2):
    b, a = signal.butter(order, [max(lo / (sr / 2), 1e-4), min(hi / (sr / 2), 0.99)], 'band')
    return signal.lfilter(b, a, x)


def resonator(x, fc, bw, sr=SR):
    """Two-pole resonant bandpass used as a vowel formant."""
    r = np.exp(-np.pi * bw / sr)
    theta = 2 * np.pi * fc / sr
    b = [1 - r]
    a = [1, -2 * r * np.cos(theta), r * r]
    return signal.lfilter(b, a, x)


VOWELS = {
    # F1, F2, F3 (Hz) with bandwidths for a crowd of mostly male voices
    'a': [(730, 90), (1090, 110), (2440, 170)],
    'o': [(570, 80), (840, 100), (2410, 170)],
    'u': [(300, 70), (870, 100), (2240, 170)],
    'e': [(530, 80), (1840, 120), (2480, 170)],
    'i': [(270, 60), (2290, 140), (3010, 200)],
    'ae': [(660, 90), (1720, 120), (2410, 170)],
}


def formant(x, vowel, sr=SR):
    out = np.zeros_like(x)
    for i, (f, bw) in enumerate(VOWELS[vowel]):
        out += resonator(x, f, bw, sr) * [1.0, 0.6, 0.25][i]
    return out


def stadium_ir(dur=2.6, sr=SR, rt60=2.1, stereo=True):
    n = int(dur * sr)
    t = np.arange(n) / sr
    decay = np.exp(-6.9 * t / rt60)
    chans = []
    for c in range(2 if stereo else 1):
        noise = rng.standard_normal(n) * decay
        noise = lowpass(noise, 5200, sr)
        # early reflections from the stands
        for k in range(14):
            idx = int(rng.uniform(0.008, 0.11) * sr)
            noise[idx] += rng.uniform(0.3, 0.9) * (1 if rng.random() > 0.5 else -1)
        noise[0] = 1.0
        chans.append(noise / np.max(np.abs(noise)))
    return np.stack(chans)


def reverb(x, wet=0.35, ir=None, sr=SR):
    """x: (2, n) stereo. Returns same length with reverb tail folded in."""
    if ir is None:
        ir = stadium_ir(sr=sr)
    out = np.zeros_like(x)
    for c in range(2):
        w = signal.fftconvolve(x[c], ir[c % ir.shape[0]])[: x.shape[1]]
        w /= max(1e-9, np.max(np.abs(w))) / max(1e-9, np.max(np.abs(x[c])))
        out[c] = x[c] * (1 - wet) + w * wet
    return out


def pan(mono, p):
    """p in [-1, 1]."""
    l = np.cos((p + 1) * np.pi / 4)
    r = np.sin((p + 1) * np.pi / 4)
    return np.stack([mono * l, mono * r])


def normalize(x, peak=0.89):
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 0 else x


def loop_crossfade(x, fade_s, sr=SR):
    """Make a stereo buffer loop seamlessly by folding its tail into its head."""
    f = int(fade_s * sr)
    head = x[:, :f]
    tail = x[:, -f:]
    ramp = np.linspace(0, 1, f)
    blended = head * ramp + tail * (1 - ramp)
    return np.concatenate([blended, x[:, f:-f]], axis=1)


def write_mp3(path, x, sr=SR, bitrate='128k'):
    import subprocess, tempfile, os
    from scipy.io import wavfile
    x = np.clip(x, -1, 1)
    data = (x.T * 32767).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        wavfile.write(f.name, sr, data)
        tmp = f.name
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-codec:a', 'libmp3lame', '-b:a', bitrate, path], check=True)
    os.unlink(tmp)
