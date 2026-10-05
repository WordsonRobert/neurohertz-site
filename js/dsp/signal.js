/**
 * signal.js — The NeuroHertz pipeline, in the browser.
 *
 *   synthRecording  a deterministic 19-channel eyes-closed EEG stand-in
 *   bandpass/notch  zero-phase spectral filters (Session 1)
 *   averageReference subtract the across-electrode mean at every instant
 *   removeSpikes    MAD spike repair, ported verbatim from session1_preprocess.py
 *   hilbert         the analytic signal, as scipy.signal.hilbert builds it
 *   instFreq        diff(unwrap(angle)) · fs / 2π, as Sessions 2–4 compute it
 *
 * The recording is synthetic — no patient data ships with the site — but every
 * transform applied to it is the real one.
 */
import { fft, isPow2 } from './fft.js';
import { vmd } from './vmd.js';
import { CHANNELS } from './montage.js';

export const FS = 500;

/* ── Deterministic randomness ─────────────────────────────────────────────── */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.gauss = () => {
    const u = Math.max(next(), 1e-12), v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return next;
}

/* ── Spectral shaping helpers ─────────────────────────────────────────────── */
function shapedNoise(N, r, gain) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let k = 1; k < N / 2; k++) {
    const f = (k * FS) / N;
    const g = gain(f);
    if (!g) continue;
    const ph = r() * 2 * Math.PI;
    re[k] = g * Math.cos(ph); im[k] = g * Math.sin(ph);
    re[N - k] = re[k]; im[N - k] = -im[k];
  }
  fft(re, im, true);
  return normalise(re);
}

function normalise(x) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m += x[i];
  m /= x.length;
  let s = 0;
  for (let i = 0; i < x.length; i++) { x[i] -= m; s += x[i] * x[i]; }
  s = Math.sqrt(s / x.length) || 1;
  for (let i = 0; i < x.length; i++) x[i] /= s;
  return x;
}

const smooth = (cut) => (f) => Math.exp(-0.5 * (f / cut) ** 2);

/* ── The synthetic subject ─────────────────────────────────────────────────── */
const LOBE_ALPHA = { occipital: 1, parietal: 0.8, temporal: 0.5, central: 0.35, frontal: 0.15 };
const LOBE_GAMMA = { occipital: 0.75, parietal: 1, temporal: 0.6, central: 0.8, frontal: 0.55 };

/**
 * A 19-channel, N-sample eyes-closed recording in µV.
 *
 * The gamma generator is what differs between subjects:
 *   wander  standard deviation (Hz) of slow frequency excursions around 40 Hz
 *   slips   phase slips per second — moments where the rhythm stumbles and
 *           re-locks, which is what drives the instantaneous frequency off its
 *           centre inside VMD's mode bandwidth
 */
export function synthRecording({ seed = 7, N = 4096, wander = 3, slips = 0, gammaAmp = 4.2, artifacts = true } = {}) {
  const r = rng(seed);
  const slipR = rng(seed * 31 + 5);
  const t = (i) => i / FS;

  // Shared generators — volume conduction means every electrode hears them.
  const alphaEnv = shapedNoise(N, r, smooth(0.35)).map((v) => 0.75 + 0.3 * v);
  const alphaFm = shapedNoise(N, r, smooth(0.5));
  const gammaEnv = shapedNoise(N, r, smooth(1.2)).map((v) => Math.max(0.15, 1 + 0.35 * v));
  const gammaFm = shapedNoise(N, r, smooth(2.2));
  const drift = shapedNoise(N, r, smooth(0.12));

  // Phase slips: smooth phase steps of random size over ~24 ms.
  const slipStep = new Float64Array(N);
  if (slips > 0) {
    const width = Math.round(0.024 * FS);
    let at = 0;
    for (;;) {
      at += Math.max(0.02, -Math.log(Math.max(slipR(), 1e-9)) / slips) * FS;
      if (at >= N) break;
      const jump = (slipR() * 2 - 1) * Math.PI * 0.9;
      for (let k = 0; k < width; k++) {
        const i = Math.floor(at) + k;
        if (i < N) slipStep[i] += (jump * (1 - Math.cos((2 * Math.PI * (k + 0.5)) / width))) / width;
      }
    }
  }

  const alphaPhase = new Float64Array(N);
  const gammaPhase = new Float64Array(N);
  for (let i = 1; i < N; i++) {
    alphaPhase[i] = alphaPhase[i - 1] + (2 * Math.PI * (10 + 0.4 * alphaFm[i])) / FS;
    gammaPhase[i] = gammaPhase[i - 1] + (2 * Math.PI * (40 + wander * gammaFm[i])) / FS + slipStep[i];
  }

  const data = CHANNELS.map((ch, c) => {
    const bg = shapedNoise(N, r, (f) => (f < 0.3 ? 0 : 1 / f ** 0.85));
    const beta = shapedNoise(N, r, (f) => Math.exp(-0.5 * ((f - 20) / 3) ** 2));
    const wa = LOBE_ALPHA[ch.lobe], wg = LOBE_GAMMA[ch.lobe];
    const lag = (c / CHANNELS.length) * 0.6;
    const humPhase = r() * 2 * Math.PI;
    const x = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      x[i] =
        7 * bg[i] +
        16 * wa * alphaEnv[i] * Math.sin(alphaPhase[i] + lag) +
        2.2 * beta[i] +
        gammaAmp * wg * gammaEnv[i] * Math.sin(gammaPhase[i] + lag * 0.5) +
        5 * Math.sin(2 * Math.PI * 50 * t(i) + humPhase) +
        22 * drift[i] * (0.6 + 0.4 * Math.sin(c)) +
        0.9 * r.gauss();
    }
    return x;
  });

  if (artifacts) addArtifacts(data, r, N);
  return data;
}

function addArtifacts(data, r, N) {
  const idx = (id) => CHANNELS.findIndex((c) => c.id === id);
  const bump = (ch, at, amp, width) => {
    const c = idx(ch), s = at * FS, w = width * FS;
    for (let i = Math.max(0, Math.floor(s - 4 * w)); i < Math.min(N, s + 4 * w); i++) {
      data[c][i] += amp * Math.exp(-0.5 * ((i - s) / w) ** 2);
    }
  };
  const pop = (ch, at, amp) => {
    const c = idx(ch), s = Math.floor(at * FS);
    for (let i = s; i < Math.min(N, s + 40); i++) data[c][i] += amp * Math.exp(-(i - s) / 6);
  };
  const burst = (ch, at, dur, amp) => {
    const c = idx(ch), s = Math.floor(at * FS), e = Math.min(N, s + dur * FS);
    for (let i = s; i < e; i++) data[c][i] += amp * r.gauss() * Math.sin((Math.PI * (i - s)) / (e - s));
  };
  const span = N / FS;
  // Eye blinks: large slow deflections over the frontopolar sites.
  for (const at of [0.26, 0.74]) {
    bump('Fp1', at * span, 130, 0.07); bump('Fp2', at * span, 125, 0.07);
    bump('F7', at * span, 40, 0.07);   bump('F8', at * span, 38, 0.07);
  }
  // Electrode pops — the sharp transients MAD repair exists for.
  pop('P3', 0.41 * span, 95);
  pop('T4', 0.58 * span, -80);
  pop('O2', 0.88 * span, 70);
  // A burst of jaw-muscle activity at the temporal sites.
  burst('T3', 0.64 * span, 0.25, 45);
  burst('T5', 0.645 * span, 0.2, 25);
}

/* ── Session 1: cleaning ──────────────────────────────────────────────────── */

/**
 * Zero-phase spectral filter with a mirrored pad (so the circular transform
 * sees no edge jump). `gain(fHz)` returns the amplitude response.
 */
export function spectralFilter(x, gain) {
  const N = x.length;
  const M = 2 * N;
  if (!isPow2(M)) throw new Error('filter length must be a power of two');
  const re = new Float64Array(M), im = new Float64Array(M);
  const q = N >> 1;
  for (let i = 0; i < q; i++) re[i] = x[q - 1 - i];
  for (let i = 0; i < N; i++) re[q + i] = x[i];
  for (let i = 0; i < q; i++) re[q + N + i] = x[N - 1 - i];
  fft(re, im);
  for (let k = 0; k <= M / 2; k++) {
    const g = gain((k * FS) / M);
    re[k] *= g; im[k] *= g;
    if (k > 0 && k < M / 2) { re[M - k] *= g; im[M - k] *= g; }
  }
  fft(re, im, true);
  return Float64Array.from(re.subarray(q, q + N));
}

const ramp = (f, a, b) => (f <= a ? 0 : f >= b ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * (f - a)) / (b - a)));

export function bandpassGain(lo, hi) {
  const loW = Math.max(0.1, lo * 0.5), hiW = 4;
  return (f) => ramp(f, lo - loW, lo + loW) * (1 - ramp(f, hi - hiW / 2, hi + hiW / 2));
}

export function notchGain(f0, width = 0.8) {
  return (f) => 1 - Math.exp(-0.5 * ((f - f0) / width) ** 2);
}

export function averageReference(data) {
  const C = data.length, N = data[0].length;
  const out = data.map((ch) => new Float64Array(ch));
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let c = 0; c < C; c++) m += data[c][i];
    m /= C;
    for (let c = 0; c < C; c++) out[c][i] -= m;
  }
  return out;
}

function median(arr) {
  const s = Float64Array.from(arr).sort();
  const n = s.length, h = n >> 1;
  return n % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/**
 * session1_preprocess.remove_spikes_amplitude, line for line — including the
 * detail that the threshold is applied to |x|, not |x − median(x)|.
 */
export function removeSpikes(signal, thresholdStd = 5.0, interpMargin = 10) {
  const x = Float64Array.from(signal);
  const n = x.length;
  const med = median(x);
  const mad = median(x.map((v) => Math.abs(v - med)));
  const robustStd = mad / 0.6745;
  const threshold = thresholdStd * robustStd;

  const expanded = new Uint8Array(n);
  let flagged = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(x[i]) > threshold) {
      flagged++;
      const s = Math.max(0, i - interpMargin), e = Math.min(n, i + interpMargin + 1);
      for (let j = s; j < e; j++) expanded[j] = 1;
    }
  }

  const good = [];
  for (let i = 0; i < n; i++) if (!expanded[i]) good.push(i);
  if (good.length > 1 && good.length < n) {
    // np.interp: linear between the nearest good neighbours, clamped at the ends.
    let g = 0; // good[g] is the last trusted sample before i (when one exists)
    for (let i = 0; i < n; i++) {
      if (!expanded[i]) continue;
      while (g + 1 < good.length && good[g + 1] < i) g++;
      const left = good[g] < i ? good[g] : null;
      const right = left === null ? good[0] : g + 1 < good.length ? good[g + 1] : null;
      if (left === null) x[i] = signal[right];
      else if (right === null) x[i] = signal[left];
      else x[i] = signal[left] + ((signal[right] - signal[left]) * (i - left)) / (right - left);
    }
  }

  const regions = [];
  for (let i = 0; i < n; i++) {
    if (expanded[i] && (i === 0 || !expanded[i - 1])) regions.push([i, i]);
    if (expanded[i]) regions[regions.length - 1][1] = i;
  }
  return { cleaned: x, threshold, robustStd, mad, median: med, flagged, regions };
}

/** Full Session 1 on a 19 × N recording. */
export function cleanRecording(raw, p = {}) {
  const { lo = 0.5, hi = 80, notch = true, threshold = 5, margin = 10 } = p;
  const bp = bandpassGain(lo, hi);
  const nt = notchGain(50);
  const gain = notch ? (f) => bp(f) * nt(f) : bp;
  const filtered = raw.map((ch) => spectralFilter(ch, gain));
  const referenced = averageReference(filtered);
  const spikes = referenced.map((ch) => removeSpikes(ch, threshold, margin));
  return { filtered, referenced, cleaned: spikes.map((s) => s.cleaned), spikes };
}

/* ── Sessions 2–4: decomposition, rhythm, the number ──────────────────────── */

export function hilbert(x) {
  const N = x.length;
  const re = Float64Array.from(x), im = new Float64Array(N);
  fft(re, im);
  for (let k = 1; k < N / 2; k++) { re[k] *= 2; im[k] *= 2; }
  for (let k = N / 2 + 1; k < N; k++) { re[k] = 0; im[k] = 0; }
  fft(re, im, true);
  return { re, im };
}

export function instFreq({ re, im }) {
  const N = re.length;
  const envelope = new Float64Array(N);
  const f = new Float64Array(N);
  let prev = Math.atan2(im[0], re[0]);
  envelope[0] = Math.hypot(re[0], im[0]);
  for (let i = 1; i < N; i++) {
    envelope[i] = Math.hypot(re[i], im[i]);
    const ph = Math.atan2(im[i], re[i]);
    let d = ph - prev;
    // np.unwrap: fold each step into (−π, π]
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    f[i - 1] = (d * FS) / (2 * Math.PI);
    prev = ph;
  }
  f[N - 1] = f[N - 2];
  return { envelope, f };
}

export function std(arr) {
  let m = 0;
  for (const v of arr) m += v;
  m /= arr.length;
  let s = 0;
  for (const v of arr) s += (v - m) ** 2;
  return Math.sqrt(s / arr.length);
}

/**
 * One channel through Sessions 2–4: VMD → nearest-to-target mode → Hilbert →
 * instantaneous frequency → keep 25–80 Hz → standard deviation.
 */
export function analyse(signal, p = {}) {
  const { K = 8, alpha = 2000, target = 40, validLo = 25, validHi = 80 } = p;
  const { u, omega, iterations } = vmd(signal, { alpha, K, tau: 0, DC: false, init: 1, tol: 1e-7 });
  const omegaHz = omega.map((w) => w * FS);
  let gammaIdx = 0;
  for (let k = 1; k < K; k++) {
    if (Math.abs(omegaHz[k] - target) < Math.abs(omegaHz[gammaIdx] - target)) gammaIdx = k;
  }
  const gamma = u[gammaIdx];
  const { envelope, f } = instFreq(hilbert(gamma));
  const valid = [];
  for (const v of f) if (v > validLo && v < validHi) valid.push(v);
  const stdIfreq = valid.length >= 2 ? std(valid) : NaN;
  const meanIfreq = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : NaN;
  return {
    modes: u, omegaHz, gammaIdx, gamma, envelope, ifreq: f,
    validCount: valid.length, stdIfreq, meanIfreq, iterations,
  };
}
