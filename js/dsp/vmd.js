/**
 * vmd.js — Variational Mode Decomposition, ported line-for-line from vmdpy 0.2
 * (the implementation session2_vmd.py and session3_vae_sweep.py call).
 *
 *   VMD(f, alpha, tau, K, DC, init, tol)  →  { u, omega }
 *
 * Same mirror extension, same normalised frequency grid, same Wiener-filter
 * mode update and centre-of-gravity omega update, same convergence test, same
 * 500-iteration cap. Only the bookkeeping differs: vmdpy keeps every iterate
 * in memory, we keep the previous one, and because f_hat_plus is zero on the
 * negative half (and lambda never leaves zero there) we only update the
 * positive half of the spectrum.
 *
 * omega is returned in cycles/sample, exactly like vmdpy — multiply by the
 * sampling rate for Hz, as the pipeline does with `omega[-1, :] * SFREQ`.
 */
import { fft, isPow2 } from './fft.js';

export function vmd(signal, opts = {}) {
  const {
    alpha = 2000, tau = 0, K = 8, DC = false, init = 1, tol = 1e-7, maxIter = 500,
  } = opts;

  let f = signal;
  if (f.length % 2) f = f.subarray ? f.subarray(0, f.length - 1) : f.slice(0, -1);
  const N = f.length;
  const half = N >> 1;
  const T = 2 * N;
  if (!isPow2(T)) throw new Error(`VMD mirrored length ${T} must be a power of two`);

  // Mirror extension: [flip(f[:N/2]), f, flip(f[-N/2:])]
  const re = new Float64Array(T);
  const im = new Float64Array(T);
  for (let i = 0; i < half; i++) re[i] = f[half - 1 - i];
  for (let i = 0; i < N; i++) re[half + i] = f[i];
  for (let i = 0; i < half; i++) re[half + N + i] = f[N - 1 - i];
  fft(re, im);

  // fftshift, then keep only the positive half (f_hat_plus)
  const H = T >> 1;
  const fRe = new Float64Array(T);
  const fIm = new Float64Array(T);
  for (let k = H; k < T; k++) {
    const s = (k + H) % T;
    fRe[k] = re[s];
    fIm[k] = im[s];
  }

  // freqs = t - 0.5 - 1/T, t = (1..T)/T  →  k/T - 0.5
  const freqs = new Float64Array(T);
  for (let k = 0; k < T; k++) freqs[k] = k / T - 0.5;

  let omega = new Float64Array(K);
  if (init === 1) for (let i = 0; i < K; i++) omega[i] = (0.5 / K) * i;
  else if (init === 2) {
    const fs = 1 / N;
    const r = Array.from({ length: K }, () => Math.exp(Math.log(fs) + (Math.log(0.5) - Math.log(fs)) * Math.random()));
    r.sort((a, b) => a - b).forEach((v, i) => { omega[i] = v; });
  }
  if (DC) omega[0] = 0;

  const size = K * T;
  let uRe = new Float64Array(size), uIm = new Float64Array(size);
  let nRe = new Float64Array(size), nIm = new Float64Array(size);
  const lamRe = new Float64Array(T), lamIm = new Float64Array(T);
  const sumRe = new Float64Array(T), sumIm = new Float64Array(T);
  const nextOmega = new Float64Array(K);

  let uDiff = tol + Number.EPSILON;
  let n = 0;
  let prevOmega = Float64Array.from(omega);
  while (uDiff > tol && n < maxIter - 1) {
    for (let k = 0; k < K; k++) {
      const prevOff = (k === 0 ? K - 1 : k - 1) * T;
      const prevArrRe = k === 0 ? uRe : nRe;
      const prevArrIm = k === 0 ? uIm : nIm;
      const off = k * T;
      const a = alpha;
      const w = omega[k];
      let num = 0, den = 0;
      for (let j = H; j < T; j++) {
        // accumulator: sum_uk = u[k-1] + sum_uk - u_prev[k]
        sumRe[j] = prevArrRe[prevOff + j] + sumRe[j] - uRe[off + j];
        sumIm[j] = prevArrIm[prevOff + j] + sumIm[j] - uIm[off + j];
        const d = freqs[j] - w;
        const g = 1 / (1 + a * d * d);
        const vr = (fRe[j] - sumRe[j] - lamRe[j] / 2) * g;
        const vi = (fIm[j] - sumIm[j] - lamIm[j] / 2) * g;
        nRe[off + j] = vr;
        nIm[off + j] = vi;
        const p = vr * vr + vi * vi;
        num += freqs[j] * p;
        den += p;
      }
      nextOmega[k] = (k === 0 && DC) ? 0 : (den > 0 ? num / den : omega[k]);
    }

    if (tau !== 0) {
      for (let j = H; j < T; j++) {
        let sr = 0, si = 0;
        for (let k = 0; k < K; k++) { sr += nRe[k * T + j]; si += nIm[k * T + j]; }
        lamRe[j] += tau * (sr - fRe[j]);
        lamIm[j] += tau * (si - fIm[j]);
      }
    }

    n++;
    uDiff = Number.EPSILON;
    for (let i = 0; i < size; i++) {
      const dr = nRe[i] - uRe[i], di = nIm[i] - uIm[i];
      uDiff += (dr * dr + di * di) / T;
    }
    uDiff = Math.abs(uDiff);

    [uRe, nRe] = [nRe, uRe];
    [uIm, nIm] = [nIm, uIm];
    prevOmega = omega;
    omega = Float64Array.from(nextOmega);
  }

  // vmdpy reads back u_hat_plus[Niter-1] and omega_plus[Niter-1] with
  // Niter = n — one iterate behind the last update. Match it: after the final
  // swap, nRe/nIm hold that iterate and prevOmega holds its centre frequencies.
  uRe = nRe; uIm = nIm;
  omega = prevOmega;

  // Reconstruction: Hermitian-symmetric spectrum, ifftshift, ifft, drop the mirror.
  const u = [];
  const bRe = new Float64Array(T), bIm = new Float64Array(T);
  for (let k = 0; k < K; k++) {
    const off = k * T;
    const sRe = new Float64Array(T), sIm = new Float64Array(T);
    for (let j = H; j < T; j++) { sRe[j] = uRe[off + j]; sIm[j] = uIm[off + j]; }
    // u_hat[idxs] = conj(u_hat_plus[T/2:T]), idxs = T/2, T/2-1, ..., 1
    for (let m = 0; m < H; m++) {
      const idx = H - m;
      sRe[idx] = uRe[off + H + m];
      sIm[idx] = -uIm[off + H + m];
    }
    sRe[0] = sRe[T - 1];
    sIm[0] = -sIm[T - 1];
    for (let j = 0; j < T; j++) {
      const s = (j + H) % T;
      bRe[j] = sRe[s];
      bIm[j] = sIm[s];
    }
    fft(bRe, bIm, true);
    u.push(Float64Array.from(bRe.subarray(T / 4, (3 * T) / 4)));
  }

  return { u, omega: Array.from(omega), iterations: n };
}
