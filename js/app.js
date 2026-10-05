/**
 * app.js — Entry point. Seats the electrodes, then hands the page to the story.
 *
 * The boot screen is an impedance check: each of the 19 electrodes lights as
 * real work completes — fonts, the 3D stage, and the DSP worker's run of the
 * pipeline on the synthetic recording. Nothing is shown until the film has the
 * numbers it is about to draw.
 */
import { buildScalp } from './scalp.js';
import { runJob } from './dsp/client.js';
import { CHANNEL_IDS } from './dsp/montage.js';
import { createScope } from './scope.js';
import { initStory } from './story.js';
import { initCharts } from './charts.js';
import { initLab } from './lab.js';
import { initTheme } from './theme.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);

/* ── Boot: the electrode check ──────────────────────────────────────────── */
const bootEl = $('boot');
const bootMap = buildScalp($('boot-map'), { radius: 0.1 });
const tasks = { fonts: [0.12, 0], stage: [0.38, 0], dsp: [0.5, 0] };
let shown = 0, lit = 0;
const logged = [];

function target() { return Object.values(tasks).reduce((s, [w, p]) => s + w * p, 0); }

function bootLog(html) {
  const li = document.createElement('li');
  li.innerHTML = html;
  $('boot-log').append(li);
  logged.push(li);
  while (logged.length > 5) logged.shift().remove();
}

function bootTick() {
  const goal = target();
  shown += (goal - shown) * (reduced ? 1 : 0.12);
  if (goal - shown < 0.002) shown = goal;
  const want = Math.min(19, Math.floor(shown * 19 + 0.0001));
  while (lit < want) {
    const id = CHANNEL_IDS[lit];
    bootMap.set(id, 'on');
    bootLog(`${id.padEnd(3, ' ')} · contact · <b>OK</b>`);
    lit++;
  }
  $('boot-count').textContent = String(lit).padStart(2, '0');
  $('boot-fill').style.width = `${(shown * 100).toFixed(1)}%`;
  $('boot-pct').textContent = `${Math.round(shown * 100)}%`;
  if (shown < 1) requestAnimationFrame(bootTick);
}
requestAnimationFrame(bootTick);

function task(name, label) {
  $('boot-task').textContent = label;
  return (p = 1) => { tasks[name][1] = p; };
}

/* ── Load ───────────────────────────────────────────────────────────────── */
const lowPower = (navigator.hardwareConcurrency || 8) <= 4 || window.innerWidth < 700;

const fontsDone = task('fonts', 'Impedance check');
const fontsP = (document.fonts?.ready || Promise.resolve()).then(() => fontsDone());

const stageDone = task('stage', 'Building the head');
const stageP = import('./gl/stage.js')
  .then((m) => { stageDone(0.6); return m.createStage($('gl'), $('labels'), { lowPower }); })
  .then((s) => { stageDone(); return s; })
  .catch((e) => { console.warn('3D stage unavailable:', e); document.body.classList.add('no-gl'); stageDone(); return null; });

const dspDone = task('dsp', 'Decomposing P3');
const dspP = runJob('film').then((d) => { dspDone(); return d; });

const minWait = new Promise((r) => setTimeout(r, reduced ? 0 : 1300));

Promise.all([fontsP, stageP, dspP, minWait]).then(([, stage, film]) => {
  $('boot-task').textContent = 'All 19 channels seated';
  setTimeout(() => start(stage, film), reduced ? 0 : 520);
}).catch((e) => {
  console.error(e);
  bootEl.classList.add('is-done');
  document.body.classList.remove('is-booting');
});

/* ── Start ──────────────────────────────────────────────────────────────── */
function start(stage, film) {
  bootEl.classList.add('is-done');
  document.body.classList.remove('is-booting');

  // The film's oscilloscope, framed to sit clear of the step cards.
  const scopeCanvas = $('scope');
  const firstCard = document.querySelector('#film .step__card');
  const scope = createScope(scopeCanvas, film, {
    hud: { t: $('hud-t') },
    plotRect(w, h) {
      if (window.innerWidth > 900 && firstCard) {
        const cr = firstCard.getBoundingClientRect();
        const fr = scopeCanvas.getBoundingClientRect();
        const x = Math.max(w * 0.3, cr.right - fr.left + 44);
        return { x, y: 70, w: w - x - 56, h: h - 70 - 92 };
      }
      return { x: 12, y: 64, w: w - 24, h: h - 64 - 40 };
    },
  });

  // Film furniture that changes per beat.
  const filmMap = buildScalp($('film-map'), { radius: 0.085, labels: false });
  filmMap.all('on');
  const beatText = ['RAW · 19 CHANNELS', 'CLEANING · 19 CHANNELS', 'P3 · VMD K=8 · α=2000', 'P3 · γ MODE · HILBERT', 'STD_IFREQ · TWO RECORDINGS'];
  const S = film.steady, W = film.wandering;
  const g = S.omegaHz[S.gammaIdx];
  const omegaEl = document.querySelector('#omega-readout span');
  omegaEl.innerHTML = [...S.omegaHz].sort((a, b) => a - b).map((w) => (w === g ? `<b>${w.toFixed(1)}</b>` : w.toFixed(1))).join(' · ') + ' Hz';
  const onBeat = (beat) => {
    $('film-beat').textContent = beatText[beat];
    const focus = beat >= 2;
    filmMap.all('on', !focus);
    filmMap.all('dim', focus);
    filmMap.set('P3', 'dim', false);
    filmMap.set('P3', 'active', focus);
    $('hud-ch').textContent = focus ? 'P3' : '19';
    $('hud-g').textContent = focus ? `${g.toFixed(1)} Hz` : '—';
    $('hud-s').textContent = beat >= 4 ? `${S.std.toFixed(2)} | ${W.std.toFixed(2)}` : beat >= 3 ? `${S.std.toFixed(2)} Hz` : '—';
  };

  const story = initStory({ scope, stage, film: { onBeat } });
  initCharts({ stage });
  const lab = initLab();

  initTheme(() => {
    stage?.applyTheme();
    scope.refreshTheme();
    lab?.refreshTheme();
  });

  // "wander": the hero's one interaction — desynchronise the brain's gamma.
  const wander = $('wander');
  let pinned = false;
  const setDrift = (on) => stage?.setState({ drift: on ? 1 : 0 });
  wander.addEventListener('pointerenter', () => setDrift(true));
  wander.addEventListener('pointerleave', () => setDrift(pinned));
  wander.addEventListener('focus', () => setDrift(true));
  wander.addEventListener('blur', () => setDrift(pinned));
  wander.addEventListener('click', () => { pinned = !pinned; wander.setAttribute('aria-pressed', String(pinned)); setDrift(pinned); });

  initMenu();
  story.measure();
}

function initMenu() {
  const btn = $('menu-toggle');
  const menu = $('menu');
  const set = (open) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close chapter menu' : 'Open chapter menu');
  };
  btn.addEventListener('click', () => set(menu.hidden));
  document.addEventListener('nh:navigate', () => set(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { set(false); btn.focus(); } });
}
