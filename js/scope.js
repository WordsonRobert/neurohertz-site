/**
 * scope.js — The film's oscilloscope. One canvas follows one wave through
 * chapters 01–05:
 *
 *   f ∈ [0,1)  19 raw rows, framed as the matrix X
 *   f ∈ [1,2)  each row cleaned; spikes flagged and redrawn
 *   f ∈ [2,3)  P3 lifted out and split into its VMD modes; gamma kept
 *   f ∈ [3,4)  the gamma mode, its envelope, its phasor, its frequency
 *   f ∈ [4,5]  two recordings' frequency traces collapse to one number each
 *
 * The scroll story writes `f`; nothing else does. Every value drawn comes from
 * the DSP worker's run of the real pipeline on the synthetic recording.
 */
import { CHANNEL_IDS } from './dsp/montage.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createScope(canvas, data, opts = {}) {
  const ctx = canvas.getContext('2d');
  const { fs, window: [w0, w1], channel } = data;
  const L = w1 - w0;
  const P3 = channel;
  const cssW = () => canvas.clientWidth, cssH = () => canvas.clientHeight;

  // Window views of the full-length arrays, so every beat reads the same samples.
  const raw = data.raw.map((ch) => ch.subarray(w0, w1));
  const clean = data.clean.map((ch) => ch.subarray(w0, w1));
  const spikes = data.spikes.map((sp) => ({
    threshold: sp.threshold,
    regions: sp.regions.filter(([s, e]) => e >= w0 && s < w1).map(([s, e]) => [Math.max(0, s - w0), Math.min(L - 1, e - w0)]),
  }));
  const S = data.steady, Wd = data.wandering;
  const order = S.omegaHz.map((w, k) => [w, k]).sort((a, b) => a[0] - b[0]).map(([, k]) => k);
  const modeScale = S.modes.map((m) => { let mx = 1e-9; for (const v of m) mx = Math.max(mx, Math.abs(v)); return mx; });
  let envMax = 1e-9; for (const v of S.envelope) envMax = Math.max(envMax, v);

  let colors = readColors();
  let f = 0, visible = false, tape = 220, last = 0, raf = 0, dpr = 1;
  let plot = { x: 0, y: 0, w: 1, h: 1 };
  const hud = opts.hud || {};

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return {
      hi: v('--t-hi'), t: v('--t'), mid: v('--t-mid'), low: v('--t-low'),
      line: `rgb(${v('--line-rgb')} / 0.16)`, lineSoft: `rgb(${v('--line-rgb')} / 0.07)`,
      violet: v('--violet'), violetHi: v('--violet-hi'), amber: v('--amber'), amberRgb: v('--amber-rgb'),
      violetRgb: v('--violet-rgb'), cn: v('--cn'), ad: v('--ad'), panel: v('--panel'),
      mono: v('--font-mono') || 'monospace',
    };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW() * dpr);
    canvas.height = Math.round(cssH() * dpr);
    plot = opts.plotRect ? opts.plotRect(cssW(), cssH()) : { x: 24, y: 56, w: cssW() - 48, h: cssH() - 120 };
  }

  /* ── drawing helpers ─────────────────────────────────────────────────── */
  const sampleAt = (arr, i) => arr[((Math.floor(i) % L) + L) % L];

  /**
   * Stroke `count` samples starting at fractional index `start` across
   * [x0, x1]. The fractional part shifts the trace sub-pixel so a slow tape
   * glides instead of stepping a whole sample at a time.
   */
  function trace(getY, x0, x1, start, count, { color, width = 1.2, alpha = 1, clipTop = -Infinity, clipBot = Infinity, upTo = 1 }) {
    if (alpha <= 0.002) return;
    const base = Math.floor(start), frac = start - base;
    const cols = Math.max(2, Math.floor((x1 - x0) * upTo));
    const n = Math.max(2, Math.floor(count * upTo) + 1);
    const step = Math.max(1, n / cols / 1.5);
    const span = (x1 - x0) / (count - 1);
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, -1e4, (x1 - x0) * upTo, 2e4); ctx.clip();
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    let first = true;
    for (let k = 0; k <= n; k += step) {
      const kk = Math.floor(k);
      const x = x0 + (kk - frac) * span;
      const y = clamp(getY(base + kk), clipTop, clipBot);
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function text(str, x, y, { color = colors.low, size = 11, align = 'left', weight = 500, alpha = 1, base = 'middle', font } = {}) {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${font || colors.mono}`;
    ctx.textAlign = align; ctx.textBaseline = base;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  function hline(x0, x1, y, color, alpha = 1, width = 1) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x1, Math.round(y) + 0.5); ctx.stroke(); ctx.restore();
  }

  /* ── beats ───────────────────────────────────────────────────────────── */
  function drawMontage(W, start) {
    const { x, y, w, h } = plot;
    const labelW = 40;
    const x0 = x + labelW, x1 = x + w;
    const rowH = h / 19;
    const sel = smooth(2.0, 2.18, f);
    const c = smooth(1.2, 1.6, f);
    const flagA = smooth(1.02, 1.2, f) * (1 - smooth(1.85, 2.05, f));
    const scale = (rowH * 0.5) / 28;
    const matrixA = smooth(0.15, 0.45, f) * (1 - smooth(0.92, 1.1, f));

    // Matrix brackets and the highlighted column.
    if (matrixA > 0) {
      ctx.save();
      ctx.globalAlpha = matrixA;
      ctx.strokeStyle = colors.violetHi; ctx.lineWidth = 1.5;
      const bx0 = x0 - 8, bx1 = x1 + 2, by0 = y - 4, by1 = y + h + 4;
      ctx.beginPath();
      ctx.moveTo(bx0 + 8, by0); ctx.lineTo(bx0, by0); ctx.lineTo(bx0, by1); ctx.lineTo(bx0 + 8, by1);
      ctx.moveTo(bx1 - 8, by0); ctx.lineTo(bx1, by0); ctx.lineTo(bx1, by1); ctx.lineTo(bx1 - 8, by1);
      ctx.stroke();
      const cx = x0 + (x1 - x0) * 0.68;
      ctx.fillStyle = `rgb(${colors.violetRgb} / 0.14)`;
      ctx.fillRect(cx - 3, y, 6, h);
      ctx.restore();
      text('X ∈ ℝ¹⁹ˣᴺ', x0, y - 16, { color: colors.hi, size: 13, alpha: matrixA, weight: 600 });
      ctx.font = `600 13px ${colors.mono}`;
      text('N columns · one every 2 ms →', x0 + ctx.measureText('X ∈ ℝ¹⁹ˣᴺ').width + 18, y - 16, { color: colors.mid, alpha: matrixA });
      text('one column = one instant, 19 numbers', x0 + (x1 - x0) * 0.68 + 8, y + h + 14, { color: colors.violetHi, alpha: matrixA, align: 'center' });
    }

    if (f >= 1 && f < 2.05) {
      text('0.5–80 Hz · notch 50 Hz · average reference · MAD repair', x0, y - 16, { color: colors.mid, alpha: smooth(1.05, 1.25, f) * (1 - smooth(1.9, 2.05, f)) });
    }

    for (let r = 0; r < 19; r++) {
      const isP3 = r === P3;
      const baseY = y + (r + 0.5) * rowH;
      let cy = baseY, sc = scale, alpha = 1;
      if (sel > 0) {
        if (isP3) { cy = lerp(baseY, y + h * 0.075, sel); sc = lerp(scale, (h * 0.07) / 28, sel); }
        else alpha = 1 - sel * 0.97;
      }
      if (alpha < 0.01) continue;
      const label = CHANNEL_IDS[r];
      text(label, x, cy, { color: isP3 && sel > 0 ? colors.amber : colors.low, size: 10.5, alpha, weight: isP3 ? 600 : 500 });

      // Spike regions inside the visible window.
      const sp = spikes[r];
      if (flagA > 0 && sp.regions.length) {
        for (const [s, e] of sp.regions) {
          for (const shift of [0, L, -L]) {
            const a = (s + shift - start) / (W - 1), b = (e + shift - start) / (W - 1);
            if (b < 0 || a > 1) continue;
            const xa = x0 + clamp(a) * (x1 - x0), xb = x0 + clamp(b) * (x1 - x0);
            ctx.save();
            ctx.globalAlpha = flagA * alpha * 0.9;
            ctx.fillStyle = `rgb(${colors.amberRgb} / 0.16)`;
            ctx.fillRect(xa - 3, cy - rowH * 0.48, xb - xa + 6, rowH * 0.96);
            ctx.restore();
          }
        }
      }

      const rawArr = raw[r], cleanArr = clean[r];
      const clip = rowH * 1.05;
      const rx0 = isP3 ? lerp(x0, x + 96, sel) : x0;
      trace((i) => {
        const v = lerp(sampleAt(rawArr, i), sampleAt(cleanArr, i), c);
        return cy - v * sc;
      }, rx0, x1, start, W, {
        color: isP3 && sel > 0.5 ? colors.hi : colors.t,
        width: isP3 && sel > 0 ? lerp(1.1, 1.6, sel) : 1.05,
        alpha: alpha * (isP3 ? 1 : 0.85),
        clipTop: cy - clip, clipBot: cy + clip,
      });
    }
    return { x0, x1 };
  }

  function drawModes(W, start) {
    const { x, y, w, h } = plot;
    const labelW = 96;
    const x0 = x + labelW, x1 = x + w;
    const emerge = smooth(2.12, 2.4, f);
    const pick = smooth(2.48, 2.66, f);
    const fadeOut = 1 - smooth(3.0, 3.25, f);
    if (emerge <= 0 || fadeOut <= 0) return;
    const K = order.length;
    const top = y + h * 0.2, rowH = (h * 0.8) / K;
    const srcY = y + h * 0.075, srcSc = (h * 0.07) / 28;
    text('P3', x, srcY, { color: colors.amber, size: 10.5, alpha: fadeOut, weight: 600 });
    text('x(t)', x + 26, srcY, { color: colors.mid, size: 10.5, alpha: fadeOut });
    trace((i) => srcY - sampleAt(clean[P3], i) * srcSc, x0, x1, start, W, { color: colors.hi, width: 1.6, alpha: fadeOut, clipTop: srcY - h * 0.075, clipBot: srcY + h * 0.075 });
    text('Σ uₖ(t) ≈ x(t)', x1, y + h * 0.075 - rowH * 0.62, { color: colors.mid, align: 'right', alpha: emerge * fadeOut });
    order.forEach((k, idx) => {
      const appear = smooth(2.12 + idx * 0.026, 2.3 + idx * 0.026, f);
      if (appear <= 0) return;
      const isG = k === S.gammaIdx;
      const targetY = top + (idx + 0.5) * rowH;
      const cy = lerp(y + h * 0.075, targetY, appear);
      const dim = isG ? 1 : 1 - pick * 0.62;
      const alpha = appear * dim * fadeOut;
      const color = isG && pick > 0.2 ? colors.amber : colors.t;
      const sc = (rowH * 0.4) / modeScale[k];
      const m = S.modes[k];
      text(`u${idx + 1}`, x, cy, { color: isG && pick > 0.2 ? colors.amber : colors.low, size: 10.5, alpha, weight: 600 });
      text(`${S.omegaHz[k].toFixed(1)} Hz`, x + 26, cy, { color: isG && pick > 0.2 ? colors.hi : colors.mid, size: 10.5, alpha });
      trace((i) => cy - sampleAt(m, i) * sc, x0, x1, start, W, { color, width: isG ? lerp(1.2, 2, pick) : 1.1, alpha });
      if (isG && pick > 0) {
        text(`nearest 40 Hz · |${S.omegaHz[k].toFixed(1)} − 40| = ${Math.abs(S.omegaHz[k] - 40).toFixed(1)}`, x1, cy - rowH * 0.5, { color: colors.hi, align: 'right', alpha: pick * fadeOut, size: 10.5 });
      }
    });
    text('each mode scaled to fit its row', x0, y + h + 14, { color: colors.low, alpha: emerge * fadeOut, size: 10 });
  }

  function drawRhythm(W, start) {
    const a = smooth(3.0, 3.3, f) * (1 - smooth(3.9, 4.12, f));
    if (a <= 0) return;
    const { x, y, w, h } = plot;
    const narrow = w < 560;
    const phW = narrow ? 0 : Math.min(w * 0.26, h * 0.5);
    const x0 = x, x1 = x + w - (phW ? phW + 28 : 0);
    const gTop = y + h * 0.02, gH = h * 0.42;
    const gc = gTop + gH / 2;
    const sc = (gH * 0.46) / envMax;
    const g = S.gamma, env = S.envelope, fr = S.ifreq;

    text('γ mode · u(t) with envelope ±A(t)', x0, gTop - 4, { color: colors.mid, alpha: a, base: 'bottom' });
    // Envelope band.
    ctx.save();
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = `rgb(${colors.amberRgb} / 0.12)`;
    ctx.beginPath();
    const n = W;
    for (let k = 0; k < n; k++) { const xx = x0 + (k / (n - 1)) * (x1 - x0); const yy = gc - sampleAt(env, start + k) * sc; k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
    for (let k = n - 1; k >= 0; k--) { const xx = x0 + (k / (n - 1)) * (x1 - x0); ctx.lineTo(xx, gc + sampleAt(env, start + k) * sc); }
    ctx.closePath(); ctx.fill();
    ctx.restore();
    trace((i) => gc - sampleAt(g, i) * sc, x0, x1, start, W, { color: colors.amber, width: 1.6, alpha: a });

    // Instantaneous frequency.
    const fTop = y + h * 0.56, fH = h * 0.42;
    const fMin = 15, fMax = 75;
    const fy = (v) => fTop + fH - ((v - fMin) / (fMax - fMin)) * fH;
    text('f(t) = Δφ ⁄ 2π · 500 Hz', x0, fTop - 6, { color: colors.mid, alpha: a, base: 'bottom' });
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = `rgb(${colors.violetRgb} / 0.07)`;
    ctx.fillRect(x0, fy(75), x1 - x0, fy(25) - fy(75)); ctx.restore();
    hline(x0, x1, fy(40), colors.line, a);
    for (const v of [20, 40, 60]) text(`${v}`, x1 + 6, fy(v), { color: colors.low, alpha: a, size: 10 });
    trace((i) => fy(sampleAt(fr, i)), x0, x1, start, W, { color: colors.violetHi, width: 1.5, alpha: a, clipTop: fTop, clipBot: fTop + fH });

    // "Now" marker at the right edge, and the phasor it drives.
    const nowI = Math.floor(start) + W - 1;
    ctx.save(); ctx.globalAlpha = a * 0.6; ctx.strokeStyle = colors.line; ctx.beginPath(); ctx.moveTo(x1 + 0.5, gTop); ctx.lineTo(x1 + 0.5, fTop + fH); ctx.stroke(); ctx.restore();
    const fNow = sampleAt(fr, nowI);
    if (phW) {
      const R = phW * 0.42, pcx = x + w - phW / 2, pcy = gc + 6;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(pcx, pcy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pcx - R - 6, pcy); ctx.lineTo(pcx + R + 6, pcy); ctx.moveTo(pcx, pcy - R - 6); ctx.lineTo(pcx, pcy + R + 6); ctx.stroke();
      // phase from the analytic signal: angle of (u, H[u]) — reconstruct from envelope & gamma
      const phaseAt = (i) => {
        const u = sampleAt(g, i), A = Math.max(1e-9, sampleAt(env, i));
        const cosv = clamp(u / A, -1, 1);
        // sign of sin from the derivative: a rising cosine means phase in (π, 2π)
        const du = sampleAt(g, i + 1) - sampleAt(g, i - 1);
        return du > 0 ? -Math.acos(cosv) : Math.acos(cosv);
      };
      for (let k = 18; k >= 0; k--) {
        const i = nowI - k;
        const ph = phaseAt(i), A = sampleAt(env, i) / envMax;
        ctx.fillStyle = `rgb(${colors.amberRgb} / ${(0.5 * (1 - k / 19)).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(pcx + Math.cos(ph) * R * A, pcy - Math.sin(ph) * R * A, 2.4, 0, Math.PI * 2); ctx.fill();
      }
      const ph = phaseAt(nowI), A = sampleAt(env, nowI) / envMax;
      ctx.strokeStyle = colors.amber; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pcx, pcy); ctx.lineTo(pcx + Math.cos(ph) * R * A, pcy - Math.sin(ph) * R * A); ctx.stroke();
      ctx.fillStyle = colors.amber; ctx.beginPath(); ctx.arc(pcx + Math.cos(ph) * R * A, pcy - Math.sin(ph) * R * A, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      text('A(t)·e^iφ(t)', pcx, pcy - R - 18, { color: colors.mid, alpha: a, align: 'center' });
      text(`f = ${fNow.toFixed(1)} Hz`, pcx, pcy + R + 22, { color: colors.hi, alpha: a, align: 'center', size: 13, weight: 600 });
      text('slowed 20× so the phase is visible', pcx, pcy + R + 40, { color: colors.low, alpha: a, align: 'center', size: 10 });
    } else {
      text(`f now = ${fNow.toFixed(1)} Hz`, x1, fTop - 6, { color: colors.hi, alpha: a, align: 'right', base: 'bottom', weight: 600 });
    }
  }

  function drawNumber() {
    const a = smooth(4.0, 4.25, f);
    if (a <= 0) return;
    const { x, y, w, h } = plot;
    const narrow = w < 560;
    const histW = narrow ? Math.min(90, w * 0.24) : Math.min(170, w * 0.22);
    const numW = narrow ? 0 : Math.min(150, w * 0.2);
    const x0 = x, x1 = x + w - histW - numW - (narrow ? 12 : 36);
    const rows = [
      { r: S, color: colors.cn, name: 'Steady', reveal: smooth(4.02, 4.25, f) },
      { r: Wd, color: colors.ad, name: 'Wandering', reveal: smooth(4.15, 4.42, f) },
    ];
    const rowH = h / 2;
    const fMin = 15, fMax = 75;
    rows.forEach(({ r, color, name, reveal }, idx) => {
      const top = y + idx * rowH + 18, hh = rowH - 40;
      const fy = (v) => top + hh - ((v - fMin) / (fMax - fMin)) * hh;
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = `rgb(${colors.violetRgb} / 0.05)`;
      ctx.fillRect(x0, fy(75), x1 - x0, fy(25) - fy(75)); ctx.restore();
      hline(x0, x1, fy(40), colors.line, a);
      text(`${name} · f(t), 4.1 s`, x0, top - 6, { color: colors.mid, alpha: a, base: 'bottom' });
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = color; ctx.fillRect(x0 - 12, top - 12, 6, 6); ctx.restore();
      for (const v of [25, 40, 75]) text(`${v}`, x1 + 6, fy(v), { color: colors.low, alpha: a * 0.9, size: 10 });
      trace((i) => fy(r.ifreq[i]), x0, x1, 0, r.ifreq.length, { color, width: 1, alpha: a, clipTop: top, clipBot: top + hh, upTo: reveal });

      // Histogram of the valid readings, on the same frequency axis.
      const bins = new Float32Array(60);
      let total = 0;
      for (const v of r.ifreq) if (v > 25 && v < 80) { const b = Math.floor(v - fMin); if (b >= 0 && b < 60) { bins[b]++; total++; } }
      let mx = 1; for (const b of bins) mx = Math.max(mx, b);
      const hx = x1 + 30;
      ctx.save(); ctx.globalAlpha = a * reveal; ctx.fillStyle = color;
      for (let b = 0; b < 60; b++) {
        const v0 = fMin + b, yy = fy(v0 + 1), hh2 = Math.max(1, fy(v0) - fy(v0 + 1) - 1);
        const len = (bins[b] / mx) * (histW - 10);
        if (len > 0.5) ctx.fillRect(hx, yy, len, hh2);
      }
      ctx.restore();
      // ±σ bracket around the mean.
      const m = r.mean, sd = r.std;
      ctx.save(); ctx.globalAlpha = a * reveal; ctx.strokeStyle = colors.hi; ctx.lineWidth = 1.5;
      const bx = hx - 8;
      ctx.beginPath(); ctx.moveTo(bx + 5, fy(m + sd)); ctx.lineTo(bx, fy(m + sd)); ctx.lineTo(bx, fy(m - sd)); ctx.lineTo(bx + 5, fy(m - sd)); ctx.stroke();
      ctx.restore();
      const val = (sd * reveal).toFixed(2);
      if (numW) {
        const nx = x + w - numW + 10, ny = top + hh / 2;
        text('std_ifreq', nx, ny - 24, { color: colors.low, alpha: a * reveal, size: 10.5 });
        text(val, nx, ny + 4, { color: colors.hi, alpha: a * reveal, size: 30, weight: 600, font: 'Inter, system-ui, sans-serif' });
        text('Hz', nx, ny + 30, { color: colors.mid, alpha: a * reveal, size: 11 });
      } else {
        text(`σ ${val} Hz`, x1, top - 6, { color: colors.hi, alpha: a * reveal, align: 'right', base: 'bottom', weight: 600, size: 12 });
      }
    });
  }

  /* ── frame ───────────────────────────────────────────────────────────── */
  function frame(now) {
    raf = 0;
    if (!visible) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    const rate = reduced ? 0 : lerp(lerp(lerp(240, 150, smooth(1.9, 2.3, f)), 25, smooth(2.9, 3.15, f)), 0, smooth(3.9, 4.1, f));
    tape = (tape + rate * dt) % L;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW(), cssH());
    const W = Math.round(lerp(1000, 300, smooth(2.9, 3.15, f)));
    const start = tape;

    if (f < 2.2) drawMontage(W, start);
    if (f >= 2.1 && f < 3.3) drawModes(W, start);
    if (f >= 2.95 && f < 4.15) drawRhythm(W, start);
    if (f >= 3.95) drawNumber();

    if (hud.t) {
      const secs = (w0 + ((start + W) % L)) / fs;
      hud.t.textContent = `00:0${Math.floor(secs)}.${Math.floor((secs % 1) * 10)}`;
    }
    raf = requestAnimationFrame(frame);
  }

  function setF(value) {
    f = clamp(value, 0, 5);
  }

  function setVisible(v) {
    if (v === visible) return;
    visible = v;
    if (v && !raf) { last = 0; raf = requestAnimationFrame(frame); }
  }

  function refreshTheme() { colors = readColors(); }

  resize();
  return { setF, setVisible, resize, refreshTheme, get f() { return f; } };
}
