/**
 * pipeline.js — The four phases wired together, with the defaults taken from
 * the NeuroHertz scripts. Everything the film and the lab draw comes out of
 * `runPipeline`; nothing on the page invents a signal value of its own.
 */
import { synthRecording, cleanRecording, analyse, FS } from './signal.js';
import { P3_INDEX } from './montage.js';

/** Sample range VMD sees: 2048 samples (4.1 s) from the middle of the recording. */
export const WINDOW = [1024, 3072];
export const N_SAMPLES = 4096;

/**
 * The two synthetic subjects. Same seed, same background, same artifacts —
 * only the gamma generator differs: the wandering one is weaker, drifts
 * further and slips phase more often. Their std_ifreq values are real
 * measurements of synthetic 4-second windows; they are not on the same scale
 * as the reported 10-minute clinical values and the page never implies so.
 */
export const SUBJECTS = {
  steady:    { label: 'Steady gamma',    seed: 7, wander: 2,   slips: 0.5, gammaAmp: 4.2 },
  wandering: { label: 'Wandering gamma', seed: 7, wander: 3.5, slips: 5,   gammaAmp: 1.0 },
};

/** Defaults, named after the constants in session1–4. */
export const DEFAULTS = Object.freeze({
  lo: 0.5,          // session1: raw.filter(l_freq=0.5)
  hi: 80,           // session1: h_freq=80.0
  notch: true,      // session1: notch_filter(freqs=[50.0])
  threshold: 5,     // session1: threshold_std=5.0
  margin: 10,       // session1: interp_margin=10
  K: 8,             // session2: VMD_K
  alpha: 2000,      // session2: VMD_ALPHA
  target: 40,       // session2: TARGET_HZ
  validLo: 25,      // session4: inst_freq > 25
  validHi: 80,      // session4: inst_freq < 80
  channel: P3_INDEX,
});

const rawCache = new Map();
function raw(subject) {
  if (!rawCache.has(subject)) {
    const s = SUBJECTS[subject];
    rawCache.set(subject, synthRecording({ ...s, N: N_SAMPLES }));
  }
  return rawCache.get(subject);
}

export function runPipeline(subject = 'steady', params = {}) {
  const p = { ...DEFAULTS, ...params };
  const rec = raw(subject);
  const clean = cleanRecording(rec, p);
  const signal = clean.cleaned[p.channel].subarray(WINDOW[0], WINDOW[1]);
  const result = analyse(signal, p);
  return { params: p, raw: rec, clean, signal, ...result, fs: FS };
}
