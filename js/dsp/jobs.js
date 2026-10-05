/**
 * jobs.js — The three computations the page asks for, packed into typed
 * arrays so they can cross the worker boundary without copying.
 *
 *   film  everything chapters 01–05 draw (both synthetic subjects)
 *   lab   both subjects through the pipeline with the lab's parameters
 *   grid  the 4 × 4 K/α sweep on the steady subject, one cell at a time
 */
import { runPipeline, WINDOW, N_SAMPLES } from './pipeline.js';
import { analyse, FS } from './signal.js';

const f32 = (a) => (a instanceof Float32Array ? a : Float32Array.from(a));

function packAnalysis(r) {
  return {
    signal: f32(r.signal),
    modes: r.modes.map(f32),
    omegaHz: r.omegaHz,
    gammaIdx: r.gammaIdx,
    gamma: f32(r.gamma),
    envelope: f32(r.envelope),
    ifreq: f32(r.ifreq),
    std: r.stdIfreq,
    mean: r.meanIfreq,
    validCount: r.validCount,
    iterations: r.iterations,
  };
}

function collect(obj, out = []) {
  if (!obj || typeof obj !== 'object') return out;
  if (ArrayBuffer.isView(obj)) { out.push(obj.buffer); return out; }
  for (const v of Object.values(obj)) collect(v, out);
  return out;
}

export function film() {
  const s = runPipeline('steady');
  const w = runPipeline('wandering');
  const result = {
    fs: FS, n: N_SAMPLES, window: WINDOW, channel: s.params.channel,
    raw: s.raw.map(f32),
    clean: s.clean.cleaned.map(f32),
    spikes: s.clean.spikes.map((sp) => ({ threshold: sp.threshold, regions: sp.regions, flagged: sp.flagged })),
    steady: packAnalysis(s),
    wandering: packAnalysis(w),
  };
  return { result, transfer: collect(result) };
}

export function lab(params) {
  const out = {};
  for (const subject of ['steady', 'wandering']) {
    const r = runPipeline(subject, params);
    const ch = r.params.channel;
    const [a, b] = WINDOW;
    const sp = r.clean.spikes[ch];
    out[subject] = {
      ...packAnalysis(r),
      raw: f32(r.raw[ch].subarray(a, b)),
      referenced: f32(r.clean.referenced[ch].subarray(a, b)),
      threshold: sp.threshold,
      regions: sp.regions.filter(([s, e]) => e >= a && s < b).map(([s, e]) => [Math.max(0, s - a), Math.min(b - a - 1, e - a)]),
    };
  }
  out.params = runPipeline('steady', params).params;
  return { result: out, transfer: collect(out) };
}

export const GRID_K = [6, 7, 8, 9];
export const GRID_ALPHA = [1000, 2000, 3000, 4000];

export function grid(_params, progress) {
  const base = runPipeline('steady');
  const cells = [];
  for (const K of GRID_K) {
    for (const alpha of GRID_ALPHA) {
      const r = analyse(base.signal, { ...base.params, K, alpha });
      const cell = { K, alpha, gammaHz: r.omegaHz[r.gammaIdx], std: r.stdIfreq, gamma: f32(r.gamma.subarray(0, 300)) };
      cells.push(cell);
      if (progress) progress(cell);
    }
  }
  return { result: { cells: cells.map(({ gamma, ...rest }) => rest) }, transfer: [] };
}
