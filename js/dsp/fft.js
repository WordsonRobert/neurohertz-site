/**
 * fft.js — In-place iterative radix-2 complex FFT.
 *
 * Every transform in the site goes through here: the band-pass and notch,
 * VMD's spectral updates, and the Hilbert transform. Lengths are always a
 * power of two because we choose the window lengths ourselves.
 */

const twiddles = new Map();

function table(n) {
  let t = twiddles.get(n);
  if (t) return t;
  t = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2) };
  for (let i = 0; i < n / 2; i++) {
    t.cos[i] = Math.cos((2 * Math.PI * i) / n);
    t.sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  twiddles.set(n, t);
  return t;
}

export function isPow2(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

/** Forward (inverse=false) or inverse FFT. Inverse is scaled by 1/n like numpy. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  if (!isPow2(n)) throw new Error(`fft length ${n} is not a power of two`);

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  const { cos, sin } = table(n);
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const wr = cos[j * step];
        const wi = sign * sin[j * step];
        const a = i + j, b = a + half;
        const vr = re[b] * wr - im[b] * wi;
        const vi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr;        im[a] += vi;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}
