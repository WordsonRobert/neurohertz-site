/**
 * charts.js — Chapters 07 and 08, plus the montage card in 06.
 *
 * Numbers here are the pipeline's reported results (results/README.md in the
 * NeuroHertz repo). The sweep grid is computed live by the DSP worker on the
 * synthetic recording; nothing in this file invents a per-subject value.
 */
import { runJob } from './dsp/client.js';
import { buildScalp } from './scalp.js';
import { CHANNELS } from './dsp/montage.js';

const RESULTS = {
  kDist: [[6, 19], [7, 15], [8, 18], [9, 36]],
  aDist: [[1000, 8], [2000, 10], [3000, 15], [4000, 55]],
  confusion: { tn: 22, fp: 7, fn: 10, tp: 26 },
  groups: [
    { key: 'cn', name: 'Controls', n: 29, mean: 5.53, sd: 1.09 },
    { key: 'ad', name: "Alzheimer's", n: 36, mean: 7.17, sd: 1.89 },
  ],
  bench: [
    { name: 'Shamsi, 2025', meta: 'Wavelet scattering, many features · 5-fold GroupKFold', acc: 83.1, muted: true },
    { name: 'Miltiadous et al., 2023', meta: '95 features · random forest · leave-one-subject-out', acc: 77.01 },
    { name: 'NeuroHertz', meta: '1 feature · logistic regression · leave-one-subject-out', acc: 73.8, ours: true },
  ],
  baseline: 55.4,
};

const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, parent) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent?.append(n); return n; };

function onVisible(el, fn, margin = '0px 0px -12% 0px') {
  if (!el) return;
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin: margin });
  io.observe(el);
}

/* ── Tooltip (one for the page) ─────────────────────────────────────────── */
function initTooltip() {
  const tip = h('div', 'tip');
  tip.setAttribute('role', 'tooltip');
  const v = h('b'), l = h('span');
  tip.append(v, l);
  document.body.append(tip);
  const show = (el, x, y) => {
    v.textContent = el.dataset.tipValue || '';
    l.textContent = el.dataset.tip || '';
    tip.classList.add('is-on');
    const r = tip.getBoundingClientRect();
    const tx = Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2));
    const ty = y - r.height - 14 < 8 ? y + 18 : y - r.height - 14;
    tip.style.transform = `translate(${tx}px, ${ty}px)`;
  };
  const hide = () => tip.classList.remove('is-on');
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el) show(el, e.clientX, e.clientY); else hide();
  }, { passive: true });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    show(el, r.left + r.width / 2, r.top);
  });
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, { passive: true });
}

/* ── 07 · sweep grid ────────────────────────────────────────────────────── */
function initSweep() {
  const grid = document.getElementById('sweep-grid');
  const status = document.getElementById('sweep-status');
  if (!grid) return;
  const Ks = [6, 7, 8, 9], As = [1000, 2000, 3000, 4000];
  for (const a of As) grid.append(Object.assign(h('div', 'sweep__h', `α ${a}`), { role: 'columnheader' }));
  const cells = {};
  for (const K of Ks) {
    const rh = h('div', 'sweep__h', `K ${K}`); rh.setAttribute('role', 'rowheader');
    grid.append(rh);
    for (const a of As) {
      const c = h('div', 'sweep__cell');
      c.setAttribute('role', 'cell');
      c.tabIndex = 0;
      if (K === 8 && a === 2000) c.classList.add('is-default');
      const cv = h('canvas'); const lab = h('span', null, '…');
      c.append(cv, lab);
      c.dataset.tip = `K = ${K}, α = ${a}${K === 8 && a === 2000 ? ' · Session 2 default' : ''}`;
      c.dataset.tipValue = 'decomposing…';
      grid.append(c);
      cells[`${K}-${a}`] = { el: c, cv, lab };
    }
  }

  const amber = () => getComputedStyle(document.documentElement).getPropertyValue('--amber').trim();
  function draw({ cv }, gamma) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, hh = cv.clientHeight;
    cv.width = w * dpr; cv.height = hh * dpr;
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    let mx = 1e-9; for (const v of gamma) mx = Math.max(mx, Math.abs(v));
    ctx.strokeStyle = amber(); ctx.lineWidth = 1.2; ctx.beginPath();
    const n = gamma.length;
    for (let i = 0; i < n; i++) {
      const x = 6 + (i / (n - 1)) * (w - 12);
      const y = hh * 0.44 - (gamma[i] / mx) * hh * 0.3;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  onVisible(grid, () => {
    let done = 0;
    const order = Ks.flatMap((K) => As.map((a) => `${K}-${a}`));
    cells[order[0]].el.classList.add('is-scan');
    runJob('grid', {}, (cell) => {
      const key = `${cell.K}-${cell.alpha}`;
      const c = cells[key];
      c.el.classList.remove('is-scan');
      draw(c, cell.gamma);
      c.lab.textContent = `γ ${cell.gammaHz.toFixed(1)} Hz`;
      c.el.dataset.tipValue = `γ mode at ${cell.gammaHz.toFixed(1)} Hz`;
      c.el.dataset.tip = `K = ${cell.K}, α = ${cell.alpha} · std_ifreq ${cell.std.toFixed(2)} Hz${cell.K === 8 && cell.alpha === 2000 ? ' · Session 2 default' : ''}`;
      done++;
      status.textContent = done < 16 ? `decomposing ${done}/16` : '16 decompositions · live';
      if (order[done]) cells[order[done]].el.classList.add('is-scan');
    }).catch(() => { status.textContent = 'unavailable'; });
  }, '400px 0px 400px 0px');
}

/* ── 07 · VAE diagram + distributions ───────────────────────────────────── */
function initVae() {
  const g = document.querySelector('.vae__layers');
  if (!g) return;
  const layers = [256, 128, 128, 16, 128, 128, 256];
  const W = 320, top = 14, maxH = 78;
  const xs = layers.map((_, i) => 22 + i * ((W - 44) / (layers.length - 1)));
  const hs = layers.map((n) => 12 + (Math.log2(n) / 8) * (maxH - 12));
  for (let i = 0; i < layers.length - 1; i++) {
    const y0 = top + (maxH - hs[i]) / 2, y1 = top + (maxH - hs[i + 1]) / 2;
    s('path', { class: 'lk', d: `M${xs[i] + 7},${y0} L${xs[i + 1] - 7},${y1} M${xs[i] + 7},${y0 + hs[i]} L${xs[i + 1] - 7},${y1 + hs[i + 1]}` }, g);
  }
  layers.forEach((n, i) => {
    s('rect', { class: i === 3 ? 'lay lat' : 'lay', x: xs[i] - 7, y: top + (maxH - hs[i]) / 2, width: 14, height: hs[i], rx: 4 }, g);
    s('text', { x: xs[i], y: top + maxH + 13 }, g).textContent = n;
  });
  s('text', { class: 'lbl', x: (xs[0] + xs[2]) / 2, y: 8 }, g).textContent = 'ENCODER';
  s('text', { class: 'lbl', x: xs[3], y: 8 }, g).textContent = 'LATENT';
  s('text', { class: 'lbl', x: (xs[4] + xs[6]) / 2, y: 8 }, g).textContent = 'DECODER';
}

function bars(el, rows, fmt, sym) {
  if (!el) return;
  const max = Math.max(...rows.map(([, n]) => n));
  const fills = [];
  for (const [k, n] of rows) {
    const row = h('div', 'bar');
    row.tabIndex = 0;
    row.dataset.tip = `Best ${sym} = ${fmt(k)}`;
    row.dataset.tipValue = `${n} of 88 recordings`;
    const track = h('div', 'bar__track');
    const fill = h('div', 'bar__fill');
    track.append(fill);
    row.append(h('span', 'bar__k', fmt(k)), track, h('span', 'bar__v', String(n)));
    el.append(row);
    fills.push([fill, n / max]);
  }
  onVisible(el, () => fills.forEach(([f, p], i) => setTimeout(() => { f.style.width = `${(p * 100).toFixed(1)}%`; }, i * 90)));
}

/* ── 08 · units, whisker, benchmark ─────────────────────────────────────── */
function initUnits() {
  const root = document.getElementById('units');
  if (!root) return;
  const { tn, fp, fn, tp } = RESULTS.confusion;
  const groups = [
    { name: "Alzheimer's", n: tp + fn, ok: tp, miss: fn, cls: 'ad', okTip: "Alzheimer's · predicted Alzheimer's", missTip: "Alzheimer's · predicted control" },
    { name: 'Controls', n: tn + fp, ok: tn, miss: fp, cls: 'cn', okTip: 'Control · predicted control', missTip: "Control · predicted Alzheimer's" },
  ];
  const all = [];
  for (const g of groups) {
    const wrap = h('div', 'ugroup');
    const head = h('div', 'ugroup__head');
    const nm = h('span'); nm.append(h('b', null, g.name), document.createTextNode(` · n = ${g.n}`));
    head.append(nm, h('span', null, `${g.ok} correct · ${g.miss} missed`));
    const cells = h('div', 'ugroup__cells');
    cells.setAttribute('role', 'img');
    cells.setAttribute('aria-label', `${g.name}: ${g.ok} of ${g.n} classified correctly, ${g.miss} misclassified`);
    for (let i = 0; i < g.n; i++) {
      const miss = i >= g.ok;
      const c = h('span', `ucell ucell--${g.cls}${miss ? ' ucell--miss' : ''}`);
      c.style.setProperty('--c', `var(--${g.cls})`);
      c.dataset.tip = miss ? g.missTip : g.okTip;
      c.dataset.tipValue = miss ? 'Misclassified' : 'Correct';
      cells.append(c);
      all.push(c);
    }
    wrap.append(head, cells);
    root.append(wrap);
  }
  onVisible(root, () => all.forEach((c, i) => setTimeout(() => c.classList.add('is-in'), i * 14)));
}

function initWhisker() {
  const root = document.getElementById('whisker');
  if (!root) return;
  const svg = s('svg', { viewBox: '0 0 560 150', preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'std_ifreq mean and standard deviation: controls 5.53 ± 1.09 Hz, Alzheimer’s 7.17 ± 1.89 Hz' }, root);
  const x0 = 110, x1 = 540, lo = 2, hi = 11;
  const X = (v) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
  const ax = s('g', { class: 'axis' }, svg);
  for (let v = 2; v <= 10; v += 2) {
    s('line', { x1: X(v), x2: X(v), y1: 14, y2: 118 }, ax);
    s('text', { x: X(v), y: 136, 'text-anchor': 'middle' }, ax).textContent = `${v}`;
  }
  s('text', { x: x1, y: 150, 'text-anchor': 'end', class: 'wlabel' }, svg).textContent = 'std_ifreq (Hz)';
  RESULTS.groups.forEach((g, i) => {
    const y = 42 + i * 52;
    s('text', { x: 0, y: y + 4, class: 'wname' }, svg).textContent = `${g.name}`;
    s('text', { x: 0, y: y + 20, class: 'wlabel' }, svg).textContent = `n = ${g.n}`;
    s('line', { x1: X(g.mean - g.sd), x2: X(g.mean + g.sd), y1: y, y2: y, stroke: `var(--${g.key})`, 'stroke-width': 2, 'stroke-linecap': 'round' }, svg);
    for (const e of [g.mean - g.sd, g.mean + g.sd]) s('line', { x1: X(e), x2: X(e), y1: y - 6, y2: y + 6, stroke: `var(--${g.key})`, 'stroke-width': 2, 'stroke-linecap': 'round' }, svg);
    const dot = s('circle', { cx: X(g.mean), cy: y, r: 6, fill: `var(--${g.key})`, stroke: 'var(--surface-chart)', 'stroke-width': 2, tabindex: 0 }, svg);
    dot.dataset.tip = `${g.name} · n = ${g.n} · mean ± SD`;
    dot.dataset.tipValue = `${g.mean.toFixed(2)} ± ${g.sd.toFixed(2)} Hz`;
    s('circle', { cx: X(g.mean), cy: y, r: 14, fill: 'transparent', 'data-tip': dot.dataset.tip, 'data-tip-value': dot.dataset.tipValue }, svg);
    s('text', { x: X(g.mean + g.sd) + 10, y: y + 4, class: 'wval' }, svg).textContent = `${g.mean.toFixed(2)} ± ${g.sd.toFixed(2)}`;
  });
}

function initBench() {
  const root = document.getElementById('bench-bars');
  if (!root) return;
  const fills = [];
  for (const b of RESULTS.bench) {
    const row = h('div', `hbar${b.ours ? ' hbar--ours' : ''}${b.muted ? ' hbar--muted' : ''}`);
    row.tabIndex = 0;
    row.dataset.tip = `${b.name} · ${b.meta}`;
    row.dataset.tipValue = `${b.acc.toFixed(1)}% accuracy`;
    const top = h('div', 'hbar__top');
    top.append(h('b', null, b.name), h('span', 'hbar__meta', b.meta));
    const track = h('div', 'hbar__track');
    const fill = h('div', 'hbar__fill');
    const val = h('span', 'hbar__val', `${b.acc.toFixed(1)}%`);
    track.append(fill, val);
    row.append(top, track);
    root.append(row);
    fills.push([fill, val, b.acc]);
  }
  const axis = h('div', 'hbar__axis');
  axis.innerHTML = '<span>0%</span><span>100%</span>';
  const base = h('div', 'hbar__base');
  base.style.left = `${RESULTS.baseline}%`;
  base.dataset.tip = 'Always guess the larger group';
  base.dataset.tipValue = `Majority-class baseline · ${RESULTS.baseline}%`;
  base.append(h('span', null, `baseline ${RESULTS.baseline}%`));
  root.append(axis);
  root.style.position = 'relative';
  root.append(base);
  onVisible(root, () => fills.forEach(([f, v, acc], i) => setTimeout(() => {
    f.style.width = `${acc}%`;
    v.style.left = `${acc}%`;
  }, i * 140)));
}

/* ── 06 · montage card ──────────────────────────────────────────────────── */
function initMontage(stage) {
  const svg = document.getElementById('montage-map');
  const hint = document.getElementById('montage-hint');
  if (!svg) return;
  const map = buildScalp(svg, { radius: 0.095 });
  const info = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));
  const original = hint.textContent;
  let active = null;
  const select = (id) => {
    if (active) map.set(active, 'active', false);
    active = id;
    if (id) {
      map.set(id, 'active', true);
      const c = info[id];
      hint.textContent = '';
      hint.append(Object.assign(document.createElement('b'), { textContent: id }), document.createTextNode(` · ${c.region} · ${c.side}`));
    } else hint.textContent = original;
    stage?.highlight(id);
  };
  for (const [id, node] of Object.entries(map.nodes)) {
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', `${id}: ${info[id].region}, ${info[id].side.toLowerCase()}`);
    node.addEventListener('pointerenter', () => select(id));
    node.addEventListener('focus', () => select(id));
    node.addEventListener('click', () => select(id));
  }
  svg.addEventListener('pointerleave', () => select(null));
  svg.addEventListener('focusout', (e) => { if (!svg.contains(e.relatedTarget)) select(null); });
}

/* ── reveals ────────────────────────────────────────────────────────────── */
function initReveals() {
  const targets = document.querySelectorAll('.chapter__head, .chapter .panel, .flow, .bench__head');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  targets.forEach((t, i) => { t.classList.add('reveal'); t.style.transitionDelay = `${(i % 4) * 70}ms`; io.observe(t); });
}

export function initCharts({ stage } = {}) {
  initTooltip();
  initSweep();
  initVae();
  bars(document.getElementById('dist-k'), RESULTS.kDist, (k) => `${k}`, 'K');
  bars(document.getElementById('dist-a'), RESULTS.aDist, (a) => `${a}`, 'α');
  initUnits();
  initWhisker();
  initBench();
  initMontage(stage);
  initReveals();
}
