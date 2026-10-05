/**
 * lab.js — Chapter 09. Every control maps to a constant at the top of one of
 * the four pipeline scripts. Changing one re-runs the whole chain on both
 * synthetic recordings in the DSP worker and redraws the active phase.
 */
import { runJob } from './dsp/client.js';
import { DEFAULTS } from './dsp/pipeline.js';

const CAPTIONS = {
  clean: 'P3, 4.1 s. Top: as recorded, with mains hum and drift. Middle: band-passed, notched and re-referenced, with the ±5σ̂ spike threshold. Bottom: after MAD repair; redrawn samples in amber.',
  decompose: 'Every VMD mode of the P3 window, lowest centre frequency first, each scaled to its row. The mode nearest the target is kept.',
  rhythm: 'The kept mode with its Hilbert envelope, and its instantaneous frequency. The shaded band is the range Phase 4 keeps.',
  score: 'Distribution of the kept instantaneous-frequency readings for both recordings. Their standard deviations are the biomarker; the gap between them is what a classifier gets to work with.',
};

const FMT = {
  lo: (v) => `${v.toFixed(1)} Hz`, hi: (v) => `${v} Hz`, threshold: (v) => `${v.toFixed(1)} σ̂`,
  margin: (v) => `±${v} samples`, K: (v) => `${v}`, alpha: (v) => `${v}`, target: (v) => `${v} Hz`,
  validLo: (v) => `${v} Hz`, validHi: (v) => `${v} Hz`,
};

export function initLab() {
  const root = document.getElementById('lab-app');
  if (!root) return null;
  const canvas = document.getElementById('lab-canvas');
  const ctx = canvas.getContext('2d');
  const caption = document.getElementById('lab-caption');
  const stateEl = document.getElementById('lab-state');
  const codeEl = document.getElementById('lab-code');
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const subjBtns = [...root.querySelectorAll('[data-subject]')];
  const inputs = [...root.querySelectorAll('.lab__inspector input')];
  const out = { steady: document.getElementById('r-steady'), wandering: document.getElementById('r-wandering'), gap: document.getElementById('r-gap') };

  const params = { lo: DEFAULTS.lo, hi: DEFAULTS.hi, notch: DEFAULTS.notch, threshold: DEFAULTS.threshold, margin: DEFAULTS.margin, K: DEFAULTS.K, alpha: DEFAULTS.alpha, target: DEFAULTS.target, validLo: DEFAULTS.validLo, validHi: DEFAULTS.validHi };
  let tab = 'clean', subject = 'steady', data = null, req = 0, timer = 0, colors = null, started = false;

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    colors = { hi: v('--t-hi'), t: v('--t'), mid: v('--t-mid'), low: v('--t-low'), line: `rgb(${v('--line-rgb')} / 0.16)`, violet: v('--violet'), violetHi: v('--violet-hi'), violetRgb: v('--violet-rgb'), amber: v('--amber'), amberRgb: v('--amber-rgb'), cn: v('--cn'), ad: v('--ad'), mono: v('--font-mono') };
  }

  /* ── controls ───────────────────────────────────────────────────────── */
  function syncControl(input) {
    const name = input.name;
    if (input.type === 'checkbox') { params[name] = input.checked; return; }
    const v = Number(input.value);
    params[name] = v;
    const o = root.querySelector(`output[data-for="${name}"]`);
    if (o) o.textContent = FMT[name](v);
    const pct = ((v - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
    input.style.setProperty('--fill', `${pct}%`);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(compute, 140);
    renderCode();
  }

  async function compute() {
    const id = ++req;
    stateEl.textContent = 'computing…';
    stateEl.classList.add('is-busy');
    const t0 = performance.now();
    try {
      const r = await runJob('lab', { ...params });
      if (id !== req) return;
      data = r;
      stateEl.textContent = `ready · ${Math.round(performance.now() - t0)} ms`;
      stateEl.classList.remove('is-busy');
      renderReadout();
      draw();
    } catch (e) {
      if (id !== req) return;
      stateEl.textContent = 'error';
      console.error(e);
    }
  }

  function renderReadout() {
    const a = data.steady.std, b = data.wandering.std;
    out.steady.textContent = Number.isFinite(a) ? `${a.toFixed(2)} Hz` : '—';
    out.wandering.textContent = Number.isFinite(b) ? `${b.toFixed(2)} Hz` : '—';
    out.gap.textContent = Number.isFinite(a) && Number.isFinite(b) ? `${b - a >= 0 ? '+' : '−'}${Math.abs(b - a).toFixed(2)} Hz · ×${(b / a).toFixed(2)}` : '—';
  }

  function renderCode() {
    const line = (prefix, key, fmt, comment) => {
      const changed = params[key] !== DEFAULTS[key];
      const val = fmt(params[key]);
      return `${prefix}<span class="${changed ? 'ch' : 'k'}">${val}</span>${changed ? `<span class="c">   # was ${fmt(DEFAULTS[key])}</span>` : comment ? `<span class="c">   ${comment}</span>` : ''}`;
    };
    const bound = (key) => `<span class="${params[key] !== DEFAULTS[key] ? 'ch' : 'k'}">${params[key]}</span>`;
    codeEl.innerHTML = [
      '<span class="c"># session1_preprocess.py</span>',
      line('l_freq        = ', 'lo', (v) => v.toFixed(1)),
      line('h_freq        = ', 'hi', (v) => v.toFixed(1)),
      line('notch_filter  = ', 'notch', (v) => (v ? '[50.0]' : 'None')),
      line('threshold_std = ', 'threshold', (v) => v.toFixed(1)),
      line('interp_margin = ', 'margin', (v) => String(v)),
      '<span class="c"># session2_vmd.py</span>',
      line('VMD_K     = ', 'K', (v) => String(v)),
      line('VMD_ALPHA = ', 'alpha', (v) => String(v)),
      line('TARGET_HZ = ', 'target', (v) => v.toFixed(1)),
      '<span class="c"># session4_classification.py</span>',
      `valid = (inst_freq &gt; ${bound('validLo')}) &amp; (inst_freq &lt; ${bound('validHi')})`,
    ].join('\n');
  }

  /* ── drawing ────────────────────────────────────────────────────────── */
  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, hh = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [w, hh];
  }

  function label(t, x, y, { color = colors.low, size = 10.5, align = 'left', weight = 500, base = 'middle' } = {}) {
    ctx.fillStyle = color; ctx.font = `${weight} ${size}px ${colors.mono}`; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(t, x, y);
  }

  function path(arr, x0, x1, yOf, { color, width = 1.1, from = 0, to = arr.length } = {}) {
    const n = to - from;
    const cols = x1 - x0;
    const step = Math.max(1, n / cols / 1.5);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
    ctx.beginPath();
    let first = true;
    for (let k = 0; k < n; k += step) {
      const i = from + Math.floor(k);
      const x = x0 + (Math.floor(k) / (n - 1)) * cols;
      const y = yOf(arr[i]);
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function rowScale(arr, rowH) { let mx = 1e-9; for (const v of arr) mx = Math.max(mx, Math.abs(v)); return (rowH * 0.42) / mx; }

  function drawClean(d, w, hh) {
    const x0 = 64, x1 = w - 12, rowH = (hh - 24) / 3;
    const rows = [
      { arr: d.raw, name: 'raw', color: colors.mid },
      { arr: d.referenced, name: 'filtered + ref', color: colors.t },
      { arr: d.signal, name: 'repaired', color: colors.hi },
    ];
    const sc = rowScale(d.referenced, rowH) * 1.3;
    rows.forEach((r, i) => {
      const cy = 12 + rowH * (i + 0.5);
      label(r.name, 8, cy);
      if (i >= 1) {
        // flagged regions
        ctx.fillStyle = `rgb(${colors.amberRgb} / 0.14)`;
        for (const [s, e] of d.regions) ctx.fillRect(x0 + (s / (r.arr.length - 1)) * (x1 - x0) - 2, cy - rowH * 0.48, ((e - s) / (r.arr.length - 1)) * (x1 - x0) + 4, rowH * 0.96);
      }
      if (i === 1) {
        ctx.strokeStyle = colors.amber; ctx.lineWidth = 1; ctx.globalAlpha = 0.8;
        for (const sgn of [1, -1]) { const y = Math.round(cy - sgn * d.threshold * sc) + 0.5; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
        ctx.globalAlpha = 1;
        label(`±${d.threshold.toFixed(1)} µV`, x1, cy - d.threshold * sc - 8, { color: colors.amber, align: 'right' });
      }
      const mean = i === 0 ? r.arr.reduce((a, b) => a + b, 0) / r.arr.length : 0;
      ctx.save(); ctx.beginPath(); ctx.rect(x0, cy - rowH / 2, x1 - x0, rowH); ctx.clip();
      path(r.arr, x0, x1, (v) => cy - (v - mean) * sc, { color: r.color, width: i === 2 ? 1.3 : 1 });
      if (i === 2) for (const [s, e] of d.regions) path(r.arr, x0 + (s / (r.arr.length - 1)) * (x1 - x0), x0 + (e / (r.arr.length - 1)) * (x1 - x0), (v) => cy - v * sc, { color: colors.amber, width: 2.2, from: s, to: e + 1 });
      ctx.restore();
    });
    label(`${d.regions.length} region${d.regions.length === 1 ? '' : 's'} repaired in this window`, x1, hh - 4, { align: 'right', base: 'bottom' });
  }

  function drawModes(d, w, hh) {
    const order = d.omegaHz.map((v, k) => [v, k]).sort((a, b) => a[0] - b[0]);
    const K = order.length, x0 = 118, x1 = w - 12, rowH = (hh - 10) / K;
    const show = 900;
    order.forEach(([om, k], idx) => {
      const cy = 5 + rowH * (idx + 0.5);
      const g = k === d.gammaIdx;
      label(`u${idx + 1}`, 8, cy, { color: g ? colors.amber : colors.low, weight: 600 });
      label(`${om.toFixed(1)} Hz`, 34, cy, { color: g ? colors.hi : colors.mid });
      const m = d.modes[k];
      const sc = rowScale(m, rowH);
      path(m, x0, x1, (v) => cy - v * sc, { color: g ? colors.amber : colors.t, width: g ? 1.8 : 1, from: 0, to: show });
      if (g) label(`nearest ${params.target} Hz`, x1, cy - rowH * 0.42, { color: colors.hi, align: 'right' });
    });
  }

  function drawRhythm(d, w, hh) {
    const x0 = 44, x1 = w - 36, show = 500;
    const gTop = 18, gH = hh * 0.42;
    const gc = gTop + gH / 2;
    let em = 1e-9; for (let i = 0; i < show; i++) em = Math.max(em, d.envelope[i]);
    const sc = (gH * 0.46) / em;
    label('γ mode and envelope · 1 s', x0, 8);
    ctx.fillStyle = `rgb(${colors.amberRgb} / 0.12)`;
    ctx.beginPath();
    for (let i = 0; i < show; i++) { const x = x0 + (i / (show - 1)) * (x1 - x0); const y = gc - d.envelope[i] * sc; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    for (let i = show - 1; i >= 0; i--) ctx.lineTo(x0 + (i / (show - 1)) * (x1 - x0), gc + d.envelope[i] * sc);
    ctx.fill();
    path(d.gamma, x0, x1, (v) => gc - v * sc, { color: colors.amber, width: 1.5, to: show });

    const fTop = gTop + gH + 34, fH = hh - fTop - 10;
    const lo = 10, hi = 100;
    const fy = (v) => fTop + fH - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * fH;
    label('instantaneous frequency (Hz) · 1 s', x0, fTop - 12);
    ctx.fillStyle = `rgb(${colors.violetRgb} / 0.1)`;
    ctx.fillRect(x0, fy(params.validHi), x1 - x0, fy(params.validLo) - fy(params.validHi));
    for (const v of [20, 40, 60, 80]) { ctx.strokeStyle = colors.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, Math.round(fy(v)) + 0.5); ctx.lineTo(x1, Math.round(fy(v)) + 0.5); ctx.stroke(); label(`${v}`, x1 + 6, fy(v), { size: 10 }); }
    ctx.save(); ctx.beginPath(); ctx.rect(x0, fTop, x1 - x0, fH); ctx.clip();
    path(d.ifreq, x0, x1, fy, { color: colors.violetHi, width: 1.4, to: show });
    ctx.restore();
  }

  function drawScore(w, hh) {
    const x0 = 44, x1 = w - 20, top = 26, bot = hh - 34;
    const lo = 15, hi = 75, bin = 1;
    const X = (v) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
    const hist = (arr) => {
      const b = new Float32Array(Math.ceil((hi - lo) / bin));
      let n = 0;
      for (const v of arr) if (v > params.validLo && v < params.validHi && v >= lo && v < hi) { b[Math.floor((v - lo) / bin)]++; n++; }
      return b.map((c) => c / Math.max(1, n));
    };
    const hs = { steady: hist(data.steady.ifreq), wandering: hist(data.wandering.ifreq) };
    let mx = 1e-9; for (const k in hs) for (const v of hs[k]) mx = Math.max(mx, v);
    ctx.fillStyle = `rgb(${colors.violetRgb} / 0.08)`;
    ctx.fillRect(X(params.validLo), top, X(params.validHi) - X(params.validLo), bot - top);
    for (const v of [20, 30, 40, 50, 60, 70]) { label(`${v}`, X(v), bot + 14, { align: 'center', size: 10 }); }
    ctx.strokeStyle = colors.line; ctx.beginPath(); ctx.moveTo(x0, bot + 0.5); ctx.lineTo(x1, bot + 0.5); ctx.stroke();
    label('instantaneous frequency (Hz)', x1, bot + 28, { align: 'right', size: 10 });
    for (const [key, color] of [['steady', colors.cn], ['wandering', colors.ad]]) {
      const b = hs[key];
      ctx.save();
      ctx.globalAlpha = key === subject ? 1 : 0.55;
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < b.length; i++) { const x = X(lo + (i + 0.5) * bin); const y = bot - (b[i] / mx) * (bot - top); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      ctx.globalAlpha *= 0.1; ctx.lineTo(X(hi), bot); ctx.lineTo(X(lo), bot); ctx.fill();
      ctx.restore();
      const d = data[key];
      if (Number.isFinite(d.mean)) {
        const y = key === 'steady' ? top + 6 : top + 24;
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(d.mean - d.std), y); ctx.lineTo(X(d.mean + d.std), y); ctx.stroke();
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(d.mean), y, 4, 0, Math.PI * 2); ctx.fill();
        label(`${key === 'steady' ? 'Steady' : 'Wandering'} · σ ${d.std.toFixed(2)} Hz`, X(d.mean + d.std) + 8, y, { color: colors.hi });
      }
    }
  }

  function draw() {
    if (!data || !colors) return;
    const [w, hh] = size();
    ctx.clearRect(0, 0, w, hh);
    const d = data[subject];
    if (tab === 'clean') drawClean(d, w, hh);
    else if (tab === 'decompose') drawModes(d, w, hh);
    else if (tab === 'rhythm') drawRhythm(d, w, hh);
    else drawScore(w, hh);
    caption.textContent = CAPTIONS[tab];
  }

  /* ── wiring ─────────────────────────────────────────────────────────── */
  tabs.forEach((t) => t.addEventListener('click', () => {
    tab = t.dataset.tab;
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b === t)));
    document.getElementById('lab-view').setAttribute('aria-labelledby', t.id);
    draw();
  }));
  root.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || !e.target.matches('[role="tab"]')) return;
    const i = tabs.indexOf(e.target);
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    n.focus(); n.click();
  });
  subjBtns.forEach((b) => b.addEventListener('click', () => {
    subject = b.dataset.subject;
    subjBtns.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    draw();
  }));
  inputs.forEach((i) => { syncControl(i); i.addEventListener('input', () => { syncControl(i); schedule(); }); });
  document.getElementById('lab-reset').addEventListener('click', () => {
    for (const i of inputs) {
      if (i.type === 'checkbox') i.checked = DEFAULTS[i.name];
      else i.value = DEFAULTS[i.name];
      syncControl(i);
    }
    schedule();
  });
  new ResizeObserver(() => draw()).observe(canvas);

  readColors();
  renderCode();
  caption.textContent = CAPTIONS.clean;
  const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting) && !started) { started = true; io.disconnect(); compute(); } }, { rootMargin: '600px 0px' });
  io.observe(root);

  return { refreshTheme() { readColors(); draw(); } };
}
