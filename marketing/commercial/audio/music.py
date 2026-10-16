# Original 120 BPM electronic bed for the Frenzsave commercial, synthesised from scratch
# (no samples, no third-party audio). 46 s. Drop at 4.0 s, outro hit at 38.0 s.
import numpy as np, wave, sys
SR = 44100; BPM = 120; BEAT = 60 / BPM; DUR = 46.0
N = int(SR * DUR); rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)
def t_(n): return np.arange(n) / SR
def add(sig, start, gain=1.0, pan=0.0):
    i = int(start * SR); n = min(len(sig), N - i)
    if n <= 0: return
    L[i:i+n] += sig[:n] * gain * np.sqrt(0.5 * (1 - pan)) * 1.414
    R[i:i+n] += sig[:n] * gain * np.sqrt(0.5 * (1 + pan)) * 1.414
def midi(m): return 440 * 2 ** ((m - 69) / 12)
def saw(f, dur, harm=24, bright=1.0, det=0.0):
    t = t_(int(dur * SR)); out = np.zeros_like(t)
    for k in range(1, harm + 1):
        if f * k > 16000: break
        out += np.sin(2 * np.pi * f * (1 + det) * k * t) / k * np.exp(-k * (1.2 / bright) / harm * 4)
    return out
def env(n, a, r, sustain=1.0):
    e = np.ones(n) * sustain; ai = max(1, int(a * SR)); ri = max(1, int(r * SR))
    e[:ai] = np.linspace(0, sustain, ai); e[-ri:] *= np.linspace(1, 0, ri); return e
def hp(x): return np.diff(x, prepend=0)
def norm(x, peak): return x / (np.abs(x).max() + 1e-9) * peak

DROP, OUTRO = 4.0, 38.0
# Chords (A minor: Am F C G), one per bar (2 s)
CH = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
ROOT = [45, 41, 48, 43]
bars = int(DUR / (4 * BEAT))
# sidechain envelope (pump on every beat after the drop)
side = np.ones(N)
for b in np.arange(DROP, OUTRO, BEAT):
    i = int(b * SR); n = int(0.28 * SR)
    side[i:i+n] = np.minimum(side[i:i+n], 0.35 + 0.65 * np.linspace(0, 1, n) ** 0.6)
pad = np.zeros(N)
for bar in range(bars):
    st = bar * 4 * BEAT; d = 4 * BEAT + 0.3
    for m in CH[bar % 4]:
        for det in (-0.004, 0.0, 0.004):
            s = saw(midi(m), d, harm=14, bright=0.5 if st < DROP else 0.8, det=det) * env(int(d * SR), 0.25, 0.4)
            i = int(st * SR); n = min(len(s), N - i); pad[i:i+n] += s[:n] * 0.05
add(pad * side, 0, 1.0)
# intro swell gain
sw = np.clip(t_(N) / DROP, 0, 1) ** 1.5
L *= np.where(t_(N) < DROP, 0.3 + 0.7 * sw, 1); R *= np.where(t_(N) < DROP, 0.3 + 0.7 * sw, 1)
# Kick
def kick():
    t = t_(int(0.45 * SR)); f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.tanh(2.2 * np.sin(ph) * np.exp(-t * 7)) + norm(hp(rng.standard_normal(len(t))) * np.exp(-t * 200), 0.15)
K = kick()
for b in np.arange(DROP, OUTRO, BEAT): add(K, b, 0.55)
add(K, OUTRO, 0.7)
# Clap on 2 and 4
def clap():
    t = t_(int(0.3 * SR)); n = hp(hp(rng.standard_normal(len(t))))
    e = np.exp(-t * 18) + 0.6 * np.exp(-np.maximum(t - 0.012, 0) * 40) * (t > 0.012)
    return norm(n * e, 0.3)
C = clap()
for b in np.arange(DROP + BEAT, OUTRO, 2 * BEAT): add(C, b, 0.5, 0.05)
# Hats: closed on 16ths (soft), open on off-beats
def hat(dec):
    t = t_(int(0.25 * SR)); return norm(hp(hp(rng.standard_normal(len(t)))) * np.exp(-t * dec), 0.09)
HC, HO = hat(60), hat(12)
for i, b in enumerate(np.arange(DROP, OUTRO, BEAT / 4)):
    if i % 4 == 2: add(HO, b, 0.6, 0.25)
    elif b > DROP + 8 * BEAT: add(HC, b, 0.25 + 0.15 * (i % 2), -0.25)
# Bass: off-beat 8ths on chord root
for bar in range(bars):
    st = bar * 4 * BEAT
    if st < DROP or st >= OUTRO: continue
    for e8 in range(8):
        if e8 % 2 == 0: continue
        d = BEAT / 2 * 0.9; f = midi(ROOT[bar % 4] - 12 + (12 if e8 == 7 else 0))
        s = saw(f, d, harm=10, bright=0.6) * env(int(d * SR), 0.005, 0.05)
        add(np.tanh(s * 1.5) * 0.22, st + e8 * BEAT / 2)
# Pluck arpeggio after the second phrase
for bar in range(bars):
    st = bar * 4 * BEAT
    if st < DROP + 8 * BEAT or st >= OUTRO: continue
    notes = CH[bar % 4] + [CH[bar % 4][0] + 12]
    for s16 in range(16):
        if s16 % 3 == 2: continue
        m = notes[(s16 * 3) % 4] + 12; d = 0.22
        t = t_(int(d * SR)); s = (np.sin(2*np.pi*midi(m)*t) + 0.3*np.sin(4*np.pi*midi(m)*t)) * np.exp(-t * 16)
        add(s * 0.07, st + s16 * BEAT / 4, pan=0.4 * np.sin(s16))
# Riser into drop + reverse swell into outro, impacts
def riser(d):
    t = t_(int(d * SR)); n = hp(rng.standard_normal(len(t))); return norm(n * (t / d) ** 3, 0.18)
add(riser(3.0), DROP - 3.0, 0.8); add(riser(2.0), OUTRO - 2.0, 0.7)
def impact():
    t = t_(int(2.5 * SR)); return (np.sin(2*np.pi*42*t) * np.exp(-t * 2.2) * 0.8 + rng.standard_normal(len(t)) * np.exp(-t * 6) * 0.05)
add(impact(), DROP, 0.6); add(impact(), OUTRO, 0.6)
# Outro: sustained final chord
d = DUR - OUTRO
for m in [57, 60, 64, 69]:
    for det in (-0.004, 0.004):
        add(saw(midi(m), d, harm=14, bright=0.7, det=det) * env(int(d * SR), 0.02, d * 0.9), OUTRO, 0.05)
# Master: fade, soft clip, normalise
fade = np.ones(N); fi = int(2.5 * SR); fade[-fi:] = np.linspace(1, 0, fi) ** 2
out = np.stack([L, R], 1) * fade[:, None]
out = np.tanh(out * 1.2) ; out /= np.abs(out).max() / 0.89
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((out * 32767).astype('<i2').tobytes())
print('ok', DUR)
